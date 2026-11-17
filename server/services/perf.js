const OBJ          = require('./objectives');
const { readCfg, readFOTasks, readWeeklyProgress } = require('../core/store');
const { readSessions } = require('./objectives-store');

// ── PERFORMANCE : CONSULTATION PAR L'AGENT ────────────────────
// Un FO peut consulter sa propre note, et seulement la sienne. Le besoin
// est de restituer un niveau à l'intéressé sans ouvrir la notation de
// l'équipe : c'est le serveur qui choisit à qui appartient la réponse, à
// partir du jeton — jamais un identifiant fourni par le client.
//
// Doit rester aligné sur PERF_CRITERIA / perfScore() côté client : deux
// barèmes divergents afficheraient deux notes différentes pour la même
// personne, celle de l'admin et celle de l'agent.
const PERF_WEIGHTS = {
  sla: 20, process: 10, attendance: 15, skills: 10, individual: 35, tasks: 10,
};

// Handover a rejoint Process. Les fiches notées avant la fusion le portent
// encore à part : on le replie dans Process (moyenne si les deux sont
// notés). Doit rester aligné sur _perfLegacyCard() côté client.
function legacyCard(card) {
  if (!card) return card;
  const num = v => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)))
    ? null : Number(v);
  const h = num(card.handover);
  if (h === null) return card;
  const p = num(card.process);
  return { ...card, process: p === null ? h : Math.round((p + h) / 2) };
}

// Mois neutralisé par l'admin (absence longue, arrivée en cours de mois…) :
// pas de note du tout, ni 0 ni mesure automatique.
function perfScoreOf(card) {
  if (card && card._neutre) return null;
  card = legacyCard(card);
  let sum = 0, w = 0;
  for (const [id, weight] of Object.entries(PERF_WEIGHTS)) {
    const v = card?.[id];
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    sum += n * weight; w += weight;
  }
  return w ? Math.round(sum / w) : null;
}

// Le chiffre seul se prête mal à la lecture : on l'accompagne d'un palier
// qui dit ce qu'il vaut, sans exposer le détail du barème.
function perfLevel(score) {
  if (score === null) return { niveau: 'Not rated', rang: 0, sur: 4 };
  if (score >= 85) return { niveau: 'Very good', rang: 4, sur: 4 };
  if (score >= 70) return { niveau: 'Bon',       rang: 3, sur: 4 };
  if (score >= 55) return { niveau: 'Correct',   rang: 2, sur: 4 };
  return { niveau: 'Needs improvement', rang: 1, sur: 4 };
}

function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function prevMonthKey(key) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 2, 1);   // m-1 = mois courant, donc m-2 = précédent
  return monthKey(d);
}

// Codes d'accès : rangés hachés sous config.fo_access_codes[fo]. Le code
// en clair n'existe qu'une fois, dans la réponse à sa génération.
function foAccessCodes() { return readCfg().fo_access_codes || {}; }

