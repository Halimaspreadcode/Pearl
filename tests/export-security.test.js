// /api/export : réservé à l'admin, sans aucun condensé de secret.
const { useTempDataDir } = require('./helpers/data-dir');
const bcrypt = require('bcryptjs');
process.env.CONFIG_PW_HASH = bcrypt.hashSync('x', 4);
useTempDataDir({
  'config.json': { fo_list: ['Awa'], approval_password_hash: 'h1', absence_password_hash: 'h2',
    fo_access_codes: { Awa: { hash: 'h3' } }, fo_scorecards: { '2026-09': { Awa: { sla: 90 } } } },
  'sn.json': [], 'ci.json': [], 'observations.json': [], 'audit.json': [],
});
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { issueSession } = require('../server/auth/sessions');

let srv, base;
before(async () => {
  const app = express(); app.use(express.json()); app.use(require('../server/routes/dashboard'));
  await new Promise(r => { srv = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => srv.close());

test('refusé sans session admin', async () => {
  assert.equal((await fetch(`${base}/api/export`)).status, 401);
});

test('admin : données, mais aucun condensé de mot de passe ni de code', async () => {
  const r = await fetch(`${base}/api/export`, { headers: { 'X-Admin-Token': issueSession().token } });
  assert.equal(r.status, 200);
  const txt = await r.text();
  const d = JSON.parse(txt);
  assert.equal(d.config.fo_scorecards['2026-09'].Awa.sla, 90);
  for (const k of ['approval_password_hash', 'absence_password_hash', 'fo_access_codes']) assert.ok(!(k in d.config), k);
  assert.ok(!/"h[123]"/.test(txt));
});
