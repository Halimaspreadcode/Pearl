/**
 * Génération du PPTX de rapport hebdomadaire.
 *
 * Le deck reprend les chiffres de /api/reports/weekly (il ne recalcule
 * rien) et y ajoute des faits marquants déduits des données (pics,
 * ruptures, blocages) que le tableau ne donne pas.
 *
 * Les sections rédigées par l'utilisateur (highlights, risques, actions)
 * arrivent depuis le client en POST : elles vivent dans son brouillon
 * local, le serveur ne les stocke pas.
 *
 * Parti pris visuel — mise en page éditoriale :
 *   · une gouttière unique (M) sur laquelle tout s'aligne ;
 *   · des titres larges ferrés à gauche, le blanc porte la hiérarchie ;
 *   · des aplats gris clair sans bordure ni ombre marquée ;
 *   · le rouge de marque en accent, jamais en fond de slide — sinon tout
 *     le deck se lit comme une alerte et le vrai signal disparaît.
 *
 * Les graphiques sont dessinés en formes (cf. la section dédiée) et non
 * via addChart : les graphiques natifs ne sont rendus que par PowerPoint
 * et laissent un cadre vide dans LibreOffice, Keynote ou Google Slides.
 */

const PptxGenJS = require('pptxgenjs');

// Palette : rouge de marque Huawei en accent, sur une structure Material
// (surfaces claires, neutres gris, ombres douces). Sans le '#' :
// PptxGenJS attend des hex nus.
//
// Deux rouges cohabitent volontairement :
//   · `brand` (#CF0A2C) porte l'identité — filets, eyebrow, accents info ;
//   · `red`   (#D93025) porte le signal d'alerte — SLA rompu, breach.
// Les confondre ferait lire toute slide de marque comme une alerte.
const C = {
  brand:     'CF0A2C',  // rouge Huawei, accent d'identité
  brandDark: '9E0821',
  brandSoft: 'FDE8EC',
  blue:      '1A73E8',  // conservé pour les séries de données neutres
  blueDark:  '174EA6',
  blueSoft:  'E8F0FE',
  red:       'D93025',  // réservé aux alertes
  redSoft:   'FCE8E6',
  green:    '1E8E3E',
  greenSoft:'E6F4EA',
  amber:    'F9AB00',
  amberSoft:'FEF7E0',
  purple:   '9334E6',
  teal:     '12B5CB',
  ink:      '111214',   // texte principal, presque noir : type éditoriale
  mute:     '5F6368',   // texte secondaire
  faint:    '8A9099',
  line:     'E4E7EA',   // filets fins, plus discrets que la bordure Material
  bg:       'FFFFFF',
  bgSoft:   'F5F6F7',   // surface neutre des panneaux
  wash:     'DDEAEE',   // teinte froide des slides d'ouverture de section
};

// Couleurs par priorité et par domaine : mêmes conventions que l'app,
// pour qu'un lecteur qui connaît le dashboard ne réapprenne rien.
const PRIO_C   = { P1: C.red, P2: C.amber, P3: C.blue, P4: C.faint };
// Sévérité : même échelle de lecture que la priorité, sur les valeurs du
// tracker (Critical / Major / Minor / Warning).
const SEV_C    = { critical: C.red, major: C.amber, minor: C.blue, warning: C.faint };
// Rang de tri : P1 avant P2, etc. Une priorité absente passe en dernier.
const PRIO_RANK = { P1: 0, P2: 1, P3: 2, P4: 3 };
// Séquence catégorielle : le rouge de marque ouvre la série (la catégorie
// dominante porte l'accent Huawei), puis des teintes distinctes en teinte
// et en clarté pour rester lisibles côte à côte et en niveaux de gris.
const DOMAIN_C = [C.brand, '1A73E8', '12B5CB', 'F9AB00', '1E8E3E', '9334E6'];

const FONT = 'Arial';           // présente partout, contrairement à Roboto

const fmtDur = ms => {
  if (ms == null || isNaN(ms)) return 'N/A';
  const h = ms / 3600000;
  if (h < 1)  return `${Math.round(ms / 60000)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} d`;
};

/* Cible MTTD : la détection doit tenir sous 5 minutes. C'est le seuil
   d'engagement du Front Office, et il ne dépend pas du SLA du ticket —
   d'où une constante ici plutôt qu'une lecture de `config.json`.

   `mttdTone()` renvoie le verdict lisible par les gabarits :
     · 'good'  — sous la cible, on surligne en vert ;
     · 'alert' — au-dessus, en rouge ;
     · null    — pas de mesure (aucun ticket horodaté sur la période),
                 auquel cas on ne colore rien : une absence de donnée
                 n'est ni une réussite ni un manquement. */
const MTTD_TARGET_MS = 5 * 60 * 1000;

// Hauteur de ligne de la slide « SLA breaches » : une ligne de plus que les
// autres listes (le point d'avancement du ticket), donc plus haute. Partagée
// entre la pagination et le rendu — les deux doivent lire la même valeur.
const BREACH_ROW_H = 1.28;

const mttdTone = ms =>
  (ms == null || isNaN(ms)) ? null : (ms <= MTTD_TARGET_MS ? 'good' : 'alert');

const fmtDate = d =>
  new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

// Le texte est rendu en entier, sans coupure. La fonction ne fait plus que
// normaliser les blancs : un rapport qui tronque à « ... » oblige à
// rouvrir l'outil pour lire la fin, ce qui lui retire son intérêt.
//
// Le second argument (l'ancienne longueur max) est conservé aux points
// d'appel : il sert désormais à dimensionner le corps du texte via
// autoFit(), pour que la ligne longue rétrécisse au lieu de déborder.
const clip = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

// Corps de texte réduit quand le contenu dépasse la longueur pour laquelle
// la boîte a été dessinée. On ne descend pas sous 60 % du corps nominal :
// en dessous, la ligne est illisible en projection, et c'est le signe qu'il
// faut donner plus de place au bloc, pas rapetisser encore.
const fitPt = (text, budget, pt) => {
  const len = String(text == null ? '' : text).trim().length;
  if (!len || !budget || len <= budget) return pt;
  return Math.max(pt * 0.6, Math.round(pt * Math.sqrt(budget / len) * 10) / 10);
};

// Une valeur absente s'écrit "n/a" et non un tiret : dans un tableau
// dense, un tiret se confond avec un signe moins ou une puce.
const orNA = v => {
  const t = String(v == null ? '' : v).trim();
  return t || 'n/a';
};

/* ── Semaine sans activité ────────────────────────────────────
   Un deck à « 0 / 0 / 0 » attire l'œil du management : il se lit comme
   une panne de l'outil, un oubli de saisie ou une équipe absente. Quand
   aucun ticket n'a été ouvert ni clôturé, on le dit en toutes lettres et
   on donne le contexte mesuré qui l'explique. Uniquement des faits tirés
   des données — aucune cause supposée.

   Renvoie null pour une semaine active, sinon :
   { title, lead, points: [texte], short } */
/* Observations de la semaine qui peuvent expliquer un creux d'activité.
   Pas toutes : seules celles qui touchent à ce qui fait remonter les
   incidents (supervision, outils, accès, alarmes), au calendrier
   (maintenance, gel, férié) ou à l'infrastructure. Chaque thème porte un
   poids ; une observation doit atteindre un seuil pour être retenue, et
   on en garde trois au plus, les plus parlantes d'abord.

   Le thème « visibility » compte double dans la lecture : si la
   supervision était dégradée, l'absence de ticket peut venir d'incidents
   non détectés — le rapport doit alors le dire au lieu d'affirmer que la
   semaine était calme. Mots-clés FR et EN, accents ignorés. */
const QUIET_RE = {
  // Ce qui fait remonter les incidents jusqu'au Front Office.
  monitoring: /supervi|monitor|nms|u2020|mmc|alarm|alerte|remont|collect|sonde|probe|dashboard|tableau de bord|visibilit|detect/,
  tooling:    /outil|tool|acces|access|vpn|login|connexion|credential|mot de passe|password|licen|certificat|certificate|serveur|server|script|plateforme|platform|portail|portal|tracker|messagerie|mail/,
  // Un problème réel sur ce sujet : sans lui, « deux alarmes en double »
  // ou « nouveau tableau de bord » n'expliquent en rien l'absence de ticket.
  problem:    /panne|inaccessib|injoignable|unreachable|pas d.acces|no access|impossible d|indisponib|unavailab|\bdown\b|outage|coupure|coupe|interrompu|interruption|instable|unstable|crash|bloqu|block|hors service|\bhs\b|degrad|relanc|restart|redemarr|perte|perdu|\blost\b|loss|manqu|missing|aucune? (alarme|remontee|alerte)|pas d.(alarme|remontee|alerte)|no (alarm|alert)|expire|echec|fail|lent|slow|retard|delay|sature/,
  calendar:   /maintenance|\bgel\b|freeze|change window|fenetre de|\bmop\b|migration|upgrade|mise a (jour|niveau)|ferie|holiday|tabaski|korite|magal|gamou|paques|noel|christmas|nouvel an|greve|strike|jour off|activite reduite|reduced activity/,
  // Impact écarté par l'auteur lui-même : l'observation n'explique rien.
  noImpact:   /sans (impact|incident|consequence)|no impact|without impact|bascule automatique ok|\bok\b\.?$/,
};
function quietObservations(data) {
  const fold = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const scored = (data.activity_context?.week_observations || []).map(o => {
    const txt = fold(o.observation);
    const has = k => QUIET_RE[k].test(txt);
    let score = 0, label = '', blind = false;
    if ((has('monitoring') || has('tooling')) && has('problem') && !has('noImpact')) {
      score = 4; blind = true;
      label = has('monitoring') ? 'monitoring / alarm visibility' : 'tooling or access issue';
    } else if (has('calendar')) {
      score = 3; label = 'maintenance or calendar';
    }
    if (score && String(o.priority).toUpperCase() === 'P1') score += 1;
    return { o, score, label, blind };
  }).filter(x => x.score >= 3)
    .sort((a, b) => b.score - a.score
      || new Date(b.o.date || b.o.created_at) - new Date(a.o.date || a.o.created_at));
  const items = scored.slice(0, 3);
  return { items, visibility: items.some(x => x.blind) };
}

function quietWeek(data) {
  const k = data.kpis || {};
  const opened = k.opened_this_week ?? 0;
  const closed = k.resolved_this_week ?? 0;
  if (opened || closed) return null;

  const ctx  = data.activity_context || {};
  const hist = (data.trend_history || []).slice(0, -1);   // semaines précédentes
  const actives = hist.filter(h => (h.opened || 0) + (h.closed || 0) > 0);
  const avg = hist.length ? hist.reduce((a, h) => a + (h.opened || 0), 0) / hist.length : 0;
  const ws  = new Date(data.week_start).getTime();
  const daysBefore = d => Math.max(1, Math.round((ws - new Date(d).getTime()) / 86400000));
  const backlog = k.overall_open ?? 0;
  const points = [];

  // 1. Mesuré, pas manquant : l'outil contient bien des tickets.
  points.push((k.overall_total ?? 0) > 0
    ? `The figures are measured, not missing: the tracker holds ${k.overall_total} ticket(s) in total, none of them opened or closed during this week.`
    : 'The tracker holds no ticket yet for this scope, so every figure in this report is zero by construction.');

  // 2. Dernière activité et rythme habituel.
  if (ctx.last_opened_before) {
    points.push(`The last ticket was opened on ${fmtDate(ctx.last_opened_before)}, `
      + `${daysBefore(ctx.last_opened_before)} day(s) before this week started.`);
    if (hist.length) {
      points.push(`Usual pace: ${avg.toFixed(1).replace(/\.0$/, '')} new ticket(s) per week on average `
        + `over the previous ${hist.length} weeks, with activity in ${actives.length} of them.`);
    }
  } else if (hist.length) {
    points.push(`No ticket activity either over the previous ${hist.length} weeks.`);
  }

  // 3. Encours : rien n'a bougé, mais ce qui reste ouvert reste suivi.
  points.push(backlog
    ? `${backlog} ticket(s) opened in earlier weeks remain open and are still followed up; none of them was closed this week.`
    : 'No ticket is waiting in the queue: the backlog is clear.');

  // 4. Calendrier et présence : la semaine était-elle ouvrée, l'équipe en poste ?
  if ((ctx.holidays || []).length) {
    points.push(`The week included ${ctx.holidays.length} public holiday(s) (${ctx.holidays.map(fmtDate).join(', ')}).`);
  }
  if (ctx.shifts_covered) {
    points.push(`The Front Office was staffed as planned: ${ctx.shifts_covered} shift(s) covered by ${ctx.agents_on_shift} agent(s). No incident reached the team during those shifts.`);
  }

  // 5. Travail hors tickets, pour ne pas laisser croire à une semaine vide.
  const done = (data.weekly_progress || []).filter(p => String(p.status || '').toLowerCase() === 'done').length;
  const obs  = (data.observations_open || []).length;
  if (done || obs) {
    points.push(`Activity outside the ticket queue: ${[done ? `${done} item(s) completed in Weekly Progress` : '',
      obs ? `${obs} open observation(s) tracked` : ''].filter(Boolean).join(', ')}.`);
  }

  // Observations qui peuvent expliquer le creux : placées en tête des
  // constats, ce sont les plus utiles au lecteur.
  const qo = quietObservations(data);
  const obsPoints = qo.items.map(({ o, label }) =>
    `Observation logged on ${fmtDate(o.date || o.created_at)}${o.author ? ` by ${o.author}` : ''} `
    + `(${label}${o.status === 'Closed' ? ', since closed' : ''}): "${String(o.observation).trim().replace(/\s+/g, ' ')}"`);
  points.unshift(...obsPoints);

  return {
    title: 'Quiet week: no ticket activity',
    // Supervision ou outillage dégradés : on ne peut pas affirmer que la
    // semaine était calme, seulement que rien n'a été remonté.
    lead: qo.visibility
      ? 'No ticket was opened or closed on this scope during the week. Observations logged by the team '
        + 'point to a monitoring or tooling issue, so incidents may have gone undetected: '
        + 'this should be ruled out before reading the week as calm.'
      : 'No ticket was opened or closed on this scope during the week. '
        + 'This reflects the absence of incidents raised to the Front Office, not missing data.'
        + (qo.items.length ? ' Observations logged this week give context below.' : ''),
    visibility_risk: qo.visibility,
    short: 'Quiet week: no ticket opened or closed, the zeros below are measured, not missing.',
    points,
  };
}

/* ── Faits marquants déduits ──────────────────────────────────
   Les lignes saisies par l'utilisateur disent ce qu'il a observé ;
   celles-ci disent ce que les données montrent. Chaque fait porte un
   ton (good / warn / alert / info) qui pilote sa couleur. */
function deriveHighlights(data) {
  const k    = data.kpis || {};
  const out  = [];
  const week = data.week_tickets  || [];
  const act  = data.active_tickets || [];

  // Volume : ouverts contre clôturés. C'est la première question posée
  // en revue : est-ce qu'on absorbe le flux ?
  const opened   = k.opened_this_week   || 0;
  const resolved = k.resolved_this_week || 0;
  if (opened || resolved) {
    const delta = resolved - opened;
    out.push({
      tone: delta >= 0 ? 'good' : (opened - resolved > 5 ? 'alert' : 'warn'),
      text: delta >= 0
        ? `Intake absorbed: ${resolved} ticket(s) closed against ${opened} opened, a net +${delta}.`
        : `Backlog building: ${opened} ticket(s) opened against ${resolved} closed, a net ${delta}.`,
    });
  }

  if (k.sla_compliance != null) {
    out.push({
      tone: k.sla_compliance >= 95 ? 'good' : k.sla_compliance >= 85 ? 'warn' : 'alert',
      text: `SLA compliance for the week: ${k.sla_compliance}%`
          + (k.breach ? `, with ${k.breach} breach(es) among tickets opened this week.` : '.'),
    });
  }

  // Ruptures encore ouvertes : le stock, pas le flux. C'est ce qui
  // reste à traiter lundi matin.
  const openBreach = act.filter(t => t.sla_status === 'Breach');
  if (openBreach.length) {
    out.push({
      tone: 'alert',
      text: `${openBreach.length} breached ticket(s) still open, of which `
          + `${openBreach.filter(t => ['P1', 'P2'].includes(t.priority)).length} are P1 or P2.`,
    });
  }

  const highs = week.filter(t => ['P1', 'P2'].includes(t.priority));
  if (highs.length) {
    const p1 = highs.filter(t => t.priority === 'P1').length;
    out.push({
      tone: highs.length > 5 ? 'warn' : 'info',
      text: `${highs.length} P1/P2 ticket(s) opened during the week`
          + (p1 ? `, including ${p1} at P1.` : '.'),
    });
  }

  // Domaine dominant : dit où l'effort s'est concentré.
  const dom = Object.entries(data.by_domain || {}).sort((a, b) => b[1] - a[1])[0];
  if (dom && opened) {
    out.push({
      tone: 'info',
      text: `Most affected domain: ${dom[0]} with ${dom[1]} ticket(s), `
          + `i.e. ${Math.round((dom[1] / opened) * 100)}% of the week's volume.`,
    });
  }

  // Tickets anciens toujours ouverts : signal d'enlisement, invisible
  // dans un simple décompte de volume.
  const now = Date.now();
  const stale = act.filter(t =>
    t.open_date && (now - new Date(t.open_date).getTime()) > 7 * 86400000);
  if (stale.length) {
    out.push({
      tone: stale.length > 3 ? 'warn' : 'info',
      text: `${stale.length} ticket(s) open for more than 7 days and awaiting a decision.`,
    });
  }

  if (k.mttr_ms) {
    out.push({ tone: 'info', text: `Mean time to resolution: ${fmtDur(k.mttr_ms)}.` });
  }
  return out;
}

