const express     = require('express');
const { v4: uuidv4 } = require('uuid');
const { FILES } = require('../config/paths');
const { readWeeklyProgress, withFileLock, writeWeeklyProgress } = require('../core/store');
const { cleanBody } = require('../core/sanitize');

const router = express.Router();

// ── WEEKLY PROGRESS ───────────────────────────────────────────
router.get('/api/weekly-progress', (req, res) => res.json(readWeeklyProgress()));

router.post('/api/weekly-progress', (req, res) => {
  withFileLock(FILES.weekly_progress, () => {
    const items = readWeeklyProgress();
    const entry = {
      id: uuidv4().slice(0, 8),
      created_at: new Date().toISOString(),
      status: 'Planned',
      ...cleanBody(req.body)
    };
    items.push(entry);
    writeWeeklyProgress(items);
    res.status(201).json(entry);
  }).catch(err => res.status(500).json({ error: err.message }));
});

router.put('/api/weekly-progress/:id', (req, res) => {
  withFileLock(FILES.weekly_progress, () => {
    const items = readWeeklyProgress();
    const idx = items.findIndex(t => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    items[idx] = { ...items[idx], ...cleanBody(req.body), updated_at: new Date().toISOString() };
    writeWeeklyProgress(items);
    res.json(items[idx]);
  }).catch(err => res.status(500).json({ error: err.message }));
});

router.delete('/api/weekly-progress/:id', (req, res) => {
  withFileLock(FILES.weekly_progress, () => {
    const items = readWeeklyProgress();
    writeWeeklyProgress(items.filter(t => t.id !== req.params.id));
    res.json({ ok: true });
  }).catch(err => res.status(500).json({ error: err.message }));
});

module.exports = router;
