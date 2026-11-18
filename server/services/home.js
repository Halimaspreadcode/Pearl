// ══════════════════════════════════════════════════════════════
// TABLEAU DE BORD COMPOSABLE
//
// L'accueil n'est plus le tableau des tickets : c'est une grille de blocs
// que l'organisation compose avec Pear, puis que chacun peut ajuster.
//   · catalogue  : blocs proposés selon les modules actifs (business,
//                  équipe, performance, tickets, formation…) ;
//   · disposition: celle de l'organisation (fixée par un administrateur),
//                  sinon le modèle du métier ; chaque personne peut en
//                  garder une à elle, et revenir à celle de l'organisation ;
//   · indicateurs business : ceux qui comptent pour le client (chiffre
//                  d'affaires, commandes, satisfaction…), avec une cible ;
//                  les valeurs sont saisies dans Pear ou importées.
// Les chiffres sont calculés ici, à partir des données de l'organisation.
//
// Fichier : home.json → { org_layout, users: { clé: layout }, metrics: [] }
// ══════════════════════════════════════════════════════════════
const crypto = require('crypto');
const { FILES } = require('../config/paths');
const store = require('../core/store');

const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const str = (v, n = 120) => String(v == null ? '' : v).trim().slice(0, n);
const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const isoDay = d => d.toISOString().slice(0, 10);

// ── Catalogue des blocs ──
// module : le bloc n'est proposé que si le module est actif.
// size   : tailles permises (s = 1 colonne, m = 2, l = toute la ligne).
const WIDGETS = [
  { type: 'metric',        group: 'business',    module: 'core',       sizes: ['s', 'm'], needs: 'metric', label: 'Indicateur', desc: 'Une valeur clé, sa cible et sa tendance.' },
  { type: 'metric-trend',  group: 'business',    module: 'core',       sizes: ['m', 'l'], needs: 'metric', label: 'Évolution d’un indicateur', desc: 'Les dernières périodes, comparées à la cible.' },
  { type: 'metrics-table', group: 'business',    module: 'core',       sizes: ['m', 'l'], label: 'Tous les indicateurs', desc: 'Chaque indicateur business face à sa cible.' },
  { type: 'team-today',    group: 'team',        module: 'core',       sizes: ['s', 'm'], label: 'Équipe aujourd’hui', desc: 'Effectif, présents, absents, en formation.' },
  { type: 'absences',      group: 'team',        module: 'absences',   sizes: ['s', 'm'], label: 'Absences', desc: 'Taux d’absence de la période et absences imprévues.' },
  { type: 'upcoming-absences', group: 'team',    module: 'absences',   sizes: ['m', 'l'], label: 'Absences à venir', desc: 'Qui sera absent dans les 14 prochains jours.' },
  { type: 'tasks',         group: 'performance', module: 'planning',   sizes: ['s', 'm'], label: 'Tâches de l’équipe', desc: 'Tâches réalisées, en cours et en retard.' },
  { type: 'team-performance', group: 'performance', module: 'planning', sizes: ['m', 'l'], label: 'Performance par personne', desc: 'Tâches réalisées par personne sur la période.' },
  { type: 'training',      group: 'performance', module: 'academy',    sizes: ['s', 'm'], label: 'Formation', desc: 'Quiz passés, score moyen, taux de réussite.' },
  { type: 'tickets',       group: 'operations',  module: 'tickets',    sizes: ['s', 'm', 'l'], label: 'Demandes et tickets', desc: 'Ouverts, hors délai, résolus, respect des délais.' },
  { type: 'tickets-detail', group: 'operations', module: 'tickets',    sizes: ['l'], label: 'Détail des tickets', desc: 'Le tableau complet : volumes, derniers tickets, activité.' },
  { type: 'note',          group: 'other',       module: 'core',       sizes: ['s', 'm', 'l'], label: 'Note', desc: 'Un message de la direction : cap du trimestre, priorités…' },
  { type: 'shortcuts',     group: 'other',       module: 'core',       sizes: ['m', 'l'], label: 'Raccourcis', desc: 'Les pages que l’équipe ouvre le plus.' },
];
const GROUPS = { business: 'Business', team: 'Équipe', performance: 'Performance', operations: 'Opérations', other: 'Autres' };
const byType = Object.fromEntries(WIDGETS.map(w => [w.type, w]));

