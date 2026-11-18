// ══════════════════════════════════════════════════════════════
// ONE-TO-ONE — entretiens et objectifs personnels
// La notation mensuelle dit où en est l'agent ; elle ne dit pas ce
// qu'on lui a demandé ni ce qui a été convenu. Cet espace tient les
// deux : un historique d'entretiens daté, et des objectifs personnels
// suivis d'un entretien à l'autre — ce que le champ « Commentaire »
// de la fiche mensuelle ne pouvait pas porter, faute de date et de
// continuité entre les mois.
//
// Rangé sous config.fo_o2o[fo] = { objectives:[…], meetings:[…] } :
// les objectifs personnels vivent au-delà du mois noté, on ne les
// range donc pas sous fo_scorecards.
// ══════════════════════════════════════════════════════════════
const O2O_STATUSES = [
  { id: 'todo',    label: 'To start' },
  { id: 'doing',   label: 'En cours' },
  { id: 'done',    label: 'Atteint' },
  { id: 'dropped', label: 'Dropped' },
];

// ── Trame d'entretien ─────────────────────────────────────────
// Un entretien se conduit, il ne s'improvise pas devant une zone de
// texte vide. La trame propose les questions à poser ; chaque section
// reste facultative et l'ensemble est personnalisable (on masque ce
// qu'on n'utilise pas, on ajoute ses propres rubriques).
//
// Les trames vivent dans config.o2o_template — modifiable par
// l'utilisateur, avec ce jeu par défaut au premier usage.
const O2O_SECTIONS_DEFAULT = [
  { id: 'wins',    label: 'What went well',
    hint: 'Wins of the month, what to build on.' },
  { id: 'blocked', label: 'Difficulties encountered',
    hint: 'Obstacles, manques d’outil ou d’information.' },
  { id: 'feedback', label: 'Feedback to the agent',
    hint: 'What you expect, clearly stated.' },
  { id: 'agent',   label: 'What the agent asks for',
    hint: 'Their requests: training, resources, career.' },
  { id: 'actions', label: 'Actions convenues',
    hint: 'One action per line — who does what, by when.', list: true },
];

