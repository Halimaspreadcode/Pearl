const express     = require('express');
const { FILES } = require('../config/paths');
const { readJSON, withFileLock, writeJSON } = require('../core/store');

const router = express.Router();

/* ── PRÉFÉRENCES UTILISATEUR ──────────────────────────────────
   Les épinglages de la barre latérale suivent la PERSONNE, pas le poste :
   un agent qui change de machine ou de navigateur doit retrouver ses
   raccourcis. Le reste des réglages d'interface vit dans localStorage,
   ce qui convient à une préférence d'affichage locale (thème, replis) —
   mais pas à un choix de travail qu'on refait sinon à chaque poste.

   La clé est l'ID Huawei, seul identifiant stable et attribué. Le nom ne
   suffit pas : il change de graphie, l'ID non. */
function readUserPrefs() { return readJSON(FILES.user_prefs, {}); }

// Normalise la clé pour que « H50056630 » et « h50056630 » soient la même
// personne — c'est le genre d'écart qui crée deux profils fantômes.
const prefKey = id => String(id || '').trim().toLowerCase();

router.get('/api/user-prefs/:huaweiId', (req, res) => {
  const k = prefKey(req.params.huaweiId);
  if (!k) return res.status(400).json({ error: 'ID required' });
  res.json(readUserPrefs()[k] || { pinned: [] });
});

router.put('/api/user-prefs/:huaweiId', (req, res) => {
  withFileLock(FILES.user_prefs, () => {
    const k = prefKey(req.params.huaweiId);
    if (!k) return res.status(400).json({ error: 'ID required' });

    const all = readUserPrefs();
    const cur = all[k] || {};
    const patch = {};

    if (Array.isArray(req.body?.pinned)) {
      // On borne la liste : un épinglage n'a de sens que s'il tient en
      // haut d'écran sans repousser la navigation. Au-delà de 8, ce n'est
      // plus un raccourci mais un second menu.
      patch.pinned = [...new Set(req.body.pinned
        .map(p => String(p || '').trim())
        .filter(Boolean))].slice(0, 8);
    }
    if (req.body?.name != null) patch.name = String(req.body.name).trim().slice(0, 60);
    if (req.body?.role != null) patch.role = String(req.body.role).trim().slice(0, 20);

    all[k] = { ...cur, ...patch, updated_at: new Date().toISOString() };
    writeJSON(FILES.user_prefs, all);
    res.json(all[k]);
  }).catch(err => res.status(500).json({ error: err.message }));
});

module.exports = router;
