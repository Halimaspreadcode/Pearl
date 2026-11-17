const express     = require('express');
const { FILES } = require('../config/paths');
const { readCfg, withFileLock, writeCfg } = require('../core/store');
const { addAudit } = require('../core/audit');
const { requireAdmin } = require('../auth/guards');
const { COURSES, catalog, readLocks } = require('../services/academy');

const router = express.Router();

// ── ACADEMY ───────────────────────────────────────────────────
// Catalogue (formations, modules, sessions) et fermetures. Lecture
// ouverte : l'agent doit savoir ce qui est fermé pour ne pas y entrer.
// Aucune donnée personnelle ici, seulement la structure des cours.
router.get('/api/academy', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ courses: catalog() });
});

// Version légère, lue de façon synchrone par le pont des formations avant
// le chargement du cours : elle doit rester petite et rapide.
router.get('/api/academy/locks', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(readLocks());
});

// Ouvrir ou fermer : { courses: { id: bool }, modules: { 'id:M3': bool } }.
// Seules les clés connues sont retenues, pour qu'un nom mal tapé ne
// s'accumule pas dans la config.
router.put('/api/academy/locks', requireAdmin, (req, res) => {
  const b = req.body || {};
  const known = new Set(COURSES.map(c => c.id));
  const modKey = /^([a-z]+):(M\d{1,2})$/;
  withFileLock(FILES.config, () => {
    const cfg = readCfg();
    const cur = cfg.academy || {};
    const courses = { ...(cur.courses || {}) };
    const modules = { ...(cur.modules || {}) };
    const changes = [];
    for (const [id, v] of Object.entries(b.courses || {})) {
      if (!known.has(id)) continue;
      if (v) courses[id] = true; else delete courses[id];
      changes.push(`${id}=${v ? 'fermé' : 'ouvert'}`);
    }
    for (const [k, v] of Object.entries(b.modules || {})) {
      const m = modKey.exec(k);
      if (!m || !known.has(m[1])) continue;
      if (v) modules[k] = true; else delete modules[k];
      changes.push(`${k}=${v ? 'fermé' : 'ouvert'}`);
    }
    cfg.academy = { courses, modules };
    writeCfg(cfg);
    if (changes.length) addAudit('academy', 'locks', String(b.by || 'admin').slice(0, 120), 'update', { changes });
    res.json(cfg.academy);
  }).catch(e => res.status(500).json({ error: e.message }));
});

module.exports = router;
