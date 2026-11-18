const express = require('express');
const { addAudit } = require('../core/audit');
const { requireAdmin } = require('../auth/guards');
const { reqCountry } = require('../core/enrich');
const ind = require('../services/indicateurs');
const jobs = require('../services/ai-jobs');

const router = express.Router();

// ── INDICATEURS (admin) ───────────────────────────────────────
// L'IA ne sert qu'à écrire la définition ; le suivi est calculé ici, à
// chaque lecture, sans appel au modèle.
router.use('/api/indicateurs', requireAdmin, (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/api/indicateurs/catalogue', (_req, res) => res.json(ind.catalogue()));

router.get('/api/indicateurs', (req, res) => {
  const country = reqCountry(req);
  const items = ind.lire().map(def => {
    try { const r = ind.calculer(def, { country }); return { def: r.def, resume: r.resume, serie: r.serie }; }
    catch (e) { return { def, erreur: e.message }; }
  });
  res.json({ items });
});

router.post('/api/indicateurs/apercu', (req, res) => {
  try {
    const { avertissements } = ind.nettoyer(req.body?.def);
    res.json({ ...ind.calculer(req.body?.def, { country: reqCountry(req) }), avertissements });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/api/indicateurs/:id', (req, res) => {
  const def = ind.lire().find(x => x.id === req.params.id);
  if (!def) return res.status(404).json({ error: 'Indicateur introuvable.' });
  res.json({ ...ind.calculer(def, { country: reqCountry(req) }), meta: { cree_le: def.cree_le, maj_le: def.maj_le } });
});

router.post('/api/indicateurs', async (req, res) => {
  try {
    const r = await ind.enregistrer(req.body?.def, 'admin');
    addAudit('INDICATEUR', r.item.genre, 'admin', r.item.nom, { id: r.item.id });
    res.json(r);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/api/indicateurs/:id', async (req, res) => {
  const ok = await ind.supprimer(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Indicateur introuvable.' });
  addAudit('INDICATEUR', 'suppression', 'admin', req.params.id, {});
  res.json({ ok: true });
});

// Traduction par l'IA, en tâche de fond (même suivi et même Stop que
// Pear AI : /api/ai/jobs/:id).
router.post('/api/indicateurs/ia', (req, res) => {
  const b = req.body || {};
  if (!String(b.demande || '').trim()) return res.status(400).json({ error: 'Décris l\'indicateur ou la vue voulue.' });
  const country = reqCountry(req);
  const job = jobs.lancer({ skill: 'indicateur', titre: 'Indicateur' }, async progres => {
    const r = await ind.traduire({ demande: b.demande, def: b.def, historique: b.historique }, progres);
    const calc = ind.calculer(r.definition, { country });
    addAudit('AI', 'indicateur', 'admin', r.definition.nom, { ms: r.ms });
    return { ...r, calcul: calc };
  });
  res.status(202).json({ job });
});

module.exports = router;
