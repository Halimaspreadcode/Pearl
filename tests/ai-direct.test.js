// Big Brother : réponse directe (sans réflexion) et bouton Stop.
const { useTempDataDir } = require('./helpers/data-dir');
useTempDataDir({});
process.env.AI_ALLOW_HTTP = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

let srv, recus = [], refuseKwargs = false, lent = false;
before(async () => {
  srv = http.createServer((req, res) => {
    let b = ''; req.on('data', d => b += d); req.on('end', () => {
      const j = JSON.parse(b || '{}'); recus.push(j);
      if (refuseKwargs && j.chat_template_kwargs) { res.writeHead(400); return res.end('{"error":"Unrecognized request argument: chat_template_kwargs"}'); }
      const fin = () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })); };
      if (lent) setTimeout(() => { if (!res.destroyed) fin(); }, 5000); else fin();
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const ai = require('../server/services/ai');
  ai.majConf({ base_url: `http://127.0.0.1:${srv.address().port}/v1`, model: 'qwen-test', api_key: 'sk-test-123456', proxy_mode: 'none' });
});
after(() => srv.close());

test('premier appel : réflexion coupée (consigne et paramètre)', async () => {
  recus = [];
  const r = await require('../server/services/ai').chat([{ role: 'user', content: 'Bonjour' }]);
  assert.equal(r.content, 'ok');
  assert.equal(recus.length, 1);
  assert.deepEqual(recus[0].chat_template_kwargs, { enable_thinking: false });
  assert.match(recus[0].messages.at(-1).content, /\/no_think/);
});

test('serveur qui refuse le paramètre : on le retire, une seule fois', async () => {
  const ai = require('../server/services/ai');
  ai.majConf({ base_url: `http://localhost:${srv.address().port}/v1`, api_key: 'sk-test-123456' });
  refuseKwargs = true; recus = [];
  assert.equal((await ai.chat([{ role: 'user', content: 'a' }])).content, 'ok');
  assert.equal(recus.length, 2);
  recus = [];
  assert.equal((await ai.chat([{ role: 'user', content: 'b' }])).content, 'ok');
  assert.equal(recus.length, 1, 'le refus est mémorisé');
  refuseKwargs = false;
});

test('réflexion réactivée dans les réglages : rien n\'est ajouté', async () => {
  const ai = require('../server/services/ai');
  ai.majConf({ reflexion: true }); recus = [];
  await ai.chat([{ role: 'user', content: 'c' }]);
  assert.equal(recus[0].chat_template_kwargs, undefined);
  assert.doesNotMatch(recus[0].messages.at(-1).content, /no_think/);
  ai.majConf({ reflexion: false });
});

test('Stop : la tâche est arrêtée et l\'appel au modèle coupé', async () => {
  const ai = require('../server/services/ai');
  const jobs = require('../server/services/ai-jobs');
  lent = true;
  const j = jobs.lancer({ skill: 'x', titre: 'X' }, () => ai.chat([{ role: 'user', content: 'long' }]));
  await new Promise(r => setTimeout(r, 300));
  const t0 = Date.now();
  assert.equal(jobs.annuler(j.id).etat, 'annule');
  await new Promise(r => setTimeout(r, 200));
  assert.equal(jobs.lire(j.id).etat, 'annule');
  assert.ok(Date.now() - t0 < 1000);
  // Hors tâche, une question directe s'arrête avec son signal.
  const ctrl = new AbortController();
  const p = ai.avecArret(ctrl.signal, () => ai.chat([{ role: 'user', content: 'long' }]));
  setTimeout(() => ctrl.abort(), 200);
  await assert.rejects(p, e => e.arret === true);
  lent = false;
});
