// ══════════════════════════════════════════════════════════════
// ADAPTATEUR SUPABASE (API REST PostgREST, en HTTPS)
//
// Clé service_role côté serveur UNIQUEMENT : elle contourne la RLS.
// L'isolation entre tenants est donc garantie ici, en un seul endroit :
// chaque requête porte `tenant=eq.<slug>`, jamais un filtre venu du client.
// Les rôles anon / authenticated n'ont aucune politique sur ces tables
// (voir db/migrations) : une clé publique ne lit rien.
// ══════════════════════════════════════════════════════════════
const { request } = require('../http-client');

const enc = encodeURIComponent;

function makeSupabaseAdapter({ url, serviceKey, schema = 'public' } = {}) {
  url = (url || process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  serviceKey = serviceKey || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
  if (!url || !serviceKey) throw new Error('STORE=supabase demande SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY');

  const base = `${url}/rest/v1`;
  const headers = extra => ({
    apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
    'Accept-Profile': schema, 'Content-Profile': schema, 'Content-Type': 'application/json', ...extra,
  });
  async function call(method, path, body, extra) {
    const r = await request(`${base}${path}`, { method, headers: headers(extra), body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status >= 300) {
      const msg = (r.json && (r.json.message || r.json.error)) || r.text || `HTTP ${r.status}`;
      throw Object.assign(new Error(`Supabase ${method} ${path.split('?')[0]} : ${msg}`), { status: r.status, body: r.json });
    }
    return r.json;
  }
  const upsert = { Prefer: 'resolution=merge-duplicates,return=minimal' };
  const t = slug => `tenant=eq.${enc(slug)}`;

  return {
    kind: 'supabase',
    call,
    // ── documents ──
    async loadDocs(tenant) {
      const out = [];
      for (let from = 0; ; from += 1000) {
        const rows = await call('GET', `/pearl_documents?select=name,content&${t(tenant)}&order=name`, undefined, { Range: `${from}-${from + 999}` });
        for (const r of rows) out.push({ name: r.name, text: JSON.stringify(r.content) });
        if (rows.length < 1000) return out;
      }
    },
    upsertDoc: (tenant, name, text) => call('POST', '/pearl_documents?on_conflict=tenant,name',
      [{ tenant, name, content: JSON.parse(text), updated_at: new Date().toISOString() }], upsert),
    deleteDoc: (tenant, name) => call('DELETE', `/pearl_documents?${t(tenant)}&name=eq.${enc(name)}`),
    // ── blobs (base64) ──
    async getBlob(tenant, name) {
      const rows = await call('GET', `/pearl_blobs?select=data&${t(tenant)}&name=eq.${enc(name)}`);
      return rows.length ? Buffer.from(rows[0].data, 'base64') : null;
    },
    putBlob: (tenant, name, buf) => call('POST', '/pearl_blobs?on_conflict=tenant,name',
      [{ tenant, name, data: Buffer.from(buf).toString('base64'), updated_at: new Date().toISOString() }], upsert),
    removeBlobs: (tenant, prefix) => call('DELETE', `/pearl_blobs?${t(tenant)}&name=like.${enc(prefix.replace(/[%_]/g, m => '\\' + m) + '*')}`),
    // ── registre des tenants ──
    listTenants: () => call('GET', '/pearl_tenants?select=*&order=created_at'),
    async getTenant(slug) { const r = await call('GET', `/pearl_tenants?select=*&slug=eq.${enc(slug)}`); return r[0] || null; },
    async findTenantByDomain(host) { const r = await call('GET', `/pearl_tenants?select=*&domains=cs.${enc(`{${host}}`)}`); return r[0] || null; },
    async insertTenant(row) { const r = await call('POST', '/pearl_tenants', [row], { Prefer: 'return=representation' }); return r[0]; },
    async updateTenant(slug, patch) { const r = await call('PATCH', `/pearl_tenants?slug=eq.${enc(slug)}`, patch, { Prefer: 'return=representation' }); return r[0] || null; },
    deleteTenant: slug => call('DELETE', `/pearl_tenants?slug=eq.${enc(slug)}`),
    // ── membres ──
    listMembers: slug => call('GET', `/pearl_members?select=*&${t(slug)}&order=created_at`),
    membershipsOf: userId => call('GET', `/pearl_members?select=*&user_id=eq.${enc(userId)}`),
    upsertMember: m => call('POST', '/pearl_members?on_conflict=user_id,tenant', [m], upsert),
    deleteMember: (userId, slug) => call('DELETE', `/pearl_members?user_id=eq.${enc(userId)}&${t(slug)}`),
    async isPlatformAdmin(userId) { const r = await call('GET', `/pearl_platform_admins?select=user_id&user_id=eq.${enc(userId)}`); return r.length > 0; },
    addPlatformAdmin: userId => call('POST', '/pearl_platform_admins?on_conflict=user_id', [{ user_id: userId }], upsert),
  };
}

module.exports = { makeSupabaseAdapter };
