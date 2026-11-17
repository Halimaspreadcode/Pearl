/**
 * Génération du PPTX de bilan d'une session d'objectifs.
 *
 * Le deck reprend le système visuel du rapport hebdomadaire
 * (weekly-pptx.js) : même palette, mêmes en-têtes, mêmes pieds, mêmes
 * cartes. Un lecteur qui connaît l'un lit l'autre sans réapprendre.
 *
 * Il ne se contente pas de lister : il compare l'avancement au temps
 * écoulé (l'« avancement attendu »), classe chaque objectif approuvé
 * (terminé, dans les temps, à risque, en retard, abandonné), en déduit des
 * constats rédigés, une watchlist, une frise des jalons, la qualité SMART
 * et des actions recommandées.
 *
 * Entrée : { sess, lignes, cfg } où `lignes` = [{ fo, o }] et `o` est déjà
 * décoré par objectives.decorate() (progress_pct, late, smart…).
 * Sortie : un Buffer (nodebuffer), comme buildWeeklyPptx.
 *
 * Tout le texte du deck est en anglais.
 */

const PptxGenJS = require('pptxgenjs');
const { design } = require('./weekly-pptx');

const {
  C, FONT, M, CW, FLOOR,
  clip, fitPt, orNA,
  slideHeader, slideFooter, statement, metricCard, panel,
  pieChart, shareBar, emptyNote, entryList, planGrid, paginateRows,
} = design;

// Ville et libellé d'équipe du deck en cours : posés par
// buildObjectivesPptx selon sess.team (SN, CI ou les deux).
let VILLE = 'Dakar';
let EQUIPE = 'Front Office Team';
let FOOTER_TEXT = 'Pearl · Dakar · Internal distribution';
const SMART_PASS = 70;
const DAY = 86400000;

// Écart (en points) entre avancement attendu et avancement réel au-delà
// duquel un objectif est jugé « à risque ».
const RISK_GAP = 20;

/* ── Dates ────────────────────────────────────────────────────
   Les dates du module sont des jours ISO (AAAA-MM-JJ). On les lit en UTC
   et on borne le jour au mois : une fin de session saisie « 2026-09-31 »
   se lit comme le 30 septembre, pas comme le 1er octobre. */
function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  if (!m) return null;
  const y = +m[1], mo = +m[2] - 1;
  if (mo < 0 || mo > 11) return null;
  const dim = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return Date.UTC(y, mo, Math.min(Math.max(1, +m[3]), dim));
}
const fmtDay = ms => (ms == null ? 'n/a'
  : new Date(ms).toLocaleDateString('en-GB',
      { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }));
