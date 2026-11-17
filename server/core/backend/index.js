// ══════════════════════════════════════════════════════════════
// CHOIX DU STOCKAGE
//
//   STORE=fs        (défaut) fichiers JSON dans DATA_DIR
//   STORE=supabase  API REST Supabase en HTTPS (SUPABASE_URL + clé service_role)
//   STORE=pg        PostgreSQL direct avec RLS (DATABASE_URL)
//
// `backend` sert les documents des tenants (lecture synchrone, voir
// remote.js) ; `registry` sert le registre de la plateforme (tenants,
// membres, admins), toujours en async.
// ══════════════════════════════════════════════════════════════
const { DATA_DIR } = require('../../config/paths');
const { DEFAULT_TENANT } = require('../tenant');

let _backend = null, _registry = null;

function init() {
  if (_backend) return;
  const kind = (process.env.STORE || 'fs').toLowerCase();
  if (kind === 'fs') {
    _backend = require('./fs');
    _registry = require('./fs-registry').makeFsRegistry({ dataDir: DATA_DIR });
    return;
  }
  let adapter;
  if (kind === 'supabase') adapter = require('./supabase-rest').makeSupabaseAdapter();
  else if (kind === 'pg') adapter = require('./pg').makePgAdapter();
  else throw new Error(`STORE inconnu : ${kind} (fs, supabase ou pg)`);
  _backend = require('./remote').makeRemoteBackend({ kind, adapter, dataDir: DATA_DIR, defaultTenant: DEFAULT_TENANT });
  _registry = adapter;
}

function backend()  { init(); return _backend; }
function registry() { init(); return _registry; }

// Tests : repartir d'un état vierge (autre STORE, autre adaptateur).
function _reset(b, r) { _backend = b || null; _registry = r || null; }

module.exports = { backend, registry, _reset };
