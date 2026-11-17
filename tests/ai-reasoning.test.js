// Modèles « à raisonnement » : réflexion à part ou dans <think>, et
// réponse vide quand toute la marge part en réflexion.
const { useTempDataDir } = require('./helpers/data-dir');
useTempDataDir({ 'config.json': {}, 'audit.json': [] });
for (const k of ['AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL', 'AI_PROXY', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) delete process.env[k];

const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ai = require('../server/services/ai');

let mock, mode, recu = [];
before(async () => {
  mock = http.createServer((req, res) => {
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      const corps = JSON.parse(b); recu.push(corps);
      // Second essai : la consigne propre au réessai (le premier appel porte déjà /no_think).
      const second = /sans exposer ton raisonnement/.test(corps.messages.at(-1).content);
      let message, finish = 'stop';
      if (mode === 'vide-puis-ok') {
        message = second ? { content: 'OK après réessai' } : { content: null, reasoning_content: 'je réfléchis…' };
        if (!second) finish = 'length';
      } else if (mode === 'think') {
        message = { content: '<think>analyse {pas du json}</think>\n{"verdict":"approuver"}' };
      } else if (mode === 'think-coupe') {
        message = { content: '<think>je réfléchis encore et encore' }; finish = 'length';
      } else if (mode === 'parts') {
        message = { content: [{ type: 'text', text: 'Bon' }, { type: 'text', text: 'jour' }] };
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ model: 'qwen-aw-35b', choices: [{ message, finish_reason: finish }], usage: { completion_tokens: 3000 } }));
    });
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  ai.majConf({ base_url: `http://127.0.0.1:${mock.address().port}/v1`, api_key: 'sk-test-0123456789', model: 'qwen-aw-35b', proxy_mode: 'none' });
});
after(() => mock.close());

const q = [{ role: 'user', content: 'Question' }];

test('réponse vide par réflexion : second essai avec plus de marge', async () => {
  mode = 'vide-puis-ok'; recu = [];
  const r = await ai.chat(q, { max_tokens: 1200 });
  assert.equal(r.content, 'OK après réessai');
  assert.equal(recu.length, 2);
  assert.ok(recu[1].max_tokens > recu[0].max_tokens);
  assert.match(recu[1].messages.at(-1).content, /no_think/);
});

test('réflexion dans <think> : retirée, le JSON reste lisible', async () => {
  mode = 'think';
  const r = await ai.chat(q);
  assert.equal(r.content, '{"verdict":"approuver"}');
  assert.deepEqual(require('../server/services/ai-skills').lireJson(r.content), { verdict: 'approuver' });
});

test('réflexion coupée deux fois : erreur explicite', async () => {
  mode = 'think-coupe'; recu = [];
  await assert.rejects(ai.chat(q), /aucun texte.*réfléchir/);
  assert.equal(recu.length, 2);
});

test('contenu en morceaux : assemblé', async () => {
  mode = 'parts';
  assert.equal((await ai.chat(q)).content, 'Bonjour');
});
