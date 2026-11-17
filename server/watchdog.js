#!/usr/bin/env node
// ── WATCHDOG ──────────────────────────────────────────────────
// Garde le serveur en vie et à jour, sans dépendance : `npm run watchdog`
// au lieu de `npm start` (ou `npm run service:install`, qui le lance au
// démarrage de la machine).
//
//   · Plantage : le serveur s'arrête tout seul → relancé. Le délai double à
//     chaque échec rapproché (1 s, 2 s, 4 s… plafonné à 1 min) pour ne pas
//     marteler une machine qui redémarre en boucle, et revient à 1 s dès que
//     le serveur a tenu 5 minutes.
//   · Blocage : le process vit mais ne répond plus (boucle infinie, disque
//     saturé…). Un plantage se voit ; un blocage, non — c'est pour ça qu'on
//     interroge /api/status. Trois réponses manquées d'affilée → arrêt
//     propre (SIGTERM, qui laisse finir les écritures), puis SIGKILL au bout
//     de 10 s s'il ne s'arrête pas, puis relance.
//   · Nouvelle version : toutes les 10 min, `git fetch`. Si origin/main a
//     avancé : arrêt propre, passage du code à la nouvelle version en
//     gardant data/ et .env (voir updater.js), `npm install` si les
//     dépendances ont changé, relance. Les migrations de données se font au
//     démarrage du serveur.
//   · Retour arrière : la nouvelle version est « à l'essai » pendant 3 min.
//     Si elle plante ou ne répond pas pendant l'essai, le code revient à la
//     version précédente et celle-ci est écartée — elle ne sera pas
//     retentée, seule une version plus récente le sera.
//   · Arrêt voulu : Ctrl-C ou `kill` sur le watchdog arrête le serveur
//     proprement et ne le relance pas.
//
// Si la mise à jour modifie le watchdog lui-même : sous un service
// (systemd, launchd — WATCHDOG_SUPERVISED=1), il s'arrête et le service le
// relance avec son nouveau code ; lancé à la main, il le signale dans le
// journal (il faut le relancer pour en profiter).
//
// Journal : sortie standard + watchdog.log à la racine du projet. État
// (essai en cours, versions écartées) : .watchdog-state.json.
//
// Réglages (variables d'environnement, valeurs par défaut) :
//   WATCHDOG_UPDATE_MIN  minutes entre deux vérifications git, 0 = jamais (10)
//   WATCHDOG_TRIAL_MS    durée d'essai d'une nouvelle version       (180000)
//   Pour les tests surtout :
//   WATCHDOG_ROOT        dossier du projet                     (dossier parent)
//   WATCHDOG_SCRIPT      script à surveiller, relatif au projet (server/index.js)
//   WATCHDOG_CHECK_MS    intervalle des contrôles de santé      (30000)
//   WATCHDOG_TIMEOUT_MS  délai de réponse d'un contrôle          (5000)
//   WATCHDOG_GRACE_MS    délai avant le premier contrôle        (20000)
//   WATCHDOG_FAILS       contrôles manqués avant relance            (3)
//   WATCHDOG_STABLE_MS   durée qui remet le délai à 1 s        (300000)
//   WATCHDOG_KILL_MS     délai entre SIGTERM et SIGKILL         (10000)
//   WATCHDOG_UPDATE_FIRST_MS  première vérification git après   (60000)
//   WATCHDOG_LOG         fichier journal ('' = aucun)      (watchdog.log)
if (parseInt(process.versions.node, 10) < 18) {
  // Sans ça, le serveur relancé mourrait aussitôt, en boucle : autant le dire.
  console.error('Pearl demande Node.js 18 ou plus récent — installé : ' + process.version + '. Voir « Prérequis » dans le README.');
  process.exit(1);
}
const path = require('path');
const ROOT = path.resolve(process.env.WATCHDOG_ROOT || path.join(__dirname, '..'));
// Chemin explicite : lancé par un service, le dossier courant n'est pas
// forcément celui du projet, et PORT ne serait pas lu.
require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });

const { spawn } = require('child_process');
const fs   = require('fs');
const http = require('http');
const updater = require('./updater');
const ui = require('./cli-ui');

const env    = (k, d) => (process.env[k] !== undefined ? process.env[k] : d);
const num    = (k, d) => Number(env(k, d));
const SCRIPT = path.resolve(ROOT, env('WATCHDOG_SCRIPT', 'server/index.js'));
const PORT   = num('PORT', 3000);
const CHECK_MS   = num('WATCHDOG_CHECK_MS', 30000);
const TIMEOUT_MS = num('WATCHDOG_TIMEOUT_MS', 5000);
const GRACE_MS   = num('WATCHDOG_GRACE_MS', 20000);
const MAX_FAILS  = num('WATCHDOG_FAILS', 3);
const STABLE_MS  = num('WATCHDOG_STABLE_MS', 300000);
const KILL_MS    = num('WATCHDOG_KILL_MS', 10000);
const UPDATE_MS  = num('WATCHDOG_UPDATE_MIN', 10) * 60000;
const UPDATE_FIRST_MS = num('WATCHDOG_UPDATE_FIRST_MS', 60000);
const TRIAL_MS   = num('WATCHDOG_TRIAL_MS', 180000);
const SUPERVISED = env('WATCHDOG_SUPERVISED', '') === '1';
const DELAY_MIN = 1000, DELAY_MAX = 60000;
const LOG_FILE   = env('WATCHDOG_LOG', path.join(ROOT, 'watchdog.log'));
const STATE_FILE = path.join(ROOT, '.watchdog-state.json');
// Fichiers dont le changement demande de relancer le watchdog lui-même.
const SOI = ['server/watchdog.js', 'server/updater.js'];

