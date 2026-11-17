// ── Carte d'item ──────────────────────────────────────────────
// ── Tâches imposées : ce que le FO ne peut pas réécrire ───────
// Deux origines, une même règle. Une action convenue en entretien et une
// tâche donnée par l'admin sont toutes deux des engagements pris ailleurs
// que sur cet écran : l'agent en fait avancer le statut, il n'en corrige
// pas l'intitulé et ne la fait pas disparaître.
//
// Le verrou est une garde d'interface, pas une protection : l'API reste
// ouverte. Il empêche l'erreur honnête — retoucher un libellé en croyant
// que c'est sa propre note — pas la manipulation délibérée. Le poser
// côté serveur demanderait une identité FO authentifiée, que le registre
// weekly_progress n'a pas (modified_by est un nom, pas un compte).
function wpIsLocked(item) {
  if (!item) return false;
  if (AdminSession.active) return false;   // l'admin corrige ce qu'il a donné
  return !!(item.admin_task || item.o2o_action);
}

// Pourquoi c'est verrouillé — dit à l'agent d'où vient la tâche plutôt
// que de lui opposer un bouton mort sans explication.
function wpLockReason(item) {
  if (!item) return '';
  return item.admin_task
    ? `Assigned by ${item.assigned_by || 'the admin'} — only the status can be changed`
    : 'Action agreed in review — only the status can be changed';
}

function _wpLockToast(item) {
  toast(item.admin_task
    ? 'Task assigned by the admin — you can change its status, not its wording'
    : 'Action agreed in review — you can change its status, not its wording',
    'info');
}

function _wpCard(item, opts = {}) {
  const late = _isProgressDelayed(item);
  const meta = WP_STATUS[item.status] || WP_STATUS.Planned;
  const checkCls = item.status === 'Done' ? 's-done' : item.status === 'In Progress' ? 's-prog' : '';
  const nextLabel = item.status === 'Done' ? 'Move back to planned' : item.status === 'In Progress' ? 'Mark as done' : 'Move to in progress';

  // Deux origines imposées, chacune avec son habillage. Une action
  // d'entretien est un engagement pris devant le manager ; une tâche
  // admin est une consigne reçue. Les confondre avec une note que l'agent
  // s'est écrite à lui-même ferait glisser les deux sans conséquence.
  const o2o = !!item.o2o_action;
  const adm = !!item.admin_task;
  const locked = wpIsLocked(item);
  const reason = locked ? wpLockReason(item) : '';
  const prio = adm && item.priority ? String(item.priority) : '';
  // Échéance ferme portée par la tâche admin : distincte de la semaine
  // d'atterrissage, qui n'est qu'un rangement.
  const due = adm && item.due_date ? item.due_date : '';
  const dueLate = due && item.status !== 'Done' && due < _o2oToday();

  return `
    <div class="wp-card ${meta.key === 'done' ? 's-done' : ''} ${late ? 'is-late' : ''} ${adm ? 'is-adm' : ''} ${locked ? 'is-locked' : ''}"
         data-id="${esc(item.id)}"
         ${opts.draggable && !locked ? 'draggable="true" ondragstart="wpDragStart(event)" ondragend="wpDragEnd(event)"' : ''}
         onclick="if(!event.target.closest('button')) openEditProgressItem('${esc(item.id)}')">

      <button class="wp-check ${checkCls}" title="${nextLabel}" aria-label="${nextLabel}"
              onclick="event.stopPropagation();wpCycleStatus('${esc(item.id)}')">
        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
      </button>

      <div class="wp-card-main">
        <div class="wp-card-txt">${_wpHighlight(item.task || '', wpSearch.trim())}</div>
        ${adm && item.instructions
          ? `<div class="wp-card-note">${esc(item.instructions)}</div>` : ''}
        <div class="wp-card-meta">
          ${adm ? `<span class="wp-pill s-adm" title="${esc(reason || ('Assigned by ' + (item.assigned_by || 'the admin')))}">
            <svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true"><path fill="currentColor" d="M18 8h-1V6a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2M9 6a3 3 0 0 1 6 0v2H9z"/></svg>
            Assigned</span>` : ''}
          ${o2o ? `<span class="wp-pill s-o2o" title="Action agreed in the review of ${esc(_wpFmtDate(item.o2o_date || item.week_start))} — counts towards the score">
            <svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true"><path fill="currentColor" d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10m0 2c-4 0-8 2-8 5v3h16v-3c0-3-4-5-8-5"/></svg>
            Review</span>` : ''}
          ${prio ? `<span class="wp-pill s-prio-${esc(prio.toLowerCase())}">${esc(prio)}</span>` : ''}
          ${opts.hideOwner ? '' : `<span class="wp-meta-owner">${_wpAvatar(item.modified_by)}${esc(item.modified_by || 'Unassigned')}</span><span class="wp-sep">·</span>`}
          <span class="wp-pill s-site">${esc(item.tracker || '—')}</span>
          ${opts.hideStatus ? '' : `<span class="wp-pill s-${meta.key}">${meta.label}</span>`}
          ${due ? `<span class="wp-sep">·</span><span class="${dueLate ? 'wp-due-late' : ''}">due ${esc(_wpFmtDate(due))}</span>` : ''}
          ${late ? `<span class="wp-pill s-late">Late · wk of ${esc(_wpFmtDate(item.week_start))}</span>` : ''}
          ${opts.showWeek && !late ? `<span class="wp-sep">·</span><span>week of ${esc(_wpFmtDate(item.week_start))}</span>` : ''}
        </div>
        ${adm ? `<div class="wp-card-from">
          <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10m0 2c-4 0-8 2-8 5v3h16v-3c0-3-4-5-8-5"/></svg>
          Assigned by ${esc(item.assigned_by || 'Admin')}${locked ? ' · wording locked' : ''}
        </div>` : ''}
      </div>

      <div class="wp-card-acts">
        ${locked ? `
          <span class="wp-lockmark" title="${esc(reason)}" aria-label="${esc(reason)}">
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M18 8h-1V6a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2M9 6a3 3 0 0 1 6 0v2H9z"/></svg>
          </span>` : `
          <button class="wp-iact" title="Modifier" aria-label="Modifier"
                  onclick="event.stopPropagation();openEditProgressItem('${esc(item.id)}')">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zm17.71-10.21a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z"/></svg>
          </button>
          <button class="wp-iact" title="Carry over to next week" aria-label="Carry over to next week"
                  onclick="event.stopPropagation();wpPushToNextWeek('${esc(item.id)}')">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8"/></svg>
          </button>
          <button class="wp-iact danger" title="Supprimer" aria-label="Supprimer"
                  onclick="event.stopPropagation();wpDeleteItem('${esc(item.id)}')">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z"/></svg>
          </button>`}
      </div>
    </div>`;
}