// ── Indicateurs business ──
const FORMATS = ['number', 'currency', 'percent'];
const AGG = ['sum', 'avg', 'last'];            // cumul sur la période, moyenne, dernière valeur
const FREQ = ['day', 'week', 'month'];

function cleanMetric(m, prev = {}) {
  const label = str(m.label ?? prev.label, 60);
  if (label.length < 2) throw err("Nom d'indicateur trop court.");
  return {
    id: prev.id || crypto.randomBytes(5).toString('hex'),
    label,
    unit: str(m.unit ?? prev.unit, 12),
    format: FORMATS.includes(m.format) ? m.format : (prev.format || 'number'),
    agg: AGG.includes(m.agg) ? m.agg : (prev.agg || 'sum'),
    freq: FREQ.includes(m.freq) ? m.freq : (prev.freq || 'month'),
    target: m.target !== undefined ? num(m.target) : (prev.target ?? null),
    better: m.better === 'down' ? 'down' : (m.better === 'up' ? 'up' : (prev.better || 'up')),
    entries: Array.isArray(prev.entries) ? prev.entries : [],
    created_at: prev.created_at || new Date().toISOString(),
  };
}

function readHome() {
  const h = store.readJSON(FILES.home, null);
  return h && typeof h === 'object' ? { org_layout: null, users: {}, metrics: [], ...h } : null;
}
function writeHome(h) { store.writeJSON(FILES.home, h); }

// Première ouverture : modèle du métier (pack) ou modèle générique.
function seed(packHome) {
  const metrics = (packHome && Array.isArray(packHome.metrics) ? packHome.metrics : DEFAULT_METRICS).map(m => cleanMetric(m));
  return { org_layout: null, users: {}, metrics, seeded_at: new Date().toISOString() };
}
const DEFAULT_METRICS = [
  { label: "Chiffre d'affaires", format: 'currency', unit: '€', agg: 'sum', freq: 'month', better: 'up' },
  { label: 'Nouveaux clients', format: 'number', agg: 'sum', freq: 'month', better: 'up' },
  { label: 'Satisfaction client', format: 'percent', unit: '%', agg: 'avg', freq: 'month', better: 'up', target: 90 },
];

function ensureHome(packHome) {
  let h = readHome();
  if (!h) { h = seed(packHome); writeHome(h); }
  return h;
}

// Disposition par défaut : les blocs utiles selon les modules actifs.
function defaultLayout(mods, metrics, packLayout) {
  const on = t => mods.includes(byType[t].module);
  let items = Array.isArray(packLayout) && packLayout.length ? packLayout : null;
  if (!items) {
    items = [];
    metrics.slice(0, 3).forEach(m => items.push({ w: 'metric', size: 's', metric: m.id }));
    items.push({ w: 'team-today', size: 's' });
    if (mods.includes('tickets')) items.push({ w: 'tickets', size: 'm' });
    if (mods.includes('planning')) items.push({ w: 'tasks', size: 's' });
    if (mods.includes('absences')) items.push({ w: 'absences', size: 's' });
    if (metrics[0]) items.push({ w: 'metric-trend', size: 'm', metric: metrics[0].id });
    if (mods.includes('planning')) items.push({ w: 'team-performance', size: 'm' });
    if (mods.includes('academy')) items.push({ w: 'training', size: 's' });
    if (mods.includes('absences')) items.push({ w: 'upcoming-absences', size: 'm' });
  } else {
    // Modèle du pack : « metric:0 » désigne le premier indicateur.
    items = items.map(it => {
      const m = /^metric:(\d+)$/.exec(String(it.metric || ''));
      return m ? { ...it, metric: (metrics[Number(m[1])] || {}).id } : it;
    });
  }
  return cleanLayout(items.filter(it => byType[it.w] && on(it.w)), metrics, mods);
}

