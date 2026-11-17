const express     = require('express');
const OBJ          = require('../services/objectives');
const { readCfg } = require('../core/store');
const { addAudit } = require('../core/audit');
const { requireAdmin } = require('../auth/guards');
const {
  commitObjectives, openSession, readObjectives, readSessions, sessionById,
} = require('../services/objectives-store');

const router = express.Router();

// ── Admin ─────────────────────────────────────────────────────

// Tout ce qui attend un arbitrage, tous agents confondus. C'est l'écran
// de travail de l'admin : il ne devrait pas avoir à ouvrir chaque agent
// pour découvrir ce qui l'attend.
router.get('/api/objectives', requireAdmin, (req, res) => {
  const all = readObjectives();
  const sessions = readSessions();
  const out = {};
  for (const [fo, list] of Object.entries(all)) {
    out[fo] = (list || []).map(o => OBJ.decorate(o, sessions.find(s => s.id === o.session)));
  }
  res.json({ objectives: out, sessions, smart_pass: OBJ.SMART_PASS });
});

// Contrôle SMART à blanc pour l'admin : la session guidée de One-to-One
// construit l'objectif avec l'agent et affiche la note en direct, avec le
// même barème que celui de l'agent. N'écrit rien. Chemin distinct de
// /api/objectives/:fo, qui l'aurait capturé.
router.post('/api/objective-smart-check', requireAdmin, (req, res) => {
  const b = req.body || {};
  res.json(OBJ.smartReport({
    title: b.title, why: b.why, due: b.due,
    kpis: Array.isArray(b.kpis) ? b.kpis.map(OBJ.normKpi) : [],
    steps: Array.isArray(b.steps) ? b.steps.map(OBJ.normStep) : [],
  }, openSession()));
});

// Arbitrage de l'objectif lui-même.
//   approve : la modification en attente est fondue dans l'objectif.
//   reject  : `pending` est jeté, la valeur en vigueur n'a pas bougé.
//             Le motif est obligatoire — un refus sans motif oblige
//             l'agent à deviner.
router.post('/api/objectives/:fo/:id/decide', requireAdmin, (req, res) => {
  const { fo, id } = req.params;
  const decision = String((req.body || {}).decision || '');
  const note = OBJ.clampStr((req.body || {}).note, 2000);
  const by   = OBJ.clampStr((req.body || {}).by, 120) || 'admin';
  if (!['approve', 'reject'].includes(decision))
    return res.status(400).json({ error: 'Unknown decision.' });
  if (decision === 'reject' && !note)
    return res.status(400).json({ error: 'A reason is required to reject.' });

  let out;
  commitObjectives(cfg => {
    const o = (cfg.fo_objectives[fo] || []).find(x => x.id === id);
    if (!o) throw new Error('Unknown objective.');

    if (decision === 'approve') {
      // Approuver l'objectif approuve ses jalons : tous doivent être datés.
      const sansDate = OBJ.stepsSansDate(o.steps);
      if (sansDate) throw new Error(sansDate + ' Ask the agent to add it, then approve.');
      if (o.pending) { Object.assign(o, o.pending); delete o.pending; }
      o.state = 'approved';
      o.approved_at = OBJ.nowISO();
      delete o.reject_reason;
      // Approuver l'objectif approuve ce qui a été déposé avec lui.
      (o.kpis  || []).forEach(k => { if (k.state !== 'approved') k.state = 'approved'; });
      (o.steps || []).forEach(s => { if (s.state !== 'approved') s.state = 'approved'; });
    } else {
      if (o.pending) {
        // Refus portant sur une modification : l'objectif reste approuvé,
        // seule la proposition tombe.
        delete o.pending;
      } else {
        o.state = 'rejected';
      }
      o.reject_reason = note;
    }
    o.history.push(OBJ.hist(decision, by, note));
    out = o;
  }).then(() => {
    addAudit('perf', id, by, `objective-${decision}`, { fo, note });
    res.json(OBJ.decorate(out, sessionById(out.session)));
  }).catch(e => res.status(400).json({ error: e.message }));
});

