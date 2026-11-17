const fs          = require('fs');
const crypto      = require('crypto');
const bcrypt      = require('bcryptjs');
const { FILES } = require('../config/paths');
const { readJSON, writeJSON, removeDoc } = require('../core/store');
const { isMultiTenant } = require('../core/tenant');
const {
  ADMIN_COOKIE, readCookie, sessionValid, absenceSessions, foSessionOwner,
} = require('./sessions');

// ── ACCÈS ÉQUIPE ──────────────────────────────────────────────
// Jusqu'ici, toute route de lecture (tickets, tableau de bord, rapports,
// observations, planning…) répondait à n'importe quel poste du réseau :
// le « profil » choisi dans l'appli est déclaratif, il ne prouve rien.
// Le verrou d'équipe ferme cette porte : une fois un mot de passe d'équipe
// défini dans la Configuration, toute l'API exige une session.
//
// Ouvrent l'accès : le mot de passe d'équipe, le mot de passe admin, ou le
// code personnel d'un agent (identifiant + code). Les sessions admin,
// absences et FO déjà ouvertes valent aussi.
//
// Le condensé vit dans data/team-access.secret : comme la clé Pearl AI,
// hors de git (data/*.secret est ignoré) même si data/ est versionné.
//
// Tant qu'aucun mot de passe d'équipe n'est défini, le verrou laisse passer :
// l'activer d'office après une mise à jour aurait enfermé toute l'équipe
// dehors sans moyen d'entrer. L'écran de Configuration le signale.

const TEAM_COOKIE = 'fo_team';
const TEAM_TTL_MS = 12 * 60 * 60 * 1000;   // une journée de travail, garde comprise
const teamSessions = require('../core/scoped').scopedMap();            // token -> { expires, qui }

function lireSecret() {
  return readJSON(FILES.team_secret, {}) || {};
}

// TEAM_PW_HASH (.env) ne vaut qu'en mono-tenant : en multi-tenant, chaque
// organisation a son propre mot de passe d'équipe.
function teamHash() {
  return (!isMultiTenant() && process.env.TEAM_PW_HASH) || lireSecret().hash || '';
}

// En multi-tenant, l'accès exige toujours une connexion (compte, code
// personnel ou mot de passe d'équipe) : les données d'une organisation ne
// sont jamais lisibles par un inconnu.
function teamGateActif() { return isMultiTenant() || !!teamHash(); }

function teamPwMatches(given) {
  const h = teamHash();
  return !!h && bcrypt.compareSync(String(given || ''), h);
}

function definirMotDePasse(pw) {
  const data = { hash: bcrypt.hashSync(String(pw), 12), updated_at: new Date().toISOString() };
  writeJSON(FILES.team_secret, data, { mode: 0o600 });
  // Changer le mot de passe ferme les sessions d'équipe ouvertes avec
  // l'ancien : sinon le changement ne mettrait personne dehors.
  teamSessions.clear();
  return data.updated_at;
}

function desactiver() {
  removeDoc(FILES.team_secret);
  teamSessions.clear();
}

function etat() {
  const s = lireSecret();
  return {
    actif: teamGateActif(),
    via_env: !!process.env.TEAM_PW_HASH,
    updated_at: s.updated_at || '',
    sessions: [...teamSessions.values()].filter(v => v.expires > Date.now()).length,
    nominatives: [...teamSessions.values()].filter(v => v.expires > Date.now() && v.qui?.name).length,
  };
}

function ouvrirSession(res, req, qui) {
  const token = crypto.randomBytes(32).toString('hex');
  teamSessions.set(token, { expires: Date.now() + TEAM_TTL_MS, qui });
  res.cookie(TEAM_COOKIE, token, {
    httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: TEAM_TTL_MS, path: '/',
  });
  return token;
}

function fermerSession(req, res) {
  teamSessions.delete(readCookie(req, TEAM_COOKIE));
  res.clearCookie(TEAM_COOKIE, { path: '/' });
}

// Session d'équipe de la requête : { expires, qui } ou null. `qui` porte
// l'identité vérifiée ({ name, employeeId, role }) quand la session a été
// ouverte avec un code personnel, { lecture: true } avec le mot de passe
// d'équipe (voir auth/identity.js).
function sessionEquipe(req) {
  const t = readCookie(req, TEAM_COOKIE);
  if (!t) return null;
  const s = teamSessions.get(t);
  if (!s) return null;
  if (s.expires < Date.now()) { teamSessions.delete(t); return null; }
  return s;
}

function teamSessionValide(req) { return !!sessionEquipe(req); }

// La requête porte-t-elle une session, quelle qu'elle soit ?
function requeteAuthentifiee(req) {
  if (teamSessionValide(req)) return true;
  if (sessionValid(req.get('X-Admin-Token')) || sessionValid(readCookie(req, ADMIN_COOKIE))) return true;
  if (sessionValid(req.get('X-Absence-Token'), absenceSessions)) return true;
  if (foSessionOwner(req.get('X-FO-Token'))) return true;
  return false;
}

// Routes ouvertes sans session : celles qui permettent d'en obtenir une,
// et les sondes de vie (watchdog, rechargement automatique des onglets).
const OUVERTES = new Set([
  '/status', '/version',
  '/team/auth', '/team/session', '/team/logout', '/team/me',
  '/config/auth', '/config/session', '/config/logout',
  '/fo-access/login', '/fo-access/logout',
  '/absences/auth', '/absences/session', '/absences/logout',
  '/team/account-login', '/team/account-logout', '/platform/brand',
]);

// Monté sur /api : req.path est donc relatif (« /sn », « /dashboard »…).
function teamGate(req, res, next) {
  if (req.method === 'OPTIONS') return next();
  if (!teamGateActif()) return next();
  if (OUVERTES.has(req.path)) return next();
  if (requeteAuthentifiee(req)) return next();
  // Boîte à idées ouverte par lien de partage (routes/ideas.js).
  if (require('../routes/ideas').accesParLien(req)) return next();
  // En-tête dédié : le client distingue « connexion d'équipe requise » des
  // autres 401 (session admin expirée, code agent faux…).
  res.set('X-Team-Auth', 'required');
  return res.status(401).json({ error: 'Team sign-in required.', team_auth: true });
}

// Pages statiques qui montrent des données (captures de démonstration,
// analyseur de journaux) : même verrou, renvoi vers l'accueil sinon.
const PAGES_PROTEGEES = /^\/(demo(\/|\.html$))/;
function teamGateStatique(req, res, next) {
  if (!PAGES_PROTEGEES.test(req.path)) return next();
  if (!teamGateActif() || requeteAuthentifiee(req)) return next();
  return res.redirect(302, '/');
}

setInterval(() => {
  const now = Date.now();
  for (const [t, s] of teamSessions) if (s.expires < now) teamSessions.delete(t);
}, 30 * 60 * 1000).unref();

module.exports = {
  TEAM_COOKIE, teamSessions, teamGate, teamGateStatique, teamGateActif, teamPwMatches,
  definirMotDePasse, desactiver, etat, ouvrirSession, fermerSession, teamSessionValide,
  requeteAuthentifiee, sessionEquipe, OUVERTES,
};
