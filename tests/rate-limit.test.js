// Limiteur des connexions : seuls les échecs comptent, par compte (ID saisi),
// déblocable par l'admin.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { authLimiter, debloquerCompte } = require('../server/http/security');
let srv, base;
before(async () => {
  const app = express(); app.use(express.json());
  app.post('/login', authLimiter, (req, res) => res.status(req.body.ok ? 200 : 401).json({}));
  await new Promise(r => { srv = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => srv.close());
const essai = (id, ok = false) => fetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ huaweiId: id, ok }) }).then(r => r.status);

test('les connexions réussies ne rapprochent pas du blocage', async () => {
  for (let i = 0; i < 40; i++) assert.equal(await essai('a00000009', true), 200);
});

test('10 codes faux bloquent ce compte, pas ses collègues', async () => {
  for (let i = 0; i < 10; i++) assert.equal(await essai('a00000001'), 401);
  assert.equal(await essai('a00000001'), 429);
  assert.equal(await essai('a00000001', true), 429);   // bloqué même avec le bon code
  assert.equal(await essai('a00000002'), 401);
});

test('l\'admin débloque', async () => {
  await debloquerCompte('A00000001');
  assert.equal(await essai('a00000001', true), 200);
});

test('sans session, une adresse partagée (proxy) n\'est pas bloquée à 600 requêtes', async () => {
  const { apiRateLimit } = require('../server/http/security');
  const app = express(); app.use('/api', apiRateLimit); app.get('/api/x', (req, res) => res.json({}));
  const s2 = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const u = `http://127.0.0.1:${s2.address().port}/api/x`;
  let refus = 0;
  for (let i = 0; i < 700; i++) if ((await fetch(u)).status === 429) refus++;
  s2.close();
  assert.equal(refus, 0);
});
