const express     = require('express');
const { readAudit, readCI, readCfg, readObs, readSN } = require('../core/store');
const { allEnriched } = require('../core/enrich');
const { requireAdmin } = require('../auth/guards');

const router = express.Router();

// ── DASHBOARD ────────────────────────────────────────────────
router.get('/api/dashboard', (req, res) => {
  const cfg     = readCfg();
  const tickets = allEnriched(cfg);
  const today   = new Date(); today.setHours(0,0,0,0);

  const slaScope = tickets.filter(t => !['N/A', 'On Hold'].includes(t.sla_status));
  const totalSLA = slaScope.length;
  const inSLA    = slaScope.filter(t => ['In SLA','Near Breach'].includes(t.sla_status)).length;

  const kpis = {
    total:    tickets.length,
    open:     tickets.filter(t => ['Open','In Progress'].includes(t.status)).length,
    sla_scope: totalSLA,
    breach_all: slaScope.filter(t => t.sla_status === 'Breach').length,
    breach:   tickets.filter(t => t.sla_status === 'Breach' && !['Resolved','Closed'].includes(t.status)).length,
    near_breach: tickets.filter(t => t.sla_status === 'Near Breach' && !['Resolved','Closed'].includes(t.status)).length,
    resolved: tickets.filter(t => t.status === 'Resolved').length,
    today:    tickets.filter(t => {
      if (!t.open_date) return false;
      const d = new Date(t.open_date); d.setHours(0,0,0,0);
      return d.getTime() === today.getTime();
    }).length,
    sla_compliance: totalSLA > 0 ? Math.round(inSLA / totalSLA * 100) : 100,
    by_domain:{}, by_priority:{}, by_type:{}, by_status:{}, by_fo:{}, by_fo_monthly:{}, by_fo_sla_monthly:{},
    breach_list: [], near_breach_list: [], oldest_open: null
  };

  const monthKeys = [];
  for (let i = 11; i >= 0; i--) {
    const m = new Date(today.getFullYear(), today.getMonth()-i, 1);
    monthKeys.push(m.getFullYear()+'-'+String(m.getMonth()+1).padStart(2,'0'));
  }
  kpis.fo_months = monthKeys;

  tickets.forEach(t => {
    if (t.domain)   kpis.by_domain[t.domain]     = (kpis.by_domain[t.domain]||0)+1;
    if (t.priority) kpis.by_priority[t.priority] = (kpis.by_priority[t.priority]||0)+1;
    if (t.type)     kpis.by_type[t.type]         = (kpis.by_type[t.type]||0)+1;
    if (t.status)   kpis.by_status[t.status]     = (kpis.by_status[t.status]||0)+1;
    const fo = t.assigned_to || t.fo_owner;
    if (fo) {
      if (!kpis.by_fo[fo]) kpis.by_fo[fo] = { open:0, resolved:0, breach:0, total:0 };
      kpis.by_fo[fo].total++;
      if (['Open','In Progress'].includes(t.status)) kpis.by_fo[fo].open++;
      if (t.status === 'Resolved') kpis.by_fo[fo].resolved++;
      if (t.sla_status === 'Breach') kpis.by_fo[fo].breach++;
      if (t.open_date) {
        const od = new Date(t.open_date);
        const mk = od.getFullYear()+'-'+String(od.getMonth()+1).padStart(2,'0');
        if (monthKeys.includes(mk)) {
          if (!kpis.by_fo_monthly[fo]) kpis.by_fo_monthly[fo] = {};
          kpis.by_fo_monthly[fo][mk] = (kpis.by_fo_monthly[fo][mk]||0)+1;
        }
      }
    }
    // SLA par agent et par mois, pour la note de performance du mois.
    // by_fo couvre tout l'historique : un agent sans shift depuis des mois
    // y gardait le taux de ses vieux tickets. Ici un ticket ne compte que
    // dans les mois où il a été ouvert ou clos, et seulement s'il est dans
    // le périmètre SLA (ni N/A ni On Hold, comme le taux global).
    if (fo && !['N/A', 'On Hold'].includes(t.sla_status)) {
      const mois = new Set();
      for (const d of [t.open_date, t.close_date]) {
        if (!d) continue;
        const x = new Date(d);
        if (isNaN(x)) continue;
        mois.add(x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0'));
      }
      for (const mk of mois) {
        if (!monthKeys.includes(mk)) continue;
        const parFo = kpis.by_fo_sla_monthly[fo] || (kpis.by_fo_sla_monthly[fo] = {});
        const m = parFo[mk] || (parFo[mk] = { scope: 0, breach: 0 });
        m.scope++;
        if (t.sla_status === 'Breach') m.breach++;
      }
    }
    const stillOpen = !['Resolved','Closed'].includes(t.status);
    if (t.sla_status === 'Breach' && stillOpen)
      kpis.breach_list.push({ id:t.id, tracker:t.tracker, sn_tt:t.sn_tt, title:t.title, priority:t.priority, time_left_ms:t.time_left_ms, fo_owner:t.fo_owner });
    if (t.sla_status === 'Near Breach' && stillOpen)
      kpis.near_breach_list.push({ id:t.id, tracker:t.tracker, sn_tt:t.sn_tt, title:t.title, priority:t.priority, time_left_ms:t.time_left_ms, fo_owner:t.fo_owner });
  });

  const open = tickets.filter(t => ['Open','In Progress'].includes(t.status) && t.duration_ms);
  if (open.length) {
    const oldest = open.reduce((a,b) => a.duration_ms > b.duration_ms ? a : b);
    kpis.oldest_open = { sn_tt:oldest.sn_tt, title:oldest.title, tracker:oldest.tracker, duration_ms:oldest.duration_ms };
  }
  res.json(kpis);
});

// ── EXPORT ───────────────────────────────────────────────────
// Export complet : réservé à l'admin. Il était public, et la config qu'il
// renvoie porte les notes, entretiens, objectifs et absences de chaque
// agent. Les condensés de mots de passe et de codes personnels n'en
// sortent jamais, même pour l'admin : une sauvegarde n'en a pas besoin.
router.get('/api/export', requireAdmin, (req, res) => {
  const {
    approval_password_hash, absence_password_hash, fo_access_codes, ...config
  } = readCfg();
  const data = {
    sn: readSN(), ci: readCI(),
    observations: readObs(), audit: readAudit(), config
  };
  const date = new Date().toISOString().slice(0,10);
  res.setHeader('Content-Disposition', `attachment; filename="pearl-data-${date}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(data, null, 2));
});

module.exports = router;
