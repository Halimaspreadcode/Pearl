// ══════════════════════════════════════════════════════════════
// ACTIVITÉ HORS TICKETS
// Le dashboard ne mesurait que les tickets. Or une partie du travail
// d'un FO est ailleurs : tâches assignées, items de weekly progress,
// formation (quiz), et disponibilité (absences). On agrège ici, sur
// la même période que le reste de la page.
//
// Les trois registres (fo_tasks, weekly_progress, absences) peuvent
// être vides : chaque panneau affiche alors un état vide explicite
// plutôt qu'un zéro qui se ferait passer pour une mesure.
// ══════════════════════════════════════════════════════════════

// Début de la période sélectionnée, ou null pour « Tout ».
function _foPeriodStart() {
  const period = (document.getElementById('fo-dash-period') || {}).value || 'all';
  if (period === 'all') return null;
  const now = new Date(), from = new Date(now);
  if (period === 'today')      from.setHours(0,0,0,0);
  else if (period === 'week')  { from.setDate(now.getDate() - (now.getDay()===0?6:now.getDay()-1)); from.setHours(0,0,0,0); }
  else if (period === 'month') { from.setDate(1); from.setHours(0,0,0,0); }
  return from;
}

// Cache des agrégats d'absence : /api/absences/stats ne renvoie aucun
// nom ni motif (le détail nominatif reste derrière le verrou RH).
let _foAbsStats = null;
let _foAbsPending = false;
async function _loadFoAbsenceStats() {
  if (_foAbsPending) return;
  _foAbsPending = true;
  try {
    const today = new Date();
    let from = _foPeriodStart();
    // « Tout » n'a pas de borne : on prend 30 jours glissants, sinon le
    // taux comparerait des jours d'absence à la capacité d'une journée.
    if (!from) { from = new Date(today); from.setDate(from.getDate() - 29); }
    const qs = new URLSearchParams({
      country: getActiveCountry(),
      from: from.toISOString().slice(0, 10),
      to: today.toISOString().slice(0, 10),
    });
    const r = await fetch(`${API}/api/absences/stats?${qs}`);
    _foAbsStats = r.ok ? await r.json() : null;
  } catch { _foAbsStats = null; }
  _foAbsPending = false;
  // Les agrégats arrivent après le premier rendu : on repeint la zone.
  if (document.getElementById('fo-activity')) renderFoDashboard();
}

