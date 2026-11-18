// ── FO DASHBOARD ─────────────────────────────────────────────

// KPI definitions - id must match keys in config.kpi_visibility
const FO_KPI_DEFS = [
  { id: 'total',          label: 'Total tickets',   agg: 'total' },
  { id: 'open',           label: 'Open',         agg: 'open' },
  { id: 'in_progress',    label: 'En cours',        agg: 'inProgress' },
  { id: 'resolved',       label: 'Resolved',         agg: 'resolved' },
  { id: 'breach',         label: 'SLA breach',      agg: 'breach' },
  { id: 'p1',             label: 'Tickets P1',      agg: 'p1' },
  { id: 'sla_rate',       label: 'Taux SLA',        agg: 'slaRate',       fmt: v => v + '%' },
  { id: 'avg_resolution', label: 'Avg. resolution', agg: 'avgResolution' },
];

// In-memory cache - fetched once per page load, invalidated on save
let _kpiVisibility = null;

async function _loadKpiVisibility() {
  if (_kpiVisibility) return _kpiVisibility;
  try {
    const res = await fetch(`${API}/api/kpi-config`);
    const data = await res.json();
    _kpiVisibility = data.kpi_visibility || {};
  } catch { _kpiVisibility = {}; }
  return _kpiVisibility;
}

async function _toggleKpiVisible(id, visible) {
  try {
    const res = await fetch(`${API}/api/kpi-config/toggle/${id}`, {
      method: 'PUT', headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
      credentials: 'same-origin', body: JSON.stringify({ visible })
    });
    if (!res.ok) { toast('KPI save error', 'error'); return; }
    const data = await res.json();
    _kpiVisibility = data.kpi_visibility;
    renderFoDashboard();
  } catch { toast('Network error', 'error'); }
}

function _foFilterTickets(fo) {
  const period  = (document.getElementById('fo-dash-period')  || {}).value || 'all';
  const tracker = (document.getElementById('fo-dash-tracker') || {}).value || 'both';

  let pool = [];
  pool = pool.concat(ticketsInScope(tracker === 'both' ? 'ALL' : tracker.toUpperCase()));
  pool = pool.filter(t => t.fo_owner === fo || t.assigned_to === fo);

  if (period !== 'all') {
    const now  = new Date();
    const from = new Date(now);
    if (period === 'today')      { from.setHours(0,0,0,0); }
    else if (period === 'week')  { from.setDate(now.getDate() - (now.getDay()===0?6:now.getDay()-1)); from.setHours(0,0,0,0); }
    else if (period === 'month') { from.setDate(1); from.setHours(0,0,0,0); }
    pool = pool.filter(t => {
      const d = t.created_at || t.open_date;
      return d && new Date(d) >= from;
    });
  }
  return pool;
}

function _calcFoStats(fo) {
  const mine      = _foFilterTickets(fo);
  const open      = mine.filter(t => !['Resolved','Closed'].includes(t.status)).length;
  const resolved  = mine.filter(t => ['Resolved','Closed'].includes(t.status)).length;
  const inProgress = mine.filter(t => t.status === 'In Progress').length;
  const p1        = mine.filter(t => t.priority === 'P1').length;
  const now       = Date.now();
  const breach    = mine.filter(t => {
    if (!t.sla_deadline) return false;
    return new Date(t.sla_deadline).getTime() < now && !['Resolved','Closed'].includes(t.status);
  }).length;
  const withSLA   = mine.filter(t => t.sla_status && !['N/A', 'On Hold'].includes(t.sla_status)).length;
  const inSLA     = mine.filter(t => t.sla_status === 'In SLA').length;
  const slaRate   = withSLA > 0 ? Math.round((inSLA / withSLA) * 100) : 100;
  const resolvedD = mine.filter(t => ['Resolved','Closed'].includes(t.status) && t.duration_ms > 0);
  const avgResMs  = resolvedD.length ? resolvedD.reduce((s,t) => s + (t.duration_ms||0), 0) / resolvedD.length : null;
  const avgResolution = avgResMs
    ? (avgResMs < 3600000 ? `${Math.round(avgResMs/60000)} min` : `${(avgResMs/3600000).toFixed(1)} h`)
    : 'N/A';
  return { total: mine.length, open, resolved, inProgress, p1, breach, slaRate, avgResMs, avgResolution };
}

