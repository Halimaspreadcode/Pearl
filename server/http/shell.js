const express     = require('express');
const fs          = require('fs');
const path        = require('path');
const zlib        = require('zlib');
const { ADMIN_COOKIE, readCookie, sessionValid } = require('../auth/sessions');
const { requireAdmin } = require('../auth/guards');
const bundle      = require('./bundle');

const router = express.Router();

// ── ZONE ADMIN ────────────────────────────────────────────────
// L'admin vit sur sa propre route, servie uniquement à qui présente
// un cookie de session valide. Déclaré AVANT express.static pour que
// le HTML admin ne puisse pas être récupéré en le demandant par son
// nom de fichier : le gardien passerait sinon après le service statique.
const SHELL_PAGE = path.join(__dirname, '../../public/index.html');
const ADMIN_LOGIN_PAGE = path.join(__dirname, '../../public/admin-login.html');
const CONFIG_PARTIAL = path.join(__dirname, '../partials/config-page.html');
const ADMIN_SLOT = '<!--ADMIN_CONFIG_PAGE-->';

// Le balisage de la Configuration vit hors de public/ : servi par
// express.static, il partirait avec la page publique. Il n'est recollé
// dans la coquille que pour une session admin valide — un visiteur
// anonyme ne télécharge jamais ces écrans.
//
// Les suites de <script src="/js/…"> et de <link href="/css/…"> sont
// remplacées par des paquets (voir bundle.js ; BUNDLE=0 pour s'en passer).
// La réécriture porte sur la coquille AVANT l'insertion du fragment admin :
// une seule entrée à mettre en cache, et le fragment ne porte aucun script.
function renderShell(withAdmin) {
  const shell = bundle.rewriteShell(fs.readFileSync(SHELL_PAGE, 'utf-8'));
  const slot  = withAdmin ? fs.readFileSync(CONFIG_PARTIAL, 'utf-8') : '';
  return shell.replace(ADMIN_SLOT, slot);
}

// La coquille est assemblée à la volée (elle porte, ou non, les écrans
// d'administration) : le compresseur de fichiers statiques ne peut donc pas
// s'en occuper, et elle repartait en clair — c'est la plus grosse réponse
// HTML du site. On la compresse ici, et on garde le résultat en mémoire :
// il n'y a que deux variantes possibles, avec ou sans la partie admin.
//
// Le cache est indexé sur la date de modification des deux fichiers source
// et sur l'état des paquets (bundle.stateId, qui change avec le moindre
// fichier /js ou /css) : une modification est prise en compte sans redémarrage.
const _cacheShell = new Map();
// Cache distinct : envoyerShell() vide le sien à chaque variante servie,
// ce qui évincerait le fragment admin et le recompresserait sans cesse.
const _cacheFragment = new Map();
function envoyerShell(req, res, withAdmin) {
  let empreinte;
  try {
    const a = fs.statSync(SHELL_PAGE).mtimeMs;
    const b = fs.existsSync(CONFIG_PARTIAL) ? fs.statSync(CONFIG_PARTIAL).mtimeMs : 0;
    empreinte = `${withAdmin}:${a}:${b}`;
  } catch {
    empreinte = null;                       // illisible : on laisse la voie normale échouer
  }

  // Rendu d'abord : c'est lui qui reconstruit les paquets si une source a
  // changé, et donc qui fixe l'état à inclure dans la clé du cache.
  const html = renderShell(withAdmin);
  if (empreinte) empreinte += `:${bundle.stateId()}`;
  res.type('html');
  res.set('Vary', 'Accept-Encoding');
  // La coquille nomme les paquets /bundle/app.<empreinte>.js : une copie
  // gardée par le navigateur rechargerait l'ancien code après une mise à
  // jour. Toujours revalider auprès du serveur.
  res.set('Cache-Control', 'no-cache');

  if (!empreinte || !/\bgzip\b/.test(req.get('Accept-Encoding') || '')) {
    return res.send(html);
  }
  let corps = _cacheShell.get(empreinte);
  if (!corps) {
    corps = zlib.gzipSync(html);
    _cacheShell.clear();                    // deux variantes suffisent
    _cacheShell.set(empreinte, corps);
  }
  res.set('Content-Encoding', 'gzip');
  res.end(corps);
}