// Couleur de la ligne à l'écran selon l'événement ; le fichier reste brut.
function teinte(msg) {
  if (/^(serveur lancé|code à jour|version .* validée)/.test(msg)) return ui.VERT;
  if (/ÉCHEC|échec|retour à la version|écartée/.test(msg)) return ui.ROUGE;
  if (/sans réponse|arrêté \(|nouvelle version|mise à jour :|ne répond plus/.test(msg)) return ui.JAUNE;
  return '';
}

function log(msg) {
  const quand = new Date().toISOString();
  const line = `[watchdog ${quand}] ${msg}`;
  if (ui.TTY) {
    const t = teinte(msg);
    console.log(`${ui.GRIS}${quand.slice(11, 19)}${ui.R} ${t}${msg}${t ? ui.R : ''}`);
  } else console.log(line);
  if (LOG_FILE) { try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch { /* journal facultatif */ } }
}

// ── État persistant ───────────────────────────────────────────
// Survit à un redémarrage du watchdog : l'essai d'une version se poursuit
// quand le service relance le watchdog mis à jour, et une version écartée
// le reste.
function lireEtat() {
  try { const e = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); return { ecartees: e.ecartees || [], essai: e.essai || null }; }
  catch { return { ecartees: [], essai: null }; }
}
const etat = lireEtat();
function sauverEtat() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(etat, null, 2)); } catch (e) { log(`état non enregistré : ${e.message}`); }
}
const court = sha => String(sha || '').slice(0, 7);

let child = null;
let startedAt = 0;
let delay = DELAY_MIN;
let fails = 0;
let stopping = false;      // arrêt demandé : ne plus relancer
let maintenance = false;   // mise à jour ou retour arrière en cours
let restartTimer = null;
let checkTimer = null;
let updateTimer = null;
let killTimer = null;
let restarts = 0;
let attenteArret = null;   // résolue quand le serveur s'est arrêté
let dernierMessage = '';   // pour ne pas répéter le même refus toutes les 10 min

function start() {
  restartTimer = null;
  startedAt = Date.now();
  fails = 0;
  child = spawn(process.execPath, [SCRIPT], { cwd: ROOT, env: process.env, stdio: 'inherit' });
  log(`serveur lancé (pid ${child.pid})${restarts ? ` — relance n° ${restarts}` : ''}` +
      (etat.essai ? ` — version ${court(etat.essai.apres)} à l'essai` : ''));

  child.on('exit', (code, signal) => {
    clearTimeout(killTimer);
    child = null;
    const vecu = Date.now() - startedAt;
    if (attenteArret) { const r = attenteArret; attenteArret = null; r(); }
    if (stopping) { log('serveur arrêté.'); process.exit(0); }
    if (maintenance) return;   // c'est la mise à jour qui l'a arrêté
    const cause = signal ? 'signal ' + signal : 'code ' + code;
    if (etat.essai) { retourArriere(`le serveur s'est arrêté (${cause}) pendant l'essai`); return; }
    // Un serveur qui a tenu longtemps n'est pas en boucle de plantage :
    // on repart du délai minimal.
    if (vecu >= STABLE_MS) delay = DELAY_MIN;
    log(`serveur arrêté (${cause}) après ${Math.round(vecu / 1000)} s — relance dans ${delay / 1000} s`);
    restarts++;
    restartTimer = setTimeout(start, delay);
    delay = Math.min(delay * 2, DELAY_MAX);
  });
}

// Arrêt propre d'abord : le serveur vide sa file d'écritures sur SIGTERM
// (voir gracefulShutdown dans index.js). SIGKILL seulement s'il est bloqué.
function stopChild(raison) {
  if (!child) return;
  log(`arrêt du serveur (pid ${child.pid}) : ${raison}`);
  const c = child;
  c.kill('SIGTERM');
  clearTimeout(killTimer);
  killTimer = setTimeout(() => {
    if (child === c) { log('pas d\'arrêt après SIGTERM — SIGKILL'); c.kill('SIGKILL'); }
  }, KILL_MS);
}

function arreterEtAttendre(raison) {
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  if (!child) return Promise.resolve();
  return new Promise(r => { attenteArret = r; stopChild(raison); });
}