/* ── Primitives de mise en page ─────────────────────────────── */

// PIÈGE PptxGenJS : une forme sans `line`, ou avec `line: { width: 0 }`,
// reçoit un contour gris foncé de 1pt par défaut. C'est ce qui cerclait
// chaque barre d'un liseré noir. La seule façon de ne rien dessiner est
// `line: { type: 'none' }` — à conserver sur toutes les formes du deck.

// Ombre quasi imperceptible. Le style éditorial repose sur les filets et
// les aplats, pas sur la profondeur : une ombre marquée daterait le deck.
const SHADOW = { type: 'outer', color: '000000', opacity: 0.05,
                 blur: 5, offset: 1, angle: 90 };

// Marges : une seule gouttière gauche/droite pour tout le deck. Les
// titres, les filets et les colonnes s'alignent tous dessus.
const M     = 0.72;              // marge latérale
const CW    = 13.333 - M * 2;    // largeur utile = 11.893
// Plancher du contenu. Le filet de pied est à 6.90 ; on garde une
// respiration au-dessus pour que rien ne vienne s'y coller. Toute liste
// paginée doit tenir au-dessus de cette ligne.
const FLOOR = 6.55;

// En-tête éditorial : eyebrow discret, titre large ferré à gauche sur
// deux lignes possibles, période à droite. Pas de filet d'accent — le
// blanc et l'échelle typographique portent la hiérarchie.
function slideHeader(slide, title, sub, eyebrow) {
  if (eyebrow) {
    slide.addText(String(eyebrow), {
      x: M, y: 0.44, w: 7.5, h: 0.2,
      fontSize: 9, color: C.mute, charSpacing: 0.6, fontFace: FONT,
    });
  }
  // 26pt sur deux lignes : c'est l'échelle de la référence, un titre qui
  // occupe l'espace au lieu de se tasser dans un bandeau.
  slide.addText(title, {
    x: M - 0.03, y: eyebrow ? 0.68 : 0.5, w: 9.0, h: 0.82,
    fontSize: 26, bold: true, color: C.ink, fontFace: FONT,
    valign: 'top', lineSpacingMultiple: 1.06,
  });
  if (sub) {
    slide.addText(sub, {
      x: 9.9, y: eyebrow ? 0.46 : 0.52, w: CW - 9.18, h: 0.24,
      fontSize: 9.5, color: C.faint, align: 'right', valign: 'middle', fontFace: FONT,
    });
  }
}

// Pied de page : mention à gauche, numéro de page à droite. Le numéro est
// composé "n / total" en deux graisses — le rang en gras, le total en
// gris — pour se repérer dans le deck sans que le chiffre crie.
function slideFooter(slide, n, total, ville) {
  slide.addShape('rect', {
    x: M, y: 6.9, w: CW, h: 0.01, fill: { color: C.line }, line: { type: 'none' },
  });
  slide.addText(`EMOC · Front Office · ${ville || VILLE} · Internal distribution`, {
    x: M, y: 7.0, w: 8, h: 0.24,
    fontSize: 8, color: C.faint, fontFace: FONT, valign: 'middle',
  });
  slide.addText(
    total
      ? [{ text: String(n), options: { bold: true, color: C.ink } },
         { text: ` / ${total}`, options: { color: C.faint } }]
      : [{ text: String(n), options: { bold: true, color: C.ink } }],
    {
      x: M + CW - 1.2, y: 7.0, w: 1.2, h: 0.24,
      fontSize: 8.5, align: 'right', valign: 'middle', fontFace: FONT,
    });
}

/* ── Modèles de slide réutilisables ───────────────────────────
   Trois gabarits pour les pages de contenu rédigé, chacun appliqué à
   plusieurs slides pour que le deck n'invente pas une mise en page par
   page :

     · entryList()  — SLA breaches · Risks & Issues · Observations.
       Même problème dans les trois cas : une liste d'éléments qui portent
       chacun un intitulé, un porteur et une criticité. Le tableau dense
       est remplacé par des lignes aérées à liseré de priorité.

     · planGrid()   — Next week actions.
       Des engagements numérotés : la numérotation est l'information, elle
       passe donc en gros corps devant chaque ligne.

     · statement()  — Manager commentary · Thank you.
       Une page de texte, sans donnée. Aplat plein, titre surdimensionné.
*/

// Liste d'entrées. `rows` : [{ tag, title, meta, tone, pills }].
// `pills` : bulles de porteurs ferrées à droite (FO, BO).
// `tone` pilote le liseré : alert (rouge), warn (ambre), info (marque).
//
// Nombre de lignes qui tiennent au-dessus de FLOOR pour une hauteur de
// ligne donnée. Sert à découper une liste en slides plutôt qu'à en jeter
// la fin : le deck ne masque plus rien.
function rowsPerSlide(top, h) {
  return Math.max(1, Math.floor((FLOOR - top) / h));
}

// Découpe `rows` en autant de pages que nécessaire. Le reliquat n'est plus
// résumé par « + N more » : il part sur une slide de continuation, qui
// reprend le même en-tête suffixé « (cont.) ».
function paginateRows(rows, top, h) {
  const per = rowsPerSlide(top, h);
  const out = [];
  for (let i = 0; i < rows.length; i += per) out.push(rows.slice(i, i + per));
  return out.length ? out : [[]];
}

// La fonction décide elle-même combien de lignes tiennent au-dessus de
// FLOOR et compose la mention de reliquat. L'appelant passait auparavant un
// `slice()` deviné à la main, et six lignes débordaient sur le pied de page.
function entryList(slide, { rows, y, rowH, note }) {
  const top = y ?? 1.95;
  const h   = rowH ?? 0.86;
  // Les appelants paginent en amont (paginateRows), donc `rows` tient sur
  // la slide. Le garde-fou reste, mais il ne doit plus jamais mordre : si
  // une page arrivait trop pleine, on resserre la hauteur de ligne plutôt
  // que d'abandonner la fin de la liste.
  const cap = rowsPerSlide(top, h);
  const shown = rows;
  const step = rows.length > cap ? (FLOOR - top) / rows.length : h;
  const over = 0;
  shown.forEach((r, i) => {
    const cy = top + i * step;
    const col = r.tone === 'alert' ? C.red : r.tone === 'warn' ? C.amber
              : r.tone === 'good' ? C.green : C.brand;
    // Filet vertical de criticité : lisible même en vue miniature, et il
    // ne consomme pas de colonne comme le faisait la cellule "Priority".
    // Épaissi sur la ligne distinguée (kudos), pour la retrouver dans la
    // liste sans relire les noms.
    slide.addShape('rect', {
      x: M, y: cy + 0.06, w: r.kudos ? 0.07 : 0.032, h: h - 0.26,
      fill: { color: col }, line: { type: 'none' },
    });
    // Étiquette courte (n° de ticket, source, porteur) en tête de ligne.
    if (r.tag) {
      slide.addText(clip(r.tag), {
        x: M + 0.24, y: cy + 0.02, w: 2.3, h: 0.26,
        fontSize: fitPt(r.tag, 22, 10), bold: true, color: col, fontFace: FONT, valign: 'middle',
      });
    }
    // Bulles de porteurs, ferrées à droite : un porteur se repère à sa
    // pastille, pas en lisant une ligne de métadonnées. `pills` :
    // [{ label, value, tone }] — 2 au plus, sinon la ligne se remplit.
    const pills = (r.pills || []).slice(0, 2);
    const pillW = 2.05, pillGap = 0.12;
    const pillsW = pills.length
      ? pills.length * pillW + (pills.length - 1) * pillGap : 0;
    // La coupe du titre est déduite de la largeur restante, pas d'une
    // constante : avec deux bulles il reste 4,9 in, soit ~56 caractères à
    // 12,5 pt. Une valeur devinée (66) faisait passer le titre sur une
    // deuxième ligne, sous les bulles.
    const titleX = M + (r.tag ? 2.62 : 0.24);
    const titleW = M + CW - titleX - 0.16 - pillsW;
    const titleMax = Math.max(18, Math.floor(titleW / (0.5 * 12.5 / 72)));
    slide.addText(clip(r.title), {
      x: titleX, y: cy + 0.02, w: titleW, h: 0.3,
      fontSize: fitPt(r.title, titleMax, 12.5), color: C.ink, fontFace: FONT, valign: 'middle',
    });
    pills.forEach((pl, pi) => {
      const px = M + CW - pillsW + pi * (pillW + pillGap);
      // Un porteur non affecté se lit en creux : contour seul, texte gris.
      // Sinon la bulle vide paraîtrait renseignée.
      const empty = !pl.value;
      const pc = pl.tone === 'alert' ? C.red : pl.tone === 'good' ? C.green : C.brand;
      slide.addShape('roundRect', {
        x: px, y: cy + 0.04, w: pillW, h: 0.42, rectRadius: 0.21,
        fill: empty ? { color: C.bgSoft } : { color: pc },
        line: empty ? { color: C.line, width: 0.75 } : { type: 'none' },
      });
      slide.addText([
        { text: `${pl.label}  `, options: {
            fontSize: 8, color: empty ? C.faint : 'FFFFFF' } },
        { text: clip(pl.value || 'unassigned'), options: {
            fontSize: fitPt(pl.value || 'unassigned', 16, 9.5),
            bold: true, color: empty ? C.mute : 'FFFFFF' } },
      ], {
        x: px + 0.1, y: cy + 0.04, w: pillW - 0.2, h: 0.42,
        align: 'center', valign: 'middle', fontFace: FONT,
      });
    });
    if (r.meta) {
      const metaW = CW - 0.34 - pillsW;
      const metaMax = Math.floor(metaW / (0.5 * 9.5 / 72));
      slide.addText(clip(r.meta), {
        x: M + 0.24, y: cy + 0.34, w: metaW, h: 0.26,
        fontSize: fitPt(r.meta, metaMax, 9.5), color: C.mute, fontFace: FONT, valign: 'middle',
      });
    }
    /* Point d'avancement, sur sa propre ligne sous les métadonnées. Il
       occupe toute la largeur — il passe sous les bulles de porteurs, qui
       s'arrêtent au-dessus — parce que c'est une phrase, pas une étiquette :
       la comprimer à côté des pastilles la couperait au tiers.

       Un préfixe « Update » la distingue des métadonnées grises juste
       au-dessus. Quand rien n'est saisi, le texte passe en italique atténué :
       le lecteur voit du premier coup d'œil quels tickets ne sont pas suivis,
       sans lire les phrases une à une. */
    if (r.update && r.update.text) {
      /* La ligne de métadonnées court de 0,34 à 0,60 : démarrer le bloc
         à 0,54 le faisait chevaucher les deux dernières décimales et
         l'ensemble paraissait collé au haut de la ligne. Il commence
         maintenant sous la fin réelle des métadonnées, avec un blanc de
         respiration au-dessus. */
      const upY = cy + 0.68;
      const upH = 0.34;
      // Aplat teinté sur toute la largeur : c'est l'information que la
      // revue vient chercher sur cette slide, elle ne doit pas se lire
      // comme une troisième ligne de métadonnées. Ambre quand un suivi
      // existe, gris quand il manque — l'absence est signalée mais ne
      // crie pas plus fort que le contenu.
      slide.addShape('roundRect', {
        x: M + 0.16, y: upY, w: CW - 0.16, h: upH, rectRadius: 0.06,
        fill: { color: r.update.missing ? C.bgSoft : C.amberSoft },
        line: { type: 'none' },
      });
      // Filet d'appel à gauche de l'aplat, dans le ton du bloc.
      slide.addShape('rect', {
        x: M + 0.16, y: upY, w: 0.028, h: upH,
        fill: { color: r.update.missing ? C.line : C.amber }, line: { type: 'none' },
      });
      const upW   = CW - 0.52;
      const upMax = Math.floor(upW / (0.5 * 9.5 / 72)) - 10;
      slide.addText([
        { text: `${r.update.label || 'UPDATE'}   `, options: {
            bold: true, fontSize: 8,
            color: r.update.missing ? C.faint : '7A5200' } },
        { text: clip(r.update.text), options: {
            bold: !r.update.missing, italic: !!r.update.missing,
            fontSize: fitPt(r.update.text, upMax, 9.5),
            color: r.update.missing ? C.faint : C.ink } },
      ], {
        x: M + 0.3, y: upY, w: upW, h: upH,
        fontFace: FONT, valign: 'middle',
      });
    }
    // Filet de séparation, sauf après la dernière ligne.
    if (i < shown.length - 1) {
      slide.addShape('rect', {
        x: M, y: cy + h - 0.13, w: CW, h: 0.008,
        fill: { color: C.line }, line: { type: 'none' },
      });
    }
  });
  // Pas de phrase de reliquat en pied : elle venait s'écraser sur le pied
  // de page et alourdissait la slide. Le compte total est porté par le
  // sous-titre de l'en-tête (cf. les appelants), donc rien n'est masqué
  // sans que le lecteur le sache. `over` est renvoyé pour cet usage.
  if (note && !over) {
    slide.addText(note, {
      x: M, y: Math.min(top + shown.length * step + 0.04, FLOOR + 0.1), w: CW, h: 0.26,
      fontSize: 9, italic: true, color: C.faint, fontFace: FONT, valign: 'middle',
    });
  }
  return { shown: shown.length, over };
}

// Grille d'engagements numérotés. `rows` : [{ text, owner, eta, tone }].
// `startAt` : rang de la première ligne de la page. Sur une slide de
// continuation la numérotation doit reprendre où la précédente s'est
// arrêtée, sinon deux actions différentes portent le numéro 01.
function planGrid(slide, { rows, y, note, startAt = 0 }) {
  const top = y ?? 1.95;
  const h = 0.92;
  rows.forEach((r, i) => {
    const cy = top + i * h;
    const col = r.tone === 'alert' ? C.red : r.tone === 'warn' ? C.amber : C.brand;
    // Le numéro en 26pt : c'est un plan, l'ordre compte.
    slide.addText(String(startAt + i + 1).padStart(2, '0'), {
      x: M, y: cy, w: 0.8, h: 0.5,
      fontSize: 26, bold: true, color: col, fontFace: FONT, valign: 'middle',
    });
    slide.addText(clip(r.text), {
      x: M + 0.92, y: cy + 0.02, w: CW - 3.4, h: 0.46,
      fontSize: fitPt(r.text, 120, 12.5), color: C.ink, fontFace: FONT, valign: 'middle',
    });
    // Porteur et échéance ferrés à droite, alignés sur une colonne fixe :
    // le lecteur balaie la colonne pour retrouver qui fait quoi.
    // Deuxième ligne : l'échéance quand elle existe, sinon le statut
    // (« In Progress », « Planned ») pour les lignes venues du Weekly
    // Progress, qui ne portent pas de date mais portent un état.
    const sub = r.eta ? `by ${r.eta}` : (r.status || 'no date set');
    slide.addText([
      { text: orNA(r.owner), options: { bold: true, color: C.ink } },
      { text: `\n${sub}`,
        options: { color: r.eta ? C.mute : (r.status ? C.ink : C.faint), fontSize: 9.5 } },
    ], {
      x: M + CW - 2.4, y: cy, w: 2.4, h: 0.56,
      fontSize: 10.5, align: 'right', valign: 'middle', fontFace: FONT,
      lineSpacingMultiple: 1.25,
    });
    if (i < rows.length - 1) {
      slide.addShape('rect', {
        x: M, y: cy + h - 0.16, w: CW, h: 0.008,
        fill: { color: C.line }, line: { type: 'none' },
      });
    }
  });
  if (note) {
    slide.addText(note, {
      x: M, y: top + rows.length * h + 0.04, w: CW, h: 0.28,
      fontSize: 9, italic: true, color: C.faint, fontFace: FONT,
    });
  }
}

// Page de propos : aplat plein, texte à gauche, titre surdimensionné en
// bas à droite, séparés par un filet vertical. Renvoie le numéro de page
// consommé pour que l'appelant garde son compteur cohérent.
function statement(slide, { bg, on, onMute, rule, eyebrow, lead, title, sub }) {
  slide.background = { color: bg };
  if (eyebrow) {
    slide.addText(eyebrow, {
      x: M, y: 0.72, w: 5.2, h: 0.24,
      fontSize: 10, color: onMute, fontFace: FONT,
    });
  }
  if (lead) {
    // Le commentaire est rendu intégralement. La boîte tient ~460 signes à
    // 17 pt ; au-delà le corps décroît plutôt que le texte d'être coupé.
    // La hauteur suit aussi, jusqu'au filet de pied.
    const leadY = eyebrow ? 1.12 : 0.72;
    slide.addText(lead, {
      x: M, y: leadY, w: 5.4, h: Math.min(2.6, 6.8 - leadY) + 1.6,
      fontSize: fitPt(lead, 460, 17), color: onMute, fontFace: FONT,
      valign: 'top', lineSpacingMultiple: 1.36,
    });
  }
  slide.addShape('rect', {
    x: 6.66, y: 0, w: 0.008, h: 7.5,
    fill: { color: rule }, line: { type: 'none' },
  });
  slide.addShape('ellipse', {
    x: 6.615, y: 4.02, w: 0.1, h: 0.1,
    fill: { color: on }, line: { type: 'none' },
  });
  slide.addText(title, {
    x: 7.15, y: 3.42, w: CW - 6.43, h: 2.0,
    fontSize: 40, color: on, fontFace: FONT,
    valign: 'top', lineSpacingMultiple: 1.04,
  });
  if (sub) {
    slide.addText(sub, {
      x: 7.18, y: 5.5, w: CW - 6.46, h: 0.3,
      fontSize: 10.5, color: onMute, fontFace: FONT,
    });
  }
  // Pas de pied ici : il est posé par la numérotation différée en fin de
  // deck, seule à connaître le rang et le total. Le poser aussi ici
  // superposait un second pied « undefined / undefined ».
}

