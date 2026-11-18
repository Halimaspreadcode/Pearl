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
const billing = require('./billing');
const invites = require('./invites');
const activity = require('./activity');

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
  await activity.log(r.tenant.slug, r.owner.email, 'org.created', { pack: r.tenant.pack });
  const handoff = accounts.signToken({ uid: r.owner.id, email: r.owner.email, tenant: r.tenant.slug, purpose: 'handoff' }, 5 * 60 * 1000);
  res.status(201).json({ ok: true, tenant: publicTenant(r.tenant), url: tenantUrl(req, r.tenant.slug, `/auth/handoff?t=${encodeURIComponent(handoff)}`) });
}));

// ── Console super-admin ──
platform.post('/api/platform/console/login', authLimiter, wrap(async (req, res) => {
  const u = await accounts.provider().signIn(req.body?.email, req.body?.password);
  if (!u || !(await isPlatformAdmin(u))) return res.status(401).json({ error: 'Identifiants incorrects ou accès non autorisé.' });
  accounts.setAccountCookie(req, res, u, null);
  await activity.log(null, u.email, 'auth.login', { ip: req.ip });
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

// Organisation vue de la console : abonnement, sièges, membres.
async function consoleTenant(req, t) {
  const [members, inv] = await Promise.all([registry().listMembers(t.slug), invites.listInvites(t.slug)]);
  const b = billing.summary(t, members, inv);
  const owner = members.find(m => m.role === 'owner');
  return { ...publicTenant(t), url: tenantUrl(req, t.slug), members: members.length, owner_email: owner ? owner.email : null,
    seats: b.seats, seats_used: b.usage.used, invites: inv.length, plan: b.plan, interval: b.interval,
    mrr: t.status === 'active' ? b.price.monthly : 0, price: b.price };
}
const consoleLog = (req, action, details) => activity.log(null, req.account.email, action, details);

platform.get('/api/platform/console/tenants', requirePlatformAdmin, wrap(async (req, res) => {
  const list = await registry().listTenants();
  res.json(await Promise.all(list.map(t => consoleTenant(req, t))));
}));

// Indicateurs de la plateforme.
platform.get('/api/platform/console/stats', requirePlatformAdmin, wrap(async (req, res) => {
  const list = await Promise.all((await registry().listTenants()).map(t => consoleTenant(req, t)));
  const soon = Date.now() + 7 * 86400000;
  const byPlan = {};
  for (const t of list) byPlan[t.plan] = (byPlan[t.plan] || 0) + 1;
  res.json({
    tenants: list.length,
    active: list.filter(t => t.status === 'active').length,
    trial: list.filter(t => t.status === 'trial').length,
    suspended: list.filter(t => t.status === 'suspended').length,
    trial_ending: list.filter(t => t.status === 'trial' && t.trial_ends_at && Date.parse(t.trial_ends_at) < soon).length,
    members: list.reduce((n, t) => n + t.members, 0),
    seats: list.reduce((n, t) => n + t.seats, 0),
    seats_used: list.reduce((n, t) => n + t.seats_used, 0),
    mrr: Math.round(list.reduce((n, t) => n + t.mrr, 0) * 100) / 100,
    pipeline: Math.round(list.filter(t => t.status === 'trial').reduce((n, t) => n + t.price.monthly, 0) * 100) / 100,
    by_plan: byPlan, plans: billing.PLANS,
    new_30d: list.filter(t => Date.parse(t.created_at) > Date.now() - 30 * 86400000).length,
  });
}));

platform.get('/api/platform/console/tenants/:slug', requirePlatformAdmin, wrap(async (req, res) => {
  const t = await registry().getTenant(req.params.slug);
  if (!t) return res.status(404).json({ error: 'Organisation inconnue' });
  const [members, inv, act] = await Promise.all([registry().listMembers(t.slug), invites.listInvites(t.slug), activity.read(t.slug, { limit: 100 })]);
  res.json({ ...(await consoleTenant(req, t)), billing: billing.summary(t, members, inv), member_list: members,
    invite_list: inv.map(publicInvite), activity: act });
}));

platform.post('/api/platform/console/tenants', requirePlatformAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  const r = await provisionTenant({
    name: b.name, slug: b.slug, pack: b.pack, sites: b.sites, modules: b.modules, status: b.status || 'active', plan: b.plan || 'business',
    branding: b.branding, owner: b.owner_email ? { email: b.owner_email, name: b.owner_name } : null,
  });
  if (b.seats || b.plan) {
    const c = billing.applyChange(r.tenant, [], [], { seats: b.seats, plan: billing.planOf(b.plan) ? b.plan : undefined }, req.account.email);
    await registry().updateTenant(r.tenant.slug, { billing: c.billing, plan: c.billing.plan });
  }
  await consoleLog(req, 'tenant.created', { slug: r.tenant.slug, owner: b.owner_email || null });
  await activity.log(r.tenant.slug, `console:${req.account.email}`, 'org.created', { pack: r.tenant.pack });
  res.status(201).json({ ok: true, tenant: publicTenant(r.tenant), owner: r.owner, temp_password: r.tempPassword, url: tenantUrl(req, r.tenant.slug) });
}));

platform.patch('/api/platform/console/tenants/:slug', requirePlatformAdmin, wrap(async (req, res) => {
  const b = req.body || {}, patch = {};
  const cur = await registry().getTenant(req.params.slug);
  if (!cur) return res.status(404).json({ error: 'Organisation inconnue' });
  if (b.name != null) patch.name = String(b.name).trim().slice(0, 80);
  if (b.status != null) {
    if (!['trial', 'active', 'suspended'].includes(b.status)) return res.status(400).json({ error: 'Statut invalide' });
    patch.status = b.status;
  }
  if (b.modules != null) {
    const v = validateModules(b.modules);
    if (!v.ok) return res.status(400).json({ error: v.error });
    patch.modules = v.modules;
  }
  if (b.branding != null) patch.branding = cleanBranding(b.branding, b.name || cur.name);
  if (b.domains != null) {
    const d = [...new Set([].concat(b.domains).map(x => String(x).trim().toLowerCase()).filter(Boolean))];
    if (d.some(x => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(x) || x.endsWith(`.${tenants.baseDomain()}`)))
      return res.status(400).json({ error: 'Domaine invalide' });
    patch.domains = d;
  }
  if (b.trial_ends_at !== undefined) patch.trial_ends_at = b.trial_ends_at || null;
  if (b.extend_trial_days) {
    const base = Math.max(Date.now(), Date.parse(cur.trial_ends_at || 0) || 0);
    patch.trial_ends_at = new Date(base + Math.min(365, Math.max(1, Number(b.extend_trial_days))) * 86400000).toISOString();
    if (cur.status !== 'trial' && b.status == null) patch.status = 'trial';
  }
  if (b.seats != null || b.billing_plan != null || b.interval != null || (b.plan != null && billing.planOf(b.plan))) {
    const [members, inv] = await Promise.all([registry().listMembers(cur.slug), invites.listInvites(cur.slug)]);
    const c = billing.applyChange(cur, members, inv, { seats: b.seats, plan: b.billing_plan || (billing.planOf(b.plan) ? b.plan : undefined), interval: b.interval }, `console:${req.account.email}`);
    if (c.changed.length) { patch.billing = c.billing; patch.plan = c.billing.plan; await activity.log(cur.slug, `console:${req.account.email}`, 'billing.changed', c.entry); }
  } else if (b.plan != null) patch.plan = String(b.plan).trim().slice(0, 40);
  const t = await registry().updateTenant(req.params.slug, patch);
  if (!t) return res.status(404).json({ error: 'Organisation inconnue' });
  tenants.invalidate(req.params.slug);
  await consoleLog(req, 'tenant.updated', { slug: req.params.slug, fields: Object.keys(patch) });
  res.json({ ok: true, tenant: publicTenant(t) });
}));

platform.delete('/api/platform/console/tenants/:slug', requirePlatformAdmin, wrap(async (req, res) => {
  if (req.body?.confirm !== req.params.slug) return res.status(400).json({ error: 'Confirmation : retaper le slug du tenant.' });
  await registry().deleteTenant(req.params.slug);
  if (backend().evict) backend().evict(req.params.slug);
  tenants.invalidate(req.params.slug);
  await registry().deleteSetting(`invites:${req.params.slug}`).catch(() => {});
  await activity.forget(req.params.slug);
  await consoleLog(req, 'tenant.deleted', { slug: req.params.slug });
  res.json({ ok: true });
}));

platform.get('/api/platform/console/tenants/:slug/members', requirePlatformAdmin, wrap(async (req, res) => {
  res.json(await registry().listMembers(req.params.slug));
}));

// Support : changer un rôle, retirer un membre, réinitialiser un mot de passe.
platform.put('/api/platform/console/tenants/:slug/members/:uid', requirePlatformAdmin, wrap(async (req, res) => {
  const list = await registry().listMembers(req.params.slug);
  const m = list.find(x => x.user_id === req.params.uid);
  if (!m) return res.status(404).json({ error: 'Membre inconnu' });
  const role = req.body?.role;
  if (!accounts.ROLES.includes(role)) return res.status(400).json({ error: 'Rôle invalide.' });
  if (m.role === 'owner' && role !== 'owner' && list.filter(x => x.role === 'owner').length < 2)
    return res.status(400).json({ error: "L'organisation doit garder au moins un propriétaire." });
  await registry().upsertMember({ ...m, role });
  forgetMember(m.user_id, req.params.slug);
  await activity.log(req.params.slug, `console:${req.account.email}`, 'member.role', { email: m.email, from: m.role, to: role });
  await consoleLog(req, 'member.role', { slug: req.params.slug, email: m.email, to: role });
  res.json({ ok: true });
}));
platform.delete('/api/platform/console/tenants/:slug/members/:uid', requirePlatformAdmin, wrap(async (req, res) => {
  const list = await registry().listMembers(req.params.slug);
  const m = list.find(x => x.user_id === req.params.uid);
  if (!m) return res.status(404).json({ error: 'Membre inconnu' });
  if (m.role === 'owner' && list.filter(x => x.role === 'owner').length < 2)
    return res.status(400).json({ error: "L'organisation doit garder au moins un propriétaire." });
  await registry().deleteMember(m.user_id, req.params.slug);
  forgetMember(m.user_id, req.params.slug);
  await activity.log(req.params.slug, `console:${req.account.email}`, 'member.removed', { email: m.email });
  await consoleLog(req, 'member.removed', { slug: req.params.slug, email: m.email });
  res.json({ ok: true });
}));
platform.post('/api/platform/console/tenants/:slug/members/:uid/reset-password', requirePlatformAdmin, wrap(async (req, res) => {
  const m = (await registry().listMembers(req.params.slug)).find(x => x.user_id === req.params.uid);
  if (!m) return res.status(404).json({ error: 'Membre inconnu' });
  const pw = accounts.tempPassword();
  await accounts.provider().setPassword(m.user_id, pw);
  await consoleLog(req, 'member.password_reset', { slug: req.params.slug, email: m.email });
  res.json({ ok: true, temp_password: pw, email: m.email });
}));

// Invitation envoyée depuis la console (propriétaire d'un nouveau client…).
platform.post('/api/platform/console/tenants/:slug/invites', requirePlatformAdmin, wrap(async (req, res) => {
  const t = await registry().getTenant(req.params.slug);
  if (!t) return res.status(404).json({ error: 'Organisation inconnue' });
  const email = accounts.normEmail(req.body?.email), role = req.body?.role || 'admin';
  if (!accounts.validEmail(email)) return res.status(400).json({ error: 'Email invalide.' });
  if (!accounts.ROLES.includes(role)) return res.status(400).json({ error: 'Rôle invalide.' });
  const [members, inv] = await Promise.all([registry().listMembers(t.slug), invites.listInvites(t.slug)]);
  if (!inv.some(i => i.email === email)) billing.assertSeat(t, members, inv, role);
  const r = await invites.createInvite(t.slug, { email, role, invited_by: `console:${req.account.email}` });
  await consoleLog(req, 'invite.sent', { slug: t.slug, email, role });
  res.status(201).json({ ok: true, link: tenantUrl(req, t.slug, `/invite?t=${encodeURIComponent(r.token)}`), invite: publicInvite(r.invite) });
}));
platform.delete('/api/platform/console/tenants/:slug/invites/:id', requirePlatformAdmin, wrap(async (req, res) => {
  await invites.revokeInvite(req.params.slug, req.params.id);
  await consoleLog(req, 'invite.revoked', { slug: req.params.slug });
  res.json({ ok: true });
}));

// ── Administrateurs de la plateforme ──
async function adminEmails() { return (await registry().getSetting('platform_admin_emails')) || {}; }
platform.get('/api/platform/console/admins', requirePlatformAdmin, wrap(async (req, res) => {
  const [list, emails] = await Promise.all([registry().listPlatformAdmins(), adminEmails()]);
  if (!emails[req.account.id]) { emails[req.account.id] = req.account.email; await registry().setSetting('platform_admin_emails', emails); }
  res.json(list.map(a => ({ user_id: a.user_id, email: emails[a.user_id] || null, created_at: a.created_at || null, me: a.user_id === req.account.id })));
}));
platform.post('/api/platform/console/admins', requirePlatformAdmin, wrap(async (req, res) => {
  const email = accounts.normEmail(req.body?.email);
  if (!accounts.validEmail(email)) return res.status(400).json({ error: 'Email invalide.' });
  const p = accounts.provider();
  let user = await p.findByEmail(email), temp = null;
  if (!user) user = await p.createUser(email, temp = accounts.tempPassword());
  await registry().addPlatformAdmin(user.id);
  const emails = await adminEmails(); emails[user.id] = email; await registry().setSetting('platform_admin_emails', emails);
  await consoleLog(req, 'admin.added', { email });
  res.status(201).json({ ok: true, email, temp_password: temp });
}));
platform.delete('/api/platform/console/admins/:uid', requirePlatformAdmin, wrap(async (req, res) => {
  if (req.params.uid === req.account.id) return res.status(400).json({ error: 'Vous ne pouvez pas retirer votre propre accès.' });
  if ((await registry().countPlatformAdmins()) < 2) return res.status(400).json({ error: 'Il faut garder au moins un administrateur.' });
  await registry().removePlatformAdmin(req.params.uid);
  const emails = await adminEmails();
  await consoleLog(req, 'admin.removed', { email: emails[req.params.uid] || req.params.uid });
  res.json({ ok: true });
}));

platform.get('/api/platform/console/activity', requirePlatformAdmin, wrap(async (req, res) => {
  res.json(await activity.read(null, { limit: Number(req.query.limit) || 300 }));
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
  await activity.log(req.tenant.slug, u.email, 'auth.login', { role: m.role, ip: req.ip });
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

// ── Accepter une invitation (sans être connecté) ──
tenantRouter.get('/invite', (req, res) => res.sendFile(path.join(PLATFORM_DIR, 'invite.html')));
tenantRouter.get('/api/platform/invite', wrap(async (req, res) => {
  const inv = await invites.resolveToken(req.tenant.slug, req.query.t);
  if (!inv) return res.status(404).json({ error: 'Cette invitation a expiré ou a été révoquée. Demandez-en une nouvelle.' });
  const t = req.tenant;
  const exists = !!(await accounts.provider().findByEmail(inv.email));
  res.json({ email: inv.email, role: inv.role, role_label: roleLabel(inv.role), org: (t.branding && t.branding.name) || t.name,
    branding: t.branding || {}, invited_by: inv.invited_by, account_exists: exists, expires_at: inv.expires_at });
}));
tenantRouter.post('/api/platform/invite/accept', authLimiter, wrap(async (req, res) => {
  const b = req.body || {};
  const inv = await invites.resolveToken(req.tenant.slug, b.t);
  if (!inv) return res.status(404).json({ error: 'Cette invitation a expiré ou a été révoquée. Demandez-en une nouvelle.' });
  const p = accounts.provider();
  let user = await p.findByEmail(inv.email);
  if (user) {
    const ok = await p.signIn(inv.email, b.password);
    if (!ok) return res.status(401).json({ error: 'Mot de passe incorrect pour ce compte.' });
  } else {
    const e = accounts.validPassword(b.password);
    if (e) return res.status(400).json({ error: e });
    user = await p.createUser(inv.email, b.password);
  }
  const name = String(b.name || '').trim().slice(0, 80) || inv.person_name || null;
  const prev = (await registry().listMembers(req.tenant.slug)).find(m => m.user_id === user.id);
  await registry().upsertMember({ user_id: user.id, tenant: req.tenant.slug, role: prev ? prev.role : inv.role,
    person_name: (prev && prev.person_name) || name, email: inv.email });
  await invites.consume(req.tenant.slug, inv.id);
  forgetMember(user.id, req.tenant.slug);
  await activity.log(req.tenant.slug, inv.email, 'invite.accepted', { role: inv.role, invited_by: inv.invited_by });
  accounts.setAccountCookie(req, res, user, req.tenant.slug);
  res.json({ ok: true, url: '/' });
}));

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

const requireOwner = (req, res, next) => (req.account && req.account.role === 'owner' ? next()
  : res.status(403).json({ error: 'Réservé au propriétaire de l’organisation.' }));

const roleLabel = r => ({ owner: 'Propriétaire', admin: 'Administrateur', manager: 'Manager', agent: 'Membre', observer: 'Lecture seule' }[r] || r);
const publicInvite = i => ({ id: i.id, email: i.email, role: i.role, person_name: i.person_name, invited_by: i.invited_by, created_at: i.created_at, expires_at: i.expires_at });

async function orgState(slug) {
  const t = await registry().getTenant(slug);
  const [members, inv] = await Promise.all([registry().listMembers(slug), invites.listInvites(slug)]);
  return { t, members, inv };
}

// Vue d'ensemble de l'organisation pour l'écran Organisation.
tenantRouter.get('/api/platform/org', requireOrgAdmin, wrap(async (req, res) => {
  const { t, members, inv } = await orgState(req.tenant.slug);
  res.json({ tenant: publicTenant(t), billing: billing.summary(t, members, inv), members, invites: inv.map(publicInvite),
    me: req.account, can_billing: req.account.role === 'owner' });
}));

tenantRouter.get('/api/platform/members', requireOrgAdmin, wrap(async (req, res) => {
  res.json(await registry().listMembers(req.tenant.slug));
}));

// Ajout direct (compte créé avec mot de passe provisoire). L'écran passe
// plutôt par les invitations ; cette route reste pour les scripts.
tenantRouter.post('/api/platform/members', requireOrgAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  if (!accounts.validEmail(b.email)) return res.status(400).json({ error: 'Email invalide.' });
  if (!accounts.ROLES.includes(b.role) || b.role === 'owner' && req.account.role !== 'owner')
    return res.status(400).json({ error: 'Rôle invalide.' });
  const { t, members, inv } = await orgState(req.tenant.slug);
  const p = accounts.provider();
  let user = await p.findByEmail(b.email), temp = null;
  const existing = user && members.find(m => m.user_id === user.id);
  if (!existing) billing.assertSeat(t, members, inv, b.role);
  if (!user) user = await p.createUser(b.email, temp = accounts.tempPassword());
  await registry().upsertMember({ user_id: user.id, tenant: req.tenant.slug, role: b.role,
    person_name: String(b.person_name || '').trim().slice(0, 80) || null, email: accounts.normEmail(b.email) });
  forgetMember(user.id, req.tenant.slug);
  require('../core/audit').addAudit('access', user.email, req.account.email, 'member-invite', { role: b.role });
  await activity.log(req.tenant.slug, req.account.email, 'member.added', { email: user.email, role: b.role });
  res.status(201).json({ ok: true, user_id: user.id, email: user.email, temp_password: temp });
}));

tenantRouter.put('/api/platform/members/:uid', requireOrgAdmin, wrap(async (req, res) => {
  const { t, members: list, inv } = await orgState(req.tenant.slug);
  const m = list.find(x => x.user_id === req.params.uid);
  if (!m) return res.status(404).json({ error: 'Membre inconnu' });
  const role = req.body?.role || m.role;
  if (!accounts.ROLES.includes(role)) return res.status(400).json({ error: 'Rôle invalide.' });
  if ((role === 'owner' || m.role === 'owner') && req.account.role !== 'owner')
    return res.status(403).json({ error: 'Seul le propriétaire gère le rôle propriétaire.' });
  if (m.role === 'owner' && role !== 'owner' && list.filter(x => x.role === 'owner').length < 2)
    return res.status(400).json({ error: "L'organisation doit garder au moins un propriétaire." });
  if (!billing.PAID_ROLES.includes(m.role)) billing.assertSeat(t, list, inv, role);
  await registry().upsertMember({ ...m, role, person_name: req.body?.person_name !== undefined ? (String(req.body.person_name || '').trim().slice(0, 80) || null) : m.person_name });
  forgetMember(m.user_id, req.tenant.slug);
  if (role !== m.role) await activity.log(req.tenant.slug, req.account.email, 'member.role', { email: m.email, from: m.role, to: role });
  res.json({ ok: true });
}));

tenantRouter.delete('/api/platform/members/:uid', requireOrgAdmin, wrap(async (req, res) => {
  const list = await registry().listMembers(req.tenant.slug);
  const m = list.find(x => x.user_id === req.params.uid);
  if (!m) return res.status(404).json({ error: 'Membre inconnu' });
  if (m.role === 'owner' && req.account.role !== 'owner') return res.status(403).json({ error: 'Seul le propriétaire peut retirer un propriétaire.' });
  if (m.role === 'owner' && list.filter(x => x.role === 'owner').length < 2)
    return res.status(400).json({ error: "L'organisation doit garder au moins un propriétaire." });
  await registry().deleteMember(m.user_id, req.tenant.slug);
  forgetMember(m.user_id, req.tenant.slug);
  await activity.log(req.tenant.slug, req.account.email, 'member.removed', { email: m.email, role: m.role });
  res.json({ ok: true });
}));

// ── Invitations ──
function inviteLink(req, token) { return tenantUrl(req, req.tenant.slug, `/invite?t=${encodeURIComponent(token)}`); }

tenantRouter.get('/api/platform/invites', requireOrgAdmin, wrap(async (req, res) => {
  res.json((await invites.listInvites(req.tenant.slug)).map(publicInvite));
}));

// Une ou plusieurs adresses (séparées par virgules, espaces ou retours).
tenantRouter.post('/api/platform/invites', requireOrgAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  const role = b.role || 'agent';
  if (!accounts.ROLES.includes(role) || role === 'owner' && req.account.role !== 'owner') return res.status(400).json({ error: 'Rôle invalide.' });
  const emails = [...new Set(String(Array.isArray(b.emails) ? b.emails.join(',') : (b.emails || b.email || ''))
    .split(/[\s,;]+/).map(accounts.normEmail).filter(Boolean))];
  if (!emails.length) return res.status(400).json({ error: 'Indiquez au moins une adresse email.' });
  if (emails.length > 100) return res.status(400).json({ error: '100 invitations au plus à la fois.' });
  const bad = emails.filter(e => !accounts.validEmail(e));
  if (bad.length) return res.status(400).json({ error: `Adresse invalide : ${bad.join(', ')}` });
  const { t, members, inv } = await orgState(req.tenant.slug);
  const memberEmails = new Set(members.map(m => accounts.normEmail(m.email)));
  const already = emails.filter(e => memberEmails.has(e));
  const todo = emails.filter(e => !memberEmails.has(e));
  const newOnes = todo.filter(e => !inv.some(i => i.email === e));
  billing.assertSeat(t, members, inv, role, newOnes.length);
  const orgName = (t.branding && t.branding.name) || t.name;
  const out = [];
  for (const email of todo) {
    const r = await invites.createInvite(req.tenant.slug, { email, role, person_name: todo.length === 1 ? b.person_name : null, invited_by: req.account.email });
    const link = inviteLink(req, r.token);
    const mailed = b.send_email === false ? false : await invites.sendInviteMail({ to: email, orgName, link, role: roleLabel(role), by: req.account.person_name || req.account.email });
    out.push({ ...publicInvite(r.invite), link, mailed });
  }
  if (out.length) await activity.log(req.tenant.slug, req.account.email, 'invite.sent', { emails: todo, role });
  res.status(201).json({ ok: true, invites: out, already_members: already });
}));

