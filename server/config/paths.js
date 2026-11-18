const path        = require('path');
const { currentTenant, DEFAULT_TENANT } = require('../core/tenant');

// Répertoire des données. DATA_DIR permet de faire tourner une instance de
// test sur un jeu de fichiers distinct, sans toucher aux données de prod.
const DATA_DIR   = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '../../data');
const NAMES = {
  sn:              'sn.json',
  ci:              'ci.json',
  observations:    'observations.json',
  audit:           'audit.json',
  config:          'config.json',
  bo:              'bo_list.json',
  legacy:          'tickets.json',
  shifts_plan:     'shifts_plan.json',
  fo_tasks:        'fo_tasks.json',
  holidays:        'holidays.json',
  shift_requests:  'shift_requests.json',
  quizzes:         'quizzes.json',
  quiz_results:    'quiz_results.json',
  quiz_progress:   'quiz_progress.json',
  // Progression de la formation DigitalView (public/formation), par agent.
  formation_progress: 'formation_progress.json',
  // Progression de la formation Process ITSM (public/formation/process.html).
  formation_process_progress: 'formation_process_progress.json',
  // Progression de la formation Mobile Money 2.0 (public/formation/mobilemoney.html).
  formation_mobilemoney_progress: 'formation_mobilemoney_progress.json',
  // Progression de la formation Data center (public/formation/datacenter.html).
  formation_datacenter_progress: 'formation_datacenter_progress.json',
  // Progression de la formation Réseaux (public/formation/reseau.html).
  formation_reseau_progress: 'formation_reseau_progress.json',
  // Clé de l'assistant IA : hors de git (.gitignore) et hors des
  // sauvegardes (qui ne copient que les .json). Voir services/ai.js.
  // Insights Pear AI des agents, gardés pour ne pas rappeler le modèle
  // à chaque ouverture de la page.
  ai_insights:     'ai_insights.json',
  // Résultats de skills épinglés sur l'accueil de Pear AI.
  ai_pins:         'ai_pins.json',
  // Base de connaissances de Pear AI : documents importés, découpés
  // en passages (services/ai-kb.js).
  ai_kb:           'ai_kb.json',
  // Vecteurs (embeddings) des passages, un fichier par document.
  ai_kb_vec:       'ai_kb_vec',
  // Indicateurs (KPI / PI) définis avec l'IA puis suivis automatiquement.
  indicateurs:     'indicateurs.json',
  // Tableau de bord composable : dispositions et indicateurs business.
  home:            'home.json',
  ai_secret:       'ai.secret',
  team_secret:     'team-access.secret',
  quiz_published:  'quiz_published.json',
  weekly_progress: 'weekly_progress.json',
  report_layout:   'report_layout.json',
  absences:        'absences.json',
  ideas:           'ideas.json',
  ideas_share:     'ideas-share.json',
  user_prefs:      'user_prefs.json',
  announcements:   'announcements.json',
  trainings:       'trainings.json',
  // Diffusion par mail : groupes de destinataires + planifications d'un
  // côté, journal des envois de l'autre. Deux fichiers parce qu'ils ne
  // vivent pas au même rythme — la configuration change rarement, le
  // journal grossit à chaque envoi.
  mailing:         'mailing.json',
  mail_log:        'mail_log.json',
  // Brouillons des rapports (highlights, risques, actions). Ils vivaient
  // en localStorage, donc dans un seul navigateur : le serveur ne pouvait
  // pas les joindre à un envoi programmé, et un daily expédié à 8 h
  // arrivait amputé de tout ce qui avait été rédigé à la main.
  report_drafts:   'report_drafts.json',
  // Derniers classeurs produits par la page, pour que l'envoi programmé
  // expédie le rapport réellement mis en forme. Voir REPORTS_DIR.
  report_files:    'report_files.json',
};

// Dossier des données d'un tenant. Le tenant « default » garde le
// dossier historique (DATA_DIR) ; les autres ont le leur, à part.
function tenantDir(tenant = currentTenant()) {
  return tenant === DEFAULT_TENANT ? DATA_DIR : path.join(DATA_DIR, 'tenants', tenant);
}
const dataDir = () => tenantDir();

// Fichier des tickets d'un site (code « SN » → sn.json : les fichiers
// existants restent valides).
const SITE_CODE_RE = /^[A-Z0-9]{2,8}$/;
function siteFile(code, tenant) {
  const c = String(code || '').toUpperCase();
  if (!SITE_CODE_RE.test(c)) throw Object.assign(new Error(`Code de site invalide : ${code}`), { status: 400 });
  return path.join(tenantDir(tenant), `${c.toLowerCase()}.json`);
}

// FILES.x donne le chemin de x POUR LE TENANT COURANT, calculé à chaque
// accès : ne jamais le recopier dans une constante au chargement d'un
// module. FILES.sn / FILES.ci (et tout code de site) restent acceptés.
const FILES = new Proxy(NAMES, {
  get(target, key) {
    if (typeof key !== 'string') return undefined;
    if (Object.prototype.hasOwnProperty.call(target, key)) return path.join(tenantDir(), target[key]);
    if (SITE_CODE_RE.test(key.toUpperCase()) && /^[a-z0-9]+$/i.test(key)) return siteFile(key);
    return undefined;
  },
  has(target, key) { return Object.prototype.hasOwnProperty.call(target, key); },
});

module.exports = {
  DATA_DIR, FILES, NAMES, tenantDir, dataDir, siteFile, SITE_CODE_RE,
};
