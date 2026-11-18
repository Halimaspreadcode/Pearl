// ══════════════════════════════════════════════════════════════
// ROUTES DE LA PLATEFORME
//
// Domaine nu (req.platform) : accueil, inscription en libre-service,
// console super-admin. Rien d'autre n'y est servi.
//
// Espace d'une organisation (req.tenant) : connexion par compte, profil de
// l'organisation (marque, modules), membres, transfert de session après
// l'inscription. Le reste de l'application suit, dans index.js.
// ══════════════════════════════════════════════════════════════
const express = require('express');
const path    = require('path');
const { authLimiter } = require('../http/security');
const { registry, backend } = require('../core/backend');
const { runAsTenant, isMultiTenant, SLUG_RE } = require('../core/tenant');
const accounts = require('./accounts');
const { accountBridge, membership, forgetMember, ADMIN_LIKE } = require('./bridge');
const { activeModules, validateModules, moduleGuard, pagesOf, MODULES, allPages } = require('./modules');
const { provisionTenant, listPacks, cleanBranding, slugify } = require('./provision');
const tenants = require('./tenants');

const router = express.Router();
const PLATFORM_DIR = path.join(__dirname, '../../public/platform');
const STATIQUE = /^\/(css|js|fonts|vendor|bundle|favicon|img)\b/;

const send = (res, e) => res.status(e.status || 500).json({ error: e.status ? e.message : 'Erreur interne' });
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(e => {
  if (!e.status) console.error('[platform]', e);
  send(res, e);
});

// Adresse d'un espace : https://<slug>.<domaine> (port conservé en local),
// ou <origine>/o/<slug> en mode chemin (Vercel, pas de DNS générique).
function tenantUrl(req, slug, chemin = '/') {
  if (require('../config/runtime').tenantUrlMode() === 'path') {
    const proto = req.protocol || 'https';
    return `${proto}://${req.headers.host}/o/${slug}${chemin === '/' ? '' : chemin}`;
  }
  const host = String(req.headers.host || '');
  const port = host.includes(':') ? `:${host.split(':')[1]}` : '';
  const proto = req.secure ? 'https' : (tenants.baseDomain() === 'localhost' ? 'http' : 'https');
  return `${proto}://${slug}.${tenants.baseDomain()}${port}${chemin}`;
}

async function isPlatformAdmin(acct) {
  if (!acct) return false;
  const emails = String(process.env.PEARL_PLATFORM_ADMIN_EMAILS || '').split(',').map(accounts.normEmail).filter(Boolean);
  if (emails.includes(accounts.normEmail(acct.email))) return true;
  try { return await registry().isPlatformAdmin(acct.id); } catch { return false; }
}

const publicTenant = t => ({
  slug: t.slug, name: t.name, status: t.status, plan: t.plan, pack: t.pack,
  trial_ends_at: t.trial_ends_at || null, branding: t.branding || {}, modules: t.modules || [], domains: t.domains || [],
  created_at: t.created_at,
});

// ═════════════════════ DOMAINE DE LA PLATEFORME ═════════════════════
const platform = express.Router();

platform.get('/', (req, res) => res.sendFile(path.join(PLATFORM_DIR, 'index.html')));

// Entrée d'un espace en mode chemin : /o/acme (puis /o/acme/<chemin>).
// Le cookie retient l'organisation ; /o/- revient à la plateforme.
platform.get(/^\/o\/([^/]+)(\/.*)?$/, wrap(async (req, res) => {
  const slug = String(req.params[0] || '').toLowerCase();
  const reste = req.params[1] || '/';
  const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  if (slug === '-') { res.clearCookie(tenants.ORG_COOKIE, { path: '/' }); return res.redirect('/'); }
  if (!SLUG_RE.test(slug) || !(await tenants.getTenant(slug)))
    return res.status(404).type('html').send(tenants.pageSimple('Organisation introuvable', "Cette adresse ne correspond à aucun espace Pear. Vérifiez le lien reçu."));
  res.cookie(tenants.ORG_COOKIE, slug, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 365 * 86400000, path: '/' });
  // Seuls des chemins internes : jamais de redirection vers un autre site.
  const cible = /^\/[^/\\]/.test(reste) || reste === '/' ? reste : '/';
  res.redirect(cible + qs);
}));
platform.get('/signup', (req, res) => res.sendFile(path.join(PLATFORM_DIR, 'signup.html')));
platform.get('/console', (req, res) => res.sendFile(path.join(PLATFORM_DIR, 'console.html')));
platform.get('/platform/:file', (req, res, next) => {
  if (!/^[a-z0-9-]+\.(css|js|svg)$/.test(req.params.file)) return next();
  res.sendFile(path.join(PLATFORM_DIR, req.params.file));
});

