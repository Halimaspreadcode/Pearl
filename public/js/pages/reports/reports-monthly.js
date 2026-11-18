// ── MONTHLY REPORT ────────────────────────────────────────────
// Year options were hard-coded to 2024-2026, which silently expires. Build the
// range from the data plus a window around today, so it always stays usable.
function fillMonthlyYears() {
  const sel = document.getElementById('monthly-sel-year');
  if (!sel) return;
  const now = new Date().getFullYear();
  const years = new Set([now - 1, now, now + 1, monthlyYear]);
  allTicketsRaw().forEach(t => {
    const y = t.open_date && new Date(t.open_date).getFullYear();
    if (y && !isNaN(y)) years.add(y);
  });
  const sorted = [...years].sort((a, b) => b - a);
  const cur = sel.value;
  sel.innerHTML = sorted.map(y => `<option value="${y}">${y}</option>`).join('');
  if (sorted.includes(+cur)) sel.value = cur;
}

let monthlyYear  = new Date().getFullYear();
let monthlyMonth = new Date().getMonth() + 1;

const MONTH_NAMES_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const MONTH_NAMES_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];

async function renderMonthlyReport() {
  await ensureReportLayoutLoaded();
  saveMonthlyForm();
  const moCountry = typeof getActiveCountry === 'function' ? getActiveCountry() : 'ALL';
  const res  = await fetch(`${API}/api/reports/monthly?year=${monthlyYear}&month=${monthlyMonth}&country=${moCountry}`);
  const data = await res.json();
  monthlyForm.risks = seedRisksFromTickets(monthlyForm.risks);
  lastMonthlyReport = data;
  const k   = data.kpis;
  const cfg = typeof getLangConfig === 'function' ? getLangConfig() : { locale:'en-GB' };
  // MONTH_NAMES_FR exists and the app has a language switch, so honour it
  // instead of pinning the month name to English.
  const isEN = (typeof currentLang === 'undefined') || currentLang !== 'fr';
  const mName = isEN ? MONTH_NAMES_EN[monthlyMonth-1] : MONTH_NAMES_FR[monthlyMonth-1];
  const monthLabel = `${mName} ${monthlyYear}`;

  document.getElementById('monthly-report-label').textContent = monthLabel;
  fillMonthlyYears();
  document.getElementById('monthly-sel-year').value  = monthlyYear;
  document.getElementById('monthly-sel-month').value = monthlyMonth;

  const domRows   = Object.entries(data.by_domain   || {}).sort((a,b)=>b[1]-a[1]);
  const prioRows  = Object.entries(data.by_priority || {}).sort((a,b)=>['P1','P2','P3','P4'].indexOf(a[0])-['P1','P2','P3','P4'].indexOf(b[0]));
  const typeRows  = Object.entries(data.by_type     || {}).sort((a,b)=>b[1]-a[1]);
  const statRows  = Object.entries(data.by_status   || {}).sort((a,b)=>b[1]-a[1]);

  /* ── Récap bento mensuel ── même grammaire que le weekly. */
  rcCatReset();
  const moNet = (k.resolved_this_month || 0) - (k.total || 0);
  const moActive = data.active_tickets || [];
  const moClose = (k.total || 0)
    ? Math.round(((k.resolved_this_month || 0) / k.total) * 100) : null;
  const moTk = data.month_tickets || [];
  const moP12 = moTk.length
    ? Math.round((moTk.filter(t => ['P1', 'P2'].includes(t.priority)).length / moTk.length) * 100) : null;
  const moSlaTone = k.sla_compliance == null ? 'warn'
    : k.sla_compliance >= 95 ? 'good' : k.sla_compliance < 85 ? 'alert' : 'warn';

  const sec_metrics = `<div class="rc rc-bento">
    ${rcCard({ variant: 'dark', span: 2,
      title: 'Monthly volume', sub: 'Opened, closed and in progress',
      body: rcHero({
        label: 'Tickets opened this month',
        value: k.total ?? 0,
        delta: (k.total || k.resolved_this_month)
          ? { text: (moNet >= 0 ? '+' : '') + moNet, tone: moNet >= 0 ? 'good' : 'alert' } : null,
        note: `${k.resolved_this_month ?? 0} closed · ${moActive.length} in progress`,
      }) + `<div class="rc-kpis" style="margin-top:26px;grid-template-columns:1fr 1fr">
        ${rcTile({ label: 'MTTR', value: formatDuration(k.mttr_ms), note: 'mean time to resolve' })}
        ${rcTile({ label: 'MTTD', value: formatDuration(k.mttd_ms), note: 'mean time to detect' })}
      </div>` })}

    ${rcCard({ title: 'SLA Compliance', sub: 'Over tickets opened in the period', span: 2,
      icon: 'gauge', iconTone: 'accent',
      body: `<div style="margin-top:auto">
        ${rcStat({ label: 'SLA Compliance',
                   value: k.sla_compliance == null ? 'n/a' : k.sla_compliance,
                   unit: k.sla_compliance == null ? '' : '%',
                   note: `${(k.total || 0) - (k.breach || 0)}/${k.total || 0} within target`,
                   pct: k.sla_compliance, tone: moSlaTone })}
        ${rcStat({ label: 'Closure Rate',
                   value: moClose == null ? 'n/a' : moClose,
                   unit: moClose == null ? '' : '%',
                   note: `${k.resolved_this_month ?? 0} closed of ${k.total ?? 0} opened`,
                   pct: moClose,
                   tone: moClose == null ? 'warn' : moClose >= 100 ? 'good' : moClose < 70 ? 'alert' : 'warn' })}
      </div>
      <div class="rc-card-foot">${k.breach ?? 0} rupture(s) SLA · part P1/P2 ${
        moP12 == null ? 'n/a' : moP12 + '%'} · encours global ${k.overall_open ?? 0}</div>` })}

    ${rcCard({ title: 'Findings for the month', sub: 'Automatically derived', span: 4, variant: 'plain',
      icon: 'trend', iconTone: 'accent',
      body: rcInsights(rcDeriveInsights(data, k.total || 0, k.resolved_this_month || 0, moActive)) })}
  </div>${rptMetricsNote('month')}`;

  const sec_breakdown = `<div class="rc rc-bento">
    ${rcCard({ title: 'By Domain', sub: 'Monthly volume', span: 2, icon: 'layers',
      body: rcBars(domRows, rcCatColor) })}
    ${rcCard({ title: 'By Priority', sub: 'Monthly volume', span: 2,
      body: rcBars(prioRows, p => ({ P1: 'var(--m3-error,#C7000B)', P2: '#E8710A', P3: '#1A73E8' }[p] || 'var(--m3-on-surf-var)')) })}
    ${rcCard({ title: 'By type', sub: 'Nature of tickets', span: 2, body: rcBars(typeRows, rcCatColor) })}
    ${rcCard({ title: 'By status', sub: 'State at end of period', span: 2, body: rcBars(statRows, _bxSegColor) })}
  </div>`;

  const sec_fo = `<div class="rc rc-bento">
    ${rcCard({ sub: 'Workload carried and share closed',
      span: 4, variant: 'plain', icon: 'users',
      body: rcFoRanking(data.by_fo, data.fo_list || state.config.fo_list || []) })}
  </div>`;

  /* Découpage hebdomadaire du mois : ouverts contre clôturés semaine par
     semaine. Barres jumelées plutôt qu'un tableau — c'est la tendance
     qu'on cherche, pas les valeurs exactes. */
  const moWeeks = data.weekly_breakdown || [];
  const moWkMax = Math.max(1, ...moWeeks.map(w => Math.max(w.opened || 0, w.closed || 0)));
  const sec_weekly = `<div class="rc rc-bento">
    ${rcCard({ title: 'Weekly breakdown', sub: 'Opened and closed by ISO week', span: 4, variant: 'plain',
      icon: 'trend',
      body: moWeeks.length ? `<div class="rc-cols">${moWeeks.map(w => {
        // Deux colonnes jumelées par semaine : la comparaison ouverts /
        // clôturés se fait verticalement, comme les mois du dashboard.
        const bar = (n, col) => `<span style="flex:1;display:flex;flex-direction:column;justify-content:flex-end">
            <span style="height:${Math.max(((n || 0) / moWkMax) * 100, n ? 6 : 0)}%;background:${col};
              border-radius:var(--m3-r-md,12px) var(--m3-r-md,12px) 0 0" title="${n || 0}"></span>
          </span>`;
        return `<div class="rc-col">
          <div class="rc-col-track" style="height:100%;flex-direction:row;gap:4px;padding:0 6px">
            ${bar(w.opened, '#1A73E8')}${bar(w.closed, '#1E8E3E')}
          </div>
          <div>
            <div class="rc-col-cap">S${w.iso_week}</div>
            <div class="rc-col-pct">${w.opened || 0} · ${w.closed || 0}</div>
          </div>
        </div>`;
      }).join('')}</div>
        <div class="rc-legend">
          <span><i style="background:#1A73E8"></i>Ouverts</span>
          <span><i style="background:#1E8E3E"></i>Closed</span>
        </div>`
        : '<div class="rc-empty">No week with activity this month</div>' })}
  </div>`;

  const sec_highlights = `<div style="overflow-x:auto"><table style="${RPT_TBL.replace('border-radius:0 0 8px 8px','border-radius:0')}">
          <thead><tr>
            <th style="${RPT_TH}" colspan="2">Source / Category</th>
            <th style="${RPT_TH}" colspan="4">Observation</th>
            <th style="${RPT_TH}">Priority</th>
            <th style="${RPT_TH}" colspan="2">Status</th>
            ${monthlyForm.customCols.highlights.map(c => `<th style="${RPT_TH};white-space:nowrap">${esc(c.label)} <span onclick="removeReportCustomCol('monthly','highlights','${c.id}')" title="Supprimer" style="cursor:pointer;opacity:.6">×</span></th>`).join('')}
            <th style="${RPT_TH};width:1%"></th>
          </tr></thead>
          <tbody>${monthlyForm.highlights.map((r, i) => `
            <tr>
              <td style="${RPT_TD}" colspan="2">${rptInp(`mo-hl-src-${i}`, r.source, 'Source...')}</td>
              <td style="${RPT_TD}" colspan="4">${rptInp(`mo-hl-obs-${i}`, r.observation, 'Observation...')}</td>
              <td style="${RPT_TD}">${rptSel(`mo-hl-pri-${i}`, r.priority, PRI_OPTS)}</td>
              <td style="${RPT_TD}" colspan="2">${rptSel(`mo-hl-sta-${i}`, r.status, STA_OPTS)}</td>
              ${monthlyForm.customCols.highlights.map(c => `<td style="${RPT_TD};min-width:120px">${rptInp(`mo-hl-${c.id}-${i}`, r[c.id], '')}</td>`).join('')}
              <td style="${RPT_TD}"></td>
            </tr>`).join('')}
          </tbody>
        </table></div><div style="padding:6px 0;display:flex;gap:14px">${rptAddRowBtn('monthlyHighlights')}${rptAddColBtn('monthly','highlights')}</div>`;

  const sec_risks = `<div style="overflow-x:auto"><table style="${RPT_TBL.replace('border-radius:0 0 8px 8px','border-radius:0')}">
          <thead><tr>
            <th style="${RPT_TH};width:40px">#</th>
            <th style="${RPT_TH}" colspan="3">Description</th>
            <th style="${RPT_TH}">FO</th>
            <th style="${RPT_TH}">BO</th>
            <th style="${RPT_TH}">Priority</th>
            <th style="${RPT_TH}" colspan="2">Status</th>
            ${monthlyForm.customCols.risks.map(c => `<th style="${RPT_TH};white-space:nowrap">${esc(c.label)} <span onclick="removeReportCustomCol('monthly','risks','${c.id}')" title="Supprimer" style="cursor:pointer;opacity:.6">×</span></th>`).join('')}
            <th style="${RPT_TH};width:1%"></th>
          </tr></thead>
          <tbody>${monthlyForm.risks.map((r, i) => `
            <tr${r._auto ? ' style="background:rgba(37,99,235,.05)"' : ''}>
              <td style="${RPT_TD};font-family:'DM Mono',monospace;color:var(--mute);background:var(--bg2);width:40px;text-align:center">${i + 1}</td>
              <td style="${RPT_TD}" colspan="3">${r._auto ? rptAutoDescCell(`mo-risk-desc-${i}`, r, 'Description...') : rptInp(`mo-risk-desc-${i}`, r.description, 'Description...')}</td>
              <td style="${RPT_TD};min-width:110px">${rptInp(`mo-risk-fo-${i}`, r.fo || '', 'FO...')}</td>
              <td style="${RPT_TD};min-width:110px">${rptInp(`mo-risk-bo-${i}`, r.bo || '', 'BO...')}</td>
              <td style="${RPT_TD}">${rptSel(`mo-risk-pri-${i}`, r.priority, PRI_OPTS)}</td>
              <td style="${RPT_TD}" colspan="2">${rptSel(`mo-risk-sta-${i}`, r.status, STA_OPTS)}</td>
              ${monthlyForm.customCols.risks.map(c => `<td style="${RPT_TD};min-width:120px">${rptInp(`mo-risk-${c.id}-${i}`, r[c.id], '')}</td>`).join('')}
              <td style="${RPT_TD}"></td>
            </tr>`).join('')}
          </tbody>
        </table></div><div style="padding:6px 0;display:flex;gap:14px">${rptAddRowBtn('monthlyRisks')}${rptAddColBtn('monthly','risks')}</div>`;

  const sec_actions = `<div style="overflow-x:auto"><table style="${RPT_TBL.replace('border-radius:0 0 8px 8px','border-radius:0')}">
          <thead><tr>
            <th style="${RPT_TH};width:40px">#</th>
            <th style="${RPT_TH}" colspan="3">Action Item</th>
            <th style="${RPT_TH}">Owner</th>
            <th style="${RPT_TH}">Priority</th>
            <th style="${RPT_TH}" colspan="3">ETA</th>
            ${monthlyForm.customCols.actions.map(c => `<th style="${RPT_TH};white-space:nowrap">${esc(c.label)} <span onclick="removeReportCustomCol('monthly','actions','${c.id}')" title="Supprimer" style="cursor:pointer;opacity:.6">×</span></th>`).join('')}
            <th style="${RPT_TH};width:1%"></th>
          </tr></thead>
          <tbody>${monthlyForm.actions.map((r, i) => `
            <tr>
              <td style="${RPT_TD};font-family:'DM Mono',monospace;color:var(--mute);background:var(--bg2);width:40px;text-align:center">${i + 1}</td>
              <td style="${RPT_TD}" colspan="3">${rptInp(`mo-act-item-${i}`, r.action, 'Action...')}</td>
              <td style="${RPT_TD}">${rptInp(`mo-act-own-${i}`, r.owner, 'Owner...')}</td>
              <td style="${RPT_TD}">${rptSel(`mo-act-pri-${i}`, r.priority, PRI_OPTS)}</td>
              <td style="${RPT_TD}" colspan="3">${rptInp(`mo-act-eta-${i}`, r.eta, 'ETA...')}</td>
              ${monthlyForm.customCols.actions.map(c => `<td style="${RPT_TD};min-width:120px">${rptInp(`mo-act-${c.id}-${i}`, r[c.id], '')}</td>`).join('')}
              <td style="${RPT_TD}"></td>
            </tr>`).join('')}
          </tbody>
        </table></div><div style="padding:6px 0;display:flex;gap:14px">${rptAddRowBtn('monthlyActions')}${rptAddColBtn('monthly','actions')}</div>`;

  const moBodies = { metrics: sec_metrics, weekly: sec_weekly, breakdown: sec_breakdown, fo: sec_fo, highlights: sec_highlights, risks: sec_risks, actions: sec_actions };
  const moTitles = { metrics: 'Month summary', weekly: 'Weekly Breakdown', breakdown: 'Breakdown', fo: 'Performance Front Office', highlights: 'Operational Highlights', risks: 'Risks &amp; Issues', actions: 'Next Month Priority Action Items' };
  const moExtraStyle = {};

  // Même parti que le weekly : plus de cadre imprimé ni de panneau
  // latéral, le récap occupe toute la largeur.
  if (!monthlyForm.author) monthlyForm.author = rptDefaultAuthor();
  document.getElementById('monthly-report-content').innerHTML =
    getOrderedSections('monthly').map(([key, title], idx) =>
      rptSection('monthly', key, moTitles[key] || title, moBodies[key], idx === 0 ? ';margin-top:0' : (moExtraStyle[key] || ''))
    ).join('');
  setTimeout(() => { document.querySelectorAll('#monthly-report-content textarea').forEach(t => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }); }, 0);
}

