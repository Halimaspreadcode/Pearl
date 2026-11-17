// ══════════════════════════════════════════════════════════════
// Vue RAPPORT — la slide « Team Progress » rendue à l'écran.
//
// Le même découpage que le PPTX, alimenté par les mêmes règles :
//  · Achievements  = items Done de la semaine, regroupés par FO
//    (un FO saisit plusieurs lignes ; les éclater donnerait une
//    liste de fragments sans auteur lisible) ;
//  · Next steps    = ce qui reste ouvert — In Progress et Planned ;
//  · Issues/Risks  = les reports des semaines passées, qui sont
//    par construction les vrais blocages ;
//  · Help needed   = les items en retard depuis 2 semaines ou plus,
//    seuil au-delà duquel l'équipe ne s'en sort pas seule.
//
// Ce que l'écran affiche est donc exactement ce qui sera présenté.
// ══════════════════════════════════════════════════════════════
function _wpReportData(weekStart) {
  const country = getActiveCountry();
  const all = (state.weeklyProgress || []).filter(p =>
    p && p.task && (country === 'ALL' || p.tracker === country));
  const week = all.filter(p => p.week_start === weekStart);

  // Achievements groupés par FO, le plus contributeur en tête.
  const byAgent = new Map();
  week.filter(p => p.status === 'Done').forEach(p => {
    const who = String(p.modified_by || '').trim() || 'Unassigned';
    if (!byAgent.has(who)) byAgent.set(who, []);
    byAgent.get(who).push(p);
  });
  const achievements = [...byAgent.entries()].sort((a, b) => b[1].length - a[1].length);

  const nextSteps = week.filter(p => p.status !== 'Done');
  const carry = all.filter(_isProgressDelayed);

  // Un report de 2 semaines ou plus n'est plus un retard, c'est un
  // blocage : il remonte dans « Help needed ».
  const cur = _wpCurWeek();
  const stuck = carry.filter(p =>
    Math.round((new Date(cur) - new Date(p.week_start)) / 6048e5) >= 2);
  const risks = carry.filter(p => !stuck.includes(p));

  return { all, week, achievements, nextSteps, carry, risks, stuck };
}

