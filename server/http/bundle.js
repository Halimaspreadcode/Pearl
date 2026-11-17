const fs     = require('fs');
const path   = require('path');
const zlib   = require('zlib');
const vm     = require('vm');
const crypto = require('crypto');

// ── REGROUPEMENT DES SCRIPTS ET FEUILLES DE LA COQUILLE ───────
// index.html charge ~80 scripts classiques et ~45 feuilles, découpés pour
// la lisibilité. Au premier chargement, cela faisait ~130 requêtes. On les
// regroupe ici, au moment où la coquille est servie, sans étape de build
// et sans toucher à l'arborescence des sources :
//
//   - chaque suite CONTIGUË de <script src="/js/…"> (seuls des blancs ou
//     des commentaires HTML entre eux) devient un <script src="/bundle/app.<hash>.js"> ;
//   - chaque suite de <link rel="stylesheet" href="/css/…"> devient un
//     <link href="/bundle/app.<hash>.css"> ;
//   - les balises externes ou /vendor restent à leur place et coupent la
//     suite : l'ordre d'exécution de chaque script reste identique.
//
// Le paquet est la concaténation des fichiers, dans l'ordre, chacun précédé
// d'un repère `/* ── /js/xxx.js ── */`. Il est gardé en mémoire, compressé
// une fois, et servi avec un cache d'un an : son nom porte l'empreinte de
// son contenu, donc un fichier modifié donne un autre nom.
//
// Échappatoire : BUNDLE=0 dans l'environnement sert les balises d'origine
// (numéros de ligne exacts dans la console, pour déboguer).
//
// ── Ce qui change quand plusieurs scripts n'en font plus qu'un ──
// Des scripts classiques séparés partagent les mêmes globales, mais chacun
// est un « Script » distinct pour le moteur. Concaténés, trois différences
// apparaissent ; on s'en protège en coupant le paquet quand il le faut :
//
// 1. Remontée des `function f() {}` : dans un seul script, une fonction
//    déclarée dans un fichier ULTÉRIEUR existe déjà quand les fichiers
//    précédents s'exécutent. Un fichier qui teste au chargement
//    `typeof window.te === 'function'` (daily-workbook.js le fait) verrait
//    alors une fonction qui, en scripts séparés, n'existe pas encore.
//    Faute d'analyseur (pas de dépendance), on repère prudemment : si un
//    fichier déclare en colonne 0 un nom que l'un des fichiers précédents
//    du paquet sonde (`typeof nom`, `window.nom`, `'nom' in`, `nom =`),
//    ou redéclare un nom déjà déclaré, un nouveau paquet commence. C'est
//    volontairement large (quelques coupures inutiles plutôt qu'une seule
//    manquée) ; une référence directe au chargement à une fonction pas
//    encore chargée lèverait déjà une erreur en scripts séparés.
// 2. Directive "use strict" en tête de fichier : en tête de paquet, elle
//    rendrait strict tout le paquet ; au milieu, elle serait ignorée. Un
//    tel fichier reste seul dans son paquet (aucun aujourd'hui : celui de
//    daily-workbook.js est dans une fonction, sans effet de bord).
// 3. Isolement des erreurs : en scripts séparés, une exception levée au
//    chargement d'un fichier n'empêche pas les suivants de s'exécuter ; dans
//    un paquet, elle arrête le reste du paquet. Le test de non-régression
//    (tools/regression, partie ui) vérifie qu'aucune page n'a d'erreur au
//    chargement. Une erreur de SYNTAXE, elle, est détectée ici (vm.Script) :
//    le fichier fautif garde sa balise d'origine, comme avant.
//
// Côté CSS : @charset est retiré (le paquet est servi en UTF-8), un fichier
// contenant @import commence un nouveau paquet (l'@import doit précéder
// toute règle), les url() relatives sont réécrites en absolu (elles
// seraient sinon résolues depuis /bundle/), et un fichier aux accolades ou
// commentaires non refermés garde sa balise : il déborderait sur le suivant.

const PUBLIC_DIR = path.resolve(__dirname, '../../public');
const ACTIVE = process.env.BUNDLE !== '0';