platform.get('/api/platform/packs', (req, res) => res.json(listPacks().map(p => ({
  id: p.id, label: p.label, desc: p.desc, modules: p.modules, sites: p.sites,
}))));
platform.get('/api/platform/modules', (req, res) => res.json(MODULES.map(m => ({ id: m.id, label: m.label, desc: m.desc, always: !!m.always, depends: m.depends || [] }))));

platform.get('/api/platform/slug', wrap(async (req, res) => {
  const slug = String(req.query.slug || slugify(req.query.name || '')).toLowerCase();
  const valid = SLUG_RE.test(slug) && !tenants.isReservedSlug(slug);
  const taken = valid ? !!(await registry().getTenant(slug)) : false;
  res.json({ slug, valid, available: valid && !taken, url: valid ? tenantUrl(req, slug) : null });
}));

// Inscription en libre-service : organisation + compte propriétaire, puis
// transfert de session vers l'espace (le cookie est propre à chaque hôte).
platform.post('/api/platform/signup', authLimiter, wrap(async (req, res) => {
  if (process.env.PEARL_SIGNUP === 'off') return res.status(403).json({ error: 'Les inscriptions sont fermées.' });
  const b = req.body || {};
  const r = await provisionTenant({
    name: b.org_name, slug: b.slug, pack: b.pack, sites: b.sites, modules: b.modules,
    branding: { primary: b.primary, logo: b.logo, tagline: b.tagline },
    owner: { email: b.email, password: b.password, name: b.full_name },
  });
  const handoff = accounts.signToken({ uid: r.owner.id, email: r.owner.email, tenant: r.tenant.slug, purpose: 'handoff' }, 5 * 60 * 1000);
  res.status(201).json({ ok: true, tenant: publicTenant(r.tenant), url: tenantUrl(req, r.tenant.slug, `/auth/handoff?t=${encodeURIComponent(handoff)}`) });
}));