tenantRouter.post('/api/platform/invites/:id/renew', requireOrgAdmin, wrap(async (req, res) => {
  const r = await invites.renewInvite(req.tenant.slug, req.params.id);
  await activity.log(req.tenant.slug, req.account.email, 'invite.renewed', { email: r.invite.email });
  res.json({ ok: true, invite: { ...publicInvite(r.invite), link: inviteLink(req, r.token) } });
}));

tenantRouter.delete('/api/platform/invites/:id', requireOrgAdmin, wrap(async (req, res) => {
  const inv = (await invites.listInvites(req.tenant.slug)).find(i => i.id === req.params.id);
  await invites.revokeInvite(req.tenant.slug, req.params.id);
  await activity.log(req.tenant.slug, req.account.email, 'invite.revoked', { email: inv && inv.email });
  res.json({ ok: true });
}));

// ── Abonnement ──
tenantRouter.get('/api/platform/billing', requireOrgAdmin, wrap(async (req, res) => {
  const { t, members, inv } = await orgState(req.tenant.slug);
  res.json(billing.summary(t, members, inv));
}));

tenantRouter.put('/api/platform/billing', requireOwner, wrap(async (req, res) => {
  const { t, members, inv } = await orgState(req.tenant.slug);
  const r = billing.applyChange(t, members, inv, req.body || {}, req.account.email);
  if (r.changed.length) {
    await registry().updateTenant(req.tenant.slug, { billing: r.billing, plan: r.billing.plan });
    tenants.invalidate(req.tenant.slug);
    await activity.log(req.tenant.slug, req.account.email, 'billing.changed', r.entry);
  }
  const t2 = await registry().getTenant(req.tenant.slug);
  res.json({ ok: true, billing: billing.summary(t2, members, inv) });
}));