// Balises reconnues : exactement celles d'index.html. Tout autre forme
// (attributs defer/async/type/media…) n'est pas touchée.
const RE_SCRIPT = /<script src="(\/js\/[^"?#]+\.js)"><\/script>/y;
const RE_LINK   = /<link rel="stylesheet" href="(\/css\/[^"?#]+\.css)">/y;
const RE_BETWEEN = /(?:\s|<!--[\s\S]*?-->)*/y;   // blancs et commentaires HTML

// Paquets servis : nom → { corps, gz, type, etag }. Borné : on garde les
// versions récentes pour une page ouverte juste avant une modification.
const _paquets = new Map();
const MAX_PAQUETS = 40;

// Dernière réécriture : { html, sig, sortie, fichiers }.
let _dernier = null;

function lire(url) {
  const cible = path.resolve(PUBLIC_DIR, '.' + url);
  if (!cible.startsWith(PUBLIC_DIR + path.sep)) return null;
  try { return fs.readFileSync(cible, 'utf-8'); } catch { return null; }
}

function signature(fichiers) {
  return fichiers.map(u => {
    try { const s = fs.statSync(path.join(PUBLIC_DIR, u)); return `${s.mtimeMs}:${s.size}`; }
    catch { return 'x'; }
  }).join('|');
}

// ── Repérage des suites de balises ────────────────────────────
// Renvoie les groupes { debut, fin, type, urls } dans l'ordre du document.
// Les balises situées dans un commentaire HTML sont ignorées.
function reperer(html) {
  const groupes = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    if (html.startsWith('<!--', lt)) {
      const fin = html.indexOf('-->', lt + 4);
      i = fin < 0 ? html.length : fin + 3;
      continue;
    }
    const type = balise(html, lt);
    if (!type) { i = lt + 1; continue; }
    const g = { debut: lt, fin: type.fin, type: type.type, urls: [type.url] };
    // Prolonge le groupe tant que la balise suivante est du même type,
    // séparée seulement par des blancs ou des commentaires.
    for (;;) {
      RE_BETWEEN.lastIndex = g.fin;
      RE_BETWEEN.exec(html);
      const suivante = balise(html, RE_BETWEEN.lastIndex);
      if (!suivante || suivante.type !== g.type) break;
      g.urls.push(suivante.url);
      g.fin = suivante.fin;
    }
    groupes.push(g);
    i = g.fin;
  }
  return groupes;
}

function balise(html, pos) {
  for (const [type, re] of [['js', RE_SCRIPT], ['css', RE_LINK]]) {
    re.lastIndex = pos;
    const m = re.exec(html);
    if (m) return { type, url: m[1], fin: re.lastIndex };
  }
  return null;
}

