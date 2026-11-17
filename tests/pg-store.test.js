// Stockage PostgreSQL (server/core/backend/pg.js + remote.js) et isolation
// par Row Level Security. Demande une base de test vide :
//   PEARL_TEST_PG_URL=postgres://postgres@localhost:54329/pearl_test npm test
// Sans elle, les tests sont ignorés.
const { useTempDataDir } = require('./helpers/data-dir');
const DIR = useTempDataDir({});
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');

const URL_PG = process.env.PEARL_TEST_PG_URL;
const skip = !URL_PG && 'PEARL_TEST_PG_URL non défini';
let adapter, backend;

before(async () => {
  if (skip) return;
  execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'db-migrate.js')], { env: { ...process.env, DATABASE_URL: URL_PG }, stdio: 'pipe' });
  adapter = require('../server/core/backend/pg').makePgAdapter({ connectionString: URL_PG });
  await adapter.query("delete from pearl_tenants where slug like 't-%'");
  await adapter.insertTenant({ slug: 't-a', name: 'A', modules: ['core'], branding: { name: 'A' } });
  await adapter.insertTenant({ slug: 't-b', name: 'B' });
  backend = require('../server/core/backend/remote').makeRemoteBackend({ kind: 'pg', adapter, dataDir: DIR, defaultTenant: 'default' });
});
after(async () => { if (adapter) { await adapter.query("delete from pearl_tenants where slug like 't-%'"); await adapter.end(); } });

test('documents : écriture en cache puis en base, relecture après rechargement', { skip }, async () => {
  await backend.ensureTenant('t-a');
  const f = path.join(DIR, 'tenants', 't-a', 'config.json');
  backend.writeText(f, JSON.stringify({ org_name: 'A', sites: [{ code: 'LYO' }] }));
  assert.equal(JSON.parse(backend.readText(f)).org_name, 'A');
  await backend.flush();
  backend.evict('t-a');
  await backend.ensureTenant('t-a');
  assert.deepEqual(JSON.parse(backend.readText(f)).sites, [{ code: 'LYO' }]);
  assert.deepEqual(backend.listDocs(path.join(DIR, 'tenants', 't-a')), ['config.json']);
});

test('lecture d\'un tenant non chargé : erreur explicite, jamais un autre tenant', { skip }, () => {
  assert.throws(() => backend.readText(path.join(DIR, 'tenants', 't-zzz', 'config.json')), /non chargées/);
});

test('RLS : le rôle applicatif ne voit et n\'écrit que le tenant posé', { skip }, async () => {
  await adapter.upsertDoc('t-b', 'secret.json', JSON.stringify({ b: true }));
  const vuParA = await adapter.scoped('t-a', c => c.query('select tenant, name from pearl_documents').then(r => r.rows));
  assert.ok(vuParA.length >= 1);
  assert.ok(vuParA.every(r => r.tenant === 't-a'));
  // Écrire pour B depuis le contexte de A : refusé par la politique.
  await assert.rejects(adapter.scoped('t-a', c => c.query(
    "insert into pearl_documents (tenant, name, content) values ('t-b', 'pirate.json', '{}')")), /row-level security/);
  // Sans contexte de tenant : rien.
  const sansCtx = await adapter.scoped('', c => c.query('select count(*)::int as n from pearl_documents').then(r => r.rows[0].n));
  assert.equal(sansCtx, 0);
});

test('blobs : aller-retour binaire et suppression par préfixe', { skip }, async () => {
  const f = path.join(DIR, 'tenants', 't-a', 'ai_kb_vec', 'doc1.m.bin');
  const buf = Buffer.from([0, 1, 2, 250, 255]);
  await backend.putBlob(f, buf);
  assert.deepEqual(await backend.getBlob(f), buf);
  await backend.removeBlobs(path.join(DIR, 'tenants', 't-a', 'ai_kb_vec'), 'doc1.');
  assert.equal(await backend.getBlob(f), null);
});

test('registre : domaines, membres, suppression en cascade', { skip }, async () => {
  await adapter.updateTenant('t-a', { domains: ['ops.a.test'], branding: { name: 'A2', primary: '#112233' } });
  assert.equal((await adapter.findTenantByDomain('ops.a.test')).slug, 't-a');
  const uid = '00000000-0000-4000-8000-000000000001';
  await adapter.upsertMember({ user_id: uid, tenant: 't-a', role: 'owner', person_name: 'Ann', email: 'ann@a.test' });
  assert.equal((await adapter.membershipsOf(uid))[0].role, 'owner');
  await adapter.deleteTenant('t-a');
  assert.equal((await adapter.membershipsOf(uid)).length, 0);
  const n = await adapter.query("select count(*)::int as n from pearl_documents where tenant = 't-a'");
  assert.equal(n[0].n, 0);
});
