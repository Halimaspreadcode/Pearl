// ══════════════════════════════════════════════════════════════
// ATTRIBUTION DE TÂCHES — l'admin assigne, le FO exécute
// ══════════════════════════════════════════════════════════════
// Les tâches attribuées ici vivent dans le même registre que My Tasks
// (weekly_progress). Un registre séparé aurait obligé le FO à consulter
// deux écrans pour savoir ce qu'il a à faire, et aurait dupliqué la
// notion de statut.
//
// Ce qui les distingue d'une tâche que le FO se donne lui-même :
//   · admin_task    — marqueur d'origine, porte l'habillage et le verrou
//   · assigned_by   — qui l'a donnée, affiché sur la carte
//   · due_date      — échéance ferme, distincte de la semaine d'atterrissage
//   · priority      — l'admin hiérarchise, le FO ne réordonne pas
//
// Verrou : l'intitulé, l'échéance et la priorité sont figés côté FO ;
// seul le statut bouge. La règle est appliquée par wpIsLocked(), partagée
// avec les actions issues d'entretien qui obéissent à la même logique.
const ASG_PRIOS = ['High', 'Medium', 'Low'];

// Destinataires cochés dans le composeur. Hors du DOM : la liste de
// pastilles est re-rendue à chaque passe et perdrait l'état.
let asgPicked = new Set();
let asgTab = 'open';          // 'open' | 'done' | 'all'

function _asgFoList() {
  const trackers = state.config.fo_trackers || {};
  const country = getActiveCountry();
  return (state.config.fo_list || []).filter(fo =>
    country === 'ALL' || (trackers[fo] || 'SN') === country);
}

function _asgTracker(fo) { return (state.config.fo_trackers || {})[fo] || 'SN'; }

// Toutes les tâches attribuées par l'admin, quel que soit leur semaine.
function _asgAll() {
  const country = getActiveCountry();
  return (state.weeklyProgress || []).filter(p =>
    p.admin_task && (country === 'ALL' || p.tracker === country));
}

function renderAssignPage() {
  _asgRenderChips();
  _asgRenderFilter();
  _asgRenderSegs();
  _asgRenderList();
  asgSyncPreview();
}

// ── Composeur ─────────────────────────────────────────────────
function _asgRenderChips() {
  const el = document.getElementById('asg-fo-chips');
  if (!el) return;
  const list = _asgFoList();
  if (!list.length) {
    el.innerHTML = '<span class="asg-na">No agent in this scope.</span>';
    return;
  }
  // Un agent retiré de l'équipe ne doit pas rester coché en silence.
  asgPicked = new Set([...asgPicked].filter(fo => list.includes(fo)));

  const all = list.length && list.every(fo => asgPicked.has(fo));
  el.innerHTML = list.map(fo => `
      <button type="button" class="asg-chip${asgPicked.has(fo) ? ' is-on' : ''}"
              onclick="asgTogglePick(${escAttrArg(fo)})"
              aria-pressed="${asgPicked.has(fo)}">
        <span class="asg-chip-av" style="background:${_wpAvatarColor(fo)}">${esc(_wpInitials(fo))}</span>
        ${esc(fo)}
      </button>`).join('')
    + `<button type="button" class="asg-chip asg-chip-all" onclick="asgPickAll()">
        ${all ? 'Clear all' : 'Select all'}</button>`;
}

function asgTogglePick(fo) {
  if (asgPicked.has(fo)) asgPicked.delete(fo); else asgPicked.add(fo);
  _asgRenderChips();
  asgSyncPreview();
}

function asgPickAll() {
  const list = _asgFoList();
  asgPicked = list.every(fo => asgPicked.has(fo)) ? new Set() : new Set(list);
  _asgRenderChips();
  asgSyncPreview();
}

// La zone de saisie grandit avec le texte : une tâche de deux lignes ne
// doit pas se lire par une fenêtre d'une ligne.
function asgOnInput(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
  asgSyncPreview();
}

function _asgReadForm() {
  return {
    task: (document.getElementById('asg-task')?.value || '').trim(),
    due:  document.getElementById('asg-due')?.value || '',
    prio: document.getElementById('asg-prio')?.value || '',
    note: (document.getElementById('asg-note')?.value || '').trim(),
    fos:  [...asgPicked],
  };
}

