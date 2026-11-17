// Verrou d'équipe (server/auth/team-gate.js) et CORS restreint au même hôte.
const { useTempDataDir } = require('./helpers/data-dir');
const bcrypt = require('bcryptjs');
process.env.CONFIG_PW_HASH = bcrypt.hashSync('admin-pw', 4);
delete process.env.TEAM_PW_HASH;
useTempDataDir({
  'config.json': { fo_list: ['Awa'], fo_access_codes: { Awa: { hash: bcrypt.hashSync('CODE2345', 4), huawei_id: 'a00123456' } } },
  'sn.json': [], 'ci.json': [], 'observations.json': [], 'audit.json': [],
});
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { issueSession, issueFoSession } = require('../server/auth/sessions');
const { teamGate } = require('../server/auth/team-gate');
const { corsMiddleware } = require('../server/http/security');

let srv, base;
const admin = () => ({ 'X-Admin-Token': issueSession().token, 'Content-Type': 'application/json' });
const json = { 'Content-Type': 'application/json' };
const cookieDe = r => (r.headers.get('set-cookie') || '').split(';')[0];

before(async () => {
  const app = express();
  app.use(corsMiddleware);
  app.use(express.json());
  app.use('/api', teamGate);
  app.use('/api', require('../server/auth/identity').identite);
  app.use(require('../server/routes/status'));
  app.use(require('../server/routes/team-access'));
  app.use(require('../server/routes/tickets'));
  await new Promise(r => { srv = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => srv.close());

test('sans mot de passe d\'équipe, rien ne change', async () => {
  assert.equal((await fetch(`${base}/api/sn`)).status, 200);
  { const j = await (await fetch(`${base}/api/team/session`)).json(); assert.equal(j.actif, false); assert.equal(j.ok, true); }
});

test('seul l\'admin définit le mot de passe, avec une longueur minimale', async () => {
  assert.equal((await fetch(`${base}/api/team/password`, { method: 'PUT', headers: json, body: '{"password":"equipe-2026!"}' })).status, 401);
  assert.equal((await fetch(`${base}/api/team/password`, { method: 'PUT', headers: admin(), body: '{"password":"court"}' })).status, 400);
  assert.equal((await fetch(`${base}/api/team/password`, { method: 'PUT', headers: admin(), body: '{"password":"admin-pw-xx"}' })).status, 200);
  assert.equal((await fetch(`${base}/api/team/password`, { method: 'PUT', headers: admin(), body: '{"password":"equipe-2026!"}' })).status, 200);
});

test('verrou actif : lecture refusée sans session, sondes ouvertes', async () => {
  const r = await fetch(`${base}/api/sn`);
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('x-team-auth'), 'required');
  assert.equal((await fetch(`${base}/api/status`)).status, 200);
  { const j = await (await fetch(`${base}/api/team/session`)).json(); assert.equal(j.actif, true); assert.equal(j.ok, false); }
});

test('mauvais mot de passe refusé, bon mot de passe → cookie qui ouvre l\'API', async () => {
  assert.equal((await fetch(`${base}/api/team/auth`, { method: 'POST', headers: json, body: '{"password":"nope"}' })).status, 401);
  const r = await fetch(`${base}/api/team/auth`, { method: 'POST', headers: json, body: '{"password":"equipe-2026!"}' });
  assert.equal(r.status, 200);
  const sc = r.headers.get('set-cookie');
  assert.match(sc, /HttpOnly/i); assert.match(sc, /SameSite=Strict/i);
  assert.equal((await fetch(`${base}/api/sn`, { headers: { cookie: cookieDe(r) } })).status, 200);
  assert.equal((await fetch(`${base}/api/sn`, { headers: { cookie: 'fo_team=forge' } })).status, 401);
});

test('code personnel d\'agent et mot de passe admin ouvrent aussi', async () => {
  const bad = await fetch(`${base}/api/team/auth`, { method: 'POST', headers: json, body: '{"huaweiId":"a00123456","password":"equipe-2026!"}' });
  assert.equal(bad.status, 401);
  const ag = await fetch(`${base}/api/team/auth`, { method: 'POST', headers: json, body: '{"huaweiId":"A00123456","password":"CODE2345"}' });
  assert.equal(ag.status, 200);
  assert.equal((await fetch(`${base}/api/sn`, { headers: { cookie: cookieDe(ag) } })).status, 200);
  const ad = await fetch(`${base}/api/team/auth`, { method: 'POST', headers: json, body: '{"password":"admin-pw"}' });
  assert.equal(ad.status, 200);
});

test('les sessions admin et agent existantes passent le verrou', async () => {
  assert.equal((await fetch(`${base}/api/sn`, { headers: admin() })).status, 200);
  assert.equal((await fetch(`${base}/api/sn`, { headers: { 'X-FO-Token': issueFoSession('Awa').token } })).status, 200);
});

test('changer le mot de passe ferme les sessions d\'équipe', async () => {
  const r = await fetch(`${base}/api/team/auth`, { method: 'POST', headers: json, body: '{"password":"equipe-2026!"}' });
  const c = cookieDe(r);
  await fetch(`${base}/api/team/password`, { method: 'PUT', headers: admin(), body: '{"password":"nouveau-2026!"}' });
  assert.equal((await fetch(`${base}/api/sn`, { headers: { cookie: c } })).status, 401);
});

test('le condensé n\'est jamais renvoyé', async () => {
  const d = await (await fetch(`${base}/api/team/password`, { headers: admin() })).json();
  assert.equal(d.actif, true);
  assert.ok(!JSON.stringify(d).includes('$2'));
});

test('désactivation par l\'admin : l\'API se rouvre', async () => {
  assert.equal((await fetch(`${base}/api/team/password`, { method: 'DELETE' })).status, 401);
  assert.equal((await fetch(`${base}/api/team/password`, { method: 'DELETE', headers: admin() })).status, 200);
  assert.equal((await fetch(`${base}/api/sn`)).status, 200);
});

test('CORS : une autre origine, même privée, n\'est pas autorisée', async () => {
  const autre = await fetch(`${base}/api/status`, { headers: { Origin: 'http://10.9.9.9' } });
  assert.equal(autre.headers.get('access-control-allow-origin'), null);
  const meme = await fetch(`${base}/api/status`, { headers: { Origin: base } });
  assert.equal(meme.headers.get('access-control-allow-origin'), base);
});
