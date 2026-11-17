// ── État de l'interface du classement ─────────────────────────
const foUI = { search: '', legend: false };

let _foSearchTimer = null;
function foOnSearch() {
  const v = document.getElementById('fo-search')?.value || '';
  const clr = document.getElementById('fo-search-clear');
  if (clr) clr.style.display = v ? '' : 'none';
  clearTimeout(_foSearchTimer);
  _foSearchTimer = setTimeout(() => {
    foUI.search = v.trim().toLowerCase();
    renderFoDashboard();
  }, 150);
}

function foClearSearch() {
  const inp = document.getElementById('fo-search');
  if (inp) inp.value = '';
  foUI.search = '';
  const clr = document.getElementById('fo-search-clear');
  if (clr) clr.style.display = 'none';
  renderFoDashboard();
}

function foToggleLegend() {
  foUI.legend = !foUI.legend;
  const el = document.getElementById('fo-legend');
  const btn = document.getElementById('fo-legend-toggle');
  if (el)  el.style.display = foUI.legend ? 'flex' : 'none';
  if (btn) btn.classList.toggle('active', foUI.legend);
}

// Agrégats sur une fenêtre de N jours glissants — sert à calculer les
// deltas des tuiles KPI. Sans point de comparaison, « 56 résolus » ne
// dit pas si la semaine a été bonne.
function _foWindowAgg(daysBack, daysSpan) {
  const tracker = (document.getElementById('fo-dash-tracker') || {}).value || 'both';
  let pool = [];
  pool = pool.concat(tracker === 'both' ? allTicketsRaw() : ticketsOf(tracker));

  const to   = Date.now() - daysBack * 86400000;
  const from = to - daysSpan * 86400000;
  const inWin = d => { const t = new Date(d).getTime(); return t >= from && t < to; };

  const opened   = pool.filter(t => (t.open_date || t.created_at) && inWin(t.open_date || t.created_at));
  const resolved = pool.filter(t => t.close_date && inWin(t.close_date)
    && ['Resolved','Closed'].includes(t.status));
  const withSLA  = opened.filter(t => t.sla_status && !['N/A', 'On Hold'].includes(t.sla_status));
  const inSLA    = withSLA.filter(t => t.sla_status === 'In SLA');
  return {
    total: opened.length,
    resolved: resolved.length,
    p1: opened.filter(t => t.priority === 'P1').length,
    slaRate: withSLA.length ? Math.round(inSLA.length / withSLA.length * 100) : null,
  };
}

// Série journalière des tickets résolus, pour les sparklines des tuiles.
function _foDailySeries(days = 10) {
  const tracker = (document.getElementById('fo-dash-tracker') || {}).value || 'both';
  let pool = [];
  pool = pool.concat(tracker === 'both' ? allTicketsRaw() : ticketsOf(tracker));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0,10);
    out.push(pool.filter(t => (t.close_date || '').slice(0,10) === key
      && ['Resolved','Closed'].includes(t.status)).length);
  }
  return out;
}

