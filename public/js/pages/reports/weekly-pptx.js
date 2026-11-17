/* ── Export PPTX du rapport hebdomadaire ──────────────────────
   Généré côté serveur : le deck part des mêmes chiffres que la page
   (même endpoint), et les sections rédigées ici — highlights, risques,
   actions, notes — voyagent dans la requête puisqu'elles ne vivent que
   dans le brouillon local.

   Le bouton ouvre un aperçu au lieu de télécharger : sur un rapport
   qu'on relit et corrige plusieurs fois, chaque vérification laissait
   sinon un fichier de plus dans le dossier de téléchargements. Le
   téléchargement reste à un clic, depuis l'aperçu. */

// Le blob de la dernière génération, gardé pour que le bouton
// « Télécharger » de l'aperçu n'ait pas à régénérer le deck : c'est
// exactement le fichier que l'utilisateur vient de relire qui part sur
// le disque, et non un second rendu qui pourrait différer.
let weeklyPptxBlob = null;

async function buildWeeklyPptxBlob() {
  const res = await fetch(`${API}/api/reports/weekly.pptx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      date: weeklyAnchorDate,
      // Le deck porte le périmètre de l'en-tête : un site ou tous.
      country: typeof getActiveCountry === 'function' ? getActiveCountry() : 'ALL',
      form: {
        ...collectWeeklyForm(),
        author: weeklyForm.author || rptDefaultAuthor(),
        site: scopeLabel(typeof getActiveCountry === 'function' ? getActiveCountry() : 'ALL'),
      },
    }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || 'PPTX generation failed');
  }
  return res.blob();
}

function weeklyPptxFilename() {
  // Le nom de fichier est décidé par le serveur (Content-Disposition),
  // mais un download programmatique ne le lit pas : on le reconstruit.
  const day = (lastWeeklyReport?.week_start
    ? new Date(lastWeeklyReport.week_start)
    : new Date()).toISOString().slice(0, 10);
  return `Pearl_Weekly_Report_${day}.pptx`;
}

async function exportWeeklyPptx() {

  const btn   = document.getElementById('weekly-pptx-btn');
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }

  const modal = document.getElementById('pptx-preview-modal');
  const body  = document.getElementById('pptx-preview-body');
  try {
    weeklyPptxBlob = await buildWeeklyPptxBlob();
    weeklyPptxName = null;          // nom par défaut : celui du Weekly Report

    if (modal && body && typeof renderPptxPreview === 'function') {
      body.innerHTML = '<div class="pptx-preview-loading">Rendering preview…</div>';
      modal.classList.add('open');
      // L'aperçu est rendu depuis le fichier que l'on téléchargera : il
      // lit le vrai PPTX plutôt que de redessiner la maquette, donc il ne
      // peut pas diverger de ce qui sortira.
      const n = await renderPptxPreview(weeklyPptxBlob, body, { scale: 96 });
      const cnt = document.getElementById('pptx-preview-count');
      if (cnt) cnt.textContent = `${n} slide${n > 1 ? 's' : ''}`;
    } else {
      // Sans le module d'aperçu, le bouton retombe sur son comportement
      // d'origine : mieux vaut un téléchargement direct qu'un bouton mort.
      downloadWeeklyPptx();
    }
  } catch (e) {
    toast(e && e.message ? e.message : 'Serveur injoignable', 'error');
    if (modal) modal.classList.remove('open');
  } finally {
    if (btn) { btn.textContent = label; }
    // On repasse par le calcul de disponibilité plutôt que de réactiver
    // en dur : le site a pu changer pendant la génération.
    if (typeof _applyPptxAvailability === 'function') _applyPptxAvailability();
    else if (btn) btn.disabled = false;
  }
}

// Nom du fichier à télécharger depuis l'aperçu. L'aperçu est partagé
// entre le Weekly Report et le Weekly Progress : sans cette variable, un
// deck relu depuis Weekly Progress repartait sous le nom du Weekly
// Report. Elle est posée par celui qui ouvre l'aperçu.
let weeklyPptxName = null;

function downloadWeeklyPptx() {
  if (!weeklyPptxBlob) { toast('No PPTX to download', 'error'); return; }
  const url = URL.createObjectURL(weeklyPptxBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = weeklyPptxName || weeklyPptxFilename();
  a.click();
  URL.revokeObjectURL(url);
  toast('PPTX downloaded', 'success');
}

async function exportWeeklyExcel() {
  const data = lastWeeklyReport || await fetch(
    `${API}/api/reports/weekly?country=${typeof getActiveCountry === 'function' ? getActiveCountry() : 'ALL'}`
  ).then(r => r.json());
  const form = collectWeeklyForm();
  const k = data.kpis;
  const { locale: _l, tz: _tz } = getLangConfig();
  const wkLabel = `Week of ${new Date(data.week_start).toLocaleDateString(_l, { timeZone: _tz })} to ${new Date(data.week_end).toLocaleDateString(_l, { timeZone: _tz })}`;
  const slaPct = k.sla_compliance !== null && k.sla_compliance !== undefined ? `${k.sla_compliance}%` : 'N/A';
  const domRows  = Object.entries(data.by_domain || {}).sort((a, b) => b[1] - a[1]);
  const prioRows = Object.entries(data.by_priority || {}).sort((a, b) => ['P1','P2','P3','P4'].indexOf(a[0]) - ['P1','P2','P3','P4'].indexOf(b[0]));
  const foList   = data.fo_list || [];

  const WK_METRIC_SPANS = [
    [1,1,'Opened This Week'], [2,2,'Still Open'], [3,3,'SLA Breach'],
    [4,4,'Backlog (all)'], [5,5,'Resolved This Week'], [6,6,'MTTD'], [7,7,'MTTR'], [8,9,'SLA %'],
  ];
  const wkVals    = [k.total, k.open, k.breach, k.overall_open ?? '-', k.resolved_this_week,
    formatDuration(k.mttd_ms), formatDuration(k.mttr_ms), slaPct];
  const wkColors  = [XL_BLUE, XL_ORANGE, XL_RED_F, XL_BLACK, XL_GREEN, XL_BLACK, XL_BLACK, XL_GREEN];

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Weekly Report', { views: [{ state: 'frozen', ySplit: 2 }] });
  ws.columns = [
    { width: 14 }, { width: 10 }, { width: 10 }, { width: 18 },
    { width: 12 }, { width: 12 }, { width: 14 }, { width: 10 }, { width: 12 },
  ];

  ws.mergeCells(1, 1, 1, 10);
  const t1 = ws.getCell(1, 1);
  t1.value = 'WEEKLY REPORT';
  xlFill(t1, XL_RED);
  xlFont(t1, { bold: true, color: { argb: XL_WHITE }, size: 14 });
  xlCenter(t1);
  ws.getRow(1).height = 28;

  ws.mergeCells(2, 1, 2, 3);
  ws.mergeCells(2, 4, 2, 7);
  ws.mergeCells(2, 8, 2, 10);
  [[wkLabel], [weeklyForm.author || rptDefaultAuthor()], [scopeLabel(typeof getActiveCountry === 'function' ? getActiveCountry() : 'ALL')]].forEach(([txt], i) => {
    const c = ws.getCell(2, [1, 4, 8][i]);
    c.value = txt;
    xlFill(c, XL_BLACK);
    xlFont(c, { color: { argb: XL_WHITE }, size: 10 });
    c.alignment = { horizontal: i === 2 ? 'right' : i === 1 ? 'center' : 'left', vertical: 'middle' };
    c.border = XL_BORDER;
  });
  ws.getRow(2).height = 20;

  const maxCustomColsWk = Math.max(
    weeklyForm.customCols.highlights.length,
    weeklyForm.customCols.risks.length,
    weeklyForm.customCols.actions.length,
    0
  );
  for (let i = 0; i < maxCustomColsWk; i++) ws.getColumn(11 + i).width = 16;  // pas ws.columns.push : casse ExcelJS
  const lastColWk = 10 + maxCustomColsWk;

  const wkSectionRenderers = {
    metrics(r) {
      xlBar(ws, r, 1, lastColWk, 'GLOBAL METRICS'); r++;
      WK_METRIC_SPANS.forEach(([c1, c2, lbl]) => xlSpan(ws, r, c1, c2, lbl, { hdr: true }));
      if (lastColWk > 10) xlSpan(ws, r, 11, lastColWk, '', { hdr: true });
      r++;
      WK_METRIC_SPANS.forEach(([c1, c2], i) => xlSpan(ws, r, c1, c2, wkVals[i], {
        center: true, bold: true, size: 16, color: wkColors[i], height: 36,
      }));
      if (lastColWk > 10) { try { ws.mergeCells(r, 11, r, lastColWk); } catch(e){} ws.getCell(r, 11).border = {}; }
      r++;
      xlGap(ws, r, 1, lastColWk);
      return r + 1;
    },
    week(r) {
      xlBar(ws, r, 1, lastColWk, 'WEEK TT OVERVIEW'); r++;
      const ttHdrs = ['TT#','Src','Dom.','FO Owner','Severity','SLA Target','Time Left','SLA','Status'].map(h=>te(h));
      xlHdr(ws, r, [1,2,3,4,5,6,7,8,9], ttHdrs); r++;
      if (data.week_tickets.length) {
        data.week_tickets.forEach(t => {
          xlCell(ws, r, 1, t.sn_tt || '');
          xlCell(ws, r, 2, t.tracker || '');
          xlCell(ws, r, 3, t.domain || '');
          xlCell(ws, r, 4, t.fo_owner || '');
          xlCell(ws, r, 5, t.severity || '');
          xlCell(ws, r, 6, slaTargetText(t), { color: XL_RED_F });
          xlCell(ws, r, 7, formatTimeLeft(t.time_left_ms, t.status));
          xlCell(ws, r, 8, t.sla_status || '');
          xlCell(ws, r, 9, t.status || '');
          r++;
        });
      } else {
        ws.mergeCells(r, 1, r, lastColWk);
        xlCell(ws, r, 1, 'No tickets opened this week');
        r++;
      }
      xlGap(ws, r, 1, lastColWk);
      return r + 1;
    },
    active(r) {
      // active_tickets aren't part of this export's original layout; skip if not rendered elsewhere.
      return r;
    },
    breakdown(r) {
      xlBar(ws, r, 1, lastColWk, 'BY DOMAIN'); r++;
      xlSpan(ws, r, 1, 1, 'Domain', { hdr: true });
      xlSpan(ws, r, 2, lastColWk, 'Count', { hdr: true });
      r++;
      if (domRows.length) domRows.forEach(([d, v]) => {
        xlSpan(ws, r, 1, 1, d, { height: 26 });
        xlSpan(ws, r, 2, lastColWk, v, { noHeight: true });
        ws.getRow(r).height = 26; r++;
      }); else { xlSpan(ws, r, 1, lastColWk, '-'); r++; }
      r++;

      xlBar(ws, r, 1, lastColWk, 'BY PRIORITY'); r++;
      xlSpan(ws, r, 1, 1, 'Priority', { hdr: true });
      xlSpan(ws, r, 2, lastColWk, 'Count', { hdr: true });
      r++;
      if (prioRows.length) prioRows.forEach(([p, v]) => {
        xlSpan(ws, r, 1, 1, p, { height: 26 });
        xlSpan(ws, r, 2, lastColWk, v, { noHeight: true });
        ws.getRow(r).height = 26; r++;
      }); else { xlSpan(ws, r, 1, lastColWk, '-'); r++; }
      xlGap(ws, r, 1, lastColWk);
      return r + 1;
    },
    fo(r) {
      xlBar(ws, r, 1, lastColWk, 'FO PERFORMANCE'); r++;
      xlSpan(ws, r, 1, 4, 'FO Name', { hdr: true });
      xlSpan(ws, r, 5, 5, 'Open', { hdr: true });
      xlSpan(ws, r, 6, 6, 'Resolved', { hdr: true });
      xlSpan(ws, r, 7, lastColWk, 'Breach', { hdr: true });
      r++;
      foList.forEach(fo => {
        const d = (data.by_fo || {})[fo] || { open: 0, resolved: 0, breach: 0 };
        xlSpan(ws, r, 1, 4, fo, { height: 26 });
        xlSpan(ws, r, 5, 5, d.open, { noHeight: true });
        xlSpan(ws, r, 6, 6, d.resolved, { noHeight: true });
        xlSpan(ws, r, 7, lastColWk, d.breach, { noHeight: true });
        ws.getRow(r).height = 26; r++;
      });
      xlGap(ws, r, 1, lastColWk);
      return r + 1;
    },
    highlights(r) {
      const cols = weeklyForm.customCols.highlights;
      xlBar(ws, r, 1, lastColWk, 'OPERATIONAL HIGHLIGHTS'); r++;
      xlSpan(ws, r, 1, 2, 'Source / Category', { hdr: true });
      xlSpan(ws, r, 3, 6, 'Observation', { hdr: true });
      xlSpan(ws, r, 7, 7, 'Priority', { hdr: true });
      xlSpan(ws, r, 8, cols.length ? 9 : lastColWk, 'Status', { hdr: true });
      cols.forEach((c, i) => xlSpan(ws, r, 10 + i, 10 + i, c.label, { hdr: true }));
      r++;
      form.highlights.forEach(row => {
        xlSpan(ws, r, 1, 2, row.source, { height: 30 });
        xlSpan(ws, r, 3, 6, row.observation, { noHeight: true });
        xlSpan(ws, r, 7, 7, row.priority, { noHeight: true });
        xlSpan(ws, r, 8, cols.length ? 9 : lastColWk, row.status, { noHeight: true });
        cols.forEach((c, ci) => xlSpan(ws, r, 10 + ci, 10 + ci, row[c.id], { noHeight: true }));
        ws.getRow(r).height = 30; r++;
      });
      xlGap(ws, r, 1, lastColWk);
      return r + 1;
    },
    risks(r) {
      const cols = weeklyForm.customCols.risks;
      xlBar(ws, r, 1, lastColWk, 'RISKS & ISSUES'); r++;
      xlSpan(ws, r, 1, 1, '#', { hdr: true });
      xlSpan(ws, r, 2, 4, 'Description', { hdr: true });
      xlSpan(ws, r, 5, 5, 'FO', { hdr: true });
      xlSpan(ws, r, 6, 6, 'BO', { hdr: true });
      xlSpan(ws, r, 7, 7, 'Priority', { hdr: true });
      xlSpan(ws, r, 8, cols.length ? 9 : lastColWk, 'Status', { hdr: true });
      cols.forEach((c, i) => xlSpan(ws, r, 10 + i, 10 + i, c.label, { hdr: true }));
      r++;
      form.risks.forEach((row, i) => {
        const z = i % 2 === 1;
        xlSpan(ws, r, 1, 1, i + 1, { height: 30, center: true, zebra: z });
        xlSpan(ws, r, 2, 4, xlRiskDesc(row), { noHeight: true, zebra: z });
        xlSpan(ws, r, 5, 5, row.fo || '', { noHeight: true, zebra: z });
        xlSpan(ws, r, 6, 6, row.bo || '', { noHeight: true, zebra: z });
        xlSpan(ws, r, 7, 7, row.priority, { noHeight: true, semantic: true });
        xlSpan(ws, r, 8, cols.length ? 9 : lastColWk, row.status, { noHeight: true, semantic: true });
        cols.forEach((c, ci) => xlSpan(ws, r, 10 + ci, 10 + ci, row[c.id], { noHeight: true, zebra: z }));
        ws.getRow(r).height = 30; r++;
      });
      xlGap(ws, r, 1, lastColWk);
      return r + 1;
    },
    actions(r) {
      const cols = weeklyForm.customCols.actions;
      xlBar(ws, r, 1, lastColWk, 'NEXT WEEK ACTIONS'); r++;
      xlSpan(ws, r, 1, 1, '#', { hdr: true });
      xlSpan(ws, r, 2, 4, 'Action Item', { hdr: true });
      xlSpan(ws, r, 5, 5, 'Owner', { hdr: true });
      xlSpan(ws, r, 6, 6, 'Priority', { hdr: true });
      xlSpan(ws, r, 7, cols.length ? 9 : lastColWk, 'ETA', { hdr: true });
      cols.forEach((c, i) => xlSpan(ws, r, 10 + i, 10 + i, c.label, { hdr: true }));
      r++;
      form.actions.forEach((row, i) => {
        xlSpan(ws, r, 1, 1, i + 1, { height: 30 });
        xlSpan(ws, r, 2, 4, row.action, { noHeight: true });
        xlSpan(ws, r, 5, 5, row.owner, { noHeight: true });
        xlSpan(ws, r, 6, 6, row.priority, { noHeight: true });
        xlSpan(ws, r, 7, cols.length ? 9 : lastColWk, row.eta, { noHeight: true });
        cols.forEach((c, ci) => xlSpan(ws, r, 10 + ci, 10 + ci, row[c.id], { noHeight: true }));
        ws.getRow(r).height = 30; r++;
      });
      xlGap(ws, r, 1, lastColWk);
      return r + 1;
    },
  };

  xlGap(ws, 3, 1, lastColWk);
  let r = 4;
  getOrderedSections('weekly').forEach(([key]) => {
    if (isSectionHidden('weekly', key)) return;
    const renderFn = wkSectionRenderers[key];
    if (renderFn) r = renderFn(r);
  });

  xlBar(ws, r, 1, lastColWk, 'MANAGER NOTES'); r++;
  xlSpan(ws, r, 1, 1, '#', { hdr: true });
  xlSpan(ws, r, 2, lastColWk, 'Note', { hdr: true });
  r++;
  form.notes.forEach((row, i) => {
    xlSpan(ws, r, 1, 1, i + 1, { height: 30 });
    xlSpan(ws, r, 2, lastColWk, row.note, { noHeight: true });
    ws.getRow(r).height = 30; r++;
  });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  // Période = la date du jour et non le début de semaine : c'est sur
  // elle que le serveur vérifie la fraîcheur au moment de l'envoi.
  a.download = `Pearl_Weekly_Report_${new Date(data.week_start).toISOString().slice(0, 10)}.xlsx`;
  a.click();
  _uploadReportFile('weekly', buf, a.download, new Date().toISOString().slice(0, 10));
  toast('Excel export generated', 'success');
}

function printReport(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const html = `<!DOCTYPE html>
    <html><head>
      <title>Report</title>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
      <style>
        body{font-family:'DM Sans',sans-serif;margin:24px;color:#111;font-size:13px}
        .badge{display:inline-block;padding:2px 7px;border-radius:3px;font-size:10px;font-weight:700;letter-spacing:.04em}
        @media print{body{margin:0}}
      </style>
    </head><body>
      ${el.innerHTML}
    </body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const win = window.open(url, '_blank');
  win.addEventListener('load', () => {
    setTimeout(() => { win.print(); URL.revokeObjectURL(url); }, 500);
  });
}

