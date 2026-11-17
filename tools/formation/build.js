#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════
   GÉNÉRATION DES FORMATIONS DÉRIVÉES DE DIGITALVIEW

   Les formations de l'Academy autres que DigitalView réutilisent son
   moteur (cartes, quiz, révision, XP, série, examen final, lexique,
   synchronisation de la progression). Plutôt que de dupliquer ce moteur à
   la main, on le reprend de digitalview.html et on remplace :
     · le contenu (glossaire, sessions, modules)  ← <id>-content.js
     · les widgets interactifs                    ← <id>-widgets.js
     · les libellés propres à DigitalView, et les clés de stockage local
       (sinon les formations écraseraient mutuellement leur état).

   Usage : node tools/formation/build.js <id>     (sans id : toutes ;
           « digitalview » ne fait que recopier le kit commun)
   À relancer après chaque modification du contenu ou des widgets, et
   après une mise à jour de digitalview.html si l'on veut en suivre le
   moteur.
   ══════════════════════════════════════════════════════════════ */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const SRC  = path.join(ROOT, 'public/formation/digitalview.html');

// Une entrée par formation : libellés à poser et clés de stockage local
// (état, série). L'id est celui du catalogue (server/services/academy.js).
const COURS = {
  process: {
    titre: 'Process ITSM', h1: 'Maîtrisons nos process !', legende: 'Légende EMOC',
    lexique: 'SLA, On Hold, RCA, MTTD…',
    pied: 'Process EMOC · règles du tracker (SLA, statuts, types de tickets)',
    etat: 'itf-state', serie: 'its-state',
  },
  mobilemoney: {
    titre: 'Mobile Money 2.0', h1: 'Maîtrisons Mobile Money 2.0 !', legende: 'Légende MM',
    lexique: 'RSU, CP ID, gray release, CloudDR…',
    pied: 'Mobile Money 2.0 · formation Starry Sky 2026, cours 1 à 7',
    etat: 'mmf-state', serie: 'mms-state',
  },
  datacenter: {
    titre: 'Data center', h1: 'Comprenons le data center !', legende: 'Légende DC',
    lexique: 'Baie, PDU, leaf, VXLAN, SFP…',
    pied: 'Data center · du bâtiment au port',
    etat: 'dcf-state', serie: 'dcs-state',
  },
  reseau: {
    titre: 'Réseaux', h1: 'Comprenons les réseaux !', legende: 'Légende Réseaux',
    lexique: 'NAT, masque, BGP, DNS, TCP…',
    pied: 'Réseaux · des bits à internet',
    etat: 'rsf-state', serie: 'rss-state',
  },
};

// Kit commun des scènes (appareils réalistes, paquets, illustrations du
// lexique). Injecté devant les widgets de chaque formation, et recopié
// dans digitalview.html entre deux repères, pour que DigitalView en
// profite aussi.
const KIT = fs.readFileSync(path.join(__dirname, 'nk-kit.js'), 'utf8');
const KIT_A = '/* NK-KIT:début (généré par tools/formation/build.js, ne pas modifier ici) */';
const KIT_B = '/* NK-KIT:fin */';
function synchroniserDigitalView() {
  const extra = fs.readFileSync(path.join(__dirname, 'digitalview-gi.js'), 'utf8');
  let html = fs.readFileSync(SRC, 'utf8');
  const bloc = KIT_A + '\n' + KIT.trim() + '\n' + extra.trim() + '\n' + KIT_B;
  const a = html.indexOf(KIT_A), b = html.indexOf(KIT_B);
  if (a >= 0 && b > a) html = html.slice(0, a) + bloc + html.slice(b + KIT_B.length);
  else {
    const m = '\nvar W={};';
    if (!html.includes(m)) throw new Error('Repère « var W={}; » absent de digitalview.html');
    html = html.replace(m, m + '\n' + bloc);
  }
  new vm.Script(html.slice(html.indexOf('<script>\nvar CFG') + 8, html.lastIndexOf('</script>')), { filename: 'digitalview.html' });
  fs.writeFileSync(SRC, html);
  console.log('digitalview.html : kit commun à jour.');
}

