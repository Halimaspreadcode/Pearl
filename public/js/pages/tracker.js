// ── TRACKER TABLE ────────────────────────────────────────────
// All columns matching the Excel tracker
function getTrackerCols() { return [
  // [key, label, render_fn]
  ['sn_tt',  t('Ticket #'),  t => `<span class="td-mono">${esc(t.sn_tt)||'-'}</span>`],
  ['imoc_tt',  t('External ref.'),  t => `<span class="td-mono" style="color:var(--mute)">${esc(t.imoc_tt)||'-'}</span>`],
  ['title',  t('Titre'),  t => `<span class="td-title" title="${esc(t.title)}">${esc(t.title)||'-'}</span>`],
  ['type',  t('Type'),  t => `<span class="badge badge-type-${esc((t.type||'').toLowerCase().replace(/\s+/g,'-').replace('non-bug','nonbug'))}">${esc(t.type)||'-'}</span>`],
  ['domain',  t('Domaine'),  t => esc(t.domain)||'-'],
  ['priority',  t('Priority'),  t => `<span class="${priorityClass(t.priority)}">${esc(t.priority)||'-'}</span>`],
  ['severity',  t('Severity'),  t => `<span class="badge badge-sev-${esc((t.severity||'').toLowerCase())}">${esc(t.severity)||'-'}</span>`],
  ['status',  t('Statut'),  t => `<span class="${statusClass(t.status)}">${esc(t.status)||'-'}</span>`],
  ['fo_owner',  t('FO Owner'),  t => `<span style="max-width:120px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.fo_owner)||'-'}</span>`],
  ['assigned_to',  t('Assigned To'),  t => `<span style="max-width:120px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.assigned_to)||'-'}</span>`],
  ['bo_handling',  t('BO Handling'),  t => `<span style="max-width:130px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.bo_handling)||'-'}</span>`],
  ['occur_time',  t('Occur Time'),  t => `<span style="font-size:11px;white-space:nowrap">${fmtDt(t.occur_time)}</span>`],
  ['detection_time',  t('Detection Time'),  t => `<span style="font-size:11px;white-space:nowrap">${fmtDt(t.detection_time)}</span>`],
  ['open_date',  t('Open Date'),  t => `<span style="font-size:11px;white-space:nowrap">${fmtDt(t.open_date)}</span>`],
  ['close_date',  t('Close Date'),  t => `<span style="font-size:11px;white-space:nowrap;${!t.close_date && (t.status==='Resolved'||t.status==='Closed')?'color:var(--p2-fg);font-weight:600':''}">${fmtDt(t.close_date)}</span>`],
  ['workaround_date',  t('Workaround Date'),  t => `<span style="font-size:11px;white-space:nowrap">${fmtDt(t.workaround_date)}</span>`],
  ['sla_ref',  t('SLA Ref'),  t => `<span style="font-size:11px;color:var(--red);font-weight:600">${slaTarget(t)}</span>`],
  ['time_left',  t('Time Left'),  t => `<span class="timeleft ${timeLeftClass(t.time_left_ms,t.status)}" id="tl-${t.id}">${formatTimeLeft(t.time_left_ms,t.status)}</span>`],
  ['sla_status',  t('SLA Status'),  t => `<span class="${slaClass(t.sla_status)}">${t.sla_status||'-'}</span>`],
  ['root_cause',  t('Root Cause'),  t => `<span style="max-width:140px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px" title="${esc(t.root_cause)}">${esc(t.root_cause)||'-'}</span>`],
  ['rc_category',  t('RC Category'),  t => esc(t.rc_category)||'-'],
  ['rc_description',  t('RC Description'),  t => `<span style="max-width:140px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px" title="${esc(t.rc_description)}">${esc(t.rc_description)||'-'}</span>`],
  ['corrective_actions','Corrective Actions',t => `<span style="max-width:140px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px" title="${esc(t.corrective_actions)}">${esc(t.corrective_actions)||'-'}</span>`],
  ['observations',  t('Observations'),  t => `<span style="max-width:120px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px" title="${esc(t.observations)}">${esc(t.observations)||'-'}</span>`],
  ['lien_rca',  t('Lien RCA'),  t => safeUrl(t.lien_rca) ? `<a href="${esc(safeUrl(t.lien_rca))}" target="_blank" rel="noopener noreferrer" style="color:var(--red);font-size:11px">↗ RCA</a>` : '-'],
  ['lien_alarme',  t('Lien Alarme'),  t => safeUrl(t.lien_alarme) ? `<a href="${esc(safeUrl(t.lien_alarme))}" target="_blank" rel="noopener noreferrer" style="color:var(--red);font-size:11px">↗ Alarme</a>` : '-'],
  ['comments',  t('Comments'),  t => `<span style="max-width:120px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px" title="${esc(t.comments)}">${esc(t.comments)||'-'}</span>`],
  ['update_action',  t('Update / Action'),  t => `<span style="max-width:140px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:500;color:${t.update_action?'var(--dark)':'var(--mute)'}" title="${esc(t.update_action)}">${esc(t.update_action)||'-'}</span>`],
  ['modified_by',  t('Modified By'),  t => `<span style="font-size:11px">${esc(t.modified_by)||'-'}</span>`],
  ['modified_at',  t('Modified At'),  t => `<span style="font-size:11px">${fmtDt(t.modified_at)}</span>`],
  ['shift',  t('Shift'),  t => `<span style="font-size:11px;color:var(--mute)">${esc(t.shift)||'-'}</span>`],
]; }

