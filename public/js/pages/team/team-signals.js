/* ══════════════════════════════════════════════════════════════
   ÉQUIPE — ce qui demande une action, agent par agent

   Les signaux se calculent sur des données déjà servies ailleurs :
   state.config (objectifs, entretiens, notations), state.weeklyProgress
   (tâches attribuées), et deux lectures que la page Équipe fait à
   l'ouverture — /api/absences et /api/trainings. Aucune règle métier
   n'est réécrite : les retards d'objectifs, d'actions et de jalons
   passent par les fonctions de Performance FO, Suivi O2O et Suivi des
   objectifs, pour que la carte et l'écran détaillé disent la même chose.

   Trois niveaux, qui fixent l'ordre des cartes :
     urgent  quelque chose a dépassé son échéance
     todo    une décision ou une saisie attend l'admin
     info    à savoir, sans rien à faire (absence, formation)
   Une donnée absente ne produit pas de signal : « 0 » se lirait comme
   un constat alors qu'on n'a simplement pas regardé.
   ══════════════════════════════════════════════════════════════ */

const EQ_LEVEL_WEIGHT = { urgent: 100, todo: 10, info: 0 };
// Au-delà, un One-to-One est à replanifier — même seuil que le Bilan
// du Suivi O2O (« Last meeting more than 45 days ago »).
const EQ_O2O_MAX_DAYS = 45;
// Horizon des absences et formations signalées sur la carte.
const EQ_SOON_DAYS = 7;
const EQ_TRAINING_DAYS = 21;

function _eqToday() { return new Date().toISOString().slice(0, 10); }

function _eqAddDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 03/10 — l'année n'apporte rien sur un horizon de quelques semaines.
function _eqDm(iso) {
  const s = String(iso || '');
  return s.length >= 10 ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : s;
}

function _eqMonthLabel(key) {
  try {
    return new Date(key + '-01T00:00:00Z')
      .toLocaleDateString((globalThis.PEAR_LOCALE || 'fr-FR'), { month: 'long', timeZone: 'UTC' });
  } catch (_) { return key; }
}

function _eqPlural(n, one, many) { return `${n} ${n > 1 ? (many || one + 's') : one}`; }

// Objectifs de l'agent. La réponse de /api/objectives prime quand elle
// est là (le serveur y pose `late`) ; sinon la config suffit, _obtLate
// sait recalculer.
function _eqObjectivesOf(fo, ctx) {
  const src = (ctx && ctx.objectives) || (state.config && state.config.fo_objectives) || {};
  return src[fo] || [];
}

// L'audience d'une formation est un texte libre (« Claire LEROY, Paul BERNARD »,
// « Toute l'équipe »). On ne rattache une session à un agent que si son
// nom y figure : un mot commun ne suffit pas, « BA » est dans trop de mots.
function _eqTrainingConcerns(t, fo) {
  const aud = _cfgFold(t && t.audience);
  if (!aud) return false;
  const nom = _cfgFold(fo);
  if (aud.includes(nom)) return true;
  const toks = new Set(aud.split(/[^a-z0-9]+/).filter(Boolean));
  const parts = nom.split(/[^a-z0-9]+/).filter(Boolean);
  if (parts.length && parts.every(p => toks.has(p))) return true;
  const last = parts[parts.length - 1];
  return !!last && last.length >= 4 && toks.has(last);
}

function _eqAbsLabel(a) {
  const t = String(a.type || '');
  if (/cong|rtt/i.test(t)) return 'En congé';
  if (/formation/i.test(t)) return 'En formation';
  return 'Absent';
}

