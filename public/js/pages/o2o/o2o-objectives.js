// ── Édition d'un objectif ─────────────────────────────────────
// Intitulé, KPI, échéance et statut se règlent dans le volet Réglages de
// l'objectif ouvert. Un seul objectif étant ouvert à la fois, il ne peut
// pas y avoir deux « Enregistrer » concurrents sur la même liste.
async function o2oSaveObjective(fo, id) {
  const title = (document.getElementById(`ob-title-${id}`)?.value || '').trim();
  if (!title) { toast('Title required', 'error'); return; }
  const kpi = (document.getElementById(`ob-kpi-${id}`)?.value || '').trim();
  const due = document.getElementById(`ob-due-${id}`)?.value || '';
  const st  = document.getElementById(`ob-st-${id}`)?.value || '';
  o2oUI.editing = null;
  if (await _o2oCommit(fo, e => {
    const o = e.objectives.find(x => x.id === id);
    if (!o) return;
    o.title = title.slice(0, 180);
    if (kpi) o.kpi = kpi.slice(0, 140); else delete o.kpi;
    if (due) o.due = due; else delete o.due;
    if (O2O_STATUSES.some(s => s.id === st)) o.status = st;
  })) toast('Objective updated', 'success');
}

// Ouvre / referme un objectif. Un seul à la fois : la liste reste
// parcourable et le détail garde toute la largeur.
function o2oToggle(id) {
  o2oUI.open = o2oUI.open === id ? null : id;
  o2oUI.pane = 'steps';
  o2oUI.editing = null;
  renderO2O();
}

function o2oPane(pane) {
  if (!['steps', 'notes', 'set'].includes(pane)) return;
  o2oUI.pane = pane;
  renderO2O();
}

// ── Jalons ────────────────────────────────────────────────────
// Un objectif trimestriel ne se coche pas d'un bloc : on le découpe en
// étapes vérifiables, et l'avancement se déduit des cases cochées.
async function o2oAddStep(fo, objId) {
  const inp = document.getElementById(`st-new-${objId}`);
  const due = document.getElementById(`st-due-${objId}`);
  const title = (inp?.value || '').trim();
  if (!title) { inp?.focus(); return; }
  // Règle : pas de jalon sans date limite.
  if (!due?.value) {
    due?.classList.add('is-missing'); due?.focus();
    toast('The milestone needs a deadline.', 'error'); return;
  }
  const step = { id: _o2oUid(), title: title.slice(0, 160), done: false, due: due.value };
  if (await _o2oCommit(fo, e => {
    const o = e.objectives.find(x => x.id === objId);
    if (!o) return;
    o.steps = _stepList(o).concat(step);
  })) toast('Milestone added', 'success');
}

// Ajoute une suggestion. L'index se réfère à la liste affichée, qui est
// recalculée à chaque rendu — on la reconstruit donc à l'identique ici
// plutôt que de faire confiance à un index figé dans le HTML.
async function o2oAddSuggested(fo, objId, idx) {
  const { objectives } = _o2oFor(fo);
  const o = objectives.find(x => x.id === objId);
  if (!o) return;
  const title = _suggestSteps(o)[idx];
  if (!title) return;
  // Une suggestion n'a pas de date : on la pose dans le champ de saisie et
  // on demande la date limite, obligatoire pour tout jalon.
  const inp = document.getElementById(`st-new-${objId}`);
  const due = document.getElementById(`st-due-${objId}`);
  if (inp) inp.value = title;
  if (due?.value) return o2oAddStep(fo, objId);
  due?.classList.add('is-missing'); due?.focus();
  toast('Pick its deadline, then Add.', 'info');
}

