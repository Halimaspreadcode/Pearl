const express     = require('express');
const { v4: uuidv4 } = require('uuid');
const { readBO, writeBO } = require('../core/store');
const { cleanBody } = require('../core/sanitize');

const router = express.Router();

// ── BO LIST ──────────────────────────────────────────────────
router.get('/api/bo', (req, res) => res.json(readBO()));

router.post('/api/bo', (req, res) => {
  const { name, phone } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const list = readBO();
  if (list.some(b => b.name.toLowerCase() === name.toLowerCase()))
    return res.status(409).json({ error: 'exists' });
  const entry = { id: uuidv4().slice(0,8), name, phone: phone||'' };
  list.push(entry);
  writeBO(list);
  res.status(201).json(entry);
});

router.put('/api/bo/:id', (req, res) => {
  const list = readBO();
  const idx  = list.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  list[idx] = { ...list[idx], ...cleanBody(req.body) };
  writeBO(list);
  res.json(list[idx]);
});

router.delete('/api/bo/:id', (req, res) => {
  const list = readBO().filter(b => b.id !== req.params.id);
  writeBO(list);
  res.json({ ok: true });
});

module.exports = router;