// Quiz bonus = up to 10 pts per quiz attempt, scaled by the score obtained (e.g. 4/5 -> 8 pts).
function _foQuizBonus(fo) {
  const results = (state.quizResults || []).filter(r => r.user === fo);
  return results.reduce((s, r) => s + (r.total > 0 ? Math.round((r.score / r.total) * 10) : 0), 0);
}

// Score = points used to rank FOs, shown to users so they understand why someone is higher.
// Each resolved ticket = 10 pts, P1 handled = +5 bonus, each SLA breach = -8, every point of SLA rate = +1,
// quiz attempts give a bonus of up to 10 pts each based on the score obtained.
function _foScoreBreakdown(r) {
  const quizBonus = r.quizBonus || 0;
  const items = [
    { label: 'Resolved tickets',      detail: `${r.resolved} × 10`,  pts: r.resolved * 10 },
    { label: 'P1 handled bonus',     detail: `${r.p1} × 5`,         pts: r.p1 * 5 },
    { label: 'Taux SLA',             detail: `${r.slaRate}%`,       pts: r.slaRate },
    { label: 'SLA breach penalty',    detail: `${r.breach} × -8`,    pts: r.breach * -8 },
    { label: 'Bonus quiz',           detail: `quiz`,                pts: quizBonus },
  ];
  const score = items.reduce((s, it) => s + it.pts, 0);
  return { items, score: Math.max(0, score) };
}

// Weekly score history for one FO, last N weeks (independent of the period filter).
// Each week's score is computed the same way as the live ranking (_foScoreBreakdown),
// but using only tickets opened that week.
function _foScoreHistory(fo, weeks = 8) {
  const tracker = (document.getElementById('fo-dash-tracker') || {}).value || 'both';
  let pool = [];
  pool = pool.concat(tracker === 'both' ? allTicketsRaw() : ticketsOf(tracker));
  pool = pool.filter(t => t.fo_owner === fo || t.assigned_to === fo);

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setHours(0,0,0,0);
  weekStart.setDate(weekStart.getDate() - (weekStart.getDay()===0?6:weekStart.getDay()-1)); // Monday this week

  const result = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const from = new Date(weekStart); from.setDate(from.getDate() - i*7);
    const to   = new Date(from); to.setDate(to.getDate() + 7);
    const mine = pool.filter(t => {
      const d = t.created_at || t.open_date;
      if (!d) return false;
      const dt = new Date(d);
      return dt >= from && dt < to;
    });
    const resolved   = mine.filter(t => ['Resolved','Closed'].includes(t.status)).length;
    const p1         = mine.filter(t => t.priority === 'P1').length;
    const withSLA    = mine.filter(t => t.sla_status && !['N/A', 'On Hold'].includes(t.sla_status)).length;
    const inSLA      = mine.filter(t => t.sla_status === 'In SLA').length;
    const slaRate    = withSLA > 0 ? Math.round((inSLA / withSLA) * 100) : 100;
    const breachNow  = Date.now();
    const breach     = mine.filter(t => t.sla_deadline && new Date(t.sla_deadline).getTime() < breachNow && !['Resolved','Closed'].includes(t.status)).length;
    const { score }  = _foScoreBreakdown({ resolved, p1, slaRate, breach });
    result.push({ from, score, total: mine.length });
  }
  return result;
}

