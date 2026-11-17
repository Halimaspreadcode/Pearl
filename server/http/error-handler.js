const { LOG_HTTP } = require('./request-log');

// ── GESTIONNAIRE D'ERREURS EXPRESS ────────────────────────────
// Dernier maillon : sans lui, une exception dans un handler part en page
// HTML d'erreur d'Express, que le front — qui attend du JSON — n'affiche
// pas. Il doit garder ses quatre paramètres, c'est ce qui le distingue
// d'un middleware ordinaire aux yeux d'Express.
const errorHandler = (err, req, res, _next) => {
  // Corps illisible ou trop volumineux : la faute est au client, pas au
  // serveur. Renvoyer 500 mentait sur l'origine du problème et remplissait
  // le journal de fausses pannes, au risque de masquer les vraies. Ces
  // deux cas sont donc triés avant, et journalisés comme un simple refus.
  // `express.json()` s'exécute avant le middleware de journal : un corps
  // invalide n'atteint donc jamais ce dernier. Sans la ligne ci-dessous,
  // ces refus ne laisseraient aucune trace — on la pose ici, au même
  // format que le journal des requêtes, mais sans pile d'appels.
  const clientFault = err?.type === 'entity.parse.failed' ? [400, 'Invalid JSON body.']
                    : err?.type === 'entity.too.large'   ? [413, 'Payload too large.']
                    : null;
  if (clientFault) {
    const [code, message] = clientFault;
    if (LOG_HTTP) console.log([
      new Date().toISOString(), req.method, code, '-',
      req.ip || '-', req.originalUrl.split('?')[0],
    ].join(' '));
    if (res.headersSent) return;
    return res.status(code).json({ error: message });
  }

  console.error('[EMOC] Unhandled error:', req.method, req.originalUrl, err);
  if (res.headersSent) return;
  // Le détail part dans le journal, pas au client : un message d'erreur
  // brut expose volontiers des chemins de fichiers.
  res.status(500).json({ error: 'Internal server error.' });
};

module.exports = {
  errorHandler,
};
