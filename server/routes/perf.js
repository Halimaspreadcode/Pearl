const express     = require('express');
const { agentDe } = require('../auth/identity');
const bcrypt      = require('bcryptjs');
const { readCfg } = require('../core/store');
const { addAudit } = require('../core/audit');
const { authLimiter } = require('../http/security');
const { foSessionOwner, foSessions, issueFoSession } = require('../auth/sessions');
const { requireAdmin } = require('../auth/guards');
const { buildPerfView, foAccessCodes } = require('../services/perf');

const router = express.Router();

// ── PERFORMANCE : CONSULTATION PAR L'AGENT ────────────────────
// Calcul des notes et de la vue agent : services/perf.js.

// Ouverture d'une session FO. Le rate-limit est celui des autres écrans
// d'authentification : un code à 8 caractères doit rester coûteux à
// deviner, même en connaissant l'ID Huawei de la personne.
router.post('/api/fo-access/login', authLimiter, (req, res) => {
  const huaweiId = String(req.body?.huaweiId || '').trim().toLowerCase();
  const code     = String(req.body?.code     || '').trim();
  if (!huaweiId || !code)
    return res.status(400).json({ error: 'ID and code are required.' });

  const codes = foAccessCodes();
  // On cherche le FO dont l'ID correspond, puis on vérifie le code. Le
  // message d'erreur reste le même dans les deux cas : distinguer
  // « ID inconnu » de « code faux » dirait quels ID existent.
  const entry = Object.entries(codes)
    .find(([, v]) => String(v?.huawei_id || '').toLowerCase() === huaweiId);

  const norme = code.replace(/[\s-]+/g, '').toUpperCase();   // saisie en minuscules acceptée
  if (!entry || !entry[1]?.hash || !(bcrypt.compareSync(code, entry[1].hash)
      || (norme !== code && bcrypt.compareSync(norme, entry[1].hash))))
    return res.status(401).json({ error: 'Identifiant ou code incorrect.' });

  const { token, expires_in } = issueFoSession(entry[0]);
  // Même code, même personne : la connexion à Ma performance ouvre aussi la
  // session nominative de FOps (auth/identity.js), sauf si une autre
  // personne est déjà connectée sur ce navigateur.
  const team = require('../auth/team-gate');
  const cur = team.sessionEquipe(req);
  if (!cur || !cur.qui?.name)
    team.ouvrirSession(res, req, { name: entry[0], huaweiId: entry[1].huawei_id, role: require('../auth/identity').roleDe(entry[0]) });
  addAudit('perf', entry[0], entry[0], 'consult-login', {});
  res.json({ ok: true, token, expires_in, fo: entry[0] });
});

router.post('/api/fo-access/logout', (req, res) => {
  foSessions.delete(req.get('X-FO-Token'));
  res.json({ ok: true });
});

// La note de l'agent porteur du jeton. Aucun paramètre n'est accepté :
// il n'existe aucun moyen de demander la note de quelqu'un d'autre.
router.get('/api/my-perf', (req, res) => {
  const fo = agentDe(req);
  if (!fo) return res.status(401).json({ error: 'Session expired or missing.' });
  res.json(buildPerfView(fo));
});

// Vue de contrôle réservée à l'admin : la fiche telle que l'agent la
// voit, pour vérifier l'affichage sans avoir à emprunter son code
// d'accès. Route distincte et non un paramètre sur /api/my-perf : cette
// dernière doit rester non paramétrable, c'est ce qui garantit qu'un
// jeton FO ne peut jamais servir à lire la note d'un collègue.
router.get('/api/fo-perf/:fo', requireAdmin, (req, res) => {
  const fo = String(req.params.fo || '');
  const cfg = readCfg();
  if (!(cfg.fo_list || []).includes(fo))
    return res.status(404).json({ error: 'Agent inconnu' });
  res.json(buildPerfView(fo));
});

module.exports = router;
