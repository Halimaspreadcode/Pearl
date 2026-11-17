// Insights de performance des agents : activation par l'admin, génération
// automatique agent par agent, état visible par l'admin, données de
// l'agent seul et sans nom, historique gardé.
const { useTempDataDir } = require('./helpers/data-dir');
const bcrypt = require('bcryptjs');
process.env.CONFIG_PW_HASH = bcrypt.hashSync('x', 4);
const mois = new Date().toISOString().slice(0, 7);
const dir = useTempDataDir({
  'config.json': {
    fo_list: ['Awa Ndiaye', 'Moussa', 'Ba'],
    fo_scorecards: { [mois]: { 'Awa Ndiaye': { sla: 90, attendance: 80, individual: 60, notes: [{ text: 'Awa progresse bien, Moussa l\'aide' }] } } },
  },
  'audit.json': [],
});
for (const k of ['AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL', 'AI_PROXY', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) delete process.env[k];

const fs = require('fs');
const path = require('path');
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const ai = require('../server/services/ai');
const ins = require('../server/services/ai-insight');
const { issueSession, issueFoSession } = require('../server/auth/sessions');

let mock, mockUrl, srv, base, adm, tokAwa, tokMoussa, recu = [];
before(async () => {
  mock = http.createServer((req, res) => {
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      recu.push(JSON.parse(b));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ model: 'qwen', choices: [{ message: { content: `{"headline":"Solid month ${recu.length}","strengths":["SLA 90"],"focus":[],"next_step":"Book a 1:1","encouragement":"Keep going"}` }, finish_reason: 'stop' }] }));
    });
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  mockUrl = `http://127.0.0.1:${mock.address().port}/v1`;
  ai.majConf({ base_url: mockUrl, api_key: 'sk-test-0123456789', model: 'qwen', proxy_mode: 'none' });
  const app = express(); app.use(express.json());
  app.use(require('../server/routes/ai')); app.use(require('../server/routes/ai-insight')); app.use(require('../server/routes/config'));
  await new Promise(r => { srv = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${srv.address().port}`;
  adm = issueSession().token; tokAwa = issueFoSession('Awa Ndiaye').token; tokMoussa = issueFoSession('Moussa').token;
});
after(() => { srv.close(); mock.close(); });

const call = (method, p, body, h) => fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...h }, body: body && JSON.stringify(body) })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const asAwa = (m, p = '/api/my-insight') => call(m, p, undefined, { 'X-FO-Token': tokAwa });
const asAdmin = (m, p, b) => call(m, p, b, { 'X-Admin-Token': adm });
const finPasse = async () => { for (let i = 0; i < 200 && ins.JOB.encours; i++) await new Promise(r => setTimeout(r, 20)); };
const fichier = () => JSON.parse(fs.readFileSync(path.join(dir, 'ai_insights.json'), 'utf8'));

test('désactivé : rien de visible, aucune passe', async () => {
  assert.deepEqual((await asAwa('GET')).body, { actif: false });
  assert.equal((await asAdmin('POST', '/api/ai/insights/run', {})).body.lance, false);
  assert.equal(recu.length, 0);
});

test('l\'agent ne peut plus déclencher de génération', async () => {
  assert.equal((await call('POST', '/api/my-insight', {}, { 'X-FO-Token': tokAwa })).status, 404);
});

test('activer un agent lance sa génération, sans son nom ; l\'agent la lit', async () => {
  await asAdmin('PUT', '/api/ai/insights', { enabled: true, agents: { 'Awa Ndiaye': true } });
  await finPasse();
  assert.equal(recu.length, 1);
  assert.ok(!/Awa|Ndiaye|Moussa/.test(JSON.stringify(recu[0].messages)));
  const e = (await asAwa('GET')).body;
  assert.equal(e.actif, true);
  assert.match(e.insight.data.headline, /Solid month/);
  const v = (await asAdmin('GET', '/api/ai/insights')).body;
  assert.equal(v.agents.find(a => a.fo === 'Awa Ndiaye').etat, 'fait');
  assert.equal(v.agents.find(a => a.fo === 'Moussa').etat, 'inactif');
  // Un collègue non activé ne voit rien.
  assert.equal((await call('GET', '/api/my-insight', undefined, { 'X-FO-Token': tokMoussa })).body.actif, false);
});

test('passe suivante : rien à refaire, aucun appel', async () => {
  recu = [];
  assert.equal(ins.lancerPasse(), false);
  assert.equal(recu.length, 0);
});

test('fiche modifiée : refaite, mais pas plus d\'une fois par jour ; historique gardé', async () => {
  const cfgP = path.join(dir, 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgP, 'utf8'));
  cfg.fo_scorecards[mois]['Awa Ndiaye'].sla = 70;
  fs.writeFileSync(cfgP, JSON.stringify(cfg));
  assert.equal(ins.lancerPasse(), false, 'moins de 24 h : on attend');
  assert.equal((await asAdmin('GET', '/api/ai/insights')).body.agents.find(a => a.fo === 'Awa Ndiaye').etat, 'fait');
  const t = fichier(); t['Awa Ndiaye'][0].at = new Date(Date.now() - 25 * 3600e3).toISOString();
  fs.writeFileSync(path.join(dir, 'ai_insights.json'), JSON.stringify(t));
  assert.equal((await asAdmin('GET', '/api/ai/insights')).body.agents.find(a => a.fo === 'Awa Ndiaye').etat, 'a_refaire');
  recu = [];
  assert.equal(ins.lancerPasse(), true);
  await finPasse();
  assert.equal(recu.length, 1);
  assert.equal(fichier()['Awa Ndiaye'].length, 2);
  const e = (await asAwa('GET')).body;
  assert.equal(e.historique.length, 2);
  const ancien = e.historique[1];
  assert.match((await asAwa('GET', `/api/my-insight/${ancien.id}`)).body.insight.data.headline, /Solid month/);
  assert.equal((await call('GET', `/api/my-insight/${ancien.id}`, undefined, { 'X-FO-Token': tokMoussa })).status, 404);
});

test('regénérer un agent depuis l\'admin, même à jour', async () => {
  recu = [];
  const r = await asAdmin('POST', '/api/ai/insights/run', { fo: 'Awa Ndiaye' });
  assert.equal(r.body.lance, true);
  await finPasse();
  assert.equal(recu.length, 1);
  assert.equal(fichier()['Awa Ndiaye'].length, 3);
});

test('Big Brother injoignable : la passe s\'arrête, les suivants attendent', async () => {
  await asAdmin('PUT', '/api/ai/insights', { agents: { Moussa: true, Ba: true } });
  await finPasse();
  // Les deux viennent d'être faits ; on les force avec le tunnel coupé.
  ai.majConf({ base_url: 'http://127.0.0.1:1/v1', api_key: 'sk-test-0123456789' });
  assert.equal(ins.lancerPasse({ force: true }), true);
  await finPasse();
  const v = (await asAdmin('GET', '/api/ai/insights')).body;
  const etats = v.agents.filter(a => a.actif).map(a => a.etat);
  assert.ok(etats.includes('echec'), JSON.stringify(etats));
  assert.match(v.passe.motif, /injoignable/);
  ai.majConf({ base_url: mockUrl, api_key: 'sk-test-0123456789' });
});

test('ancien format du fichier relu ; la config générale ne touche pas l\'activation', async () => {
  fs.writeFileSync(path.join(dir, 'ai_insights.json'), JSON.stringify({ 'Awa Ndiaye': { periode: '2026-01', at: '2026-01-15T10:00:00.000Z', data: { headline: 'Ancien' } } }));
  assert.equal((await asAwa('GET')).body.historique[0].headline, 'Ancien');
  const avant = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).ai_insights;
  await asAdmin('PUT', '/api/config', { fo_list: ['Awa Ndiaye', 'Moussa', 'Ba'], ai_insights: { enabled: false, agents: {} } });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).ai_insights, avant);
  assert.equal((await call('GET', '/api/config')).body.ai_insights, undefined);
});
