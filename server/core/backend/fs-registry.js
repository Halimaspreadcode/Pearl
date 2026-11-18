// Registre de plateforme (tenants, membres, admins) en mode fichiers :
// DATA_DIR/platform/registry.json. Même interface que les adaptateurs
// Supabase et PostgreSQL, pour que le reste du code ne voie pas la
// différence. Pensé pour le développement et les petites installations.
const fs   = require('fs');
const path = require('path');

function makeFsRegistry({ dataDir }) {
  const file = path.join(dataDir, 'platform', 'registry.json');
  const read = () => {
    try { return { tenants: [], members: [], admins: [], users: [], ...JSON.parse(fs.readFileSync(file, 'utf8')) }; }
    catch { return { tenants: [], members: [], admins: [], users: [] }; }
  };
  const write = d => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(d, null, 2));
    fs.renameSync(file + '.tmp', file);
  };
  const clone = x => (x ? JSON.parse(JSON.stringify(x)) : x);

  return {
    kind: 'fs',
    async listTenants() { return clone(read().tenants); },
    async getTenant(slug) { return clone(read().tenants.find(t => t.slug === slug) || null); },
    async findTenantByDomain(host) { return clone(read().tenants.find(t => (t.domains || []).includes(host)) || null); },
    async insertTenant(row) {
      const d = read();
      if (d.tenants.some(t => t.slug === row.slug)) throw Object.assign(new Error(`Le tenant « ${row.slug} » existe déjà`), { status: 409 });
      const t = { status: 'trial', plan: 'trial', pack: null, modules: [], branding: {}, domains: [], billing: {},
        trial_ends_at: null, created_at: new Date().toISOString(), ...row };
      d.tenants.push(t); write(d); return clone(t);
    },
    async updateTenant(slug, patch) {
      const d = read(); const t = d.tenants.find(x => x.slug === slug);
      if (!t) return null;
      Object.assign(t, patch); write(d); return clone(t);
    },
    async deleteTenant(slug) {
      const d = read();
      d.tenants = d.tenants.filter(t => t.slug !== slug);
      d.members = d.members.filter(m => m.tenant !== slug);
      write(d);
    },
    async listMembers(slug) { return clone(read().members.filter(m => m.tenant === slug)); },
    async membershipsOf(userId) { return clone(read().members.filter(m => m.user_id === userId)); },
    async upsertMember(m) {
      const d = read();
      const i = d.members.findIndex(x => x.user_id === m.user_id && x.tenant === m.tenant);
      const row = { created_at: new Date().toISOString(), ...(i >= 0 ? d.members[i] : {}), ...m };
      if (i >= 0) d.members[i] = row; else d.members.push(row);
      write(d);
    },
    async deleteMember(userId, slug) {
      const d = read(); d.members = d.members.filter(m => !(m.user_id === userId && m.tenant === slug)); write(d);
    },
    // Comptes locaux (fournisseur « local » de platform/accounts.js).
    async getUserByEmail(email) { return clone(read().users.find(u => u.email === email) || null); },
    async insertUser(u) { const d = read(); d.users.push({ ...u, created_at: new Date().toISOString() }); write(d); },
    async updateUserPassword(id, hash) { const d = read(); const u = d.users.find(x => x.id === id); if (u) { u.password_hash = hash; write(d); } },
    async isPlatformAdmin(userId) { return read().admins.includes(userId); },
    async countPlatformAdmins() { return read().admins.length; },
    async getSetting(key) { return clone((read().settings || {})[key] ?? null); },
    async setSetting(key, value) { const d = read(); d.settings = { ...(d.settings || {}), [key]: value }; write(d); },
    async deleteSetting(key) { const d = read(); if (d.settings) delete d.settings[key]; write(d); },
    async listPlatformAdmins() { return read().admins.map(user_id => ({ user_id })); },
    async removePlatformAdmin(userId) { const d = read(); d.admins = d.admins.filter(x => x !== userId); write(d); },
    async addPlatformAdmin(userId) { const d = read(); if (!d.admins.includes(userId)) d.admins.push(userId); write(d); },
  };
}

module.exports = { makeFsRegistry };