// ── Vue Tableau (kanban, glisser-déposer) ─────────────────────
function _wpRenderBoard(el, items) {
  el.innerHTML = `<div class="wp-board">${PROGRESS_STATUSES.map(status => {
    const meta = WP_STATUS[status];
    const col = items.filter(i => i.status === status);
    return `<div class="wp-col" style="--wp-c:${meta.c};--wp-cc:${meta.cc}"
                 data-status="${esc(status)}"
                 ondragover="wpDragOver(event)" ondragleave="wpDragLeave(event)" ondrop="wpDrop(event)">
      <div class="wp-col-head">
        <span class="wp-col-dot" style="background:${meta.c}"></span>
        <span class="wp-col-title">${meta.label}</span>
        <span class="wp-col-count">${col.length}</span>
      </div>
      <div class="wp-col-items">
        ${col.length
          ? col.map(i => _wpCard(i, { draggable: true, hideStatus: true })).join('')
          : `<div class="wp-col-empty">Drag a card here</div>`}
      </div>
    </div>`;
  }).join('')}</div>`;
}

let _wpDragId = null;

function wpDragStart(e) {
  const card = e.currentTarget;
  _wpDragId = card.dataset.id;
  card.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  // Firefox exige une charge utile pour armer le glisser.
  try { e.dataTransfer.setData('text/plain', _wpDragId); } catch (_) {}
}
function wpDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('#page-weekly-progress .wp-col.drop').forEach(c => c.classList.remove('drop'));
  _wpDragId = null;
}
function wpDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drop');
}
function wpDragLeave(e) {
  // relatedTarget nul (sortie de fenêtre) ou hors colonne : on éteint.
  if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('drop');
}
function wpDrop(e) {
  e.preventDefault();
  const col = e.currentTarget;
  col.classList.remove('drop');
  const id = _wpDragId || (() => { try { return e.dataTransfer.getData('text/plain'); } catch (_) { return null; } })();
  if (id) wpSetStatus(id, col.dataset.status);
  _wpDragId = null;
}

