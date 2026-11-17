// ══════════════════════════════════════════════════════════════
// TENANTS : résolution, cache, middleware, tâches de fond
//
// Résolution d'une requête vers une organisation (multi-tenant) :
//   1. domaine personnalisé déclaré sur le tenant (tenant.domains) ;
//   2. sous-domaine du domaine de la plateforme :
//        PEARL_BASE_DOMAIN=pearl.app  →  acme.pearl.app = « acme »
//      (en local : acme.localhost:3000 fonctionne dans les navigateurs) ;
//   3. en-tête X-Pearl-Tenant, seulement si PEARL_TENANT_HEADER=1
//      (tests, outils internes derrière un proxy de confiance).
// Le domaine nu (pearl.app, localhost) est la plateforme elle-même :
// inscription, console, page d'accueil. Aucune donnée de tenant n'y est lue.
//
// Mono-tenant : tout va au tenant « default », comme avant.
// ══════════════════════════════════════════════════════════════
const { runAsTenant, isMultiTenant, DEFAULT_TENANT, SLUG_RE } = require('../core/tenant');
const { backend, registry } = require('../core/backend');

const CACHE_MS = 30 * 1000;
const _cache = new Map();   // clé (slug ou domaine) → { at, tenant }

const baseDomain = () => String(process.env.PEARL_BASE_DOMAIN || 'localhost').toLowerCase().replace(/^\.+|\.+$/g, '');

// Sous-domaines réservés à la plateforme : jamais un slug de client.
const RESERVED = new Set(['www', 'app', 'api', 'admin', 'console', 'platform', 'signup', 'login', 'auth',
  'mail', 'smtp', 'static', 'assets', 'cdn', 'status', 'docs', 'help', 'support', 'billing', 'default', 'pearl']);
const isReservedSlug = s => RESERVED.has(String(s || '').toLowerCase());

function hostOf(req) {
  return String(req.hostname || (req.headers.host || '').split(':')[0] || '').toLowerCase();
}

// Ce que dit l'hôte, sans aller en base : { kind: 'platform' } |
// { kind: 'slug', slug } | { kind: 'domain', host }.
function parseHost(host) {
  const base = baseDomain();
  if (!host || host === base || host === `www.${base}`) return { kind: 'platform' };
  if (host.endsWith(`.${base}`)) {
    const sub = host.slice(0, -(base.length + 1));
    if (!sub.includes('.') && SLUG_RE.test(sub)) return isReservedSlug(sub) ? { kind: 'platform' } : { kind: 'slug', slug: sub };
    return { kind: 'unknown' };
  }
  // Adresse IP ou nom de machine sans domaine : la plateforme.
  if (/^[\d.]+$/.test(host) || /^\[?[0-9a-f:]+\]?$/.test(host) || !host.includes('.')) return { kind: 'platform' };
  return { kind: 'domain', host };
}

async function cached(key, load) {
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.tenant;
  const tenant = await load();
  _cache.set(key, { at: Date.now(), tenant });
  return tenant;
}
const invalidate = slug => { for (const [k, v] of _cache) if (k === slug || (v.tenant && v.tenant.slug === slug)) _cache.delete(k); };

const getTenant = slug => cached(`slug:${slug}`, () => registry().getTenant(slug));

// Mode « chemin » (pearl.app/o/acme) : l'organisation est retenue dans un
// cookie posé par /o/<slug>. Ces chemins restent ceux de la plateforme,
// quel que soit le cookie (inscription, console, changement d'espace).
const ORG_COOKIE = 'pearl_org';
const TOUJOURS_PLATEFORME = /^\/(signup|console|platform\/|o\/|o$|api\/platform\/(signup|slug|packs|console)(\/|$))/;
function orgCookie(req) {
  const m = /(?:^|;\s*)pearl_org=([^;]+)/.exec(req.headers.cookie || '');
  const v = m ? decodeURIComponent(m[1]) : '';
  return SLUG_RE.test(v) ? v : '';
}
function forcePlateforme(req) {
  return TOUJOURS_PLATEFORME.test(req.path) || (req.method === 'GET' && req.path === '/api/platform/modules');
}

async function resolveTenant(req) {
  if (!isMultiTenant()) return { kind: 'tenant', tenant: { slug: DEFAULT_TENANT, name: null, status: 'active', modules: [], branding: {} } };
  if (process.env.PEARL_TENANT_HEADER === '1' && req.headers['x-pearl-tenant']) {
    const slug = String(req.headers['x-pearl-tenant']).toLowerCase();
    const t = SLUG_RE.test(slug) ? await getTenant(slug) : null;
    return t ? { kind: 'tenant', tenant: t } : { kind: 'unknown' };
  }
  const p = parseHost(hostOf(req));
  if (p.kind === 'slug') {
    const t = await getTenant(p.slug);
    return t ? { kind: 'tenant', tenant: t } : { kind: 'unknown' };
  }
  if (p.kind === 'domain') {
    const t = await cached(`domain:${p.host}`, () => registry().findTenantByDomain(p.host));
    if (t) return { kind: 'tenant', tenant: t };
    // Mode chemin : tout hôte qui n'est pas un domaine de client (domaine
    // du déploiement, prévisualisations) est la plateforme.
    if (require('../config/runtime').tenantUrlMode() !== 'path') return { kind: 'unknown' };
  } else if (p.kind !== 'platform') return { kind: 'unknown' };
  // Plateforme, ou espace choisi par /o/<slug>.
  const slug = !forcePlateforme(req) && orgCookie(req);
  if (slug) {
    const t = await getTenant(slug);
    if (t) return { kind: 'tenant', tenant: t };
  }
  return { kind: 'platform' };
}