// ── JS : découpage en paquets sûrs ────────────────────────────
const RE_DECL = /^(?:async[ \t]+)?function[ \t]*\*?[ \t]*([A-Za-z_$][\w$]*)|^(?:var|let|const|class)[ \t]+([A-Za-z_$][\w$]*)/gm;
const RE_USE_STRICT = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*(['"])use strict\1/;
const echap = s => s.replace(/\$/g, '\\$');

function syntaxeValide(src) {
  try { new vm.Script(src); return true; } catch { return false; }
}

// Découpe une suite d'URL JS en segments. Un segment d'un seul fichier
// garde sa balise d'origine ; `seul: true` interdit de lui adjoindre
// d'autres fichiers.
function segmenterJs(urls) {
  const segments = [];
  let seg = null;
  const fermer = () => { if (seg) segments.push(seg); seg = null; };

  for (const url of urls) {
    const src = lire(url);
    if (src === null || !syntaxeValide(src) || RE_USE_STRICT.test(src)) {
      // Illisible (le navigateur aurait eu un 404), fautif ou strict :
      // balise d'origine, seule.
      fermer(); segments.push({ fichiers: [{ url, src }], seul: true }); continue;
    }
    const noms = [...src.matchAll(RE_DECL)].map(m => ({ nom: m[1] || m[2], fonction: !!m[1] }));
    if (seg && conflit(seg, noms)) { if (process.env.BUNDLE_DEBUG) console.log(`[bundle]   avant ${url}`); fermer(); }
    if (!seg) seg = { fichiers: [], noms: new Set() };
    seg.fichiers.push({ url, src });
    for (const n of noms) seg.noms.add(n.nom);
  }
  fermer();
  return segments;
}

function conflit(seg, noms) {
  for (const { nom, fonction } of noms) {
    if (seg.noms.has(nom)) return trace(`${nom} redéclaré`);
    const n = echap(nom);
    // Sondes vues au chargement : typeof (y compris sur une const encore
    // en zone morte, qui lèverait dans un seul script), window.nom
    // (fonctions seulement : const/let ne vont pas sur window), 'nom' in,
    // affectation nue.
    const motifs = [`typeof[ \\t(]+(?:(?:window|globalThis|self)\\.)?${n}(?![\\w$])`,
      `['"]${n}['"][ \\t]+in[ \\t]`, `(?:^|[^.\\w$])${n}[ \\t]*=(?!=)`];
    if (fonction) motifs.push(`(?:window|globalThis|self)\\.${n}(?![\\w$])`);
    const re = new RegExp(motifs.join('|'), 'm');
    const sondeur = seg.fichiers.find(f => re.test(f.src));
    if (sondeur) return trace(`${nom} sondé par ${sondeur.url} : « ${re.exec(sondeur.src)[0].trim()} »`);
  }
  return false;
}

// BUNDLE_DEBUG=1 : affiche au démarrage pourquoi un paquet a été coupé.
function trace(raison) {
  if (process.env.BUNDLE_DEBUG) console.log(`[bundle] nouveau paquet — ${raison}`);
  return true;
}

function assemblerJs(fichiers) {
  // « ;\n » entre fichiers : un fichier sans point-virgule final ne doit pas
  // se souder au suivant (ASI) ; le saut de ligne referme un // final.
  return fichiers.map(f => `/* ── ${f.url} ── */\n${f.src}\n;\n`).join('');
}

// ── CSS ───────────────────────────────────────────────────────
// Accolades et commentaires équilibrés (chaînes ignorées) : sinon le
// fichier déborderait sur le suivant une fois concaténé.
function cssEquilibre(src) {
  let prof = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '*') {
      const fin = src.indexOf('*/', i + 2);
      if (fin < 0) return false;
      i = fin + 1;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      if (src[j] !== c) return false;
      i = j;
    } else if (c === '{') prof++;
    else if (c === '}') { if (--prof < 0) return false; }
  }
  return prof === 0;
}

function sansCommentaires(src) { return src.replace(/\/\*[\s\S]*?\*\//g, ''); }

// url(relative) → url(/css/dossier/relative), résolue depuis le fichier.
function reecrireUrls(src, url) {
  const dossier = path.posix.dirname(url);
  return src.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (tout, q, cible) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(cible)) return tout;   // absolue, data:, #id
    return `url(${q}${path.posix.normalize(path.posix.join(dossier, cible))}${q})`;
  });
}

function segmenterCss(urls) {
  const segments = [];
  let seg = null;
  const fermer = () => { if (seg) segments.push(seg); seg = null; };
  for (const url of urls) {
    let src = lire(url);
    if (src === null || !cssEquilibre(src)) {
      fermer(); segments.push({ fichiers: [{ url, src }], seul: true }); continue;
    }
    src = src.replace(/^﻿/, '').replace(/^\s*@charset\s+[^;]+;/i, '');
    src = reecrireUrls(src, url);
    if (seg && /@import\b/i.test(sansCommentaires(src))) fermer();
    if (!seg) seg = { fichiers: [] };
    seg.fichiers.push({ url, src });
  }
  fermer();
  return segments;
}

function assemblerCss(fichiers) {
  return fichiers.map(f => `/* ── ${f.url} ── */\n${f.src}\n`).join('');
}

