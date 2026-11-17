// ══════════════════════════════════════════════════════════════
// CONTEXTE DE TENANT
//
// Chaque requête HTTP (et chaque tâche de fond) s'exécute « pour » une
// organisation. Le tenant courant est porté par AsyncLocalStorage : le
// code métier n'a jamais à le passer en paramètre, et le stockage
// (config/paths.js, core/store.js) le lit lui-même.
//
// Mono-tenant (MULTI_TENANT absent) : tout se passe dans le tenant
// « default », dont les données vivent directement dans DATA_DIR — c'est
// le fonctionnement historique, inchangé.
//
// Multi-tenant (MULTI_TENANT=1) : un accès aux données hors contexte est
// une erreur, jamais un repli silencieux sur un autre tenant.
// ══════════════════════════════════════════════════════════════
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();
const DEFAULT_TENANT = 'default';
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

const isMultiTenant = () => process.env.MULTI_TENANT === '1';

function currentTenant() {
  const s = als.getStore();
  if (s && s.tenant) return s.tenant;
  if (isMultiTenant()) {
    const e = new Error('Accès aux données hors contexte de tenant');
    e.code = 'NO_TENANT';
    throw e;
  }
  return DEFAULT_TENANT;
}

// Le tenant courant, ou null hors contexte (ne lève jamais).
function tenantOrNull() {
  const s = als.getStore();
  return (s && s.tenant) || (isMultiTenant() ? null : DEFAULT_TENANT);
}

function runAsTenant(tenant, fn) {
  if (!isValidSlug(tenant)) throw new Error(`Identifiant de tenant invalide : ${tenant}`);
  return als.run({ tenant }, fn);
}

const isValidSlug = s => typeof s === 'string' && (s === DEFAULT_TENANT || SLUG_RE.test(s));

module.exports = { currentTenant, tenantOrNull, runAsTenant, isMultiTenant, isValidSlug, DEFAULT_TENANT, SLUG_RE };