// Le calcul de la fiche, extrait pour être partagé par deux routes : la
// vue de l'agent (/api/my-perf, jamais paramétrable) et la vue de
// contrôle de l'admin (/api/fo-perf/:fo). Un seul calcul, donc ce que
// l'admin vérifie est exactement ce que l'agent voit — c'est tout
// l'intérêt de l'écran de contrôle.
// ── TÂCHES DU MOIS ────────────────────────────────────────────
// Même règle que _taskBreakdown() côté client (perf.js) : deux registres
// (Daily Check-up : fo_tasks.assigned_to ; espace Tâches :
// weekly_progress.modified_by, quelle que soit l'origine), une tâche n'entre dans la note
// qu'une fois exigible (échéance passée ou du jour) ou faite. Les autres
// sont rendues aussi, marquées « à venir » : sans elles l'agent ne voyait
// rien de ses tâches tant qu'aucune n'était échue.
function tachesDuMois(fo, mois = monthKey(), today = new Date().toISOString().slice(0, 10)) {
  const [y, m] = mois.split('-').map(Number);
  const from = `${mois}-01`;
  const to = `${mois}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
  const day = d => d ? String(d).slice(0, 10) : '';
  const items = [];
  const liste = v => (Array.isArray(v) ? v : []);
  for (const t of liste(readFOTasks())) {
    if (!t || typeof t !== 'object') continue;
    if (t.assigned_to !== fo || (!t.is_occurrence && t.status === 'Recurring')) continue;
    items.push({ titre: t.title || '', echeance: day(t.due_date || t.created_at), faite: t.status === 'Done', statut: t.status || '', source: 'checkup' });
  }
  for (const p of liste(readWeeklyProgress())) {
    if (!p || typeof p !== 'object') continue;
    if (p.modified_by !== fo) continue;   // assignées, One-to-One ou ajoutées par l'agent
    items.push({ titre: p.task || '', echeance: day(p.due_date || p.week_start || p.created_at), faite: p.status === 'Done', statut: p.status || '', source: 'assignee' });
  }
  const duMois = items.filter(i => i.echeance >= from && i.echeance <= to)
    .map(i => ({ ...i, etat: i.faite ? 'faite' : (i.echeance < today ? 'en_retard' : (i.echeance === today ? 'aujourdhui' : 'a_venir')) }))
    .sort((a, b) => a.echeance.localeCompare(b.echeance));
  const comptees = duMois.filter(i => i.faite || i.echeance <= today);
  const faites = comptees.filter(i => i.faite).length;
  return {
    items: duMois.slice(0, 50),
    total: duMois.length,
    exigibles: comptees.length,
    faites,
    a_venir: duMois.filter(i => !i.faite && i.echeance > today).length,
    score: comptees.length ? Math.round(faites / comptees.length * 100) : null,
  };
}

function buildPerfView(fo) {
  const cfg   = readCfg();
  // Critère Tasks en direct, comme côté admin (_perfMonthData) : la valeur
  // enregistrée dans la fiche ne vaut que si l'admin l'a saisie à la main.
  const cards = {};
  for (const [m, byFo] of Object.entries(cfg.fo_scorecards || {})) {
    const card = byFo?.[fo];
    if (!card || typeof card !== 'object') continue;
    const c = { ...card };
    if (!card._ovr?.tasks && !card._neutre) {
      const sc = tachesDuMois(fo, m).score;
      if (sc === null) delete c.tasks; else c.tasks = sc;
    }
    cards[m] = { [fo]: c };
  }
  const mois  = monthKey();
  const prev  = prevMonthKey(mois);

  const scoreNow  = perfScoreOf(cards[mois]?.[fo]);
  const scorePrev = perfScoreOf(cards[prev]?.[fo]);

  // Repli sur la note libre quand le mois n'a pas encore été noté :
  // sans cela l'agent verrait « non évalué » alors qu'une note existe.
  const manual = Number(cfg.fo_performance?.[fo]);
  const neutre = !!cards[mois]?.[fo]?._neutre;
  const score  = scoreNow !== null ? scoreNow
               : (!neutre && Number.isFinite(manual) ? manual : null);

  let tendance = 'stable';
  if (scoreNow === null || scorePrev === null) tendance = 'inconnue';
  else if (scoreNow - scorePrev >= 3)  tendance = 'hausse';
  else if (scorePrev - scoreNow >= 3)  tendance = 'baisse';

  // Détail par critère : c'est sa propre notation, l'agent a le droit de
  // savoir sur quoi elle repose. Le mois courant s'il est noté, sinon le
  // dernier mois noté — sans ce repli le détail serait vide tout le mois.
  const cardNow  = legacyCard(cards[mois]?.[fo]);
  const cardPrev = legacyCard(cards[prev]?.[fo]);
  const refCard  = neutre ? null : scoreNow !== null ? cardNow : cardPrev;

  // Tasks se mesure en direct sur le mois en cours, même avant que le mois
  // soit noté : l'agent voit ses tâches terminées compter tout de suite.
  const tachesLive = cardNow?._ovr?.tasks || neutre ? null : tachesDuMois(fo, mois).score;
  const criteres = Object.entries(PERF_WEIGHTS).map(([id, weight]) => {
    const raw  = id === 'tasks' && tachesLive !== null ? tachesLive : refCard?.[id];
    const n    = Number(raw);
    const val  = (raw === undefined || raw === null || raw === '' || !Number.isFinite(n))
      ? null : n;
    const p    = Number(cardPrev?.[id]);
    return {
      id, weight, valeur: val,
      precedent: Number.isFinite(p) ? p : null,
    };
  });

  // Historique glissant sur 6 mois : une note isolée ne dit pas grand-chose,
  // la trajectoire si. Toujours la sienne, jamais celle d'un collègue.
  const historique = [];
  let k = mois;
  for (let i = 0; i < 6; i++) {
    historique.unshift({ periode: k, score: perfScoreOf(cards[k]?.[fo]) });
    k = prevMonthKey(k);
  }

  // Ses objectifs du trimestre. La page disait la note sans jamais dire
  // sur quoi l'agent s'était engagé : le critère « Individual objectives »
  // pèse 35 % et restait le seul dont on ne pouvait pas voir le contenu.
  // On envoie l'avancement calculé côté serveur — jalons tenus hors délai
  // comptés pour moitié — pour que l'agent lise exactement le même
  // pourcentage que son manager.
  const today = new Date().toISOString().slice(0, 10);
  const sess  = readSessions();
  // Session courante : l'ouverte, sinon la plus récente. Le bandeau de
  // retard ne doit pas rappeler un objectif d'un trimestre clos — les
  // sessions passées se relisent dans « My objectives », par navigation.
  const courante = sess.find(x => x.state === 'open')
    || [...sess].sort((a, b) => String(b.start || '').localeCompare(String(a.start || '')))[0];
  const objectifs = ((cfg.fo_objectives || {})[fo] || [])
    .filter(o => o.state === 'approved')
    .filter(o => !courante || o.session === courante.id)
    .map(o => {
      const late = OBJ.objLateInfo(o, today);
      const session = sess.find(x => x.id === o.session);
      return {
        id: o.id,
        title: o.title,
        due: o.due || '',
        progress: o.progress,
        progress_pct: OBJ.objProgressPct(o, today),
        late,
        session: session ? session.name : '',
        session_open: session?.state === 'open',
        steps: (o.steps || []).filter(x => x.state === 'approved').map(x => ({
          label: x.label || x.title || '',
          due: x.due || '',
          done: !!x.done,
          late: OBJ.stepLate(x, today),
        })),
      };
    })
    // Le plus en retard d'abord : c'est ce que l'agent doit voir en premier.
    .sort((a, b) => (b.late.days_over - a.late.days_over)
      || (b.late.late_steps - a.late.late_steps)
      || String(a.due || '9999').localeCompare(String(b.due || '9999')));

  // ── Commentaires du manager ─────────────────────────────────
  // Les commentaires saisis en notation vivaient dans la fiche sans
  // jamais atteindre l'intéressé : l'agent recevait un chiffre sans les
  // mots. Un 55 en Process sans explication ne peut être que contesté ;
  // le même 55 avec « escalade TT#4412 passée sans l'étape N2 » se
  // travaille. Ce sont ses propres commentaires : les lui montrer ne
  // révèle rien qui ne le concerne.
  //
  // Ils sont rattachés au critère quand ils y sont rangés, sinon versés
  // au niveau de la fiche. Les deux formes coexistent dans les données.
  const noteList = holder => {
    if (!holder) return [];
    if (Array.isArray(holder._notes)) return holder._notes;
    if (Array.isArray(holder.notes))  return holder.notes;
    const legacy = holder._note ?? (typeof holder.notes === 'string' ? holder.notes : null);
    return legacy ? [{ id: 'legacy', text: legacy, at: null }] : [];
  };
  const clean = n => ({
    id: n.id || '', text: String(n.text || ''), at: n.at || null,
  });
  const commentaires = [];
  if (refCard) {
    // Commentaires généraux de la fiche.
    noteList(refCard).forEach(n => {
      if (n && n.text) commentaires.push({ ...clean(n), critere: null });
    });
    // Commentaires rangés sous un critère.
    // `handover` a rejoint `process` : ses anciens commentaires y sont rangés.
    for (const [key, id] of [...Object.keys(PERF_WEIGHTS).map(k => [k, k]), ['handover', 'process']]) {
      const holder = refCard[`${key}_notes`] ? { _notes: refCard[`${key}_notes`] } : null;
      noteList(holder).forEach(n => {
        if (n && n.text) commentaires.push({ ...clean(n), critere: id });
      });
    }
  }
  commentaires.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));

  // ── Actions convenues en entretien ──────────────────────────
  // Ce que l'agent s'est engagé à faire, avec son manager. C'était
  // visible du seul côté manager alors que l'engagement est le sien :
  // il ne pouvait pas suivre ce qu'il avait accepté, ni voir ce qui
  // avait dépassé sa date. Le taux de suivi pèse par ailleurs 20 % du
  // critère « objectifs individuels ».
  const o2oEntry = (cfg.fo_o2o || {})[fo] || {};
  const actionsOf = m => {
    if (Array.isArray(m.actions)) return m.actions;
    const sec = (m.sections || []).find(x => x.id === 'actions');
    if (!sec || !sec.text) return [];
    return String(sec.text).split('\n').map(x => x.trim()).filter(Boolean)
      .map((text, i) => ({ id: `${m.id}-a${i}`, text, status: 'todo', due: '' }));
  };
  const actions = [...(o2oEntry.meetings || [])]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .flatMap(m => actionsOf(m).map(a => ({
      id: a.id || '',
      text: String(a.text || ''),
      status: a.status || 'todo',
      due: a.due || '',
      date: m.date || '',
      late: a.status === 'todo' && !!a.due && a.due < today,
    })))
    // Ce qui appelle une action d'abord : en retard, puis à faire.
    .sort((a, b) => (b.late - a.late)
      || (a.status === 'todo' ? -1 : 1) - (b.status === 'todo' ? -1 : 1)
      || String(a.due || '9999').localeCompare(String(b.due || '9999')));

  // Ni classement, ni note des collègues : l'entretien individuel reste le
  // lieu du détail qualitatif, la page ne fait que restituer les chiffres.
  return {
    fo,
    periode: mois,
    score,
    ...perfLevel(score),
    tendance,
    evalue: scoreNow !== null,
    // Mois neutralisé : la page agent le dit au lieu de « non évalué ».
    neutre,
    score_precedent: scorePrev,
    criteres,
    historique,
    objectifs,
    commentaires,
    actions,
    taches: tachesDuMois(fo, mois),
  };
}

module.exports = {
  foAccessCodes, buildPerfView, perfScoreOf, tachesDuMois,
};