// ── Vue Liste : groupée par FO ────────────────────────────────
function _wpRenderList(el, items) {
  // Grouper par FO répond à « qui a fait quoi » sans second écran.
  // Si l'utilisateur trie déjà par autre chose, on respecte son choix
  // et on affiche une liste plate.
  if (wpSort !== 'smart' && wpSort !== 'owner') {
    el.innerHTML = `<div class="wp-group-items">${items.map(i => _wpCard(i, { showWeek: true })).join('')}</div>`;
    return;
  }

  const groups = new Map();
  items.forEach(i => {
    const k = i.modified_by || 'Unassigned';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  });

  // Les FO qui ont le plus de reste-à-faire remontent : la liste
  // s'ouvre sur ce qui demande de l'attention.
  const ordered = [...groups.entries()].sort((a, b) => {
    const rest = g => g.filter(i => i.status !== 'Done').length;
    return rest(b[1]) - rest(a[1]) || a[0].localeCompare(b[0]);
  });

  el.innerHTML = `<div class="wp-list">${ordered.map(([owner, list]) => {
    const done = list.filter(i => i.status === 'Done').length;
    const pct = Math.round(done / list.length * 100);
    return `<div class="wp-group">
      <div class="wp-group-head">
        ${_wpAvatar(owner)}
        <span class="wp-group-title">${esc(owner)}</span>
        <span class="wp-group-count">${list.length}</span>
        <div class="wp-group-bar" title="${done}/${list.length} delivered"><i style="width:${pct}%"></i></div>
        <span class="wp-group-pct">${pct}%</span>
      </div>
      <div class="wp-group-items">${list.map(i => _wpCard(i, { hideOwner: true })).join('')}</div>
    </div>`;
  }).join('')}</div>`;
}

// ── Vue Tendance : 8 semaines glissantes ──────────────────────
function _wpRenderTimeline(el, weekStart) {
  const country = getActiveCountry();
  const all = (state.weeklyProgress || []).filter(p => country === 'ALL' || p.tracker === country);

  const weeks = [];
  for (let i = 7; i >= 0; i--) weeks.push(_wpShiftWeek(weekStart, -i));

  const data = weeks.map(w => {
    const items = all.filter(p => p.week_start === w);
    return { w, ...(_wpStats(items)) };
  });
  const max = Math.max(1, ...data.map(d => d.total));
  const cur = _wpCurWeek();

  const seg = (n, color) => n ? `<div class="wp-tseg" style="height:${(n / max * 150).toFixed(1)}px;background:${color}" title="${n}"></div>` : '';

  // Moyenne de complétion sur les semaines qui ont eu des items : une
  // semaine vide n'est pas une semaine à 0 %.
  const active = data.filter(d => d.total);
  const avg = active.length ? Math.round(active.reduce((s, d) => s + d.pct, 0) / active.length) : 0;

  el.innerHTML = `
    <div class="wp-panel">
      <div class="wp-panel-head">
        <div class="wp-panel-t">8-week trend</div>
        <div class="wp-panel-s">Average completion of <b>${avg}%</b> across ${active.length} week${active.length > 1 ? 's' : ''} filled in. Click a column to open the week.</div>
      </div>

      <div class="wp-trend">
        ${data.map(d => `
          <div class="wp-tcol ${d.w === weekStart ? 'now' : ''}" onclick="progressAnchorDate='${d.w}';setProgressView('board')"
               title="Week of ${esc(_wpFmtDate(d.w))} — ${d.total} item${d.total > 1 ? 's' : ''}, ${d.pct}% delivered">
            <span class="wp-tpct">${d.total ? d.pct + '%' : '—'}</span>
            <div class="wp-tstack" style="min-height:${d.total ? 0 : 6}px">
              ${seg(d.done, 'var(--wp-done)')}
              ${seg(d.prog, 'var(--wp-prog)')}
              ${seg(d.plan - d.late, 'var(--wp-plan)')}
              ${seg(d.late, 'var(--wp-late)')}
            </div>
            <span class="wp-tlabel">${esc(_wpFmtDate(d.w))}${d.w === cur ? '<br>now' : ''}</span>
          </div>`).join('')}
      </div>

      <div class="wp-legend">
        <span><i style="background:var(--wp-done)"></i>Done</span>
        <span><i style="background:var(--wp-prog)"></i>In progress</span>
        <span><i style="background:var(--wp-plan)"></i>Planned</span>
        <span><i style="background:var(--wp-late)"></i>Overdue</span>
      </div>
    </div>`;
}

