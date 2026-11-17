const express     = require('express');
const { readAudit } = require('../core/store');
const { requireAdmin } = require('../auth/guards');

const router = express.Router();

// ── AUDIT ────────────────────────────────────────────────────
// Le journal d'audit nomme qui a modifié quoi : il ne sort plus sans
// session admin. La variante par ticket reste ouverte, elle alimente
// l'historique affiché dans le détail d'un ticket côté FO.

router.get('/api/audit', requireAdmin, (req, res) => res.json(readAudit()));
router.get('/api/audit/:tracker/:id', (req, res) => {
  res.json(readAudit().filter(
    a => a.tracker === req.params.tracker && a.ticket_id === req.params.id
  ));
});

module.exports = router;
