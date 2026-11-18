#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════
   SERVICE SYSTÈME — démarrage automatique du watchdog

   npm run service:install     installe et démarre le service
   npm run service:uninstall   l'arrête et le retire
   npm run service:status      état du service et du serveur
   npm run service:restart     redémarre (après un git pull, par exemple)
   npm run service:stop        arrête (le service reste installé)
   npm run service:start       relance après un stop
   … -- --dry-run              affiche ce qui serait fait, sans rien faire

   Le système est détecté : systemd sous Linux (service système, démarre
   avec la machine, tourne sous l'utilisateur qui l'installe), launchd sous
   macOS (agent de session). Chemins remplis d'office : dossier du projet,
   Node.js qui exécute cette commande (process.execPath — celui de nvm s'il
   y en a un), utilisateur. Rien à éditer à la main, contrairement aux
   modèles de service générés par ce script.

   Linux demande `sudo` pour écrire dans /etc/systemd/system : la commande
   le lance elle-même et le mot de passe est demandé dans le terminal.
   ══════════════════════════════════════════════════════════════ */
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');

const ROOT  = path.join(__dirname, '..');
const NAME  = 'pearl';
const LABEL = 'com.pearl.watchdog';
const UNIT_PATH  = `/etc/systemd/system/${NAME}.service`;
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

// Lancé via `sudo npm run …`, l'utilisateur réel est dans SUDO_USER : le
// service ne doit pas tourner en root, les fichiers de data/ sont à lui.
function utilisateur() {
  return process.env.SUDO_USER || os.userInfo().username;
}

function port() {
  try {
    const m = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/^\s*PORT\s*=\s*(\d+)/m);
    if (m) return Number(m[1]);
  } catch { /* pas de .env : port par défaut */ }
  return Number(process.env.PORT) || 3000;
}

// ── Fichiers générés (fonctions pures, testées) ───────────────
function unitSystemd({ root, node, user }) {
  return `# Généré par « npm run service:install » — relancer la commande après
# avoir déplacé le projet ou changé de version de Node.
[Unit]
Description=Pear — serveur sous watchdog
After=network.target

[Service]
Type=simple
User=${user}
WorkingDirectory=${root}
ExecStart=${node} ${path.join(root, 'server', 'watchdog.js')}
# Le watchdog se sait relancé par systemd : après une mise à jour de son
# propre code, il s'arrête et systemd le relance avec la nouvelle version.
Environment=WATCHDOG_SUPERVISED=1
Restart=always
RestartSec=5
# SIGTERM au watchdog, qui arrête le serveur proprement (écritures finies).
KillMode=mixed
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
`;
}

