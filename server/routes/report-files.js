const express     = require('express');
const fs          = require('fs');
const path        = require('path');
const { FILES } = require('../config/paths');
const { withFileLock, writeJSON } = require('../core/store');
const { REPORTS_DIR, readDrafts, readReportFiles } = require('../services/report-store');

const router = express.Router();

// ── CLASSEURS DÉPOSÉS PAR LA PAGE ─────────────────────────────
// Pourquoi la page dépose son classeur : voir services/report-store.js.

router.put('/api/report-file/:type', express.raw({ type: '*/*', limit: '25mb' }), (req, res) => {
  const type = String(req.params.type || '');
  if (!['daily', 'weekly', 'monthly'].includes(type))
    return res.status(400).json({ error: 'Type de rapport inconnu' });
  if (!req.body || !req.body.length)
    return res.status(400).json({ error: 'Fichier vide' });

  const pays = ['SN', 'CI', 'ALL'].includes(String(req.query.country)) ? String(req.query.country) : 'SN';
  withFileLock(FILES.report_files, () => {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    const nom = `${type}-${pays}.xlsx`;
    // Écriture atomique : un envoi qui lirait le fichier au milieu d'une
    // réécriture recevrait un classeur tronqué.
    const tmp = path.join(REPORTS_DIR, `.${nom}.tmp`);
    fs.writeFileSync(tmp, req.body);
    fs.renameSync(tmp, path.join(REPORTS_DIR, nom));

    const idx = readReportFiles();
    idx[`${type}:${pays}`] = {
      filename: String(req.query.filename || nom).replace(/[^\w.\-]/g, '_'),
      saved_at: new Date().toISOString(),
      period:   String(req.query.period || ''),
      size:     req.body.length,
      country:  pays,
    };
    writeJSON(FILES.report_files, idx);
    res.json({ ok: true });
  }).catch(err => res.status(500).json({ error: err.message }));
});

router.get('/api/report-draft/:type/:period', (req, res) => {
  const all = readDrafts();
  res.json(all[`${req.params.type}:${req.params.period}`] || null);
});

router.put('/api/report-draft/:type/:period', (req, res) => {
  const type = String(req.params.type || '');
  if (!['daily', 'weekly', 'monthly'].includes(type))
    return res.status(400).json({ error: 'Type de rapport inconnu' });

  withFileLock(FILES.report_drafts, () => {
    const all = readDrafts();
    const b = req.body || {};
    const lignes = v => Array.isArray(v) ? v.slice(0, 200) : [];
    all[`${type}:${req.params.period}`] = {
      author:     String(b.author || '').slice(0, 120),
      highlights: lignes(b.highlights),
      risks:      lignes(b.risks),
      actions:    lignes(b.actions),
      notes:      typeof b.notes === 'string' ? b.notes.slice(0, 20000) : (b.notes || ''),
      saved_at:   new Date().toISOString(),
    };
    // Bornage : un brouillon par jour pendant des années ferait grossir le
    // fichier sans qu'on relise jamais les anciens.
    const cles = Object.keys(all);
    if (cles.length > 400) {
      cles.sort((a, b2) => String(all[a].saved_at || '').localeCompare(String(all[b2].saved_at || '')));
      cles.slice(0, cles.length - 400).forEach(k => delete all[k]);
    }
    writeJSON(FILES.report_drafts, all);
    res.json({ ok: true });
  }).catch(err => res.status(500).json({ error: err.message }));
});

module.exports = router;
