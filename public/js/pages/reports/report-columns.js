// ── CUSTOM COLUMNS (daily/weekly/monthly) ─────────────────────
const RPT_SAVE_FORM_FNS = { daily: 'saveDailyForm', weekly: 'saveWeeklyForm', monthly: 'saveMonthlyForm' };

function addReportCustomCol(reportType, section) {
  const form = _rptFormFor(reportType);
  const saveFn = window[RPT_SAVE_FORM_FNS[reportType]];
  if (typeof saveFn === 'function') saveFn();
  const label = (prompt('Column name?') || '').trim();
  if (!label) return;
  const id = 'c' + Date.now();
  form.customCols[section].push({ id, label });
  form[section].forEach(row => { row[id] = ''; });
  pushReportLayout(reportType, { customCols: form.customCols });
  const renderFn = window[RPT_RENDER_FNS[reportType]];
  if (typeof renderFn === 'function') renderFn();
}
function removeReportCustomCol(reportType, section, id) {
  const form = _rptFormFor(reportType);
  const saveFn = window[RPT_SAVE_FORM_FNS[reportType]];
  if (typeof saveFn === 'function') saveFn();
  form.customCols[section] = form.customCols[section].filter(c => c.id !== id);
  form[section].forEach(row => { delete row[id]; });
  pushReportLayout(reportType, { customCols: form.customCols });
  const renderFn = window[RPT_RENDER_FNS[reportType]];
  if (typeof renderFn === 'function') renderFn();
}
function rptAddColBtn(reportType, section) {
  return rptToolBtn('Column', `addReportCustomCol('${reportType}','${section}')`);
}
// Back-compat aliases used by the daily report markup.
function addDailyCustomCol(section) { addReportCustomCol('daily', section); }
function removeDailyCustomCol(section, id) { removeReportCustomCol('daily', section, id); }

function saveDailyForm() {
  dailyForm.author = document.getElementById('daily-author')?.value ?? dailyForm.author;
  for (let i = 0; i < dailyForm.highlights.length; i++) {
    dailyForm.highlights[i] = {
      source:      document.getElementById(`hl-src-${i}`)?.value ?? dailyForm.highlights[i].source,
      observation: document.getElementById(`hl-obs-${i}`)?.value ?? dailyForm.highlights[i].observation,
      priority:    document.getElementById(`hl-pri-${i}`)?.value ?? dailyForm.highlights[i].priority,
      status:      document.getElementById(`hl-sta-${i}`)?.value ?? dailyForm.highlights[i].status,
    };
    dailyForm.customCols.highlights.forEach(c => {
      dailyForm.highlights[i][c.id] = document.getElementById(`hl-${c.id}-${i}`)?.value ?? dailyForm.highlights[i][c.id];
    });
  }
  for (let i = 0; i < dailyForm.risks.length; i++) {
    dailyForm.risks[i] = {
      description: document.getElementById(`risk-desc-${i}`)?.value ?? dailyForm.risks[i].description,
      fo:          document.getElementById(`risk-fo-${i}`)?.value ?? dailyForm.risks[i].fo,
      bo:          document.getElementById(`risk-bo-${i}`)?.value ?? dailyForm.risks[i].bo,
      priority:    document.getElementById(`risk-pri-${i}`)?.value ?? dailyForm.risks[i].priority,
      status:      document.getElementById(`risk-sta-${i}`)?.value ?? dailyForm.risks[i].status,
      _auto:       dailyForm.risks[i]._auto,
      _autoType:   dailyForm.risks[i]._autoType,
      _timeLeft:   dailyForm.risks[i]._timeLeft,
    };
    dailyForm.customCols.risks.forEach(c => {
      dailyForm.risks[i][c.id] = document.getElementById(`risk-${c.id}-${i}`)?.value ?? dailyForm.risks[i][c.id];
    });
  }
  for (let i = 0; i < dailyForm.actions.length; i++) {
    dailyForm.actions[i] = {
      action:   document.getElementById(`act-item-${i}`)?.value ?? dailyForm.actions[i].action,
      owner:    document.getElementById(`act-own-${i}`)?.value ?? dailyForm.actions[i].owner,
      priority: document.getElementById(`act-pri-${i}`)?.value ?? dailyForm.actions[i].priority,
      eta:      document.getElementById(`act-eta-${i}`)?.value ?? dailyForm.actions[i].eta,
    };
    dailyForm.customCols.actions.forEach(c => {
      dailyForm.actions[i][c.id] = document.getElementById(`act-${c.id}-${i}`)?.value ?? dailyForm.actions[i][c.id];
    });
  }
  dailyForm.highlights = trimEmptyRows(dailyForm.highlights, RPT_EMPTY_ROW.highlights);
  dailyForm.risks      = trimEmptyRows(dailyForm.risks, RPT_EMPTY_ROW.risks);
  dailyForm.actions    = trimEmptyRows(dailyForm.actions, RPT_EMPTY_ROW.actions);
  saveDailyDraft();
}

