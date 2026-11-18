/**
 * Weekly Performance — tous les sites (jusqu'à 4 côte à côte).
 *
 * Deck de revue hebdomadaire présenté aux deux équipes. Il reprend le
 * système visuel du Weekly Report (weekly-pptx.js › design) et ses
 * chiffres (buildWeeklyReport, par site), mais l'organise autrement :
 *
 *   · une page par site pour l'activité, et des pages communes pour ce
 *     qui se compare (indicateurs, tendance, incidents) ;
 *   · une zone « Explanation » sur chaque page de données : la revue
 *     commente, elle ne se contente pas de lire des chiffres ;
 *   · ce qui sort de l'ordinaire — pic d'activité, absences,
 *     incident de plateforme — DOIT être expliqué. Une explication
 *     manquante s'affiche en rouge sur la slide plutôt que de disparaître.
 *
 * L'analyse (pics, absences, incidents) vient de services/weekly-combined
 * ; les textes saisis arrivent du client dans `form.explanations`, indexés
 * par la clé de chaque point.
 */

const PptxGenJS = require('pptxgenjs');
const { design } = require('./weekly-pptx');

const {
  C, FONT, M, CW, FLOOR,
  clip, fitPt, slideHeader, slideFooter, statement, panel, legend,
  hBars, groupedCols, stackedCols, fmtDur, fmtDate, MTTD_TARGET_MS,
} = design;

// Couleur d'un site : dans l'ordre de la configuration.
const PALETTE = [C.brand, C.blue, C.green || '2E7D32', C.red || 'C62828'];
let SITE_ORDER = [];
const SITE_C = new Proxy({}, { get: (_, code) => PALETTE[Math.max(0, SITE_ORDER.indexOf(code)) % PALETTE.length] });
// Largeur d'une colonne quand n sites se partagent la largeur utile.
const colWidth = (n, total = CW, gap = 0.3) => (total - gap * (Math.max(1, n) - 1)) / Math.max(1, n);

// Un « \n » en fin de segment ne coupe pas la ligne dans tous les
// lecteurs (l'aperçu de l'app, Google Slides) : PptxGenJS attend
// `breakLine`. On le pose ici pour tous les segments qui finissent ainsi.
const brk = runs => runs.map(r => (typeof r.text === 'string' && r.text.endsWith('\n'))
  ? { text: r.text.slice(0, -1), options: { ...(r.options || {}), breakLine: true } }
  : r);

// Lignes pointillées à remplir, autant que la hauteur en laisse.
const blankLines = h => Array.from({ length: Math.max(2, Math.floor(h / 0.34)) },
  () => '……………………………………………………………………………………………').join('\n');
// Libellé des sites du deck (« Lyon × Paris »), posé à chaque génération.
let VILLES = '';

/* ── Explications ─────────────────────────────────────────────
   Texte saisi > proposition tirée des Observations. Une clé présente mais
   vide dans le formulaire est un choix de l'utilisateur (il a effacé la
   proposition) : on ne la remet pas en douce. */
function explanationOf(form, item) {
  const ex = (form && form.explanations) || {};
  if (Object.prototype.hasOwnProperty.call(ex, item.key)) return String(ex[item.key] || '').trim();
  return String(item.suggestion || '').trim();
}

// Point marqué « not needed » dans la fenêtre de saisie : il n'appelle
// plus d'explication et ne s'affiche pas en rouge.
function isSkipped(form, key) {
  return Array.isArray(form && form.skipped) && form.skipped.includes(key);
}

// Points requis encore sans explication et non passés. La route refuse
// l'export tant qu'il en reste ; la couverture les compte par sécurité.
function missingExplanations(analysis, form) {
  return (analysis.to_explain || [])
    .filter(it => it.required && !isSkipped(form, it.key) && !explanationOf(form, it));
}

