const express = require('express');
const { FILES, siteFile } = require('../config/paths');
const { withFileLock, readCfg, writeCfg, readSites, readTracker, writeTracker, docExists, removeDoc } = require('../core/store');
const { requireAdmin } = require('../auth/guards');
const { addAudit } = require('../core/audit');
const { cleanSites } = require('../platform/provision');

const router = express.Router();

// ── SITES ─────────────────────────────────────────────────────
// Les sites d'une organisation (agences, plateaux, pays, zones…). Chaque
// site a son tracker de tickets. Lecture ouverte à l'équipe ; écriture
// réservée à l'admin.
router.get('/api/sites', (req, res) => res.json(readSites()));

// Remplace la liste. Un site retiré qui porte encore des tickets est
// refusé : on ne perd jamais un historique par un clic.
router.put('/api/sites', requireAdmin, (req, res) => {
  const next = cleanSites(req.body && req.body.sites);
  if (!next.length) return res.status(400).json({ error: 'Au moins un site est nécessaire.' });
  withFileLock(FILES.config, () => {
    const cfg = readCfg();
    const before = readSites(cfg);
    const retires = before.filter(s => !next.some(n => n.code === s.code));
    const avecTickets = retires.filter(s => readTracker(s.code).length);
    if (avecTickets.length && !(req.body && req.body.archive === true))
      return res.status(409).json({ error: `Site(s) avec des tickets : ${avecTickets.map(s => s.code).join(', ')}. Les tickets doivent être déplacés, ou confirmer l'archivage.`, sites: avecTickets.map(s => s.code) });
    // Archivage : les tickets d'un site retiré sont conservés à part.
    for (const s of retires) {
      const t = readTracker(s.code);
      if (t.length) writeTracker(`ARC${s.code}`.slice(0, 8), t);
      if (docExists(siteFile(s.code))) removeDoc(siteFile(s.code));
    }
    for (const s of next) if (!docExists(siteFile(s.code))) writeTracker(s.code, []);
    cfg.sites = next;
    writeCfg(cfg);
    addAudit('config', 'sites', 'admin', 'sites-update', { from: before.map(s => s.code), to: next.map(s => s.code) });
    res.json({ ok: true, sites: readSites(cfg) });
  }).catch(e => res.status(500).json({ error: e.message }));
});

module.exports = router;