function seedHighlightsFromObs(observations) {
  const rows = Math.max(dailyForm.highlights.length, observations.length, 1);
  dailyForm.highlights = Array(rows).fill(null).map((_, i) => {
    const existing = dailyForm.highlights[i];
    const customVals = {}; dailyForm.customCols.highlights.forEach(c => { customVals[c.id] = existing?.[c.id] || ''; });
    const o = observations[i];
    if (o) {
      const text = o.author ? `[${o.author}] ${o.observation || ''}` : (o.observation || '');
      return { source: o.source || '', observation: text, priority: o.priority || '', status: o.status || 'Open', ...customVals };
    }
    return existing || { source: '', observation: '', priority: '', status: '', ...customVals };
  });
  dailyForm.highlights = trimEmptyRows(dailyForm.highlights, RPT_EMPTY_ROW.highlights);
}

const RPT_EMPTY_ROW = {
  highlights: { source: '', observation: '', priority: '', status: '' },
  risks:      { description: '', fo: '', bo: '', priority: '', status: '' },
  actions:    { action: '', owner: '', priority: '', eta: '' },
};

function _isRowEmpty(row) {
  return Object.entries(row).every(([k, v]) => k === '_auto' || k === 'id' || !String(v || '').trim());
}

// Drops trailing empty rows, keeping exactly one empty row at the end (none if the
// last real row already fills the form) so the section never shows more than 1 blank row —
// in the UI and in downloads alike.
function trimEmptyRows(rows, emptyRowTemplate) {
  const trimmed = [...rows];
  while (trimmed.length > 1 && _isRowEmpty(trimmed[trimmed.length - 1]) && _isRowEmpty(trimmed[trimmed.length - 2])) {
    trimmed.pop();
  }
  if (!trimmed.length || !_isRowEmpty(trimmed[trimmed.length - 1])) {
    trimmed.push({ ...emptyRowTemplate });
  }
  return trimmed;
}

// Tickets P1/P2 still open for more than 24h, scoped to the active country (or both if 'ALL').
function _longOpenP1P2Tickets() {
  const country = typeof getActiveCountry === 'function' ? getActiveCountry() : 'ALL';
  const pools = country === 'ALL' ? allTicketsRaw() : ticketsOf(country);
  const now = Date.now();
  return pools.filter(t =>
    ['P1','P2'].includes(t.priority) &&
    ['Open','In Progress'].includes(t.status) &&
    t.open_date && (now - new Date(t.open_date).getTime()) > 24 * 3600 * 1000
  ).sort((a,b) => new Date(a.open_date) - new Date(b.open_date));
}

// Open tickets whose SLA is "Near Breach" (<20% of SLA window left), scoped to the active country.
function _nearBreachTickets() {
  const country = typeof getActiveCountry === 'function' ? getActiveCountry() : 'ALL';
  const pools = country === 'ALL' ? allTicketsRaw() : ticketsOf(country);
  return pools.filter(t =>
    t.sla_status === 'Near Breach' && !['Resolved','Closed'].includes(t.status)
  );
}

