const express     = require('express');
const { v4: uuidv4 } = require('uuid');
const { FILES } = require('../config/paths');
const { readAnnouncements, withFileLock, writeAnnouncements } = require('../core/store');
const { authLimiter } = require('../http/security');
const { requireAdmin } = require('../auth/guards');

const router = express.Router();

// ── QUIZ ─────────────────────────────────────────────────────
// ── ANNONCES À L'ÉQUIPE ───────────────────────────────────────
// Notifications diffusées par l'admin à tous les FO. Elles s'affichent
// dans le panneau de rappels, au-dessus des rappels personnels.
// L'accusé de lecture est stocké côté client (localStorage) : c'est un
// confort d'affichage, pas une preuve de lecture — le serveur ne
// prétend donc pas savoir qui a lu quoi.
const ANNOUNCE_LEVELS = ['info', 'warning', 'critical'];
// Format d'affichage : « panel » dans la cloche (défaut), « banner » en
// bande pleine largeur en haut de l'application, pour tout le monde —
// réservé aux grandes annonces.
const ANNOUNCE_DISPLAYS = ['panel', 'banner'];

router.get('/api/announcements', (req, res) => {
  const now = Date.now();
  // Une annonce expirée disparaît d'elle-même : sans cela, la barre se
  // remplirait de messages périmés que personne ne pense à retirer.
  res.json(readAnnouncements().filter(a => !a.expires_at || Date.parse(a.expires_at) > now));
});

router.post('/api/announcements', authLimiter, requireAdmin, (req, res) => {
  const title = String(req.body.title || '').trim();
  const body  = String(req.body.body || '').trim();
  if (!title) return res.status(400).json({ error: 'Title is required.' });
  if (title.length > 120) return res.status(400).json({ error: 'Title too long (120 characters max).' });
  if (body.length > 2000) return res.status(400).json({ error: 'Message too long (2000 characters max).' });

  const level = ANNOUNCE_LEVELS.includes(req.body.level) ? req.body.level : 'info';
  const display = ANNOUNCE_DISPLAYS.includes(req.body.display) ? req.body.display : 'panel';
  const days  = Number(req.body.expires_days);
  const ttl   = Number.isFinite(days) && days > 0 ? Math.min(days, 90) : 7;

  withFileLock(FILES.announcements, () => {
    const list = readAnnouncements();
    const entry = {
      id: uuidv4().slice(0, 8),
      title, body, level, display,
      author: String(req.body.author || 'Administration').slice(0, 80),
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + ttl * 864e5).toISOString(),
    };
    list.unshift(entry);
    // Garde-fou : on ne conserve que les 100 dernières, sinon le fichier
    // grossit indéfiniment sur une instance de longue durée.
    writeAnnouncements(list.slice(0, 100));
    res.status(201).json(entry);
  }).catch(err => res.status(500).json({ error: err.message }));
});

router.delete('/api/announcements/:id', requireAdmin, (req, res) => {
  withFileLock(FILES.announcements, () => {
    writeAnnouncements(readAnnouncements().filter(a => a.id !== req.params.id));
    res.json({ ok: true });
  }).catch(err => res.status(500).json({ error: err.message }));
});

module.exports = router;
