const express     = require('express');
const { v4: uuidv4 } = require('uuid');
const { FILES } = require('../config/paths');
const { readCfg, withFileLock, writeJSON } = require('../core/store');
const { cleanBody } = require('../core/sanitize');
const { requireAbsence, requireAdmin } = require('../auth/guards');
const {
  ABSENCE_TYPES, computeAbsenceSummary, defaultNotice, eachDay, holidaySetFor, noticeOk,
  readAbsences, validateAbsence,
} = require('../services/absences');

const router = express.Router();

router.get('/api/absences', requireAbsence, (_req, res) => res.json(readAbsences()));

router.post('/api/absences', requireAbsence, (req, res) => {
  withFileLock(FILES.absences, () => {
    const err = validateAbsence(req.body);
    if (err) return res.status(400).json({ error: err });
    const list = readAbsences();
    const entry = {
      id: uuidv4().slice(0, 8),
      created_at: new Date().toISOString(),
      ...cleanBody(req.body),
    };
    // Après l'étalement, pas avant : `status: 'Demandée'` placé au-dessus
    // était écrasé par un `status: ''` reçu du client. L'absence était
    // alors enregistrée sans statut, et tous les calculs qui filtrent sur
    // 'Validée'/'Demandée' l'ignoraient — elle n'apparaissait ni dans les
    // soldes de congés ni dans le taux d'absentéisme, tout en s'affichant
    // dans la liste. Un solde qui ne bouge pas venait de là.
    if (!entry.status) entry.status = 'Demandée';
    // Déduit du moment de la saisie si le client ne l'a pas précisé.
    entry.notice = defaultNotice(entry);
    list.push(entry);
    writeJSON(FILES.absences, list);
    res.status(201).json(entry);
  }).catch(err => res.status(500).json({ error: err.message }));
});

