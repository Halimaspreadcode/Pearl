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
  console.error('\n  Pearl demande Node.js ' + NODE_MIN + ' ou plus récent (20 conseillé).');
  console.error('  Version installée : ' + process.version + '  (' + process.execPath + ')');
  console.error('  Mise à jour : voir « Prérequis » dans le README.\n');
  process.exit(1);
}

// `dotenv` doit être chargé AVANT tout autre module : plusieurs lisent
// process.env dès leur chargement (secrets, DATA_DIR, LOG_HTTP…).
require('dotenv').config({ quiet: true });   // sans la publicité de dotenv 17 dans le journal

const express     = require('express');
const { DATA_DIR } = require('./config/paths');
const { _locks, getPendingWrites } = require('./core/store');
const { apiRateLimit, corsMiddleware, securityHeaders } = require('./http/security');
const { requestLog } = require('./http/request-log');
const { errorHandler } = require('./http/error-handler');
const tls = require('./http/tls');
const { startScheduler } = require('./services/mail/scheduler');
const { backupData } = require('./services/backups');
const shellRoutes = require('./http/shell');
const staticRoutes = require('./http/static');
const statusRoutes = require('./routes/status');
const boRoutes = require('./routes/bo');
const configRoutes = require('./routes/config');
const authRoutes = require('./routes/auth');
const kpiConfigRoutes = require('./routes/kpi-config');
const suggestRoutes = require('./routes/suggest');
const ticketsRoutes = require('./routes/tickets');
const observationsRoutes = require('./routes/observations');
const reportLayoutRoutes = require('./routes/report-layout');
const reportFilesRoutes = require('./routes/report-files');
const mailingRoutes = require('./routes/mailing');
const auditRoutes = require('./routes/audit');
const dashboardRoutes = require('./routes/dashboard');
const reportsRoutes = require('./routes/reports');
const shiftsPlanRoutes = require('./routes/shifts-plan');
const foTasksRoutes = require('./routes/fo-tasks');
const weeklyProgressRoutes = require('./routes/weekly-progress');
const announcementsRoutes = require('./routes/announcements');
const perfRoutes = require('./routes/perf');
const objectivesAgentRoutes = require('./routes/objectives-agent');
const objectivesAdminRoutes = require('./routes/objectives-admin');
const objectiveSessionsRoutes = require('./routes/objective-sessions');
const foAccessRoutes = require('./routes/fo-access');
const trainingsRoutes = require('./routes/trainings');
const quizRoutes = require('./routes/quiz');
const rotaRoutes = require('./routes/rota');
const userPrefsRoutes = require('./routes/user-prefs');
const holidaysRoutes = require('./routes/holidays');
const absencesRoutes = require('./routes/absences');
const shiftRequestsRoutes = require('./routes/shift-requests');
const presenceRoutes = require('./routes/presence');
const formationRoutes = require('./routes/formation');
const formationAskRoutes = require('./routes/formation-ask');
const academyRoutes = require('./routes/academy');
const aiRoutes = require('./routes/ai');
const indicateursRoutes = require('./routes/indicateurs');
const partiesRoutes = require('./routes/parties');
const aiInsightRoutes = require('./routes/ai-insight');
const teamAccessRoutes = require('./routes/team-access');
const ideasRoutes = require('./routes/ideas');
const { teamGate, teamGateStatique } = require('./auth/team-gate');

const app  = express();
const PORT = process.env.PORT || 3000;
// Adresse d'écoute. Par défaut toutes les interfaces, pour que la VM soit
// joignable depuis le réseau ; mettre HOST=127.0.0.1 pour la restreindre.
const HOST = process.env.HOST || '0.0.0.0';

// Derrière un reverse-proxy, `req.secure` et l'IP client viennent des
// en-têtes X-Forwarded-*. Sans ceci le cookie admin ne serait jamais posé
// en `secure`, et le rate-limit compterait toutes les requêtes sur l'IP
// du proxy — donc bloquerait tout le monde d'un coup.
//
// « loopback » et non plus « 1 » : avec 1, n'importe quel poste pouvait
// envoyer son propre X-Forwarded-For et changer d'IP à chaque requête, ce
// qui annulait le rate-limit des mots de passe. Seul un proxy installé
// sur la machine elle-même (nginx) est maintenant cru.
// TRUST_PROXY (facultatif) : adresse du proxy de l'entreprise dont on croit
// le X-Forwarded-For, ex. TRUST_PROXY=loopback,172.18.208.222.
app.set('trust proxy', (process.env.TRUST_PROXY || 'loopback').split(',').map(s => s.trim()).filter(Boolean));

app.use(securityHeaders);
app.use(tls.hstsEtRedirection);

app.use(corsMiddleware);

app.use(express.json({ limit: '10mb' }));

app.use(requestLog);