// Aperçu : la carte telle que le FO la verra, plus le décompte des
// destinataires. Assigner à l'aveugle est le meilleur moyen d'envoyer un
// intitulé bancal à toute l'équipe.
function asgSyncPreview() {
  const el = document.getElementById('asg-preview');
  const btn = document.getElementById('asg-send');
  const lab = document.getElementById('asg-send-label');
  const f = _asgReadForm();
  const ready = !!f.task && !!f.fos.length;

  if (btn) btn.disabled = !ready;
  if (lab) lab.textContent = f.fos.length > 1 ? `Assign to ${f.fos.length}` : 'Assign';
  if (!el) return;

  if (!f.task && !f.fos.length) {
    el.innerHTML = `<span class="asg-na">Write the task, pick the agents — a preview of
      the card the agent will see appears here.</span>`;
    return;
  }

  const manque = [];
  if (!f.task) manque.push('an instruction');
  if (!f.fos.length) manque.push('at least one agent');

  el.innerHTML = `
    <div class="asg-pv-card">
      <span class="asg-pv-check"></span>
      <div class="asg-pv-b">
        <div class="asg-pv-t">${esc(f.task || 'Your instruction will appear here…')}</div>
        ${f.note ? `<div class="asg-pv-n">${esc(f.note)}</div>` : ''}
        <div class="asg-pv-m">
          <span class="wp-pill s-adm">Assigned</span>
          ${f.prio ? `<span class="wp-pill s-prio-${f.prio.toLowerCase()}">${esc(f.prio)}</span>` : ''}
          ${f.due ? `<span>due ${esc(_wpFmtDate(f.due))}</span>` : '<span>no due date</span>'}
        </div>
      </div>
    </div>
    <div class="asg-pv-side">
      ${f.fos.length
        ? `<b>${f.fos.length}</b> agent${f.fos.length > 1 ? 's' : ''} — ${esc(f.fos.join(', '))}`
        : ''}
      ${manque.length ? `<div class="asg-na">Missing: ${esc(manque.join(' and '))}.</div>` : ''}
    </div>`;
}

// Une tâche par destinataire : chacun suit la sienne. Un enregistrement
// partagé aurait signifié qu'un agent la coche pour tous.
const asgSubmit = withSaveGuard(async function () {
  const f = _asgReadForm();
  if (!f.task || !f.fos.length) return;

  const week = _o2oTaskWeek(f.due);   // jamais dans une semaine passée
  const by = currentUser?.name || 'Admin';

  const res = await Promise.allSettled(f.fos.map(fo => fetch(`${API}/api/weekly-progress`, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, AdminSession.headers()),
    credentials: 'same-origin',
    body: JSON.stringify({
      task: f.task,
      week_start: week,
      status: 'Planned',
      modified_by: fo,
      tracker: _asgTracker(fo),
      admin_task: true,
      assigned_by: by,
      assigned_at: new Date().toISOString(),
      due_date: f.due || '',
      priority: f.prio || '',
      instructions: f.note || '',
    }),
  })));

  const ok = res.filter(r => r.status === 'fulfilled' && r.value.ok).length;
  if (!ok) { toast('Assignment failed', 'error'); return; }

  toast(ok === f.fos.length
    ? `Task assigned to ${ok} agent${ok > 1 ? 's' : ''}`
    : `${ok}/${f.fos.length} assigned — ${f.fos.length - ok} failed`,
    ok === f.fos.length ? 'success' : 'error');

  // Le formulaire se vide, mais la sélection d'agents reste : on assigne
  // souvent plusieurs tâches d'affilée à la même personne.
  const ta = document.getElementById('asg-task');
  if (ta) { ta.value = ''; ta.style.height = 'auto'; }
  ['asg-note'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });

  await loadAll();
  renderAssignPage();
});

// ── Liste des tâches attribuées ───────────────────────────────
function _asgRenderFilter() {
  const sel = document.getElementById('asg-filter-fo');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">All agents</option>'
    + _asgFoList().map(fo => `<option value="${esc(fo)}">${esc(fo)}</option>`).join('');
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
}

function _asgRenderSegs() {
  const el = document.getElementById('asg-segs');
  if (!el) return;
  const all = _asgAll();
  const n = {
    open: all.filter(t => t.status !== 'Done').length,
    done: all.filter(t => t.status === 'Done').length,
    all:  all.length,
  };
  const btn = (k, label) => `<button class="${asgTab === k ? 'is-on' : ''}" role="tab"
      aria-selected="${asgTab === k}" onclick="asgSetTab('${k}')">${label}<span>${n[k]}</span></button>`;
  el.innerHTML = btn('open', 'Outstanding') + btn('done', 'Done') + btn('all', 'All');
}

function asgSetTab(t) { asgTab = t; _asgRenderSegs(); _asgRenderList(); }

