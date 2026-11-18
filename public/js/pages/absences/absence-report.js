// ── Export ─────────────────────────────────────────────────────
// ── RAPPORT D'ABSENCE ─────────────────────────────────────────
// L'export CSV existant est un journal : une ligne par absence, brut.
// Le rapport répond à une autre question — « où en est l'équipe sur la
// période ? » — et reprend les agrégats que le serveur calcule déjà pour
// la page (absState.summary). Rien n'est recalculé ici : un chiffre du
// rapport et le même chiffre à l'écran ne peuvent pas diverger.
// Rapport PDF. Pas de bibliothèque PDF dans le projet, et le README
// promet un déploiement sur VM sans accès Internet : en ajouter une
// serait un obstacle au déploiement. On produit donc une page mise en
// forme pour l'impression et on ouvre la boîte d'impression du
// navigateur, où « Enregistrer au format PDF » est la destination
// standard. Le rendu est identique sur toutes les machines puisque les
// styles sont embarqués dans le document.
// ── SIGNAUX DU RAPPORT ────────────────────────────────────────
// Deux profils que le tableau des soldes ne fait pas ressortir seul :
// il faut lire ligne à ligne pour les repérer, ce qu'on ne fait pas sur
// un rapport de dix agents.
//
//  1. Trop absent — deux signaux combinés, car ils ne décrivent pas la
//     même chose. Un agent nettement au-dessus de la moyenne de l'équipe
//     (volume), OU un agent qui multiplie les absences subies même en
//     petit volume (fréquence : 5 arrêts d'un jour désorganisent plus
//     qu'un arrêt de 5 jours). La moyenne se recalcule sur l'équipe
//     affichée, donc aucun seuil à maintenir quand l'effectif change.
//
//  2. Sans préavis — l'équipe découvre le trou le matin même. C'est le
//     champ no_notice_episodes, déjà calculé par le serveur.
const _ABS_SEUIL_MOYENNE = 1.5;   // × la moyenne d'équipe
const _ABS_SEUIL_SUBIS   = 3;     // épisodes subis à partir desquels on signale

function _absReportSignals(sum, rows) {
  const bal = (sum.balances || []);
  if (!bal.length) return { tropAbsents: [], sansPreavis: [], moyenne: 0, seuil: 0 };

  // Épisodes subis par agent : non calculé par le serveur, déduit des
  // types (`planned: false`) que summary renvoie déjà.
  const types = sum.types || {};
  const subis = {};
  for (const a of (rows || [])) {
    if (a.status === 'Refusée' || a.status === 'Annulée') continue;
    // Un type inconnu (donnée ancienne) est compté comme subi : ne pas le
    // compter du tout masquerait l'absence au lieu de la signaler.
    if (types[a.type]?.planned) continue;
    subis[a.fo_name] = (subis[a.fo_name] || 0) + 1;
  }

  const moyenne = bal.reduce((s, b) => s + (b.total_days || 0), 0) / bal.length;
  const seuil   = Math.round(moyenne * _ABS_SEUIL_MOYENNE * 10) / 10;

  const tropAbsents = bal
    .map(b => {
      const nSubis = subis[b.fo_name] || 0;
      const ratio  = moyenne ? (b.total_days || 0) / moyenne : 0;
      const parVolume    = moyenne > 0 && (b.total_days || 0) > seuil;
      const parFrequence = nSubis >= _ABS_SEUIL_SUBIS;
      return { ...b, nSubis, ratio, parVolume, parFrequence };
    })
    .filter(b => b.parVolume || b.parFrequence)
    .sort((a, b) => (b.total_days || 0) - (a.total_days || 0));

  const sansPreavis = bal
    .filter(b => (b.no_notice_episodes || 0) > 0)
    .sort((a, b) => (b.no_notice_episodes || 0) - (a.no_notice_episodes || 0));

  return { tropAbsents, sansPreavis, moyenne: Math.round(moyenne * 10) / 10, seuil };
}

