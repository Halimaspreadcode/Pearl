const bcrypt      = require('bcryptjs');
const { ABSENCE_PW_HASH, CONFIG_PW_HASH } = require('../config/secrets');
const { readCfg } = require('../core/store');
const { absenceSessions, sessionValid } = require('./sessions');

// bcrypt.compareSync est déjà à temps constant et intègre le sel : plus
// besoin de timingSafeEqual ici. Le coût du hash (~100 ms en facteur 12)
// freine aussi le bruteforce, en plus du rate-limit.
// En multi-tenant, le mot de passe admin de .env ne vaut pour aucune
// organisation : l'administration passe par les comptes (rôles owner/admin).
function pwMatches(given) {
  if (require('../core/tenant').isMultiTenant()) return false;
  return !!CONFIG_PW_HASH && bcrypt.compareSync(String(given || ''), CONFIG_PW_HASH);
}
// Le hash défini depuis l'admin (config.json) prime sur celui de
// l'environnement : c'est lui qui reflète le dernier changement voulu.
function absencePwMatches(given) {
  const stored = readCfg().absence_password_hash || (require('../core/tenant').isMultiTenant() ? '' : ABSENCE_PW_HASH);
  return !!stored && bcrypt.compareSync(String(given || ''), stored);
}

// Middleware pour les routes protégées : accepte un jeton de session,
// et conserve `_auth` en repli le temps que les clients migrent.
function requireAdmin(req, res, next) {
  const hdr = req.get('X-Admin-Token');
  if (sessionValid(hdr)) return next();
  if (req.body && req.body._auth && pwMatches(req.body._auth)) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// ── VERROU ABSENCES ───────────────────────────────────────────
// Contrairement aux autres pages « protégées » du produit, dont le
// verrou n'est qu'un écran devant des données déjà chargées, celui-ci
// garde réellement la porte : les routes /api/absences exigent le
// jeton, donc les données ne quittent jamais le serveur sans lui.
function requireAbsence(req, res, next) {
  if (sessionValid(req.get('X-Absence-Token'), absenceSessions)) return next();
  // Une session admin ouvre aussi les absences, à la demande explicite de
  // l'exploitant. Ce n'était pas le cas à l'origine : les deux secrets
  // sont distincts parce que ces routes portent des données RH (motifs,
  // arrêts maladie, soldes) et que l'admin technique n'a pas
  // nécessairement à les connaître. La séparation reste donc vraie dans
  // l'autre sens — un jeton Absences n'ouvre rien de la Configuration.
  if (sessionValid(req.get('X-Admin-Token'))) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// ── LISTE BLANCHE ABSENCES ────────────────────────────────────
// La page Absences n'est ouverte qu'aux identifiants déclarés dans la
// Configuration (`absence_allowed_ids`). Le mot de passe reste exigé :
// l'ID vient du navigateur, donc il est déclarable par le client et ne
// peut pas servir de verrou à lui seul. Les deux conditions se cumulent.
// Liste vide = personne, plutôt que tout le monde : un oubli de config
// doit fermer l'accès, pas l'ouvrir.
function absenceAllowedIds() {
  const raw = readCfg().absence_allowed_ids;
  if (!Array.isArray(raw)) return [];
  return raw.map(v => String(v || '').trim().toLowerCase()).filter(Boolean);
}

function absenceIdAllowed(id) {
  const wanted = String(id || '').trim().toLowerCase();
  if (!wanted) return false;
  return absenceAllowedIds().includes(wanted);
}

module.exports = {
  pwMatches, absencePwMatches, requireAdmin, requireAbsence,
  absenceIdAllowed,
};
