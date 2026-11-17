const express = require('express');
const { suggest } = require('../services/suggest');
const { siteCodes } = require('../core/store');

const router = express.Router();

// ── SUGGESTIONS À LA CRÉATION D'UN TICKET ────────────────────
// GET /api/tickets/:site/suggest?title=…&sn_tt=…&imoc_tt=…&domain=…
// Monté AVANT le routeur tickets dans index.js : sinon
// `/api/tickets/:site/:id` capturerait « suggest » comme un id.
const txt = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

router.get('/api/tickets/:site/suggest', (req, res) => {
    const tracker = String(req.params.site || '').toUpperCase();
    if (!siteCodes().includes(tracker)) return res.status(404).json({ error: 'Site inconnu' });
    const q = req.query || {};
    res.json(suggest(tracker.toLowerCase(), {
      title:   txt(q.title, 500),
      sn_tt:   txt(q.sn_tt, 50).trim(),
      imoc_tt: txt(q.imoc_tt, 50).trim(),
      domain:  txt(q.domain, 50).trim(),
    }));
});

module.exports = router;