// Arbitrage d'un KPI ou d'un jalon pris isolément — y compris la coche
// de progression déposée par l'agent.
function subDecide(kind) {
  return (req, res) => {
    const { fo, id, sid } = req.params;
    const decision = String((req.body || {}).decision || '');
    const note = OBJ.clampStr((req.body || {}).note, 2000);
    const by   = OBJ.clampStr((req.body || {}).by, 120) || 'admin';
    if (!['approve', 'reject'].includes(decision))
      return res.status(400).json({ error: 'Unknown decision.' });
    if (decision === 'reject' && !note)
      return res.status(400).json({ error: 'A reason is required to reject.' });

    let out;
    commitObjectives(cfg => {
      const o = (cfg.fo_objectives[fo] || []).find(x => x.id === id);
      if (!o) throw new Error('Unknown objective.');
      const it = (o[kind] || []).find(x => x.id === sid);
      if (!it) throw new Error('Unknown entry.');

      if (decision === 'approve') {
        if (kind === 'steps' && !(it.pending && it.pending.due) && !it.due)
          throw new Error('This milestone has no deadline — it cannot be approved.');
        if (it.pending) { Object.assign(it, it.pending); delete it.pending; }
        it.state = 'approved';
        delete it.reject_reason;
        // Cocher un jalon passe par une demande, que l'admin approuve
        // ensuite : la date de réalisation doit être celle du geste de
        // l'agent, pas celle de l'approbation. Dater à l'approbation
        // ferait porter à l'agent le délai de traitement de sa demande.
        if (kind === 'steps') {
          if (it.done && !it.done_at) it.done_at = it.submitted_at || OBJ.nowISO();
          if (!it.done) delete it.done_at;
        }
      } else {
        if (it.pending) delete it.pending;          // la valeur en vigueur tient
        else if (it.state !== 'approved') it.state = 'rejected';
        it.reject_reason = note;
      }
      o.history.push(OBJ.hist(`${kind === 'kpis' ? 'kpi' : 'step'}-${decision}`, by, note));
      out = o;
    }).then(() => res.json(OBJ.decorate(out, sessionById(out.session))))
      .catch(e => res.status(400).json({ error: e.message }));
  };
}

router.post('/api/objectives/:fo/:id/kpis/:sid/decide',  requireAdmin, subDecide('kpis'));
router.post('/api/objectives/:fo/:id/steps/:sid/decide', requireAdmin, subDecide('steps'));

// Objectif posé directement par l'admin, pour un agent donné. Il naît
// approuvé : c'est l'admin qui l'écrit, le faire passer par sa propre
// validation n'aurait pas de sens. Sert aux objectifs décidés en
// entretien, sans attendre que l'agent les ressaisisse.
router.post('/api/objectives/:fo', requireAdmin, (req, res) => {
  const fo = String(req.params.fo || '').trim();
  const cfg = readCfg();
  if (!(cfg.fo_list || []).includes(fo))
    return res.status(404).json({ error: 'Unknown agent.' });

  const sess = openSession();
  if (!sess) return res.status(409).json({ error: 'No session is open.' });

  const b  = req.body || {};
  const by = OBJ.clampStr(b.by, 120) || 'admin';
  const o = {
    id: OBJ.uid('o'), session: sess.id,
    title: OBJ.clampStr(b.title, 400),
    why:   OBJ.clampStr(b.why, 1000),
    due:   OBJ.ISO_DATE.test(OBJ.clampStr(b.due, 10)) ? OBJ.clampStr(b.due, 10) : '',
    state: 'approved', progress: 'todo',
    approved_at: OBJ.nowISO(),
    set_by_manager: true,
    kpis:  (Array.isArray(b.kpis)  ? b.kpis  : []).slice(0, 8)
             .map(k => ({ ...OBJ.normKpi(k),  state: 'approved' })),
    steps: (Array.isArray(b.steps) ? b.steps : []).slice(0, 20)
             .map(s => ({ ...OBJ.normStep(s), state: 'approved', done: false })),
    created: OBJ.nowISO(),
    history: [OBJ.hist('create-manager', by, '')],
  };
  if (!o.title) return res.status(400).json({ error: 'A title is required.' });
  const sansDate = OBJ.stepsSansDate(o.steps);
  if (sansDate) return res.status(400).json({ error: sansDate });

  commitObjectives(cfg2 => {
    cfg2.fo_objectives[fo] = cfg2.fo_objectives[fo] || [];
    cfg2.fo_objectives[fo].push(o);
  }).then(() => {
    addAudit('perf', o.id, by, 'objective-create-manager', { fo, title: o.title });
    res.status(201).json(OBJ.decorate(o, sess));
  }).catch(e => res.status(500).json({ error: e.message }));
});

