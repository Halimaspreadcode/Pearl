const express     = require('express');
const { v4: uuidv4 } = require('uuid');
const { FILES } = require('../config/paths');
const { readFOTasks, withFileLock, writeFOTasks } = require('../core/store');
const { cleanBody } = require('../core/sanitize');

const router = express.Router();

// ── FO TASKS ─────────────────────────────────────────────────
router.get('/api/fo-tasks', (req, res) => res.json(readFOTasks()));

// Generate occurrences for a recurring task across all of 2026
function generateOccurrences(parent) {
  const { recurrence, assigned_to, title, priority, notes } = parent;
  if (!recurrence || recurrence === '') return [];

  const YEAR_START = new Date('2026-01-01');
  const YEAR_END   = new Date('2026-12-31');

  const step = { daily: 1, weekly: 7, monthly: null }[recurrence];
  const occurrences = [];
  let cur = new Date(YEAR_START);

  while (cur <= YEAR_END) {
    const dateStr = cur.toISOString().slice(0, 10);
    occurrences.push({
      id: uuidv4().slice(0, 8),
      parent_id: parent.id,
      created_at: new Date().toISOString(),
      status: 'Pending',
      title, assigned_to, priority: priority || '', notes: notes || '',
      recurrence,
      due_date: dateStr,
      is_occurrence: true
    });
    if (recurrence === 'monthly') {
      cur = new Date(cur);
      cur.setMonth(cur.getMonth() + 1);
    } else {
      cur.setDate(cur.getDate() + step);
    }
  }
  return occurrences;
}

router.post('/api/fo-tasks', (req, res) => {
  withFileLock(FILES.fo_tasks, () => {
    let tasks = readFOTasks();
    const entry = {
      id: uuidv4().slice(0, 8),
      created_at: new Date().toISOString(),
      status: req.body.recurrence ? 'Recurring' : 'Pending',
      ...cleanBody(req.body)
    };
    tasks.push(entry);
    if (entry.recurrence) {
      tasks = tasks.concat(generateOccurrences(entry));
    }
    writeFOTasks(tasks);
    res.status(201).json(entry);
  }).catch(err => res.status(500).json({ error: err.message }));
});

router.put('/api/fo-tasks/:id', (req, res) => {
  withFileLock(FILES.fo_tasks, () => {
    let tasks = readFOTasks();
    const idx = tasks.findIndex(t => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const updated = { ...tasks[idx], ...cleanBody(req.body), updated_at: new Date().toISOString() };
    // If this is a parent recurring task, regenerate occurrences
    if (!updated.is_occurrence && updated.recurrence) {
      updated.status = 'Recurring';
      tasks[idx] = updated;
      // Keep existing occurrences as-is (preserve their status, e.g. Done),
      // only add occurrences for dates that don't already exist
      const existing = tasks.filter(t => t.parent_id === updated.id);
      const existingDates = new Set(existing.map(t => t.due_date));
      const fresh = generateOccurrences(updated).filter(o => !existingDates.has(o.due_date));
      tasks = tasks.concat(fresh);
    } else {
      tasks[idx] = updated;
    }
    writeFOTasks(tasks);
    res.json(updated);
  }).catch(err => res.status(500).json({ error: err.message }));
});

router.delete('/api/fo-tasks/:id', (req, res) => {
  withFileLock(FILES.fo_tasks, () => {
    const tasks = readFOTasks();
    const target = tasks.find(t => t.id === req.params.id);
    // Also delete all occurrences if deleting a parent
    const idsToRemove = new Set([req.params.id]);
    if (target && !target.is_occurrence) {
      tasks.filter(t => t.parent_id === req.params.id).forEach(t => idsToRemove.add(t.id));
    }
    writeFOTasks(tasks.filter(t => !idsToRemove.has(t.id)));
    res.json({ ok: true });
  }).catch(err => res.status(500).json({ error: err.message }));
});

module.exports = router;
