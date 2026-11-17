// ══════════════════════════════════════════════════════════════
// OBJECTIFS PERSONNELS — cycle trimestriel, saisie par l'agent,
// approbation par l'admin.
//
// Trois idées portent ce module :
//
// 1. L'agent écrit, l'admin valide. Rien de ce que l'agent saisit
//    n'est visible comme « acquis » tant que l'admin ne l'a pas
//    approuvé. Cela vaut pour l'objectif lui-même, pour toute
//    modification ultérieure de son intitulé, pour ses KPIs et pour
//    ses jalons. Un jalon coché fait bouger une barre de progression :
//    il porte donc la même exigence d'approbation que le reste.
//
// 2. Rien n'est écrasé sur place. Une modification d'un élément déjà
//    approuvé ne touche pas la valeur en vigueur : elle est déposée
//    dans `pending`, à côté. Tant que l'admin n'a pas tranché, c'est
//    l'ancienne valeur qui fait foi. Un refus se contente d'effacer
//    `pending` — la valeur approuvée n'a jamais bougé, il n'y a rien
//    à restaurer.
//
// 3. Le contrôle SMART est indicatif. Il note et il explique, il ne
//    bloque pas : c'est un garde-fou pour l'agent et une information
//    pour l'admin, qui reste seul à décider. Un objectif légitime mais
//    mal reconnu par l'heuristique ne doit pas être impossible à
//    soumettre.
// ══════════════════════════════════════════════════════════════

// ── Cycle de vie ──────────────────────────────────────────────
// draft     : l'agent écrit, personne d'autre ne le voit.
// submitted : déposé, en attente de l'admin.
// approved  : en vigueur.
// rejected  : refusé avec motif ; l'agent corrige et resoumet, ce qui
//             le ramène à `submitted`. On ne le supprime pas : le motif
//             et l'historique doivent rester lisibles des deux côtés.
// lapsed    : la session s'est close avant que l'admin ne tranche.
//             Terminal — l'objectif n'a jamais pris effet, mais il reste
//             lisible dans l'historique du trimestre.
const OBJ_STATES = ['draft', 'submitted', 'approved', 'rejected', 'lapsed'];

// Un objectif approuvé reçoit ensuite un avancement, qui n'a rien à voir
// avec son approbation : on peut être approuvé et pas commencé.
const OBJ_PROGRESS = ['todo', 'doing', 'done', 'dropped'];

const SESSION_STATES = ['open', 'closed'];

const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const nowISO = () => new Date().toISOString();
const clampStr = (v, n) => String(v ?? '').trim().slice(0, n);

// ══════════════════════════════════════════════════════════════
// CONTRÔLE SMART
//
// Cinq critères, chacun noté sur 20, avec un message qui dit quoi
// corriger plutôt que « ce n'est pas SMART ». L'heuristique est
// déterministe et locale : même texte, même verdict, toujours, et sans
// dépendance réseau.
//
// Elle reste faillible par construction — c'est pourquoi le résultat
// est indicatif. Elle attrape ce qui est mécaniquement vérifiable (un
// chiffre, une date, un verbe d'action) et ne prétend pas juger la
// pertinence métier, qui est le travail de l'admin.
// ══════════════════════════════════════════════════════════════

// Verbes d'action, FR et EN. Un objectif qui commence par « être » ou
// « avoir » décrit un état, pas quelque chose qu'on fait.
const ACTION_VERBS = /\b(r[ée]duire|augmenter|atteindre|livrer|mettre en place|d[ée]ployer|obtenir|passer|former|animer|r[ée]diger|documenter|traiter|r[ée]soudre|automatiser|am[ée]liorer|maintenir|cr[ée]er|construire|valider|certifier|migrer|standardiser|industrialiser|supprimer|[ée]liminer|acc[ée]l[ée]rer|fiabiliser|s[ée]curiser|reduce|increase|achieve|reach|deliver|implement|deploy|obtain|complete|train|run|write|document|handle|resolve|automate|improve|maintain|create|build|validate|certify|migrate|remove|eliminate|accelerate|secure)\b/i;

// Un état plutôt qu'une action : « être plus rigoureux », « avoir une
// meilleure communication ». Rien à mesurer là-dedans.
const STATE_ONLY = /^\s*(être|etre|avoir|rester|devenir|be|have|stay|become)\b/i;

// Vocabulaire vague : signale une cible non mesurable même quand un
// chiffre traîne ailleurs dans la phrase.
const VAGUE = /\b(mieux|meilleur|bien|bonne?|am[ée]lior\w*\s+(?:la|le|les)?\s*(?:qualit[ée]|communication|relation)|plus\s+(?:de\s+)?(?:rigueur|s[ée]rieux|professionnalisme)|efficace|proactif|impliqu[ée]|motiv[ée]|better|good|nice|proactive|involved|efficient)\b/i;

