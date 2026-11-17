// ══════════════════════════════════════════════════════════════
// MISE EN SERVICE D'UNE ORGANISATION
//
// Un seul mécanisme pour les trois chemins : console super-admin,
// `npm run tenant:create`, inscription en libre-service.
//   1. registre : le tenant (slug, nom, pack, modules, marque, essai) ;
//   2. données : configuration de départ tirée du pack (domaines, statuts,
//      SLA, sites…) ;
//   3. compte propriétaire : créé (ou retrouvé) et rattaché en « owner ».
// En cas d'échec après l'étape 1, le tenant est retiré : pas de demi-tenant.
// ══════════════════════════════════════════════════════════════
const fs   = require('fs');
const path = require('path');
const { SLUG_RE, runAsTenant } = require('../core/tenant');
const { backend, registry } = require('../core/backend');
const { validateModules } = require('./modules');
const { isReservedSlug, invalidate } = require('./tenants');
const accounts = require('./accounts');

const PACKS_DIR = path.join(__dirname, 'packs');
const TRIAL_DAYS = Number(process.env.PEARL_TRIAL_DAYS || 14);

function listPacks() {
  return fs.readdirSync(PACKS_DIR).filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(PACKS_DIR, f), 'utf8')))
    .sort((a, b) => (a.id === 'generic') - (b.id === 'generic') || a.label.localeCompare(b.label));
}
function getPack(id) {
  const p = listPacks().find(x => x.id === (id || 'generic'));
  if (!p) throw Object.assign(new Error(`Pack inconnu : ${id}`), { status: 400 });
  return p;
}

const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

// Slug proposé à partir d'un nom d'organisation.
function slugify(name) {
  return String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'org';
}

const HEX = /^#[0-9a-f]{6}$/i;
function cleanBranding(b = {}, name = '') {
  const out = {};
  out.name = clip(b.name || name, 60);
  if (HEX.test(b.primary || '')) out.primary = b.primary;
  if (HEX.test(b.accent || '')) out.accent = b.accent;
  // Logo : URL https ou image en data: (≤ 200 Ko), affichée telle quelle.
  const logo = String(b.logo || '');
  if (/^https:\/\/[^\s"'<>]+$/.test(logo) && logo.length <= 2048) out.logo = logo;
  else if (/^data:image\/(png|svg\+xml|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo) && logo.length <= 200 * 1024) out.logo = logo;
  if (b.tagline) out.tagline = clip(b.tagline, 80);
  if (b.mail_from_name) out.mail_from_name = clip(b.mail_from_name, 60);
  return out;
}

function cleanSites(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).map(s => ({
    code: clip(s && s.code, 8).toUpperCase(),
    name: clip(s && s.name, 60),
    city: clip(s && s.city, 60),
    country: clip(s && s.country, 60),
    tz: clip(s && s.tz, 60),
  })).filter(s => /^[A-Z0-9]{2,8}$/.test(s.code) && !seen.has(s.code) && seen.add(s.code)).slice(0, 50);
}

async function provisionTenant(input = {}) {
  const name = clip(input.name, 80);
  if (name.length < 2) throw err("Nom d'organisation trop court.");
  const slug = String(input.slug || slugify(name)).toLowerCase();
  if (!SLUG_RE.test(slug)) throw err('Adresse invalide : lettres minuscules, chiffres et tirets, 2 à 40 caractères.');
  if (isReservedSlug(slug)) throw err('Cette adresse est réservée.');
  const pack = getPack(input.pack);
  const mods = validateModules(input.modules && input.modules.length ? input.modules : pack.modules);
  if (!mods.ok) throw err(mods.error);
  const sites = cleanSites(input.sites && input.sites.length ? input.sites : pack.sites);
  if (!sites.length) throw err('Au moins un site est nécessaire.');

  const owner = input.owner || null;
  if (owner) {
    if (!accounts.validEmail(owner.email)) throw err('Email invalide.');
    if (owner.password) { const e = accounts.validPassword(owner.password); if (e) throw err(e); }
  }

  const reg = registry();
  if (await reg.getTenant(slug)) throw err('Cette adresse est déjà prise.', 409);

  const trialEnds = new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString();
  const tenant = await reg.insertTenant({
    slug, name, status: input.status || 'trial', plan: input.plan || 'trial', pack: pack.id,
    modules: mods.modules, branding: cleanBranding(input.branding, name), domains: [],
    billing: {}, trial_ends_at: (input.status || 'trial') === 'trial' ? trialEnds : null,
  });

  try {
    await backend().ensureTenant(slug);
    await runAsTenant(slug, async () => {
      const store = require('../core/store');
      const { FILES } = require('../config/paths');
      const cfg = {
        ...store.readCfg(),
        ...pack.config,
        sites,
        fo_list: [],
        org_name: name,
      };
      store.writeCfg(cfg);
      for (const s of sites) if (!store.docExists(require('../config/paths').siteFile(s.code))) store.writeTracker(s.code, []);
      if (!store.docExists(FILES.observations)) store.writeObs([]);
      if (!store.docExists(FILES.audit)) store.writeAudit([]);
      store.initTenant();
      require('../core/audit').addAudit('platform', slug, owner ? accounts.normEmail(owner.email) : 'system', 'tenant-created', { pack: pack.id });
    });
    await backend().flush();

    let user = null, tempPassword = null;
    if (owner) {
      const p = accounts.provider();
      user = await p.findByEmail(owner.email);
      if (!user) {
        const pw = owner.password || (tempPassword = accounts.tempPassword());
        user = await p.createUser(owner.email, pw);
      }
      await reg.upsertMember({ user_id: user.id, tenant: slug, role: 'owner',
        person_name: clip(owner.name, 80) || null, email: accounts.normEmail(owner.email) });
    }
    invalidate(slug);
    return { tenant, owner: user, tempPassword };
  } catch (e) {
    try { await reg.deleteTenant(slug); } catch {}
    if (backend().evict) backend().evict(slug);
    invalidate(slug);
    throw e;
  }
}

module.exports = { provisionTenant, listPacks, getPack, slugify, cleanBranding, cleanSites, TRIAL_DAYS };