// Tous les signaux d'un agent, plus quelques chiffres pour l'en-tête de
// sa fiche. `ctx` : { objectives, abs, trainings } — chaque champ peut
// manquer, le signal correspondant est alors simplement omis.
function eqAgentSignals(fo, ctx) {
  ctx = ctx || {};
  const today = _eqToday();
  const cfg = state.config || {};
  const items = [];
  const push = (lvl, kind, txt, atab, asub) => items.push({ lvl, kind, txt, atab, asub });
  const stats = {};

  // ── Objectifs ──
  const fresh = _eqObjectivesOf(fo, ctx);
  // Signaux sur la session par défaut (ouverte, sinon la plus récente) :
  // un objectif d'un trimestre clos n'appelle plus d'action.
  const sidDef = _objDefaultSessionId();
  const approved = fresh.filter(o => o.state === 'approved' && objInSession(o, sidDef || 'all'));
  const repris = fresh.some(o => o.state === 'approved');
  let actifs, retard, jalons = 0, depuisPlan = false;
  if (repris) {
    actifs = approved.filter(o => o.progress !== 'done' && o.progress !== 'dropped');
    retard = actifs.filter(o => _obtLate(o, today).overdue);
    jalons = actifs.filter(o => !_obtLate(o, today).overdue && _obtLate(o, today).late_steps > 0).length;
  } else {
    // Agent pas encore repris dans le flux : son plan One-to-One fait foi,
    // comme dans la notation (voir _scoredObjectives).
    actifs = _o2oFor(fo).objectives.filter(o => o.status !== 'done' && o.status !== 'dropped');
    retard = actifs.filter(o => o.due && o.due < today);
    depuisPlan = true;
  }
  stats.objActifs = actifs.length;
  stats.objRetard = retard.length;
  // Objectifs du plan One-to-One (agent pas encore dans le circuit
  // d'approbation) : ils ne figurent pas dans « Suivi », qui ne liste que les
  // objectifs approuvés — on renvoie donc vers l'onglet One-to-One, où ils sont.
  if (retard.length) push('urgent', 'obj-late', depuisPlan
    ? `${_eqPlural(retard.length, 'objectif')} du plan One-to-One en retard`
    : `${_eqPlural(retard.length, 'objectif')} en retard`,
    depuisPlan ? 'o2o' : 'objectifs', depuisPlan ? 'profil' : 'suivi');
  stats.objDepuisPlan = depuisPlan;
  if (jalons) push('urgent', 'obj-steps', `${_eqPlural(jalons, 'objectif')} avec jalons en retard`, 'objectifs', 'suivi');

  const attente = _objRevPending({ [fo]: fresh }).length;
  stats.objAttente = attente;
  if (attente) push('todo', 'obj-review', `${_eqPlural(attente, 'objectif')} à approuver`, 'objectifs', 'objectifs');

  // ── One-to-One ──
  const { meetings } = _o2oFor(fo);
  const d = _o2oBreakdown(fo);
  const dernier = d && d.dernierEntretien
    || meetings.map(m => m.date).filter(Boolean).sort().pop() || null;
  stats.o2oDernier = dernier;
  stats.o2oJours = dernier ? _o2osJours(dernier) : null;
  if (!meetings.length) push('todo', 'o2o-none', 'One-to-One à planifier · aucun enregistré', 'o2o', 'entretiens');
  else if (stats.o2oJours > EQ_O2O_MAX_DAYS)
    push('todo', 'o2o-old', `One-to-One à planifier · dernier il y a ${stats.o2oJours} j`, 'o2o', 'entretiens');
  const actRetard = _o2oActionStats(fo, meetings).retard;
  if (actRetard) push('urgent', 'o2o-actions', `${_eqPlural(actRetard, 'action')} de One-to-One en retard`, 'o2o', 'profil');

  // ── Notation du mois ──
  const mois = _perfMonthKey();
  const carte = (cfg.fo_scorecards || {})[mois] || {};
  // Tasks en direct ; « note à saisir » tant que l'admin n'a rien noté.
  // Mois neutralisé : pas de note attendue, rien à signaler.
  const neutre = !!carte[fo]?._neutre;
  const { score: noteSaisie } = perfScore(carte[fo]);
  const score = noteSaisie === null ? null : perfScore(_perfMonthData(mois)[fo]).score;
  stats.score = score;
  stats.mois = mois;
  if (neutre) { /* mois neutre : ni note ni mise à jour */ }
  else if (score === null) push('todo', 'score', `Note de ${_eqMonthLabel(mois)} à saisir`, 'perf');
  // Fiche notée dont les mesures ont bougé depuis (perf.js, perfMisesAJour).
  else if (typeof perfMisesAJour === 'function') {
    const maj = perfMisesAJour(fo, mois);
    if (maj.etat === 'a_jour_a_faire')
      push('todo', 'perf-update', `Performance à mettre à jour · ${maj.changes.map(_perfMajTxt).join(', ')}`, 'perf');
  }

  // ── Tâches attribuées ──
  const taches = (state.weeklyProgress || []).filter(t => t.admin_task && t.modified_by === fo);
  const ouvertes = taches.filter(t => t.status !== 'Done');
  const tRetard = ouvertes.filter(t => t.due_date && t.due_date < today);
  stats.tachesOuvertes = ouvertes.length;
  stats.tachesRetard = tRetard.length;
  if (tRetard.length)
    push('urgent', 'tasks-late', `${_eqPlural(ouvertes.length, 'tâche ouverte', 'tâches ouvertes')} (${tRetard.length} en retard)`, 'taches');
  else if (ouvertes.length)
    push('info', 'tasks', _eqPlural(ouvertes.length, 'tâche ouverte', 'tâches ouvertes'), 'taches');

  // ── Absences ──
  if (Array.isArray(ctx.abs)) {
    const mine = ctx.abs.filter(a => a.fo_name === fo
      && (a.status === 'Validée' || a.status === 'Demandée') && a.date_to >= today);
    const demain = _eqAddDays(today, 1);
    const bientot = _eqAddDays(today, EQ_SOON_DAYS);
    const valid = mine.filter(a => a.status === 'Validée')
      .sort((a, b) => String(a.date_from).localeCompare(String(b.date_from)));
    const cours = valid.find(a => a.date_from <= today);
    if (cours) {
      stats.absentJusqua = cours.date_to;
      push('info', 'abs-now', cours.date_to === today
        ? `${_eqAbsLabel(cours)} aujourd'hui`
        : `${_eqAbsLabel(cours)} jusqu'au ${_eqDm(cours.date_to)}`, 'absences');
    } else {
      const proche = valid.find(a => a.date_from <= bientot);
      if (proche) push('info', 'abs-soon', proche.date_from === demain
        ? `Absent demain${proche.date_to > demain ? ` jusqu'au ${_eqDm(proche.date_to)}` : ''}`
        : `Absent à partir du ${_eqDm(proche.date_from)}`, 'absences');
    }
    const demandes = mine.filter(a => a.status === 'Demandée');
    if (demandes.length) push('todo', 'abs-request', demandes.length > 1
      ? `${demandes.length} demandes d'absence à traiter`
      : `Demande d'absence à traiter (${_eqDm(demandes[0].date_from)} → ${_eqDm(demandes[0].date_to)})`, 'absences');
  }

  // ── Formation ──
  if (Array.isArray(ctx.trainings)) {
    const limite = _eqAddDays(today, EQ_TRAINING_DAYS);
    const next = ctx.trainings
      .filter(t => t.date >= today && t.date <= limite && _eqTrainingConcerns(t, fo))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
    if (next) push('info', 'training', `Formation prévue le ${_eqDm(next.date)}`, 'formation');
  }

  const poids = items.reduce((n, s) => n + EQ_LEVEL_WEIGHT[s.lvl], 0);
  const actions = items.filter(s => s.lvl !== 'info').length;
  // L'urgent d'abord, puis ce qui attend une décision, puis l'information.
  items.sort((a, b) => EQ_LEVEL_WEIGHT[b.lvl] - EQ_LEVEL_WEIGHT[a.lvl]);
  return { fo, items, poids, actions, stats };
}

// Toute l'équipe, dans l'ordre de traitement.
function eqTeamSignals(foList, ctx) {
  return foList.map(fo => eqAgentSignals(fo, ctx))
    .sort((a, b) => b.poids - a.poids || b.actions - a.actions
      || String(a.fo).localeCompare(String(b.fo)));
}
