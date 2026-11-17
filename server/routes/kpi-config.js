const express     = require('express');
const { FILES } = require('../config/paths');
const { readCfg, withFileLock, writeCfg } = require('../core/store');
const { authLimiter } = require('../http/security');
const { requireAdmin } = require('../auth/guards');

const router = express.Router();

// ── KPI CONFIG ────────────────────────────────────────────────
// Stores which KPI cards are visible: config.kpi_visibility = { [id]: true|false }
// Authenticated with the same CONFIG_PW.
const DEFAULT_KPI_VISIBILITY = {
  total: true, open: true, resolved: true, in_progress: true,
  breach: true, p1: true, sla_rate: true, avg_resolution: true
};

router.get('/api/kpi-config', (req, res) => {
  const cfg = readCfg();
  res.json({ kpi_visibility: { ...DEFAULT_KPI_VISIBILITY, ...(cfg.kpi_visibility || {}) } });
});

router.put('/api/kpi-config', authLimiter, requireAdmin, (req, res) => {
  withFileLock(FILES.config, () => {
    const cfg = readCfg();
    const visibility = { ...DEFAULT_KPI_VISIBILITY, ...(cfg.kpi_visibility || {}), ...req.body.visibility };
    cfg.kpi_visibility = visibility;
    writeCfg(cfg);
    res.json({ kpi_visibility: visibility });
  }).catch(err => res.status(500).json({ error: err.message }));
});

// Quick on/off toggle for a single KPI card - no password required (display preference only)
router.put('/api/kpi-config/toggle/:id', requireAdmin, (req, res) => {
  withFileLock(FILES.config, () => {
    const cfg = readCfg();
    const visibility = { ...DEFAULT_KPI_VISIBILITY, ...(cfg.kpi_visibility || {}) };
    visibility[req.params.id] = !!req.body.visible;
    cfg.kpi_visibility = visibility;
    writeCfg(cfg);
    res.json({ kpi_visibility: visibility });
  }).catch(err => res.status(500).json({ error: err.message }));
});

module.exports = router;