// Pose le découpage complet d'un coup : c'est le geste normal sur un
// objectif qui n'a encore aucun jalon.
async function o2oAddAllSteps(fo, objId) {
  const { objectives } = _o2oFor(fo);
  const o = objectives.find(x => x.id === objId);
  if (!o) return;
  const titles = _suggestSteps(o);
  if (!titles.length) return;
  // Tous les jalons prennent la date limite choisie dans le champ de
  // saisie : sans date, rien n'est ajouté.
  const due = document.getElementById(`st-due-${objId}`);
  if (!due?.value) {
    due?.classList.add('is-missing'); due?.focus();
    toast('Pick a deadline first — every milestone needs one.', 'error'); return;
  }
  if (await _o2oCommit(fo, e => {
    const t = e.objectives.find(x => x.id === objId);
    if (t) t.steps = _stepList(t).concat(
      titles.map(title => ({ id: _o2oUid(), title, done: false, due: due.value })));
  })) toast(`${titles.length} milestones added`, 'success');
}

async function o2oToggleStep(fo, objId, stepId) {
  await _o2oCommit(fo, e => {
    const o = e.objectives.find(x => x.id === objId);
    if (!o) return;
    const s = _stepList(o).find(x => x.id === stepId);
    if (!s) return;
    s.done = !s.done;
    // Trace de quand l'étape a été franchie : en entretien, « fait »
    // sans date ne permet pas de constater un rythme.
    if (s.done) s.at = new Date().toISOString(); else delete s.at;
    // Tous les jalons cochés : l'objectif est atteint, on le reflète
    // plutôt que d'obliger à changer le statut à la main.
    const all = _stepList(o);
    if (all.length && all.every(x => x.done) && o.status !== 'dropped') o.status = 'done';
    else if (o.status === 'done' && all.some(x => !x.done)) o.status = 'doing';
  });
}

async function o2oDelStep(fo, objId, stepId) {
  if (await _o2oCommit(fo, e => {
    const o = e.objectives.find(x => x.id === objId);
    if (!o) return;
    o.steps = _stepList(o).filter(x => x.id !== stepId);
    if (!o.steps.length) delete o.steps;
  })) toast('Milestone deleted', 'success');
}

// Écrit dans objective.notes. Même contrat que _perfCommitNotes : le
// mutateur reçoit la liste, la persistance et le re-rendu suivent.
async function _o2oCommitNotes(objId, mutate) {
  const fo = perfUI.fo;
  if (!fo) return false;
  // L'objectif reste ouvert sur son volet Suivi après l'écriture : on
  // vient d'y travailler.
  o2oUI.open = objId;
  o2oUI.pane = 'notes';
  return _o2oCommit(fo, e => {
    const o = e.objectives.find(x => x.id === objId);
    if (!o) return;
    o.notes = _noteList(o).map(n =>
      n.id === 'legacy' ? { ...n, id: 'n' + Date.now().toString(36) } : n);
    mutate(o.notes);
    if (!o.notes.length) delete o.notes;
  });
}

async function o2oSetStatus(fo, id, status) {
  if (!O2O_STATUSES.some(s => s.id === status)) return;
  await _o2oCommit(fo, e => {
    const o = e.objectives.find(x => x.id === id);
    if (o) o.status = status;
  });
}

async function o2oDelObjective(fo, id) {
  if (!confirm('Delete this objective?')) return;
  if (await _o2oCommit(fo, e => { e.objectives = e.objectives.filter(x => x.id !== id); }))
    toast('Objective deleted', 'success');
}

async function o2oAddMeeting(fo) {
  const date  = document.getElementById('o2o-m-date')?.value || _o2oToday();
  const topic = (document.getElementById('o2o-m-topic')?.value || '').trim();
  const mood  = document.querySelector('input[name="o2o-mood"]:checked')?.value || '';

  // On ne garde que les rubriques renseignées : le compte rendu doit se
  // lire comme ce qui s'est dit, pas comme un formulaire à trous.
  const secs = [];
  _o2oSections().forEach(s => {
    const text = (document.getElementById(`o2o-s-${s.id}`)?.value || '').trim();
    if (!text) return;
    const rec = { id: s.id, label: s.label, text: text.slice(0, 4000) };
    if (s.list) rec.list = true;
    secs.push(rec);
  });

  if (!secs.length && !topic) { toast('Empty meeting', 'error'); return; }

  const m = { id: _o2oUid(), date, topic: topic.slice(0, 140), sections: secs };
  if (O2O_MOODS.some(x => x.id === mood)) m.mood = mood;
  // Le formulaire se referme après enregistrement : l'écran revient sur
  // l'historique, où l'entretien qu'on vient de saisir apparaît en tête.
  o2oUI.formOpen = false;
  if (await _o2oCommit(fo, e => e.meetings.push(m))) toast('Meeting saved', 'success');
}