// Kudos de la semaine : le podium est toujours calculé sur la semaine en
// cours, indépendamment du sélecteur de période — une section intitulée
// « de la semaine » qui suivrait le filtre « Tout » mentirait sur son titre.
// Positif uniquement : on ne montre que le haut du classement, jamais le bas.
function _foWeeklyKudos(limit = 3) {
  const tracker = (document.getElementById('fo-dash-tracker') || {}).value || 'both';
  const foList  = (state.config.fo_list || []).filter(fo =>
    getActiveCountry() === 'ALL' || personInScope(fo, getActiveCountry()));

  let pool = [];
  pool = pool.concat(tracker === 'both' ? allTicketsRaw() : ticketsOf(tracker));

  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - (from.getDay() === 0 ? 6 : from.getDay() - 1)); // lundi

  const now = Date.now();
  const rows = foList.map(fo => {
    const mine = pool.filter(t => {
      if (t.fo_owner !== fo && t.assigned_to !== fo) return false;
      const d = t.created_at || t.open_date;
      return d && new Date(d) >= from;
    });
    const resolved = mine.filter(t => ['Resolved','Closed'].includes(t.status)).length;
    const p1       = mine.filter(t => t.priority === 'P1').length;
    const withSLA  = mine.filter(t => t.sla_status && !['N/A', 'On Hold'].includes(t.sla_status)).length;
    const inSLA    = mine.filter(t => t.sla_status === 'In SLA').length;
    const slaRate  = withSLA > 0 ? Math.round((inSLA / withSLA) * 100) : 100;
    const breach   = mine.filter(t => t.sla_deadline
      && new Date(t.sla_deadline).getTime() < now
      && !['Resolved','Closed'].includes(t.status)).length;
    const { score } = _foScoreBreakdown({ resolved, p1, slaRate, breach });
    return { fo, score, resolved, p1, slaRate, withSLA };
  });

  // Un podium n'a de sens que si la personne a réellement travaillé cette
  // semaine : sans ticket résolu, un score nul ne mérite pas d'être célébré.
  return rows
    .filter(r => r.resolved > 0)
    .sort((a, b) => b.score - a.score || b.resolved - a.resolved)
    .slice(0, limit);
}

// Motif de félicitation : on met en avant ce que la personne a le mieux
// réussi, plutôt que de répéter le score brut pour les trois.
function _foKudosReason(r) {
  if (r.withSLA > 0 && r.slaRate === 100 && r.resolved >= 3)
    return `${r.resolved} ticket${r.resolved > 1 ? 's' : ''} résolu${r.resolved > 1 ? 's' : ''}, 100% dans les SLA`;
  if (r.p1 > 0)
    return `${r.p1} P1 pris en charge · ${r.resolved} résolu${r.resolved > 1 ? 's' : ''}`;
  if (r.withSLA > 0 && r.slaRate >= 90)
    return `${r.resolved} résolu${r.resolved > 1 ? 's' : ''} · ${r.slaRate}% de respect des SLA`;
  return `${r.resolved} ticket${r.resolved > 1 ? 's' : ''} résolu${r.resolved > 1 ? 's' : ''} cette semaine`;
}

function _renderFoKudos() {
  const el = document.getElementById('fo-kudos');
  if (!el) return;

  const top = _foWeeklyKudos(3);
  if (!top.length) {
    el.innerHTML = `
      <div class="fo-kudos-head">
        <span class="fo-kudos-ico">🎉</span>
        <span class="fo-kudos-title">Kudos de la semaine</span>
      </div>
      <div class="fo-kudos-empty">Aucun ticket résolu pour le moment cette semaine — le podium s'affichera dès les premières résolutions.</div>`;
    return;
  }

  const MEDAL = ['🥇', '🥈', '🥉'];
  const cards = top.map((r, i) => `
    <div class="fo-kudo r${i + 1}">
      <span class="fo-kudo-medal">${MEDAL[i] || '🏅'}</span>
      <div class="fo-kudo-txt">
        <div class="fo-kudo-name">${esc(r.fo)}</div>
        <div class="fo-kudo-why">${esc(_foKudosReason(r))}</div>
      </div>
      <span class="fo-kudo-score">${r.score}<span class="fo-kudo-pts">pts</span></span>
    </div>`).join('');

  el.innerHTML = `
    <div class="fo-kudos-head">
      <span class="fo-kudos-ico">🎉</span>
      <span class="fo-kudos-title">Kudos de la semaine</span>
      <span class="fo-kudos-meta">Depuis lundi</span>
    </div>
    <div class="fo-kudos-grid">${cards}</div>`;
}