async function exportMonthlyExcel() {
  if (!lastMonthlyReport) { await renderMonthlyReport(); }
  saveMonthlyForm();
  const data = lastMonthlyReport;
  const form = { highlights: monthlyForm.highlights, risks: monthlyForm.risks, actions: monthlyForm.actions };
  const k    = data.kpis;
  const mName = MONTH_NAMES_EN[monthlyMonth-1];
  const slaPct = k.sla_compliance !== null && k.sla_compliance !== undefined ? `${k.sla_compliance}%` : 'N/A';
  const domRows  = Object.entries(data.by_domain   || {}).sort((a,b)=>b[1]-a[1]);
  const prioRows = Object.entries(data.by_priority || {}).sort((a,b)=>['P1','P2','P3','P4'].indexOf(a[0])-['P1','P2','P3','P4'].indexOf(b[0]));
  const typeRows = Object.entries(data.by_type     || {}).sort((a,b)=>b[1]-a[1]);
  const statRows = Object.entries(data.by_status   || {}).sort((a,b)=>b[1]-a[1]);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Monthly Report', { views: [{ state: 'frozen', ySplit: 2 }] });
  ws.columns = [
    { width: 14 }, { width: 10 }, { width: 10 }, { width: 18 },
    { width: 12 }, { width: 12 }, { width: 14 }, { width: 10 }, { width: 12 },
  ];

  ws.mergeCells(1, 1, 1, 10);
  const t1 = ws.getCell(1, 1);
  t1.value = `FRONT OFFICE MONTHLY REPORT - ${mName.toUpperCase()} ${monthlyYear}`;
  xlFill(t1, XL_RED);
  xlFont(t1, { bold: true, color: { argb: XL_WHITE }, size: 14 });
  xlCenter(t1);
  ws.getRow(1).height = 30;

  ws.mergeCells(2, 1, 2, 3);
  ws.mergeCells(2, 4, 2, 7);
  ws.mergeCells(2, 8, 2, 10);
  [[`${mName} ${monthlyYear}`], [monthlyForm.author || rptDefaultAuthor()], [scopeLabel(typeof getActiveCountry === 'function' ? getActiveCountry() : 'ALL')]].forEach(([txt], i) => {
    const c = ws.getCell(2, [1, 4, 8][i]);
    c.value = txt;
    xlFill(c, XL_BLACK);
    xlFont(c, { color: { argb: XL_WHITE }, size: 10 });
    c.alignment = { horizontal: i === 2 ? 'right' : i === 1 ? 'center' : 'left', vertical: 'middle' };
    c.border = XL_BORDER;
  });
  ws.getRow(2).height = 22;

  const METRIC_SPANS_MO = [
    [1,1,'Opened This Month'], [2,2,'Resolved This Month'], [3,3,'Still Open'],
    [4,4,'SLA Breach'], [5,5,'Backlog (all)'], [6,6,'MTTD'], [7,7,'MTTR'], [8,10,'SLA %'],
  ];
  const metricValsMo = [k.total, k.resolved_this_month, k.open, k.breach, k.overall_open ?? '-',
    formatDuration(k.mttd_ms), formatDuration(k.mttr_ms), slaPct];
  const metricColorsMo = [XL_BLUE, XL_GREEN, XL_ORANGE, XL_RED_F, XL_BLACK, XL_BLACK, XL_BLACK, XL_GREEN];

  const maxCustomColsMo = Math.max(
    monthlyForm.customCols.highlights.length,
    monthlyForm.customCols.risks.length,
    monthlyForm.customCols.actions.length,
    0
  );
  for (let i = 0; i < maxCustomColsMo; i++) ws.getColumn(11 + i).width = 16;  // pas ws.columns.push : casse ExcelJS
  const lastColMo = 10 + maxCustomColsMo;

  const moSectionRenderers = {
    metrics(r) {
      xlBar(ws, r, 1, lastColMo, 'GLOBAL METRICS'); r++;
      METRIC_SPANS_MO.forEach(([c1, c2, lbl]) => xlSpan(ws, r, c1, c2, lbl, { hdr: true }));
      if (lastColMo > 10) xlSpan(ws, r, 11, lastColMo, '', { hdr: true });
      r++;
      METRIC_SPANS_MO.forEach(([c1, c2], i) => xlSpan(ws, r, c1, c2, metricValsMo[i], {
        center: true, bold: true, size: 16, color: metricColorsMo[i], height: 36,
      }));
      if (lastColMo > 10) { try { ws.mergeCells(r, 11, r, lastColMo); } catch(e){} ws.getCell(r, 11).border = {}; }
      r++;
      xlGap(ws, r, 1, lastColMo);
      return r + 1;
    },
    weekly(r) {
      xlBar(ws, r, 1, lastColMo, 'WEEKLY BREAKDOWN'); r++;
      xlSpan(ws, r, 1, 2, 'Week', { hdr: true });
      xlSpan(ws, r, 3, 4, 'Opened', { hdr: true });
      xlSpan(ws, r, 5, 6, 'Resolved', { hdr: true });
      xlSpan(ws, r, 7, lastColMo, 'Breach', { hdr: true });
      r++;
      const { locale: _ml, tz: _mtz } = getLangConfig();
      (data.weekly_breakdown||[]).forEach((w,i) => {
        const ws2 = new Date(w.start).toLocaleDateString(_ml,{timeZone:_mtz,day:'2-digit',month:'short'});
        const we2 = new Date(w.end).toLocaleDateString(_ml,{timeZone:_mtz,day:'2-digit',month:'short'});
        xlSpan(ws, r, 1, 2, `S${i+1} · ${ws2} – ${we2}`, { height: 26 });
        xlSpan(ws, r, 3, 4, w.opened, { noHeight: true });
        xlSpan(ws, r, 5, 6, w.closed, { noHeight: true });
        xlSpan(ws, r, 7, lastColMo, w.breach, { noHeight: true, color: w.breach > 0 ? XL_RED_F : undefined, bold: w.breach > 0 });
        ws.getRow(r).height = 26; r++;
      });
      xlGap(ws, r, 1, lastColMo);
      return r + 1;
    },
    breakdown(r) {
      const groups = [['By Domain', domRows], ['By Priority', prioRows], ['By Type', typeRows], ['By Status', statRows]];
      groups.forEach(([title, rows]) => {
        xlBar(ws, r, 1, lastColMo, title.toUpperCase()); r++;
        xlSpan(ws, r, 1, 1, title.replace('By ',''), { hdr: true });
        xlSpan(ws, r, 2, lastColMo, 'Count', { hdr: true });
        r++;
        if (rows.length) rows.forEach(([name, v]) => {
          xlSpan(ws, r, 1, 1, name, { height: 26 });
          xlSpan(ws, r, 2, lastColMo, v, { noHeight: true });
          ws.getRow(r).height = 26; r++;
        }); else { xlSpan(ws, r, 1, lastColMo, '-'); r++; }
        r++;
      });
      return r;
    },
    fo(r) {
      xlBar(ws, r, 1, lastColMo, 'FO PERFORMANCE'); r++;
      xlSpan(ws, r, 1, 4, 'FO Name', { hdr: true });
      xlSpan(ws, r, 5, 5, 'Total', { hdr: true });
      xlSpan(ws, r, 6, 6, 'Open', { hdr: true });
      xlSpan(ws, r, 7, 7, 'Resolved', { hdr: true });
      xlSpan(ws, r, 8, lastColMo, 'Breach', { hdr: true });
      r++;
      Object.entries(data.by_fo||{}).forEach(([fo, v]) => {
        xlSpan(ws, r, 1, 4, fo, { height: 26 });
        xlSpan(ws, r, 5, 5, v.total||0, { noHeight: true });
        xlSpan(ws, r, 6, 6, v.open, { noHeight: true });
        xlSpan(ws, r, 7, 7, v.resolved, { noHeight: true });
        xlSpan(ws, r, 8, lastColMo, v.breach, { noHeight: true, color: v.breach > 0 ? XL_RED_F : undefined, bold: v.breach > 0 });
        ws.getRow(r).height = 26; r++;
      });
      xlGap(ws, r, 1, lastColMo);
      return r + 1;
    },
    tickets(r) {
      xlBar(ws, r, 1, lastColMo, `TICKETS OPENED THIS MONTH (${data.month_tickets?.length||0})`); r++;
      const ttHdrs = ['TT#','Title','Type','Domain','Priority','Status','FO Owner','SLA'].map(h=>te(h));
      xlSpan(ws, r, 1, 1, ttHdrs[0], { hdr: true });
      xlSpan(ws, r, 2, 3, ttHdrs[1], { hdr: true });
      xlSpan(ws, r, 4, 4, ttHdrs[2], { hdr: true });
      xlSpan(ws, r, 5, 5, ttHdrs[3], { hdr: true });
      xlSpan(ws, r, 6, 6, ttHdrs[4], { hdr: true });
      xlSpan(ws, r, 7, 7, ttHdrs[5], { hdr: true });
      xlSpan(ws, r, 8, 8, ttHdrs[6], { hdr: true });
      xlSpan(ws, r, 9, lastColMo, ttHdrs[7], { hdr: true });
      r++;
      (data.month_tickets||[]).forEach(mt => {
        xlSpan(ws, r, 1, 1, mt.sn_tt||'-', { height: 22, font: { name: 'Consolas' } });
        xlSpan(ws, r, 2, 3, mt.title||'-', { noHeight: true });
        xlSpan(ws, r, 4, 4, mt.type||'-', { noHeight: true });
        xlSpan(ws, r, 5, 5, mt.domain||'-', { noHeight: true });
        xlSpan(ws, r, 6, 6, mt.priority||'-', { noHeight: true, semantic: true });
        xlSpan(ws, r, 7, 7, mt.status||'-', { noHeight: true, semantic: true });
        xlSpan(ws, r, 8, 8, mt.fo_owner||'-', { noHeight: true });
        xlSpan(ws, r, 9, lastColMo, mt.sla_status||'-', { noHeight: true, color: mt.sla_status==='Breach' ? XL_RED_F : undefined, bold: mt.sla_status==='Breach' });
        ws.getRow(r).height = 22; r++;
      });
      xlGap(ws, r, 1, lastColMo);
      return r + 1;
    },
    highlights(r) {
      const cols = monthlyForm.customCols.highlights;
      xlBar(ws, r, 1, lastColMo, 'OPERATIONAL HIGHLIGHTS'); r++;
      xlSpan(ws, r, 1, 2, 'Source / Category', { hdr: true });
      xlSpan(ws, r, 3, 6, 'Observation', { hdr: true });
      xlSpan(ws, r, 7, 7, 'Priority', { hdr: true });
      xlSpan(ws, r, 8, cols.length ? 9 : lastColMo, 'Status', { hdr: true });
      cols.forEach((c, i) => xlSpan(ws, r, 10 + i, 10 + i, c.label, { hdr: true }));
      r++;
      (form.highlights||[]).forEach(row => {
        xlSpan(ws, r, 1, 2, row.source, { height: 30 });
        xlSpan(ws, r, 3, 6, row.observation, { noHeight: true });
        xlSpan(ws, r, 7, 7, row.priority, { noHeight: true, semantic: true });
        xlSpan(ws, r, 8, cols.length ? 9 : lastColMo, row.status, { noHeight: true, semantic: true });
        cols.forEach((c, ci) => xlSpan(ws, r, 10 + ci, 10 + ci, row[c.id], { noHeight: true }));
        ws.getRow(r).height = 30; r++;
      });
      xlGap(ws, r, 1, lastColMo);
      return r + 1;
    },
    risks(r) {
      const cols = monthlyForm.customCols.risks;
      xlBar(ws, r, 1, lastColMo, 'RISKS & ISSUES'); r++;
      xlSpan(ws, r, 1, 1, '#', { hdr: true });
      xlSpan(ws, r, 2, 4, 'Description', { hdr: true });
      xlSpan(ws, r, 5, 5, 'FO', { hdr: true });
      xlSpan(ws, r, 6, 6, 'BO', { hdr: true });
      xlSpan(ws, r, 7, 7, 'Priority', { hdr: true });
      xlSpan(ws, r, 8, cols.length ? 9 : lastColMo, 'Status', { hdr: true });
      cols.forEach((c, i) => xlSpan(ws, r, 10 + i, 10 + i, c.label, { hdr: true }));
      r++;
      (form.risks||[]).forEach((row, i) => {
        const z = i % 2 === 1;
        xlSpan(ws, r, 1, 1, i + 1, { height: 30, center: true, zebra: z });
        xlSpan(ws, r, 2, 4, xlRiskDesc(row), { noHeight: true, zebra: z });
        xlSpan(ws, r, 5, 5, row.fo || '', { noHeight: true, zebra: z });
        xlSpan(ws, r, 6, 6, row.bo || '', { noHeight: true, zebra: z });
        xlSpan(ws, r, 7, 7, row.priority, { noHeight: true, semantic: true });
        xlSpan(ws, r, 8, cols.length ? 9 : lastColMo, row.status, { noHeight: true, semantic: true });
        cols.forEach((c, ci) => xlSpan(ws, r, 10 + ci, 10 + ci, row[c.id], { noHeight: true, zebra: z }));
        ws.getRow(r).height = 30; r++;
      });
      xlGap(ws, r, 1, lastColMo);
      return r + 1;
    },
    actions(r) {
      const cols = monthlyForm.customCols.actions;
      xlBar(ws, r, 1, lastColMo, 'NEXT MONTH PRIORITY ACTION ITEMS'); r++;
      xlSpan(ws, r, 1, 1, '#', { hdr: true });
      xlSpan(ws, r, 2, 4, 'Action Item', { hdr: true });
      xlSpan(ws, r, 5, 5, 'Owner', { hdr: true });
      xlSpan(ws, r, 6, 6, 'Priority', { hdr: true });
      xlSpan(ws, r, 7, cols.length ? 9 : lastColMo, 'ETA', { hdr: true });
      cols.forEach((c, i) => xlSpan(ws, r, 10 + i, 10 + i, c.label, { hdr: true }));
      r++;
      (form.actions||[]).forEach((row, i) => {
        xlSpan(ws, r, 1, 1, i + 1, { height: 30 });
        xlSpan(ws, r, 2, 4, row.action, { noHeight: true });
        xlSpan(ws, r, 5, 5, row.owner, { noHeight: true });
        xlSpan(ws, r, 6, 6, row.priority, { noHeight: true, semantic: true });
        xlSpan(ws, r, 7, cols.length ? 9 : lastColMo, row.eta, { noHeight: true });
        cols.forEach((c, ci) => xlSpan(ws, r, 10 + ci, 10 + ci, row[c.id], { noHeight: true }));
        ws.getRow(r).height = 30; r++;
      });
      return r;
    },
  };

  xlGap(ws, 3, 1, lastColMo);
  let r = 4;
  getOrderedSections('monthly').forEach(([key]) => {
    if (isSectionHidden('monthly', key)) return;
    const renderFn = moSectionRenderers[key];
    if (renderFn) r = renderFn(r);
  });

  const buf  = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `Pear_Monthly_Report_${monthlyYear}-${String(monthlyMonth).padStart(2,'0')}.xlsx`;
  a.click();
  _uploadReportFile('monthly', buf, a.download, new Date().toISOString().slice(0, 10));
  toast('Excel export generated', 'success');
}

function changeMonth(delta) {
  saveMonthlyForm();
  monthlyMonth += delta;
  if (monthlyMonth > 12) { monthlyMonth = 1;  monthlyYear++; }
  if (monthlyMonth < 1)  { monthlyMonth = 12; monthlyYear--; }
  loadReportDraft('monthly', `${monthlyYear}-${String(monthlyMonth).padStart(2,'0')}`);
  renderMonthlyReport();
}

function goToMonth() {
  saveMonthlyForm();
  const y = parseInt(document.getElementById('monthly-sel-year').value);
  const m = parseInt(document.getElementById('monthly-sel-month').value);
  if (y && m) {
    monthlyYear = y; monthlyMonth = m;
    loadReportDraft('monthly', `${monthlyYear}-${String(monthlyMonth).padStart(2,'0')}`);
    renderMonthlyReport();
  }
}