function _foActivityStats(ranked) {
  const from     = _foPeriodStart();
  const country  = getActiveCountry();
  const trackers = state.config.fo_trackers || {};
  const foSet    = new Set(ranked.map(r => r.fo));
  const inPeriod = d => !from || (d && new Date(d) >= from);

  // ── Tâches assignées ────────────────────────────────────────
  // Deux registres : Daily Check-up (/api/fo-tasks) et les tâches données
  // depuis Équipe › Tâches, rangées dans weekly_progress (admin_task,
  // modified_by = l'agent). Une tâche n'existe que dans l'un des deux :
  // les additionner ne compte rien deux fois.
  // Les occurrences récurrentes sont les vraies unités de travail ;
  // la tâche parente n'est qu'un gabarit et ne doit pas être comptée.
  const today = new Date().toISOString().slice(0, 10);
  const chk = (state.foTasks || []).filter(t =>
    !(!t.is_occurrence && t.status === 'Recurring') &&
    (country === 'ALL' || (trackers[t.assigned_to] || 'SN') === country) &&
    inPeriod(t.due_date || t.created_at));
  const assigned = (state.weeklyProgress || []).filter(p => p.admin_task &&
    (country === 'ALL' || p.tracker === country) &&
    inPeriod(p.due_date || p.week_start || p.created_at));
  // Une tâche assignée sans échéance est en retard comme un item de la
  // semaine : pas faite, et sa semaine est passée.
  const asgLate = p => p.status !== 'Done' && (p.due_date ? p.due_date < today
    : typeof _isProgressDelayed === 'function' && _isProgressDelayed(p));
  const tTotal   = chk.length + assigned.length;
  const tDone    = chk.filter(t => t.status === 'Done').length
                 + assigned.filter(p => p.status === 'Done').length;
  const tBlocked = chk.filter(t => t.status === 'Blocked').length;
  const tLate    = chk.filter(t => t.status !== 'Done' && t.due_date && t.due_date < today).length
                 + assigned.filter(asgLate).length;

  // ── Weekly progress ─────────────────────────────────────────
  // Ce que l'agent planifie lui-même : les tâches assignées sont
  // comptées au-dessus, pas une seconde fois ici.
  const progress = (state.weeklyProgress || []).filter(p => !p.admin_task &&
    (country === 'ALL' || p.tracker === country) &&
    inPeriod(p.week_start || p.created_at));
  const pDone    = progress.filter(p => p.status === 'Done').length;
  const pDelayed = progress.filter(p => typeof _isProgressDelayed === 'function'
    ? _isProgressDelayed(p) : false).length;

  // ── Formation (quiz) ────────────────────────────────────────
  // Seuls les FO du périmètre courant comptent, sinon le score moyen
  // inclurait des personnes absentes du classement affiché.
  const quiz = (state.quizResults || []).filter(q =>
    foSet.has(q.user) && inPeriod(q.created_at));
  const qScore = quiz.reduce((s, q) => s + (q.score || 0), 0);
  const qTotal = quiz.reduce((s, q) => s + (q.total || 0), 0);
  const quizPct = qTotal ? Math.round(qScore / qTotal * 100) : null;
  const trained = new Set(quiz.map(q => q.user)).size;

  return {
    tasks:    { total: tTotal, done: tDone, blocked: tBlocked, late: tLate,
                pct: tTotal ? Math.round(tDone / tTotal * 100) : null },
    progress: { total: progress.length, done: pDone, delayed: pDelayed,
                pct: progress.length ? Math.round(pDone / progress.length * 100) : null },
    training: { attempts: quiz.length, pct: quizPct, trained, headcount: ranked.length },
    absence:  _foAbsStats,
  };
}

// ── Objectifs : cible, valeur atteinte, écart ──────────────────
function _renderFoGoals(agg, act) {
  const el   = document.getElementById('fo-goals');
  const meta = document.getElementById('fo-goals-meta');
  if (!el) return;
  const goals = _foGoals();

  // Valeur mesurée pour chaque objectif. `null` = pas de donnée pour
  // le mesurer : l'objectif s'affiche en attente plutôt qu'à 0 %.
  const mttrH = (() => {
    const m = /([\d.]+)\s*h/.exec(agg.avgResolution || '');
    if (m) return Number(m[1]);
    const min = /([\d.]+)\s*min/.exec(agg.avgResolution || '');
    return min ? Number(min[1]) / 60 : null;
  })();
  const measured = {
    sla_rate: agg.slaRate,
    resolved: agg.resolved,
    breach:   agg.breach,
    mttr:     mttrH,
    tasks:    act.tasks.pct,
    progress: act.progress.pct,
    training: act.training.pct,
    absence:  act.absence ? act.absence.absence_rate : null,
  };

  const active = FO_GOAL_DEFS.filter(d => goals[d.id] !== undefined && goals[d.id] !== null);
  if (!active.length) {
    if (meta) meta.textContent = '';
    el.innerHTML = `<div class="fo-goals-empty">
      No objective defined. Set the team targets in
      <a onclick="window.renderPage('config')">Configuration › Objectives</a>
      to track their progress here.
    </div>`;
    return;
  }

  // Seul le résumé est affiché : on ne compte plus que les objectifs
  // mesurables et ceux qui sont tenus.
  let reached = 0, pending = 0;
  active.forEach(d => {
    const target = Number(goals[d.id]);
    const cur    = measured[d.id];
    if (cur === null || cur === undefined) { pending++; return; }
    const hit = d.dir === 'min' ? cur >= target : cur <= target;
    if (hit) reached++;
  });

  // Le compteur passe dans la carte : un résumé lisible en tête plutôt
  // qu'une mention discrète dans le coin de l'en-tête.
  if (meta) meta.textContent = '';

  const measurable = active.length - pending;
  const ringPct = measurable ? Math.round(reached / measurable * 100) : 0;
  const tone = !measurable ? 'void' : ringPct === 100 ? 'ok' : ringPct >= 60 ? 'warn' : 'err';
  const R = 26, C = 2 * Math.PI * R;

  el.innerHTML = `
    <div class="fo-goals-summary is-${tone}">
      <div class="fo-goals-ring">
        <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
          <circle cx="32" cy="32" r="${R}" class="fo-goals-ring-bg"/>
          <circle cx="32" cy="32" r="${R}" class="fo-goals-ring-fg"
            stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - ringPct / 100)).toFixed(1)}"/>
        </svg>
        <span class="fo-goals-ring-n">${reached}<span class="fo-goals-ring-d">/${measurable || '—'}</span></span>
      </div>
      <div class="fo-goals-summary-txt">
        <div class="fo-goals-summary-t">${
          !measurable ? 'No measurable objective yet'
          : reached === measurable ? 'All measured objectives are met'
          : `${measurable - reached} objective${measurable - reached > 1 ? 's' : ''} still below target`
        }</div>
        <div class="fo-goals-summary-d">${
          pending ? `${pending} objective${pending > 1 ? 's' : ''} awaiting data · ` : ''
        }Measured over the displayed period</div>
      </div>
    </div>`;
}