// ── Personnalisation de la trame ──────────────────────────────
// Les rubriques ne conviennent pas à tout le monde : on les modifie ici,
// une par ligne, au format « Intitulé | aide facultative ». Un « - » en
// fin de ligne marque une rubrique en liste (une entrée par ligne).
function o2oEditTemplate() {
  const cur = _o2oSections()
    .map(s => `${s.label}${s.hint ? ' | ' + s.hint : ''}${s.list ? ' | -' : ''}`)
    .join('\n');
  const next = prompt(
    'Template sections, one per line.\n' +
    'Format: Title | optional hint | - for a list\n\n' +
    'Leave empty to restore the default template.',
    cur);
  if (next === null) return;

  const lines = next.split('\n').map(l => l.trim()).filter(Boolean);
  const tpl = lines.map((l, i) => {
    const parts = l.split('|').map(p => p.trim());
    const label = parts[0].slice(0, 80);
    const rec = { id: 's' + i, label };
    const hint = parts[1] && parts[1] !== '-' ? parts[1].slice(0, 160) : '';
    if (hint) rec.hint = hint;
    if (parts.includes('-')) rec.list = true;
    return rec;
  }).filter(s => s.label);

  _o2oSaveTemplate(tpl.length ? tpl : null);
}

async function _o2oSaveTemplate(tpl) {
  // PUT /api/config fusionne l'objet reçu sur l'existant : retirer la
  // clé ici ne l'effacerait pas côté serveur. On envoie donc un tableau
  // vide, que _o2oSections() interprète déjà comme « trame par défaut ».
  const cfg = { ...state.config, o2o_template: tpl || [] };
  const res = await fetch(`${API}/api/config`, {
    method: 'PUT', headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
    credentials: 'same-origin', body: JSON.stringify(cfg) });
  if (!res.ok) { toast('Server error', 'error'); return; }
  await loadConfig();
  o2oUI.formOpen = true;
  renderO2O();
  toast(tpl ? 'Template saved' : 'Default template restored', 'success');
}

async function o2oDelMeeting(fo, id) {
  if (!confirm('Delete this meeting?')) return;
  if (await _o2oCommit(fo, e => { e.meetings = e.meetings.filter(x => x.id !== id); }))
    toast('Meeting deleted', 'success');
}

