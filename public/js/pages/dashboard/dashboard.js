// ── DASHBOARD ────────────────────────────────────────────────
// Recomputes the same shape as /api/dashboard but scoped to a single country
// (or all, like the server). Tickets from state.tickets are already
// fully enriched (sla_status, time_left_ms, etc.) by the API.
// ── Dashboard period state ────────────────────────────────────
window._dashPeriod = 'all';

function setDashPeriod(p) {
  window._dashPeriod = p;
  const sel = document.getElementById('dash-period-select');
  if (sel && sel.value !== p) sel.value = p;
  const customDiv = document.getElementById('dash-period-custom');
  if (customDiv) {
    customDiv.style.display = p === 'custom' ? 'flex' : 'none';
    if (p === 'custom') onDashCustomTypeChange();
  }
  renderDashboard();
}

function onDashCustomTypeChange() {
  const type = document.getElementById('dash-custom-type')?.value || 'month';
  const wk = document.getElementById('dash-custom-week');
  const mo = document.getElementById('dash-custom-month');
  if (wk) wk.style.display = type === 'week'  ? '' : 'none';
  if (mo) mo.style.display = type === 'month' ? '' : 'none';
  renderDashboard();
}

function getDashPeriodRange() {
  const p = window._dashPeriod || 'all';
  const { tz } = getLangConfig();
  const now = new Date();
  if (p === 'all') return null;
  if (p === 'week') {
    const day = now.getDay(); // 0=Sun
    const mon = new Date(now); mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1)); mon.setHours(0,0,0,0);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 7);
    return { from: mon, to: sun };
  }
  if (p === 'month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to   = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { from, to };
  }
  if (p === 'custom') {
    const type = document.getElementById('dash-custom-type')?.value || 'month';
    if (type === 'week') {
      const val = document.getElementById('dash-custom-week')?.value; // "2026-W26"
      if (!val) return null;
      const [yr, wk] = val.split('-W').map(Number);
      // ISO week: Jan 4 is always in week 1
      const jan4 = new Date(yr, 0, 4);
      const wkStart = new Date(jan4);
      wkStart.setDate(jan4.getDate() - (jan4.getDay() || 7) + 1 + (wk - 1) * 7);
      wkStart.setHours(0,0,0,0);
      const wkEnd = new Date(wkStart); wkEnd.setDate(wkStart.getDate() + 7);
      return { from: wkStart, to: wkEnd };
    } else {
      const val = document.getElementById('dash-custom-month')?.value; // "2026-06"
      if (!val) return null;
      const [yr, mo] = val.split('-').map(Number);
      return { from: new Date(yr, mo - 1, 1), to: new Date(yr, mo, 1) };
    }
  }
  return null;
}

