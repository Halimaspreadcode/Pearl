/* ══════════════════════════════════════════════════════════════
   CLASSEUR DU DAILY REPORT — générateur partagé
   ══════════════════════════════════════════════════════════════
   Chargé par le navigateur (<script>) ET par le serveur (require).
   C'est le point essentiel : le rapport reçu par mail est produit par
   le même code que celui exporté depuis la page, donc il ne peut pas
   en différer. Deux implémentations auraient divergé à la première
   évolution de la mise en forme.

   Aucune dépendance au DOM ni à l'état du client : les données, le
   formulaire et la locale arrivent en paramètre, pour que le serveur
   puisse l'appeler sans navigateur — un envoi programmé à 8 h n'a
   personne devant l'écran.
══════════════════════════════════════════════════════════════ */
(function (racine) {
'use strict';

const XL_RED    = 'FFC7000B';
const XL_RED_D  = 'FFA0000A';
const XL_BLACK  = 'FF1A1C1E';
const XL_WHITE  = 'FFFFFFFF';
const XL_GREEN  = 'FF2E7D32';
const XL_GREEN_BG = 'FFE8F5E9';
const XL_RED_F  = 'FFC62828';
const XL_RED_BG = 'FFFFEBEE';
const XL_ORANGE = 'FFE65100';
const XL_ORANGE_BG = 'FFFFF3E0';
const XL_BLUE   = 'FF2563EB';
const XL_GRAY   = 'FFE5E7EB';
const XL_GRAY_BG = 'FFF5F6F8';
const XL_ZEBRA  = 'FFFAFAFB';
const XL_BORDER = {
  top:    { style: 'thin', color: { argb: XL_GRAY } },
  left:   { style: 'thin', color: { argb: XL_GRAY } },
  bottom: { style: 'thin', color: { argb: XL_GRAY } },
  right:  { style: 'thin', color: { argb: XL_GRAY } },
};

function xlFill(cell, argb) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}
function xlFont(cell, opts = {}) {
  cell.font = { name: 'Calibri', ...opts };
}
function xlCenter(cell) {
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
}
function xlLeft(cell) {
  cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true, indent: 1 };
}
function xlRiskDesc(row) {
  if (!row._auto) return row.description || '';
  const tag = row._autoType === 'near-breach' ? 'NEAR BREACH' : 'P1/P2 OPEN';
  const time = row._timeLeft ? ` | ${row._timeLeft}${row._autoType === 'near-breach' ? ' left' : ''}` : '';
  return `[${tag}${time}] ${row.description || ''}`;
}
function xlGap(ws, row, c1, c2) {
  for (let col = c1; col <= c2; col++) {
    const c = ws.getCell(row, col);
    c.value = '';
    c.border = {};
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_WHITE } };
  }
  try { ws.mergeCells(row, c1, row, c2); } catch(e) { /* already merged */ }
  ws.getRow(row).height = 10;
}
function xlBar(ws, row, c1, c2, text) {
  ws.mergeCells(row, c1, row, c2);
  const c = ws.getCell(row, c1);
  c.value = text;
  xlFill(c, XL_BLACK);
  xlFont(c, { bold: true, color: { argb: XL_WHITE }, size: 10 });
  xlLeft(c);
  c.border = {};
  ws.getRow(row).height = 26;
}
function xlHdr(ws, row, cols, labels) {
  labels.forEach((lbl, i) => {
    const c = ws.getCell(row, cols[i]);
    c.value = lbl;
    xlFill(c, XL_GRAY);
    xlFont(c, { bold: true, color: { argb: XL_BLACK }, size: 9 });
    xlLeft(c);
    c.border = XL_BORDER;
  });
  ws.getRow(row).height = 24;
}
// Colors a cell based on SLA / priority / status semantic value
function xlSemanticColor(val) {
  const v = String(val || '').toLowerCase();
  if (v === 'breach' || v === 'p1' || v === 'critical') return { fg: XL_RED_F, bg: XL_RED_BG };
  if (v === 'p2' || v === 'high' || v === 'open')       return { fg: XL_ORANGE, bg: XL_ORANGE_BG };
  if (v === 'in sla' || v === 'resolved' || v === 'closed') return { fg: XL_GREEN, bg: XL_GREEN_BG };
  return null;
}
function xlCell(ws, row, col, val, opts = {}) {
  const c = ws.getCell(row, col);
  c.value = val ?? '';
  c.border = XL_BORDER;
  xlFont(c, { size: 10, ...opts.font });
  if (opts.center) xlCenter(c);
  else xlLeft(c);
  if (opts.zebra) xlFill(c, XL_ZEBRA);
  if (opts.semantic) {
    const sem = xlSemanticColor(val);
    if (sem) { xlFill(c, sem.bg); c.font = { ...c.font, color: { argb: sem.fg }, bold: true }; xlCenter(c); }
  }
  if (opts.color) c.font = { ...c.font, color: { argb: opts.color } };
  if (opts.bold)  c.font = { ...c.font, bold: true };
  if (opts.size)  c.font = { ...c.font, size: opts.size };
  if (!opts.noHeight) ws.getRow(row).height = opts.height || 28;
}
function xlSpan(ws, row, c1, c2, val, opts = {}) {
  if (c1 !== c2) ws.mergeCells(row, c1, row, c2);
  const c = ws.getCell(row, c1);
  c.value = val ?? '';
  c.border = XL_BORDER;
  if (opts.hdr) {
    xlFill(c, XL_GRAY);
    xlFont(c, { bold: true, color: { argb: XL_BLACK }, size: 9 });
    xlLeft(c);
    ws.getRow(row).height = opts.height || 24;
  } else {
    xlFont(c, { size: opts.size || 10, bold: opts.bold, color: opts.color ? { argb: opts.color } : undefined });
    if (opts.zebra) xlFill(c, XL_ZEBRA);
    if (opts.semantic) {
      const sem = xlSemanticColor(val);
      if (sem) { xlFill(c, sem.bg); c.font = { ...c.font, color: { argb: sem.fg }, bold: true }; xlCenter(c); }
    }
    if (opts.center) xlCenter(c);
    else xlLeft(c);
    if (!opts.noHeight) ws.getRow(row).height = opts.height || 28;
  }
}
// Row of TT overview cells with semantic coloring for SLA/Time Left/Status columns
function xlTicketRow(ws, row, t, opts = {}) {
  xlCell(ws, row, 1, t.sn_tt || '', { zebra: opts.zebra, font: { name: 'Consolas' } });
  xlCell(ws, row, 2, t.tracker || '', { zebra: opts.zebra });
  xlCell(ws, row, 3, t.domain || '', { zebra: opts.zebra });
  xlCell(ws, row, 4, t.fo_owner || '', { zebra: opts.zebra });
  xlCell(ws, row, 5, t.severity || '', { zebra: opts.zebra, semantic: true });
  xlCell(ws, row, 6, slaTargetText(t), { zebra: opts.zebra, color: XL_RED_F, font: { name: 'Consolas' } });
  xlCell(ws, row, 7, formatTimeLeft(t.time_left_ms, t.status), { zebra: opts.zebra, font: { name: 'Consolas' } });
  xlCell(ws, row, 8, t.sla_status || '', { zebra: opts.zebra, semantic: true });
  xlCell(ws, row, 9, t.status || '', { zebra: opts.zebra, semantic: true });
}