// Minimal weekly score history: simple bar chart + last value.
function _renderFoScoreSparkline(history) {
  const max = Math.max(...history.map(h => h.score), 1);
  const last = history[history.length - 1];

  const bars = history.map(h => {
    const pct = Math.round((h.score / max) * 100);
    return `<div class="fo-spark-col" title="${h.score} pts">
      <div class="fo-spark-bar" style="height:${Math.max(pct, 4)}%"></div>
    </div>`;
  }).join('');

  return `<div>
    <div class="fo-spark">${bars}</div>
    <div class="fo-spark-foot">${last.score} <span>pts this week</span></div>
  </div>`;
}

function _renderFoQuizSummary(fo) {
  const results = (state.quizResults || []).filter(r => r.user === fo)
    .sort((a,b) => new Date(b.created_at) - new Date(a.created_at));

  if (!results.length) {
    return `<div class="fo-quiz-none">No quiz attempt</div>`;
  }

  const totalScore = results.reduce((s,r) => s + r.score, 0);
  const totalMax = results.reduce((s,r) => s + r.total, 0);
  const avgPct = totalMax ? Math.round((totalScore / totalMax) * 100) : 0;

  const rows = results.slice(0, 5).map(r => `
    <div class="fo-quiz-row">
      <span>${esc(r.quiz_name || '-')} · ${new Date(r.created_at).toLocaleDateString(...(()=>{const{locale:l,tz}=getLangConfig();return[l,{timeZone:tz}]})())}</span>
      <strong>${r.score} / ${r.total}</strong>
    </div>`).join('');

  const bonus = _foQuizBonus(fo);

  return `<div class="fo-quiz-avg">${avgPct}% <span>moyenne sur ${results.length} tentative${results.length>1?'s':''}</span></div>
    <div class="fo-quiz-bonus">+${bonus} pts de bonus au score</div>
    ${rows}`;
}

// Smooth SVG line/area chart of resolved tickets per day, last N days.
function _renderFoEvolutionChart() {
  const el = document.getElementById('fo-evolution-chart');
  if (!el) return;

  const tracker = (document.getElementById('fo-dash-tracker') || {}).value || 'both';
  let pool = [];
  pool = pool.concat(tracker === 'both' ? allTicketsRaw() : ticketsOf(tracker));
  const resolved = pool.filter(t => ['Resolved','Closed'].includes(t.status) && t.close_date);

  const DAYS = 14;
  const days = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0,10));
  }
  const dayTickets = days.map(day => resolved.filter(t => (t.close_date||'').slice(0,10) === day));
  const counts = dayTickets.map(arr => arr.length);
  const max = Math.max(...counts, 1);

  // Per-day breakdown by FO, for tooltip
  const dayBreakdowns = dayTickets.map(arr => {
    const by = {};
    arr.forEach(t => {
      const who = t.fo_owner || t.assigned_to || 'Unassigned';
      by[who] = (by[who]||0) + 1;
    });
    return Object.entries(by).sort((a,b) => b[1]-a[1]);
  });

  const total      = counts.reduce((a,b)=>a+b,0);
  const todayCount = counts[counts.length-1];
  const avg        = +(total / DAYS).toFixed(1);
  const bestIdx    = counts.indexOf(Math.max(...counts));

  // Trend vs. the previous 7-day window
  const last7 = counts.slice(-7).reduce((a,b)=>a+b,0);
  const prev7 = counts.slice(-14,-7).reduce((a,b)=>a+b,0);
  let trendPct = null;
  if (prev7 > 0) trendPct = Math.round(((last7 - prev7) / prev7) * 100);
  else if (last7 > 0) trendPct = 100;

  // Stash data for the hover handler
  window._foEvoData = { days, counts, dayBreakdowns };

  const trendChip = trendPct === null
    ? `<span class="fo-evo-tile-val">—</span>`
    : `<span class="fo-evo-trend ${trendPct >= 0 ? 'up' : 'down'}">
         ${trendPct >= 0 ? '↑' : '↓'} ${Math.abs(trendPct)}%<small>vs prev. 7d</small>
       </span>`;

  // En-tête : total en grand + tuiles secondaires
  const summary = `
    <div class="fo-evo-summary">
      <div>
        <div class="fo-evo-total">${total}</div>
        <div class="fo-evo-total-sub">tickets resolved · <strong>${todayCount}</strong> today</div>
      </div>
      <div class="fo-evo-tiles">
        <div class="fo-evo-tile">
          <div class="fo-evo-tile-lbl">Moy./jour</div>
          <div class="fo-evo-tile-val">${avg}</div>
        </div>
        <div class="fo-evo-tile">
          <div class="fo-evo-tile-lbl">Tendance</div>
          <div class="fo-evo-tile-trend">${trendChip}</div>
        </div>
      </div>
    </div>`;

  // Clean minimal bar chart - rounded bars, accent on the best/today, soft track behind
  const bars = counts.map((c, i) => {
    const h        = max > 0 ? (c / max) * 100 : 0;
    const isToday  = i === DAYS - 1;
    const isBest   = i === bestIdx && c > 0;
    const fill     = isToday ? 'var(--m3-primary)'
                   : isBest  ? 'color-mix(in srgb,var(--m3-primary) 55%,transparent)'
                             : 'color-mix(in srgb,var(--m3-primary) 22%,transparent)';
    const dd       = new Date(days[i]+'T00:00:00');
    const dayLbl   = dd.toLocaleDateString((globalThis.PEAR_LOCALE || 'fr-FR'),{weekday:'short'}).replace('.','');
    const showDate = i % 2 === 0 || isToday;
    return `<div class="fo-evo-bar" onmouseenter="_showFoEvoTooltip(event,${i})" onmouseleave="_hideFoEvoTooltip()">
        <div class="fo-evo-bar-track">
          <div class="fo-evo-bar-val" style="height:${Math.max(h,c>0?6:0)}%;background:${fill}"></div>
        </div>
        <div class="fo-evo-bar-lbl${isToday ? ' today' : ''}">${showDate?dayLbl:'&nbsp;'}</div>
      </div>`;
  }).join('');

  el.innerHTML = `
    ${summary}
    <div class="fo-evo-wrap">
      <div class="fo-evo-chart">${bars}</div>
      <div id="fo-evo-tooltip" class="fo-evo-tip"></div>
    </div>`;
}