function cleanLayout(list, metrics, mods) {
  const ids = new Set(metrics.map(m => m.id));
  const out = [];
  for (const it of Array.isArray(list) ? list.slice(0, 40) : []) {
    const def = byType[it && it.w];
    if (!def) continue;
    if (mods && !mods.includes(def.module)) continue;
    const item = { id: str(it.id, 20) || crypto.randomBytes(4).toString('hex'), w: def.type, size: def.sizes.includes(it.size) ? it.size : def.sizes[0] };
    if (def.needs === 'metric') { if (!ids.has(it.metric)) continue; item.metric = it.metric; }
    if (def.type === 'note') { item.title = str(it.title, 80); item.text = str(it.text, 1200); }
    if (def.type === 'shortcuts') item.pages = (Array.isArray(it.pages) ? it.pages : []).map(p => str(p, 40)).filter(Boolean).slice(0, 8);
    out.push(item);
  }
  return out;
}

// ── Périodes ──
function periodBounds(period, now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let from, prevFrom, prevTo;
  if (period === 'week') {
    const dow = (d.getUTCDay() + 6) % 7;
    from = new Date(d); from.setUTCDate(d.getUTCDate() - dow);
    prevFrom = new Date(from); prevFrom.setUTCDate(from.getUTCDate() - 7);
  } else if (period === 'quarter') {
    from = new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1));
    prevFrom = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - 3, 1));
  } else if (period === 'year') {
    from = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    prevFrom = new Date(Date.UTC(d.getUTCFullYear() - 1, 0, 1));
  } else {
    from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    prevFrom = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  }
  prevTo = new Date(from); prevTo.setUTCDate(from.getUTCDate() - 1);
  // Période précédente comparée à date égale : 12 jours de mars contre les 12 premiers de février.
  const elapsed = Math.round((d - from) / 86400000);
  const prevSame = new Date(prevFrom); prevSame.setUTCDate(prevFrom.getUTCDate() + elapsed);
  return { from: isoDay(from), to: isoDay(d), prev_from: isoDay(prevFrom), prev_to: isoDay(prevSame < prevTo ? prevSame : prevTo) };
}

function aggregate(entries, agg, from, to) {
  const vals = entries.filter(e => e.date >= from && e.date <= to).sort((a, b) => a.date.localeCompare(b.date)).map(e => e.value);
  if (!vals.length) return null;
  if (agg === 'avg') return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length * 100) / 100;
  if (agg === 'last') return vals[vals.length - 1];
  return Math.round(vals.reduce((s, v) => s + v, 0) * 100) / 100;
}

// Les 12 dernières périodes de la fréquence de l'indicateur.
function series(m, now = new Date()) {
  const out = [];
  for (let i = 11; i >= 0; i--) {
    let from, to, label;
    if (m.freq === 'day') {
      const d = new Date(now); d.setUTCDate(d.getUTCDate() - i);
      from = to = isoDay(d); label = from.slice(5);
    } else if (m.freq === 'week') {
      const d = new Date(now); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - i * 7);
      const e = new Date(d); e.setUTCDate(d.getUTCDate() + 6);
      from = isoDay(d); to = isoDay(e); label = from.slice(5);
    } else {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const e = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
      from = isoDay(d); to = isoDay(e); label = from.slice(0, 7);
    }
    out.push({ label, from, to, value: aggregate(m.entries, m.agg, from, to) });
  }
  return out;
}

function metricView(m, b) {
  const value = aggregate(m.entries, m.agg, b.from, b.to);
  const prev = aggregate(m.entries, m.agg, b.prev_from, b.prev_to);
  const last = [...m.entries].sort((a, c) => c.date.localeCompare(a.date))[0] || null;
  return {
    id: m.id, label: m.label, unit: m.unit, format: m.format, agg: m.agg, freq: m.freq, target: m.target, better: m.better,
    value, prev, delta: value != null && prev ? Math.round((value - prev) / Math.abs(prev) * 1000) / 10 : null,
    progress: value != null && m.target ? Math.round(value / m.target * 1000) / 10 : null,
    series: series(m), last_entry: last, entries_count: m.entries.length,
  };
}

