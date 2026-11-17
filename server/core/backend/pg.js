// ══════════════════════════════════════════════════════════════
// ADAPTATEUR POSTGRESQL DIRECT (avec Row Level Security)
//
// Chaque accès aux données d'un tenant tourne dans une transaction qui
// prend le rôle `pearl_app` (soumis à la RLS) et pose app.tenant : la base
// elle-même refuse de rendre les lignes d'un autre tenant, même si une
// requête est mal écrite. Le registre (tenants, membres) reste sous le
// rôle de connexion : c'est de l'administration de plateforme.
// ══════════════════════════════════════════════════════════════

function poolFor(connectionString) {
  const { Pool } = require('pg');
  const url = new URL(connectionString);
  const ssl = /require|verify/.test(url.searchParams.get('sslmode') || '') || /supabase\.(co|com)$/.test(url.hostname)
    ? { rejectUnauthorized: false } : undefined;
  url.searchParams.delete('sslmode');
  return new Pool({ connectionString: url.toString(), ssl, max: Number(process.env.PG_POOL_MAX || 5) });
}

// Les objets JSON passent en texte ; les tableaux restent des tableaux
// Postgres (text[]).
const param = v => (v !== null && typeof v === 'object' && !Array.isArray(v)) ? JSON.stringify(v) : v;

function makePgAdapter({ connectionString } = {}) {
  connectionString = connectionString || process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) throw new Error('STORE=pg demande DATABASE_URL');
  const pool = poolFor(connectionString);

  async function scoped(tenant, fn) {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role pearl_app');
      await c.query("select set_config('app.tenant', $1, true)", [tenant]);
      const r = await fn(c);
      await c.query('commit');
      return r;
    } catch (e) { try { await c.query('rollback'); } catch {} throw e; }
    finally { c.release(); }
  }
  const q = (sql, params) => pool.query(sql, params).then(r => r.rows);

  const adapter = {
    kind: 'pg',
    pool, scoped, query: q,
    loadDocs: tenant => scoped(tenant, c => c.query('select name, content::text as text from pearl_documents order by name').then(r => r.rows)),
    upsertDoc: (tenant, name, text) => scoped(tenant, c => c.query(
      `insert into pearl_documents (tenant, name, content, updated_at) values ($1, $2, $3::jsonb, now())
       on conflict (tenant, name) do update set content = excluded.content, updated_at = now()`, [tenant, name, text])),
    deleteDoc: (tenant, name) => scoped(tenant, c => c.query('delete from pearl_documents where name = $1', [name])),
    getBlob: (tenant, name) => scoped(tenant, c => c.query('select data from pearl_blobs where name = $1', [name])
      .then(r => r.rows[0] ? Buffer.from(r.rows[0].data, 'base64') : null)),
    putBlob: (tenant, name, buf) => scoped(tenant, c => c.query(
      `insert into pearl_blobs (tenant, name, data, updated_at) values ($1, $2, $3, now())
       on conflict (tenant, name) do update set data = excluded.data, updated_at = now()`, [tenant, name, Buffer.from(buf).toString('base64')])),
    removeBlobs: (tenant, prefix) => scoped(tenant, c => c.query('delete from pearl_blobs where starts_with(name, $1)', [prefix])),

    listTenants: () => q('select * from pearl_tenants order by created_at'),
    getTenant: slug => q('select * from pearl_tenants where slug = $1', [slug]).then(r => r[0] || null),
    findTenantByDomain: host => q('select * from pearl_tenants where $1 = any(domains)', [host]).then(r => r[0] || null),
    async insertTenant(row) {
      const cols = Object.keys(row);
      const r = await q(`insert into pearl_tenants (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')}) returning *`,
        cols.map(k => param(row[k])));
      return r[0];
    },
    async updateTenant(slug, patch) {
      const cols = Object.keys(patch);
      if (!cols.length) return adapter.getTenant(slug);
      const r = await q(`update pearl_tenants set ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} where slug = $1 returning *`,
        [slug, ...cols.map(k => param(patch[k]))]);
      return r[0] || null;
    },
    deleteTenant: slug => q('delete from pearl_tenants where slug = $1', [slug]),

    listMembers: slug => q('select * from pearl_members where tenant = $1 order by created_at', [slug]),
    membershipsOf: userId => q('select * from pearl_members where user_id = $1', [userId]),
    upsertMember: m => q(`insert into pearl_members (user_id, tenant, role, person_name, email) values ($1,$2,$3,$4,$5)
      on conflict (user_id, tenant) do update set role = excluded.role, person_name = excluded.person_name, email = excluded.email`,
      [m.user_id, m.tenant, m.role, m.person_name || null, m.email || null]),
    deleteMember: (userId, slug) => q('delete from pearl_members where user_id = $1 and tenant = $2', [userId, slug]),
    isPlatformAdmin: userId => q('select 1 from pearl_platform_admins where user_id = $1', [userId]).then(r => r.length > 0),
    addPlatformAdmin: userId => q('insert into pearl_platform_admins (user_id) values ($1) on conflict do nothing', [userId]),
    end: () => pool.end(),
  };
  return adapter;
}

module.exports = { makePgAdapter };
