// Règle : tout jalon doit avoir une date limite. Les routes refusent de
// créer, d'ajouter, de vider, de soumettre ou d'approuver un jalon non daté,
// et l'admin peut dater ceux créés avant la règle.
const { useTempDataDir } = require('./helpers/data-dir');
const bcrypt = require('bcryptjs');
process.env.CONFIG_PW_HASH = bcrypt.hashSync('x', 4);
useTempDataDir({
  'config.json': {
    timezone: 'Africa/Dakar',
    fo_list: ['Awa'],
    objective_sessions: [{ id: 'q4', name: 'Q4', start: '2026-10-01', end: '2026-12-31', state: 'open' }],
    fo_objectives: {
      'Awa': [{
        id: 'o-old', session: 'q4', title: 'Ancien', state: 'submitted', progress: 'todo', due: '2026-12-15',
        kpis: [], steps: [{ id: 's-old', label: 'Sans date', due: '', done: false, state: 'submitted' }], history: [],
      }],
    },
  },
});

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { issueFoSession } = require('../server/auth/sessions');

let srv, base, tok;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use(require('../server/routes/objectives-agent'));
  app.use(require('../server/routes/objectives-admin'));
  await new Promise(r => { srv = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${srv.address().port}`;
  tok = issueFoSession('Awa').token;
});
after(() => srv.close());

const agent = (method, path, body) => fetch(base + '/api/my-objectives' + path, {
  method, headers: { 'Content-Type': 'application/json', 'X-FO-Token': tok }, body: body && JSON.stringify(body),
}).then(async r => ({ status: r.status, body: await r.json() }));
const admin = (method, path, body) => fetch(base + '/api/objectives' + path, {
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(body || {}), _auth: 'x' }),
}).then(async r => ({ status: r.status, body: await r.json() }));

test('création : un jalon sans date est refusé, daté il passe', async () => {
  let r = await agent('POST', '', { title: 'T', steps: [{ label: 'Étape A', due: '' }] });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /deadline/);
  r = await agent('POST', '', { title: 'T', steps: [{ label: 'Étape A', due: '2026-11-01' }] });
  assert.equal(r.status, 201);
});

test('ajout et modification : date obligatoire, et on ne peut pas la retirer', async () => {
  const c = await agent('POST', '', { title: 'U', steps: [] });
  const id = c.body.id;
  assert.equal((await agent('POST', `/${id}/steps`, { label: 'B' })).status, 400);
  const a = await agent('POST', `/${id}/steps`, { label: 'B', due: '2026-11-10' });
  assert.equal(a.status, 200);
  const sid = a.body.steps.find(s => s.label === 'B').id;
  assert.equal((await agent('PUT', `/${id}/steps/${sid}`, { label: 'B', due: '' })).status, 400);
  // Libellé seul : la date en place est conservée.
  const e = await agent('PUT', `/${id}/steps/${sid}`, { label: 'B2' });
  assert.equal(e.status, 200);
  assert.equal(e.body.steps.find(s => s.id === sid).due, '2026-11-10');
});

test('approbation refusée tant qu\'un jalon n\'a pas de date ; l\'admin peut la poser', async () => {
  let r = await admin('POST', '/Awa/o-old/decide', { decision: 'approve' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Sans date/);
  assert.equal((await admin('POST', '/Awa/o-old/steps/s-old/decide', { decision: 'approve' })).status, 400);
  assert.equal((await admin('PUT', '/Awa/o-old/steps/s-old/due', { due: 'bientôt' })).status, 400);
  r = await admin('PUT', '/Awa/o-old/steps/s-old/due', { due: '2026-11-30' });
  assert.equal(r.status, 200);
  r = await admin('POST', '/Awa/o-old/decide', { decision: 'approve' });
  assert.equal(r.status, 200);
});

test('objectif créé par le manager : même règle', async () => {
  const r = await admin('POST', '/Awa', { title: 'M', steps: [{ label: 'C' }] });
  assert.equal(r.status, 400);
});
