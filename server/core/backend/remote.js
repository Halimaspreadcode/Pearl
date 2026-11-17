// ══════════════════════════════════════════════════════════════
// PILOTE DISTANT À CACHE (Supabase REST ou PostgreSQL direct)
//
// Le code métier lit ses données de façon SYNCHRONE (readJSON) : 48 appels
// dans une vingtaine de modules. Plutôt que de tout réécrire en async,
// chaque tenant est chargé en mémoire au début de sa première requête
// (ensureTenant, appelé par le middleware de tenant). Ensuite :
//   · lecture : depuis le cache, texte JSON re-parsé (l'appelant peut
//     muter l'objet sans toucher au cache, comme avec des fichiers) ;
//   · écriture : cache mis à jour tout de suite, persistance en arrière-
//     plan, dans l'ordre, par tenant. flush() attend la fin des écritures.
//
// Un seul processus serveur par base (hypothèse de la phase actuelle).
// Pour plusieurs instances, il faudra invalider le cache (LISTEN/NOTIFY).
// ══════════════════════════════════════════════════════════════
const path = require('path');

function makeRemoteBackend({ kind, adapter, dataDir, defaultTenant }) {
  const cache   = new Map();   // tenant → Map(name → { text, v })
  const loading = new Map();   // tenant → Promise
  const queues  = new Map();   // tenant → Promise (écritures ordonnées)
  let counter = 0;
  let lastError = null;

  // Chemin absolu → { tenant, name }. Même découpage que config/paths.js.
  function locate(file) {
    const rel = path.relative(dataDir, file).split(path.sep).join('/');
    if (rel.startsWith('..')) throw new Error(`Chemin hors des données : ${file}`);
    const m = /^tenants\/([^/]+)\/(.+)$/.exec(rel);
    return m ? { tenant: m[1], name: m[2] } : { tenant: defaultTenant, name: rel };
  }
  function docs(tenant) {
    const d = cache.get(tenant);
    if (!d) {
      const e = new Error(`Données du tenant « ${tenant} » non chargées (ensureTenant manquant)`);
      e.code = 'TENANT_NOT_LOADED';
      throw e;
    }
    return d;
  }
  function enqueue(tenant, fn) {
    const prev = queues.get(tenant) || Promise.resolve();
    const next = prev.then(fn).catch(err => {
      lastError = err;
      console.error(`[store:${kind}] écriture ${tenant} échouée :`, err.message);
    });
    queues.set(tenant, next);
    return next;
  }

  return {
    kind,
    adapter,
    lastError: () => lastError,
    isLoaded: tenant => cache.has(tenant),
    async ensureTenant(tenant) {
      if (cache.has(tenant)) return;
      if (!loading.has(tenant)) {
        loading.set(tenant, (async () => {
          const rows = await adapter.loadDocs(tenant);
          const m = new Map();
          for (const r of rows) m.set(r.name, { text: r.text, v: ++counter });
          cache.set(tenant, m);
        })().finally(() => loading.delete(tenant)));
      }
      await loading.get(tenant);
    },
    // Oublie un tenant (rechargé à la prochaine requête).
    evict(tenant) { cache.delete(tenant); },
    readText(file) {
      const { tenant, name } = locate(file);
      const e = docs(tenant).get(name);
      return e ? e.text : null;
    },
    writeText(file, text) {
      const { tenant, name } = locate(file);
      docs(tenant).set(name, { text, v: ++counter });
      enqueue(tenant, () => adapter.upsertDoc(tenant, name, text));
    },
    exists(file) { const { tenant, name } = locate(file); return docs(tenant).has(name); },
    remove(file) {
      const { tenant, name } = locate(file);
      if (docs(tenant).delete(name)) enqueue(tenant, () => adapter.deleteDoc(tenant, name));
    },
    version(file) { const { tenant, name } = locate(file); const e = docs(tenant).get(name); return e ? `v${e.v}` : null; },
    listDocs(dir) {
      const { tenant } = locate(path.join(dir, '_'));
      return [...docs(tenant).keys()].filter(n => n.endsWith('.json') && !n.includes('/'));
    },
    async getBlob(file) { const { tenant, name } = locate(file); return adapter.getBlob(tenant, name); },
    async putBlob(file, buf) { const { tenant, name } = locate(file); await adapter.putBlob(tenant, name, buf); },
    async removeBlobs(dir, prefix) {
      const { tenant, name } = locate(path.join(dir, prefix || '_'));
      await adapter.removeBlobs(tenant, prefix ? name : name.slice(0, -1));
    },
    async flush() { await Promise.all([...queues.values()]); },
  };
}

module.exports = { makeRemoteBackend };