function ping() {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/status', timeout: TIMEOUT_MS }, res => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

async function check() {
  if (!child || stopping || maintenance) return;
  if (Date.now() - startedAt < GRACE_MS) return;   // le serveur démarre encore
  if (await ping()) {
    fails = 0;
    if (etat.essai && Date.now() - startedAt >= TRIAL_MS) {
      log(`version ${court(etat.essai.apres)} validée (${Math.round(TRIAL_MS / 1000)} s sans incident)`);
      etat.essai = null;
      sauverEtat();
    }
    return;
  }
  fails++;
  log(`contrôle /api/status sans réponse (${fails}/${MAX_FAILS})`);
  if (fails < MAX_FAILS) return;
  fails = 0;
  if (etat.essai) retourArriere('le serveur ne répond pas pendant l\'essai');
  else stopChild('ne répond plus');
}

// Après un changement de code : si le watchdog lui-même a changé et qu'un
// service saura le relancer, il s'arrête ; sinon on relance le serveur.
function relancerApres(changes) {
  if (changes.some(f => SOI.includes(f))) {
    if (SUPERVISED) {
      log('le watchdog lui-même a changé — arrêt, le service le relance avec sa nouvelle version');
      process.exit(0);
    }
    log('le watchdog lui-même a changé — relancez-le (Ctrl-C puis npm run watchdog) pour en profiter');
  }
  maintenance = false;
  delay = DELAY_MIN;
  start();
}

async function miseAJour() {
  if (stopping || maintenance || etat.essai) return;
  const v = updater.verifier(ROOT);
  if (!v.dispo) {
    if (v.raison && v.raison !== dernierMessage) { log(`mise à jour : ${v.raison}`); dernierMessage = v.raison; }
    if (v.raison === 'pas un dépôt git') clearInterval(updateTimer);
    return;
  }
  if (etat.ecartees.includes(v.distant)) {
    const m = `version ${court(v.distant)} écartée (échec lors d'un essai précédent) — en attente d'une version plus récente`;
    if (m !== dernierMessage) { log(m); dernierMessage = m; }
    return;
  }
  dernierMessage = '';
  maintenance = true;
  log(`nouvelle version ${court(v.distant)} « ${v.titre} » (${v.fichiers.length} fichier(s)) — mise à jour depuis ${court(v.local)}`);
  await arreterEtAttendre('mise à jour');
  const r = updater.appliquer(ROOT, v.distant, { avant: v.local });
  if (!r.ok) {
    log(`échec de la mise à jour : ${r.erreur} — retour à ${court(v.local)}`);
    updater.appliquer(ROOT, v.local, { avant: v.distant });
    etat.ecartees = [...etat.ecartees, v.distant].slice(-20);
    sauverEtat();
    relancerApres(v.fichiers);
    return;
  }
  log(`code à jour (${court(v.distant)})${r.npm ? ', dépendances réinstallées' : ''} — essai de ${Math.round(TRIAL_MS / 1000)} s`);
  etat.essai = { avant: v.local, apres: v.distant, depuis: new Date().toISOString() };
  sauverEtat();
  relancerApres(v.fichiers);
}

async function retourArriere(raison) {
  if (maintenance) return;
  maintenance = true;
  const e = etat.essai;
  log(`${raison} — retour à la version ${court(e.avant)}, la version ${court(e.apres)} est écartée`);
  await arreterEtAttendre('retour arrière');
  const r = updater.appliquer(ROOT, e.avant, { avant: e.apres });
  if (!r.ok) log(`ÉCHEC du retour arrière : ${r.erreur} — intervention nécessaire (git status dans ${ROOT})`);
  etat.ecartees = [...etat.ecartees, e.apres].slice(-20);
  etat.essai = null;
  sauverEtat();
  relancerApres(r.changes || SOI);
}

function shutdown(sig) {
  if (stopping) return;
  stopping = true;
  clearInterval(checkTimer);
  clearInterval(updateTimer);
  if (restartTimer || (!child && !maintenance)) { clearTimeout(restartTimer); log(`${sig} reçu — arrêt.`); process.exit(0); }
  log(`${sig} reçu — arrêt du serveur puis du watchdog.`);
  if (child) stopChild(sig);
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(sig));

// Un serveur qui répond déjà (lancé à la main, ou un autre watchdog) : en
// démarrer un second le ferait échouer sur le port occupé — et le contrôle,
// qui interroge le port, croirait à tort que tout va bien.
ping().then(async occupe => {
  if (ui.TTY) await ui.banniere('Watchdog — surveillance, relance et mises à jour');
  if (occupe) {
    log(`un serveur répond déjà sur le port ${PORT} — arrêtez-le d'abord (lsof -ti:${PORT} | xargs kill).`);
    process.exit(1);
  }
  log(`surveillance de ${path.relative(ROOT, SCRIPT)} sur le port ${PORT}` +
      (UPDATE_MS > 0 ? ` — mises à jour git toutes les ${UPDATE_MS / 60000} min` : ' — mises à jour désactivées'));
  start();
  checkTimer = setInterval(check, CHECK_MS);
  if (UPDATE_MS > 0) {
    setTimeout(() => { miseAJour(); updateTimer = setInterval(miseAJour, UPDATE_MS); }, UPDATE_FIRST_MS);
  }
});