// Téléchargement générique d'un Blob (PDF, etc.).
function _dlBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  // Révocation différée : certains navigateurs lisent l'URL après click().
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Rapport PDF généré côté serveur (server/absence-pdf.js) : vrai fichier
// PDF, graphiques et constats compris, au lieu de l'impression navigateur.
// Même année et même périmètre que _absReportData, pour que PDF et Excel
// montrent les mêmes chiffres.
async function exportAbsenceReportPDF() {
  const adminOk = typeof AdminSession !== 'undefined' && AdminSession.active;
  if (!AbsenceSession.token && !adminOk) {
    throw new Error('Ouvrez d\'abord la page Absences pour déverrouiller les données RH.');
  }
  const year    = absState.year || new Date().getFullYear();
  const country = (typeof currentCountry !== 'undefined' && currentCountry !== 'ALL')
    ? currentCountry : '';
  const qs = `year=${year}${country ? `&country=${encodeURIComponent(country)}` : ''}`;
  const res = await fetch(`${API}/api/absences/report.pdf?${qs}`, { headers: AbsenceSession.headers() });
  if (res.status === 401) throw new Error('Session Absences expirée — rouvrez la page Absences.');
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `Génération du rapport impossible (HTTP ${res.status})`);
  }
  const blob = await res.blob();
  const cd   = res.headers.get('Content-Disposition') || '';
  const name = (cd.match(/filename="?([^";]+)"?/) || [])[1] || `Pear_Absence_Report_${year}.pdf`;
  _dlBlob(blob, name);
  toast('Rapport PDF téléchargé', 'success');
}

// Données du rapport, partagées par les versions PDF et Excel : les deux
// doivent montrer exactement les mêmes chiffres.
async function _absReportData() {

  // Appelable depuis la page Export, où la page Absences n'a jamais été
  // ouverte : absState est alors vide. On charge ce qu'il manque plutôt
  // que de renvoyer l'utilisateur ouvrir une autre page d'abord.
  // Les absences ont leur propre session, distincte de l'admin — sans
  // elle le serveur refuse, et c'est le déverrouillage de la page
  // Absences qui la délivre.
  if (!absState.summary || !absState.data) {
    // Une session admin ouvre aussi les absences (bypass explicite) : on
    // n'exige le jeton Absences que si l'admin n'est pas connecté.
    const adminOk = typeof AdminSession !== 'undefined' && AdminSession.active;
    if (!AbsenceSession.token && !adminOk) {
      throw new Error('Ouvrez d\'abord la page Absences pour déverrouiller les données RH.');
    }
    const year    = absState.year || new Date().getFullYear();
    const country = (typeof currentCountry !== 'undefined' && currentCountry !== 'ALL')
      ? currentCountry : '';
    const qs = `year=${year}${country ? `&country=${country}` : ''}`;
    const [listRes, sumRes] = await Promise.all([
      fetch(`${API}/api/absences`, { headers: AbsenceSession.headers() }),
      fetch(`${API}/api/absences/summary?${qs}`, { headers: AbsenceSession.headers() }),
    ]);
    if (!listRes.ok || !sumRes.ok) {
      throw new Error('Session Absences expirée — rouvrez la page Absences.');
    }
    absState.year    = absState.year || year;
    absState.data    = await listRes.json();
    absState.summary = await sumRes.json();
  }

  return { sum: absState.summary, rows: absState.data || [] };
}