async function renderFoDashboard() {
  _renderFoEvolutionChart();
  // La Trust Matrix a migré vers Admin › Performance FO : c'est un outil
  // d'encadrement, pas un contenu de tableau de bord d'équipe.
  const vis    = await _loadKpiVisibility();
  const foList = (state.config.fo_list || []).filter(fo =>
    getActiveCountry() === 'ALL' || personInScope(fo, getActiveCountry()));
  let ranked = foList.map(fo => {
    const stats = _calcFoStats(fo);
    const quizBonus = _foQuizBonus(fo);
    const { items, score } = _foScoreBreakdown({ ...stats, quizBonus });
    return { fo, ...stats, score, scoreItems: items, quizBonus };
  });
  ranked.sort((a, b) => b.score - a.score || b.resolved - a.resolved || a.breach - b.breach);

  // Global aggregates for KPI bar
  const agg = { total: 0, open: 0, inProgress: 0, resolved: 0, breach: 0, p1: 0 };
  ranked.forEach(r => {
    agg.total      += r.total;
    agg.open       += r.open;
    agg.inProgress += r.inProgress;
    agg.resolved   += r.resolved;
    agg.breach     += r.breach;
    agg.p1         += r.p1;
  });
  const allTickets = allTicketsRaw();
  const withSLA    = allTickets.filter(t => t.sla_status && !['N/A', 'On Hold'].includes(t.sla_status));
  const inSLA      = withSLA.filter(t => t.sla_status === 'In SLA');
  agg.slaRate      = withSLA.length ? Math.round((inSLA.length / withSLA.length) * 100) : 100;
  const resolvedAll = allTickets.filter(t => ['Resolved','Closed'].includes(t.status) && t.duration_ms > 0);
  const avgMs      = resolvedAll.length ? resolvedAll.reduce((s,t) => s+(t.duration_ms||0),0) / resolvedAll.length : null;
  agg.avgResolution = avgMs
    ? (avgMs < 3600000 ? `${Math.round(avgMs/60000)} min` : `${(avgMs/3600000).toFixed(1)} h`)
    : 'N/A';

  const act = _foActivityStats(ranked);
  _renderFoKudos();
  _renderFoGoals(agg, act);
  _renderFoActivity(act);

  // ── Tuiles KPI : valeur + delta vs 7 jours précédents ─────────
  const kpiBar = document.getElementById('fo-kpi-bar');
  if (kpiBar) {
    const eyeOn  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    const eyeOff = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

    const cur  = _foWindowAgg(0, 7);
    const prev = _foWindowAgg(7, 7);
    const series = _foDailySeries(10);
    const sparkMax = Math.max(...series, 1);
    // Pour « Hors SLA », une hausse est mauvaise : le sens du delta
    // dépend de l'indicateur.
    const DELTA = {
      total:    { key: 'total',    good: 'up'   },
      resolved: { key: 'resolved', good: 'up'   },
      p1:       { key: 'p1',       good: 'down' },
      sla_rate: { key: 'slaRate',  good: 'up', unit: 'pt' },
    };

    kpiBar.innerHTML = FO_KPI_DEFS.map(k => {
      const isOn = vis[k.id] !== false;
      let val = agg[k.agg];
      if (k.fmt) val = k.fmt(val);
      const display = (val === undefined || val === null) ? '-' : val;

      // Delta : seulement là où une comparaison a du sens.
      let deltaHtml = '';
      const d = DELTA[k.id];
      if (isOn && d && cur[d.key] != null && prev[d.key] != null) {
        const diff = cur[d.key] - prev[d.key];
        const dir  = diff === 0 ? 'flat' : (diff > 0) === (d.good === 'up') ? 'up' : 'down';
        const arrow = diff === 0 ? '→' : diff > 0 ? '↑' : '↓';
        deltaHtml = `<span class="fo-kpi-delta ${dir}" title="vs previous 7 days">${arrow} ${Math.abs(diff)}${d.unit || ''}</span>`;
      }
      // Sparkline sur les tuiles de volume résolu.
      const sparkHtml = (isOn && k.id === 'resolved')
        ? `<div class="fo-kpi-spark">${series.map(n =>
            `<i style="height:${Math.max(Math.round(n / sparkMax * 100), 3)}%"></i>`).join('')}</div>`
        : '';

      return `<div class="fo-kpi${isOn?'':' off'}">
        <button class="fo-kpi-eye" onclick="_toggleKpiVisible('${k.id}',${!isOn})" title="${isOn?'Hide this KPI':'Show this KPI'}">${isOn?eyeOn:eyeOff}</button>
        <div class="fo-kpi-label">${k.label}</div>
        <div class="fo-kpi-row">
          <div class="fo-kpi-val">${isOn ? display : '-'}</div>
          ${deltaHtml}
        </div>
        ${sparkHtml}
      </div>`;
    }).join('');
  }

  // Sort toolbar
  const sortKey = window._foRankSort || null;
  const sortBar = document.getElementById('fo-rank-sort');
  if (sortBar) {
    const sortBtns = [
      { key: null,       label: 'Score' },
      { key: 'resolved', label: 'Resolved' },
      { key: 'breach',   label: 'SLA breach' },
    ];
    sortBar.innerHTML = sortBtns.map(b => {
      const active = (b.key === null && !sortKey) || (sortKey && sortKey.key === b.key);
      const arrow  = (sortKey && sortKey.key === b.key) ? (sortKey.dir === 1 ? ' ↑' : ' ↓') : '';
      return `<button class="${active?'active':''}" onclick="_sortFoRanking(${b.key===null?'null':`'${b.key}'`})">${b.label}${arrow}</button>`;
    }).join('');
  }

  // ── Podium ────────────────────────────────────────────────────
  // Repose sur le classement au score, jamais sur le tri courant :
  // un podium qui change en triant par « Hors SLA » n'est plus un podium.
  const podEl = document.getElementById('fo-podium');
  if (podEl) {
    const top = ranked.slice(0, 3);
    const medals = ['🥇', '🥈', '🥉'];
    // Masqué en recherche : le podium n'est pas un résultat de recherche.
    podEl.style.display = (top.length === 3 && !foUI.search) ? 'grid' : 'none';
    if (top.length === 3 && !foUI.search) {
      podEl.innerHTML = top.map((r, i) => `
        <div class="fo-pod fo-pod-${i+1}" onclick="_toggleFoDetail('${esc(r.fo).replace(/'/g,"\\'")}')">
          <span class="fo-pod-medal">${medals[i]}</span>
          <div class="fo-pod-av" style="background:${foAvatarColor(r.fo)}">${foInitials(r.fo)}</div>
          <div class="fo-pod-name" title="${esc(r.fo)}">${esc(r.fo)}</div>
          <div class="fo-pod-score">${r.score}</div>
          <div class="fo-pod-meta">${r.resolved} resolved · ${r.slaRate}% SLA</div>
        </div>`).join('');
    }
  }

  // Ranking list
  const rankTable = document.getElementById('fo-ranking-table');
  if (!rankTable) return;
  if (!ranked.length) {
    rankTable.innerHTML = '<div class="fo-rank-empty">No FO configured.</div>';
    return;
  }

  // Apply sort if user picked a column other than the default score-based ranking
  let displayed = ranked;
  if (sortKey) {
    const { key, dir } = sortKey;
    displayed = [...ranked].sort((a, b) => (a[key] - b[key]) * dir);
  }
  if (foUI.search) {
    displayed = displayed.filter(r => r.fo.toLowerCase().includes(foUI.search));
  }
  if (!displayed.length) {
    rankTable.innerHTML = `<div class="fo-rank-empty">No Front Office matches “${esc(foUI.search)} ».</div>`;
    return;
  }

  const maxScore = Math.max(...ranked.map(r => r.score), 1);

  rankTable.innerHTML = `<div class="fo-rank">${displayed.map((r) => {
    const rankIndex = ranked.indexOf(r);
    const tr        = personSite(r.fo);
    const trCls     = String(tr || '').toLowerCase();
    const safeFo    = esc(r.fo).replace(/'/g,"\\'");
    const rowId     = `fo-detail-${rankIndex}`;
    const initials  = foInitials(r.fo);
    const isTop3    = rankIndex < 3;
    const posCell   = `<span class="fo-rank-num${isTop3?' top':''}">${rankIndex+1}</span>`;

    const detailRows = r.scoreItems.map(it => `
      <div class="fo-detail-row">
        <span class="fo-detail-row-lbl">${it.label} <small>(${it.detail})</small></span>
        <span class="fo-detail-pts ${it.pts >= 0 ? 'pos' : 'neg'}">${it.pts >= 0 ? '+' : ''}${it.pts}</span>
      </div>`).join('');

    return `<div class="fo-rank-row" id="row-${rowId}" onclick="_toggleFoDetail('${safeFo}')">
        <div class="fo-rank-pos">${posCell}</div>
        <div class="fo-rank-av" style="background:${foAvatarColor(r.fo)}">${initials}</div>
        <div class="fo-rank-id">
          <div class="fo-rank-name">${foHi(r.fo)}</div>
          <div class="fo-rank-tracker ${trCls}">${tr}</div>
        </div>
        <div class="fo-rank-stat">
          <div class="fo-rank-stat-val" style="color:var(--fod-ok-on)">${r.resolved}</div>
          <div class="fo-rank-stat-lbl">Resolved</div>
        </div>
        <div class="fo-rank-stat">
          <div class="fo-rank-stat-val" style="color:${r.breach > 0 ? 'var(--fod-err-on)' : 'var(--m3-on-surf-var)'}">${r.breach}</div>
          <div class="fo-rank-stat-lbl">SLA breach</div>
        </div>
        <div class="fo-rank-stat">
          <div class="fo-rank-stat-val" style="color:${r.slaRate >= 90 ? 'var(--fod-ok-on)' : r.slaRate >= 70 ? 'var(--fod-warn-on)' : 'var(--fod-err-on)'}">${r.slaRate}%</div>
          <div class="fo-rank-stat-lbl">SLA</div>
        </div>
        <div class="fo-rank-bar" title="${r.score} pts of ${maxScore}">
          <div class="fo-rank-bar-fill" style="width:${Math.round(r.score / maxScore * 100)}%"></div>
        </div>
        <div class="fo-rank-score">
          <div class="fo-rank-score-val">${r.score}</div>
          <div class="fo-rank-score-lbl">Score</div>
        </div>
        <svg class="fo-rank-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="fo-rank-detail" id="${rowId}">
        <div class="fo-detail-grid">
          <div>
            <div class="fo-detail-h">Why this score?</div>
            ${detailRows}
            <div class="fo-detail-total">
              <span>Score total</span><span>${r.score} pts</span>
            </div>
          </div>
          <div>
            <div class="fo-detail-h">Score history</div>
            ${_renderFoScoreSparkline(_foScoreHistory(r.fo))}
          </div>
          <div>
            <div class="fo-detail-h">Quiz</div>
            ${_renderFoQuizSummary(r.fo)}
          </div>
        </div>
      </div>`;
  }).join('')}</div>`;
}

// Surlignage du terme recherché dans les noms de FO.
function foHi(text) {
  const s = esc(text == null ? '' : String(text));
  if (!foUI.search) return s;
  const needle = foUI.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return s.replace(new RegExp(`(${needle})`, 'gi'), '<mark class="fo-mark">$1</mark>');
}

