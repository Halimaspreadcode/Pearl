// ══════════════════════════════════════════════════════════════
// CONFIGURATION AUTOMATIQUE SELON L'HÉBERGEMENT
//
// Chargé en tout premier (app.js, index.js). Ne remplace jamais une
// variable déjà définie : il complète ce qui manque.
//
//   · Supabase relié (SUPABASE_URL + clé service_role, comme le fait
//     l'intégration Vercel ↔ Supabase) → STORE=supabase, MULTI_TENANT=1 ;
//   · Vercel (ou PEARL_SERVERLESS=1) → données temporaires dans /tmp,
//     proxy de confiance, adresses d'espace en /o/<organisation> (les
//     sous-domaines *.vercel.app par client n'existent pas).
// ══════════════════════════════════════════════════════════════
const env = process.env;

const isServerless = () => !!env.VERCEL || env.PEARL_SERVERLESS === '1';
const supabaseConfigured = () => !!(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL)
  && !!(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY);

function applyRuntimeDefaults() {
  if (!env.SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_URL) env.SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!env.SUPABASE_ANON_KEY && env.NEXT_PUBLIC_SUPABASE_ANON_KEY) env.SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!env.STORE && supabaseConfigured()) env.STORE = 'supabase';
  if (!env.MULTI_TENANT && (env.STORE === 'supabase' || env.STORE === 'pg')) env.MULTI_TENANT = '1';
  if (isServerless()) {
    if (!env.DATA_DIR) env.DATA_DIR = '/tmp/pearl-data';
    if (!env.TRUST_PROXY) env.TRUST_PROXY = 'true';
    // Domaine de la plateforme : celui du déploiement de production.
    if (!env.PEARL_BASE_DOMAIN && env.VERCEL_PROJECT_PRODUCTION_URL) env.PEARL_BASE_DOMAIN = env.VERCEL_PROJECT_PRODUCTION_URL;
    if (!env.PEARL_TENANT_URLS) env.PEARL_TENANT_URLS = 'path';
  }
}

// Adresses des espaces : 'subdomain' (acme.pearl.app, demande un DNS
// générique) ou 'path' (pearl.app/o/acme, fonctionne partout).
const tenantUrlMode = () => (env.PEARL_TENANT_URLS === 'path' ? 'path' : 'subdomain');

module.exports = { applyRuntimeDefaults, isServerless, supabaseConfigured, tenantUrlMode };
