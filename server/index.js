// Point d'entrée : démarrage uniquement. Le code vit dans des modules :
//   config/   chemins des données, secrets
//   core/     stockage JSON et verrous, temps/fuseaux, SLA, assainissement, audit
//   http/     durcissement, journal, coquille admin, fichiers statiques, erreurs
//   auth/     sessions (admin, absences, FO) et gardiens de routes
//   services/ logique métier (rapports, diffusion par mail, absences, rota…)
//   routes/   un routeur Express par domaine
//   documents/, quiz/  générateurs PPTX/PDF, banques de quiz
//
// Version de Node vérifiée AVANT de charger quoi que ce soit : sur un Node
// trop ancien, le premier module qui emploie `?.` ou `??` (le nôtre ou une
// dépendance) plante avec un « SyntaxError: Unexpected token » illisible.
// Ce fichier-ci reste donc écrit dans une syntaxe que tout Node comprend.
var NODE_MIN = 18;
if (parseInt(process.versions.node, 10) < NODE_MIN) {
  console.error('\n  Pear demande Node.js ' + NODE_MIN + ' ou plus récent (20 conseillé).');
  console.error('  Version installée : ' + process.version + '  (' + process.execPath + ')');
  console.error('  Mise à jour : voir « Prérequis » dans le README.\n');
  process.exit(1);
}

// `dotenv` doit être chargé AVANT tout autre module : plusieurs lisent
// process.env dès leur chargement (secrets, DATA_DIR, LOG_HTTP…).
require('dotenv').config({ quiet: true });   // sans la publicité de dotenv 17 dans le journal
require('./config/runtime').applyRuntimeDefaults();

const { DATA_DIR } = require('./config/paths');
const { _locks, getPendingWrites } = require('./core/store');
const tls = require('./http/tls');
const { startScheduler } = require('./services/mail/scheduler');
const { backupData } = require('./services/backups');
const { createApp } = require('./app');

const PORT = process.env.PORT || 3000;
// Adresse d'écoute. Par défaut toutes les interfaces, pour que la VM soit
// joignable depuis le réseau ; mettre HOST=127.0.0.1 pour la restreindre.
const HOST = process.env.HOST || '0.0.0.0';
const app = createApp();

// Diffusion par mail : réveil chaque minute (voir services/mail/scheduler.js).
startScheduler();

process.on('uncaughtException', err => {
  console.error('[Pear] Uncaught exception:', err);
});

process.on('unhandledRejection', err => {
  console.error('[Pear] Unhandled rejection:', err);
});

// Une copie au démarrage — c'est le moment où l'on vient souvent de
// toucher aux données — puis une par jour. Le poste serveur peut être
// éteint la nuit : un intervalle simple est plus fiable ici qu'une heure
// fixe qui serait manquée à chaque extinction.
backupData();
setInterval(backupData, 24 * 60 * 60 * 1000).unref();

// Corrections de nom d'agent demandées (services/rename-agent.js), après la
// sauvegarde : en cas de souci, la copie du jour a l'état d'avant.
require('./platform/tenants').forEachTenant(() => require('./services/rename-agent').appliquerCorrections())
  .catch(e => console.error('[Pear] Corrections :', e.message));

// Insights des agents : passes automatiques (services/ai-insight.js).
try { require('./services/ai-insight').demarrerAuto(); } catch (e) { console.error('[Pear] Insights :', e.message); }

const server = app.listen(PORT, HOST, () => {
  console.log(`\n  Pear running at http://localhost:${PORT}  (écoute ${HOST}:${PORT})`);
  const { backend } = require('./core/backend');
  console.log(`  stockage : ${backend().kind}${backend().kind === 'fs' ? ` (${DATA_DIR})` : ''} · ${require('./core/tenant').isMultiTenant() ? `multi-tenant (*.${require('./platform/tenants').baseDomain()})` : 'mono-tenant'}\n`);
});
// HTTPS en plus, si un certificat est configuré (voir http/tls.js).
const serverTls = tls.demarrer(app, HOST);

// ── ARRÊT PROPRE ──────────────────────────────────────────────
// Ctrl-C envoie SIGINT, `kill` envoie SIGTERM. Sans traitement, le process meurt
// sur-le-champ : une écriture en cours peut être coupée entre le fichier
// temporaire et le renommage, et les requêtes en vol tombent sans réponse.
// On ferme donc l'écoute, puis on attend que la file d'écritures se vide.
let shuttingDown = false;

async function gracefulShutdown(signal) {
  if (shuttingDown) return;          // un second Ctrl-C ne doit pas relancer la séquence
  shuttingDown = true;
  console.log(`[Pear] ${signal} received — shutting down…`);

  // On cesse d'accepter de nouvelles connexions ; celles en cours finissent.
  server.close(() => console.log('[Pear] HTTP server closed.'));
  if (serverTls) serverTls.close();

  // Les écritures passent toutes par withLock : attendre que les chaînes
  // de verrous se résolvent garantit qu'aucun writeJSON n'est à mi-course.
  try {
    await Promise.race([
      Promise.allSettled(Object.values(_locks)),
      new Promise(r => setTimeout(r, 5000)),   // filet : on ne bloque pas indéfiniment
    ]);
  } catch { /* une écriture ratée ne doit pas empêcher l'arrêt */ }

  // Stockage distant : attendre que les écritures en arrière-plan partent.
  try {
    await Promise.race([require('./core/backend').backend().flush(), new Promise(r => setTimeout(r, 8000))]);
  } catch { /* idem */ }

  if (getPendingWrites() > 0)
    console.warn(`[Pear] Shutting down with ${getPendingWrites()} write(s) still queued.`);
  console.log('[Pear] Shutdown complete.');
  process.exit(0);
}

for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => gracefulShutdown(sig));
