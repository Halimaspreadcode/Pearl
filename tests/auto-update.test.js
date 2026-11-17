// Mise à jour automatique (server/updater.js + watchdog) sur de vrais dépôts
// git temporaires : un « GitHub » (dépôt nu), un poste de dev qui pousse,
// une « VM » qui tourne sous watchdog avec ses propres données.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const WATCHDOG = path.join(__dirname, '..', 'server', 'watchdog.js');
const updater = require('../server/updater');

const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' }).trim();
const attendre = ms => new Promise(r => setTimeout(r, ms));
async function jusqua(cond, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (cond()) return true; await attendre(100); }
  return cond();
}
function freePort() {
  return new Promise(res => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}

// Faux serveur : note sa version dans ran.txt (non suivi), répond à /api/status.
const serveur = (v, casse = false) => `
require('fs').appendFileSync(require('path').join(__dirname, '..', 'ran.txt'), '${v}\\n');
${casse ? 'process.exit(1);' : ''}
require('http').createServer((q, r) => r.end('{"ok":true}')).listen(+process.env.PORT, '127.0.0.1');
process.on('SIGTERM', () => process.exit(0));`;

function depots() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoupd-'));
  const nu = path.join(dir, 'remote.git');
  execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', nu]);
  const dev = path.join(dir, 'dev');
  execFileSync('git', ['clone', '--quiet', nu, dev]);
  git(dev, 'checkout', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dev, 'server'));
  fs.mkdirSync(path.join(dev, 'data'));
  fs.writeFileSync(path.join(dev, 'server', 'app.js'), serveur('v1'));
  fs.writeFileSync(path.join(dev, 'data', 'config.json'), '{"source":"dev"}');
  fs.writeFileSync(path.join(dev, '.gitignore'), 'ran.txt\nwatchdog.log\n.watchdog-state.json\n.update-save/\n');
  git(dev, 'add', '-A'); git(dev, 'commit', '-qm', 'v1'); git(dev, 'push', '-q', 'origin', 'main');
  const vm = path.join(dir, 'vm');
  execFileSync('git', ['clone', '--quiet', nu, vm]);
  // La VM a ses propres données, écrites par le serveur, jamais commitées.
  fs.writeFileSync(path.join(vm, 'data', 'config.json'), '{"source":"prod"}');
  const pousser = (msg, fichiers) => {
    for (const [f, c] of Object.entries(fichiers)) fs.writeFileSync(path.join(dev, f), c);
    git(dev, 'add', '-A'); git(dev, 'commit', '-qm', msg); git(dev, 'push', '-q', 'origin', 'main');
    return git(dev, 'rev-parse', 'HEAD');
  };
  return { dev, vm, pousser };
}

test('met à jour en gardant les données de la VM, puis revient en arrière sur une version cassée', async () => {
  const { vm, pousser } = depots();
  const port = await freePort();
  const wd = spawn(process.execPath, [WATCHDOG], {
    env: { ...process.env, PORT: String(port), WATCHDOG_ROOT: vm, WATCHDOG_SCRIPT: 'server/app.js',
      WATCHDOG_CHECK_MS: '150', WATCHDOG_TIMEOUT_MS: '200', WATCHDOG_GRACE_MS: '0', WATCHDOG_FAILS: '2',
      WATCHDOG_KILL_MS: '500', WATCHDOG_UPDATE_MIN: String(0.4 / 60), WATCHDOG_UPDATE_FIRST_MS: '300',
      WATCHDOG_TRIAL_MS: '1000', WATCHDOG_LOG: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  wd.stdout.on('data', d => { out += d; }); wd.stderr.on('data', d => { out += d; });
  const fin = new Promise(r => wd.on('exit', r));
  const lances = () => { try { return fs.readFileSync(path.join(vm, 'ran.txt'), 'utf8').trim().split('\n'); } catch { return []; } };
  const donnees = () => JSON.parse(fs.readFileSync(path.join(vm, 'data', 'config.json'), 'utf8')).source;
  try {
    assert.ok(await jusqua(() => lances().includes('v1')), out);

    // v2 : le commit change aussi data/config.json — la VM doit garder le sien.
    const v2 = pousser('v2', { 'server/app.js': serveur('v2'), 'data/config.json': '{"source":"dev2"}' });
    assert.ok(await jusqua(() => lances().at(-1) === 'v2'), out);
    assert.equal(git(vm, 'rev-parse', 'HEAD'), v2);
    assert.equal(donnees(), 'prod');
    assert.ok(await jusqua(() => /validée/.test(out)), out);

    // v3 plante au démarrage : retour à v2, v3 écartée.
    const v3 = pousser('v3 cassée', { 'server/app.js': serveur('v3', true) });
    assert.ok(await jusqua(() => /retour à la version/.test(out) && lances().at(-1) === 'v2'), out);
    assert.equal(git(vm, 'rev-parse', 'HEAD'), v2);
    assert.equal(donnees(), 'prod');
    const etat = JSON.parse(fs.readFileSync(path.join(vm, '.watchdog-state.json'), 'utf8'));
    assert.ok(etat.ecartees.includes(v3));
    assert.equal(etat.essai, null);

    // v3 n'est pas retentée.
    const nbV3 = lances().filter(v => v === 'v3').length;
    await attendre(1500);
    assert.equal(lances().filter(v => v === 'v3').length, nbV3, out);
  } finally { wd.kill('SIGTERM'); await fin; }
});

test('refuse de mettre à jour si le code a été modifié sur la VM', () => {
  const { vm, pousser } = depots();
  pousser('v2', { 'server/app.js': serveur('v2') });
  fs.appendFileSync(path.join(vm, 'server', 'app.js'), '\n// retouche locale\n');
  const v = updater.verifier(vm);
  assert.equal(v.dispo, false);
  assert.equal(v.bloque, true);
  assert.match(v.raison, /code modifié.*server\/app\.js/);
});

test('des données modifiées sur la VM ne bloquent pas la mise à jour', () => {
  const { vm, pousser } = depots();
  const v2 = pousser('v2', { 'server/app.js': serveur('v2') });
  const v = updater.verifier(vm);
  assert.equal(v.dispo, true);
  assert.equal(v.distant, v2);
  const r = updater.appliquer(vm, v.distant, { avant: v.local });
  assert.ok(r.ok, r.erreur);
  assert.equal(JSON.parse(fs.readFileSync(path.join(vm, 'data', 'config.json'), 'utf8')).source, 'prod');
  assert.equal(r.npm, false);
});

test('commits faits sur la VM : historique divergent, pas de mise à jour', () => {
  const { vm, pousser } = depots();
  pousser('v2', { 'server/app.js': serveur('v2') });
  fs.writeFileSync(path.join(vm, 'server', 'local.js'), '//');
  git(vm, 'add', 'server/local.js'); git(vm, 'commit', '-qm', 'local');
  const v = updater.verifier(vm);
  assert.equal(v.dispo, false);
  assert.match(v.raison, /divergent/);
});