function _wpRenderReport(el, weekStart) {
  const d = _wpReportData(weekStart);
  const st = _wpStats(d.week);
  const { weekEnd } = _progressWeekRange(weekStart);
  const country = getActiveCountry();

  const li = (html) => `<div class="wp-rep-li">${html}</div>`;
  const empty = (msg) => `<div class="wp-quad-empty">${esc(msg)}</div>`;

  // ── Achievements ──
  const achHtml = d.achievements.length
    ? `<div class="wp-rep-list">${d.achievements.map(([who, tasks]) => li(
        `<span><span class="wp-rep-who">${esc(who)}</span> <span class="wp-rep-sub">— ${tasks.length} item${tasks.length > 1 ? 's' : ''}</span><br>${tasks.map(t => esc(t.task)).join('<br>')}</span>`
      )).join('')}</div>`
    : empty('No item delivered this week.');

  // ── Next steps : tableau Activité / Owner / Échéance / Statut ──
  const stepsHtml = d.nextSteps.length
    ? `<table class="wp-rep-tbl">
        <thead><tr><th>Activity / Task</th><th>Owner</th><th>Due date</th><th>Statut</th></tr></thead>
        <tbody>${d.nextSteps.map(p => {
          const m = WP_STATUS[p.status] || WP_STATUS.Planned;
          const due = _progressWeekRange(p.week_start).weekEnd;
          return `<tr onclick="openEditProgressItem('${esc(p.id)}')" title="Ouvrir l'item">
            <td>${esc(p.task)}</td>
            <td>${esc(_wpInitials(p.modified_by))}</td>
            <td>${esc(_wpFmtDate(due))}</td>
            <td><span class="wp-rep-st" style="background:${m.cc};color:${m.c}">${m.label}</span></td>
          </tr>`;
        }).join('')}</tbody>
      </table>`
    : empty('Nothing planned — the week is fully cleared.');

  // ── Issues / Risks ──
  const risksHtml = d.risks.length
    ? `<div class="wp-rep-list">${d.risks.map(p => li(
        `<span><span class="wp-rep-who">Report :</span> ${esc(p.task)}<br><span class="wp-rep-sub">${esc(p.modified_by || 'Unassigned')} · initialement sem. du ${esc(_wpFmtDate(p.week_start))}</span></span>`
      )).join('')}</div>`
    : empty('No blocker reported.');

  // ── Help needed ──
  const helpHtml = d.stuck.length
    ? `<div class="wp-rep-list">${d.stuck.map(p => {
        const w = Math.round((new Date(_wpCurWeek()) - new Date(p.week_start)) / 6048e5);
        return li(`<span>${esc(p.task)}<br><span class="wp-rep-sub">${esc(p.modified_by || 'Unassigned')} · blocked for ${w} weeks</span></span>`);
      }).join('')}</div>`
    : empty('No support needed this week.');

  const quad = (title, sub, color, cont, body) => `
    <div class="wp-quad" style="--wp-qc:${color};--wp-qcc:${cont}">
      <div class="wp-quad-h">${title}</div>
      <div class="wp-quad-s">${sub}</div>
      <div class="wp-quad-body">${body}</div>
    </div>`;

  el.innerHTML = `
    <div class="wp-report">
      <div class="wp-rep-head">
        <div class="wp-rep-title">Team Progress</div>
        <div class="wp-rep-meta">
          Semaine du ${esc(_wpFmtDate(weekStart))} au ${esc(_wpFmtDate(weekEnd))}
          · ${country === 'ALL' ? scopeLabel('ALL') : siteLabel(country)}
          · ${st.done}/${st.total} delivered (${st.pct}%)
        </div>
      </div>

      <div class="wp-quads">
        ${quad('Achievements', 'What was achieved this week', 'var(--wp-q-ok)', 'var(--wp-q-ok-c)', achHtml)}
        ${quad('Next steps / Forecasted activities', 'Planned activities and deadlines', 'var(--wp-q-next)', 'var(--wp-q-next-c)', stepsHtml)}
        ${quad('Main issues / Risks', 'Current blockers and at-risk items', 'var(--wp-q-risk)', 'var(--wp-q-risk-c)', risksHtml)}
        ${quad('Help needed', 'Soutien requis', 'var(--wp-q-help)', 'var(--wp-q-help-c)', helpHtml)}
      </div>

      <div class="wp-rep-foot">
        <span class="wp-rep-note">This view mirrors the weekly slide layout: what you see here is what will be presented.</span>
        <button class="wp-empty-btn" onclick="wpCopyReport()">Copy the text</button>
        <button class="wp-empty-btn" onclick="window.print()">Imprimer / PDF</button>
        <button class="wp-empty-btn primary" onclick="renderPage('weekly-report')">Open the Weekly Report</button>
      </div>
    </div>`;
}