// Carte de métrique pleine hauteur : aplat de couleur sans bordure, la
// valeur posée en très grand corps, le libellé et sa glose en pied. C'est
// la structure de la slide Overview — trois cartes côte à côte plutôt
// qu'une grille de petites tuiles filetées.
//
// `fill` porte la surface, `on` la couleur du texte : une carte sombre
// demande du texte clair, une carte claire du texte sombre. L'appelant
// choisit le couple, la fonction ne devine pas.
//
// `align` place le bloc valeur+texte en haut ou en bas de la carte : en
// alternant d'une carte à l'autre, la rangée respire au lieu de répéter
// trois fois la même composition.
function metricCard(slide, { x, y, w, h, value, label, note, kicker,
                             fill, on, onMute, align = 'bottom' }) {
  slide.addShape('rect', {
    x, y, w, h, fill: { color: fill }, line: { type: 'none' },
  });

  const pad = 0.34;
  // Ligne de contexte en tête de carte (le "25% still rely on..." de la
  // référence) : elle ne concurrence pas la valeur, elle l'installe.
  if (kicker) {
    slide.addText(clip(kicker), {
      x: x + pad, y: y + 0.3, w: w - pad * 2, h: 0.5,
      fontSize: fitPt(kicker, 64, 9.5), color: onMute, fontFace: FONT,
      valign: 'top', lineSpacingMultiple: 1.16,
    });
  }

  // Bloc de pied : la valeur puis son libellé, calés sur le bas de la
  // carte. Les hauteurs sont fixes pour que trois cartes de contenus
  // différents alignent leurs lignes de base.
  const noteH  = note ? 0.5 : 0;
  const blockH = 0.92 + 0.3 + noteH;
  // Le bloc est calé au bas de la carte, mais remonté d'un tiers de la
  // hauteur restante : posé sur le bord, il laissait un vide central
  // trop lourd pour ce que la carte porte.
  const slack  = Math.max(0, h - pad * 2 - blockH - (kicker ? 0.9 : 0));
  const by     = align === 'top' ? y + (kicker ? 1.05 : pad)
                                 : y + h - pad - blockH - slack * 0.34;

  slide.addText(String(value), {
    x: x + pad - 0.05, y: by, w: w - pad * 2 + 0.1, h: 0.92,
    fontSize: 54, bold: true, color: on, fontFace: FONT, valign: 'middle',
  });
  slide.addText(String(label), {
    x: x + pad, y: by + 0.94, w: w - pad * 2, h: 0.3,
    fontSize: 13, bold: true, color: on, fontFace: FONT, valign: 'top',
  });
  if (note) {
    slide.addText(clip(note), {
      x: x + pad, y: by + 1.26, w: w - pad * 2, h: noteH,
      fontSize: fitPt(note, 90, 9.5), color: onMute, fontFace: FONT,
      valign: 'top', lineSpacingMultiple: 1.16,
    });
  }
}

// Les tableaux (table / tablePlaceholder) ont été retirés : toutes les
// listes du deck passent désormais par entryList() ou planGrid(), qui
// évitent le défilement de colonnes et portent la criticité par un liseré.

// Bloc "rien à signaler" : une section vide doit dire pourquoi elle est
// vide, sinon le lecteur croit à une donnée manquante. Toutes les slides
// du deck sont toujours produites — la structure du rapport doit rester
// lisible même sur une semaine creuse.
function emptyNote(slide, text, opts = {}) {
  const y = opts.y ?? 1.95;
  const h = opts.h ?? 1.0;
  slide.addShape('roundRect', {
    x: opts.x ?? M, y, w: opts.w ?? CW, h, rectRadius: 0.06,
    fill: { color: C.bgSoft }, line: { color: C.line, width: 0.75, dashType: 'dash' },
  });
  slide.addText(text, {
    x: (opts.x ?? M) + 0.35, y, w: (opts.w ?? CW) - 0.7, h,
    fontSize: opts.fontSize ?? 12, color: C.mute, valign: 'middle',
    align: opts.align || 'left', fontFace: FONT,
  });
}

/* ── Graphiques dessinés en formes ────────────────────────────
   Les graphiques natifs PowerPoint (addChart) ne sont rendus que par
   PowerPoint lui-même : LibreOffice, Keynote, Google Slides et les
   aperçus macOS affichent un cadre vide à leur place. Un rapport qui
   ne se lit que dans un seul logiciel ne remplit pas son office, donc
   les graphiques sont composés ici en rectangles et en texte — le même
   vocabulaire que les tuiles de KPI, rendu à l'identique partout.
   On perd l'édition du graphique par le lecteur ; on gagne un deck
   lisible sans condition. */

// Ordonnée à laquelle le contenu d'un panneau peut commencer sans
// chevaucher son titre et sa note. L'appelant s'en sert au lieu de
// recalculer un décalage à la main — c'est ce qui provoquait les
// superpositions (barre de parts posée sur la note du panneau).
panel.contentY = (y, hasNote) => y + (hasNote ? 0.92 : 0.68);

// Panneau : aplat clair servant de cadre à un graphique, avec son titre.
function panel(slide, { x, y, w, h, title, note, fill }) {
  // Aplat gris très clair sans bordure ni ombre : la surface se distingue
  // du fond blanc par sa seule valeur, comme les cartes de la référence.
  slide.addShape('rect', {
    x, y, w, h, fill: { color: fill || C.bgSoft }, line: { type: 'none' },
  });
  if (title) {
    slide.addText(title, {
      x: x + 0.32, y: y + 0.26, w: w - 0.64, h: 0.26,
      fontSize: 12, bold: true, color: C.ink, fontFace: FONT,
    });
  }
  if (note) {
    slide.addText(note, {
      x: x + 0.32, y: y + 0.54, w: w - 0.64, h: 0.24,
      fontSize: 9, color: C.mute, fontFace: FONT,
    });
  }
}

// Légende horizontale : pastille + libellé, répartie sur une ligne.
function legend(slide, { x, y, w, items }) {
  const step = w / items.length;
  items.forEach((it, i) => {
    slide.addShape('roundRect', {
      x: x + i * step, y: y + 0.05, w: 0.16, h: 0.11,
      rectRadius: 0.05, fill: { color: it.color }, line: { type: 'none' },
    });
    slide.addText(it.label, {
      x: x + i * step + 0.24, y, w: step - 0.3, h: 0.22,
      fontSize: 9.5, color: C.mute, valign: 'middle', fontFace: FONT,
    });
  });
}

// Barres horizontales : une ligne par catégorie, libellé à gauche,
// longueur proportionnelle, valeur au bout. Comparer des longueurs
// alignées sur une même base est la lecture la plus fiable.
function hBars(slide, { x, y, w, h, rows, labelW }) {
  if (!rows.length) return;
  const max   = Math.max(...rows.map(r => r.value), 1);
  const lw    = labelW ?? 1.5;
  const trackX = x + lw;
  // La valeur est écrite au bout de la barre : la piste s'arrête assez tôt
  // pour que le chiffre de la plus longue ligne reste dans le panneau.
  const trackW = w - lw - 0.62;
  const rowH  = Math.min(0.46, h / rows.length);
  const barH  = Math.min(0.15, rowH * 0.38);

  // Libellés ferrés à gauche, tous alignés sur la même colonne : ferrés à
  // droite ils créaient un bord en dents de scie contre les barres.
  rows.forEach((r, i) => {
    const cy = y + i * rowH;
    slide.addText(clip(r.label), {
      x, y: cy, w: lw - 0.14, h: rowH,
      fontSize: fitPt(r.label, 18, 9.5), color: C.mute, valign: 'middle', fontFace: FONT,
    });
    // Pas de rail de fond : sur un aplat clair il se lisait comme une
    // bordure autour de chaque barre. L'échelle est portée par l'alignement
    // commun des barres et par la valeur inscrite au bout.
    const bw = Math.max((r.value / max) * trackW, 0.02);
    slide.addShape('rect', {
      x: trackX, y: cy + (rowH - barH) / 2, w: bw, h: barH,
      fill: { color: r.color }, line: { type: 'none' },
    });
    slide.addText(String(r.value), {
      x: trackX + bw + 0.1, y: cy, w: 0.5, h: rowH,
      fontSize: 9.5, bold: true, color: C.ink, valign: 'middle', fontFace: FONT,
    });
  });
}

// Barres verticales groupées : deux séries par jour. Remplace la courbe
// de tendance — sur 7 points, des colonnes se lisent aussi bien et se
// dessinent sans interpolation.
function groupedCols(slide, { x, y, w, h, labels, series }) {
  const all = series.flatMap(s => s.values);
  const max = Math.max(...all, 1);
  const plotH = h - 0.4;                      // place pour l'axe des jours
  const step  = w / labels.length;
  const bw    = Math.min(0.34, (step * 0.62) / series.length);
  const groupW = bw * series.length;

  // Lignes de grille horizontales + graduations : sans repère, la hauteur
  // d'une colonne n'est pas quantifiable.
  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const v  = (max / ticks) * t;
    const gy = y + plotH - (v / max) * plotH;
    // line width 0 explicite : sans lui PptxGenJS pose un contour gris
    // foncé de 1pt par défaut, qui transformait ce filet en trait sale.
    slide.addShape('rect', {
      x, y: gy, w, h: 0.008, line: { type: 'none' },
      fill: { color: t === 0 ? 'C9CDD2' : 'E9EBED' },
    });
    slide.addText(String(Math.round(v)), {
      x: x - 0.42, y: gy - 0.1, w: 0.36, h: 0.2,
      fontSize: 8, color: C.faint, align: 'right', valign: 'middle', fontFace: FONT,
    });
  }

  labels.forEach((lb, i) => {
    const gx = x + i * step + (step - groupW) / 2;
    series.forEach((s, j) => {
      const v  = s.values[i] || 0;
      const bh = (v / max) * plotH;
      const bx = gx + j * bw;
      if (bh > 0.01) {
        slide.addShape('rect', {
          x: bx, y: y + plotH - bh, w: bw - 0.04, h: bh,
          fill: { color: s.color }, line: { type: 'none' },
        });
      }
      // La valeur n'est écrite que si elle est non nulle : des "0" à
      // répétition sur une semaine creuse noient les vrais chiffres.
      if (v > 0) {
        slide.addText(String(v), {
          x: bx - 0.09, y: y + plotH - bh - 0.22, w: bw + 0.14, h: 0.2,
          fontSize: 8.5, bold: true, color: s.color, align: 'center', fontFace: FONT,
        });
      }
    });
    slide.addText(lb, {
      x: x + i * step, y: y + plotH + 0.06, w: step, h: 0.24,
      fontSize: 9, color: C.mute, align: 'center', valign: 'middle', fontFace: FONT,
    });
  });
}

// Barres empilées verticales : hauteur totale = charge portée, segments
// colorés = composition. Remplace le graphique empilé natif.
function stackedCols(slide, { x, y, w, h, labels, series }) {
  const totals = labels.map((_, i) =>
    series.reduce((a, s) => a + (s.values[i] || 0), 0));
  const max = Math.max(...totals, 1);
  const plotH = h - 0.55;                     // place pour les noms d'agents
  const step  = w / labels.length;
  const bw    = Math.min(0.72, step * 0.56);

  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const v  = (max / ticks) * t;
    const gy = y + plotH - (v / max) * plotH;
    // line width 0 explicite : sans lui PptxGenJS pose un contour gris
    // foncé de 1pt par défaut, qui transformait ce filet en trait sale.
    slide.addShape('rect', {
      x, y: gy, w, h: 0.008, line: { type: 'none' },
      fill: { color: t === 0 ? 'C9CDD2' : 'E9EBED' },
    });
    slide.addText(String(Math.round(v)), {
      x: x - 0.42, y: gy - 0.1, w: 0.36, h: 0.2,
      fontSize: 8, color: C.faint, align: 'right', valign: 'middle', fontFace: FONT,
    });
  }

  labels.forEach((lb, i) => {
    const bx = x + i * step + (step - bw) / 2;
    let acc = 0;
    series.forEach(s => {
      const v  = s.values[i] || 0;
      if (v <= 0) return;
      const bh = (v / max) * plotH;
      acc += bh;
      slide.addShape('rect', {
        x: bx, y: y + plotH - acc, w: bw, h: bh,
        fill: { color: s.color }, line: { type: 'none' },
      });
      // Étiquette dans le segment, seulement s'il est assez haut pour
      // la contenir sans chevaucher le segment voisin.
      if (bh > 0.24) {
        slide.addText(String(v), {
          x: bx, y: y + plotH - acc, w: bw, h: bh,
          fontSize: 9, bold: true, color: 'FFFFFF',
          align: 'center', valign: 'middle', fontFace: FONT,
        });
      }
    });
    if (totals[i] > 0) {
      slide.addText(String(totals[i]), {
        x: bx - 0.1, y: y + plotH - acc - 0.22, w: bw + 0.2, h: 0.2,
        fontSize: 8.5, bold: true, color: C.ink, align: 'center', fontFace: FONT,
      });
    }
    // La boîte du nom ne dépasse pas le pas de la colonne : élargie, elle
    // recouvrait celle du voisin et PowerPoint superposait les deux textes.
    slide.addText(clip(lb), {
      x: x + i * step + 0.02, y: y + plotH + 0.1, w: step - 0.04, h: 0.4,
      fontSize: fitPt(lb, 13, 8), color: C.mute, align: 'center', valign: 'top', fontFace: FONT,
    });
  });
}

// Répartition en proportions : barre unique segmentée + liste chiffrée.
// Remplace camembert et anneau, qu'on ne peut pas dessiner en formes de
// façon fiable — et une longueur segmentée se compare mieux qu'un angle.
// Répartition circulaire dessinée UNIQUEMENT en `ellipse`.
//
// Historique des tentatives, pour qu'on ne les refasse pas :
//   · addChart natif  -> cadre vide hors PowerPoint ;
//   · prst="pie"      -> PptxGenJS n'émet qu'un preset sans chemin de repli,
//                        les lecteurs qui l'ignorent dessinent la boîte
//                        englobante, d'où un carré plein ;
//   · donut/arc/chord -> mêmes presets nus, même risque.
// `ellipse` et `rect`, eux, sont rendus partout (les puces du deck le
// prouvent). On compose donc le cercle avec des disques : une couronne de
// pastilles dont la couleur suit la répartition, et le total au centre.
// C'est lisible comme un camembert — chaque pastille est une part — sans
// dépendre d'un moteur de secteurs.
function pieChart(slide, { cx, cy, d, rows, legendX, legendW, centerLabel = 'open' }) {
  const total = rows.reduce((a, r) => a + r.value, 0);
  if (!total) return;

  const N = 24;                       // pastilles de la couronne
  const R = d / 2;                    // rayon de la couronne
  const dot = Math.max(0.17, d * 0.1);
  const ccx = cx + R, ccy = cy + R;   // centre du cercle

  // Répartition des pastilles par catégorie, au plus proche, en corrigeant
  // le reste sur la plus grosse part pour que le total fasse exactement N.
  const live = rows.filter(r => r.value > 0);
  const counts = live.map(r => Math.max(1, Math.round((r.value / total) * N)));
  let diff = N - counts.reduce((a, b) => a + b, 0);
  if (diff !== 0) {
    const big = counts.indexOf(Math.max(...counts));
    counts[big] += diff;
  }

  // Couleur de chaque pastille, dans l'ordre des catégories.
  const seq = [];
  live.forEach((r, i) => { for (let n = 0; n < counts[i]; n++) seq.push(r.color); });

  seq.forEach((col, i) => {
    // Départ à midi, sens horaire.
    const ang = (-90 + (i / N) * 360) * Math.PI / 180;
    slide.addShape('ellipse', {
      x: ccx + Math.cos(ang) * R - dot / 2,
      y: ccy + Math.sin(ang) * R - dot / 2,
      w: dot, h: dot,
      fill: { color: col }, line: { type: 'none' },
    });
  });

  // Total au centre : le cercle porte la proportion, le centre l'effectif.
  slide.addText(String(total), {
    x: ccx - 0.85, y: ccy - 0.34, w: 1.7, h: 0.5,
    fontSize: 30, bold: true, color: C.ink,
    align: 'center', valign: 'middle', fontFace: FONT,
  });
  // Libellé sous le total : 'open' pour le weekly, surchargeable par les
  // autres decks qui réutilisent le gabarit (objectifs).
  slide.addText(centerLabel, {
    x: ccx - 0.85, y: ccy + 0.14, w: 1.7, h: 0.24,
    fontSize: 9.5, color: C.mute, align: 'center', valign: 'middle', fontFace: FONT,
  });

  // Légende : pastille, libellé, effectif et part.
  const lx = legendX ?? (cx + d + 0.5);
  const lw = legendW ?? 2.4;
  const step = 0.42;
  const startY = ccy - (rows.length * step) / 2;
  rows.forEach((r, i) => {
    const ly = startY + i * step;
    slide.addShape('ellipse', {
      x: lx, y: ly + 0.085, w: 0.16, h: 0.16,
      fill: { color: r.color }, line: { type: 'none' },
    });
    slide.addText(clip(r.label), {
      x: lx + 0.3, y: ly, w: lw - 1.05, h: 0.32,
      fontSize: fitPt(r.label, 18, 10), color: C.ink, valign: 'middle', fontFace: FONT,
    });
    slide.addText([
      { text: String(r.value), options: { bold: true, color: C.ink } },
      { text: `  ${Math.round((r.value / total) * 100)}%`, options: { color: C.mute } },
    ], {
      x: lx + lw - 0.78, y: ly, w: 0.78, h: 0.32,
      fontSize: 10, align: 'right', valign: 'middle', fontFace: FONT,
    });
  });
}

