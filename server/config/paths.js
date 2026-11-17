const path        = require('path');

// Répertoire des données. DATA_DIR permet de faire tourner une instance de
// test sur un jeu de fichiers distinct, sans toucher aux données de prod.
const DATA_DIR   = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '../../data');
const FILES = {
  sn:              path.join(DATA_DIR, 'sn.json'),
  ci:              path.join(DATA_DIR, 'ci.json'),
  observations:    path.join(DATA_DIR, 'observations.json'),
  audit:           path.join(DATA_DIR, 'audit.json'),
  config:          path.join(DATA_DIR, 'config.json'),
  bo:              path.join(DATA_DIR, 'bo_list.json'),
  legacy:          path.join(DATA_DIR, 'tickets.json'),
  shifts_plan:     path.join(DATA_DIR, 'shifts_plan.json'),
  fo_tasks:        path.join(DATA_DIR, 'fo_tasks.json'),
  holidays:        path.join(DATA_DIR, 'holidays.json'),
  shift_requests:  path.join(DATA_DIR, 'shift_requests.json'),
  quizzes:         path.join(DATA_DIR, 'quizzes.json'),
  quiz_results:    path.join(DATA_DIR, 'quiz_results.json'),
  quiz_progress:   path.join(DATA_DIR, 'quiz_progress.json'),
  // Progression de la formation DigitalView (public/formation), par agent.
  formation_progress: path.join(DATA_DIR, 'formation_progress.json'),
  // Progression de la formation Process ITSM (public/formation/process.html).
  formation_process_progress: path.join(DATA_DIR, 'formation_process_progress.json'),
  // Progression de la formation Mobile Money 2.0 (public/formation/mobilemoney.html).
  formation_mobilemoney_progress: path.join(DATA_DIR, 'formation_mobilemoney_progress.json'),
  // Progression de la formation Data center (public/formation/datacenter.html).
  formation_datacenter_progress: path.join(DATA_DIR, 'formation_datacenter_progress.json'),
  // Progression de la formation Réseaux (public/formation/reseau.html).
  formation_reseau_progress: path.join(DATA_DIR, 'formation_reseau_progress.json'),
  // Clé de l'assistant IA : hors de git (.gitignore) et hors des
  // sauvegardes (qui ne copient que les .json). Voir services/ai.js.
  // Insights Big Brother des agents, gardés pour ne pas rappeler le modèle
  // à chaque ouverture de la page.
  ai_insights:     path.join(DATA_DIR, 'ai_insights.json'),
  // Résultats de skills épinglés sur l'accueil de Big Brother.
  ai_pins:         path.join(DATA_DIR, 'ai_pins.json'),
  // Base de connaissances de Big Brother : documents importés, découpés
  // en passages (services/ai-kb.js).
  ai_kb:           path.join(DATA_DIR, 'ai_kb.json'),
  // Vecteurs (embeddings) des passages, un fichier par document.
  ai_kb_vec:       path.join(DATA_DIR, 'ai_kb_vec'),
  // Connecteur IMOC (outil de tickets du réseau) : réglages non secrets et
  // dernier relevé. Les identifiants ne sont jamais enregistrés.
  imoc:            path.join(DATA_DIR, 'imoc.json'),
  imoc_tickets:    path.join(DATA_DIR, 'imoc_tickets.json'),
  // Indicateurs (KPI / PI) définis avec l'IA puis suivis automatiquement.
  indicateurs:     path.join(DATA_DIR, 'indicateurs.json'),
  ai_secret:       path.join(DATA_DIR, 'ai.secret'),
  team_secret:     path.join(DATA_DIR, 'team-access.secret'),
  quiz_published:  path.join(DATA_DIR, 'quiz_published.json'),
  weekly_progress: path.join(DATA_DIR, 'weekly_progress.json'),
  report_layout:   path.join(DATA_DIR, 'report_layout.json'),
  absences:        path.join(DATA_DIR, 'absences.json'),
  ideas:           path.join(DATA_DIR, 'ideas.json'),
  ideas_share:     path.join(DATA_DIR, 'ideas-share.json'),
  user_prefs:      path.join(DATA_DIR, 'user_prefs.json'),
  announcements:   path.join(DATA_DIR, 'announcements.json'),
  trainings:       path.join(DATA_DIR, 'trainings.json'),
  // Diffusion par mail : groupes de destinataires + planifications d'un
  // côté, journal des envois de l'autre. Deux fichiers parce qu'ils ne
  // vivent pas au même rythme — la configuration change rarement, le
  // journal grossit à chaque envoi.
  mailing:         path.join(DATA_DIR, 'mailing.json'),
  mail_log:        path.join(DATA_DIR, 'mail_log.json'),
  // Brouillons des rapports (highlights, risques, actions). Ils vivaient
  // en localStorage, donc dans un seul navigateur : le serveur ne pouvait
  // pas les joindre à un envoi programmé, et un daily expédié à 8 h
  // arrivait amputé de tout ce qui avait été rédigé à la main.
  report_drafts:   path.join(DATA_DIR, 'report_drafts.json'),
  // Derniers classeurs produits par la page, pour que l'envoi programmé
  // expédie le rapport réellement mis en forme. Voir REPORTS_DIR.
  report_files:    path.join(DATA_DIR, 'report_files.json'),
};

module.exports = {
  DATA_DIR, FILES,
};
