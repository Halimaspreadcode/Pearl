const express     = require('express');
const bcrypt      = require('bcryptjs');
const { FILES } = require('../config/paths');
const { readCfg, withFileLock, writeCfg } = require('../core/store');
const { authLimiter } = require('../http/security');
const {
  ADMIN_COOKIE, SESSION_TTL_MS, absenceSessions, issueSession, readCookie, sessionValid,
  sessions,
} = require('../auth/sessions');
const { absenceIdAllowed, absencePwMatches, pwMatches, requireAdmin } = require('../auth/guards');

const router = express.Router();

router.post('/api/config/auth', authLimiter, (req, res) => {
  if (!pwMatches(req.body.password))
    return res.status(401).json({ ok: false, error: 'Incorrect password' });
  const session = issueSession();
  // Cookie en plus du jeton : une navigation vers /admin/app ne peut pas
  // porter d'en-tête X-Admin-Token, or c'est le serveur — pas le client —
  // qui doit décider si le HTML admin part sur le réseau.
  res.cookie(ADMIN_COOKIE, session.token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure,
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
  res.json({ ok: true, ...session });
});

// Permet au client de savoir si sa session tient toujours, sans
// redemander le mot de passe à chaque navigation.
router.get('/api/config/session', (req, res) => {
  if (sessionValid(req.get('X-Admin-Token'))) return res.json({ ok: true });
  // Repli sur le cookie : après une navigation vers /admin/app dans un
  // nouvel onglet, la session est valide côté serveur mais le jeton n'est
  // plus en sessionStorage. On le renvoie pour que les appels XHR
  // suivants puissent repasser par l'en-tête.
  const cookieToken = readCookie(req, ADMIN_COOKIE);
  if (sessionValid(cookieToken)) return res.json({ ok: true, token: cookieToken });
  res.json({ ok: false });
});

router.post('/api/config/logout', (req, res) => {
  sessions.delete(req.get('X-Admin-Token'));
  sessions.delete(readCookie(req, ADMIN_COOKIE));
  res.clearCookie(ADMIN_COOKIE, { path: '/' });
  res.json({ ok: true });
});

router.post('/api/absences/auth', authLimiter, (req, res) => {
  const pwOk = absencePwMatches(req.body.password);
  const idOk = absenceIdAllowed(req.body.huaweiId);
  // Message unique : distinguer « mauvais ID » de « mauvais mot de passe »
  // dirait à un inconnu lequel des deux il a déjà trouvé.
  if (!pwOk || !idOk)
    return res.status(401).json({
      ok: false,
      error: 'Access denied: unauthorized ID or incorrect password.',
    });
  res.json({ ok: true, ...issueSession(absenceSessions) });
});

router.get('/api/absences/session', (req, res) => {
  res.json({ ok: sessionValid(req.get('X-Absence-Token'), absenceSessions) });
});

router.post('/api/absences/logout', (req, res) => {
  absenceSessions.delete(req.get('X-Absence-Token'));
  res.json({ ok: true });
});

// Réinitialisation du mot de passe Absences depuis l'admin. Le nouveau
// secret est stocké haché dans config.json et prend le pas sur la valeur
// d'environnement : on peut donc le changer sans redéployer.
router.post('/api/absences/password', authLimiter, requireAdmin, (req, res) => {
  const pw = String(req.body.password || '');
  if (pw.length < 8)
    return res.status(400).json({ error: 'The password must be at least 8 characters.' });

  withFileLock(FILES.config, () => {
    const cfg = readCfg();
    cfg.absence_password_hash = bcrypt.hashSync(pw, 12);
    writeCfg(cfg);
  });
  // Les sessions ouvertes avec l'ancien secret sont invalidées : sinon
  // changer le mot de passe ne fermerait la porte à personne.
  absenceSessions.clear();
  res.json({ ok: true });
});

module.exports = router;
