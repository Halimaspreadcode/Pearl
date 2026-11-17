// SaaS multi-tenant de bout en bout (stockage fichiers, comptes locaux) :
// mise en service, isolation des données, comptes et rôles, sessions
// d'une organisation refusées sur une autre, modules désactivés.
const { useTempDataDir } = require('./helpers/data-dir');
process.env.MULTI_TENANT = '1';
process.env.PEARL_TENANT_HEADER = '1';
process.env.PEARL_BASE_DOMAIN = 'pearl.test';
process.env.PEARL_SESSION_SECRET = 'test-secret';
process.env.AUTH_PROVIDER = 'local';
process.env.PEARL_PLATFORM_ADMIN_EMAILS = 'root@pearl.test';
delete process.env.CONFIG_PW_HASH;
delete process.env.TEAM_PW_HASH;
delete process.env.STORE;
useTempDataDir({});

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/app');
const { provisionTenant } = require('../server/platform/provision');
const { parseHost } = require('../server/platform/tenants');
const accounts = require('../server/platform/accounts');

let srv, base;
const cookiesOf = r => (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || ''])
  .map(c => c.split(';')[0]).filter(Boolean).join('; ');
const T = (slug, extra = {}) => ({ 'X-Pearl-Tenant': slug, 'Content-Type': 'application/json', ...extra });

