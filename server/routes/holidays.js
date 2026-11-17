const express     = require('express');
const { v4: uuidv4 } = require('uuid');
const { FILES } = require('../config/paths');
const { readHolidays, withFileLock, writeJSON, siteCodes } = require('../core/store');

const router = express.Router();

// ── HOLIDAYS ──────────────────────────────────────────────────

router.get('/api/holidays', (_req, res) => res.json(readHolidays()));

/* Les fériés sont tous modifiables. Le drapeau `editable: false` posé au
   seed verrouillait 27 des 36 entrées : les fêtes à date fixe (Noël,
   Assomption, Toussaint…) étaient réputées immuables.

   C'est faux en pratique. Un férié se déplace par décret, un pont
   s'ajoute, une date à calcul lunaire est corrigée, et un jour chômé
   n'est pas le même d'un site à l'autre. Ces dates pilotent le décompte
   des jours ouvrés (absences, SLA en mode business) : ne pas pouvoir les
   corriger fausse tout ce qui en dépend.

   Le drapeau est conservé en lecture pour ne pas casser les entrées
   existantes, mais il ne bloque plus rien. */
function normalizeHoliday(body = {}) {
  const out = {};
  if (body.date != null) out.date = String(body.date).trim();
  if (body.name != null) out.name = String(body.name).trim().slice(0, 80);
  if (body.country != null) {
    const c = String(body.country).trim().toUpperCase();
    // '' / 'ALL' = férié commun à tous les sites.
    out.country = siteCodes().includes(c) ? c : '';
  }
  return out;
}

// Une date au format ISO court : c'est la clé de comparaison utilisée par
// holidaySetFor(), un autre format sortirait silencieusement du décompte.
const isISODate = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));

router.post('/api/holidays', (req, res) => {
  withFileLock(FILES.holidays, () => {
    const patch = normalizeHoliday(req.body);
    if (!isISODate(patch.date))
      return res.status(400).json({ error: 'Date required in YYYY-MM-DD format' });
    if (!patch.name) return res.status(400).json({ error: 'Name required' });

    const list = readHolidays();
    // Doublon sur la même date et le même périmètre : le jour serait
    // compté une fois mais affiché deux, ce qui se lit comme un bug.
    const clash = list.find(h => h.date === patch.date
      && String(h.country || '') === String(patch.country || ''));
    if (clash)
      return res.status(409).json({ error: `A holiday already exists on this date: ${clash.name}` });

    const entry = { id: uuidv4().slice(0,8), country: '', ...patch, editable: true };
    list.push(entry);
    writeJSON(FILES.holidays, list);
    res.status(201).json(entry);
  }).catch(err => res.status(500).json({ error: err.message }));
});

router.put('/api/holidays/:id', (req, res) => {
  withFileLock(FILES.holidays, () => {
    const list = readHolidays();
    const idx = list.findIndex(h => h.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });

    const patch = normalizeHoliday(req.body);
    if (patch.date != null && !isISODate(patch.date))
      return res.status(400).json({ error: 'Invalid date (expected YYYY-MM-DD)' });
    if (patch.name != null && !patch.name)
      return res.status(400).json({ error: 'The name cannot be empty' });

    const next = { ...list[idx], ...patch };
    const clash = list.find((h, i) => i !== idx && h.date === next.date
      && String(h.country || '') === String(next.country || ''));
    if (clash)
      return res.status(409).json({ error: `A holiday already exists on this date: ${clash.name}` });

    list[idx] = next;
    writeJSON(FILES.holidays, list);
    res.json(list[idx]);
  }).catch(err => res.status(500).json({ error: err.message }));
});

router.delete('/api/holidays/:id', (req, res) => {
  withFileLock(FILES.holidays, () => {
    const list = readHolidays();
    if (!list.some(h => h.id === req.params.id))
      return res.status(404).json({ error: 'Not found' });
    writeJSON(FILES.holidays, list.filter(h => h.id !== req.params.id));
    res.json({ ok: true });
  }).catch(err => res.status(500).json({ error: err.message }));
});

module.exports = router;