// Zone d'explication. `items` : [{ label, text, required, skipped }].
// Un point requis sans texte s'affiche en rouge : la slide dit elle-même
// ce qu'il reste à expliquer, au lieu de laisser croire que tout va bien.
// Un point facultatif vide laisse des lignes à remplir.
function explainBox(slide, { x, y, w, h, title, items }) {
  const missing = items.some(it => it.required && !it.text);
  slide.addShape('rect', {
    x, y, w, h, fill: { color: missing ? C.redSoft : C.bgSoft },
    line: missing ? { color: C.red, width: 1, dashType: 'dash' } : { type: 'none' },
  });
  slide.addText(title || 'Explanation', {
    x: x + 0.24, y: y + 0.16, w: w - 0.48, h: 0.26,
    fontSize: 11, bold: true, color: missing ? C.red : C.ink, fontFace: FONT,
  });

  const top = y + 0.5;
  const avail = h - 0.62;
  if (!items.length) return;
  // Chaque point reçoit une part de la hauteur à proportion de son texte,
  // avec un minimum pour l'intitulé et une ligne.
  const weight = it => 1 + Math.min(4, (it.text || '').length / 120);
  const totalW = items.reduce((n, it) => n + weight(it), 0);
  let cy = top;
  items.forEach(it => {
    const ih = avail * weight(it) / totalW;
    const runs = [];
    if (it.skipped) {
      // Passé volontairement : l'intitulé reste, sans espace à remplir.
      runs.push({ text: it.label || '', options: { bold: true, fontSize: 9.5, color: C.mute } });
    } else if (it.label) {
      runs.push({ text: `${it.label}\n`, options: {
        bold: true, fontSize: 9.5, color: it.required && !it.text ? C.red : C.ink } });
    }
    if (it.skipped) {
      // rien de plus
    } else if (it.text) {
      runs.push({ text: it.text, options: { fontSize: 10, color: C.ink } });
    } else if (it.required) {
      runs.push({ text: '⚠ Explanation required: to be completed before the review.',
        options: { fontSize: 9.5, italic: true, bold: true, color: C.red } });
    } else {
      // Lignes pointillées : un espace visible où écrire, en séance ou
      // dans PowerPoint avant diffusion.
      runs.push({ text: blankLines(ih - (it.label ? 0.3 : 0)),
        options: { fontSize: 9.5, color: C.faint } });
    }
    const len = (it.label || '').length + (it.text || '').length;
    const budget = Math.max(60, Math.floor((w - 0.48) * 14 * Math.max(1, ih / 0.22)));
    slide.addText(brk(runs), {
      x: x + 0.24, y: cy, w: w - 0.48, h: ih,
      fontFace: FONT, valign: 'top', lineSpacingMultiple: 1.12,
      fontSize: fitPt('x'.repeat(len), budget, 10),
    });
    cy += ih;
  });
}

/* ── Indicateurs comparés ───────────────────────────────────── */
const pct = v => (v == null || isNaN(v) ? 'n/a' : `${Math.round(v * 10) / 10}%`);
// `better` : sens de l'amélioration ; null = volume, ni bon ni mauvais.
const METRICS = [
  { id: 'opened',  label: 'Tickets opened',       get: k => k.opened_this_week,   fmt: v => String(v ?? 0), better: null },
  { id: 'closed',  label: 'Tickets resolved',     get: k => k.resolved_this_week, fmt: v => String(v ?? 0), better: null },
  { id: 'backlog', label: 'Backlog (open)',       get: k => k.overall_open,       fmt: v => String(v ?? 0), better: 'down' },
  { id: 'sla',     label: 'SLA compliance',       get: k => k.sla_compliance,     fmt: pct,                 better: 'up' },
  { id: 'breach',  label: 'SLA breaches',         get: k => k.breach,             fmt: v => String(v ?? 0), better: 'down' },
  { id: 'mttd',    label: 'MTTD (target ≤ 5 min)',get: k => k.mttd_ms,            fmt: fmtDur,              better: 'down' },
  { id: 'mttr',    label: 'MTTR',                 get: k => k.mttr_ms,            fmt: fmtDur,              better: 'down' },
];

