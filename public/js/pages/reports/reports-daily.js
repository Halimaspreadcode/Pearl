// ── REPORT DRAFT PERSISTENCE (local only — never touches server data) ──
// Each report type/period gets its own draft key so editing one date/week/month
// never clobbers another, and the underlying tickets/observations stay read-only.
function _reportDraftKey(reportType, period) { return `emoc_${reportType}_draft_${period}`; }

// customCols is intentionally excluded here — it's shared layout (server-side via
// _reportLayout), not per-date draft content. Only row text/author/notes are local drafts.
// Envoi différé vers le serveur : la saisie déclenche une sauvegarde à
// chaque frappe, une requête par frappe saturerait le réseau pour rien.
const _draftSyncTimers = {};
// Consultation seule (verrou d'équipe, sans identité) : le serveur refuse
// toute écriture, et chaque refus ouvrait la fenêtre de connexion dès
// l'ouverture d'un rapport. Les écritures d'arrière-plan s'abstiennent.
function rptCanWrite() {
  const t = window.TeamIdentity;
  if (typeof AdminSession !== 'undefined' && AdminSession.active) return true;
  return !(t && (t.actif || t.exige) && !t.user && !t.admin);
}
function _syncDraftToServer(reportType, period, payload) {
  if (!rptCanWrite()) return;
  const k = `${reportType}:${period}`;
  clearTimeout(_draftSyncTimers[k]);
  _draftSyncTimers[k] = setTimeout(() => {
    fetch(`${API}/api/report-draft/${reportType}/${encodeURIComponent(period)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => { /* le localStorage reste la copie de travail */ });
  }, 1500);
}

function saveReportDraft(reportType, period) {
  const form = _rptFormFor(reportType);
  if (!form) return;
  const payload = {
    author: form.author,
    highlights: form.highlights,
    risks: form.risks,
    actions: form.actions,
    notes: form.notes,
  };
  // Le serveur reçoit une copie : sans elle, un rapport envoyé
  // automatiquement partirait sans les sections rédigées, qui ne vivent
  // que dans le navigateur de la personne qui les a saisies.
  _syncDraftToServer(reportType, period, payload);
  try {
    localStorage.setItem(_reportDraftKey(reportType, period), JSON.stringify(payload));
  } catch (e) { /* storage full or unavailable — draft just won't persist */ }
}

// Repli serveur : un poste qui n'a jamais ouvert ce rapport n'a rien en
// localStorage, alors que le brouillon existe peut-être — saisi depuis un
// autre navigateur. On le récupère alors, sans rendre loadReportDraft
// asynchrone : elle est appelée au milieu de rendus synchrones, et la
// transformer propagerait des `await` dans tout le chemin d'affichage.
async function fetchReportDraftIfMissing(reportType, period, apresChargement) {
  try {
    if (localStorage.getItem(_reportDraftKey(reportType, period))) return false;
    const res = await fetch(`${API}/api/report-draft/${reportType}/${encodeURIComponent(period)}`);
    if (!res.ok) return false;
    const d = await res.json();
    if (!d) return false;
    // On le dépose en local, puis on rejoue le chemin normal : une seule
    // logique de chargement, pas deux à garder cohérentes.
    localStorage.setItem(_reportDraftKey(reportType, period), JSON.stringify(d));
    if (loadReportDraft(reportType, period) && typeof apresChargement === 'function') {
      apresChargement();
    }
    return true;
  } catch { return false; }
}

function loadReportDraft(reportType, period) {
  const form = _rptFormFor(reportType);
  if (!form) return false;
  try {
    const raw = localStorage.getItem(_reportDraftKey(reportType, period));
    if (!raw) return false;
    const draft = JSON.parse(raw);
    form.author = draft.author ?? form.author;
    form.highlights = trimEmptyRows(draft.highlights || form.highlights, RPT_EMPTY_ROW.highlights);
    form.risks = trimEmptyRows(draft.risks || form.risks, RPT_EMPTY_ROW.risks);
    form.actions = trimEmptyRows(draft.actions || form.actions, RPT_EMPTY_ROW.actions);
    if (form.notes) form.notes = draft.notes || form.notes;
    return true;
  } catch (e) { return false; }
}

function saveDailyDraft() { saveReportDraft('daily', dailyAnchorDate); }
function loadDailyDraft(date) { return loadReportDraft('daily', date); }

function changeDailyDate(delta) {
  saveDailyForm();
  const d = new Date(dailyAnchorDate);
  d.setDate(d.getDate() + delta);
  dailyAnchorDate = d.toISOString().slice(0,10);
  loadDailyDraft(dailyAnchorDate);
  renderPage_daily();
}

function goToDailyDate() {
  saveDailyForm();
  const v = document.getElementById('daily-sel-date')?.value;
  if (v) { dailyAnchorDate = v; loadDailyDraft(dailyAnchorDate); renderPage_daily(); }
}

let _reportLayoutLoaded = false;
async function ensureReportLayoutLoaded() {
  if (_reportLayoutLoaded) return;
  _reportLayoutLoaded = true;
  await loadReportLayout();
}

async function renderPage_daily() {
  await ensureReportLayoutLoaded();
  // Avant saveDailyForm() : celui-ci écrit le formulaire courant (vide sur
  // un poste neuf) dans le brouillon, ce qui écraserait la version
  // serveur qu'on cherche justement à récupérer.
  await fetchReportDraftIfMissing('daily', dailyAnchorDate);
  saveDailyForm();
  const dyCountry = typeof getActiveCountry === 'function' ? getActiveCountry() : 'ALL';
  const data = await fetch(`${API}/api/reports/daily?date=${dailyAnchorDate}&country=${dyCountry}`).then(r => r.json());
  seedHighlightsFromObs(data.observations_open || []);
  dailyForm.risks = seedRisksFromTickets(dailyForm.risks);
  lastDailyReport = data;

  const dateSel = document.getElementById('daily-sel-date');
  if (dateSel) dateSel.value = dailyAnchorDate;

  const { locale: _dl, tz: _dtz } = getLangConfig();
  const dateShort = new Date(data.date).toLocaleDateString(_dl, { timeZone: _dtz });
  const dateLong  = new Date(data.date).toLocaleDateString(_dl, { timeZone: _dtz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  document.getElementById('daily-report-date').textContent = dateLong;
  const k = data.kpis;
  const slaPct = k.sla_compliance !== null && k.sla_compliance !== undefined ? `${k.sla_compliance}%` : 'N/A';

  // Chiffres du jour : des tuiles lisibles d'un coup d'œil plutôt qu'une
  // ligne de tableau. Une seule teinte ; le rouge ne s'allume que s'il y a
  // rupture SLA.
  const kpiTiles = [
    ['Opened today', k.total], ['Still open', k.open], ['SLA breach', k.breach, !!k.breach],
    ['Backlog (all)', k.overall_open ?? '-'], ['Resolved today', k.resolved_today ?? 0],
    ['MTTD', formatDuration(k.mttd_ms)], ['MTTR', formatDuration(k.mttr_ms)], ['SLA %', slaPct],
  ];
  const sec_metrics = `<div class="rd-kpis">${kpiTiles.map(([l, v, alert]) =>
      `<div class="rd-kpi${alert ? ' is-alert' : ''}"><span>${l}</span><b>${v}</b></div>`).join('')}</div>${rptMetricsNote('today')}`;

  // Tableau vide : une ligne qui le dit, sans en-têtes de colonnes orphelins.
  const rdEmpty = (txt, ok) => `<div class="rd-empty${ok ? ' is-ok' : ''}">${ok ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' : ''}${txt}</div>`;

  const sec_today = !data.today_tickets.length ? rdEmpty('No ticket opened today') : `<div style="${RPT_SCROLL}"><table style="${RPT_TBL};margin-bottom:24px">
          <thead><tr>
            ${['TT#','Src','Dom.','FO Owner','Severity','SLA Target','Time Left','SLA','Status'].map(h=>te(h)).map(h =>
              `<th style="${RPT_TH}">${h}</th>`).join('')}
          </tr></thead>
          <tbody>${data.today_tickets.length ? data.today_tickets.map(t => `
            <tr>
              <td style="${RPT_TD};font-family:'DM Mono',monospace;font-size:11px">${esc(t.sn_tt || '')}</td>
              <td style="${RPT_TD}">${esc(t.tracker)}</td>
              <td style="${RPT_TD}">${esc(t.domain || '')}</td>
              <td style="${RPT_TD}">${esc(t.fo_owner || '')}</td>
              <td style="${RPT_TD}">${esc(t.severity || '')}</td>
              <td style="${RPT_TD};color:var(--red);font-weight:600">${slaTarget(t)}</td>
              <td style="${RPT_TD};font-family:'DM Mono',monospace;font-size:11px" class="${timeLeftClass(t.time_left_ms, t.status)}">${formatTimeLeft(t.time_left_ms, t.status)}</td>
              <td style="${RPT_TD}">${esc(t.sla_status || '')}</td>
              <td style="${RPT_TD}">${esc(t.status || '')}</td>
            </tr>`).join('') : `<tr><td colspan="9" style="${RPT_TD};color:var(--mute);padding:24px;text-align:center">No tickets opened today</td></tr>`}
          </tbody>
        </table></div>`;

  const sec_breaches = !data.breach_tickets.length ? rdEmpty('No active SLA breach', true) : `<div style="${RPT_SCROLL}"><table style="${RPT_TBL};margin-bottom:24px">
          <thead><tr>
            ${['TT#','Src','Dom.','FO Owner','BO Handling','Severity','SLA Target','Overdue by','Status'].map(h=>te(h)).map(h =>
              `<th style="${RPT_TH}">${h}</th>`).join('')}
          </tr></thead>
          <tbody>${data.breach_tickets.length ? data.breach_tickets.map(t => `
            <tr>
              <td style="${RPT_TD};font-family:'DM Mono',monospace;font-size:11px">${esc(t.sn_tt || '')}</td>
              <td style="${RPT_TD}">${esc(t.tracker)}</td>
              <td style="${RPT_TD}">${esc(t.domain || '')}</td>
              <td style="${RPT_TD}">${esc(t.fo_owner || '')}</td>
              <td style="${RPT_TD}">${esc(t.bo_handling || '')}</td>
              <td style="${RPT_TD}">${esc(t.severity || '')}</td>
              <td style="${RPT_TD};color:var(--red);font-weight:600">${slaTarget(t)}</td>
              <td style="${RPT_TD};font-family:'DM Mono',monospace;font-size:11px;color:var(--red);font-weight:700">${formatTimeLeft(t.time_left_ms, t.status)}</td>
              <td style="${RPT_TD}">${esc(t.status || '')}</td>
            </tr>`).join('') : `<tr><td colspan="9" style="${RPT_TD};color:var(--mute);padding:24px;text-align:center">No active SLA breaches</td></tr>`}
          </tbody>
        </table></div>`;

  const sec_highlights = `<div style="overflow-x:auto"><table style="${RPT_TBL.replace('border-radius:0 0 8px 8px','border-radius:0')}">
          <thead><tr>
            <th style="${RPT_TH}" colspan="2">Source / Category</th>
            <th style="${RPT_TH}" colspan="4">Observation</th>
            <th style="${RPT_TH}">Priority</th>
            <th style="${RPT_TH}" colspan="2">Status</th>
            ${dailyForm.customCols.highlights.map(c => `<th style="${RPT_TH};white-space:nowrap">${esc(c.label)} <span onclick="removeDailyCustomCol('highlights','${c.id}')" title="Supprimer" style="cursor:pointer;opacity:.6">×</span></th>`).join('')}
            <th style="${RPT_TH};width:1%"></th>
          </tr></thead>
          <tbody>${dailyForm.highlights.map((r, i) => `
            <tr>
              <td style="${RPT_TD}" colspan="2">${rptInp(`hl-src-${i}`, r.source, 'Source...')}</td>
              <td style="${RPT_TD}" colspan="4">${rptInp(`hl-obs-${i}`, r.observation, 'Observation...')}</td>
              <td style="${RPT_TD}">${rptSel(`hl-pri-${i}`, r.priority, PRI_OPTS)}</td>
              <td style="${RPT_TD}" colspan="2">${rptSel(`hl-sta-${i}`, r.status, STA_OPTS)}</td>
              ${dailyForm.customCols.highlights.map(c => `<td style="${RPT_TD};min-width:120px">${rptInp(`hl-${c.id}-${i}`, r[c.id], '')}</td>`).join('')}
              <td style="${RPT_TD}"></td>
            </tr>`).join('')}
          </tbody>
        </table></div><div style="padding:10px 14px;display:flex;gap:8px;background:var(--bg2,#f7f8fa);border-top:1px solid var(--line)">${rptAddRowBtn('highlights')}${rptAddColBtn('daily','highlights')}</div>`;

  const sec_risks = `<div style="overflow-x:auto"><table style="${RPT_TBL.replace('border-radius:0 0 8px 8px','border-radius:0')}">
          <thead><tr>
            <th style="${RPT_TH};width:40px">#</th>
            <th style="${RPT_TH}" colspan="3">Description</th>
            <th style="${RPT_TH}">FO</th>
            <th style="${RPT_TH}">BO</th>
            <th style="${RPT_TH}">Priority</th>
            <th style="${RPT_TH}" colspan="2">Status</th>
            ${dailyForm.customCols.risks.map(c => `<th style="${RPT_TH};white-space:nowrap">${esc(c.label)} <span onclick="removeDailyCustomCol('risks','${c.id}')" title="Supprimer" style="cursor:pointer;opacity:.6">×</span></th>`).join('')}
            <th style="${RPT_TH};width:1%"></th>
          </tr></thead>
          <tbody>${dailyForm.risks.map((r, i) => `
            <tr${r._auto ? ' style="background:rgba(37,99,235,.05)"' : ''}>
              <td style="${RPT_TD};font-family:'DM Mono',monospace;color:var(--mute);background:var(--bg2);width:40px;text-align:center">${i + 1}</td>
              <td style="${RPT_TD}" colspan="3">${r._auto ? rptAutoDescCell(`risk-desc-${i}`, r, 'Description...') : rptInp(`risk-desc-${i}`, r.description, 'Description...')}</td>
              <td style="${RPT_TD};min-width:110px">${rptInp(`risk-fo-${i}`, r.fo || '', 'FO...')}</td>
              <td style="${RPT_TD};min-width:110px">${rptInp(`risk-bo-${i}`, r.bo || '', 'BO...')}</td>
              <td style="${RPT_TD}">${rptSel(`risk-pri-${i}`, r.priority, PRI_OPTS)}</td>
              <td style="${RPT_TD}" colspan="2">${rptSel(`risk-sta-${i}`, r.status, STA_OPTS)}</td>
              ${dailyForm.customCols.risks.map(c => `<td style="${RPT_TD};min-width:120px">${rptInp(`risk-${c.id}-${i}`, r[c.id], '')}</td>`).join('')}
              <td style="${RPT_TD}"></td>
            </tr>`).join('')}
          </tbody>
        </table></div><div style="padding:10px 14px;display:flex;gap:8px;background:var(--bg2,#f7f8fa);border-top:1px solid var(--line)">${rptAddRowBtn('risks')}${rptAddColBtn('daily','risks')}</div>`;

  const sec_actions = `<div style="overflow-x:auto"><table style="${RPT_TBL.replace('border-radius:0 0 8px 8px','border-radius:0')}">
          <thead><tr>
            <th style="${RPT_TH};width:40px">#</th>
            <th style="${RPT_TH}" colspan="3">Action Item</th>
            <th style="${RPT_TH}">Owner</th>
            <th style="${RPT_TH}">Priority</th>
            <th style="${RPT_TH}" colspan="3">ETA</th>
            ${dailyForm.customCols.actions.map(c => `<th style="${RPT_TH};white-space:nowrap">${esc(c.label)} <span onclick="removeDailyCustomCol('actions','${c.id}')" title="Supprimer" style="cursor:pointer;opacity:.6">×</span></th>`).join('')}
            <th style="${RPT_TH};width:1%"></th>
          </tr></thead>
          <tbody>${dailyForm.actions.map((r, i) => `
            <tr>
              <td style="${RPT_TD};font-family:'DM Mono',monospace;color:var(--mute);background:var(--bg2);width:40px;text-align:center">${i + 1}</td>
              <td style="${RPT_TD}" colspan="3">${rptInp(`act-item-${i}`, r.action, 'Action...')}</td>
              <td style="${RPT_TD}">${rptInp(`act-own-${i}`, r.owner, 'Owner...')}</td>
              <td style="${RPT_TD}">${rptSel(`act-pri-${i}`, r.priority, PRI_OPTS)}</td>
              <td style="${RPT_TD}" colspan="3">${rptInp(`act-eta-${i}`, r.eta, 'ETA...')}</td>
              ${dailyForm.customCols.actions.map(c => `<td style="${RPT_TD};min-width:120px">${rptInp(`act-${c.id}-${i}`, r[c.id], '')}</td>`).join('')}
              <td style="${RPT_TD}"></td>
            </tr>`).join('')}
          </tbody>
        </table></div><div style="padding:10px 14px;display:flex;gap:8px;background:var(--bg2,#f7f8fa);border-top:1px solid var(--line)">${rptAddRowBtn('actions')}${rptAddColBtn('daily','actions')}</div>`;

  // Sections : des blocs séparés par un filet (pas de carte sur carte), un
  // titre lisible avec son compteur, repliables, et une barre pour sauter
  // directement à l'une d'elles.
  const rdLabels = { metrics: 'Key metrics', today: 'Opened today', breaches: 'Active SLA breaches',
    highlights: 'Operational highlights', risks: 'Risks & issues', actions: "Tomorrow's priority actions" };
  const filled = rows => (rows || []).filter(r => Object.keys(r).some(c => !c.startsWith('_') && String(r[c] || '').trim() && !['priority', 'status'].includes(c))).length;
  const rdCounts = { today: data.today_tickets.length, breaches: data.breach_tickets.length,
    highlights: filled(dailyForm.highlights), risks: filled(dailyForm.risks), actions: filled(dailyForm.actions) };
  const rdCol = rdCollapsed();
  const bodies = { metrics: sec_metrics, today: sec_today, breaches: sec_breaches, highlights: sec_highlights, risks: sec_risks, actions: sec_actions };
  const ordered = getOrderedSections('daily');
  const badge = key => key in rdCounts
    ? `<span class="rd-count${key === 'breaches' && rdCounts[key] ? ' is-alert' : ''}">${rdCounts[key]}</span>` : '';

  document.getElementById('daily-report-content').innerHTML = `
    <div class="rpt-doc rd-doc">
      <header class="rd-head">
        <div>
          <div class="rd-eyebrow">Front Office daily report · EMOC</div>
          <h2 class="rd-title">${dateLong}</h2>
        </div>
        <div class="rd-meta">
          <label class="rd-author"><span>Prepared by</span><input id="daily-author" value="${esc(dailyForm.author || rptDefaultAuthor())}" placeholder="Name - Role" oninput="dailyForm.author=this.value"></label>
          <span class="rd-site">Dakar · ${dateShort}</span>
        </div>
      </header>
      <nav class="rd-nav" aria-label="Sections">
        ${ordered.filter(([key]) => !isSectionHidden('daily', key)).map(([key]) =>
          `<button type="button" onclick="rdJump('${key}')">${rdLabels[key] || key}${badge(key)}</button>`).join('')}
      </nav>
      <div class="rd-body">
        ${ordered.map(([key, title]) => {
          const tail = `${badge(key)}<button type="button" class="rd-fold" onclick="rdFold('${key}')" aria-label="Collapse section" aria-expanded="${!rdCol.includes(key)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>`;
          const hidden = isSectionHidden('daily', key);
          return `<section class="rd-sec${rdCol.includes(key) ? ' is-col' : ''}" id="rd-sec-${key}">${rptBar('daily', key, rdLabels[key] || title, '', hidden ? '' : tail)}${hidden ? '' : `<div class="rd-sec-body">${bodies[key]}</div>`}</section>`;
        }).join('')}
      </div>
    </div>`;
  // La barre des sections colle au haut de la zone qui défile ; celle-ci a
  // un rembourrage haut que « top:0 » laisserait voir au-dessus d'elle.
  const rdNav = document.querySelector('#daily-report-content .rd-nav');
  const rdScroller = rdNav && rdNav.closest('.main');
  if (rdScroller) rdNav.style.top = -(parseFloat(getComputedStyle(rdScroller).paddingTop) || 0) + 'px';
  setTimeout(() => { document.querySelectorAll('#daily-report-content textarea').forEach(t => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }); }, 0);
  renderRptSidePanel('daily');

  // Publie le rapport mis en forme pour la diffusion. Différé : la page
  // doit s'afficher d'abord, la construction du classeur n'a aucune
  // urgence et ne doit pas retarder le rendu.
  setTimeout(() => { _publishDailyForMail(); }, 1200);
}


// Sections repliées du rapport quotidien : préférence locale du poste.
function rdCollapsed() { try { return JSON.parse(localStorage.getItem('rd-collapsed') || '[]'); } catch (e) { return []; } }
function rdFold(key) {
  const sec = document.getElementById('rd-sec-' + key);
  if (!sec) return;
  const col = sec.classList.toggle('is-col');
  sec.querySelector('.rd-fold')?.setAttribute('aria-expanded', String(!col));
  const list = rdCollapsed().filter(k => k !== key);
  if (col) list.push(key);
  try { localStorage.setItem('rd-collapsed', JSON.stringify(list)); } catch (e) {}
}
function rdJump(key) {
  const sec = document.getElementById('rd-sec-' + key);
  if (!sec) return;
  if (sec.classList.contains('is-col')) rdFold(key);
  sec.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  sec.classList.remove('is-flash'); void sec.offsetWidth; sec.classList.add('is-flash');
}
