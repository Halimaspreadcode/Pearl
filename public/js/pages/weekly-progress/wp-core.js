// ══════════════════════════════════════════════════════════════
// WEEKLY PROGRESS
// La page répond à une question : « où en est-on cette semaine, et
// qu'est-ce qui traîne ? ». Tout le reste (tri, filtres, vues) sert
// à raffiner cette réponse, jamais à la remplacer.
//
// Choix structurants :
//  · l'état de lecture (semaine, filtres, vue) est persisté dans
//    localStorage — revenir sur la page ne doit pas tout réarmer ;
//  · les mutations de statut sont optimistes : le clic répond
//    immédiatement, le serveur suit. Un échec restaure l'état.
// ══════════════════════════════════════════════════════════════

let progressAnchorDate = new Date().toISOString().slice(0, 10);
const PROGRESS_STATUSES = ['Planned', 'In Progress', 'Done'];
const PROGRESS_STATUS_CLS = { Planned: 'badge-na', 'In Progress': 'badge-inprogress', Done: 'badge-resolved' };

// Une seule table de vérité pour l'apparence d'un statut : libellé,
// suffixe de classe et jeton de couleur. Les vues piochent ici au
// lieu de redéfinir chacune sa correspondance.
const WP_STATUS = {
  'Planned':     { key: 'plan', label: 'Planned',  c: 'var(--wp-plan)', cc: 'var(--wp-plan-cont)' },
  'In Progress': { key: 'prog', label: 'In progress', c: 'var(--wp-prog)', cc: 'var(--wp-prog-cont)' },
  'Done':        { key: 'done', label: 'Done',      c: 'var(--wp-done)', cc: 'var(--wp-done-cont)' },
};
const WP_LATE = { key: 'late', label: 'Overdue', c: 'var(--wp-late)', cc: 'var(--wp-late-cont)' };

const WP_PREFS_KEY = 'wp.prefs.v1';
let progressView = 'board';
let wpFilter = '';          // '' | 'Planned' | 'In Progress' | 'Done' | 'late'
let wpOwner = '';           // '' = toute l'équipe
let wpSort = 'smart';
let wpSearch = '';
let wpSearchTimer = null;
let editingProgressId = null;

function _wpLoadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(WP_PREFS_KEY) || '{}');
    if (p.view && ['board', 'list', 'timeline', 'insights', 'report'].includes(p.view)) progressView = p.view;
    if (typeof p.sort === 'string') wpSort = p.sort;
    if (typeof p.owner === 'string') wpOwner = p.owner;
  } catch (_) { /* préférence corrompue : on repart des défauts */ }
}
function _wpSavePrefs() {
  try {
    localStorage.setItem(WP_PREFS_KEY, JSON.stringify({ view: progressView, sort: wpSort, owner: wpOwner }));
  } catch (_) { /* quota / mode privé : la page marche sans */ }
}
_wpLoadPrefs();

// ── Semaines ──────────────────────────────────────────────────
function _progressWeekRange(dateStr) {
  const d = new Date(dateStr);
  const dow = d.getDay() === 0 ? 7 : d.getDay();
  const mon = new Date(d); mon.setDate(d.getDate() - dow + 1); mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  return { weekStart: mon.toISOString().slice(0, 10), weekEnd: sun };
}

const _wpCurWeek = () => _progressWeekRange(new Date().toISOString().slice(0, 10)).weekStart;

// Décale une date de semaine de n semaines (n négatif = passé).
function _wpShiftWeek(weekStart, n) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + n * 7);
  return d.toISOString().slice(0, 10);
}

function changeProgressWeek(delta) {
  const d = new Date(progressAnchorDate);
  d.setDate(d.getDate() + delta * 7);
  progressAnchorDate = d.toISOString().slice(0, 10);
  renderWeeklyProgress();
}

function goToProgressWeek() {
  const v = document.getElementById('progress-sel-date')?.value;
  if (v) { progressAnchorDate = v; renderWeeklyProgress(); }
}

function goToThisWeek() {
  progressAnchorDate = new Date().toISOString().slice(0, 10);
  renderWeeklyProgress();
}