// Un chiffre chargé d'unité : 95 %, 24 h, 3 sessions, 50 tickets.
const HAS_NUMBER = /\d/;
const NUMBER_WITH_UNIT = /\d+\s*(%|h\b|heures?|hours?|j(?:ours?)?\b|days?|min\b|minutes?|tickets?|sessions?|incidents?|fiches?|proc[ée]dures?|modules?|certifications?|points?|pts?\b|k\b|€|\$)/i;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Date de réalisation d'un jalon, donnée par l'agent ou corrigée par le
// manager. Un agent coche souvent après coup : sans elle, un jalon tenu le
// 3 et coché le 12 passait pour rendu en retard. Refusée si future ou
// antérieure d'un an à aujourd'hui (faute de frappe). Renvoie l'ISO à midi
// UTC, pour qu'aucun fuseau ne la fasse glisser d'un jour.
function doneDate(v, today = new Date().toISOString().slice(0, 10)) {
  const d = String(v || '').slice(0, 10);
  if (!ISO_DATE.test(d) || isNaN(Date.parse(d))) return null;
  if (d > today) return null;
  const min = new Date(Date.parse(today) - 366 * 86400000).toISOString().slice(0, 10);
  if (d < min) return null;
  return `${d}T12:00:00.000Z`;
}

function scoreSpecific(o) {
  const t = clampStr(o.title, 400);
  const issues = [];
  let s = 20;
  if (t.length < 15) { s -= 12; issues.push('The wording is too short to say what will actually be done.'); }
  if (STATE_ONLY.test(t)) { s -= 10; issues.push('Starts with a state verb — describe an action, not a quality to have.'); }
  else if (!ACTION_VERBS.test(t)) { s -= 6; issues.push('No clear action verb — start with what you will do (reduce, deliver, obtain…).'); }
  if (VAGUE.test(t)) { s -= 6; issues.push('Contains vague wording ("better", "more rigorous") — say what changes, concretely.'); }
  return { score: Math.max(0, s), issues };
}

// Mesurable : c'est ici que se joue l'essentiel. On regarde d'abord les
// KPIs — c'est leur raison d'être — et l'intitulé en secours.
function scoreMeasurable(o) {
  const kpis = Array.isArray(o.kpis) ? o.kpis : [];
  const issues = [];
  let s = 20;

  if (!kpis.length) {
    return { score: 0, issues: ['No KPI defined — add at least one measurable indicator with a target value.'] };
  }
  const withTarget = kpis.filter(k => HAS_NUMBER.test(`${k.target ?? ''}`));
  if (!withTarget.length) {
    s -= 14;
    issues.push('No KPI carries a numeric target — a target must be a number you can check against.');
  }
  const withUnit = kpis.filter(k => clampStr(k.unit, 30).length > 0
    || NUMBER_WITH_UNIT.test(`${k.target ?? ''}`));
  if (!withUnit.length) {
    s -= 5;
    issues.push('No KPI states a unit (%, hours, tickets…) — a bare number is ambiguous.');
  }
  if (kpis.some(k => !clampStr(k.name, 200))) {
    s -= 4;
    issues.push('A KPI has no name — say what is being measured.');
  }
  // Une source de mesure évite le « on verra bien » en fin de trimestre.
  if (!kpis.some(k => clampStr(k.source, 200))) {
    s -= 3;
    issues.push('No KPI says where the figure comes from — name the source (ServiceNow, the tracker, a report…).');
  }
  return { score: Math.max(0, s), issues };
}

// Atteignable : on ne peut pas juger la charge réelle, mais on peut
// repérer les cibles absurdes, qui sont la faute la plus fréquente.
function scoreAchievable(o) {
  const kpis = Array.isArray(o.kpis) ? o.kpis : [];
  const issues = [];
  let s = 20;
  for (const k of kpis) {
    const raw = `${k.target ?? ''}`;
    const pct = raw.match(/(\d+(?:[.,]\d+)?)\s*%/);
    if (pct) {
      const v = parseFloat(pct[1].replace(',', '.'));
      if (v > 100) { s -= 10; issues.push(`Target "${clampStr(k.name, 40)}" exceeds 100 % — check the value.`); }
      else if (v === 100) { s -= 4; issues.push(`Target "${clampStr(k.name, 40)}" is 100 % — perfection over a whole quarter leaves no room for a single incident; 95–98 % is usually the honest target.`); }
      else if (v === 0 && !/breach|incident|d[ée]passement|rupture/i.test(`${k.name}`)) {
        s -= 3; issues.push(`Target "${clampStr(k.name, 40)}" is 0 — make sure that is really what you mean.`);
      }
    }
  }
  if (kpis.length > 5) { s -= 5; issues.push('More than 5 KPIs on a single objective — keep the two or three that really decide it.'); }
  return { score: Math.max(0, s), issues };
}

