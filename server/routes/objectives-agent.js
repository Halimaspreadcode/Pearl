const express     = require('express');
const { agentDe } = require('../auth/identity');
const OBJ          = require('../services/objectives');
const { addAudit } = require('../core/audit');
const { foSessionOwner } = require('../auth/sessions');
const {
  commitObjectives, foObjectives, openSession, readSessions, sessionById,
} = require('../services/objectives-store');

const router = express.Router();

// ── Agent ─────────────────────────────────────────────────────

// Ses objectifs, plus la session en cours et le rappel du barème SMART.
router.get('/api/my-objectives', (req, res) => {
  const fo = agentDe(req);
  if (!fo) return res.status(401).json({ error: 'Session expired or missing.' });

  const sessions = readSessions();
  const open = sessions.find(s => s.state === 'open') || null;
  const mine = foObjectives(fo);

  res.json({
    fo,
    session: open,
    // Les sessions closes servent à relire les trimestres passés ; on
    // renvoie leur identité, pas seulement leur id, pour que le client
    // puisse les nommer sans deuxième appel.
    sessions: sessions.map(({ id, name, start, end, state }) => ({ id, name, start, end, state })),
    objectives: mine.map(o => OBJ.decorate(o, sessions.find(s => s.id === o.session))),
    smart_pass: OBJ.SMART_PASS,
  });
});

// Contrôle SMART à blanc : le client interroge cette route pendant la
// saisie pour montrer le score en direct. Elle n'écrit rien.
router.post('/api/my-objectives/smart-check', (req, res) => {
  const fo = agentDe(req);
  if (!fo) return res.status(401).json({ error: 'Session expired or missing.' });
  const b = req.body || {};
  res.json(OBJ.smartReport({
    title: b.title, why: b.why, due: b.due,
    kpis: Array.isArray(b.kpis) ? b.kpis.map(OBJ.normKpi) : [],
    steps: Array.isArray(b.steps) ? b.steps.map(OBJ.normStep) : [],
  }, openSession()));
});

// Création. L'objectif naît en `draft` et n'est visible que de l'agent
// tant qu'il ne l'a pas soumis.
router.post('/api/my-objectives', (req, res) => {
  const fo = agentDe(req);
  if (!fo) return res.status(401).json({ error: 'Session expired or missing.' });

  const sess = openSession();
  if (!sess) return res.status(409).json({ error: 'No objectives session is open at the moment.' });

  const b = req.body || {};
  const o = {
    id: OBJ.uid('o'),
    session: sess.id,
    title: OBJ.clampStr(b.title, 400),
    why:   OBJ.clampStr(b.why, 1000),
    due:   OBJ.ISO_DATE.test(OBJ.clampStr(b.due, 10)) ? OBJ.clampStr(b.due, 10) : '',
    state: 'draft',
    progress: 'todo',
    // KPIs et jalons créés avec l'objectif suivent son sort : ils sont
    // approuvés en même temps que lui, pas séparément.
    kpis:  (Array.isArray(b.kpis)  ? b.kpis  : []).slice(0, 8).map(k => ({ ...OBJ.normKpi(k),  state: 'draft' })),
    steps: (Array.isArray(b.steps) ? b.steps : []).slice(0, 20).map(s => ({ ...OBJ.normStep(s), state: 'draft', done: false })),
    created: OBJ.nowISO(),
    history: [OBJ.hist('create', fo, '')],
  };
  if (!o.title) return res.status(400).json({ error: 'A title is required.' });
  const sansDate = OBJ.stepsSansDate(o.steps);
  if (sansDate) return res.status(400).json({ error: sansDate });

  commitObjectives(cfg => {
    cfg.fo_objectives[fo] = cfg.fo_objectives[fo] || [];
    cfg.fo_objectives[fo].push(o);
  }).then(() => {
    addAudit('perf', o.id, fo, 'objective-create', { title: o.title });
    res.status(201).json(OBJ.decorate(o, sess));
  }).catch(e => res.status(500).json({ error: e.message }));
});

