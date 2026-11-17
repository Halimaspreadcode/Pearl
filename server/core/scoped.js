// ══════════════════════════════════════════════════════════════
// ÉTAT EN MÉMOIRE ISOLÉ PAR TENANT
//
// Sessions, présence, tâches de fond… vivent en mémoire, dans des Map de
// module. En multi-tenant, une Map partagée laisserait un jeton ouvert sur
// une organisation fonctionner sur une autre. scopedMap() a l'interface
// d'une Map mais range chaque entrée dans la Map du tenant courant : le
// code existant ne change pas, l'isolation est garantie ici.
//
// Hors contexte de tenant (minuteurs de purge), les parcours voient
// toutes les entrées et `delete` agit partout ; get/set/has lèvent, pour
// qu'un oubli de contexte ne passe jamais inaperçu.
// ══════════════════════════════════════════════════════════════
const { tenantOrNull } = require('./tenant');

function scopedMap() {
  const byTenant = new Map();
  const inner = (create) => {
    const t = tenantOrNull();
    if (!t) return null;
    let m = byTenant.get(t);
    if (!m && create) { m = new Map(); byTenant.set(t, m); }
    return m || null;
  };
  const strict = (create) => {
    const t = tenantOrNull();
    if (!t) throw Object.assign(new Error('État de tenant lu hors contexte'), { code: 'NO_TENANT' });
    return inner(create);
  };
  function* all() { for (const m of byTenant.values()) yield* m.entries(); }
  const current = () => (tenantOrNull() ? (inner(false) || new Map()).entries() : all());

  return {
    get: k => { const m = strict(false); return m ? m.get(k) : undefined; },
    set(k, v) { strict(true).set(k, v); return this; },
    has: k => { const m = strict(false); return !!m && m.has(k); },
    delete(k) {
      if (tenantOrNull()) { const m = inner(false); return !!m && m.delete(k); }
      let any = false;
      for (const m of byTenant.values()) any = m.delete(k) || any;
      return any;
    },
    clear() {
      if (tenantOrNull()) { const m = inner(false); if (m) m.clear(); } else byTenant.clear();
    },
    get size() { let n = 0; for (const _ of current()) n++; return n; },
    entries: () => current(),
    keys: function* () { for (const [k] of current()) yield k; },
    values: function* () { for (const [, v] of current()) yield v; },
    forEach(fn, thisArg) { for (const [k, v] of current()) fn.call(thisArg, v, k, this); },
    [Symbol.iterator]() { return current(); },
  };
}

// Un objet d'état par tenant (ex. la passe en cours d'une tâche de fond).
// `factory()` crée l'état initial ; les propriétés se lisent et s'écrivent
// comme sur un objet ordinaire.
function scopedObject(factory) {
  const byTenant = new Map();
  const target = () => {
    const t = tenantOrNull() || '__none__';
    if (!byTenant.has(t)) byTenant.set(t, factory());
    return byTenant.get(t);
  };
  return new Proxy({}, {
    get: (_, k) => target()[k],
    set: (_, k, v) => { target()[k] = v; return true; },
    has: (_, k) => k in target(),
    ownKeys: () => Reflect.ownKeys(target()),
    getOwnPropertyDescriptor: (_, k) => {
      const d = Reflect.getOwnPropertyDescriptor(target(), k);
      if (d) d.configurable = true;
      return d;
    },
    deleteProperty: (_, k) => delete target()[k],
  });
}

module.exports = { scopedMap, scopedObject };
