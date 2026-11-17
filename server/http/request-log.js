// ── JOURNAL DES REQUÊTES ──────────────────────────────────────
// Sans dépendance : une ligne par requête, en UTC comme le reste de
// l'app. L'audit métier dit qui a changé quel ticket ; ceci dit ce que
// le serveur a reçu — c'est ce qui manquait pour relire un incident.
// Les lectures sont bruyantes et sans intérêt : on ne trace que les
// écritures, les erreurs et les refus d'authentification.
const LOG_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Écritures purement techniques, répétées en boucle par le client. Le
// battement de présence part toutes les 30 s et par onglet ouvert : tracé,
// il noie les écritures qui méritent d'être relues. Un échec reste visible,
// puisque le filtre ne s'applique qu'aux réponses réussies.
const LOG_MUTE = [
  '/api/presence/ping',
  '/api/presence/leave',
];

// 404 que le NAVIGATEUR provoque tout seul, sans que personne ait cliqué.
// Elles étaient tracées parce que le filtre ne dispense que les réponses
// réussies : un GET 404 passait donc toujours. Or aucune ne signale un
// problème — ce sont des fichiers que Chrome DevTools cherche d'office et
// qui n'existent pas en production :
//
//   /.well-known/appspecific/com.chrome.devtools.json  sonde de DevTools
//   *.map                                              source maps
//
// Un 404 sur une vraie route de l'application reste tracé : c'est le
// symptôme d'un lien mort ou d'un appel erroné, et il doit se voir.
const LOG_MUTE_404 = [
  '/.well-known/',
  '/favicon.ico',
];
function bruitDeNavigateur(chemin) {
  return chemin.endsWith('.map') || LOG_MUTE_404.some(p => chemin.startsWith(p));
}

// Interrupteur général : LOG_HTTP=0 coupe le journal des requêtes, sans
// toucher aux erreurs serveur (console.error), qui restent toujours
// affichées — les couper masquerait de vrais incidents.
const LOG_HTTP = process.env.LOG_HTTP !== '0';

const requestLog = (req, res, next) => {
  if (!LOG_HTTP) return next();
  const started = Date.now();
  res.on('finish', () => {
    if (!LOG_METHODS.has(req.method) && res.statusCode < 400) return;
    if (res.statusCode < 400 && LOG_MUTE.includes(req.path)) return;
    if (res.statusCode === 404 && bruitDeNavigateur(req.path)) return;
    // Jamais le corps : il porte des mots de passe sur les routes d'auth.
    console.log([
      new Date().toISOString(),
      req.method,
      res.statusCode,
      `${Date.now() - started}ms`,
      req.ip || '-',
      req.originalUrl.split('?')[0],
    ].join(' '));
  });
  next();
};

module.exports = {
  LOG_HTTP, requestLog,
};
