// ── EXPORT & PRINT ────────────────────────────────────────────
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

async function exportJSON() {
  // Réservé à l'admin : la session part avec la demande.
  const res = await fetch(`${API}/api/export`, { headers: AdminSession.headers(), credentials: 'same-origin' });
  if (res.status === 401) { if (typeof toast === 'function') toast('Session admin requise pour l\'export complet', 'error'); return; }
  if (!res.ok) { if (typeof toast === 'function') toast('Export impossible', 'error'); return; }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `pearl-data-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportStatsExcel() {
  const d = await fetch(`${API}/api/dashboard`).then(r => r.json());
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Breakdown');
  ws.columns = [{ width: 22 }, { width: 12 }, { width: 12 }];

  ws.mergeCells(1, 1, 1, 3);
  const title = ws.getCell(1, 1);
  title.value = 'TICKET BREAKDOWN - STATUS / DOMAIN / PRIORITY';
  xlFill(title, XL_RED);
  xlFont(title, { bold: true, color: { argb: XL_WHITE }, size: 13 });
  xlCenter(title);
  ws.getRow(1).height = 26;

  ws.mergeCells(2, 1, 2, 3);
  const sub = ws.getCell(2, 1);
  sub.value = 'Generated on ' + new Date().toLocaleString('en-GB');
  xlFill(sub, XL_BLACK);
  xlFont(sub, { color: { argb: XL_WHITE }, size: 9 });
  xlCenter(sub);

  let r = 4;
  const sections = [
    { title: 'BY STATUS',    data: d.by_status },
    { title: 'BY DOMAIN',    data: d.by_domain },
    { title: 'BY PRIORITY', data: d.by_priority },
  ];
  sections.forEach(sec => {
    xlBar(ws, r, 1, 3, sec.title); r++;
    ws.mergeCells(r, 1, r, 3);
    const note = ws.getCell(r, 1);
    note.value = 'For the pie chart: select Label + Count below → Insert → Pie';
    xlFont(note, { italic: true, size: 8.5, color: { argb: 'FF8A8D93' } });
    note.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    ws.getRow(r).height = 16;
    r++;
    xlHdr(ws, r, [1,2,3], ['Label', 'Nombre', '%']); r++;
    const entries = Object.entries(sec.data || {}).sort((a,b) => b[1]-a[1]);
    const total = entries.reduce((s,[,v]) => s+v, 0) || 1;
    if (entries.length) {
      entries.forEach(([k,v], i) => {
        xlCell(ws, r, 1, k, { zebra: i % 2 === 1 });
        xlCell(ws, r, 2, v, { zebra: i % 2 === 1, center: true });
        xlCell(ws, r, 3, Math.round((v/total)*100) + '%', { zebra: i % 2 === 1, center: true });
        r++;
      });
    } else {
      ws.mergeCells(r, 1, r, 3);
      xlCell(ws, r, 1, 'No data', { center: true });
      r++;
    }
    r++;
  });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `repartition-tickets-${date}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

// Dépose le classeur sur le serveur pour que l'envoi programmé expédie
// ce fichier-là — celui que la page vient de produire, avec sa mise en
// forme — plutôt qu'une reconstruction serveur qui en différerait.
// Silencieux en cas d'échec : l'export local, lui, a réussi, et l'utilisateur
// n'a pas à être alerté d'un aléa réseau sur une opération d'arrière-plan.
async function _uploadReportFile(type, buf, filename, period) {
  try {
    await fetch(`${API}/api/report-file/${type}`
      + `?filename=${encodeURIComponent(filename)}&period=${encodeURIComponent(period)}`
      // Pays affiché : le serveur range un classeur par pays.
      + `&country=${encodeURIComponent(typeof getActiveCountry === 'function' ? getActiveCountry() : 'ALL')}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buf,
    });
  } catch { /* sans effet sur le téléchargement déjà effectué */ }
}

// Construit le classeur du daily et renvoie son buffer. Extrait de
// exportDailyExcel pour être réutilisable sans déclencher de
// téléchargement : l'envoi programmé a besoin du même fichier, mais
// personne ne clique à 8 h du matin.
async function _buildDailyWorkbookBuffer(dataIn) {
  // La mise en forme vit dans daily-workbook.js, chargé aussi par le
  // serveur : un seul générateur, donc le rapport reçu par mail est
  // exactement celui qu'on exporte ici. C'est ce partage qui règle le
  // « ce n'est pas le bon daily » — deux implémentations divergeaient.
  const data = dataIn || lastDailyReport || await fetch(
    `${API}/api/reports/daily?country=${typeof getActiveCountry === 'function' ? getActiveCountry() : 'ALL'}`
  ).then(r => r.json());
  const { locale, tz } = getLangConfig();
  return buildDailyWorkbook(ExcelJS, data, collectDailyForm(), {
    locale, tz,
    author: dailyForm.author || rptDefaultAuthor(),
    // L'ordre et le masquage des sections sont propres à la page ; le
    // serveur s'en remet à l'ordre par défaut du module.
    sections: getOrderedSections('daily')
      .map(([key]) => key)
      .filter(key => !isSectionHidden('daily', key)),
    slaText: slaTargetText,
    lieu: scopeLabel(typeof getActiveCountry === 'function' ? getActiveCountry() : 'ALL'),
  });
}


async function exportDailyExcel() {
  const data = lastDailyReport || await fetch(
    `${API}/api/reports/daily?country=${typeof getActiveCountry === 'function' ? getActiveCountry() : 'ALL'}`
  ).then(r => r.json());
  const buf = await _buildDailyWorkbookBuffer(data);
  const jourISO = new Date(data.date).toISOString().slice(0, 10);
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Pearl_Daily_Report_${jourISO}.xlsx`;
  a.click();
  _uploadReportFile('daily', buf, a.download, jourISO);
  _dailyPublished = jourISO;
  toast('Excel export generated', 'success');
}

// Dépôt silencieux, sans téléchargement : appelé à l'ouverture de la page
// pour que l'envoi programmé dispose du rapport mis en forme même si
// personne n'a cliqué « Export Excel » ce jour-là. Faire dépendre un
// envoi automatique d'un geste manuel quotidien n'était pas tenable.
async function _publishDailyForMail() {
  try {
    if (typeof ExcelJS === 'undefined') return;
    const data = lastDailyReport;
    if (!data) return;
    const jourISO = new Date(data.date).toISOString().slice(0, 10);
    // Déjà publié pour cette date depuis cet onglet : inutile de
    // reconstruire le classeur à chaque rendu de la page.
    if (_dailyPublished === jourISO) return;
    // En consultation seule, le serveur refuserait l'écriture et la page
    // afficherait la fenêtre de connexion à la simple ouverture du rapport.
    if (typeof rptCanWrite === 'function' && !rptCanWrite()) return;
    const buf = await _buildDailyWorkbookBuffer(data);
    if (!buf) return;
    await _uploadReportFile('daily', buf, `Pearl_Daily_Report_${jourISO}.xlsx`, jourISO);
    _dailyPublished = jourISO;
  } catch { /* la page reste utilisable, l'envoi retombera sur le repli */ }
}
let _dailyPublished = null;