/* Tableau de tickets, colonnes du tracker.
   Le camembert dit combien de tickets sont ouverts et dans quel statut,
   mais pas lesquels : en revue, la question qui suit est toujours « c'est
   quoi ces tickets ? ». Ce tableau y répond sous le graphique.

   Colonnes reprises du tracker, dans son ordre, et arrêtées à la
   sévérité : Océane TT# · Titre · Domaine · Priorité · Sévérité. Au-delà,
   les colonnes du tracker (statut, porteurs, dates, SLA, cause racine)
   ne tiennent pas dans un demi-panneau et sont déjà portées ailleurs
   dans le deck.

   Le tableau ne pagine pas : c'est un extrait, pas un inventaire. Quand
   la liste dépasse, la mention de reliquat le dit explicitement. */
function ticketTable(slide, { x, y, w, rows, total, rowH }) {
  const h = rowH ?? 0.24;
  // Largeurs de colonnes en part de la largeur utile. Le titre prend ce
  // qui reste : c'est la seule colonne dont la longueur est libre.
  const cTT = 0.92, cDom = 0.66, cPri = 0.42, cSev = 0.62;
  const cTitle = w - cTT - cDom - cPri - cSev - 0.12;
  const colX = {
    tt:    x,
    title: x + cTT,
    dom:   x + cTT + cTitle,
    pri:   x + cTT + cTitle + cDom,
    sev:   x + cTT + cTitle + cDom + cPri,
  };

  // Ligne d'en-tête, en petites capitales grises : même grammaire que les
  // libellés de colonnes du reste du deck.
  const head = [
    ['Oceane TT#', colX.tt, cTT], ['Title', colX.title, cTitle],
    ['Domain', colX.dom, cDom], ['Prio', colX.pri, cPri],
    ['Severity', colX.sev, cSev],
  ];
  head.forEach(([label, hx, hw]) => {
    slide.addText(label, {
      x: hx, y, w: hw, h: 0.2,
      fontSize: 7.5, bold: true, color: C.faint, charSpacing: 0.3, fontFace: FONT,
      valign: 'middle',
    });
  });
  slide.addShape('rect', {
    x, y: y + 0.21, w, h: 0.008, fill: { color: C.line }, line: { type: 'none' },
  });

  rows.forEach((r, i) => {
    const cy = y + 0.27 + i * h;
    const pc = PRIO_C[r.priority] || C.faint;
    const sc = SEV_C[String(r.severity || '').toLowerCase()] || C.faint;

    slide.addText(clip(r.tt), {
      x: colX.tt, y: cy, w: cTT - 0.06, h,
      fontSize: fitPt(r.tt, 11, 8), bold: true, color: C.ink,
      fontFace: FONT, valign: 'middle',
    });
    slide.addText(clip(r.title), {
      x: colX.title, y: cy, w: cTitle - 0.08, h,
      fontSize: fitPt(r.title, 42, 8), color: C.ink, fontFace: FONT, valign: 'middle',
    });
    slide.addText(clip(r.domain), {
      x: colX.dom, y: cy, w: cDom - 0.06, h,
      fontSize: fitPt(r.domain, 9, 8), color: C.mute, fontFace: FONT, valign: 'middle',
    });
    // Priorité et sévérité portent leur couleur : ce sont les deux
    // colonnes qu'on balaie du regard pour trier ce qui presse.
    slide.addText(orNA(r.priority), {
      x: colX.pri, y: cy, w: cPri - 0.06, h,
      fontSize: 8, bold: true, color: pc, fontFace: FONT, valign: 'middle',
    });
    slide.addText(orNA(r.severity), {
      x: colX.sev, y: cy, w: cSev, h,
      fontSize: fitPt(r.severity, 9, 8), bold: true, color: sc,
      fontFace: FONT, valign: 'middle',
    });
  });

  // Reliquat : on ne le laisse jamais implicite, sinon l'extrait se lit
  // comme la liste complète.
  const over = (total ?? rows.length) - rows.length;
  if (over > 0) {
    slide.addText(`+ ${over} other open ticket(s), see the tracker`, {
      x, y: y + 0.3 + rows.length * h, w, h: 0.22,
      fontSize: 7.5, italic: true, color: C.faint, fontFace: FONT, valign: 'middle',
    });
  }
}

function shareBar(slide, { x, y, w, rows }) {
  const total = rows.reduce((a, r) => a + r.value, 0);
  if (!total) return;
  const H = 0.42;
  let cx = x;
  rows.forEach(r => {
    const sw = (r.value / total) * w;
    if (sw <= 0) return;
    slide.addShape('rect', {
      x: cx, y, w: sw, h: H, fill: { color: r.color }, line: { type: 'none' },
    });
    // Pourcentage inscrit dans le segment s'il est assez large.
    if (sw > 0.5) {
      slide.addText(`${Math.round((r.value / total) * 100)}%`, {
        x: cx, y, w: sw, h: H,
        fontSize: 10, bold: true, color: 'FFFFFF',
        align: 'center', valign: 'middle', fontFace: FONT,
      });
    }
    cx += sw;
  });

  // Détail sous la barre : libellé + effectif seulement. Le pourcentage est
  // déjà inscrit dans le segment ; le répéter ici le faisait apparaître
  // deux fois par ligne pour une seule information.
  rows.forEach((r, i) => {
    const ly = y + H + 0.3 + i * 0.32;
    slide.addShape('rect', {
      x, y: ly + 0.09, w: 0.13, h: 0.13,
      fill: { color: r.color }, line: { type: 'none' },
    });
    slide.addText(clip(r.label), {
      x: x + 0.26, y: ly, w: w - 1.0, h: 0.3,
      fontSize: fitPt(r.label, 24, 10), color: C.ink, valign: 'middle', fontFace: FONT,
    });
    slide.addText(`${r.value}`, {
      x: x + w - 0.7, y: ly, w: 0.7, h: 0.3,
      fontSize: 10, bold: true, color: C.ink,
      align: 'right', valign: 'middle', fontFace: FONT,
    });
  });
}

/* ── Séries dérivées pour les graphiques ──────────────────────
   Le endpoint ne renvoie que des listes de tickets : les séries
   temporelles et les répartitions par statut se calculent ici. */

// Ouverts et clôturés jour par jour sur la semaine.
function dailySeries(data) {
  const start = new Date(data.week_start);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    days.push(d.toISOString().slice(0, 10));
  }
  const lbl = days.map(d =>
    new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB',
      { weekday: 'short', day: 'numeric', timeZone: 'UTC' }));
  const opened = days.map(d =>
    (data.week_tickets || []).filter(t =>
      (t.open_date || '').slice(0, 10) === d).length);
  const closed = days.map(d =>
    (data.closed_week_tickets || data.week_tickets || [])
      .filter(t => (t.close_date || '').slice(0, 10) === d).length);
  return { labels: lbl, opened, closed, total: opened.reduce((a, b) => a + b, 0) };
}

// Répartition par statut sur les tickets actifs.
function statusSeries(data) {
  const tally = {};
  for (const t of data.active_tickets || []) {
    if (t.status) tally[t.status] = (tally[t.status] || 0) + 1;
  }
  return Object.entries(tally).sort((a, b) => b[1] - a[1]);
}

// Conformité SLA des tickets de la semaine, en trois états.
function slaSeries(data) {
  const w = data.week_tickets || [];
  const rated = w.filter(t => t.sla_status && !['N/A', 'On Hold'].includes(t.sla_status));
  return [
    ['Within SLA',    rated.filter(t => t.sla_status === 'In SLA').length],
    ['Near breach',   rated.filter(t => t.sla_status === 'Near Breach').length],
    ['Breached',      rated.filter(t => t.sla_status === 'Breach').length],
  ].filter(([, v]) => v > 0);
}


/* ── Slide de tendance ────────────────────────────────────────
   Le deck décrivait une semaine isolée : on savait où on en était, pas
   si on progressait. Cette slide compare la semaine à la précédente sur
   les points qui déclenchent une décision en revue.

   Le choix des métriques est délibéré : chacune est actionnable, et son
   sens de progrès est connu. On écarte les indicateurs de volume pur —
   « plus de tickets » n'est ni bon ni mauvais en soi.

   `better` dit dans quel sens va l'amélioration ; sans cette information
   une flèche verte sur « ruptures SLA en hausse » serait un contresens. */
function trendRows(data) {
  const k = data.kpis || {};
  const p = data.prev_kpis || {};
  const hrs  = ms => (ms == null || isNaN(ms) ? null : ms / 3600000);
  const mins = ms => (ms == null || isNaN(ms) ? null : ms / 60000);

  return [
    { key: 'sla', label: 'SLA compliance',
      now: k.sla_compliance, was: p.sla_compliance,
      unit: '%', better: 'up',
      why: 'Share of the period\u2019s tickets meeting their target.' },
    { key: 'breach', label: 'SLA breaches',
      now: k.breach ?? 0, was: p.breach ?? 0,
      unit: '', better: 'down',
      why: 'Tickets opened in the period that missed their target.' },
    { key: 'net', label: 'Closed vs opened',
      // Le solde net : au-dessus de zéro l'encours se résorbe, en dessous
      // il enfle. C'est la mesure qui dit si l'équipe tient la charge.
      now: (k.resolved_this_week ?? 0) - (k.opened_this_week ?? 0),
      was: (p.resolved_this_week ?? 0) - (p.opened_this_week ?? 0),
      unit: '', better: 'up', signed: true,
      why: 'Net backlog movement: above zero the queue shrinks.' },
    { key: 'backlog', label: 'Open backlog',
      // L'encours porté : le solde net dit le sens, celui-ci dit le niveau.
      now: k.overall_open, was: p.overall_open,
      unit: '', better: 'down',
      why: 'Tickets still open at the close of the week.' },
    { key: 'mttr', label: 'MTTR',
      now: hrs(k.mttr_ms), was: hrs(p.mttr_ms),
      unit: 'h', better: 'down', decimals: 1,
      why: 'Mean worked time from opening to closure.' },
    /* MTTD est comparé à la semaine précédente comme les autres lignes,
       mais il porte en plus une cible absolue (5 min). Deux conséquences :

         · l'unité passe en minutes — en heures à une décimale, la cible
           s'écrit « 0.1 h » et devient illisible ;
         · `target` fait primer le verdict « cible tenue / manquée » sur
           le verdict d'évolution : passer de 12 à 9 min est une baisse,
           ce n'est toujours pas conforme, et la ligne doit rester rouge. */
    { key: 'mttd', label: 'MTTD',
      now: mins(k.mttd_ms), was: mins(p.mttd_ms),
      unit: ' min', better: 'down', decimals: 0,
      target: { max: MTTD_TARGET_MS / 60000 },
      why: 'Mean worked time from occurrence to detection. Target: under 5 min.' },
  ];
}

// Formatage partagé par la liste et la synthèse.
function trendFmt(v, r) {
  if (v == null || isNaN(v)) return 'n/a';
  const n = r.decimals ? Number(v).toFixed(r.decimals) : String(Math.round(v));
  return (r.signed && v > 0 ? '+' : '') + n + (r.unit || '');
}

// Une ligne est-elle une amélioration ? `null` = pas d'avis (pas de
// référence, ou écart nul).
//
// Quand la ligne porte une cible absolue (`r.target.max`), c'est elle qui
// décide de la couleur : la conformité prime sur l'évolution. La flèche,
// elle, continue de dire le sens du mouvement — les deux informations sont
// distinctes et se lisent ensemble (« en baisse, toujours hors cible »).
function trendVerdict(r) {
  const hasNow = r.now != null && !isNaN(r.now);
  const has    = hasNow && r.was != null && !isNaN(r.was);
  const diff   = has ? r.now - r.was : null;

  if (r.target && hasNow) {
    return { has, good: r.now <= r.target.max, diff, onTarget: r.now <= r.target.max };
  }
  if (!has) return { has: false, good: null, diff: null };
  if (diff === 0) return { has: true, good: null, diff: 0 };
  return { has: true, good: r.better === 'up' ? diff > 0 : diff < 0, diff };
}

/* Rendu d'une ligne de tendance : libellé, valeur de la semaine passée et
   valeur actuelle. La couleur suit le progrès, pas le signe : une baisse
   des ruptures est verte bien qu'elle soit négative. */
function trendList(slide, { rows, x, y, w, rowH }) {
  const h = rowH ?? 0.72;

  rows.forEach((r, i) => {
    const cy = y + i * h;
    const v = trendVerdict(r);
    const col  = v.good === null ? C.mute : v.good ? C.green : C.red;
    const arrow = !v.has || v.diff === 0 ? '=' : v.diff > 0 ? '\u25b2' : '\u25bc';

    slide.addShape('rect', {
      x, y: cy + 0.05, w: 0.032, h: h - 0.2,
      fill: { color: col }, line: { type: 'none' },
    });
    slide.addText(clip(r.label), {
      x: x + 0.22, y: cy, w: 2.05, h: 0.3,
      fontSize: 12, bold: true, color: C.ink, fontFace: FONT, valign: 'middle',
    });
    slide.addText(clip(r.why), {
      x: x + 0.22, y: cy + 0.28, w: 4.5, h: 0.24,
      fontSize: 8.5, color: C.faint, fontFace: FONT, valign: 'middle',
    });

    // Valeurs : la semaine passée en gris, celle-ci en encre pleine.
    slide.addText([
      { text: trendFmt(r.was, r), options: { color: C.faint } },
      { text: '   \u2192   ', options: { color: C.line } },
      { text: trendFmt(r.now, r), options: { bold: true, color: C.ink } },
    ], {
      x: x + w - 4.4, y: cy, w: 2.95, h: 0.52,
      fontSize: 13.5, align: 'right', valign: 'middle', fontFace: FONT,
    });

    // Pastille d'écart, ferrée à droite.
    slide.addShape('roundRect', {
      x: x + w - 1.32, y: cy + 0.05, w: 1.32, h: 0.4, rectRadius: 0.2,
      fill: { color: v.good === null ? C.bgSoft : v.good ? C.greenSoft : C.redSoft },
      line: { type: 'none' },
    });
    // Sur une ligne à cible, la pastille dit la conformité plutôt que
    // l'écart : c'est le verdict qui compte en revue, et l'évolution reste
    // lisible juste à gauche (valeur passée → valeur actuelle).
    /* La pastille ne répète plus l'écart chiffré (« ▼ 12% ») : les deux
       valeurs sont juste à gauche, l'écart se lit dessus. Elle ne garde
       que le sens du mouvement — et, sur une ligne à cible, le verdict de
       conformité, qui lui n'est déductible d'aucun des deux nombres. */
    const pillText = r.target
      ? (v.onTarget == null ? 'not measured'
         : v.onTarget ? 'on target' : 'off target')
      : v.has ? (v.diff === 0 ? 'stable' : `${arrow}  ${v.good ? 'better' : 'worse'}`)
              : 'no baseline';
    slide.addText(
      pillText,
      {
        x: x + w - 1.32, y: cy + 0.05, w: 1.32, h: 0.4,
        fontSize: r.target ? 9 : v.has ? 10 : 8, bold: r.target || v.has,
        color: v.good === null ? C.mute : v.good ? '0B5C28' : '8C1D16',
        align: 'center', valign: 'middle', fontFace: FONT,
      });
  });
}

/* Synthèse en une phrase : la slide montre six écarts, la revue veut
   savoir si la semaine est meilleure ou moins bonne. On compte les
   améliorations contre les régressions et on nomme le mouvement le plus
   fort dans chaque sens — c'est ce qu'un manager dirait à l'oral. */
