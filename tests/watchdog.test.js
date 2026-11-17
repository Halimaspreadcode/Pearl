// server/watchdog.js : relance après plantage, relance d'un serveur bloqué,
// arrêt propre, refus d'un second serveur sur un port occupé. Le serveur
// surveillé est remplacé par de petits scripts (WATCHDOG_SCRIPT) et les
// délais raccourcis par variables d'environnement.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const WATCHDOG = path.join(__dirname, '..', 'server', 'watchdog.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-'));

function freePort() {
  return new Promise(res => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}

// Script factice : note chaque lancement dans `compteur`, puis fait `corps`.
function script(nom, corps) {
  const f = path.join(dir, nom + '.js');
  const compteur = path.join(dir, nom + '.count');
  fs.writeFileSync(f, `require('fs').appendFileSync(${JSON.stringify(compteur)}, 'x');\n${corps}`);
  return { f, lancements: () => (fs.existsSync(compteur) ? fs.readFileSync(compteur, 'utf8').length : 0) };
}

function lancer(scriptPath, port, extra = {}) {
  const wd = spawn(process.execPath, [WATCHDOG], {
    env: {
      ...process.env, PORT: String(port), WATCHDOG_SCRIPT: scriptPath, WATCHDOG_LOG: '',
      WATCHDOG_CHECK_MS: '150', WATCHDOG_TIMEOUT_MS: '100', WATCHDOG_GRACE_MS: '0',
      WATCHDOG_FAILS: '2', WATCHDOG_KILL_MS: '300', WATCHDOG_UPDATE_MIN: '0', ...extra,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  wd.stdout.on('data', d => { out += d; });
  wd.stderr.on('data', d => { out += d; });
  wd.sortie = () => out;
  wd.fin = new Promise(r => wd.on('exit', code => r(code)));
  return wd;
}

const attendre = ms => new Promise(r => setTimeout(r, ms));
async function jusqua(cond, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (cond()) return true; await attendre(50); }
  return cond();
}

const SERVEUR_OK = `
require('http').createServer((q, r) => r.end('{"ok":true}')).listen(+process.env.PORT, '127.0.0.1');
process.on('SIGTERM', () => process.exit(0));`;

test('relance le serveur après un plantage', async () => {
  const s = script('crash', 'process.exit(1);');
  const wd = lancer(s.f, await freePort());
  try {
    assert.ok(await jusqua(() => s.lancements() >= 2, 4000), wd.sortie());
    assert.match(wd.sortie(), /relance dans 1 s/);
  } finally { wd.kill('SIGTERM'); await wd.fin; }
});

test('relance un serveur qui ne répond plus', async () => {
  // Écoute le port mais ne répond jamais : vivant, mais bloqué.
  const s = script('hang', `require('net').createServer(() => {}).listen(+process.env.PORT, '127.0.0.1');`);
  const wd = lancer(s.f, await freePort());
  try {
    assert.ok(await jusqua(() => s.lancements() >= 2, 6000), wd.sortie());
    assert.match(wd.sortie(), /ne répond plus/);
  } finally { wd.kill('SIGTERM'); await wd.fin; }
});

test('un serveur sain n\'est pas relancé ; SIGTERM arrête tout proprement', async () => {
  const s = script('ok', SERVEUR_OK);
  const port = await freePort();
  const wd = lancer(s.f, port);
  await attendre(1200);
  assert.equal(s.lancements(), 1, wd.sortie());
  wd.kill('SIGTERM');
  assert.equal(await wd.fin, 0);
  assert.match(wd.sortie(), /serveur arrêté\./);
  // Plus personne sur le port.
  const libre = await new Promise(r => {
    const c = net.connect(port, '127.0.0.1', () => { c.destroy(); r(false); });
    c.on('error', () => r(true));
  });
  assert.ok(libre);
});

test('refuse de démarrer si un serveur répond déjà sur le port', async () => {
  const port = await freePort();
  const occupant = require('node:http').createServer((q, r) => r.end('ok')).listen(port, '127.0.0.1');
  const s = script('second', SERVEUR_OK);
  const wd = lancer(s.f, port);
  try {
    assert.equal(await wd.fin, 1);
    assert.equal(s.lancements(), 0);
    assert.match(wd.sortie(), /répond déjà/);
  } finally { occupant.close(); }
});
