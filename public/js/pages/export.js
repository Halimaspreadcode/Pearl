/* ══════════════════════════════════════════════════════════════
   PAGE EXPORT — dispatcher
   Les exports existaient déjà, chacun sur sa page. Cette page ne les
   réécrit pas : elle appelle les mêmes fonctions, pour qu'un fichier
   produit ici soit identique à celui produit depuis la page d'origine.
   Deux exceptions écrites ici parce qu'elles n'existaient nulle part :
   les observations et le planning des shifts.

   Une nuance importante : depuis leur page, les exports de trackers
   respectent les filtres affichés à l'écran. Ici il n'y a pas d'écran
   de tracker, donc pas de filtre visible — exporter « ce qui est
   filtré » produirait un fichier silencieusement incomplet. Les
   trackers partent donc complets depuis cette page.
══════════════════════════════════════════════════════════════ */

function _expStatus(msg, kind) {
  const el = document.getElementById('export-status');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'exp-status' + (kind ? ' is-' + kind : '');
}

// Enveloppe commune : désarme le bouton le temps de l'export et rend
// l'échec visible. Sans cela, un export qui échoue ne dit rien et
// l'utilisateur reclique dans le vide.
async function runExport(btn, kind) {
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Export…'; }
  _expStatus('Génération en cours…');
  try {
    await _runExportKind(kind);
    _expStatus('Export terminé.', 'ok');
  } catch (e) {
    console.error('[export]', kind, e);
    _expStatus('Échec de l\'export : ' + (e && e.message ? e.message : 'erreur inconnue'), 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}

async function _runExportKind(kind) {
  switch (kind) {
    // ── Rapports : chacun va chercher ses données s'il ne les a pas.
    case 'daily-xlsx':   return exportDailyExcel();
    case 'weekly-xlsx':  return exportWeeklyExcel();
    case 'weekly-pptx':  return exportWeeklyPptx();
    case 'monthly-xlsx': return exportMonthlyExcel();
    case 'ops-review':   return exportOpsReviewXLSX();
    case 'stats':        return exportStatsExcel();

    // ── Trackers, sans les filtres d'écran (voir l'en-tête de section).
    case 'tracker-sn':   return exportTrackerFull('sn');
    case 'tracker-ci':   return exportTrackerFull('ci');
    case 'tracker-all':  return exportTrackerFull(null);
    case 'observations': return exportObservationsExcel();

    // ── Planning & RH
    case 'planning':     return exportPlanningExcel();
    case 'absences':     return exportAbsencesCSV();
    case 'absence-report': return exportAbsenceReport();
    case 'absence-report-pdf': return exportAbsenceReportPDF();
    case 'quiz':         return exportQuizHistoryExcel();

    // ── Données brutes
    case 'data-quality': return exportDataQualityCSV();
    case 'json':         return exportJSON();

    default: throw new Error('Type d\'export inconnu : ' + kind);
  }
}

// Télécharge un classeur ExcelJS. Repris tel quel des exports existants,
// factorisé ici pour les trois fonctions ajoutées par cette page.
async function _dlWorkbook(wb, filename) {
  const buf  = await wb.xlsx.writeBuffer();
  const url  = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

// Tracker complet : `which` vaut 'sn', 'ci', ou null pour les deux.
async function exportTrackerFull(which) {
  const rows = which
    ? (state[which] || []).map(t => ({ ...t, _tracker: which }))
    : getGlobalTickets();
  if (!rows.length) throw new Error('Aucun ticket à exporter.');

  const cols = which ? getTrackerCols() : getGlobalTrackerCols();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(which ? `Tracker ${which.toUpperCase()}` : 'Tracker Global');
  ws.columns = cols.map(() => ({ width: 18 }));
  xlHdr(ws, 1, cols.map((_, i) => i + 1), cols.map(([, lbl]) => lbl));

  const DATES = ['occur_time','detection_time','open_date','close_date','workaround_date','modified_at'];
  rows.forEach((t, i) => {
    cols.forEach(([key], ci) => {
      let v = key === '_tracker' ? String(t._tracker || '').toUpperCase() : (t[key] ?? '');
      if (DATES.includes(key) && v) v = fmtDt(v);
      xlCell(ws, i + 2, ci + 1, v, { zebra: i % 2 === 1 });
    });
  });

  const date = new Date().toISOString().slice(0, 10);
  await _dlWorkbook(wb, `Tracker_${which ? which.toUpperCase() : 'GLOBAL'}_${date}.xlsx`);
  toast('Excel export generated', 'success');
}

// Observations : le formulaire est à schéma libre (FormData), donc les
// colonnes sont déduites des données plutôt que codées en dur — un champ
// ajouté au formulaire se retrouve dans l'export sans y toucher.
async function exportObservationsExcel() {
  const rows = state.observations || [];
  if (!rows.length) throw new Error('Aucune observation à exporter.');

  const PREF = ['date','source','priority','status','author','observation','description','comments'];
  const seen = new Set();
  rows.forEach(o => Object.keys(o).forEach(k => { if (!k.startsWith('_')) seen.add(k); }));
  const keys = [...PREF.filter(k => seen.has(k)), ...[...seen].filter(k => !PREF.includes(k)).sort()];

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Observations');
  ws.columns = keys.map(() => ({ width: 22 }));
  xlHdr(ws, 1, keys.map((_, i) => i + 1), keys.map(k => k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())));

  rows.forEach((o, i) => {
    keys.forEach((k, ci) => {
      let v = o[k] ?? '';
      if ((k === 'date' || k.endsWith('_at')) && v) v = fmtDt(v);
      xlCell(ws, i + 2, ci + 1, v, { zebra: i % 2 === 1 });
    });
  });

  await _dlWorkbook(wb, `Observations_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast('Excel export generated', 'success');
}

// Planning des shifts : une ligne par affectation. La page l'affiche en
// grille mensuelle, illisible une fois mise à plat — un tableau trié par
// date se relit et se filtre dans Excel.
async function exportPlanningExcel() {
  const rows = (state.shiftsPlan || []).slice()
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  if (!rows.length) throw new Error('Aucun shift planifié à exporter.');

  const LABELS = [['date','Date'], ['tracker','Tracker'], ['site','Site'],
                  ['shift','Shift'], ['fo','FO'], ['role','Rôle'], ['note','Note']];
  const extra = new Set();
  rows.forEach(r => Object.keys(r).forEach(k => {
    if (!k.startsWith('_') && !LABELS.some(([id]) => id === k)) extra.add(k);
  }));
  const cols = [...LABELS, ...[...extra].sort().map(k => [k, k])];

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Planning');
  ws.columns = cols.map(() => ({ width: 18 }));
  xlHdr(ws, 1, cols.map((_, i) => i + 1), cols.map(([, lbl]) => lbl));

  rows.forEach((r, i) => {
    cols.forEach(([key], ci) => {
      xlCell(ws, i + 2, ci + 1, r[key] ?? '', { zebra: i % 2 === 1 });
    });
  });

  await _dlWorkbook(wb, `Planning_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast('Excel export generated', 'success');
}