function _showFoEvoTooltip(evt, i) {
  const tip = document.getElementById('fo-evo-tooltip');
  const wrap = tip && tip.parentElement;
  const data = window._foEvoData;
  if (!tip || !wrap || !data) return;

  const { days, counts, dayBreakdowns } = data;
  const date = days[i];
  const count = counts[i];
  const breakdown = dayBreakdowns[i];

  const dateLbl = new Date(date+'T00:00:00').toLocaleDateString((globalThis.PEAR_LOCALE || 'fr-FR'), { weekday:'short', day:'numeric', month:'short' });
  const who = breakdown.length
    ? breakdown.map(([fo,n]) => `<div class="fo-evo-tip-row"><span>${esc(fo)}</span><strong>${n}</strong></div>`).join('')
    : '<div class="fo-evo-tip-row"><span>No ticket resolved</span></div>';

  tip.innerHTML = `
    <div class="fo-evo-tip-date">${dateLbl}</div>
    <div class="fo-evo-tip-n">${count} resolved</div>
    ${who}`;

  // position relative to the chart wrapper
  const target = evt.currentTarget;
  const wrapRect = wrap.getBoundingClientRect();
  const ptRect = target.getBoundingClientRect();
  const x = ptRect.left + ptRect.width/2 - wrapRect.left;
  const y = ptRect.top - wrapRect.top;
  tip.style.left = x + 'px';
  tip.style.top  = (y - 6) + 'px';
  tip.style.display = 'block';
}
function _hideFoEvoTooltip() {
  const tip = document.getElementById('fo-evo-tooltip');
  if (tip) tip.style.display = 'none';
}

