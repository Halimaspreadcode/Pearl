const { readCfg, readWeeklyProgress, readBO } = require('../core/store');
const { ADMIN_COOKIE, readCookie, sessionValid, foSessionOwner } = require('./sessions');

// ── IDENTITÉ VÉRIFIÉE ─────────────────────────────────────────
// Jusqu'ici, « qui je suis » était déclaré par le navigateur : un nom choisi
// dans une liste, gardé en mémoire locale, puis recopié dans chaque écriture
// (modified_by, user, requested_by…). N'importe qui pouvait agir au nom d'un
// collègue. Désormais, dès que le verrou d'équipe est actif :
//
//   · l'identité vient de la session, ouverte avec l'ID employé et le code
//     personnel (auth/team-gate.js) — jamais du corps de la requête ;
//   · la session ouverte avec le mot de passe d'équipe est en lecture seule ;
//   · les champs qui désignent l'auteur d'une écriture sont réécrits par le
//     serveur avec l'identité vérifiée ;
//   · un agent ne modifie que ses propres tâches et ses propres préférences.
//
// La session admin garde la main : elle agit au nom de l'équipe (assigner
// une tâche à un agent, corriger un ticket) et ses champs restent ceux
// qu'elle envoie.

// Rôle d'une personne d'après les listes de la Configuration.
// Rôles créés par l'admin (services/parties.js) compris : SMC, DRPS…
function roleDe(nom) {
  return require('../services/parties').roleDe(nom, readCfg());
}

function estAdmin(req) {
  return sessionValid(req.get('X-Admin-Token')) || sessionValid(readCookie(req, ADMIN_COOKIE));
}

// { name, employeeId, role, admin, lecture } ou null.
function identiteDe(req) {
  const team = require('./team-gate');
  const s = team.sessionEquipe(req);
  const nominative = s && s.qui && typeof s.qui === 'object' && s.qui.name ? s.qui : null;
  if (estAdmin(req)) return { ...(nominative || { name: 'Admin', employeeId: '', role: 'Admin' }), admin: true };
  if (nominative) return { ...nominative, admin: false };
  const fo = foSessionOwner(req.get('X-FO-Token'));
  if (fo) {
    const code = (readCfg().fo_access_codes || {})[fo] || {};
    return { name: fo, employeeId: code.employee_id || '', role: roleDe(fo), admin: false };
  }
  if (s) return { lecture: true, admin: false };
  return null;
}

// Agent de « Ma performance » / « Mes objectifs » : le jeton FO (code saisi
// dans la page) ou, à défaut, la session nominative ouverte avec le même
// code. Un seul code, une seule connexion.
function agentDe(req) {
  const fo = foSessionOwner(req.get('X-FO-Token'));
  if (fo) return fo;
  const s = require('./team-gate').sessionEquipe(req);
  return s && s.qui && s.qui.name ? s.qui.name : null;
}

const ECRITURE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Écritures sans auteur ni effet métier : permises en lecture seule.
const SANS_AUTEUR = new Set(['/presence/ping', '/presence/leave']);
// Champs qui désignent l'auteur d'une écriture, quel que soit l'écran.
const CHAMPS_AUTEUR = ['user', 'created_by', 'requested_by', 'author'];

function refuser(res, code, error) {
  const requise = /code personnel/.test(error);
  // En-tête lu par le client (public/js/core/team-gate.js) : il propose
  // alors la connexion par code personnel au lieu d'un simple message.
  if (requise) res.set('X-Identity', 'required');
  return res.status(code).json({ error, identite_requise: requise });
}

// ── PAGES RÉSERVÉES : CONTRÔLE SERVEUR ────────────────────────
// Les onglets de My Space réservés à quelques ID (Admin › Vues par profil ›
// Pages réservées) ne sont pas qu'un affichage : maintenant que l'identité
// est prouvée, leurs routes refusent aussi les autres.
const ROUTES_RESERVABLES = [
  { page: 'my-perf',         re: /^\/(my-perf|my-objectives|my-insight)(\/|$)/ },
  { page: 'quiz',            re: /^\/quiz\/(results|progress)(\/|$)/, ecriture: true },
  { page: 'my-requests',     re: /^\/shift-requests$/, ecriture: true },
  { page: 'weekly-progress', re: /^\/weekly-progress(\/|$)/, ecriture: true },
];

function reserveeA(page) {
  const ids = (readCfg().nav_reserved || {})[page];
  return Array.isArray(ids) && ids.length ? ids.map(x => String(x).trim().toLowerCase()) : null;
}

