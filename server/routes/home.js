// Tableau de bord composable (services/home.js).
const express = require('express');
const home = require('../services/home');
const { estAdmin } = require('../auth/identity');

const router = express.Router();
const send = (res, e) => res.status(e.status || 500).json({ error: e.status ? e.message : 'Erreur interne' });

function modsOf(req) {
  if (!req.tenant) return require('../platform/modules').MODULES.map(m => m.id);
  return require('../platform/modules').activeModules(req.tenant);
}
function packHome(req) {
  try { return req.tenant && req.tenant.pack ? (require('../platform/provision').getPack(req.tenant.pack).home || null) : null; }
  catch { return null; }
}
// La disposition personnelle suit la personne : compte, sinon ID employé.
function userKey(req) {
  const q = req.qui || {};
  const k = (req.account && req.account.email) || q.employeeId || (q.name && !q.lecture ? q.name : '');
  return String(k || '').trim().toLowerCase() || null;
}
const isAdmin = req => estAdmin(req) || !!(req.account && ['owner', 'admin', 'manager'].includes(req.account.role));
const requireAdmin = (req, res, next) => (isAdmin(req) ? next() : res.status(403).json({ error: 'Réservé aux administrateurs et managers.' }));
const who = req => (req.account && req.account.email) || (req.qui && req.qui.name) || null;

router.get('/api/home', (req, res) => {
  try {
    const period = ['week', 'month', 'quarter', 'year'].includes(req.query.period) ? req.query.period : 'month';
    res.json({ ...home.build({ mods: modsOf(req), period, userKey: userKey(req), isAdmin: isAdmin(req), packHome: packHome(req) }), personal: !!userKey(req) });
  } catch (e) { send(res, e); }
});

router.put('/api/home/layout', (req, res) => {
  try {
    const scope = req.body?.scope === 'org' ? 'org' : 'me';
    if (scope === 'org' && !isAdmin(req)) return res.status(403).json({ error: "Seuls les administrateurs modifient la disposition de l'organisation." });
    const layout = home.saveLayout(scope, userKey(req), req.body?.layout, modsOf(req));
    res.json({ ok: true, layout });
  } catch (e) { send(res, e); }
});
router.delete('/api/home/layout', (req, res) => {
  try {
    const scope = req.query.scope === 'org' ? 'org' : 'me';
    if (scope === 'org' && !isAdmin(req)) return res.status(403).json({ error: "Seuls les administrateurs modifient la disposition de l'organisation." });
    home.resetLayout(scope, userKey(req));
    res.json({ ok: true });
  } catch (e) { send(res, e); }
});

router.post('/api/home/metrics', requireAdmin, (req, res) => { try { res.status(201).json(home.upsertMetric(null, req.body)); } catch (e) { send(res, e); } });
router.put('/api/home/metrics/:id', requireAdmin, (req, res) => { try { res.json(home.upsertMetric(req.params.id, req.body)); } catch (e) { send(res, e); } });
router.delete('/api/home/metrics/:id', requireAdmin, (req, res) => { try { home.deleteMetric(req.params.id); res.json({ ok: true }); } catch (e) { send(res, e); } });
router.post('/api/home/metrics/:id/entries', requireAdmin, (req, res) => {
  try { res.json(home.addEntries(req.params.id, req.body?.entries || req.body, who(req))); } catch (e) { send(res, e); }
});
router.delete('/api/home/metrics/:id/entries/:date', requireAdmin, (req, res) => {
  try { home.deleteEntry(req.params.id, req.params.date); res.json({ ok: true }); } catch (e) { send(res, e); }
});

module.exports = router;