// ── FO performance score, podium, monthly chart, trust matrix ──
function foAvatarColor(fo) {
  const idx = (state.config.fo_list||[]).indexOf(fo);
  return AVATAR_COLORS_FO[(idx<0?0:idx) % AVATAR_COLORS_FO.length];
}
function foInitials(fo) {
  return fo.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
}
function computeFoScores(d) {
  // Même périmètre que le reste de l'application : la Trust Matrix
  // positionne les agents les uns par rapport aux autres, mêler deux pays
  // dans la même grille fausserait la comparaison.
  const scope = (typeof getActiveCountry === 'function') ? getActiveCountry() : 'ALL';
  const foList = (state.config.fo_list || []).filter(fo =>
    scope === 'ALL' || personInScope(fo, scope));
  const manualPerf = state.config.fo_performance || {};
  const manualEng  = state.config.fo_engagement  || {};
  const byFo = d.by_fo || {};
  return foList.map(fo => {
    const stats = byFo[fo] || { total:0, resolved:0, breach:0 };
    const autoSla  = stats.total > 0 ? Math.round((1 - stats.breach/stats.total) * 100) : 100;
    const autoVol  = stats.total > 0 ? Math.min(100, Math.round((stats.resolved/stats.total) * 100)) : 0;
    const autoScore = Math.round((autoSla + autoVol) / 2);
    // Le score du mois noté, s'il existe, prime sur la note libre :
    // c'est la mesure la plus complète dont on dispose sur l'agent.
    const cardScore = (typeof perfScore === 'function' && typeof perfUI === 'object')
      ? perfScore(_perfMonthData(perfUI.month || _perfMonthKey())[fo]).score
      : null;
    const manual = manualPerf[fo] ?? 50;
    const performance = cardScore !== null && cardScore !== undefined
      ? cardScore
      : Math.round(autoScore * 0.5 + manual * 0.5);
    const engagement = manualEng[fo] ?? 50;
    return { fo, total: stats.total||0, resolved: stats.resolved||0, breach: stats.breach||0, autoScore, manual, performance, engagement };
  });
}

// ── Trust / Loyalty Matrix - Performance × Engagement (2x2) ──
// Repliée par défaut : il faut d'abord l'ouvrir, puis saisir le mot de passe Configuration.
function toggleTrustMatrix() {
  const head = document.getElementById('trust-collapse-head');
  const body = document.getElementById('trust-collapse-body');
  const el   = document.getElementById('dc-trust-matrix-body');
  if (!head || !body || !el) return;
  const open = !body.classList.contains('show');
  window._trustMatrixOpen = open;
  body.classList.toggle('show', open);
  head.classList.toggle('open', open);
  if (open) {
    if (window._trustMatrixUnlocked) _renderTrustMatrixBody(el, state.dashboard || {});
    else { _renderTrustMatrixLock(el); setTimeout(() => { const pw = document.getElementById('trust-matrix-pw'); if (pw) pw.focus(); }, 120); }
  }
}

