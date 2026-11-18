const { buildWeeklyPptx } = require('../documents/weekly-pptx');
const { readCfg } = require('../core/store');
const { reportTZ, tzParts } = require('../core/time');
const { allEnriched } = require('../core/enrich');
const { readDrafts, readReportFile } = require('./report-store');
const { buildDailyReport, buildWeeklyReport } = require('./reports');
const { computeAbsenceSummary, readAbsences } = require('./absences');

// ── RAPPORTS PRODUITS PAR LE SERVEUR ──────────────────────────
// Les exports existants sont générés dans le navigateur (ExcelJS côté
// client). Un envoi programmé à 8 h n'a personne devant l'écran : le
// serveur doit donc produire le fichier lui-même. `exceljs` est déjà une
// dépendance du projet, rien à installer.
const ExcelJSSrv = require('exceljs');
// Générateur partagé avec la page : même code des deux côtés, donc le
// rapport envoyé par mail ne peut pas différer de celui exporté à
// l'écran. Vit dans public/ parce que le navigateur le charge aussi.
const { buildDailyWorkbook } = require('../../public/js/daily-workbook.js');

function xlsxHeader(ws, labels) {
  const r = ws.getRow(1);
  labels.forEach((l, i) => {
    const c = r.getCell(i + 1);
    c.value = l;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF37474F' } };
  });
  r.commit();
}