function _dashPeriodLabel(range) {
  if (!range) return '';
  const { locale, tz } = getLangConfig();
  const fmt = d => d.toLocaleDateString(locale, { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric' });
  const toExcl = new Date(range.to.getTime() - 1);
  return fmt(range.from) + ' → ' + fmt(toExcl);
}

// Nombre de tickets dans les délais, sur le périmètre SLA applicable.
function inSlaCount(d) {
  const scope = d.sla_scope || 0;
  return Math.round((d.sla_compliance ?? 100) / 100 * scope);
}

// Clé de jour en UTC (YYYY-MM-DD) — la plateforme est en UTC+0.
function _utcDayKey(d) {
  const x = (d instanceof Date) ? d : new Date(d);
  return isNaN(x) ? '' : x.toISOString().slice(0, 10);
}

function _computeDashboardKpis(country, dateRange) {
  let tickets = [
    ...ticketsInScope(country).map(t => ({ ...t, tracker: t._tracker.toUpperCase() })),
  ];
  if (dateRange) {
    tickets = tickets.filter(t => {
      if (!t.open_date) return false;
      const d = new Date(t.open_date);
      return d >= dateRange.from && d < dateRange.to;
    });
  }
  const today = new Date(); today.setHours(0,0,0,0);
  // Conformité SLA : le dénominateur doit couvrir les MÊMES tickets que le
  // numérateur. On comptait tous les tickets SLA (y compris les breachs déjà
  // clos) au dénominateur, mais on excluait les clos du compteur de breach —
  // le taux affiché était donc supérieur à la réalité.
  const slaScope = tickets.filter(t => !['N/A', 'On Hold'].includes(t.sla_status));
  const totalSLA = slaScope.length;
  const inSLA    = slaScope.filter(t => ['In SLA','Near Breach'].includes(t.sla_status)).length;
  const breachedAll = slaScope.filter(t => t.sla_status === 'Breach').length;

  const kpis = {
    total:    tickets.length,
    open:     tickets.filter(t => ['Open','In Progress'].includes(t.status)).length,
    breach:   tickets.filter(t => t.sla_status === 'Breach' && !['Resolved','Closed'].includes(t.status)).length,
    breach_all: breachedAll,
    sla_scope:  totalSLA,
    near_breach: tickets.filter(t => t.sla_status === 'Near Breach' && !['Resolved','Closed'].includes(t.status)).length,
    resolved: tickets.filter(t => t.status === 'Resolved').length,
    // La plateforme travaille en UTC : on compare des jours UTC, pas des
    // minuits locaux au navigateur (sinon "aujourd'hui" glisse d'un jour
    // pour tout utilisateur hors UTC+0).
    today:    tickets.filter(t => t.open_date && _utcDayKey(t.open_date) === _utcDayKey(new Date())).length,
    sla_compliance: totalSLA > 0 ? Math.round(inSLA / totalSLA * 100) : 100,
    by_domain:{}, by_priority:{}, by_type:{}, by_status:{},
    breach_list: [], near_breach_list: [],
    spark: {},
  };

  // Séries réelles sur 7 jours glissants (UTC), utilisées par les sparklines.
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const dd = new Date(Date.now() - i * 86400000);
    days.push(_utcDayKey(dd));
  }
  const zero = () => days.map(() => 0);
  const created = zero(), resolvedSeries = zero(), breachSeries = zero(), openSeries = zero();
  tickets.forEach(t => {
    const ci = t.open_date ? days.indexOf(_utcDayKey(t.open_date)) : -1;
    if (ci >= 0) {
      created[ci]++;
      if (t.sla_status === 'Breach') breachSeries[ci]++;
      if (['Open','In Progress'].includes(t.status)) openSeries[ci]++;
    }
    const closedAt = t.close_date;
    const ri = closedAt ? days.indexOf(_utcDayKey(closedAt)) : -1;
    if (ri >= 0) resolvedSeries[ri]++;
  });
  kpis.spark = { days, created, resolved: resolvedSeries, breach: breachSeries, open: openSeries };

  // ── Signaux pour les insights ────────────────────────────────
  const stillOpenList = tickets.filter(t => !['Resolved','Closed'].includes(t.status));

  // Ticket ouvert le plus ancien (âge en jours).
  let oldest = null;
  stillOpenList.forEach(t => {
    if (!t.open_date) return;
    const age = (Date.now() - new Date(t.open_date).getTime()) / 86400000;
    if (!oldest || age > oldest.age) oldest = { age, tt: t.sn_tt, tracker: t.tracker, id: t.id, title: t.title };
  });
  kpis.oldest_open_ticket = oldest;

  // Charge par FO sur les tickets encore ouverts (détection de surcharge).
  const foLoad = {};
  stillOpenList.forEach(t => { if (t.fo_owner) foLoad[t.fo_owner] = (foLoad[t.fo_owner] || 0) + 1; });
  kpis.fo_open_load = foLoad;

  // Temps de résolution médian (en heures) sur les tickets clos de la période.
  const durations = tickets
    .filter(t => t.open_date && t.close_date)
    .map(t => (new Date(t.close_date) - new Date(t.open_date)) / 3600000)
    .filter(h => h >= 0)
    .sort((a, b) => a - b);
  kpis.median_resolution_h = durations.length
    ? durations[Math.floor(durations.length / 2)]
    : null;

  tickets.forEach(t => {
    if (t.domain)   kpis.by_domain[t.domain]     = (kpis.by_domain[t.domain]||0)+1;
    if (t.priority) kpis.by_priority[t.priority] = (kpis.by_priority[t.priority]||0)+1;
    if (t.type)     kpis.by_type[t.type]         = (kpis.by_type[t.type]||0)+1;
    if (t.status)   kpis.by_status[t.status]     = (kpis.by_status[t.status]||0)+1;
    const stillOpen = !['Resolved','Closed'].includes(t.status);
    if (t.sla_status === 'Breach' && stillOpen)
      kpis.breach_list.push({ id:t.id, tracker:t.tracker, sn_tt:t.sn_tt, title:t.title, priority:t.priority, time_left_ms:t.time_left_ms, fo_owner:t.fo_owner });
    if (t.sla_status === 'Near Breach' && stillOpen)
      kpis.near_breach_list.push({ id:t.id, tracker:t.tracker, sn_tt:t.sn_tt, title:t.title, priority:t.priority, time_left_ms:t.time_left_ms, fo_owner:t.fo_owner });
  });
  return kpis;
}


// Barre d'insights : au plus 3 constats, triés par urgence.
function renderDashInsights(d) {
  const el = document.getElementById('dash-insights');
  if (!el) return;
  const out = [];

  // 1. Ruptures SLA — toujours en tête si présentes.
  if ((d.breach || 0) > 0) {
    out.push({ tone:'crit', icon:'alert', prio:0, chip:true,
      text:`<b>${d.breach}</b> out of SLA`,
      fn:"toggleBreachCollapse()", open: !document.getElementById('breach-alert')?.classList.contains('collapsed') });
  }
  if ((d.near_breach || 0) > 0) {
    out.push({ tone:'warn', icon:'clock', prio:1, chip:true,
      text:`<b>${d.near_breach}</b> close to breach`,
      fn:"toggleNearBreachCollapse()", open: !document.getElementById('near-breach-alert')?.classList.contains('collapsed') });
  }

  // 2. Ticket ouvert anormalement ancien (> 14 jours).
  const oldest = d.oldest_open_ticket;
  if (oldest && oldest.age > 14) {
    out.push({ tone:'warn', icon:'clock', prio:2,
      text:`<b>${esc(oldest.tt) || 'A ticket'}</b> open for <b>${Math.floor(oldest.age)} d</b>` });
  }

  // 3. Surcharge d'un FO : plus de 40% des tickets ouverts sur une
  //    seule personne, et au moins 4 tickets (sinon le ratio ne veut
  //    rien dire sur de petits volumes).
  const load = Object.entries(d.fo_open_load || {}).sort((a,b) => b[1]-a[1])[0];
  const openTotal = Object.values(d.fo_open_load || {}).reduce((a,b) => a+b, 0);
  if (load && load[1] >= 4 && openTotal > 0 && load[1] / openTotal > 0.4) {
    out.push({ tone:'warn', icon:'user', prio:3,
      text:`<b>${esc(load[0])}</b> holds <b>${load[1]}</b> of the ${openTotal} open tickets` });
  }

  // 4. Tendance du volume : 3 derniers jours vs 3 précédents.
  const sp = d.spark || {};
  if (Array.isArray(sp.created) && sp.created.length === 7) {
    const recent = sp.created.slice(4).reduce((a,b) => a+b, 0);
    const before = sp.created.slice(1,4).reduce((a,b) => a+b, 0);
    if (before >= 3 && recent > before * 1.6) {
      out.push({ tone:'warn', icon:'trend', prio:4,
        text:`Volume up: <b>${recent}</b> over 3 d vs ${before} before` });
    } else if (recent >= 3 && before > recent * 1.6) {
      out.push({ tone:'info', icon:'trend', prio:6,
        text:`Volume down: <b>${recent}</b> over 3 d vs ${before} before` });
    }
  }

  // 5. Domaine dominant, seulement s'il se détache nettement.
  const dom = Object.entries(d.by_domain || {}).sort((a,b) => b[1]-a[1])[0];
  if (dom && d.total > 0) {
    const pct = Math.round(dom[1] / d.total * 100);
    if (pct >= 30) out.push({ tone:'info', icon:'chart', prio:5,
      text:`<b>${pct}%</b> of tickets on <b>${esc(dom[0])}</b>` });
  }

  // 6. Délai de résolution médian — repère de performance.
  if (d.median_resolution_h != null) {
    const h = d.median_resolution_h;
    const txt = h < 48 ? `${h.toFixed(1)} h` : `${(h/24).toFixed(1)} j`;
    out.push({ tone:'info', icon:'check', prio:7,
      text:`Median resolution: <b>${txt}</b>` });
  }

  if (!out.length) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = 'flex';

  const ico = {
    alert:'<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    clock:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    chart:'<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    trend:'<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    check:'<polyline points="20 6 9 17 4 12"/>',
  };
  out.sort((a,b) => a.prio - b.prio);
  // Une seule ligne : les alertes SLA en pastilles cliquables (elles
  // déplient la liste des tickets juste en dessous), puis les constats en
  // texte discret séparés par des points.
  const chips = out.filter(i => i.chip);
  const infos = out.filter(i => !i.chip).slice(0, 3);
  el.innerHTML =
    chips.map(i => `<button type="button" class="d-chip ${i.tone}${i.open ? ' open' : ''}" onclick="${i.fn};renderDashInsightsAgain()" aria-expanded="${i.open}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ico[i.icon]||''}</svg>
      <span>${i.text}</span>
      <svg class="d-chip-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>`).join('') +
    (infos.length ? `<div class="d-infos">${infos.map(i => `<span>${i.text}</span>`).join('<i>·</i>')}</div>` : '');
  _lastInsightData = d;
}

let _lastInsightData = null;
// Le chevron de la pastille suit l'état replié/déplié de la liste.
function renderDashInsightsAgain() { if (_lastInsightData) renderDashInsights(_lastInsightData); }

function renderDashboard() {
  const range = getDashPeriodRange();
  const labelEl = document.getElementById('dash-period-label');
  if (labelEl) labelEl.textContent = range ? _dashPeriodLabel(range) : '';
  const d = _computeDashboardKpis(typeof getActiveCountry === 'function' ? getActiveCountry() : 'ALL', range);
  const cfg2 = typeof getLangConfig === 'function' ? getLangConfig() : { locale:'en-GB', tz:'UTC' };
  const today = new Date().toLocaleDateString(cfg2.locale, {timeZone:cfg2.tz, weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const el = document.getElementById('dash-date');
  if (el) el.textContent = today;

  // Quote
  const q = getDailyQuote();
  const qEl = document.getElementById('dash-quote');
  if (qEl) qEl.innerHTML = `"${q.text}" <span class="dash-quote-author">— ${q.author}</span>`;

  // Sidebar counts
  const siteEl = document.getElementById('sb-count-site');
  if (siteEl) siteEl.textContent = ticketsOf(activeSiteKey()).length;
  const globalEl = document.getElementById('sb-count-global');
  if (globalEl) globalEl.textContent = allTicketsRaw().length;
  // DQ badge — run checks silently to update count
  const dqBadge = document.getElementById('sb-count-dq');
  if (dqBadge) {
    const dqN = _runDataQualityChecks().length;
    dqBadge.textContent = dqN > 0 ? dqN : '';
    dqBadge.style.display = dqN > 0 ? '' : 'none';
  }
  const sbUser = document.getElementById('sb-user-name');
  if (sbUser && typeof currentUser !== 'undefined' && currentUser?.name)
    sbUser.textContent = currentUser.name.split(' ')[0];

  // Breach alert banner
  const ba = document.getElementById('breach-alert');
  const bl = document.getElementById('breach-list');
  if (ba && d.breach_list && d.breach_list.length > 0) {
    ba.classList.add('visible');
    bl.innerHTML = d.breach_list.map(b =>
      `<div class="breach-item" onclick="navigateToTicket(${escAttrArg(b.tracker?.toLowerCase())},${escAttrArg(b.id)})" style="cursor:pointer">
        <span class="badge badge-${esc((b.priority||'').toLowerCase())}">${esc(b.priority)}</span>
        <span class="breach-tt">[${esc(b.tracker)}] ${esc(b.sn_tt)}</span>
        <span style="color:var(--mid);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(b.title)}</span>
        <span class="breach-time">${formatTimeLeft(b.time_left_ms,'Open')}</span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--mute)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-left:4px"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
      </div>`
    ).join('');
    const bcl = document.getElementById('breach-count-label');
    if (bcl) bcl.innerHTML = `${Number(d.breach_list.length)}<span class="bcl-word"> BREACH</span>`;
    document.getElementById('breach-badge').classList.add('visible');
    const cnt = document.getElementById('breach-alert-count');
    if (cnt) cnt.textContent = d.breach_list.length;
  } else if (ba) {
    ba.classList.remove('visible');
    document.getElementById('breach-badge').classList.remove('visible');
  }

  // Near-breach alert banner
  const nba = document.getElementById('near-breach-alert');
  const nbl = document.getElementById('near-breach-list');
  if (nba && d.near_breach_list && d.near_breach_list.length > 0) {
    nba.classList.add('visible');
    nbl.innerHTML = d.near_breach_list.map(b =>
      `<div class="breach-item" onclick="navigateToTicket(${escAttrArg(b.tracker?.toLowerCase())},${escAttrArg(b.id)})" style="cursor:pointer">
        <span class="badge badge-${esc((b.priority||'').toLowerCase())}">${esc(b.priority)}</span>
        <span class="breach-tt">[${esc(b.tracker)}] ${esc(b.sn_tt)}</span>
        <span style="color:var(--mid);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(b.title)}</span>
        <span class="breach-time">${formatTimeLeft(b.time_left_ms,'Open')}</span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--mute)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-left:4px"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
      </div>`
    ).join('');
    const nbcl = document.getElementById('near-breach-alert-count');
    if (nbcl) nbcl.textContent = d.near_breach_list.length;
  } else if (nba) {
    nba.classList.remove('visible');
  }

  // ── helpers ──────────────────────────────────────────────
  function set(id, v) { const e=document.getElementById(id); if(e) e.textContent=v; }

  // Les barres ne portent plus de couleur inline : elle venait de
  // --line (#222 en dark), quasi confondu avec le fond du widget
  // (#171717), et un opacity:.28 par-dessus achevait de l'effacer.
  // La teinte vient maintenant du CSS, qui suit le thème ; le JS ne
  // décide que du relief (barre courante vs historique).
  function miniChart(id, values, color) {
    const el = document.getElementById(id);
    if (!el) return;
    const max = Math.max(...values, 1);
    const hot = color === 'var(--red)';
    el.innerHTML = values.map((v, i) => {
      const h = Math.max(2, Math.round((v/max)*20));
      const last = i === values.length - 1;
      const cls = ['hm-spark-bar', last ? 'active' : '', hot ? 'hot' : ''].filter(Boolean).join(' ');
      return `<span class="${cls}" style="height:${h}px"></span>`;
    }).join('');
  }

  function statsList(id, data, colorFn, badgeFn) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!data || !Object.keys(data).length) {
      el.innerHTML = '<div class="d-empty">No ticket in the selected period</div>';
      return;
    }
    const entries = Object.entries(data).sort((a,b)=>b[1]-a[1]).slice(0,6);
    const max = entries[0][1] || 1;
    const totalAll = entries.reduce((s,[,v])=>s+v,0) || 1;
    el.innerHTML = entries.map(([k,v]) => {
      const barPct = Math.round((v/max)*100);
      const pctOfTotal = Math.round((v/totalAll)*100);
      const color = colorFn(k);
      const badge = badgeFn ? badgeFn(k) : '';
      return `<div class="d-stat-row">
        ${badge}<span class="d-stat-key" title="${k}" style="${badge?'width:52px':''}">${k}</span>
        <div class="d-stat-bar-wrap"><div class="d-stat-bar" style="width:${barPct}%;background:${color}"></div></div>
        <span class="d-stat-val">${v} · ${pctOfTotal}%</span>
      </div>`;
    }).join('');
  }

  function coloredBadge(color) {
    return `<span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;display:inline-block;margin-right:4px"></span>`;
  }

  // ── Pie charts (SVG) - Status / Domain / Priority ──────────
  function pieSlicesSVG(data, colorFn) {
    const entries = Object.entries(data || {}).filter(([,v]) => v > 0);
    const total = entries.reduce((s,[,v]) => s+v, 0);
    if (!total) return { svg: '<div class="d-empty" style="text-align:center;padding:20px 0">No data</div>', legend: '' };
    const r = 40, cx = 50, cy = 50;
    let angle = -90;
    const paths = entries.map(([k,v]) => {
      const pct = v / total;
      const sweep = pct * 360;
      const x1 = cx + r * Math.cos(angle * Math.PI/180);
      const y1 = cy + r * Math.sin(angle * Math.PI/180);
      const endAngle = angle + sweep;
      const x2 = cx + r * Math.cos(endAngle * Math.PI/180);
      const y2 = cy + r * Math.sin(endAngle * Math.PI/180);
      const largeArc = sweep > 180 ? 1 : 0;
      const color = colorFn(k);
      angle = endAngle;
      if (pct >= 0.999) {
        return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"><title>${k}: ${v} (${Math.round(pct*100)}%)</title></circle>`;
      }
      return `<path d="M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${largeArc} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" fill="${color}"><title>${k}: ${v} (${Math.round(pct*100)}%)</title></path>`;
    }).join('');
    const svg = `<svg viewBox="0 0 100 100" width="100%" height="120" style="max-width:140px">${paths}</svg>`;
    const legend = entries.sort((a,b)=>b[1]-a[1]).map(([k,v]) => {
      const pct = Math.round((v/total)*100);
      return `<div style="display:flex;align-items:center;gap:5px;font-size:10.5px;color:var(--dark);margin-bottom:3px">
        <span style="width:8px;height:8px;border-radius:2px;background:${colorFn(k)};flex-shrink:0;display:inline-block"></span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${k}">${k}</span>
        <span style="color:var(--mute)">${v} · ${pct}%</span>
      </div>`;
    }).join('');
    return { svg, legend };
  }

  function statusColor(k) { return ({'Open':'var(--p1-fg)','In Progress':'var(--p2-fg)','Resolved':'var(--ok-fg)','Closed':'var(--mute)'}[k]||'var(--mid)'); }
  function prioColor(k) { return ({P1:'var(--p1-fg)',P2:'var(--p2-fg)',P3:'var(--p3-fg)',P4:'var(--p4-fg)'}[k]||'var(--mid)'); }
  function domainPieColor(k, domainKeys) { const i = domainKeys.indexOf(k); return DOMAIN_COLORS[(i<0?0:i) % DOMAIN_COLORS.length]; }

  function renderStatsPieCharts(d) {
    const el = document.getElementById('dc-pies-body');
    if (!el) return;
    const domainKeys = Object.keys(d.by_domain || {});
    const groups = [
      { title: 'Statut',   data: d.by_status,   colorFn: statusColor },
      { title: 'Domaine',  data: d.by_domain,   colorFn: k => domainPieColor(k, domainKeys) },
      { title: 'Priority', data: d.by_priority, colorFn: prioColor },
    ];
    el.innerHTML = groups.map(g => {
      const { svg, legend } = pieSlicesSVG(g.data, g.colorFn);
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:8px;min-width:0">
        <span style="font-size:11px;font-weight:600;color:var(--dark)">${g.title}</span>
        ${svg}
        <div style="width:100%;max-width:160px">${legend}</div>
      </div>`;
    }).join('');
  }

  // ── FO scoring - combined performance (50% auto + 50% manual) ──
  // Les bandeaux viennent d'être (re)peuplés : on réapplique l'état
  // replié/déplié, sinon un ticket qui arrive les rouvre tous.
  if (typeof applyBreachCollapseDefaults === 'function') applyBreachCollapseDefaults();

  // ── INSIGHTS ─────────────────────────────────────────────
  // Uniquement des constats vérifiables à partir des tickets chargés.
  // Pas de prédiction, pas d'extrapolation : si la donnée manque, on
  // n'affiche rien plutôt que d'inventer une tendance.
  renderDashInsights(d);

  // ── KPI values ───────────────────────────────────────────
  const total   = d.total   || 0;
  const open    = d.open    || 0;
  const breach  = d.breach  || 0;
  const sla     = d.sla_compliance ?? 100;
  const resolved= d.resolved|| 0;
  const todayCt = d.today   || 0;

  set('dc-total-val',   total);
  set('dc-open-val',    open);
  set('dc-breach-val',  breach);
  set('dc-sla-val',     (d.sla_scope || 0) === 0 ? '—' : sla + '%');
  set('dc-res-val',     resolved);
  set('dc-today-val',   todayCt);

  // trend subtitles
  const activeCountry = typeof getActiveCountry === 'function' ? getActiveCountry() : 'ALL';
  set('dc-total-sub',  activeCountry === 'ALL' ? siteCodes().map(c => `${c}: ${ticketsOf(c).length}`).join(' · ') : `${activeCountry} only`);
  // « Total » et « Ouverts aujourd'hui » n'ont plus de carte : ils
  // deviennent la ligne de contexte de la carte des tickets ouverts.
  set('dc-open-sub',   `${todayCt} new today · ${total} total`);
  const bEl = document.getElementById('dc-breach-sub');
  // className écrasait la classe d-kpi-sub : le sous-titre perdait son
  // style de widget et les règles .d-kpi-sub ne l'atteignaient plus
  // (d'où un rouge foncé figé, illisible en thème sombre). On garde la
  // classe de base et on ne bascule que l'état.
  if (bEl) {
    bEl.textContent = breach > 0 ? 'to handle now' : 'All tickets within SLA';
    bEl.classList.add('d-kpi-sub');
    bEl.classList.toggle('down', breach > 0);
    bEl.classList.toggle('neu',  breach === 0);
  }
  const bValEl = document.getElementById('dc-breach-val');
  if (bValEl) bValEl.style.color = breach > 0 ? 'var(--m3-error)' : '';
  // La carte "Hors SLA" du bandeau se teinte en entier quand il y a
  // rupture : c'est le seul signal rouge du dashboard.
  const bCard = document.getElementById('dc-breach');
  if (bCard) bCard.classList.toggle('has-breach', breach > 0);
  // Le taux porte sur les tickets ayant un SLA applicable — on le dit,
  // sinon "100%" sur un périmètre vide se lit comme un vrai score.
  const slaScope = d.sla_scope || 0;
  set('dc-sla-sub', slaScope === 0
        ? 'No ticket with applicable SLA'
        : `${inSlaCount(d)}/${slaScope} within target`);
  set('dc-res-sub', total > 0
        ? `${Math.round(resolved / total * 100)}% of volume`
        : 'No closed ticket');

  // donut SLA - r=18
  const ring = document.getElementById('dc-sla-ring');
  if (ring) {
    const circ = 2 * Math.PI * 18;
    const offset = circ * (1 - sla / 100);
    ring.style.strokeDasharray  = circ.toFixed(1);
    ring.style.strokeDashoffset = offset.toFixed(1);
    // Périmètre vide → anneau neutre, pas un "100%" vert trompeur.
    const noScope = (d.sla_scope || 0) === 0;
    ring.style.stroke   = noScope ? 'var(--line)' : (sla >= 90 ? 'var(--ok-fg)' : sla >= 75 ? 'var(--c-amber)' : 'var(--m3-error)');
    ring.style.opacity  = noScope ? '0.5' : '1';
  }

  // Sparklines : séries RÉELLES sur les 7 derniers jours.
  // (Avant : by_domain*0.3 / by_domain-1 — des formes décoratives
  //  présentées comme des tendances. Supprimé.)
  const spark = d.spark || {};
  miniChart('dc-total-chart',  spark.created  || [], 'var(--line)');
  miniChart('dc-open-chart',   spark.open     || [], 'var(--line)');
  miniChart('dc-breach-chart', spark.breach   || [], breach > 0 ? 'var(--red)' : 'var(--line)');
  miniChart('dc-res-chart',    spark.resolved || [], 'var(--line)');
  miniChart('dc-today-chart',  spark.created  || [], 'var(--line)');

  // stats lists totals
  function setCardTotal(cardId, data) {
    const card = document.getElementById(cardId);
    if (!card) return;
    const total = Object.values(data||{}).reduce((s,v)=>s+v,0);
    const existing = card.querySelector('.d-card-total-sub');
    if (existing) existing.remove();
    const head = card.querySelector('.d-card-head');
    if (head) {
      const sub = document.createElement('div');
      sub.className = 'd-card-total-sub';
      sub.style.cssText = 'font-size:10.5px;color:var(--mute);margin-top:-14px;margin-bottom:8px';
      sub.textContent = total + ' ticket' + (total !== 1 ? 's' : '');
      card.insertBefore(sub, head.nextSibling);
    }
  }
  setCardTotal('dc-prio', d.by_priority);
  setCardTotal('dc-status', d.by_status);

  // ── By Domain - tuiles colorées
  renderDomainTiles(d.by_domain || {});
  statsList('dc-prio-list',   d.by_priority,
    k => ({P1:'var(--p1-fg)',P2:'var(--p2-fg)',P3:'var(--p3-fg)',P4:'var(--p4-fg)'}[k]||'var(--mid)'),
    k => coloredBadge({P1:'var(--p1-fg)',P2:'var(--p2-fg)',P3:'var(--p3-fg)',P4:'var(--p4-fg)'}[k]||'var(--mid)')
  );
  statsList('dc-status-list', d.by_status,
    k => ({'Open':'var(--p1-fg)','In Progress':'var(--p2-fg)','Resolved':'var(--ok-fg)','Closed':'var(--mute)'}[k]||'var(--mid)'),
    k => coloredBadge({'Open':'var(--p1-fg)','In Progress':'var(--p2-fg)','Resolved':'var(--ok-fg)','Closed':'var(--mute)'}[k]||'var(--mid)')
  );

  // ── Pie charts - Status / Domain / Priority
  renderStatsPieCharts(d);

  // ── Bento expressif (volume / derniers tickets / activité / charge)
  renderBentoCards(d);

  // ── FO Workload heatmap (day / week / month)
  renderFOHeatmap(window._hmPeriod || 'day');
  // legacy compat (hidden elements)
  function statsBlockLegacy(data, colorFn) {
    if (!data || !Object.keys(data).length) return '';
    const entries = Object.entries(data).sort((a,b)=>b[1]-a[1]);
    const max = entries[0][1] || 1;
    return entries.map(([k,v]) => {
      const pct = Math.round((v/max)*100);
      const color = colorFn(k);
      return `<div class="stats-row"><span class="stats-key">${k}</span><div class="stats-bar-wrap"><div class="stats-bar" style="width:${pct}%;background:${color}"></div></div><span class="stats-val">${v}</span></div>`;
    }).join('');
  }
  const sd = document.getElementById('stats-domain');   if(sd) sd.innerHTML = statsBlockLegacy(d.by_domain, ()=>'var(--red)');
  const sp = document.getElementById('stats-priority'); if(sp) sp.innerHTML = statsBlockLegacy(d.by_priority, k=>({P1:'var(--p1-fg)',P2:'var(--p2-fg)',P3:'var(--p3-fg)',P4:'var(--p4-fg)'}[k]||'var(--red)'));
  const st = document.getElementById('stats-type');     if(st) st.innerHTML = statsBlockLegacy(d.by_type, ()=>'var(--red)');
  const ss = document.getElementById('stats-status');   if(ss) ss.innerHTML = statsBlockLegacy(d.by_status, k=>({'Open':'var(--p1-fg)','In Progress':'var(--p2-fg)','Resolved':'var(--ok-fg)','Closed':'var(--ok-fg)'}[k]||'var(--dark)'));
}