// ── Panneaux d'activité ────────────────────────────────────────
function _renderFoActivity(act) {
  const el = document.getElementById('fo-activity');
  if (!el) return;

  const ICO = {
    task:  '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    prog:  '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    train: '<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
    away:  '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    lock:  '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  };
  const card = (icon, title, body) => `
    <div class="fo-act">
      <div class="fo-act-head">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${icon}</svg>
        <span class="fo-act-title">${title}</span>
      </div>
      ${body}
    </div>`;
  const tone = pct => pct >= 80 ? 'ok' : pct >= 50 ? 'warn' : 'err';
  const bar  = pct => `<div class="fo-act-track"><div class="fo-act-fill ${tone(pct)}" style="width:${pct}%"></div></div>`;

  // ── Tâches assignées ──
  const t = act.tasks;
  const tasksBody = t.total === 0
    // Ce bloc compte les tâches Daily Check-up et celles d'Équipe ›
    // Tâches. Ces dernières se suivent dans My Space › Tasks, qu'on
    // indique plutôt que la page Daily Check-up, sans entrée de menu.
    ? `<div class="fo-act-empty">No assigned task in the period.<br>
         Agents follow them in <a onclick="window.renderPage('weekly-progress')">My Space › Tasks</a>.</div>`
    : `<div class="fo-act-big"><span class="fo-act-n">${t.done}</span><span class="fo-act-of">/ ${t.total} completed</span></div>
       ${bar(t.pct)}
       <div class="fo-act-split">
         <span class="fo-act-tag ok"><b>${t.pct}%</b> accompli</span>
         ${t.late    ? `<span class="fo-act-tag err"><b>${t.late}</b> en retard</span>` : ''}
         ${t.blocked ? `<span class="fo-act-tag warn"><b>${t.blocked}</b> blocked</span>` : ''}
       </div>`;

  // ── Weekly progress ──
  const p = act.progress;
  const progBody = p.total === 0
    ? `<div class="fo-act-empty">No item in the period.<br>
         Agents log them in <a onclick="window.renderPage('weekly-progress')">My Space › Tasks</a>.</div>`
    : `<div class="fo-act-big"><span class="fo-act-n">${p.done}</span><span class="fo-act-of">/ ${p.total} delivered</span></div>
       ${bar(p.pct)}
       <div class="fo-act-split">
         <span class="fo-act-tag ok"><b>${p.pct}%</b> delivered</span>
         ${p.delayed ? `<span class="fo-act-tag err"><b>${p.delayed}</b> en retard</span>` : ''}
       </div>`;

  // ── Formation ──
  const q = act.training;
  const trainBody = q.attempts === 0
    ? `<div class="fo-act-empty">No quiz taken in the period.<br>
         Quizzes are in <a onclick="window.renderPage('quiz')">My Space › Quiz</a>.</div>`
    : `<div class="fo-act-big"><span class="fo-act-n">${q.pct}%</span><span class="fo-act-of">score moyen</span></div>
       ${bar(q.pct)}
       <div class="fo-act-split">
         <span class="fo-act-tag"><b>${q.attempts}</b> tentative${q.attempts > 1 ? 's' : ''}</span>
         <span class="fo-act-tag ${q.trained === q.headcount ? 'ok' : 'warn'}"><b>${q.trained}</b>/${q.headcount} FOs trained</span>
       </div>`;

  // ── Absences ──
  // Agrégats uniquement : ni nom, ni motif, ni solde. Le détail reste
  // sur la page Absences, derrière son propre mot de passe.
  const a = act.absence;
  const awayBody = !a
    ? `<div class="fo-act-empty">Aggregates unavailable.</div>`
    : a.episodes === 0
      ? `<div class="fo-act-empty">No absence recorded in the period.<br>
           Le suivi se fait dans <a onclick="window.renderPage('absences')">Absences</a>.</div>
         <div class="fo-act-lock"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${ICO.lock}</svg>Named detail protected</div>`
      : `<div class="fo-act-big"><span class="fo-act-n">${a.absence_rate}%</span><span class="fo-act-of">taux d'absence</span></div>
         <div class="fo-act-sub">${a.working_days} working day${a.working_days > 1 ? 's' : ''} · ${a.headcount} FOs</div>
         ${bar(Math.max(0, 100 - a.absence_rate * 4))}
         <div class="fo-act-split">
           <span class="fo-act-tag ${a.absent_today ? 'warn' : 'ok'}"><b>${a.absent_today}</b> absent today</span>
           <span class="fo-act-tag"><b>${a.total_days}</b> d total</span>
           ${a.unplanned_days ? `<span class="fo-act-tag err"><b>${a.unplanned_days}</b> d unplanned</span>` : ''}
           ${a.training_days ? `<span class="fo-act-tag"><b>${a.training_days}</b> j formation</span>` : ''}
         </div>
         <div class="fo-act-lock"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${ICO.lock}</svg>Named detail protected</div>`;

  el.innerHTML =
      card(ICO.task,  'Assigned tasks',    tasksBody)
    + card(ICO.prog,  'Weekly progress',   progBody)
    + card(ICO.train, 'Formation',         trainBody)
    + card(ICO.away,  'Absences',          awayBody);

  // Premier passage : on va chercher les agrégats d'absence.
  if (act.absence === null && !_foAbsPending) _loadFoAbsenceStats();
}

