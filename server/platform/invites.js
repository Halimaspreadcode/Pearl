// ══════════════════════════════════════════════════════════════
// INVITATIONS
//
// Un administrateur invite une adresse avec un rôle ; Pear crée un lien
// signé valable 7 jours. La personne ouvre le lien, choisit son mot de
// passe (ou se connecte si elle a déjà un compte) et rejoint l'espace.
// Une invitation en attente occupe un siège tant qu'elle n'est ni
// acceptée, ni révoquée, ni expirée.
//
// Stockage : registre de la plateforme, clé `invites:<slug>`.
// Si l'organisation a configuré un serveur d'envoi (Diffusion), le lien
// part aussi par email ; sinon l'administrateur le copie et le transmet.
// ══════════════════════════════════════════════════════════════
const crypto = require('crypto');
const { registry } = require('../core/backend');
const accounts = require('./accounts');

const TTL_MS = 7 * 86400000;
const key = slug => `invites:${slug}`;
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

async function listInvites(slug) {
  const all = (await registry().getSetting(key(slug))) || [];
  const now = Date.now();
  const live = all.filter(i => Date.parse(i.expires_at) > now);
  if (live.length !== all.length) await registry().setSetting(key(slug), live);
  return live;
}
const save = (slug, list) => registry().setSetting(key(slug), list);

function tokenFor(slug, inv) {
  return accounts.signToken({ tenant: slug, inv: inv.id, email: inv.email, purpose: 'invite' }, Date.parse(inv.expires_at) - Date.now());
}

async function createInvite(slug, { email, role, person_name, invited_by }) {
  const e = accounts.normEmail(email);
  const list = await listInvites(slug);
  const prev = list.find(i => i.email === e);
  const inv = {
    id: crypto.randomBytes(9).toString('base64url'), email: e, role,
    person_name: String(person_name || '').trim().slice(0, 80) || null,
    invited_by: invited_by || null, created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + TTL_MS).toISOString(),
  };
  await save(slug, [inv, ...list.filter(i => i !== prev)].slice(0, 500));
  return { invite: inv, token: tokenFor(slug, inv), replaced: !!prev };
}

async function renewInvite(slug, id) {
  const list = await listInvites(slug);
  const inv = list.find(i => i.id === id);
  if (!inv) throw err('Invitation introuvable.', 404);
  inv.expires_at = new Date(Date.now() + TTL_MS).toISOString();
  await save(slug, list);
  return { invite: inv, token: tokenFor(slug, inv) };
}

async function revokeInvite(slug, id) {
  const list = await listInvites(slug);
  if (!list.some(i => i.id === id)) throw err('Invitation introuvable.', 404);
  await save(slug, list.filter(i => i.id !== id));
}

// Lien → invitation encore valide de cette organisation, ou null.
async function resolveToken(slug, token) {
  const p = accounts.verifyToken(token, 'invite');
  if (!p || p.tenant !== slug) return null;
  const inv = (await listInvites(slug)).find(i => i.id === p.inv);
  return inv || null;
}

async function consume(slug, id) {
  const list = await listInvites(slug);
  await save(slug, list.filter(i => i.id !== id));
}

// Envoi par email si l'organisation a un serveur SMTP configuré.
async function sendInviteMail({ to, orgName, link, role, by }) {
  try {
    const { readMailing } = require('../services/mail/store');
    const { smtpSend } = require('../services/mail/smtp');
    const cfg = readMailing().smtp;
    if (!cfg.host || !(cfg.from || cfg.user)) return false;
    const subject = `${by || 'Votre équipe'} vous invite sur ${orgName}`;
    const text = `Bonjour,\n\n${by || 'Un administrateur'} vous invite à rejoindre l'espace ${orgName} (rôle : ${role}).\n\nPour accepter, ouvrez ce lien (valable 7 jours) :\n${link}\n\n— Pear`;
    await Promise.race([smtpSend(cfg, { to, subject, text }), new Promise((_, ko) => setTimeout(() => ko(new Error('délai')), 8000))]);
    return true;
  } catch (e) {
    console.warn('[invites] envoi impossible :', e.message);
    return false;
  }
}

module.exports = { listInvites, createInvite, renewInvite, revokeInvite, resolveToken, consume, sendInviteMail, TTL_MS };