// Version Excel du même rapport : mêmes données, format tableur pour qui
// veut filtrer ou recalculer.
async function exportAbsenceReport() {
  const { sum, rows } = await _absReportData();
  const sig = _absReportSignals(sum, rows);

  const wb = new ExcelJS.Workbook();
  const per = `${sum.from || ''} → ${sum.to || ''}`;

  // ── Feuille 1 : points d'attention, en tête du classeur. Mêmes
  // signaux et mêmes seuils que la version PDF — les deux rapports
  // doivent désigner les mêmes agents.
  if (sig.tropAbsents.length || sig.sansPreavis.length) {
    const wsA = wb.addWorksheet('Points d\'attention');
    wsA.columns = [{ width: 24 }, { width: 14 }, { width: 12 }, { width: 12 },
                   { width: 12 }, { width: 34 }];
    let r = 1;
    if (sig.tropAbsents.length) {
      xlHdr(wsA, r, [1, 2, 3, 4, 5, 6],
        ['Absentéisme élevé', 'Jours absents', 'vs moyenne', 'Épisodes', 'dont subis', 'Motif']);
      r++;
      sig.tropAbsents.forEach((b, i) => {
        const motif = [b.parVolume ? 'volume au-dessus du seuil' : '',
                       b.parFrequence ? 'absences subies répétées' : '']
                      .filter(Boolean).join(' · ');
        [b.fo_name, b.total_days, b.ratio ? Number(b.ratio.toFixed(1)) : '',
         b.episodes, b.nSubis, motif]
          .forEach((v, ci) => xlCell(wsA, r, ci + 1, v, { zebra: i % 2 === 1 }));
        r++;
      });
      r++;   // ligne vide entre les deux tableaux
    }
    if (sig.sansPreavis.length) {
      xlHdr(wsA, r, [1, 2, 3, 4, 5],
        ['Absences sans préavis', 'Épisodes sans préavis', 'Jours concernés',
         'Total épisodes', 'À qualifier']);
      r++;
      sig.sansPreavis.forEach((b, i) => {
        [b.fo_name, b.no_notice_episodes, b.no_notice_days, b.episodes, b.unqualified]
          .forEach((v, ci) => xlCell(wsA, r, ci + 1, v, { zebra: i % 2 === 1 }));
        r++;
      });
    }
  }

  // ── Feuille 2 : synthèse de la période
  const ws = wb.addWorksheet('Synthèse');
  ws.columns = [{ width: 38 }, { width: 18 }];
  xlHdr(ws, 1, [1, 2], ['Indicateur', 'Valeur']);
  const pct = v => (v === null || v === undefined) ? 'n/a' : `${v} %`;
  const synth = [
    ['Période',                         per],
    ['Périmètre',                       sum.country || 'Tous'],
    ['Agents suivis',                   sum.headcount ?? 0],
    ['Jours ouvrés de la période',      sum.working_days ?? 0],
    ['Jours d\'absence (total)',        sum.total_days ?? 0],
    ['dont non planifiés',              sum.unplanned_days ?? 0],
    ['Taux d\'absentéisme',             pct(sum.absence_rate)],
    ['Taux d\'absence non planifiée',   pct(sum.unplanned_rate)],
    ['Demandes en attente',             sum.pending_count ?? 0],
    ['Préavis respecté',                sum.notice_ok ?? 0],
    ['Préavis non respecté',            sum.notice_ko ?? 0],
    ['Préavis à qualifier',             sum.notice_unknown ?? 0],
    ['Taux de préavis respecté',        pct(sum.notice_rate)],
    ['Conflits absence / planning',     (sum.conflicts || []).length],
  ];
  synth.forEach(([k, v], i) => {
    xlCell(ws, i + 2, 1, k, { zebra: i % 2 === 1 });
    xlCell(ws, i + 2, 2, v, { zebra: i % 2 === 1 });
  });

  // ── Feuille 3 : par agent. C'est la vue qu'on relit en entretien.
  const wsB = wb.addWorksheet('Par agent');
  const BAL = [
    ['fo_name', 'Agent'], ['entitlement', 'Droit (j)'], ['taken', 'Pris (j)'],
    ['pending', 'En attente (j)'], ['remaining', 'Solde (j)'],
    ['sick_days', 'Maladie (j)'], ['total_days', 'Total absent (j)'],
    ['episodes', 'Épisodes'], ['no_notice_episodes', 'Sans préavis'],
    ['no_notice_days', 'Jours sans préavis'], ['unqualified', 'À qualifier'],
  ];
  wsB.columns = BAL.map((_, i) => ({ width: i === 0 ? 24 : 15 }));
  xlHdr(wsB, 1, BAL.map((_, i) => i + 1), BAL.map(([, l]) => l));
  (sum.balances || []).forEach((b, i) => {
    BAL.forEach(([k], ci) => xlCell(wsB, i + 2, ci + 1, b[k] ?? '', { zebra: i % 2 === 1 }));
  });

  // ── Feuille 4 : répartition par type puis par préavis, dans une seule
  // feuille — deux tableaux de quelques lignes ne justifient pas deux
  // onglets qu'il faudrait ouvrir l'un après l'autre.
  const wsT = wb.addWorksheet('Répartition');
  wsT.columns = [{ width: 30 }, { width: 16 }];
  xlHdr(wsT, 1, [1, 2], ['Type d\'absence', 'Jours']);
  const types = Object.entries(sum.by_type || {}).sort((a, b) => b[1] - a[1]);
  types.forEach(([k, v], i) => {
    xlCell(wsT, i + 2, 1, k, { zebra: i % 2 === 1 });
    xlCell(wsT, i + 2, 2, v, { zebra: i % 2 === 1 });
  });
  const off = types.length + 3;
  xlHdr(wsT, off, [1, 2], ['Préavis', 'Épisodes']);
  Object.entries(sum.by_notice || {}).sort((a, b) => b[1] - a[1])
    .forEach(([k, v], i) => {
      xlCell(wsT, off + 1 + i, 1, k, { zebra: i % 2 === 1 });
      xlCell(wsT, off + 1 + i, 2, v, { zebra: i % 2 === 1 });
    });

  // ── Feuille 5 : conflits, seulement s'il y en a. Une feuille vide
  // laisse croire à une erreur d'export.
  const conflicts = sum.conflicts || [];
  if (conflicts.length) {
    const wsC = wb.addWorksheet('Conflits planning');
    const C = [['date', 'Date'], ['fo_name', 'Agent'], ['shift_name', 'Shift'],
               ['absence_type', 'Type d\'absence'], ['absence_status', 'Statut']];
    wsC.columns = C.map(() => ({ width: 22 }));
    xlHdr(wsC, 1, C.map((_, i) => i + 1), C.map(([, l]) => l));
    conflicts.forEach((c, i) => {
      C.forEach(([k], ci) => xlCell(wsC, i + 2, ci + 1, c[k] ?? '', { zebra: i % 2 === 1 }));
    });
  }

  // ── Feuille 6 : le détail, pour pouvoir remonter à la ligne d'origine
  // derrière n'importe quel chiffre des feuilles précédentes.
  const wsD = wb.addWorksheet('Détail');
  const D = [['fo_name', 'Agent'], ['type', 'Type'], ['date_from', 'Du'], ['date_to', 'Au'],
             ['status', 'Statut'], ['notice', 'Préavis'], ['notice_date', 'Prévenu le'],
             ['reason', 'Motif'], ['created_at', 'Saisi le']];
  wsD.columns = D.map(() => ({ width: 20 }));
  xlHdr(wsD, 1, D.map((_, i) => i + 1), D.map(([, l]) => l));
  rows.forEach((a, i) => {
    D.forEach(([k], ci) => {
      let v = a[k] ?? '';
      if (k === 'created_at' && v) v = String(v).slice(0, 10);
      if (k === 'notice' && !v)    v = 'À qualifier';
      xlCell(wsD, i + 2, ci + 1, v, { zebra: i % 2 === 1 });
    });
  });

  await _dlWorkbook(wb, `Rapport_absences_${absState.year || ''}.xlsx`);
  toast('Rapport généré', 'success');
}

function exportAbsencesCSV() {
  const rows = absState.data || [];
  if (!rows.length) { toast('Nothing to export', 'error'); return; }
  const head = ['Agent', 'Type', 'Du', 'Au', 'Working days', 'Half day', 'Statut',
                'Notified', 'Notified on', 'Reason', 'Created on'];
  // Un champ commençant par = + - @ est interprété comme une formule
  // par Excel : on le neutralise par une apostrophe.
  const cell = v => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = [head.map(cell).join(';')]
    .concat(rows.map(a => [
      a.fo_name, a.type, a.date_from, a.date_to, _absDays(a),
      a.half_day || '', a.status,
      a.notice || 'À qualifier', a.notice_date || '',
      a.reason || '', (a.created_at || '').slice(0, 10),
    ].map(cell).join(';')))
    .join('\r\n');
  // BOM : sans lui Excel lit le CSV en ANSI et casse les accents.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `absences-${absState.year || ''}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