// Localise un objectif de l'agent, en refusant tout ce qui n'est pas à
// lui. Retourne aussi la session pour éviter de la relire partout.
function findOwn(fo, id) {
  const list = foObjectives(fo);
  const o = list.find(x => x.id === id);
  if (!o) return null;
  return { o, session: sessionById(o.session) };
}

// Modification par l'agent.
//
// Sur un brouillon (ou un objectif refusé qu'on corrige), on écrit
// directement : rien n'a encore été approuvé, il n'y a rien à protéger.
//
// Sur un objectif approuvé, on n'écrase pas : la modification part dans
// `pending` et l'objectif garde sa valeur en vigueur jusqu'à l'arbitrage.
// C'est ce que demande « une modification d'intitulé doit être approuvée ».
router.put('/api/my-objectives/:id', (req, res) => {
  const fo = agentDe(req);
  if (!fo) return res.status(401).json({ error: 'Session expired or missing.' });

  const found = findOwn(fo, req.params.id);
  if (!found) return res.status(404).json({ error: 'Unknown objective.' });
  if (found.session?.state !== 'open')
    return res.status(409).json({ error: 'This session is closed — it can no longer be modified.' });

  const b = req.body || {};
  const patch = {};
  if ('title' in b) patch.title = OBJ.clampStr(b.title, 400);
  if ('why'   in b) patch.why   = OBJ.clampStr(b.why, 1000);
  if ('due'   in b) patch.due   = OBJ.ISO_DATE.test(OBJ.clampStr(b.due, 10)) ? OBJ.clampStr(b.due, 10) : '';
  if (patch.title === '') return res.status(400).json({ error: 'The title cannot be empty.' });

  let out;
  commitObjectives(cfg => {
    const o = cfg.fo_objectives[fo].find(x => x.id === req.params.id);
    if (o.state === 'approved') {
      // On ne dépose que ce qui diffère vraiment : une modification qui
      // ne change rien n'a pas à mobiliser l'admin.
      const diff = Object.fromEntries(Object.entries(patch).filter(([k, v]) => o[k] !== v));
      if (Object.keys(diff).length) {
        o.pending = { ...(o.pending || {}), ...diff };
        o.history.push(OBJ.hist('edit-submitted', fo, Object.keys(diff).join(', ')));
      }
    } else {
      Object.assign(o, patch);
      if (o.state === 'rejected') o.state = 'draft';   // corrigé, donc à resoumettre
      o.history.push(OBJ.hist('edit', fo, ''));
    }
    out = o;
  }).then(() => res.json(OBJ.decorate(out, found.session)))
    .catch(e => res.status(500).json({ error: e.message }));
});

// Soumission à l'admin. Le contrôle SMART est joint mais ne bloque pas :
// il est indicatif, l'arbitrage reste humain.
router.post('/api/my-objectives/:id/submit', (req, res) => {
  const fo = agentDe(req);
  if (!fo) return res.status(401).json({ error: 'Session expired or missing.' });

  const found = findOwn(fo, req.params.id);
  if (!found) return res.status(404).json({ error: 'Unknown objective.' });
  if (found.session?.state !== 'open')
    return res.status(409).json({ error: 'This session is closed.' });
  if (!['draft', 'rejected'].includes(found.o.state))
    return res.status(409).json({ error: 'This objective has already been submitted.' });
  const sansDate = OBJ.stepsSansDate(found.o.steps);
  if (sansDate) return res.status(400).json({ error: sansDate });

  let out;
  commitObjectives(cfg => {
    const o = cfg.fo_objectives[fo].find(x => x.id === req.params.id);
    o.state = 'submitted';
    o.submitted_at = OBJ.nowISO();
    (o.kpis  || []).forEach(k => { if (k.state === 'draft') k.state = 'submitted'; });
    (o.steps || []).forEach(s => { if (s.state === 'draft') s.state = 'submitted'; });
    const r = OBJ.smartReport(o, found.session);
    o.smart_at_submit = { score: r.score, pass: r.pass };
    o.history.push(OBJ.hist('submit', fo, `SMART ${r.score}/100`));
    out = o;
  }).then(() => {
    addAudit('perf', req.params.id, fo, 'objective-submit', {});
    res.json(OBJ.decorate(out, found.session));
  }).catch(e => res.status(500).json({ error: e.message }));
});