// Le champ suit la hauteur de son contenu : réserver quatre lignes à
// une rubrique qui en prendra une allonge le formulaire pour rien.
function autoGrow(ta) {
  if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

function _o2oSections() {
  const t = state.config.o2o_template;
  return Array.isArray(t) && t.length ? t : O2O_SECTIONS_DEFAULT;
}

// Humeur de l'entretien : trois niveaux, saisis en un clic. Sur douze
// entretiens on lit une trajectoire, ce qu'un texte libre ne donne pas.
const O2O_MOODS = [
  { id: 'up',   label: 'Bonne dynamique' },
  { id: 'flat', label: 'Stable' },
  { id: 'down', label: 'Point de vigilance' },
];

// ── Commentaires datés ────────────────────────────────────────
// Un seul champ de texte écrasé à chaque passage ne garde aucune trace :
// le mois suivant, on ne sait plus ce qui avait été dit ni quand. Les
// commentaires deviennent une suite d'entrées datées, ajoutables à tout
// moment et modifiables après coup.
//
// Portés à la fois par les notations mensuelles (fo_scorecards[mois][fo]
// ._notes) et par les objectifs personnels (objective.notes), d'où ces
// utilitaires communs.
function _noteNew(text) {
  return {
    id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text: String(text).slice(0, 4000),
    at: new Date().toISOString(),
  };
}

// Migration douce : les fiches existantes portent `_note`, une chaîne
// unique. On la présente comme une première entrée plutôt que de la
// perdre — sans réécrire le fichier tant que rien n'est modifié.
function _noteList(holder) {
  if (!holder) return [];
  if (Array.isArray(holder._notes)) return holder._notes;
  if (Array.isArray(holder.notes))  return holder.notes;
  const legacy = holder._note ?? (typeof holder.notes === 'string' ? holder.notes : null);
  return legacy ? [{ id: 'legacy', text: legacy, at: null }] : [];
}

// Horodatage court et lisible : « 8 août, 14:30 ».
function _noteWhen(iso) {
  if (!iso) return 'No date';
  const d = new Date(iso);
  if (isNaN(d)) return 'No date';
  return d.toLocaleDateString((globalThis.PEAR_LOCALE || 'fr-FR'), { day: 'numeric', month: 'short' })
    + ', ' + d.toLocaleTimeString((globalThis.PEAR_LOCALE || 'fr-FR'), { hour: '2-digit', minute: '2-digit' });
}

// Fil de commentaires réutilisable.
//   `ns`    préfixe les identifiants DOM — deux fils sur le même écran
//           ne doivent pas se marcher dessus ;
//   `fns`   nom des fonctions appelées, auxquelles on passe toujours
//           (ns, id) : un seul jeu de gestionnaires sert les deux fils.
function _noteThread(ns, notes, fns, placeholder) {
  const call = (fn, id) => `${fn}('${ns}'${id ? `,'${id}'` : ''})`;
  const items = notes.map(n => `
    <li class="nt-item">
      <div class="nt-body" id="${ns}-body-${n.id}">
        <p class="nt-text">${esc(n.text).replace(/\n/g, '<br>')}</p>
        <div class="nt-meta">
          <span class="nt-when">${_noteWhen(n.at)}${n.edited ? ' · edited' : ''}</span>
          <button class="nt-act" onclick="${call(fns.edit, n.id)}">Modifier</button>
          <button class="nt-act" onclick="${call(fns.del, n.id)}">Supprimer</button>
        </div>
      </div>
      <div class="nt-edit" id="${ns}-edit-${n.id}" hidden>
        <textarea class="form-control nt-ta" id="${ns}-ta-${n.id}" rows="3">${esc(n.text)}</textarea>
        <div class="nt-edit-foot">
          <button class="nt-btn is-ghost" onclick="${call(fns.cancel, n.id)}">Annuler</button>
          <button class="nt-btn" onclick="${call(fns.save, n.id)}">Enregistrer</button>
        </div>
      </div>
    </li>`).join('');

  return `<div class="nt">
    ${notes.length ? `<ol class="nt-list">${items}</ol>` : ''}
    <div class="nt-add">
      <textarea class="form-control nt-ta" id="${ns}-new" rows="2"
        placeholder="${esc(placeholder || 'Add a comment…')}"></textarea>
      <button class="nt-btn" onclick="${call(fns.add)}">Ajouter</button>
    </div>
  </div>`;
}

// État d'affichage de la vue One-to-One : quel objectif est en cours
// d'édition, lequel est déplié, et sur quel onglet il est ouvert.
// Purement visuel — rien ici n'est persisté.
//
// Un seul objectif ouvert à la fois : c'est ce qui distingue la liste
// parcourable (neuf intitulés qu'on balaie) du détail sur lequel on
// travaille. Tout déplier donnait la page interminable de la capture.
const o2oUI = { editing: null, open: null, pane: 'steps', formOpen: false };

// Jalons d'un objectif : « certification obtenue » ne se suit pas d'un
// coup, il se découpe. Chaque jalon est une case à cocher datée — c'est
// ce qui rend l'avancement lisible sans avoir à lire les commentaires.
function _stepList(o) { return Array.isArray(o?.steps) ? o.steps : []; }

// L'intitulé d'un jalon s'écrit `title` quand l'application le crée, mais
// `label` dans les objectifs importés du plan trimestriel. Les deux jeux
// cohabitent dans la même liste : on lit l'un ou l'autre, sans quoi un
// seul jalon issu du plan suffit à faire échouer tout le rendu de la vue.
function _stepTitle(s) { return s?.title ?? s?.label ?? ''; }

// ── Jalons suggérés ───────────────────────────────────────────
// Devant un objectif vide, « ajoutez un jalon » ne dit pas lesquels. On
// propose un découpage tiré de la nature de l'objectif — reconnue sur
// son intitulé et son KPI, qui viennent du plan trimestriel et emploient
// un vocabulaire stable (certification, RCA, session, shadowing…).
// Ce sont des propositions : on clique celles qu'on garde.
const STEP_RECIPES = [
  { match: /certification|itil|hcia|examen/i,
    steps: ['Choose the session and register', 'Review the syllabus',
            'Passer l’examen', 'Submit the certificate'] },
  { match: /rca|cause racine|root cause/i,
    steps: ['Identify the incident to analyse', 'Collecter logs et chronologie',
            'Write the analysis', 'Get the RCA approved'] },
  { match: /session|partage|knowledge|animé/i,
    steps: ['Choose the topic', 'Prepare the material',
            'Run the session', 'Share the material with the team'] },
  { match: /shadowing|immersion|back office|bo /i,
    steps: ['Schedule the slots', 'Complete the immersion',
            'Debrief with the referent'] },
  { match: /checklist|backup it|validation/i,
    steps: ['Draw up the checklist', 'Run through the checks',
            'Get IT OSS approval'] },
  { match: /procédure|fiche|documentation|base de connaissance/i,
    steps: ['List the sheets to produce', 'Write the sheets',
            'Faire relire et valider'] },
  { match: /formation|module|training/i,
    steps: ['Identify the training', 'Follow the module',
            'Apply it in the field'] },
  { match: /scorecard|score|évaluation|assessment/i,
    steps: ['Mid-point review', 'Monthly score review',
            'End-of-quarter review'] },
];

// Découpage par défaut : convient à un objectif de progression continue,
// où il n'y a pas d'étape métier identifiable.
const STEP_GENERIC = ['Starting point established', 'Halfway reached', 'Objective met'];

function _suggestSteps(o) {
  const hay = `${o.title || ''} ${o.kpi || ''}`;
  const hit = STEP_RECIPES.find(r => r.match.test(hay));
  const base = hit ? hit.steps : STEP_GENERIC;
  // On ne repropose pas ce qui est déjà posé.
  const have = _stepList(o).map(s => _stepTitle(s).toLowerCase());
  return base.filter(t => !have.includes(t.toLowerCase()));
}

// Avancement déduit des jalons, ou du statut s'il n'y en a pas.
function _objProgress(o) {
  const steps = _stepList(o);
  if (!steps.length) return o.status === 'done' ? 100 : o.status === 'doing' ? 50 : 0;
  return _stepsPct(steps);
}

// Un objectif du plan a-t-il déjà été repris dans le flux agent ? On le
// signale sur cette page pour éviter qu'il soit modifié aux deux
// endroits, sans pour autant le retirer d'ici : le critère « individual »
// de la notation mensuelle se calcule encore sur cette liste.
function _o2oCarriedOver(fo) {
  const mine = (state.config.fo_objectives || {})[fo] || [];
  return mine.some(o => typeof o.origin === 'string' && o.origin.startsWith('o2o:'));
}

function _o2oAll() { return state.config.fo_o2o || {}; }
function _o2oFor(fo) {
  const e = _o2oAll()[fo] || {};
  return { objectives: e.objectives || [], meetings: e.meetings || [] };
}
function _o2oUid() { return 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function _o2oToday() { return new Date().toISOString().slice(0, 10); }

// Écrit dans state.config puis persiste. Chaque geste (ajout, coche,
// suppression) enregistre : un entretien à moitié saisi qu'on perd en
// changeant d'agent serait pire que l'absence de la fonction.
async function _o2oCommit(fo, mutate) {
  const all = JSON.parse(JSON.stringify(_o2oAll()));
  all[fo] = all[fo] || { objectives: [], meetings: [] };
  all[fo].objectives = all[fo].objectives || [];
  all[fo].meetings   = all[fo].meetings   || [];
  mutate(all[fo]);
  // Un agent sans rien n'a pas à occuper une entrée dans la config.
  if (!all[fo].objectives.length && !all[fo].meetings.length) delete all[fo];

  const cfg = { ...state.config, fo_o2o: all };
  const res = await fetch(`${API}/api/config`, {
    method: 'PUT', headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
    credentials: 'same-origin', body: JSON.stringify(cfg) });
  if (!res.ok) { toast('Server error', 'error'); return false; }
  await loadConfig();
  renderO2O();
  return true;
}

function renderO2O() {
  const el = document.getElementById('perf-o2o');
  if (!el) return;
  const fo = perfUI.fo;
  if (!fo) { el.innerHTML = ''; return; }

  const { objectives, meetings } = _o2oFor(fo);
  // Objectifs en cours d'abord : c'est sur eux que porte l'entretien.
  const open = objectives.filter(o => o.status !== 'done' && o.status !== 'dropped');
  const closed = objectives.filter(o => o.status === 'done' || o.status === 'dropped');
  const sorted = [...meetings].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const done = objectives.filter(o => o.status === 'done').length;

  // Nom de l'agent prêt à passer dans un attribut onclick.
  const q = esc(fo).replace(/'/g, "\\'");
  const entry = _o2oAll()[fo] || {};
  const sections = _o2oSections();

  // Une carte d'objectif se lit sur deux niveaux : une ligne repliée qui
  // tient l'essentiel (intitulé, avancement, échéance), et un détail
  // dépliable où l'on travaille — jalons, suivi, réglages.
  const objRow = o => {
    const st    = O2O_STATUSES.find(s => s.id === o.status) || O2O_STATUSES[0];
    const late  = o.due && o.status !== 'done' && o.status !== 'dropped' && o.due < _o2oToday();
    const notes = _noteList(o);
    const steps = _stepList(o);
    const pct   = _objProgress(o);
    const isOpen = o2oUI.open === o.id;
    const doneSteps = steps.filter(s => s.done).length;
    const pane = o2oUI.pane;
    const sugg = _suggestSteps(o);

    // Ligne repliée : cliquable sur toute sa surface.
    const head = `
      <button class="ob-head" onclick="o2oToggle('${o.id}')" aria-expanded="${isOpen}">
        <span class="ob-chev" aria-hidden="true"></span>
        <span class="ob-head-main">
          <span class="ob-title">${esc(o.title)}</span>
          <span class="ob-sub">
            <span class="o2o-status is-${o.status}">${st.label}</span>
            ${steps.length ? `<span class="ob-steps-count">${doneSteps}/${steps.length} jalons</span>` : ''}
            ${notes.length ? `<span class="ob-notes-count">${notes.length} suivi</span>` : ''}
            ${o.due ? `<span class="o2o-due${late ? ' is-late' : ''}">${esc(o.due)}${late ? ' · overdue' : ''}</span>` : ''}
          </span>
        </span>
        <span class="ob-gauge" role="img" aria-label="${pct} % d’avancement">
          <span class="ob-gauge-fill" style="width:${pct}%"></span>
        </span>
        <span class="ob-pct">${pct}%</span>
      </button>`;

    if (!isOpen) return `<div class="o2o-obj is-${o.status}">${head}</div>`;

    // Détail : trois volets plutôt qu'un empilement. On ne consulte pas
    // les jalons et les réglages au même moment.
    const tab = (id, label, count) => `
      <button class="ob-tab${pane === id ? ' is-on' : ''}" onclick="o2oPane('${id}')" role="tab"
              aria-selected="${pane === id}">${label}${count ? ` <span class="ob-tab-n">${count}</span>` : ''}</button>`;

    const stepsPane = `
      <div class="ob-steps">
        ${steps.length ? steps.map(s => `
          <label class="ob-step${s.done ? ' is-done' : ''}">
            <input type="checkbox"${s.done ? ' checked' : ''}
                   onchange="o2oToggleStep('${q}','${o.id}','${s.id}')">
            <span class="ob-step-box" aria-hidden="true"></span>
            <span class="ob-step-t">${esc(_stepTitle(s))}</span>
            ${s.due ? `<span class="ob-step-due">${esc(s.due)}</span>` : ''}
            <button class="o2o-icon ob-step-del" title="Delete milestone" aria-label="Delete milestone"
                    onclick="event.preventDefault();o2oDelStep('${q}','${o.id}','${s.id}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
            </button>
          </label>`).join('')
        : '<p class="ob-empty">No milestone. Break the objective into verifiable steps.</p>'}

        ${sugg.length ? `<div class="ob-sugg">
          <div class="ob-sugg-head">
            <span>Suggested breakdown</span>
            ${!steps.length ? `<button class="ob-sugg-all" onclick="o2oAddAllSteps('${q}','${o.id}')">Add all</button>` : ''}
          </div>
          <div class="ob-sugg-chips">
            ${sugg.map((t, i) => `<button class="ob-sugg-chip" onclick="o2oAddSuggested('${q}','${o.id}',${i})">
              <span aria-hidden="true">+</span>${esc(t)}</button>`).join('')}
          </div>
        </div>` : ''}

        <div class="ob-step-add">
          <input class="form-control" id="st-new-${o.id}" maxlength="160" placeholder="New milestone"
                 onkeydown="if(event.key==='Enter'){event.preventDefault();o2oAddStep('${q}','${o.id}')}">
          <input class="form-control ob-step-date" id="st-due-${o.id}" type="date" required aria-required="true"
                 aria-label="Milestone deadline (required)" title="Deadline — required"
                 oninput="this.classList.remove('is-missing')">
          <button class="nt-btn" onclick="o2oAddStep('${q}','${o.id}')">Ajouter</button>
        </div>
      </div>`;

    const notesPane = `<div class="ob-pane-body">
      ${_noteThread('on-' + o.id, notes, NT_FNS, 'Where does this objective stand?')}
    </div>`;

    const setPane = `
      <div class="ob-pane-body o2o-edit">
        <label class="form-label" for="ob-title-${o.id}">Title</label>
        <input class="form-control" id="ob-title-${o.id}" maxlength="180" value="${esc(o.title)}">
        <div class="o2o-edit-grid">
          <div class="ob-f">
            <label class="form-label" for="ob-kpi-${o.id}">KPI — cible et source</label>
            <input class="form-control" id="ob-kpi-${o.id}" maxlength="140" value="${esc(o.kpi || '')}">
          </div>
          <div class="ob-f">
            <label class="form-label" for="ob-due-${o.id}">Due date</label>
            <input class="form-control" id="ob-due-${o.id}" type="date" value="${esc(o.due || '')}">
          </div>
          <div class="ob-f">
            <label class="form-label" for="ob-st-${o.id}">Statut</label>
            <select class="form-control" id="ob-st-${o.id}">
              ${O2O_STATUSES.map(s => `<option value="${s.id}"${s.id === o.status ? ' selected' : ''}>${s.label}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="ob-set-foot">
          <button class="nt-btn is-danger" onclick="o2oDelObjective('${q}','${o.id}')">Delete objective</button>
          <button class="nt-btn" onclick="o2oSaveObjective('${q}','${o.id}')">Enregistrer</button>
        </div>
      </div>`;

    return `<div class="o2o-obj is-${o.status} is-open">
      ${head}
      <div class="ob-detail">
        ${o.kpi ? `<p class="ob-kpi-line"><span>KPI</span>${esc(o.kpi)}</p>` : ''}
        <div class="ob-tabs" role="tablist">
          ${tab('steps', 'Jalons', steps.length)}
          ${tab('notes', 'Suivi', notes.length)}
          ${tab('set',   'Settings', 0)}
        </div>
        ${pane === 'steps' ? stepsPane : pane === 'notes' ? notesPane : setPane}
      </div>
    </div>`;
  };

  // Les objectifs ne vivent plus ici : ils sont saisis par l'agent et
  // arbitrés dans Performance → Approvals, et c'est de là que vient la
  // note. Garder une liste modifiable en doublon n'aurait fait
  // qu'entretenir deux versions divergentes du même objectif. Cette page
  // redevient donc ce qu'elle est : la page des entretiens.
  //
  // On garde un simple report de ce que l'agent suit — sans quoi il
  // faudrait changer d'écran en plein entretien pour savoir de quoi
  // parler.
  const live = _scoredObjectives(fo);
  const liveDone = live.filter(o => o.status === 'done').length;
  const today = _o2oToday();
  const liveLate = live.filter(o =>
    o.due && o.due < today && !['done', 'dropped'].includes(o.status));

  el.innerHTML = `
    <div class="gsla-card">
      <div class="gsla-card-head o2o-head">
        <div>
          <h3 class="gsla-card-t">Objectives</h3>
          ${entry.focus ? `<p class="o2o-focus">${esc(entry.focus)}</p>` : ''}
        </div>
        ${live.length ? `<span class="o2o-tally">${liveDone}/${live.length} met</span>` : ''}
      </div>

      ${live.length ? `
        <div class="o2o-recap">
          ${live.map(o => {
            const late = o.due && o.due < today && !['done', 'dropped'].includes(o.status);
            const lbl = { todo: 'To start', doing: 'In progress', done: 'Met', dropped: 'Not met' }[o.status] || o.status;
            return `<div class="o2o-rc ${o.status === 'done' ? 'is-done' : ''}">
              <span class="o2o-rc-t">${esc(o.title || '')}</span>
              <span class="o2o-rc-s st-${esc(o.status)}">${esc(lbl)}</span>
              ${o.due ? `<span class="o2o-rc-d ${late ? 'is-late' : ''}">${esc(o.due)}</span>` : ''}
            </div>`;
          }).join('')}
        </div>
        ${liveLate.length ? `<div class="o2o-recap-warn">
          ${liveLate.length} objective${liveLate.length > 1 ? 's are' : ' is'} past its deadline — worth raising in the meeting.
        </div>` : ''}
      ` : `<div class="o2o-none">No objective is being tracked for this agent yet.</div>`}

      <div class="o2o-recap-foot">
        Objectives are written by the agent and approved by you in
        <b>Performance → Approvals</b>, which is also where the monthly
        “Objectives” score comes from. This is a read-only recap for the meeting.
      </div>
    </div>

    <div class="gsla-card">
      <div class="gsla-card-head o2o-head">
        <h3 class="gsla-card-t">Entretiens</h3>
        <span class="o2o-head-r">
          <span class="o2o-tally">${sorted.length}</span>
          <!-- Session guidée : l'entretien mené à l'écran, étape par étape,
               avec les questions SMART du modèle (o2o-guide.js). -->
          <button class="o2o-btn o2o-btn-guide" onclick="o2oGuideOpen('${q}')">Session guidée</button>
        </span>
      </div>

      <!-- Trame d'entretien : les questions à poser, dans l'ordre où on
           les pose. Chaque rubrique est facultative — ce qui reste vide
           n'apparaît pas dans le compte rendu. -->
      <details class="o2o-fold" id="o2o-form"${o2oUI.formOpen ? ' open' : ''}
               ontoggle="o2oUI.formOpen=this.open">
        <summary>Run a meeting</summary>
        <div class="o2o-new">
          ${_o2oReprise(fo, meetings)}
          <div class="o2o-new-bar">
            <input class="form-control o2o-new-date" id="o2o-m-date" type="date"
                   value="${_o2oToday()}" aria-label="Meeting date">
            <input class="form-control" id="o2o-m-topic" maxlength="140"
                   placeholder="Objet — ex. « Point mensuel »">
          </div>

          <div class="o2o-mood" role="radiogroup" aria-label="Meeting tone">
            ${O2O_MOODS.map(md => `
              <label class="o2o-mood-opt">
                <input type="radio" name="o2o-mood" value="${md.id}"${md.id === 'flat' ? ' checked' : ''}>
                <span>${md.label}</span>
              </label>`).join('')}
          </div>

          <div class="o2o-secs">
            ${sections.map(s => `
              <div class="o2o-sec">
                <label class="form-label" for="o2o-s-${s.id}">${esc(s.label)}</label>
                ${s.hint ? `<p class="o2o-sec-hint">${esc(s.hint)}</p>` : ''}
                <textarea class="o2o-sec-ta bare-input" id="o2o-s-${s.id}" data-o2o-sec="${s.id}" rows="1"
                  oninput="autoGrow(this)"
                  placeholder="${esc(s.ph || (s.list ? 'One action per line…' : 'Write…'))}"></textarea>
              </div>`).join('')}
          </div>

          <div class="o2o-new-foot">
            <button class="nt-btn is-ghost" onclick="o2oEditTemplate()">Customise template</button>
            <button class="o2o-btn" onclick="o2oAddMeeting('${q}')">Save meeting</button>
          </div>
        </div>
      </details>

      ${sorted.length ? `<ol class="o2o-tl">${sorted.map(m => {
        const secs = Array.isArray(m.sections) ? m.sections : null;
        const mood = O2O_MOODS.find(x => x.id === m.mood);
        return `<li class="o2o-tl-item">
          <div class="o2o-tl-head">
            <span class="o2o-tl-date">${esc(m.date)}</span>
            ${m.topic ? `<span class="o2o-tl-topic">${esc(m.topic)}</span>` : ''}
            ${mood ? `<span class="o2o-mood-tag is-${m.mood}">${mood.label}</span>` : ''}
            <button class="o2o-icon" title="Delete meeting" aria-label="Delete meeting"
                    onclick="o2oDelMeeting('${q}','${m.id}')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
            </button>
          </div>
          ${secs ? secs.map(s => `
            <div class="o2o-tl-sec">
              <div class="o2o-tl-sec-t">${esc(s.label)}</div>
              ${s.list
                ? `<ul class="o2o-acts">${s.text.split('\n').filter(Boolean)
                     .map(l => `<li>${esc(l)}</li>`).join('')}</ul>`
                : `<p class="o2o-tl-notes">${esc(s.text).replace(/\n/g, '<br>')}</p>`}
            </div>`).join('')
          : `${m.notes ? `<p class="o2o-tl-notes">${esc(m.notes).replace(/\n/g, '<br>')}</p>` : ''}
             ${(m.actions || []).length ? `<ul class="o2o-acts">
               ${m.actions.map(a => `<li>${esc(typeof a === 'string' ? a : (a && a.text) || '')}</li>`).join('')}
             </ul>` : ''}`}
        </li>`;
      }).join('')}</ol>`
      : '<div class="o2o-none">No meeting recorded for this agent.</div>'}
    </div>`;
}

async function o2oAddObjective(fo) {
  const t = document.getElementById('o2o-new-title');
  const d = document.getElementById('o2o-new-due');
  const title = (t?.value || '').trim();
  if (!title) { toast('Title required', 'error'); t?.focus(); return; }
  const obj = { id: _o2oUid(), title: title.slice(0, 180), status: 'todo', created: _o2oToday() };
  if (d?.value) obj.due = d.value;
  if (await _o2oCommit(fo, e => e.objectives.push(obj))) toast('Objective added', 'success');
}

