const express     = require('express');
const bcrypt      = require('bcryptjs');
const { addAudit } = require('../core/audit');
const { authLimiter } = require('../http/security');
const { pwMatches, requireAdmin } = require('../auth/guards');
const { foAccessCodes } = require('../services/perf');
const team = require('../auth/team-gate');
const { identiteDe, roleDe } = require('../auth/identity');

const router = express.Router();

// Les codes sont générés en majuscules, sans I/O/0/1 : on accepte la saisie
// en minuscules ou avec des espaces, sinon un code juste est refusé.
function codeOk(saisi, hash) {
  const brut = String(saisi || '');
  const norme = brut.replace(/[\s-]+/g, '').toUpperCase();
  return bcrypt.compareSync(brut, hash) || (norme !== brut && bcrypt.compareSync(norme, hash));
}

// ── CONNEXION D'ÉQUIPE ────────────────────────────────────────
// Trois façons d'entrer, un seul message d'échec : dire laquelle a raté
// renseignerait un attaquant sur ce qu'il a déjà trouvé.
router.post('/api/team/auth', authLimiter, (req, res) => {
  const password = String(req.body?.password || '');
  const employeeId = String(req.body?.employeeId || '').trim().toLowerCase();
  let qui = null;

  if (employeeId) {
    // Code personnel : connexion nominative, la seule qui permet d'écrire.
    const entry = Object.entries(foAccessCodes())
      .find(([, v]) => String(v?.employee_id || '').toLowerCase() === employeeId);
    if (entry && entry[1]?.hash && codeOk(password, entry[1].hash))
      qui = { name: entry[0], employeeId: entry[1].employee_id, role: roleDe(entry[0]) };
  } else if (team.teamPwMatches(password) || pwMatches(password)) {
    // Mot de passe d'équipe (ou admin saisi ici) : consultation seulement.
    qui = { lecture: true };
  }

  if (!qui) return res.status(401).json({ ok: false, error: 'Mot de passe ou code incorrect.' });
  team.ouvrirSession(res, req, qui);
  addAudit('access', qui.name || 'équipe', qui.name || 'équipe', qui.name ? 'login' : 'team-login', {});
  res.json({ ok: true, user: qui.name ? qui : null, lecture: !!qui.lecture });
});

// Identité de la session courante, lue par le client au chargement :
// c'est elle, et non un choix fait dans le navigateur, qui dit qui l'on est.
router.get('/api/team/session', (req, res) => {
  const actif = team.teamGateActif();
  const q = identiteDe(req);
  const cfg = require('../core/store').readCfg();
  res.json({
    actif,
    // Code personnel exigé pour modifier, et existence d'au moins un code :
    // le client choisit entre connexion par code et ancien choix du nom.
    exige: actif || !!cfg.identity_required,
    codes: Object.keys(cfg.fo_access_codes || {}).length > 0,
    ok: !actif || team.requeteAuthentifiee(req),
    user: q && q.name && q.name !== 'Admin' ? { name: q.name, employeeId: q.employeeId || '', role: q.role || '' } : null,
    lecture: !!(q && q.lecture),
    admin: !!(q && q.admin),
    // Connexion par compte (email + mot de passe) disponible.
    accounts: require('../core/tenant').isMultiTenant() || process.env.ACCOUNTS === '1',
  });
});

// « Exiger le code personnel pour modifier », indépendamment du mot de
// passe d'équipe : la lecture reste ouverte, l'écriture devient nominative.
router.put('/api/team/required', requireAdmin, (req, res) => {
  const on = !!req.body?.on;
  const { FILES } = require('../config/paths');
  const { withFileLock, readCfg, writeCfg } = require('../core/store');
  withFileLock(FILES.config, () => {
    const cfg = readCfg();
    cfg.identity_required = on;
    writeCfg(cfg);
  }).then(() => {
    addAudit('access', 'team', 'admin', on ? 'identity-required-on' : 'identity-required-off', {});
    res.json({ ok: true, on });
  }).catch(e => res.status(500).json({ error: e.message }));
});

router.post('/api/team/logout', (req, res) => {
  team.fermerSession(req, res);
  res.json({ ok: true });
});

// ── RÉGLAGE (admin) ───────────────────────────────────────────
router.get('/api/team/password', requireAdmin, (req, res) =>
  res.json({ ...team.etat(), identity_required: !!require('../core/store').readCfg().identity_required }));

router.put('/api/team/password', authLimiter, requireAdmin, (req, res) => {
  const pw = String(req.body?.password || '');
  if (pw.length < 10)
    return res.status(400).json({ error: 'Au moins 10 caractères.' });
  if (pwMatches(pw))
    return res.status(400).json({ error: 'Choisis un mot de passe différent de celui de l\'admin.' });
  const updated_at = team.definirMotDePasse(pw);
  addAudit('access', 'team', 'admin', 'team-password-set', {});
  res.json({ ok: true, updated_at });
});

router.delete('/api/team/password', requireAdmin, (req, res) => {
  if (process.env.TEAM_PW_HASH)
    return res.status(409).json({ error: 'Défini par TEAM_PW_HASH dans .env : à retirer là-bas.' });
  team.desactiver();
  addAudit('access', 'team', 'admin', 'team-password-remove', {});
  res.json({ ok: true });
});

module.exports = router;