// Suppression : seulement ce qui n'a jamais été approuvé. Un objectif
// approuvé s'abandonne (`dropped`) devant l'admin, il ne s'efface pas.
router.delete('/api/my-objectives/:id', (req, res) => {
  const fo = agentDe(req);
  if (!fo) return res.status(401).json({ error: 'Session expired or missing.' });

  const found = findOwn(fo, req.params.id);
  if (!found) return res.status(404).json({ error: 'Unknown objective.' });
  if (found.o.state === 'approved')
    return res.status(409).json({ error: 'An approved objective cannot be deleted — ask your manager to drop it.' });

  commitObjectives(cfg => {
    cfg.fo_objectives[fo] = cfg.fo_objectives[fo].filter(x => x.id !== req.params.id);
  }).then(() => res.json({ ok: true }))
    .catch(e => res.status(500).json({ error: e.message }));
});

// ── KPIs et jalons, côté agent ────────────────────────────────
// Même règle pour les deux : ajouté à un objectif déjà approuvé, un
// élément naît `submitted` et n'est pris en compte qu'une fois validé.

function subAdd(kind) {
  return (req, res) => {
    const fo = agentDe(req);
    if (!fo) return res.status(401).json({ error: 'Session expired or missing.' });
    const found = findOwn(fo, req.params.id);
    if (!found) return res.status(404).json({ error: 'Unknown objective.' });
    if (found.session?.state !== 'open')
      return res.status(409).json({ error: 'This session is closed.' });

    let out;
    commitObjectives(cfg => {
      const o = cfg.fo_objectives[fo].find(x => x.id === req.params.id);
      o[kind] = o[kind] || [];
      if (o[kind].length >= (kind === 'kpis' ? 8 : 20)) throw new Error('Too many entries on this objective.');
      const item = kind === 'kpis' ? OBJ.normKpi(req.body) : OBJ.normStep(req.body);
      if (kind === 'steps' && !item.due) throw new Error('A milestone needs a deadline.');
      // Sur un objectif encore en brouillon, l'élément suit l'objectif ;
      // sur un objectif approuvé, il part seul en approbation.
      item.state = o.state === 'approved' ? 'submitted' : 'draft';
      if (kind === 'steps') item.done = false;
      o[kind].push(item);
      o.history.push(OBJ.hist(kind === 'kpis' ? 'kpi-add' : 'step-add', fo, item.name || item.label));
      out = o;
    }).then(() => res.json(OBJ.decorate(out, found.session)))
      .catch(e => res.status(400).json({ error: e.message }));
  };
}

router.post('/api/my-objectives/:id/kpis',  subAdd('kpis'));
router.post('/api/my-objectives/:id/steps', subAdd('steps'));

// Cocher un jalon. C'est ce geste qui fait bouger la barre de
// progression, donc il passe lui aussi par l'admin : on n'écrit pas
// `done` directement, on dépose une demande.
router.post('/api/my-objectives/:id/steps/:sid/check', (req, res) => {
  const fo = agentDe(req);
  if (!fo) return res.status(401).json({ error: 'Session expired or missing.' });
  const found = findOwn(fo, req.params.id);
  if (!found) return res.status(404).json({ error: 'Unknown objective.' });
  if (found.session?.state !== 'open')
    return res.status(409).json({ error: 'This session is closed.' });

  const want = !!(req.body || {}).done;
  // Date donnée par l'agent (« fait le… ») ; à défaut, maintenant.
  const quand = (req.body || {}).done_at;
  const faitLe = quand ? OBJ.doneDate(quand) : OBJ.nowISO();
  if (want && quand && !faitLe)
    return res.status(400).json({ error: 'Invalid completion date (not in the future, within the last year).' });
  let out;
  commitObjectives(cfg => {
    const o = cfg.fo_objectives[fo].find(x => x.id === req.params.id);
    const s = (o.steps || []).find(x => x.id === req.params.sid);
    if (!s) throw new Error('Unknown milestone.');
    if (s.state !== 'approved') {
      // Pas encore approuvé : il n'est pas encore un jalon officiel, la
      // case suit donc le brouillon sans procédure supplémentaire.
      s.done = want;
      // Date de réalisation : c'est elle qui permet de distinguer plus
      // tard un jalon tenu d'un jalon rendu après son échéance. Sans
      // elle, un retard de trois semaines se lit comme un jalon à l'heure.
      if (want) s.done_at = faitLe; else delete s.done_at;
    } else if (s.done !== want) {
      s.pending = want ? { done: true, done_at: faitLe } : { done: false };
      // Horodatage de la demande : c'est cette date qui fera foi comme
      // date de réalisation une fois le jalon approuvé.
      s.submitted_at = OBJ.nowISO();
      o.history.push(OBJ.hist('step-check-submitted', fo, `${s.label} → ${want ? 'done' : 'not done'}`));
    }
    out = o;
  }).then(() => res.json(OBJ.decorate(out, found.session)))
    .catch(e => res.status(400).json({ error: e.message }));
});