router.get('/admin', (req, res) => {
  // Déjà authentifié : inutile de redemander le mot de passe.
  if (sessionValid(readCookie(req, ADMIN_COOKIE)))
    return res.redirect('/admin/app');
  res.sendFile(ADMIN_LOGIN_PAGE);
});

router.get('/admin/app', (req, res) => {
  if (!sessionValid(readCookie(req, ADMIN_COOKIE)))
    return res.redirect('/admin');
  envoyerShell(req, res, true);
});

// ── PAGE DE CONNEXION (mise de côté) ──────────────────────────
// La page /login est conservée (public/login.html) mais n'est plus utilisée
// pour l'instant : on est revenu à l'écran de connexion affiché par-dessus
// l'app (public/js/core/team-gate.js). Ses adresses ramènent à l'app.
router.get(['/login', '/login.html'], (req, res) => res.redirect(302, '/'));
// Boîte à idées : page autonome, ouverte aussi par lien de partage
// (/idees?k=…). Les données restent derrière le verrou (routes/ideas.js).
router.get(['/idees', '/ideas'], (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'idees.html'));
});

// L'app publique et son entrée directe passent par la même coquille,
// vidée de son emplacement admin.
router.get(['/', '/index.html'], (req, res) => envoyerShell(req, res, false));

// ── FRAGMENT ADMIN (bascule sans rechargement) ────────────────
// La bascule Simple/Admin passait par location.href : deux navigations
// serveur, tout le HTML re-analysé et les 14 appels de loadAll() rejoués
// à chaque aller-retour. Sur une VM, l'attente était très visible.
//
// Cette route sert le seul fragment manquant à l'app publique, pour que
// le client l'injecte dans l'emplacement resté vide. C'est bien le
// serveur qui décide : sans session valide, le HTML admin ne part pas.
// `requireAdmin` lit l'en-tête X-Admin-Token, que le fetch client porte.
router.get('/api/admin/config-page', requireAdmin, (req, res) => {
  let html, empreinte;
  try {
    html = fs.readFileSync(CONFIG_PARTIAL, 'utf-8');
    // mtimeMs est fractionnaire : on l'arrondit, sinon le point décimal
    // se retrouve dans l'ETag et la comparaison If-None-Match échoue.
    empreinte = `partial-${Math.round(fs.statSync(CONFIG_PARTIAL).mtimeMs)}`;
  } catch {
    return res.status(500).json({ error: 'Fragment indisponible' });
  }

  res.type('html');
  res.set('Vary', 'Accept-Encoding');
  // Jamais de cache partagé : la réponse dépend de la session.
  res.set('Cache-Control', 'private, no-cache');
  res.set('ETag', `W/"${empreinte}"`);
  // Le fragment ne change qu'au redéploiement : une revalidation suffit
  // à rendre les bascules suivantes gratuites sur le réseau.
  if (req.get('If-None-Match') === `W/"${empreinte}"`) return res.status(304).end();

  if (!/\bgzip\b/.test(req.get('Accept-Encoding') || '')) return res.send(html);
  let corps = _cacheFragment.get(empreinte);
  if (!corps) { corps = zlib.gzipSync(html); _cacheFragment.clear(); _cacheFragment.set(empreinte, corps); }
  res.set('Content-Encoding', 'gzip');
  res.end(corps);
});

// Empêche de contourner /admin en demandant le fichier de login sous son
// vrai nom, et garde une seule URL canonique pour la zone admin.
router.get('/admin-login.html', (req, res) => res.redirect('/admin'));

module.exports = router;