// Pertinent : rattaché au poste. Faute d'un référentiel de compétences,
// on vérifie qu'il y a une justification écrite — c'est ce qui permet à
// l'admin de trancher sans demander.
function scoreRelevant(o) {
  const why = clampStr(o.why, 1000);
  const issues = [];
  let s = 20;
  if (!why) { s -= 14; issues.push('No reason given — say why this objective matters for your role this quarter.'); }
  else if (why.length < 25) { s -= 7; issues.push('The reason is very brief — a line or two on what it changes for the team helps the review.'); }
  return { score: Math.max(0, s), issues };
}

// Temporel : une échéance réelle, dans la fenêtre de la session.
function scoreTimeBound(o, session) {
  const issues = [];
  let s = 20;
  const due = clampStr(o.due, 10);
  if (!ISO_DATE.test(due)) {
    return { score: 0, issues: ['No due date — every objective needs one.'] };
  }
  const d = new Date(due + 'T00:00:00');
  if (isNaN(d)) return { score: 0, issues: ['The due date is not a valid date.'] };

  if (session?.start && due < session.start) {
    s -= 12; issues.push(`The due date falls before the session starts (${session.start}).`);
  }
  if (session?.end && due > session.end) {
    s -= 12; issues.push(`The due date falls after the session ends (${session.end}) — split the objective or bring the date forward.`);
  }
  // Des jalons datés valent mieux qu'une seule échéance en fin de course.
  const steps = Array.isArray(o.steps) ? o.steps : [];
  if (!steps.length) { s -= 4; issues.push('No milestone — cutting the objective into steps is what makes progress visible before the deadline.'); }
  return { score: Math.max(0, s), issues };
}

// Note globale, sur 100. Le seuil de 70 sert d'indication visuelle :
// au-dessus, l'objectif est jugé exploitable ; en dessous, l'agent est
// prévenu — mais il reste libre de soumettre, et l'admin de refuser.
const SMART_PASS = 70;

function smartReport(o, session) {
  const parts = {
    specific:   scoreSpecific(o),
    measurable: scoreMeasurable(o),
    achievable: scoreAchievable(o),
    relevant:   scoreRelevant(o),
    timebound:  scoreTimeBound(o, session),
  };
  const score = Object.values(parts).reduce((a, p) => a + p.score, 0);
  // Le total seul laisserait passer un objectif sans aucun KPI ni aucune
  // échéance, rattrapé par les trois autres axes. Or ce sont exactement
  // les deux choses sans lesquelles il n'y a rien à constater en fin de
  // trimestre : elles conditionnent le verdict, pas seulement le total.
  const gated = parts.measurable.score > 0 && parts.timebound.score > 0;
  return {
    score,
    pass: score >= SMART_PASS && gated,
    parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, {
      score: v.score, max: 20, issues: v.issues,
    }])),
    issues: Object.values(parts).flatMap(p => p.issues),
  };
}

// ══════════════════════════════════════════════════════════════
// STRUCTURE
//
// config.objective_sessions = [ { id, name, start, end, state, … } ]
// config.fo_objectives[fo]  = [ objectif, … ]
//
// Un objectif :
//   { id, session, title, why, due, state, progress,
//     kpis:  [ { id, name, target, unit, source, state, pending, … } ],
//     steps: [ { id, label, due, done, state, pending, … } ],
//     pending: { title?, why?, due? },      // modif en attente
//     history: [ { at, by, action, note } ] }
//
// `pending` n'existe que le temps d'un aller-retour : approuvé, il est
// fondu dans l'objet et effacé ; refusé, il est simplement effacé.
// ══════════════════════════════════════════════════════════════

function normKpi(raw) {
  return {
    id:     clampStr(raw?.id, 40) || uid('k'),
    name:   clampStr(raw?.name, 200),
    target: clampStr(raw?.target, 100),
    unit:   clampStr(raw?.unit, 30),
    source: clampStr(raw?.source, 200),
  };
}

function normStep(raw) {
  return {
    id:    clampStr(raw?.id, 40) || uid('s'),
    label: clampStr(raw?.label ?? raw?.title, 300),
    due:   ISO_DATE.test(clampStr(raw?.due, 10)) ? clampStr(raw.due, 10) : '',
  };
}