// ── Vue Analyse : charge par FO + dette de report ─────────────
function _wpRenderInsightsView(el, weekStart) {
  const country = getActiveCountry();
  const all = (state.weeklyProgress || []).filter(p => country === 'ALL' || p.tracker === country);
  const week = all.filter(p => p.week_start === weekStart);
  const carry = all.filter(_isProgressDelayed);

  // Charge par FO sur la semaine affichée.
  const byOwner = new Map();
  week.forEach(p => {
    const k = p.modified_by || 'Unassigned';
    if (!byOwner.has(k)) byOwner.set(k, { done: 0, prog: 0, plan: 0, total: 0 });
    const g = byOwner.get(k);
    g.total++;
    if (p.status === 'Done') g.done++; else if (p.status === 'In Progress') g.prog++; else g.plan++;
  });
  const ranked = [...byOwner.entries()].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]));
  const maxTotal = Math.max(1, ...ranked.map(r => r[1].total));

  const seg = (n, tot, color) => n ? `<i style="width:${(n / tot * 100).toFixed(1)}%;background:${color}"></i>` : '';

  const loadPanel = ranked.length ? `
    <div class="wp-rank">
      ${ranked.map(([owner, g]) => `
        <div class="wp-rank-row" onclick="wpSetOwner('${esc(owner).replace(/'/g, "\\'")}');setProgressView('list')"
             title="${esc(owner)} — ${g.done} done, ${g.prog} in progress, ${g.plan} planned">
          ${_wpAvatar(owner)}
          <span class="wp-rank-name">${esc(owner)}</span>
          <span class="wp-rank-bar" style="opacity:${(.45 + .55 * g.total / maxTotal).toFixed(2)}">
            ${seg(g.done, g.total, 'var(--wp-done)')}${seg(g.prog, g.total, 'var(--wp-prog)')}${seg(g.plan, g.total, 'var(--wp-plan)')}
          </span>
          <span class="wp-rank-n">${g.done}/${g.total}</span>
        </div>`).join('')}
    </div>`
    : `<div class="wp-col-empty">No item this week — nothing to split.</div>`;

  // Dette de report, groupée par semaine d'origine : on voit d'où
  // vient l'accumulation, pas seulement son volume.
  const byWeek = new Map();
  carry.forEach(p => {
    if (!byWeek.has(p.week_start)) byWeek.set(p.week_start, []);
    byWeek.get(p.week_start).push(p);
  });
  const carryOrdered = [...byWeek.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const carryPanel = carry.length ? `
    <div style="display:flex;flex-direction:column;gap:18px">
      ${carryOrdered.map(([w, list]) => `
        <div>
          <div class="wp-group-head">
            <span class="wp-group-title">Semaine du ${esc(_wpFmtDate(w))}</span>
            <span class="wp-group-count">${list.length}</span>
            <div class="wp-weekbar-spacer"></div>
            <button class="wp-empty-btn" style="height:30px;padding:0 14px;font-size:12px"
                    onclick="wpPushWeekToCurrent('${w}')">Carry over to this week</button>
          </div>
          <div class="wp-group-items">${list.map(i => _wpCard(i, { showWeek: false })).join('')}</div>
        </div>`).join('')}
    </div>`
    : `<div class="wp-col-empty">Nothing overdue — no carry-over debt.</div>`;

  el.innerHTML = `
    <div class="wp-panels">
      <div class="wp-panel">
        <div class="wp-panel-head">
          <div class="wp-panel-t">Load by FO</div>
          <div class="wp-panel-s">Displayed week · click a row to filter the list</div>
        </div>
        ${loadPanel}
        <div class="wp-legend">
          <span><i style="background:var(--wp-done)"></i>Done</span>
          <span><i style="background:var(--wp-prog)"></i>In progress</span>
          <span><i style="background:var(--wp-plan)"></i>Planned</span>
        </div>
      </div>

      <div class="wp-panel">
        <div class="wp-panel-head">
          <div class="wp-panel-t">Carry-over debt</div>
          <div class="wp-panel-s">${carry.length ? `${carry.length} item${carry.length > 1 ? 's' : ''} not delivered from past weeks` : 'All up to date'}</div>
        </div>
        ${carryPanel}
      </div>
    </div>`;
}

