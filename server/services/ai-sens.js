// ══════════════════════════════════════════════════════════════
// RECHERCHE PAR LE SENS (embeddings) POUR LA BASE DE CONNAISSANCES
//
// La recherche par mots-clés (BM25, ai-kb.js) ne trouve un passage que
// s'il contient les mots de la question. « Que faire si le client n'a plus
// internet ? » ne retrouve pas « procédure en cas de coupure du service
// data ». Ici, chaque passage est transformé en vecteur par un modèle
// d'embeddings ; la question aussi ; on rapproche les vecteurs.
//
// Facultatif : il faut que le service IA propose un modèle d'embeddings
// (route /embeddings). Sans lui, la base reste en mots-clés.
//
// Stockage : un blob binaire par document (ai_kb_vec/<id>.<modèle>.bin),
// vecteurs normalisés puis quantifiés sur 8 bits (4 fois moins de place,
// précision largement suffisante pour classer des passages).
// L'indexation tourne en arrière-plan après chaque ajout.
// ══════════════════════════════════════════════════════════════
const path = require('path');
const { FILES } = require('../config/paths');
const { backend } = require('../core/backend');

const LOT = 32;            // passages envoyés par appel
const ENTETE = 16;         // octets : 'KBV1', dim (u32), n (u32), réservé
const _vec = require('../core/scoped').scopedMap();    // doc → { model, dim, n, data: Int8Array }
const etat = require('../core/scoped').scopedObject(() => ({ actif: false, fait: 0, total: 0, doc: '', erreur: '', modele: '' }));

const modele = () => { try { return require('./ai').lireFichier().embed_model || ''; } catch { return ''; } };
const fichier = (id, m) => path.join(FILES.ai_kb_vec, `${id}.${String(m).replace(/[^\w.-]+/g, '_')}.bin`);

function normaliserQuantifier(v) {
  let n = 0; for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  const q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(v[i] / n * 127)));
  return q;
}

// Lecture depuis le cache seulement (synchrone). `chargerTous` remplit le
// cache depuis le stockage avant chaque usage ; `false` = blob absent.
function charger(id, m) {
  const v = _vec.get(`${id}|${m}`);
  return v || null;
}
function decoder(buf, m) {
  if (!buf || buf.length < ENTETE || buf.toString('ascii', 0, 4) !== 'KBV1') return false;
  const dim = buf.readUInt32LE(4), n = buf.readUInt32LE(8);
  if (buf.length !== ENTETE + dim * n) return false;
  return { model: m, dim, n, data: new Int8Array(buf.buffer, buf.byteOffset + ENTETE, dim * n) };
}
async function chargerTous(ids, m) {
  for (const id of ids) {
    const k = `${id}|${m}`;
    if (_vec.has(k)) continue;
    let buf = null;
    try { buf = await backend().getBlob(fichier(id, m)); } catch { buf = null; }
    _vec.set(k, decoder(buf, m));
  }
}

async function ecrire(id, m, vecteurs) {
  const dim = vecteurs[0].length, n = vecteurs.length;
  const buf = Buffer.alloc(ENTETE + dim * n);
  buf.write('KBV1', 0, 'ascii'); buf.writeUInt32LE(dim, 4); buf.writeUInt32LE(n, 8);
  vecteurs.forEach((q, i) => Buffer.from(q.buffer, q.byteOffset, q.length).copy(buf, ENTETE + i * dim));
  await backend().putBlob(fichier(id, m), buf);
  _vec.set(`${id}|${m}`, decoder(buf, m));
}

function oublier(id) {
  for (const k of [..._vec.keys()]) if (k.startsWith(id + '|')) _vec.delete(k);
  backend().removeBlobs(FILES.ai_kb_vec, id + '.').catch(() => {});
}

// Texte envoyé au modèle pour un passage : le nom du document aide à le
// situer (« Procédure P1 — … »).
const texteDe = (doc, c) => `${doc.name.replace(/\.[a-z0-9]+$/i, '')}\n${c.text}`;