function _asgRenderList() {
  const el = document.getElementById('asg-list');
  if (!el) return;

  const fFO = document.getElementById('asg-filter-fo')?.value || '';
  const today = _o2oToday();
  let list = _asgAll();
  if (fFO) list = list.filter(t => t.modified_by === fFO);
  if (asgTab === 'open') list = list.filter(t => t.status !== 'Done');
  if (asgTab === 'done') list = list.filter(t => t.status === 'Done');

  if (!list.length) {
    el.innerHTML = `<div class="asg-empty">
      <div class="asg-empty-t">${fFO || asgTab !== 'all' ? 'No task matches' : 'No task assigned yet'}</div>
      <div class="asg-empty-s">${fFO || asgTab !== 'all'
        ? 'Widen the filters to see more.'
        : 'Use the box above — the task lands straight in the agent’s My Tasks.'}</div>
    </div>`;
    return;
  }

  // Groupé par agent : la question posée à cette page est « qu'ai-je
  // donné à qui », pas « qu'existe-t-il ».
  const byFo = new Map();
  list.forEach(t => {
    if (!byFo.has(t.modified_by)) byFo.set(t.modified_by, []);
    byFo.get(t.modified_by).push(t);
  });

  // Ce qui demande une décision remonte : retard, puis à faire, puis fait.
  const rank = t => t.status === 'Done' ? 2
    : (t.due_date && t.due_date < today) ? 0 : 1;

  el.innerHTML = [...byFo.entries()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([fo, items]) => {
      const rows = items.sort((a, b) => rank(a) - rank(b)
        || String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')));
      const late = rows.filter(t => t.status !== 'Done' && t.due_date && t.due_date < today).length;
      const open = rows.filter(t => t.status !== 'Done').length;
      return `
        <div class="asg-grp">
          <div class="asg-grp-h">
            <span class="asg-grp-av" style="background:${_wpAvatarColor(fo)}">${esc(_wpInitials(fo))}</span>
            <b>${esc(fo || 'Unassigned')}</b>
            <span class="asg-grp-n">${open} open</span>
            ${late ? `<span class="asg-grp-n is-late">${late} overdue</span>` : ''}
          </div>
          <div class="asg-rows">${rows.map(t => _asgRow(t, today)).join('')}</div>
        </div>`;
    }).join('');
}

function _asgRow(t, today) {
  const done = t.status === 'Done';
  const late = !done && t.due_date && t.due_date < today;
  const cls = done ? 'is-done' : late ? 'is-late' : '';
  const meta = WP_STATUS[t.status] || WP_STATUS.Planned;
  return `<div class="asg-row-i ${cls}">
    <span class="asg-dot s-${meta.key}" title="${esc(meta.label)}"></span>
    <div class="asg-row-b">
      <div class="asg-row-t">${esc(t.task || '')}</div>
      ${t.instructions ? `<div class="asg-row-n">${esc(t.instructions)}</div>` : ''}
      <div class="asg-row-m">
        <span class="wp-pill s-${meta.key}">${meta.label}</span>
        ${t.priority ? `<span class="wp-pill s-prio-${String(t.priority).toLowerCase()}">${esc(t.priority)}</span>` : ''}
        ${t.due_date
          ? `<span class="${late ? 'asg-late' : ''}">due ${esc(_wpFmtDate(t.due_date))}</span>`
          : '<span class="asg-na">no due date</span>'}
        <span class="asg-sep">·</span>
        <span>by ${esc(t.assigned_by || 'Admin')}</span>
      </div>
    </div>
    <div class="asg-row-a">
      <button class="asg-iact" title="Edit" aria-label="Edit task"
              onclick="asgEdit('${esc(t.id)}')">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zm17.71-10.21a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z"/></svg>
      </button>
      <button class="asg-iact danger" title="Withdraw" aria-label="Withdraw task"
              onclick="asgDelete('${esc(t.id)}')">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z"/></svg>
      </button>
    </div>
  </div>`;
}

// Édition par l'admin — le seul chemin par lequel l'intitulé d'une tâche
// attribuée peut changer.
async function asgEdit(id) {
  const t = (state.weeklyProgress || []).find(p => p.id === id);
  if (!t) return;
  const txt = prompt('Task wording:', t.task || '');
  if (txt === null) return;
  const clean = txt.trim();
  if (!clean) { toast('The wording cannot be empty', 'error'); return; }
  if (clean === t.task) return;
  try {
    const res = await fetch(`${API}/api/weekly-progress/${id}`, {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, AdminSession.headers()),
      credentials: 'same-origin',
      body: JSON.stringify({ task: clean }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    toast('Task updated', 'success');
    await loadAll();
    renderAssignPage();
  } catch (e) { toast('Update failed', 'error'); }
}

async function asgDelete(id) {
  const t = (state.weeklyProgress || []).find(p => p.id === id);
  if (!t) return;
  if (!confirm(`Withdraw “${t.task}” from ${t.modified_by || 'this agent'}?`
    + '\n\nIt disappears from their My Tasks.')) return;
  try {
    const res = await fetch(`${API}/api/weekly-progress/${id}`, {
      method: 'DELETE',
      headers: AdminSession.headers(),
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    toast('Task withdrawn', 'success');
    await loadAll();
    renderAssignPage();
  } catch (e) { toast('Withdrawal failed', 'error'); }
}