// Suppression d'un objectif — réservée à l'admin, quel que soit son état.
//
// L'agent, lui, ne peut effacer que ce qui n'a jamais été approuvé (voir
// DELETE /api/my-objectives/:id) : une fois l'objectif validé, il engage
// les deux parties et le faire disparaître unilatéralement effacerait la
// trace de ce qui avait été convenu.
//
// La suppression est définitive et emporte l'historique : on trace donc
// dans l'audit ce qui a été supprimé, par qui, avec son intitulé — c'est
// tout ce qu'il restera.
router.delete('/api/objectives/:fo/:id', requireAdmin, (req, res) => {
  const { fo, id } = req.params;
  const by = OBJ.clampStr(req.query.by, 120) || 'admin';
  let gone = null;

  commitObjectives(cfg => {
    const list = cfg.fo_objectives[fo] || [];
    const o = list.find(x => x.id === id);
    if (!o) return;
    gone = { title: o.title, state: o.state, progress: o.progress, session: o.session };
    cfg.fo_objectives[fo] = list.filter(x => x.id !== id);
    if (!cfg.fo_objectives[fo].length) delete cfg.fo_objectives[fo];
  }).then(() => {
    if (!gone) return res.status(404).json({ error: 'Unknown objective.' });
    addAudit('perf', id, by, 'objective-delete', { fo, ...gone });
    res.json({ ok: true });
  }).catch(e => res.status(500).json({ error: e.message }));
});

// Suppression d'un KPI ou d'un jalon approuvé. Même raison : l'agent ne
// peut pas retirer ce qui a été validé, l'admin oui.
function subDelAdmin(kind) {
  return (req, res) => {
    const { fo, id, sid } = req.params;
    const by = OBJ.clampStr(req.query.by, 120) || 'admin';
    let gone = null, out;
    commitObjectives(cfg => {
      const o = (cfg.fo_objectives[fo] || []).find(x => x.id === id);
      if (!o) throw new Error('Unknown objective.');
      const it = (o[kind] || []).find(x => x.id === sid);
      if (!it) throw new Error('Unknown entry.');
      gone = it.name || it.label || '';
      o[kind] = o[kind].filter(x => x.id !== sid);
      o.history.push(OBJ.hist(`${kind === 'kpis' ? 'kpi' : 'step'}-delete`, by, gone));
      out = o;
    }).then(() => {
      addAudit('perf', id, by, `objective-${kind === 'kpis' ? 'kpi' : 'step'}-delete`, { fo, label: gone });
      res.json(OBJ.decorate(out, sessionById(out.session)));
    }).catch(e => res.status(400).json({ error: e.message }));
  };
}

router.delete('/api/objectives/:fo/:id/kpis/:sid',  requireAdmin, subDelAdmin('kpis'));
router.delete('/api/objectives/:fo/:id/steps/:sid', requireAdmin, subDelAdmin('steps'));