function delta(m, now, prev) {
  if (now == null || prev == null || isNaN(now) || isNaN(prev)) return { text: '', color: C.faint };
  const d = now - prev;
  if (Math.abs(d) < 1e-9) return { text: '= vs W-1', color: C.faint };
  const arrow = d > 0 ? '▲' : '▼';
  let txt;
  if (m.id === 'mttd' || m.id === 'mttr') txt = `${arrow} ${fmtDur(Math.abs(d))}`;
  else if (m.id === 'sla') txt = `${arrow} ${Math.round(Math.abs(d) * 10) / 10} pt`;
  else txt = `${arrow} ${Math.abs(d)}`;
  const good = m.better === null ? null : (m.better === 'up' ? d > 0 : d < 0);
  return { text: `${txt} vs W-1`, color: good === null ? C.mute : good ? C.green : C.red };
}

function compareTable(slide, { x, y, w, sites }) {
  const labelW = w * 0.38;
  const colW = (w - labelW) / sites.length;
  const rowH = 0.58;
  // En-têtes de colonnes : le nom du site sur sa couleur.
  sites.forEach((s, i) => {
    const cx = x + labelW + i * colW;
    slide.addShape('rect', { x: cx + 0.06, y, w: colW - 0.12, h: 0.42,
      fill: { color: SITE_C[s.code] }, line: { type: 'none' } });
    slide.addText(s.ville, { x: cx + 0.06, y, w: colW - 0.12, h: 0.42,
      fontSize: 12, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', fontFace: FONT });
  });
  METRICS.forEach((m, r) => {
    const ry = y + 0.56 + r * rowH;
    if (r % 2 === 0) {
      slide.addShape('rect', { x, y: ry, w, h: rowH, fill: { color: C.bgSoft }, line: { type: 'none' } });
    }
    slide.addText(m.label, { x: x + 0.14, y: ry, w: labelW - 0.2, h: rowH,
      fontSize: 11, color: C.ink, valign: 'middle', fontFace: FONT });
    sites.forEach((s, i) => {
      const cx = x + labelW + i * colW;
      const now = m.get(s.kpis || {});
      const prev = m.get(s.prev || {});
      let color = C.ink;
      if (m.id === 'mttd' && now != null && !isNaN(now)) color = now <= MTTD_TARGET_MS ? C.green : C.red;
      if (m.id === 'breach' && now > 0) color = C.red;
      const dl = delta(m, now, prev);
      slide.addText(brk([
        { text: m.fmt(now), options: { bold: true, fontSize: 15, color } },
        ...(dl.text ? [{ text: `   ${dl.text}`, options: { fontSize: 8.5, color: dl.color } }] : []),
      ]), { x: cx + 0.1, y: ry, w: colW - 0.2, h: rowH, align: 'center', valign: 'middle', fontFace: FONT });
    });
  });
  return y + 0.56 + METRICS.length * rowH;
}

/* ── Pages ──────────────────────────────────────────────────── */

// Activité d'un site : colonnes ouverts / résolus par jour, jours de pic
// signalés au-dessus de leur colonne, et la zone d'explication à droite.
function activitySlide(pptx, s, form, period) {
  const sl = pptx.addSlide();
  slideHeader(sl, `${s.ville}: weekly activity`, period, `SITE · ${s.ville.toUpperCase()}`);

  const k = s.kpis || {};
  // Bandeau de chiffres clés, en ligne au-dessus du graphique.
  const strip = [
    ['Opened', String(k.opened_this_week ?? 0)],
    ['Resolved', String(k.resolved_this_week ?? 0)],
    ['SLA', pct(k.sla_compliance)],
    ['Breaches', String(k.breach ?? 0)],
    [`Usual / day · peak ≥ ${s.peak_threshold}`, String(s.avg_day)],
  ];
  const stripW = 7.3 / strip.length;
  strip.forEach(([l, v], i) => {
    sl.addText(brk([
      { text: `${v}\n`, options: { bold: true, fontSize: 20, color: i === 3 && Number(v) > 0 ? C.red : C.ink } },
      { text: l, options: { fontSize: 9, color: C.mute } },
    ]), { x: M + i * stripW, y: 1.6, w: stripW, h: 0.72, fontFace: FONT, valign: 'top' });
  });

  // Le graphique démarre sous le titre et la légende du panneau : les
  // repères de pic se posent dans la marge laissée au-dessus des colonnes.
  const chart = { x: M + 0.45, y: 3.55, w: 6.6, h: 2.8 };
  panel(sl, { x: M, y: 2.45, w: 7.3, h: 4.05, title: 'Tickets per day' });
  groupedCols(sl, {
    ...chart, labels: s.labels,
    series: [
      { name: 'Opened', color: SITE_C[s.code], values: s.opened },
      { name: 'Resolved', color: C.faint, values: s.closed },
    ],
  });
  legend(sl, { x: M + 3.6, y: 2.66, w: 3.4, items: [
    { label: 'Opened', color: SITE_C[s.code] }, { label: 'Resolved', color: C.faint }] });
  // Repère de pic au-dessus de la colonne concernée.
  const step = chart.w / s.labels.length;
  s.peaks.forEach(p => {
    const i = s.days.indexOf(p.day);
    if (i < 0) return;
    sl.addShape('roundRect', { x: chart.x + i * step + step / 2 - 0.3, y: chart.y - 0.5, w: 0.6, h: 0.22,
      rectRadius: 0.1, fill: { color: C.red }, line: { type: 'none' } });
    sl.addText('PEAK', { x: chart.x + i * step + step / 2 - 0.3, y: chart.y - 0.5, w: 0.6, h: 0.22,
      fontSize: 7.5, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', fontFace: FONT });
  });

  // Ce qui doit être expliqué sur cette page : la semaine si elle est
  // chargée, chaque jour de pic. À défaut, un commentaire libre.
  const items = [
    ...(s.week_peak ? [s.week_peak] : []),
    ...s.peaks,
  ].map(p => ({
    label: p.kind === 'week-peak'
      ? `Busy week: ${p.count} tickets (usual ≈ ${p.baseline}/week)`
      : `Peak ${p.label}: ${p.count} tickets (usual ≈ ${p.baseline}/day)`,
    text: explanationOf(form, p),
    required: !isSkipped(form, p.key), skipped: isSkipped(form, p.key),
  }));
  if (!items.length) {
    items.push({ label: 'No activity peak this week', text: explanationOf(form, { key: `activity-${s.code}` }),
      required: false });
  }
  explainBox(sl, { x: M + 7.55, y: 1.6, w: CW - 7.55, h: 4.9, title: 'Explanation', items });
  return sl;
}

function breakdownSlide(pptx, sites, form, period) {
  const sl = pptx.addSlide();
  slideHeader(sl, 'Where the load came from', period, `${VILLES.toUpperCase()} · BREAKDOWN`);
  const colW = colWidth(sites.length);
  sites.forEach((s, i) => {
    const x = M + i * (colW + 0.3);
    const doms = s.by_domain.slice(0, 6);
    const tot = doms.reduce((n, [, v]) => n + v, 0);
    panel(sl, { x, y: 1.6, w: colW, h: 3.15, title: `${s.ville} by domain`,
      note: tot ? `${s.kpis.opened_this_week ?? 0} tickets opened this week` : 'No ticket opened this week' });
    if (doms.length) {
      hBars(sl, { x: x + 0.32, y: panel.contentY(1.6, true), w: colW - 0.64, h: 1.8,
        rows: doms.map(([label, value]) => ({ label, value, color: SITE_C[s.code] })) });
    }
    const prios = ['P1', 'P2', 'P3', 'P4'].map(p => `${p} ${(s.by_priority.find(([k]) => k === p) || [0, 0])[1]}`);
    sl.addText(`Priority mix   ${prios.join('   ·   ')}`, {
      x: x + 0.32, y: 4.42, w: colW - 0.64, h: 0.26, fontSize: 9.5, color: C.mute, fontFace: FONT });
  });
  explainBox(sl, { x: M, y: 4.95, w: CW, h: 1.55, title: 'Explanation',
    items: [{ label: '', text: explanationOf(form, { key: 'breakdown' }), required: false }] });
  return sl;
}

function trendSlide(pptx, sites, form, period) {
  const sl = pptx.addSlide();
  slideHeader(sl, 'Eight-week trend', period, `${VILLES.toUpperCase()} · TREND`);
  const hist = sites[0].history;
  const labels = hist.map(h => h.label);
  panel(sl, { x: M, y: 1.6, w: 7.3, h: 4.9, title: 'Tickets opened per week', note: 'Week starting on' });
  groupedCols(sl, { x: M + 0.45, y: 2.65, w: 6.6, h: 2.9, labels,
    series: sites.map(s => ({ name: s.ville, color: SITE_C[s.code], values: s.history.map(h => h.opened || 0) })) });
  legend(sl, { x: M + 4.2, y: 1.86, w: 2.9, items: sites.map(s => ({ label: s.ville, color: SITE_C[s.code] })) });
  // SLA par semaine, sous le graphique : une ligne par site.
  const step = 6.6 / labels.length;
  sites.forEach((s, r) => {
    sl.addText(`SLA ${s.ville}`, { x: M + 0.1, y: 5.68 + r * 0.32, w: 1.2, h: 0.28,
      fontSize: 8, bold: true, color: SITE_C[s.code], fontFace: FONT, valign: 'middle' });
    s.history.forEach((h, i) => {
      sl.addText(h.sla_compliance == null ? 'n/a' : `${Math.round(h.sla_compliance)}%`, {
        x: M + 0.45 + i * step + (r ? 0 : 0), y: 5.68 + r * 0.32, w: step, h: 0.28,
        fontSize: 8.5, color: h.sla_compliance != null && h.sla_compliance < 90 ? C.red : C.mute,
        align: 'center', valign: 'middle', fontFace: FONT });
    });
  });
  explainBox(sl, { x: M + 7.55, y: 1.6, w: CW - 7.55, h: 4.9, title: 'Explanation',
    items: [{ label: 'What the trend says', text: explanationOf(form, { key: 'trend' }), required: false }] });
  return sl;
}

// Assiduité de l'équipe, agrégée : aucun nom, aucun motif.
function attendanceSlide(pptx, a, form, period) {
  const sl = pptx.addSlide();
  slideHeader(sl, 'Team attendance', period, `${VILLES.toUpperCase()} · ATTENDANCE`);
  const cards = [
    ['Presence rate', a.presence_rate == null ? 'n/a' : `${a.presence_rate}%`,
      `${a.headcount} agents · ${a.working_days} working days`],
    ['Absence days', String(a.absence_days), `${a.absence_rate}% of capacity`],
    ['Unplanned', String(a.unplanned_days), `${a.unplanned_rate}% of capacity`],
    ['Notice given', a.notice_rate == null ? 'n/a' : `${a.notice_rate}%`, 'absences announced in time'],
  ];
  const cw = (7.3 - 0.3) / 4;
  cards.forEach(([l, v, n], i) => {
    const x = M + i * (cw + 0.1);
    const alert = (i === 2 && a.unplanned_days > 0);
    sl.addShape('rect', { x, y: 1.6, w: cw, h: 1.3, fill: { color: alert ? C.redSoft : C.bgSoft }, line: { type: 'none' } });
    sl.addText(brk([
      { text: `${v}\n`, options: { bold: true, fontSize: 24, color: alert ? C.red : C.ink } },
      { text: `${l}\n`, options: { bold: true, fontSize: 9.5, color: C.ink } },
      { text: n, options: { fontSize: 8, color: C.mute } },
    ]), { x: x + 0.16, y: 1.66, w: cw - 0.3, h: 1.2, fontFace: FONT, valign: 'top' });
  });

  panel(sl, { x: M, y: 3.1, w: 4.4, h: 3.4, title: 'Agents absent per day', note: 'Half days count 0.5' });
  stackedCols(sl, { x: M + 0.4, y: panel.contentY(3.1, true) + 0.05, w: 3.8, h: 2.35,
    labels: a.labels.map(l => l.split(' ').slice(0, 2).join(' ')),
    series: [
      { name: 'Planned', color: C.blue, values: a.per_day.map(d => d.planned) },
      { name: 'Unplanned', color: C.red, values: a.per_day.map(d => d.unplanned) },
      { name: 'Training', color: C.green, values: a.per_day.map(d => d.training) },
    ] });
  legend(sl, { x: M + 0.3, y: 6.2, w: 3.9, items: [
    { label: 'Planned', color: C.blue }, { label: 'Unplanned', color: C.red }, { label: 'Training', color: C.green }] });

  panel(sl, { x: M + 4.6, y: 3.1, w: 2.7, h: 3.4, title: 'Absence rate', note: 'Last five weeks' });
  const tr = a.trend || [];
  tr.forEach((t, i) => {
    const cur = i === tr.length - 1;
    sl.addText(brk([
      { text: `${new Date(t.from + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })}   `,
        options: { fontSize: 9, color: C.mute } },
      { text: `${t.absence_rate}%`, options: { fontSize: 11, bold: true, color: cur ? C.brand : C.ink } },
      ...(t.unplanned_rate ? [{ text: `  (${t.unplanned_rate}% unpl.)`, options: { fontSize: 8, color: C.red } }] : []),
    ]), { x: M + 4.9, y: 4.05 + i * 0.44, w: 2.3, h: 0.38, fontFace: FONT, valign: 'middle' });
  });

  explainBox(sl, { x: M + 7.55, y: 1.6, w: CW - 7.55, h: 4.9, title: 'Explanation', items: [{
    label: a.required
      ? `${a.absence_days} absence day(s), ${a.unplanned_days} unplanned`
      : 'Full attendance this week',
    text: explanationOf(form, { key: a.key }),
    required: a.required && !isSkipped(form, a.key),
    skipped: a.required && isSkipped(form, a.key),
  }] });
  return sl;
}

// Incidents de plateforme et observations, deux colonnes par site.
// Les incidents d'abord ; chacun porte son explication (impact, action)
// ou la mention rouge qui la réclame.
const OBS_PER_COL = 4;
function observationSlides(pptx, obs, form, period, sites) {
  const cols = sites.map(s => ({ code: s.code, ville: s.ville, rows: obs.filter(o => o.site === s.code || o.site === 'ALL') }));
  const pages = Math.max(1, ...cols.map(c => Math.ceil(c.rows.length / OBS_PER_COL)));
  const out = [];
  const nOut = obs.filter(o => o.outage).length;
  for (let p = 0; p < pages; p++) {
    const sl = pptx.addSlide();
    slideHeader(sl, `Platform incidents & observations${p ? ' (cont.)' : ''}`,
      period, `${VILLES.toUpperCase()} · ${nOut} INCIDENT${nOut > 1 ? 'S' : ''} · ${obs.length} OBSERVATION${obs.length > 1 ? 'S' : ''}`);
    const colW = colWidth(cols.length);
    cols.forEach((c, ci) => {
      const x = M + ci * (colW + 0.3);
      sl.addShape('rect', { x, y: 1.6, w: colW, h: 0.05, fill: { color: SITE_C[c.code] }, line: { type: 'none' } });
      sl.addText(c.ville, { x, y: 1.7, w: colW, h: 0.3, fontSize: 13, bold: true, color: C.ink, fontFace: FONT });
      const rows = c.rows.slice(p * OBS_PER_COL, (p + 1) * OBS_PER_COL);
      if (!rows.length && p === 0) {
        sl.addText('No observation recorded this week.', { x, y: 2.1, w: colW, h: 0.4,
          fontSize: 10.5, italic: true, color: C.mute, fontFace: FONT });
        return;
      }
      const rh = (FLOOR - 2.1) / OBS_PER_COL;
      rows.forEach((o, i) => {
        const y = 2.1 + i * rh;
        const ex = explanationOf(form, o);
        const need = o.required && !ex && !isSkipped(form, o.key);
        const col = o.outage ? C.red : C.brand;
        sl.addShape('rect', { x, y: y + 0.04, w: 0.04, h: rh - 0.16, fill: { color: col }, line: { type: 'none' } });
        const tag = [o.outage ? 'PLATFORM INCIDENT' : 'OBSERVATION', o.date, o.priority, o.status,
          o.site === 'ALL' ? 'all sites' : ''].filter(Boolean).join(' · ');
        sl.addText(brk([
          { text: `${tag}\n`, options: { fontSize: 7.5, bold: true, color: col } },
          { text: `${clip(o.text)}\n`, options: { fontSize: 10, color: C.ink } },
          need
            ? { text: '⚠ Explanation required: impact and action to be completed.', options: { fontSize: 9, italic: true, bold: true, color: C.red } }
            : ex
              ? { text: ex, options: { fontSize: 9, color: C.mute } }
              : { text: 'Explanation: ……………………………………………………………', options: { fontSize: 9, color: C.faint } },
        ]), { x: x + 0.16, y, w: colW - 0.2, h: rh - 0.08, fontFace: FONT, valign: 'top',
             fontSize: fitPt(o.text + ex, 220, 10), lineSpacingMultiple: 1.08 });
      });
    });
    out.push(sl);
  }
  return out;
}

// Prochaine semaine : un espace par site, rempli ou à remplir en séance.
function nextStepsSlide(pptx, form, period, sites) {
  const sl = pptx.addSlide();
  slideHeader(sl, 'Next week: focus and actions', period, `${VILLES.toUpperCase()} · NEXT STEPS`);
  const colW = colWidth(sites.length);
  sites.map(s => [s.code, s.ville]).forEach(([code, ville], i) => {
    const x = M + i * (colW + 0.3);
    sl.addShape('rect', { x, y: 1.6, w: colW, h: 0.05, fill: { color: SITE_C[code] }, line: { type: 'none' } });
    explainBox(sl, { x, y: 1.75, w: colW, h: 4.75, title: ville, items: [
      { label: 'Focus & actions', text: explanationOf(form, { key: `next-${code}` }), required: false },
    ] });
  });
  return sl;
}

/* ── Règles typographiques du deck ───────────────────────────
   Arial partout et aucun tiret long (— ni –), y compris dans les textes
   saisis par l'utilisateur ou tirés des Observations. Plutôt que de
   compter sur chaque appel, on intercepte addText sur toutes les slides :
   un gabarit partagé ou un texte collé ne peut pas passer à côté. */
const noDash = t => String(t).replace(/\s*[\u2014\u2013]\s*/g, ' - ');
function guardText(pptx) {
  const addSlide = pptx.addSlide.bind(pptx);
  pptx.addSlide = (...args) => {
    const slide = addSlide(...args);
    const addText = slide.addText.bind(slide);
    slide.addText = (text, opts = {}) => {
      const t = Array.isArray(text)
        ? text.map(r => ({ ...r, text: noDash(r.text ?? ''),
            options: { ...(r.options || {}), fontFace: FONT } }))
        : noDash(text ?? '');
      return addText(t, { ...opts, fontFace: FONT });
    };
    return slide;
  };
}

async function buildCombinedPptx(analysis, form = {}) {
  const pptx = new PptxGenJS();
  guardText(pptx);
  pptx.layout  = 'LAYOUT_WIDE';
  pptx.author  = form.author || 'Pear';
  pptx.company = 'Pear';
  pptx.title   = 'Weekly Performance';

  const period = `${fmtDate(analysis.week_start)} to ${fmtDate(analysis.week_end)}`;
  const sites = (analysis.sites || []).slice(0, 4);
  SITE_ORDER = sites.map(s => s.code);
  VILLES = sites.map(s => s.ville).join(' × ') || 'All sites';
  const numbered = [];

  // Combien de points requis restent sans explication : affiché en
  // couverture, pour que personne ne présente un deck incomplet sans le savoir.
  const reste = missingExplanations(analysis, form).length;

  /* Couverture */
  const cover = pptx.addSlide();
  cover.background = { color: C.wash };
  cover.addText(`Pear · ${VILLES}`, { x: M, y: 0.72, w: 6, h: 0.24, fontSize: 10, color: '4A6169', fontFace: FONT });
  cover.addText('Weekly performance review presented to both teams: activity, service level, '
    + 'attendance and platform incidents, with every peak and every absence explained.', {
    x: M, y: 1.1, w: 5.4, h: 1.2, fontSize: 13, color: '3E555C', fontFace: FONT, valign: 'top', lineSpacingMultiple: 1.4 });
  cover.addText('Weekly Performance', { x: M - 0.04, y: 2.6, w: CW, h: 1.0, fontSize: 48, bold: true, color: C.ink, fontFace: FONT });
  cover.addText(`${VILLES}   ·   ${period}`, { x: M, y: 3.6, w: CW, h: 0.4, fontSize: 16, color: '3E555C', fontFace: FONT });
  const colW = CW / Math.max(1, sites.length);
  sites.forEach((s, i) => {
    const x = M + i * colW;
    const k = s.kpis || {};
    cover.addShape('rect', { x, y: 4.55, w: colW - 0.3, h: 0.05, fill: { color: SITE_C[s.code] }, line: { type: 'none' } });
    cover.addText(s.ville, { x, y: 4.68, w: colW - 0.3, h: 0.3, fontSize: 12, bold: true, color: C.ink, fontFace: FONT });
    [['opened', k.opened_this_week ?? 0], ['resolved', k.resolved_this_week ?? 0], ['SLA', pct(k.sla_compliance)]]
      .forEach(([l, v], j) => {
        cover.addText(brk([
          { text: `${v}\n`, options: { fontSize: 30, bold: true, color: C.ink } },
          { text: l, options: { fontSize: 10, color: '4A6169' } },
        ]), { x: x + j * ((colW - 0.3) / 3), y: 5.05, w: (colW - 0.3) / 3, h: 1.0, fontFace: FONT, valign: 'top' });
      });
  });
  if (reste) {
    cover.addText(`⚠ ${reste} point${reste > 1 ? 's' : ''} still to be explained`, {
      x: M, y: 6.45, w: 6, h: 0.3, fontSize: 10.5, bold: true, color: C.red, fontFace: FONT });
  }

  /* Indicateurs côte à côte */
  const s2 = pptx.addSlide();
  slideHeader(s2, sites.length > 1 ? 'Sites side by side' : 'Key figures', period, `${VILLES.toUpperCase()} · KEY FIGURES`);
  compareTable(s2, { x: M, y: 1.6, w: 7.3, sites });
  explainBox(s2, { x: M + 7.55, y: 1.6, w: CW - 7.55, h: 4.9, title: 'Key takeaways',
    items: [{ label: '', text: explanationOf(form, { key: 'summary' }), required: false }] });
  numbered.push(s2);

  /* Une page d'activité par site */
  sites.forEach(s => numbered.push(activitySlide(pptx, s, form, period)));
  numbered.push(breakdownSlide(pptx, sites, form, period));
  numbered.push(trendSlide(pptx, sites, form, period));
  numbered.push(attendanceSlide(pptx, analysis.attendance, form, period));
  numbered.push(...observationSlides(pptx, analysis.observations || [], form, period, sites));
  numbered.push(nextStepsSlide(pptx, form, period, sites));

  /* Clôture */
  const end = pptx.addSlide();
  statement(end, {
    bg: C.ink, on: 'FFFFFF', onMute: 'B8BEC6', rule: '3A3F45',
    eyebrow: `Pear · ${VILLES}`,
    lead: 'Questions, corrections and missing explanations: raise them now, '
      + 'or send them before the deck is shared.',
    title: 'Thank you', sub: period,
  });

  // Numérotation en fin de construction : le nombre de pages
  // d'observations dépend des données.
  numbered.forEach((sl, i) => slideFooter(sl, i + 2, numbered.length + 2, VILLES));

  return pptx.write({ outputType: 'nodebuffer' });
}

module.exports = { buildCombinedPptx, missingExplanations };
