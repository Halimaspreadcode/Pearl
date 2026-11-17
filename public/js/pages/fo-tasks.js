// ── FO DAILY CHECK-UP ────────────────────────────────────────
// Plus d'entrée de menu (remplacé par My Tasks, weekly-progress), mais
// l'écran reste : c'est le seul endroit où l'on coche, modifie ou
// supprime une tâche /api/fo-tasks — y compris les occurrences d'une
// tâche récurrente, que les rappels (tk-late, tk-today, tk-blocked)
// continuent de signaler et d'ouvrir ici.
let editingFOTaskId = null;

// pill toggle logic - works for both priority and recurrence groups.
// Un seul écouteur délégué par groupe : _initPills est rappelé à chaque
// ouverture de panneau et empilait auparavant un écouteur par chip et
// par ouverture. La garde `_pillsBound` rend l'appel idempotent.
function _initPills(containerId) {
  const container = document.getElementById(containerId);
  if (!container || container._pillsBound) return;
  container._pillsBound = true;
  container.setAttribute('role', 'radiogroup');

  const select = pill => {
    const radio = pill.querySelector('input[type=radio]');
    if (!radio) return;
    radio.checked = true;
    container.querySelectorAll('.fotask-pill').forEach(p => {
      const on = p === pill;
      p.classList.toggle('fotask-pill-active', on);
      p.setAttribute('aria-checked', String(on));
    });
    // Les aperçus / avatars branchés en `change` ne se déclenchaient pas :
    // cocher un radio par script n'émet pas l'évènement.
    radio.dispatchEvent(new Event('change', { bubbles: true }));
  };

  container.addEventListener('click', e => {
    const pill = e.target.closest('.fotask-pill');
    if (pill && container.contains(pill)) select(pill);
  });

  // Flèches ← → pour parcourir le groupe, comme un radiogroup natif.
  container.addEventListener('keydown', e => {
    if (!['ArrowRight','ArrowLeft','ArrowUp','ArrowDown'].includes(e.key)) return;
    const pills = [...container.querySelectorAll('.fotask-pill')];
    const cur = pills.findIndex(p => p.classList.contains('fotask-pill-active'));
    const step = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
    const next = pills[(Math.max(cur, 0) + step + pills.length) % pills.length];
    if (!next) return;
    e.preventDefault();
    select(next);
    next.querySelector('input[type=radio]')?.focus();
  });
}

function _setPill(containerId, value) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.fotask-pill').forEach(pill => {
    const radio = pill.querySelector('input[type=radio]');
    if (!radio) return;
    const match = radio.value === value;
    pill.classList.toggle('fotask-pill-active', match);
    pill.setAttribute('aria-checked', String(match));
    radio.checked = match;
  });
}

const AVATAR_COLORS_FO = ['#C7000B','#2563EB','#059669','#7C3AED','#D97706','#0891B2','#BE185D','#65A30D','#DC2626','#0D9488'];
function updateFOTaskAvatar() {
  const sel = document.getElementById('fotask-fo-select');
  const av  = document.getElementById('fotask-fo-avatar');
  if (!av || !sel) return;
  const name = sel.value;
  if (!name) {
    av.textContent = '?'; av.style.background = 'var(--bg2)'; av.style.color = 'var(--mute)'; av.style.border = '1.5px solid var(--line)';
    const b = document.getElementById('fotask-fo-tracker-badge'); if (b) b.style.display = 'none';
    return;
  }
  const idx = (state.config.fo_list||[]).indexOf(name);
  const color = AVATAR_COLORS_FO[idx % AVATAR_COLORS_FO.length] || '#C7000B';
  av.textContent = name.split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase();
  av.style.background = color;
  av.style.color = '#fff';
  av.style.border = 'none';

  const badge = document.getElementById('fotask-fo-tracker-badge');
  if (badge) {
    const tr = personSite(name);
    badge.textContent = tr;
    badge.style.display = 'inline-block';
    badge.style.background = siteBg(tr);
    badge.style.color = siteColor(tr);
  }
}

