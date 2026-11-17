const cors        = require('cors');
const helmet      = require('helmet');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// ── DURCISSEMENT HTTP ─────────────────────────────────────────
// La CSP décrit ce que l'app fait réellement aujourd'hui, pas un idéal :
// le front porte des <script> et <style> en ligne et près de 170 attributs
// `style=`, donc 'unsafe-inline' reste nécessaire tant que ce balisage
// n'a pas été extrait. Elle bride malgré tout l'essentiel — aucun script
// distant ne peut être chargé (tout vient de /vendor), `object-src 'none'`
// ferme les greffons et `connect-src 'self'` empêche l'exfiltration de
// données vers un autre hôte.
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      // Plus aucun script externe : ExcelJS et JSZip sont servis depuis
      // /vendor. Seul le code de l'application peut donc s'exécuter.
      scriptSrc:   ["'self'", "'unsafe-inline'"],
      styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:     ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc:      ["'self'", 'data:', 'blob:'],
      connectSrc:  ["'self'"],
      objectSrc:   ["'none'"],
      frameAncestors: ["'self'"],
      formAction:  ["'self'"],
      // Helmet pose `script-src-attr 'none'` par défaut, ce qui coupe
      // TOUS les gestionnaires en ligne — l'app en compte plus de 200
      // (`onclick=`), donc plus un seul bouton ne répondrait. On le
      // rouvre explicitement ; c'est `escAttrArg()` côté client qui
      // empêche une donnée saisie d'y injecter du code.
      scriptSrcAttr: ["'unsafe-inline'"],
      // Le déploiement est en HTTP sur le réseau interne : la directive
      // par défaut ferait basculer chaque requête en HTTPS, vers un port
      // qui n'écoute pas. On la retire au lieu de la subir.
      upgradeInsecureRequests: null,
    },
  },
  // HSTS n'est posé que sur les réponses HTTPS, par http/tls.js : sur un
  // déploiement encore en HTTP, il enfermerait les navigateurs sur un
  // HTTPS qui n'existe pas.
  hsts: false,
  // L'aperçu PPTX et les exports ouvrent des blob: — la politique par
  // défaut (`same-origin`) les casse.
  crossOriginResourcePolicy: { policy: 'same-site' },
  crossOriginOpenerPolicy: false,
  crossOriginEmbedderPolicy: false,
});

// ── CORS ──────────────────────────────────────────────────────
// Le déploiement est interne : le front est servi par ce même serveur,
// donc aucune origine tierce n'a de raison légitime d'appeler l'API.
// On accepte les requêtes sans origine (curl, health-check, navigation
// directe).
const CORS_EXTRA = String(process.env.CORS_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

// Seule la page servie par CE serveur (même hôte) et les origines listées
// dans CORS_ORIGINS sont admises. Accepter toute adresse privée laissait
// n'importe quel autre site interne (une autre VM en 10.x) lire l'API au
// nom de l'utilisateur, cookies compris.
function memeHote(req, origin) {
  try { return new URL(origin).host === String(req.headers.host || ''); }
  catch { return false; }
}

const corsMiddleware = cors((req, cb) => {
  const origin = req.headers.origin;
  const ok = !origin || CORS_EXTRA.includes(origin) || memeHote(req, origin);
  cb(null, { origin: ok, credentials: true });
});

// ── RATE-LIMIT GLOBAL ─────────────────────────────────────────
// Filet large, très au-dessus d'un usage humain normal : il n'est pas là
// pour brider l'équipe mais pour empêcher qu'un client en boucle folle
// ou un script égaré ne sature le serveur. `authLimiter` reste bien plus
// strict sur les routes de mot de passe.
const apiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  // 600/min par session ; sans session, la clé est l'adresse, qui peut être
  // celle du proxy de l'entreprise pour toute l'équipe : plafond bien plus
  // haut, sinon chaque écran tombait en « Chargement impossible ».
  max: req => (cleSession(req) ? 600 : 6000),
  standardHeaders: true,
  legacyHeaders: false,
  // Le battement de présence est fréquent et sans effet de bord : le
  // compter rapprocherait de la limite sans raison. Idem pour /version,
  // interrogé par chaque onglet ouvert (auto-reload.js).
  skip: req => req.path === '/presence/ping' || req.path === '/version',
  // Par session plutôt que par IP : derrière le proxy de l'entreprise,
  // toute l'équipe arrive avec la même adresse et se partageait sinon les
  // 600 requêtes de la minute — d'où des refus en pleine journée.
  keyGenerator: (req) => cleSession(req) || ipKeyGenerator(req.ip || ''),
  message: { error: 'Too many requests, please wait a moment.' },
  // Trace côté serveur : un refus du filet ne doit plus passer inaperçu.
  handler: (req, res, _next, options) => {
    const now = Date.now();
    if (now - _dernierAvis > 60 * 1000) {
      _dernierAvis = now;
      console.warn(`[EMOC] Limite de requêtes atteinte (${cleSession(req) ? 'session' : 'adresse ' + req.ip}) sur ${req.originalUrl.split('?')[0]}.`);
    }
    res.status(options.statusCode).json(options.message);
  },
});
let _dernierAvis = 0;

// Mots de passe et codes : seuls les ÉCHECS comptent (une connexion réussie
// ne rapproche plus du blocage — la session Performance expirant toutes les
// 30 min, un agent qui se reconnectait souvent finissait bloqué), et le
// plafond vise le COMPTE saisi (ID Huawei), quel que soit le poste : 10
// codes faux bloquent ce compte 15 min, sans toucher aux collègues derrière
// la même adresse. L'admin peut le débloquer (Codes personnels › Débloquer).
// Un filet large par adresse reste en place contre le balayage de comptes.
const authParAdresse = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => ipKeyGenerator(req.ip || ''),
  message: { error: 'Trop d\'essais depuis ce poste. Réessaie dans 15 minutes.' },
});
function cleCompte(req) {
  const id = String(req.body?.huaweiId || '').trim().toLowerCase();
  return id ? `id:${id}` : `ip:${ipKeyGenerator(req.ip || '')}`;
}
const authParCompte = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: cleCompte,
  message: { error: 'Trop de codes erronés pour cet identifiant : compte bloqué 15 minutes. L\'admin peut le débloquer.' },
});
// Débloque un identifiant (route admin, routes/fo-access.js).
function debloquerCompte(huaweiId) {
  const id = String(huaweiId || '').trim().toLowerCase();
  if (id) return authParCompte.resetKey(`id:${id}`);
}
const authLimiter = (req, res, next) => authParAdresse(req, res, err => err ? next(err) : authParCompte(req, res, next));

// Jeton de session présent sur la requête (équipe, admin ou agent).
function cleSession(req) {
  const c = String(req.headers.cookie || '');
  const m = /(?:^|;\s*)fo_team=([^;]+)/.exec(c) || /(?:^|;\s*)fo_admin=([^;]+)/.exec(c);
  const t = (m && m[1]) || req.get('X-Admin-Token') || req.get('X-FO-Token') || '';
  return t && t !== 'session' ? 's:' + t.slice(0, 64) : '';
}

module.exports = {
  authLimiter, debloquerCompte, securityHeaders, corsMiddleware, apiRateLimit,
};
