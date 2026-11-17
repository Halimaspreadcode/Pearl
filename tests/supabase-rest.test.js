// Pilote Supabase (API REST) contre un faux PostgREST : chaque requête de
// données porte le filtre du tenant, la clé service_role part en en-tête,
// les documents font l'aller-retour via le cache.
const { useTempDataDir } = require('./helpers/data-dir');
const DIR = useTempDataDir({});
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');

const rows = [];             // pearl_documents simulée
const vus = [];
let srv, adapter, backend;

before(async () => {
  srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      vus.push({ method: req.method, path: u.pathname, q: Object.fromEntries(u.searchParams), auth: req.headers.authorization, apikey: req.headers.apikey });
      const tenant = (u.searchParams.get('tenant') || '').replace(/^eq\./, '');
      res.setHeader('Content-Type', 'application/json');
      if (u.pathname === '/rest/v1/pearl_documents' && req.method === 'GET')
        return res.end(JSON.stringify(rows.filter(r => r.tenant === tenant).map(({ name, content }) => ({ name, content }))));
      if (u.pathname === '/rest/v1/pearl_documents' && req.method === 'POST') {
        for (const r of JSON.parse(body)) {
          const i = rows.findIndex(x => x.tenant === r.tenant && x.name === r.name);
          if (i >= 0) rows[i] = r; else rows.push(r);
        }
        res.statusCode = 201; return res.end('');
      }
      if (u.pathname === '/rest/v1/pearl_tenants') return res.end(JSON.stringify([{ slug: 'acme', name: 'Acme' }]));
      res.statusCode = 404; res.end(JSON.stringify({ message: 'not found' }));
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  adapter = require('../server/core/backend/supabase-rest').makeSupabaseAdapter({ url, serviceKey: 'service-key-test' });
  backend = require('../server/core/backend/remote').makeRemoteBackend({ kind: 'supabase', adapter, dataDir: DIR, defaultTenant: 'default' });
  rows.push({ tenant: 'globex', name: 'config.json', content: { org_name: 'Globex' } });
});
after(() => srv.close());

test('chargement d\'un tenant : filtre tenant=eq.<slug> et clé service', async () => {
  await backend.ensureTenant('acme');
  const get = vus.find(v => v.method === 'GET' && v.path === '/rest/v1/pearl_documents');
  assert.equal(get.q.tenant, 'eq.acme');
  assert.equal(get.auth, 'Bearer service-key-test');
  assert.equal(get.apikey, 'service-key-test');
  // Rien de Globex n'est arrivé chez Acme.
  assert.equal(backend.readText(path.join(DIR, 'tenants', 'acme', 'config.json')), null);
});

test('écriture : upsert sur (tenant, name), relu après rechargement', async () => {
  const f = path.join(DIR, 'tenants', 'acme', 'sn.json');
  backend.writeText(f, JSON.stringify([{ id: 't1' }]));
  await backend.flush();
  const post = vus.find(v => v.method === 'POST');
  assert.equal(post.q.on_conflict, 'tenant,name');
  assert.ok(rows.some(r => r.tenant === 'acme' && r.name === 'sn.json'));
  backend.evict('acme');
  await backend.ensureTenant('acme');
  assert.deepEqual(JSON.parse(backend.readText(f)), [{ id: 't1' }]);
});

test('registre : liste des tenants', async () => {
  assert.deepEqual((await adapter.listTenants()).map(t => t.slug), ['acme']);
});