// ── Données de l'équipe et des modules ──
function teamData(mods, b, today) {
  const cfg = store.readCfg();
  const people = [...new Set([...(cfg.fo_list || [])])];
  const out = { headcount: people.length };
  if (mods.includes('absences')) {
    let abs = [];
    try { abs = require('./absences').readAbsences(); } catch { abs = []; }
    const counted = abs.filter(a => a.status === 'Validée' || a.status === 'Demandée');
    const onDay = d => counted.filter(a => a.date_from <= d && a.date_to >= d);
    const todayList = onDay(today);
    out.absent_today = new Set(todayList.filter(a => a.type !== 'Formation').map(a => a.fo_name)).size;
    out.training_today = new Set(todayList.filter(a => a.type === 'Formation').map(a => a.fo_name)).size;
    // Jours ouvrés d'absence dans la période, rapportés à la capacité.
    let work = 0, absent = 0, unplanned = 0;
    const PLANNED = /cong|rtt|formation|planifi|site/i;
    for (let d = new Date(b.from + 'T00:00:00Z'); isoDay(d) <= b.to; d.setUTCDate(d.getUTCDate() + 1)) {
      const dow = d.getUTCDay(); if (dow === 0 || dow === 6) continue;
      work++;
      const list = onDay(isoDay(d)).filter(a => a.type !== 'Formation');
      absent += new Set(list.map(a => a.fo_name)).size;
      unplanned += new Set(list.filter(a => !PLANNED.test(a.type || '')).map(a => a.fo_name)).size;
    }
    const cap = work * (people.length || 1);
    out.absence_rate = cap ? Math.round(absent / cap * 1000) / 10 : 0;
    out.unplanned_days = unplanned;
    out.absent_days = absent;
    const in14 = new Date(today + 'T00:00:00Z'); in14.setUTCDate(in14.getUTCDate() + 14);
    out.upcoming = counted.filter(a => a.date_to >= today && a.date_from <= isoDay(in14))
      .sort((x, y) => x.date_from.localeCompare(y.date_from)).slice(0, 12)
      .map(a => ({ name: a.fo_name, type: a.type, from: a.date_from, to: a.date_to, status: a.status }));
  }
  out.present_today = out.absent_today != null ? Math.max(0, people.length - out.absent_today - (out.training_today || 0)) : null;
  return out;
}

function tasksData(b, today) {
  const tasks = store.readFOTasks().filter(t => t.status !== 'Recurring');
  const inP = tasks.filter(t => (t.due_date || String(t.created_at || '').slice(0, 10)) >= b.from && (t.due_date || String(t.created_at || '').slice(0, 10)) <= b.to);
  const done = inP.filter(t => t.status === 'Done').length;
  const overdue = tasks.filter(t => t.status !== 'Done' && t.due_date && t.due_date < today).length;
  const per = {};
  for (const t of inP) {
    const who = String(t.assigned_to || '').trim() || '—';
    for (const name of who.split(/\s*,\s*/)) {
      per[name] = per[name] || { name, total: 0, done: 0 };
      per[name].total++; if (t.status === 'Done') per[name].done++;
    }
  }
  const people = Object.values(per).map(p => ({ ...p, rate: p.total ? Math.round(p.done / p.total * 100) : 0 }))
    .sort((x, y) => y.rate - x.rate || y.done - x.done).slice(0, 12);
  return { total: inP.length, done, open: inP.length - done, overdue, rate: inP.length ? Math.round(done / inP.length * 100) : null, people };
}

function trainingData(b) {
  const res = store.readQuizResults().filter(r => String(r.created_at || '').slice(0, 10) >= b.from && String(r.created_at || '').slice(0, 10) <= b.to);
  const pct = r => (r.total ? r.score / r.total * 100 : 0);
  return {
    attempts: res.length,
    people: new Set(res.map(r => r.user)).size,
    avg: res.length ? Math.round(res.reduce((s, r) => s + pct(r), 0) / res.length) : null,
    pass_rate: res.length ? Math.round(res.filter(r => pct(r) >= 70).length / res.length * 100) : null,
  };
}

function ticketsData(b) {
  const { allEnriched, isOpen } = require('../core/enrich');
  const all = allEnriched(store.readCfg(), 'ALL');
  const d10 = t => String(t.open_date || t.occur_time || '').slice(0, 10);
  const opened = all.filter(t => d10(t) >= b.from && d10(t) <= b.to);
  const rated = opened.filter(t => !['N/A', 'On Hold'].includes(t.sla_status));
  const onTime = rated.filter(t => ['In SLA', 'Near Breach'].includes(t.sla_status)).length;
  const prevOpened = all.filter(t => d10(t) >= b.prev_from && d10(t) <= b.prev_to).length;
  return {
    open: all.filter(isOpen).length,
    overdue: all.filter(t => isOpen(t) && t.sla_status === 'Breach').length,
    opened: opened.length, prev_opened: prevOpened,
    resolved: opened.filter(t => ['Resolved', 'Closed'].includes(t.status)).length,
    on_time_rate: rated.length ? Math.round(onTime / rated.length * 100) : null,
  };
}