// ── Journal d'activité ──
tenantRouter.get('/api/platform/activity', requireOrgAdmin, wrap(async (req, res) => {
  res.json(await activity.read(req.tenant.slug, { limit: Number(req.query.limit) || 300, action: req.query.action || undefined }));
}));

// Marque blanche : nom affiché, couleurs, logo.
tenantRouter.put('/api/platform/branding', requireOrgAdmin, wrap(async (req, res) => {
  const branding = cleanBranding(req.body || {}, req.tenant.name);
  const t = await registry().updateTenant(req.tenant.slug, { branding });
  tenants.invalidate(req.tenant.slug);
  await activity.log(req.tenant.slug, req.account.email, 'org.branding', { name: branding.name, logo: !!branding.logo });
  res.json({ ok: true, branding: t.branding });
}));

// Modules actifs (le propriétaire peut en retirer ou en ajouter).
tenantRouter.put('/api/platform/modules', requireOrgAdmin, wrap(async (req, res) => {
  const v = validateModules(req.body?.modules);
  if (!v.ok) return res.status(400).json({ error: v.error });
  await registry().updateTenant(req.tenant.slug, { modules: v.modules });
  tenants.invalidate(req.tenant.slug);
  await activity.log(req.tenant.slug, req.account.email, 'org.modules', { modules: v.modules });
  res.json({ ok: true, modules: v.modules });
}));

router.use((req, res, next) => (req.tenant ? tenantRouter(req, res, next) : next()));

module.exports = router;
