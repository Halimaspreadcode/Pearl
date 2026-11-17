const express     = require('express');
const { FILES } = require('../config/paths');
const { readReportLayout, withFileLock, writeReportLayout } = require('../core/store');

const router = express.Router();

// ── REPORT LAYOUT (shared across all users: section order, hidden sections, custom columns) ──
router.get('/api/report-layout', (req, res) => res.json(readReportLayout()));

router.put('/api/report-layout', (req, res) => {
  withFileLock(FILES.report_layout, () => {
    const layout = readReportLayout();
    const { reportType, order, hidden, customCols } = req.body || {};
    if (!reportType) return res.status(400).json({ error: 'reportType required' });
    if (order)      { layout.order[reportType] = order; }
    if (hidden)     { layout.hidden[reportType] = hidden; }
    if (customCols) { layout.customCols[reportType] = customCols; }
    writeReportLayout(layout);
    res.json(layout);
  }).catch(err => res.status(500).json({ error: err.message }));
});

module.exports = router;