// Auto-fills the risks rows from long-open P1/P2 tickets and Near-Breach SLA tickets,
// keeping any manually edited rows untouched.
function seedRisksFromTickets(formRisks) {
  const longOpenRows = _longOpenP1P2Tickets().map(t => {
    const tt = t.sn_tt || t.imoc_tt || t.id || '';
    const title = t.title ? ` – ${t.title}` : '';
    return {
      description: `${tt}${title}`,
      fo: t.fo_owner || '',
      bo: t.bo_handling || '',
      priority: t.priority,
      status: 'Open',
      _auto: true,
      _autoType: 'long-open',
      _timeLeft: `open since ${fmtDt(t.open_date)}`,
    };
  });
  const nearBreachRows = _nearBreachTickets().map(t => {
    const tt = t.sn_tt || t.imoc_tt || t.id || '';
    const title = t.title ? ` – ${t.title}` : '';
    return {
      description: `${tt}${title}`,
      fo: t.fo_owner || '',
      bo: t.bo_handling || '',
      priority: t.priority,
      status: 'Open',
      _auto: true,
      _autoType: 'near-breach',
      _timeLeft: formatTimeLeft(t.time_left_ms, t.status),
    };
  });
  const manualRows = (formRisks || []).filter(r => !r._auto);
  const rows = [...longOpenRows, ...nearBreachRows, ...manualRows];
  return trimEmptyRows(rows, RPT_EMPTY_ROW.risks);
}

function addDailyRow(section) {
  saveDailyForm();
  dailyForm[section].push({ ...RPT_EMPTY_ROW[section] });
  renderPage_daily();
}

// section is e.g. 'weeklyHighlights' / 'monthlyRisks' / 'monthlyActions'
const RPT_ROW_TARGETS = {
  weekly:  ['weeklyForm', 'saveWeeklyForm', 'renderPage_weekly'],
  monthly: ['monthlyForm', 'saveMonthlyForm', 'renderMonthlyReport'],
};

// 'weeklyHighlights' -> { reportKey:'weekly', key:'highlights' }
function _rptRowTarget(section) {
  const reportKey = section.startsWith('weekly') ? 'weekly' : 'monthly';
  const field = section.slice(reportKey.length);
  return { reportKey, key: field.charAt(0).toLowerCase() + field.slice(1) };
}

function addReportRow(section) {
  const { reportKey, key } = _rptRowTarget(section);
  const [formName, saveFn, renderFn] = RPT_ROW_TARGETS[reportKey];
  window[saveFn]();
  window[formName][key].push({ ...RPT_EMPTY_ROW[key] });
  window[renderFn]();
}

// Suppression d'une ligne. Il n'y en avait aucune : on pouvait ajouter
// indéfiniment sans jamais retirer, et une ligne saisie par erreur partait
// dans le PPTX. Les lignes auto-détectées (_auto) ne sont pas supprimables
// ici — elles reviendraient au prochain rendu puisqu'elles sont déduites
// des tickets ; c'est le ticket qu'il faut traiter.
function removeReportRow(section, i) {
  const { reportKey, key } = _rptRowTarget(section);
  const [formName, saveFn, renderFn] = RPT_ROW_TARGETS[reportKey];
  window[saveFn]();
  const rows = window[formName][key];
  if (!rows[i] || rows[i]._auto) return;
  // Une ligne remplie ne disparaît pas sans confirmation : le brouillon
  // n'a pas d'annulation.
  const filled = Object.entries(rows[i])
    .some(([k, v]) => !k.startsWith('_') && k !== 'id' && String(v || '').trim());
  if (filled && !confirm('Delete this row?')) return;
  rows.splice(i, 1);
  window[renderFn]();
}

function collectDailyForm() {
  saveDailyForm();
  return {
    highlights: dailyForm.highlights.map(r => ({ ...r })),
    risks:      dailyForm.risks.map(r => ({ ...r })),
    actions:    dailyForm.actions.map(r => ({ ...r })),
    // Le classeur lit les colonnes ajoutées par l'utilisateur.
    customCols: dailyForm.customCols || { highlights: [], risks: [], actions: [] },
  };
}

let dailyAnchorDate = new Date().toISOString().slice(0,10);

