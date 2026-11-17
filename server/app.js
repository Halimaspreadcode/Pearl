// ══════════════════════════════════════════════════════════════
// APPLICATION EXPRESS
//
// createApp() monte les middlewares et les routes, sans écouter ni lancer
// de tâche de fond : index.js le fait en production, les tests montent
// l'application telle quelle.
// ══════════════════════════════════════════════════════════════
const express     = require('express');
const { apiRateLimit, corsMiddleware, securityHeaders } = require('./http/security');
const { requestLog } = require('./http/request-log');
const { errorHandler } = require('./http/error-handler');
const tls = require('./http/tls');
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

function createApp() {
const app  = express();

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

// Organisation (tenant) de la requête : sous-domaine ou domaine
// personnalisé (platform/tenants.js). Tout ce qui suit s'exécute dans son
// contexte ; le domaine nu de la plateforme est servi par platformRoutes.
app.use(require('./platform/tenants').tenantMiddleware());
app.use(require('./platform/routes'));

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

// Routes de l'API. L'ordre de montage reprend l'ordre historique des
// déclarations : Express essaie les routes dans cet ordre, il fait donc
// partie du comportement (ex. /api/fo-access/login avant /api/fo-access/:fo).
app.use(statusRoutes);
app.use(teamAccessRoutes);
app.use(ideasRoutes);
app.use(boRoutes);
app.use(configRoutes);
app.use(require('./routes/sites'));
app.use(authRoutes);
app.use(kpiConfigRoutes);
app.use(suggestRoutes);   // avant tickets : /api/tickets/:site/suggest n'est pas …/:id
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

return app;
}

module.exports = { createApp };
