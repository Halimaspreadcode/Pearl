// Boîte à idées : accès d'équipe et par lien, signature, likes, droits.
const { useTempDataDir } = require('./helpers/data-dir');
const bcrypt = require('bcryptjs');
process.env.CONFIG_PW_HASH = bcrypt.hashSync('admin-pw', 4);
delete process.env.TEAM_PW_HASH;
useTempDataDir({
  'config.json': { fo_list: ['Awa'], fo_access_codes: { Awa: { hash: bcrypt.hashSync('CODEAWA2', 4), huawei_id: 'a00000001' } } },
  'ideas.json': [],
});
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { teamGate, definirMotDePasse } = require('../server/auth/team-gate');
const { issueSession } = require('../server/auth/sessions');

let srv, base;
const J = { 'Content-Type': 'application/json' };
const login = async body => {
  const r = await fetch(`${base}/api/team/auth`, { method: 'POST', headers: J, body: JSON.stringify(body) });
  return (r.headers.get('set-cookie') || '').split(';')[0];
};
before(async () => {
  definirMotDePasse('equipe-2026!');
  const app = express(); app.use(express.json());
  app.use('/api', teamGate);
  app.use('/api', require('../server/auth/identity').identite);
  app.use(require('../server/routes/team-access'));
  app.use(require('../server/routes/ideas'));
  await new Promise(r => { srv = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => srv.close());

test('sans session ni lien : refusé', async () => {
  assert.equal((await fetch(`${base}/api/ideas`)).status, 401);
});

test('consultation seule : on peut poster, anonyme ou signé, et aimer une fois', async () => {
  const cookie = await login({ password: 'equipe-2026!' });
  const h = { ...J, cookie, 'X-Voter': 'voter-aaaaaaaa' };
  const r = await fetch(`${base}/api/ideas`, { method: 'POST', headers: h, body: JSON.stringify({ text: 'Un tableau des astreintes', color: 'pink', x: 100, y: 80 }) });
  assert.equal(r.status, 201);
  const idee = await r.json();
  assert.equal(idee.author, null);
  assert.equal(idee.mine, true);
  const signee = await (await fetch(`${base}/api/ideas`, { method: 'POST', headers: h, body: JSON.stringify({ text: 'Signée', signed: true, author: 'Fatou' }) })).json();
  assert.equal(signee.author, 'Fatou');
  const autre = { ...J, cookie, 'X-Voter': 'voter-bbbbbbbb' };
  const l1 = await (await fetch(`${base}/api/ideas/${idee.id}/like`, { method: 'POST', headers: autre })).json();
  assert.equal(l1.likes, 1); assert.equal(l1.liked, true);
  const l2 = await (await fetch(`${base}/api/ideas/${idee.id}/like`, { method: 'POST', headers: autre })).json();
  assert.equal(l2.likes, 0);
  // Un autre navigateur ne peut pas déplacer ce post-it.
  assert.equal((await fetch(`${base}/api/ideas/${idee.id}`, { method: 'PUT', headers: autre, body: '{"x":10,"y":10}' })).status, 403);
  assert.equal((await fetch(`${base}/api/ideas/${idee.id}`, { method: 'PUT', headers: h, body: '{"x":10,"y":10}' })).status, 200);
});

test('la signature d\'une session nominative est son vrai nom', async () => {
  const cookie = await login({ huaweiId: 'a00000001', password: 'CODEAWA2' });
  const r = await (await fetch(`${base}/api/ideas`, { method: 'POST', headers: { ...J, cookie, 'X-Voter': 'voter-cccccccc' },
    body: JSON.stringify({ text: 'Idée', signed: true, author: 'Quelqu\'un d\'autre' }) })).json();
  assert.equal(r.author, 'Awa');
});

test('lien de partage : ouvre les idées, et seulement elles', async () => {
  const key = (await (await fetch(`${base}/api/ideas-share`, { method: 'POST', headers: { ...J, 'X-Admin-Token': issueSession().token }, body: '{}' })).json()).key;
  assert.ok(key);
  const h = { ...J, 'X-Ideas-Key': key, 'X-Voter': 'voter-dddddddd' };
  assert.equal((await fetch(`${base}/api/ideas`, { headers: h })).status, 200);
  assert.equal((await fetch(`${base}/api/ideas`, { method: 'POST', headers: h, body: '{"text":"Depuis le lien"}' })).status, 201);
  assert.equal((await fetch(`${base}/api/team/me`, { headers: h })).status !== 500, true);
  assert.equal((await fetch(`${base}/api/ideas-share`, { headers: h })).status, 401);
  assert.equal((await fetch(`${base}/api/ideas?k=mauvaise-cle-xxxxxxxx`)).status, 401);
});
