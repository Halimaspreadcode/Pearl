const express     = require('express');
const bcrypt      = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { FILES } = require('../config/paths');
const {
  readCfg, readJSON, readShiftsPlan, withFileLock, writeJSON, writeShiftsPlan,
} = require('../core/store');
const { cleanBody } = require('../core/sanitize');
const { readAbsences, validateAbsence } = require('../services/absences');
const { authLimiter } = require('../http/security');

const router = express.Router();

// ── SHIFT REQUESTS ────────────────────────────────────────────
// Type d'absence déduit de la demande : « Sick leave » choisi comme
// raison donne un arrêt maladie, une demande On-Site un déplacement ;
// le reste est un congé payé, qui entame le solde.
function typeAbsence(r) {
  if (r.type === 'onsite') return 'On-Site (Delivery)';
  if (/sick|malad/i.test(r.note || '')) return 'Maladie';
  return 'Congés payés';
}
function absenceDepuisDemande(r) {
  if (!r || !['absence', 'onsite'].includes(r.type) || !r.fo_name || !r.date) return;
  withFileLock(FILES.absences, () => {
    const list = readAbsences();
    if (list.some(a => a.request_id === r.id)) return;          // déjà créée
    const a = {
      id: uuidv4().slice(0, 8),
      fo_name: r.fo_name,
      type: typeAbsence(r),
      status: 'Validée',
      date_from: r.date,
      date_to: r.date_to || r.date,
      notice: "Prévenu à l'avance",
      comment: r.note || '',
      request_id: r.id,
      created_at: r.created_at || new Date().toISOString(),
      created_by: r.approved_by || 'request',
    };
    if (validateAbsence(a)) return;
    list.push(a);
    writeJSON(FILES.absences, list);
  }).catch(() => {});
}
function readShiftRequests() { return readJSON(FILES.shift_requests, []); }

router.get('/api/shift-requests', (_req, res) => res.json(readShiftRequests()));

router.post('/api/shift-requests', (req, res) => {
  withFileLock(FILES.shift_requests, () => {
    const list = readShiftRequests();
    const entry = {
      id: uuidv4().slice(0, 8),
      status: 'pending',
      created_at: new Date().toISOString(),
      ...cleanBody(req.body),
    };
    list.push(entry);
    writeJSON(FILES.shift_requests, list);
    res.status(201).json(entry);
  }).catch(err => res.status(500).json({ error: err.message }));
});

router.put('/api/shift-requests/:id', authLimiter, (req, res) => {
  if (['approved', 'rejected'].includes(req.body.status)) {
    const cfg = readCfg();
    const hash = cfg.approval_password_hash;
    if (!hash || !req.body.password || !bcrypt.compareSync(req.body.password, hash)) {
      return res.status(403).json({ error: 'Invalid password' });
    }
  }
  withFileLock(FILES.shift_requests, () => {
    const list = readShiftRequests();
    const idx = list.findIndex(r => r.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const { password: _pw, ...body } = req.body;
    list[idx] = { ...list[idx], ...body, updated_at: new Date().toISOString() };
    // If approved, apply the shift change
    if (req.body.status === 'approved' && list[idx].shift_entry_id) {
      const req_ = list[idx];
      withFileLock(FILES.shifts_plan, () => {
        const plan = readShiftsPlan();
        const si = plan.findIndex(s => s.id === req_.shift_entry_id);
        if (si === -1) return;
        const now = new Date().toISOString();
        const approver = req_.approved_by || 'supervisor';

        if (req_.type === 'swap' && req_.swap_with) {
          const oi = plan.findIndex(s => s.fo_name === req_.swap_with && s.date === req_.date);
          if (oi !== -1) {
            const a = plan[si], b = plan[oi];
            const tmp = { shift_id: a.shift_id, shift_name: a.shift_name, shift_type: a.shift_type, is_rest: a.is_rest, status: a.status };
            a.shift_id = b.shift_id; a.shift_name = b.shift_name; a.shift_type = b.shift_type; a.is_rest = b.is_rest; a.status = b.status;
            b.shift_id = tmp.shift_id; b.shift_name = tmp.shift_name; b.shift_type = tmp.shift_type; b.is_rest = tmp.is_rest; b.status = tmp.status;
            a.modified_by = b.modified_by = approver;
            a.modified_at = b.modified_at = now;
            writeShiftsPlan(plan);
          }
        } else if (req_.new_shift_id) {
          plan[si].shift_id   = req_.new_shift_id;
          plan[si].shift_name = req_.new_shift_name || req_.new_shift_id;
          plan[si].shift_type = req_.new_shift_type || req_.new_shift_id;
          plan[si].is_rest    = req_.new_shift_id === 'rest';
          plan[si].modified_by = approver;
          plan[si].modified_at = now;
          writeShiftsPlan(plan);
        }
      });
    }
    // Une demande d'absence (ou de déplacement chez le client) approuvée
    // devient une absence validée : sans cela, elle ne modifiait que le
    // planning, et le solde de congés ne bougeait jamais.
    if (req.body.status === 'approved') absenceDepuisDemande(list[idx]);
    writeJSON(FILES.shift_requests, list);
    res.json(list[idx]);
  }).catch(err => res.status(500).json({ error: err.message }));
});

router.delete('/api/shift-requests/:id', (req, res) => {
  withFileLock(FILES.shift_requests, () => {
    writeJSON(FILES.shift_requests, readShiftRequests().filter(r => r.id !== req.params.id));
    res.json({ ok: true });
  }).catch(err => res.status(500).json({ error: err.message }));
});

module.exports = router;
module.exports.absenceDepuisDemande = absenceDepuisDemande;