// Copier en texte brut : le chemin le plus court vers un mail ou une
// zone de texte de slide, sans passer par un export de fichier.
async function wpCopyReport() {
  const { weekStart, weekEnd } = _progressWeekRange(progressAnchorDate);
  const d = _wpReportData(weekStart);
  const L = [];
  L.push(`Team Progress — week of ${_wpFmtDate(weekStart)} to ${_wpFmtDate(weekEnd)}`, '');
  L.push('ACHIEVEMENTS');
  d.achievements.length
    ? d.achievements.forEach(([who, tasks]) => tasks.forEach(t => L.push(`  - ${who} : ${t.task}`)))
    : L.push('  - (none)');
  L.push('', 'NEXT STEPS / FORECASTED ACTIVITIES');
  d.nextSteps.length
    ? d.nextSteps.forEach(p => L.push(`  - ${p.task} — ${p.modified_by || 'Unassigned'} — ${_wpFmtDate(_progressWeekRange(p.week_start).weekEnd)} — ${(WP_STATUS[p.status] || WP_STATUS.Planned).label}`))
    : L.push('  - (none)');
  L.push('', 'MAIN ISSUES / RISKS');
  d.risks.length
    ? d.risks.forEach(p => L.push(`  - Report : ${p.task} (${p.modified_by || 'Unassigned'}, sem. du ${_wpFmtDate(p.week_start)})`))
    : L.push('  - (none)');
  L.push('', 'HELP NEEDED');
  d.stuck.length
    ? d.stuck.forEach(p => L.push(`  - ${p.task} (${p.modified_by || 'Unassigned'})`))
    : L.push('  - (none)');

  try {
    await navigator.clipboard.writeText(L.join('\n'));
    toast('Report copied to clipboard', 'success');
  } catch (e) { toast('Copy failed — check your browser permissions', 'error'); }
}

// ── État vide ─────────────────────────────────────────────────
function _wpEmptyState(weekCount) {
  // Dans My Space, le filtre sur l'agent lui-même n'est pas un filtre :
  // c'est sa semaine, vide, et il doit pouvoir y ajouter une tâche.
  const mine = wpOwner && typeof mesMe === 'function' && wpOwner === mesMe()
    && !!document.getElementById('page-weekly-progress')?.dataset.mes;
  const filtered = wpFilter || (wpOwner && !mine) || wpSearch.trim();
  if (filtered) {
    return `<div class="wp-empty">
      <div class="wp-empty-ico"><svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14"/></svg></div>
      <div class="wp-empty-t">No item matches</div>
      <div class="wp-empty-s">${weekCount} item${weekCount > 1 ? 's' : ''} this week, but none match the active filters.</div>
      <div class="wp-empty-act"><button class="wp-empty-btn primary" onclick="wpClearFilters()">Clear the filters</button></div>
    </div>`;
  }
  const isCur = _progressWeekRange(progressAnchorDate).weekStart === _wpCurWeek();
  return `<div class="wp-empty">
    <div class="wp-empty-ico"><svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M19 3h-1V1h-2v2H8V1H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2m0 16H5V9h14zM7 11h5v5H7z"/></svg></div>
    <div class="wp-empty-t">Empty week</div>
    <div class="wp-empty-s">No item has been logged for this week yet. Add what is planned, then tick as you go.</div>
    <div class="wp-empty-act">
      <button class="wp-empty-btn primary" onclick="openNewProgressItem()">Add an item</button>
      ${isCur ? '' : `<button class="wp-empty-btn" onclick="goToThisWeek()">Go to this week</button>`}
    </div>
    <div class="wp-kbd"><kbd>N</kbd> new item<span class="wp-sep">·</span><kbd>←</kbd><kbd>→</kbd> change week<span class="wp-sep">·</span><kbd>T</kbd> back to today<span class="wp-sep">·</span><kbd>/</kbd> search</div>
  </div>`;
}