// Indexe tout ce qui manque, document par document. Une seule boucle à
// la fois ; un nouvel appel pendant qu'elle tourne ne fait que la relancer
// à la fin.
let _relancer = false;
async function indexer(lireKb) {
  const m = modele();
  if (!m) { etat.actif = false; etat.erreur = ''; etat.modele = ''; return; }
  if (etat.actif) { _relancer = true; return; }
  etat.actif = true; etat.erreur = ''; etat.modele = m;
  try {
    const kb = lireKb();
    await chargerTous(kb.docs.map(d => d.id), m);
    const parDoc = new Map();
    kb.chunks.forEach(c => { const l = parDoc.get(c.doc) || []; l.push(c); parDoc.set(c.doc, l); });
    const aFaire = kb.docs.filter(d => { const v = charger(d.id, m); return !v || v.n !== (parDoc.get(d.id) || []).length; });
    etat.total = aFaire.reduce((n, d) => n + (parDoc.get(d.id) || []).length, 0); etat.fait = 0;
    const { embed } = require('./ai');
    for (const d of aFaire) {
      const chunks = (parDoc.get(d.id) || []).sort((a, b) => a.i - b.i);
      if (!chunks.length) continue;
      etat.doc = d.name;
      const out = [];
      for (let i = 0; i < chunks.length; i += LOT) {
        if (modele() !== m) throw new Error('Modèle changé pendant l\'indexation.');
        const lot = chunks.slice(i, i + LOT);
        const r = await embed(lot.map(c => texteDe(d, c)), { model: m });
        r.vecteurs.forEach(v => out.push(normaliserQuantifier(v)));
        etat.fait += lot.length;
      }
      // Le document a pu être retiré pendant l'indexation.
      if (lireKb().docs.some(x => x.id === d.id)) await ecrire(d.id, m, out);
    }
  } catch (e) {
    etat.erreur = e.message;
    console.error('[kb] indexation par le sens interrompue :', e.message);
  } finally {
    etat.actif = false; etat.doc = '';
    if (_relancer) { _relancer = false; setImmediate(() => indexer(lireKb)); }
  }
}

// Passages les plus proches d'un texte, par le sens. null si la recherche
// par le sens n'est pas disponible (pas de modèle, rien d'indexé).
async function proches(texte, lireKb, k = 150) {
  const m = modele();
  if (!m) return null;
  const kb = lireKb();
  await chargerTous(kb.docs.map(d => d.id), m);
  const blocs = kb.docs.map(d => ({ d, v: charger(d.id, m) })).filter(x => x.v);
  if (!blocs.length) return null;
  let q;
  try { q = normaliserQuantifier((await require('./ai').embed([texte], { model: m, delai: 30000 })).vecteurs[0]); }
  catch (e) { console.error('[kb] question non vectorisée :', e.message); return null; }
  const idx = new Map();   // doc → index des passages par numéro
  kb.chunks.forEach((c, j) => { let x = idx.get(c.doc); if (!x) idx.set(c.doc, x = new Map()); x.set(c.i, j); });
  const res = [];
  for (const { d, v } of blocs) {
    if (v.dim !== q.length) continue;
    const pos = idx.get(d.id); if (!pos) continue;
    for (let i = 0; i < v.n; i++) {
      let s = 0; const o = i * v.dim;
      for (let t = 0; t < v.dim; t++) s += q[t] * v.data[o + t];
      const j = pos.get(i);
      if (j !== undefined) res.push({ j, s: s / (127 * 127) });
    }
  }
  res.sort((a, b) => b.s - a.s);
  return res.slice(0, k);
}

function vueEtat(lireKb) {
  const m = modele();
  if (!m) return { modele: '', actif: false };
  const kb = lireKb();
  const total = kb.chunks.length;
  const indexes = kb.docs.reduce((n, d) => { const v = charger(d.id, m); return n + (v ? v.n : 0); }, 0);
  return { modele: m, actif: etat.actif, indexes: Math.min(indexes, total), total, en_cours: etat.actif ? { fait: etat.fait, total: etat.total, doc: etat.doc } : null, erreur: etat.erreur };
}

module.exports = { indexer, proches, oublier, vueEtat, normaliserQuantifier, _vec };