// ── Console super-admin ──
platform.post('/api/platform/console/login', authLimiter, wrap(async (req, res) => {
  const u = await accounts.provider().signIn(req.body?.email, req.body?.password);
  if (!u || !(await isPlatformAdmin(u))) return res.status(401).json({ error: 'Identifiants incorrects ou accès non autorisé.' });
  accounts.setAccountCookie(req, res, u, null);
  res.json({ ok: true, email: u.email });
}));
// Première installation : tant qu'aucun administrateur n'existe, le code
// d'installation (empreinte bcrypt en base, ou PEARL_SETUP_CODE) crée le
// premier compte. Le code est détruit une fois utilisé.
async function setupOuvert() {
  try { return (await registry().countPlatformAdmins()) === 0; } catch { return false; }
}
platform.get('/api/platform/console/setup', wrap(async (req, res) => res.json({ open: await setupOuvert() })));
platform.post('/api/platform/console/setup', authLimiter, wrap(async (req, res) => {
  if (!(await setupOuvert())) return res.status(403).json({ error: 'La console est déjà installée.' });
  const b = req.body || {};
  const code = String(b.code || '').trim();
  const stored = await registry().getSetting('console_setup');
  const bcrypt = require('bcryptjs');
  const ok = code && ((stored && stored.hash && bcrypt.compareSync(code, stored.hash))
    || (process.env.PEARL_SETUP_CODE && code === process.env.PEARL_SETUP_CODE));
  if (!ok) return res.status(401).json({ error: "Code d'installation incorrect." });
  if (!accounts.validEmail(b.email)) return res.status(400).json({ error: 'Email invalide.' });
  const pwErr = accounts.validPassword(b.password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  const p = accounts.provider();
  let user = await p.findByEmail(b.email);
  if (user) await p.setPassword(user.id, b.password); else user = await p.createUser(b.email, b.password);
  await registry().addPlatformAdmin(user.id);
  await registry().deleteSetting('console_setup');
  accounts.setAccountCookie(req, res, user, null);
  res.json({ ok: true, email: user.email });
}));

platform.post('/api/platform/console/logout', (req, res) => { accounts.clearAccountCookie(res); res.json({ ok: true }); });

const requirePlatformAdmin = wrap(async (req, res, next) => {
  const a = accounts.accountOf(req);
  if (!a || a.tenant || !(await isPlatformAdmin(a))) return res.status(401).json({ error: 'Connexion requise', console_auth: true });
  req.account = a;
  next();
});

platform.get('/api/platform/console/me', requirePlatformAdmin, (req, res) => res.json({ ok: true, email: req.account.email }));

platform.get('/api/platform/console/tenants', requirePlatformAdmin, wrap(async (req, res) => {
  const list = await registry().listTenants();
  const withMembers = await Promise.all(list.map(async t => ({ ...publicTenant(t), members: (await registry().listMembers(t.slug)).length, url: tenantUrl(req, t.slug) })));
  res.json(withMembers);
}));

platform.post('/api/platform/console/tenants', requirePlatformAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  const r = await provisionTenant({
    name: b.name, slug: b.slug, pack: b.pack, sites: b.sites, modules: b.modules, status: b.status || 'active', plan: b.plan || 'standard',
    branding: b.branding, owner: b.owner_email ? { email: b.owner_email, name: b.owner_name } : null,
  });
  res.status(201).json({ ok: true, tenant: publicTenant(r.tenant), owner: r.owner, temp_password: r.tempPassword, url: tenantUrl(req, r.tenant.slug) });
}));

platform.patch('/api/platform/console/tenants/:slug', requirePlatformAdmin, wrap(async (req, res) => {
  const b = req.body || {}, patch = {};
  if (b.name != null) patch.name = String(b.name).trim().slice(0, 80);
  if (b.status != null) {
    if (!['trial', 'active', 'suspended'].includes(b.status)) return res.status(400).json({ error: 'Statut invalide' });
    patch.status = b.status;
  }
  if (b.plan != null) patch.plan = String(b.plan).trim().slice(0, 40);
  if (b.modules != null) {
    const v = validateModules(b.modules);
    if (!v.ok) return res.status(400).json({ error: v.error });
    patch.modules = v.modules;
  }
  if (b.branding != null) patch.branding = cleanBranding(b.branding, b.name);
  if (b.domains != null) {
    const d = [...new Set([].concat(b.domains).map(x => String(x).trim().toLowerCase()).filter(Boolean))];
    if (d.some(x => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(x) || x.endsWith(`.${tenants.baseDomain()}`)))
      return res.status(400).json({ error: 'Domaine invalide' });
    patch.domains = d;
  }
  if (b.trial_ends_at !== undefined) patch.trial_ends_at = b.trial_ends_at || null;
  const t = await registry().updateTenant(req.params.slug, patch);
  if (!t) return res.status(404).json({ error: 'Tenant inconnu' });
  tenants.invalidate(req.params.slug);
  res.json({ ok: true, tenant: publicTenant(t) });
}));

platform.delete('/api/platform/console/tenants/:slug', requirePlatformAdmin, wrap(async (req, res) => {
  if (req.body?.confirm !== req.params.slug) return res.status(400).json({ error: 'Confirmation : retaper le slug du tenant.' });
  await registry().deleteTenant(req.params.slug);
  if (backend().evict) backend().evict(req.params.slug);
  tenants.invalidate(req.params.slug);
  res.json({ ok: true });
}));

platform.get('/api/platform/console/tenants/:slug/members', requirePlatformAdmin, wrap(async (req, res) => {
  res.json(await registry().listMembers(req.params.slug));
}));