// ── DAILY CHECK-UP ────────────────────────────────────────────
// Statuts stockés côté données. Le select de filtre d'origine
// proposait des valeurs en minuscules ('pending', 'done', 'verified')
// alors que les tâches portent 'Pending' / 'Done' / … : aucun filtre
// ne matchait jamais, et 'verified' n'existe pas dans le modèle.
const DCHK_STATUSES = ['Pending', 'In Progress', 'Blocked', 'Done'];
const DCHK_PRIO_CLS = { Critical:'prio-high', High:'prio-high', Medium:'prio-med', Low:'prio-low' };
const DCHK_RECUR_LBL = { daily:'Quotidien', weekly:'Hebdo', monthly:'Mensuel' };
// Ordre d'affichage : ce qui bloque ou traîne remonte.
const DCHK_ORDER = { Blocked:0, 'In Progress':1, Pending:2, Recurring:3, Done:4 };

const DCHK_ICON = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  edit:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
  sun:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  list:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  repeat:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
  done:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
};

// Filtre de statut courant. Piloté par les segments et par les
// pastilles de décompte du héros (qui servent de raccourci).
let _dchkStatus = '';

function setDchkStatus(v) {
  _dchkStatus = (_dchkStatus === v) ? '' : v;
  renderFOTasks();
}

// Initiales pour l'avatar — même logique que le panneau d'assignation.
function _dchkInitials(name) {
  return (name || '?').split(' ').filter(Boolean).slice(0, 2)
    .map(w => w[0]).join('').toUpperCase() || '?';
}
function _dchkColor(name) {
  const idx = (state.config.fo_list || []).indexOf(name);
  return AVATAR_COLORS_FO[(idx < 0 ? 0 : idx) % AVATAR_COLORS_FO.length];
}