function trendSummary(rows) {
  /* Les lignes à cible sont écartées du décompte « en hausse / en baisse » :
     leur `good` répond à « conforme ? », pas à « en progrès ? ». Les mêler
     aux autres ferait dire « MTTD s'améliore » à une ligne simplement
     conforme, et l'inverse pour une ligne en progrès mais hors cible.
     Elles reviennent en fin de synthèse, avec leur propre verdict. */
  const targeted = rows.map(r => ({ r, v: trendVerdict(r) }))
    .filter(z => z.r.target && z.v.onTarget != null);

  const scored = rows.filter(r => !r.target)
    .map(r => ({ r, v: trendVerdict(r) })).filter(z => z.v.has && z.v.good !== null);
  if (!scored.length) return null;
  const up = scored.filter(z => z.v.good), down = scored.filter(z => !z.v.good);

  // « Le plus fort » se mesure en écart relatif : 3 ruptures de moins et
  // 3 points de SLA ne pèsent pas pareil.
  const rel = z => {
    const base = Math.abs(z.r.was);
    return base > 0.001 ? Math.abs(z.v.diff) / base : Math.abs(z.v.diff);
  };
  const best  = up.length   ? up.slice().sort((a, b) => rel(b) - rel(a))[0]   : null;
  const worst = down.length ? down.slice().sort((a, b) => rel(b) - rel(a))[0] : null;

  const tone = up.length > down.length ? 'good'
             : down.length > up.length ? 'alert' : 'warn';
  const head = up.length > down.length
    ? `Net improvement: ${up.length} of ${scored.length} indicators up`
    : down.length > up.length
      ? `Net regression: ${down.length} of ${scored.length} indicators down`
      : `Mixed week: ${up.length} up, ${down.length} down`;

  const bits = [];
  if (best)  bits.push(`${best.r.label} improved from ${trendFmt(best.r.was, best.r)} `
                     + `to ${trendFmt(best.r.now, best.r)}`);
  if (worst) bits.push(`${worst.r.label} moved the wrong way, `
                     + `${trendFmt(worst.r.was, worst.r)} to ${trendFmt(worst.r.now, worst.r)}`);
  // Verdict de conformité, à part du sens de l'évolution.
  targeted.forEach(z => bits.push(
    `${z.r.label} at ${trendFmt(z.r.now, z.r)}, `
    + `${z.v.onTarget ? 'within' : 'above'} the ${trendFmt(z.r.target.max, z.r)} target`));
  return { head, detail: bits.join('. ') + (bits.length ? '.' : ''), tone };
}

/* Mouvement par domaine. Le total peut être stable pendant qu'un domaine
   décroche : c'est le niveau auquel une décision se prend. */
function domainMoveRows(data) {
  return Object.entries(data.domain_move || {})
    .map(([d, v]) => ({ domain: d, now: v.now || 0, was: v.was || 0,
                        diff: (v.now || 0) - (v.was || 0) }))
    // Les plus gros mouvements d'abord, dans un sens comme dans l'autre.
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || b.now - a.now)
    .filter(r => r.now || r.was);
}

/* ── Sections paginées ────────────────────────────────────────
   Quatre sections portent des listes de longueur libre : observations,
   risques, ruptures SLA et plan d'action. Elles étaient coupées à un
   nombre de lignes fixe, avec un « + N more » qui obligeait à rouvrir
   l'outil. Elles sont désormais découpées en pages.

   Les lignes sont construites ici, une seule fois : le décompte des
   slides et leur rendu doivent partir des mêmes données, sinon la
   numérotation « n / total » ment. */
// Au-delà de MAX_FO colonnes l'axe devient illisible : on découpe.
const MAX_FO = 12;
function paginateFo(fo) {
  const out = [];
  for (let i = 0; i < fo.length; i += MAX_FO) out.push(fo.slice(i, i + MAX_FO));
  return out.length ? out : [[]];
}

// Le deck est un rapport Sénégal. Tout ce qui porte explicitement un autre
// pays est écarté ici, en plus du filtrage côté serveur : les sections
// rédigées (highlights, risques) viennent du brouillon client, où rien
// n'empêchait de saisir une ligne « CI ».
//
// Un champ pays vide est conservé : c'est une saisie qui ne le renseigne
// pas, pas une donnée d'un autre pays.
// Périmètre du deck en cours de génération : 'SN' (défaut), 'CI' ou 'ALL'.
// Posé par buildWeeklyPptx à l'entrée ; la génération des slides est
// synchrone, deux decks ne se construisent donc pas en même temps.
let SCOPE = 'SN';
let VILLE = 'Dakar';
const NOMS_PAYS = { SN: ['SN', 'SENEGAL', 'SÉNÉGAL'], CI: ['CI', "COTE D'IVOIRE", "CÔTE D'IVOIRE", 'CIV'] };
function inScope(v) {
  if (SCOPE === 'ALL') return true;
  const c = String(v == null ? '' : v).trim().toUpperCase();
  return !c || (NOMS_PAYS[SCOPE] || [SCOPE]).includes(c);
}

function buildPagedSections(data, form = {}) {
  const tone = p => p === 'Critical' || p === 'High' ? 'alert'
                  : p === 'Medium' ? 'warn' : 'info';

  // Observations : celles saisies dans le rapport + le registre ouvert.
  /* Observations : deux sources pour un même objet — les lignes saisies
     dans le rapport (form.highlights) et le registre ouvert
     (data.observations_open). Une observation saisie des deux côtés
     sortait deux fois, sous deux mises en forme différentes, ce qui se
     lisait comme deux faits distincts.

     On dédoublonne sur le texte de l'observation, et une seule grammaire
     de ligne subsiste : priorité, impact, auteur. Elle est plus riche que
     l'autre (qui n'avait que priorité et statut) et c'est celle qui
     répond aux questions posées en revue. */
  const seenObs = new Set();
  const obsKey = t => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const obsRow = o => ({
    tag: orNA(o.source),
    title: o.observation || 'n/a',
    meta: [o.priority && `Priority ${o.priority}`,
           o.impact && `Impact: ${clip(o.impact)}`,
           (o.author || o.raised_by) && `Raised by ${o.author || o.raised_by}`,
           // Le statut ne figure que s'il n'est pas « Open » : sur une
           // slide d'observations ouvertes, le préciser partout est du
           // bruit.
           o.status && o.status !== 'Open' && `Status ${o.status}`]
      .filter(Boolean).join('   ·   ') || null,
    tone: tone(o.priority),
  });

  // Le registre passe en premier : il porte l'impact et l'auteur, donc en
  // cas de doublon c'est sa version qu'on veut conserver.
  const hl = (form.highlights || [])
    .filter(r => r && r.observation && inScope(r.source));
  const observations = [
    ...(data.observations_open || []).filter(o => o && o.observation && inScope(o.source)),
    ...hl,
  ].filter(o => {
    const k = obsKey(o.observation);
    if (!k || seenObs.has(k)) return false;
    seenObs.add(k);
    return true;
  }).map(obsRow);

  /* Motif d'inscription d'un risque auto-détecté.

     Ces lignes ne sont pas saisies par un agent : l'application les ajoute
     seule, sur deux critères. Le deck n'affichait que le n° de ticket, si
     bien qu'en revue la question tombait à chaque fois — « pourquoi cette
     ligne est-elle un risque ? ». Le motif est porté par `_autoType`, et
     `_timeLeft` en donne la mesure (temps restant avant rupture, ou date
     d'ouverture pour un ticket qui traîne).

     Les lignes saisies à la main n'en portent pas : leur description dit
     déjà pourquoi elles sont là. */
  const riskWhy = r => {
    if (!r._auto) return null;
    const when = String(r._timeLeft || '').trim();
    if (r._autoType === 'near-breach') {
      return when ? `Near breach — ${when} left before the SLA target`
                  : 'Near breach — less than 20% of the SLA window left';
    }
    if (r._autoType === 'long-open') {
      return when ? `P1/P2 still open — ${when}`
                  : 'P1/P2 ticket open beyond the expected handling time';
    }
    return 'Flagged automatically from the tracker';
  };

  const risks = (form.risks || [])
    .filter(r => r && (r.description || r.fo || r.bo))
    .filter(r => inScope(r.country || r.site || r.source))
    .map(r => ({
      title: r.description || 'n/a',
      meta: [r.priority && `Priority ${r.priority}`, r.status && `Status ${r.status}`]
        .filter(Boolean).join('   ·   ') || null,
      pills: [
        { label: 'FO', value: String(r.fo || '').trim() },
        { label: 'BO', value: String(r.bo || '').trim() },
      ],
      // Réutilise le bloc « update » de la liste : même gabarit, même
      // place. Le libellé change pour dire ce que la ligne porte.
      update: (() => {
        const why = riskWhy(r);
        return why ? { text: why, label: 'WHY', missing: false } : null;
      })(),
      tone: tone(r.priority),
    }));

  const breaches = (data.active_tickets || [])
    .filter(t => t.sla_status === 'Breach')
    // `tracker` est posé par allEnriched() : 'SN' ou 'CI'.
    .filter(t => inScope(t.tracker || t.country))
    .sort((a, b) => new Date(a.open_date) - new Date(b.open_date))
    .map(t => ({
      tag: orNA(t.sn_tt || t.id),
      title: t.title ? clip(t.title) : `${orNA(t.domain)} / ${orNA(t.status)}`,
      meta: [t.priority && `Priority ${t.priority}`,
             t.domain && `Domain ${t.domain}`,
             t.open_date && `Opened ${fmtDate(t.open_date)}`]
        .filter(Boolean).join('   ·   '),
      pills: [
        { label: 'FO', value: String(t.assigned_to || t.fo_owner || '').trim() },
        { label: 'BO', value: String(t.bo_handling || '').trim() },
      ],
      /* Le point d'avancement du ticket. C'est l'information que la revue
         cherche sur cette slide : un ticket hors SLA sans mention de ce
         qui est fait pour le refermer oblige à rouvrir le tracker en
         séance.

         Trois sources, par ordre de précision décroissante :
           · update_action — l'action en cours, écrite pour ça ;
           · comments      — le commentaire libre de l'agent ;
           · root_cause    — à défaut d'action, au moins la cause connue.
         On ne concatène pas : deux champs mis bout à bout dépassent la
         ligne et le second devient illisible. Le plus précis l'emporte.

         Silence explicite quand rien n'est saisi : « no update recorded »
         est une information de pilotage (le ticket n'est pas suivi), une
         ligne vide n'en est pas une. */
      update: (() => {
        const src = [t.update_action, t.comments, t.root_cause]
          .map(v => String(v || '').trim()).find(Boolean);
        return src ? { text: src, missing: false }
                   : { text: 'No update recorded for this ticket.', missing: true };
      })(),
      // Toutes ces lignes sont hors SLA : le liseré est rouge partout.
      tone: 'alert',
    }));

  /* Achievements : ce que les agents déclarent avoir terminé cette
     semaine (Weekly Progress, statut Done). Un agent saisit souvent
     plusieurs lignes ; elles sont regroupées sous son nom et concaténées,
     sinon la slide devient une liste de fragments sans auteur lisible. */
  const wp = (data.weekly_progress || []).filter(p => p && p.task);
  const byAgent = new Map();
  wp.filter(p => p.status === 'Done').forEach(p => {
    const who = String(p.modified_by || '').trim() || 'Unattributed';
    if (!byAgent.has(who)) byAgent.set(who, []);
    byAgent.get(who).push(String(p.task).trim());
  });
  const ranked = [...byAgent.entries()]
    // Le plus productif en tête : la slide s'ouvre sur la contribution la
    // plus lourde plutôt que sur l'ordre de saisie.
    .sort((a, b) => b[1].length - a[1].length);

  /* Kudos : la personne qui a bouclé le plus d'items sur la semaine.

     Deux garde-fous, parce qu'une mise en avant injuste vaut moins que
     pas de mise en avant du tout :
       · en cas d'égalité en tête, on nomme tout le monde plutôt que de
         désigner arbitrairement le premier de la liste ;
       · sous deux items, on n'affiche rien : féliciter quelqu'un pour un
         unique item quand personne d'autre n'a saisi ne récompense pas
         un effort, ça récompense une saisie.

     `Unattributed` est exclu : c'est un défaut de saisie, pas une
     personne. */
  const top = ranked.filter(([who]) => who !== 'Unattributed');
  const best = top.length ? top[0][1].length : 0;
  const winners = best >= 2 ? top.filter(([, t]) => t.length === best) : [];
  const kudos = winners.length ? {
    names: winners.map(([who]) => who),
    count: best,
    // Le total de l'équipe situe la performance : « 5 items » ne dit rien
    // sans savoir que la semaine en comptait 12.
    total: ranked.reduce((n, [, t]) => n + t.length, 0),
  } : null;

  const achievements = ranked.map(([who, tasks]) => ({
    tag: who,
    title: tasks.join('  ·  '),
    meta: `${tasks.length} item(s) completed`,
    tone: 'good',
    // Marque la ligne du ou des lauréats : le bandeau les nomme, le
    // liseré les retrouve dans la liste.
    kudos: winners.some(([w]) => w === who),
  }));

  /* Plan : les engagements rédigés dans le rapport, complétés par ce qui
     reste ouvert au Weekly Progress (In Progress et Planned). Ces tâches
     sont déjà des engagements pris — les omettre du plan faisait un plan
     incomplet, et obligeait à ressaisir la même chose à la main. */
  const carried = wp
    .filter(p => p.status === 'In Progress' || p.status === 'Planned')
    // In Progress avant Planned : ce qui est commencé passe en premier.
    .sort((a, b) => (a.status === 'In Progress' ? 0 : 1) - (b.status === 'In Progress' ? 0 : 1))
    .map(p => ({
      text: String(p.task).trim(),
      owner: p.modified_by || '',
      // Pas d'échéance sur ces lignes : le Weekly Progress n'en porte pas.
      // `eta` vide s'affiche « no date set », ce qui est exact.
      eta: '',
      // Le statut voyage dans le libellé du porteur : c'est l'information
      // qui distingue une tâche entamée d'une tâche seulement prévue.
      status: p.status,
      tone: p.status === 'In Progress' ? 'warn' : 'info',
    }));

  const actions = [
    ...(form.actions || [])
      .filter(r => r && (r.action || r.owner))
      .map(r => ({
        text: r.action || 'n/a', owner: r.owner, eta: r.eta, tone: tone(r.priority),
      })),
    ...carried,
  ];

  // Les hauteurs de ligne doivent correspondre à celles utilisées au
  // rendu, sinon le total et la réalité divergent.
  return {
    observations: paginateRows(observations, 1.95, 0.82),
    /* Les risques n'ont besoin de la hauteur augmentée que si au moins
       une ligne porte un motif auto-détecté. Une liste entièrement
       saisie à la main garde les lignes serrées d'origine, et donc le
       même nombre de lignes par page qu'avant. */
    risks:        paginateRows(risks,        1.95,
                    risks.some(r => r.update) ? BREACH_ROW_H : 0.82),
    // Les breaches portent une ligne de plus (le point d'avancement) : la
    // hauteur de ligne est augmentée d'autant, ici comme au rendu. Les deux
    // valeurs doivent rester égales, sinon la pagination promet des lignes
    // qui débordent sous le pied de page.
    breaches:     paginateRows(breaches,     1.95, BREACH_ROW_H),
    actions:      paginateRows(actions,      1.98, 0.92),
    achievements: paginateRows(achievements,  1.95, 0.86),
    fo:           paginateFo(Object.entries(data.by_fo || {})
                    .filter(([, v]) => v.open || v.resolved || v.breach)),
    // Hors sections paginées : porté à part pour ne pas fausser le
    // décompte des pages, qui n'itère que sur des tableaux.
    _kudos: kudos,
  };
}


// Réduit le jeu de données au seul périmètre Sénégal. Le serveur le fait
// déjà (buildWeeklyReport est appelé avec 'SN'), mais l'export accepte
// aussi un appel direct à l'API : sans cette reprise, un `data` construit
// en 'ALL' produirait un deck estampillé Dakar contenant des tickets CI.
function scopeToSenegal(data) {
  if (SCOPE === 'ALL') return { ...(data || {}) };
  const d = { ...(data || {}) };
  const keep = t => inScope(t && (t.tracker || t.country));

  d.week_tickets   = (d.week_tickets   || []).filter(keep);
  d.active_tickets = (d.active_tickets || []).filter(keep);
  d.observations_open = (d.observations_open || [])
    .filter(o => inScope(o && o.source));
  d.weekly_progress = (d.weekly_progress || [])
    .filter(p => inScope(p && p.tracker));

  // by_fo est un agrégat calculé côté serveur sur l'ensemble des tickets,
  // historique compris — on ne peut donc pas le recomposer depuis les
  // seuls tickets de la semaine sans perdre les agents dont l'activité est
  // entièrement soldée. On le restreint plutôt aux agents du roster FO,
  // qui est déjà le roster Sénégal.
  // Hors Sénégal, le roster est celui des agents rattachés au pays
  // (fo_trackers) : fo_list est la liste de l'équipe de Dakar.
  const parPays = Object.entries(d.fo_trackers || {})
    .filter(([, tr]) => [].concat(tr).map(x => String(x).toUpperCase()).includes(SCOPE)).map(([n]) => n);
  const roster = new Set((SCOPE === 'SN' ? (d.fo_list || []) : parPays).map(n => String(n).trim()));
  if (roster.size) {
    d.by_fo = Object.fromEntries(
      Object.entries(d.by_fo || {}).filter(([fo]) => roster.has(String(fo).trim())));
  }
  return d;
}

/* ── Génération ───────────────────────────────────────────────
   `data`  : réponse de /api/reports/weekly
   `form`  : sections rédigées côté client {author, site, highlights,
             risks, actions, notes} ; facultatif. */
