// ── BASE DE CONNAISSANCES DE PEARL AI ──────────────────────
// L'admin importe des documents (procédures, guides, comptes rendus…).
// Chacun est réduit à son texte, découpé en passages d'environ un
// paragraphe, puis gardé dans data/ai_kb.json.
//
// À chaque question, une recherche locale (BM25, sans service extérieur
// ni base vectorielle) retient les passages les plus proches ; ils sont
// donnés au modèle avec la consigne de s'appuyer dessus et de citer leur
// source. Rien à installer sur la VM, et rien ne sort de la maison en
// dehors des quelques passages joints à la question.
//
// Formats lus ici : Word (.docx), PowerPoint (.pptx), Excel (.xlsx), texte,
// Markdown, CSV, JSON. Le PDF est lu dans le navigateur (pdf.js) et arrive
// déjà en texte.
const crypto = require('crypto');
const JSZip = require('jszip');
const { FILES } = require('../config/paths');
const { readJSON, writeJSON, withFileLock, docVersion } = require('../core/store');

const LIM = {
  docs: 300,                 // documents au plus
  // Fichiers jusqu'à 50 Mo : leur texte (souvent bien plus léger que le
  // fichier, images et mise en page en moins) est gardé jusqu'à 8 millions
  // de caractères par document, 60 millions pour toute la base.
  file_bytes: 50 * 1024 * 1024,
  chars_doc: 8_000_000,      // texte gardé par document
  chars_total: 60_000_000,   // texte total de la base
  chunk: 1100,               // taille visée d'un passage
  overlap: 180,              // recouvrement entre deux passages
  k: 6,                      // passages joints à une question
  chars_ctx: 7000,           // texte joint au plus
  chars_ctx_strict: 14000,   // en mode knowledge, plus large
};

// Lecture mise en cache tant que le fichier n'a pas changé : avec de gros
// documents, relire et décoder des dizaines de Mo à chaque question
// coûterait plus que la réponse. Copie superficielle : un appelant qui
// réassigne docs ou chunks ne touche pas au cache.
// Un cache par tenant (clé = chemin du fichier, propre au tenant).
const _caches = new Map();
const lire = () => {
  const f = FILES.ai_kb;
  const cle = docVersion(f) || 'vide';
  let _cache = _caches.get(f);
  if (!_cache || _cache.cle !== cle) {
    const kb = readJSON(f, null) || {};
    _cache = { cle, kb: { enabled: kb.enabled !== false, docs: kb.docs || [], chunks: kb.chunks || [] } };
    _caches.set(f, _cache);
  }
  const k = _cache.kb;
  return { enabled: k.enabled, docs: [...k.docs], chunks: [...k.chunks] };
};

// ── Extraction ────────────────────────────────────────────────
const decoder = s => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');
const textesDe = (xml, balise) => [...String(xml).matchAll(new RegExp(`<${balise}(?:\\s[^>]*)?>([^<]*)</${balise}>`, 'g'))].map(m => decoder(m[1]));

async function extraireDocx(buf) {
  const zip = await JSZip.loadAsync(buf);
  const f = zip.file('word/document.xml');
  if (!f) throw new Error('Document Word illisible.');
  const xml = await f.async('string');
  // Un paragraphe Word = une ligne ; les tableaux gardent une cellule par ligne.
  return xml.split(/<\/w:p>/).map(p => textesDe(p, 'w:t').join('')).filter(t => t.trim()).join('\n');
}

async function extrairePptx(buf) {
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => +a.match(/(\d+)\.xml$/)[1] - +b.match(/(\d+)\.xml$/)[1]);
  const out = [];
  for (const [i, n] of slides.entries()) {
    const xml = await zip.file(n).async('string');
    const lignes = xml.split(/<\/a:p>/).map(p => textesDe(p, 'a:t').join('')).filter(t => t.trim());
    if (lignes.length) out.push(`Diapositive ${i + 1}\n${lignes.join('\n')}`);
  }
  return out.join('\n\n');
}