// Avancement posé par l'admin (todo / doing / done / dropped). C'est le
// seul chemin pour abandonner un objectif approuvé.
// Correction de la date de réalisation d'un jalon fait (manager). C'est
// elle qui décide « tenu » ou « en retard » : un agent qui a coché après
// coup doit pouvoir être rétabli sans refaire tout le circuit.
router.put('/api/objectives/:fo/:id/steps/:sid/done-date', requireAdmin, (req, res) => {
  const { fo, id, sid } = req.params;
  const by = OBJ.clampStr((req.body || {}).by, 120) || 'admin';
  const iso = OBJ.doneDate((req.body || {}).date);
  if (!iso) return res.status(400).json({ error: 'Invalid date (not in the future, within the last year).' });
  let out;
  commitObjectives(cfg => {
    const o = (cfg.fo_objectives[fo] || []).find(x => x.id === id);
    if (!o) throw new Error('Unknown objective.');
    const s = (o.steps || []).find(x => x.id === sid);
    if (!s) throw new Error('Unknown milestone.');
    // Jalon fait mais jamais coché par l'agent : l'admin peut le marquer
    // fait à la date réelle (markDone). La demande en attente éventuelle
    // tombe, elle portait sur la même chose.
    if (!s.done && !(req.body || {}).markDone) throw new Error('This milestone is not done yet.');
    const avant = s.done ? (s.done_at ? String(s.done_at).slice(0, 10) : '—') : 'not done';
    if (!s.done) { s.done = true; delete s.pending; delete s.submitted_at; }
    s.done_at = iso;
    o.history = o.history || [];
    o.history.push(OBJ.hist('step-done-date', by, `${s.label} : ${avant} → ${iso.slice(0, 10)}`));
    out = o;
  }).then(() => res.json(OBJ.decorate(out, readSessions().find(x => x.id === out.session))))
    .catch(e => res.status(400).json({ error: e.message }));
});

// Date limite d'un jalon, posée par le manager. Tout jalon doit en avoir
// une : c'est ainsi qu'on rattrape ceux créés avant la règle, sans
// renvoyer l'objectif à l'agent.
router.put('/api/objectives/:fo/:id/steps/:sid/due', requireAdmin, (req, res) => {
  const { fo, id, sid } = req.params;
  const by = OBJ.clampStr((req.body || {}).by, 120) || 'admin';
  const due = OBJ.clampStr((req.body || {}).due, 10);
  if (!OBJ.ISO_DATE.test(due)) return res.status(400).json({ error: 'A milestone needs a valid deadline.' });
  let out;
  commitObjectives(cfg => {
    const o = (cfg.fo_objectives[fo] || []).find(x => x.id === id);
    if (!o) throw new Error('Unknown objective.');
    const s = (o.steps || []).find(x => x.id === sid);
    if (!s) throw new Error('Unknown milestone.');
    const avant = s.due || '—';
    s.due = due;
    if (s.pending) { delete s.pending.due; if (!Object.keys(s.pending).length) delete s.pending; }
    o.history = o.history || [];
    o.history.push(OBJ.hist('step-due', by, `${s.label} : ${avant} → ${due}`));
    out = o;
  }).then(() => res.json(OBJ.decorate(out, readSessions().find(x => x.id === out.session))))
    .catch(e => res.status(400).json({ error: e.message }));
});

router.put('/api/objectives/:fo/:id/progress', requireAdmin, (req, res) => {
  const { fo, id } = req.params;
  const p = String((req.body || {}).progress || '');
  if (!OBJ.OBJ_PROGRESS.includes(p)) return res.status(400).json({ error: 'Unknown status.' });
  const by = OBJ.clampStr((req.body || {}).by, 120) || 'admin';

  let out;
  commitObjectives(cfg => {
    const o = (cfg.fo_objectives[fo] || []).find(x => x.id === id);
    if (!o) throw new Error('Unknown objective.');
    o.progress = p;
    o.history.push(OBJ.hist('progress', by, p));
    out = o;
  }).then(() => res.json(OBJ.decorate(out, sessionById(out.session))))
    .catch(e => res.status(400).json({ error: e.message }));
});

module.exports = router;