// Produit le classeur d'un rapport. Renvoie { filename, content, type }
// directement exploitable comme pièce jointe.
async function buildReportFile(kind, countryIn) {
  const jour = new Date().toISOString().slice(0, 10);
  const { PAYS, normPays } = require('./mail/bodies');
  const country = normPays(countryIn);
  const P = PAYS[country];
  const code = country === 'ALL' ? 'ALL' : country;

  // Priorité au classeur déposé par la page : c'est le rapport mis en
  // forme que l'équipe relit. À défaut d'un classeur du jour, on reprend
  // le dernier disponible — il porte la vraie mise en forme, et l'écart
  // de date est signalé dans le corps du mail. La génération ci-dessous
  // ne sert que si la page n'a jamais été ouverte.
  // Le classeur déposé ne sert que s'il a été produit pour ce pays : la
  // page dépose celui du pays affiché à l'écran.
  const frais = await readReportFile(kind, jour, country);
  if (frais) return frais;
  const dernier = await readReportFile(kind, null, country);
  if (dernier) return dernier;

  const wb = new ExcelJSSrv.Workbook();
  let nom = `rapport-${jour}.xlsx`;

  const kpiSheet = (titre, kpis) => {
    const ws = wb.addWorksheet(titre);
    ws.columns = [{ width: 34 }, { width: 18 }];
    xlsxHeader(ws, ['Indicateur', 'Valeur']);
    Object.entries(kpis || {}).forEach(([k, v], i) => {
      ws.getRow(i + 2).values = [k, (v && typeof v === 'object') ? JSON.stringify(v) : v];
    });
    return ws;
  };

  const ticketSheet = (titre, liste) => {
    const ws = wb.addWorksheet(titre);
    const cols = ['sn_tt', 'imoc_tt', 'title', 'status', 'priority', 'domain',
                  'fo_owner', 'open_date', 'close_date', 'sla_status'];
    ws.columns = cols.map(() => ({ width: 18 }));
    xlsxHeader(ws, ['TT', 'Réf. externe', 'Titre', 'Statut', 'Priorité', 'Domaine',
                    'FO', 'Ouvert', 'Clôturé', 'SLA']);
    (liste || []).forEach((t, i) => {
      ws.getRow(i + 2).values = cols.map(c => t[c] ?? '');
    });
    return ws;
  };

  // Sections rédigées à la main : elles ne sortent d'aucun calcul, et un
  // rapport qui les omet n'est pas celui que l'équipe relit.
  const redige = (ws, titre, lignes) => {
    if (!lignes || !lignes.length) return;
    const r = ws.rowCount + 2;
    ws.getCell(`A${r}`).value = titre;
    ws.getCell(`A${r}`).font = { bold: true, size: 12 };
    // Chaque ligne est un objet dont les clés varient selon le type de
    // section : on aplatit les valeurs renseignées plutôt que de figer un
    // schéma qui casserait à la première colonne personnalisée.
    lignes.forEach((l, i) => {
      const vals = (l && typeof l === 'object')
        ? Object.entries(l).filter(([k, v]) => !k.startsWith('_') && v !== '' && v != null)
            .map(([, v]) => String(v))
        : [String(l)];
      ws.getRow(r + 1 + i).values = vals;
    });
  };

  if (kind === 'daily') {
    const d = buildDailyReport(null, country);
    // Même générateur que la page : c'est ce partage qui garantit qu'un
    // rapport reçu par mail est identique à celui exporté à l'écran.
    // Le serveur n'a plus besoin que personne n'ouvre le navigateur.
    const br = readDrafts()[`daily:${jour}`] || {};
    const form = {
      author:     br.author || '',
      highlights: br.highlights || [],
      risks:      br.risks || [],
      actions:    br.actions || [],
      notes:      br.notes || '',
      // Colonnes personnalisées : portées par la mise en page, que le
      // serveur ne connaît pas. Vides plutôt qu'absentes, sinon le
      // générateur bute sur `.length`.
      customCols: { highlights: [], risks: [], actions: [] },
    };
    const cfg = readCfg();
    const buffer = await buildDailyWorkbook(ExcelJSSrv, d, form, {
      locale: 'fr-FR',
      tz: reportTZ(cfg),
      author: br.author || '',
      lieu: P.ville,
      slaText: t => require('../core/sla').slaTargetLabel(t, cfg),
    });
    return {
      filename: `Pear_Daily_Report_${code}_${jour}.xlsx`,
      content: Buffer.from(buffer),
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      period: jour,
    };
  } else if (kind === 'weekly') {
    const d = buildWeeklyReport(null, country);
    nom = `weekly-${code}-${jour}.xlsx`;
    const ws = kpiSheet('KPI', d.kpis);
    // Clé 'YYYY-MM-DD' comme la page : c'est weeklyAnchorDate, une date
    // et non un numéro de semaine.
    const br = readDrafts()[`weekly:${jour}`];
    if (br) {
      redige(ws, 'Highlights', br.highlights);
      redige(ws, 'Risques',    br.risks);
      redige(ws, 'Actions',    br.actions);
    }
    ticketSheet('Tickets', d.tickets || d.week_tickets || []);
  } else if (kind === 'monthly') {
    // Le mensuel n'a pas de fonction extraite : on rejoue son calcul via
    // les mêmes briques que la route.
    const cfg = readCfg();
    const tz  = reportTZ(cfg);
    const nowP = tzParts(new Date(), tz);
    const tickets = allEnriched(cfg, country);
    nom = `monthly-${code}-${nowP.year}-${String(nowP.month).padStart(2, '0')}.xlsx`;
    ticketSheet('Tickets', tickets);
  } else if (kind === 'weekly_pptx') {
    // Même générateur que le bouton de la page : le management reçoit le
    // deck qu'on lui présente, pas une seconde version qui divergerait.
    // Périmètre choisi dans la planification ; le deck filtre lui-même
    // tickets, observations et agents sur ce pays.
    const d  = buildWeeklyReport(null, country);
    const br = readDrafts()[`weekly:${jour}`] || {};
    const buf = await buildWeeklyPptx(d, {
      highlights: br.highlights || [],
      risks:      br.risks || [],
      actions:    br.actions || [],
      author:     br.author || '',
      country,
      fo_trackers: readCfg().fo_trackers || {},
    });
    return {
      filename: `Pear_Weekly_Review_${code}_${jour}.pptx`,
      content: Buffer.from(buf),
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      period: jour,
    };
  } else if (kind === 'absences') {
    // Rapport PDF analysé (tendances, agents à suivre, soldes) plutôt que
    // le registre brut : c'est le même document que le bouton Export.
    // Année en cours, agents du pays choisi (tous avec 'ALL').
    const { buildAbsencePdf } = require('../documents/absence-pdf');
    const summary = computeAbsenceSummary({ year: new Date().getUTCFullYear(), country, agentsDuPays: true });
    const agents = new Set((summary.balances || []).map(b => b.fo_name));
    const absences = country === 'ALL' ? readAbsences() : readAbsences().filter(a => agents.has(a.fo_name));
    const buf = buildAbsencePdf({ summary, absences, generatedAt: new Date() });
    return {
      filename: `Pear_Absence_Report_${code}_${summary.from}_${summary.to}.pdf`,
      content: Buffer.from(buf),
      type: 'application/pdf',
      period: jour,
    };
  } else {
    throw new Error(`Rapport inconnu : ${kind}`);
  }

  const content = await wb.xlsx.writeBuffer();
  return {
    filename: nom,
    content: Buffer.from(content),
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

module.exports = {
  ExcelJSSrv, buildReportFile,
};
