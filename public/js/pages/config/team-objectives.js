// ══════════════════════════════════════════════════════════════
// OBJECTIFS D'ÉQUIPE
// Cibles chiffrées, réglables dans Configuration et mesurées sur la
// période choisie dans le FO Dashboard. `dir` dit dans quel sens
// l'objectif est atteint : 'min' = au moins la cible (taux SLA),
// 'max' = au plus la cible (ruptures SLA).
// ══════════════════════════════════════════════════════════════
// `group` reprend les quatre familles du plan trimestriel (Fiabilité,
// Réactivité, Continuité, Discipline) pour que la page se lise comme le
// document de référence. `plan` est la cible officielle du trimestre :
// affichée à titre de repère, elle ne remplace pas la valeur saisie —
// l'équipe peut viser autre chose sur une période donnée.
const FO_GOAL_DEFS = [
  { id: 'sla_rate',  label: 'Taux SLA',              unit: '%',       dir: 'min', dflt: 90,
    group: 'Reliability', plan: 98,
    hint: 'Share of tickets handled within SLA.' },
  { id: 'breach',    label: 'Ruptures SLA',          unit: '',        dir: 'max', dflt: 0,
    group: 'Reliability', plan: 0,
    hint: 'Number of breaches tolerated.' },
  { id: 'mttr',      label: 'Average resolution',    unit: 'h',       dir: 'max', dflt: 24,
    group: 'Responsiveness',
    hint: 'Target average resolution time — the plan aims for −15 % vs 2025.' },
  { id: 'resolved',  label: 'Resolved tickets',       unit: '',        dir: 'min', dflt: 50,
    group: 'Responsiveness',
    hint: 'Volume resolved in the displayed period.' },
  { id: 'tasks',     label: 'Tâches accomplies',     unit: '%',       dir: 'min', dflt: 80,
    group: 'Continuity', plan: 95,
    hint: 'Share of assigned tasks completed — Daily Check-up and Équipe › Tâches.' },
  { id: 'progress',  label: 'Weekly progress delivered', unit: '%',       dir: 'min', dflt: 80,
    group: 'Continuity', plan: 100,
    hint: 'Share of the items agents plan themselves in “Done” (assigned tasks count above).' },
  { id: 'training',  label: 'Quizzes passed',          unit: '%',       dir: 'min', dflt: 70,
    group: 'Discipline', plan: 80,
    hint: 'Average score on training quizzes.' },
  { id: 'absence',   label: 'Taux d\'absence',       unit: '%',       dir: 'max', dflt: 8,
    group: 'Discipline', plan: 2,
    hint: 'Maximum accepted absenteeism.' },
];

function _foGoals() { return state.config.fo_goals || {}; }

function renderGoalsConfig() {
  const el = document.getElementById('config-goals');
  if (!el) return;
  const g = _foGoals();

  // Une ligne par objectif, regroupée par famille — même vocabulaire
  // visuel que la page SLA.
  const row = d => {
    const v   = g[d.id];
    const val = (v === undefined || v === null || v === '') ? '' : v;
    const ref = d.plan === undefined ? ''
      : `<span class="gsla-plan" title="Quarterly plan target">Plan ${d.dir === 'min' ? '≥' : '≤'} ${d.plan}${d.unit}</span>`;
    // Un champ vide = objectif désactivé : la ligne le dit d'elle-même
    // (contour pointillé) plutôt que de laisser deviner au placeholder.
    return `<div class="gsla-row gsla-row-goal${val === '' ? ' is-unset' : ''}">
      <span class="gsla-goal-main">
        <label class="gsla-name" for="goal-${d.id}">${d.label}</label>
        <span class="gsla-goal-hint">${d.hint}</span>
      </span>
      ${ref}
      <span class="gsla-num">
        <span class="gsla-dir">${d.dir === 'min' ? '≥' : '≤'}</span>
        <input id="goal-${d.id}" type="number" min="0" step="any"
               data-goal-key="${d.id}" placeholder="${d.dflt}" value="${val}"
               oninput="onGoalInput(this)"
               aria-label="${d.label} — cible">
        <span class="gsla-unit">${d.unit || ''}</span>
      </span>
    </div>`;
  };

  const groups = [];
  FO_GOAL_DEFS.forEach(d => {
    const last = groups[groups.length - 1];
    if (last && last.name === d.group) last.defs.push(d);
    else groups.push({ name: d.group, defs: [d] });
  });

  // Le compteur d'objectifs actifs par famille : il répond à « qu'est-ce
  // qui est réellement suivi ? » sans avoir à parcourir chaque ligne.
  const activeIn = defs => defs.filter(d => {
    const v = g[d.id];
    return v !== undefined && v !== null && v !== '';
  }).length;

  el.classList.add('gsla-goals');
  el.innerHTML = groups.map(gr => `<div class="gsla-group">
    <div class="gsla-group-t">
      <span>${gr.name}</span>
      <span class="gsla-group-count">${activeIn(gr.defs)}/${gr.defs.length} actifs</span>
    </div>
    ${gr.defs.map(row).join('')}
  </div>`).join('');
}

// Reflète l'état « objectif désactivé » pendant la saisie, et tient à
// jour le compteur de la famille : vider un champ doit se voir tout de
// suite, pas seulement après enregistrement.
function onGoalInput(inp) {
  const row = inp.closest('.gsla-row');
  if (row) row.classList.toggle('is-unset', inp.value.trim() === '');
  const group = inp.closest('.gsla-group');
  const badge = group?.querySelector('.gsla-group-count');
  if (!group || !badge) return;
  const all = group.querySelectorAll('[data-goal-key]');
  const on  = [...all].filter(i => i.value.trim() !== '').length;
  badge.textContent = `${on}/${all.length} actifs`;
}

async function saveGoals() {
  const fo_goals = {};
  document.querySelectorAll('#config-goals [data-goal-key]').forEach(inp => {
    const key = inp.getAttribute('data-goal-key');
    // Un champ vide retire l'objectif : c'est la façon de le désactiver.
    if (inp.value.trim() === '') return;
    const val = Number(inp.value);
    if (!isFinite(val) || val < 0) return;
    fo_goals[key] = val;
  });
  const cfg = { ...state.config, fo_goals };
  const res = await fetch(`${API}/api/config`, {
    method: 'PUT', headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
    credentials: 'same-origin', body: JSON.stringify(cfg) });
  if (!res.ok) { toast('Server error', 'error'); return; }
  await loadConfig();
  renderConfig();
  toast('Objectives saved', 'success');
}

