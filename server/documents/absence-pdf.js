/**
 * Rapport d'absences PDF, généré côté serveur.
 *
 * Entrée : l'objet renvoyé par computeAbsenceSummary (= la réponse de
 * /api/absences/summary) et la liste brute des absences. Rien n'est
 * relu sur disque : le module est pur, testable avec des données de
 * synthèse, et réutilisable par la diffusion e-mail.
 *
 * Parti pris : un rapport de pilotage, pas un export de tables.
 *   · une synthèse chiffrée + des constats rédigés automatiquement ;
 *   · des graphiques vectoriels (tendance mensuelle, jours de semaine,
 *     types, préavis, charge hebdomadaire) ;
 *   · la liste des agents à suivre, avec la raison du signalement ;
 *   · les soldes, les conflits de planning, puis le détail en annexe.
 *
 * Rapport en anglais (destiné au management) ; les valeurs saisies
 * (noms, motifs) restent telles quelles, accents compris.
 *
 * Signaux repris du rapport navigateur (_absReportSignals, app.js) :
 * volume > 1,5× la moyenne d'équipe, ou ≥ 3 absences subies ; épisodes
 * sans préavis. S'y ajoute le facteur de Bradford (S² × D, sur les
 * absences non planifiées), qui fait ressortir les absences courtes et
 * répétées — les plus perturbantes pour un planning.
 */

const { PdfDoc } = require('./pdf-lite');

// Seuils — alignés sur app.js pour que les deux rapports signalent
// les mêmes agents.
const SEUIL_MOYENNE  = 1.5;   // × la moyenne d'équipe
const SEUIL_SUBIS    = 3;     // épisodes non planifiés
const BRADFORD_WATCH = 50;    // barème usuel : 50 à surveiller…
const BRADFORD_HIGH  = 125;   // …125 action recommandée
const COVERAGE_MIN   = 0.75;  // part de l'équipe présente en dessous de laquelle on signale

const C = {
  brand: '#C7000B', brandSoft: '#FBE8E9', brandInk: '#9A0009',
  ink: '#16181D', text: '#2B2F36', mute: '#646B76', faint: '#9AA1AB',
  line: '#E4E7EB', hair: '#EFF1F3', soft: '#F5F6F8', track: '#E9ECF0',
  planned: '#7E93AD', plannedDark: '#34506F', pending: '#B9C7D8',
  amber: '#B86E00', amberSoft: '#FDF1DC', green: '#1E7F43', greenSoft: '#E4F3E9',
  white: '#FFFFFF',
};