function construire(id) {
  const c = COURS[id];
  if (!c) throw new Error(`Formation inconnue : ${id}`);
  const OUT     = path.join(ROOT, `public/formation/${id}.html`);
  const CONTENT = fs.readFileSync(path.join(__dirname, `${id}-content.js`), 'utf8');
  const WIDGETS = fs.readFileSync(path.join(__dirname, `${id}-widgets.js`), 'utf8');

  let html = fs.readFileSync(SRC, 'utf8');

  // Remplace exactement une occurrence, ou échoue : si le moteur change de
  // forme, mieux vaut un arrêt net qu'une page à moitié convertie.
  function swap(from, to, all = false) {
    const n = html.split(from).length - 1;
    if (!n) throw new Error(`Motif introuvable dans digitalview.html : ${from.slice(0, 60)}`);
    if (!all && n > 1) throw new Error(`Motif ambigu (${n} fois) : ${from.slice(0, 60)}`);
    html = all ? html.split(from).join(to) : html.replace(from, to);
  }
  function cut(startMark, endMark, replacement) {
    const a = html.indexOf(startMark);
    const b = html.indexOf(endMark, a + 1);
    if (a < 0 || b < 0) throw new Error(`Bornes introuvables : ${startMark} … ${endMark}`);
    html = html.slice(0, a) + '\n' + replacement.trim() + '\n' + html.slice(b);
  }

  // ── Contenu et widgets ──
  // Le contenu se pose en deux temps : glossaire et sessions à la place de
  // ceux de DigitalView, puis la liste des modules. Entre les deux, le
  // moteur définit ses utilitaires (gs, ss, ico…) : on n'y touche pas.
  const SEP = '/* ── Modules ──';
  if (!CONTENT.includes(SEP)) throw new Error(`Repère « ${SEP} » absent de ${id}-content.js`);
  const [SESSIONS, MODULES] = [CONTENT.slice(0, CONTENT.indexOf(SEP)), CONTENT.slice(CONTENT.indexOf(SEP))];
  cut('\nvar G={', '\nvar root=document.documentElement;', SESSIONS);
  cut('\nvar POSE=', '\nvar GL={}', MODULES);
  cut('\nvar W={}', '\nfunction widgetHTML', KIT + '\n' + WIDGETS);

  // ── Libellés ──
  swap('<title>DigitalView · Formation</title>', `<title>${c.titre} · Formation</title>`);
  swap('<div class="brand">DigitalView</div>', `<div class="brand">${c.titre}</div>`);
  swap('Apprenons DigitalView !', c.h1);
  swap("'Légende DV'", `'${c.legende}'`);
  swap('SNMP, Kafka, UniEP, inode…', c.lexique);
  swap('<div class="foot">V800R026C10 · contenu tiré de la documentation produit</div>',
    `<div class="foot">${c.pied}</div>`);

  // ── Stockage local propre à cette formation ──
  swap("'dvf-state'", `'${c.etat}'`, true);
  swap("'dvs-state'", `'${c.serie}'`, true);

  // ── Pont serveur : même pont, autre formation et autres clés ──
  swap('<script src="/formation/digitalview-bridge.js"></script>',
    `<script src="/formation/digitalview-bridge.js" data-course="${id}" data-keys="${c.etat},${c.serie}"></script>`);

  // ── Contrôles ──
  const script = html.slice(html.indexOf('<script>\nvar CFG') + 8, html.lastIndexOf('</script>'));
  new vm.Script(script, { filename: `${id}.html` });          // syntaxe

  const sandbox = {};
  vm.runInNewContext(
    'var ico=function(){return ""};' + CONTENT + ';' + KIT + ';' + WIDGETS
    + ';this.G=G;this.MODS=MODS;this.W=W;this.GI=GI;', sandbox);
  const icons = new Set(Object.keys(JSON.parse(
    html.slice(html.indexOf('var LI=') + 7, html.indexOf(';\n', html.indexOf('var LI='))))));
  const termes = new Set(Object.keys(sandbox.G).map(k => k.toLowerCase()));
  const pb = [];
  let sessions = 0, quiz = 0;
  const ids = new Set();
  for (const m of sandbox.MODS) {
    if (!icons.has(m.ic)) pb.push(`icône de module inconnue : ${m.ic}`);
    for (const s of m.S) {
      sessions++;
      if (ids.has(`${m.id}.${s.id}`)) pb.push(`session en double : ${m.id}.${s.id}`);
      ids.add(`${m.id}.${s.id}`);
      for (const c of s.cards) {
        if (c.i && !icons.has(c.i)) pb.push(`${m.id}.${s.id} : icône inconnue ${c.i}`);
        if (c.w && !sandbox.W[c.w]) pb.push(`${m.id}.${s.id} : widget inconnu ${c.w}`);
        if (c.q) { quiz++; if (!(c.a >= 0 && c.a < c.o.length)) pb.push(`${m.id}.${s.id} : réponse hors options`); }
        const textes = [c.h, c.q, c.e, c.m, ...(c.p || []), ...(c.o || []), ...(c.r || [])].filter(Boolean);
        for (const t of textes) {
          for (const [, k] of t.matchAll(/\[\[([^\]|]+)/g)) {
            if (!termes.has(k.toLowerCase())) pb.push(`${m.id}.${s.id} : terme absent du glossaire [[${k}]]`);
          }
        }
      }
    }
  }
  for (const k of Object.keys(sandbox.GI)) if (!sandbox.G[k]) pb.push(`illustration pour un terme absent du glossaire : ${k}`);
  for (const [n, w] of Object.entries(sandbox.W)) if (!icons.has(w.ic)) pb.push(`widget ${n} : icône inconnue ${w.ic}`);
  // L'examen final tire 30 questions : il en faut au moins autant.
  if (quiz < 30) pb.push(`${quiz} questions seulement, l'examen final en demande 30`);
  if (pb.length) { console.error(`${id} :\n` + pb.join('\n')); process.exitCode = 1; return; }

  fs.writeFileSync(OUT, html);
  console.log(`${id}.html écrit : ${sandbox.MODS.length} modules, ${sessions} sessions, ${quiz} questions, ${Object.keys(sandbox.G).length} termes.`);
}

const demande = process.argv[2];
synchroniserDigitalView();
// « digitalview » : seulement la recopie du kit (la page n'est pas générée).
(demande ? [demande] : Object.keys(COURS)).filter(id => id !== 'digitalview').forEach(construire);
