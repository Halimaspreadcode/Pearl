// ══════════════════════════════════════════════════════════════
// COMPTES UTILISATEURS (phase 2)
//
// Un compte = un email + un mot de passe, rattaché à une ou plusieurs
// organisations avec un rôle (pearl_members). Deux fournisseurs :
//   · Supabase Auth (SUPABASE_URL + clés) : les comptes vivent dans
//     Supabase, appelé en HTTPS ;
//   · local : comptes rangés dans le registre de la plateforme (bcrypt),
//     pour le développement et les installations sans Supabase.
//
// Session de compte : cookie `pearl_account`, signé HMAC, sans état côté
// serveur (survit aux redémarrages, fonctionne sur plusieurs instances).
// Il est propre à un hôte : chaque organisation a le sien.
// ══════════════════════════════════════════════════════════════
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { request } = require('../core/http-client');
const { registry } = require('../core/backend');

const ROLES = ['owner', 'admin', 'manager', 'agent', 'observer'];
const ADMIN_ROLES = ['owner', 'admin'];
const ACCOUNT_COOKIE = 'pearl_account';
const ACCOUNT_TTL_MS = 12 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const normEmail = e => String(e || '').trim().toLowerCase();
const validEmail = e => EMAIL_RE.test(normEmail(e)) && normEmail(e).length <= 254;
function validPassword(pw) {
  const s = String(pw || '');
  if (s.length < 10) return 'Au moins 10 caractères.';
  if (s.length > 200) return 'Mot de passe trop long.';
  return '';
}
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

// ── Fournisseur Supabase Auth ─────────────────────────────────
function supabaseProvider() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || service;
  const admin = { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' };
  const user = u => ({ id: u.id, email: normEmail(u.email) });

  return {
    kind: 'supabase',
    async createUser(email, password) {
      const r = await request(`${url}/auth/v1/admin/users`, { method: 'POST', headers: admin,
        body: JSON.stringify({ email: normEmail(email), password, email_confirm: true }) });
      if (r.status === 422 || (r.json && /already|exists|registered/i.test(r.json.msg || r.json.message || r.json.error_code || '')))
        throw err('Un compte existe déjà avec cet email.', 409);
      if (r.status >= 300) throw err(`Création du compte impossible (${(r.json && (r.json.msg || r.json.message)) || r.status}).`, 502);
      return user(r.json.user || r.json);
    },
    async signIn(email, password) {
      const r = await request(`${url}/auth/v1/token?grant_type=password`, { method: 'POST',
        headers: { apikey: anon, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normEmail(email), password: String(password || '') }) });
      if (r.status === 400 || r.status === 401) return null;
      if (r.status >= 300) throw err('Service de connexion indisponible.', 502);
      return user(r.json.user);
    },
    async findByEmail(email) {
      const e = normEmail(email);
      for (let page = 1; page <= 50; page++) {
        const r = await request(`${url}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: admin });
        if (r.status >= 300) throw err('Annuaire des comptes indisponible.', 502);
        const list = (r.json && (r.json.users || r.json)) || [];
        const hit = list.find(u => normEmail(u.email) === e);
        if (hit) return user(hit);
        if (list.length < 200) return null;
      }
      return null;
    },
    async setPassword(id, password) {
      const r = await request(`${url}/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: 'PUT', headers: admin,
        body: JSON.stringify({ password }) });
      if (r.status >= 300) throw err('Changement de mot de passe impossible.', 502);
    },
  };
}

// ── Fournisseur local ─────────────────────────────────────────
let _dummy = null;
const dummyHash = () => (_dummy = _dummy || bcrypt.hashSync('pearl-dummy-password', 12));
function localProvider() {
  const reg = () => registry();
  return {
    kind: 'local',
    async createUser(email, password) {
      const e = normEmail(email);
      if (await reg().getUserByEmail(e)) throw err('Un compte existe déjà avec cet email.', 409);
      const u = { id: crypto.randomUUID(), email: e, password_hash: bcrypt.hashSync(String(password), 12) };
      await reg().insertUser(u);
      return { id: u.id, email: e };
    },
    async signIn(email, password) {
      const u = await reg().getUserByEmail(normEmail(email));
      // Compte inconnu : même coût qu'un vrai essai (pas d'indice par le temps).
      if (!u || !u.password_hash) { bcrypt.compareSync(String(password || ''), dummyHash()); return null; }
      return bcrypt.compareSync(String(password || ''), u.password_hash) ? { id: u.id, email: u.email } : null;
    },
    async findByEmail(email) {
      const u = await reg().getUserByEmail(normEmail(email));
      return u ? { id: u.id, email: u.email } : null;
    },
    async setPassword(id, password) { await reg().updateUserPassword(id, bcrypt.hashSync(String(password), 12)); },
  };
}

let _provider = null;
function provider() {
  if (_provider) return _provider;
  const useSupabase = (process.env.AUTH_PROVIDER || '').toLowerCase() === 'supabase'
    || (!process.env.AUTH_PROVIDER && process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY));
  _provider = useSupabase ? supabaseProvider() : localProvider();
  return _provider;
}
const _setProvider = p => { _provider = p; };

// ── Session de compte signée ──────────────────────────────────
let _secret = null;
function secret() {
  if (_secret) return _secret;
  const s = process.env.PEARL_SESSION_SECRET || process.env.SUPABASE_JWT_SECRET;
  if (s) _secret = crypto.createHash('sha256').update(`pearl-session:${s}`).digest();
  else {
    _secret = crypto.randomBytes(32);
    console.warn('[accounts] PEARL_SESSION_SECRET absent : sessions de compte perdues à chaque redémarrage.');
  }
  return _secret;
}
const b64 = b => Buffer.from(b).toString('base64url');

// Jeton { uid, email, tenant?, exp, purpose } signé. `purpose` distingue la
// session du jeton de transfert (handoff) utilisé après l'inscription.
function signToken(payload, ttlMs = ACCOUNT_TTL_MS) {
  const body = b64(JSON.stringify({ ...payload, exp: Date.now() + ttlMs }));
  const sig = b64(crypto.createHmac('sha256', secret()).update(body).digest());
  return `${body}.${sig}`;
}
function verifyToken(token, purpose) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expected = b64(crypto.createHmac('sha256', secret()).update(body).digest());
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let p; try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!p || typeof p.exp !== 'number' || p.exp < Date.now()) return null;
  if (purpose && p.purpose !== purpose) return null;
  return p;
}

function setAccountCookie(req, res, user, tenantSlug) {
  const token = signToken({ uid: user.id, email: user.email, tenant: tenantSlug || null, purpose: 'session' });
  res.cookie(ACCOUNT_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: ACCOUNT_TTL_MS, path: '/' });
}
function clearAccountCookie(res) { res.clearCookie(ACCOUNT_COOKIE, { path: '/' }); }
function accountOf(req) {
  const { readCookie } = require('../auth/sessions');
  const p = verifyToken(readCookie(req, ACCOUNT_COOKIE), 'session');
  return p ? { id: p.uid, email: p.email, tenant: p.tenant } : null;
}

// Mot de passe provisoire lisible (invitations).
function tempPassword() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(14), x => A[x % A.length]).join('');
}

module.exports = {
  ROLES, ADMIN_ROLES, ACCOUNT_COOKIE, provider, _setProvider, normEmail, validEmail, validPassword,
  signToken, verifyToken, setAccountCookie, clearAccountCookie, accountOf, tempPassword,
};
