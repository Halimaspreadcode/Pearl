const path        = require('path');
const { FILES, dataDir } = require('../config/paths');
const { readJSON } = require('../core/store');
const { backend } = require('../core/backend');

// ── CLASSEURS DÉPOSÉS PAR LA PAGE ─────────────────────────────
// Le rapport de la page est mis en forme par ~10 000 caractères de code
// client s'appuyant sur 26 helpers qui n'existent que dans le navigateur.
// Les réécrire ici produirait un second rapport, condamné à diverger du
// premier. La page dépose donc son classeur, et l'envoi le réexpédie —
// un seul générateur, aucun écart possible.
// Dossier des classeurs du tenant courant (blobs).
const reportsDir = () => path.join(dataDir(), 'reports');

function readReportFiles() { return readJSON(FILES.report_files, {}); }

// Le classeur déposé. `periodeAttendue` non nul exige qu'il corresponde
// à la période demandée ; nul, on accepte ce qu'on a. Un classeur par
// site : la page dépose celui du site affiché, et un envoi pour un site
// ne doit pas partir avec le classeur d'un autre. Les dépôts d'avant
// (sans site) sont ignorés — le serveur reconstruit le rapport.
async function readReportFile(type, periodeAttendue, pays) {
  try {
    const meta = readReportFiles()[`${type}:${pays}`];
    if (!meta) return null;
    if (periodeAttendue && meta.period && meta.period !== periodeAttendue) return null;
    const content = await backend().getBlob(path.join(reportsDir(), `${type}-${pays}.xlsx`));
    if (!content) return null;
    return {
      filename: meta.filename || `${type}.xlsx`,
      content,
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
  reportsDir, readReportFiles, readReportFile, readDrafts,
};
