const express = require('express');
const { suggest } = require('../services/suggest');

const router = express.Router();

// ── SUGGESTIONS À LA CRÉATION D'UN TICKET ────────────────────
// GET /api/sn/suggest?title=…&sn_tt=…&imoc_tt=…&domain=…
// Monté AVANT le routeur tickets dans index.js : sinon `/api/sn/:id`
// capturerait « suggest » comme un id et répondrait 404.
const txt = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

['sn', 'ci'].forEach(tracker => {
  router.get(`/api/${tracker}/suggest`, (req, res) => {
    const q = req.query || {};
    res.json(suggest(tracker, {
      title:   txt(q.title, 500),
      sn_tt:   txt(q.sn_tt, 50).trim(),
      imoc_tt: txt(q.imoc_tt, 50).trim(),
      domain:  txt(q.domain, 50).trim(),
    }));
  });
});

module.exports = router;
