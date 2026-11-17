const express     = require('express');
const { FILES } = require('../config/paths');
const {
  readJSON, readShiftsPlan, withFileLock, writeJSON, writeShiftsPlan,
} = require('../core/store');
const { sessionValid } = require('../auth/sessions');
const { computeAnchorOffsets, generateRotaServer } = require('../services/rota');

const router = express.Router();

// ── ROTA CONFIG ───────────────────────────────────────────────
router.get('/api/rota/config', (req, res) => {
  const cfg = readJSON(FILES.config, {});
  res.json(cfg.rota_config || { sites: [] });
});

router.put('/api/rota/config', (req, res) => {
  withFileLock(FILES.config, () => {
    const cfg = readJSON(FILES.config, {});
    cfg.rota_config = req.body;
    writeJSON(FILES.config, cfg);
    res.json(cfg.rota_config);
  }).catch(err => res.status(500).json({ error: err.message }));
});

// Seuil au-delà duquel une génération est considérée comme un écrasement
// de masse et exige l'authentification admin. L'auto-remplissage courant
// (4 semaines) reste libre pour ne pas bloquer l'usage quotidien.
const ROTA_BULK_WEEKS = 8;

router.post('/api/rota/generate', (req, res) => {
  const { site_id, start_date, weeks = 4, use_anchor = false } = req.body;
  if (!site_id || !start_date) return res.status(400).json({ error: 'site_id and start_date required' });
  // Contrôle côté serveur : la vérification côté client seule serait
  // contournable par un appel direct à l'API.
  if (Number(weeks) > ROTA_BULK_WEEKS && !sessionValid(req.get('X-Admin-Token')))
    return res.status(401).json({ error: 'Unauthorized: administrator authentication required' });
  const cfg = readJSON(FILES.config, {});
  const rotaConfig = cfg.rota_config || { sites: [] };
  const site = (rotaConfig.sites || []).find(s => s.id === site_id);

  let anchorOffsets = {};
  if (use_anchor && site) {
    const existingPlan = readShiftsPlan();
    const shiftIds = (site.shifts || []).map(s => s.id);
    anchorOffsets = computeAnchorOffsets(existingPlan, site, shiftIds, start_date);
  }

  const assignments = generateRotaServer(rotaConfig, site_id, start_date, Math.min(weeks, 54), anchorOffsets);
  res.json(assignments);
});

router.post('/api/rota/save', (req, res) => {
  // Même seuil qu'à la génération : c'est cette route qui écrase
  // réellement les entrées existantes sur la plage demandée.
  if (Number(req.body.weeks) > ROTA_BULK_WEEKS && !sessionValid(req.get('X-Admin-Token')))
    return res.status(401).json({ error: 'Unauthorized: administrator authentication required' });
  withFileLock(FILES.shifts_plan, () => {
    const { assignments, entries, site_id, start_date, weeks } = req.body;
    const toSave = assignments || entries || [];
    let plan = readShiftsPlan();
    // Remove existing rota entries for this site+date range if provided
    if (site_id && start_date && weeks) {
      const start = new Date(start_date);
      const end   = new Date(start_date);
      end.setDate(end.getDate() + weeks * 7);
      const startISO = start.toISOString().slice(0, 10);
      const endISO   = end.toISOString().slice(0, 10);
      plan = plan.filter(e => !(e.is_rota && e.site_id === site_id && e.date >= startISO && e.date < endISO));
    }
    plan.push(...toSave);
    writeShiftsPlan(plan);
    res.json({ saved: toSave.length });
  }).catch(err => res.status(500).json({ error: err.message }));
});

module.exports = router;