// ── Carry-over of pending points ───────────────────────────────
// A review starts with whatever was left from the previous one. Without
// this reminder the FO had to reopen the earlier write-up — or, more
// often, simply forgot, and the agreed action died for never having been
// asked about again.
//
// Points are settled here, during the review: done / dropped, or carried
// over into today's actions in one click.
function _o2oReprise(fo, meetings) {
  const today = _o2oToday();
  const en = _o2oAllActions(fo, meetings).filter(a => a.status === 'todo');
  const objLate = _scoredObjectives(fo).filter(o =>
    o.due && o.status !== 'done' && o.status !== 'dropped' && o.due < today);

  if (!en.length && !objLate.length) return '';
  const q = esc(fo).replace(/'/g, "\\'");

  // Oldest first: what has been dragging for two reviews deserves
  // discussion before what was agreed last week.
  const rows = [...en].sort((a, b) => String(a.date).localeCompare(String(b.date)));

  return `<div class="o2o-reprise">
    <div class="o2o-reprise-h">
      <b>Carried over from the last review</b>
      <span class="o2o-reprise-n">${rows.length + objLate.length}</span>
      ${rows.length ? `<button class="nt-btn is-ghost" onclick="o2oReconduire('${q}')"
        title="Copy these actions into the « Agreed actions » field below">
        Carry over into actions</button>` : ''}
    </div>
    ${rows.length ? `<div class="o2o-reprise-l">
      ${rows.map(a => {
        const late = _o2oActionLate(a, today);
        const args = `'${q}','${esc(a.meetingId)}','${esc(a.id)}'`;
        return `<div class="o2o-reprise-i${late ? ' is-late' : ''}">
          <span class="o2o-reprise-t">${esc(a.text)}</span>
          <span class="o2o-reprise-d">${esc(_absFmtDay(a.date))}${a.due ? ` · due ${esc(_absFmtDay(a.due))}` : ''}</span>
          <button class="nt-btn is-ghost" onclick="o2oSetActionStatus(${args},'done')">Done</button>
          <button class="nt-btn is-ghost" onclick="o2oSetActionStatus(${args},'drop')">Drop</button>
        </div>`;
      }).join('')}
    </div>` : ''}
    ${objLate.length ? `<div class="o2o-reprise-obj">
      ${objLate.length} objective${objLate.length > 1 ? 's' : ''} past due:
      ${esc(objLate.slice(0, 3).map(o => o.title).join(' · '))}
    </div>` : ''}
  </div>`;
}

// Copies still-open actions into the form's "Agreed actions" field.
// Nothing is written to storage: the FO rereads, adjusts, then saves —
// blindly carrying over an action the agent just said to drop would be
// worse than proposing nothing at all.
function o2oReconduire(fo) {
  const sec = _o2oSections().find(s => s.list) || { id: 'actions' };
  const ta = document.getElementById(`o2o-s-${sec.id}`);
  if (!ta) { toast('Agreed actions field not found', 'error'); return; }

  const en = _o2oAllActions(fo).filter(a => a.status === 'todo').map(a => a.text);
  const deja = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
  const ajout = en.filter(t => !deja.includes(t));
  if (!ajout.length) { toast('These actions are already in the section', 'info'); return; }

  ta.value = [...deja, ...ajout].join('\n');
  autoGrow(ta);
  ta.focus();
  toast(`${ajout.length} action${ajout.length > 1 ? 's' : ''} carried over`, 'success');
}

// ── Tracking agreed actions ────────────────────────────────────
// An action's status is entered, no longer inferred. These operations
// write into meetings[].actions[], materialising along the way the
// reviews that still only carry the free-text field.

// Materialises a review's actions if they do not exist yet.
// Returns the array, ready to mutate.
function _o2oEnsureActions(meeting) {
  if (!Array.isArray(meeting.actions)) {
    meeting.actions = _o2oActionsOf(meeting).map(a => {
      const { legacy, ...rest } = a;
      return rest;
    });
  }
  return meeting.actions;
}

async function o2oSetActionStatus(fo, meetingId, actionId, status) {
  if (!O2O_ACTION_STATUSES.some(s => s.id === status)) return;
  const ok = await _o2oCommit(fo, e => {
    const m = e.meetings.find(x => x.id === meetingId);
    if (!m) return;
    const a = _o2oEnsureActions(m).find(x => x.id === actionId);
    if (!a) return;
    a.status = status;
    // The completion date serves the history: without it we know an
    // action is done but not when — useless in a review.
    if (status === 'done') a.doneAt = new Date().toISOString();
    else delete a.doneAt;
  });
  if (ok) {
    toast(`Action : ${_o2oActionLabel(status)}`, 'success');
    _o2osRenderProfil(o2osUI.fo);
  }
}

// Cycle to do → done → to do. Dropping stays an explicit gesture: it
// must not be caught by one click too many.
function o2oCycleAction(fo, meetingId, actionId) {
  const m = _o2oFor(fo).meetings.find(x => x.id === meetingId);
  if (!m) return;
  const a = _o2oActionsOf(m).find(x => x.id === actionId);
  if (!a) return;
  o2oSetActionStatus(fo, meetingId, actionId, a.status === 'done' ? 'todo' : 'done');
}

async function o2oSetActionDue(fo, meetingId, actionId) {
  const m = _o2oFor(fo).meetings.find(x => x.id === meetingId);
  const a = m && _o2oActionsOf(m).find(x => x.id === actionId);
  if (!a) return;
  const next = prompt('Action due date (YYYY-MM-DD). Leave empty for none.', a.due || '');
  if (next === null) return;
  const due = next.trim();
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) { toast('Expected format: YYYY-MM-DD', 'error'); return; }
  const ok = await _o2oCommit(fo, e => {
    const mm = e.meetings.find(x => x.id === meetingId);
    if (!mm) return;
    const aa = _o2oEnsureActions(mm).find(x => x.id === actionId);
    if (aa) aa.due = due;
  });
  if (ok) { toast(due ? 'Due date saved' : 'Due date removed', 'success'); _o2osRenderProfil(o2osUI.fo); }
}

