// ══════════════════════════════════════════════════════════════
// PONT COMPTES → SESSIONS DE L'APPLICATION
//
// L'application connaît trois accès : la session d'équipe (nominative ou
// lecture seule), la session admin et le code agent. Plutôt que de les
// réécrire, un membre connecté avec son compte reçoit les sessions qui
// correspondent à son rôle dans l'organisation :
//   owner, admin, manager → session admin + session d'équipe nominative ;
//   agent                 → session d'équipe nominative ;
//   observer              → session d'équipe en lecture seule.
// Les sessions sont rouvertes d'elles-mêmes si elles ont expiré ou si le
// serveur a redémarré, tant que le cookie de compte est valide.
// ══════════════════════════════════════════════════════════════
const accounts = require('./accounts');
const { registry } = require('../core/backend');

const MEMBER_CACHE_MS = 60 * 1000;
const _members = new Map();   // `${uid}|${slug}` → { at, m }

async function membership(uid, slug) {
  const k = `${uid}|${slug}`;
  const hit = _members.get(k);
  if (hit && Date.now() - hit.at < MEMBER_CACHE_MS) return hit.m;
  const m = ((await registry().membershipsOf(uid)) || []).find(x => x.tenant === slug) || null;
  _members.set(k, { at: Date.now(), m });
  return m;
}
const forgetMember = (uid, slug) => _members.delete(`${uid}|${slug}`);

const ADMIN_LIKE = ['owner', 'admin', 'manager'];

// Ajoute un cookie à la requête en cours, pour que les middlewares
// suivants le voient sans attendre la requête suivante.
function injectCookie(req, name, value) {
  const c = req.headers.cookie ? `${req.headers.cookie}; ` : '';
  req.headers.cookie = `${c}${name}=${encodeURIComponent(value)}`;
}

function nomDe(m, acct) {
  return (m && m.person_name) || String(acct.email || '').split('@')[0];
}

// Ouvre les sessions du rôle si elles manquent.
function ouvrirSessions(req, res, acct, m) {
  const team = require('../auth/team-gate');
  const S = require('../auth/sessions');
  const { roleDe } = require('../auth/identity');
  const name = nomDe(m, acct);
  if (!team.sessionEquipe(req)) {
    const qui = m.role === 'observer' ? { lecture: true }
      : { name, employeeId: acct.email, role: ADMIN_LIKE.includes(m.role) ? (roleDe(name) === 'Observer' ? 'Manager' : roleDe(name)) : roleDe(name), account: true };
    injectCookie(req, team.TEAM_COOKIE, team.ouvrirSession(res, req, qui));
  }
  if (ADMIN_LIKE.includes(m.role) && !S.sessionValid(S.readCookie(req, S.ADMIN_COOKIE))) {
    const s = S.issueSession();
    res.cookie(S.ADMIN_COOKIE, s.token, { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: S.SESSION_TTL_MS, path: '/' });
    injectCookie(req, S.ADMIN_COOKIE, s.token);
  }
}

// Middleware, monté après la résolution du tenant.
async function accountBridge(req, res, next) {
  if (!req.tenant || req.platform) return next();
  const acct = accounts.accountOf(req);
  if (!acct || acct.tenant !== req.tenant.slug) return next();
  try {
    const m = await membership(acct.id, req.tenant.slug);
    if (!m) return next();
    req.account = { id: acct.id, email: acct.email, role: m.role, person_name: m.person_name || null };
    ouvrirSessions(req, res, acct, m);
  } catch (e) {
    console.error('[accounts] pont de session :', e.message);
  }
  next();
}

module.exports = { accountBridge, membership, forgetMember, ADMIN_LIKE };
