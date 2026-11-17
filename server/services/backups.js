const fs          = require('fs');
const path        = require('path');
const { DATA_DIR, tenantDir } = require('../config/paths');

// ── SAUVEGARDES ───────────────────────────────────────────────
// Les données de production vivent dans des fichiers JSON sur un poste
// unique : sans copie, une fausse manœuvre ou un disque défaillant les
// emporte définitivement.
//
// La v2.5 avait retiré les snapshots *horaires*, qui saturaient le disque
// pour peu de valeur. On ne les rétablit pas : une copie par jour, avec
// une rétention bornée, couvre le besoin réel sans revenir au défaut qui
// avait motivé leur suppression. `BACKUP_RETENTION_DAYS=0` les désactive.
// Un dossier backups/ par tenant, dans son propre dossier de données. En
// base (STORE=supabase|pg), les sauvegardes sont celles de la base.
const BACKUP_RETENTION = Number.isFinite(Number(process.env.BACKUP_RETENTION_DAYS))
  ? Number(process.env.BACKUP_RETENTION_DAYS) : 14;

// Un dossier par jour : reprendre le même horodatage rend l'opération
// idempotente, donc un redémarrage en série ne crée pas dix copies.
function backupData() {
  if (BACKUP_RETENTION <= 0) return;
  if (require('../core/backend').backend().kind !== 'fs') return;
  const slugs = ['default'];
  try { for (const d of fs.readdirSync(path.join(DATA_DIR, 'tenants'))) slugs.push(d); } catch {}
  for (const slug of slugs) backupDir(tenantDir(slug));
}

function backupDir(dataDir) {
  if (!fs.existsSync(dataDir)) return;
  const BACKUPS_DIR = path.join(dataDir, 'backups');
  const day = new Date().toISOString().slice(0, 10);
  const dest = path.join(BACKUPS_DIR, day);
  try {
    if (fs.existsSync(dest)) return;                  // déjà sauvegardé aujourd'hui
    fs.mkdirSync(dest, { recursive: true });
    let n = 0;
    for (const f of fs.readdirSync(dataDir)) {
      // Uniquement les .json à la racine de data/ : ni le dossier
      // backups/ lui-même (qui se copierait en cascade), ni les .tmp
      // d'une écriture en cours, qui sont par nature incomplets.
      if (!f.endsWith('.json')) continue;
      const src = path.join(dataDir, f);
      if (!fs.statSync(src).isFile()) continue;
      fs.copyFileSync(src, path.join(dest, f));
      n++;
    }
    console.log(`[Pearl] Sauvegarde ${day} : ${n} fichier(s) → ${dest}`);
    pruneBackups(BACKUPS_DIR);
  } catch (err) {
    // Une sauvegarde ratée ne doit jamais empêcher l'app de tourner.
    console.error('[Pearl] Sauvegarde impossible :', err.message);
  }
}

// Rétention : au-delà de N dossiers, les plus anciens partent. Sans cela
// la sauvegarde règlerait un problème en en créant un autre — le disque.
function pruneBackups(BACKUPS_DIR) {
  let dirs;
  try { dirs = fs.readdirSync(BACKUPS_DIR).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)); }
  catch { return; }
  dirs.sort();                                        // ISO : ordre lexical = ordre chronologique
  for (const old of dirs.slice(0, Math.max(0, dirs.length - BACKUP_RETENTION))) {
    try {
      fs.rmSync(path.join(BACKUPS_DIR, old), { recursive: true, force: true });
      console.log(`[Pearl] Expired backup removed: ${old}`);
    } catch { /* on réessaiera au prochain passage */ }
  }
}

module.exports = {
  backupData,
};
