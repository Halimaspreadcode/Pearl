const express     = require('express');
const { buildWeeklyPptx } = require('../documents/weekly-pptx');
const { buildCombinedPptx, missingExplanations } = require('../documents/weekly-combined-pptx');
const { buildCombinedAnalysis } = require('../services/weekly-combined');
const { readCfg, readObs } = require('../core/store');
const {
  isoWeekNumber, reportTZ, tzEndOfDay, tzParts, tzStartOfWeek, zonedTimeToUtc,
} = require('../core/time');
const { allEnriched, inRange, periodKpis, reqCountry } = require('../core/enrich');
const { buildDailyReport, buildWeeklyReport } = require('../services/reports');

const router = express.Router();

router.get('/api/reports/daily', (req, res) => {
  res.json(buildDailyReport(req.query.date, reqCountry(req)));
});

router.get('/api/reports/weekly', (req, res) => {
  res.json(buildWeeklyReport(req.query.date, reqCountry(req)));
});

// ── EXPORT PPTX DU RAPPORT HEBDO ──────────────────────────────
// POST et non GET : les sections rédigées (highlights, risques,
// actions) vivent dans le brouillon local du client, le serveur ne les
// stocke pas. Elles voyagent donc dans le corps de la requête.
router.post('/api/reports/weekly.pptx', async (req, res) => {
  try {
    // Le deck hebdomadaire porte strictement le périmètre Sénégal. Le pays
    // transmis par le client est ignoré : avec 'ALL' ou 'CI', les tickets
    // et observations de Côte d'Ivoire se retrouvaient dans un document
    // diffusé comme un rapport SN.
    const data = buildWeeklyReport(req.body?.date, 'SN');
    const buf  = await buildWeeklyPptx(data, req.body?.form || {});
    const day  = new Date(data.week_start).toISOString().slice(0, 10);
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition',
      `attachment; filename="EMOC_Weekly_Report_${day}.pptx"`);
    res.send(buf);
  } catch (err) {
    console.error('PPTX generation failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── WEEKLY PERFORMANCE — DAKAR × ABIDJAN ──────────────────────
// Deck présenté aux deux équipes. GET renvoie l'analyse (pics, absences,
// incidents) pour que le client demande les explications avant de
// générer ; POST produit le PPTX avec les textes saisis.
router.get('/api/reports/weekly-combined', (req, res) => {
  try { res.json(buildCombinedAnalysis(req.query.date)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/reports/weekly-combined.pptx', async (req, res) => {
  try {
    const analysis = buildCombinedAnalysis(req.body?.date);
    const form = req.body?.form || {};
    // Chaque point requis est expliqué ou explicitement passé avant
    // l'export : un deck présenté aux deux équipes ne part pas avec des
    // trous. Le client bloque déjà le bouton ; la route tient la règle.
    const manquants = missingExplanations(analysis, form);
    if (manquants.length) {
      return res.status(400).json({
        error: `${manquants.length} explanation(s) missing. Fill them in or mark them as not needed.`,
        missing: manquants.map(it => it.key),
      });
    }
    const buf = await buildCombinedPptx(analysis, form);
    const day = new Date(analysis.week_start).toISOString().slice(0, 10);
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition',
      `attachment; filename="EMOC_Weekly_Performance_Dakar_Abidjan_${day}.pptx"`);
    res.send(buf);
  } catch (err) {
    console.error('Combined PPTX generation failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── MONTHLY REPORT ────────────────────────────────────────────
router.get('/api/reports/monthly', (req, res) => {
  const cfg  = readCfg();
  const tz   = reportTZ(cfg);
  const nowP = tzParts(new Date(), tz);
  const year  = parseInt(req.query.year)  || nowP.year;
  const month = parseInt(req.query.month) || nowP.month;
  const mStart = new Date(zonedTimeToUtc(year, month - 1, 1, 0, 0, 0, 0, tz));
  // Day 0 of the next month = last day of this one.
  const mEnd   = new Date(zonedTimeToUtc(year, month, 0, 23, 59, 59, 999, tz));

  const tickets     = allEnriched(cfg, reqCountry(req));
  const monthTkts   = tickets.filter(t => inRange(t.open_date, mStart, mEnd));
  const closedMonth = tickets.filter(t =>
    ['Resolved','Closed'].includes(t.status) && inRange(t.close_date, mStart, mEnd));

  const byDomain={}, byPriority={}, byType={}, byFO={}, byStatus={};
  monthTkts.forEach(t => {
    if(t.domain)   byDomain[t.domain]     = (byDomain[t.domain]||0)+1;
    if(t.priority) byPriority[t.priority] = (byPriority[t.priority]||0)+1;
    if(t.type)     byType[t.type]         = (byType[t.type]||0)+1;
    if(t.status)   byStatus[t.status]     = (byStatus[t.status]||0)+1;
  });
  tickets.forEach(t => {
    const fo = t.assigned_to||t.fo_owner; if(!fo)return;
    if(!byFO[fo]) byFO[fo]={open:0,resolved:0,breach:0,total:0};
    byFO[fo].total++;
    if(['Open','In Progress'].includes(t.status)) byFO[fo].open++;
    if(['Resolved','Closed'].includes(t.status))  byFO[fo].resolved++;
    if(t.sla_status==='Breach') byFO[fo].breach++;
  });

  // Calendar (ISO, Monday-based) weeks, clipped to the month. Previously this
  // stepped 7 days from the 1st, so a month starting on a Wednesday produced
  // "weeks" running Wed→Tue that matched nothing in the Weekly Report.
  const weeks = [];
  let cur = tzStartOfWeek(mStart, tz);
  while (cur <= mEnd) {
    const wkEnd  = tzEndOfDay(new Date(cur.getTime() + 6 * 86400000), tz);
    const clipS  = cur   < mStart ? mStart : cur;     // first/last weeks are
    const clipE  = wkEnd > mEnd   ? mEnd   : wkEnd;   // partial by definition
    const wT = monthTkts.filter(t => inRange(t.open_date,  clipS, clipE));
    const wC = closedMonth.filter(t => inRange(t.close_date, clipS, clipE));
    weeks.push({
      start: clipS.toISOString(), end: clipE.toISOString(),
      iso_week: isoWeekNumber(clipS, tz),
      opened: wT.length, closed: wC.length,
      breach: wT.filter(t => t.sla_status === 'Breach').length,
    });
    cur = new Date(cur.getTime() + 7 * 86400000);
  }

  const scoped = periodKpis(monthTkts, closedMonth, cfg);

  res.json({
    year, month,
    month_start: mStart.toISOString(), month_end: mEnd.toISOString(),
    kpis:{
      ...scoped,
      opened_this_month: monthTkts.length,
      resolved_this_month: closedMonth.length,
      overall_total:  tickets.length,
      overall_open:   tickets.filter(t=>['Open','In Progress'].includes(t.status)).length,
      overall_breach: tickets.filter(t=>t.sla_status==='Breach').length,
    },
    month_tickets: monthTkts, closed_tickets: closedMonth,
    by_domain: byDomain, by_priority: byPriority, by_type: byType,
    by_status: byStatus, by_fo: byFO, weekly_breakdown: weeks,
    fo_list: cfg.fo_list||[],
    observations_open: readObs().filter(o=>o.status==='Open'),
  });
});

module.exports = router;
