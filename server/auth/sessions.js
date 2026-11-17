const crypto      = require('crypto');

// ── SESSIONS ADMIN ────────────────────────────────────────────
// Auparavant : le mot de passe était renvoyé au client, stocké tel quel
// et réémis dans le corps de chaque requête protégée (`_auth`). Il
// transitait donc en clair à chaque écriture et restait indéfiniment
// valide. On délivre maintenant un jeton de session à durée limitée ;
// le mot de passe ne quitte le client qu'une seule fois.
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 h — une journée de travail
const sessions = new Map(); // token -> { expires }

// Nom du cookie de session admin. Une seule valeur à lire : on l'extrait
// à la main plutôt que d'ajouter cookie-parser aux dépendances.
const ADMIN_COOKIE = 'fo_admin';

function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name)
      return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}
// Les absences ont leur propre registre : un jeton admin ne doit pas
// ouvrir les dossiers RH, ni l'inverse. Deux secrets, deux Map.
const absenceSessions = new Map();

function issueSession(store = sessions) {
  const token = crypto.randomBytes(32).toString('hex');
  store.set(token, { expires: Date.now() + SESSION_TTL_MS });
  return { token, expires_in: SESSION_TTL_MS };
}

function sessionValid(token, store = sessions) {
  if (!token) return false;
  const s = store.get(token);
  if (!s) return false;
  if (s.expires < Date.now()) { store.delete(token); return false; }
  return true;
}

// ── SESSIONS FO (consultation de sa propre performance) ───────
// Registre distinct des deux autres, et surtout porteur d'une identité :
// un jeton FO ne vaut que pour l'agent auquel il a été délivré. C'est ce
// qui permet de ne jamais servir la note d'un collègue, même à quelqu'un
// muni d'un jeton valide.
//
// Durée courte : ces notes sont consultées ponctuellement, pas gardées
// ouvertes toute la journée sur un poste partagé.
const FO_SESSION_TTL_MS = 30 * 60 * 1000; // 30 min
const foSessions = new Map(); // token -> { fo, expires }

function issueFoSession(fo) {
  const token = crypto.randomBytes(32).toString('hex');
  foSessions.set(token, { fo, expires: Date.now() + FO_SESSION_TTL_MS });
  return { token, expires_in: FO_SESSION_TTL_MS };
}

// Renvoie le nom du FO associé au jeton, ou null. C'est le serveur qui
// décide de qui il s'agit : le client n'a jamais son mot à dire.
function foSessionOwner(token) {
  if (!token) return null;
  const s = foSessions.get(token);
  if (!s) return null;
  if (s.expires < Date.now()) { foSessions.delete(token); return null; }
  return s.fo;
}

// Purge périodique pour éviter que les Map ne grossissent indéfiniment.
setInterval(() => {
  const now = Date.now();
  for (const store of [sessions, absenceSessions, foSessions])
    for (const [t, s] of store) if (s.expires < now) store.delete(t);
}, 30 * 60 * 1000).unref();

module.exports = {
  SESSION_TTL_MS, sessions, ADMIN_COOKIE, readCookie, absenceSessions,
  issueSession, sessionValid, foSessions, issueFoSession, foSessionOwner,
};