// Tous les identifiants connus d'une personne : celui de son code
// personnel et celui de sa fiche agent (Configuration › Général). Ils
// peuvent différer (code délivré avec un autre ID) : la réservation doit
// reconnaître la personne par l'un ou l'autre, et aussi par son nom.
function idsDe(qui) {
  const cfg = readCfg();
  const out = new Set();
  const add = v => { const x = String(v || '').trim().toLowerCase(); if (x) out.add(x); };
  add(qui.employeeId);
  add((cfg.fo_ids || {})[qui.name]);
  add(((cfg.fo_access_codes || {})[qui.name] || {}).employee_id);
  add(qui.name);
  return out;
}

const LIBELLES = { 'my-perf': 'Performance', quiz: 'Quiz', 'my-requests': 'Requests', 'weekly-progress': 'Tasks' };

function horsReservation(req) {
  if (!req.qui || req.qui.admin || req.qui.lecture) return null;
  for (const r of ROUTES_RESERVABLES) {
    if (!r.re.test(req.path)) continue;
    if (r.ecriture && !ECRITURE.has(req.method)) continue;
    const ids = reserveeA(r.page);
    if (!ids) continue;
    const miens = idsDe(req.qui);
    if (!ids.some(id => miens.has(id))) return r.page;
  }
  return null;
}

// Monté sur /api après le verrou d'équipe : req.path est relatif.
function identite(req, res, next) {
  const team = require('./team-gate');
  req.qui = identiteDe(req);
  if (team.OUVERTES.has(req.path)) return next();
  // Le code personnel est exigé pour écrire quand le verrou d'équipe est
  // actif, ou quand l'admin l'a demandé (Accès équipe › « Exiger le code
  // personnel »). Sans exigence, une session nominative est quand même
  // signée et contrôlée : seule l'écriture anonyme reste tolérée.
  const exige = team.teamGateActif() || !!readCfg().identity_required;
  const nominatif = req.qui && !req.qui.lecture && !req.qui.admin;
  if (!exige && !nominatif) return next();

  // Préférences d'affichage : chacun les siennes.
  const pref = /^\/user-prefs\/([^/]+)$/.exec(req.path);
  if (pref && req.qui && !req.qui.admin && !req.qui.lecture
      && decodeURIComponent(pref[1]).toLowerCase() !== String(req.qui.employeeId || '').toLowerCase())
    return refuser(res, 403, 'Préférences d\'une autre personne.');

  const reservee = horsReservation(req);
  if (reservee) return refuser(res, 403,
    `L'onglet ${LIBELLES[reservee] || reservee} est réservé à certaines personnes (Admin › Vues par profil › Pages réservées)`
    + ` et ${req.qui.name || 'cet identifiant'} n'y figure pas.`);

  if (!ECRITURE.has(req.method)) return next();
  // Boîte à idées : ouverte à tous ceux qui voient le tableau (consultation
  // seule et lien de partage compris). La signature est gérée par la route.
  if (/^\/ideas(\/|$)/.test(req.path)) return next();
  if (SANS_AUTEUR.has(req.path)) {
    if (req.qui && !req.qui.lecture && !req.qui.admin && req.body && typeof req.body === 'object') {
      req.body.name = req.qui.name; req.body.employeeId = req.qui.employeeId;
    }
    return next();
  }
  if (!req.qui || req.qui.lecture)
    return refuser(res, 403, 'Connecte-toi avec ton identifiant employé et ton code personnel pour modifier.');
  if (req.qui.admin) return next();

  const moi = req.qui.name;
  const b = req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : null;
  if (b) {
    for (const k of CHAMPS_AUTEUR) if (k in b) b[k] = moi;
    if ('_operator_id' in b) b._operator_id = req.qui.employeeId;
    if (/^\/shift-requests$/.test(req.path) && req.method === 'POST') b.requested_by = moi;
  }

  // Tickets : modified_by est l'auteur de la modification.
  if (b && /^\/tickets\/[^/]+(\/[^/]+)?$/.test(req.path)) b.modified_by = moi;

  // Tâches : un agent crée les siennes et ne touche qu'aux siennes.
  if (req.path === '/weekly-progress' && req.method === 'POST' && b) {
    b.modified_by = moi;
    delete b.admin_task; delete b.assigned_by;
  }
  const wp = /^\/weekly-progress\/([^/]+)$/.exec(req.path);
  if (wp) {
    const item = readWeeklyProgress().find(p => p.id === wp[1]);
    if (item && item.modified_by !== moi) return refuser(res, 403, 'Cette tâche appartient à quelqu\'un d\'autre.');
    if (item && b) b.modified_by = item.modified_by;
  }
  return next();
}

module.exports = { estAdmin, identite, identiteDe, agentDe, roleDe, CHAMPS_AUTEUR, ROUTES_RESERVABLES };
