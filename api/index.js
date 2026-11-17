// Point d'entrée Vercel : toute requête (pages, API, fichiers) passe par
// l'application Express. La configuration se déduit des variables de
// l'intégration Supabase (server/config/runtime.js).
process.env.PEARL_SERVERLESS = '1';
const { createApp } = require('../server/app');

const app = createApp();
module.exports = (req, res) => app(req, res);