function _renderTrustMatrixLock(el, error) {
  const lockIcon = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
  el.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:44px 20px;text-align:center">
    <div style="width:56px;height:56px;border-radius:18px;background:var(--fo-soft,#F3F4F6);color:var(--mute);display:flex;align-items:center;justify-content:center">${lockIcon}</div>
    <div>
      <div style="font-size:14px;font-weight:700;color:var(--dark)">Protected content</div>
      <div style="font-size:12px;color:var(--mute);margin-top:4px;max-width:340px">Enter the Configuration page password pour afficher la Trust Matrix.</div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;width:100%;max-width:320px">
      <input type="password" id="trust-matrix-pw" class="search-input" placeholder="Password" style="flex:1"
        onkeydown="if(event.key==='Enter')unlockTrustMatrix()">
      <button class="btn btn-primary btn-sm" onclick="unlockTrustMatrix()">Unlock</button>
    </div>
    ${error ? `<div style="font-size:11.5px;color:var(--red);font-weight:600">${error}</div>` : ''}
  </div>`;
}

async function unlockTrustMatrix() {
  const pwEl = document.getElementById('trust-matrix-pw');
  const el   = document.getElementById('dc-trust-matrix-body');
  const pw   = (pwEl && pwEl.value) ? pwEl.value.trim() : '';
  if (!pw || !el) return;
  try {
    const res = await fetch(`${API}/api/config/auth`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }), credentials: 'same-origin',
    });
    if (!res.ok) { _renderTrustMatrixLock(el, 'Incorrect password'); return; }
    const data = await res.json().catch(() => ({}));
    if (!data.ok || !data.token) { _renderTrustMatrixLock(el, 'Incorrect password'); return; }

    // Les notes ne viennent plus avec la config publique : il faut les
    // redemander avec le jeton. Sans ce rechargement la matrice
    // s'afficherait vide, les champs d'évaluation étant absents.
    AdminSession.set(data.token);
    const cfgRes = await fetch(`${API}/api/config`, {
      headers: AdminSession.headers(), credentials: 'same-origin',
    });
    if (cfgRes.ok) state.config = { ...state.config, ...(await cfgRes.json()) };

    window._trustMatrixUnlocked = true;
    _renderTrustMatrixBody(el, state.dashboard || {});
  } catch { _renderTrustMatrixLock(el, 'Network error'); }
}

function _renderTrustMatrixBody(el, d) {
  if (!el) return;
  const scores = computeFoScores(d);
  if (!scores.length) {
    const scope = (typeof getActiveCountry === 'function') ? getActiveCountry() : 'ALL';
    el.innerHTML = `<div class="perf-empty">${scope === 'ALL'
      ? 'No FO configured.'
      : `No FO assigned to ${esc(scope)}.`}</div>`;
    return;
  }

  // Quatre quadrants neutres : la position dans la grille porte déjà le
  // sens (haut = performance haute, droite = engagement haut). Une seule
  // case est mise en avant — celle qu'on vise — et le reste se distingue
  // par un simple repère de niveau, pas par un aplat de couleur.
  // Intitulés repris du plan trimestriel (Grow / Top performer / Watch /
  // Go). Les anciens noms — « Mercenaire brillant », « Poids mort » — ne
  // venaient d'aucun document de référence et ne sont pas des mots qu'on
  // peut poser devant l'agent concerné en entretien.
  const quadrants = [
    { key:'top',        label:'Top performer', sub:'Confiance haute · Performance haute', goal:true,
      hint:'Autonomy, referent roles, career milestones.' },
    { key:'developing', label:'Grow',          sub:'High trust · Results to build',
      hint:'Coaching, formation et immersion.' },
    { key:'mercenary',  label:'Watch',         sub:'Results without rigour',
      hint:'Refocus on process: notifications, escalations, handover.' },
    { key:'deadweight', label:'Go',            sub:'Neither trust nor results',
      hint:'Structured action plan, clear deadlines.' },
  ];
  function quadrantFor(s) {
    const highPerf = s.performance >= 50;
    const highEng  = s.engagement  >= 50;
    if (highPerf && highEng)  return 'top';
    if (highPerf && !highEng) return 'mercenary';
    if (!highPerf && highEng) return 'developing';
    return 'deadweight';
  }
  const grouped = { top:[], mercenary:[], developing:[], deadweight:[] };
  scores.forEach(s => grouped[quadrantFor(s)].push(s));

  el.innerHTML = `<div class="tmx">
    <div class="tmx-grid">
      ${quadrants.map(q => {
        const list = grouped[q.key];
        return `<section class="tmx-q${q.goal ? ' is-goal' : ''}">
          <header class="tmx-q-head">
            <div class="tmx-q-title">
              <span class="tmx-q-name">${q.label}</span>
              ${q.goal ? '<span class="tmx-q-tag">Cible</span>' : ''}
            </div>
            <span class="tmx-q-count">${list.length}</span>
          </header>
          <p class="tmx-q-sub">${q.sub}</p>
          <p class="tmx-q-hint">${q.hint}</p>
          <div class="tmx-q-list">
            ${list.map(s => `
              <div class="tmx-fo">
                <span class="tmx-fo-av" style="background:${foAvatarColor(s.fo)}">${foInitials(s.fo)}</span>
                <span class="tmx-fo-name" title="${esc(s.fo)}">${esc(s.fo)}</span>
                <span class="tmx-fo-stats">
                  <span class="tmx-fo-stat"><span class="tmx-fo-k">Perf</span>${s.performance}<span class="tmx-fo-u">%</span></span>
                  <span class="tmx-fo-stat"><span class="tmx-fo-k">Eng</span>${s.engagement}<span class="tmx-fo-u">%</span></span>
                </span>
              </div>`).join('') || '<div class="tmx-empty">No FO</div>'}
          </div>
        </section>`;
      }).join('')}
    </div>
    <div class="tmx-axes">
      <span>← Engagement bas</span><span>Engagement haut →</span>
    </div>
  </div>`;
}