// ── Bridge to My Tasks ─────────────────────────────────────────
// An agreed action is a task: it has an owner, a due date and a status.
// Rather than rebuilding a parallel tracker, we push it into My Tasks,
// which already handles weeks, lateness and the board.
//
// The link is carried by the My Tasks item (`o2o_action`), not by the
// action: the task can be found from the action without duplicating
// state. Status lives in exactly one place — the action — and My Tasks
// reflects it, which avoids two contradicting truths.
function _o2oTaskFor(fo, actionId) {
  return (state.weeklyProgress || []).find(t => t.o2o_action === actionId && t.o2o_fo === fo);
}

// Landing week: the due date's week, but never in the past. My Tasks
// shows one week at a time, so sending an already-overdue action into its
// original week would make it invisible — the FO would click "Send" and
// nothing would appear.
//
// A passed due date is still late: the card carries My Tasks' own "Late"
// badge, which compares against the current week. No information is lost,
// it is simply put where it can be seen.
function _o2oTaskWeek(due) {
  const cur = _wpCurWeek();
  if (!due || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return cur;
  const w = _progressWeekRange(due).weekStart;
  return w < cur ? cur : w;
}

const O2O_TO_WP_STATUS = { todo: 'Planned', done: 'Done', drop: 'Done' };

// Opens My Tasks on the task's own week rather than the current one:
// otherwise the link lands on a screen where the task is absent.
function o2oGoToTask(taskId) {
  const t = (state.weeklyProgress || []).find(x => x.id === taskId);
  if (!t) { toast('Task not found — it may have been deleted', 'error'); return; }
  progressAnchorDate = t.week_start;
  _wpSavePrefs();
  window.renderPage('weekly-progress');
}

async function o2oPushActionToTasks(fo, meetingId, actionId) {
  const m = _o2oFor(fo).meetings.find(x => x.id === meetingId);
  const a = m && _o2oActionsOf(m).find(x => x.id === actionId);
  if (!a) return;

  // Already sent: rather than a flat refusal, take the user to the task.
  // It may sit in a different week than the one on screen — saying
  // "already in My Tasks" without leading there leaves them hunting.
  const deja = _o2oTaskFor(fo, actionId);
  if (deja) {
    progressAnchorDate = deja.week_start;
    _wpSavePrefs();
    window.renderPage('weekly-progress');
    toast('Already sent — here is the week it is in', 'info');
    return;
  }

  // A text-derived action must exist in storage before being linked:
  // otherwise its id would change on the next render and break the link.
  if (a.legacy) {
    const done = await _o2oCommit(fo, e => {
      const mm = e.meetings.find(x => x.id === meetingId);
      if (mm) _o2oEnsureActions(mm);
    });
    if (!done) return;
  }

  try {
    const res = await fetch(`${API}/api/weekly-progress`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: a.text,
        week_start: _o2oTaskWeek(a.due),
        status: O2O_TO_WP_STATUS[a.status] || 'Planned',
        modified_by: fo,
        tracker: personSite(fo),
        // Origin markers: they carry the dedicated styling and the way
        // back to the review the action came from.
        o2o_action: actionId,
        o2o_fo: fo,
        o2o_meeting: meetingId,
        o2o_date: m.date,
      }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    await loadAll();
    toast('Action sent to My Tasks', 'success');
    _o2osRenderProfil(o2osUI.fo);
  } catch (e) { toast('Send failed', 'error'); }
}

// Bulk send: on leaving a review, push everything still to do in one
// gesture rather than action by action.
async function o2oPushAllActions(fo) {
  const today = _o2oToday();
  const todo = _o2oAllActions(fo).filter(a =>
    a.status === 'todo' && !_o2oTaskFor(fo, a.id));
  if (!todo.length) { toast('Nothing to send', 'info'); return; }
  if (!confirm(`Send ${todo.length} action${todo.length > 1 ? 's' : ''} to My Tasks?`)) return;

  // Text-derived actions are materialised in a single config write
  // rather than one write per action.
  if (todo.some(a => a.legacy)) {
    const ok = await _o2oCommit(fo, e => e.meetings.forEach(_o2oEnsureActions));
    if (!ok) return;
  }

  const tracker = personSite(fo);
  const res = await Promise.allSettled(todo.map(a => fetch(`${API}/api/weekly-progress`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task: a.text, week_start: _o2oTaskWeek(a.due), status: 'Planned',
      modified_by: fo, tracker,
      o2o_action: a.id, o2o_fo: fo, o2o_meeting: a.meetingId, o2o_date: a.date,
    }),
  })));
  const ok = res.filter(r => r.status === 'fulfilled' && r.value.ok).length;
  await loadAll();
  toast(ok === todo.length
    ? `${ok} action${ok > 1 ? 's' : ''} sent to My Tasks`
    : `${ok}/${todo.length} sent — ${todo.length - ok} failed`,
    ok === todo.length ? 'success' : 'error');
  _o2osRenderProfil(o2osUI.fo);
}