// Échéance en clair : « aujourd'hui », « demain », « en retard de 3 j ».
// Une date ISO seule n'aide pas à juger de l'urgence.
function _dchkDue(dateStr, today) {
  if (!dateStr) return null;
  const diff = Math.round((new Date(dateStr + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
  if (diff === 0)  return { txt: "Aujourd'hui", late: false };
  if (diff === 1)  return { txt: 'Demain', late: false };
  if (diff === -1) return { txt: 'Hier', late: true };
  if (diff < 0)    return { txt: `${-diff} d overdue`, late: true };
  if (diff <= 7)   return { txt: `Dans ${diff} j`, late: false };
  return { txt: dateStr, late: false };
}

// Rendu d'une tâche. `variant` distingue une occurrence du jour (dont
// le parent porte la récurrence) d'une tâche mère.
function _dchkTaskHtml(task, ctx, variant) {
  const { today, allTasks } = ctx;
  const isDone   = task.status === 'Done';
  const due      = _dchkDue(task.due_date, today);
  // Une tâche mère récurrente n'est pas cochable : l'état vit sur ses
  // occurrences. La case est alors désactivée plutôt qu'absente, pour
  // que l'alignement des lignes reste constant.
  const lockable = variant === 'parent' && !!task.recurrence;

  const who = task.assigned_to || '-';
  const tags = [];
  if (task.priority) {
    tags.push(`<span class="dchk-tag ${DCHK_PRIO_CLS[task.priority] || ''}">${esc(task.priority)}</span>`);
  }
  if (variant === 'parent' && task.recurrence) {
    tags.push(`<span class="dchk-tag">${DCHK_ICON.repeat}${esc(DCHK_RECUR_LBL[task.recurrence] || task.recurrence)}</span>`);
  }
  if (variant === 'today') {
    const parent = allTasks.find(t => t.id === task.parent_id);
    const lbl = parent && DCHK_RECUR_LBL[parent.recurrence];
    if (lbl) tags.push(`<span class="dchk-tag">${DCHK_ICON.repeat}${esc(lbl)}</span>`);
  }
  if (task.status === 'Blocked') {
    tags.push(`<span class="dchk-tag prio-high">${DCHK_ICON.alert}Blocked</span>`);
  } else if (task.status === 'In Progress') {
    tags.push('<span class="dchk-tag prio-med">En cours</span>');
  }

  // Avancement d'une récurrence : barre + décompte, plus lisible que
  // « 12 occ. · 8 done · 4 left » en texte courant.
  let recur = '';
  if (variant === 'parent' && task.recurrence) {
    const occs = allTasks.filter(t => t.parent_id === task.id);
    const done = occs.filter(t => t.status === 'Done').length;
    const pct  = occs.length ? Math.round(done / occs.length * 100) : 0;
    const todayOc = occs.find(t => t.due_date === today);
    recur = `<div class="dchk-recur">
      <div class="dchk-recur-bar"><div class="dchk-recur-fill" style="width:${pct}%"></div></div>
      <div class="dchk-recur-txt">
        <span><b>${done}</b> / ${occs.length} occurrence${occs.length > 1 ? 's' : ''} faite${done > 1 ? 's' : ''}</span>
        ${todayOc ? `<span class="dchk-tag ${todayOc.status === 'Done' ? 'prio-low' : 'prio-med'}">Today: ${todayOc.status === 'Done' ? 'done' : 'to do'}</span>` : ''}
      </div>
    </div>`;
  }

  const checkCls = `dchk-check${isDone ? ' checked' : ''}${lockable ? ' disabled' : ''}`;
  const checkAttrs = lockable
    ? `disabled title="Recurring task — tick today's occurrence" aria-label="Non cochable"`
    : isDone
      ? `title="Already done" aria-label="Tâche faite" aria-pressed="true" disabled`
      : `onclick="markFOTaskDone('${task.id}')" title="Marquer comme faite" aria-label="Marquer « ${esc(task.title || '')} » comme faite" aria-pressed="false"`;

  return `<div class="dchk-task${isDone ? ' is-done' : ''}">
    <button class="${checkCls}" ${checkAttrs}>${DCHK_ICON.check}</button>
    <div class="dchk-task-main">
      <div class="dchk-task-title">${esc(task.title || task.description || '-')}</div>
      ${task.notes ? `<div class="dchk-task-notes">${esc(task.notes)}</div>` : ''}
      <div class="dchk-meta">
        <span class="dchk-who">
          <span class="dchk-avatar" style="background:${_dchkColor(who)}">${esc(_dchkInitials(who))}</span>
          <b>${esc(who)}</b>
        </span>
        ${due && !(variant === 'parent' && task.recurrence) ? `<span class="dchk-sep">·</span><span class="dchk-due${due.late && !isDone ? ' late' : ''}">${esc(due.txt)}</span>` : ''}
        ${tags.length ? `<span class="dchk-sep">·</span>${tags.join('')}` : ''}
      </div>
      ${recur}
    </div>
    <div class="dchk-actions">
      ${variant === 'parent' ? `
        <button class="dchk-icon" onclick="openEditFOTask('${task.id}')" title="Edit" aria-label="Edit task">${DCHK_ICON.edit}</button>
        <button class="dchk-icon danger" onclick="deleteFOTaskDirect('${task.id}')" title="Delete" aria-label="Delete task">${DCHK_ICON.trash}</button>` : ''}
    </div>
  </div>`;
}

function renderFOTasks() {
  const cfg      = state.config;
  const today    = new Date().toISOString().slice(0,10);
  const trackers = cfg.fo_trackers || {};
  const allTasks = (state.foTasks || []).filter(t =>
    getActiveCountry() === 'ALL' || personInScope(t.assigned_to, getActiveCountry()));

  const foFilter = document.getElementById('fotask-filter-fo');
  if (foFilter) {
    const cur = foFilter.value;
    foFilter.innerHTML = '<option value="">All FOs</option>';
    (cfg.fo_list||[]).forEach(fo => { const o=document.createElement('option'); o.value=fo; o.textContent=fo; foFilter.appendChild(o); });
    if ([...foFilter.options].some(o => o.value === cur)) foFilter.value = cur;
  }

  const fFO      = foFilter?.value || '';
  const hideDone = !!document.getElementById('dchk-hide-done')?.checked;

  // Badge de la barre latérale : inchangé.
  const todayOccPending = allTasks.filter(t => t.is_occurrence && t.due_date === today && t.status !== 'Done').length;
  const parentPending   = allTasks.filter(t => !t.is_occurrence && t.status !== 'Done' && t.status !== 'Recurring').length;
  const badge = document.getElementById('sb-count-tasks');
  if (badge) badge.textContent = (todayOccPending + parentPending) || '-';

  const el = document.getElementById('fo-tasks-list');
  if (!el) return;

  const ctx = { today, allTasks };
  const byFO = t => !fFO || t.assigned_to === fFO;
  const byStatus = t => !_dchkStatus || t.status === _dchkStatus;
  const bySort = (a,b) => (DCHK_ORDER[a.status] ?? 2) - (DCHK_ORDER[b.status] ?? 2);

  // ── Décomptes du jour (avant filtres de statut, sinon le héros
  //    changerait selon le filtre et ne serait plus une référence).
  const scope   = allTasks.filter(byFO);
  const dueToday = scope.filter(t => t.is_occurrence ? t.due_date === today
                                                     : (!t.recurrence && t.due_date === today));
  const doneToday = dueToday.filter(t => t.status === 'Done').length;
  // Retards : échéance passée et pas faite. Invisible auparavant.
  const overdue = scope.filter(t => !t.recurrence && t.status !== 'Done'
                                 && t.due_date && t.due_date < today);
  const openAll = scope.filter(t => t.status !== 'Done' && t.status !== 'Recurring');
  const blocked = scope.filter(t => t.status === 'Blocked');

  renderDchkHero({ dueToday: dueToday.length, doneToday, overdue: overdue.length,
                   open: openAll.length, blocked: blocked.length });
  renderDchkSegments(scope);

  // ── Appartenance aux groupes, déterminée AVANT les filtres.
  //    La calculer après filtrage ferait réapparaître dans « Toutes les
  //    tâches » une tâche que le filtre a retirée d'« Aujourd'hui » :
  //    elle n'était alors plus dans l'ensemble des ids déjà affichés.
  const lateSet  = new Set(overdue.map(t => t.id));
  const todaySet = new Set(scope
    .filter(t => !lateSet.has(t.id)
              && ((t.is_occurrence && t.due_date === today)
               || (!t.is_occurrence && !t.recurrence && t.due_date === today)))
    .map(t => t.id));

  // Filtres communs aux trois groupes.
  const visible = t => byStatus(t) && !(hideDone && t.status === 'Done');

  // Groupe 1 : en retard — leading, c'est ce qui exige une action.
  const lateList  = scope.filter(t => lateSet.has(t.id)).filter(visible).sort(bySort);
  // Groupe 2 : échéance du jour (occurrences récurrentes + ponctuelles).
  const todayList = scope.filter(t => todaySet.has(t.id)).filter(visible).sort(bySort);
  // Groupe 3 : le reste des tâches mères.
  const restList  = scope.filter(t => !t.is_occurrence
                                   && !lateSet.has(t.id) && !todaySet.has(t.id))
                         .filter(visible).sort(bySort);

  // Le variant se déduit de la tâche, pas du groupe : une occurrence
  // reste une occurrence même listée sous « En retard ».
  const variantOf = t => t.is_occurrence ? 'today' : 'parent';

  const group = (cls, icon, title, list) => list.length ? `
    <div class="dchk-group${cls ? ' ' + cls : ''}">
      <div class="dchk-group-head">
        <div class="dchk-group-title">${icon}${title}</div>
        <span class="dchk-group-n">${list.length}</span>
        <span class="dchk-group-rule"></span>
      </div>
      <div class="dchk-list">${list.map(t => _dchkTaskHtml(t, ctx, variantOf(t))).join('')}</div>
    </div>` : '';

  const html = group('is-late', DCHK_ICON.alert, 'En retard', lateList)
             + group('', DCHK_ICON.sun, "Aujourd'hui", todayList)
             + group('', DCHK_ICON.list, 'Toutes les tâches', restList);

  if (!html) {
    // Message d'état vide contextuel : « aucun résultat » et « rien à
    // faire » ne demandent pas la même action.
    const filtered = fFO || _dchkStatus || hideDone;
    el.innerHTML = `<div class="dchk-empty">
      ${filtered ? DCHK_ICON.list : DCHK_ICON.done}
      <div class="dchk-empty-t">${filtered ? 'No task matches' : 'Nothing to do — all up to date'}</div>
      <div class="dchk-empty-s">${filtered
        ? 'Widen the filters to see more tasks.'
        : 'Assign a task to see it appear here.'}</div>
    </div>`;
    return;
  }
  el.innerHTML = html;
}

// Anneau d'avancement du jour + décomptes cliquables.
function renderDchkHero(s) {
  const el = document.getElementById('dchk-hero');
  if (!el) return;

  const pct = s.dueToday ? Math.round(s.doneToday / s.dueToday * 100) : (s.open ? 0 : 100);
  const R = 46, C = 2 * Math.PI * R;
  // Teinte de l'anneau : le retard prime sur le taux d'avancement.
  const tone = s.overdue ? 'late' : (pct >= 80 ? '' : 'warn');

  const verdict = s.overdue
    ? `${s.overdue} tâche${s.overdue > 1 ? 's' : ''} en retard`
    : !s.dueToday
      ? (s.open ? 'Nothing planned today' : 'All up to date')
      : s.doneToday === s.dueToday
        ? 'Day complete'
        : `${s.dueToday - s.doneToday} task${s.dueToday - s.doneToday > 1 ? 's' : ''} due today`;

  const sub = s.overdue
    ? `Handle first. <b>${s.doneToday}/${s.dueToday}</b> of today's tasks are done.`
    : s.dueToday
      ? `<b>${s.doneToday}</b> of <b>${s.dueToday}</b> task${s.dueToday > 1 ? 's' : ''} ticked for today.`
      : `<b>${s.open}</b> open task${s.open > 1 ? 's' : ''} in total.`;

  // Chaque pastille filtre sur le statut correspondant (chaîne vide =
  // tout afficher). `status` est explicite pour éviter de déduire le
  // filtre du libellé.
  const stat = (cls, color, label, n, status) => `
    <button class="dchk-stat ${cls}" onclick="setDchkStatus('${status}')"
      title="${status ? 'Filter: ' + label : 'Show all'}">
      <span class="dchk-stat-dot" style="background:${color}"></span>${label} <b>${n}</b>
    </button>`;

  el.innerHTML = `
    <div class="dchk-ring ${tone}">
      <svg viewBox="0 0 104 104" aria-hidden="true">
        <circle class="dchk-ring-track" cx="52" cy="52" r="${R}"/>
        <circle class="dchk-ring-fill"  cx="52" cy="52" r="${R}"
          stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - pct / 100)).toFixed(1)}"/>
      </svg>
      <div class="dchk-ring-mid">
        <div class="dchk-ring-n">${pct}<small>%</small></div>
        <div class="dchk-ring-l">du jour</div>
      </div>
    </div>
    <div class="dchk-hero-main">
      <div class="dchk-hero-verdict">${verdict}</div>
      <div class="dchk-hero-sub">${sub}</div>
      <div class="dchk-stats">
        ${s.overdue ? stat('is-late', 'var(--dchk-late)', 'En retard', s.overdue, '') : ''}
        ${s.blocked ? stat('', 'var(--dchk-warn)', 'Blocked', s.blocked, 'Blocked') : ''}
        ${stat('', 'var(--m3-on-surf-var)', 'To do', s.open, 'Pending')}
        ${stat('is-done', 'var(--dchk-ok)', 'Faites', s.dueToday ? s.doneToday : 0, 'Done')}
      </div>
    </div>`;
}

// Segments de statut, avec le décompte réel de chaque état.
function renderDchkSegments(scope) {
  const el = document.getElementById('dchk-seg-status');
  if (!el) return;
  const count = v => scope.filter(t => t.status === v).length;
  const btn = (v, label) => {
    const n = v ? count(v) : scope.length;
    return `<button class="${_dchkStatus === v ? 'active' : ''}" role="tab"
      aria-selected="${_dchkStatus === v}" onclick="setDchkStatus('${v}')">
      ${label}<span class="dchk-seg-n">${n}</span></button>`;
  };
  el.innerHTML = btn('', 'Toutes')
    + DCHK_STATUSES.map(st => btn(st, {
        Pending:'To do', 'In Progress':'En cours', Blocked:'Blocked', Done:'Faites',
      }[st])).join('');
}

function _populateFOTaskDropdowns() {
  const foList  = state.config.fo_list  || [];
  const shifts  = getConfiguredShifts();
  const foSel   = document.getElementById('fotask-fo-select');
  const shSel   = document.getElementById('fotask-shift-select');
  if (foSel) {
    foSel.innerHTML = '<option value="">- Select FO -</option>';
    foList.forEach(fo => {
      const o = document.createElement('option'); o.value = fo; o.textContent = fo; foSel.appendChild(o);
    });
  }
  if (shSel) {
    shSel.innerHTML = '<option value="">- Any shift -</option>';
    shifts.forEach(s => {
      const o = document.createElement('option'); o.value = s; o.textContent = s; shSel.appendChild(o);
    });
  }
}

function openNewFOTask() {
  editingFOTaskId = null;
  const form = document.getElementById('fo-task-form');
  form.reset();
  document.getElementById('fo-task-modal-title').textContent = 'Assign task';
  document.getElementById('fo-task-modal-sub').textContent = 'New task for a Front Office agent';
  document.getElementById('fotask-btn-delete').style.display = 'none';
  _populateFOTaskDropdowns();
  _initPills('fotask-priority-pills');
  _initPills('fotask-recur-pills');
  _setPill('fotask-priority-pills', '');
  _setPill('fotask-recur-pills', '');
  const due = form.querySelector('[name=due_date]');
  if (due) due.value = new Date().toISOString().slice(0,10);
  if (currentUser?.name) {
    const foSel = document.getElementById('fotask-fo-select');
    if (foSel && [...foSel.options].some(o => o.value === currentUser.name)) {
      foSel.value = currentUser.name;
      updateFOTaskAvatar();
    }
  }
  document.getElementById('fo-task-modal').classList.add('open');
}

function openEditFOTask(id) {
  editingFOTaskId = id;
  const task = (state.foTasks||[]).find(t => t.id === id);
  if (!task) return;
  const form = document.getElementById('fo-task-form');
  form.reset();
  document.getElementById('fo-task-modal-title').textContent = 'Edit task';
  document.getElementById('fo-task-modal-sub').textContent = `Editing task assigned to ${task.assigned_to||'-'}`;
  document.getElementById('fotask-btn-delete').style.display = '';
  _populateFOTaskDropdowns();
  _initPills('fotask-priority-pills');
  _initPills('fotask-recur-pills');
  Object.keys(task).forEach(k => {
    const el = form.querySelector(`[name="${k}"]`);
    if (el) el.value = task[k] || '';
  });
  _setPill('fotask-priority-pills', task.priority || '');
  _setPill('fotask-recur-pills',    task.recurrence || '');
  updateFOTaskAvatar();
  document.getElementById('fo-task-modal').classList.add('open');
}

const saveFOTask = withSaveGuard(async function() {
  const form = document.getElementById('fo-task-form');
  if (!form.checkValidity()) { form.reportValidity(); return; }
  const data = {}; new FormData(form).forEach((v,k) => { data[k]=v; });
  try {
    if (editingFOTaskId) {
      await fetch(`${API}/api/fo-tasks/${editingFOTaskId}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
      toast('Task updated', 'success');
    } else {
      await fetch(`${API}/api/fo-tasks`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
      toast('Task assigned', 'success');
    }
    closeModal('fo-task-modal'); await loadAll(); renderFOTasks();
  } catch(e) { toast('Error saving task', 'error'); }
});

const deleteFOTask = withSaveGuard(async function() {
  if (!editingFOTaskId) return;
  if (!confirm('Delete this task?')) return;
  await fetch(`${API}/api/fo-tasks/${editingFOTaskId}`, { method:'DELETE' });
  toast('Task deleted', 'success');
  closeModal('fo-task-modal'); await loadAll(); renderFOTasks();
});

async function deleteFOTaskDirect(id) {
  if (!confirm('Delete this task?')) return;
  await fetch(`${API}/api/fo-tasks/${id}`, { method:'DELETE' });
  toast('Task deleted', 'success');
  await loadAll(); renderFOTasks();
}

async function markFOTaskDone(id) {
  await fetch(`${API}/api/fo-tasks/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({status:'Done'}) });
  toast('Task marked done', 'success');
  await loadAll(); renderFOTasks();
}

