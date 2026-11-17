const express     = require('express');
const { v4: uuidv4 } = require('uuid');
const { FILES } = require('../config/paths');
const { readShiftsPlan, withFileLock, writeShiftsPlan } = require('../core/store');
const { cleanBody } = require('../core/sanitize');

const router = express.Router();

// ── SHIFTS PLAN ──────────────────────────────────────────────
router.get('/api/shifts-plan', (req, res) => res.json(readShiftsPlan()));

router.post('/api/shifts-plan', (req, res) => {
  withFileLock(FILES.shifts_plan, () => {
    const plan = readShiftsPlan();
    const entry = { id: uuidv4().slice(0,8), created_at: new Date().toISOString(), ...cleanBody(req.body) };
    plan.push(entry);
    writeShiftsPlan(plan);
    res.status(201).json(entry);
  }).catch(err => res.status(500).json({ error: err.message }));
});

router.put('/api/shifts-plan/:id', (req, res) => {
  withFileLock(FILES.shifts_plan, () => {
    const plan = readShiftsPlan();
    const idx = plan.findIndex(s => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    plan[idx] = { ...plan[idx], ...cleanBody(req.body) };
    writeShiftsPlan(plan);
    res.json(plan[idx]);
  }).catch(err => res.status(500).json({ error: err.message }));
});

router.delete('/api/shifts-plan/:id', (req, res) => {
  withFileLock(FILES.shifts_plan, () => {
    writeShiftsPlan(readShiftsPlan().filter(s => s.id !== req.params.id));
    res.json({ ok: true });
  }).catch(err => res.status(500).json({ error: err.message }));
});

module.exports = router;