// Tâches planifiées en serverless (Vercel Cron) : diffusion des rapports
// pour chaque organisation. Protégé par CRON_SECRET (envoyé par Vercel).
platform.get('/api/cron/tick', wrap(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.get('authorization') !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  const { tickDiffusion } = require('../services/mail/scheduler');
  await tenants.forEachTenant(() => tickDiffusion());
  await backend().flush();
  res.json({ ok: true });
}));

// Fichiers statiques communs ; tout le reste n'existe pas sur la plateforme.
platform.use((req, res, next) => {
  if (STATIQUE.test(req.path)) return next();
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).type('html').send(tenants.pageSimple('Page introuvable', "Cette page n'existe pas sur la plateforme Pear."));
});

router.use((req, res, next) => (req.platform ? platform(req, res, next) : next()));

// ═════════════════════ ESPACE D'UNE ORGANISATION ═════════════════════
const tenantRouter = express.Router();

// Marque et nom, lisibles avant connexion (écran de connexion).
tenantRouter.get('/api/platform/brand', (req, res) => {
  const t = req.tenant;
  const b = (t && t.branding) || {};
  const cfg = require('../core/store').readCfg();
  res.json({ name: b.name || t.name || cfg.org_name || 'Pear', branding: b, accounts: accountsEnabled(),
    // Mode chemin : lien pour changer d'organisation.
    switch_url: require('../config/runtime').tenantUrlMode() === 'path' ? '/o/-' : null });
});

// Comptes actifs : toujours en multi-tenant ; en mono-tenant si ACCOUNTS=1.
const accountsEnabled = () => isMultiTenant() || process.env.ACCOUNTS === '1';

tenantRouter.post('/api/team/account-login', authLimiter, wrap(async (req, res) => {
  if (!accountsEnabled()) return res.status(404).json({ error: 'Not found' });
  const u = await accounts.provider().signIn(req.body?.email, req.body?.password);
  const m = u && await membership(u.id, req.tenant.slug);
  if (!u || !m) return res.status(401).json({ ok: false, error: 'Email ou mot de passe incorrect.' });
  accounts.setAccountCookie(req, res, u, req.tenant.slug);
  require('../core/audit').addAudit('access', u.email, m.person_name || u.email, 'account-login', { role: m.role });
  res.json({ ok: true, role: m.role, admin: ADMIN_LIKE.includes(m.role) });
}));

tenantRouter.post('/api/team/account-logout', (req, res) => {
  accounts.clearAccountCookie(res);
  require('../auth/team-gate').fermerSession(req, res);
  const S = require('../auth/sessions');
  S.sessions.delete(S.readCookie(req, S.ADMIN_COOKIE));
  res.clearCookie(S.ADMIN_COOKIE, { path: '/' });
  res.json({ ok: true });
});

// Arrivée depuis l'inscription : jeton de transfert à usage court.
tenantRouter.get('/auth/handoff', (req, res) => {
  const p = accounts.verifyToken(req.query.t, 'handoff');
  if (!p || p.tenant !== req.tenant.slug) return res.redirect('/');
  accounts.setAccountCookie(req, res, { id: p.uid, email: p.email }, p.tenant);
  res.redirect('/');
});

// Les sessions de l'application suivent le compte (platform/bridge.js).
tenantRouter.use(accountBridge);
// Modules : une route d'un module non activé n'existe pas.
tenantRouter.use('/api', moduleGuard);

const requireOrgAdmin = (req, res, next) => {
  if (req.account && ['owner', 'admin'].includes(req.account.role)) return next();
  return res.status(403).json({ error: 'Réservé au propriétaire et aux administrateurs de l’organisation.' });
};

tenantRouter.get('/api/platform/me', (req, res) => {
  const t = req.tenant;
  const mods = activeModules(t);
  res.json({
    tenant: { slug: t.slug, name: t.name, status: t.status, plan: t.plan, trial_ends_at: t.trial_ends_at || null, branding: t.branding || {} },
    multi_tenant: isMultiTenant(), accounts: accountsEnabled(),
    modules: mods, pages: pagesOf(mods), all_pages: allPages(),
    account: req.account || null,
  });
});

// Catalogue des modules (cases de Configuration › Organisation).
tenantRouter.get('/api/platform/modules-catalog', (req, res) => res.json(MODULES.map(m => ({
  id: m.id, label: m.label, desc: m.desc, always: !!m.always, depends: m.depends || [],
}))));