function plistLaunchd({ root, node }) {
  const x = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Généré par « npm run service:install » -->
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${x(node)}</string>
    <string>${x(path.join(root, 'server', 'watchdog.js'))}</string>
  </array>
  <key>WorkingDirectory</key><string>${x(root)}</string>
  <key>EnvironmentVariables</key>
  <dict><key>WATCHDOG_SUPERVISED</key><string>1</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${x(path.join(root, 'watchdog.out.log'))}</string>
  <key>StandardErrorPath</key><string>${x(path.join(root, 'watchdog.out.log'))}</string>
</dict>
</plist>
`;
}

// ── Exécution ─────────────────────────────────────────────────
const DRY = process.argv.includes('--dry-run');
const ui  = require('../server/cli-ui');
const { spawn } = require('child_process');

// Commande asynchrone : l'animation continue pendant qu'elle tourne. La
// sortie est gardée pour l'afficher en cas d'échec seulement.
function exec(cmd, args, { ignore = false } = {}) {
  if (DRY) { console.log(`      ${ui.GRIS}$ ${cmd} ${args.join(' ')}${ui.R}`); return Promise.resolve(''); }
  return new Promise((res, rej) => {
    const c = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', d => { out += d; });
    c.stderr.on('data', d => { out += d; });
    c.on('error', e => (ignore ? res(out) : rej(e)));
    c.on('exit', code => (code === 0 || ignore ? res(out) : rej(new Error(`${cmd} ${args.join(' ')} : ${out.trim().split('\n').pop() || 'code ' + code}`))));
  });
}

async function ecrire(fichier, contenu, { sudo = false } = {}) {
  // Contenu affiché seulement sur demande : il noierait la simulation.
  if (DRY) { if (process.argv.includes('--show')) console.log(contenu.replace(/^/gm, `      ${ui.GRIS}│${ui.R} `)); return; }
  if (!sudo) { fs.mkdirSync(path.dirname(fichier), { recursive: true }); fs.writeFileSync(fichier, contenu); return; }
  const tmp = path.join(os.tmpdir(), `${NAME}-${process.pid}.service`);
  fs.writeFileSync(tmp, contenu);
  try { await exec('sudo', ['-n', 'install', '-m', '644', tmp, fichier]); } finally { fs.rmSync(tmp, { force: true }); }
}

// Le mot de passe sudo est demandé AVANT les animations : une invite au
// milieu d'une ligne animée serait écrasée à chaque image.
function sudoAvant() {
  if (DRY) return;
  console.log(`  ${ui.GRIS}Droits administrateur nécessaires pour le service système :${ui.R}`);
  const r = spawnSync('sudo', ['-v'], { stdio: 'inherit' });
  if (r.status !== 0) { ui.echec('sudo refusé — rien n\'a été modifié.'); process.exit(1); }
  console.log('');
}

// Même vérification que le watchdog, dans un process à part : `git fetch`
// est synchrone dans updater.js et figerait l'animation.
function verifierMaj() {
  return new Promise(res => {
    const code = `console.log(JSON.stringify(require(${JSON.stringify(path.join(ROOT, 'server', 'updater.js'))}).verifier(${JSON.stringify(ROOT)})))`;
    const c = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    c.stdout.on('data', d => { out += d; });
    c.on('exit', () => { try { res(JSON.parse(out)); } catch { res({ raison: 'vérification impossible' }); } });
  });
}

function ping(p) {
  return new Promise(res => {
    const req = http.get({ host: '127.0.0.1', port: p, path: '/api/status', timeout: 2000 }, r => { r.resume(); res(r.statusCode === 200); });
    req.on('timeout', () => { req.destroy(); res(false); });
    req.on('error', () => res(false));
  });
}

async function attendreServeur(p, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await ping(p)) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

function systeme() {
  if (process.platform === 'linux') {
    const r = spawnSync('systemctl', ['--version'], { stdio: 'ignore' });
    if (r.status === 0) return 'systemd';
  }
  if (process.platform === 'darwin') return 'launchd';
  return null;
}

const journal = sys => (sys === 'systemd' ? `journalctl -u ${NAME} -n 50` : path.join(ROOT, 'watchdog.out.log'));

function ligneMaj(v) {
  if (v.raison && /fetch/.test(v.raison)) return { avertissement: 'GitHub injoignable sans mot de passe' };
  if (v.bloque || v.raison) return { avertissement: v.raison };
  return v.dispo ? `nouvelle version ${String(v.distant).slice(0, 7)} — installée dans la minute` : 'dernière version installée';
}

async function install() {
  const sys = systeme();
  const p = port();
  await ui.banniere('Installation du service' + (DRY ? ' — simulation' : ''));
  if (!sys) {
    ui.echec(`Système non pris en charge par cette commande (${process.platform}).`);
    console.log('    Windows : voir « Relance automatique » dans le README (Planificateur de tâches).');
    process.exit(1);
  }
  const ctx = { root: ROOT, node: process.execPath, user: utilisateur() };
  ui.info('système', sys);
  ui.info('projet', ctx.root);
  ui.info('node', `${process.version} ${ui.GRIS}${ctx.node}${ui.R}`);
  ui.info('port', String(p));
  if (sys === 'systemd') ui.info('compte', ctx.user);
  console.log('');

  // Un serveur lancé à la main occupe le port : le watchdog refuserait de
  // démarrer. On le dit maintenant plutôt que de laisser un service en échec.
  if (!DRY && await ping(p)) {
    ui.echec(`Un serveur répond déjà sur le port ${p}. Arrêtez-le d'abord :`);
    console.log(`      lsof -ti:${p} | xargs kill        ${ui.GRIS}(ou Ctrl-C dans son terminal)${ui.R}`);
    console.log('    puis relancez : npm run service:install\n');
    process.exit(1);
  }

  try {
    if (sys === 'systemd') {
      sudoAvant();
      await ui.etape('Écriture du service systemd', async () => { await ecrire(UNIT_PATH, unitSystemd(ctx), { sudo: true }); return UNIT_PATH; });
      await ui.etape('Activation au démarrage de la machine', async () => {
        await exec('sudo', ['-n', 'systemctl', 'daemon-reload']);
        await exec('sudo', ['-n', 'systemctl', 'enable', NAME]);
      });
      // `enable --now` ne relance pas un service déjà actif : après une
      // réinstallation (nouveau Node, projet déplacé), il faut le redémarrer.
      await ui.etape('Démarrage du watchdog', () => exec('sudo', ['-n', 'systemctl', 'restart', NAME]));
    } else {
      await ui.etape('Écriture de l\'agent launchd', async () => {
        await exec('launchctl', ['unload', '-w', PLIST_PATH], { ignore: true });
        await ecrire(PLIST_PATH, plistLaunchd(ctx));
        return PLIST_PATH.replace(os.homedir(), '~');
      });
      await ui.etape('Démarrage du watchdog', () => exec('launchctl', ['load', '-w', PLIST_PATH]));
    }
  } catch {
    ui.cadre('Installation interrompue', [`Journal : ${journal(sys)}`], ui.ROUGE);
    process.exit(1);
  }
  if (DRY) { ui.cadre('Simulation terminée', ['Rien n\'a été modifié.', 'Sans --dry-run pour installer.'], ui.JAUNE); return; }

  let repond = false;
  try {
    await ui.etape('Le serveur répond', async () => {
      if (!(await attendreServeur(p))) throw new Error(`pas de réponse sur le port ${p} après 20 s`);
      repond = true;
      return `http://localhost:${p}`;
    });
  } catch { /* affiché par l'étape */ }
  const v = await ui.etape('Accès GitHub pour les mises à jour', async () => ligneMaj(await verifierMaj()));

  const lignes = repond
    ? [`${ui.VERT}●${ui.R} Pear tourne sur http://localhost:${p}`,
       '  redémarre avec la machine et après un plantage',
       '  se met à jour depuis GitHub toutes les 10 min',
       '', `${ui.GRIS}État     npm run service:status${ui.R}`, `${ui.GRIS}Journal  watchdog.log${ui.R}`]
    : [`${ui.ROUGE}●${ui.R} Le serveur ne répond pas`, `Journal : ${journal(sys)}`];
  if (v && v.avertissement && /GitHub/.test(v.avertissement)) {
    lignes.push('', `${ui.JAUNE}Mises à jour : enregistrer l'accès GitHub une fois${ui.R}`,
      '  git config credential.helper store && git fetch',
      `  ${ui.GRIS}(jeton GitHub comme mot de passe)${ui.R}`);
  }
  ui.cadre(repond ? 'Service installé' : 'Service installé, serveur muet', lignes, repond ? ui.VERT : ui.ROUGE);
  if (!repond) process.exit(1);
}