app.use('/api', apiRateLimit);
// Verrou d'équipe (auth/team-gate.js) : toute l'API exige une session dès
// qu'un mot de passe d'équipe est défini.
app.use('/api', teamGate);
// Identité vérifiée et signature des écritures (auth/identity.js). Le corps
// JSON doit être lu avant : express.json est monté plus haut.
app.use('/api', require('./auth/identity').identite);
app.use(teamGateStatique);
app.use(tls.routeCa);
// Zone admin AVANT express.static : sinon le HTML admin serait servi par
// son nom de fichier, sans passer par le gardien (voir http/shell.js).
app.use(shellRoutes);
app.use(staticRoutes);

// Diffusion par mail : réveil chaque minute (voir services/mail/scheduler.js).
startScheduler();

// Routes de l'API. L'ordre de montage reprend l'ordre historique des
// déclarations : Express essaie les routes dans cet ordre, il fait donc
// partie du comportement (ex. /api/fo-access/login avant /api/fo-access/:fo).
app.use(statusRoutes);
app.use(teamAccessRoutes);
app.use(ideasRoutes);
app.use(boRoutes);
app.use(configRoutes);
app.use(authRoutes);
app.use(kpiConfigRoutes);
app.use(suggestRoutes);   // avant tickets : /api/sn/suggest n'est pas /api/sn/:id
app.use(ticketsRoutes);
app.use(observationsRoutes);
app.use(reportLayoutRoutes);
app.use(reportFilesRoutes);
app.use(mailingRoutes);
app.use(auditRoutes);
app.use(dashboardRoutes);
app.use(reportsRoutes);
app.use(shiftsPlanRoutes);
app.use(foTasksRoutes);
app.use(weeklyProgressRoutes);
app.use(announcementsRoutes);
app.use(perfRoutes);
app.use(objectivesAgentRoutes);
app.use(objectivesAdminRoutes);
app.use(objectiveSessionsRoutes);
app.use(foAccessRoutes);
app.use(trainingsRoutes);
app.use(quizRoutes);
app.use(rotaRoutes);
app.use(userPrefsRoutes);
app.use(holidaysRoutes);
app.use(absencesRoutes);
app.use(shiftRequestsRoutes);
app.use(presenceRoutes);
app.use(formationRoutes);
app.use(formationAskRoutes);
app.use(academyRoutes);
app.use(aiRoutes);
app.use(indicateursRoutes);
app.use(partiesRoutes);
app.use(aiInsightRoutes);

// Toujours en dernier (voir http/error-handler.js).
app.use(errorHandler);

process.on('uncaughtException', err => {
  console.error('[Pearl] Uncaught exception:', err);
});

process.on('unhandledRejection', err => {
  console.error('[Pearl] Unhandled rejection:', err);
});

// Une copie au démarrage — c'est le moment où l'on vient souvent de
// toucher aux données — puis une par jour. Le poste serveur peut être
// éteint la nuit : un intervalle simple est plus fiable ici qu'une heure
// fixe qui serait manquée à chaque extinction.
backupData();
setInterval(backupData, 24 * 60 * 60 * 1000).unref();

// Corrections de nom d'agent demandées (services/rename-agent.js), après la
// sauvegarde : en cas de souci, la copie du jour a l'état d'avant.
require('./services/rename-agent').appliquerCorrections().catch(e => console.error('[Pearl] Corrections :', e.message));

// Insights des agents : passes automatiques (services/ai-insight.js).
try { require('./services/ai-insight').demarrerAuto(); } catch (e) { console.error('[Pearl] Insights :', e.message); }

const server = app.listen(PORT, HOST, () => {
  console.log(`\n  Pearl running at http://localhost:${PORT}  (écoute ${HOST}:${PORT})`);
  console.log(`  données : ${DATA_DIR}\n`);
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
  console.log(`[Pearl] ${signal} received — shutting down…`);

  // On cesse d'accepter de nouvelles connexions ; celles en cours finissent.
  server.close(() => console.log('[Pearl] HTTP server closed.'));
  if (serverTls) serverTls.close();

  // Les écritures passent toutes par withLock : attendre que les chaînes
  // de verrous se résolvent garantit qu'aucun writeJSON n'est à mi-course.
  try {
    await Promise.race([
      Promise.allSettled(Object.values(_locks)),
      new Promise(r => setTimeout(r, 5000)),   // filet : on ne bloque pas indéfiniment
    ]);
  } catch { /* une écriture ratée ne doit pas empêcher l'arrêt */ }

  if (getPendingWrites() > 0)
    console.warn(`[Pearl] Shutting down with ${getPendingWrites()} write(s) still queued.`);
  console.log('[Pearl] Shutdown complete.');
  process.exit(0);
}

for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => gracefulShutdown(sig));
