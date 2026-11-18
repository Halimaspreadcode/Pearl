// Déploiement sans sous-domaines (Vercel) : espaces en /o/<slug>, page
// d'accueil de la plateforme, installation de la console par code unique,
// configuration déduite des variables de l'hébergement.
const { useTempDataDir } = require('./helpers/data-dir');
process.env.MULTI_TENANT = '1';
process.env.PEARL_TENANT_URLS = 'path';
process.env.PEARL_BASE_DOMAIN = 'pearl-demo.vercel.app';
process.env.PEARL_SESSION_SECRET = 'test';
process.env.AUTH_PROVIDER = 'local';
process.env.PEARL_SETUP_CODE = 'CODE-TEST-1234';
delete process.env.STORE;
delete process.env.PEARL_PLATFORM_ADMIN_EMAILS;
useTempDataDir({});

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/app');
const { provisionTenant } = require('../server/platform/provision');

let srv, base;
const cookiesOf = r => r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');

before(async () => {
  await provisionTenant({ name: 'Acme', slug: 'acme', owner: { email: 'boss@acme.test', password: 'motdepasse-acme' } });
  const app = createApp();
  await new Promise(r => { srv = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => srv.close());

test('domaine nu : page d\'accueil de la plateforme, pas l\'application', async () => {
  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /Créer mon espace/);
});

test('/o/<slug> retient l\'organisation ; /signup et /console restent la plateforme', async () => {
  const r = await fetch(`${base}/o/acme`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  const cookie = cookiesOf(r);
  assert.match(cookie, /pearl_org=acme/);
  const brand = await (await fetch(`${base}/api/platform/brand`, { headers: { cookie } })).json();
  assert.equal(brand.name, 'Acme');
  assert.equal(brand.switch_url, '/o/-');
  assert.match(await (await fetch(`${base}/signup`, { headers: { cookie } })).text(), /Comment s'appelle votre équipe/);
  const inconnu = await fetch(`${base}/o/nexistepas`, { redirect: 'manual' });
  assert.equal(inconnu.status, 404);
  const sortie = await fetch(`${base}/o/-`, { headers: { cookie }, redirect: 'manual' });
  assert.match(sortie.headers.get('set-cookie') || '', /pearl_org=;/);
});

test('connexion par compte dans un espace choisi par /o/', async () => {
  const cookie = cookiesOf(await fetch(`${base}/o/acme`, { redirect: 'manual' }));
  const r = await fetch(`${base}/api/team/account-login`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'boss@acme.test', password: 'motdepasse-acme' }) });
  assert.equal(r.status, 200);
  const all = `${cookie}; ${cookiesOf(r)}`;
  assert.equal((await fetch(`${base}/api/tickets`, { headers: { cookie: all } })).status, 200);
});

test('console : installation par code unique, puis fermée', async () => {
  const st = await (await fetch(`${base}/api/platform/console/setup`)).json();
  assert.equal(st.open, true);
  const bad = await fetch(`${base}/api/platform/console/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'FAUX', email: 'root@pearl.test', password: 'motdepasse-root' }) });
  assert.equal(bad.status, 401);
  const ok = await fetch(`${base}/api/platform/console/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'CODE-TEST-1234', email: 'root@pearl.test', password: 'motdepasse-root' }) });
  assert.equal(ok.status, 200);
  const me = await fetch(`${base}/api/platform/console/me`, { headers: { cookie: cookiesOf(ok) } });
  assert.equal(me.status, 200);
  assert.equal((await (await fetch(`${base}/api/platform/console/setup`)).json()).open, false);
  const again = await fetch(`${base}/api/platform/console/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'CODE-TEST-1234', email: 'pirate@x.test', password: 'motdepasse-pirate' }) });
  assert.equal(again.status, 403);
});

test('configuration automatique : intégration Vercel ↔ Supabase', () => {
  const { applyRuntimeDefaults } = require('../server/config/runtime');
  const saved = { ...process.env };
  try {
    for (const k of ['STORE', 'MULTI_TENANT', 'DATA_DIR', 'PEARL_TENANT_URLS', 'SUPABASE_URL']) delete process.env[k];
    Object.assign(process.env, { VERCEL: '1', NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' });
    applyRuntimeDefaults();
    assert.equal(process.env.STORE, 'supabase');
    assert.equal(process.env.MULTI_TENANT, '1');
    assert.equal(process.env.DATA_DIR, '/tmp/pearl-data');
    assert.equal(process.env.PEARL_TENANT_URLS, 'path');
    assert.equal(process.env.SUPABASE_URL, 'https://x.supabase.co');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
