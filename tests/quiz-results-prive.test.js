// Résultats de quiz : chacun ne reçoit que les siens ; l'admin voit tout ;
// la consultation seule ne reçoit rien.
const { useTempDataDir } = require('./helpers/data-dir');
const bcrypt = require('bcryptjs');
process.env.CONFIG_PW_HASH = bcrypt.hashSync('admin-pw', 4);
delete process.env.TEAM_PW_HASH;
useTempDataDir({
  'config.json': { fo_list: ['Awa', 'Moussa'], fo_access_codes: {
    Awa: { hash: bcrypt.hashSync('CODEAWA2', 4), employee_id: 'a00000001' } } },
  'quiz_results.json': [
    { id: 'r1', user: 'Awa', quiz_name: 'Q', score: 8, total: 10 },
    { id: 'r2', user: 'Moussa', quiz_name: 'Q', score: 3, total: 10 },
  ],
});
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { teamGate, definirMotDePasse } = require('../server/auth/team-gate');
const { issueSession } = require('../server/auth/sessions');

let srv, base;
const login = async body => {
  const r = await fetch(`${base}/api/team/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return (r.headers.get('set-cookie') || '').split(';')[0];
};
const ids = async headers => (await (await fetch(`${base}/api/quiz/results`, { headers })).json()).map(r => r.id).sort();

before(async () => {
  definirMotDePasse('equipe-2026!');
  const app = express(); app.use(express.json());
  app.use('/api', teamGate);
  app.use('/api', require('../server/auth/identity').identite);
  app.use(require('../server/routes/team-access'));
  app.use(require('../server/routes/quiz'));
  await new Promise(r => { srv = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => srv.close());

test('un agent ne reçoit que ses propres résultats', async () => {
  const cookie = await login({ employeeId: 'a00000001', password: 'CODEAWA2' });
  assert.deepEqual(await ids({ cookie }), ['r1']);
});

test('consultation seule : aucun résultat', async () => {
  const cookie = await login({ password: 'equipe-2026!' });
  assert.deepEqual(await ids({ cookie }), []);
});

test('l\'admin voit les résultats de toute l\'équipe', async () => {
  const cookie = await login({ password: 'equipe-2026!' });
  assert.deepEqual(await ids({ cookie, 'X-Admin-Token': issueSession().token }), ['r1', 'r2']);
});
