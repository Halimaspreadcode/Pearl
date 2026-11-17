const express     = require('express');
const { v4: uuidv4 } = require('uuid');
const { FILES } = require('../config/paths');
const { readObs, withFileLock, writeObs } = require('../core/store');
const { cleanBody } = require('../core/sanitize');

const router = express.Router();

// ── OBSERVATIONS ─────────────────────────────────────────────
//
// Cycle de vie : une observation s'ouvre, se traite, et se ferme. Le
// registre n'avait pas de fin — les entrées restaient ouvertes
// indéfiniment, et la liste devenait un journal qu'on ne relit pas
// plutôt qu'une file de travail.
//
// Trois jours sans clôture et la fermeture se fait d'elle-même. Le
// délai est délibérément court : une observation est un signalement
// d'exploitation, pas un dossier. Si elle demande plus de trois jours,
// c'est qu'elle relève d'un ticket ou d'un objectif, pas du registre.
//
// La fermeture automatique est tracée (`auto_closed`) et distinguée
// d'une fermeture décidée : on doit pouvoir dire, en relisant, si
// quelqu'un a statué ou si le délai a simplement couru.
const OBS_AUTO_CLOSE_DAYS = 3;

function obsAgeDays(o, now) {
  const t = Date.parse(o && (o.created_at || o.date) || '');
  if (!isFinite(t)) return 0;
  return Math.floor(((now || Date.now()) - t) / 86400000);
}

// Ferme ce qui a dépassé le délai. Appelé à la lecture du registre :
// sans tâche planifiée, c'est la consultation qui fait avancer l'état —
// une observation ne peut pas être « en retard de fermeture » au moment
// où quelqu'un la regarde.
function obsAutoClose() {
  const obs = readObs();
  const now = Date.now();
  let changed = 0;
  for (const o of obs) {
    if (o.status === 'Closed') continue;
    if (obsAgeDays(o, now) < OBS_AUTO_CLOSE_DAYS) continue;
    o.status = 'Closed';
    o.closed_at = new Date().toISOString();
    o.auto_closed = true;
    o.closed_by = 'auto';
    changed++;
  }
  if (changed) writeObs(obs);
  return { obs, changed };
}

router.get('/api/observations', (req, res) => {
  // La lecture déclenche la fermeture des retardataires : le registre
  // servi est donc toujours à jour, sans dépendre d'un ordonnanceur.
  withFileLock(FILES.observations, () => {
    const { obs } = obsAutoClose();
    res.json(obs);
  }).catch(() => res.json(readObs()));
});

router.post('/api/observations', (req, res) => {
  withFileLock(FILES.observations, () => {
    const obs  = readObs();
    const entry = { id: uuidv4(), created_at: new Date().toISOString(), date: new Date().toISOString(), ...cleanBody(req.body) };
    obs.push(entry);
    writeObs(obs);
    res.status(201).json(entry);
  }).catch(err => res.status(500).json({ error: err.message }));
});

router.put('/api/observations/:id', (req, res) => {
  withFileLock(FILES.observations, () => {
    const obs = readObs();
    const idx = obs.findIndex(o => o.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const wasOpen = obs[idx].status !== 'Closed';
    obs[idx] = { ...obs[idx], ...cleanBody(req.body) };
    if (wasOpen && obs[idx].status === 'Closed' && !req.body.closed_at) {
      obs[idx].closed_at = new Date().toISOString();
    }
    if (obs[idx].status !== 'Closed' && !req.body.closed_at) {
      obs[idx].closed_at = null;
    }
    writeObs(obs);
    res.json(obs[idx]);
  }).catch(err => res.status(500).json({ error: err.message }));
});

router.delete('/api/observations/:id', (req, res) => {
  withFileLock(FILES.observations, () => {
    writeObs(readObs().filter(o => o.id !== req.params.id));
    res.json({ ok: true });
  }).catch(err => res.status(500).json({ error: err.message }));
});

module.exports = router;