// Modification d'un KPI ou d'un jalon déjà approuvé : même dépôt en
// `pending` que pour l'intitulé de l'objectif.
function subEdit(kind) {
  return (req, res) => {
    const fo = agentDe(req);
    if (!fo) return res.status(401).json({ error: 'Session expired or missing.' });
    const found = findOwn(fo, req.params.id);
    if (!found) return res.status(404).json({ error: 'Unknown objective.' });
    if (found.session?.state !== 'open')
      return res.status(409).json({ error: 'This session is closed.' });

    let out;
    commitObjectives(cfg => {
      const o = cfg.fo_objectives[fo].find(x => x.id === req.params.id);
      const it = (o[kind] || []).find(x => x.id === req.params.sid);
      if (!it) throw new Error('Unknown entry.');
      const patch = kind === 'kpis' ? OBJ.normKpi({ ...req.body, id: it.id })
                                    : OBJ.normStep({ ...req.body, id: it.id });
      delete patch.id;
      // Jalon : la date limite ne peut pas être retirée. Absente de la
      // demande, on garde celle en place ; absente des deux, refus.
      if (kind === 'steps') {
        if (!patch.due) { if ('due' in (req.body || {}) || !it.due) throw new Error('A milestone needs a deadline.'); patch.due = it.due; }
      }
      if (it.state === 'approved') {
        const diff = Object.fromEntries(Object.entries(patch).filter(([k, v]) => it[k] !== v));
        if (Object.keys(diff).length) {
          it.pending = { ...(it.pending || {}), ...diff };
          o.history.push(OBJ.hist(`${kind === 'kpis' ? 'kpi' : 'step'}-edit-submitted`, fo, Object.keys(diff).join(', ')));
        }
      } else {
        Object.assign(it, patch);
      }
      out = o;
    }).then(() => res.json(OBJ.decorate(out, found.session)))
      .catch(e => res.status(400).json({ error: e.message }));
  };
}

router.put('/api/my-objectives/:id/kpis/:sid',  subEdit('kpis'));
router.put('/api/my-objectives/:id/steps/:sid', subEdit('steps'));

function subDel(kind) {
  return (req, res) => {
    const fo = agentDe(req);
    if (!fo) return res.status(401).json({ error: 'Session expired or missing.' });
    const found = findOwn(fo, req.params.id);
    if (!found) return res.status(404).json({ error: 'Unknown objective.' });
    let out;
    commitObjectives(cfg => {
      const o = cfg.fo_objectives[fo].find(x => x.id === req.params.id);
      const it = (o[kind] || []).find(x => x.id === req.params.sid);
      if (!it) throw new Error('Unknown entry.');
      if (it.state === 'approved') throw new Error('An approved entry cannot be deleted — ask your manager.');
      o[kind] = o[kind].filter(x => x.id !== req.params.sid);
      out = o;
    }).then(() => res.json(OBJ.decorate(out, found.session)))
      .catch(e => res.status(400).json({ error: e.message }));
  };
}

router.delete('/api/my-objectives/:id/kpis/:sid',  subDel('kpis'));
router.delete('/api/my-objectives/:id/steps/:sid', subDel('steps'));

module.exports = router;