tenantRouter.get('/api/platform/members', requireOrgAdmin, wrap(async (req, res) => {
  res.json(await registry().listMembers(req.tenant.slug));
}));

// Inviter : crée le compte s'il n'existe pas (mot de passe provisoire
// renvoyé une fois), puis le rattache avec un rôle.
tenantRouter.post('/api/platform/members', requireOrgAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  if (!accounts.validEmail(b.email)) return res.status(400).json({ error: 'Email invalide.' });
  if (!accounts.ROLES.includes(b.role) || b.role === 'owner' && req.account.role !== 'owner')
    return res.status(400).json({ error: 'Rôle invalide.' });
  const p = accounts.provider();
  let user = await p.findByEmail(b.email), temp = null;
  if (!user) user = await p.createUser(b.email, temp = accounts.tempPassword());
  await registry().upsertMember({ user_id: user.id, tenant: req.tenant.slug, role: b.role,
    person_name: String(b.person_name || '').trim().slice(0, 80) || null, email: accounts.normEmail(b.email) });
  forgetMember(user.id, req.tenant.slug);
  require('../core/audit').addAudit('access', user.email, req.account.email, 'member-invite', { role: b.role });
  res.status(201).json({ ok: true, user_id: user.id, email: user.email, temp_password: temp });
}));

tenantRouter.put('/api/platform/members/:uid', requireOrgAdmin, wrap(async (req, res) => {
  const list = await registry().listMembers(req.tenant.slug);
  const m = list.find(x => x.user_id === req.params.uid);
  if (!m) return res.status(404).json({ error: 'Membre inconnu' });
  const role = req.body?.role || m.role;
  if (!accounts.ROLES.includes(role)) return res.status(400).json({ error: 'Rôle invalide.' });
  if ((role === 'owner' || m.role === 'owner') && req.account.role !== 'owner')
    return res.status(403).json({ error: 'Seul le propriétaire gère le rôle propriétaire.' });
  if (m.role === 'owner' && role !== 'owner' && list.filter(x => x.role === 'owner').length < 2)
    return res.status(400).json({ error: "L'organisation doit garder au moins un propriétaire." });
  await registry().upsertMember({ ...m, role, person_name: req.body?.person_name !== undefined ? (String(req.body.person_name || '').trim().slice(0, 80) || null) : m.person_name });
  forgetMember(m.user_id, req.tenant.slug);
  res.json({ ok: true });
}));

tenantRouter.delete('/api/platform/members/:uid', requireOrgAdmin, wrap(async (req, res) => {
  const list = await registry().listMembers(req.tenant.slug);
  const m = list.find(x => x.user_id === req.params.uid);
  if (!m) return res.status(404).json({ error: 'Membre inconnu' });
  if (m.role === 'owner' && list.filter(x => x.role === 'owner').length < 2)
    return res.status(400).json({ error: "L'organisation doit garder au moins un propriétaire." });
  await registry().deleteMember(m.user_id, req.tenant.slug);
  forgetMember(m.user_id, req.tenant.slug);
  res.json({ ok: true });
}));

// Marque blanche : nom affiché, couleurs, logo.
tenantRouter.put('/api/platform/branding', requireOrgAdmin, wrap(async (req, res) => {
  const branding = cleanBranding(req.body || {}, req.tenant.name);
  const t = await registry().updateTenant(req.tenant.slug, { branding });
  tenants.invalidate(req.tenant.slug);
  res.json({ ok: true, branding: t.branding });
}));

// Modules actifs (le propriétaire peut en retirer ou en ajouter).
tenantRouter.put('/api/platform/modules', requireOrgAdmin, wrap(async (req, res) => {
  const v = validateModules(req.body?.modules);
  if (!v.ok) return res.status(400).json({ error: v.error });
  await registry().updateTenant(req.tenant.slug, { modules: v.modules });
  tenants.invalidate(req.tenant.slug);
  res.json({ ok: true, modules: v.modules });
}));

router.use((req, res, next) => (req.tenant ? tenantRouter(req, res, next) : next()));

module.exports = router;
