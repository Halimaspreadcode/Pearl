const fs    = require('fs');
const https = require('https');

// ── HTTPS ─────────────────────────────────────────────────────
// Sans HTTPS, mots de passe, codes d'agents et jetons de session passent
// en clair sur le réseau. Node sert lui-même le HTTPS dès que .env donne
// un certificat — pas besoin de nginx :
//
//   TLS_CERT=data/tls/server.crt
//   TLS_KEY=data/tls/server.key
//   HTTPS_PORT=3443            (facultatif, 3443 par défaut)
//
// `npm run https:setup` crée ces fichiers (voir scripts/https-setup.js).
//
// Le serveur HTTP habituel reste ouvert sur PORT, mais ne sert plus que la
// machine elle-même (watchdog, scripts de service) : tout autre poste est
// renvoyé vers l'adresse HTTPS.

const CERT = process.env.TLS_CERT || '';
const KEY  = process.env.TLS_KEY  || '';
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443;

// Lu une fois au chargement : si le certificat est illisible, le HTTPS
// reste éteint ET la redirection aussi — sinon on renverrait tout le monde
// vers un port qui n'écoute pas.
let options = null;
if (CERT && KEY) {
  try {
    options = { cert: fs.readFileSync(CERT), key: fs.readFileSync(KEY), minVersion: 'TLSv1.2' };
  } catch (e) {
    console.error(`[Pear] HTTPS désactivé : certificat illisible (${e.message}).`);
  }
}
const actif = !!options;

const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;

function hstsEtRedirection(req, res, next) {
  if (!actif) return next();
  if (req.socket.encrypted) {
    // Six mois. Pas de includeSubDomains : l'hôte est une IP ou un nom
    // interne, on ne décide pas pour les voisins.
    res.set('Strict-Transport-Security', 'max-age=15552000');
    return next();
  }
  if (LOOPBACK.test(req.socket.remoteAddress || '')) return next();
  const hote = String(req.headers.host || '').replace(/:\d+$/, '').replace(/[^\w.\-\[\]:]/g, '');
  if (!hote) return res.status(400).end();
  return res.redirect(301, `https://${hote}:${HTTPS_PORT}${req.originalUrl}`);
}

function demarrer(app, host) {
  if (!actif) return null;
  const srv = https.createServer(options, app);
  srv.listen(HTTPS_PORT, host, () => {
    console.log(`  HTTPS actif : https://<adresse>:${HTTPS_PORT}  (HTTP réservé à la machine locale)\n`);
  });
  srv.on('error', e => console.error(`[Pear] HTTPS : ${e.message}`));
  return srv;
}

// Le certificat PUBLIC de l'autorité locale, à installer sur les postes.
// Jamais la clé : seul ca.crt est servi.
const path = require('path');
const CA_CRT = path.join(path.dirname(path.resolve(CERT || 'data/tls/server.crt')), 'ca.crt');
function routeCa(req, res, next) {
  if (req.path !== '/pearl-ca.crt' || req.method !== 'GET') return next();
  if (!fs.existsSync(CA_CRT)) return res.status(404).end();
  res.set('Content-Type', 'application/x-x509-ca-cert');
  res.set('Content-Disposition', 'attachment; filename="pearl-ca.crt"');
  res.sendFile(CA_CRT);
}

module.exports = { hstsEtRedirection, demarrer, routeCa, actif, HTTPS_PORT };
