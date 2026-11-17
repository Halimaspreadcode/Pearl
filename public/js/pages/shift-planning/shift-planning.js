// ── SHIFT PLANNING ───────────────────────────────────────────
let editingShiftId = null;
let shiftWeekOffset = 0;
let _shiftPlanActiveSite = null;
let _hideWeekends = false; // synced with config.hide_weekends

async function toggleHideWeekends() {
  _hideWeekends = !_hideWeekends;
  state.config.hide_weekends = _hideWeekends;
  await fetch(`${API}/api/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.config) });
  _updateWeekendBtn();
  renderShiftPlanning();
}

function _updateWeekendBtn() {
  const btn = document.getElementById('btn-hide-weekends');
  if (!btn) return;
  // État porté par une classe (.sp-chip.sel) et non par des styles inline :
  // ces derniers écrasaient le thème et ne suivaient pas le mode sombre.
  btn.classList.toggle('sel', _hideWeekends);
  btn.setAttribute('aria-pressed', String(_hideWeekends));
  btn.title = _hideWeekends ? 'Show weekends' : 'Hide weekends';
  const check = btn.querySelector('.sp-chip-check');
  if (_hideWeekends && !check) {
    btn.insertAdjacentHTML('afterbegin',
      '<svg class="sp-chip-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>');
  } else if (!_hideWeekends && check) {
    check.remove();
  }
}

function renderShiftPlanning() {
  const el = document.getElementById('shift-planning-grid');
  if (!el) return;

  // 4-week month view anchored to shiftWeekOffset (in months)
  const today = new Date();
  const anchorMonth = new Date(today.getFullYear(), today.getMonth() + shiftWeekOffset, 1);
  const year  = anchorMonth.getFullYear();
  const month = anchorMonth.getMonth();
  const monthLabel = anchorMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  // Build all days in the month
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const allDays = Array.from({ length: daysInMonth }, (_, i) => {
    const d = new Date(year, month, i + 1);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  // Group days into ISO weeks (Mon–Sun), keep only weeks that overlap this month
  const weeksMap = new Map();
  allDays.forEach(d => {
    const dow = d.getDay() === 0 ? 7 : d.getDay();
    const mon = new Date(d); mon.setDate(d.getDate() - dow + 1);
    const key = mon.toISOString().slice(0, 10);
    if (!weeksMap.has(key)) weeksMap.set(key, []);
    weeksMap.get(key).push(d);
  });

  // Each week = full Mon–Sun (may include days outside the month - shown greyed)
  const DAY_NAMES_FR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const weeks = [];
  let wNum = 1;
  weeksMap.forEach((_, monKey) => {
    const mon = new Date(monKey);
    const days7 = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(mon);
      d.setDate(mon.getDate() + i);
      d.setHours(0, 0, 0, 0);
      return d;
    });
    weeks.push({ label: `Week ${wNum++}`, days: days7 });
  });

  const lbl = document.getElementById('shift-week-label');
  if (lbl) lbl.textContent = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

  const allShifts = (state.shiftsPlan || []).filter(s => getActiveCountry() === 'ALL' || (s.tracker || 'SN') === getActiveCountry());
  const rc = state.rotaConfig || { sites: [] };
  const sites = (rc.sites || []).filter(s => getActiveCountry() === 'ALL' || (s.tracker || 'SN') === getActiveCountry());

  // Couleurs déléguées aux variables CSS de #page-shift-planning : elles
  // basculent seules en mode sombre, ce que les hex codés en dur ne faisaient pas.
  const SHIFT_DEF = {
    morning:   { c: 'var(--sp-morning)',   cc: 'var(--sp-morning-cont)',   label: 'Matin',      abbr: 'M' },
    afternoon: { c: 'var(--sp-afternoon)', cc: 'var(--sp-afternoon-cont)', label: 'Afternoon', abbr: 'A' },
    night:     { c: 'var(--sp-night)',     cc: 'var(--sp-night-cont)',     label: 'Nuit',       abbr: 'N' },
    rest:      { c: 'var(--sp-rest)',      cc: 'var(--sp-rest-cont)',      label: 'Repos',      abbr: '-' },
  };
  // Initiales pour les avatars du panneau latéral.
  const initials = n => n.trim().split(/\s+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase();

  // ── Panneau latéral : équipes par site ──
  function legendPanel(sitesArr) {
    return sitesArr.map(site => {
      const teams = site.teams || [];
      const teamsHtml = teams.map(team => {
        const members = (team.members || []).map(m => `
          <div class="sp-member">
            <span class="sp-avatar">${esc(initials(m))}</span>
            <span class="sp-member-name" title="${esc(m)}">${esc(m)}</span>
          </div>`).join('');
        return `<div class="sp-team">
          <div class="sp-team-name">${esc(team.name)}${team.tracker ? ' · ' + esc(team.tracker) : ''}</div>
          ${members}
        </div>`;
      }).join('');
      return `<div style="margin-bottom:6px">
        <div class="sp-site-name">${esc(site.name)}</div>
        ${teamsHtml || '<div class="sp-member-name" style="opacity:.6">—</div>'}
      </div>`;
    }).join('');
  }

  // ── Légende des shifts ──
  const shiftLegend = `<div class="sp-legend">
    ${Object.values(SHIFT_DEF).map(v => `
      <div class="sp-legend-row" style="--sp-c:${v.c};--sp-cc:${v.cc}">
        <span class="sp-legend-sw"></span>
        <span class="sp-legend-txt">${v.label}</span>
      </div>`).join('')}
  </div>`;

  // ── Build site tabs ──
  const hasSites = sites.length > 0;
  let activeSiteId = _shiftPlanActiveSite;
  if (hasSites) {
    if (!activeSiteId || !sites.find(s => s.id === activeSiteId)) activeSiteId = sites[0].id;
    _shiftPlanActiveSite = activeSiteId;
  }

  const tabsHtml = hasSites ? `
    <div class="sp-tabs" role="tablist">
      ${sites.map(s => {
        const active = s.id === activeSiteId;
        return `<button class="sp-tab${active ? ' active' : ''}" role="tab" aria-selected="${active}"
          onclick="_shiftPlanActiveSite='${s.id}';renderShiftPlanning()">${esc(s.name)}</button>`;
      }).join('')}
    </div>` : '';

  // ── Collect all FOs and shift defs for the active site ──
  let siteShiftDefs = [];
  let allFOs = [];

  if (hasSites) {
    const site = sites.find(s => s.id === activeSiteId) || sites[0];
    siteShiftDefs = (site.shifts || []).filter(s => s.id !== 'rest');
    if (!siteShiftDefs.length) siteShiftDefs = [
      { id: 'morning',   name: 'Matin',      start: '07:30', end: '16:00' },
      { id: 'afternoon', name: 'Afternoon', start: '15:30', end: '00:00' },
      { id: 'night',     name: 'Nuit',       start: '23:30', end: '08:00' },
    ];
    (site.teams || []).forEach(team => (team.members || []).forEach(fo => allFOs.push(fo)));
    if (!allFOs.length) {
      el.innerHTML = tabsHtml + `<div class="sp-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        <div>No team configured</div>
        <div style="font-size:13px;opacity:.75;margin-top:4px">Settings → Shift Rota</div>
      </div>`;
      return;
    }
  } else {
    allFOs = state.config.fo_list || [];
    siteShiftDefs = [
      { id: 'morning',   name: 'Matin',      start: '07:30', end: '16:00' },
      { id: 'afternoon', name: 'Afternoon', start: '15:30', end: '00:00' },
      { id: 'night',     name: 'Nuit',       start: '23:30', end: '08:00' },
    ];
    if (!allFOs.length) {
      el.innerHTML = `<div class="sp-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        <div>No FO configured</div>
        <div style="font-size:13px;opacity:.75;margin-top:4px">Add FOs in Settings</div>
      </div>`;
      return;
    }
  }

  // Get the shift entry for a specific FO on a date
  function entryForFODay(fo, ds) {
    return allShifts.find(s => s.fo_name === fo && s.date === ds) || null;
  }

  // ── Week pill selection ──
  const currentWeekIdx = weeks.findIndex(w => w.days.some(d => d.toDateString() === today.toDateString()));
  if (typeof window._shiftActiveWeek === 'undefined' || window._shiftLastOffset !== shiftWeekOffset) {
    window._shiftActiveWeek = currentWeekIdx >= 0 ? currentWeekIdx : 0;
    window._shiftLastOffset = shiftWeekOffset;
  }
  const awi = Math.min(window._shiftActiveWeek, weeks.length - 1);
  const activeWeek = weeks[awi];

  // ── Build table: rows = shift × team (3 rows per day), cols = days ──
  function buildWeekTable(wk) {
    const visibleDays = _hideWeekends ? wk.days.filter(d => d.getDay() !== 0 && d.getDay() !== 6) : wk.days;
    const site  = hasSites ? (sites.find(s => s.id === activeSiteId) || sites[0]) : null;
    const teams = site ? (site.teams || []) : [];

    // Classes d'état d'une colonne, partagées par l'en-tête et les cellules.
    const dayCls = d => {
      const c = [];
      if (d.getMonth() !== month) c.push('is-out');
      if (d.getDay() === 6 || d.getDay() === 0) c.push('is-we');
      if (d.toDateString() === today.toDateString()) c.push('is-today');
      return c.join(' ');
    };

    const thDays = visibleDays.map(d => {
      const dayIdx = d.getDay() === 0 ? 6 : d.getDay() - 1;
      return `<th class="${dayCls(d)}">
        <div class="sp-dow">${DAY_NAMES_FR[dayIdx]}</div>
        <div class="sp-daynum">${d.getDate()}</div>
      </th>`;
    }).join('');

    // Un bloc de lignes par shift ; à l'intérieur, une ligne par équipe.
    // Un site sans équipe déclarée produit quand même une ligne, sinon le
    // shift disparaissait silencieusement de la grille.
    let bodyRows = '';
    siteShiftDefs.forEach((shDef, shIdx) => {
      const st  = SHIFT_DEF[shDef.id] || SHIFT_DEF.morning;
      const hrs = `${shDef.start}–${shDef.end}`;
      const isLastShift = shIdx === siteShiftDefs.length - 1;
      const rowTeams = teams.length ? teams : [{ name: '', members: allFOs }];

      rowTeams.forEach((team, teamIdx) => {
        const members = team.members || [];
        const isLastTeam = teamIdx === rowTeams.length - 1;

        const labelCell = teamIdx === 0
          ? `<td class="sp-shift-cell" rowspan="${rowTeams.length}" style="--sp-c:${st.c}">
              <div class="sp-shift-inner">
                <span class="sp-shift-dot"></span>
                <div style="min-width:0">
                  <div class="sp-shift-name">${esc(shDef.name)}</div>
                  <div class="sp-shift-hrs">${hrs}</div>
                </div>
              </div>
            </td>`
          : '';

        const dayCells = visibleDays.map(d => {
          const ds  = d.toISOString().slice(0, 10);
          const cls = dayCls(d);

          if (d.getMonth() !== month) return `<td class="${cls}"></td>`;

          const onShift = members
            .map(fo => ({ fo, entry: entryForFODay(fo, ds) }))
            .filter(({ entry }) => entry && entry.shift_id === shDef.id);

          if (!onShift.length) return `<td class="${cls}"></td>`;

          const chips = onShift.map(({ fo, entry }) => {
            const parts = fo.trim().split(/\s+/);
            const first = parts[0] || '';
            const last  = parts.slice(1).join(' ');
            // Ses propres créneaux ressortent : on se cherche d'abord soi-même.
            const me = typeof currentUser !== 'undefined' && currentUser && currentUser.name === fo;
            return `<button class="sp-ev${me ? ' is-me' : ''}" style="--sp-c:${st.c};--sp-cc:${st.cc}"
              onclick="openEditShift('${entry.id}')" title="${esc(fo)} · ${esc(shDef.name)} ${hrs}">
              <span class="sp-ev-dot"></span>
              <span class="sp-ev-name">${esc(first)}${last ? ` <span class="sp-ev-last">${esc(last)}</span>` : ''}</span>
            </button>`;
          }).join('');

          return `<td class="${cls}">${chips}</td>`;
        }).join('');

        // Trait plus marqué à la fin d'un bloc de shift.
        const endCls = isLastTeam && !isLastShift ? ' class="sp-shift-end"' : '';
        bodyRows += `<tr${endCls}>${labelCell}${dayCells}</tr>`;
      });
    });

    // Ligne des jours fériés
    const holidayRowCells = `<td class="sp-hol-label">Holidays</td>` +
      visibleDays.map(d => {
        const ds  = d.toISOString().slice(0, 10);
        const hol = (state.holidays || []).find(h => h.date === ds);
        return hol
          ? `<td class="${dayCls(d)}"><span class="sp-hol-pill" title="${esc(hol.name)}">${esc(hol.name)}</span></td>`
          : `<td class="${dayCls(d)}"></td>`;
      }).join('');

    return `<div class="sp-grid-wrap"><div class="sp-scroll">
      <table class="sp-grid">
        <thead>
          <tr>
            <th class="sp-corner">Shift</th>
            ${thDays}
          </tr>
        </thead>
        <tbody>
          ${visibleDays.some(d => (state.holidays || []).some(h => h.date === d.toISOString().slice(0, 10)))
            ? `<tr class="sp-hol">${holidayRowCells}</tr>` : ''}
          ${bodyRows}
        </tbody>
      </table>
    </div></div>`;
  }

  // ── Sélecteur de semaine ──
  const pillsHtml = `<div class="sp-weeks">
    ${weeks.map((wk, i) => {
      const isCur = wk.days.some(d => d.toDateString() === today.toDateString());
      const isAct = i === awi;
      const range = `${wk.days[0].getDate()}–${wk.days[6].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
      const cls   = ['sp-week', isAct ? 'active' : '', isCur && !isAct ? 'now' : ''].filter(Boolean).join(' ');
      return `<button class="${cls}" aria-pressed="${isAct}" onclick="window._shiftActiveWeek=${i};renderShiftPlanning()">
        S${i + 1}<span class="sp-week-range">${range}</span>
      </button>`;
    }).join('')}
  </div>`;

  // ── Panneau latéral ──
  const legendInline = `<div class="sp-legend-inline">${Object.values(SHIFT_DEF).map(v =>
    `<span style="--sp-c:${v.c}"><i></i>${v.label}</span>`).join('')}</div>`;
  const panelHtml = hasSites ? `
    <div class="sp-side">
      <div class="sp-card">
        <div class="sp-card-title">Teams</div>
        ${legendPanel(sites)}
        ${shiftLegend}
      </div>
    </div>` : '';

  el.innerHTML = `
    ${tabsHtml}
    <div class="sp-weekbar">${pillsHtml}${hasSites ? '' : legendInline}</div>
    <div class="sp-layout${hasSites ? '' : ' is-full'}">
      <div class="sp-main">${buildWeekTable(activeWeek)}</div>
      ${panelHtml}
    </div>`;
}

function openNewShift() {
  editingShiftId = null;
  document.getElementById('shift-form').reset();
  document.getElementById('shift-modal-title').textContent = 'Add shift';
  document.getElementById('shift-btn-delete').style.display = 'none';
  populateShiftDropdowns();
  document.getElementById('shift-form').querySelector('[name=date]').value = new Date().toISOString().slice(0,10);
  document.getElementById('shift-modal').classList.add('open');
}

function openNewShiftFor(fo, date) {
  openNewShift();
  setTimeout(() => {
    const foSel = document.getElementById('shift-fo-select');
    if (foSel) foSel.value = fo;
    const dateInp = document.getElementById('shift-form').querySelector('[name=date]');
    if (dateInp) dateInp.value = date;
  }, 60);
}

let _sreqShiftId = null;

function openEditShift(id) {
  const shift = (state.shiftsPlan || []).find(s => s.id === id);
  if (!shift) return;
  _sreqShiftId = id;

  // Populate info block
  const st = shift.is_rest ? 'Repos' : (shift.shift_name || shift.shift_id || '-');
  document.getElementById('shift-request-info').innerHTML = `
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <div><span style="color:var(--mute)">Agent</span><br><strong>${esc(shift.fo_name)}</strong></div>
      <div><span style="color:var(--mute)">Date</span><br><strong>${shift.date}</strong></div>
      <div><span style="color:var(--mute)">Shift actuel</span><br><strong>${esc(st)}</strong></div>
    </div>`;

  // Populate identity dropdown from fo_list
  const idSel = document.getElementById('sreq-identity');
  idSel.innerHTML = '<option value="">- Select -</option>' +
    (state.config.fo_list || []).map(fo => `<option value="${esc(fo)}"${fo===shift.fo_name?' selected':''}>${esc(fo)}</option>`).join('');

  // Populate swap-with dropdown
  const swapSel = document.getElementById('sreq-swap-with');
  swapSel.innerHTML = '<option value="">- Select -</option>' +
    (state.config.fo_list || []).filter(fo => fo !== shift.fo_name).map(fo => `<option value="${esc(fo)}">${esc(fo)}</option>`).join('');

  // Reset fields
  document.getElementById('sreq-note').value = '';
  document.getElementById('sreq-type').value = 'swap';
  document.getElementById('sreq-swap-group').style.display = '';

  document.getElementById('sreq-type').onchange = function() {
    document.getElementById('sreq-swap-group').style.display = this.value === 'swap' ? '' : 'none';
  };

  document.getElementById('shift-request-modal').classList.add('open');
}

async function submitShiftRequest() {
  const identity = document.getElementById('sreq-identity').value;
  const note     = document.getElementById('sreq-note').value.trim();
  const type     = document.getElementById('sreq-type').value;
  const swapWith = document.getElementById('sreq-swap-with').value;

  if (!identity) { toast('Please select your identity', 'error'); return; }
  if (!note)     { toast('Please enter a reason', 'error'); return; }

  const shift = (state.shiftsPlan || []).find(s => s.id === _sreqShiftId);
  if (!shift) return;

  const payload = {
    shift_entry_id: shift.id,
    fo_name:        shift.fo_name,
    date:           shift.date,
    current_shift:  shift.shift_id,
    current_shift_name: shift.shift_name || shift.shift_id,
    requested_by:   identity,
    type,
    swap_with:      type === 'swap' ? swapWith : null,
    note,
    status:         'pending',
  };

  try {
    await fetch(`${API}/api/shift-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    toast('Request sent - awaiting approval', 'success');
    closeModal('shift-request-modal');
    await loadAll();
  } catch (e) {
    toast('Error while sending', 'error');
  }
}

function populateShiftDropdowns() {
  const cfg = state.config;
  const foSel = document.getElementById('shift-fo-select');
  if (foSel) { foSel.innerHTML = '<option value="">-</option>'; (cfg.fo_list||[]).forEach(fo => { const o=document.createElement('option'); o.value=fo; o.textContent=fo; foSel.appendChild(o); }); }
  const stSel = document.getElementById('shift-type-select');
  if (stSel) { stSel.innerHTML = '<option value="">-</option>'; getConfiguredShifts().forEach(s => { const o=document.createElement('option'); o.value=s; o.textContent=s; stSel.appendChild(o); }); }
}

const saveShift = withSaveGuard(async function() {
  const form = document.getElementById('shift-form');
  if (!form.checkValidity()) { form.reportValidity(); return; }
  const data = {}; new FormData(form).forEach((v,k) => { data[k]=v; });
  try {
    if (editingShiftId) {
      await fetch(`${API}/api/shifts-plan/${editingShiftId}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
      toast('Shift updated', 'success');
    } else {
      await fetch(`${API}/api/shifts-plan`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
      toast('Shift added', 'success');
    }
    closeModal('shift-modal'); await loadAll(); renderShiftPlanning();
  } catch(e) { toast('Error saving shift', 'error'); }
});

const deleteShift = withSaveGuard(async function() {
  if (!editingShiftId) return;
  if (!confirm('Delete this shift?')) return;
  await fetch(`${API}/api/shifts-plan/${editingShiftId}`, { method:'DELETE' });
  toast('Shift deleted', 'success');
  closeModal('shift-modal'); await loadAll(); renderShiftPlanning();
});

