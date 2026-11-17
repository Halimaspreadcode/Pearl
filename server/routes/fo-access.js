const express     = require('express');
const bcrypt      = require('bcryptjs');
const crypto      = require('crypto');
const { FILES } = require('../config/paths');
const { readCfg, withFileLock, writeCfg } = require('../core/store');
const { addAudit } = require('../core/audit');
const { authLimiter, debloquerCompte } = require('../http/security');
const { foSessions } = require('../auth/sessions');
const { teamSessions } = require('../auth/team-gate');
const { requireAdmin } = require('../auth/guards');
const { foAccessCodes } = require('../services/perf');

const router = express.Router();

// ── CODES D'ACCÈS FO (admin) ──────────────────────────────────
// Ouverture/fermeture de session par l'agent : routes/perf.js, monté
// avant ce routeur (POST /api/fo-access/login doit passer avant /:fo).

// Génération d'un code pour un agent (admin). Le code en clair n'est
// renvoyé qu'ici : il n'est stocké que haché, donc irrécupérable ensuite.
// Le régénérer invalide le précédent.
router.post('/api/fo-access/:fo', authLimiter, requireAdmin, (req, res) => {
  // Tout membre de l'équipe peut recevoir un code, pas seulement les FO :
  // c'est ce code qui ouvre une session nominative (auth/identity.js), sans
  // laquelle on ne peut plus rien modifier une fois le verrou d'équipe actif.
  const fo = String(req.params.fo || '').trim().replace(/\s+/g, ' ');
  if (!fo || fo.length > 80 || /[<>"]/.test(fo))
    return res.status(400).json({ error: 'Invalid name.' });

  const huaweiId = String(req.body?.huaweiId || '').trim();
  if (!/^[a-zA-Z]{1,2}\d{7,8}$/.test(huaweiId))
    return res.status(400).json({ error: 'Invalid Huawei ID.' });
  // Un ID = une personne : sinon la connexion ne saurait pas qui ouvrir.
  const pris = Object.entries(readCfg().fo_access_codes || {})
    .find(([n, v]) => n !== fo && String(v?.huawei_id || '').toLowerCase() === huaweiId.toLowerCase());
  if (pris) return res.status(409).json({ error: `This Huawei ID already belongs to ${pris[0]}.` });

  // Alphabet sans I, O, 0, 1 : ces codes se lisent et se recopient à la
  // main, et la confusion se paierait en tentatives échouées.
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = Array.from(crypto.randomBytes(8))
    .map(b => ALPHABET[b % ALPHABET.length]).join('');

  withFileLock(FILES.config, () => {
    const cur = readCfg();
    const codes = { ...(cur.fo_access_codes || {}) };
    codes[fo] = {
      hash: bcrypt.hashSync(code, 10),
      huawei_id: huaweiId,
      updated_at: new Date().toISOString(),
    };
    writeCfg({ ...cur, fo_access_codes: codes });

    // Les sessions ouvertes avec l'ancien code tombent : régénérer doit
    // couper l'accès précédent, sinon la révocation n'en est pas une.
    for (const [t, s] of foSessions) if (s.fo === fo) foSessions.delete(t);
    for (const [t, s] of teamSessions) if (s.qui?.name === fo) teamSessions.delete(t);

    // Un nouveau code repart de zéro : l'éventuel blocage pour essais
    // ratés sur cet identifiant est levé.
    debloquerCompte(huaweiId);
    addAudit('perf', fo, 'admin', 'code-generate', { huawei_id: huaweiId });
    res.json({ ok: true, fo, code, huawei_id: huaweiId });
  }).catch(e => res.status(500).json({ error: e.message }));
});

// Lève le blocage « trop de codes erronés » d'une personne, sans changer
// son code (security.js, authParCompte).
router.post('/api/fo-access/:fo/unlock', requireAdmin, (req, res) => {
  const fo = String(req.params.fo || '').trim();
  const v = (readCfg().fo_access_codes || {})[fo];
  if (!v) return res.status(404).json({ error: 'No code for this person.' });
  debloquerCompte(v.huawei_id);
  addAudit('perf', fo, 'admin', 'code-unlock', {});
  res.json({ ok: true });
});

router.delete('/api/fo-access/:fo', requireAdmin, (req, res) => {
  const fo = String(req.params.fo || '').trim();
  withFileLock(FILES.config, () => {
    const cur = readCfg();
    const codes = { ...(cur.fo_access_codes || {}) };
    if (!codes[fo]) return res.status(404).json({ error: 'No code for this agent.' });
    delete codes[fo];
    writeCfg({ ...cur, fo_access_codes: codes });
    for (const [t, s] of foSessions) if (s.fo === fo) foSessions.delete(t);
    for (const [t, s] of teamSessions) if (s.qui?.name === fo) teamSessions.delete(t);
    addAudit('perf', fo, 'admin', 'code-revoke', {});
    res.json({ ok: true });
  }).catch(e => res.status(500).json({ error: e.message }));
});

// État des codes, pour l'écran d'administration : qui en a un, depuis
// quand. Jamais le code lui-même — il n'est plus récupérable.
router.get('/api/fo-access', requireAdmin, (req, res) => {
  const codes = foAccessCodes();
  res.json(Object.entries(codes).map(([fo, v]) => ({
    fo, huawei_id: v.huawei_id || '', updated_at: v.updated_at || '',
    sessions: [...foSessions.values()].filter(s => s.fo === fo).length,
  })));
});

module.exports = router;
