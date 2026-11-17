const { readCfg, readObs } = require('../core/store');
const { buildWeeklyReport } = require('./reports');
const {
  readAbsences, ABSENCE_TYPES, eachDay, holidaySetFor, defaultNotice, noticeOk,
} = require('./absences');

// ══════════════════════════════════════════════════════════════
// WEEKLY PERFORMANCE — DAKAR × ABIDJAN
//
// Le Weekly Report est un rapport Sénégal. Celui-ci présente la même
// semaine aux deux équipes, côte à côte, avec une règle de plus : ce qui
// sort de l'ordinaire doit être expliqué. Le serveur repère donc ce qui
// appelle une explication — pics d'activité, absences à Dakar, incidents
// de plateforme — et propose ce que les Observations en disent déjà.
// Le client complète, le deck affiche ; une explication manquante reste
// visible sur la slide au lieu de disparaître.
//
// Chaque point à expliquer porte une clé stable (`key`) : c'est par elle
// que le texte saisi côté client retrouve sa place dans le deck.
// ══════════════════════════════════════════════════════════════

const SITES = [
  { code: 'SN', ville: 'Dakar' },
  { code: 'CI', ville: 'Abidjan' },
];

// Un incident de plateforme se reconnaît à son vocabulaire : les
// Observations sont du texte libre, sans catégorie. Mots FR et EN,
// accents ignorés.
const OUTAGE_RE = /\b(outage|panne|down|indispon\w*|unavailab\w*|coupure|interruption|crash\w*|plant\w*|degrad\w*|instab\w*|lenteur|slow\w*|inaccessib\w*|bloqu\w*|ko\b|hs\b|perte de (?:supervision|connexion|liaison)|incident (?:plateforme|platform|majeur))/i;
const sansAccent = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const isOutage = o => OUTAGE_RE.test(sansAccent(`${o.observation || ''} ${o.impact || ''}`));

const day = d => (d ? new Date(d).toISOString().slice(0, 10) : '');

function weekDays(weekStart) {
  const start = new Date(weekStart);
  return Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * 86400000 + 3600000)
    .toISOString().slice(0, 10));
}

const dayLabel = iso => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB',
  { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

// ── Activité d'un site ────────────────────────────────────────
// Un pic se juge contre l'habitude du site, pas contre l'autre site :
// Abidjan et Dakar n'ont pas le même volume. La référence est la moyenne
// journalière des sept semaines précédentes.
//
// Un jour est un pic s'il atteint au moins deux fois cette moyenne, avec
// un plancher de 3 tickets — sans plancher, passer de 0 à 1 ticket sur
// un site calme serait un « pic » à expliquer chaque semaine.
const PEAK_FACTOR = 2;
const PEAK_FLOOR  = 3;
// La semaine entière est un pic quand elle dépasse de moitié la moyenne
// hebdomadaire, avec un plancher de 5 tickets.
const WEEK_FACTOR = 1.5;
const WEEK_FLOOR  = 5;

function siteActivity(data, code, ville, obsBySite) {
  const days = weekDays(data.week_start);
  const tickets = data.week_tickets || [];
  const closedPool = data.closed_week_tickets || (data.active_tickets || []).concat(tickets);
  const seen = new Set();
  const opened = days.map(d => tickets.filter(t => day(t.open_date) === d).length);
  const closed = days.map(d => closedPool.filter(t => {
    if (day(t.close_date) !== d) return false;
    const id = t.id || t.sn_tt || JSON.stringify(t).slice(0, 80);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).length);

  const hist = (data.trend_history || []).slice(0, -1);   // la dernière = semaine courante
  const histWeeks = hist.filter(h => h.opened !== undefined);
  const avgWeek = histWeeks.length
    ? histWeeks.reduce((n, h) => n + (h.opened || 0), 0) / histWeeks.length : 0;
  const avgDay = avgWeek / 7;
  const seuil = Math.max(PEAK_FLOOR, Math.ceil(avgDay * PEAK_FACTOR));

  const obsDuJour = d => (obsBySite[code] || []).filter(o => day(o.date || o.created_at) === d);
  const suggestion = list => list.map(o => [o.observation, o.impact && `Impact: ${o.impact}`]
    .filter(Boolean).join(' · ')).join(' · ');

  const peaks = days.map((d, i) => ({ d, n: opened[i] }))
    .filter(x => x.n >= seuil)
    .map(x => {
      const obs = obsDuJour(x.d);
      return {
        key: `peak-${code}-${x.d}`,
        kind: 'peak', site: code, ville, day: x.d, label: dayLabel(x.d),
        count: x.n, baseline: Math.round(avgDay * 10) / 10,
        title: `${ville}: activity peak on ${dayLabel(x.d)}: ${x.n} tickets opened`
          + ` (usual ≈ ${Math.round(avgDay * 10) / 10}/day)`,
        suggestion: suggestion(obs),
        required: true,
      };
    });

  const k = data.kpis || {};
  const total = k.opened_this_week ?? tickets.length;
  const weekPeak = avgWeek > 0 && total >= Math.max(WEEK_FLOOR, Math.ceil(avgWeek * WEEK_FACTOR))
    ? {
        key: `week-${code}`,
        kind: 'week-peak', site: code, ville, count: total,
        baseline: Math.round(avgWeek * 10) / 10,
        title: `${ville}: busy week, ${total} tickets opened (usual ≈ ${Math.round(avgWeek)}/week)`,
        suggestion: '',
        required: true,
      }
    : null;

  // Répartitions utiles à la lecture du pic : où se concentre la charge.
  const top = obj => Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);

  return {
    code, ville,
    kpis: k, prev: data.prev_kpis || {},
    days, labels: days.map(d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB',
      { weekday: 'short', day: 'numeric', timeZone: 'UTC' })),
    opened, closed,
    avg_day: Math.round(avgDay * 10) / 10, avg_week: Math.round(avgWeek * 10) / 10,
    peak_threshold: seuil,
    peaks, week_peak: weekPeak,
    by_domain: top(data.by_domain), by_priority: top(data.by_priority),
    history: data.trend_history || [],
  };
}