// ── Mutations optimistes ──────────────────────────────────────
// L'utilisateur clique pour changer un statut : l'interface doit
// répondre tout de suite. On patche l'état local, on rend, puis on
// pousse au serveur — et on restaure si ça échoue.
async function _wpPatch(id, patch, okMsg) {
  const items = state.weeklyProgress || [];
  const idx = items.findIndex(p => p.id === id);
  if (idx === -1) return;
  const before = { ...items[idx] };
  items[idx] = { ...before, ...patch, updated_at: new Date().toISOString() };
  renderWeeklyProgress();

  try {
    const res = await fetch(`${API}/api/weekly-progress/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...patch, modified_by: before.modified_by || currentUser?.name || '' }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (okMsg) toast(okMsg, 'success');
    // A task from a review stays tied to its action: ticking it here must
    // close the commitment on the O2O side, otherwise the score would
    // keep counting it as unmet.
    if (items[idx].o2o_action && 'status' in patch) await _o2oSyncFromTask(items[idx]);
  } catch (e) {
    items[idx] = before;                       // rollback : l'écran ne doit pas mentir
    renderWeeklyProgress();
    toast('Update failed', 'error');
  }
}

// Le cycle Planifié → En cours → Fait → Planifié suit le déroulé
// réel d'une tâche ; le retour au début sert à corriger un clic.
function wpCycleStatus(id) {
  const item = (state.weeklyProgress || []).find(p => p.id === id);
  if (!item) return;
  const next = PROGRESS_STATUSES[(PROGRESS_STATUSES.indexOf(item.status) + 1) % PROGRESS_STATUSES.length];
  _wpPatch(id, { status: next }, `Status: ${WP_STATUS[next].label}`);
}

function wpSetStatus(id, status) {
  const item = (state.weeklyProgress || []).find(p => p.id === id);
  if (!item || item.status === status) return;
  _wpPatch(id, { status }, `Status: ${WP_STATUS[status].label}`);
}

// Reporter plutôt que laisser pourrir : un item non fait qu'on
// décale explicitement sort de la dette de report.
function wpPushToNextWeek(id) {
  const item = (state.weeklyProgress || []).find(p => p.id === id);
  if (!item) return;
  // Reporter une tâche imposée reviendrait à repousser une échéance que
  // l'agent n'a pas fixée.
  if (wpIsLocked(item)) { _wpLockToast(item); return; }
  const target = _wpShiftWeek(item.week_start, 1);
  _wpPatch(id, { week_start: target }, `Carried over to the week of ${_wpFmtDate(target)}`);
}

async function wpPushWeekToCurrent(weekStart) {
  const country = getActiveCountry();
  const inWeek = (state.weeklyProgress || []).filter(p =>
    p.week_start === weekStart && p.status !== 'Done' && (country === 'ALL' || p.tracker === country));
  // Les tâches imposées restent où elles sont — leur échéance vient d'un
  // engagement, pas du rangement hebdomadaire.
  const todo = inWeek.filter(p => !wpIsLocked(p));
  const gardees = inWeek.length - todo.length;
  if (!todo.length) {
    toast(gardees ? 'Only assigned tasks left — they cannot be carried over' : 'Nothing to carry over', 'info');
    return;
  }
  if (!confirm(`Carry over ${todo.length} item${todo.length > 1 ? 's' : ''} to the current week?`
    + (gardees ? `\n\n${gardees} assigned task${gardees > 1 ? 's stay' : ' stays'} in place.` : ''))) return;

  const cur = _wpCurWeek();
  await Promise.all(todo.map(p => fetch(`${API}/api/weekly-progress/${p.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ week_start: cur }),
  })));
  toast(`${todo.length} item${todo.length > 1 ? 's' : ''} carried over`, 'success');
  await loadAll();
  renderWeeklyProgress();
}

