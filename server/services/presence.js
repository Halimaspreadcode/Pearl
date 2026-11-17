const { readBO, readCfg } = require('../core/store');

// ── PRESENCE (who is online right now) ────────────────────────
// Volatile on purpose: presence is a live signal, not a record. It lives in
// memory only, so a restart simply empties it and clients repopulate it on
// their next ping. Keyed by huaweiId when available (a user may open several
// tabs), falling back to the name.
const PRESENCE_TTL_MS   = 90 * 1000;  // a client is "online" if seen within 90s
const PRESENCE_SWEEP_MS = 60 * 1000;
const presence = new Map();

// Sessions coupées par un administrateur. Sans cette mémoire, retirer une
// entrée de `presence` serait sans effet : le client repingue 30 s plus tard
// et réapparaît. La révocation expire, pour ne pas bannir définitivement.
const REVOKE_TTL_MS = 10 * 60 * 1000;
const revokedPresence = new Map();

function livePresence() {
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  return [...presence.values()]
    .filter(u => u.lastSeen >= cutoff)
    .sort((a, b) => b.lastSeen - a.lastSeen);
}

// Drop stale entries so the map cannot grow unbounded across a long uptime.
setInterval(() => {
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  for (const [key, u] of presence) if (u.lastSeen < cutoff) presence.delete(key);

  const revokeCutoff = Date.now() - REVOKE_TTL_MS;
  for (const [k, at] of revokedPresence) if (at < revokeCutoff) revokedPresence.delete(k);
}, PRESENCE_SWEEP_MS).unref();

// Les listes FO / BO font foi pour l'identité. Le contrôle existe aussi
// côté client, mais il vit dans localStorage : sans reprise ici, il suffit
// d'éditer le stockage pour apparaître sous un nom inventé.
function knownIdentityNames() {
  const cfg = readCfg();
  return new Set([
    ...(cfg.fo_list || []),
    ...readBO().map(b => b && b.name),
  ].filter(Boolean).map(n => String(n).toLowerCase()));
}

/* Hors listes, le rôle Observateur reste ouvert : des gens consultent le
   tracker sans y être affectés. Mais le nom doit ressembler à un nom —
   c'est ce qui sépare un observateur légitime d'un « sddd ».

   Doit rester aligné sur _isPlausibleName() côté client : si le serveur
   est plus strict, l'utilisateur voit un formulaire qui accepte puis une
   présence qui échoue sans explication. */
const NAME_STOPWORDS = new Set([
  'test', 'tests', 'testing', 'essai', 'demo', 'admin', 'user', 'utilisateur',
  'anonyme', 'anonymous', 'inconnu', 'unknown', 'moi', 'toto', 'azerty', 'qwerty',
  'aaa', 'abc', 'xxx', 'asdf', 'qwe',
]);

function looksLikeWord(w) {
  const s = w.toLowerCase();
  if (NAME_STOPWORDS.has(s)) return false;
  if (/^(.)\1+$/.test(s)) return false;
  if (s.length < 2) return false;
  if (!/[aeiouyàâäéèêëîïôöùûüÿ]/.test(s)) return false;
  if (/[bcdfghjklmnpqrstvwxz]{4,}/.test(s)) return false;
  return true;
}

function isPlausibleName(name) {
  const n = String(name || '').trim();
  if (n.length < 4) return false;
  if (!/^[\p{L}][\p{L}\s'’.-]*$/u.test(n)) return false;
  const parts = n.split(/[\s.]+/).filter(Boolean);
  // Une initiale (« M. Fall ») compte comme un mot pour la règle des deux
  // éléments, mais n'est pas soumise au test de prononçabilité.
  if (parts.length < 2) return false;
  const words = parts.filter(w => w.length > 1);
  // Au moins un vrai mot : « s. d » n'est qu'une suite d'initiales, il
  // passerait sinon sans qu'aucun test de prononçabilité ne s'applique.
  if (!words.length) return false;
  return words.every(looksLikeWord);
}

module.exports = {
  presence, revokedPresence, livePresence, knownIdentityNames,
  isPlausibleName,
};
