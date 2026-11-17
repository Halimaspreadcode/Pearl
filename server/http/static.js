const express     = require('express');
const fs          = require('fs');
const path        = require('path');
const zlib        = require('zlib');
const bundle      = require('./bundle');

const router = express.Router();

// Paquets JS/CSS de la coquille (voir bundle.js) : servis depuis la
// mémoire, compressés une fois, cache d'un an (le nom porte l'empreinte).
router.get('/bundle/:nom', bundle.serve());

// ── COMPRESSION DES FICHIERS STATIQUES ────────────────────────
// app.js pèse 1,09 Mo et index.html 799 Ko : près de 1,9 Mo à télécharger
// puis à analyser à chaque ouverture de page. Compressés, ils tombent à
// 473 Ko — trois quarts de moins sur le réseau.
//
// On passe par `zlib`, livré avec Node, plutôt que par le module
// `compression` : le projet se déploie sur des postes sans accès Internet,
// où toute dépendance supplémentaire est un obstacle.
//
// Le résultat est gardé en mémoire, indexé par (chemin + date de
// modification) : sans ce cache, chaque requête paierait la compression,
// et on remplacerait un problème de réseau par un problème de processeur.
// Le cache se réinvalide de lui-même quand un fichier change, donc le
// développement n'en souffre pas.
//
// Une entrée PAR FICHIER (chemin → { cle, corps }). Le cache n'en gardait
// qu'une seule en tout : tenable avec un unique app.js, mais depuis le
// découpage en ~130 fichiers presque chaque requête recompressait. La
// mémoire reste bornée par la taille de public/ compressé (quelques Mo).
const _cacheGzip = new Map();
const COMPRESSIBLE = /\.(js|css|html|json|svg|map)$/i;
const TAILLE_MIN_GZIP = 1024;   // en dessous, l'en-tête coûte plus qu'il ne rapporte

router.get(/.*/, (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (!/\bgzip\b/.test(req.get('Accept-Encoding') || '')) return next();

  // Un chemin qui finit par « / » désigne l'index du dossier : c'est ainsi
  // qu'arrive la page d'accueil, et sans cette résolution index.html — le
  // plus gros fichier du lot — repartait non compressé.
  let chemin = decodeURIComponent(req.path);
  if (chemin.endsWith('/')) chemin += 'index.html';
  if (!COMPRESSIBLE.test(chemin)) return next();

  // On reste strictement sous public/ : `path.resolve` puis vérification du
  // préfixe empêchent un ../ de faire servir un fichier hors du dossier.
  const racine = path.resolve(__dirname, '../../public');
  const cible = path.resolve(racine, '.' + chemin);
  if (!cible.startsWith(racine + path.sep)) return next();

  let stat;
  try { stat = fs.statSync(cible); }
  catch { return next(); }                       // absent : la suite s'en charge
  if (!stat.isFile() || stat.size < TAILLE_MIN_GZIP) return next();

  const cle = `${stat.mtimeMs}:${stat.size}`;
  let entree = _cacheGzip.get(cible);
  if (!entree || entree.cle !== cle) {
    let corps;
    try { corps = zlib.gzipSync(fs.readFileSync(cible)); }
    catch { return next(); }
    entree = { cle, corps };
    _cacheGzip.set(cible, entree);               // remplace l'ancienne version du fichier
  }

  const etag = `W/"${stat.size}-${stat.mtimeMs}"`;
  // Varie selon l'encodage accepté : sans cet en-tête, un cache intermédiaire
  // pourrait servir la version compressée à un client qui ne la comprend pas.
  res.set('Vary', 'Accept-Encoding');
  res.set('ETag', etag);
  // Revalidation : fichier inchangé → 304 vide, le navigateur garde sa
  // copie. L'ETag était posé mais jamais comparé, si bien que chaque
  // visite retéléchargeait tous les scripts.
  if (req.get('If-None-Match') === etag) return res.status(304).end();

  res.set('Content-Encoding', 'gzip');
  res.set('Content-Type', express.static.mime.lookup(cible));
  if (req.method === 'HEAD') return res.end();
  res.end(entree.corps);
});

router.use(express.static(path.join(__dirname, '../../public'), {
  // Revalidation à chaque visite, mais réponse 304 (vide) si rien n'a changé :
  // le navigateur réutilise sa copie au lieu de retélécharger 1 Mo. On évite
  // un max-age long, qui servirait une version périmée après un déploiement.
  etag: true,
  lastModified: true,
  maxAge: 0,
}));

// JSZip est servi depuis node_modules plutôt que depuis un CDN : l'aperçu
// du PPTX en dépend, et l'outil doit rester utilisable sur un poste sans
// accès Internet — c'est déjà une dépendance installée du projet.
router.use('/vendor/jszip.min.js', (req, res) =>
  res.sendFile(require.resolve('jszip/dist/jszip.min.js')));

// Même raison pour ExcelJS, qui venait d'un CDN : tous les boutons
// « Export Excel » cessaient de fonctionner sur une VM hors-ligne, alors
// que le README promet un déploiement sans accès Internet. La
// bibliothèque est désormais une dépendance déclarée et servie d'ici.
router.use('/vendor/exceljs.min.js', (req, res) =>
  res.sendFile(require.resolve('exceljs/dist/exceljs.min.js')));

module.exports = router;