before(async () => {
  await provisionTenant({ name: 'Acme Support', slug: 'acme', pack: 'support-it',
    sites: [{ code: 'LYO', name: 'Lyon' }, { code: 'PAR', name: 'Paris' }],
    owner: { email: 'boss@acme.test', password: 'motdepasse-acme', name: 'Alice Boss' } });
  await provisionTenant({ name: 'Globex', slug: 'globex', pack: 'generic',
    modules: ['core', 'tickets'],
    owner: { email: 'boss@globex.test', password: 'motdepasse-globex', name: 'Bob Globex' } });
  await accounts.provider().createUser('root@pearl.test', 'motdepasse-root');
  const app = createApp();
  await new Promise(r => { srv = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => srv.close());

async function login(slug, email, password) {
  const r = await fetch(`${base}/api/team/account-login`, { method: 'POST', headers: T(slug), body: JSON.stringify({ email, password }) });
  return { r, cookie: cookiesOf(r), body: await r.json() };
}

test('résolution par hôte : sous-domaine, domaine nu, domaine perso, réservé', () => {
  assert.deepEqual(parseHost('acme.pearl.test'), { kind: 'slug', slug: 'acme' });
  assert.deepEqual(parseHost('pearl.test'), { kind: 'platform' });
  assert.deepEqual(parseHost('www.pearl.test'), { kind: 'platform' });
  assert.deepEqual(parseHost('console.pearl.test'), { kind: 'platform' });
  assert.deepEqual(parseHost('ops.client.com'), { kind: 'domain', host: 'ops.client.com' });
});

test('mise en service : sites et configuration du pack, slug réservé ou pris refusé', async () => {
  await assert.rejects(provisionTenant({ name: 'Xyz Corp', slug: 'acme' }), /déjà prise/);
  await assert.rejects(provisionTenant({ name: 'Xyz Corp', slug: 'console' }), /réservée/);
  await assert.rejects(provisionTenant({ name: 'Xyz Corp', slug: 'Bad Slug' }), /invalide/);
  const { cookie } = await login('acme', 'boss@acme.test', 'motdepasse-acme');
  const sites = await (await fetch(`${base}/api/sites`, { headers: T('acme', { cookie }) })).json();
  assert.deepEqual(sites.map(s => s.code), ['LYO', 'PAR']);
});

test('sans connexion, les données d\'une organisation sont fermées', async () => {
  const r = await fetch(`${base}/api/tickets`, { headers: T('acme') });
  assert.equal(r.status, 401);
  const inconnu = await fetch(`${base}/api/tickets`, { headers: T('nobody') });
  assert.equal(inconnu.status, 404);
});

test('compte : connexion, ouverture des sessions, identité signée', async () => {
  const bad = await login('acme', 'boss@acme.test', 'mauvais-mot-de-passe');
  assert.equal(bad.r.status, 401);
  const { r, cookie, body } = await login('acme', 'boss@acme.test', 'motdepasse-acme');
  assert.equal(r.status, 200);
  assert.equal(body.role, 'owner');
  const me = await (await fetch(`${base}/api/platform/me`, { headers: T('acme', { cookie }) })).json();
  assert.equal(me.tenant.slug, 'acme');
  assert.equal(me.account.role, 'owner');
  const t = await fetch(`${base}/api/tickets/lyo`, { method: 'POST', headers: T('acme', { cookie }),
    body: JSON.stringify({ title: 'Panne', type: 'Incident', priority: 'P1', status: 'Open', occur_time: new Date().toISOString(), modified_by: 'quelqu’un d’autre' }) });
  assert.equal(t.status, 201);
});

test('isolation : un compte d\'une organisation n\'ouvre rien chez une autre', async () => {
  const acme = await login('acme', 'boss@acme.test', 'motdepasse-acme');
  // Même identifiants, autre organisation : pas membre.
  const x = await login('globex', 'boss@acme.test', 'motdepasse-acme');
  assert.equal(x.r.status, 401);
  // Cookies d'Acme présentés à Globex : aucune session reconnue.
  const r = await fetch(`${base}/api/tickets`, { headers: T('globex', { cookie: acme.cookie }) });
  assert.equal(r.status, 401);
  // Et les tickets d'Acme ne sont pas chez Globex.
  const g = await login('globex', 'boss@globex.test', 'motdepasse-globex');
  const gt = await (await fetch(`${base}/api/tickets`, { headers: T('globex', { cookie: g.cookie }) })).json();
  assert.deepEqual(gt.sites.map(s => s.code), ['HQ']);
  assert.equal(Object.values(gt.tickets).flat().length, 0);
  const at = await (await fetch(`${base}/api/tickets`, { headers: T('acme', { cookie: acme.cookie }) })).json();
  assert.equal(at.tickets.LYO.length, 1);
});

test('modules : une route d\'un module non activé n\'existe pas', async () => {
  const g = await login('globex', 'boss@globex.test', 'motdepasse-globex');
  const abs = await fetch(`${base}/api/absences`, { headers: T('globex', { cookie: g.cookie }) });
  assert.equal(abs.status, 404);
  const me = await (await fetch(`${base}/api/platform/me`, { headers: T('globex', { cookie: g.cookie }) })).json();
  assert.deepEqual(me.modules, ['core', 'tickets']);
  assert.ok(!me.pages.includes('absences'));
});

test('membres : invitation avec mot de passe provisoire, rôle agent, dernier propriétaire protégé', async () => {
  const o = await login('acme', 'boss@acme.test', 'motdepasse-acme');
  const inv = await fetch(`${base}/api/platform/members`, { method: 'POST', headers: T('acme', { cookie: o.cookie }),
    body: JSON.stringify({ email: 'agent@acme.test', role: 'agent', person_name: 'Carla Agent' }) });
  assert.equal(inv.status, 201);
  const { temp_password, user_id } = await inv.json();
  assert.ok(temp_password && temp_password.length >= 12);
  const a = await login('acme', 'agent@acme.test', temp_password);
  assert.equal(a.body.role, 'agent');
  // Un agent n'administre pas les membres.
  const list = await fetch(`${base}/api/platform/members`, { headers: T('acme', { cookie: a.cookie }) });
  assert.equal(list.status, 403);
  // Le dernier propriétaire ne peut pas être rétrogradé.
  const members = await (await fetch(`${base}/api/platform/members`, { headers: T('acme', { cookie: o.cookie }) })).json();
  const owner = members.find(m => m.role === 'owner');
  const demote = await fetch(`${base}/api/platform/members/${owner.user_id}`, { method: 'PUT', headers: T('acme', { cookie: o.cookie }), body: JSON.stringify({ role: 'admin' }) });
  assert.equal(demote.status, 400);
  assert.ok(user_id);
});

test('plateforme : inscription en libre-service puis transfert de session', async () => {
  const host = { 'Content-Type': 'application/json' };   // domaine nu (127.0.0.1)
  const packs = await (await fetch(`${base}/api/platform/packs`, { headers: host })).json();
  assert.ok(packs.some(p => p.id === 'call-center'));
  const avail = await (await fetch(`${base}/api/platform/slug?name=Initech%20Ops`, { headers: host })).json();
  assert.equal(avail.slug, 'initech-ops');
  assert.equal(avail.available, true);
  const r = await fetch(`${base}/api/platform/signup`, { method: 'POST', headers: host, body: JSON.stringify({
    org_name: 'Initech Ops', pack: 'call-center', email: 'ceo@initech.test', password: 'motdepasse-initech', full_name: 'Bill' }) });
  assert.equal(r.status, 201);
  const j = await r.json();
  assert.equal(j.tenant.slug, 'initech-ops');
  const t = new URL(j.url).searchParams.get('t');
  const h = await fetch(`${base}/auth/handoff?t=${encodeURIComponent(t)}`, { headers: { 'X-Pearl-Tenant': 'initech-ops' }, redirect: 'manual' });
  assert.equal(h.status, 302);
  const me = await (await fetch(`${base}/api/platform/me`, { headers: T('initech-ops', { cookie: cookiesOf(h) }) })).json();
  assert.equal(me.account.role, 'owner');
  // Le jeton de transfert ne vaut que pour son organisation.
  const h2 = await fetch(`${base}/auth/handoff?t=${encodeURIComponent(t)}`, { headers: { 'X-Pearl-Tenant': 'acme' }, redirect: 'manual' });
  assert.ok(!cookiesOf(h2).includes('pearl_account'));
});

test('console : réservée aux administrateurs de la plateforme, suspension effective', async () => {
  const host = { 'Content-Type': 'application/json' };
  const refus = await fetch(`${base}/api/platform/console/login`, { method: 'POST', headers: host, body: JSON.stringify({ email: 'boss@acme.test', password: 'motdepasse-acme' }) });
  assert.equal(refus.status, 401);
  const ok = await fetch(`${base}/api/platform/console/login`, { method: 'POST', headers: host, body: JSON.stringify({ email: 'root@pearl.test', password: 'motdepasse-root' }) });
  assert.equal(ok.status, 200);
  const cookie = cookiesOf(ok);
  const list = await (await fetch(`${base}/api/platform/console/tenants`, { headers: { ...host, cookie } })).json();
  assert.deepEqual(list.map(t => t.slug).sort(), ['acme', 'globex', 'initech-ops']);
  const sus = await fetch(`${base}/api/platform/console/tenants/globex`, { method: 'PATCH', headers: { ...host, cookie }, body: JSON.stringify({ status: 'suspended' }) });
  assert.equal(sus.status, 200);
  const r = await fetch(`${base}/api/platform/brand`, { headers: T('globex') });
  assert.equal(r.status, 402);
  // Une session de console n'ouvre aucune organisation.
  const x = await fetch(`${base}/api/tickets`, { headers: T('acme', { cookie }) });
  assert.equal(x.status, 401);
});