async function buildWeeklyPptx(rawData, form = {}) {
  // Périmètre Sénégal appliqué une fois, à l'entrée : toutes les lectures
  // en aval (KPI, graphiques, listes) partent donc d'un jeu déjà filtré,
  // plutôt que de dépendre d'un filtre répété à chaque point d'usage.
  SCOPE = ['SN', 'CI', 'ALL'].includes(form.country) ? form.country : 'SN';
  VILLE = { SN: 'Dakar', CI: 'Abidjan', ALL: 'Dakar + Abidjan' }[SCOPE];
  const data = scopeToSenegal({ ...(rawData || {}), fo_trackers: (rawData && rawData.fo_trackers) || form.fo_trackers || {} });

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';           // 13.33 x 7.5 pouces
  pptx.author  = form.author || 'EMOC Front Office';
  pptx.company = 'EMOC';
  pptx.title   = 'EMOC Weekly Report';

  const k   = data.kpis || {};
  const period = `${fmtDate(data.week_start)} to ${fmtDate(data.week_end)}`;
  // Le total n'est plus constant : les listes longues débordent sur des
  // slides de continuation au lieu d'être tronquées, donc le nombre de
  // pages dépend des données. Il est calculé avant la construction —
  // 13 slides numérotées de base, plus une par page de continuation.
  //
  // Les jeux de lignes sont préparés ici pour que le compte et le rendu
  // partent exactement des mêmes données.
  const PAGED = buildPagedSections(data, form);
  // Semaine sans activité : expliquée partout où un zéro s'affiche.
  const Q = quietWeek(data);
  const why = t => (Q ? 'Quiet week: no ticket opened or closed. ' : '') + t;

  /* Le deck sortait 15 slides numérotées quoi qu'il arrive : une semaine
     sans risque déclaré, sans dépassement et sans action produisait trois
     pages dont le seul contenu était « rien à signaler ». Sur un document
     qu'on diffuse, ces pages coûtent la lecture sans rien apprendre, et
     donnent un deck plus épais que la semaine ne le justifie.

     Les sections de contenu sont donc omises quand elles sont vides. Deux
     conséquences à tenir :

     1. Le total n'est plus connu à l'avance. On numérote donc APRÈS coup :
        chaque slide est empilée avec la fonction qui posera son pied, et
        le pied n'est écrit qu'une fois le deck complet — sinon « 4 / 15 »
        s'imprimerait sur un deck de 11 pages.

     2. Le squelette reste : couverture, synthèse, faits marquants,
        répartitions, qualité de service, performance FO, intercalaire,
        commentaire, remerciement. Ce sont les pages qui portent le sens
        du rapport, y compris quand elles disent zéro — un « 0 hors SLA »
        est une information, l'absence de la page ne l'est pas. */
  const pieds = [];
  // `encre` permet aux slides en aplat sombre ou de marque de garder leur
  // propre couleur de pied : slideFooter() compose en encre sombre, qui
  // disparaîtrait sur ces fonds.
  const differerPied = (slide, encre) => { pieds.push({ slide, encre }); };
  let page = 0;

  /* Slide 1 : couverture.
     Aplat teinté froid pleine page, titre surdimensionné ferré à gauche,
     et les quatre chiffres de la semaine en colonnes séparées de filets
     fins — la structure de la maquette de référence. */
  const cover = pptx.addSlide();
  cover.background = { color: C.wash };

  // Colonne gauche : le contexte, en petit corps, haut de page.
  cover.addText(`EMOC · Front Office · ${VILLE}`, {
    x: M, y: 0.72, w: 5.2, h: 0.24,
    fontSize: 10, color: '4A6169', fontFace: FONT,
  });
  cover.addText(
    'Weekly activity report covering tickets opened and closed, service-level '
    + 'performance, workload per agent, and the risks carried into next week.', {
    x: M, y: 1.1, w: 5.2, h: 1.3,
    fontSize: 13, color: '3E555C', fontFace: FONT,
    valign: 'top', lineSpacingMultiple: 1.4,
  });

  // Filet vertical de séparation, comme la maquette : il coupe la page et
  // pousse le titre dans le quadrant bas-droit.
  cover.addShape('rect', {
    x: 6.66, y: 0, w: 0.008, h: 7.5,
    fill: { color: '9FB8C0' }, line: { type: 'none' },
  });
  cover.addShape('ellipse', {
    x: 6.615, y: 4.02, w: 0.1, h: 0.1,
    fill: { color: C.brand }, line: { type: 'none' },
  });

  // Titre surdimensionné, ferré à gauche du filet, dans le bas de page.
  cover.addText('Weekly\nReport', {
    x: 7.15, y: 3.42, w: CW - 6.43, h: 2.0,
    fontSize: 52, bold: true, color: C.ink, fontFace: FONT,
    valign: 'top', lineSpacingMultiple: 1.02,
  });
  cover.addText(period, {
    x: 7.18, y: 5.52, w: CW - 6.46, h: 0.3,
    fontSize: 13, color: '3E555C', fontFace: FONT,
  });

  // Semaine calme : annoncée dès la couverture, pour que le lecteur
  // n'aborde pas les zéros des pages suivantes comme une anomalie.
  if (Q) {
    cover.addShape('roundRect', {
      x: M, y: 2.6, w: 5.2, h: 1.45, rectRadius: 0.1,
      // Supervision en cause : encadré de vigilance, pas un simple constat.
      fill: { color: Q.visibility_risk ? 'FEF7E0' : 'FFFFFF' },
      line: { color: Q.visibility_risk ? 'E0B252' : '9FB8C0', width: 0.75 },
    });
    cover.addText([
      { text: Q.title, options: { bold: true, fontSize: 12.5, color: C.ink, breakLine: true } },
      { text: Q.lead, options: { fontSize: 10.5, color: '3E555C' } },
    ], {
      x: M + 0.22, y: 2.72, w: 4.76, h: 1.21, fontFace: FONT,
      valign: 'top', lineSpacingMultiple: 1.3,
    });
  }

  // Signature en pied de la colonne gauche, alignée sur le titre.
  cover.addShape('rect', {
    x: M, y: 5.6, w: 1.4, h: 0.026,
    fill: { color: '9FB8C0' }, line: { type: 'none' },
  });
  cover.addText(form.author || 'Front Office Team', {
    x: M, y: 5.78, w: 5.2, h: 0.26,
    fontSize: 11.5, bold: true, color: C.ink, fontFace: FONT,
  });
  cover.addText('Internal distribution', {
    x: M, y: 6.04, w: 5.2, h: 0.24,
    fontSize: 9.5, color: '4A6169', fontFace: FONT,
  });

  /* Slide 2 : synthèse KPI + faits marquants */
  const s2 = pptx.addSlide();
  slideHeader(s2, 'What the week shows\nin numbers', period, 'Overview');

  {
    // Trois cartes pleine hauteur portent la slide : le flux de la
    // semaine, la tenue du SLA, l'encours restant. Ce sont les trois
    // questions posées en revue, dans cet ordre. Les métriques
    // secondaires passent en rang filetée sous les cartes — elles
    // restent dans le deck sans disputer l'attention aux trois grandes.
    //
    // Net = clôturés moins ouverts, porté par la carte de flux : c'est
    // la lecture qui compte, pas les deux volumes pris séparément.
    const opened = k.opened_this_week   ?? 0;
    const closed = k.resolved_this_week ?? 0;
    const net    = closed - opened;
    const sla    = k.sla_compliance;

    // La carte SLA prend la couleur de son état : c'est la seule des
    // trois qui porte un jugement, et l'aplat le dit avant le chiffre.
    // Les deux autres restent neutres — un mur de couleur annulerait le
    // signal.
    const slaFill = sla == null ? C.bgSoft
                  : sla >= 95 ? C.greenSoft : sla < 85 ? C.redSoft : C.amberSoft;
    const slaOn   = sla == null ? C.ink
                  : sla >= 95 ? '0B5C28' : sla < 85 ? '8C1D16' : '7A5200';

    const cardY = 1.86;
    const cardH = 4.24;
    const gap   = 0.26;
    const cardW = (CW - gap * 2) / 3;

    metricCard(s2, {
      x: M, y: cardY, w: cardW, h: cardH,
      value: opened, label: 'Tickets opened',
      note: closed || opened
        ? `${closed} closed over the same period, a net ${net >= 0 ? '+' : ''}${net}.`
        : 'No intake recorded for this period.',
      fill: C.bgSoft, on: C.ink, onMute: C.mute, align: 'bottom',
    });

    metricCard(s2, {
      x: M + cardW + gap, y: cardY, w: cardW, h: cardH,
      // "opened this week" est explicite à dessein : la slide de faits
      // marquants compte les breaches encore ouverts toutes semaines
      // confondues, un total différent. Sans la précision, les deux
      // chiffres se lisent comme une contradiction.
      kicker: (k.breach ?? 0) > 0
        ? `${k.breach} breach(es) opened this week. The figure below is the week's compliance, not its absence.`
        : 'No SLA breach opened this week.',
      value: sla == null ? 'n/a' : `${sla}%`,
      label: 'SLA compliance',
      note: 'Share of tickets in the period meeting their target.',
      fill: slaFill, on: slaOn, onMute: sla == null ? C.mute : slaOn,
      align: 'bottom',
    });

    // Troisième carte en aplat de marque plein : elle ferme la rangée
    // comme le violet ferme celle de la référence. Texte clair dessus.
    metricCard(s2, {
      x: M + (cardW + gap) * 2, y: cardY, w: cardW, h: cardH,
      value: k.overall_open ?? 0, label: 'Open backlog',
      note: `Out of ${k.overall_total ?? 0} ticket(s) on record, all statuses.`,
      fill: C.brand, on: 'FFFFFF', onMute: 'F6D3D9', align: 'bottom',
    });

    /* Rang secondaire : les métriques que les cartes ne portent pas.
       Colonnes filetées, même vocabulaire que le reste du deck, à une
       échelle qui les tient au second plan. */
    const wk    = data.week_tickets || [];
    const rated = wk.filter(t => t.sla_status && !['N/A', 'On Hold'].includes(t.sla_status));
    const p12   = wk.length
      ? Math.round((wk.filter(t => ['P1', 'P2'].includes(t.priority)).length / wk.length) * 100)
      : null;

    // Une seule ligne de texte par métrique, séparées par des filets
    // verticaux : cinq colonnes à deux étages donnaient des micro-cartes
    // écrasées en pied de slide. Ici la valeur et son libellé se lisent
    // d'un trait, comme une ligne de résumé.
    const sec = [
      { label: 'Closed',      value: String(closed),
        note: `net ${net >= 0 ? '+' : ''}${net}` },
      { label: 'SLA breaches', value: String(k.breach ?? 0),
        tone: (k.breach ?? 0) > 0 ? 'alert' : undefined },
      { label: 'MTTR', value: fmtDur(k.mttr_ms) },
      // MTTD est la seule colonne jugée contre une cible chiffrée (5 min) :
      // elle est surlignée en vert quand la cible est tenue, en rouge sinon.
      // La note rappelle la cible, sinon la couleur est un verdict sans
      // critère affiché.
      { label: 'MTTD', value: fmtDur(k.mttd_ms),
        tone: mttdTone(k.mttd_ms), highlight: true,
        note: mttdTone(k.mttd_ms) == null ? 'target 5 min · not measured'
            : mttdTone(k.mttd_ms) === 'good' ? 'target 5 min · met'
            : 'target 5 min · missed' },
      { label: 'P1/P2 share', value: p12 == null ? 'n/a' : `${p12}%`,
        note: `${rated.length}/${wk.length} rated` },
    ];
    const secW = CW / sec.length;
    s2.addShape('rect', {
      x: M, y: 6.3, w: CW, h: 0.01,
      fill: { color: C.line }, line: { type: 'none' },
    });
    sec.forEach((t, i) => {
      const x = M + i * secW;
      // Filet séparateur entre colonnes, pas devant la première.
      if (i > 0) {
        s2.addShape('rect', {
          x, y: 6.46, w: 0.008, h: 0.34,
          fill: { color: C.line }, line: { type: 'none' },
        });
      }
      // Colonne jugée contre une cible : aplat teinté derrière la valeur.
      // Le texte seul en couleur se perd dans une rangée de cinq colonnes,
      // l'aplat se repère d'un coup d'œil depuis le fond de la salle.
      if (t.highlight && t.tone) {
        s2.addShape('roundRect', {
          x: x + (i > 0 ? 0.14 : -0.06), y: 6.4, w: secW - 0.16, h: 0.46,
          rectRadius: 0.08,
          fill: { color: t.tone === 'good' ? C.greenSoft : C.redSoft },
          line: { type: 'none' },
        });
      }
      s2.addText([
        { text: t.value, options: {
            bold: true, fontSize: 15,
            color: t.tone === 'alert' ? C.red : t.tone === 'good' ? C.green : C.ink } },
        { text: `  ${t.label}`, options: { fontSize: 9.5, color: C.mute } },
        ...(t.note ? [{ text: `  ${t.note}`, options: { fontSize: 9.5, color: C.faint } }] : []),
      ], {
        x: x + (i > 0 ? 0.2 : 0), y: 6.44, w: secW - 0.22, h: 0.38,
        fontFace: FONT, valign: 'middle',
      });
    });

    // Semaine creuse : les cartes affichent zéro, mais un zéro ne dit pas
    // s'il est mesuré ou manquant. La note le dit, posée sur la carte de
    // flux qui est la plus neutre des trois.
    if (Q) {
      // Semaine calme : la carte de flux, la plus neutre, porte
      // l'explication — les trois zéros se lisent alors comme un constat.
      s2.addText([
        { text: Q.title, options: { bold: true, fontSize: 11.5, color: C.ink, breakLine: true } },
        { text: Q.lead, options: { fontSize: 9.5, color: C.mute } },
      ], {
        x: M + 0.3, y: cardY + 0.28, w: cardW - 0.6, h: 1.9,
        fontFace: FONT, valign: 'top', lineSpacingMultiple: 1.3,
      });
    } else if (!deriveHighlights(data).length) {
      s2.addText('No activity recorded for this period.', {
        x: M + 0.34, y: cardY + 0.3, w: cardW - 0.68, h: 0.4,
        fontSize: 9.5, italic: true, color: C.faint, fontFace: FONT,
      });
    }
  }
  differerPied(s2);

  /* Slide 3 : faits marquants déduits.
     Les cartes de l'Overview donnent les chiffres ; cette slide dit ce
     qu'ils signifient. Elle vivait en bande basse de l'Overview, où les
     lignes se serraient à quatre maximum — seule, elle les prend toutes
     et les laisse respirer. */
  const sHi = pptx.addSlide();
  {
    // Slide sombre, à contre-emploi du reste du deck : un chiffre
    // surdimensionné à gauche, le texte qui l'explique à droite, et une
    // rangée de disques qui matérialise la proportion. La rupture de fond
    // signale au lecteur que cette page porte le message, pas des données.
    const INK  = '15161A';
    const ON   = 'FFFFFF';
    const MUTE = 'A8ACB5';
    sHi.background = { color: INK };
    sHi.addText('Key highlights', {
      x: M, y: 0.5, w: 6, h: 0.24,
      fontSize: 9.5, color: MUTE, fontFace: FONT,
    });

    const wk2   = data.week_tickets || [];
    const sla   = k.sla_compliance;
    const total = wk2.length;
    const inSla = wk2.filter(t => t.sla_status === 'In SLA').length;

    // Le chiffre héros est la conformité SLA : c'est la question posée en
    // revue. À défaut (aucun SLA mesuré), on retombe sur le volume, qui
    // existe toujours.
    const heroVal  = sla != null ? String(sla) : String(total);
    const heroUnit = sla != null ? '%' : '';
    const heroText = Q ? Q.lead : sla != null
      ? `${inSla} of ${total} ticket(s) opened this week were resolved within their `
        + `service-level target. `
        + ((k.breach ?? 0) > 0
            ? `${k.breach} breached and now ${k.breach === 1 ? 'sits' : 'sit'} on the `
              + `remediation list.`
            : `No breach was recorded over the period.`)
      : `${total} ticket(s) were opened this week. None of them carries a service-level `
        + `target, so no compliance figure can be computed for the period.`;

    // Le corps s'adapte à la longueur ET tient dans sa boîte, en hauteur
    // comme en largeur. La contrainte de largeur manquait : à « 100 » sur
    // trois chiffres plus le « % », le bloc dépassait la moitié de la
    // slide et poussait le texte explicatif hors marge.
    //
    // Largeur allouée au chiffre + son unité : on s'arrête à 4,3 in pour
    // que le paragraphe garde une colonne lisible à droite.
    const HERO_BOX = 1.9;                       // hauteur de la boîte, en pouces
    const HERO_MAXW = 4.3;                      // largeur max chiffre + unité
    const HERO_MAX = Math.floor(HERO_BOX / 1.2 * 72);   // = 114pt
    // Avance d'un chiffre en Arial = 0,556 em ; l'unité « % » est composée
    // à 0,36 × le corps. La largeur totale est donc une fonction du corps,
    // qu'on inverse pour trouver le plus grand corps qui tienne.
    const heroEm  = heroVal.length * 0.556 + (heroUnit ? 0.36 * 0.95 + 0.14 : 0);
    const HERO_FIT = Math.floor(HERO_MAXW / heroEm * 72);
    const HERO_PT  = Math.min(HERO_MAX, HERO_FIT, heroVal.length >= 3 ? 92 : 114);
    // Avance d'un chiffre en Arial = 0,556 em. C'est cette mesure, et non
    // une constante devinée, qui place l'unité : avec une approximation,
    // le "%" chevauchait la valeur à trois chiffres.
    const digitW  = 0.556 * HERO_PT / 72;
    const heroX   = M - 0.14;
    const heroW   = heroVal.length * digitW;

    // La boîte fait exactement la largeur des glyphes : toute marge ici se
    // superposerait à l'unité placée juste après.
    // Marge à droite : une boîte au pixel près fait passer « 40 » sur deux
    // lignes dans Keynote. Aligné à gauche, l'excédent ne se voit pas.
    sHi.addText(heroVal, {
      x: heroX, y: 1.05, w: heroW + 0.35, h: HERO_BOX, fit: 'none', wrap: false,
      fontSize: HERO_PT, color: ON, fontFace: FONT,
      valign: 'middle', align: 'left',
    });
    if (heroUnit) {
      sHi.addText(heroUnit, {
        x: heroX + heroW + 0.1, y: 1.02, w: 1.1, h: 0.72,
        fontSize: Math.round(HERO_PT * 0.36), color: ON, fontFace: FONT,
        valign: 'top',
      });
    }
    // Le texte démarre après le chiffre et son unité, jamais en dur : sur
    // une valeur longue il serait passé dessous.
    const textX = Math.max(5.55, heroX + heroW + (heroUnit ? 1.15 : 0.5));
    sHi.addText(heroText, {
      x: textX, y: 1.32, w: M + CW - textX, h: 1.5,
      fontSize: 12.5, color: ON, fontFace: FONT,
      valign: 'top', lineSpacingMultiple: 1.42,
    });

    // Les constats déduits, en pleine largeur : c'est le contenu de la
    // slide, pas une note de bas de page. La rangée de disques a été
    // retirée — à 100 % de conformité les dix disques se remplissaient et
    // formaient une bande rouge pleine, qui ne portait aucune information.
    // Semaine calme : les constats sont le contexte mesuré qui explique
    // l'absence d'activité, pas une liste vide.
    const derived = Q ? Q.points.map(t => ({ text: t, tone: 'info' })) : deriveHighlights(data);
    if (!derived.length) {
      sHi.addText('No activity recorded for this period: no tickets opened, closed or '
                + 'in progress. Nothing to report for this week.', {
        x: M, y: 3.5, w: CW, h: 0.5,
        fontSize: 12, italic: true, color: MUTE, fontFace: FONT,
      });
    } else {
      // Le bloc d'observations ayant quitté cette slide, les constats
      // disposent de toute la hauteur jusqu'au filet de pied. Le nombre de
      // lignes est calculé depuis FLOOR, pas fixé à la main.
      const HI_TOP = 3.34, HI_H = 0.46;
      const hiCap  = Math.max(1, Math.floor((FLOOR + 0.35 - HI_TOP) / HI_H));
      derived.slice(0, hiCap).forEach((h, i) => {
        const cy = HI_TOP + i * HI_H;
        const col = h.tone === 'alert' ? C.red : h.tone === 'warn' ? C.amber
                  : h.tone === 'good' ? C.green : C.brand;
        sHi.addShape('rect', {
          x: M, y: cy + 0.14, w: 0.16, h: 0.04,
          fill: { color: col }, line: { type: 'none' },
        });
        sHi.addText(clip(h.text), {
          x: M + 0.34, y: cy, w: CW - 0.34, h: 0.38,
          fontSize: fitPt(h.text, 132, 11.5), color: 'D8DBE0', valign: 'middle', fontFace: FONT,
        });
      });
    }

    // Le bloc « Open observations » vivait ici en pied de slide, en corps 9
    // sur deux colonnes. Il a été retiré : cette page porte les constats
    // déduits, et les observations ont leur propre slide dédiée
    // ("Observations logged by the team"), qui les rend en entier.

    // Mention de pied posée par la numérotation différée (encre de la slide).
    // Numéro posé après coup, comme les autres : le total n'est connu
    // qu'une fois les sections vides écartées. On garde ici l'encre
    // claire de la slide, que slideFooter() ne saurait pas deviner.
    differerPied(sHi, { on: ON, mute: '6B6F78' });
  }

  /* Slide de tendance : la semaine comparée à la précédente.
     Placée juste après les constats, avant les découpages détaillés :
     « est-ce que ça s'améliore ? » se pose avant « où exactement ».

     Trois étages, du général au particulier :
       1. une phrase de synthèse — le verdict de la semaine ;
       2. six indicateurs datés, chacun avec sa courbe sur 8 semaines ;
       3. le mouvement par domaine, là où se prend la décision. */
  {
    const sTr = pptx.addSlide();
    const pStart = data.prev_week_start, pEnd = data.prev_week_end;
    const prevLabel = pStart && pEnd
      ? `vs ${fmtDate(pStart)} to ${fmtDate(pEnd)}` : 'vs previous week';
    slideHeader(sTr, 'How this week moved\nagainst the last', prevLabel, 'Trend');

    const rows = trendRows(data);
    // Sans semaine de référence, la slide le dit plutôt que d'afficher des
    // écarts calculés contre zéro, qui se liraient comme un effondrement.
    const hasBaseline = rows.some(r => r.was != null && !isNaN(r.was));

    if (!hasBaseline) {
      emptyNote(sTr, 'No comparable activity in the previous week, so no trend can be '
                   + 'computed for this period.', { x: M, y: 1.95, w: CW, h: 1.0 });
      differerPied(sTr);
    } else {
      /* 1. Bandeau de synthèse. Une revue lit d'abord le verdict ; le
         détail sert à le contester, pas à le construire. */
      const sum = trendSummary(rows);
      let top = 1.9;
      if (sum) {
        const bg = sum.tone === 'good' ? C.greenSoft
                 : sum.tone === 'alert' ? C.redSoft : C.amberSoft;
        const fg = sum.tone === 'good' ? '0B5C28'
                 : sum.tone === 'alert' ? '8C1D16' : '7A5200';
        // La phrase de détail peut passer sur deux lignes selon les
        // métriques nommées : le bandeau est dimensionné pour, sinon le
        // texte déborde sur la légende posée juste dessous.
        // Le bandeau garde une hauteur fixe : la phrase est composée pour
        // y tenir (deux lignes au plus à 8,5 pt). Le laisser grandir
        // repoussait le bloc par domaine sous le plancher, où il était
        // purement et simplement omis.
        const detailLong = clip(sum.detail).length > 92;
        const bandH = 0.66;
        sTr.addShape('rect', {
          x: M, y: top, w: CW, h: bandH, fill: { color: bg }, line: { type: 'none' },
        });
        sTr.addText(sum.head, {
          x: M + 0.26, y: top + 0.04, w: CW - 0.52, h: 0.26,
          fontSize: 12, bold: true, color: fg, fontFace: FONT, valign: 'middle',
        });
        sTr.addText(clip(sum.detail), {
          x: M + 0.26, y: top + 0.3, w: CW - 0.52, h: bandH - 0.34,
          fontSize: detailLong ? 8.5 : 9, color: fg, fontFace: FONT,
          valign: 'top', lineSpacingMultiple: 1.1,
        });
        top += bandH + 0.16;
      }

      /* 2. Les six indicateurs, avec leur courbe. */
      const LIST_H = 0.46;
      trendList(sTr, { rows, x: M, y: top, w: CW, rowH: LIST_H });
      const afterList = top + rows.length * LIST_H + 0.26;

      /* 3. Mouvement par domaine, en pied : un total stable peut cacher un
         domaine qui décroche, et c'est à ce niveau qu'on réaffecte. */
      // Le bloc par domaine occupe ~0,8 in (filet, titre, pastilles). On ne
      // le rend que s'il tient entièrement au-dessus du plancher : sur une
      // synthèse longue le bandeau grandit et la place manque, auquel cas
      // mieux vaut l'omettre que le faire déborder sur le pied de page.
      const dom = domainMoveRows(data);
      if (dom.length && afterList + 0.8 <= FLOOR) {
        sTr.addShape('rect', {
          x: M, y: afterList, w: CW, h: 0.008,
          fill: { color: C.line }, line: { type: 'none' },
        });
        sTr.addText('Where the volume moved, by domain', {
          x: M, y: afterList + 0.1, w: 5, h: 0.22,
          fontSize: 9, bold: true, color: C.mute, fontFace: FONT,
        });

        // Une pastille par domaine : nom, volume de la semaine, écart.
        const shown = dom.slice(0, 6);
        const cw = CW / shown.length;
        shown.forEach((d, i) => {
          const dx = M + i * cw;
          const dy = afterList + 0.32;
          // Pas d'avis moral sur le volume : plus de tickets sur un domaine
          // n'est pas « mauvais », c'est un déplacement de charge. On code
          // donc le sens, pas la valeur.
          sTr.addText(clip(d.domain), {
            x: dx, y: dy, w: cw - 0.12, h: 0.2,
            fontSize: 9, bold: true, color: C.ink, fontFace: FONT,
          });
          // Volume de la semaine et rappel de la semaine passée. L'écart
          // chiffré (« +3 ») est retiré : il se déduit des deux nombres
          // affichés, et sa pastille de couleur ajoutait un troisième
          // code visuel sur une ligne qui n'en demande pas.
          sTr.addText([
            { text: String(d.now), options: { fontSize: 14, bold: true, color: C.ink } },
            { text: `   was ${d.was}`, options: { fontSize: 8, color: C.faint } },
          ], {
            x: dx, y: dy + 0.18, w: cw - 0.12, h: 0.3,
            fontFace: FONT, valign: 'middle',
          });
        });
        if (dom.length > shown.length) {
          sTr.addText(`+ ${dom.length - shown.length} other domain(s)`, {
            x: M + CW - 2.2, y: afterList + 0.1, w: 2.2, h: 0.22,
            fontSize: 8, color: C.faint, align: 'right', fontFace: FONT,
          });
        }
      }

      differerPied(sTr);
    }
  }

  /* Slide 3 : tendance quotidienne.
     Le volume hebdomadaire ne dit pas si la charge s'est concentrée sur
     un jour ou étalée : cette courbe le montre. */
  const daily = dailySeries(data);
  const s3 = pptx.addSlide();
  slideHeader(s3, 'Where the week\'s load\nlanded, day by day', period, 'Volume');
  if (!daily.total && !daily.closed.some(Boolean)) {
    emptyNote(s3, why('No daily movement recorded for this week.'), { x: M, y: 1.9, w: CW, h: 1.0 });
  } else {
    const closedTotal = daily.closed.reduce((a, b) => a + b, 0);
    panel(s3, { x: M, y: 1.86, w: CW, h: 4.52,
      note: `${daily.total} opened · ${closedTotal} closed over the week` });
    groupedCols(s3, {
      x: M + 0.72, y: panel.contentY(1.86, true) + 0.16, w: CW - 1.1, h: 2.9,
      labels: daily.labels,
      series: [
        { label: 'Opened', color: C.brand, values: daily.opened },
        { label: 'Closed', color: C.green, values: daily.closed },
      ],
    });
    legend(s3, { x: M + 0.72, y: 5.95, w: 2.9, items: [
      { label: 'Opened', color: C.brand }, { label: 'Closed', color: C.green },
    ] });
  }
  differerPied(s3);

  /* Slide 4 : répartitions par domaine et priorité */
  const byDom  = Object.entries(data.by_domain   || {}).sort((a, b) => b[1] - a[1]);
  const byPrio = Object.entries(data.by_priority || {}).sort((a, b) => b[1] - a[1]);
  const s4 = pptx.addSlide();
  slideHeader(s4, 'Which domains and priorities\ndrove the volume', period, 'Distribution');
  if (byDom.length) {
    // Barres plutôt qu'un camembert : au-delà de 4 parts, comparer des
    // angles est moins précis que comparer des longueurs.
    panel(s4, { x: M, y: 1.86, w: 5.78, h: 4.52, title: 'By domain',
      note: `${byDom.length} domain(s) affected` });
    hBars(s4, {
      x: M + 0.36, y: panel.contentY(1.86, true), w: 5.06, h: 3.4, labelW: 1.42,
      rows: byDom.map(([d, v], i) => ({
        label: d, value: v, color: DOMAIN_C[i % DOMAIN_C.length],
      })),
    });
  } else {
    panel(s4, { x: M, y: 1.86, w: 5.78, h: 4.52, title: 'By domain' });
    emptyNote(s4, why('No tickets in this period.'),
      { x: M + 0.36, y: panel.contentY(1.86, false), w: 5.06, h: 0.9, fontSize: 11 });
  }

  if (byPrio.length) {
    // Barre de parts : la lecture attendue est la proportion de P1/P2,
    // et une longueur segmentée se compare mieux qu'un angle.
    const p12 = byPrio.filter(([p]) => ['P1', 'P2'].includes(p))
                      .reduce((a, [, v]) => a + v, 0);
    const tot = byPrio.reduce((a, [, v]) => a + v, 0);
    // Pas de note ici : le pavé d'accent en pied de colonne porte déjà le
    // ratio P1/P2. La note le répétait mot pour mot.
    panel(s4, { x: 6.83, y: 1.86, w: 5.78, h: 4.52, title: 'By priority' });
    shareBar(s4, {
      x: 7.19, y: panel.contentY(1.86, false), w: 5.06,
      rows: byPrio.map(([p, v], i) => ({
        label: p, value: v, color: PRIO_C[p] || DOMAIN_C[i % DOMAIN_C.length],
      })),
    });
    // Bloc d'accent saturé en pied de colonne, comme le pavé coloré de la
    // maquette : porte le chiffre que le lecteur doit retenir.
    const critical = Math.round((p12 / tot) * 100);
    s4.addShape('rect', {
      x: 7.19, y: 5.0, w: 5.06, h: 1.12,
      fill: { color: critical >= 50 ? C.brand : C.ink }, line: { type: 'none' },
    });
    s4.addText(`${critical}%`, {
      x: 7.5, y: 5.14, w: 2.2, h: 0.52,
      fontSize: 30, bold: true, color: 'FFFFFF', fontFace: FONT, valign: 'middle',
    });
    s4.addText(`of the week's tickets were P1 or P2`, {
      x: 7.5, y: 5.64, w: 4.4, h: 0.3,
      fontSize: 10.5, color: 'FFFFFF', fontFace: FONT, valign: 'middle',
    });
  } else {
    panel(s4, { x: 6.83, y: 1.86, w: 5.78, h: 4.52, title: 'By priority' });
    emptyNote(s4, why('No tickets in this period.'),
      { x: 7.19, y: panel.contentY(1.86, false), w: 5.06, h: 0.9, fontSize: 11 });
  }
  differerPied(s4);

  /* Slide 5 : qualité de service.
     Statuts de l'encours d'un côté, tenue des SLA de l'autre : deux
     lectures complémentaires de la même semaine. */
  const byStatus = statusSeries(data);
  const bySla    = slaSeries(data);
  const s5 = pptx.addSlide();
  slideHeader(s5, 'How the open workload\nand SLAs held up', period, 'Performance');

  if (byStatus.length) {
    const totOpen = byStatus.reduce((a, [, v]) => a + v, 0);
    panel(s5, { x: M, y: 1.86, w: 5.78, h: 4.52, title: 'Open workload by status',
      note: `${totOpen} ticket(s) currently open` });
    // Camembert : les statuts forment un tout dont on veut la composition
    // (part de l'encours encore à prendre en charge). Deux ou trois barres
    // laissaient les trois quarts du panneau vides.
    //
    // Le disque est resserré (2,3 → 1,9 in) et remonté : la place libérée
    // en bas de panneau porte la liste des tickets concernés.
    pieChart(s5, {
      // Le disque part sous le titre ET sa note : posé plus haut il
      // recouvrait le « n ticket(s) currently open » du panneau.
      cx: M + 0.42, cy: panel.contentY(1.86, true) + 0.04, d: 1.78,
      legendX: M + 2.86, legendW: 2.56,
      rows: byStatus.map(([s, v], i) => ({
        label: s, value: v, color: DOMAIN_C[i % DOMAIN_C.length],
      })),
    });

    /* « C'est quoi ces tickets ? » — le graphique donne la répartition,
       le tableau nomme les tickets. Extrait, pas inventaire : les plus
       prioritaires d'abord, puis les plus récents, et le reliquat est
       annoncé. */
    const open = (data.active_tickets || [])
      .slice()
      .sort((a, b) => {
        const pr = v => PRIO_RANK[v && v.priority] ?? 9;
        const d  = pr(a) - pr(b);
        if (d) return d;
        return new Date(b.open_date || 0) - new Date(a.open_date || 0);
      });
    if (open.length) {
      const TT_ROWS = 4;
      ticketTable(s5, {
        x: M + 0.36, y: 4.86, w: 5.06,
        total: open.length,
        rows: open.slice(0, TT_ROWS).map(t => ({
          tt:       t.sn_tt || t.imoc_tt || t.id,
          title:    t.title || `${orNA(t.domain)} / ${orNA(t.status)}`,
          domain:   t.domain,
          priority: t.priority,
          severity: t.severity,
        })),
      });
    }
  } else {
    panel(s5, { x: M, y: 1.86, w: 5.78, h: 4.52, title: 'Open workload by status' });
    emptyNote(s5, 'No tickets currently in progress.',
      { x: M + 0.36, y: panel.contentY(1.86, false), w: 5.06, h: 0.9, fontSize: 11 });
  }

  if (bySla.length) {
    // Couleurs sémantiques figées : vert tenu, ambre limite, rouge rompu.
    // Ne pas les tirer de la palette de domaines, qui n'a pas ce sens —
    // ni du rouge de marque, qui n'est pas un signal d'alerte.
    const SLA_C = { 'Within SLA': C.green, 'Near breach': C.amber, 'Breached': C.red };
    const slaTot = bySla.reduce((a, [, v]) => a + v, 0);
    const brk    = bySla.find(([l]) => l === 'Breached');
    panel(s5, { x: 6.83, y: 1.86, w: 5.78, h: 4.52, title: 'SLA outcome',
      note: brk ? `${brk[1]} of ${slaTot} SLA-bearing ticket(s) breached`
                : `${slaTot} SLA-bearing ticket(s), none breached` });
    shareBar(s5, {
      x: 7.19, y: panel.contentY(1.86, true), w: 5.06,
      rows: bySla.map(([l, v]) => ({ label: l, value: v, color: SLA_C[l] || C.mute })),
    });
  } else {
    panel(s5, { x: 6.83, y: 1.86, w: 5.78, h: 4.52, title: 'SLA outcome' });
    emptyNote(s5, why('No SLA-bearing tickets in this period.'),
      { x: 7.19, y: panel.contentY(1.86, false), w: 5.06, h: 0.9, fontSize: 11 });
  }
  differerPied(s5);

  /* Slide 6 : performance FO.
     Au-delà de 12 agents les colonnes deviennent trop fines et les noms se
     chevauchent. On ne coupe plus la liste pour autant : les agents
     suivants passent sur une slide de continuation. */
  {
    const fo = Object.entries(data.by_fo || {})
      .filter(([, v]) => v.open || v.resolved || v.breach)
      .sort((a, b) => b[1].resolved - a[1].resolved);
    const foPages = paginateFo(fo);
    foPages.forEach((shown, pi) => {
      const sl = pptx.addSlide();
      slideHeader(sl,
        pi === 0 ? 'What each agent carried\nthrough the week'
                 : 'What each agent carried\nthrough the week (cont.)',
        period, 'Team');
      if (shown.length) {
        // Empilé : la hauteur totale est la charge portée, la couleur dit
        // ce qui est soldé et ce qui reste.
        const from = foPages.slice(0, pi).reduce((n, p) => n + p.length, 0);
        panel(sl, { x: M, y: 1.86, w: CW, h: 4.52,
          note: foPages.length > 1
            ? `Agents ${from + 1}–${from + shown.length} of ${fo.length}, by volume closed this week`
            : `${fo.length} agent(s) with activity this week · closures credited to whoever closed the ticket` });
        stackedCols(sl, {
          x: M + 0.72, y: panel.contentY(1.86, true) + 0.16, w: CW - 1.1, h: 2.86,
          labels: shown.map(([n]) => n),
          series: [
            // Libellés explicitement datés : « Closed » seul laissait
            // croire à un cumul historique, ce que la barre n'est pas.
            { label: 'Closed this week',   color: C.green, values: shown.map(([, v]) => v.resolved || 0) },
            { label: 'Opened, still open', color: C.blue,  values: shown.map(([, v]) => v.open     || 0) },
            { label: 'Breached this week', color: C.red,   values: shown.map(([, v]) => v.breach   || 0) },
          ],
        });
        legend(sl, { x: M + 0.72, y: 5.98, w: 6.6, items: [
          { label: 'Closed this week', color: C.green },
          { label: 'Opened, still open', color: C.blue },
          { label: 'Breached this week', color: C.red },
        ] });
      } else {
        emptyNote(sl, why('No activity assigned to any agent in this period.'),
          { x: M, y: 1.9, w: CW, h: 1.0 });
      }
      differerPied(sl);
    });
  }

  /* Slide 7 : ouverture de section, en aplat de marque plein.
     Le deck bascule ici des chiffres calculés vers ce que l'équipe a
     rédigé. Une page d'intercalaire marque la coupure : à plat sur le
     rouge de marque, coupée d'un filet vertical, comme la référence.
     Le tableau des observations vient sur la slide suivante. */
  // Compte affiché sur l'intercalaire : celui de la liste dédoublonnée
  // qui suit, pas celui de la saisie brute — sinon l'annonce et la page
  // se contredisent.
  const obsCount = PAGED.observations.reduce((n, p) => n + p.length, 0);
  // L'intercalaire annonce le bloc rédigé par l'équipe. Si ce bloc est
  // entièrement vide — ni observation, ni risque, ni dépassement, ni
  // action — il n'annonce plus rien : on le retire avec lui, sinon le
  // deck garde une page de titre suivie du commentaire.
  const nbRediges = ['observations', 'risks', 'breaches', 'achievements', 'actions']
    .reduce((n, k) => n + (PAGED[k] || []).reduce((m, p) => m + p.length, 0), 0);
  if (nbRediges) {
    const sDiv = pptx.addSlide();
    sDiv.background = { color: C.brand };
    // Texte de gauche en rouge éclairci sur le rouge de marque : c'est le
    // rapport de la référence entre son texte pâle et son fond violet.
    sDiv.addText(
      'From tickets, alarms and shift notes to a single weekly read,'
      + ' this is what the Front Office observed on the ground.', {
      x: M, y: 0.72, w: 5.5, h: 2.0,
      fontSize: 21, color: 'EE9BA6', fontFace: FONT,
      valign: 'top', lineSpacingMultiple: 1.34,
    });
    // Filet vertical de séparation, pleine hauteur.
    sDiv.addShape('rect', {
      x: 6.66, y: 0, w: 0.008, h: 7.5,
      fill: { color: 'E8737F' }, line: { type: 'none' },
    });
    // Puce sur le filet, à hauteur du titre.
    sDiv.addShape('ellipse', {
      x: 6.62, y: 4.16, w: 0.09, h: 0.09,
      fill: { color: 'FFFFFF' }, line: { type: 'none' },
    });
    sDiv.addText('What the team\nreported', {
      x: 7.15, y: 3.62, w: CW - 6.43, h: 1.5,
      fontSize: 38, color: 'FFFFFF', fontFace: FONT,
      valign: 'top', lineSpacingMultiple: 1.06,
    });
    sDiv.addText(obsCount
      ? `${obsCount} observation(s) recorded · ${period}`
      : `No observation recorded · ${period}`, {
      x: 7.17, y: 5.2, w: CW - 6.45, h: 0.28,
      fontSize: 10.5, color: 'F3C3CA', fontFace: FONT,
    });
    // Mention de pied posée par la numérotation différée (encre de la slide).
    differerPied(sDiv, { on: 'FFFFFF', mute: 'E8919C' });
  }

  // Deux sources fusionnées dans buildPagedSections : ce que l'utilisateur
  // a saisi dans le rapport (form.highlights) ET les observations ouvertes
  // du registre (data.observations_open). La liste est rendue en entier,
  // sur autant de slides que nécessaire.
  {
    const pages = PAGED.observations;
    const count = pages.reduce((n, p) => n + p.length, 0);
    // Section omise quand rien n'a été observé : une page dont le seul
    // contenu est « aucune observation » allonge le deck sans rien dire.
    if (count) pages.forEach((rows, pi) => {
      const sl = pptx.addSlide();
      slideHeader(sl,
        pi === 0 ? 'Observations logged\nby the team'
                 : 'Observations logged\nby the team (cont.)',
        count ? `${count} observation(s)` : period, 'Reported');
      if (rows.length) entryList(sl, { rows, y: 1.95, rowH: 0.82 });
      else emptyNote(sl, 'No observation recorded for this week, either in the report or in '
                       + 'the observation register.', { x: M, y: 1.95, w: CW, h: 1.0 });
      differerPied(sl);
    });
  }

  /* Slide 8 : risques. Lignes construites dans buildPagedSections,
     paginées plutôt que coupées. */
  {
    const pages = PAGED.risks;
    const count = pages.reduce((n, p) => n + p.length, 0);
    if (count) pages.forEach((rows, pi) => {
      const sl = pptx.addSlide();
      slideHeader(sl,
        pi === 0 ? 'Risks and issues\non the watchlist'
                 : 'Risks and issues\non the watchlist (cont.)',
        count ? `${count} item(s)` : period, 'Watchlist');
      // Même règle qu'à la pagination : la hauteur suit la présence d'un
      // motif, sinon les lignes déborderaient sous le pied de page.
      if (rows.length) entryList(sl, {
        rows, y: 1.95,
        rowH: pages.some(p => p.some(r => r.update)) ? BREACH_ROW_H : 0.82,
      });
      else emptyNote(sl, 'No risk declared for this week. Nothing on the watchlist.',
        { x: M, y: 1.95, w: CW, h: 1.0 });
      differerPied(sl);
    });
  }

  /* Slide 9 : tickets hors SLA encore ouverts. */
  {
    const pages = PAGED.breaches;
    const count = pages.reduce((n, p) => n + p.length, 0);
    if (count) pages.forEach((rows, pi) => {
      const sl = pptx.addSlide();
      slideHeader(sl,
        pi === 0 ? 'SLA breaches still\nopen and to address'
                 : 'SLA breaches still\nopen and to address (cont.)',
        count ? `${count} ticket(s)` : 'none', 'Action required');
      if (rows.length) entryList(sl, { rows, y: 1.95, rowH: BREACH_ROW_H });
      else emptyNote(sl, 'No SLA breach outstanding. Nothing to address on this front.',
        { x: M, y: 1.95, w: CW, h: 1.0 });
      differerPied(sl);
    });
  }

  /* Achievements : ce que la semaine a produit, d'après les déclarations
     des agents. Le deck disait ce qui restait ouvert et ce qui venait,
     jamais ce qui avait été accompli. */
  {
    const pages = PAGED.achievements;
    const count = pages.reduce((n, p) => n + p.length, 0);
    if (count) pages.forEach((rows, pi) => {
      const sl = pptx.addSlide();
      slideHeader(sl,
        pi === 0 ? 'What was accomplished\nthis week'
                 : 'What was accomplished\nthis week (cont.)',
        count ? `${count} contributor(s)` : period, 'Achievements');

      let listTop = 1.95;
      /* Bandeau de félicitations, sur la première page seulement : le
         répéter sur une page de continuation en ferait un en-tête, pas
         une distinction. */
      const kd = PAGED._kudos;
      if (pi === 0 && kd) {
        const H = 0.72;
        sl.addShape('rect', {
          x: M, y: listTop, w: CW, h: H,
          fill: { color: C.greenSoft }, line: { type: 'none' },
        });
        // Filet d'accent à gauche : même grammaire que les liserés de
        // criticité, mais en vert — ici c'est une bonne nouvelle.
        sl.addShape('rect', {
          x: M, y: listTop, w: 0.05, h: H,
          fill: { color: C.green }, line: { type: 'none' },
        });
        // Médaille : un symbole suffit, dessiné en disque pour rester
        // rendu à l'identique partout (les emojis ne le sont pas).
        sl.addShape('ellipse', {
          x: M + 0.3, y: listTop + 0.16, w: 0.4, h: 0.4,
          fill: { color: C.green }, line: { type: 'none' },
        });
        sl.addText(String(kd.count), {
          x: M + 0.3, y: listTop + 0.16, w: 0.4, h: 0.4,
          fontSize: 15, bold: true, color: 'FFFFFF',
          align: 'center', valign: 'middle', fontFace: FONT,
        });

        const many = kd.names.length > 1;
        sl.addText(many ? 'Kudos to the week\u2019s top contributors'
                        : 'Kudos to the week\u2019s top contributor', {
          x: M + 0.86, y: listTop + 0.1, w: CW - 1.1, h: 0.24,
          fontSize: 9, color: '0B5C28', charSpacing: 0.4, fontFace: FONT,
          valign: 'middle',
        });
        sl.addText([
          { text: clip(kd.names.join(', ')), options: { bold: true, fontSize: 14 } },
          { text: `   ${kd.count} of ${kd.total} item(s) completed this week`,
            options: { fontSize: 10, color: '2E7D4F' } },
        ], {
          x: M + 0.86, y: listTop + 0.32, w: CW - 1.1, h: 0.3,
          color: '0B5C28', fontFace: FONT, valign: 'middle',
        });
        listTop += H + 0.18;
      }

      // La hauteur de ligne suit la place restante : avec le bandeau, les
      // lignes se resserrent plutôt que de passer sous le filet de pied.
      const rowH = Math.min(0.86, Math.max(0.6, (FLOOR - listTop) / Math.max(rows.length, 1)));
      if (rows.length) entryList(sl, { rows, y: listTop, rowH });
      else emptyNote(sl, 'No completed item logged in Weekly Progress for this week.',
        { x: M, y: listTop, w: CW, h: 1.0 });
      differerPied(sl);
    });
  }

  /* Slide 10 : actions de la semaine à venir.
     Champs client : action / owner / priority / eta. Le plafond de cinq
     actions et son « + N more » ont disparu : le plan est rendu entier. */
  {
    const pages = PAGED.actions;
    const nbActions = pages.reduce((n, p) => n + p.length, 0);
    if (nbActions) pages.forEach((rows, pi) => {
      const sl = pptx.addSlide();
      slideHeader(sl,
        pi === 0 ? 'What we commit to\nnext week'
                 : 'What we commit to\nnext week (cont.)',
        period, 'Plan');
      const startAt = pages.slice(0, pi).reduce((n, p) => n + p.length, 0);
      if (rows.length) planGrid(sl, { rows, y: 1.98, startAt });
      else emptyNote(sl, 'No action planned for the coming week.',
        { x: M, y: 1.95, w: CW, h: 1.0 });
      differerPied(sl);
    });
  }

  /* Slide 11 : notes libres.
     `notes` arrive comme un tableau de lignes côté client, mais une
     chaîne simple reste acceptée pour un appel direct à l'API. */
  const notesText = Array.isArray(form.notes)
    ? form.notes.map(n => (typeof n === 'string' ? n : (n && (n.note || n.text)) || ''))
        .filter(t => String(t).trim()).join('\n')
    : String(form.notes || '');
  // Modèle `statement` : page de propos, aplat teinté, pas de donnée.
  const s11 = pptx.addSlide();
  statement(s11, {
    bg: C.wash, on: C.ink, onMute: '3E555C', rule: '9FB8C0',
    eyebrow: 'Commentary',
    lead: notesText.trim()
      ? clip(notesText.trim())
      : 'No commentary was recorded for this week. The figures in this deck stand on '
        + 'their own; anything requiring a decision is listed on the watchlist.',
    title: 'Manager\ncommentary',
    sub: period,
  });
  differerPied(s11, { on: C.ink, mute: C.faint });

  /* Slide 12 : remerciement. Même gabarit `statement`, mais en aplat de
     marque plein : le deck se ferme comme il s'est ouvert, sur une page
     sans donnée. */
  const sEnd = pptx.addSlide();
  statement(sEnd, {
    bg: C.brand, on: 'FFFFFF', onMute: 'F0AFB8', rule: 'E8737F',
    eyebrow: `EMOC · Front Office · ${VILLE}`,
    lead: 'Thanks to the Front Office team for the shifts covered, the tickets closed '
        + 'and the escalations handled this week. Questions on any figure in this deck '
        + 'are welcome; the underlying tickets are all traceable in the tracker.',
    title: 'Thank you',
    sub: `${form.author || 'Front Office Team'} · ${period}`,
  });
  differerPied(sEnd, { on: 'FFFFFF', mute: 'F0AFB8' });
  /* Numérotation, une fois le deck arrêté. C'est seulement ici qu'on
     connaît le nombre de pages réellement produites : les sections vides
     ayant été écartées, le compter d'avance donnerait un « / 15 » faux
     sur un deck plus court. */
  const total = pieds.length;
  pieds.forEach(({ slide, encre }, i) => {
    const n = i + 1;
    if (!encre) { slideFooter(slide, n, total); return; }
    // Pied sur fond coloré : même géométrie que slideFooter(), sans le
    // filet — ces slides n'en portent pas — et dans l'encre de la slide.
    slide.addText(`EMOC · Front Office · ${VILLE} · Internal distribution`, {
      x: M, y: 7.0, w: 8, h: 0.24,
      fontSize: 8, color: encre.mute, fontFace: FONT, valign: 'middle',
    });
    slide.addText([
      { text: String(n), options: { bold: true, color: encre.on } },
      { text: ` / ${total}`, options: { color: encre.mute } },
    ], {
      x: M + CW - 1.2, y: 7.0, w: 1.2, h: 0.24,
      fontSize: 8.5, align: 'right', valign: 'middle', fontFace: FONT,
    });
  });

  // 'nodebuffer' : on renvoie le binaire au client via Express, sans
  // passer par un fichier temporaire.
  return pptx.write({ outputType: 'nodebuffer' });
}

module.exports = {
  buildWeeklyPptx, deriveHighlights, quietWeek,
  // Système visuel partagé avec les autres decks (bilan d'objectifs) : même
  // palette, mêmes gabarits, pour un rendu identique d'un rapport à l'autre.
  design: {
    C, FONT, M, CW, FLOOR, SHADOW,
    clip, fitPt, orNA,
    slideHeader, slideFooter, statement, metricCard, panel, legend,
    hBars, stackedCols, groupedCols, pieChart, shareBar, emptyNote,
    entryList, planGrid, rowsPerSlide, paginateRows,
    fmtDur, fmtDate, mttdTone, MTTD_TARGET_MS,
  },
};