async function wpDeleteItem(id) {
  const item = (state.weeklyProgress || []).find(p => p.id === id);
  if (!item) return;
  // Une tâche reçue ne se supprime pas de son propre chef : la retirer
  // revient à décider seul qu'elle n'a plus lieu d'être.
  if (wpIsLocked(item)) { _wpLockToast(item); return; }
  // Deleting here does not delete the commitment: the action stays on the
  // agent's record and keeps counting. Say so, otherwise we would imply
  // it has just been cancelled.
  const avert = item.o2o_action
    ? '\n\nThis task comes from a review. The agreed action stays in O2O tracking and keeps counting towards the score.'
    : '';
  if (!confirm(`Delete “${item.task}”?${avert}`)) return;
  try {
    const res = await fetch(`${API}/api/weekly-progress/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.weeklyProgress = (state.weeklyProgress || []).filter(p => p.id !== id);
    toast('Item deleted', 'success');
    renderWeeklyProgress();
  } catch (e) { toast('Delete failed', 'error'); }
}

// ── Raccourcis clavier ────────────────────────────────────────
// Actifs seulement quand la page est visible et qu'on n'est pas en
// train de saisir du texte : un raccourci qui vole une frappe est
// pire que pas de raccourci.
document.addEventListener('keydown', e => {
  const page = document.getElementById('page-weekly-progress');
  if (!page || !page.classList.contains('active')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.querySelector('.side-panel-overlay.open')) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
    if (e.key === 'Escape' && t.id === 'wp-search') { wpClearSearch(); t.blur(); }
    return;
  }

  switch (e.key) {
    case 'ArrowLeft':  e.preventDefault(); changeProgressWeek(-1); break;
    case 'ArrowRight': e.preventDefault(); changeProgressWeek(1); break;
    case 't': case 'T': e.preventDefault(); goToThisWeek(); break;
    case 'n': case 'N': e.preventDefault(); openNewProgressItem(); break;
    case '/': e.preventDefault(); document.getElementById('wp-search')?.focus(); break;
    case 'Escape': if (wpFilter || wpOwner || wpSearch) { e.preventDefault(); wpClearFilters(); } break;
    case '1': e.preventDefault(); setProgressView('board'); break;
    case '2': e.preventDefault(); setProgressView('list'); break;
    case '3': e.preventDefault(); setProgressView('timeline'); break;
    case '4': e.preventDefault(); setProgressView('insights'); break;
    case '5': e.preventDefault(); setProgressView('report'); break;
  }
});

// ── Panneau latéral (création / édition) ──────────────────────
function _onProgressTaskInput(textarea) {
  const count = document.getElementById('progress-char-count');
  if (count) {
    const n = textarea.value.length;
    count.textContent = `${n} / 220`;
    // Passe en accent dans les 30 derniers caractères : on voit la limite
    // arriver au lieu de buter dessus.
    count.classList.toggle('near', n > 190);
  }
  _updateProgressPreview();
}

function _updateProgressPreview() {
  const el = document.getElementById('progress-preview');
  if (!el) return;
  const task = document.querySelector('#progress-form [name=task]')?.value.trim() || 'Votre tâche s\'affichera ici…';
  const tracker = document.getElementById('progress-tracker-select')?.value || defaultSite();
  const status = document.querySelector('#progress-form [name=status]:checked')?.value || 'Planned';
  const meta = WP_STATUS[status] || WP_STATUS.Planned;
  const owner = (editingProgressId
    ? (state.weeklyProgress || []).find(p => p.id === editingProgressId)?.modified_by
    : currentUser?.name) || '';

  el.innerHTML = `
    <div style="flex:1;padding:14px 16px">
      <div style="font-size:13.5px;line-height:1.5;${status === 'Done' ? 'text-decoration:line-through;color:var(--mute)' : ''}">${esc(task)}</div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:9px;font-size:11.5px;color:var(--mute)">
        ${owner ? `<span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;font-size:9px;font-weight:700;color:#fff;background:${_wpAvatarColor(owner)}">${esc(_wpInitials(owner))}</span>${esc(owner)}<span style="opacity:.45">·</span>` : ''}
        <span style="padding:2px 9px;border-radius:999px;font-size:10.5px;font-weight:700;background:var(--info-bg,#E8F0FE);color:#1A73E8">${esc(tracker)}</span>
        <span style="padding:2px 9px;border-radius:999px;font-size:10.5px;font-weight:700;background:${meta.cc};color:${meta.c}">${meta.label}</span>
      </div>
    </div>`;
}

function openNewProgressItem() {
  editingProgressId = null;
  const form = document.getElementById('progress-form');
  form.reset();
  document.getElementById('progress-modal-title').textContent = 'Nouvel item';
  document.getElementById('progress-modal-sub').textContent = 'What is planned or delivered this week';
  document.getElementById('progress-btn-delete').style.display = 'none';
  // Le panneau est partagé avec l'édition d'une tâche verrouillée : sans
  // cette remise à zéro, les champs resteraient en lecture seule.
  const eyebrow = document.getElementById('progress-modal-eyebrow');
  if (eyebrow) eyebrow.textContent = 'Weekly progress';
  const ta = form.querySelector('[name=task]');
  ta.readOnly = false;
  ta.classList.remove('is-locked');
  document.getElementById('progress-tracker-select').disabled = false;
  _wpRenderLockNote(null, false);
  _initPills('progress-status-pills');
  // Pré-sélection cohérente avec le filtre actif : si l'utilisateur
  // regarde « En cours », il ajoute très probablement un item en cours.
  _setPill('progress-status-pills', (wpFilter && wpFilter !== 'late') ? wpFilter : 'Planned');
  const trackerSel = document.getElementById('progress-tracker-select');
  fillSiteSelects(trackerSel.parentElement);
  trackerSel.value = getActiveCountry() !== 'ALL' ? getActiveCountry() : defaultSite();
  document.getElementById('progress-char-count').textContent = '0 / 220';
  _updateProgressWeekContext();
  _updateProgressPreview();
  document.getElementById('progress-modal').classList.add('open');
  setTimeout(() => form.querySelector('[name=task]')?.focus(), 260);
}

function openEditProgressItem(id) {
  editingProgressId = id;
  const item = (state.weeklyProgress || []).find(p => p.id === id);
  if (!item) return;
  const form = document.getElementById('progress-form');
  form.reset();

  // Tâche imposée : le panneau s'ouvre quand même — le FO doit pouvoir
  // lire la consigne en entier et bouger le statut. Ce sont les champs
  // qui se ferment, pas l'écran.
  const locked = wpIsLocked(item);
  const eyebrow = document.getElementById('progress-modal-eyebrow');
  if (eyebrow) eyebrow.textContent = item.admin_task ? 'Assigned task'
    : item.o2o_action ? 'Action from review' : 'Weekly progress';

  document.getElementById('progress-modal-title').textContent = locked ? 'Update status' : 'Edit item';
  document.getElementById('progress-modal-sub').textContent = locked
    ? wpLockReason(item)
    : (item.modified_by ? `Logged by ${item.modified_by}` : 'Unassigned');
  // Retirer plutôt que griser : un bouton Supprimer désactivé laisse
  // croire qu'il suffirait d'insister.
  document.getElementById('progress-btn-delete').style.display = locked ? 'none' : '';

  const ta = form.querySelector('[name=task]');
  ta.value = item.task || '';
  ta.readOnly = locked;
  ta.classList.toggle('is-locked', locked);
  const trk = document.getElementById('progress-tracker-select');
  trk.value = item.tracker || defaultSite();
  trk.disabled = locked;

  _initPills('progress-status-pills');
  _setPill('progress-status-pills', item.status || 'Planned');
  document.getElementById('progress-char-count').textContent = `${(item.task || '').length} / 220`;
  _updateProgressWeekContext();
  _wpRenderLockNote(item, locked);
  _updateProgressPreview();
  document.getElementById('progress-modal').classList.add('open');
}

// Bandeau du panneau : d'où vient la tâche et ce qui reste modifiable.
// Injecté dans un conteneur créé à la volée — le balisage du panneau est
// partagé avec la création d'item, qui n'a rien à verrouiller.
function _wpRenderLockNote(item, locked) {
  const form = document.getElementById('progress-form');
  if (!form) return;
  let box = document.getElementById('progress-lock-note');
  if (!locked || !item) { if (box) box.remove(); return; }
  if (!box) {
    box = document.createElement('div');
    box.id = 'progress-lock-note';
    box.className = 'wp-locknote';
    form.prepend(box);
  }
  const src = item.admin_task
    ? `Assigned by <b>${esc(item.assigned_by || 'the admin')}</b>${item.assigned_at ? ` on ${esc(_wpFmtDate(item.assigned_at.slice(0, 10)))}` : ''}`
    : `Agreed in the review of <b>${esc(_wpFmtDate(item.o2o_date || item.week_start))}</b>`;
  box.innerHTML = `
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M18 8h-1V6a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2M9 6a3 3 0 0 1 6 0v2H9z"/></svg>
    <div>
      <div class="wp-locknote-t">${src}</div>
      <div class="wp-locknote-d">You can move the status. The wording${item.admin_task ? ', due date and priority' : ''} can only be changed by the admin.</div>
      ${item.admin_task && item.instructions ? `<div class="wp-locknote-i">${esc(item.instructions)}</div>` : ''}
      ${item.admin_task && item.due_date ? `<div class="wp-locknote-d">Due ${esc(_wpFmtDate(item.due_date))}${item.priority ? ` · priority ${esc(item.priority)}` : ''}</div>` : ''}
    </div>`;
}

function _updateProgressWeekContext() {
  // En édition, la semaine affichée dans le panneau est celle de
  // l'item, pas celle qu'on regarde : sinon le libellé ment.
  const item = editingProgressId ? (state.weeklyProgress || []).find(p => p.id === editingProgressId) : null;
  const anchor = item ? item.week_start : progressAnchorDate;
  const { weekStart, weekEnd } = _progressWeekRange(anchor);
  const { locale, tz } = getLangConfig();
  const s = new Date(weekStart).toLocaleDateString(locale, { timeZone: tz });
  const e = weekEnd.toLocaleDateString(locale, { timeZone: tz });
  const el = document.getElementById('progress-week-context');
  if (el) el.textContent = `Week of ${s} to ${e}`;
}

const saveProgressItemFromModal = withSaveGuard(async function () {
  const form = document.getElementById('progress-form');
  if (!form.checkValidity()) { form.reportValidity(); return; }
  const data = {}; new FormData(form).forEach((v, k) => { data[k] = v; });

  try {
    if (editingProgressId) {
      // Tâche imposée : on ne renvoie que le statut. Un champ en lecture
      // seule est quand même sérialisé par FormData — sans ce filtre, une
      // valeur inchangée serait réécrite, et un DOM bricolé passerait.
      const cur = (state.weeklyProgress || []).find(p => p.id === editingProgressId);
      if (wpIsLocked(cur)) {
        const st = data.status;
        for (const k of Object.keys(data)) delete data[k];
        if (st) data.status = st;
      }
      // On ne réécrit pas la semaine d'un item existant : l'édition
      // corrige le texte ou le statut, le report a son propre geste.
      await fetch(`${API}/api/weekly-progress/${editingProgressId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      });
      // Comme dans _wpPatch : une action d'entretien cochée ici doit
      // fermer l'engagement côté O2O, sinon la note continuerait de la
      // compter comme non tenue.
      if (cur && cur.o2o_action && data.status && data.status !== cur.status) {
        await _o2oSyncFromTask({ ...cur, status: data.status });
      }
      toast('Item updated', 'success');
    } else {
      data.week_start = _progressWeekRange(progressAnchorDate).weekStart;
      data.modified_by = currentUser?.name || '';
      await fetch(`${API}/api/weekly-progress`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      });
      toast('Item added', 'success');
    }
    closeModal('progress-modal');
    await loadAll();
    renderWeeklyProgress();
  } catch (e) { toast('Error while saving', 'error'); }
});

const deleteProgressItemFromModal = withSaveGuard(async function () {
  if (!editingProgressId) return;
  if (!confirm('Delete this item?')) return;
  await fetch(`${API}/api/weekly-progress/${editingProgressId}`, { method: 'DELETE' });
  toast('Item deleted', 'success');
  closeModal('progress-modal');
  await loadAll();
  renderWeeklyProgress();
});

