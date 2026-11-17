const express = require('express');
const { addAudit } = require('../core/audit');
const { requireAdmin } = require('../auth/guards');
const imoc = require('../services/imoc');
const jobs = require('../services/ai-jobs');

const router = express.Router();

// ── CONNECTEUR IMOC (admin seulement) ─────────────────────────
// L'admin lance une requête avec ses identifiants IMOC : ils ne servent
// qu'à cette requête, ne sont ni enregistrés ni tracés (l'audit garde
// qui, quand, la période et le nombre de tickets — pas l'identifiant).
router.use('/api/imoc', requireAdmin, (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/api/imoc/config', (_req, res) => res.json(imoc.vueConf()));
router.put('/api/imoc/config', (req, res) => {
  try { res.json(imoc.majConf(req.body || {})); } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

router.get('/api/imoc/tickets', (_req, res) => res.json(imoc.base()));

// ── Ajout aux trackers (validation de l'admin) ──
router.get('/api/imoc/candidates', (_req, res) => res.json(imoc.candidats()));
router.post('/api/imoc/ignore', async (req, res) => {
  const b = req.body || {};
  try { res.json(await imoc.ignorer(Array.isArray(b.numbers) ? b.numbers.slice(0, 500) : [], b.ignore !== false)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/api/imoc/import', async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 500) : [];
  if (!items.length) return res.status(400).json({ error: 'Aucun ticket sélectionné.' });
  try {
    const r = await imoc.importer(items, 'admin (import IMOC)');
    r.created.forEach(c => addAudit(c.tracker.toUpperCase(), c.id, 'admin', 'create', { source: 'imoc', imoc_tt: c.number, sn_tt: c.sn_tt }));
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Mises à jour des tickets déjà dans un tracker (validation de l'admin) ──
router.get('/api/imoc/updates', (_req, res) => res.json(imoc.synchros()));
router.post('/api/imoc/updates/ignore', async (req, res) => {
  const b = req.body || {};
  try { res.json(await imoc.ignorerSynchro(Array.isArray(b.numbers) ? b.numbers.slice(0, 500) : [], b.ignore !== false)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/api/imoc/updates/apply', async (req, res) => {
  const numbers = Array.isArray(req.body?.numbers) ? req.body.numbers.slice(0, 500) : [];
  if (!numbers.length) return res.status(400).json({ error: 'Aucun ticket sélectionné.' });
  try {
    const r = await imoc.appliquerSynchro(numbers, 'admin (mise à jour IMOC)');
    r.applied.forEach(a => addAudit(a.tracker.toUpperCase(), a.id, 'admin', 'update', { source: 'imoc', imoc_tt: a.number, ...a.changes }));
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

let enCours = null;
// Code de vérification en attente, par requête : l'image à montrer et la
// promesse que la réponse de l'admin résout. Trois minutes pour répondre.
const questions = new Map();
function demanderCode(jobId) {
  return ({ image, essai }) => new Promise((resolve) => {
    const minuteur = setTimeout(() => { questions.delete(jobId); resolve(null); }, 3 * 60 * 1000);
    questions.set(jobId, { image, essai, resolve: v => { clearTimeout(minuteur); questions.delete(jobId); resolve(v); } });
  });
}
router.post('/api/imoc/query', (req, res) => {
  if (enCours && jobs.lire(enCours)?.etat === 'en_cours') return res.status(409).json({ error: 'Une requête IMOC est déjà en cours.' });
  const b = req.body || {};
  const demande = { username: String(b.username || ''), password: String(b.password || ''), from: b.from, to: b.to, status: b.status || '', instance: String(b.instance || 'sn') };
  if (!demande.username || !demande.password) return res.status(400).json({ error: 'Identifiant et mot de passe IMOC requis.' });
  let jobId = null;
  const job = jobs.lancer({ skill: 'imoc', titre: 'Requête IMOC' }, async progres => {
    try {
      const r = await imoc.requete(demande, progres, { demanderCode: q => demanderCode(jobId)(q) });
      addAudit('IMOC', 'query', 'admin', 'query', { instance: r.instance, from: r.from, to: r.to, count: r.count, new: r.new, updated: r.updated });
      return r;
    } catch (e) {
      addAudit('IMOC', 'query', 'admin', 'query-failed', { from: demande.from, to: demande.to, error: String(e.message).slice(0, 200) });
      throw e;
    } finally {
      // On ne garde pas le mot de passe en mémoire plus que nécessaire.
      demande.password = ''; demande.username = '';
    }
  });
  // Le corps de la requête (avec le mot de passe) n'est plus référencé.
  b.password = undefined;
  jobId = job.id;
  enCours = job.id;
  res.status(202).json({ job });
});
router.get('/api/imoc/jobs/:id', (req, res) => {
  const j = jobs.lire(req.params.id);
  if (!j || j.skill !== 'imoc') return res.status(404).json({ error: 'Requête inconnue ou expirée.' });
  const q = j.etat === 'en_cours' && questions.get(j.id);
  res.json(q ? { ...j, code: { image: q.image, essai: q.essai } } : j);
});
// Réponse de l'admin : le code lu sur l'image, ou une autre image.
router.post('/api/imoc/jobs/:id/code', (req, res) => {
  const q = questions.get(req.params.id);
  if (!q) return res.status(409).json({ error: 'Aucun code attendu pour cette requête.' });
  const b = req.body || {};
  q.resolve(b.refresh ? { refresh: true } : { code: String(b.code || '').slice(0, 20) });
  res.json({ ok: true });
});
router.post('/api/imoc/jobs/:id/cancel', (req, res) => {
  questions.get(req.params.id)?.resolve(null);
  const j = jobs.annuler(req.params.id);
  res.json({ job: j });
});

module.exports = router;