// ── Filtres / tri ─────────────────────────────────────────────
function wpSetFilter(f) {
  wpFilter = (wpFilter === f) ? '' : f;   // re-cliquer une tuile active la désarme
  renderWeeklyProgress();
}
function wpSetOwner(v) { wpOwner = v; _wpSavePrefs(); renderWeeklyProgress(); }
// Bandeau « en retard » filtré sur un agent : ses tâches à rattraper,
// sur la semaine la plus ancienne, plutôt que l'analyse d'équipe.
function wpShowCarry(week) {
  progressAnchorDate = week; wpFilter = 'late';
  if (progressView !== 'list') progressView = 'board';
  _wpSavePrefs(); renderWeeklyProgress();
}
function wpSetSort(v) { wpSort = v; _wpSavePrefs(); renderWeeklyProgress(); }

// La frappe ne doit pas relancer un rendu complet à chaque touche.
function wpOnSearch(v) {
  wpSearch = v;
  document.querySelector('#page-weekly-progress .wp-search')?.classList.toggle('has-value', !!v);
  clearTimeout(wpSearchTimer);
  wpSearchTimer = setTimeout(() => renderWeeklyProgress(), 160);
}
function wpClearSearch() {
  const input = document.getElementById('wp-search');
  if (input) input.value = '';
  wpSearch = '';
  document.querySelector('#page-weekly-progress .wp-search')?.classList.remove('has-value');
  renderWeeklyProgress();
}
function wpClearFilters() {
  wpFilter = ''; wpOwner = ''; wpSearch = '';
  const input = document.getElementById('wp-search');
  if (input) input.value = '';
  document.querySelector('#page-weekly-progress .wp-search')?.classList.remove('has-value');
  _wpSavePrefs();
  renderWeeklyProgress();
}

function setProgressView(view) {
  progressView = view;
  _wpSavePrefs();
  renderWeeklyProgress();
}

// Un item est « en retard » s'il n'est pas fait et que sa semaine est
// strictement antérieure à la semaine courante.
function _isProgressDelayed(item) {
  if (item.status === 'Done') return false;
  return item.week_start < _wpCurWeek();
}

// ── Utilitaires d'affichage ───────────────────────────────────
function _wpInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

// Couleur d'avatar dérivée du nom : stable d'un rendu à l'autre et
// sans table à maintenir quand l'équipe change.
const WP_AV_COLORS = ['#1A73E8', '#1E8E3E', '#E37400', '#9334E6', '#C7000B', '#00838F', '#5F6368', '#AD1457'];
function _wpAvatarColor(name) {
  let h = 0;
  const s = String(name || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return WP_AV_COLORS[h % WP_AV_COLORS.length];
}
function _wpAvatar(name) {
  return `<span class="wp-av" style="background:${_wpAvatarColor(name)}" title="${esc(name || 'Unassigned')}">${esc(_wpInitials(name))}</span>`;
}

function _wpFmtDate(d) {
  const { locale, tz } = getLangConfig();
  return new Date(d).toLocaleDateString(locale, { timeZone: tz, day: 'numeric', month: 'short' });
}

// Met en évidence les occurrences de la recherche : sans ça, sur une
// tâche de 200 caractères, on ne voit pas pourquoi elle a matché.
function _wpHighlight(text, q) {
  const safe = esc(text);
  if (!q) return safe;
  const needle = esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return safe.replace(new RegExp(needle, 'gi'),
      m => `<mark style="background:var(--wp-prog-cont);color:var(--wp-prog);border-radius:3px;padding:0 2px">${m}</mark>`);
  } catch (_) { return safe; }
}

// ── Sélection des données ─────────────────────────────────────
// Renvoie les items de la semaine affichée, avant filtres d'écran :
// les tuiles doivent compter sur cette base, sinon elles changeraient
// de valeur en fonction du filtre qu'elles pilotent.
function _wpWeekItems() {
  const { weekStart } = _progressWeekRange(progressAnchorDate);
  const country = getActiveCountry();
  return (state.weeklyProgress || []).filter(p =>
    p.week_start === weekStart && (country === 'ALL' || p.tracker === country));
}