async function uninstall() {
  const sys = systeme();
  await ui.banniere('Retrait du service' + (DRY ? ' — simulation' : ''));
  try {
    if (sys === 'systemd') {
      sudoAvant();
      await ui.etape('Arrêt du watchdog et du serveur', () => exec('sudo', ['-n', 'systemctl', 'disable', '--now', NAME], { ignore: true }));
      await ui.etape('Suppression du service systemd', async () => {
        await exec('sudo', ['-n', 'rm', '-f', UNIT_PATH]);
        await exec('sudo', ['-n', 'systemctl', 'daemon-reload']);
      });
    } else if (sys === 'launchd') {
      await ui.etape('Arrêt du watchdog et du serveur', () => exec('launchctl', ['unload', '-w', PLIST_PATH], { ignore: true }));
      await ui.etape('Suppression de l\'agent launchd', async () => { if (!DRY) fs.rmSync(PLIST_PATH, { force: true }); });
    } else { ui.echec('Système non pris en charge.'); process.exit(1); }
  } catch { process.exit(1); }
  ui.cadre('Service retiré', ['Le serveur ne démarrera plus tout seul.', `${ui.GRIS}À la main : npm start${ui.R}`], ui.JAUNE);
}

async function restart() {
  const sys = systeme();
  const p = port();
  await ui.banniere('Redémarrage');
  try {
    if (sys === 'systemd') { sudoAvant(); await ui.etape('Redémarrage du watchdog', () => exec('sudo', ['-n', 'systemctl', 'restart', NAME])); }
    else if (sys === 'launchd') await ui.etape('Redémarrage du watchdog', () => exec('launchctl', ['kickstart', '-k', `gui/${process.getuid()}/${LABEL}`]));
    else { ui.echec('Système non pris en charge.'); process.exit(1); }
    if (!DRY) await ui.etape('Le serveur répond', async () => {
      if (!(await attendreServeur(p))) throw new Error(`pas de réponse après 20 s — ${journal(sys)}`);
      return `http://localhost:${p}`;
    });
  } catch { process.exit(1); }
  console.log(`\n  ${ui.GRIS}Le watchdog vérifie GitHub dans la minute.${ui.R}\n`);
}

