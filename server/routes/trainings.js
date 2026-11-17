const express     = require('express');
const { v4: uuidv4 } = require('uuid');
const { FILES } = require('../config/paths');
const { readTrainings, withFileLock, writeTrainings } = require('../core/store');
const { addAudit } = require('../core/audit');
const { authLimiter } = require('../http/security');
const { requireAdmin } = require('../auth/guards');

const router = express.Router();

// ── AGENDA DE TRAINING ────────────────────────────────────────
// Calendrier des sessions de formation. Volontairement simple : l'admin
// pose les séances, l'équipe les consulte. Pas d'inscription ni d'émargement
// — « Formation » existe déjà comme type d'absence pour le décompte des
// jours, cet agenda ne fait que dire quoi a lieu, quand et où.
const TRAINING_MAX = 500;

// Renvoie un message d'erreur, ou null si la séance est valide.
function validateTraining(b) {
  const title = String(b.title || '').trim();
  if (!title) return 'Title is required.';
  if (title.length > 120) return 'Title too long (120 characters max).';

  const date = String(b.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Date invalide (format attendu : AAAA-MM-JJ).';
  if (Number.isNaN(Date.parse(date))) return 'Date inexistante.';

  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  const start = String(b.start_time || '').trim();
  const end   = String(b.end_time   || '').trim();
  if (start && !hhmm.test(start)) return 'Invalid start time (HH:MM).';
  if (end   && !hhmm.test(end))   return 'Heure de fin invalide (HH:MM).';
  // Comparaison lexicographique : sur du HH:MM zéro-paddé, elle équivaut
  // à une comparaison horaire, sans passer par des objets Date.
  if (start && end && end <= start) return 'The end time must be after the start time.';

  if (String(b.trainer  || '').length > 80)  return 'Trainer: 80 characters max.';
  if (String(b.location || '').length > 80)  return 'Location: 80 characters max.';
  if (String(b.audience || '').length > 200) return 'Attendees: 200 characters max.';
  if (String(b.notes    || '').length > 1000) return 'Notes: 1000 characters max.';
  return null;
}

function trainingFromBody(b) {
  return {
    title:      String(b.title || '').trim(),
    date:       String(b.date  || '').trim(),
    start_time: String(b.start_time || '').trim(),
    end_time:   String(b.end_time   || '').trim(),
    trainer:    String(b.trainer  || '').trim().slice(0, 80),
    location:   String(b.location || '').trim().slice(0, 80),
    audience:   String(b.audience || '').trim().slice(0, 200),
    notes:      String(b.notes    || '').trim().slice(0, 1000),
  };
}

// Lecture ouverte : l'équipe doit pouvoir consulter le programme. Seule
// l'écriture est réservée à l'administration.
router.get('/api/trainings', (req, res) => {
  const list = readTrainings()
    .slice()
    .sort((a, b) => (a.date + (a.start_time || '')).localeCompare(b.date + (b.start_time || '')));
  res.json(list);
});

router.post('/api/trainings', authLimiter, requireAdmin, (req, res) => {
  const err = validateTraining(req.body || {});
  if (err) return res.status(400).json({ error: err });

  withFileLock(FILES.trainings, () => {
    const list = readTrainings();
    if (list.length >= TRAINING_MAX)
      return res.status(400).json({ error: `Limit reached (${TRAINING_MAX} sessions).` });

    const entry = {
      id: uuidv4().slice(0, 8),
      ...trainingFromBody(req.body),
      created_at: new Date().toISOString(),
    };
    list.push(entry);
    writeTrainings(list);
    addAudit('training', entry.id, String(req.body.author || 'admin').slice(0, 80),
      'create', { title: entry.title, date: entry.date });
    res.status(201).json(entry);
  }).catch(e => res.status(500).json({ error: e.message }));
});

router.put('/api/trainings/:id', authLimiter, requireAdmin, (req, res) => {
  const err = validateTraining(req.body || {});
  if (err) return res.status(400).json({ error: err });

  withFileLock(FILES.trainings, () => {
    const list = readTrainings();
    const i = list.findIndex(t => t.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'Session not found.' });

    // created_at et id sont conservés : une modification ne réécrit pas
    // l'origine de la séance.
    list[i] = { ...list[i], ...trainingFromBody(req.body) };
    writeTrainings(list);
    addAudit('training', req.params.id, String(req.body.author || 'admin').slice(0, 80),
      'update', { title: list[i].title, date: list[i].date });
    res.json(list[i]);
  }).catch(e => res.status(500).json({ error: e.message }));
});

router.delete('/api/trainings/:id', requireAdmin, (req, res) => {
  withFileLock(FILES.trainings, () => {
    const list = readTrainings();
    const gone = list.find(t => t.id === req.params.id);
    if (!gone) return res.status(404).json({ error: 'Session not found.' });

    writeTrainings(list.filter(t => t.id !== req.params.id));
    addAudit('training', req.params.id, 'admin', 'delete',
      { title: gone.title, date: gone.date });
    res.json({ ok: true });
  }).catch(e => res.status(500).json({ error: e.message }));
});

module.exports = router;
