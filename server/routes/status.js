const express     = require('express');
const { getPendingWrites } = require('../core/store');

const router = express.Router();

// ── STATUS ───────────────────────────────────────────────────
router.get('/api/status', (req, res) => res.json({ pending: getPendingWrites(), ok: true }));

// ── VERSION DU SERVEUR ───────────────────────────────────────
// Change à chaque démarrage (redémarrage, mise à jour par le watchdog) :
// les navigateurs ouverts la comparent à celle qu'ils ont chargée et se
// rechargent d'eux-mêmes (public/js/core/auto-reload.js). Le commit est
// joint pour lecture humaine ; c'est l'heure de démarrage qui fait foi.
const BOOT = (() => {
  let commit = '';
  try {
    commit = require('child_process').execFileSync('git', ['rev-parse', '--short', 'HEAD'],
      { cwd: require('path').join(__dirname, '..', '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { /* pas de git : l'heure de démarrage suffit */ }
  return { boot: `${Date.now().toString(36)}-${process.pid}`, commit, started_at: new Date().toISOString() };
})();
router.get('/api/version', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(BOOT);
});

module.exports = router;