// Clé de tracker : code du site en minuscules (« lyo ») ou 'global'.
// Le DOM n'a qu'une page de site (préfixe « site- ») et la page globale.
// Les attributs onclick de la page portent la clé générique « site » :
// elle désigne le site actif (activeSiteKey).
const _tk = tk => (tk === 'site' ? activeSiteKey() : tk);
const _dp = tk => (tk === 'global' ? 'global' : 'site');
const _tkData = tk => (tk === 'global' ? getGlobalTickets() : ticketsOf(_tk(tk)));

// Per-tracker, per-column active filter values: { lyo: { domain: Set(['MMC']) }, global: {...} }
const _colFilters = new Proxy({}, { get: (o, k) => (typeof k === 'string' ? (o[_tk(k)] = o[_tk(k)] || {}) : undefined) });

function toggleColFilterMenu(tracker, key, evt) {
  evt.stopPropagation();
  document.querySelectorAll('.col-filter-menu').forEach(m => { if (m.id !== `colf-${_dp(tracker)}-${key}`) m.remove(); });
  const existing = document.getElementById(`colf-${_dp(tracker)}-${key}`);
  if (existing) { existing.remove(); return; }

  const source = tracker === 'global' ? getGlobalTickets() : _tkData(tracker);
  const values = [...new Set(source.map(t => t[key]))].filter(v => v !== undefined && v !== null && v !== '').sort((a,b) => String(a).localeCompare(String(b)));
  const active = _colFilters[tracker][key]; // Set or undefined = all selected

  const menu = document.createElement('div');
  menu.className = 'col-filter-menu';
  menu.id = `colf-${_dp(tracker)}-${key}`;
  menu.style.cssText = 'position:fixed;z-index:300;background:var(--bg);border:1px solid var(--line);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.15);padding:8px;width:220px;max-height:320px;overflow-y:auto;font-size:12px';

  const rect = evt.target.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${Math.min(rect.left, window.innerWidth - 232)}px`;

  const checked = v => !active || active.has(v);
  menu.innerHTML = `
    <input type="text" placeholder="Search..." oninput="_colFilterSearch(this,'${tracker}','${key}')" style="width:100%;padding:5px 7px;margin-bottom:6px;border:1px solid var(--line);border-radius:5px;font-size:11px;box-sizing:border-box">
    <div style="display:flex;justify-content:space-between;margin-bottom:4px">
      <button class="btn btn-ghost btn-sm" style="padding:2px 6px;font-size:10px" onclick="_colFilterAll('${tracker}','${key}',true)">Select all</button>
      <button class="btn btn-ghost btn-sm" style="padding:2px 6px;font-size:10px" onclick="_colFilterAll('${tracker}','${key}',false)">Clear</button>
    </div>
    <div id="colf-list-${_dp(tracker)}-${key}">
      ${values.map(v => `
        <label style="display:flex;align-items:center;gap:6px;padding:3px 2px;cursor:pointer">
          <input type="checkbox" value="${esc(String(v))}" ${checked(v) ? 'checked' : ''} onchange="_colFilterToggle('${tracker}','${key}',this)">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(String(v))}</span>
        </label>`).join('') || '<div style="color:var(--mute);padding:6px 2px">No values</div>'}
    </div>`;
  document.body.appendChild(menu);

  const closeOnClickAway = (e) => {
    if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', closeOnClickAway); }
  };
  setTimeout(() => document.addEventListener('click', closeOnClickAway), 0);
}

function _colFilterSearch(input, tracker, key) {
  const q = input.value.toLowerCase();
  document.querySelectorAll(`#colf-list-${_dp(tracker)}-${key} label`).forEach(lbl => {
    lbl.style.display = lbl.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

function _colFilterToggle(tracker, key, checkbox) {
  const source = tracker === 'global' ? getGlobalTickets() : _tkData(tracker);
  const allValues = [...new Set(source.map(t => t[key]))].filter(v => v !== undefined && v !== null && v !== '').map(String);
  if (!_colFilters[tracker][key]) _colFilters[tracker][key] = new Set(allValues);
  const set = _colFilters[tracker][key];
  if (checkbox.checked) set.add(checkbox.value); else set.delete(checkbox.value);
  if (set.size === allValues.length) delete _colFilters[tracker][key]; // back to "all" = no filter
  filterTable(tracker);
}

function _colFilterAll(tracker, key, select) {
  const menu = document.getElementById(`colf-${_dp(tracker)}-${key}`);
  if (!menu) return;
  menu.querySelectorAll(`#colf-list-${_dp(tracker)}-${key} input[type=checkbox]`).forEach(cb => cb.checked = select);
  if (select) delete _colFilters[tracker][key];
  else _colFilters[tracker][key] = new Set();
  filterTable(tracker);
}

function renderTracker(tracker) {
  tracker = _tk(tracker);
  currentTracker = tracker;
  const t = document.getElementById('site-page-title');
  if (t) t.textContent = siteList().length > 1 ? `Tickets · ${siteName(tracker)}` : 'Tickets';
  const sub = document.getElementById('site-page-sub');
  if (sub) { const st = siteByCode(tracker); sub.textContent = st ? [st.name, st.city, st.country].filter((v, i, a) => v && a.indexOf(v) === i).join(' · ') : 'No site configured yet: add one in Configuration.'; }
  renderTrackerViews(tracker);
  const cfg = state.config || {};

  // FO filter from config
  const foFilter = document.getElementById(`${_dp(tracker)}-filter-fo`);
  if (foFilter) {
    const cur = foFilter.value;
    foFilter.innerHTML = '<option value="">All FOs</option>';
    (cfg.fo_list||[]).forEach(fo => {
      const o = document.createElement('option'); o.value=fo; o.textContent=fo; foFilter.appendChild(o);
    });
    if ([...foFilter.options].some(o => o.value === cur)) foFilter.value = cur;
  }

  // Domain filter from config
  const domFilter = document.getElementById(`${_dp(tracker)}-filter-domain`);
  if (domFilter) {
    const cur = domFilter.value;
    domFilter.innerHTML = '<option value="">All domains</option>';
    (cfg.domains||[]).forEach(d => {
      const o = document.createElement('option'); o.value=d; o.textContent=d; domFilter.appendChild(o);
    });
    if ([...domFilter.options].some(o => o.value === cur)) domFilter.value = cur;
  }

  // Rebuild header on every render so language changes propagate
  const thead = document.getElementById(`${_dp(tracker)}-thead-row`);
  if (thead) {
    thead.innerHTML = getTrackerCols().map(([k,lbl]) => `
      <th style="white-space:nowrap"${_colFilters[tracker][k] ? ' data-colf="1"' : ''}>
        <span>${lbl}</span>
        <button type="button" onclick="toggleColFilterMenu('${tracker}','${k}',event)"
          style="border:none;background:transparent;cursor:pointer;color:${_colFilters[tracker][k] ? 'var(--m3-primary)' : 'var(--m3-on-surf-var)'};vertical-align:middle"
          title="Filter">▾</button>
      </th>`).join('');
  }
  renderTrackerRows(tracker);
}

function getFilteredTickets(tracker) {
  const search    = document.getElementById(`${_dp(tracker)}-search`)?.value.toLowerCase()||'';
  const fStatus   = document.getElementById(`${_dp(tracker)}-filter-status`)?.value||'';
  const fPrio     = document.getElementById(`${_dp(tracker)}-filter-priority`)?.value||'';
  const fFO       = document.getElementById(`${_dp(tracker)}-filter-fo`)?.value||'';
  const fDom      = document.getElementById(`${_dp(tracker)}-filter-domain`)?.value||'';
  const fDateFrom = document.getElementById(`${_dp(tracker)}-filter-date-from`)?.value||'';
  const fDateTo   = document.getElementById(`${_dp(tracker)}-filter-date-to`)?.value||'';

  const colFilters = _colFilters[tracker] || {};

  return _tkData(tracker).filter(t => {
    if (!_trViewMatch(tracker, t)) return false;
    if (fStatus && t.status !== fStatus) return false;
    if (fPrio   && t.priority !== fPrio) return false;
    if (fFO     && t.fo_owner !== fFO && t.assigned_to !== fFO) return false;
    if (fDom    && t.domain !== fDom) return false;
    if (fDateFrom || fDateTo) {
      const d = t.open_date ? t.open_date.slice(0,10) : '';
      if (fDateFrom && d < fDateFrom) return false;
      if (fDateTo   && d > fDateTo)   return false;
    }
    if (search) {
      const hay = [t.sn_tt,t.imoc_tt,t.title,t.fo_owner,t.assigned_to,t.domain,t.bo_handling,t.root_cause,t.comments,t.update_action].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    for (const key in colFilters) {
      const set = colFilters[key];
      if (set && !set.has(String(t[key] ?? ''))) return false;
    }
    return true;
  });
}

function renderTrackerRows(tracker) {
  const tickets = getFilteredTickets(tracker);
  const tbody = document.getElementById(`${_dp(tracker)}-tbody`);
  const cols  = getTrackerCols();

  _updateTrackerCount(tracker, tickets.length, (_tkData(tracker) || []).length);
  _bindTrackerScrollShadow();

  if (!tickets.length) {
    // Un "No tickets" centré ne disait pas si la table est vide ou si
    // les filtres sont trop restrictifs — et n'offrait aucune sortie.
    const total = (_tkData(tracker) || []).length;
    tbody.innerHTML = `<tr><td colspan="${cols.length}">
      <div class="tk-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <div class="tk-empty-title">${total ? 'No ticket matches the filters' : 'No ticket in this tracker'}</div>
        ${total ? `<div class="tk-empty-sub">${total} ticket(s) in total — try widening the search.</div>
        <button class="btn btn-ghost btn-sm" onclick="resetTrackerFilters('${tracker}')">Reset filters</button>` : ''}
      </div></td></tr>`;
    return;
  }

  // Le fond rose sur toute la ligne colorait la moitié du tableau dès
  // qu'il y avait quelques ruptures : plus rien ne ressortait. Remplacé
  // par un liseré à gauche, lisible sans noyer la ligne.
  tbody.innerHTML = tickets.map(t => {
    const flag = t.sla_status === 'Breach' ? ' data-sla="breach"'
               : t.sla_status === 'Near Breach' ? ' data-sla="near"' : '';
    return `<tr onclick="openEditTicket(${escAttrArg(tracker)},${escAttrArg(t.id)})"${flag}>
      ${cols.map(([k,,fn]) => `<td>${fn(t)}</td>`).join('')}
    </tr>`;
  }).join('');
}

// Ombre de défilement sous l'en-tête figé des trackers : sans elle, le
// thead sticky reste un bandeau plat et on ne voit pas que ça défile.
function _bindTrackerScrollShadow() {
  ['site','global'].forEach(tk => {
    const wrap = document.querySelector(`#page-${tk} .table-wrap`);
    if (!wrap || wrap.dataset.shadowBound) return;
    wrap.dataset.shadowBound = '1';
    const sync = () => {
      wrap.classList.toggle('is-scrolled', wrap.scrollTop > 0);
      // L'état vide vit dans un <td colspan> aussi large que le tableau
      // (~4500px) : sans cette largeur explicite, son contenu centré
      // tombe hors écran. On lui donne la largeur visible du conteneur.
      wrap.style.setProperty('--tk-vw', `${wrap.clientWidth}px`);
    };
    wrap.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync, { passive: true });
    sync();
  });
}

// Compteur de résultats : sans lui, impossible de savoir si un filtre
// a pris effet ni combien de lignes sont masquées.
function _updateTrackerCount(tracker, shown, total) {
  const el = document.getElementById(`${_dp(tracker)}-result-count`);
  if (!el) return;
  el.textContent = shown === total
    ? `${total} ticket${total > 1 ? 's' : ''}`
    : `${shown} of ${total} ticket${total > 1 ? 's' : ''}`;
  el.classList.toggle('filtered', shown !== total);
}

// ── Vues rapides ──────────────────────────────────────────────
// Les questions qu'on se pose en ouvrant un tracker, en un clic, avec
// leur nombre : qu'est-ce qui est actif, hors SLA, en attente, à moi ?
// Elles se combinent avec la recherche et les filtres.
const _trView = new Proxy({}, {
  get: (o, k) => (typeof k === 'string' ? o[_tk(k)] : undefined),
  set: (o, k, v) => { o[_tk(k)] = v; return true; },
});
const _TR_CLOS = t => t.status === 'Resolved' || t.status === 'Closed';
const _TR_ME = () => (typeof currentUser !== 'undefined' && currentUser && currentUser.name) || '';
const TR_VIEWS = [
  ['all',    'All',        () => true],
  ['active', 'Active',     t => !_TR_CLOS(t)],
  ['breach', 'Out of SLA', t => !_TR_CLOS(t) && (t.sla_status === 'Breach' || (typeof t.time_left_ms === 'number' && t.time_left_ms < 0 && t.sla_status !== 'On Hold'))],
  ['hold',   'On hold',    t => t.status === 'On Hold' || t.sla_status === 'On Hold'],
  ['mine',   'Mine',       t => !!_TR_ME() && (t.fo_owner === _TR_ME() || t.assigned_to === _TR_ME())],
  ['closed', 'Closed',     t => _TR_CLOS(t)],
];
function _trViewMatch(tracker, t) {
  const v = TR_VIEWS.find(x => x[0] === (_trView[tracker] || 'all'));
  return !v || v[2](t);
}
function setTrackerView(tracker, v) { _trView[tracker] = v; filterTable(tracker); }
function renderTrackerViews(tracker) {
  const el = document.getElementById(`${_dp(tracker)}-views`);
  if (!el) return;
  const base = tracker === 'global' ? getGlobalTickets() : (_tkData(tracker) || []);
  const cur = _trView[tracker] || 'all';
  el.innerHTML = TR_VIEWS.filter(([k]) => k !== 'mine' || _TR_ME()).map(([k, l, f]) => {
    const n = base.filter(f).length;
    return `<button type="button" role="tab" aria-selected="${k === cur}" class="tr-view${k === cur ? ' on' : ''}${k === 'breach' && n ? ' is-alert' : ''}"
      onclick="setTrackerView('${tracker}','${k}')">${l}<span class="tr-view-n">${n}</span></button>`;
  }).join('');
}

function filterTable(tracker) {
  renderTrackerViews(tracker);
  if (tracker === 'global') renderGlobalTrackerRows();
  else renderTrackerRows(tracker);
  updateTrackerFilterBadges(tracker);
}

async function exportTrackerExcel(tracker) {
  const tickets = getFilteredTickets(tracker);
  tracker = _tk(tracker);
  if (!tickets.length) { alert('Nothing to export.'); return; }

  const cols = getTrackerCols();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Tracker ${tracker.toUpperCase()}`.slice(0, 31));
  ws.columns = cols.map(() => ({ width: 18 }));

  xlHdr(ws, 1, cols.map((_,i) => i+1), cols.map(([,lbl]) => lbl));

  tickets.forEach((t, i) => {
    cols.forEach(([key], ci) => {
      let v = t[key] ?? '';
      if (['occur_time','detection_time','open_date','close_date','workaround_date','modified_at'].includes(key) && v) v = fmtDt(v);
      xlCell(ws, i+2, ci+1, v, { zebra: i % 2 === 1 });
    });
  });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0,10);
  const a = Object.assign(document.createElement('a'), { href: url, download: `Tracker_${tracker.toUpperCase()}_${date}.xlsx` });
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  toast('Excel export generated', 'success');
}

// ── TRACKER GLOBAL (tous les sites, lecture seule) ───────────
function getGlobalTickets() {
  return allTickets();
}

function getFilteredGlobalTickets() {
  const search     = document.getElementById('global-tracker-search')?.value.toLowerCase()||'';
  const fSite      = document.getElementById('global-filter-site')?.value||'';
  const fStatus    = document.getElementById('global-filter-status')?.value||'';
  const fPrio      = document.getElementById('global-filter-priority')?.value||'';
  const fFO        = document.getElementById('global-filter-fo')?.value||'';
  const fDom       = document.getElementById('global-filter-domain')?.value||'';
  const fDateFrom  = document.getElementById('global-filter-date-from')?.value||'';
  const fDateTo    = document.getElementById('global-filter-date-to')?.value||'';

  return getGlobalTickets().filter(t => {
    if (!_trViewMatch('global', t)) return false;
    if (fSite   && t._tracker !== fSite) return false;
    if (fStatus && t.status !== fStatus) return false;
    if (fPrio   && t.priority !== fPrio) return false;
    if (fFO     && t.fo_owner !== fFO && t.assigned_to !== fFO) return false;
    if (fDom    && t.domain !== fDom) return false;
    if (fDateFrom || fDateTo) {
      const d = t.open_date ? t.open_date.slice(0,10) : '';
      if (fDateFrom && d < fDateFrom) return false;
      if (fDateTo   && d > fDateTo)   return false;
    }
    if (search) {
      const hay = [t.sn_tt,t.imoc_tt,t.title,t.fo_owner,t.assigned_to,t.domain,t.bo_handling,t.root_cause,t.comments,t.update_action].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    const colFilters = _colFilters.global || {};
    for (const key in colFilters) {
      const set = colFilters[key];
      if (set && !set.has(String(t[key] ?? ''))) return false;
    }
    return true;
  });
}

function getGlobalTrackerCols() {
  return [['_tracker', t('Site'), t => `<span class="badge badge-site badge-site-${t._tracker||''}">${(t._tracker||'').toUpperCase()}</span>`], ...getTrackerCols()];
}

function renderGlobalTracker() {
  renderTrackerViews('global');
  const thead = document.getElementById('global-thead-row');
  if (thead) {
    thead.innerHTML = getGlobalTrackerCols().map(([k,lbl]) => `
      <th style="white-space:nowrap"${_colFilters.global[k] ? ' data-colf="1"' : ''}>
        <span>${lbl}</span>
        <button type="button" onclick="toggleColFilterMenu('global','${k}',event)"
          style="border:none;background:transparent;cursor:pointer;color:${_colFilters.global[k] ? 'var(--m3-primary)' : 'var(--m3-on-surf-var)'};vertical-align:middle"
          title="Filter">▾</button>
      </th>`).join('');
  }
  renderGlobalTrackerRows();
}

function renderGlobalTrackerRows() {
  const tickets = getFilteredGlobalTickets();
  const tbody = document.getElementById('global-tbody');
  if (!tbody) return;
  const cols  = getGlobalTrackerCols();
  const total = getGlobalTickets().length;

  _updateTrackerCount('global', tickets.length, total);
  _bindTrackerScrollShadow();

  if (!tickets.length) {
    tbody.innerHTML = `<tr><td colspan="${cols.length}">
      <div class="tk-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <div class="tk-empty-title">${total ? 'No ticket matches the filters' : 'No ticket'}</div>
        ${total ? `<div class="tk-empty-sub">${total} ticket(s) in total — try widening the search.</div>
        <button class="btn btn-ghost btn-sm" onclick="resetTrackerFilters('global')">Reset filters</button>` : ''}
      </div></td></tr>`;
    return;
  }
  tbody.innerHTML = tickets.map(t => {
    const flag = t.sla_status === 'Breach' ? ' data-sla="breach"'
               : t.sla_status === 'Near Breach' ? ' data-sla="near"' : '';
    return `<tr onclick="openEditTicket(${escAttrArg(t._tracker)},${escAttrArg(t.id)})"${flag}>
      ${cols.map(([k,,fn]) => `<td>${fn(t)}</td>`).join('')}
    </tr>`;
  }).join('');
}

function updateTrackerFilterBadges(tracker) {
  const isGlobal = tracker === 'global';
  const searchId = isGlobal ? 'global-tracker-search' : `${_dp(tracker)}-search`;
  const filterIds = isGlobal
    ? [
        { id: 'global-filter-site',      label: 'Site' },
        { id: 'global-filter-status',    label: 'Status' },
        { id: 'global-filter-priority',  label: 'Priority' },
        { id: 'global-filter-fo',        label: 'FO' },
        { id: 'global-filter-domain',    label: 'Domain' },
        { id: 'global-filter-date-from', label: 'From' },
        { id: 'global-filter-date-to',   label: 'To' },
      ]
    : [
        { id: `${_dp(tracker)}-filter-status`,    label: 'Status' },
        { id: `${_dp(tracker)}-filter-priority`,  label: 'Priority' },
        { id: `${_dp(tracker)}-filter-fo`,        label: 'FO' },
        { id: `${_dp(tracker)}-filter-domain`,    label: 'Domain' },
        { id: `${_dp(tracker)}-filter-date-from`, label: 'From' },
        { id: `${_dp(tracker)}-filter-date-to`,   label: 'To' },
      ];

  const search = document.getElementById(searchId)?.value || '';
  const chips = [];
  filterIds.forEach(({ id, label }) => {
    const el = document.getElementById(id);
    if (!el) return;
    const active = !!el.value;
    el.dataset.active = active ? '1' : '';
    if (active) chips.push({ id, label, val: el.value });
  });

  const cf = _colFilters[tracker] || {};
  Object.keys(cf).forEach(k => {
    if (cf[k] && cf[k].size > 0) chips.push({ id: null, colKey: k, label: k, val: `${cf[k].size} val.` });
  });

  const searchActive = search.trim().length > 0;
  const anyActive = chips.length > 0 || searchActive;

  const resetBtn = document.getElementById(`${_dp(tracker)}-reset-btn`);
  if (resetBtn) resetBtn.style.display = anyActive ? '' : 'none';

  const container = document.getElementById(`${_dp(tracker)}-active-chips`);
  if (!container) return;
  if (!anyActive) { container.style.display = 'none'; container.innerHTML = ''; return; }

  container.style.display = 'flex';
  let html = '';
  if (searchActive) {
    html += `<span class="filter-chip">Search: "<strong>${esc(search)}</strong>" <button onclick="document.getElementById('${searchId}').value='';filterTable('${tracker}')" title="Remove">✕</button></span>`;
  }
  chips.forEach(c => {
    const remove = c.id
      ? `document.getElementById('${c.id}').value='';filterTable('${tracker}')`
      : `delete _colFilters['${tracker}']['${c.colKey}'];filterTable('${tracker}');renderGlobalTracker()`;
    html += `<span class="filter-chip">${esc(c.label)}: <strong>${esc(c.val)}</strong> <button onclick="${remove}" title="Remove">✕</button></span>`;
  });
  container.innerHTML = html;
}

function resetTrackerFilters(tracker) {
  const isGlobal = tracker === 'global';
  const searchId = isGlobal ? 'global-tracker-search' : `${_dp(tracker)}-search`;
  const prefix = isGlobal ? 'global' : tracker;
  const ids = isGlobal
    ? ['global-filter-site','global-filter-status','global-filter-priority','global-filter-fo','global-filter-domain','global-filter-date-from','global-filter-date-to']
    : [`${prefix}-filter-status`,`${prefix}-filter-priority`,`${prefix}-filter-fo`,`${prefix}-filter-domain`,`${prefix}-filter-date-from`,`${prefix}-filter-date-to`];
  ids.forEach(id => { const el = document.getElementById(id); if (el) { el.value = ''; el.dataset.active = ''; } });
  const search = document.getElementById(searchId);
  if (search) search.value = '';
  _colFilters[tracker] = {};
  _trView[tracker] = 'all';
  renderTrackerViews(tracker);
  if (isGlobal) { renderGlobalTrackerRows(); renderGlobalTracker(); }
  else { renderTrackerRows(tracker); renderTracker(tracker); }
  updateTrackerFilterBadges(tracker);
}

// keep backward-compat aliases
function updateGlobalFilterBadges() { updateTrackerFilterBadges('global'); }
function resetGlobalFilters() { resetTrackerFilters('global'); }

async function exportGlobalTrackerExcel() {
  const tickets = getFilteredGlobalTickets();
  if (!tickets.length) { alert('Nothing to export.'); return; }

  const cols = getGlobalTrackerCols();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('All sites');
  ws.columns = cols.map(() => ({ width: 18 }));

  xlHdr(ws, 1, cols.map((_,i) => i+1), cols.map(([,lbl]) => lbl));

  tickets.forEach((t, i) => {
    cols.forEach(([key], ci) => {
      let v = key === '_tracker' ? t._tracker.toUpperCase() : (t[key] ?? '');
      if (['occur_time','detection_time','open_date','close_date','workaround_date','modified_at'].includes(key) && v) v = fmtDt(v);
      xlCell(ws, i+2, ci+1, v, { zebra: i % 2 === 1 });
    });
  });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0,10);
  const a = Object.assign(document.createElement('a'), { href: url, download: `Tracker_Global_${date}.xlsx` });
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  toast('Excel export generated', 'success');
}


// ── Période des trackers ──────────────────────────────────────
// Deux champs de date à remplir à la main pour une question presque
// toujours la même (« aujourd'hui », « cette semaine »…) : un menu de
// périodes les remplit ; « Custom » fait apparaître les deux champs.
function _trPeriodInit(tr) {
  const range = document.querySelector(`#${_dp(tr)}-filter-bar .tfb-daterange`);
  if (!range || document.getElementById(`${_dp(tr)}-filter-period`)) return;
  const sel = document.createElement('select');
  sel.className = 'filter-select tfb-period';
  sel.id = `${_dp(tr)}-filter-period`;
  sel.setAttribute('aria-label', 'Open date');
  sel.innerHTML = [['', 'Any date'], ['today', 'Today'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['month', 'This month'], ['custom', 'Custom…']]
    .map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  sel.addEventListener('change', () => trSetPeriod(tr, sel.value));
  range.before(sel);
  range.hidden = true;
}
function trSetPeriod(tr, v) {
  const from = document.getElementById(`${_dp(tr)}-filter-date-from`);
  const to = document.getElementById(`${_dp(tr)}-filter-date-to`);
  const range = document.querySelector(`#${_dp(tr)}-filter-bar .tfb-daterange`);
  if (!from || !to) return;
  const iso = d => d.toISOString().slice(0, 10);
  const now = new Date();
  if (range) range.hidden = v !== 'custom';
  if (v === 'custom') { from.focus(); return; }
  if (!v) { from.value = ''; to.value = ''; }
  else if (v === 'today') { from.value = to.value = iso(now); }
  else if (v === 'month') { from.value = iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))); to.value = iso(now); }
  else { from.value = iso(new Date(now - (Number(v) - 1) * 864e5)); to.value = iso(now); }
  filterTable(tr);
}
(function () {
  const init = () => ['site', 'global'].forEach(_trPeriodInit);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  // Reset remet aussi la période à « Any date ».
  const orig = window.resetTrackerFilters;
  if (typeof orig === 'function') window.resetTrackerFilters = function (tr) {
    const p = document.getElementById(`${_dp(tr)}-filter-period`);
    if (p) p.value = '';
    const r = document.querySelector(`#${_dp(tr)}-filter-bar .tfb-daterange`);
    if (r) r.hidden = true;
    return orig.apply(this, arguments);
  };
})();