function formatDuration(ms) {
  if (ms === null || ms === undefined) return '0h 00m';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

// Ordre par défaut des sections du daily, repris de RPT_SECTIONS côté
// page. Sert de repli quand l'appelant ne fournit pas d'ordre — le
// serveur, notamment, n'a pas de raison d'en imposer un.
const SECTIONS_DAILY = ['metrics', 'today', 'breaches', 'highlights', 'risks', 'actions'];

// En-têtes de colonnes. Côté page, `te()` puise dans le dictionnaire
// I18N ; ici on reprend son comportement de repli — la clé anglaise est
// déjà le libellé affiché. Porter tout I18N pour une table d'en-têtes
// alourdirait le module sans rien changer au résultat.
const te = (typeof window !== 'undefined' && typeof window.te === 'function')
  ? window.te
  : (key) => key;

// Délai restant : purement arithmétique, repris tel quel de la page.
function formatTimeLeft(ms, status) {
  if (ms === null || ms === undefined) return '-';
  if (status === 'Resolved' || status === 'Closed') {
    const abs = Math.abs(ms);
    const h = Math.floor(abs / 3600000); const m = Math.floor((abs % 3600000) / 60000);
    const s = ms >= 0 ? '+' : '−';
    return `${s}${h}h${String(m).padStart(2, '0')}m (audit)`;
  }
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86400000);
  const h = Math.floor((abs % 86400000) / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const s2 = Math.floor((abs % 60000) / 1000);
  const sign = ms >= 0 ? '+' : '−';
  if (d > 0) return `${sign}${d}d ${h}h ${String(m).padStart(2, '0')}m`;
  return `${sign}${h}h ${String(m).padStart(2, '0')}m ${String(s2).padStart(2, '0')}s`;
}

// Cible SLA : contrairement aux autres, elle dépend de la configuration
// (barème sla_hours) et de trois fonctions qui la lisent. Plutôt que de
// porter toute cette chaîne, l'appelant fournit la fonction — la page
// passe la sienne, le serveur la sienne. Sans elle, la colonne affiche
// « - » plutôt que de faire échouer tout le rapport.
let slaTargetText = () => '-';

async function buildDailyWorkbook(ExcelJS, data, form, opts) {
  const { locale = 'fr-FR', tz = 'UTC', author = '', sections, slaText, lieu = '' } = opts || {};
  // Un highlight clôturé n'a plus rien à signaler : il reste dans la page
  // mais sort du classeur (et du mail, voir services/mail/bodies.js).
  const HL_CLOS = /^(closed|clos|close|clôturé|cloturé|fermé|done|resolved|résolu)$/i;
  // Colonnes personnalisées : absentes du formulaire envoyé par certains
  // appelants. Sans elles, le classeur doit sortir quand même.
  const cc = (form && form.customCols) || {};
  const customCols = { highlights: cc.highlights || [], risks: cc.risks || [], actions: cc.actions || [] };
  form = { ...form, customCols,
    risks: form.risks || [], actions: form.actions || [],
    highlights: (form.highlights || []).filter(h => !HL_CLOS.test(String((h && h.status) || '').trim())) };
  const SECTIONS = (Array.isArray(sections) && sections.length) ? sections : SECTIONS_DAILY;
  if (typeof slaText === 'function') slaTargetText = slaText;
  const k = data.kpis;
  const _el = locale, _etz = tz;
  const dateStr = new Date(data.date).toLocaleDateString(_el, { timeZone: _etz });
  const slaPct = k.sla_compliance !== null && k.sla_compliance !== undefined ? `${k.sla_compliance}%` : 'N/A';

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Daily Report', { views: [{ state: 'frozen', ySplit: 2 }] });
  ws.columns = [
    { width: 14 }, { width: 8 }, { width: 10 }, { width: 18 },
    { width: 18 }, { width: 10 }, { width: 12 }, { width: 10 }, { width: 12 }, { width: 12 },
  ];

  // Row 1 - titre
  ws.mergeCells(1, 1, 1, 10);
  const t1 = ws.getCell(1, 1);
  t1.value = 'DAILY REPORT';
  xlFill(t1, XL_RED);
  xlFont(t1, { bold: true, color: { argb: XL_WHITE }, size: 14 });
  xlCenter(t1);
  ws.getRow(1).height = 30;

  // Row 2 - sous-titre
  ws.mergeCells(2, 1, 2, 3);
  ws.mergeCells(2, 4, 2, 7);
  ws.mergeCells(2, 8, 2, 10);
  [['Date : ' + dateStr], [author], [lieu]].forEach(([txt], i) => {
    const c = ws.getCell(2, [1, 4, 8][i]);
    c.value = txt;
    xlFill(c, XL_BLACK);
    xlFont(c, { color: { argb: XL_WHITE }, size: 10 });
    c.alignment = { horizontal: i === 2 ? 'right' : i === 1 ? 'center' : 'left', vertical: 'middle' };
    c.border = XL_BORDER;
  });
  ws.getRow(2).height = 22;

  const METRIC_SPANS = [
    [1,1,'Opened Today'], [2,2,'Still Open'], [3,3,'SLA Breach'],
    [4,4,'Backlog (all)'], [5,5,'Resolved Today'], [6,6,'MTTD'], [7,7,'MTTR'], [8,10,'SLA %'],
  ];
  const metricVals  = [k.total, k.open, k.breach, k.overall_open ?? '-', k.resolved_today ?? 0,
    formatDuration(k.mttd_ms), formatDuration(k.mttr_ms), slaPct];
  // Column 1 is now "Opened Today" (period-scoped) and column 4 the all-time
  // backlog, so the period blue leads and the neutral black moves to col 4.
  const metricColors = [XL_BLUE, XL_ORANGE, XL_RED_F, XL_BLACK, XL_GREEN, XL_BLACK, XL_BLACK, XL_GREEN];
  const metricBgs    = [XL_GRAY_BG, XL_ORANGE_BG, XL_RED_BG, XL_GRAY_BG, XL_GREEN_BG, XL_GRAY_BG, XL_GRAY_BG, XL_GREEN_BG];

  // Extra columns (beyond the fixed 10) for any custom column added in highlights/risks/actions.
  const maxCustomCols = Math.max(
    form.customCols.highlights.length,
    form.customCols.risks.length,
    form.customCols.actions.length,
    0
  );
  // ws.columns renvoie des objets Column : y pousser un objet simple casse
  // ExcelJS à l'écriture. On règle la largeur colonne par colonne.
  for (let i = 0; i < maxCustomCols; i++) ws.getColumn(11 + i).width = 16;
  const lastCol = 10 + maxCustomCols;

  const xlSectionRenderers = {
    metrics(r) {
      xlBar(ws, r, 1, lastCol, 'GLOBAL METRICS'); r++;
      METRIC_SPANS.forEach(([c1, c2, lbl]) => xlSpan(ws, r, c1, c2, lbl, { hdr: true }));
      if (lastCol > 10) xlSpan(ws, r, 11, lastCol, '', { hdr: true });
      r++;
      METRIC_SPANS.forEach(([c1, c2], i) => {
        xlSpan(ws, r, c1, c2, metricVals[i], { center: true, bold: true, size: 16, color: metricColors[i], height: 36 });
        xlFill(ws.getCell(r, c1), metricBgs[i]);
      });
      if (lastCol > 10) { try { ws.mergeCells(r, 11, r, lastCol); } catch(e){} ws.getCell(r, 11).border = {}; }
      r++;
      xlGap(ws, r, 1, lastCol);
      return r + 1;
    },
    today(r) {
      xlBar(ws, r, 1, lastCol, 'TODAY TT OVERVIEW'); r++;
      const ttHdrs = ['TT#','Src','Dom.','FO Owner','Severity','SLA Target','Time Left','SLA','Status'].map(h=>te(h));
      xlHdr(ws, r, [1,2,3,4,5,6,7,8,9], ttHdrs); r++;
      if (data.today_tickets.length) {
        data.today_tickets.forEach((tk, i) => { xlTicketRow(ws, r, tk, { zebra: i % 2 === 1 }); r++; });
      } else {
        ws.mergeCells(r, 1, r, lastCol);
        xlCell(ws, r, 1, 'No tickets opened today', { center: true });
        r++;
      }
      xlGap(ws, r, 1, lastCol);
      return r + 1;
    },
    breaches(r) {
      xlBar(ws, r, 1, lastCol, 'ACTIVE SLA BREACHES'); r++;
      const brHdrs = ['TT#','Src','Dom.','FO Owner','BO Handling','Severity','SLA Target','Overdue by','Status'].map(h=>te(h));
      xlSpan(ws, r, 1, 1, brHdrs[0], { hdr: true });
      xlSpan(ws, r, 2, 2, brHdrs[1], { hdr: true });
      xlSpan(ws, r, 3, 3, brHdrs[2], { hdr: true });
      xlSpan(ws, r, 4, 4, brHdrs[3], { hdr: true });
      xlSpan(ws, r, 5, 5, brHdrs[4], { hdr: true });
      xlSpan(ws, r, 6, 6, brHdrs[5], { hdr: true });
      xlSpan(ws, r, 7, 7, brHdrs[6], { hdr: true });
      xlSpan(ws, r, 8, 9, brHdrs[7], { hdr: true });
      xlSpan(ws, r, 10, 10, brHdrs[8], { hdr: true });
      r++;
      if (data.breach_tickets.length) {
        data.breach_tickets.forEach((bt, i) => {
          const z = i % 2 === 1;
          xlCell(ws, r, 1, bt.sn_tt || '', { zebra: z, font: { name: 'Consolas' } });
          xlCell(ws, r, 2, bt.tracker || '', { zebra: z });
          xlCell(ws, r, 3, bt.domain || '', { zebra: z });
          xlCell(ws, r, 4, bt.fo_owner || '', { zebra: z });
          xlCell(ws, r, 5, bt.bo_handling || '', { zebra: z });
          xlCell(ws, r, 6, bt.severity || '', { zebra: z, semantic: true });
          xlCell(ws, r, 7, slaTargetText(bt), { zebra: z, color: XL_RED_F, font: { name: 'Consolas' } });
          xlSpan(ws, r, 8, 9, formatTimeLeft(bt.time_left_ms, bt.status), { noHeight: true, zebra: z, color: XL_RED_F, bold: true });
          xlCell(ws, r, 10, bt.status || '', { zebra: z, semantic: true });
          r++;
        });
      } else {
        ws.mergeCells(r, 1, r, lastCol);
        xlCell(ws, r, 1, 'No active SLA breaches', { center: true });
        r++;
      }
      xlGap(ws, r, 1, lastCol);
      return r + 1;
    },
    highlights(r) {
      const cols = form.customCols.highlights;
      xlBar(ws, r, 1, lastCol, 'OPERATIONAL HIGHLIGHTS'); r++;
      xlSpan(ws, r, 1, 2, 'Source / Category', { hdr: true });
      xlSpan(ws, r, 3, 6, 'Observation', { hdr: true });
      xlSpan(ws, r, 7, 7, 'Priority', { hdr: true });
      xlSpan(ws, r, 8, cols.length ? 9 : lastCol, 'Status', { hdr: true });
      cols.forEach((c, i) => xlSpan(ws, r, 10 + i, 10 + i, c.label, { hdr: true }));
      r++;
      form.highlights.forEach((row, i) => {
        const z = i % 2 === 1;
        xlSpan(ws, r, 1, 2, row.source, { height: 30, zebra: z });
        xlSpan(ws, r, 3, 6, row.observation, { noHeight: true, zebra: z });
        xlSpan(ws, r, 7, 7, row.priority, { noHeight: true, semantic: true });
        xlSpan(ws, r, 8, cols.length ? 9 : lastCol, row.status, { noHeight: true, semantic: true });
        cols.forEach((c, ci) => xlSpan(ws, r, 10 + ci, 10 + ci, row[c.id], { noHeight: true, zebra: z }));
        ws.getRow(r).height = 30;
        r++;
      });
      xlGap(ws, r, 1, lastCol);
      return r + 1;
    },
    risks(r) {
      const cols = form.customCols.risks;
      xlBar(ws, r, 1, lastCol, 'RISKS & ISSUES'); r++;
      xlSpan(ws, r, 1, 1, '#', { hdr: true });
      xlSpan(ws, r, 2, 4, 'Description', { hdr: true });
      xlSpan(ws, r, 5, 5, 'FO', { hdr: true });
      xlSpan(ws, r, 6, 6, 'BO', { hdr: true });
      xlSpan(ws, r, 7, 7, 'Priority', { hdr: true });
      xlSpan(ws, r, 8, cols.length ? 9 : lastCol, 'Status', { hdr: true });
      cols.forEach((c, i) => xlSpan(ws, r, 10 + i, 10 + i, c.label, { hdr: true }));
      r++;
      form.risks.forEach((row, i) => {
        const z = i % 2 === 1;
        xlSpan(ws, r, 1, 1, i + 1, { height: 30, center: true, zebra: z });
        xlSpan(ws, r, 2, 4, xlRiskDesc(row), { noHeight: true, zebra: z });
        xlSpan(ws, r, 5, 5, row.fo || '', { noHeight: true, zebra: z });
        xlSpan(ws, r, 6, 6, row.bo || '', { noHeight: true, zebra: z });
        xlSpan(ws, r, 7, 7, row.priority, { noHeight: true, semantic: true });
        xlSpan(ws, r, 8, cols.length ? 9 : lastCol, row.status, { noHeight: true, semantic: true });
        cols.forEach((c, ci) => xlSpan(ws, r, 10 + ci, 10 + ci, row[c.id], { noHeight: true, zebra: z }));
        ws.getRow(r).height = 30;
        r++;
      });
      xlGap(ws, r, 1, lastCol);
      return r + 1;
    },
    actions(r) {
      const cols = form.customCols.actions;
      xlBar(ws, r, 1, lastCol, 'TOMORROW PRIORITY ACTION ITEMS'); r++;
      xlSpan(ws, r, 1, 1, '#', { hdr: true });
      xlSpan(ws, r, 2, 4, 'Action Item', { hdr: true });
      xlSpan(ws, r, 5, 5, 'Owner', { hdr: true });
      xlSpan(ws, r, 6, 6, 'Priority', { hdr: true });
      xlSpan(ws, r, 7, cols.length ? 9 : lastCol, 'ETA', { hdr: true });
      cols.forEach((c, i) => xlSpan(ws, r, 10 + i, 10 + i, c.label, { hdr: true }));
      r++;
      form.actions.forEach((row, i) => {
        const z = i % 2 === 1;
        xlSpan(ws, r, 1, 1, i + 1, { height: 30, center: true, zebra: z });
        xlSpan(ws, r, 2, 4, row.action, { noHeight: true, zebra: z });
        xlSpan(ws, r, 5, 5, row.owner, { noHeight: true, zebra: z });
        xlSpan(ws, r, 6, 6, row.priority, { noHeight: true, semantic: true });
        xlSpan(ws, r, 7, cols.length ? 9 : lastCol, row.eta, { noHeight: true, zebra: z });
        cols.forEach((c, ci) => xlSpan(ws, r, 10 + ci, 10 + ci, row[c.id], { noHeight: true, zebra: z }));
        ws.getRow(r).height = 30;
        r++;
      });
      return r;
    },
  };

  xlGap(ws, 3, 1, lastCol);
  let r = 4;
  // L'ordre et le masquage des sections sont configurables côté page
  // (report_layout). Ils arrivent donc en paramètre : le module ne lit
  // aucun état global, c'est ce qui lui permet de tourner côté serveur.
  // Sans `sections`, on retombe sur l'ordre par défaut du rapport.
  SECTIONS.forEach((key) => {
    const renderFn = xlSectionRenderers[key];
    if (renderFn) r = renderFn(r);
  });

  const buf = await wb.xlsx.writeBuffer();
  return buf;
}


racine.buildDailyWorkbook = buildDailyWorkbook;
})(typeof module !== 'undefined' && module.exports ? module.exports : window);
