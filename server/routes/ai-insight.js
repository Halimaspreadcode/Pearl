const express   = require('express');
const { agentDe } = require('../auth/identity');
const { foSessionOwner } = require('../auth/sessions');
const insight = require('../services/ai-insight');

const router = express.Router();

// ── INSIGHT DE L'AGENT (page My Performance) ──────────────────
// Comme /api/my-perf : l'agent est celui du jeton, aucun paramètre ne
// permet de viser quelqu'un d'autre. Lecture seule : les insights sont
// générés automatiquement par le serveur (services/ai-insight.js), pour
// les agents que l'admin a activés.
function agent(req, res) {
  const fo = agentDe(req);
  if (!fo) { res.status(401).json({ error: 'Session expired or missing.' }); return null; }
  res.set('Cache-Control', 'no-store');
  return fo;
}

router.get('/api/my-insight', (req, res) => {
  const fo = agent(req, res); if (!fo) return;
  res.json(insight.etatPour(fo));
});

// Un insight passé de l'agent, choisi dans son historique.
router.get('/api/my-insight/:id', (req, res) => {
  const fo = agent(req, res); if (!fo) return;
  const i = insight.insightParId(fo, req.params.id);
  if (!i) return res.status(404).json({ error: 'Insight not found.' });
  res.json({ insight: i });
});

module.exports = router;