function _setFoPeriod(val) {
  const sel = document.getElementById('fo-dash-period'); if (sel) sel.value = val;
  document.querySelectorAll('#fo-dash-period-seg button').forEach(b => b.classList.toggle('active', b.dataset.val === val));
  renderFoDashboard();
}
function _setFoTracker(val) {
  const sel = document.getElementById('fo-dash-tracker'); if (sel) sel.value = val;
  document.querySelectorAll('#fo-dash-tracker-seg button').forEach(b => b.classList.toggle('active', b.dataset.val === val));
  renderFoDashboard();
}

function _sortFoRanking(key) {
  const cur = window._foRankSort;
  if (key === null) {
    window._foRankSort = null;
  } else if (cur && cur.key === key) {
    window._foRankSort = cur.dir === 1 ? { key, dir: -1 } : null;
  } else {
    window._foRankSort = { key, dir: -1 };
  }
  renderFoDashboard();
}

function _toggleFoDetail(fo) {
  // Match the clicked card by its visible name, then toggle the sibling detail panel.
  document.querySelectorAll('#fo-ranking-table .fo-rank-row').forEach((row) => {
    const nameEl = row.querySelector('.fo-rank-name');
    if (!nameEl || nameEl.textContent.trim() !== fo) return;
    const detail = row.nextElementSibling;
    if (detail && detail.classList.contains('fo-rank-detail')) {
      const open = !detail.classList.contains('show');
      detail.classList.toggle('show', open);
      row.classList.toggle('expanded', open);
    }
  });
}

