const express     = require('express');
const { addAudit } = require('../core/audit');
const { requireAdmin } = require('../auth/guards');
const {
  isPlausibleName, knownIdentityNames, livePresence, presence, revokedPresence,
} = require('../services/presence');

const router = express.Router();

router.post('/api/presence/ping', (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'name required' });

  const huaweiId = String(req.body?.huaweiId || '').trim().slice(0, 40);

  // On refuse ce qui n'est rattachable à personne : ni nom des listes
  // FO / BO, ni nom cohérent. Un observateur légitime passe.
  if (!knownIdentityNames().has(name.toLowerCase()) && !isPlausibleName(name))
    return res.status(403).json({ error: 'Invalid name' });
  if (!/^[a-zA-Z]{1,2}\d{7,8}$/.test(huaweiId))
    return res.status(403).json({ error: 'Invalid Huawei ID' });

  // Clé toujours en minuscules : « WX1488808 » et « wx1488808 » sont la même
  // personne, et la déconnexion admin doit retrouver l'entrée à coup sûr.
  const key = (huaweiId || name).toLowerCase();

  // Session coupée par un administrateur : on refuse le ping au lieu de le
  // réenregistrer, sinon le client réapparaîtrait au battement suivant.
  if (revokedPresence.has(key))
    return res.status(401).json({ error: 'Session closed by an administrator' });

  presence.set(key, {
    key,
    name,
    huaweiId,
    initials: String(req.body?.initials || '').trim().slice(0, 4),
    color:    String(req.body?.color    || '').trim().slice(0, 32),
    role:     String(req.body?.role     || '').trim().slice(0, 20),
    // Où l'utilisateur se trouve dans l'app. Purement indicatif : la page
    // est déclarée par le client, donc jamais utilisée pour une décision.
    page:      String(req.body?.page      || '').trim().slice(0, 40),
    pageLabel: String(req.body?.pageLabel || '').trim().slice(0, 60),
    lastSeen: Date.now(),
  });

  res.json({ ok: true, online: livePresence().length });
});

// Called on an explicit sign-out / tab close so the avatar disappears at once
// instead of lingering until the TTL expires.
router.post('/api/presence/leave', (req, res) => {
  const huaweiId = String(req.body?.huaweiId || '').trim();
  const name     = String(req.body?.name     || '').trim();
  presence.delete((huaweiId || name).toLowerCase());
  res.json({ ok: true });
});

router.get('/api/presence', (req, res) => {
  const now = Date.now();
  res.json({
    // Vue publique : volontairement pauvre. Ni ID, ni page — savoir qui est
    // là est un confort d'équipe, savoir ce que chacun consulte ne l'est pas.
    users: livePresence().map(u => ({
      name: u.name, initials: u.initials, color: u.color,
      role: u.role, secondsAgo: Math.round((now - u.lastSeen) / 1000),
    })),
  });
});

// Vue admin : le détail complet, réservé au mot de passe administrateur.
// C'est ici — et pas dans /api/presence — que vivent l'ID Huawei et la page
// consultée, pour qu'un simple utilisateur ne puisse pas suivre les autres.
router.get('/api/presence/admin', requireAdmin, (req, res) => {
  const now = Date.now();
  res.json({
    users: livePresence().map(u => ({
      key: u.key, name: u.name, huaweiId: u.huaweiId,
      initials: u.initials, color: u.color, role: u.role,
      page: u.page, pageLabel: u.pageLabel,
      secondsAgo: Math.round((now - u.lastSeen) / 1000),
      kicked: !!revokedPresence.get(u.key),
    })),
  });
});

// Déconnexion d'une session par l'administrateur.
//
// Retirer l'entrée de `presence` ne suffirait pas : le client repingue 30 s
// plus tard et réapparaît. On mémorise donc la révocation, et le ping suivant
// se voit répondre 401 — c'est lui qui déclenche la déconnexion côté client.
router.post('/api/presence/kick', requireAdmin, (req, res) => {
  const key = String(req.body?.key || '').trim().slice(0, 40).toLowerCase();
  if (!key) return res.status(400).json({ error: 'key required' });

  const target = presence.get(key);
  revokedPresence.set(key, Date.now());
  presence.delete(key);

  // Tracé : déconnecter quelqu'un est une action d'administration, elle doit
  // laisser une trace au même titre qu'une modification de ticket.
  addAudit('presence', key, 'admin', 'kick',
    { name: target?.name || key, page: target?.pageLabel || '' });

  res.json({ ok: true, online: livePresence().length });
});

module.exports = router;
