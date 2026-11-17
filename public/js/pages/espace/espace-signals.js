/* ══════════════════════════════════════════════════════════════
   MY SPACE — ce que l'agent doit faire maintenant

   Calcul pur, sans rendu : mesTodayItems() rend la liste « Today », et
   mesGlance() les quatre repères du dessous (mois, shift, objectifs,
   semaine). Tout vient de données déjà chargées :
     · state (weekly progress, demandes, quiz, rota) — servi à tous ;
     · les rappels de la cloche (NF.build) — pour savoir QUELS rappels
       s'appliquent : règles coupées par l'admin, rappels reportés par
       l'agent, fenêtre du shift. On ne refait pas ces décisions ici ;
     · la note et les objectifs, seulement si l'agent a ouvert sa
       session par son code (ctx.perf, ctx.obj) — sinon rien n'est
       déduit, et l'accueil le dit au lieu de compter zéro.

   Une ligne = un geste. `go` dit où mène le bouton : un onglet de
   My Space ({ tab, … }) ou une autre page ({ page }).
   ══════════════════════════════════════════════════════════════ */

// Tri : un vrai retard d'abord, puis ce qui est dû, puis le reste.
const MES_LVL_RANK = { late: 0, due: 1, info: 2 };

// Décisions déjà vues par l'agent : { [id demande]: statut vu }. Confort
// d'affichage propre au navigateur, comme l'accusé de lecture des
// annonces — pas une preuve de lecture.
const MES_SEEN_KEY = 'mes-seen-decisions';

function _mesToday() { return new Date().toISOString().slice(0, 10); }

function _mesPlural(n, one, many) { return `${n} ${n > 1 ? (many || one + 's') : one}`; }