router.put('/api/absences/:id', requireAbsence, (req, res) => {
  withFileLock(FILES.absences, () => {
    const list = readAbsences();
    const idx = list.findIndex(a => a.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const merged = { ...list[idx], ...cleanBody(req.body) };
    // Même garde qu'à la création : une modification qui envoie un statut
    // vide ne doit pas faire disparaître l'absence des calculs.
    if (!merged.status) merged.status = 'Demandée';
    const err = validateAbsence(merged);
    if (err) return res.status(400).json({ error: err });
    merged.modified_at = new Date().toISOString();
    list[idx] = merged;
    writeJSON(FILES.absences, list);
    res.json(merged);
  }).catch(err => res.status(500).json({ error: err.message }));
});

router.delete('/api/absences/:id', requireAbsence, (req, res) => {
  withFileLock(FILES.absences, () => {
    writeJSON(FILES.absences, readAbsences().filter(a => a.id !== req.params.id));
    res.json({ ok: true });
  }).catch(err => res.status(500).json({ error: err.message }));
});

// Synthèse : soldes par agent, KPI de période, conflits avec le
// planning. Calculée côté serveur pour que le client n'ait pas à
// recharger shifts_plan.json (~2,5 Mo) pour croiser les dates.
// ── AGRÉGATS D'ABSENCE, SANS DONNÉES NOMINATIVES ──────────────
// /api/absences et /api/absences/summary exigent le jeton RH car ils
// exposent noms, motifs et soldes individuels. Le FO Dashboard n'a
// besoin que de compteurs — cette route ne renvoie donc aucun nom,
// aucun motif et aucun solde, et peut rester ouverte. Elle ne doit
// jamais gagner de champ nominatif : ce serait contourner le verrou.
router.get('/api/absences/stats', (req, res) => {
  try {
    const cfg      = readCfg();
    const country   = req.query.country && req.query.country !== 'ALL' ? req.query.country : null;
    const today     = new Date().toISOString().slice(0, 10);
    const from      = req.query.from || today;
    const to        = req.query.to   || today;
    const holidays  = holidaySetFor(country);
    const foList    = cfg.fo_list || [];

    const counted = readAbsences().filter(a =>
      a.date_from <= to && a.date_to >= from &&
      (a.status === 'Validée' || a.status === 'Demandée'));

    // Seuls les jours tombant DANS la fenêtre comptent : sinon un congé
    // de 5 jours qui la chevauche pèserait 5 jours contre une capacité
    // d'un seul, et le taux dépasserait 100 %.
    const days = a => {
      if (a.half_day && a.date_from === a.date_to)
        return (a.date_from >= from && a.date_from <= to) ? 0.5 : 0;
      let n = 0;
      eachDay(a.date_from, a.date_to, (iso, dow) => {
        if (iso < from || iso > to) return;
        if (dow === 0 || dow === 6) return;
        if (holidays.has(iso)) return;
        n++;
      });
      return n;
    };
    const totalDays     = counted.reduce((s, a) => s + days(a), 0);
    const unplannedDays = counted
      .filter(a => !ABSENCE_TYPES[a.type]?.planned)
      .reduce((s, a) => s + days(a), 0);
    // « Formation » est une absence mais aussi un investissement :
    // le dashboard la compte à part, pas comme une indisponibilité subie.
    const trainingDays = counted
      .filter(a => a.type === 'Formation')
      .reduce((s, a) => s + days(a), 0);

    let workingDays = 0;
    eachDay(from, to, (isoDay, dow) => {
      if (dow !== 0 && dow !== 6 && !holidays.has(isoDay)) workingDays++;
    });
    const capacity = workingDays * (foList.length || 1);

    // Effectifs distincts concernés : un compteur, pas une liste.
    const peopleAbsent   = new Set(counted.map(a => a.fo_name)).size;
    const peopleTraining = new Set(counted.filter(a => a.type === 'Formation').map(a => a.fo_name)).size;
    const absentToday    = new Set(counted
      .filter(a => a.date_from <= today && a.date_to >= today && a.type !== 'Formation')
      .map(a => a.fo_name)).size;

    res.json({
      from, to, country,
      headcount: foList.length,
      working_days: workingDays,
      capacity_days: capacity,
      total_days: Math.round(totalDays * 10) / 10,
      unplanned_days: Math.round(unplannedDays * 10) / 10,
      training_days: Math.round(trainingDays * 10) / 10,
      people_absent: peopleAbsent,
      people_training: peopleTraining,
      absent_today: absentToday,
      absence_rate: capacity ? Math.round(totalDays / capacity * 1000) / 10 : 0,
      unplanned_rate: capacity ? Math.round(unplannedDays / capacity * 1000) / 10 : 0,
      episodes: counted.length,
      // Taux de préavis, agrégé : combien d'absences ont été annoncées,
      // parmi celles dont le préavis est renseigné. Sans nominatif.
      ...(() => {
        const q = counted.map(defaultNotice).filter(Boolean);
        const ok = q.filter(n => noticeOk(n)).length;
        return {
          notice_ok: ok,
          notice_ko: q.length - ok,
          notice_rate: q.length ? Math.round((ok / q.length) * 1000) / 10 : null,
        };
      })(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── NOTE D'ASSIDUITÉ PAR AGENT ────────────────────────────────
// Alimente le critère « Assiduité » (15 %) de la notation FO. Réservé à
// l'admin : la note est nominative, contrairement à /stats.
//
// Ne sort **que la note et ses composantes chiffrées** — jamais le motif
// d'une absence ni ses dates. Le barème du plan trimestriel est « zéro
// absence injustifiée, préavis systématique » : on part de 100 et on
// retire ce qui s'en écarte. Les absences planifiées (congés validés,
// formation, on-site) ne retirent rien — c'est du temps posé, pas de
// l'indiscipline.
router.get('/api/absences/scores', requireAdmin, (req, res) => {
  try {
    const cfg   = readCfg();
    const from  = req.query.from || '0000-01-01';
    const to    = req.query.to   || '9999-12-31';
    // 'Annulée' est exclu au même titre que 'Refusée' : une absence
    // annulée n'a pas eu lieu. Elle était comptée ici — et seulement ici,
    // tous les autres calculs du fichier écartent déjà les deux statuts —
    // ce qui retirait 25 points d'assiduité pour une absence qui n'a
    // jamais existé.
    const list  = readAbsences().filter(a =>
      a.date_from <= to && a.date_to >= from
      && a.status !== 'Refusée' && a.status !== 'Annulée');

    const out = {};
    (cfg.fo_list || []).forEach(fo => {
      const mine = list.filter(a => a.fo_name === fo);
      const unjustified = mine.filter(a => a.type === 'Absence injustifiée').length;
      // Préavis manquant sur une absence subie : l'équipe découvre le
      // trou le matin même. C'est ce que le plan appelle un retard.
      const lateNotice = mine.filter(a => {
        if (ABSENCE_TYPES[a.type]?.planned) return false;
        const n = defaultNotice(a);
        return n && !noticeOk(n);
      }).length;

      // 25 points par absence injustifiée, 10 par défaut de préavis :
      // une seule absence injustifiée fait tomber sous le seuil de 85 %
      // du plan, ce qui est bien l'effet recherché.
      const score = Math.max(0, 100 - unjustified * 25 - lateNotice * 10);
      out[fo] = { score, unjustified, late_notice: lateNotice, episodes: mine.length };
    });
    res.json({ from, to, scores: out });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/absences/summary', requireAbsence, (req, res) => {
  try {
    res.json(computeAbsenceSummary(req.query));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rapport d'absences PDF, généré côté serveur (cf. absence-pdf.js).
router.get('/api/absences/report.pdf', requireAbsence, (req, res) => {
  try {
    const { buildAbsencePdf } = require('../documents/absence-pdf');
    const summary = computeAbsenceSummary(req.query);
    const pdf = buildAbsencePdf({ summary, absences: readAbsences(), generatedAt: new Date() });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="Pear_Absence_Report_${summary.from}_${summary.to}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
