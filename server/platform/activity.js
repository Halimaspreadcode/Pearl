// ══════════════════════════════════════════════════════════════
// JOURNAL D'ACTIVITÉ
//
// Ce qui touche à l'organisation elle-même : connexions, membres,
// invitations, rôles, sièges, offre, marque, modules. Un journal par
// organisation (`activity:<slug>`) et un pour la plateforme
// (`activity:_platform`, actions de la console). 1 000 entrées gardées.
// ══════════════════════════════════════════════════════════════
const { registry } = require('../core/backend');

const MAX = 1000;
const key = slug => `activity:${slug || '_platform'}`;

// Les écritures d'un même journal se suivent : pas de perte en cas de rafale.
const chains = new Map();
function log(slug, actor, action, details = {}) {
  const k = key(slug);
  const prev = chains.get(k) || Promise.resolve();
  const next = prev.then(async () => {
    const list = (await registry().getSetting(k)) || [];
    list.unshift({ at: new Date().toISOString(), actor: actor || 'system', action, details });
    await registry().setSetting(k, list.slice(0, MAX));
  }).catch(e => console.warn('[activity]', e.message));
  chains.set(k, next);
  return next;
}

async function read(slug, { limit = 200, action } = {}) {
  await (chains.get(key(slug)) || Promise.resolve());
  let list = (await registry().getSetting(key(slug))) || [];
  if (action) list = list.filter(e => e.action === action || e.action.startsWith(`${action}.`));
  return list.slice(0, Math.min(MAX, limit));
}

const forget = slug => registry().deleteSetting(key(slug)).catch(() => {});

module.exports = { log, read, forget };