function build({ mods, period, userKey, isAdmin, packHome }) {
  const h = ensureHome(packHome);
  const b = periodBounds(period);
  const today = b.to;
  const mine = userKey && h.users[userKey];
  const source = mine ? 'user' : (h.org_layout ? 'org' : 'default');
  const layout = cleanLayout(mine || h.org_layout || defaultLayout(mods, h.metrics, packHome && packHome.layout), h.metrics, mods);
  const need = new Set(layout.map(x => x.w));
  const data = {};
  if (need.has('team-today') || need.has('absences') || need.has('upcoming-absences')) data.team = teamData(mods, b, today);
  if ((need.has('tasks') || need.has('team-performance')) && mods.includes('planning')) data.tasks = tasksData(b, today);
  if (need.has('training') && mods.includes('academy')) data.training = trainingData(b);
  if (need.has('tickets') && mods.includes('tickets')) { try { data.tickets = ticketsData(b); } catch (e) { data.tickets = null; } }
  return {
    period, bounds: b, source, can_edit_org: !!isAdmin, layout,
    metrics: h.metrics.map(m => metricView(m, b)),
    catalog: WIDGETS.filter(w => mods.includes(w.module)).map(({ type, group, sizes, label, desc, needs }) => ({ type, group, sizes, label, desc, needs: needs || null })),
    groups: GROUPS, data,
  };
}

function saveLayout(scope, userKey, layout, mods) {
  const h = ensureHome();
  const clean = cleanLayout(layout, h.metrics, mods);
  if (scope === 'org') h.org_layout = clean;
  else { if (!userKey) throw err('Connexion nominative requise pour garder votre disposition.', 403); h.users[userKey] = clean; }
  writeHome(h);
  return clean;
}
function resetLayout(scope, userKey) {
  const h = ensureHome();
  if (scope === 'org') h.org_layout = null; else if (userKey) delete h.users[userKey];
  writeHome(h);
}

function upsertMetric(id, body) {
  const h = ensureHome();
  const i = id ? h.metrics.findIndex(m => m.id === id) : -1;
  if (id && i < 0) throw err('Indicateur introuvable.', 404);
  if (!id && h.metrics.length >= 40) throw err('40 indicateurs au plus.');
  const m = cleanMetric(body || {}, i >= 0 ? h.metrics[i] : {});
  if (i >= 0) h.metrics[i] = m; else h.metrics.push(m);
  writeHome(h);
  return m;
}
function deleteMetric(id) {
  const h = ensureHome();
  h.metrics = h.metrics.filter(m => m.id !== id);
  writeHome(h);
}

// Saisie de valeurs : une ou plusieurs { date, value }. Même date = remplacée.
function addEntries(id, list, by) {
  const h = ensureHome();
  const m = h.metrics.find(x => x.id === id);
  if (!m) throw err('Indicateur introuvable.', 404);
  const items = (Array.isArray(list) ? list : [list]).slice(0, 1000);
  let n = 0;
  for (const it of items) {
    const date = str(it && it.date, 10), value = num(it && it.value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || value == null) continue;
    m.entries = m.entries.filter(e => e.date !== date);
    m.entries.push({ date, value, by: str(by, 80) || null, at: new Date().toISOString() });
    n++;
  }
  if (!n) throw err('Aucune valeur valable (date AAAA-MM-JJ et nombre).');
  m.entries.sort((a, b) => a.date.localeCompare(b.date));
  if (m.entries.length > 5000) m.entries = m.entries.slice(-5000);
  writeHome(h);
  return { added: n };
}
function deleteEntry(id, date) {
  const h = ensureHome();
  const m = h.metrics.find(x => x.id === id);
  if (!m) throw err('Indicateur introuvable.', 404);
  m.entries = m.entries.filter(e => e.date !== date);
  writeHome(h);
}

module.exports = { WIDGETS, build, saveLayout, resetLayout, upsertMetric, deleteMetric, addEntries, deleteEntry, periodBounds, ensureHome, readHome };
