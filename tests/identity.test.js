// Identité vérifiée (server/auth/identity.js) : plus de profil déclaratif.
const { useTempDataDir, readFixture } = require('./helpers/data-dir');
const bcrypt = require('bcryptjs');
process.env.CONFIG_PW_HASH = bcrypt.hashSync('admin-pw', 4);
delete process.env.TEAM_PW_HASH;
const dir = useTempDataDir({
  'config.json': { fo_list: ['Awa', 'Fatime NDOYE'], fo_access_codes: {
    Awa: { hash: bcrypt.hashSync('CODEAWA2', 4), huawei_id: 'a00000001' },
    'Fatime NDOYE': { hash: bcrypt.hashSync('CODEYAR2', 4), huawei_id: 'a00000002' } } },
  'sn.json': [{ id: 'T1', modified_by: 'x' }], 'ci.json': [], 'observations.json': [], 'audit.json': [],
  'weekly_progress.json': [{ id: 'w1', modified_by: 'Fatime NDOYE', task: 'Sa tâche', status: 'Planned' }],
  'quiz_results.json': [],
});
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { teamGate, definirMotDePasse } = require('../server/auth/team-gate');
const { issueSession } = require('../server/auth/sessions');

let srv, base;
const json = { 'Content-Type': 'application/json' };
const login = async body => {
  const r = await fetch(`${base}/api/team/auth`, { method: 'POST', headers: json, body: JSON.stringify(body) });
  return { status: r.status, cookie: (r.headers.get('set-cookie') || '').split(';')[0], body: await r.json() };
};
before(async () => {
  definirMotDePasse('equipe-2026!');
  const app = express(); app.use(express.json());
  app.use('/api', teamGate);
  app.use('/api', require('../server/auth/identity').identite);
  app.use(require('../server/routes/team-access'));
  app.use(require('../server/routes/weekly-progress'));
  app.use(require('../server/routes/tickets'));
  await new Promise(r => { srv = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => srv.close());

test('mot de passe d\'équipe : consultation seule', async () => {
  const l = await login({ password: 'equipe-2026!' });
  assert.equal(l.body.lecture, true);
  assert.equal((await fetch(`${base}/api/weekly-progress`, { headers: { cookie: l.cookie } })).status, 200);
  const w = await fetch(`${base}/api/weekly-progress`, { method: 'POST', headers: { ...json, cookie: l.cookie }, body: '{"task":"x"}' });
  assert.equal(w.status, 403);
  assert.equal(w.headers.get('x-identity'), 'required');
});

test('code personnel : identité renvoyée par le serveur', async () => {
  const l = await login({ huaweiId: 'a00000001', password: 'CODEAWA2' });
  assert.equal(l.body.user.name, 'Awa');
  const s = await (await fetch(`${base}/api/team/session`, { headers: { cookie: l.cookie } })).json();
  assert.deepEqual(s.user, { name: 'Awa', huaweiId: 'a00000001', role: 'FO' });
});

test('impossible d\'écrire au nom d\'un collègue', async () => {
  const { cookie } = await login({ huaweiId: 'a00000001', password: 'CODEAWA2' });
  const r = await fetch(`${base}/api/weekly-progress`, { method: 'POST', headers: { ...json, cookie },
    body: JSON.stringify({ task: 'Usurpée', modified_by: 'Fatime NDOYE', admin_task: true }) });
  assert.equal(r.status, 201);
  const cree = await r.json();
  assert.equal(cree.modified_by, 'Awa');
  assert.equal(cree.admin_task, undefined);
  // Ni modifier la tâche d'une autre.
  const p = await fetch(`${base}/api/weekly-progress/w1`, { method: 'PUT', headers: { ...json, cookie }, body: '{"status":"Done"}' });
  assert.equal(p.status, 403);
  assert.equal(readFixture(dir, 'weekly_progress.json').find(x => x.id === 'w1').status, 'Planned');
  // Ticket : l'auteur de la modification est celui de la session.
  await fetch(`${base}/api/sn/T1`, { method: 'PUT', headers: { ...json, cookie }, body: '{"modified_by":"Fatime NDOYE","status":"Open"}' });
  assert.equal(readFixture(dir, 'sn.json')[0].modified_by, 'Awa');
});

test('l\'admin assigne toujours au nom d\'un agent', async () => {
  const r = await fetch(`${base}/api/weekly-progress`, { method: 'POST',
    headers: { ...json, 'X-Admin-Token': issueSession().token },
    body: JSON.stringify({ task: 'Assignée', modified_by: 'Fatime NDOYE', admin_task: true }) });
  const t = await r.json();
  assert.equal(t.modified_by, 'Fatime NDOYE');
  assert.equal(t.admin_task, true);
});

test('onglet My Space réservé : refusé aux autres ID, même côté serveur', async () => {
  const { readCfg, writeCfg } = require('../server/core/store');
  const cfg = readCfg(); cfg.nav_reserved = { 'weekly-progress': ['A00000002'] }; writeCfg(cfg);
  const awa = await login({ huaweiId: 'a00000001', password: 'CODEAWA2' });
  const r = await fetch(`${base}/api/weekly-progress`, { method: 'POST', headers: { ...json, cookie: awa.cookie }, body: '{"task":"x"}' });
  assert.equal(r.status, 403);
  const yar = await login({ huaweiId: 'a00000002', password: 'CODEYAR2' });
  const ok = await fetch(`${base}/api/weekly-progress`, { method: 'POST', headers: { ...json, cookie: yar.cookie }, body: '{"task":"x"}' });
  assert.equal(ok.status, 201);
  cfg.nav_reserved = {}; writeCfg(cfg);
});

test('réservation : reconnue par l\'ID de la fiche agent même si le code porte un autre ID', async () => {
  const { readCfg, writeCfg } = require('../server/core/store');
  const cfg = readCfg();
  cfg.fo_ids = { 'Fatime NDOYE': 'wx1488808' };
  cfg.nav_reserved = { 'weekly-progress': ['WX1488808'] };
  writeCfg(cfg);
  const yar = await login({ huaweiId: 'a00000002', password: 'CODEYAR2' });
  const ok = await fetch(`${base}/api/weekly-progress`, { method: 'POST', headers: { ...json, cookie: yar.cookie }, body: '{"task":"y"}' });
  assert.equal(ok.status, 201);
  const awa = await login({ huaweiId: 'a00000001', password: 'CODEAWA2' });
  const ko = await fetch(`${base}/api/weekly-progress`, { method: 'POST', headers: { ...json, cookie: awa.cookie }, body: '{"task":"y"}' });
  assert.equal(ko.status, 403);
  assert.match((await ko.json()).error, /Tasks est réservé.*Awa/);
  cfg.nav_reserved = {}; writeCfg(cfg);
});