// Règle : un jalon sans date limite est refusé — à la création, à la
// modification et à l'approbation. Sans échéance, un jalon ne peut être ni
// en retard ni tenu, et le suivi n'a plus rien à mesurer. Renvoie le
// message d'erreur, ou null si tous les jalons (non vides) sont datés.
function stepsSansDate(steps) {
  const manquants = (steps || []).filter(st => st && (st.label || st.title) && !ISO_DATE.test(String(st.due || '')));
  if (!manquants.length) return null;
  const noms = manquants.slice(0, 3).map(st => `“${String(st.label || st.title).slice(0, 60)}”`).join(', ');
  return `Every milestone needs a deadline. Missing for ${noms}${manquants.length > 3 ? ` and ${manquants.length - 3} more` : ''}.`;
}

// Entrée d'historique. Court et daté : c'est ce qui permet de relire un
// aller-retour six semaines plus tard sans avoir à le reconstituer.
function hist(action, by, note) {
  return { at: nowISO(), by: clampStr(by, 120), action: clampStr(action, 40), note: clampStr(note, 2000) };
}

// Poids d'un jalon fait hors délai. Un jalon rendu après son échéance
// a bien été fait — le retirer du calcul nierait le travail — mais il
// n'a pas été tenu : le compter plein effaçait toute différence entre
// une trajectoire à l'heure et une trajectoire qui glisse, et c'est
// précisément cette différence qu'un suivi d'objectifs doit montrer.
const LATE_STEP_WEIGHT = 0.5;

// Un jalon est en retard s'il est fait après son échéance, ou pas encore
// fait alors que l'échéance est passée. La date de réalisation n'est pas
// toujours enregistrée : sans elle, on ne peut conclure au retard que
// pour un jalon non fait, et un jalon fait sans date reste compté plein.
function stepLate(s, today) {
  if (!s || !s.due) return false;
  const ref = today || new Date().toISOString().slice(0, 10);
  if (s.done) return !!s.done_at && String(s.done_at).slice(0, 10) > s.due;
  return s.due < ref;
}

// Avancement : la part des jalons approuvés ET faits. Un jalon en
// attente ne compte pas — sinon cocher suffirait à faire monter la
// barre sans que personne n'ait validé quoi que ce soit.
//
// Un jalon tenu hors délai ne compte que pour moitié : l'avancement
// affiché devient ainsi une mesure de l'avancement *tenu*, pas du seul
// volume coché.
function objProgressPct(o, today) {
  const steps = (o.steps || []).filter(s => s.state === 'approved');
  if (!steps.length) return o.progress === 'done' ? 100 : o.progress === 'doing' ? 50 : 0;
  const gagne = steps.filter(s => s.done)
    .reduce((n, s) => n + (stepLate(s, today) ? LATE_STEP_WEIGHT : 1), 0);
  return Math.round(gagne / steps.length * 100);
}

// Ce qui a glissé sur un objectif, pour l'afficher sans le recalculer
// partout : l'objectif lui-même passé d'échéance, et ses jalons en retard.
function objLateInfo(o, today) {
  const ref = today || new Date().toISOString().slice(0, 10);
  const steps = (o.steps || []).filter(s => s.state === 'approved');
  const lateSteps = steps.filter(s => stepLate(s, ref));
  const overdue = !!o.due && o.due < ref && o.progress !== 'done';
  return {
    overdue,
    days_over: overdue ? Math.max(0,
      Math.round((Date.parse(ref) - Date.parse(o.due)) / 86400000)) : 0,
    late_steps: lateSteps.length,
    total_steps: steps.length,
  };
}

// Vue destinée à l'agent. On y ajoute ce qui est calculé plutôt que
// stocké, pour que le client n'ait pas à redériver les mêmes règles.
function decorate(o, session) {
  return {
    ...o,
    progress_pct: objProgressPct(o),
    late: objLateInfo(o),
    smart: smartReport({
      title: o.pending?.title ?? o.title,
      why:   o.pending?.why   ?? o.why,
      due:   o.pending?.due   ?? o.due,
      kpis:  o.kpis, steps: o.steps,
    }, session),
    // Un objectif n'est modifiable par l'agent que tant que la session
    // est ouverte : une fois close, le trimestre est arrêté.
    editable: session?.state === 'open',
    has_pending: !!(o.pending && Object.keys(o.pending).length)
      || (o.kpis || []).some(k => k.state === 'submitted' || k.pending)
      || (o.steps || []).some(s => s.state === 'submitted' || s.pending),
  };
}

module.exports = {
  doneDate, stepsSansDate,
  OBJ_STATES, OBJ_PROGRESS, SESSION_STATES, SMART_PASS,
  smartReport, normKpi, normStep, hist, objProgressPct, decorate,
  objLateInfo, stepLate, LATE_STEP_WEIGHT,
  uid, nowISO, clampStr, ISO_DATE,
};
