#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════
// MIGRATIONS DE LA BASE (server/db/migrations/*.sql)
//
//   npm run db:migrate                 → connexion directe (DATABASE_URL)
//   npm run db:migrate -- --via=api    → API de gestion Supabase en HTTPS
//                                        (SUPABASE_ACCESS_TOKEN = jeton sbp_…)
//   npm run db:migrate -- --dry-run    → liste ce qui serait appliqué
//
// Chaque fichier est appliqué une fois, dans l'ordre des noms, et noté
// dans pearl_migrations. Rejouer la commande ne refait rien.
// ══════════════════════════════════════════════════════════════
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'server', 'db', 'migrations');
const args = process.argv.slice(2);
const via = (args.find(a => a.startsWith('--via=')) || '').slice(6) || (process.env.DATABASE_URL ? 'pg' : 'api');
const dry = args.includes('--dry-run');

const files = fs.readdirSync(DIR).filter(f => /^\d+_.+\.sql$/.test(f)).sort();

async function viaPg() {
  const { Client } = require('pg');
  const url = new URL(process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING || '');
  const ssl = /supabase\.(co|com)$/.test(url.hostname) || /require/.test(url.searchParams.get('sslmode') || '') ? { rejectUnauthorized: false } : undefined;
  url.searchParams.delete('sslmode');
  const c = new Client({ connectionString: url.toString(), ssl });
  await c.connect();
  return {
    query: async sql => (await c.query(sql)).rows,
    end: () => c.end(),
  };
}

async function viaApi() {
  const { request } = require('../server/core/http-client');
  const ref = (/^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(process.env.SUPABASE_URL || '') || [])[1] || process.env.SUPABASE_PROJECT_REF;
  if (!ref) throw new Error('SUPABASE_URL (ou SUPABASE_PROJECT_REF) manquant.');
  // Le jeton peut être injecté par un proxy : une valeur factice suffit alors.
  const token = process.env.SUPABASE_ACCESS_TOKEN || 'proxy-injected';
  return {
    async query(sql) {
      const r = await request(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: 'POST', timeoutMs: 60000,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql }),
      });
      if (r.status >= 300) throw new Error(`API Supabase ${r.status} : ${(r.json && (r.json.message || r.json.error)) || r.text}`);
      return Array.isArray(r.json) ? r.json : [];
    },
    end: async () => {},
  };
}

(async () => {
  const db = via === 'pg' ? await viaPg() : await viaApi();
  try {
    await db.query('create table if not exists pearl_migrations (id text primary key, applied_at timestamptz not null default now())');
    const done = new Set((await db.query('select id from pearl_migrations')).map(r => r.id));
    const todo = files.filter(f => !done.has(f));
    if (!todo.length) { console.log(`Base à jour (${files.length} migration(s)).`); return; }
    for (const f of todo) {
      if (dry) { console.log(`à appliquer : ${f}`); continue; }
      const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
      // Une transaction par fichier : tout ou rien.
      await db.query(`begin;\n${sql}\ninsert into pearl_migrations (id) values ('${f.replace(/'/g, "''")}');\ncommit;`);
      console.log(`appliquée : ${f}`);
    }
  } finally { await db.end(); }
})().catch(e => { console.error('Migration impossible :', e.message); process.exit(1); });
