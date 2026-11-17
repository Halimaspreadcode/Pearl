const bcrypt      = require('bcryptjs');

// ── SECRETS ───────────────────────────────────────────────────
// Les mots de passe ne sont plus stockés en clair : seul leur condensé
// bcrypt vit dans le code/env, donc lire ce fichier (ou le .env) ne
// donne plus le mot de passe. `*_PW` reste accepté pour permettre de
// définir un secret sans pré-calculer un hash, mais il est converti en
// hash au démarrage et la valeur en clair n'est jamais conservée.
//
// Aucun condensé par défaut dans le code : le dépôt est public, et un hash
// publié se casse hors ligne. Sans variable d'environnement, l'accès
// correspondant est simplement fermé (et signalé au démarrage).
function secretHash(plainEnv, hashEnv) {
  const hash = process.env[hashEnv];
  if (hash) return hash;
  const plain = process.env[plainEnv];
  if (plain) return bcrypt.hashSync(plain, 12);
  console.warn(`[secrets] ${hashEnv} absent du .env : accès désactivé tant qu'il n'est pas défini.`);
  return null;
}

const CONFIG_PW_HASH = secretHash('CONFIG_PW', 'CONFIG_PW_HASH');
// Le suivi des absences porte des données RH (motifs médicaux, soldes) :
// il a son propre secret, distinct de l'admin, pour qu'un accès Config
// n'ouvre pas les dossiers d'absence et réciproquement.
const ABSENCE_PW_HASH = secretHash('ABSENCE_PW', 'ABSENCE_PW_HASH');

module.exports = {
  CONFIG_PW_HASH, ABSENCE_PW_HASH,
};
