// ══════════════════════════════════════════════════════════════
// REGISTRE DE SESSIONS (admin, équipe, absences, agent)
//
// Les sessions vivent en mémoire, par tenant (core/scoped.js). En
// serverless (Vercel), chaque requête peut tomber sur une autre instance,
// qui ne connaît pas cette mémoire : la session serait perdue à la requête
// suivante et l'utilisateur renvoyé à l'écran de connexion.
//
// Chaque jeton est donc SIGNÉ (HMAC) et porte son contenu, son tenant et
// son expiration. En serverless, un jeton inconnu de l'instance est
// accepté s'il est authentique, du bon type, du bon tenant et non expiré.
// Hors serverless, seul le registre en mémoire fait foi, comme avant.
// Une déconnexion révoque le jeton sur l'instance qui la reçoit ; ailleurs,
// il expire de lui-même (et le cookie, lui, est effacé).
// ══════════════════════════════════════════════════════════════
const { scopedMap } = require('../core/scoped');
const { tenantOrNull } = require('../core/tenant');

function sessionStore(kind) {
  const map = scopedMap();
  const revoked = new Set();
  const serverless = () => require('../config/runtime').isServerless();
  const acc = () => require('../platform/accounts');

  const store = {
    // Crée un jeton signé portant `value`, valable `ttlMs`.
    mint(value, ttlMs) {
      const token = acc().signToken({ k: kind, t: tenantOrNull(), v: value || {} }, ttlMs);
      map.set(token, { ...(value || {}), expires: Date.now() + ttlMs });
      return token;
    },
    get(token) {
      if (!token) return undefined;
      const m = map.get(token);
      if (m) return m;
      if (!serverless() || revoked.has(token)) return undefined;
      const p = acc().verifyToken(token);
      if (!p || p.k !== kind || p.t !== tenantOrNull()) return undefined;
      return { ...(p.v || {}), expires: p.exp };
    },
    has: token => !!store.get(token),
    set(token, value) { map.set(token, value); return store; },
    delete(token) { if (token) revoked.add(token); return map.delete(token); },
    clear() { map.clear(); },
    get size() { return map.size; },
    entries: () => map.entries(),
    keys: () => map.keys(),
    values: () => map.values(),
    forEach: (fn, thisArg) => map.forEach(fn, thisArg),
    [Symbol.iterator]: () => map.entries(),
  };
  // Les révocations n'ont plus d'objet après la durée de vie maximale.
  setInterval(() => revoked.clear(), 24 * 60 * 60 * 1000).unref();
  return store;
}

module.exports = { sessionStore };