// Applique recherche + FO + tuile-filtre, puis trie.
function _wpVisibleItems(base) {
  const q = wpSearch.trim().toLowerCase();
  let items = base.filter(p => {
    if (wpOwner && p.modified_by !== wpOwner) return false;
    if (wpFilter === 'late') { if (!_isProgressDelayed(p)) return false; }
    else if (wpFilter && p.status !== wpFilter) return false;
    if (q) {
      const hay = `${p.task || ''} ${p.modified_by || ''} ${p.tracker || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Tri « intelligent » : ce qui demande une action remonte. Retard
  // d'abord, puis en cours, planifié, et enfin ce qui est fait.
  const rank = { 'In Progress': 1, 'Planned': 2, 'Done': 3 };
  const cmp = {
    smart: (a, b) => (_isProgressDelayed(b) - _isProgressDelayed(a))
      || (rank[a.status] || 9) - (rank[b.status] || 9)
      || String(a.task || '').localeCompare(String(b.task || '')),
    status: (a, b) => (rank[a.status] || 9) - (rank[b.status] || 9),
    owner: (a, b) => String(a.modified_by || '').localeCompare(String(b.modified_by || '')),
    recent: (a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')),
    alpha: (a, b) => String(a.task || '').localeCompare(String(b.task || '')),
  }[wpSort] || null;
  if (cmp) items = items.slice().sort(cmp);
  return items;
}

function _wpStats(items) {
  const done = items.filter(p => p.status === 'Done').length;
  const prog = items.filter(p => p.status === 'In Progress').length;
  const plan = items.filter(p => p.status === 'Planned').length;
  const late = items.filter(_isProgressDelayed).length;
  return {
    total: items.length, done, prog, plan, late,
    pct: items.length ? Math.round(done / items.length * 100) : 0,
  };
}

// ── Rendu principal ───────────────────────────────────────────
function renderWeeklyProgress() {
  const el = document.getElementById('weekly-progress-list');
  if (!el) return;

  const { weekStart, weekEnd } = _progressWeekRange(progressAnchorDate);
  const dateSel = document.getElementById('progress-sel-date');
  if (dateSel) dateSel.value = progressAnchorDate;

  _wpRenderWeekBar(weekStart, weekEnd);
  _wpRenderOwnerFilter();

  const sortSel = document.getElementById('wp-sort');
  if (sortSel) sortSel.value = wpSort;

  document.querySelectorAll('#page-weekly-progress .wp-tab').forEach(t => {
    const on = t.dataset.view === progressView;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });

  const base = _wpWeekItems();
  // Tuiles et bandeau suivent le FO choisi (pas les autres filtres, que
  // les tuiles pilotent) : filtré sur un agent, « 0 / 12 » serait l'équipe.
  const stats = _wpStats(wpOwner ? base.filter(p => p.modified_by === wpOwner) : base);

  _wpRenderOverview(stats, weekStart);
  _wpRenderInsight(stats, weekStart);
  _wpRenderActiveFilters();

  // Tendance et Analyse regardent au-delà de la semaine : elles ne
  // passent pas par la sélection hebdomadaire.
  if (progressView === 'timeline') { _wpRenderTimeline(el, weekStart); return; }
  if (progressView === 'insights') { _wpRenderInsightsView(el, weekStart); return; }
  if (progressView === 'report')   { _wpRenderReport(el, weekStart); return; }

  const items = _wpVisibleItems(base);

  if (!items.length) { el.innerHTML = _wpEmptyState(base.length); return; }

  if (progressView === 'list') _wpRenderList(el, items);
  else _wpRenderBoard(el, items);
}

function _wpRenderWeekBar(weekStart, weekEnd) {
  const { locale, tz } = getLangConfig();
  const s = new Date(weekStart);
  const sameMonth = s.getMonth() === weekEnd.getMonth();
  const fmtS = s.toLocaleDateString(locale, { timeZone: tz, day: 'numeric', ...(sameMonth ? {} : { month: 'short' }) });
  const fmtE = weekEnd.toLocaleDateString(locale, { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric' });
  const range = document.getElementById('wp-week-range');
  if (range) range.textContent = `${fmtS} – ${fmtE}`;

  const cur = _wpCurWeek();
  const tag = document.getElementById('wp-week-tag');
  if (tag) {
    tag.className = 'wp-weekpick-tag';
    if (weekStart === cur) tag.textContent = 'This week';
    else if (weekStart === _wpShiftWeek(cur, -1)) { tag.textContent = 'Last week'; tag.classList.add('is-past'); }
    else if (weekStart > cur) { tag.textContent = 'Upcoming'; tag.classList.add('is-future'); }
    else {
      const n = Math.round((new Date(cur) - new Date(weekStart)) / 6048e5);
      tag.textContent = `${n} weeks ago`; tag.classList.add('is-past');
    }
  }
  const todayBtn = document.getElementById('wp-today-btn');
  if (todayBtn) todayBtn.disabled = (weekStart === cur);

  const country = getActiveCountry();
  const sub = document.getElementById('wp-subtitle');
  if (sub) sub.textContent = `What the team delivered · ${country === 'ALL' ? 'Dakar + Abidjan' : (country === 'CI' ? 'Abidjan (CI)' : 'Dakar (SN)')}`;
}

// La liste des FO se construit à partir des données réelles : pas de
// liste figée qui se désynchronise quand l'équipe change.
function _wpRenderOwnerFilter() {
  const sel = document.getElementById('wp-owner-filter');
  if (!sel) return;
  const country = getActiveCountry();
  const owners = [...new Set((state.weeklyProgress || [])
    .filter(p => country === 'ALL' || p.tracker === country)
    .map(p => p.modified_by).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  const sig = owners.join('|');
  if (sel.dataset.sig !== sig) {
    sel.dataset.sig = sig;
    sel.innerHTML = `<option value="">Whole team</option>`
      + owners.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
  }
  // Le FO filtré peut avoir disparu du périmètre (changement de pays).
  if (wpOwner && !owners.includes(wpOwner)) wpOwner = '';
  sel.value = wpOwner;
}

function _wpRenderOverview(st, weekStart) {
  const el = document.getElementById('wp-overview');
  if (!el) return;

  // Comparaison à la semaine précédente : un pourcentage nu ne dit pas
  // si l'équipe progresse ou décroche.
  const country = getActiveCountry();
  const prevWeek = _wpShiftWeek(weekStart, -1);
  const prev = (state.weeklyProgress || []).filter(p =>
    p.week_start === prevWeek && (country === 'ALL' || p.tracker === country)
    && (!wpOwner || p.modified_by === wpOwner));
  const prevPct = prev.length ? Math.round(prev.filter(p => p.status === 'Done').length / prev.length * 100) : null;
  const delta = prevPct === null ? null : st.pct - prevPct;

  const R = 28, C = 2 * Math.PI * R;
  const ringColor = st.pct >= 80 ? 'var(--wp-done)' : st.pct >= 50 ? 'var(--wp-prog)' : 'var(--wp-late)';

  // Semaine encore vide : une chute de « 69 pts » n'aurait aucun sens.
  const deltaHtml = !st.total
    ? `<span>nothing planned yet</span>`
    : delta === null
    ? `<span>no comparison</span>`
    : delta === 0
      ? `<span>flat vs last week</span>`
      : `<span class="wp-delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)} pts</span> vs last week`;

  const tile = (key, label, value, hint, color, cont, dot) => `
    <button class="wp-tile ${wpFilter === key ? 'on' : ''} ${value === 0 ? 'is-zero' : ''}"
            style="--wp-c:${color};--wp-cc:${cont}"
            onclick="wpSetFilter('${key}')"
            aria-pressed="${wpFilter === key}"
            title="${wpFilter === key ? 'Click to remove the filter' : 'Click to filter'}">
      <span class="wp-tile-k">${dot ? `<span class="wp-tile-dot" style="background:${color}"></span>` : ''}${label}</span>
      <span class="wp-tile-v">${value}</span>
      <span class="wp-tile-hint">${hint}</span>
    </button>`;

  el.innerHTML = `
    <div class="wp-tile wp-tile-hero">
      <div class="wp-ring">
        <svg width="66" height="66" viewBox="0 0 66 66" aria-hidden="true">
          <circle class="wp-ring-bg" cx="33" cy="33" r="${R}" stroke-width="7"/>
          <circle class="wp-ring-fg" cx="33" cy="33" r="${R}" stroke-width="7"
                  style="stroke:${ringColor};stroke-dasharray:${C.toFixed(1)};stroke-dashoffset:${(C * (1 - st.pct / 100)).toFixed(1)}"/>
        </svg>
        <div class="wp-ring-label">${st.pct}%</div>
      </div>
      <div class="wp-hero-txt">
        <div class="wp-hero-k">Completion</div>
        <div class="wp-hero-v">${st.done} / ${st.total} delivered</div>
        <div class="wp-hero-d">${deltaHtml}</div>
      </div>
    </div>
    ${tile('Done', 'Done', st.done, st.total ? `${st.pct}% of total` : '—', 'var(--wp-done)', 'var(--wp-done-cont)', true)}
    ${tile('In Progress', 'In progress', st.prog, st.prog ? 'to finish this week' : 'nothing in progress', 'var(--wp-prog)', 'var(--wp-prog-cont)', true)}
    ${tile('Planned', 'Planned', st.plan, st.plan ? 'not started yet' : 'all started', 'var(--wp-plan)', 'var(--wp-plan-cont)', true)}
    ${tile('late', 'Overdue', st.late, st.late ? 'carried over from past weeks' : 'no carry-over', 'var(--wp-late)', 'var(--wp-late-cont)', true)}
  `;
}

// Un seul message, celui qui mérite une action maintenant. Empiler
// trois bandeaux revient à n'en afficher aucun.
function _wpRenderInsight(st, weekStart) {
  const el = document.getElementById('wp-insight');
  if (!el) return;

  const country = getActiveCountry();
  // Le filtre « FO » s'applique aussi au report : filtré sur un agent
  // (My Space l'ouvre ainsi), le bandeau ne doit compter que les siens.
  const carry = (state.weeklyProgress || []).filter(p =>
    (country === 'ALL' || p.tracker === country) && (!wpOwner || p.modified_by === wpOwner)
    && _isProgressDelayed(p));

  const ICO = {
    warn: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M1 21h22L12 2zm12-3h-2v-2h2zm0-4h-2v-4h2z"/></svg>',
    ok: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m1 15h-2v-6h2zm0-8h-2V7h2z"/></svg>',
  };
  const banner = (ico, c, cc, html, act) => `
    <div class="wp-insight" style="--wp-if:${c};--wp-ic:${cc}">
      ${ico}<div>${html}</div>${act || ''}
    </div>`;

  // Priority 1 : le report accumulé — c'est ce qui coule une équipe.
  if (carry.length) {
    const oldest = carry.reduce((a, b) => (a.week_start < b.week_start ? a : b));
    const weeks = Math.max(1, Math.round((new Date(_wpCurWeek()) - new Date(oldest.week_start)) / 6048e5));
    return void (el.innerHTML = banner(ICO.warn, 'var(--wp-late)', 'var(--wp-late-cont)',
      `<b>${carry.length} item${carry.length > 1 ? 's' : ''} overdue</b> from past weeks — the oldest has been dragging for ${weeks} week${weeks > 1 ? 's' : ''}.`,
      wpOwner
        ? `<button class="wp-insight-act" onclick="wpShowCarry('${oldest.week_start}')">Show them</button>`
        : `<button class="wp-insight-act" onclick="setProgressView('insights')">View details</button>`));
  }
  if (!st.total) { el.innerHTML = ''; return; }
  if (st.pct === 100) {
    return void (el.innerHTML = banner(ICO.ok, 'var(--wp-done)', 'var(--wp-done-cont)',
      `<b>Week wrapped up.</b> All ${st.total} items delivered and nothing carried over.`, ''));
  }
  if (st.plan && !st.prog) {
    return void (el.innerHTML = banner(ICO.info, 'var(--wp-info)', 'var(--wp-info-cont)',
      `<b>${st.plan} item${st.plan > 1 ? 's' : ''} planned</b> but none started — drag a card to “In progress” to kick off the week.`,
      `<button class="wp-insight-act" onclick="setProgressView('board')">Open the board</button>`));
  }
  el.innerHTML = banner(ICO.info, 'var(--wp-info)', 'var(--wp-info-cont)',
    `<b>${st.prog + st.plan} item${st.prog + st.plan > 1 ? 's' : ''} remaining</b> to reach 100 % this week.`, '');
}

function _wpRenderActiveFilters() {
  const el = document.getElementById('wp-activefilters');
  if (!el) return;
  const chips = [];
  const x = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';

  if (wpFilter) {
    const meta = wpFilter === 'late' ? WP_LATE : WP_STATUS[wpFilter];
    chips.push(`<span class="wp-fchip">${esc(meta ? meta.label : wpFilter)}<button onclick="wpSetFilter('${wpFilter}')" aria-label="Remove status filter">${x}</button></span>`);
  }
  if (wpOwner) chips.push(`<span class="wp-fchip">${esc(wpOwner)}<button onclick="wpSetOwner('')" aria-label="Remove FO filter">${x}</button></span>`);
  if (wpSearch.trim()) chips.push(`<span class="wp-fchip">« ${esc(wpSearch.trim())} »<button onclick="wpClearSearch()" aria-label="Clear search">${x}</button></span>`);

  el.innerHTML = chips.length
    ? chips.join('') + (chips.length > 1 ? `<button class="wp-fclear" onclick="wpClearFilters()">Clear all</button>` : '')
    : '';
}