function _mesDay(iso) {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (isNaN(d)) return String(iso);
  const diff = Math.round((d - new Date(`${_mesToday()}T00:00:00`)) / 864e5);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function _mesSeen() {
  try { return JSON.parse(localStorage.getItem(MES_SEEN_KEY) || '{}') || {}; } catch (_) { return {}; }
}

// Les réponses reçues, marquées vues quand l'agent ouvre ses demandes.
function mesMarkDecisionsSeen(me) {
  const seen = _mesSeen();
  _mesDecided(me).forEach(r => { seen[r.id] = r.status; });
  // On ne garde que les demandes encore présentes : la clé ne grossit pas.
  const ids = new Set((state.shiftRequests || []).map(r => r.id));
  Object.keys(seen).forEach(k => { if (!ids.has(k)) delete seen[k]; });
  try { localStorage.setItem(MES_SEEN_KEY, JSON.stringify(seen)); } catch (_) {}
}

// Demandes de l'agent tranchées depuis moins de 14 jours.
function _mesDecided(me) {
  const lim = new Date(Date.now() - 14 * 864e5).toISOString();
  return (state.shiftRequests || []).filter(r =>
    (r.fo_name === me || r.requested_by === me)
    && (r.status === 'approved' || r.status === 'rejected')
    && String(r.updated_at || '') >= lim);
}

function _mesMyProgress(me) {
  return (state.weeklyProgress || []).filter(p => p.modified_by === me);
}

// Tracker de l'agent, et la page où saisir ses tickets.
function _mesTracker(me) { return ((state.config?.fo_trackers || {})[me] || 'SN').toUpperCase(); }

// ── Shift ─────────────────────────────────────────────────────
// Prochain créneau travaillé : celui en cours s'il y en a un, sinon le
// suivant. Les horaires viennent de rota_config, comme pour la cloche.
function mesNextShift(me) {
  if (!me) return null;
  const today = _mesToday();
  const toMin = hhmm => { const [h, m] = String(hhmm || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const rows = (state.shiftsPlan || [])
    .filter(s => s.fo_name === me && !s.is_rest && s.shift_id !== 'rest' && s.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const row of rows) {
    const site = (state.rotaConfig?.sites || []).find(s => s.id === row.site_id);
    const sh = (site?.shifts || []).find(s => s.id === row.shift_id) || null;
    const start = sh?.start || '', end = sh?.end || '';
    if (row.date === today && sh?.start && sh?.end) {
      const a = toMin(start), b = toMin(end);
      const nuit = a > b;
      const actif = nuit ? (cur >= a || cur < b) : (cur >= a && cur < b);
      // Déjà terminé aujourd'hui : on passe au suivant.
      if (!actif && !nuit && cur >= b) continue;
      return { row, start, end, now: actif, date: row.date, name: row.shift_name || row.shift_id || '' };
    }
    return { row, start, end, now: false, date: row.date, name: row.shift_name || row.shift_id || '' };
  }
  return null;
}

// ── À faire ───────────────────────────────────────────────────
// ctx : { me, perf, obj } — perf et obj sont null tant que l'agent n'a
// pas saisi son code (ou si la lecture a échoué).
function mesTodayItems(ctx) {
  const me = ctx.me;
  if (!me) return [];
  const items = [];
  const today = _mesToday();

  // Rappels actifs de la cloche : règles de l'admin, reports, shift.
  const actifs = new Set((window.NF && NF.isFO() ? NF.build() : []).map(i => i.id));
  const wk = (typeof _wpCurWeek === 'function') ? _wpCurWeek() : NF._weekStart();
  const mine = _mesMyProgress(me);
  const semaine = mine.filter(p => p.week_start === wk);
  const tracker = _mesTracker(me);
  const trPage = tracker === 'CI' ? 'ci' : 'sn';

  // 1 ── Tâches données par le manager (Équipe › Tâches) : elles vivent
  // dans My Tasks (admin_task) avec une échéance ferme. Dues ou en retard,
  // elles passent avant le reste, et ne sont pas recomptées plus bas
  // parmi les tâches des semaines passées.
  const asg = mine.filter(p => p.admin_task && p.status !== 'Done');
  const asgLate = asg.filter(p => p.due_date ? p.due_date < today : p.week_start < wk);
  const asgToday = asg.filter(p => p.due_date === today);
  const asgNext = asg.filter(p => !asgLate.includes(p) && !asgToday.includes(p));
  const firstOf = l => `“${l[0].task}”${l.length > 1 ? ` and ${l.length - 1} more` : ''}`;
  const oldestOf = l => l.reduce((a, b) => (!a || b.week_start < a.week_start ? b : a), null);
  if (asgLate.length) items.push({
    id: 'as-late', lvl: 'late', icon: 'assign', n: asgLate.length,
    t: asgLate.length === 1 ? 'A task from your manager is past due' : `${asgLate.length} tasks from your manager are past due`,
    d: firstOf(asgLate) + '. Move it to Done once finished.',
    cta: 'Open', go: { tab: 'tasks', week: oldestOf(asgLate).week_start, filtre: '' },
  });
  if (asgToday.length) items.push({
    id: 'as-today', lvl: 'due', icon: 'assign',
    t: asgToday.length === 1 ? 'A task from your manager is due today' : `${asgToday.length} tasks from your manager are due today`,
    d: firstOf(asgToday) + '.',
    cta: 'Open', go: { tab: 'tasks', week: oldestOf(asgToday).week_start, filtre: '' },
  });
  if (asgNext.length) {
    const soon = asgNext.filter(p => p.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
    items.push({
      id: 'as-open', lvl: 'info', icon: 'assign',
      t: asgNext.length === 1 ? 'Your manager gave you a task' : `Your manager gave you ${asgNext.length} tasks`,
      d: firstOf(asgNext) + (soon ? ` — ${asgNext.length > 1 ? 'next one ' : ''}due ${_mesDay(soon.due_date)}.` : '.'),
      cta: 'Open', go: { tab: 'tasks', week: oldestOf(asgNext).week_start, filtre: '' },
    });
  }

  // 2 ── Tâches de la semaine (My Tasks), hors tâches du manager en retard
  if (actifs.has('wp-late')) {
    const carry = mine.filter(p => p.status !== 'Done' && p.week_start < wk && !asgLate.includes(p));
    const oldest = oldestOf(carry);
    if (carry.length) items.push({
      id: 'wp-late', lvl: 'late', icon: 'task', n: carry.length,
      t: `Finish or move ${_mesPlural(carry.length, 'overdue task')}`,
      d: `From past weeks — the oldest is from the week of ${_mesDay(oldest.week_start)}.`,
      cta: 'Review', go: { tab: 'tasks', week: oldest.week_start, filtre: 'late' },
    });
  }
  if (actifs.has('wp-empty')) items.push({
    id: 'wp-empty', lvl: 'due', icon: 'task',
    t: 'Plan your week',
    d: 'Nothing in your tasks yet this week. Add what you plan to deliver.',
    cta: 'Add a task', go: { tab: 'tasks', add: true, week: today, filtre: '' },
  });
  if (actifs.has('wp-open')) {
    // Les tâches du manager ont leurs lignes au-dessus : pas deux fois.
    const miennes = semaine.filter(p => !p.admin_task);
    const open = miennes.filter(p => p.status !== 'Done');
    if (open.length) items.push({
      id: 'wp-open', lvl: 'info', icon: 'task',
      t: `Update ${_mesPlural(open.length, 'open task')}`,
      d: `${miennes.length - open.length} of ${miennes.length} done this week. Tick them as you go.`,
      cta: 'Update', go: { tab: 'tasks', week: today, filtre: '' },
    });
  }

  // 3 ── Tickets, pendant le shift
  const pool = tracker === 'CI' ? (state.ci || []) : (state.sn || []);
  const miens = t => t.fo_owner === me || t.assigned_to === me;
  if (actifs.has('tk-shift')) {
    const sh = NF._todayShift();
    const n = pool.filter(t => miens(t) && String(t.created_at || '').slice(0, 10) === today).length;
    items.push({
      id: 'tk-shift', lvl: 'due', icon: 'ticket',
      t: n ? 'Keep your tickets up to date' : 'Log your tickets',
      d: (n ? `${_mesPlural(n, 'ticket')} logged today.` : 'No ticket logged today yet.')
        + (sh?.shift?.end ? ` You are on shift until ${sh.shift.end}.` : ''),
      cta: `Open Tracker ${tracker}`, go: { page: trPage },
    });
  }
  if (actifs.has('tk-open')) {
    const n = pool.filter(t => miens(t) && ['Open', 'In Progress'].includes(t.status)).length;
    if (n) items.push({
      id: 'tk-open', lvl: 'info', icon: 'ticket',
      t: `${_mesPlural(n, 'ticket')} still open`,
      d: 'Resolve them, or write the current action so the follow-up stays right.',
      cta: 'See tickets', go: { page: trPage },
    });
  }
  if (actifs.has('ho-end')) {
    const sh = NF._todayShift();
    items.push({
      id: 'ho-end', lvl: 'due', icon: 'handover',
      t: 'Prepare your handover',
      d: sh ? `Your shift ends in ${Math.max(1, sh.end - sh.cur)} min.` : 'Your shift ends soon.',
      cta: 'Open handover', go: { page: 'fo-handover' },
    });
  }

  // 4 ── Tâches assignées (Daily Check-up)
  const tasks = (state.foTasks || []).filter(t =>
    t.assigned_to === me && !(!t.is_occurrence && t.status === 'Recurring') && t.status !== 'Done');
  const tkLate = tasks.filter(t => t.due_date && t.due_date < today).length;
  const tkToday = tasks.filter(t => t.due_date === today).length;
  const tkBlocked = tasks.filter(t => t.status === 'Blocked').length;
  if (actifs.has('tk-late') && tkLate) items.push({
    id: 'tk-late', lvl: 'late', icon: 'check',
    t: `${_mesPlural(tkLate, 'assigned task')} past due`, d: 'Tick them once done, or tell your manager what blocks you.',
    cta: 'Open', go: { page: 'fo-tasks' },
  });
  if (actifs.has('tk-today') && tkToday) items.push({
    id: 'tk-today', lvl: 'due', icon: 'check',
    t: `${_mesPlural(tkToday, 'assigned task')} due today`, d: 'Tick them once done.',
    cta: 'Open', go: { page: 'fo-tasks' },
  });
  if (actifs.has('tk-blocked') && tkBlocked) items.push({
    id: 'tk-blocked', lvl: 'due', icon: 'check',
    t: `${_mesPlural(tkBlocked, 'task')} blocked`, d: 'A blocker nobody hears about stays blocked. Raise it with your manager.',
    cta: 'Open', go: { page: 'fo-tasks' },
  });

  // 5 ── Quiz de la semaine
  if (actifs.has('qz-week')) {
    const res = (state.quizResults || []).filter(r => r.user === me).map(r => r.created_at).sort();
    const last = res.pop();
    const days = last ? Math.floor((Date.now() - Date.parse(last)) / 864e5) : null;
    items.push({
      id: 'qz-week', lvl: days === null || days > 14 ? 'late' : 'due', icon: 'quiz',
      t: 'Take this week\'s quiz',
      d: `About 5 minutes, it is not an assessment.${last ? ` Your last one was ${_mesPlural(days, 'day')} ago.` : ''}`,
      cta: 'Start', go: { tab: 'quiz' },
    });
  }

  // 6 ── Réponses à mes demandes, pas encore vues
  const seen = _mesSeen();
  _mesDecided(me).filter(r => seen[r.id] !== r.status).forEach(r => {
    const ok = r.status === 'approved';
    // Libellés du formulaire de demande (anglais, comme la page).
    const type = (typeof MRQ_TYPES !== 'undefined' && MRQ_TYPES.find(x => x.v === r.type)?.label) || 'shift';
    items.push({
      id: 'rq-' + r.id, lvl: ok ? 'info' : 'due', icon: ok ? 'ok' : 'request',
      t: `Your ${String(type).toLowerCase()} request for ${_mesDay(r.date)} was ${ok ? 'approved' : 'declined'}`,
      d: ok ? 'The rota has been updated.' : (r.rejection_reason ? `Reason: ${r.rejection_reason}` : 'Open it to see the reason.'),
      cta: 'See', go: { tab: 'requests' },
    });
  });

  // 7 ── One-to-One et objectifs (session ouverte par le code)
  const perf = ctx.perf;
  if (perf) {
    const acts = (perf.actions || []).filter(a => a.late && a.status !== 'done' && a.status !== 'drop');
    if (acts.length) items.push({
      id: 'o2o-late', lvl: 'late', icon: 'o2o',
      t: acts.length === 1 ? 'One-to-One action past its date' : `${acts.length} One-to-One actions past their date`,
      d: acts.slice(0, 2).map(a => `“${a.text}”`).join(', ') + (acts.length > 2 ? '…' : ''),
      cta: 'See', go: { tab: 'performance', anchor: 'actions' },
    });
  }
  const obj = ctx.obj;
  if (obj) {
    const sess = obj.session;
    const list = (obj.objectives || []).filter(o => !sess || o.session === sess.id);
    const over = list.filter(o => o.late?.overdue && o.state === 'approved');
    const drafts = list.filter(o => o.state === 'draft');
    const redo = list.filter(o => o.state === 'rejected');
    if (over.length) items.push({
      id: 'obj-late', lvl: 'late', icon: 'goal',
      t: over.length === 1 ? 'An objective is past its deadline' : `${over.length} objectives are past their deadline`,
      d: `“${over[0].title}”${over.length > 1 ? '…' : ''}. If the date is no longer realistic, talk to your manager.`,
      cta: 'See', go: { tab: 'performance', anchor: 'objectifs' },
    });
    if (redo.length) items.push({
      id: 'obj-redo', lvl: 'due', icon: 'goal',
      t: `Your manager asked for changes on ${redo.length === 1 ? 'an objective' : `${redo.length} objectives`}`,
      d: `“${redo[0].title}”${redo.length > 1 ? '…' : ''}`,
      cta: 'Edit', go: { tab: 'performance', anchor: 'objectifs' },
    });
    if (drafts.length) items.push({
      id: 'obj-draft', lvl: 'due', icon: 'goal',
      t: drafts.length === 1 ? 'Send your objective to your manager' : `Send your ${drafts.length} draft objectives`,
      d: `“${drafts[0].title || 'Untitled'}” is still a draft — nobody sees it yet.`,
      cta: 'Submit', go: { tab: 'performance', anchor: 'objectifs' },
    });
    if (sess && !list.length) items.push({
      id: 'obj-none', lvl: 'due', icon: 'goal',
      t: `Write your objectives for ${sess.name}`,
      d: 'Two or three are enough. Nothing is final until you send it.',
      cta: 'Write', go: { tab: 'performance', anchor: 'objectifs', add: true },
    });
  }

  return items.sort((a, b) => MES_LVL_RANK[a.lvl] - MES_LVL_RANK[b.lvl]);
}

// ── Repères ───────────────────────────────────────────────────
function mesGlance(ctx) {
  const me = ctx.me;
  const wk = (typeof _wpCurWeek === 'function') ? _wpCurWeek() : '';
  const semaine = me ? _mesMyProgress(me).filter(p => p.week_start === wk) : [];
  const obj = ctx.obj;
  const sess = obj?.session;
  const objs = obj ? (obj.objectives || []).filter(o => !sess || o.session === sess.id) : [];
  // Activité du mois, lisible sans code : les tickets que l'agent a
  // saisis, dans les deux trackers (un renfort passe parfois de l'un à
  // l'autre). La note du mois, elle, attend le code.
  const mois = _mesToday().slice(0, 7);
  const tickets = me ? [...(state.sn || []), ...(state.ci || [])].filter(t =>
    t.fo_owner === me && String(t.created_at || '').slice(0, 7) === mois).length : 0;
  return {
    month: { label: new Date().toLocaleDateString('en-GB', { month: 'long' }), tickets },
    shift: mesNextShift(me),
    week: { total: semaine.length, done: semaine.filter(p => p.status === 'Done').length },
    perf: ctx.perf ? { score: ctx.perf.score, niveau: ctx.perf.niveau, periode: ctx.perf.periode, evalue: ctx.perf.evalue } : null,
    obj: obj ? {
      actifs: objs.filter(o => o.state === 'approved').length,
      attente: objs.filter(o => o.state === 'submitted' || o.has_pending).length,
      progress: objs.filter(o => o.state === 'approved').length
        ? Math.round(objs.filter(o => o.state === 'approved').reduce((s, o) => s + (o.progress_pct || 0), 0)
          / objs.filter(o => o.state === 'approved').length)
        : null,
      session: sess?.name || '',
    } : null,
  };
}
