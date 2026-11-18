// Organisation SaaS : sièges, invitations par lien, abonnement, journal,
// console (indicateurs, sièges, membres, administrateurs).
const { useTempDataDir } = require('./helpers/data-dir');
process.env.MULTI_TENANT = '1';
process.env.PEARL_TENANT_URLS = 'path';
process.env.PEARL_BASE_DOMAIN = 'pear-demo.vercel.app';
process.env.PEARL_SESSION_SECRET = 'test';
process.env.AUTH_PROVIDER = 'local';
process.env.PEARL_SETUP_CODE = 'CODE-ORG-1234';
delete process.env.STORE;
delete process.env.PEARL_PLATFORM_ADMIN_EMAILS;
useTempDataDir({});

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/app');
const { provisionTenant } = require('../server/platform/provision');

let srv, base, owner, consoleCookie;
const cookiesOf = r => r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
const json = (cookie, method, body) => ({ method, headers: { cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

async function loginOrg(email, password) {
  const org = cookiesOf(await fetch(`${base}/o/beta`, { redirect: 'manual' }));
  const r = await fetch(`${base}/api/team/account-login`, json(org, 'POST', { email, password }));
  assert.equal(r.status, 200);
  return `${org}; ${cookiesOf(r)}`;
}

before(async () => {
  await provisionTenant({ name: 'Beta', slug: 'beta', owner: { email: 'own@beta.test', password: 'motdepasse-beta' } });
  const app = createApp();
  await new Promise(r => { srv = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${srv.address().port}`;
  owner = await loginOrg('own@beta.test', 'motdepasse-beta');
});
after(() => srv.close());

test('essai : 5 sièges, le propriétaire en occupe un', async () => {
  const b = await (await fetch(`${base}/api/platform/billing`, { headers: { cookie: owner } })).json();
  assert.equal(b.seats, 5);
  assert.equal(b.usage.used, 1);
  assert.ok(b.price.monthly > 0);
});

test('invitation par lien : acceptation, siège occupé, journal', async () => {
  const r = await fetch(`${base}/api/platform/invites`, json(owner, 'POST', { emails: 'ana@beta.test, leo@beta.test', role: 'agent' }));
  assert.equal(r.status, 201);
  const j = await r.json();
  assert.equal(j.invites.length, 2);
  const link = new URL(j.invites[0].link);
  assert.match(link.pathname, /^\/o\/beta\/invite$/);
  const t = link.searchParams.get('t');
  const org = cookiesOf(await fetch(`${base}/o/beta`, { redirect: 'manual' }));
  const info = await (await fetch(`${base}/api/platform/invite?t=${encodeURIComponent(t)}`, { headers: { cookie: org } })).json();
  assert.equal(info.email, 'ana@beta.test');
  assert.equal(info.account_exists, false);
  const page = await fetch(`${base}/invite?t=x`, { headers: { cookie: org } });
  assert.equal(page.status, 200);
  const acc = await fetch(`${base}/api/platform/invite/accept`, json(org, 'POST', { t, password: 'motdepasse-ana', name: 'Ana' }));
  assert.equal(acc.status, 200);
  const again = await fetch(`${base}/api/platform/invite/accept`, json(org, 'POST', { t, password: 'motdepasse-ana' }));
  assert.equal(again.status, 404);
  const o = await (await fetch(`${base}/api/platform/org`, { headers: { cookie: owner } })).json();
  assert.equal(o.members.length, 2);
  assert.equal(o.invites.length, 1);
  assert.equal(o.billing.usage.used, 3);
  const act = await (await fetch(`${base}/api/platform/activity`, { headers: { cookie: owner } })).json();
  assert.ok(act.some(e => e.action === 'invite.accepted'));
  // L'agent n'est pas administrateur.
  const ana = await loginOrg('ana@beta.test', 'motdepasse-ana');
  assert.equal((await fetch(`${base}/api/platform/org`, { headers: { cookie: ana } })).status, 403);
});

test('sièges : plafond, lecture seule gratuite, ajout de sièges', async () => {
  const trop = await fetch(`${base}/api/platform/invites`, json(owner, 'POST', { emails: 'a1@beta.test a2@beta.test a3@beta.test', role: 'agent' }));
  assert.equal(trop.status, 402);
  const obs = await fetch(`${base}/api/platform/invites`, json(owner, 'POST', { emails: 'o1@beta.test o2@beta.test o3@beta.test', role: 'observer' }));
  assert.equal(obs.status, 201);
  const bas = await fetch(`${base}/api/platform/billing`, json(owner, 'PUT', { seats: 2 }));
  assert.equal(bas.status, 400);
  const up = await (await fetch(`${base}/api/platform/billing`, json(owner, 'PUT', { seats: 12, plan: 'entreprise', interval: 'year' }))).json();
  assert.equal(up.billing.seats, 12);
  assert.equal(up.billing.plan, 'entreprise');
  assert.equal(up.billing.history.length, 1);
  assert.equal((await fetch(`${base}/api/platform/invites`, json(owner, 'POST', { emails: 'a1@beta.test a2@beta.test a3@beta.test', role: 'agent' }))).status, 201);
});

test('console : indicateurs, sièges et administrateurs', async () => {
  const ok = await fetch(`${base}/api/platform/console/setup`, json('', 'POST', { code: 'CODE-ORG-1234', email: 'root@pear.test', password: 'motdepasse-root' }));
  assert.equal(ok.status, 200);
  consoleCookie = cookiesOf(ok);
  const st = await (await fetch(`${base}/api/platform/console/stats`, { headers: { cookie: consoleCookie } })).json();
  assert.equal(st.tenants, 1);
  assert.equal(st.seats, 12);
  const p = await fetch(`${base}/api/platform/console/tenants/beta`, json(consoleCookie, 'PATCH', { seats: 20, status: 'active' }));
  assert.equal(p.status, 200);
  const d = await (await fetch(`${base}/api/platform/console/tenants/beta`, { headers: { cookie: consoleCookie } })).json();
  assert.equal(d.seats, 20);
  assert.ok(d.mrr > 0);
  assert.ok(d.member_list.length >= 2);
  const add = await (await fetch(`${base}/api/platform/console/admins`, json(consoleCookie, 'POST', { email: 'ops@pear.test' }))).json();
  assert.ok(add.temp_password);
  const admins = await (await fetch(`${base}/api/platform/console/admins`, { headers: { cookie: consoleCookie } })).json();
  assert.equal(admins.length, 2);
  const self = admins.find(a => a.me);
  assert.equal((await fetch(`${base}/api/platform/console/admins/${self.user_id}`, json(consoleCookie, 'DELETE'))).status, 400);
  const log = await (await fetch(`${base}/api/platform/console/activity`, { headers: { cookie: consoleCookie } })).json();
  assert.ok(log.some(e => e.action === 'admin.added'));
});