const fmtShort = ms => (ms == null ? 'n/a'
  : new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pctOf = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
const avg = arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

/* ── Statuts ──────────────────────────────────────────────────
   Deux familles : la livraison (objectifs approuvés) et le circuit
   d'approbation (tout le reste). Mêmes teintes que le weekly : le rouge
   est réservé au retard, l'ambre au risque. */
const ST = {
  done:      { label: 'Completed',         color: C.green,  soft: C.greenSoft, ink: '0B5C28' },
  // Trois états seulement pour un objectif en vigueur : Completed, Not
  // finished (en cours, ou clos sans être atteint), Overdue.
  track:     { label: 'Not finished',      color: C.blue,   soft: C.blueSoft,  ink: C.blueDark },
  risk:      { label: 'At risk',           color: C.amber,  soft: C.amberSoft, ink: '7A5200' },
  overdue:   { label: 'Overdue',           color: C.red,    soft: C.redSoft,   ink: '8C1D16' },
  dropped:   { label: 'Dropped',           color: C.faint,  soft: C.bgSoft,    ink: C.mute },
  submitted: { label: 'Awaiting approval', color: C.purple, soft: 'F3E8FD',    ink: '5B1F9A' },
  draft:     { label: 'Draft',             color: 'B0B5BC', soft: C.bgSoft,    ink: C.mute },
  rejected:  { label: 'Rejected',          color: C.brandDark, soft: C.brandSoft, ink: C.brandDark },
  lapsed:    { label: 'Lapsed',            color: 'C9CDD2', soft: C.bgSoft,    ink: C.mute },
};
const DELIVERY = ['done', 'track', 'overdue'];
const PIPELINE = ['submitted', 'draft', 'rejected', 'lapsed'];
// Ordre de lecture d'une liste : ce qui presse d'abord.
const SEVERITY = { overdue: 0, risk: 1, track: 2, done: 3, dropped: 4,
                   submitted: 5, rejected: 6, draft: 7, lapsed: 8 };

const MS_ST = {
  done:     { label: 'Completed',         color: C.green },
  late:     { label: 'Completed late',    color: C.amber },
  overdue:  { label: 'Overdue',           color: C.red },
  upcoming: { label: 'Not finished',      color: C.blue },
  undated:  { label: 'Not finished',      color: C.blue },
};

const SMART_AXES = [
  ['specific', 'Specific'], ['measurable', 'Measurable'], ['achievable', 'Achievable'],
  ['relevant', 'Relevant'], ['timebound', 'Time-bound'],
];

// Image attachée à un jalon, si le modèle en porte une un jour. Seules les
// data URI sont retenues : aller chercher une URL distante au moment de
// l'export rendrait la génération dépendante du réseau.
function stepImage(s) {
  const v = s && (s.image || s.image_url || s.photo || s.picture || s.img);
  const str = typeof v === 'string' ? v : (v && (v.data || v.url)) || '';
  return /^data:image\/(png|jpe?g|gif|svg\+xml);base64,/i.test(str) ? str : null;
}

/* ── Analyse ──────────────────────────────────────────────────
   Tout ce que le deck affiche est calculé ici, une seule fois : les
   slides ne font que lire ce modèle. */
function analyse({ sess, lignes, cfg }) {
  const todayISO = new Date().toISOString().slice(0, 10);
  const today = parseDay(todayISO);
  const sStart = parseDay(sess.start);
  const sEnd = parseDay(sess.end);
  const closed = sess.state === 'closed';
  const hasWindow = sStart != null && sEnd != null && sEnd > sStart;

  // Part de la session écoulée : l'avancement « attendu » moyen.
  let elapsed = null;
  if (closed) elapsed = 100;
  else if (hasWindow) elapsed = Math.round(clamp((today - sStart) / (sEnd - sStart), 0, 1) * 100);
  const daysLeft = hasWindow && !closed ? Math.max(0, Math.round((sEnd - today) / DAY)) : null;

  const objs = lignes.map(({ fo, o }) => {
    const approved = o.state === 'approved';
    const pct = clamp(Number(o.progress_pct) || 0, 0, 100);
    const due = parseDay(o.due);
    const late = o.late || {};

    // Avancement attendu à date, sur la fenêtre propre de l'objectif :
    // du début de session (ou de son approbation) à son échéance.
    let expected = null;
    const from = sStart ?? parseDay(o.approved_at) ?? parseDay(o.created);
    const to = due ?? sEnd;
    if (approved && from != null && to != null) {
      if (to <= from) expected = today >= to ? 100 : 0;
      else expected = Math.round(clamp((today - from) / (to - from), 0, 1) * 100);
    }

    let status;
    if (!approved) status = ST[o.state] ? o.state : 'draft';
    else if (o.progress === 'done') status = 'done';
    // Clos sans être atteint : « Not finished », pas un statut à part.
    else if (o.progress !== 'dropped' && late.overdue) status = 'overdue';
    else status = 'track';

    const steps = approved ? (o.steps || []).filter(s => s.state === 'approved') : [];
    const milestones = steps.map(s => {
      const sd = parseDay(s.due);
      const doneAt = parseDay(s.done_at);
      let st;
      if (s.done) st = (doneAt != null && sd != null && doneAt > sd) ? 'late' : 'done';
      else if (sd != null && sd < today) st = 'overdue';
      else st = 'upcoming';   // pas encore dû, ou sans date : « Not finished »
      return { fo, obj: o, label: clip(s.label) || 'Untitled milestone',
               due: sd, doneAt, status: st, image: stepImage(s) };
    });

    const kpis = (o.kpis || []).filter(k => k && (k.state === 'approved' || !approved || !k.state))
      .filter(k => clip(k.name) || clip(k.target));

    return {
      fo, o, approved, pct, expected, status, due, late, milestones, kpis,
      gap: expected == null ? null : pct - expected,
      smart: o.smart && typeof o.smart.score === 'number' ? o.smart : null,
      title: clip(o.title) || 'Untitled objective',
    };
  });

  const inForce = objs.filter(x => x.approved);
  const count = k => objs.filter(x => x.status === k).length;
  const byStatus = Object.fromEntries(Object.keys(ST).map(k => [k, count(k)]));
  const avgPct = inForce.length ? Math.round(avg(inForce.map(x => x.pct))) : null;
  const expList = inForce.filter(x => x.expected != null).map(x => x.expected);
  const avgExpected = expList.length ? Math.round(avg(expList)) : elapsed;
  const milestones = objs.flatMap(x => x.milestones);
  const msCount = k => milestones.filter(m => m.status === k).length;

  // Agents : ceux qui portent au moins un objectif, puis ceux de l'équipe
  // qui n'en ont aucun — l'absence est une information de pilotage.
  const agentNames = [...new Set(objs.map(x => x.fo))];
  const agents = agentNames.map(fo => {
    const mine = objs.filter(x => x.fo === fo);
    const live = mine.filter(x => x.approved);
    const exp = live.filter(x => x.expected != null).map(x => x.expected);
    const sm = mine.filter(x => x.smart).map(x => x.smart.score);
    return {
      fo, objs: mine, live,
      avgPct: live.length ? Math.round(avg(live.map(x => x.pct))) : null,
      avgExpected: exp.length ? Math.round(avg(exp)) : null,
      done: live.filter(x => x.status === 'done').length,
      overdue: live.filter(x => x.status === 'overdue').length,
      open: live.filter(x => x.status === 'track').length,
      lateMs: live.flatMap(x => x.milestones).filter(m => m.status === 'overdue' || m.status === 'late').length,
      msDone: live.flatMap(x => x.milestones).filter(m => m.status === 'done' || m.status === 'late').length,
      msTotal: live.flatMap(x => x.milestones).length,
      smart: sm.length ? Math.round(avg(sm)) : null,
      pipeline: mine.filter(x => !x.approved).length,
    };
  }).sort((a, b) =>
    (b.avgPct ?? -1) - (a.avgPct ?? -1) || b.done - a.done || a.overdue - b.overdue
    || a.fo.localeCompare(b.fo));
  const team = Array.isArray(cfg && cfg.fo_list) ? cfg.fo_list.map(String) : [];
  const withoutAny = team.filter(n => !agentNames.includes(n));
  const withoutLive = team.filter(n => !inForce.some(x => x.fo === n));
  // Parmi ceux sans objectif en vigueur, ceux qui en ont saisi mais pas
  // encore fait approuver : les compter avec « rien saisi » faisait
  // croire que la moitié de l'équipe n'avait rien fait.
  const pendingOnly = withoutLive.filter(n => agentNames.includes(n));
  const withLive = team.filter(n => inForce.some(x => x.fo === n));

  // Qualité SMART, sur tous les objectifs de la session (y compris ceux
  // qui attendent encore une décision : c'est là qu'elle se corrige).
  const scored = objs.filter(x => x.smart);
  const smartAvg = scored.length ? Math.round(avg(scored.map(x => x.smart.score))) : null;
  const smartPass = scored.filter(x => x.smart.pass).length;
  const axes = SMART_AXES.map(([k, label]) => {
    const v = scored.map(x => (x.smart.parts && x.smart.parts[k] ? x.smart.parts[k].score : null))
      .filter(n => typeof n === 'number');
    return { key: k, label, value: v.length ? Math.round(avg(v) * 10) / 10 : null };
  });
  const issueTally = new Map();
  scored.forEach(x => (x.smart.issues || []).forEach(t => {
    // On regroupe les messages qui ne diffèrent que par un nom de KPI ou
    // une date cités entre guillemets / parenthèses.
    const key = String(t).replace(/"[^"]*"/g, '"…"').replace(/\([^)]*\)/g, '(…)');
    issueTally.set(key, (issueTally.get(key) || 0) + 1);
  }));
  const topIssues = [...issueTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

  return {
    sess, today, sStart, sEnd, closed, hasWindow, elapsed, daysLeft,
    objs, inForce, byStatus, avgPct, avgExpected, milestones,
    msStats: {
      total: milestones.length, done: msCount('done'), late: msCount('late'),
      overdue: msCount('overdue'), upcoming: msCount('upcoming'), undated: msCount('undated'),
    },
    agents, team, withoutAny, withoutLive, pendingOnly, withLive,
    scored, smartAvg, smartPass, axes, topIssues,
  };
}

/* ── Constats rédigés ─────────────────────────────────────────
   Ce que les chiffres veulent dire, en phrases, avec un ton qui pilote
   la couleur (good / warn / alert / info), comme deriveHighlights(). */
function takeaways(A) {
  const out = [];
  const n = A.inForce.length;
  const { byStatus: b } = A;

  if (n && A.avgPct != null && A.avgExpected != null) {
    const gap = A.avgPct - A.avgExpected;
    out.push({
      tone: gap >= 0 ? 'good' : gap > -RISK_GAP ? 'warn' : 'alert',
      text: A.closed
        ? `Session closed: objectives in force finished at ${A.avgPct}% average progress.`
        : gap >= 0
          ? `Ahead of the clock: ${A.avgPct}% average progress against ${A.avgExpected}% expected by today (+${gap} pts).`
          : `Behind the clock: ${A.avgPct}% average progress against ${A.avgExpected}% expected by today (${gap} pts).`,
    });
  }
  if (n) {
    out.push({
      tone: b.done === n ? 'good' : 'info',
      // L'état d'abord (dans les temps / à risque / en retard), l'achèvement
      // ensuite : en cours de trimestre, « 0 % terminés » est la norme et
      // ne dit rien de l'avancement.
      text: `${plural(n, 'objective')} in force: ${b.done} completed, ${b.track} not finished, ${b.overdue} overdue`
          + (!b.done && !A.closed ? ' — none completed yet, which is normal before the due dates.' : '.'),
    });
  }
  if (b.overdue) {
    const worst = A.inForce.filter(x => x.status === 'overdue')
      .sort((a, c) => (c.late.days_over || 0) - (a.late.days_over || 0))[0];
    out.push({
      tone: 'alert',
      text: `${plural(b.overdue, 'objective')} past due date; the oldest, "${worst.title}" (${worst.fo}), `
          + `is ${plural(worst.late.days_over || 0, 'day')} overdue.`,
    });
  }
  const ms = A.msStats;
  if (ms.total) {
    const delivered = ms.done + ms.late;
    out.push({
      tone: ms.overdue ? (ms.overdue > 2 ? 'alert' : 'warn') : 'good',
      text: `${delivered} of ${plural(ms.total, 'milestone')} delivered`
          + (ms.late ? ` (${ms.late} after their due date)` : '')
          + (ms.overdue ? `; ${ms.overdue} past due and still open.` : '; none past due and still open.'),
    });
  }
  const pend = A.byStatus.submitted, rej = A.byStatus.rejected;
  if (pend || rej) {
    out.push({
      tone: 'warn',
      text: [pend && `${plural(pend, 'objective')} awaiting an approval decision`,
             rej && `${rej} rejected and waiting to be reworked`].filter(Boolean).join(', ') + '.',
    });
  }
  if (A.smartAvg != null) {
    const weakest = A.axes.filter(a => a.value != null).sort((a, c) => a.value - c.value)[0];
    const below = A.scored.length - A.smartPass;
    out.push({
      tone: A.smartAvg >= SMART_PASS && !below ? 'good' : A.smartAvg >= SMART_PASS ? 'info' : 'warn',
      text: `Average SMART score ${A.smartAvg}/100; ${below} of ${A.scored.length} fail the check `
          + `(under ${SMART_PASS}, or no KPI or due date)` + (weakest ? `, weakest criterion ${weakest.label} (${weakest.value}/20).` : '.'),
    });
  }
  const ranked = A.agents.filter(a => a.avgPct != null);
  if (ranked.length > 1) {
    const top = ranked[0];
    out.push({ tone: 'info',
      text: `Most advanced: ${top.fo} at ${top.avgPct}% average progress across ${plural(top.live.length, 'objective')}.` });
  }
  if (A.team.length && A.withoutLive.length) {
    out.push({
      tone: A.withoutAny.length > A.team.length / 2 ? 'warn' : 'info',
      text: `${A.withLive.length} of ${A.team.length} agents have an approved objective`
          + (A.pendingOnly.length ? `; ${A.pendingOnly.length} only have objectives awaiting approval` : '')
          + (A.withoutAny.length ? `; ${A.withoutAny.length} have not entered any yet.` : '.'),
    });
  }
  return out;
}

/* ── Primitives propres au deck ───────────────────────────── */

// Couleur d'un pourcentage d'avancement, par paliers : 100 % vert, puis
// vert clair, orange, orange foncé, rouge. La même échelle partout dans le
// deck, pour qu'une barre se lise d'un coup d'œil.
const PCT_SCALE = [
  { min: 100, bar: '1E8E3E', txt: '137333' },   // vert : terminé
  { min: 75,  bar: '81C995', txt: '1E8E3E' },   // vert clair
  { min: 50,  bar: 'F9AB00', txt: 'B06000' },   // orange
  { min: 25,  bar: 'E8710A', txt: 'B8420B' },   // orange foncé
  { min: 0,   bar: 'D93025', txt: 'B31412' },   // rouge
];
function pctTone(pct) {
  const v = Number(pct) || 0;
  return PCT_SCALE.find(t => v >= t.min) || PCT_SCALE[PCT_SCALE.length - 1];
}

// Barre d'avancement avec repère « attendu à date » : la barre dit où
// l'on en est, le trait vertical où l'on devrait être.
function progressBar(slide, { x, y, w, h = 0.13, pct, expected, color }) {
  slide.addShape('rect', { x, y, w, h, fill: { color: 'ECEEF1' }, line: { type: 'none' } });
  if (pct > 0) {
    slide.addShape('rect', {
      x, y, w: Math.max(0.03, w * clamp(pct, 0, 100) / 100), h,
      fill: { color }, line: { type: 'none' },
    });
  }
  if (expected != null) {
    slide.addShape('rect', {
      x: x + w * clamp(expected, 0, 100) / 100 - 0.012, y: y - 0.06, w: 0.024, h: h + 0.12,
      fill: { color: C.ink }, line: { type: 'none' },
    });
  }
}

// Pastille de statut : aplat doux, texte foncé de la même teinte.
function statusPill(slide, { x, y, w = 1.42, h = 0.3, status }) {
  const s = ST[status] || ST.draft;
  slide.addShape('roundRect', {
    x, y, w, h, rectRadius: h / 2, fill: { color: s.soft }, line: { type: 'none' },
  });
  slide.addText(s.label, {
    x, y, w, h, fontSize: fitPt(s.label, 14, 9), bold: true, color: s.ink,
    align: 'center', valign: 'middle', fontFace: FONT,
  });
}

// Cadre d'image : une photo si le jalon en porte une, sinon un emplacement
// explicite où le présentateur dépose sa capture.
function imageFrame(slide, { x, y, w, h, image, hint }) {
  if (image) {
    slide.addShape('rect', { x, y, w, h, fill: { color: C.bgSoft }, line: { type: 'none' } });
    slide.addImage({ data: image, x, y, w, h, sizing: { type: 'cover', w, h } });
    return;
  }
  slide.addShape('roundRect', {
    x, y, w, h, rectRadius: 0.1,
    fill: { color: C.bgSoft }, line: { color: 'C9CDD2', width: 1, dashType: 'dash' },
  });
  // Pictogramme « photo » dessiné en formes simples : un cadre, un soleil,
  // deux reliefs. Rendu à l'identique partout, contrairement à un emoji.
  const iw = 0.62, ih = 0.46;
  const ix = x + (w - iw) / 2, iy = y + h / 2 - ih - 0.1;
  slide.addShape('roundRect', {
    x: ix, y: iy, w: iw, h: ih, rectRadius: 0.05,
    fill: { color: 'FFFFFF' }, line: { color: C.faint, width: 1.25 },
  });
  slide.addShape('ellipse', {
    x: ix + iw - 0.2, y: iy + 0.08, w: 0.1, h: 0.1,
    fill: { color: C.amber }, line: { type: 'none' },
  });
  slide.addShape('triangle', {
    x: ix + 0.07, y: iy + 0.17, w: 0.3, h: 0.24,
    fill: { color: C.faint }, line: { type: 'none' },
  });
  slide.addShape('triangle', {
    x: ix + 0.26, y: iy + 0.24, w: 0.28, h: 0.17,
    fill: { color: 'B0B5BC' }, line: { type: 'none' },
  });
  slide.addText('Insert image', {
    x, y: y + h / 2 + 0.02, w, h: 0.26,
    fontSize: 11, bold: true, color: C.mute, align: 'center', valign: 'middle', fontFace: FONT,
  });
  slide.addText(hint || 'Drop a photo or screenshot of this milestone', {
    x: x + 0.2, y: y + h / 2 + 0.28, w: w - 0.4, h: 0.24,
    fontSize: 8.5, color: C.faint, align: 'center', valign: 'middle', fontFace: FONT,
  });
}

// Petit titre de bloc, en gris gras, comme sur la slide Trend du weekly.
function blockTitle(slide, text, x, y, w) {
  slide.addText(text, {
    x, y, w, h: 0.24, fontSize: 9.5, bold: true, color: C.mute, fontFace: FONT, valign: 'middle',
  });
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/* ── Deck ─────────────────────────────────────────────────── */
async function buildObjectivesPptx({ sess, lignes, cfg }) {
  sess = sess || {};
  const A = analyse({ sess, lignes: lignes || [], cfg: cfg || {} });

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Pearl';
  pptx.company = 'Pearl';
  VILLE = { SN: 'Dakar', CI: 'Abidjan' }[sess.team] || (sess.team === 'ALL' || !sess.team ? 'Dakar + Abidjan' : 'Dakar');
  EQUIPE = sess.team === 'SN' ? 'Front Office Team · Senegal' : sess.team === 'CI' ? "Front Office Team · Côte d'Ivoire" : 'Front Office Team';
  FOOTER_TEXT = `Pearl · ${VILLE} · Internal distribution`;
  pptx.title = `Objectives Review · ${clip(sess.name || sess.id || '')}`;

  const sessName = clip(sess.name || sess.id) || 'Objectives session';
  const period = A.hasWindow ? `${fmtDay(A.sStart)} to ${fmtDay(A.sEnd)}`
    : [sess.start, sess.end].filter(Boolean).join(' to ') || 'Dates not set';
  const sub = sessName;

  // Pieds différés, comme dans le weekly : le total n'est connu qu'une
  // fois les sections vides écartées. Aucune slide ne pose son propre pied.
  const pieds = [];
  const differerPied = (slide, encre) => { pieds.push({ slide, encre }); };

  const n = A.inForce.length;
  const total = A.objs.length;

  /* 1. Couverture — même composition que le weekly. */
  {
    const cover = pptx.addSlide();
    cover.background = { color: C.wash };
    cover.addText(`Pearl · ${VILLE}`, {
      x: M, y: 0.72, w: 5.2, h: 0.24, fontSize: 10, color: '4A6169', fontFace: FONT,
    });
    cover.addText(
      'Session review of individual objectives: delivery against the clock, milestones, '
      + 'objective quality, and where support is needed before the deadline.', {
      x: M, y: 1.1, w: 5.2, h: 1.3, fontSize: 13, color: '3E555C', fontFace: FONT,
      valign: 'top', lineSpacingMultiple: 1.4,
    });
    cover.addShape('rect', {
      x: 6.66, y: 0, w: 0.008, h: 7.5, fill: { color: '9FB8C0' }, line: { type: 'none' },
    });
    cover.addShape('ellipse', {
      x: 6.615, y: 4.02, w: 0.1, h: 0.1, fill: { color: C.brand }, line: { type: 'none' },
    });
    cover.addText('Objectives\nReview', {
      x: 7.15, y: 3.42, w: CW - 6.43, h: 2.0,
      fontSize: 52, bold: true, color: C.ink, fontFace: FONT,
      valign: 'top', lineSpacingMultiple: 1.02,
    });
    cover.addText([
      { text: sessName, options: { bold: true, color: C.ink } },
      { text: `   ${period}`, options: { color: '3E555C' } },
    ], {
      x: 7.18, y: 5.52, w: CW - 6.46, h: 0.3, fontSize: 13, fontFace: FONT,
    });
    cover.addText(A.closed
      ? `Session closed${sess.closed_at ? ` on ${fmtDay(parseDay(sess.closed_at))}` : ''}`
      : `Session open${A.daysLeft != null ? ` · ${plural(A.daysLeft, 'day')} left` : ''}`, {
      x: 7.18, y: 5.84, w: CW - 6.46, h: 0.26, fontSize: 10.5, color: '4A6169', fontFace: FONT,
    });
    cover.addShape('rect', {
      x: M, y: 5.6, w: 1.4, h: 0.026, fill: { color: '9FB8C0' }, line: { type: 'none' },
    });
    cover.addText(EQUIPE, {
      x: M, y: 5.78, w: 5.2, h: 0.26, fontSize: 11.5, bold: true, color: C.ink, fontFace: FONT,
    });
    cover.addText('Internal distribution', {
      x: M, y: 6.04, w: 5.2, h: 0.24, fontSize: 9.5, color: '4A6169', fontFace: FONT,
    });
  }

  /* 2. Synthèse — slide sombre, chiffre héros + constats rédigés. */
  {
    const s = pptx.addSlide();
    const INK = '15161A', ON = 'FFFFFF', MUTE = 'A8ACB5';
    s.background = { color: INK };
    s.addText('Executive summary', {
      x: M, y: 0.5, w: 6, h: 0.24, fontSize: 9.5, color: MUTE, fontFace: FONT,
    });

    const heroVal = n && A.avgPct != null ? String(A.avgPct) : String(total);
    const heroUnit = n && A.avgPct != null ? '%' : '';
    let heroText;
    if (!total) {
      heroText = `No objective has been recorded for ${sessName} yet. `
        + 'The review below lists what needs to happen for the session to produce results.';
    } else if (!n) {
      heroText = `${plural(total, 'objective')} recorded for ${sessName}, none approved yet. `
        + 'Progress can only be tracked once objectives are approved.';
    } else if (A.closed) {
      heroText = `Final average progress across ${plural(n, 'objective')} in force. `
        + `${A.byStatus.done} completed, ${A.byStatus.track} not finished, ${A.byStatus.overdue} overdue.`;
    } else {
      const exp = A.avgExpected;
      heroText = `Average progress across ${plural(n, 'objective')} in force`
        + (exp != null ? `, against ${exp}% expected at this point of their timelines. ` : '. ')
        + (A.elapsed != null ? `${A.elapsed}% of the session has elapsed` : 'Session dates are not set')
        + (A.daysLeft != null ? `, ${plural(A.daysLeft, 'day')} remain.` : '.');
    }

    const HERO_BOX = 1.9, HERO_MAXW = 4.3;
    const HERO_MAX = Math.floor(HERO_BOX / 1.2 * 72);
    const heroEm = heroVal.length * 0.556 + (heroUnit ? 0.36 * 0.95 + 0.14 : 0);
    const HERO_PT = Math.min(HERO_MAX, Math.floor(HERO_MAXW / heroEm * 72),
                             heroVal.length >= 3 ? 92 : 114);
    const digitW = 0.556 * HERO_PT / 72;
    const heroX = M - 0.14;
    const heroW = heroVal.length * digitW;
    // Marges internes nulles et boîte légèrement plus large que les glyphes :
    // avec les marges par défaut (0,1 in), Keynote renvoyait « 40 » sur
    // deux lignes. L'unité reste placée d'après la largeur des glyphes.
    s.addText(heroVal, {
      x: heroX, y: 1.05, w: heroW + 0.3, h: HERO_BOX, margin: 0,
      fontSize: HERO_PT, color: ON, fontFace: FONT, valign: 'middle', align: 'left',
    });
    if (heroUnit) {
      s.addText(heroUnit, {
        x: heroX + heroW + 0.1, y: 1.12, w: 1.1, h: 0.72, margin: 0,
        fontSize: Math.round(HERO_PT * 0.36), color: ON, fontFace: FONT, valign: 'top',
      });
    }
    const textX = Math.max(5.55, heroX + heroW + (heroUnit ? 1.15 : 0.5));
    s.addText(heroText, {
      x: textX, y: 1.32, w: M + CW - textX, h: 1.5,
      fontSize: 12.5, color: ON, fontFace: FONT, valign: 'top', lineSpacingMultiple: 1.42,
    });

    const derived = takeaways(A);
    if (!derived.length) {
      s.addText('Nothing to analyse yet: no objective, milestone or approval activity in this session.', {
        x: M, y: 3.5, w: CW, h: 0.5, fontSize: 12, italic: true, color: MUTE, fontFace: FONT,
      });
    } else {
      const TOP = 3.34, H = 0.44;
      const cap = Math.max(1, Math.floor((FLOOR + 0.3 - TOP) / H));
      derived.slice(0, cap).forEach((h, i) => {
        const cy = TOP + i * H;
        const col = h.tone === 'alert' ? C.red : h.tone === 'warn' ? C.amber
                  : h.tone === 'good' ? C.green : C.brand;
        s.addShape('rect', {
          x: M, y: cy + 0.14, w: 0.16, h: 0.04, fill: { color: col }, line: { type: 'none' },
        });
        s.addText(clip(h.text), {
          x: M + 0.34, y: cy, w: CW - 0.34, h: 0.38,
          fontSize: fitPt(h.text, 132, 11.5), color: 'D8DBE0', valign: 'middle', fontFace: FONT,
        });
      });
    }
    differerPied(s, { on: ON, mute: '6B6F78' });
  }

  /* 3. Chiffres clés — trois cartes + rang secondaire. */
  {
    const s = pptx.addSlide();
    slideHeader(s, 'Where the session\nstands in numbers', sub, 'Overview');
    const cardY = 1.86, cardH = 4.24, gap = 0.26;
    const cardW = (CW - gap * 2) / 3;

    metricCard(s, {
      x: M, y: cardY, w: cardW, h: cardH,
      kicker: total ? `${plural(total, 'objective')} recorded across ${plural(A.agents.length, 'agent')}.`
                    : 'No objective recorded in this session.',
      value: n, label: 'Objectives in force',
      note: total - n
        ? `${total - n} more still in the approval circuit (draft, submitted, rejected or lapsed).`
        : total ? 'Every recorded objective has been approved.' : 'Nothing approved yet.',
      fill: C.bgSoft, on: C.ink, onMute: C.mute,
    });

    // « En bonne voie » plutôt qu'un taux d'achèvement : en cours de
    // trimestre presque rien n'est encore terminé, et un 0 % affiché en
    // grand ne disait rien de l'avancement réel. Terminés + dans les temps,
    // rapportés aux objectifs en vigueur (hors abandonnés).
    const b2 = A.byStatus;
    const base = n;
    const rate = base > 0 ? pctOf((b2.done || 0) + (b2.track || 0), base) : null;
    const tone = rate == null ? null
      : (b2.overdue ? 'alert' : rate >= 70 ? 'good' : 'warn');
    metricCard(s, {
      x: M + cardW + gap, y: cardY, w: cardW, h: cardH,
      kicker: n ? `Completed or not yet past their due date, among ${plural(base, 'objective')} in force.`
                : 'Measured on approved objectives only.',
      value: rate == null ? 'n/a' : `${rate}%`, label: 'Not overdue',
      note: n ? `${b2.done || 0} completed · ${b2.track || 0} not finished · ${b2.overdue || 0} overdue.`
              : 'No approved objective to measure.',
      fill: tone === 'good' ? C.greenSoft : tone === 'alert' ? C.redSoft : tone === 'warn' ? C.amberSoft : C.bgSoft,
      on: tone === 'good' ? '0B5C28' : tone === 'alert' ? '8C1D16' : tone === 'warn' ? '7A5200' : C.ink,
      onMute: tone ? (tone === 'good' ? '0B5C28' : tone === 'alert' ? '8C1D16' : '7A5200') : C.mute,
    });

    const gapPts = A.avgPct != null && A.avgExpected != null ? A.avgPct - A.avgExpected : null;
    metricCard(s, {
      x: M + (cardW + gap) * 2, y: cardY, w: cardW, h: cardH,
      kicker: A.elapsed != null ? `${A.elapsed}% of the session elapsed`
        + (A.daysLeft != null ? `, ${plural(A.daysLeft, 'day')} left.` : '.') : 'Session dates are not set.',
      value: A.avgPct == null ? 'n/a' : `${A.avgPct}%`, label: 'Average progress',
      note: gapPts == null ? 'Progress is the share of approved milestones delivered (late ones count half).'
        : `${gapPts >= 0 ? '+' : ''}${gapPts} pts against the ${A.avgExpected}% expected by today.`,
      fill: C.brand, on: 'FFFFFF', onMute: 'F6D3D9',
    });

    const ms = A.msStats;
    const sec = [
      { label: 'Agents with an approved objective', value: String(A.withLive.length),
        note: A.team.length ? `of ${A.team.length}${A.pendingOnly.length ? ` · ${A.pendingOnly.length} awaiting approval` : ''}` : '' },
      { label: 'Milestones delivered', value: `${ms.done + ms.late}/${ms.total}` },
      { label: 'Milestones overdue', value: String(ms.overdue), tone: ms.overdue ? 'alert' : undefined },
      { label: 'Awaiting approval', value: String(A.byStatus.submitted),
        tone: A.byStatus.submitted ? 'warn' : undefined },
      { label: 'Avg SMART', value: A.smartAvg == null ? 'n/a' : String(A.smartAvg), note: '/100',
        tone: A.smartAvg == null ? undefined : A.smartAvg >= SMART_PASS ? 'good' : 'alert' },
    ];
    const secW = CW / sec.length;
    s.addShape('rect', { x: M, y: 6.3, w: CW, h: 0.01, fill: { color: C.line }, line: { type: 'none' } });
    sec.forEach((t, i) => {
      const x = M + i * secW;
      if (i > 0) {
        s.addShape('rect', { x, y: 6.46, w: 0.008, h: 0.34, fill: { color: C.line }, line: { type: 'none' } });
      }
      s.addText([
        { text: t.value, options: { bold: true, fontSize: 15,
            color: t.tone === 'alert' ? C.red : t.tone === 'good' ? C.green
                 : t.tone === 'warn' ? '7A5200' : C.ink } },
        ...(t.note ? [{ text: ` ${t.note}`, options: { fontSize: 9.5, color: C.faint } }] : []),
        { text: `  ${t.label}`, options: { fontSize: 9.5, color: C.mute } },
      ], { x: x + (i > 0 ? 0.2 : 0), y: 6.44, w: secW - 0.22, h: 0.38, fontFace: FONT, valign: 'middle' });
    });
    differerPied(s);
  }

  if (total) {
    /* 4. Répartition — statut de livraison et circuit d'approbation. */
    {
      const s = pptx.addSlide();
      slideHeader(s, 'How objectives split\nby delivery status', sub, 'Distribution');
      const pw = 5.78;
      panel(s, { x: M, y: 1.86, w: pw, h: 4.52, title: 'Objectives in force',
        note: n ? `${plural(n, 'approved objective')}, classified against their timeline` : 'No approved objective' });
      if (n) {
        pieChart(s, {
          cx: M + 0.45, cy: 3.1, d: 2.3, centerLabel: 'in force',
          rows: DELIVERY.map(k => ({ label: ST[k].label, value: A.byStatus[k], color: ST[k].color })),
          legendX: M + 3.3, legendW: 2.2,
        });
        s.addText('Overdue: due date passed and not completed. '
          + 'Not finished: still in progress, or closed without being completed.', {
          x: M + 0.32, y: 5.72, w: pw - 0.64, h: 0.5,
          fontSize: 8.5, color: C.faint, fontFace: FONT, valign: 'top', lineSpacingMultiple: 1.1,
        });
      } else {
        emptyNote(s, 'No objective has been approved yet, so none can be tracked for delivery.',
          { x: M + 0.32, y: panel.contentY(1.86, true), w: pw - 0.64, h: 0.9, fontSize: 11 });
      }

      const rx = M + pw + 0.33, rw = CW - pw - 0.33;
      const pipe = [{ k: 'approved', label: 'Approved', value: n, color: C.green },
        ...PIPELINE.map(k => ({ k, label: ST[k].label, value: A.byStatus[k], color: ST[k].color }))]
        .filter(r => r.value > 0);
      panel(s, { x: rx, y: 1.86, w: rw, h: 4.52, title: 'Approval circuit',
        note: `${plural(total, 'objective')} recorded in the session` });
      shareBar(s, { x: rx + 0.32, y: panel.contentY(1.86, true) + 0.08, w: rw - 0.64, rows: pipe });
      const pend = A.byStatus.submitted, rej = A.byStatus.rejected, dr = A.byStatus.draft;
      const msg = pend || rej || dr
        ? [pend && `${plural(pend, 'objective')} waiting for an admin decision`,
           rej && `${rej} sent back for rework`,
           dr && `${dr} still in draft`].filter(Boolean).join(', ') + '. Until approved, they do not count toward progress.'
        : 'The approval circuit is clear: nothing is waiting for a decision.';
      s.addText(msg, {
        x: rx + 0.32, y: 5.5, w: rw - 0.64, h: 0.7,
        fontSize: 10.5, color: C.ink, fontFace: FONT, valign: 'top', lineSpacingMultiple: 1.2,
      });
      differerPied(s);
    }

    /* 5. Rythme — le temps écoulé face à l'avancement. */
    if (n) {
      const s = pptx.addSlide();
      slideHeader(s, 'Delivery measured\nagainst the clock', sub, 'Pace');
      const lw = 5.2;
      panel(s, { x: M, y: 1.86, w: lw, h: 4.52, title: 'Clock vs delivery',
        note: 'Share of the timeline consumed vs share of the work delivered' });
      const bx = M + 0.32, bw = lw - 0.64;
      const bars = [
        { label: 'Session time elapsed', value: A.elapsed, color: C.faint },
        { label: 'Progress expected by today', value: A.avgExpected, color: C.ink },
        { label: 'Average progress delivered', value: A.avgPct, color: pctTone(A.avgPct).bar, tone: true },
      ];
      bars.forEach((b, i) => {
        const y = 2.95 + i * 0.72;
        s.addText([
          { text: b.value == null ? 'n/a' : `${b.value}%`, options: { bold: true, fontSize: 14, color: b.tone && b.value != null ? pctTone(b.value).txt : C.ink } },
          { text: `   ${b.label}`, options: { fontSize: 9.5, color: C.mute } },
        ], { x: bx, y, w: bw, h: 0.3, fontFace: FONT, valign: 'middle' });
        progressBar(s, { x: bx, y: y + 0.36, w: bw, h: 0.14, pct: b.value || 0, color: b.color });
      });
      // Un objectif terminé est tenu, quel que soit son pourcentage (les
      // jalons tardifs n'y comptent que pour moitié) ; un abandon ne se
      // compare plus à rien.
      const live = A.inForce.filter(x => x.o.progress !== 'dropped');
      const ahead = live.filter(x => x.status === 'done' || (x.gap != null && x.gap >= 0)).length;
      const behind = live.filter(x => x.status !== 'done' && x.gap != null && x.gap < 0).length;
      s.addText(`${plural(ahead, 'objective')} completed or ahead of the expected progress, ${behind} behind it. `
        + 'Expected progress is the share of each objective’s own timeline (session start to due date) already elapsed.', {
        x: bx, y: 5.2, w: bw, h: 1.0,
        fontSize: 9.5, color: C.mute, fontFace: FONT, valign: 'top', lineSpacingMultiple: 1.2,
      });

      // Nuage : attendu (x) contre réel (y). Au-dessus de la diagonale, en
      // avance ; en dessous, en retard.
      const rx = M + lw + 0.26, rw = CW - lw - 0.26;
      panel(s, { x: rx, y: 1.86, w: rw, h: 4.52, title: 'Each objective, expected vs actual',
        note: 'Above the diagonal: ahead of schedule. Below: behind.' });
      const px = rx + 0.95, py = 2.95, pW = rw - 1.4, pH = 2.85;
      [0, 50, 100].forEach(v => {
        const gy = py + pH - (v / 100) * pH;
        s.addShape('rect', { x: px, y: gy, w: pW, h: 0.008, line: { type: 'none' },
          fill: { color: v === 0 ? 'C9CDD2' : 'E4E7EA' } });
        s.addText(`${v}%`, { x: px - 0.7, y: gy - 0.1, w: 0.62, h: 0.2,
          fontSize: 8, color: C.faint, align: 'right', valign: 'middle', fontFace: FONT });
        const gx = px + (v / 100) * pW;
        s.addText(`${v}%`, { x: gx - 0.3, y: py + pH + 0.04, w: 0.6, h: 0.2,
          fontSize: 8, color: C.faint, align: 'center', valign: 'middle', fontFace: FONT });
      });
      s.addShape('line', {
        x: px, y: py, w: pW, h: pH, flipV: true,
        line: { color: C.faint, width: 1, dashType: 'dash' },
      });
      s.addText('Actual', { x: px - 0.9, y: py - 0.34, w: 0.82, h: 0.2,
        fontSize: 8, bold: true, color: C.mute, align: 'right', fontFace: FONT });
      s.addText('Expected by today', { x: px + pW - 2, y: py + pH + 0.24, w: 2, h: 0.2,
        fontSize: 8, bold: true, color: C.mute, align: 'right', fontFace: FONT });
      const D = 0.17;
      const pts = A.inForce.filter(x => x.expected != null && x.o.progress !== 'dropped');
      if (!pts.length) {
        emptyNote(s, 'Not enough dates to place objectives: set the session start and each due date.',
          { x: px + 0.3, y: py + pH / 2 - 0.45, w: pW - 0.6, h: 0.9, fontSize: 10.5, align: 'center' });
      }
      pts.forEach(x => {
        s.addShape('ellipse', {
          x: px + (x.expected / 100) * pW - D / 2, y: py + pH - (x.pct / 100) * pH - D / 2, w: D, h: D,
          fill: { color: ST[x.status].color, transparency: 20 }, line: { color: 'FFFFFF', width: 0.75 },
        });
      });
      differerPied(s);
    }

    /* 6. Classement des agents. */
    {
      const ROW = 0.5, TOP = 2.28;
      const pages = paginateRows(A.agents, TOP, ROW);
      pages.forEach((rows, pi) => {
        const s = pptx.addSlide();
        slideHeader(s, pi ? 'Agent leaderboard\n(cont.)' : 'Agent leaderboard\nby average progress',
          plural(A.agents.length, 'agent'), 'Ranking');
        // En-têtes de colonnes.
        const cols = { rank: M, name: M + 0.55, bar: M + 3.55, barW: 3.9, stats: M + 8.05 };
        [['#', cols.rank, 0.5], ['Agent', cols.name, 2.9], ['Progress   |  expected by today', cols.bar, 4.3],
         ['Completed · Not finished · Overdue · Late milestones', cols.stats, CW - 8.05]].forEach(([t, x, w]) => {
          s.addText(t, { x, y: 1.9, w, h: 0.22, fontSize: 7.5, bold: true, color: C.faint,
            charSpacing: 0.3, fontFace: FONT, valign: 'middle' });
        });
        s.addShape('rect', { x: M, y: 2.14, w: CW, h: 0.008, fill: { color: C.line }, line: { type: 'none' } });
        const offset = pages.slice(0, pi).reduce((a, p) => a + p.length, 0);
        rows.forEach((a, i) => {
          const cy = TOP + i * ROW;
          const rank = offset + i + 1;
          const col = a.avgPct != null ? pctTone(a.avgPct).bar : C.faint;
          s.addText(String(rank).padStart(2, '0'), {
            x: cols.rank, y: cy, w: 0.5, h: 0.36, fontSize: 15, bold: true,
            color: rank <= 3 && a.avgPct != null ? C.brand : C.faint, fontFace: FONT, valign: 'middle',
          });
          s.addText(clip(a.fo), {
            x: cols.name, y: cy, w: 2.9, h: 0.36, fontSize: fitPt(a.fo, 26, 11.5), bold: true,
            color: C.ink, fontFace: FONT, valign: 'middle',
          });
          if (a.avgPct != null) {
            progressBar(s, { x: cols.bar, y: cy + 0.12, w: cols.barW, h: 0.12,
              pct: a.avgPct, expected: a.avgExpected, color: col });
            s.addText(`${a.avgPct}%`, { x: cols.bar + cols.barW + 0.08, y: cy, w: 0.5, h: 0.36,
              fontSize: 10.5, bold: true, color: pctTone(a.avgPct).txt, fontFace: FONT, valign: 'middle' });
            s.addText([
              { text: `${a.done}/${a.live.length}`, options: { bold: true, color: C.ink } },
              { text: '  completed   ', options: { color: C.faint } },
              { text: String(a.open), options: { bold: true, color: C.ink } },
              { text: '  not finished   ', options: { color: C.faint } },
              { text: String(a.overdue), options: { bold: true, color: a.overdue ? C.red : C.ink } },
              { text: '  overdue   ', options: { color: C.faint } },
              { text: String(a.lateMs), options: { bold: true, color: a.lateMs ? C.red : C.ink } },
              { text: '  late ms', options: { color: C.faint } },
            ], { x: cols.stats, y: cy, w: CW - 8.05, h: 0.36, fontSize: 9.5, fontFace: FONT, valign: 'middle' });
          } else {
            s.addText(`No approved objective yet · ${plural(a.pipeline, 'objective')} in the approval circuit`, {
              x: cols.bar, y: cy, w: CW - 3.55, h: 0.36, fontSize: 9.5, italic: true,
              color: C.faint, fontFace: FONT, valign: 'middle',
            });
          }
          if (i < rows.length - 1) {
            s.addShape('rect', { x: M, y: cy + ROW - 0.07, w: CW, h: 0.006,
              fill: { color: C.line }, line: { type: 'none' } });
          }
        });
        if (pi === pages.length - 1 && A.withoutAny.length) {
          const t = `No objective recorded: ${A.withoutAny.join(', ')}.`;
          const ny = Math.min(TOP + rows.length * ROW + 0.08, FLOOR);
          s.addText(t, { x: M, y: ny, w: CW, h: 0.28, fontSize: fitPt(t, 190, 9), italic: true,
            color: C.mute, fontFace: FONT, valign: 'middle' });
        }
        differerPied(s);
      });
    }

    /* 7. Watchlist — objectifs en retard ou à risque. */
    {
      // En retard, ou nettement en retard sur l'avancement attendu à date.
      const watch = A.inForce.filter(x => x.status === 'overdue'
        || (x.status === 'track' && x.o.progress !== 'dropped' && x.expected != null && x.expected - x.pct >= RISK_GAP))
        .sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status]
          || (b.late.days_over || 0) - (a.late.days_over || 0) || (a.gap ?? 0) - (b.gap ?? 0));
      if (watch.length) {
        const rows = watch.map(x => {
          const why = [];
          if (x.status === 'overdue') why.push(`Due ${fmtDay(x.due)}, ${plural(x.late.days_over || 0, 'day')} overdue and not completed`);
          if (x.gap != null && x.gap <= -RISK_GAP) why.push(`${-x.gap} pts behind the ${x.expected}% expected by today`);
          const lateMs = x.milestones.filter(m => m.status === 'overdue');
          if (lateMs.length) {
            why.push(`${plural(lateMs.length, 'milestone')} past due: `
              + lateMs.slice(0, 2).map(m => `${m.label} (${fmtShort(m.due)})`).join(', ')
              + (lateMs.length > 2 ? ` +${lateMs.length - 2}` : ''));
          }
          return {
            tag: ST[x.status].label, title: x.title,
            meta: [`Due ${fmtDay(x.due)}`, `Progress ${x.pct}%`,
                   x.expected != null && `expected ${x.expected}%`,
                   x.milestones.length && `${x.milestones.filter(m => m.status === 'done' || m.status === 'late').length}/${x.milestones.length} milestones`]
              .filter(Boolean).join('   ·   '),
            pills: [{ label: 'FO', value: x.fo }],
            update: { label: 'WHY', text: why.join('. ') || 'Behind its expected trajectory.', missing: false },
            tone: x.status === 'overdue' ? 'alert' : 'warn',
          };
        });
        const RH = 1.28;
        paginateRows(rows, 1.95, RH).forEach((page, pi) => {
          const s = pptx.addSlide();
          slideHeader(s, pi ? 'Objectives behind\nschedule (cont.)' : 'Objectives behind\nschedule to follow up',
            plural(watch.length, 'objective'), 'Watchlist');
          entryList(s, { rows: page, y: 1.95, rowH: RH });
          differerPied(s);
        });
      }
    }

    /* 8. Frise des jalons. */
    if (A.milestones.length) {
      const s = pptx.addSlide();
      const ms = A.msStats;
      slideHeader(s, 'Milestones across\nthe session timeline',
        `${ms.done + ms.late}/${ms.total} delivered`, 'Milestones');
      const dated = A.milestones.filter(m => m.due != null);
      let t0 = A.sStart, t1 = A.sEnd;
      if (!A.hasWindow) {
        const ds = dated.map(m => m.due).concat([A.today]);
        t0 = Math.min(...ds); t1 = Math.max(...ds);
      }
      if (t1 <= t0) t1 = t0 + 30 * DAY;
      const ax = M + 0.3, aw = CW - 0.6, ay = 4.0;
      const X = t => ax + clamp((t - t0) / (t1 - t0), 0, 1) * aw;

      s.addShape('rect', { x: ax, y: ay, w: aw, h: 0.03, fill: { color: 'C9CDD2' }, line: { type: 'none' } });
      // Graduations mensuelles.
      const d0 = new Date(t0);
      for (let k = 0; k < 24; k++) {
        const t = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + k, 1);
        if (t > t1) break;
        if (t < t0) continue;
        s.addShape('rect', { x: X(t) - 0.004, y: ay - 0.05, w: 0.008, h: 0.13,
          fill: { color: 'C9CDD2' }, line: { type: 'none' } });
        s.addText(new Date(t).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }), {
          x: X(t) - 0.4, y: ay + 0.1, w: 0.8, h: 0.2, fontSize: 8.5, color: C.mute,
          align: 'center', valign: 'middle', fontFace: FONT,
        });
      }
      s.addText(fmtDay(t0), { x: ax - 0.3, y: ay + 0.32, w: 1.6, h: 0.2, fontSize: 8, color: C.faint, fontFace: FONT });
      s.addText(fmtDay(t1), { x: ax + aw - 1.3, y: ay + 0.32, w: 1.6, h: 0.2, fontSize: 8, color: C.faint,
        align: 'right', fontFace: FONT });
      // Aujourd'hui.
      if (A.today >= t0 && A.today <= t1) {
        s.addShape('rect', { x: X(A.today) - 0.008, y: 2.1, w: 0.016, h: ay - 2.1 + 0.1,
          fill: { color: C.brand }, line: { type: 'none' } });
        s.addText('Today', { x: X(A.today) - 0.5, y: 1.88, w: 1.0, h: 0.2, fontSize: 8.5, bold: true,
          color: C.brand, align: 'center', fontFace: FONT });
      }
      // Jalons en couloirs, pour limiter les chevauchements.
      const DOT = 0.17, LANES = 6;
      const lanes = new Array(LANES).fill(-Infinity);
      dated.slice().sort((a, b) => a.due - b.due).forEach(m => {
        const x = X(m.due);
        let lane = lanes.findIndex(l => x - l >= DOT + 0.04);
        if (lane < 0) lane = lanes.indexOf(Math.min(...lanes));
        lanes[lane] = x;
        const y = ay - 0.32 - lane * 0.27;
        s.addShape('rect', { x: x - 0.003, y: y + DOT / 2, w: 0.006, h: ay - y - DOT / 2,
          fill: { color: 'E4E7EA' }, line: { type: 'none' } });
        s.addShape('ellipse', { x: x - DOT / 2, y, w: DOT, h: DOT,
          fill: { color: MS_ST[m.status].color }, line: { color: 'FFFFFF', width: 0.75 } });
      });
      // Légende chiffrée.
      const leg = ['done', 'late', 'overdue', 'upcoming', 'undated']
        .map(k => ({ k, v: ms[k] })).filter(r => r.v > 0);
      const lstep = CW / Math.max(leg.length, 1);
      leg.forEach((r, i) => {
        const lx = M + i * lstep;
        s.addShape('ellipse', { x: lx, y: 4.72, w: 0.14, h: 0.14,
          fill: { color: MS_ST[r.k].color }, line: { type: 'none' } });
        s.addText([{ text: String(r.v), options: { bold: true, color: C.ink } },
                   { text: `  ${MS_ST[r.k].label}`, options: { color: C.mute } }],
          { x: lx + 0.22, y: 4.66, w: lstep - 0.3, h: 0.26, fontSize: 9.5, fontFace: FONT, valign: 'middle' });
      });
      s.addShape('rect', { x: M, y: 5.06, w: CW, h: 0.008, fill: { color: C.line }, line: { type: 'none' } });

      // Deux listes : ce qui a glissé, ce qui arrive.
      const colW = (CW - 0.4) / 2;
      const overdue = A.milestones.filter(m => m.status === 'overdue').sort((a, b) => a.due - b.due);
      const soon = A.milestones.filter(m => m.status === 'upcoming' && m.due != null && m.due - A.today <= 30 * DAY)
        .sort((a, b) => a.due - b.due);
      [[`Past due and still open (${overdue.length})`, overdue, C.red, 'No milestone past due.'],
       [`Coming up in the next 30 days (${soon.length})`, soon, C.blue, 'Nothing due in the next 30 days.']]
        .forEach(([title, list, col, empty], ci) => {
          const x = M + ci * (colW + 0.4);
          blockTitle(s, title, x, 5.14, colW);
          if (!list.length) {
            s.addText(empty, { x, y: 5.42, w: colW, h: 0.28, fontSize: 9.5, italic: true,
              color: C.faint, fontFace: FONT, valign: 'middle' });
            return;
          }
          const MAX = 3;
          list.slice(0, MAX).forEach((m, i) => {
            const y = 5.42 + i * 0.3;
            s.addShape('rect', { x, y: y + 0.08, w: 0.032, h: 0.16, fill: { color: col }, line: { type: 'none' } });
            const t = `${m.label}  ·  ${m.fo}`;
            s.addText([
              { text: `${fmtShort(m.due)}   `, options: { bold: true, color: col } },
              { text: clip(t), options: { color: C.ink } },
            ], { x: x + 0.14, y, w: colW - 0.14, h: 0.3, fontSize: fitPt(t, 60, 9.5), fontFace: FONT, valign: 'middle' });
          });
          if (list.length > MAX) {
            s.addText(`+ ${list.length - MAX} more`, { x: x + colW - 1.2, y: 5.14, w: 1.2, h: 0.24,
              fontSize: 8.5, color: C.faint, align: 'right', fontFace: FONT, valign: 'middle' });
          }
        });
      differerPied(s);
    }

    /* 9. Jalons marquants — avec emplacements d'image. Au plus deux
       slides de trois cartes : c'est une vitrine, pas un inventaire. */
    {
      const delivered = A.milestones.filter(m => m.status === 'done' || m.status === 'late')
        // Les jalons qui portent déjà une image passent en tête, puis les
        // plus récents.
        .sort((a, b) => (!!b.image - !!a.image)
          || ((b.doneAt ?? b.due ?? 0) - (a.doneAt ?? a.due ?? 0)));
      if (delivered.length) {
        const pages = chunk(delivered.slice(0, 6), 3);
        pages.forEach((cards, pi) => {
          const s = pptx.addSlide();
          slideHeader(s, pi ? 'Milestones delivered\n(cont.)' : 'Milestones delivered\nworth showing',
            `${delivered.length} delivered`, 'Highlights');
          const gap = 0.26, cw = (CW - gap * 2) / 3;
          cards.forEach((m, i) => {
            const x = M + i * (cw + gap), y = 1.95;
            imageFrame(s, { x, y, w: cw, h: 2.45, image: m.image });
            s.addText(clip(m.fo), { x, y: y + 2.62, w: cw, h: 0.24, fontSize: 9.5, bold: true,
              color: C.brand, fontFace: FONT, valign: 'middle' });
            s.addText(m.label, { x, y: y + 2.88, w: cw, h: 0.62, fontSize: fitPt(m.label, 70, 14), bold: true,
              color: C.ink, fontFace: FONT, valign: 'top', lineSpacingMultiple: 1.05 });
            const ot = `Objective: ${clip(m.obj.title)}`;
            s.addText(ot, { x, y: y + 3.52, w: cw, h: 0.44, fontSize: fitPt(ot, 90, 9.5),
              color: C.mute, fontFace: FONT, valign: 'top' });
            const onTime = m.status === 'done';
            s.addShape('roundRect', { x, y: y + 4.06, w: 1.5, h: 0.28, rectRadius: 0.14,
              fill: { color: onTime ? C.greenSoft : C.amberSoft }, line: { type: 'none' } });
            s.addText(onTime ? 'Completed' : 'Completed late', { x, y: y + 4.06, w: 1.5, h: 0.28,
              fontSize: 8.5, bold: true, color: onTime ? '0B5C28' : '7A5200', align: 'center',
              valign: 'middle', fontFace: FONT });
            s.addText(m.doneAt != null ? `Completed ${fmtDay(m.doneAt)}` : `Due ${fmtDay(m.due)}`, {
              x: x + 1.6, y: y + 4.06, w: cw - 1.6, h: 0.28, fontSize: 9, color: C.faint,
              fontFace: FONT, valign: 'middle' });
          });
          differerPied(s);
        });
      }
    }

    /* 10. Qualité SMART. */
    if (A.scored.length) {
      const s = pptx.addSlide();
      slideHeader(s, 'How well the objectives\nare written (SMART)', `${A.scored.length} scored`, 'Quality');
      const lw = 3.7;
      const good = A.smartAvg >= SMART_PASS;
      metricCard(s, {
        x: M, y: 1.86, w: lw, h: 4.52,
        kicker: `${A.smartPass} of ${A.scored.length} objectives pass the ${SMART_PASS}/100 bar with a KPI and a due date.`,
        value: String(A.smartAvg), label: 'Average SMART score',
        note: 'Indicative, automated check of wording, KPIs, targets, justification and dates.',
        fill: good ? C.greenSoft : C.amberSoft, on: good ? '0B5C28' : '7A5200', onMute: good ? '0B5C28' : '7A5200',
      });
      const rx = M + lw + 0.26, rw = CW - lw - 0.26;
      panel(s, { x: rx, y: 1.86, w: rw, h: 4.52, title: 'Average score by criterion', note: 'Each criterion is scored out of 20' });
      const bx = rx + 0.32, labW = 1.5, trW = rw - 0.64 - labW - 0.7;
      A.axes.forEach((a, i) => {
        const y = panel.contentY(1.86, true) + i * 0.34;
        const v = a.value ?? 0;
        const col = v >= 16 ? C.green : v >= 12 ? C.amber : C.red;
        s.addText(a.label, { x: bx, y, w: labW, h: 0.3, fontSize: 9.5, color: C.mute, fontFace: FONT, valign: 'middle' });
        s.addShape('rect', { x: bx + labW, y: y + 0.09, w: trW, h: 0.12, fill: { color: 'E4E7EA' }, line: { type: 'none' } });
        if (v > 0) {
          s.addShape('rect', { x: bx + labW, y: y + 0.09, w: trW * v / 20, h: 0.12, fill: { color: col }, line: { type: 'none' } });
        }
        s.addText(a.value == null ? 'n/a' : `${a.value}`, { x: bx + labW + trW + 0.1, y, w: 0.6, h: 0.3,
          fontSize: 9.5, bold: true, color: C.ink, fontFace: FONT, valign: 'middle' });
      });
      const iy = panel.contentY(1.86, true) + 5 * 0.34 + 0.2;
      s.addShape('rect', { x: bx, y: iy - 0.08, w: rw - 0.64, h: 0.008, fill: { color: C.line }, line: { type: 'none' } });
      blockTitle(s, 'Most frequent gaps', bx, iy, rw - 0.64);
      if (!A.topIssues.length) {
        s.addText('No gap detected: every objective meets all five criteria.', {
          x: bx, y: iy + 0.3, w: rw - 0.64, h: 0.3, fontSize: 9.5, italic: true, color: C.faint, fontFace: FONT });
      } else {
        A.topIssues.forEach(([t, c], i) => {
          const y = iy + 0.3 + i * 0.36;
          s.addText([
            { text: `${c}×   `, options: { bold: true, color: C.brand } },
            { text: clip(t), options: { color: C.ink } },
          ], { x: bx, y, w: rw - 0.64, h: 0.34, fontSize: fitPt(t, 100, 9.5), fontFace: FONT, valign: 'middle' });
        });
      }
      differerPied(s);
    }

    /* 11. Intercalaire, puis une section par agent. */
    {
      const s = pptx.addSlide();
      statement(s, {
        bg: C.brand, on: 'FFFFFF', onMute: 'F0AFB8', rule: 'E8737F',
        eyebrow: 'Agent review',
        lead: 'One page per agent: each objective with its progress against the time elapsed, '
            + 'its milestones and their status, and the KPIs it will be judged on.',
        title: 'Agent by\nagent',
        sub: `${plural(A.agents.length, 'agent')} · ${plural(total, 'objective')} · ${sessName}`,
      });
      differerPied(s, { on: 'FFFFFF', mute: 'F0AFB8' });
    }

    const BLOCK = 1.42, BTOP = 2.2;
    const perPage = Math.max(1, Math.floor((FLOOR - BTOP + 0.1) / BLOCK));
    A.agents.slice().sort((a, b) => a.fo.localeCompare(b.fo)).forEach(ag => {
      const list = ag.objs.slice().sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status]
        || (a.due ?? Infinity) - (b.due ?? Infinity));
      const pages = chunk(list, perPage);
      pages.forEach((objs, pi) => {
        const s = pptx.addSlide();
        slideHeader(s, pi ? `${clip(ag.fo)} (cont.)` : clip(ag.fo),
          `${plural(ag.objs.length, 'objective')}`, 'Agent review');
        // Bandeau de synthèse de l'agent.
        const bits = [
          [`${ag.live.length}`, ' in force'],
          [`${ag.done}`, ' completed'],
          [ag.avgPct == null ? 'n/a' : `${ag.avgPct}%`,
           ag.avgExpected != null ? ` avg progress (expected ${ag.avgExpected}%)` : ' avg progress'],
          [`${ag.msDone}/${ag.msTotal}`, ' milestones delivered'],
          [`${ag.lateMs}`, ' late milestones'],
          [ag.smart == null ? 'n/a' : `${ag.smart}`, ' avg SMART'],
        ];
        s.addText(bits.flatMap(([v, l], i) => [
          ...(i ? [{ text: '    ·    ', options: { color: C.line } }] : []),
          { text: v, options: { bold: true, color: (l === ' late milestones' && ag.lateMs) ? C.red : C.ink } },
          { text: l, options: { color: C.mute } },
        ]), { x: M, y: 1.6, w: CW, h: 0.32, fontSize: 10, fontFace: FONT, valign: 'middle' });
        s.addShape('rect', { x: M, y: 2.0, w: CW, h: 0.01, fill: { color: C.line }, line: { type: 'none' } });

        objs.forEach((x, i) => {
          const y = BTOP + i * BLOCK;
          const st = ST[x.status];
          s.addShape('rect', { x: M, y: y + 0.04, w: 0.05, h: BLOCK - 0.3,
            fill: { color: st.color }, line: { type: 'none' } });
          // Ligne 1 : intitulé, échéance, statut.
          s.addText(x.title, { x: M + 0.24, y, w: CW - 4.7, h: 0.32,
            fontSize: fitPt(x.title, 80, 12.5), bold: true, color: C.ink, fontFace: FONT, valign: 'middle' });
          const dueTxt = x.late.overdue && x.approved
            ? `Due ${fmtDay(x.due)} · ${x.late.days_over || 0} d over` : `Due ${fmtDay(x.due)}`;
          s.addText(dueTxt, { x: M + CW - 4.35, y, w: 2.8, h: 0.32, fontSize: 9.5,
            bold: !!(x.late.overdue && x.approved), color: x.late.overdue && x.approved ? C.red : C.mute,
            align: 'right', fontFace: FONT, valign: 'middle' });
          statusPill(s, { x: M + CW - 1.42, y: y + 0.01, status: x.status });

          // Ligne 2 : barre d'avancement + KPIs.
          if (x.approved) {
            // Terminé ou abandonné : le repère « attendu » n'a plus de sens.
            const closedObj = x.status === 'done' || x.o.progress === 'dropped';
            progressBar(s, { x: M + 0.24, y: y + 0.48, w: 3.4, h: 0.12,
              pct: x.pct, expected: closedObj ? null : x.expected, color: pctTone(x.pct).bar });
            s.addText([
              { text: `${x.pct}%`, options: { bold: true, color: pctTone(x.pct).txt } },
              { text: closedObj ? `  ${x.status === 'done' ? 'completed' : 'not finished'}`
                  : x.expected != null ? `  vs ${x.expected}% expected` : '', options: { color: C.faint } },
            ], { x: M + 3.74, y: y + 0.38, w: 2.0, h: 0.3, fontSize: 9.5, fontFace: FONT, valign: 'middle' });
          } else {
            s.addText('Not in force yet: progress is tracked once approved.', {
              x: M + 0.24, y: y + 0.38, w: 5.4, h: 0.3, fontSize: 9.5, italic: true,
              color: C.faint, fontFace: FONT, valign: 'middle' });
          }
          const kpiTxt = x.kpis.length
            ? x.kpis.map(k => `${clip(k.name) || 'KPI'}: ${orNA(k.target)}${k.unit ? ' ' + clip(k.unit) : ''}`
                + (k.source ? ` (${clip(k.source)})` : '')).join('  ·  ')
            : 'No KPI defined';
          s.addText([
            { text: 'KPI   ', options: { bold: true, fontSize: 8, color: C.faint } },
            { text: kpiTxt, options: { color: x.kpis.length ? C.ink : C.faint, italic: !x.kpis.length } },
          ], { x: M + 5.85, y: y + 0.38, w: CW - 5.85, h: 0.3,
            fontSize: fitPt(kpiTxt, 80, 9.5), fontFace: FONT, valign: 'middle' });

          // Ligne 3 : jalons en pastilles.
          const ms = x.milestones.length ? x.milestones
            : (x.o.steps || []).map(st2 => ({ label: clip(st2.label) || 'Untitled milestone',
                due: parseDay(st2.due), status: 'undated', pending: true }));
          let cx = M + 0.24;
          const cy = y + 0.76, limit = M + CW;
          if (!ms.length) {
            s.addText('No milestone defined', { x: cx, y: cy, w: 4, h: 0.28, fontSize: 9, italic: true,
              color: C.faint, fontFace: FONT, valign: 'middle' });
          }
          for (let k = 0; k < ms.length; k++) {
            const m = ms[k];
            const txt = `${m.label}${m.due != null ? ' · ' + fmtShort(m.due) : ''}`;
            const w = Math.min(3.4, Math.max(1.25, 0.44 + clip(txt).length * 0.068));
            const restW = 0.9;
            if (cx + w > limit - (k < ms.length - 1 ? restW : 0)) {
              s.addText(`+ ${ms.length - k} more`, { x: cx, y: cy, w: restW, h: 0.28, fontSize: 8.5,
                color: C.faint, fontFace: FONT, valign: 'middle' });
              break;
            }
            const col = m.pending ? 'C9CDD2' : MS_ST[m.status].color;
            s.addShape('roundRect', { x: cx, y: cy, w, h: 0.28, rectRadius: 0.14,
              fill: { color: C.bgSoft }, line: { type: 'none' } });
            s.addShape('ellipse', { x: cx + 0.1, y: cy + 0.09, w: 0.1, h: 0.1,
              fill: { color: col }, line: { type: 'none' } });
            s.addText(clip(txt), { x: cx + 0.24, y: cy, w: w - 0.28, h: 0.28,
              fontSize: fitPt(txt, 44, 8.5), color: m.status === 'overdue' ? '8C1D16' : C.ink,
              fontFace: FONT, valign: 'middle' });
            cx += w + 0.1;
          }

          // Ligne 4 : la justification.
          const why = clip(x.o.why);
          s.addText([
            { text: 'WHY   ', options: { bold: true, fontSize: 8, color: C.faint } },
            { text: why || 'No justification given.', options: { italic: true, color: why ? C.mute : C.faint } },
          ], { x: M + 0.24, y: y + 1.06, w: CW - 0.24, h: 0.26,
            fontSize: fitPt(why, 150, 9), fontFace: FONT, valign: 'middle' });
          if (i < objs.length - 1) {
            s.addShape('rect', { x: M, y: y + BLOCK - 0.1, w: CW, h: 0.008,
              fill: { color: C.line }, line: { type: 'none' } });
          }
        });
        // Légende des jalons, discrète, sur la dernière ligne utile.
        if (pi === 0) {
          const items = ['done', 'late', 'overdue', 'upcoming'];
          items.forEach((k, j) => {
            const lx = M + CW - 4.8 + j * 1.2;
            s.addShape('ellipse', { x: lx, y: 6.66, w: 0.09, h: 0.09, fill: { color: MS_ST[k].color }, line: { type: 'none' } });
            s.addText(MS_ST[k].label, { x: lx + 0.13, y: 6.6, w: 1.05, h: 0.2, fontSize: 7.5,
              color: C.faint, fontFace: FONT, valign: 'middle' });
          });
        }
        differerPied(s);
      });
    });
  }

  /* 12. Actions recommandées — déduites des données. */
  {
    const rows = [];
    A.inForce.filter(x => x.status === 'overdue')
      .sort((a, b) => (b.late.days_over || 0) - (a.late.days_over || 0)).slice(0, 3)
      .forEach(x => rows.push({ tone: 'alert', owner: x.fo, status: 'Overdue',
        text: `Agree a recovery date for "${x.title}", ${plural(x.late.days_over || 0, 'day')} past due.` }));
    A.inForce.filter(x => x.status === 'track' && x.o.progress !== 'dropped'
        && ((x.gap != null && x.gap <= -RISK_GAP) || (x.late.late_steps || 0) > 0))
      .sort((a, b) => (a.gap ?? 0) - (b.gap ?? 0)).slice(0, 3)
      .forEach(x => rows.push({ tone: 'warn', owner: x.fo, status: 'Not finished',
        text: x.gap != null && x.gap <= -RISK_GAP
          ? `Review the plan for "${x.title}": ${x.pct}% delivered against ${x.expected}% expected.`
          : `Unblock the late milestone(s) on "${x.title}".` }));
    if (A.byStatus.submitted) {
      rows.push({ tone: 'warn', owner: 'Admin', status: 'Pending',
        text: `Decide on ${plural(A.byStatus.submitted, 'objective')} awaiting approval so they start counting.` });
    }
    if (A.byStatus.rejected) {
      const who = [...new Set(A.objs.filter(x => x.status === 'rejected').map(x => x.fo))];
      rows.push({ tone: 'info', owner: who.length === 1 ? who[0] : `${who.length} agents`, status: 'Rework',
        text: `Rework and resubmit ${plural(A.byStatus.rejected, 'rejected objective')}.` });
    }
    const weak = A.scored.filter(x => !x.smart.pass && x.status !== 'lapsed' && x.o.progress !== 'dropped');
    if (weak.length) {
      const wk = A.axes.filter(a => a.value != null).sort((a, b) => a.value - b.value)[0];
      rows.push({ tone: 'info', owner: 'Agents', status: 'Quality',
        text: `Strengthen ${plural(weak.length, 'objective')} scoring below ${SMART_PASS}/100 SMART`
          + (wk ? `, starting with the ${wk.label.toLowerCase()} criterion.` : '.') });
    }
    const soon = A.milestones.filter(m => m.status === 'upcoming' && m.due != null && m.due - A.today <= 14 * DAY);
    if (soon.length) {
      const lastDue = Math.max(...soon.map(m => m.due));
      rows.push({ tone: 'info', owner: plural(new Set(soon.map(m => m.fo)).size, 'agent'),
        eta: fmtDay(lastDue),
        text: `Check in on ${plural(soon.length, 'milestone')} due in the next two weeks.` });
    }
    if (A.team.length && A.withoutLive.length && !A.closed) {
      const names = A.withoutLive.slice(0, 4).join(', ') + (A.withoutLive.length > 4 ? ` +${A.withoutLive.length - 4}` : '');
      rows.push({ tone: A.withoutLive.length > A.team.length / 2 ? 'warn' : 'info', owner: 'Admin', status: 'Coverage',
        text: `Get objectives approved for ${plural(A.withoutLive.length, 'agent')} with none in force: ${names}.` });
    }
    if (rows.length) {
      const pages = paginateRows(rows, 1.98, 0.92);
      pages.forEach((page, pi) => {
        const s = pptx.addSlide();
        slideHeader(s, pi ? 'What to act on\nnext (cont.)' : 'What to act on\nnext', sub, 'Recommended actions');
        const startAt = pages.slice(0, pi).reduce((a, p) => a + p.length, 0);
        planGrid(s, { rows: page, y: 1.98, startAt });
        differerPied(s);
      });
    }
  }

  /* 13. Remerciement. */
  {
    const s = pptx.addSlide();
    statement(s, {
      bg: C.brand, on: 'FFFFFF', onMute: 'F0AFB8', rule: 'E8737F',
      eyebrow: `Pearl · ${VILLE}`,
      lead: 'Thanks to every agent for the objectives set, the milestones delivered and the '
          + 'discipline of keeping them up to date. Every figure in this deck is traceable in '
          + 'the objectives module and its Excel export.',
      title: 'Thank you',
      sub: `${EQUIPE} · ${sessName}`,
    });
    differerPied(s, { on: 'FFFFFF', mute: 'F0AFB8' });
  }

  // Numérotation différée : un seul pied par slide, posé ici.
  const tot = pieds.length;
  pieds.forEach(({ slide, encre }, i) => {
    const num = i + 1;
    if (!encre) { slideFooter(slide, num, tot); return; }
    slide.addText(FOOTER_TEXT, {
      x: M, y: 7.0, w: 8, h: 0.24, fontSize: 8, color: encre.mute, fontFace: FONT, valign: 'middle',
    });
    slide.addText([
      { text: String(num), options: { bold: true, color: encre.on } },
      { text: ` / ${tot}`, options: { color: encre.mute } },
    ], { x: M + CW - 1.2, y: 7.0, w: 1.2, h: 0.24, fontSize: 8.5, align: 'right', valign: 'middle', fontFace: FONT });
  });

  return pptx.write({ outputType: 'nodebuffer' });
}

module.exports = { buildObjectivesPptx, analyseObjectives: analyse };
