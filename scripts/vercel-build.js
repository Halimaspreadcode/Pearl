// Build Vercel : aucun fichier statique servi directement. Tout passe par
// la fonction (api/index.js), qui sert aussi public/ : c'est elle qui sait
// quelle organisation est demandée et si l'utilisateur est connecté.
// Les migrations de la base s'appliquent ici quand une connexion est
// disponible (SUPABASE_ACCESS_TOKEN ou DATABASE_URL), sinon on passe.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const out = path.join(__dirname, '..', '.vercel-static');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, '.keep'), '');

const via = process.env.SUPABASE_ACCESS_TOKEN ? 'api' : (process.env.DATABASE_URL ? 'pg' : null);
if (via) {
  try { execFileSync(process.execPath, [path.join(__dirname, 'db-migrate.js'), `--via=${via}`], { stdio: 'inherit' }); }
  catch { console.warn('[build] migrations non appliquées (voir ci-dessus) : le déploiement continue.'); }
} else console.log('[build] pas de SUPABASE_ACCESS_TOKEN ni DATABASE_URL : migrations ignorées.');
