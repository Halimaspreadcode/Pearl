const express = require('express');
const { addAudit } = require('../core/audit');
const { requireAdmin } = require('../auth/guards');
const parties = require('../services/parties');

const router = express.Router();

// ── RÔLES ET PARTIES PRENANTES ────────────────────────────────
// Lecture : ouverte (la barre latérale et l'identité en ont besoin),
// sans e-mail ni téléphone. Écriture : admin.
router.get('/api/parties', (req, res) => {
  const v = parties.vue();
  const admin = require('../auth/identity').identiteDe(req)?.admin;
  if (!admin) v.people = v.people.map(({ id, name, role, country }) => ({ id, name, role, country }));
  res.json(v);
});
const ok = (fn, quoi) => async (req, res) => {
  try { const r = await fn(req); addAudit('PARTIES', quoi, 'admin', req.params.key || req.params.id || r?.key || r?.name || '', {}); res.json(r); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
};
router.post('/api/parties/roles', requireAdmin, ok(req => parties.majRole(req.body || {}), 'role'));
router.delete('/api/parties/roles/:key', requireAdmin, ok(req => parties.retirerRole(req.params.key), 'role-remove'));
router.post('/api/parties/people', requireAdmin, ok(req => parties.majPersonne(req.body || {}), 'person'));
router.delete('/api/parties/people/:id', requireAdmin, ok(req => parties.retirerPersonne(req.params.id), 'person-remove'));
router.post('/api/parties/people/:id/alias', requireAdmin, ok(req => parties.ajouterAlias(req.params.id, req.body?.alias), 'alias'));
router.get('/api/parties/reconnaitre', requireAdmin, (req, res) => res.json(parties.reconnaitre(String(req.query.q || '')) || {}));

module.exports = router;