// ── Assiduité de l'équipe de Dakar ────────────────────────────
// Agrégée, jamais nominative : le deck est diffusé aux deux équipes. On
// ne sort ni nom, ni motif, ni type précis — seulement planifié / non
// planifié / formation, ce qui suffit à la lecture opérationnelle.
// « On-Site (Delivery) » n'est pas une absence : l'agent travaille.
function dakarAttendance(weekStart, weekEnd, cfg) {
  const trackers = cfg.fo_trackers || {};
  const equipe = (cfg.fo_list || []).filter(fo =>
    [].concat(trackers[fo] || 'SN').map(x => String(x).toUpperCase()).includes('SN'));
  const membres = new Set(equipe);
  const feries = holidaySetFor('SN');
  const all = readAbsences().filter(a => membres.has(a.fo_name)
    && (a.status === 'Validée' || a.status === 'Demandée')
    && a.type !== 'On-Site (Delivery)');

  const window = (from, to) => {
    const jours = [];
    eachDay(from, to, (iso, dow) => {
      if (dow !== 0 && dow !== 6 && !feries.has(iso)) jours.push(iso);
    });
    const concerne = all.filter(a => a.date_from <= to && a.date_to >= from);
    const parJour = jours.map(iso => {
      const ce = concerne.filter(a => a.date_from <= iso && a.date_to >= iso);
      const poids = a => (a.half_day && a.date_from === a.date_to ? 0.5 : 1);
      const sum = f => ce.filter(f).reduce((n, a) => n + poids(a), 0);
      return {
        iso,
        planned:   sum(a => a.type !== 'Formation' && ABSENCE_TYPES[a.type]?.planned !== false),
        unplanned: sum(a => ABSENCE_TYPES[a.type]?.planned === false),
        training:  sum(a => a.type === 'Formation'),
      };
    });
    const tot = k => parJour.reduce((n, d) => n + d[k], 0);
    const capacity = jours.length * (equipe.length || 1);
    const absDays = tot('planned') + tot('unplanned');
    const notices = concerne.filter(a => a.type !== 'Formation').map(defaultNotice).filter(Boolean);
    return {
      from, to, working_days: jours.length, capacity_days: capacity,
      per_day: parJour,
      planned_days: tot('planned'), unplanned_days: tot('unplanned'), training_days: tot('training'),
      absence_days: absDays,
      absence_rate: capacity ? Math.round(absDays / capacity * 1000) / 10 : 0,
      unplanned_rate: capacity ? Math.round(tot('unplanned') / capacity * 1000) / 10 : 0,
      presence_rate: capacity ? Math.round((1 - absDays / capacity) * 1000) / 10 : null,
      people_absent: new Set(concerne.filter(a => a.type !== 'Formation').map(a => a.fo_name)).size,
      notice_rate: notices.length
        ? Math.round(notices.filter(noticeOk).length / notices.length * 1000) / 10 : null,
    };
  };

  const from = day(weekStart), to = day(weekEnd);
  const semaine = window(from, to);
  // Quatre semaines précédentes, pour dire si le taux est inhabituel.
  const trend = [];
  for (let i = 4; i >= 1; i--) {
    const s = new Date(new Date(weekStart).getTime() - i * 7 * 86400000);
    const e = new Date(s.getTime() + 6 * 86400000);
    const w = window(day(s), day(e));
    trend.push({ from: w.from, absence_rate: w.absence_rate, unplanned_rate: w.unplanned_rate });
  }
  trend.push({ from: semaine.from, absence_rate: semaine.absence_rate, unplanned_rate: semaine.unplanned_rate });

  return {
    ...semaine,
    headcount: equipe.length,
    labels: semaine.per_day.map(d => dayLabel(d.iso)),
    trend,
    key: 'attendance-SN',
    // Toute absence de la semaine s'explique en revue — planifiée ou non.
    // La formation seule n'appelle pas d'explication : c'est un choix.
    required: semaine.absence_days > 0,
  };
}

