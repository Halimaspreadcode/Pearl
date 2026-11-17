const express     = require('express');
const { FILES } = require('../config/paths');
const { readJSON, withFileLock, writeJSON } = require('../core/store');
const { requireAdmin } = require('../auth/guards');

const router = express.Router();

// ── FORMATIONS (DigitalView, Process ITSM) ────────────────────
// La formation (public/formation/digitalview.html) enregistre sa
// progression ici, par agent, via le pont qui lui tient lieu de
// window.claude (digitalview-bridge.js). Clé = ID Huawei de l'agent, en
// minuscules — celui de son identification dans l'app.
//
// Le contenu est l'état de la formation tel quel (leçons faites, position,
// meilleurs scores, jours, série) : c'est la formation qui le fusionne avec
// son état local, le serveur ne fait que le garder. Même niveau d'accès
// que la progression des quiz : pas de secret là-dedans.
const ID = /^[a-z]{1,2}\d{7,8}$/;
const MAX = 256 * 1024;

// Formations construites sur le même moteur : chacune garde sa propre
// progression, dans son propre fichier. `digitalview` reste servie aussi
// par les routes d'origine (/api/formation/progress…), que la formation
// déjà déployée continue d'appeler.
const COURS = {
  digitalview: { file: () => FILES.formation_progress,         titre: 'DigitalView · Formation', fichier: 'digitalview-progress' },
  process:     { file: () => FILES.formation_process_progress, titre: 'Process ITSM · Formation', fichier: 'process-itsm-progress' },
  mobilemoney: { file: () => FILES.formation_mobilemoney_progress, titre: 'Mobile Money 2.0 · Formation', fichier: 'mobile-money-progress' },
  datacenter:  { file: () => FILES.formation_datacenter_progress, titre: 'Data center · Formation', fichier: 'data-center-progress' },
  reseau:      { file: () => FILES.formation_reseau_progress, titre: 'Réseaux · Formation', fichier: 'reseau-progress' },
};
const lire = c => readJSON(c.file(), {});

function lireAgent(c) {
  return (req, res) => {
    const id = String(req.params.id || '').toLowerCase();
    if (!ID.test(id)) return res.status(400).json({ error: 'Invalid ID.' });
    const e = lire(c)[id];
    res.set('Cache-Control', 'no-store');
    res.json({ state: e ? e.state : null, updated_at: e ? e.updated_at : null });
  };
}

function ecrireAgent(c) {
  return (req, res) => {
    const id = String(req.params.id || '').toLowerCase();
    if (!ID.test(id)) return res.status(400).json({ error: 'Invalid ID.' });
    const b = req.body || {};
    const state = b.state;
    if (!state || typeof state !== 'object' || Array.isArray(state))
      return res.status(400).json({ error: 'Invalid state.' });
    if (JSON.stringify(state).length > MAX) return res.status(413).json({ error: 'State too large.' });
    withFileLock(c.file(), () => {
      const all = lire(c);
      all[id] = {
        state,
        name: String(b.name || (all[id] && all[id].name) || '').slice(0, 120),
        total: Number.isFinite(Number(b.total)) ? Number(b.total) : (all[id] && all[id].total) || null,
        updated_at: new Date().toISOString(),
      };
      writeJSON(c.file(), all);
      res.json({ ok: true });
    }).catch(e => res.status(500).json({ error: e.message }));
  };
}

// Vue d'équipe (admin) : où en est chacun, sans le détail des réponses.
function vueEquipe(c) {
  return (req, res) => {
    const all = lire(c);
    const out = Object.entries(all).map(([id, e]) => {
      const st = (e && e.state) || {};
      const done = Object.values(st.done || {}).filter(Boolean).length;
      const best = Object.values(st.best || {}).filter(v => typeof v === 'number');
      return {
        id, name: e.name || '', done, total: e.total || null,
        streak: st.streak || 0, last: st.last || null, xp: st.xp || 0,
        days: (st.days || []).length, to_review: (st.miss || []).length,
        best_avg: best.length ? Math.round(best.reduce((s, v) => s + v, 0) / best.length) : null,
        updated_at: e.updated_at,
      };
    }).sort((a, b) => b.done - a.done || String(a.name).localeCompare(String(b.name)));
    res.json(out);
  };
}

// Export JSON complet (admin) : un fichier à télécharger, avec pour chaque
// agent le résumé et le détail de sa progression (leçons faites, position
// dans les leçons commencées, meilleurs scores, jours de pratique, série,
// questions à revoir). Les leçons sont nommées par leur clé de l'artefact
// (M1.1 = module 1, session 1).
function exportJson(c) {
  return (req, res) => {
    const all = lire(c);
    const agents = Object.entries(all).map(([id, e]) => {
      const st = (e && e.state) || {};
      const faites = Object.keys(st.done || {}).filter(k => st.done[k]).sort();
      return {
        id, name: e.name || '',
        lessons_done: faites.length, lessons_total: e.total || null,
        percent: e.total ? Math.round(faites.length / e.total * 100) : null,
        streak_days: st.streak || 0, last_practice: st.last || null, xp: st.xp || 0,
        practice_days: (st.days || []).slice().sort(),
        done: faites,
        in_progress: st.pos || {},
        best_scores: st.best || {},
        to_review: st.miss || [],
        updated_at: e.updated_at || null,
      };
    }).sort((a, b) => b.lessons_done - a.lessons_done || String(a.name).localeCompare(String(b.name)));
    const jour = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="${c.fichier}-${jour}.json"`);
    res.type('application/json').send(JSON.stringify({
      exported_at: new Date().toISOString(), training: c.titre, agents,
    }, null, 2));
  };
}

// Routes d'origine : DigitalView.
router.get('/api/formation/progress/:id', lireAgent(COURS.digitalview));
router.put('/api/formation/progress/:id', ecrireAgent(COURS.digitalview));
router.get('/api/formation/progress', requireAdmin, vueEquipe(COURS.digitalview));
router.get('/api/formation/progress.json', requireAdmin, exportJson(COURS.digitalview));

// Routes par formation : /api/formation/<cours>/progress…
function cours(req, res, next) {
  const c = COURS[req.params.course];
  if (!c) return res.status(404).json({ error: 'Unknown training.' });
  req.cours = c;
  next();
}
const viaCours = fab => (req, res) => fab(req.cours)(req, res);
router.get('/api/formation/:course/progress.json', requireAdmin, cours, viaCours(exportJson));
router.get('/api/formation/:course/progress', requireAdmin, cours, viaCours(vueEquipe));
router.get('/api/formation/:course/progress/:id', cours, viaCours(lireAgent));
router.put('/api/formation/:course/progress/:id', cours, viaCours(ecrireAgent));

module.exports = router;