// From My Tasks back to the review: ticking the task closes the original
// action. Without this the FO would tick in My Tasks while the score kept
// counting the action as not done.
async function _o2oSyncFromTask(item) {
  if (!item || !item.o2o_action || !item.o2o_fo) return;
  const status = item.status === 'Done' ? 'done' : 'todo';
  const m = _o2oFor(item.o2o_fo).meetings.find(x => x.id === item.o2o_meeting);
  const a = m && _o2oActionsOf(m).find(x => x.id === item.o2o_action);
  if (!a || a.status === status || a.status === 'drop') return;
  await _o2oCommit(item.o2o_fo, e => {
    const mm = e.meetings.find(x => x.id === item.o2o_meeting);
    if (!mm) return;
    const aa = _o2oEnsureActions(mm).find(x => x.id === item.o2o_action);
    if (!aa) return;
    aa.status = status;
    if (status === 'done') aa.doneAt = new Date().toISOString();
    else delete aa.doneAt;
  });
}

async function saveSlaHours() {
  const inputs = document.querySelectorAll('#config-sla [data-sla-key]');
  if (!inputs.length) { toast('Error: SLA inputs not found', 'error'); return; }
  const sla_hours = {};
  inputs.forEach(inp => {
    const key  = inp.getAttribute('data-sla-key');
    const leg  = inp.getAttribute('data-sla-leg') || '';
    const val  = parseInt(inp.value, 10);
    if (!key || isNaN(val) || val <= 0) return;
    const modeBtn = inp.closest('div').querySelector(leg ? `[data-sla-mode-key][data-sla-leg="${leg}"]` : '[data-sla-mode-key]');
    const mode    = modeBtn ? modeBtn.getAttribute('data-sla-mode-val') : 'calendar';
    if (leg) {
      sla_hours[key] = sla_hours[key] || {};
      sla_hours[key][leg] = { hours: val, mode };
    } else {
      sla_hours[key] = { hours: val, mode };
    }
  });
  if (!Object.keys(sla_hours).length) { toast('No valid SLA values', 'error'); return; }
  const cfg = { ...state.config, sla_hours };
  const res = await fetch(`${API}/api/config`, { method:'PUT', headers: AdminSession.headers({'Content-Type':'application/json'}), credentials:'same-origin', body: JSON.stringify(cfg) });
  if (!res.ok) { toast('Server error', 'error'); return; }
  await loadConfig(); renderConfig();
  toast('SLA updated', 'success');
}

