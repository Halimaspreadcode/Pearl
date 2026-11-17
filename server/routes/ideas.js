// ── BOÎTE À IDÉES ─────────────────────────────────────────────
// Un tableau blanc partagé : chacun y colle un post-it (signé ou anonyme),
// le place où il veut, et « like » ceux des autres.
//
// Accès :
//   · dans l'application : la session d'équipe suffit, y compris en
//     consultation seule — proposer une idée n'est pas modifier les données ;
//   · par lien de partage : /idees?k=<clé>. La clé (générée par l'admin,
//     révocable) ouvre ces routes-là, et seulement celles-là.
//
// Votant : chaque navigateur porte un identifiant aléatoire (X-Voter). Il
// sert à n'aimer qu'une fois et à ne déplacer que ses propres post-its ;
// il n'est jamais renvoyé tel quel, seulement comparé.
const express = require('express');
const crypto = require('crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { FILES } = require('../config/paths');
const { readJSON, writeJSON, withFileLock } = require('../core/store');
const { identiteDe } = require('../auth/identity');

const router = express.Router();

const COULEURS = ['yellow', 'pink', 'blue', 'green', 'orange', 'purple'];
const BOARD = { w: 1800, h: 1200 };
const MAX_TXT = 280;

const lireIdees = () => readJSON(FILES.ideas, []);
const lirePartage = () => readJSON(FILES.ideas_share, {});
const empreinte = v => crypto.createHash('sha256').update(String(v || '')).digest('hex').slice(0, 24);
const votant = req => {
  const v = String(req.get('X-Voter') || '').trim();
  return /^[a-zA-Z0-9-]{8,64}$/.test(v) ? empreinte(v) : '';
};
const cleValide = req => {
  const k = String(req.get('X-Ideas-Key') || req.query.k || '');
  const { key } = lirePartage();
  return !!key && k.length === key.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(key));
};
const estAdmin = req => !!(identiteDe(req) || {}).admin;
const borne = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));

// Ce que le client reçoit : jamais l'empreinte du votant ni des « likes ».
function vue(idee, moi, admin) {
  const likes = idee.likes || [];
  return {
    id: idee.id, text: idee.text, author: idee.author || null, color: idee.color,
    x: idee.x, y: idee.y, rot: idee.rot || 0, created_at: idee.created_at,
    likes: likes.length, liked: !!moi && likes.includes(moi),
    mine: !!moi && idee.owner === moi, can_edit: admin || (!!moi && idee.owner === moi),
  };
}

const ecritures = rateLimit({
  windowMs: 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false,
  keyGenerator: req => votant(req) || ipKeyGenerator(req.ip || ''),
});

router.get('/api/ideas', (req, res) => {
  const moi = votant(req), admin = estAdmin(req);
  res.json({ board: BOARD, ideas: lireIdees().map(i => vue(i, moi, admin)) });
});

router.post('/api/ideas', ecritures, (req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, MAX_TXT);
  if (!text) return res.status(400).json({ error: 'Write your idea first.' });
  const moi = votant(req);
  if (!moi) return res.status(400).json({ error: 'Missing voter id.' });
  // Signature : le nom de la session s'il y en a une, sinon celui saisi,
  // sinon anonyme. Un nom saisi est simplement affiché, pas vérifié.
  const qui = identiteDe(req);
  const signe = !!req.body?.signed;
  const author = signe
    ? String((qui && !qui.lecture && qui.name) || req.body?.author || '').trim().slice(0, 40) || null
    : null;
  withFileLock(FILES.ideas, () => {
    const list = lireIdees();
    const idee = {
      id: crypto.randomBytes(5).toString('hex'),
      text, author,
      color: COULEURS.includes(req.body?.color) ? req.body.color : 'yellow',
      x: borne(req.body?.x, BOARD.w - 200), y: borne(req.body?.y, BOARD.h - 200),
      rot: Math.max(-6, Math.min(6, Number(req.body?.rot) || 0)),
      owner: moi, likes: [], created_at: new Date().toISOString(),
    };
    list.push(idee);
    writeJSON(FILES.ideas, list);
    res.status(201).json(vue(idee, moi, estAdmin(req)));
  }).catch(e => res.status(500).json({ error: e.message }));
});

// Déplacer : son propre post-it (ou l'admin).
router.put('/api/ideas/:id', ecritures, (req, res) => {
  const moi = votant(req), admin = estAdmin(req);
  withFileLock(FILES.ideas, () => {
    const list = lireIdees();
    const i = list.find(x => x.id === req.params.id);
    if (!i) return res.status(404).json({ error: 'Not found' });
    if (!admin && (!moi || i.owner !== moi)) return res.status(403).json({ error: 'You can only move your own notes.' });
    i.x = borne(req.body?.x, BOARD.w - 200);
    i.y = borne(req.body?.y, BOARD.h - 200);
    writeJSON(FILES.ideas, list);
    res.json(vue(i, moi, admin));
  }).catch(e => res.status(500).json({ error: e.message }));
});

// Aimer / ne plus aimer : une fois par navigateur.
router.post('/api/ideas/:id/like', ecritures, (req, res) => {
  const moi = votant(req);
  if (!moi) return res.status(400).json({ error: 'Missing voter id.' });
  withFileLock(FILES.ideas, () => {
    const list = lireIdees();
    const i = list.find(x => x.id === req.params.id);
    if (!i) return res.status(404).json({ error: 'Not found' });
    i.likes = i.likes || [];
    const k = i.likes.indexOf(moi);
    if (k >= 0) i.likes.splice(k, 1); else i.likes.push(moi);
    writeJSON(FILES.ideas, list);
    res.json(vue(i, moi, estAdmin(req)));
  }).catch(e => res.status(500).json({ error: e.message }));
});

router.delete('/api/ideas/:id', ecritures, (req, res) => {
  const moi = votant(req), admin = estAdmin(req);
  withFileLock(FILES.ideas, () => {
    const list = lireIdees();
    const idx = list.findIndex(x => x.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Not found' });
    if (!admin && (!moi || list[idx].owner !== moi)) return res.status(403).json({ error: 'You can only remove your own notes.' });
    list.splice(idx, 1);
    writeJSON(FILES.ideas, list);
    res.json({ ok: true });
  }).catch(e => res.status(500).json({ error: e.message }));
});

// Lien de partage (admin) : lire, ou créer / renouveler la clé.
router.get('/api/ideas-share', (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: 'Admin only.' });
  res.json({ key: lirePartage().key || null });
});
router.post('/api/ideas-share', (req, res) => {
  if (!estAdmin(req)) return res.status(403).json({ error: 'Admin only.' });
  const off = req.body && req.body.disable;
  const key = off ? null : crypto.randomBytes(18).toString('base64url');
  writeJSON(FILES.ideas_share, { key, updated_at: new Date().toISOString() });
  res.json({ key });
});

// Utilisé par le verrou d'équipe et le contrôle d'identité : une requête
// sur ces routes, avec la clé de partage valide, passe sans session.
const ROUTES = /^\/ideas(\/[^/]+(\/like)?)?$/;
function accesParLien(req) { return ROUTES.test(req.path) && cleValide(req); }

module.exports = router;
module.exports.accesParLien = accesParLien;
module.exports.ROUTES = ROUTES;