const TYPE_EN = {
  'Congés payés': 'Paid leave', 'RTT': 'RTT (time off)', 'Maladie': 'Sick leave',
  'Accident travail': 'Work accident', 'Maternité': 'Maternity leave',
  'Paternité': 'Paternity leave', 'Formation': 'Training',
  'On-Site (Delivery)': 'On-site (delivery)', 'Sans solde': 'Unpaid leave',
  'Absence injustifiée': 'Unjustified absence', 'Autre': 'Other',
};
const TYPE_COLOR = {
  'Congés payés': '#34506F', 'RTT': '#6F8BAA', 'Formation': '#A9BCD1',
  'On-Site (Delivery)': '#5E8C79', 'Maternité': '#8C7BAF', 'Paternité': '#B5A8CE',
  'Sans solde': '#B4BAC3', 'Autre': '#D3D7DD',
  'Maladie': '#C7000B', 'Accident travail': '#E2585C', 'Absence injustifiée': '#7A0A10',
};
const EXTRA_COLORS = ['#C99A2E', '#4F7F8F', '#A06A8A', '#7C8A3E', '#8A8F98'];
const STATUS_EN = { 'Demandée': 'Requested', 'Validée': 'Approved', 'Refusée': 'Rejected', 'Annulée': 'Cancelled' };
const NOTICE_EN = {
  'Prévenu à l\'avance': 'In advance', 'Prévenu le jour même': 'Same day',
  'Prévenu en retard': 'Late', 'Non prévenu': 'No notice',
};
const NOTICE_ORDER = ['Prévenu à l\'avance', 'Prévenu le jour même', 'Prévenu en retard', 'Non prévenu'];
const NOTICE_COLOR = {
  'Prévenu à l\'avance': '#34506F', 'Prévenu le jour même': '#8FA5BF',
  'Prévenu en retard': '#E2585C', 'Non prévenu': '#C7000B',
};
// Même table que NOTICE_ALIASES (services/absences.js) : anciens slugs importés.
const NOTICE_ALIASES = {
  advance: 'Prévenu à l\'avance', same_day: 'Prévenu le jour même',
  late: 'Prévenu en retard', none: 'Non prévenu',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── PETITS UTILITAIRES ────────────────────────────────────────
const r1 = v => Math.round((Number(v) || 0) * 10) / 10;
const fmt = v => { const x = r1(v); return Number.isInteger(x) ? String(x) : x.toFixed(1); };
const pct = v => (v === null || v === undefined || isNaN(v)) ? 'n/a' : `${fmt(v)}%`;
const plural = (n, one, many) => `${fmt(n)} ${Number(n) === 1 ? one : (many || one + 's')}`;
const typeLabel = t => TYPE_EN[t] || t || 'Unspecified';

function parseIso(iso) { return new Date(iso + 'T00:00:00Z'); }
function isoOf(d) { return d.toISOString().slice(0, 10); }
function fmtDate(iso, year = true) {
  if (!iso) return '';
  const d = parseIso(iso);
  if (isNaN(d)) return String(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year ? ' ' + d.getUTCFullYear() : ''}`;
}
function fmtRange(a, b) {
  if (!a || !b) return `${fmtDate(a)}${b ? ' – ' + fmtDate(b) : ''}`;
  if (a === b) return fmtDate(a);
  const sameYear = a.slice(0, 4) === b.slice(0, 4);
  if (sameYear && a.slice(0, 7) === b.slice(0, 7)) return `${parseIso(a).getUTCDate()}–${fmtDate(b)}`;
  return `${fmtDate(a, !sameYear)} – ${fmtDate(b)}`;
}
function eachDay(from, to, fn) {
  const d = parseIso(from), end = parseIso(to);
  if (isNaN(d) || isNaN(end)) return;
  for (let i = 0; d <= end && i < 4000; i++) { fn(isoOf(d), d.getUTCDay()); d.setUTCDate(d.getUTCDate() + 1); }
}
function mondayOf(iso) {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return isoOf(d);
}
function addDays(iso, n) { const d = parseIso(iso); d.setUTCDate(d.getUTCDate() + n); return isoOf(d); }
function monthEnd(ym) {
  const [y, m] = ym.split('-').map(Number);
  return isoOf(new Date(Date.UTC(y, m, 0)));
}
function niceMax(v, ticks = 4) {
  if (!(v > 0)) return ticks;
  const raw = v / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const step = Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag);
  return step * ticks;
}
function noticeOf(a) {
  if (a.notice) return NOTICE_ALIASES[a.notice] || a.notice;
  const created = (a.created_at || '').slice(0, 10);
  if (created && created < a.date_from) return 'Prévenu à l\'avance';
  if (created && created === a.date_from) return 'Prévenu le jour même';
  if (created && created > a.date_from) return 'Non prévenu';
  return '';
}
const noticeIsOk = n => n === 'Prévenu à l\'avance' || n === 'Prévenu le jour même';
const toDate = v => (v instanceof Date ? v : new Date(v || Date.now()));

// ── ANALYSE ───────────────────────────────────────────────────
// Toutes les mesures dérivées du résumé et de la liste brute. Les jours
// viennent de `per_day` (déjà nets de week-ends et jours fériés côté
// serveur), rattachés à l'absence qui les couvre pour en connaître le
// type : les totaux restent ainsi égaux à ceux du résumé.
function analyse(summary, absences, generatedAt) {
  const s = summary || {};
  const from = s.from, to = s.to;
  const types = s.types || {};
  const isPlanned = t => !!types[t]?.planned;
  const headcount = s.headcount || (s.balances || []).length || 0;
  const genIso = isoOf(toDate(generatedAt));

  const inRange = (absences || []).filter(a => a && a.date_from && a.date_to
    && a.date_from <= to && a.date_to >= from);
  const counted = inRange.filter(a => a.status === 'Validée' || a.status === 'Demandée');

  const byName = {};
  for (const a of counted) (byName[a.fo_name] = byName[a.fo_name] || []).push(a);
  for (const k in byName) byName[k].sort((x, y) => x.date_from.localeCompare(y.date_from));

  const days = []; // { iso, name, a, w, planned }
  const daysByAbs = new Map();
  const pushDay = (iso, name, a) => {
    const w = a && a.half_day && a.date_from === a.date_to ? 0.5 : 1;
    const planned = a ? isPlanned(a.type) : false;
    days.push({ iso, name, a, w, planned });
    if (a) daysByAbs.set(a, (daysByAbs.get(a) || 0) + w);
  };
  if (s.per_day && typeof s.per_day === 'object') {
    for (const iso of Object.keys(s.per_day).sort()) {
      const seen = {};
      for (const name of s.per_day[iso] || []) {
        const k = seen[name] = (seen[name] || 0) + 1;
        const cands = (byName[name] || []).filter(a => a.date_from <= iso && a.date_to >= iso);
        pushDay(iso, name, cands[k - 1] || cands[0] || null);
      }
    }
  } else {
    // Repli sans per_day : jours ouvrés hors week-end (fériés inconnus).
    for (const a of counted) {
      eachDay(a.date_from < from ? from : a.date_from, a.date_to > to ? to : a.date_to, (iso, dow) => {
        if (dow !== 0 && dow !== 6) pushDay(iso, a.fo_name, a);
      });
    }
  }

  // Mois de la période (24 derniers au plus).
  let months = [];
  if (from && to) {
    let y = +from.slice(0, 4), m = +from.slice(5, 7);
    const endKey = to.slice(0, 7);
    for (let i = 0; i < 240; i++) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      months.push(key);
      if (key >= endKey) break;
      m++; if (m > 12) { m = 1; y++; }
    }
    months = months.slice(-24);
  }
  const monthly = Object.fromEntries(months.map(k => [k, { planned: 0, unplanned: 0, wd: 0, ok: 0, ko: 0 }]));
  for (const k of months) {
    const a = k + '-01' < from ? from : k + '-01';
    const b = monthEnd(k) > to ? to : monthEnd(k);
    eachDay(a, b, (_, dow) => { if (dow !== 0 && dow !== 6) monthly[k].wd++; });
  }
  const dow = [0, 1, 2, 3, 4, 5, 6].map(() => ({ planned: 0, unplanned: 0 }));
  const weekly = {};
  const perAgentUnplDays = {};
  for (const d of days) {
    const key = d.planned ? 'planned' : 'unplanned';
    const mk = d.iso.slice(0, 7);
    if (monthly[mk]) monthly[mk][key] += d.w;
    dow[parseIso(d.iso).getUTCDay()][key] += d.w;
    const wk = mondayOf(d.iso);
    weekly[wk] = weekly[wk] || { planned: 0, unplanned: 0 };
    weekly[wk][key] += d.w;
    if (!d.planned) perAgentUnplDays[d.name] = (perAgentUnplDays[d.name] || 0) + d.w;
  }
  // Préavis par mois de début d'absence.
  for (const a of counted) {
    const n = noticeOf(a);
    const mk = (a.date_from < from ? from : a.date_from).slice(0, 7);
    if (!n || !monthly[mk]) continue;
    if (noticeIsOk(n)) monthly[mk].ok++; else monthly[mk].ko++;
  }

  // Semaines : toutes celles de la période, même vides, pour le graphe.
  const weeks = [];
  if (from && to) {
    for (let wk = mondayOf(from), i = 0; wk <= to && i < 110; wk = addDays(wk, 7), i++) {
      let wd = 0;
      for (let j = 0; j < 5; j++) { const iso = addDays(wk, j); if (iso >= from && iso <= to) wd++; }
      const v = weekly[wk] || { planned: 0, unplanned: 0 };
      weeks.push({ start: wk, end: addDays(wk, 4), wd, planned: v.planned, unplanned: v.unplanned,
        total: v.planned + v.unplanned,
        load: wd && headcount ? (v.planned + v.unplanned) / (wd * headcount) : 0 });
    }
  }
  const busiest = weeks.reduce((b, w) => (w.total > (b?.total || 0) ? w : b), null);

  // Couverture : jours où la part d'équipe présente passe sous le seuil.
  const lowDays = [];
  if (headcount) {
    for (const [iso, names] of Object.entries(s.per_day || {})) {
      const n = new Set(names).size;
      if (n >= 2 && (headcount - n) / headcount < COVERAGE_MIN) lowDays.push({ iso, n });
    }
    lowDays.sort((a, b) => b.n - a.n || a.iso.localeCompare(b.iso));
  }

  // Agents : signaux du rapport navigateur + Bradford.
  const bal = s.balances || [];
  const avg = bal.length ? bal.reduce((t, b) => t + (b.total_days || 0), 0) / bal.length : 0;
  const seuil = r1(avg * SEUIL_MOYENNE);
  const unplEpisodes = {};
  for (const a of counted) if (!isPlanned(a.type)) unplEpisodes[a.fo_name] = (unplEpisodes[a.fo_name] || 0) + 1;
  const agents = bal.map(b => {
    const S = unplEpisodes[b.fo_name] || 0;
    const D = r1(perAgentUnplDays[b.fo_name] || 0);
    const bradford = Math.round(S * S * D);
    const ratio = avg ? (b.total_days || 0) / avg : 0;
    const byVolume = avg > 0 && (b.total_days || 0) > seuil;
    const byFrequency = S >= SEUIL_SUBIS;
    const byBradford = bradford >= BRADFORD_WATCH;
    const byNotice = (b.no_notice_episodes || 0) > 0;
    const severity = (bradford >= BRADFORD_HIGH ? 4 : byBradford ? 2 : 0) + (byVolume ? 3 : 0)
      + (byFrequency ? 2 : 0) + (byNotice ? 1 + b.no_notice_episodes * 0.1 : 0);
    return { ...b, S, D, bradford, ratio, byVolume, byFrequency, byBradford, byNotice, severity };
  });
  const watch = agents.filter(a => a.byVolume || a.byFrequency || a.byBradford || a.byNotice)
    .sort((a, b) => b.severity - a.severity || (b.total_days || 0) - (a.total_days || 0));

  // Tendance : dernier mois complet vs le précédent.
  const cutoff = genIso < to ? genIso : to;
  const complete = months.filter(k => (monthEnd(k) > to ? to : monthEnd(k)) <= cutoff);
  let trend = null;
  if (complete.length >= 2 && headcount) {
    const cur = complete[complete.length - 1], prev = complete[complete.length - 2];
    const rate = k => { const m = monthly[k]; return m.wd ? ((m.planned + m.unplanned) / (m.wd * headcount)) * 100 : 0; };
    trend = { cur, prev, curRate: rate(cur), prevRate: rate(prev),
      curDays: monthly[cur].planned + monthly[cur].unplanned,
      prevDays: monthly[prev].planned + monthly[prev].unplanned,
      curPlanned: monthly[cur].planned,
      curNotice: monthly[cur].ok + monthly[cur].ko ? (monthly[cur].ok / (monthly[cur].ok + monthly[cur].ko)) * 100 : null,
      curNoticeN: monthly[cur].ok + monthly[cur].ko };
  }

  const byType = Object.entries(s.by_type || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const detail = [...inRange].sort((a, b) => a.date_from.localeCompare(b.date_from)
    || String(a.fo_name).localeCompare(String(b.fo_name)));

  return { s, from, to, headcount, isPlanned, inRange, counted, days, daysByAbs, months, monthly, dow,
    weeks, busiest, lowDays, agents, watch, avg: r1(avg), seuil, trend, byType, detail };
}

// ── CONSTATS RÉDIGÉS ──────────────────────────────────────────
function buildInsights(A) {
  const { s } = A;
  const out = []; // { p: priorité, tone, text }
  const total = s.total_days || 0;
  if (!total) {
    out.push({ p: 0, tone: 'good', text: `No absence was recorded between ${fmtDate(A.from)} and ${fmtDate(A.to)}: the team was fully available over the period.` });
    if (s.pending_count) out.push({ p: 1, tone: 'info', text: `${plural(s.pending_count, 'leave request')} ${s.pending_count === 1 ? 'is' : 'are'} awaiting approval.` });
    return out;
  }
  const unpl = s.unplanned_days || 0;
  const share = total ? (unpl / total) * 100 : 0;
  out.push({ p: 1.2, tone: share >= 40 ? 'alert' : share >= 25 ? 'watch' : 'good',
    text: `Unplanned absences account for ${Math.round(share)}% of days lost (${fmt(unpl)} of ${fmt(total)} days), `
      + `i.e. ${pct(s.unplanned_rate)} of team capacity against ${pct(s.absence_rate)} for all absences.` });

  const t = A.trend;
  if (t && (t.curDays || t.prevDays)) {
    const diff = t.curRate - t.prevRate;
    const m1 = MONTHS_LONG[+t.cur.slice(5) - 1], m0 = MONTHS_LONG[+t.prev.slice(5) - 1];
    const dir = Math.abs(diff) < 0.3 ? 'held steady at' : diff > 0 ? 'rose to' : 'fell to';
    // Une hausse portée par les congés posés n'est pas une alerte.
    const mostlyPlanned = t.curDays > 0 && t.curPlanned / t.curDays >= 0.7;
    const alert = diff >= 1 && !mostlyPlanned;
    out.push({ p: alert ? 1 : 3.5, tone: alert ? 'alert' : diff > 0.3 && !mostlyPlanned ? 'watch' : diff > 0.3 ? 'info' : 'good',
      text: `The absence rate ${dir} ${pct(t.curRate)} in ${m1} (${fmt(t.curDays)} days), `
        + (Math.abs(diff) < 0.3 ? `in line with ${m0}` : `from ${pct(t.prevRate)} in ${m0} (${diff > 0 ? '+' : ''}${fmt(diff)} pts)`)
        + (diff > 0.3 && mostlyPlanned ? `, driven by planned leave (${fmt(t.curPlanned)} of ${fmt(t.curDays)} days).` : '.') });
  }

  const volume = A.watch.filter(a => a.byVolume);
  if (volume.length) {
    const names = volume.slice(0, 3).map(a => `${a.fo_name} (${fmt(a.total_days)} d)`).join(', ');
    out.push({ p: 1, tone: 'alert', text: `${plural(volume.length, 'agent')} ${volume.length === 1 ? 'exceeds' : 'exceed'} ${SEUIL_MOYENNE}× the team average of ${fmt(A.avg)} days: ${names}${volume.length > 3 ? ', …' : ''}.` });
  }
  const brad = A.agents.filter(a => a.bradford >= BRADFORD_HIGH).sort((a, b) => b.bradford - a.bradford);
  if (brad.length) {
    const names = brad.slice(0, 3).map(a => `${a.fo_name} (${a.bradford})`).join(', ');
    out.push({ p: 1.5, tone: 'alert', text: `Frequent short absences: ${plural(brad.length, 'agent')} ${brad.length === 1 ? 'has' : 'have'} a Bradford factor of ${BRADFORD_HIGH} or more — ${names}.` });
  }

  const dw = A.dow;
  const unplWeek = [1, 2, 3, 4, 5].reduce((t2, i) => t2 + dw[i].unplanned, 0);
  if (unplWeek >= 4) {
    const mf = ((dw[1].unplanned + dw[5].unplanned) / unplWeek) * 100;
    if (mf >= 45) {
      out.push({ p: mf >= 55 ? 1.8 : 3, tone: mf >= 55 ? 'alert' : 'watch',
        text: `Mondays and Fridays concentrate ${Math.round(mf)}% of unplanned absence days (40% would be expected if they were evenly spread).` });
    } else {
      const top = [1, 2, 3, 4, 5].sort((a, b) => dw[b].unplanned - dw[a].unplanned)[0];
      out.push({ p: 6, tone: 'info', text: `Unplanned absences show no Monday/Friday pattern (${Math.round(mf)}% on those days); ${['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][top]} is the most affected day.` });
    }
  }

  if (s.notice_rate !== null && s.notice_rate !== undefined) {
    const ko = s.notice_ko || 0;
    if (t && t.curNotice !== null && t.curNoticeN >= 3 && t.curNotice <= s.notice_rate - 10) {
      out.push({ p: 1.6, tone: 'alert', text: `Notice compliance fell to ${pct(t.curNotice)} in ${MONTHS_LONG[+t.cur.slice(5) - 1]}, against ${pct(s.notice_rate)} over the whole period.` });
    } else if (s.notice_rate < 80) {
      out.push({ p: 2, tone: 'alert', text: `Only ${pct(s.notice_rate)} of absences were notified on time — ${plural(ko, 'episode')} started without proper notice.` });
    } else {
      out.push({ p: 5, tone: 'good', text: `Notice compliance is ${pct(s.notice_rate)}${ko ? ` (${plural(ko, 'episode')} without proper notice)` : ''}.` });
    }
  }

  if (A.lowDays.length) {
    const w = A.lowDays[0];
    const d = parseIso(w.iso);
    out.push({ p: 2.2, tone: 'watch', text: `Team coverage dropped below ${Math.round(COVERAGE_MIN * 100)}% on ${plural(A.lowDays.length, 'working day')} — worst on ${DOW[d.getUTCDay()]} ${fmtDate(w.iso)}, with ${w.n} of ${A.headcount} agents absent.` });
  }
  if (A.busiest && A.busiest.total > 0) {
    const b = A.busiest;
    out.push({ p: 4.5, tone: 'info', text: `Busiest week: ${fmtRange(b.start, b.end)}, with ${fmt(b.total)} days lost (${fmt(b.planned)} planned, ${fmt(b.unplanned)} unplanned).` });
  }
  const nc = (s.conflicts || []).length;
  if (nc) out.push({ p: 2.5, tone: 'watch', text: `${plural(nc, 'planning conflict')}: agents scheduled on a shift while absent — the shift plan needs updating.` });
  if (s.pending_count) out.push({ p: 5.5, tone: 'info', text: `${plural(s.pending_count, 'leave request')} ${s.pending_count === 1 ? 'is' : 'are'} still awaiting approval.` });

  return out.sort((a, b) => a.p - b.p).slice(0, 5);
}

// ── MISE EN PAGE ──────────────────────────────────────────────
const PW = 595.28, PH = 841.89, M = 40, CW = PW - 2 * M;
const BOTTOM = PH - 52;
const TONE = { alert: C.brand, watch: '#E39B00', good: C.green, info: C.planned };

class Layout {
  constructor(doc, meta) { this.doc = doc; this.meta = meta; this.y = 0; }

  newPage() {
    const d = this.doc;
    d.addPage();
    d.text('EMOC', M, 30, { size: 8, bold: true, color: C.brand, charSpace: 0.8 });
    d.text('Absence report', M + 30, 30, { size: 8, color: C.mute });
    d.text(this.meta.periodLabel, PW - M, 30, { size: 8, color: C.mute, align: 'right' });
    d.line(M, 38, PW - M, 38, { color: C.line, width: 0.6 });
    this.y = 62;
  }

  ensure(h) { if (this.y + h > BOTTOM) { this.newPage(); return true; } return false; }

  section(eyebrow, title, desc, minBelow = 80) {
    const d = this.doc;
    const descLines = desc ? d.wrap(desc, CW, 9) : [];
    this.ensure(34 + descLines.length * 12.5 + minBelow);
    d.text(eyebrow.toUpperCase(), M, this.y, { size: 7.5, bold: true, color: C.brand, charSpace: 1.1 });
    d.text(title, M, this.y + 19, { size: 15, bold: true, color: C.ink });
    this.y += 27;
    descLines.forEach((ln, i) => d.text(ln, M, this.y + 6 + i * 12.5, { size: 9, color: C.mute }));
    this.y += (descLines.length ? descLines.length * 12.5 + 8 : 4);
  }

  /**
   * Tableau paginé, en-tête répété à chaque page.
   * cols: [{ label, w, align, get(row) -> texte, draw?(doc,x,y,w,h,row), color?(row), bold?(row) }]
   */
  table(cols, rows, { rowH = 18, size = 8.5, empty = 'No data.', title } = {}) {
    const d = this.doc;
    const headH = 20;
    const drawHead = cont => {
      if (cont && title) {
        d.text(`${title} (continued)`, M, this.y + 2, { size: 9, bold: true, color: C.mute });
        this.y += 14;
      }
      let x = M;
      for (const c of cols) {
        const tx = c.align === 'right' ? x + c.w - 6 : c.align === 'center' ? x + c.w / 2 : x + 6;
        d.text(c.label.toUpperCase(), tx, this.y + 12, { size: 6.8, bold: true, color: C.mute, align: c.align || 'left', maxWidth: c.w - 8, charSpace: 0.4 });
        x += c.w;
      }
      d.line(M, this.y + headH - 0.5, M + CW, this.y + headH - 0.5, { color: C.ink, width: 0.8 });
      this.y += headH;
    };
    this.ensure(headH + rowH * Math.min(3, Math.max(1, rows.length)));
    drawHead(false);
    if (!rows.length) {
      d.text(empty, M + 6, this.y + 15, { size: 9, color: C.mute });
      this.y += 24;
      return;
    }
    for (const row of rows) {
      if (this.y + rowH > BOTTOM) { this.newPage(); drawHead(true); }
      let x = M;
      if (row._bg) d.rect(M, this.y, CW, rowH, { fill: row._bg });
      for (const c of cols) {
        if (c.draw) c.draw(d, x, this.y, c.w, rowH, row);
        else {
          const v = c.get(row);
          const tx = c.align === 'right' ? x + c.w - 6 : c.align === 'center' ? x + c.w / 2 : x + 6;
          d.text(v, tx, this.y + rowH / 2 + size * 0.35, {
            size, bold: c.bold ? c.bold(row) : false, color: c.color ? c.color(row) : C.text,
            align: c.align || 'left', maxWidth: c.w - 10,
          });
        }
        x += c.w;
      }
      d.line(M, this.y + rowH, M + CW, this.y + rowH, { color: C.hair, width: 0.6 });
      this.y += rowH;
    }
    this.y += 6;
  }
}

// Panneau gris clair arrondi, titre en haut à gauche.
function panel(d, x, y, w, h, title, sub) {
  d.rect(x, y, w, h, { fill: C.soft, radius: 8 });
  if (title) d.text(title, x + 14, y + 20, { size: 10, bold: true, color: C.ink, maxWidth: w - 28 });
  if (sub) d.text(sub, x + 14, y + 33, { size: 7.8, color: C.mute, maxWidth: w - 28 });
}
function legend(d, items, xRight, y) {
  // Aligné à droite : on mesure d'abord.
  // kind 'dash' : repère en pointillé (lignes de moyenne / seuil).
  const sw = kind => (kind === 'dash' ? 14 : 8);
  const widths = items.map(([label, , kind]) => sw(kind) + 4 + d.widthOf(label, 7.5) + 12);
  let x = xRight - widths.reduce((a, b) => a + b, 0) + 12;
  items.forEach(([label, color, kind], i) => {
    if (kind === 'dash') d.line(x, y - 2.5, x + 14, y - 2.5, { color, width: 1, dash: [2.5, 1.5] });
    else d.rect(x, y - 6.5, 8, 8, { fill: color, radius: 2 });
    d.text(label, x + sw(kind) + 4, y, { size: 7.5, color: C.mute });
    x += widths[i];
  });
}
function emptyChart(d, x, y, w, h, msg) {
  d.text(msg || 'No absence data for this period', x + w / 2, y + h / 2, { size: 8.5, color: C.faint, align: 'center' });
}

// Barres empilées prévu / non planifié, avec grille et total au-dessus.
function stackedBars(d, x, y, w, h, items, { labelSize = 7.5, gapRatio = 0.34, showTotals = true } = {}) {
  const max = niceMax(Math.max(0, ...items.map(i => i.planned + i.unplanned)));
  const axisW = 22;
  const px = x + axisW, pw = w - axisW, ph = h - 16;
  for (let t = 0; t <= 4; t++) {
    const gy = y + ph - (ph * t) / 4;
    d.line(px, gy, px + pw, gy, { color: t === 0 ? '#C9CED6' : '#E2E5EA', width: t === 0 ? 0.8 : 0.5 });
    d.text(fmt((max * t) / 4), px - 5, gy + 2.5, { size: 6.5, color: C.faint, align: 'right' });
  }
  const slot = pw / Math.max(1, items.length);
  const bw = Math.min(34, slot * (1 - gapRatio));
  items.forEach((it, i) => {
    const bx = px + i * slot + (slot - bw) / 2;
    const hp = (ph * it.planned) / max, hu = (ph * it.unplanned) / max;
    const top = y + ph - hp - hu;
    const r = Math.min(3, bw / 4);
    // Coin arrondi uniquement au sommet de la pile.
    if (hu > 0) d.roundRect(bx, top, bw, hu, [r, r, 0, 0], { fill: C.brand });
    if (hp > 0) d.roundRect(bx, y + ph - hp, bw, hp, hu > 0 ? 0 : [r, r, 0, 0], { fill: C.planned });
    if (showTotals && it.planned + it.unplanned > 0)
      d.text(fmt(it.planned + it.unplanned), bx + bw / 2, top - 3.5, { size: 6.8, bold: true, color: C.text, align: 'center' });
    d.text(it.label, bx + bw / 2, y + ph + 11, { size: labelSize, color: it.dim ? C.faint : C.mute, align: 'center' });
  });
}

// ── RENDU ─────────────────────────────────────────────────────
function defaultPeriodLabel(from, to) {
  if (!from || !to) return '';
  if (from.slice(5) === '01-01' && to.slice(5) === '12-31' && from.slice(0, 4) === to.slice(0, 4))
    return `Year ${from.slice(0, 4)} · ${fmtRange(from, to)}`;
  return fmtRange(from, to);
}

function drawCover(L, A, meta) {
  const d = L.doc, s = A.s;
  d.addPage();
  d.rect(0, 0, PW, 136, { fill: C.brand });
  d.text('EMOC  ·  FRONT OFFICE', M, 44, { size: 8, bold: true, color: '#F7C6C8', charSpace: 1.4 });
  d.text('Absence report', M, 80, { size: 30, bold: true, color: C.white });
  d.text(meta.periodLabel, M, 103, { size: 12, color: '#FFE1E2', maxWidth: 300 });

  const facts = [
    ['SCOPE', s.country ? `Tracker ${s.country}` : 'All trackers'],
    ['TEAM', `${plural(A.headcount, 'agent')} · ${plural(s.working_days || 0, 'working day')}`],
    ['GENERATED', meta.generatedLabel],
  ];
  facts.forEach(([k, v], i) => {
    const yy = 44 + i * 30;
    d.text(k, PW - M, yy, { size: 6.8, bold: true, color: '#F7C6C8', align: 'right', charSpace: 1.1 });
    d.text(v, PW - M, yy + 13, { size: 9.5, bold: true, color: C.white, align: 'right' });
  });
  L.y = 166;
}

function drawKpis(L, A) {
  const d = L.doc, s = A.s;
  const ep = A.counted.length;
  const nConf = (s.conflicts || []).length;
  const noticeSub = s.notice_rate === null || s.notice_rate === undefined
    ? (s.notice_unknown ? `${s.notice_unknown} episodes to qualify` : 'No episode to assess')
    : `${s.notice_ok || 0} of ${(s.notice_ok || 0) + (s.notice_ko || 0)} on time${s.notice_unknown ? ` · ${s.notice_unknown} to qualify` : ''}`;
  const tone = (v, warn, alert, reverse) => {
    if (v === null || v === undefined) return null;
    if (reverse) return v < alert ? 'alert' : v < warn ? 'watch' : 'good';
    return v >= alert ? 'alert' : v >= warn ? 'watch' : 'good';
  };
  const share = s.total_days ? Math.round(((s.unplanned_days || 0) / s.total_days) * 100) : 0;
  const tiles = [
    ['Absence rate', pct(s.absence_rate), `${fmt(s.total_days || 0)} of ${fmt((s.working_days || 0) * A.headcount)} capacity days`, tone(s.absence_rate, 4, 6)],
    ['Unplanned rate', pct(s.unplanned_rate), `${fmt(s.unplanned_days || 0)} days · ${share}% of days lost`, tone(s.unplanned_rate, 2, 3.5)],
    ['Days lost', fmt(s.total_days || 0), `${plural(ep, 'episode')} · avg ${fmt(A.avg)} d per agent`, null],
    ['Notice compliance', pct(s.notice_rate), noticeSub, tone(s.notice_rate, 90, 80, true)],
    ['Pending requests', String(s.pending_count || 0), s.pending_count ? 'Awaiting approval' : 'Nothing awaiting approval', s.pending_count ? 'watch' : 'good'],
    ['Planning conflicts', String(nConf), nConf ? 'Absent while on the shift plan' : 'Shift plan consistent', nConf ? 'alert' : 'good'],
  ];
  const gap = 10, tw = (CW - 2 * gap) / 3, th = 66;
  L.ensure(2 * th + gap + 10);
  tiles.forEach(([label, value, sub, tn], i) => {
    const x = M + (i % 3) * (tw + gap), y = L.y + Math.floor(i / 3) * (th + gap);
    d.rect(x, y, tw, th, { fill: C.soft, radius: 8 });
    d.text(label.toUpperCase(), x + 14, y + 19, { size: 6.8, bold: true, color: C.mute, charSpace: 0.7, maxWidth: tw - 40 });
    if (tn) {
      const col = TONE[tn];
      const tag = { alert: 'HIGH', watch: 'WATCH', good: 'OK', info: '' }[tn];
      const tagW = d.widthOf(tag, 6, true) + 12;
      const bg = { alert: C.brandSoft, watch: C.amberSoft, good: C.greenSoft }[tn];
      d.rect(x + tw - 12 - tagW, y + 10, tagW, 13, { fill: bg, radius: 6.5 });
      d.text(tag, x + tw - 12 - tagW / 2, y + 19, { size: 6, bold: true, color: tn === 'watch' ? C.amber : col, align: 'center' });
    }
    d.text(value, x + 14, y + 44, { size: 22, bold: true, color: C.ink });
    d.text(sub, x + 14, y + 57, { size: 7.5, color: C.mute, maxWidth: tw - 28 });
  });
  L.y += 2 * th + gap + 14;
}

function drawInsights(L, insights) {
  const d = L.doc;
  const size = 9.8, lead = 13.6, textW = CW - 50;
  const blocks = insights.map(it => ({ it, lines: d.wrap(it.text, textW, size) }));
  const h = blocks.reduce((t, b) => t + b.lines.length * lead + 10, 0) + 34;
  L.ensure(h);
  const y0 = L.y;
  d.rect(M, y0, CW, h, { fill: C.white, stroke: C.line, lineWidth: 0.8, radius: 8 });
  d.text('Key insights', M + 16, y0 + 22, { size: 10, bold: true, color: C.ink });
  let y = y0 + 40;
  blocks.forEach(({ it, lines }, i) => {
    const col = TONE[it.tone] || C.planned;
    d.circle(M + 24, y - 3.3, 7.5, { fill: col });
    d.text(String(i + 1), M + 24, y - 0.6, { size: 7.5, bold: true, color: C.white, align: 'center' });
    lines.forEach((ln, j) => d.text(ln, M + 40, y + j * lead, { size, color: C.text }));
    y += lines.length * lead + 10;
  });
  L.y = y0 + h + 14;
}

function drawMonthly(L, A) {
  const d = L.doc;
  const h = 178;
  L.ensure(h);
  const y = L.y;
  panel(d, M, y, CW, h, 'Monthly trend', 'Working days lost per month, planned vs unplanned');
  legend(d, [['Planned', C.planned], ['Unplanned', C.brand]], M + CW - 14, y + 20);
  const items = A.months.map(k => ({ label: MONTHS[+k.slice(5) - 1] + (A.months.length > 12 ? ` ${k.slice(2, 4)}` : ''),
    planned: A.monthly[k].planned, unplanned: A.monthly[k].unplanned }));
  if (!A.days.length) emptyChart(d, M, y + 30, CW, h - 30);
  else stackedBars(d, M + 14, y + 52, CW - 28, h - 64, items, { labelSize: A.months.length > 12 ? 6 : 7.5 });
  L.y = y + h + 14;
}

function drawDowAndTypes(L, A) {
  const d = L.doc;
  const h = 210, gap = 12, w1 = (CW - gap) * 0.46, w2 = CW - gap - w1;
  L.ensure(h + 10);
  const y = L.y;
  // Jours de semaine
  panel(d, M, y, w1, h, 'Day of week', 'Working days lost by weekday');
  const items = [1, 2, 3, 4, 5].map(i => ({ label: DOW[i], planned: A.dow[i].planned, unplanned: A.dow[i].unplanned }));
  if (!A.days.length) emptyChart(d, M, y + 30, w1, h - 30);
  else {
    stackedBars(d, M + 10, y + 56, w1 - 24, h - 90, items, { gapRatio: 0.42 });
    const unpl = items.reduce((t, i) => t + i.unplanned, 0);
    const mf = unpl ? Math.round(((items[0].unplanned + items[4].unplanned) / unpl) * 100) : 0;
    d.text(unpl ? `Mon + Fri: ${mf}% of unplanned days (neutral: 40%)` : 'No unplanned absence in the period',
      M + 14, y + h - 12, { size: 7.5, color: unpl && mf >= 55 ? C.brand : C.mute, bold: unpl && mf >= 55, maxWidth: w1 - 28 });
  }
  // Types
  const x2 = M + w1 + gap;
  panel(d, x2, y, w2, h, 'Absence types', 'Share of working days lost');
  if (!A.byType.length) emptyChart(d, x2, y + 30, w2, h - 30);
  else {
    const total = A.byType.reduce((t, [, v]) => t + v, 0);
    let list = A.byType;
    if (list.length > 7) {
      const rest = list.slice(6).reduce((t, [, v]) => t + v, 0);
      list = [...list.slice(0, 6), ['__other', rest]];
    }
    let extra = 0;
    const colorOf = k => k === '__other' ? '#C4C9D0' : TYPE_COLOR[k] || EXTRA_COLORS[extra++ % EXTRA_COLORS.length];
    const colored = list.map(([k, v]) => [k, v, colorOf(k)]);
    const cx = x2 + 72, cy = y + 118, ro = 52, ri = 33;
    let a = 0;
    const gapA = colored.length > 1 ? 0.012 : 0;
    colored.forEach(([, v, col]) => {
      const da = (v / total) * Math.PI * 2;
      d.arcBand(cx, cy, ro, ri, a + gapA, a + da - gapA, { fill: col });
      a += da;
    });
    d.text(fmt(total), cx, cy + 3, { size: 15, bold: true, color: C.ink, align: 'center' });
    d.text('days', cx, cy + 14, { size: 7, color: C.mute, align: 'center' });
    // Légende
    const lx = x2 + 142, lw = w2 - 142 - 14;
    let ly = y + 118 - (colored.length * 17) / 2 + 6;
    colored.forEach(([k, v, col]) => {
      d.rect(lx, ly - 7, 8, 8, { fill: col, radius: 2 });
      const share = Math.round((v / total) * 100);
      d.text(k === '__other' ? 'Other types' : typeLabel(k), lx + 13, ly, { size: 8, color: C.text, maxWidth: lw - 64 });
      d.text(`${fmt(v)} d`, lx + lw - 26, ly, { size: 8, bold: true, color: C.ink, align: 'right' });
      d.text(`${share}%`, lx + lw, ly, { size: 8, color: C.mute, align: 'right' });
      ly += 17;
    });
  }
  L.y = y + h + 14;
}

function drawNoticeAndWeekly(L, A) {
  const d = L.doc, s = A.s;
  // Préavis : barre 100 % empilée
  const h1 = 96;
  L.ensure(h1 + 10);
  let y = L.y;
  panel(d, M, y, CW, h1, 'Notice compliance', 'How absences were announced (episodes, qualified only)');
  const counts = NOTICE_ORDER.map(k => [k, (s.by_notice || {})[k] || 0]);
  const extra = Object.entries(s.by_notice || {}).filter(([k]) => !NOTICE_ORDER.includes(k));
  extra.forEach(([k, v]) => counts.push([k, v]));
  const q = counts.reduce((t, [, v]) => t + v, 0);
  const bigX = M + 14;
  d.text(pct(s.notice_rate), bigX, y + 66, { size: 22, bold: true, color: s.notice_rate !== null && s.notice_rate < 80 ? C.brand : C.ink });
  d.text('on time', bigX, y + 79, { size: 7.5, color: C.mute });
  const bx = M + 110, bw = CW - 124, by = y + 50;
  if (!q) {
    d.rect(bx, by, bw, 14, { fill: C.track, radius: 7 });
    d.text(s.notice_unknown ? `${plural(s.notice_unknown, 'episode')} still to qualify` : 'No episode to assess', bx + bw / 2, by + 10, { size: 7.5, color: C.mute, align: 'center' });
  } else {
    let x = bx;
    const segs = counts.filter(([, v]) => v > 0);
    segs.forEach(([k, v], i) => {
      const w = (v / q) * bw;
      const r = [i === 0 ? 7 : 0, i === segs.length - 1 ? 7 : 0, i === segs.length - 1 ? 7 : 0, i === 0 ? 7 : 0];
      d.roundRect(x, by, w, 14, r, { fill: NOTICE_COLOR[k] || '#A0A6AE' });
      if (w > 26) d.text(`${Math.round((v / q) * 100)}%`, x + w / 2, by + 10, { size: 7, bold: true, color: C.white, align: 'center' });
      x += w;
    });
    let lx = bx;
    counts.forEach(([k, v]) => {
      const label = `${NOTICE_EN[k] || k} · ${v}`;
      d.rect(lx, by + 22, 7, 7, { fill: NOTICE_COLOR[k] || '#A0A6AE', radius: 2 });
      d.text(label, lx + 11, by + 28.5, { size: 7.5, color: C.mute });
      lx += d.widthOf(label, 7.5) + 26;
    });
    if (s.notice_unknown) d.text(`+ ${s.notice_unknown} to qualify`, bx + bw, by + 28.5, { size: 7.5, color: C.faint, align: 'right' });
  }
  L.y = y + h1 + 14;

  // Charge hebdomadaire
  const h2 = 150;
  L.ensure(h2 + 10);
  y = L.y;
  panel(d, M, y, CW, h2, 'Weekly team load', 'Share of team capacity absent each week');
  const weeks = A.weeks;
  if (!A.days.length || !weeks.length) { emptyChart(d, M, y + 30, CW, h2 - 30); L.y = y + h2 + 14; return; }
  const loads = weeks.map(w => w.load * 100);
  const avgLoad = loads.reduce((t, v) => t + v, 0) / Math.max(1, loads.filter((_, i) => weeks[i].wd).length);
  const max = Math.max(niceMax(Math.max(...loads, (1 - COVERAGE_MIN) * 100 + 2), 4), 5);
  const px = M + 36, pw = CW - 50, py = y + 48, ph = h2 - 72;
  for (let t = 0; t <= 4; t++) {
    const gy = py + ph - (ph * t) / 4;
    d.line(px, gy, px + pw, gy, { color: t === 0 ? '#C9CED6' : '#E2E5EA', width: t === 0 ? 0.8 : 0.5 });
    d.text(`${fmt((max * t) / 4)}%`, px - 5, gy + 2.5, { size: 6.5, color: C.faint, align: 'right' });
  }
  const slot = pw / weeks.length, wbw = Math.max(1.5, slot * 0.72);
  const thr = (1 - COVERAGE_MIN) * 100;
  weeks.forEach((w, i) => {
    const v = loads[i];
    if (v <= 0) return;
    const bh = (ph * v) / max;
    d.rect(px + i * slot + (slot - wbw) / 2, py + ph - bh, wbw, bh, { fill: v >= thr ? C.brand : v >= avgLoad * 1.5 ? '#E2585C' : C.planned });
  });
  // Repères : moyenne et seuil de couverture.
  const ya = py + ph - (ph * avgLoad) / max;
  d.line(px, ya, px + pw, ya, { color: C.ink, width: 0.6, dash: [2, 2] });
  const yt = py + ph - (ph * thr) / max;
  d.line(px, yt, px + pw, yt, { color: C.brand, width: 0.6, dash: [4, 2] });
  legend(d, [['Above 1.5× average', '#E2585C'], [`Average ${fmt(avgLoad)}%`, C.ink, 'dash'], [`Coverage alert ${Math.round(thr)}%`, C.brand, 'dash']], M + CW - 14, y + 20);
  // Étiquettes de mois sous l'axe
  let lastM = '';
  weeks.forEach((w, i) => {
    const m = w.start.slice(0, 7) < A.from.slice(0, 7) ? A.from.slice(0, 7) : w.start.slice(0, 7);
    if (m !== lastM) {
      lastM = m;
      d.text(MONTHS[+m.slice(5) - 1], px + i * slot + 1, py + ph + 11, { size: 6.5, color: C.faint });
    }
  });
  if (A.busiest && A.busiest.total > 0) {
    const bi = weeks.indexOf(A.busiest);
    const bxx = px + bi * slot + slot / 2;
    const byy = py + ph - (ph * loads[bi]) / max;
    const label = `Peak ${fmtRange(A.busiest.start, A.busiest.end)} · ${fmt(loads[bi])}%`;
    const lw = d.widthOf(label, 7, true);
    const lx = Math.min(Math.max(bxx - lw / 2, px), px + pw - lw);
    d.text(label, lx, Math.max(byy - 5, py - 2), { size: 7, bold: true, color: C.ink });
  }
  L.y = y + h2 + 14;
}

function chip(d, x, y, label, tone) {
  const w = d.widthOf(label, 6.4, true) + 9;
  const bg = { alert: C.brandSoft, watch: C.amberSoft, info: '#E8EDF3' }[tone];
  const fg = { alert: C.brandInk, watch: C.amber, info: C.plannedDark }[tone];
  d.rect(x, y, w, 12, { fill: bg, radius: 6 });
  d.text(label, x + 4.5, y + 8.5, { size: 6.4, bold: true, color: fg });
  return w;
}

function drawAttention(L, A) {
  L.section('Attention list', 'Agents to watch',
    `Flagged when days lost exceed ${SEUIL_MOYENNE}× the team average${A.avg ? ` (${fmt(A.avg)} d, hence a ${fmt(A.seuil)} d threshold)` : ''}, `
    + `with ${SEUIL_SUBIS}+ unplanned episodes, a Bradford factor of ${BRADFORD_WATCH}+ (S² × D on unplanned absences: `
    + `${BRADFORD_WATCH} watch, ${BRADFORD_HIGH} act), or absences started without notice.`, Math.min(24 + Math.max(1, A.watch.length) * 22, 260));
  const cols = [
    { label: 'Agent', w: 112, get: r => r.fo_name, bold: () => true, color: () => C.ink },
    { label: 'Days lost', w: 48, align: 'right', get: r => fmt(r.total_days || 0) },
    { label: 'vs avg', w: 42, align: 'right', get: r => (r.ratio ? `${r.ratio.toFixed(1)}×` : '—'),
      color: r => (r.byVolume ? C.brand : C.text), bold: r => r.byVolume },
    { label: 'Unpl. ep.', w: 46, align: 'right', get: r => String(r.S), color: r => (r.byFrequency ? C.brand : C.text), bold: r => r.byFrequency },
    { label: 'Bradford', w: 48, align: 'right', get: r => String(r.bradford),
      color: r => (r.bradford >= BRADFORD_HIGH ? C.brand : r.byBradford ? C.amber : C.text), bold: r => r.byBradford },
    { label: 'No notice', w: 46, align: 'right', get: r => String(r.no_notice_episodes || 0), color: r => (r.byNotice ? C.brand : C.text), bold: r => r.byNotice },
    { label: 'Why flagged', w: CW - 342, draw: (d, x, y, w, h, r) => {
      let cx = x + 8;
      const chips = [];
      if (r.byVolume) chips.push([`Volume ${r.ratio.toFixed(1)}×`, 'alert']);
      if (r.bradford >= BRADFORD_HIGH) chips.push([`Bradford ${r.bradford}`, 'alert']);
      else if (r.byBradford) chips.push([`Bradford ${r.bradford}`, 'watch']);
      if (r.byFrequency) chips.push([`${r.S} unplanned`, 'watch']);
      if (r.byNotice) chips.push([`${r.no_notice_episodes} no-notice`, 'info']);
      for (const [label, tone] of chips) {
        if (cx + d.widthOf(label, 6.4, true) + 9 > x + w) break;
        cx += chip(d, cx, y + (h - 12) / 2, label, tone) + 4;
      }
    } },
  ];
  L.table(cols, A.watch, { rowH: 22, empty: A.agents.length ? 'No agent crosses the thresholds for this period.' : 'No agent configured.', title: 'Agents to watch' });
}

function balanceBar(d, x, y, w, h, r) {
  const ent = r.entitlement || 0;
  const taken = r.taken || 0, pending = r.pending || 0;
  const scale = Math.max(ent, taken + pending, 1);
  const bw = w - 16, bx = x + 8, by = y + h / 2 - 3.5, bh = 7;
  d.rect(bx, by, bw, bh, { fill: C.track, radius: 3.5 });
  const over = taken + pending > ent;
  const tw = (bw * Math.min(taken, scale)) / scale;
  const pw = (bw * pending) / scale;
  if (tw > 0) d.roundRect(bx, by, tw, bh, [3.5, pw > 0 ? 0 : 3.5, pw > 0 ? 0 : 3.5, 3.5], { fill: over && !pending ? C.brand : C.plannedDark });
  if (pw > 0) d.roundRect(bx + tw, by, pw, bh, [tw > 0 ? 0 : 3.5, 3.5, 3.5, tw > 0 ? 0 : 3.5], { fill: over ? '#E2585C' : C.pending });
  if (over && ent > 0) {
    const ex = bx + (bw * ent) / scale;
    d.line(ex, by - 2, ex, by + bh + 2, { color: C.ink, width: 0.8 });
  }
}

function drawBalances(L, A) {
  L.section('Leave balances', 'Entitlement consumption',
    `Paid leave and RTT only. Taken = approved, pending = requested. Bar scale: annual entitlement; a black tick marks the entitlement when it is exceeded.`,
    Math.min(24 + Math.max(1, A.agents.length) * 20, 330));
  const cols = [
    { label: 'Agent', w: 122, get: r => r.fo_name, bold: () => true, color: () => C.ink },
    { label: 'Entitl.', w: 40, align: 'right', get: r => fmt(r.entitlement) },
    { label: 'Taken', w: 40, align: 'right', get: r => fmt(r.taken) },
    { label: 'Pending', w: 44, align: 'right', get: r => fmt(r.pending) },
    { label: 'Remaining', w: 54, align: 'right', get: r => fmt(r.remaining), bold: () => true,
      color: r => (r.remaining < 0 ? C.brand : r.remaining <= 3 ? C.amber : C.ink) },
    { label: 'Taken · pending · left', w: CW - 122 - 40 - 40 - 44 - 54 - 44 - 50, draw: balanceBar },
    { label: 'Sick d.', w: 44, align: 'right', get: r => fmt(r.sick_days) },
    { label: 'Episodes', w: 50, align: 'right', get: r => String(r.episodes) },
  ];
  const rows = A.agents.map(a => (a.remaining < 0 ? { ...a, _bg: '#FDF3F3' } : a));
  L.table(cols, rows, { rowH: 20, empty: 'No agent configured.', title: 'Leave balances' });
  const neg = A.agents.filter(a => a.remaining < 0);
  if (neg.length) {
    L.ensure(16);
    L.doc.text(`${plural(neg.length, 'agent')} with a negative balance (highlighted): ${neg.map(a => a.fo_name).join(', ')}.`,
      M, L.y + 6, { size: 8, color: C.brand, maxWidth: CW });
    L.y += 18;
  }
}

function drawConflicts(L, A) {
  const list = A.s.conflicts || [];
  L.section('Planning conflicts', 'Absent while on the shift plan',
    list.length ? 'Shifts still assigned to an agent who is absent on that date. Each line needs a replacement or a plan update.' : '', 40);
  const cols = [
    { label: 'Date', w: 90, get: r => `${DOW[parseIso(r.date).getUTCDay()]} ${fmtDate(r.date)}` },
    { label: 'Agent', w: 150, get: r => r.fo_name, bold: () => true, color: () => C.ink },
    { label: 'Shift', w: 105, get: r => r.shift_name },
    { label: 'Absence type', w: 100, get: r => typeLabel(r.absence_type) },
    { label: 'Status', w: CW - 445, get: r => STATUS_EN[r.absence_status] || r.absence_status },
  ];
  L.table(cols, list, { rowH: 18, empty: 'No conflict between absences and the shift plan.', title: 'Planning conflicts' });
}

function drawDetail(L, A) {
  L.section('Appendix', 'Absence detail',
    `All absences overlapping the period (${A.detail.length}), including rejected and cancelled requests (greyed). Days = working days inside the period. Reasons are truncated.`, 60);
  const dim = r => r.status === 'Refusée' || r.status === 'Annulée';
  // Période sur une seule année : l'année est au bandeau, inutile de la
  // répéter sur chaque ligne (sauf pour une date qui en sort).
  const oneYear = A.from && A.to && A.from.slice(0, 4) === A.to.slice(0, 4);
  const dt = iso => fmtDate(iso, !oneYear || String(iso).slice(0, 4) !== A.from.slice(0, 4));
  const col = r => (dim(r) ? C.faint : C.text);
  const daysOf = a => {
    if (A.daysByAbs.has(a)) return fmt(A.daysByAbs.get(a));
    if (dim(a)) {
      if (a.half_day && a.date_from === a.date_to) return '0.5';
      let n = 0;
      eachDay(a.date_from < A.from ? A.from : a.date_from, a.date_to > A.to ? A.to : a.date_to, (_, w) => { if (w && w !== 6) n++; });
      return String(n);
    }
    return '0';
  };
  const cols = [
    { label: 'Agent', w: 104, get: r => r.fo_name, color: r => (dim(r) ? C.faint : C.ink), bold: r => !dim(r) },
    { label: 'Type', w: 82, get: r => typeLabel(r.type) + (r.half_day ? ' (½)' : ''), color: col },
    { label: 'From', w: 44, get: r => dt(r.date_from), color: col },
    { label: 'To', w: 44, get: r => dt(r.date_to), color: col },
    { label: 'Days', w: 28, align: 'right', get: daysOf, color: col },
    { label: 'Status', w: 54, get: r => STATUS_EN[r.status] || r.status || '', color: r => (r.status === 'Demandée' ? C.amber : col(r)) },
    { label: 'Notice', w: 58, get: r => { const n = noticeOf(r); return n ? (NOTICE_EN[n] || n) : 'To qualify'; },
      color: r => { const n = noticeOf(r); return dim(r) ? C.faint : !n ? C.faint : noticeIsOk(n) ? C.text : C.brand; } },
    { label: 'Reason', w: CW - 414, get: r => String(r.reason || '').replace(/\s+/g, ' ').slice(0, 40), color: () => C.mute },
  ];
  L.table(cols, A.detail, { rowH: 16, size: 7.8, empty: 'No absence recorded in this period.', title: 'Absence detail' });
}

/**
 * Construit le PDF.
 * @param {object} p
 * @param {object} p.summary     objet de computeAbsenceSummary / /api/absences/summary
 * @param {Array}  p.absences    liste brute des absences (toutes ; filtrée ici sur la période)
 * @param {Date|string} [p.generatedAt]  date d'édition (défaut : maintenant)
 * @param {string} [p.periodLabel]       libellé de période (défaut : déduit de from/to)
 * @returns {Buffer}
 */
function buildAbsencePdf({ summary, absences, generatedAt, periodLabel } = {}) {
  const s = summary || {};
  const gen = toDate(generatedAt);
  const pad = v => String(v).padStart(2, '0');
  const meta = {
    periodLabel: periodLabel || defaultPeriodLabel(s.from, s.to),
    generatedLabel: `${fmtDate(isoOf(new Date(Date.UTC(gen.getFullYear(), gen.getMonth(), gen.getDate()))))}, ${pad(gen.getHours())}:${pad(gen.getMinutes())}`,
  };
  const A = analyse(s, absences, gen);
  const doc = new PdfDoc({ title: `EMOC Absence report ${s.from || ''} – ${s.to || ''}`, author: 'EMOC · Front Office' });
  const L = new Layout(doc, meta);

  drawCover(L, A, meta);
  L.section('Executive summary', 'Where the period stands', null, 150);
  drawKpis(L, A);
  drawInsights(L, buildInsights(A));
  // Sans aucun jour d'absence, les graphiques seraient des cadres vides :
  // la synthèse dit déjà l'essentiel, on passe directement aux agents.
  if (A.days.length) {
    drawMonthly(L, A);
    L.section('Patterns', 'When and why absences happen', null, 220);
    drawDowAndTypes(L, A);
    drawNoticeAndWeekly(L, A);
  }

  L.y += 6;
  drawAttention(L, A);
  L.y += 18;
  drawBalances(L, A);
  L.y += 18;
  drawConflicts(L, A);

  // L'annexe démarre sur une page neuve, sauf s'il n'y a rien à lister.
  if (A.detail.length) L.newPage(); else L.y += 18;
  drawDetail(L, A);

  // Pieds de page, une fois le nombre total connu.
  const N = doc.pages.length;
  for (let i = 0; i < N; i++) {
    doc.usePage(i);
    doc.line(M, PH - 36, PW - M, PH - 36, { color: C.line, width: 0.6 });
    doc.text(`EMOC · Front Office · Absence report — page ${i + 1} / ${N}`, M, PH - 22, { size: 7.5, color: C.mute });
    doc.text('Confidential — contains personal HR data', PW - M, PH - 22, { size: 7.5, color: C.faint, align: 'right' });
  }
  return doc.toBuffer();
}

module.exports = { buildAbsencePdf, _analyse: analyse, _insights: buildInsights };
