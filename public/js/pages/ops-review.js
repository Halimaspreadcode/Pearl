// ══════════════════════════════════════════════════════════════
// OPS REVIEW PAGE  — restricted access, global incidents view
// ══════════════════════════════════════════════════════════════

let orUnlocked = false;
let _orSnData  = [];
let _orCiData  = [];

function _renderOpsReviewPage() {
  adminGate('or', () => { orUnlocked = true; _orLoadAndRender(); });
}

async function verifyOpsReview() {
  await adminUnlock('or', () => {
    orUnlocked = true;
    document.getElementById('or-login-screen').style.display = 'none';
    document.getElementById('or-main-screen').style.display  = 'block';
    _orLoadAndRender();
  });
}

async function _orLoadAndRender() {
  const [sn, ci] = await Promise.all([
    fetch(`${API}/api/sn`).then(r => r.json()),
    fetch(`${API}/api/ci`).then(r => r.json()),
  ]);
  _orSnData = sn;
  _orCiData = ci;
  _orPopulateFilters();
  renderOpsReview();
}

// Le périmètre pays de la page, comme partout ailleurs dans l'app :
// 'SN' / 'CI' pour une filiale, 'ALL' pour la vue Global. Les tickets
// n'ont pas de champ pays — c'est le tracker d'origine qui le porte.
function _orCountryScope() {
  const c = typeof getActiveCountry === 'function' ? getActiveCountry() : 'ALL';
  return c === 'CI' ? 'CI' : c === 'ALL' ? 'ALL' : 'SN';
}

function _orGetFiltered() {
  const fWeek      = document.getElementById('or-filter-week')?.value      || '';
  const fAffiliate = document.getElementById('or-filter-affiliate')?.value || '';
  const fPriority  = document.getElementById('or-filter-priority')?.value  || '';
  const fStatus    = document.getElementById('or-filter-status')?.value    || '';
  const fType      = document.getElementById('or-filter-type')?.value      || '';
  const fDomain    = document.getElementById('or-filter-domain')?.value    || '';

  // Le sélecteur de pays de l'en-tête décide du périmètre avant tout
  // filtre local : sur « Sénégal », la page ne parle que d'OSN. En
  // « Global », les deux filiales sont réunies et le filtre Filiale
  // reprend la main.
  const scope = _orCountryScope();

  let combined = [];
  // fType: '' = tout, 'sn' = incidents seuls, 'ci-all'/'ci-bug'/'ci-nobug' = problèmes
  const includeSN = (fType === '' || fType === 'sn') && scope !== 'CI';
  const includeCI = (fType === '' || fType === 'ci-all' || fType === 'ci-bug' || fType === 'ci-nobug') && scope !== 'SN';
  if (includeSN) combined = combined.concat(_orSnData.map(t => ({ ...t, _src: 'OSN' })));
  if (includeCI) combined = combined.concat(_orCiData.map(t => ({ ...t, _src: 'OCI' })));

  return combined.filter(t => {
    if (fPriority  && t.priority !== fPriority)  return false;
    if (fStatus    && t.status   !== fStatus)     return false;
    if (fDomain    && t.domain   !== fDomain)     return false;
    if (fAffiliate && t._src     !== fAffiliate)  return false;
    // Sous-filtre type CI : Bug / non Bug
    if (fType === 'ci-bug'   && t._src === 'OCI' && t.type !== 'Problem Bug')     return false;
    if (fType === 'ci-nobug' && t._src === 'OCI' && t.type !== 'Problem non Bug') return false;
    if (fWeek) {
      const d = new Date(t.open_date || t.occur_time || t.detection_time);
      if (isNaN(d)) return false;
      const w = _orIsoWeek(d);
      if (w !== fWeek) return false;
    }
    return true;
  });
}

