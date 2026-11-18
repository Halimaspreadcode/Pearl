// Tableau de bord composable : modèle du métier, indicateurs business,
// disposition de l'organisation puis personnelle.
const { useTempDataDir } = require('./helpers/data-dir');
process.env.MULTI_TENANT = '1';
process.env.PEARL_TENANT_URLS = 'path';
process.env.PEARL_BASE_DOMAIN = 'pear-demo.vercel.app';
process.env.PEARL_SESSION_SECRET = 'test';
process.env.AUTH_PROVIDER = 'local';
delete process.env.STORE;
useTempDataDir({});

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/app');
const { provisionTenant } = require('../server/platform/provision');

let srv, base, owner, agent;
const cookiesOf = r => r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
const j = (cookie, method, body) => ({ method, headers: { cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
async function login(email, password) {
  const org = cookiesOf(await fetch(`${base}/o/shop`, { redirect: 'manual' }));
  const r = await fetch(`${base}/api/team/account-login`, j(org, 'POST', { email, password }));
  assert.equal(r.status, 200);
  return `${org}; ${cookiesOf(r)}`;
}

before(async () => {
  await provisionTenant({ name: 'Shop', slug: 'shop', pack: 'retail-network', owner: { email: 'own@shop.test', password: 'motdepasse-shop' } });
  const app = createApp();
  await new Promise(r => { srv = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${srv.address().port}`;
  owner = await login('own@shop.test', 'motdepasse-shop');
  await fetch(`${base}/api/platform/members`, j(owner, 'POST', { email: 'ana@shop.test', role: 'agent' })).then(r => r.json()).then(async x => {
    const { registry } = require('../server/core/backend');
    const accounts = require('../server/platform/accounts');
    await accounts.provider().setPassword(x.user_id, 'motdepasse-ana');
    void registry;
  });
  agent = await login('ana@shop.test', 'motdepasse-ana');
});
after(() => srv.close());

test('premier accès : indicateurs du métier et disposition proposée', async () => {
  const h = await (await fetch(`${base}/api/home`, { headers: { cookie: owner } })).json();
  assert.ok(h.metrics.some(m => m.label === "Chiffre d'affaires"));
  assert.equal(h.source, 'default');
  assert.ok(h.layout.some(x => x.w === 'metric'));
  assert.ok(h.catalog.some(c => c.type === 'tickets'));
  assert.equal(h.can_edit_org, true);
});

test('valeurs saisies : cumul de la période, cible, série', async () => {
  const h = await (await fetch(`${base}/api/home`, { headers: { cookie: owner } })).json();
  const ca = h.metrics.find(m => m.label === "Chiffre d'affaires");
  const today = new Date().toISOString().slice(0, 10);
  assert.equal((await fetch(`${base}/api/home/metrics/${ca.id}/entries`, j(owner, 'POST', { entries: [{ date: today, value: 1200 }, { date: 'x', value: 1 }] }))).status, 200);
  await fetch(`${base}/api/home/metrics/${ca.id}`, j(owner, 'PUT', { target: 2400 }));
  const h2 = await (await fetch(`${base}/api/home`, { headers: { cookie: owner } })).json();
  const m = h2.metrics.find(x => x.id === ca.id);
  assert.equal(m.value, 1200);
  assert.equal(m.progress, 50);
  assert.equal(m.series.length, 12);
  // Un membre ne saisit pas de valeurs business.
  assert.equal((await fetch(`${base}/api/home/metrics/${ca.id}/entries`, j(agent, 'POST', { entries: [{ date: today, value: 1 }] }))).status, 403);
});

test("disposition de l'organisation, puis personnelle, puis retour", async () => {
  assert.equal((await fetch(`${base}/api/home/layout`, j(agent, 'PUT', { scope: 'org', layout: [] }))).status, 403);
  const org = [{ w: 'note', size: 'l', title: 'Cap du trimestre', text: '+10 % de CA' }, { w: 'team-today', size: 's' }, { w: 'inconnu' }];
  const r = await (await fetch(`${base}/api/home/layout`, j(owner, 'PUT', { scope: 'org', layout: org }))).json();
  assert.equal(r.layout.length, 2);
  let a = await (await fetch(`${base}/api/home`, { headers: { cookie: agent } })).json();
  assert.equal(a.source, 'org');
  assert.equal(a.layout[0].title, 'Cap du trimestre');
  await fetch(`${base}/api/home/layout`, j(agent, 'PUT', { scope: 'me', layout: [{ w: 'team-today', size: 'm' }] }));
  a = await (await fetch(`${base}/api/home`, { headers: { cookie: agent } })).json();
  assert.equal(a.source, 'user');
  assert.equal(a.layout.length, 1);
  await fetch(`${base}/api/home/layout?scope=me`, { method: 'DELETE', headers: { cookie: agent } });
  a = await (await fetch(`${base}/api/home`, { headers: { cookie: agent } })).json();
  assert.equal(a.source, 'org');
});
