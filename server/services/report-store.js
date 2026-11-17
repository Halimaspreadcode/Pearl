const fs          = require('fs');
const path        = require('path');
const { DATA_DIR, FILES } = require('../config/paths');
const { readJSON } = require('../core/store');

// ── CLASSEURS DÉPOSÉS PAR LA PAGE ─────────────────────────────
// Le rapport de la page est mis en forme par ~10 000 caractères de code
// client s'appuyant sur 26 helpers qui n'existent que dans le navigateur.
// Les réécrire ici produirait un second rapport, condamné à diverger du
// premier. La page dépose donc son classeur, et l'envoi le réexpédie —
// un seul générateur, aucun écart possible.
const REPORTS_DIR = path.join(DATA_DIR, 'reports');

function readReportFiles() { return readJSON(FILES.report_files, {}); }

// Le classeur déposé. `periodeAttendue` non nul exige qu'il corresponde
// à la période demandée ; nul, on accepte ce qu'on a. Un classeur par
// pays : la page dépose celui du pays affiché, et un envoi pour la Côte
// d'Ivoire ne doit pas partir avec le classeur du Sénégal. Les dépôts
// d'avant (sans pays) sont ignorés — le serveur reconstruit le rapport.
function readReportFile(type, periodeAttendue, pays = 'SN') {
  try {
    const meta = readReportFiles()[`${type}:${pays}`];
    if (!meta) return null;
    if (periodeAttendue && meta.period && meta.period !== periodeAttendue) return null;
    const chemin = path.join(REPORTS_DIR, `${type}-${pays}.xlsx`);
    if (!fs.existsSync(chemin)) return null;
    return {
      filename: meta.filename || `${type}.xlsx`,
      content: fs.readFileSync(chemin),
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      period: meta.period || '',
    };
  } catch { return null; }
}

// ── BROUILLONS DE RAPPORT ─────────────────────────────────────
// Stockés par (type, période) : 'daily' + '2026-09-20', 'weekly' +
// '2026-W38'… Ce sont les sections rédigées à la main, celles que le
// calcul ne produit pas. Sans elles côté serveur, un envoi programmé ne
// peut expédier que des chiffres.
//
// Pas derrière requireAdmin : la page Daily Report est ouverte à toute
// l'équipe, c'est elle qui rédige. Le verrou admin empêcherait les FO
// d'enregistrer leur propre rapport.
function readDrafts() { return readJSON(FILES.report_drafts, {}); }

module.exports = {
  REPORTS_DIR, readReportFiles, readReportFile, readDrafts,
};