function _orIsoWeek(d) {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const y  = dt.getUTCFullYear();
  const w  = Math.ceil(((dt - new Date(Date.UTC(y, 0, 1))) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2,'0')}`;
}

function _orPopulateFilters() {
  // Semaines et domaines sont tirés du périmètre courant : proposer une
  // semaine absente du pays sélectionné mène à une page vide.
  const scope = _orCountryScope();
  const all = [
    ...(scope === 'CI' ? [] : _orSnData.map(t => ({ ...t, _src: 'OSN' }))),
    ...(scope === 'SN' ? [] : _orCiData.map(t => ({ ...t, _src: 'OCI' })))
  ];

  // Weeks
  const weeks = [...new Set(all.map(t => {
    const d = new Date(t.open_date || t.occur_time || t.detection_time);
    return isNaN(d) ? null : _orIsoWeek(d);
  }).filter(Boolean))].sort().reverse();
  const wSel = document.getElementById('or-filter-week');
  if (wSel) {
    const cur = wSel.value;
    wSel.innerHTML = '<option value="">All weeks</option>' +
      weeks.map(w => `<option value="${w}" ${cur===w?'selected':''}>${w}</option>`).join('');
  }

  // Filiale = OSN ou OCI (filtre statique, toujours présent)
  const aSel = document.getElementById('or-filter-affiliate');
  if (aSel && !aSel.querySelector('option[value="OSN"]')) {
    const cur = aSel.value;
    aSel.innerHTML = `<option value="">All affiliates</option>
      <option value="OSN" ${cur==='OSN'?'selected':''}>OSN</option>
      <option value="OCI" ${cur==='OCI'?'selected':''}>OCI</option>`;
  }

  // Domains
  const domains = [...new Set(all.map(t => t.domain || '').filter(Boolean))].sort();
  const dSel = document.getElementById('or-filter-domain');
  if (dSel) {
    const cur = dSel.value;
    dSel.innerHTML = '<option value="">All domains</option>' +
      domains.map(d => `<option value="${d}" ${cur===d?'selected':''}>${d}</option>`).join('');
  }
}

// ══════════════════════════════════════════════════════════════
// ÉTAT DE L'INTERFACE OPS REVIEW
// Les six listes déroulantes sont devenues des puces + une
// recherche. Les <select> d'origine restent dans le DOM (masqués)
// parce que _orGetFiltered lit encore leur .value ; on les tient
// synchronisés depuis cet état.
// ══════════════════════════════════════════════════════════════
const orUI = {
  type    : '',   // '' | 'sn' | 'ci-all' | 'ci-bug' | 'ci-nobug'
  priority: '',
  status  : '',
  affiliate:'',
  sla     : '',   // '' | 'breach' | 'ok'
  search  : '',
  rows    : 40,   // lignes affichées avant « voir plus »
};
const OR_ROWS_STEP = 40;

// Report de l'état vers les <select> masqués que lit _orGetFiltered.
function _orSyncSelects() {
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (!el.querySelector(`option[value="${v}"]`)) {
      el.innerHTML += `<option value="${v}"></option>`;
    }
    el.value = v;
  };
  set('or-filter-type',      orUI.type);
  set('or-filter-priority',  orUI.priority);
  set('or-filter-status',    orUI.status);
  set('or-filter-affiliate', orUI.affiliate);
}

let _orSearchTimer = null;
function orOnSearch() {
  const v = document.getElementById('or-search')?.value || '';
  const clr = document.getElementById('or-search-clear');
  if (clr) clr.style.display = v ? '' : 'none';
  clearTimeout(_orSearchTimer);
  _orSearchTimer = setTimeout(() => {
    orUI.search = v.trim().toLowerCase();
    orUI.rows = OR_ROWS_STEP;
    renderOpsReview();
  }, 160);
}

function orClearSearch() {
  const inp = document.getElementById('or-search');
  if (inp) inp.value = '';
  orUI.search = '';
  const clr = document.getElementById('or-search-clear');
  if (clr) clr.style.display = 'none';
  renderOpsReview();
}

function orSetFilter(key, value) {
  orUI[key] = orUI[key] === value ? '' : value;
  orUI.rows = OR_ROWS_STEP;
  renderOpsReview();
}

function orResetFilters() {
  orUI.type = orUI.priority = orUI.status = orUI.affiliate = orUI.sla = '';
  orUI.rows = OR_ROWS_STEP;
  const wk = document.getElementById('or-filter-week');
  const dm = document.getElementById('or-filter-domain');
  if (wk) wk.value = '';
  if (dm) dm.value = '';
  orClearSearch();   // déclenche le rendu
}

function orShowMore() {
  orUI.rows += OR_ROWS_STEP;
  renderOpsReviewTable();
}

function orHi(text) {
  const s = esc(text == null ? '' : String(text));
  if (!orUI.search) return s;
  const needle = orUI.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return s.replace(new RegExp(`(${needle})`, 'gi'), '<mark class="or-mark">$1</mark>');
}

// Recherche + SLA : appliqués après _orGetFiltered, qui ne les connaît pas.
function _orIsBreach(t) {
  return t.sla_status === 'Breach' || t.sla_status === 'Breached';
}
function _orApplyTableFilters(rows) {
  if (orUI.sla === 'breach') rows = rows.filter(_orIsBreach);
  if (orUI.sla === 'ok')     rows = rows.filter(t => !_orIsBreach(t));
  if (orUI.search) {
    const q = orUI.search;
    rows = rows.filter(t =>
      [t.title, t.sn_tt, t.ci_tt, t.id, t.domain, t._src, t.status, t.priority, t.fo_owner]
        .some(v => v && String(v).toLowerCase().includes(q)));
  }
  return rows;
}

// Dernier périmètre rendu, pour repérer un changement de pays.
let _orLastScope = null;

function renderOpsReview() {
  if (!orUnlocked) return;
  // Changer de pays invalide les filtres liés à la source : un « type =
  // Problèmes » hérité de Global viderait la page en périmètre Sénégal,
  // sans puce visible pour comprendre pourquoi.
  const scope = _orCountryScope();
  if (_orLastScope !== scope) {
    if (_orLastScope !== null) {
      orUI.type = orUI.affiliate = '';
      orUI.rows = OR_ROWS_STEP;
      // Semaines et domaines dépendent du périmètre : ils doivent être
      // reconstruits, sinon un filtre sans correspondance y survit.
      const wk = document.getElementById('or-filter-week');
      const dm = document.getElementById('or-filter-domain');
      if (wk) wk.value = '';
      if (dm) dm.value = '';
    }
    _orLastScope = scope;
    _orPopulateFilters();
  }
  _orSyncSelects();
  const tickets = _orApplyTableFilters(_orGetFiltered());
  // L'anneau ignore le filtre SLA : sinon « hors SLA » afficherait
  // toujours 0 %, ce qui ne renseigne sur rien.
  const savedSla = orUI.sla;
  orUI.sla = '';
  const slaScope = _orApplyTableFilters(_orGetFiltered());
  orUI.sla = savedSla;
  _orRenderHero(tickets, slaScope);
  _orRenderChips();
  _orRenderCharts(tickets);
  _orRenderSLA(tickets);
  _orRenderTable(tickets);
  _orRenderResultBar(tickets);
}

// ── Héro : SLA en anneau + chiffres clés cliquables ────────────
// La rangée de huit tuiles KPI ne hiérarchisait rien : tout avait
// le même poids visuel. Le SLA porte la lecture, le reste devient
// des raccourcis de filtre.
function _orRenderHero(tickets, slaScope) {
  const el = document.getElementById('or-hero');
  if (!el) return;
  slaScope = slaScope || tickets;

  const total    = tickets.length;
  const resolved = tickets.filter(t => t.status === 'Resolved' || t.status === 'Closed').length;
  const open     = tickets.filter(t => t.status === 'Open' || t.status === 'In Progress').length;
  const p1       = tickets.filter(t => t.priority === 'P1').length;
  const p2       = tickets.filter(t => t.priority === 'P2').length;
  const breach   = slaScope.filter(_orIsBreach).length;
  const slaP     = slaScope.length ? Math.round((slaScope.length - breach) / slaScope.length * 100) : 100;

  const withMttr = tickets.filter(t => t.close_date && (t.open_date || t.occur_time));
  const avgMttr  = withMttr.length
    ? withMttr.reduce((s, t) => {
        const d = new Date(t.close_date) - new Date(t.open_date || t.occur_time);
        return s + (d > 0 ? d : 0);
      }, 0) / withMttr.length / 3600000
    : null;

  const mod = slaP >= 90 ? 'ok' : slaP >= 70 ? 'warn' : 'err';
  const R = 56, C = 2 * Math.PI * R;
  const off = C * (1 - slaP / 100);

  const verdict = total === 0
    ? 'No ticket for these filters'
    : slaP >= 90 ? 'SLA met over the period'
    : slaP >= 70 ? 'SLA under pressure'
    : 'SLA degraded — action required';

  const sub = total === 0
    ? 'Adjust the filters to display tickets.'
    : `<b>${total}</b> ticket${total > 1 ? 's' : ''} · <b>${resolved}</b> resolved (${Math.round(resolved / total * 100)}%) · MTTR moyen <b>${avgMttr !== null ? avgMttr.toFixed(1) + 'h' : '—'}</b>`;

  const stat = (cls, n, label, key, val) => key
    ? `<button class="or-stat ${cls}" aria-pressed="${orUI[key] === val}" onclick="orSetFilter('${key}','${val}')">
         <span class="or-stat-n">${n}</span>${label}
       </button>`
    : `<span class="or-stat ${cls} static"><span class="or-stat-n">${n}</span>${label}</span>`;

  el.innerHTML = `
    <div class="or-gauge ${mod}">
      <svg viewBox="0 0 132 132">
        <circle class="or-gauge-track" cx="66" cy="66" r="${R}"/>
        <circle class="or-gauge-fill"  cx="66" cy="66" r="${R}"
                stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
      </svg>
      <div class="or-gauge-mid">
        <div class="or-gauge-n">${slaP}<small>%</small></div>
        <div class="or-gauge-l">Within SLA</div>
      </div>
    </div>
    <div class="or-hero-body">
      <div class="or-hero-verdict">${verdict}</div>
      <div class="or-hero-sub">${sub}</div>
      <div class="or-stats">
        ${stat('err',  breach, 'hors SLA',   'sla',      'breach')}
        ${stat('warn', open,   'in progress','status',   'Open')}
        ${stat('err',  p1,     'P1',         'priority', 'P1')}
        ${stat('warn', p2,     'P2',         'priority', 'P2')}
        ${stat('ok',   resolved, 'resolved',  'status',   'Resolved')}
      </div>
    </div>`;
}

// ── Puces de filtre ───────────────────────────────────────────
function _orRenderChips() {
  const el = document.getElementById('or-chips');
  if (!el) return;

  // Comptes hors du filtre concerné : sinon chaque puce non
  // sélectionnée afficherait 0 dès qu'un filtre est actif.
  const countBy = (skipKey, pred) => {
    const save = orUI[skipKey];
    orUI[skipKey] = '';
    _orSyncSelects();
    const n = _orApplyTableFilters(_orGetFiltered()).filter(pred).length;
    orUI[skipKey] = save;
    _orSyncSelects();
    return n;
  };
  const chip = (key, val, label, n) => `
    <button class="or-chip ${orUI[key] === val ? 'active' : ''}" onclick="orSetFilter('${key}','${val}')">
      ${orUI[key] === val ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
      ${label}${n != null ? `<span class="or-chip-n">${n}</span>` : ''}
    </button>`;

  // Hors « Global », le périmètre ne contient qu'une source : proposer
  // les deux puces afficherait un choix dont l'une donne toujours 0.
  const scope = _orCountryScope();
  const srcChips = scope === 'ALL'
    ? chip('type', 'sn',     'Incidents', countBy('type', t => t._src === 'OSN'))
      + chip('type', 'ci-all', 'Issues', countBy('type', t => t._src === 'OCI'))
      + '<span class="or-chip-sep"></span>'
    : '';

  el.innerHTML =
      srcChips
    + ['P1','P2','P3','P4'].map(p =>
        chip('priority', p, p, countBy('priority', t => t.priority === p))).join('')
    + '<span class="or-chip-sep"></span>'
    + [['Open','Open'],['In Progress','En cours'],['Resolved','Resolved'],['Closed','Closed']]
        .map(([v, l]) => chip('status', v, l, countBy('status', t => t.status === v))).join('');
}

function _orRenderResultBar(tickets) {
  const el = document.getElementById('or-resultbar');
  if (!el) return;
  const wk = document.getElementById('or-filter-week')?.value || '';
  const dm = document.getElementById('or-filter-domain')?.value || '';
  const filtered = !!(orUI.type || orUI.priority || orUI.status || orUI.affiliate
    || orUI.sla || orUI.search || wk || dm);
  const domains = new Set(tickets.map(t => t.domain).filter(Boolean)).size;
  // Rappeler le périmètre : sans lui, un total réduit de moitié après un
  // changement de pays se lit comme des données manquantes.
  const scope = _orCountryScope();
  const scopeLabel = scope === 'ALL' ? 'Global (OSN + OCI)' : scope === 'CI' ? 'OCI' : 'OSN';
  el.innerHTML = `
    <div><b>${tickets.length}</b> ticket${tickets.length > 1 ? 's' : ''} · <b>${domains}</b> domaine${domains > 1 ? 's' : ''} · <span style="opacity:.75">${scopeLabel}</span></div>
    <div>${filtered ? `<button class="or-linkbtn" onclick="orResetFilters()">Reset filters</button>` : ''}</div>`;
}

function _orBarChart(container, items, colorFn) {
  if (!container) return;
  const max = Math.max(...items.map(i => i.count), 1);
  container.innerHTML = items.length === 0
    ? '<div class="orb-empty">No data</div>'
    : items.map(i => `
      <div class="orb-row">
        <div class="orb-label" title="${esc(i.label)}">${esc(i.label)}</div>
        <div class="orb-track">
          <div class="orb-fill" style="width:${Math.round(i.count/max*100)}%;background:${colorFn(i.label)}"></div>
        </div>
        <div class="orb-count">${i.count}</div>
      </div>`).join('');
}

function _orRenderCharts(tickets) {
  const priorityColors = PRIO_COLORS;
  const statusColors   = STATUS_COLORS;

  const countBy = (arr, key) => {
    const map = {};
    arr.forEach(t => { const v = t[key] || 'N/A'; map[v] = (map[v] || 0) + 1; });
    return Object.entries(map).map(([label, count]) => ({ label, count })).sort((a,b) => b.count - a.count);
  };

  const affiliateColors = { OSN: '#1A73E8', OCI: '#F9AB00' };

  // Priorités dans leur ordre naturel (P1 d'abord), pas par volume : on
  // cherche d'un coup d'œil combien de P1, pas quelle priorité domine.
  const parPrio = countBy(tickets, 'priority').sort((a, b) => String(a.label).localeCompare(String(b.label)));
  _orBarChart(document.getElementById('or-chart-priority'),  parPrio, l => priorityColors[l] || '#1A73E8');
  // Une seule filiale (vue SN ou CI) : sa répartition serait une barre
  // unique à 100 %, qui redit le bandeau — le panneau se retire.
  const parFiliale = countBy(tickets, '_src');
  const panneauFiliale = document.getElementById('or-panel-affiliate');
  if (panneauFiliale) panneauFiliale.hidden = parFiliale.length < 2;
  _orBarChart(document.getElementById('or-chart-affiliate'), parFiliale, l => affiliateColors[l] || '#9AA0A6');
  _orBarChart(document.getElementById('or-chart-status'),    countBy(tickets, 'status'),   l => statusColors[l]   || '#9AA0A6');
}

function _orRenderSLA(tickets) {
  const row = document.getElementById('or-sla-row');
  if (!row) return;

  const byAffiliate = {};
  tickets.forEach(t => {
    const aff = t._src || 'N/A';
    if (!byAffiliate[aff]) byAffiliate[aff] = { total: 0, breach: 0, mttrSum: 0, mttrN: 0 };
    byAffiliate[aff].total++;
    if (_orIsBreach(t)) byAffiliate[aff].breach++;
    if (t.close_date && (t.open_date || t.occur_time)) {
      const diff = new Date(t.close_date) - new Date(t.open_date || t.occur_time);
      if (diff > 0) { byAffiliate[aff].mttrSum += diff / 3600000; byAffiliate[aff].mttrN++; }
    }
  });

  const entries = Object.entries(byAffiliate).sort((a,b) => b[1].total - a[1].total);
  // Même règle que le panneau « By affiliate » : une filiale seule a déjà
  // ses chiffres dans le bandeau.
  row.hidden = entries.length < 2;
  if (entries.length < 2) { row.innerHTML = ''; return; }

  row.innerHTML = entries.map(([aff, s]) => {
    const slaP = s.total ? Math.round((s.total - s.breach) / s.total * 100) : 100;
    const mttr = s.mttrN ? `${(s.mttrSum / s.mttrN).toFixed(1)}h` : '—';
    const col  = slaP >= 90 ? 'var(--or-ok-on)' : slaP >= 70 ? 'var(--or-warn-on)' : 'var(--or-err-on)';
    return `
      <div class="or-panel or-sla-card">
        <div class="or-sla-aff">${esc(aff)}</div>
        <div class="or-sla-stats">
          <div><div class="or-sla-lbl">Tickets</div><div class="or-sla-val">${s.total}</div></div>
          <div><div class="or-sla-lbl">Within SLA</div><div class="or-sla-val" style="color:${col}">${slaP}%</div></div>
          <div><div class="or-sla-lbl">MTTR moy.</div><div class="or-sla-val">${mttr}</div></div>
        </div>
      </div>`;
  }).join('');
}

let _orTableData = [];

function _orRenderTable(tickets) {
  _orTableData = tickets;
  renderOpsReviewTable();
}

function renderOpsReviewTable() {
  const rows  = _orTableData;
  const head  = document.getElementById('or-table-head');
  const body  = document.getElementById('or-table-body');
  const empty = document.getElementById('or-table-empty');
  const title = document.getElementById('or-table-title');
  if (!head || !body) return;
  if (title) title.textContent = `Tickets (${rows.length})`;

  const fmtDate = v => v ? new Date(v).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'2-digit' }) : '—';
  const fmtDT   = v => v ? new Date(v).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '—';

  // La colonne Type ne sert que si les deux sources sont affichées.
  const showSrc = orUI.type === '';
  head.innerHTML = `<tr>
    ${showSrc ? '<th>Type</th>' : ''}
    <th>ID</th><th>Titre</th><th>Priority</th><th>Statut</th><th>Filiale</th>
    <th>Domaine</th><th>Detection</th><th>Ouverture</th><th>Closure</th>
    <th>MTTR</th><th>SLA</th><th>RCA</th>
  </tr>`;

  if (rows.length === 0) {
    body.innerHTML = '';
    if (empty) empty.style.display = 'block';
    _orRenderMore(0);
    return;
  }
  if (empty) empty.style.display = 'none';

  const shown = rows.slice(0, orUI.rows);
  body.innerHTML = shown.map(t => {
    const id = t.sn_tt || t.ci_tt || t.id;
    let mttr = '—';
    if (t.close_date && (t.open_date || t.occur_time)) {
      const diff = new Date(t.close_date) - new Date(t.open_date || t.occur_time);
      if (diff > 0) {
        const h = diff / 3600000;
        mttr = h < 1 ? `${Math.round(h*60)}min` : `${h.toFixed(1)}h`;
      }
    }
    const breach = _orIsBreach(t);
    // Trois états et non deux : « Near Breach » passait pour « In SLA ».
    const slaCls = breach ? 'or-pill-sla-ko'
                 : /near/i.test(t.sla_status || '') ? 'or-pill-sla-warn'
                 : 'or-pill-sla-ok';
    return `<tr>
      ${showSrc ? `<td><span class="or-pill or-pill-src">${esc(t._src)}</span></td>` : ''}
      <td class="or-td-id">${orHi(id)}</td>
      <td class="or-td-title">${orHi(t.title)}</td>
      <td>${t.priority ? `<span class="badge badge-${String(t.priority).toLowerCase()}">${esc(t.priority)}</span>` : '<span class="or-td-dim">—</span>'}</td>
      <td class="or-td-dim">${esc(t.status || '—')}</td>
      <td class="or-td-dim">${esc(t._src || '—')}</td>
      <td class="or-td-dim">${orHi(t.domain || '—')}</td>
      <td class="or-td-dim">${fmtDT(t.detection_time)}</td>
      <td class="or-td-dim">${fmtDT(t.open_date)}</td>
      <td class="or-td-dim">${fmtDate(t.close_date)}</td>
      <td>${mttr}</td>
      <td><span class="or-pill ${slaCls}">${esc(t.sla_status || '—')}</span></td>
      <td>${t.lien_rca ? '<span class="or-rca-yes">✓ Oui</span>' : '<span class="or-td-dim">—</span>'}</td>
    </tr>`;
  }).join('');

  _orRenderMore(rows.length - shown.length);
}

// Bouton « voir plus » : quelques centaines de lignes d'un coup
// rendaient la page lourde à faire défiler.
function _orRenderMore(hidden) {
  const wrap = document.getElementById('or-table')?.closest('.or-panel');
  if (!wrap) return;
  let btn = wrap.querySelector('.or-more');
  if (hidden <= 0) { if (btn) btn.remove(); return; }
  if (!btn) {
    btn = document.createElement('button');
    btn.className = 'or-more';
    btn.onclick = orShowMore;
    wrap.appendChild(btn);
  }
  btn.textContent = `Show ${Math.min(hidden, OR_ROWS_STEP)} more ticket${hidden > 1 ? 's' : ''} (${hidden} restant${hidden > 1 ? 's' : ''})`;
}

async function exportOpsReviewXLSX() {
  const rows = _orTableData;
  if (!rows.length) { toast('No ticket to export', 'warning'); return; }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Pearl Ops Review';
  wb.created = new Date();

  const ws = wb.addWorksheet('Ops Review', { views: [{ state: 'frozen', ySplit: 1 }] });

  const fmtDT  = v => v ? new Date(v).toLocaleString('en-GB',  { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '';
  const fmtD   = v => v ? new Date(v).toLocaleDateString('en-GB', { day:'2-digit', month:'2-digit', year:'numeric' }) : '';
  const getMttr = t => {
    if (t.close_date && (t.open_date || t.occur_time)) {
      const diff = new Date(t.close_date) - new Date(t.open_date || t.occur_time);
      if (diff > 0) return parseFloat((diff / 3600000).toFixed(2));
    }
    return null;
  };

  const COLS = [
    { header: 'Type',       key: 'type_src',   width: 12 },
    { header: 'ID',         key: 'id',         width: 18 },
    { header: 'Titre',      key: 'title',      width: 42 },
    { header: 'Priority',   key: 'priority',   width: 10 },
    { header: 'Statut',     key: 'status',     width: 14 },
    { header: 'Filiale',    key: 'affiliate',  width: 10 },
    { header: 'Domaine',    key: 'domain',     width: 12 },
    { header: 'Detection',  key: 'detection',  width: 18 },
    { header: 'Ouverture',  key: 'open',       width: 18 },
    { header: 'Closure',    key: 'close',      width: 14 },
    { header: 'MTTR (h)',   key: 'mttr',       width: 10 },
    { header: 'SLA Status', key: 'sla',        width: 14 },
    { header: 'RCA',        key: 'rca',        width: 8  },
    { header: 'Root Cause', key: 'root_cause', width: 36 },
    { header: 'FO Owner',   key: 'fo_owner',   width: 20 },
  ];
  ws.columns = COLS;

  // Header styling
  const headerRow = ws.getRow(1);
  headerRow.eachCell(cell => {
    cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1C1E' } };
    cell.font   = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  headerRow.height = 22;

  const P_COLOR = { P1: 'FFFCE4E4', P2: 'FFFFF3E0', P3: 'FFFFFDE7', P4: 'FFEDE7F6' };
  const SLA_BREACH = 'FFFCE4E4';
  const SLA_OK     = 'FFE8F5E9';

  rows.forEach((t, i) => {
    const row = ws.addRow({
      type_src:  t._src,
      id:        t.sn_tt || t.ci_tt || t.id,
      title:     t.title || '',
      priority:  t.priority || '',
      status:    t.status || '',
      affiliate: t._src || '',
      domain:    t.domain || '',
      detection: fmtDT(t.detection_time),
      open:      fmtDT(t.open_date),
      close:     fmtD(t.close_date),
      mttr:      getMttr(t),
      sla:       t.sla_status || '',
      rca:       t.lien_rca ? 'Oui' : 'Non',
      root_cause: t.root_cause || '',
      fo_owner:  t.fo_owner || '',
    });
    row.height = 18;
    const pBg  = P_COLOR[t.priority];
    const slaBg = (t.sla_status === 'Breach' || t.sla_status === 'Breached') ? SLA_BREACH : SLA_OK;
    if (pBg) ['priority'].forEach(k => {
      const cell = row.getCell(COLS.findIndex(c => c.key === k) + 1);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pBg } };
      cell.font = { bold: true };
    });
    ['sla'].forEach(k => {
      const cell = row.getCell(COLS.findIndex(c => c.key === k) + 1);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: slaBg } };
      cell.font = { bold: true };
    });
    // alternating row bg
    if (i % 2 === 1) {
      row.eachCell({ includeEmpty: true }, cell => {
        if (!cell.fill?.fgColor?.argb || cell.fill.fgColor.argb === 'FF000000') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F6F8' } };
        }
      });
    }
  });

  // Auto-filter on header
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLS.length } };

  const buf  = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `OpsReview_${new Date().toISOString().slice(0,10)}.xlsx`;
  a.click();
  toast('Excel export generated', 'success');
}