// Arrêt sans désinstaller : le service reste installé et repart au
// prochain démarrage de la machine (ou avec service:start).
async function stop() {
  const sys = systeme();
  await ui.banniere('Arrêt du service');
  try {
    if (sys === 'systemd') { sudoAvant(); await ui.etape('Arrêt du watchdog et du serveur', () => exec('sudo', ['-n', 'systemctl', 'stop', NAME])); }
    else if (sys === 'launchd') await ui.etape('Arrêt du watchdog et du serveur', () => exec('launchctl', ['unload', PLIST_PATH]));
    else { ui.echec('Système non pris en charge.'); process.exit(1); }
  } catch { process.exit(1); }
  ui.cadre('Service arrêté', ['Pear ne tourne plus.',
    `${ui.GRIS}Relancer     npm run service:start${ui.R}`,
    sys === 'systemd' ? `${ui.GRIS}Il repartira au prochain redémarrage de la machine.${ui.R}` : `${ui.GRIS}Il repartira à la prochaine ouverture de session.${ui.R}`,
    `${ui.GRIS}Pour de bon  npm run service:uninstall${ui.R}`], ui.JAUNE);
}

async function startService() {
  const sys = systeme();
  const p = port();
  await ui.banniere('Démarrage du service');
  try {
    if (sys === 'systemd') { sudoAvant(); await ui.etape('Démarrage du watchdog', () => exec('sudo', ['-n', 'systemctl', 'start', NAME])); }
    else if (sys === 'launchd') await ui.etape('Démarrage du watchdog', () => exec('launchctl', ['load', PLIST_PATH]));
    else { ui.echec('Système non pris en charge.'); process.exit(1); }
    if (!DRY) await ui.etape('Le serveur répond', async () => {
      if (!(await attendreServeur(p))) throw new Error(`pas de réponse après 20 s — ${journal(sys)}`);
      return `http://localhost:${p}`;
    });
  } catch { process.exit(1); }
  console.log('');
}

async function status() {
  const sys = systeme();
  const p = port();
  await ui.banniere('État du service');
  let actif = false;
  await ui.etape('Service', async () => {
    if (sys === 'systemd') {
      const out = spawnSync('systemctl', ['is-active', NAME], { encoding: 'utf8' }).stdout.trim();
      actif = out === 'active';
      if (!actif) return { avertissement: out === 'inactive' || !out ? 'non démarré' : out };
      const depuis = spawnSync('systemctl', ['show', NAME, '-p', 'ActiveEnterTimestamp', '--value'], { encoding: 'utf8' }).stdout.trim();
      return `systemd, actif depuis ${depuis}`;
    }
    if (sys === 'launchd') {
      if (!fs.existsSync(PLIST_PATH)) return { avertissement: 'non installé — npm run service:install' };
      actif = spawnSync('launchctl', ['list', LABEL], { stdio: 'ignore' }).status === 0;
      return actif ? 'launchd, chargé' : { avertissement: 'installé mais non chargé' };
    }
    return { avertissement: `système non pris en charge (${process.platform})` };
  });
  await ui.etape('Serveur', async () => ((await ping(p)) ? `répond sur http://localhost:${p}` : { avertissement: `ne répond pas sur le port ${p}` }));
  const ici = spawnSync('git', ['log', '-1', '--format=%h %s (%cr)'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  await ui.etape('Version', async () => ici || { avertissement: 'inconnue' });
  await ui.etape('Mises à jour', async () => ligneMaj(await verifierMaj()));

  const log = path.join(ROOT, 'watchdog.log');
  if (fs.existsSync(log)) {
    const lignes = fs.readFileSync(log, 'utf8').trim().split('\n').slice(-6)
      .map(l => l.replace(/^\[watchdog (\d{4}-\d\d-\d\d)T(\d\d:\d\d:\d\d)\.\d+Z\]/, `${ui.GRIS}$1 $2${ui.R}`));
    console.log(`\n  ${ui.B}Derniers événements${ui.R}`);
    for (const l of lignes) console.log('  ' + l);
  }
  console.log('');
}

if (require.main === module) {
  const cmd = process.argv.slice(2).find(a => !a.startsWith('--'));
  const actions = { install, uninstall, status, restart, stop, start: startService };
  if (!actions[cmd]) {
    console.log('Usage : npm run service:install | service:start | service:stop | service:restart | service:status | service:uninstall  [-- --dry-run]');
    process.exit(cmd ? 1 : 0);
  }
  Promise.resolve(actions[cmd]()).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { unitSystemd, plistLaunchd };