// ── Observations et incidents de plateforme ───────────────────
// Toutes les observations saisies dans la semaine, plus celles encore
// ouvertes : une panne déclarée la semaine dernière et toujours en cours
// fait partie de celle-ci. Sans source, une observation vaut pour les
// deux sites ; on la range à part pour ne pas la compter deux fois.
function weekObservations(weekStart, weekEnd) {
  const s = new Date(weekStart).getTime(), e = new Date(weekEnd).getTime();
  const inWeek = o => {
    const t = new Date(o.date || o.created_at).getTime();
    return t >= s && t <= e;
  };
  return readObs().filter(o => o && o.observation && (inWeek(o) || o.status === 'Open'
    || o.status === 'In Progress'))
    .map(o => {
      const src = String(o.source || '').trim().toUpperCase();
      const site = src === 'SN' || src === 'CI' ? src : 'ALL';
      const outage = isOutage(o);
      const explication = [o.impact && `Impact: ${o.impact}`,
        o.proposed_solution && `Action: ${o.proposed_solution}`].filter(Boolean).join(' · ');
      return {
        key: `obs-${o.id}`,
        kind: outage ? 'outage' : 'observation',
        id: o.id, site, date: day(o.date || o.created_at),
        text: String(o.observation), priority: o.priority || '', status: o.status || '',
        tt: o.tracker_tt || '', author: o.author || '',
        outage, suggestion: explication,
        // Un incident de plateforme doit dire son impact et sa suite.
        // Une observation simple se suffit à elle-même.
        required: outage,
      };
    })
    .sort((a, b) => (b.outage - a.outage) || String(a.date).localeCompare(String(b.date)));
}

function buildCombinedAnalysis(dateQuery) {
  const cfg = readCfg();
  const reports = SITES.map(s => buildWeeklyReport(dateQuery, s.code));
  const ref = reports[0];
  const observations = weekObservations(ref.week_start, ref.week_end);
  const obsBySite = { SN: [], CI: [] };
  observations.forEach(o => {
    if (o.site === 'ALL') { obsBySite.SN.push(raw(o)); obsBySite.CI.push(raw(o)); }
    else obsBySite[o.site].push(raw(o));
  });
  function raw(o) { return { observation: o.text, impact: '', date: o.date }; }

  const sites = SITES.map((s, i) => siteActivity(reports[i], s.code, s.ville, obsBySite));
  const attendance = dakarAttendance(ref.week_start, ref.week_end, cfg);

  // Liste unique de ce qui demande une explication, dans l'ordre du deck.
  const toExplain = [
    ...sites.flatMap(s => [...(s.week_peak ? [s.week_peak] : []), ...s.peaks]),
    ...(attendance.required ? [{
      key: attendance.key, kind: 'attendance', site: 'SN', ville: 'Dakar', required: true,
      title: `Dakar: ${attendance.absence_days} absence day(s) this week`
        + ` (${attendance.absence_rate}% of capacity, ${attendance.unplanned_days} unplanned)`,
      suggestion: '',
    }] : []),
    ...observations.filter(o => o.outage).map(o => ({
      key: o.key, kind: 'outage', site: o.site,
      ville: o.site === 'SN' ? 'Dakar' : o.site === 'CI' ? 'Abidjan' : 'Both sites',
      required: true, title: `${o.site === 'ALL' ? 'Both sites' : o.site === 'SN' ? 'Dakar' : 'Abidjan'}`
        + `: platform incident, ${o.text}`,
      suggestion: o.suggestion,
    })),
  ];

  return {
    week_start: ref.week_start, week_end: ref.week_end,
    sites, attendance, observations, to_explain: toExplain,
  };
}

module.exports = { buildCombinedAnalysis, isOutage };
