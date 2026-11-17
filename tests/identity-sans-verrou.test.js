// Code personnel sans mot de passe d'équipe : connexion, Ma performance,
// signature des écritures, et option « exiger le code pour modifier ».
const { useTempDataDir } = require('./helpers/data-dir');
const bcrypt = require('bcryptjs');
process.env.CONFIG_PW_HASH = bcrypt.hashSync('admin-pw', 4);
delete process.env.TEAM_PW_HASH;
useTempDataDir({
  'config.json': { fo_list: ['Awa'], fo_access_codes: { Awa: { hash: bcrypt.hashSync('CODEAWA2', 4), huawei_id: 'A00000001' } } },
  'sn.json': [], 'ci.json': [], 'observations.json': [], 'audit.json': [],
  'weekly_progress.json': [], 'fo_tasks.json': [],
});
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { issueSession } = require('../server/auth/sessions');

let srv, base;
const json = { 'Content-Type': 'application/json' };
before(async () => {
  const app = express(); app.use(express.json());
  app.use('/api', require('../server/auth/team-gate').teamGate);
  app.use('/api', require('../server/auth/identity').identite);
  app.use(require('../server/routes/team-access'));
  app.use(require('../server/routes/perf'));
  app.use(require('../server/routes/weekly-progress'));
  await new Promise(r => { srv = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => srv.close());

let cookie;
test('le code de Ma performance ouvre une session nominative, ID en minuscules ou majuscules', async () => {
  const r = await fetch(`${base}/api/team/auth`, { method: 'POST', headers: json, body: '{"huaweiId":"a00000001","password":"CODEAWA2"}' });
  assert.equal(r.status, 200);
  cookie = r.headers.get('set-cookie').split(';')[0];
  const s = await (await fetch(`${base}/api/team/session`, { headers: { cookie } })).json();
  assert.equal(s.user.name, 'Awa');
  assert.equal(s.codes, true);
});

test('Ma performance s\'ouvre avec la session, sans ressaisir le code', async () => {
  const r = await fetch(`${base}/api/my-perf`, { headers: { cookie, 'X-FO-Token': 'session' } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).fo, 'Awa');
  assert.equal((await fetch(`${base}/api/my-perf`)).status, 401);
});

test('écriture signée même sans mot de passe d\'équipe', async () => {
  const r = await fetch(`${base}/api/weekly-progress`, { method: 'POST', headers: { ...json, cookie }, body: '{"task":"x","modified_by":"Autre"}' });
  assert.equal((await r.json()).modified_by, 'Awa');
});

test('code exigé : écriture anonyme refusée, lecture ouverte', async () => {
  assert.equal((await fetch(`${base}/api/weekly-progress`, { method: 'POST', headers: json, body: '{"task":"x"}' })).status, 201);
  const on = await fetch(`${base}/api/team/required`, { method: 'PUT', headers: { ...json, 'X-Admin-Token': issueSession().token }, body: '{"on":true}' });
  assert.equal(on.status, 200);
  assert.equal((await fetch(`${base}/api/weekly-progress`, { method: 'POST', headers: json, body: '{"task":"x"}' })).status, 403);
  assert.equal((await fetch(`${base}/api/weekly-progress`)).status, 200);
  assert.equal((await fetch(`${base}/api/weekly-progress`, { method: 'POST', headers: { ...json, cookie }, body: '{"task":"y"}' })).status, 201);
});

test('code saisi en minuscules ou avec espaces accepté', async () => {
  const r = await fetch(`${base}/api/team/auth`, { method: 'POST', headers: json, body: '{"huaweiId":"a00000001","password":"code awa2"}' });
  assert.equal(r.status, 200);
  const f = await fetch(`${base}/api/fo-access/login`, { method: 'POST', headers: json, body: '{"huaweiId":"a00000001","code":"codeawa2"}' });
  assert.equal(f.status, 200);
});

test('connexion à Ma performance : ouvre aussi la session nominative', async () => {
  const f = await fetch(`${base}/api/fo-access/login`, { method: 'POST', headers: json, body: '{"huaweiId":"a00000001","code":"CODEAWA2"}' });
  const c = (f.headers.get('set-cookie') || '').split(';')[0];
  assert.match(c, /^fo_team=/);
  const s = await (await fetch(`${base}/api/team/session`, { headers: { cookie: c } })).json();
  assert.equal(s.user.name, 'Awa');
});