async function extraireXlsx(buf) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const out = [];
  wb.eachSheet(ws => {
    const lignes = [];
    ws.eachRow({ includeEmpty: false }, row => {
      const v = (row.values || []).slice(1).map(c => {
        if (c == null) return '';
        if (typeof c === 'object') return c.text || c.result || (c.richText ? c.richText.map(r => r.text).join('') : '') || (c instanceof Date ? c.toISOString().slice(0, 10) : '');
        return String(c);
      });
      if (v.some(x => String(x).trim())) lignes.push(v.join(' | '));
    });
    if (lignes.length) out.push(`Feuille « ${ws.name} »\n${lignes.join('\n')}`);
  });
  return out.join('\n\n');
}

const EXT_TEXTE = ['txt', 'md', 'csv', 'json', 'log', 'pdf'];
const EXT_BINAIRE = { docx: extraireDocx, pptx: extrairePptx, xlsx: extraireXlsx };
const extension = nom => (/\.([a-z0-9]+)$/i.exec(String(nom || '')) || [])[1]?.toLowerCase() || '';

// ── Découpage ─────────────────────────────────────────────────
// Par paragraphes, regroupés jusqu'à ~1 100 caractères ; un paragraphe
// trop long est coupé à la phrase. Le début du passage suivant reprend la
// fin du précédent, pour qu'une idée à cheval ne soit pas perdue.
function decouper(texte) {
  const paras = String(texte).replace(/\r/g, '').split(/\n{2,}|\n(?=\S)/).map(p => p.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
  const morceaux = [];
  for (const p of paras) {
    if (p.length <= LIM.chunk) { morceaux.push(p); continue; }
    let reste = p;
    while (reste.length > LIM.chunk) {
      const cut = Math.max(reste.lastIndexOf('. ', LIM.chunk), reste.lastIndexOf(' ', LIM.chunk), LIM.chunk * 0.6);
      morceaux.push(reste.slice(0, cut + 1).trim());
      reste = reste.slice(cut + 1);
    }
    if (reste.trim()) morceaux.push(reste.trim());
  }
  const out = [];
  let cur = '';
  for (const m of morceaux) {
    if (cur && cur.length + m.length + 1 > LIM.chunk) {
      out.push(cur);
      const fin = cur.slice(-LIM.overlap);
      cur = (fin.includes(' ') ? fin.slice(fin.indexOf(' ') + 1) : fin) + '\n' + m;
    } else cur = cur ? `${cur}\n${m}` : m;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// ── Recherche (BM25) ──────────────────────────────────────────
const VIDES = new Set(('le la les un une des de du d l et ou a au aux en dans sur pour par avec sans ce cet cette ces qui que quoi '
  + 'dont est sont etre avoir ai as avons ont il elle ils elles on nous vous je tu me te se mon ma mes ton ta tes son sa ses leur leurs '
  + 'ne pas plus moins tres tout tous toute toutes y si comme mais donc car ni the a an of to in on for and or is are be with by at as '
  + 'it this that from what how est-ce quel quelle quels quelles comment pourquoi quand faut fait faire peut peux').split(/\s+/));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Racine légère (français d'abord, anglais ensuite) : « procédures »,
// « procédure » et « procéder » se retrouvent ; « escalade », « escalader »,
// « escaladé » aussi. Volontairement prudente : mieux vaut rater un
// rapprochement que mélanger deux mots sans rapport.
const SUFFIXES = ['issements', 'issement', 'ements', 'ement', 'ations', 'ation', 'atrices', 'atrice', 'ateurs', 'ateur',
  'ances', 'ance', 'ences', 'ence', 'iques', 'ique', 'ables', 'able', 'ibles', 'ible', 'euses', 'euse', 'eurs', 'eur',
  'ments', 'ment', 'ings', 'ing', 'ions', 'ion', 'ees', 'ee', 'es', 'er', 'ez', 'ed', 'e', 's'];
function racine(m) {
  if (m.length <= 4 || /\d/.test(m)) return m;
  for (const suf of SUFFIXES) if (m.endsWith(suf) && m.length - suf.length >= 4) return m.slice(0, -suf.length);
  return m;
}
function mots(s) {
  return norm(s).split(/[^a-z0-9]+/).filter(m => m.length > 1 && !VIDES.has(m)).map(racine);
}

let _index = null; // { cle, n, avg, df: Map, docs: [{tf: Map, len}] }
function index(kb) {
  const cle = `${kb.chunks.length}|${kb.docs.map(d => d.id).join(',')}`;
  if (_index && _index.cle === cle) return _index;
  const df = new Map();
  const noms = new Map(kb.docs.map(d => [d.id, d.name || '']));
  const docs = kb.chunks.map(c => {
    const nom = noms.get(c.doc) || '';
    const t = mots(`${nom} ${c.text}`);
    const tf = new Map();
    t.forEach(m => tf.set(m, (tf.get(m) || 0) + 1));
    tf.forEach((_, m) => df.set(m, (df.get(m) || 0) + 1));
    return { tf, len: t.length || 1 };
  });
  const avg = docs.reduce((n, d) => n + d.len, 0) / (docs.length || 1);
  _index = { cle, n: docs.length, avg, df, docs };
  return _index;
}

// Passages classés par les mots (BM25), du meilleur au moins bon : [{ i, s }].
function scoresMots(question, kb = lire()) {
  if (!kb.chunks.length) return [];
  const suite = mots(question);
  const q = [...new Set(suite)];
  if (!q.length) return [];
  const ix = index(kb);
  const k1 = 1.4, b = 0.75;
  const scores = ix.docs.map((d, i) => {
    let s = 0;
    for (const m of q) {
      const f = d.tf.get(m);
      if (!f) continue;
      const n = ix.df.get(m) || 0;
      const idf = Math.log(1 + (ix.n - n + 0.5) / (n + 0.5));
      s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / ix.avg));
    }
    return { i, s };
  }).filter(x => x.s > 0).sort((x, y) => y.s - x.s).slice(0, 300);
  // Les mots de la question qui se suivent aussi dans le passage
  // (« bridge teams », « incident p1 ») pèsent plus qu'épars. Calculé sur
  // les 300 meilleurs seulement : sur une grosse base, relire chaque
  // passage coûtait plusieurs centaines de millisecondes par question.
  if (suite.length > 1) {
    for (const x of scores) {
      const txt = ' ' + mots(kb.chunks[x.i].text).join(' ') + ' ';
      for (let j = 0; j + 1 < suite.length; j++) if (txt.includes(` ${suite[j]} ${suite[j + 1]} `)) x.s += 1.2;
    }
    scores.sort((x, y) => y.s - x.s);
  }
  return scores;
}

// On écarte les passages très en dessous du meilleur : du bruit.
function chercher(question, k = LIM.k, opts = {}) {
  const kb = lire();
  const scores = scoresMots(question, kb);
  if (!scores.length) return [];
  const seuil = scores[0].s * (opts.seuil ?? 0.25);
  const retenus = scores.filter(x => x.s >= seuil).slice(0, k);
  // Voisins : le passage d'avant et d'après complètent souvent la réponse
  // (une procédure coupée en deux, un tableau et sa légende).
  if (opts.voisins) {
    const pris = new Set(retenus.map(x => x.i));
    for (const x of retenus.slice(0, 4)) for (const d of [-1, 1]) {
      const j = x.i + d, c = kb.chunks[j];
      if (c && c.doc === kb.chunks[x.i].doc && !pris.has(j)) { pris.add(j); retenus.push({ i: j, s: x.s * 0.5, voisin: true }); }
    }
  }
  return retenus.map(x => {
    const c = kb.chunks[x.i];
    const d = kb.docs.find(dd => dd.id === c.doc) || {};
    return { doc: c.doc, name: d.name || 'Document', part: c.i + 1, parts: d.chunks || 0, i: c.i, text: c.text, score: Math.round(x.s * 100) / 100, voisin: !!x.voisin };
  });
}

// ── Recherche hybride : mots + sens ───────────────────────────
// Les deux classements sont fusionnés par rang (Reciprocal Rank Fusion) :
// un passage bien placé dans l'un OU l'autre remonte, un passage bien
// placé dans les deux passe devant. Sans recherche par le sens (pas de
// modèle d'embeddings), c'est la recherche par mots seule.
const sens = require('./ai-sens');
async function chercherHybride(texteMots, texteSens, k = LIM.k, opts = {}) {
  const kb = lire();
  if (!kb.chunks.length) return [];
  const parMots = scoresMots(texteMots, kb).slice(0, 150);
  const parSens = await sens.proches(texteSens || texteMots, lire, 150);
  let fusion;
  if (!parSens) {
    if (!parMots.length) return [];
    const seuil = parMots[0].s * (opts.seuil ?? 0.25);
    fusion = parMots.filter(x => x.s >= seuil).map(x => ({ i: x.i, s: x.s, via: 'mots' }));
  } else {
    const m = new Map();
    parMots.forEach((x, r) => m.set(x.i, { i: x.i, s: 1 / (60 + r), via: 'mots' }));
    // Un passage trop loin par le sens n'est pas retenu sur ce seul critère.
    const plancher = parSens.length ? parSens[0].s * 0.75 : 0;
    parSens.forEach((x, r) => {
      const y = m.get(x.j);
      if (y) { y.s += 1 / (60 + r); y.via = 'mots + sens'; }
      else if (x.s >= plancher) m.set(x.j, { i: x.j, s: 1 / (60 + r), via: 'sens' });
    });
    fusion = [...m.values()].sort((a, b) => b.s - a.s);
  }
  const retenus = fusion.slice(0, k);
  if (opts.voisins) {
    const pris = new Set(retenus.map(x => x.i));
    for (const x of retenus.slice(0, opts.voisinsDe || 4)) for (const d of [-1, 1]) {
      const j = x.i + d, c = kb.chunks[j];
      if (c && c.doc === kb.chunks[x.i].doc && !pris.has(j)) { pris.add(j); retenus.push({ i: j, s: x.s * 0.5, voisin: true, via: x.via }); }
    }
  }
  const noms = new Map(kb.docs.map(d => [d.id, d]));
  return retenus.map(x => {
    const c = kb.chunks[x.i], d = noms.get(c.doc) || {};
    return { doc: c.doc, name: d.name || 'Document', part: c.i + 1, parts: d.chunks || 0, i: c.i, text: c.text,
      score: Math.round(x.s * (parSens ? 10000 : 100)) / 100, voisin: !!x.voisin, via: x.via };
  });
}

// Lecture par le modèle : parmi les passages trouvés, lesquels répondent
// vraiment à la question ? C'est ce qui fait passer de « contient les
// mots » à « répond à la question ». Renvoie les passages gardés, du plus
// utile au moins utile ; en cas d'échec, l'ordre de la recherche.
async function relire(question, passages, chat, garder = 8) {
  if (passages.length <= 2) return passages;
  const liste = passages.map((p, i) => `#${i + 1} (${p.name})\n${p.text.slice(0, 700)}`).join('\n\n');
  try {
    const r = await chat([{ role: 'user', content: `Question : « ${question.slice(0, 600)} »\n\nExtraits de documents internes :\n\n${liste}\n\n`
      + `Quels extraits aident à répondre à la question, même s'ils emploient d'autres mots (synonymes, sigles, autre langue) ? `
      + `Réponds uniquement par les numéros utiles, du plus utile au moins utile, séparés par des virgules (au plus ${garder}). Si aucun n'aide, réponds 0.` }],
      { max_tokens: 80, temperature: 0, max_chars: 30000 });
    const nums = [...String(r.content || '').matchAll(/\d+/g)].map(m => +m[0]).filter(n => n >= 1 && n <= passages.length);
    if (/^\s*0\s*$/.test(String(r.content || ''))) return [];
    const vus = new Set(); const out = [];
    for (const n of nums) if (!vus.has(n)) { vus.add(n); out.push(passages[n - 1]); }
    return out.length ? out.slice(0, garder) : passages.slice(0, garder);
  } catch { return passages.slice(0, garder); }
}

// Passages voisins des passages retenus (même document), pour donner au
// modèle la phrase d'avant et d'après.
function avecVoisins(passages) {
  const kb = lire();
  const cle = p => `${p.doc}|${p.i}`;
  const pris = new Set(passages.map(cle));
  const out = [...passages];
  const docs = new Map(kb.docs.map(d => [d.id, d]));
  const parDoc = new Map(); kb.chunks.forEach(c => parDoc.set(`${c.doc}|${c.i}`, c));
  for (const p of passages.slice(0, 5)) for (const d of [-1, 1]) {
    const c = parDoc.get(`${p.doc}|${p.i + d}`);
    if (c && !pris.has(`${c.doc}|${c.i}`)) {
      pris.add(`${c.doc}|${c.i}`);
      out.push({ doc: c.doc, name: (docs.get(c.doc) || {}).name || 'Document', part: c.i + 1, parts: (docs.get(c.doc) || {}).chunks || 0, i: c.i, text: c.text, score: p.score * 0.5, voisin: true });
    }
  }
  return out;
}

// Passages d'un même document remis dans l'ordre et fusionnés quand ils se
// suivent : le modèle lit un extrait continu plutôt que des morceaux.
function regrouper(passages) {
  const parDoc = new Map();
  passages.forEach(p => { const l = parDoc.get(p.doc) || []; l.push(p); parDoc.set(p.doc, l); });
  const out = [];
  for (const l of parDoc.values()) {
    l.sort((a, b) => a.i - b.i);
    let cur = null;
    for (const p of l) {
      if (cur && p.i === cur.fin + 1) { cur.text += '\n' + p.text; cur.fin = p.i; cur.score = Math.max(cur.score, p.score); }
      else { if (cur) out.push(cur); cur = { ...p, debut: p.i, fin: p.i }; }
    }
    if (cur) out.push(cur);
  }
  return out.sort((a, b) => b.score - a.score);
}

// ── Mode « knowledge » ────────────────────────────────────────
// Réponse fondée uniquement sur les documents. Trois temps :
//  1. le modèle reformule la question en mots-clés et synonymes (FR / EN) ;
//  2. recherche élargie, passages voisins, extraits fusionnés ;
//  3. réponse stricte, chaque affirmation sourcée ; sinon il le dit.
// Si rien ne correspond, on ne dérange pas le modèle : la réponse le dit.
async function repondre(messages, chat) {
  const users = (messages || []).filter(m => m && m.role === 'user').map(m => String(m.content || ''));
  const question = users[users.length - 1] || '';
  if (!question.trim()) throw Object.assign(new Error('Pose ta question.'), { status: 400 });
  const kbase = lire();
  if (!kbase.docs.length) return { content: 'La base de connaissances est vide : importe des documents (bouton Documents) pour que je puisse m\'y référer.', sources: [], vide: true };
  // 1. Compréhension : le modèle reformule la question, donne les mots
  //    et synonymes (FR / EN, sigles) et rédige une réponse « type » :
  //    ses mots sont ceux qu'un document qui répond emploierait.
  let cles = '', reformulation = '', hypothese = '';
  const precedente = users.length > 1 ? users[users.length - 2] : '';
  try {
    const r = await chat([{ role: 'user', content: `Question : « ${question.slice(0, 600)} »${precedente ? `\nQuestion précédente : « ${precedente.slice(0, 300)} »` : ''}\n\n`
      + 'Pour retrouver la réponse dans des documents internes d\'une équipe d\'exploitation télécom, écris exactement trois lignes :\n'
      + 'QUESTION: la question reformulée, complète et sans ambiguïté (en tenant compte de la question précédente)\n'
      + 'MOTS: 8 à 15 mots-clés : termes exacts, synonymes, sigles et leur forme développée, en français et en anglais, séparés par des virgules\n'
      + 'REPONSE: deux phrases qui ressembleraient à la réponse telle qu\'un document de procédure l\'écrirait (même si tu ne la connais pas)' }],
      { max_tokens: 260, temperature: 0 });
    const t = String(r.content || '');
    reformulation = ((/QUESTION\s*:\s*(.+)/i.exec(t) || [])[1] || '').slice(0, 400);
    cles = ((/MOTS\s*:\s*(.+)/i.exec(t) || [])[1] || '').slice(0, 400);
    hypothese = ((/R[EÉ]PONSE\s*:\s*([\s\S]+)/i.exec(t) || [])[1] || '').split('\n').slice(0, 3).join(' ').slice(0, 600);
    if (!cles && !reformulation) cles = t.split('\n')[0].slice(0, 400);
  } catch { /* sans reformulation, la question seule suffit souvent */ }

  // 2. Recherche large (mots + sens), puis 3. relecture par le modèle.
  const texteMots = [question, precedente, reformulation, cles, hypothese].filter(Boolean).join('\n');
  const texteSens = [reformulation || question, hypothese].filter(Boolean).join('\n');
  const candidats = await chercherHybride(texteMots, texteSens, 24, { seuil: 0.15 });
  if (!candidats.length) return { content: 'Je n\'ai rien trouvé dans les documents importés qui réponde à cette question. Essaie d\'autres mots, ou ajoute le document qui en parle.', sources: [], cles };
  const utiles = await relire(reformulation || question, candidats, chat, 8);
  if (!utiles.length) return { content: 'J\'ai lu les passages les plus proches de ta question dans les documents importés, mais aucun n\'y répond. Reformule, ou ajoute le document qui en parle.', sources: [], cles };
  let passages = regrouper(avecVoisins(utiles));
  let total = 0;
  passages = passages.filter((p, i) => i === 0 || (total += p.text.length) <= LIM.chars_ctx_strict);
  const system = 'MODE KNOWLEDGE : tu réponds UNIQUEMENT à partir des extraits de documents internes ci-dessous.\n'
    + '- Chaque affirmation est suivie de sa source entre crochets, par exemple [1] ou [2][3].\n'
    + '- Cite les chiffres, délais, noms et étapes exactement comme dans les extraits.\n'
    + '- Si les extraits ne répondent pas, ou seulement en partie, dis-le clairement (« les documents ne précisent pas… ») ; n\'ajoute aucune connaissance extérieure.\n'
    + '- Si deux documents se contredisent, signale-le en citant les deux.\n'
    + '- Structure la réponse : d\'abord la réponse directe en une ou deux phrases, puis le détail (étapes numérotées si c\'est une procédure).\n\n'
    + passages.map((p, i) => `[${i + 1}] ${p.name} (passage${p.fin > p.debut ? `s ${p.debut + 1}–${p.fin + 1}` : ` ${p.debut + 1}`} sur ${p.parts})\n${p.text}`).join('\n\n---\n\n');
  const r = await chat(messages, { system, temperature: 0.1, max_chars: 30000 });
  return { ...r, cles, sources: passages.map((p, i) => ({ n: i + 1, doc: p.doc, name: p.name, part: p.debut + 1, part_fin: p.fin + 1, extrait: p.text.slice(0, 280) })) };
}

// Contexte joint à une conversation : la question en cours (et la
// précédente, pour les relances du type « et pour le CI ? »).
async function contexte(messages) {
  const kb = lire();
  if (!kb.enabled || !kb.chunks.length) return null;
  const users = (messages || []).filter(m => m && m.role === 'user').map(m => String(m.content || ''));
  if (!users.length) return null;
  const q = users.slice(-2).join('\n');
  let passages = regrouper(await chercherHybride(q, users[users.length - 1], LIM.k, { voisins: true }));
  if (!passages.length) return { system: null, sources: [] };
  let total = 0;
  passages = passages.filter(p => (total += p.text.length) <= LIM.chars_ctx || p === passages[0]);
  const system = 'Base de connaissances de l\'équipe : voici des extraits de documents internes, choisis pour la question.\n'
    + 'Appuie-toi d\'abord sur eux quand ils répondent à la question et cite la source entre crochets, par exemple [1] ou [2]. '
    + 'S\'ils ne contiennent pas la réponse, dis-le clairement, puis réponds avec tes connaissances générales en le précisant. '
    + 'N\'invente pas de contenu qui serait attribué à ces documents.\n\n'
    + passages.map((p, i) => `[${i + 1}] ${p.name} (passage ${p.debut + 1}/${p.parts})\n${p.text}`).join('\n\n---\n\n');
  return { system, sources: passages.map((p, i) => ({ n: i + 1, doc: p.doc, name: p.name, part: p.debut + 1, part_fin: p.fin + 1, extrait: p.text.slice(0, 280) })) };
}

// ── Gestion ───────────────────────────────────────────────────
const vue = kb => ({
  enabled: kb.enabled,
  docs: kb.docs.slice().sort((a, b) => String(b.added_at).localeCompare(String(a.added_at))),
  chars: kb.docs.reduce((n, d) => n + (d.chars || 0), 0),
  limits: { docs: LIM.docs, chars_total: LIM.chars_total, file_bytes: LIM.file_bytes },
});

async function ajouter({ name, text, data, buffer }, auteur) {
  const nom = String(name || '').replace(/[\\/]/g, '_').trim().slice(0, 160);
  if (!nom) throw Object.assign(new Error('Nom de fichier manquant.'), { status: 400 });
  const ext = extension(nom);
  let contenu;
  // Fichier texte envoyé en binaire : décodé ici.
  if (typeof text !== 'string' && Buffer.isBuffer(buffer) && EXT_TEXTE.includes(ext) && ext !== 'pdf') text = buffer.toString('utf8');
  if (typeof text === 'string') {
    if (!EXT_TEXTE.includes(ext) && ext) throw Object.assign(new Error(`Format .${ext} non pris en charge.`), { status: 400 });
    contenu = text;
  } else if (EXT_BINAIRE[ext]) {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(data || ''), 'base64');
    if (buf.length > LIM.file_bytes) throw Object.assign(new Error(`${nom} dépasse ${LIM.file_bytes / 1048576} Mo.`), { status: 413 });
    if (!buf.length) throw Object.assign(new Error('Fichier vide.'), { status: 400 });
    try { contenu = await EXT_BINAIRE[ext](buf); }
    catch (e) { throw Object.assign(new Error(`Lecture impossible de ${nom} : ${e.message}`), { status: 400 }); }
  } else {
    throw Object.assign(new Error(ext ? `Format .${ext} non pris en charge (PDF, Word, PowerPoint, Excel, texte).` : 'Format inconnu.'), { status: 400 });
  }
  contenu = String(contenu || '').replace(/\u0000/g, '').trim().slice(0, LIM.chars_doc);
  if (contenu.length < 20) throw Object.assign(new Error(`Aucun texte lisible dans ${nom} (document scanné ?).`), { status: 400 });
  const parts = decouper(contenu);
  return withFileLock(FILES.ai_kb, () => {
    const kb = lire();
    // Même nom : la nouvelle version remplace l'ancienne.
    const ancien = kb.docs.find(d => d.name === nom);
    if (ancien) { kb.docs = kb.docs.filter(d => d !== ancien); kb.chunks = kb.chunks.filter(c => c.doc !== ancien.id); sens.oublier(ancien.id); }
    if (kb.docs.length >= LIM.docs) throw Object.assign(new Error(`La base est pleine (${LIM.docs} documents).`), { status: 400 });
    const total = kb.docs.reduce((n, d) => n + (d.chars || 0), 0);
    if (total + contenu.length > LIM.chars_total) throw Object.assign(new Error('La base est pleine : retire des documents avant d\'en ajouter.'), { status: 400 });
    const doc = { id: crypto.randomBytes(6).toString('hex'), name: nom, type: ext, chars: contenu.length, chunks: parts.length,
      added_at: new Date().toISOString(), added_by: auteur || 'admin', replaced: !!ancien };
    kb.docs.push(doc);
    parts.forEach((t, i) => kb.chunks.push({ doc: doc.id, i, text: t }));
    writeJSON(FILES.ai_kb, kb); prechauffer();
    return doc;
  });
}

function retirer(id) {
  return withFileLock(FILES.ai_kb, () => {
    const kb = lire();
    const d = kb.docs.find(x => x.id === id);
    if (!d) throw Object.assign(new Error('Document introuvable.'), { status: 404 });
    kb.docs = kb.docs.filter(x => x.id !== id);
    kb.chunks = kb.chunks.filter(c => c.doc !== id);
    writeJSON(FILES.ai_kb, kb); prechauffer();
    sens.oublier(id);
    return d;
  });
}

function activer(on) {
  return withFileLock(FILES.ai_kb, () => {
    const kb = lire();
    kb.enabled = !!on;
    writeJSON(FILES.ai_kb, kb); prechauffer();
    return vue(kb);
  });
}

// Texte complet d'un document, rassemblé à partir de ses passages (sans
// les recouvrements approximatifs : c'est un aperçu, pas l'original).
function apercu(id) {
  const kb = lire();
  const d = kb.docs.find(x => x.id === id);
  if (!d) return null;
  return { ...d, passages: kb.chunks.filter(c => c.doc === id).map(c => c.text) };
}

// Index de recherche construit dès qu'un document change (et au démarrage),
// pas à la première question : avec de gros documents il prend une ou deux
// secondes.
function prechauffer() {
  const t = setTimeout(() => {
    try { const kb = lire(); if (kb.chunks.length) index(kb); } catch {}
    // Vecteurs des nouveaux passages, en arrière-plan.
    sens.indexer(lire).catch(() => {});
  }, 50);
  t.unref?.();
}
prechauffer();

module.exports = { etatSens: () => sens.vueEtat(lire), indexerSens: () => sens.indexer(lire), chercherHybride, relire, lire: () => vue(lire()), ajouter, retirer, activer, chercher, contexte, repondre, regrouper, apercu, decouper, mots, racine, LIM };