// ── Construction ──────────────────────────────────────────────
function enregistrer(type, corps) {
  const hash = crypto.createHash('sha1').update(corps).digest('hex').slice(0, 12);
  const nom = `app.${hash}.${type}`;
  if (!_paquets.has(nom)) {
    const buf = Buffer.from(corps, 'utf-8');
    _paquets.set(nom, {
      corps: buf,
      gz: zlib.gzipSync(buf),
      type: type === 'js' ? 'application/javascript; charset=utf-8' : 'text/css; charset=utf-8',
      etag: `"${hash}"`,
    });
    while (_paquets.size > MAX_PAQUETS) _paquets.delete(_paquets.keys().next().value);
  }
  return `/bundle/${nom}`;
}

function baliseDe(type, url) {
  return type === 'js' ? `<script src="${url}"></script>` : `<link rel="stylesheet" href="${url}">`;
}

function remplacerGroupe(g) {
  const segments = g.type === 'js' ? segmenterJs(g.urls) : segmenterCss(g.urls);
  return segments.map(s => {
    if (s.seul || s.fichiers.length < 2) return s.fichiers.map(f => baliseDe(g.type, f.url)).join('\n');
    const corps = g.type === 'js' ? assemblerJs(s.fichiers) : assemblerCss(s.fichiers);
    // Filet : si la concaténation ne compile pas (redéclaration de
    // const entre deux fichiers…), on revient aux balises d'origine —
    // les scripts séparés, eux, n'échouent que fichier par fichier.
    if (g.type === 'js' && !syntaxeValide(corps)) return s.fichiers.map(f => baliseDe('js', f.url)).join('\n');
    return baliseDe(g.type, enregistrer(g.type, corps));
  }).join('\n');
}

// Point d'entrée pour la coquille : réécrit le HTML si besoin. Appelé à
// chaque rendu ; le coût courant est un stat() par fichier source (~125),
// la reconstruction n'a lieu que si un fichier ou la coquille a changé.
function rewriteShell(html) {
  if (!ACTIVE) return html;
  if (_dernier && _dernier.html === html) {
    if (signature(_dernier.fichiers) === _dernier.sig) return _dernier.sortie;
  }
  const groupes = reperer(html);
  const fichiers = groupes.flatMap(g => g.urls);
  const sig = signature(fichiers);
  let sortie = '', pos = 0;
  for (const g of groupes) {
    sortie += html.slice(pos, g.debut) + remplacerGroupe(g);
    pos = g.fin;
  }
  sortie += html.slice(pos);
  _dernier = { html, sig, sortie, fichiers };
  return sortie;
}

// Identifiant de l'état courant des paquets : la coquille compressée en
// cache doit être recalculée quand un nom de paquet change.
function stateId() {
  return ACTIVE && _dernier ? crypto.createHash('sha1').update(_dernier.sig).digest('hex').slice(0, 12) : 'off';
}

// ── Service de /bundle/<nom> ──────────────────────────────────
// Nom inconnu (serveur redémarré entre la page et sa ressource, ou aucune
// coquille servie depuis le démarrage) : on reconstruit depuis index.html.
function serve() {
  return (req, res, next) => {
    const nom = req.params.nom;
    let p = _paquets.get(nom);
    if (!p && ACTIVE) {
      try { rewriteShell(fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf-8')); } catch {}
      p = _paquets.get(nom);
    }
    if (!p) return next();
    res.set('Content-Type', p.type);
    // Le nom porte l'empreinte du contenu : il peut être gardé un an.
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('ETag', p.etag);
    res.set('Vary', 'Accept-Encoding');
    const inm = req.get('If-None-Match');
    if (inm && inm.split(/\s*,\s*/).some(t => t.replace(/^W\//, '') === p.etag)) return res.status(304).end();
    const gzip = /\bgzip\b/.test(req.get('Accept-Encoding') || '');
    const corps = gzip ? p.gz : p.corps;
    if (gzip) res.set('Content-Encoding', 'gzip');
    res.set('Content-Length', String(corps.length));
    if (req.method === 'HEAD') return res.end();
    res.end(corps);
  };
}

// Premier assemblage (~1 s : compilation de contrôle et compression) fait
// juste après le démarrage plutôt qu'à la première visite.
if (ACTIVE) {
  setImmediate(() => {
    try { rewriteShell(fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf-8')); } catch {}
  }).unref();
}

module.exports = { rewriteShell, stateId, serve, ACTIVE };