// Chemins servis sans tenant ni chargement de données : fichiers statiques
// communs à tous (le style et les scripts ne dépendent pas du tenant).
const STATIQUE = /^\/(css|js|fonts|vendor|bundle|favicon|img)\b/;

function wantsJson(req) {
  return req.path.startsWith('/api/') || /json/.test(String(req.headers.accept || ''));
}

function tenantMiddleware() {
  return async function tenant(req, res, next) {
    let r;
    try { r = await resolveTenant(req); }
    catch (e) {
      console.error('[tenant] résolution impossible :', e.message);
      return res.status(503).json({ error: 'Service momentanément indisponible' });
    }
    if (r.kind === 'platform') { req.platform = true; return next(); }
    if (r.kind === 'unknown') {
      if (STATIQUE.test(req.path)) return next();
      return wantsJson(req)
        ? res.status(404).json({ error: 'Organisation inconnue' })
        : res.status(404).type('html').send(pageSimple('Organisation introuvable', "Cette adresse ne correspond à aucun espace Pearl. Vérifiez le lien reçu."));
    }
    const t = r.tenant;
    req.tenant = t;
    if (t.status === 'suspended' && !STATIQUE.test(req.path)) {
      return wantsJson(req)
        ? res.status(402).json({ error: 'Espace suspendu' })
        : res.status(402).type('html').send(pageSimple('Espace suspendu', "Cet espace est suspendu. Contactez l'administrateur de votre organisation."));
    }
    if (STATIQUE.test(req.path)) return runAsTenant(t.slug, () => next());
    const { isServerless } = require('../config/runtime');
    if (isServerless()) {
      // Plusieurs instances peuvent servir le même tenant : on relit ses
      // données à chaque requête, et la réponse ne part qu'une fois les
      // écritures enregistrées (la fonction est figée juste après).
      if (backend().evict) backend().evict(t.slug);
      const end = res.end.bind(res);
      res.end = (...args) => { backend().flush().catch(() => {}).finally(() => end(...args)); return res; };
    }
    try { await backend().ensureTenant(t.slug); }
    catch (e) {
      console.error(`[tenant] chargement de ${t.slug} impossible :`, e.message);
      return res.status(503).json({ error: 'Données momentanément indisponibles' });
    }
    runAsTenant(t.slug, () => {
      try { require('../core/store').initTenant(); } catch (e) { console.error(`[tenant] init ${t.slug} :`, e.message); }
      next();
    });
  };
}

// Exécute `fn` pour chaque tenant actif, dans son contexte, l'un après
// l'autre (tâches de fond : diffusion, insights, corrections).
async function forEachTenant(fn) {
  let slugs;
  if (!isMultiTenant()) slugs = [DEFAULT_TENANT];
  else {
    try { slugs = (await registry().listTenants()).filter(t => t.status !== 'suspended').map(t => t.slug); }
    catch (e) { console.error('[tenant] liste des tenants indisponible :', e.message); return; }
  }
  for (const slug of slugs) {
    try {
      await backend().ensureTenant(slug);
      await runAsTenant(slug, async () => {
        require('../core/store').initTenant();
        await fn(slug);
      });
    } catch (e) { console.error(`[tenant] ${slug} :`, e.message); }
  }
}

function pageSimple(titre, texte) {
  const esc = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titre)} · Pearl</title><style>body{font-family:system-ui,sans-serif;background:#F6F7F9;color:#1B2430;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
main{max-width:440px;background:#fff;border-radius:14px;padding:28px;box-shadow:0 2px 12px rgba(0,0,0,.06)}h1{font-size:20px;margin:0 0 8px}p{margin:0;color:#4A5563;line-height:1.5}
@media (prefers-color-scheme:dark){body{background:#12161C;color:#E6E9EE}main{background:#1B2129}p{color:#A9B1BC}}</style></head>
<body><main><h1>${esc(titre)}</h1><p>${esc(texte)}</p></main></body></html>`;
}

module.exports = { ORG_COOKIE, orgCookie, tenantMiddleware, resolveTenant, parseHost, forEachTenant, getTenant, invalidate, isReservedSlug, baseDomain, pageSimple };
