// ── ASSAINISSEMENT DES ENTRÉES ────────────────────────────────
// Les routes métier faisaient `{ ...cleanBody(req.body) }` : n'importe quelle clé,
// de n'importe quel type et de n'importe quelle taille, finissait telle
// quelle dans les fichiers. Sur un réseau interne le risque n'est pas
// l'attaque mais l'accident — un client qui poste un champ à 9 Mo, un
// objet là où une chaîne est attendue, ou un `id` qui écrase celui du
// serveur. Ces trois fonctions ferment ces cas sans rien changer à
// l'usage normal.

// Longueur maximale d'un champ texte. Large : les commentaires et actions
// correctives sont parfois longs, on coupe l'aberration, pas la prose.
const FIELD_MAX = 20000;

// Clés que le serveur seul décide. Les laisser venir du client permettait
// de réécrire l'identité d'un enregistrement ou de fausser sa traçabilité.
const RESERVED_KEYS = new Set([
  'id', 'created_at', 'modified_at', '_auth', '__proto__', 'constructor', 'prototype',
]);

// Maximum depth kept by cleanValue. Flat records (tickets, tasks,
// absences) never need more, and the bound protects them from an absurd
// structure sent by mistake.
//
// The configuration, however, is a tree by nature — fo_o2o nests
// agent > reviews > actions, six levels deep. At 4, reviews saved from the
// UI came back `null`: the data already in place came from the seed
// script, which writes the file directly and therefore never passed
// through this filter, hiding the truncation.
const DEPTH_MAX = 4;
const DEPTH_MAX_CONFIG = 8;

// Normalise une valeur : les chaînes sont taillées, les scalaires passent,
// les objets/tableaux sont conservés mais bornés en profondeur.
function cleanValue(v, depth = 0, max = DEPTH_MAX) {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') return v.length > FIELD_MAX ? v.slice(0, FIELD_MAX) : v;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  // Past the bound we refuse rather than copy: an over-deep structure is
  // expensive to serialise.
  if (depth >= max) return undefined;
  if (Array.isArray(v)) return v.slice(0, 1000).map(x => cleanValue(x, depth + 1, max));
  if (typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      const c = cleanValue(val, depth + 1, max);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  return undefined;                 // fonctions, symboles… : rien à stocker
}

// Corps de requête assaini, prêt à être fusionné dans un enregistrement.
// `extraReserved` sert aux routes qui protègent des champs supplémentaires.
function cleanBody(body, extraReserved = [], max = DEPTH_MAX) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const blocked = new Set([...RESERVED_KEYS, ...extraReserved]);
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (blocked.has(k)) continue;
    const c = cleanValue(v, 0, max);
    if (c !== undefined) out[k] = c;
  }
  return out;
}

// Chaîne courte et propre pour les champs identifiants (noms, ids).
function cleanStr(v, max = 200) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

module.exports = {
  DEPTH_MAX_CONFIG, cleanBody,
};
