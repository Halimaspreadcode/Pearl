/* ══════════════════════════════════════════════════════════════
   SUIVI DES OBJECTIFS — page autonome (Admin › Suivi des objectifs)

   Séparé de la file d'arbitrage, qui reste dans Performance FO ›
   Approvals. Arbitrer et suivre sont deux gestes de rythmes différents :
   l'un se fait quand une demande arrive, l'autre se consulte. Tant que
   les deux partageaient un onglet, le suivi était caché derrière la file
   et un objectif dépassé pouvait passer des semaines sans être vu.

   Cette page met donc les dépassements en tête, avant tout le reste.
   ══════════════════════════════════════════════════════════════ */

const ObjTrack = { data: null, fo: '', view: 'retard', loading: false };

function _obtToday() { return new Date().toISOString().slice(0, 10); }

function _obtDays(from, to) {
  const a = Date.parse(from), b = Date.parse(to || _obtToday());
  if (!isFinite(a) || !isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}

// Jalons approuvés d'un objectif — les seuls qui comptent.
function _obtSteps(o) { return (o.steps || []).filter(s => s.state === 'approved'); }

// État d'un objectif vis-à-vis de ses échéances. Le serveur le calcule
// déjà (`o.late`, posé par OBJ.decorate) ; on retombe sur un calcul local
// quand la réponse vient d'une route qui ne décore pas, pour que la page
// ne dépende pas de l'ordre des déploiements.
function _obtLate(o, today) {
  if (o.late) return o.late;
  const ref = today || _obtToday();
  const steps = _obtSteps(o);
  const lateSteps = steps.filter(s => _stepLate(s, ref));
  const overdue = !!o.due && o.due < ref && o.progress !== 'done';
  return {
    overdue,
    days_over: overdue ? Math.max(0, _obtDays(o.due, ref)) : 0,
    late_steps: lateSteps.length,
    total_steps: steps.length,
  };
}

function _obtPct(o) {
  if (typeof o.progress_pct === 'number') return o.progress_pct;
  const st = _obtSteps(o);
  const p = _stepsPct(st);
  return p === null
    ? (o.progress === 'done' ? 100 : o.progress === 'doing' ? 50 : 0)
    : p;
}

// Toutes les lignes, aplaties, avec ce qu'il faut pour trier et filtrer.
function _obtRows() {
  const today = _obtToday();
  const objs = ObjTrack.data?.objectives || {};
  // Seule la session choisie : sans ce filtre, le trimestre clos restait
  // mêlé au trimestre en cours.
  const sid = objCurSessionId(ObjTrack.data?.sessions);
  const rows = [];
  for (const [fo, list] of Object.entries(objs)) {
    if (typeof objInTeam === 'function' && !objInTeam(fo)) continue;
    for (const o of list || []) {
      // Un objectif rejeté ou encore en brouillon n'est pas un engagement :
      // il n'a pas à peser dans un suivi de trimestre.
      if (o.state !== 'approved') continue;
      if (!objInSession(o, sid)) continue;
      const late = _obtLate(o, today);
      rows.push({
        fo, o, late,
        pct: _obtPct(o),
        done: o.progress === 'done',
        // Un objectif atteint hors délai reste atteint : on ne le remonte
        // pas dans les alertes, mais la date tenue ou non reste lisible.
        overdue: late.overdue,
        lateSteps: late.late_steps,
        daysOver: late.days_over,
      });
    }
  }
  // Le plus en retard d'abord : c'est l'ordre de traitement.
  rows.sort((a, b) => b.daysOver - a.daysOver
    || b.lateSteps - a.lateSteps
    || a.pct - b.pct
    || String(a.fo).localeCompare(String(b.fo)));
  return rows;
}

async function renderObjTrack() {
  const el = document.getElementById('obt-body');
  if (!el) return;
  if (!ObjTrack.data && !ObjTrack.loading) {
    ObjTrack.loading = true;
    el.innerHTML = `<div class="gsla-card"><div class="or-none">Loading…</div></div>`;
    try {
      ObjTrack.data = await _objRevApi('GET', '');
    } catch (e) {
      el.innerHTML = `<div class="gsla-card"><div class="gsla-card-d">${esc(e.message)}</div></div>`;
      return;
    } finally { ObjTrack.loading = false; }
  }
  _obtPaint();
}

function _obtPaint() {
  const rows = _obtRows();
  _obtRenderSess();
  _obtRenderAlert(rows);
  _obtRenderKpis(rows);
  _obtRenderBody(rows);
}

function _obtRenderSess() {
  const el = document.getElementById('obt-sessbar');
  if (!el) return;
  const list = ObjTrack.data?.sessions || [];
  const sid = objCurSessionId(list);
  const shown = list.find(s => s.id === sid);
  const n = _obtDoneSteps().filter(x => x.late).length + _obtOverdueUnticked() + _obtUndated().length;
  el.innerHTML = objSessionPicker('_obtPaint', list)
    + (shown
    ? `<span class="obt-sess"><small>${esc(shown.start)} → ${esc(shown.end)}${
        shown.state === 'open' ? '' : ' · clôturée'}</small></span>`
    : sid === 'all' ? ''
    : `<span class="obt-sess is-off">No session</span>`)
    + `<button type="button" class="obt-fix-btn${n ? ' is-on' : ''}" onclick="obtFixOpen()">
         Fix milestone dates${n ? ` <b>${n}</b>` : ''}</button>`;
}

// ── Correction groupée des dates de réalisation ───────────────
// Contournement pour l'admin : tous les jalons faits, d'un coup d'œil, avec
// leur date de réalisation modifiable. Par défaut seuls ceux comptés en
// retard ; « Set to due date » cale la réalisation sur l'échéance (le
// jalon redevient « tenu »), ligne par ligne ou pour toute la liste.
// Objectifs de l'équipe choisie (SN, CI ou toutes).
function _obtEq() {
  const all = ObjTrack.data?.objectives || {};
  return typeof objTeamFilter === 'function' ? objTeamFilter(all) : all;
}

function _obtOverdueUnticked() {
  const today = _obtToday();
  let n = 0;
  for (const l of Object.values(_obtEq()))
    for (const o of l || []) if (o.state === 'approved')
      n += _obtSteps(o).filter(st => !st.done && st.due && st.due < today).length;
  return n;
}

// Jalons sans date limite : interdits désormais, mais ceux créés avant la
// règle restent à dater. Tous états confondus, sauf objectifs abandonnés.
function _obtUndated() {
  const out = [];
  for (const [fo, l] of Object.entries(_obtEq()))
    for (const o of l || []) {
      if (o.progress === 'dropped' || o.state === 'rejected') continue;
      for (const st of o.steps || []) if (st.state !== 'rejected' && !st.due) out.push({ fo, o, s: st });
    }
  return out;
}

function _obtDoneSteps() {
  const today = _obtToday();
  const out = [];
  for (const [fo, list] of Object.entries(_obtEq())) {
    for (const o of list || []) {
      if (o.state !== 'approved') continue;
      for (const st of _obtSteps(o)) {
        if (!st.done) continue;
        out.push({ fo, o, s: st, late: _stepLate(st, today) });
      }
    }
  }
  return out.sort((a, b) => (b.late - a.late) || a.fo.localeCompare(b.fo) || String(a.s.due).localeCompare(String(b.s.due)));
}

function obtFixOpen(showAll) {
  ObjTrack.fixAll = !!showAll;
  const today = _obtToday();
  const all = _obtDoneSteps();
  const list = showAll ? all : all.filter(x => x.late);
  const q = v => esc(v).replace(/'/g, "\\'");
  let box = document.getElementById('obt-modal');
  if (!box) {
    box = document.createElement('div');
    box.id = 'obt-modal';
    box.className = 'obt-modal';
    box.addEventListener('click', e => { if (e.target === box) obtClose(); });
    document.body.appendChild(box);
  }
  const lateN = all.filter(x => x.late).length;
  box.innerHTML = `
    <div class="obt-dlg obt-dlg-wide" role="dialog" aria-modal="true" aria-label="Fix milestone dates">
      <div class="obt-dlg-h">
        <div class="obt-dlg-id">
          <div class="obt-dlg-t">Fix milestone completion dates</div>
          <div class="obt-dlg-fo">${lateN} milestone${lateN > 1 ? 's' : ''} counted late · ${all.length} done in total.
            A milestone done after its due date counts for half.</div>
        </div>
        <button class="obt-dlg-x" onclick="obtClose()" aria-label="Close">×</button>
      </div>
      <div class="obt-fix-bar">
        <label><input type="checkbox" ${showAll ? 'checked' : ''} onchange="obtFixOpen(this.checked)"> Show all done milestones</label>
        <span style="flex:1"></span>
        ${list.some(x => x.late && x.s.due) ? `<button class="btn btn-primary btn-sm" onclick="obtFixAllToDue(this)">
          Set all late ones to their due date</button>` : ''}
      </div>
      ${(() => {
        const nd = _obtUndated();
        return nd.length ? `<div class="obt-fix-sub">No deadline — every milestone needs one</div>
          <div class="obt-fix-bar"><span style="flex:1"></span>
            <button class="btn btn-primary btn-sm" onclick="obtDueAllToObjective(this)">
              Use each objective's deadline (or the session end)</button></div>
          <div class="obt-fix-list">${nd.map(x => `<div class="obt-fix-row is-late">
            <span class="obt-fix-fo">${esc(x.fo)}</span>
            <span class="obt-fix-what"><small>${esc(x.o.title)}</small>${esc(_stepTitle(x.s) || 'milestone')}</span>
            <span class="obt-fix-due">—</span>
            <span><input type="date" value="${esc(_obtDefaultDue(x.o))}"
                 onchange="obtDueSet('${q(x.fo)}','${x.o.id}','${x.s.id}',this.value,this)"></span>
            <span><button class="obt-fix-due-btn" onclick="obtDueSet('${q(x.fo)}','${x.o.id}','${x.s.id}',this.parentNode.previousElementSibling.firstElementChild.value,this)">Save</button></span>
          </div>`).join('')}</div>` : '';
      })()}
      ${(() => {
        // Échéance passée, jamais cochés : peut-être faits sans que l'agent
        // l'ait signalé. L'admin peut les marquer faits à la date réelle.
        const pend = [];
        for (const [fo, l] of Object.entries(_obtEq()))
          for (const o of l || []) if (o.state === 'approved')
            for (const st of _obtSteps(o)) if (!st.done && st.due && st.due < today) pend.push({ fo, o, s: st });
        return pend.length ? `<div class="obt-fix-sub">Past due, not ticked — mark as done on the real date</div>
          <div class="obt-fix-list">${pend.map(x => `<div class="obt-fix-row is-late">
            <span class="obt-fix-fo">${esc(x.fo)}</span>
            <span class="obt-fix-what"><small>${esc(x.o.title)}</small>${esc(_stepTitle(x.s) || 'milestone')}</span>
            <span class="obt-fix-due">${esc(x.s.due)}</span>
            <span><input type="date" max="${today}" id="obt-md-${x.s.id}" value="${x.s.due}"></span>
            <span><button class="obt-fix-due-btn" onclick="obtFixMarkDone('${q(x.fo)}','${x.o.id}','${x.s.id}',this)">Mark done</button></span>
          </div>`).join('')}</div>
          <div class="obt-fix-sub">Done milestones</div>` : '';
      })()}
      ${list.length ? `<div class="obt-fix-list">
        <div class="obt-fix-row is-h"><span>Agent</span><span>Objective · milestone</span><span>Due</span><span>Done on</span><span></span></div>
        ${list.map(x => `<div class="obt-fix-row ${x.late ? 'is-late' : ''}">
          <span class="obt-fix-fo">${esc(x.fo)}</span>
          <span class="obt-fix-what"><small>${esc(x.o.title)}</small>${esc(_stepTitle(x.s) || 'milestone')}</span>
          <span class="obt-fix-due">${esc(x.s.due || '—')}</span>
          <span><input type="date" max="${today}" value="${x.s.done_at ? String(x.s.done_at).slice(0, 10) : ''}"
                 onchange="obtFixSet('${q(x.fo)}','${x.o.id}','${x.s.id}',this.value,this)"></span>
          <span>${x.late && x.s.due && x.s.due <= today ? `<button class="obt-fix-due-btn" onclick="obtFixSet('${q(x.fo)}','${x.o.id}','${x.s.id}','${x.s.due}',this)">Set to due date</button>` : x.late ? '' : '<span class="obt-fix-ok">on time</span>'}</span>
        </div>`).join('')}
      </div>` : `<div class="obt-dlg-none" style="padding:18px 0">No milestone ${showAll ? 'done yet' : 'counted late'}.</div>`}
    </div>`;
  box.classList.add('open');
}

async function _obtPutDate(fo, id, sid, date) {
  const o = await _objRevApi('PUT', `/${encodeURIComponent(fo)}/${id}/steps/${sid}/done-date`, { date, by: 'admin' });
  const list = (ObjTrack.data?.objectives || {})[fo] || [];
  const i = list.findIndex(x => x.id === id);
  if (i >= 0) list[i] = o;
}

async function obtFixSet(fo, id, sid, date, el) {
  if (!date) return;
  if (el) el.disabled = true;
  try {
    await _obtPutDate(fo, id, sid, date);
    toast('Completion date saved.', 'success');
  } catch (e) { toast(e.message, 'error'); }
  _obtPaint();
  obtFixOpen(ObjTrack.fixAll);
}

async function obtFixMarkDone(fo, id, sid, btn) {
  const date = document.getElementById(`obt-md-${sid}`)?.value;
  if (!date) { toast('Pick the date it was done.', 'error'); return; }
  if (btn) btn.disabled = true;
  try {
    const o = await _objRevApi('PUT', `/${encodeURIComponent(fo)}/${id}/steps/${sid}/done-date`, { date, markDone: true, by: 'admin' });
    const list = (ObjTrack.data?.objectives || {})[fo] || [];
    const i = list.findIndex(x => x.id === id);
    if (i >= 0) list[i] = o;
    toast('Milestone marked as done.', 'success');
  } catch (e) { toast(e.message, 'error'); }
  _obtPaint();
  obtFixOpen(ObjTrack.fixAll);
}

// Date proposée pour un jalon sans échéance : celle de l'objectif, sinon
// la fin de sa session.
function _obtDefaultDue(o) {
  if (o.due) return o.due;
  const sess = (ObjTrack.data?.sessions || []).find(x => x.id === o.session);
  return sess?.end || '';
}

async function _obtPutDue(fo, id, sid, due) {
  const o = await _objRevApi('PUT', `/${encodeURIComponent(fo)}/${id}/steps/${sid}/due`, { due, by: 'admin' });
  const list = (ObjTrack.data?.objectives || {})[fo] || [];
  const i = list.findIndex(x => x.id === id);
  if (i >= 0) list[i] = o;
}

async function obtDueSet(fo, id, sid, due, el) {
  if (!due) { toast('Pick a deadline.', 'error'); return; }
  if (el) el.disabled = true;
  try {
    await _obtPutDue(fo, id, sid, due);
    toast('Deadline saved.', 'success');
  } catch (e) { toast(e.message, 'error'); }
  _obtPaint();
  obtFixOpen(ObjTrack.fixAll);
}

async function obtDueAllToObjective(btn) {
  const todo = _obtUndated().map(x => ({ ...x, due: _obtDefaultDue(x.o) })).filter(x => x.due);
  const sans = _obtUndated().length - todo.length;
  if (!todo.length) { toast('No objective or session deadline to copy — set them one by one.', 'error'); return; }
  if (!confirm(`Give ${todo.length} milestone${todo.length > 1 ? 's' : ''} the deadline of their objective (or the session end)?${sans ? `\n\n${sans} have neither and will stay to set by hand.` : ''}\n\nEach change is recorded in the objective's history.`)) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  let ok = 0, ko = 0;
  for (const x of todo) {
    try { await _obtPutDue(x.fo, x.o.id, x.s.id, x.due); ok++; } catch { ko++; }
  }
  toast(ko ? `${ok} dated, ${ko} failed.` : `${ok} milestone${ok > 1 ? 's' : ''} dated.`, ko ? 'error' : 'success');
  _obtPaint();
  obtFixOpen(ObjTrack.fixAll);
}

async function obtFixAllToDue(btn) {
  const today = _obtToday();
  const todo = _obtDoneSteps().filter(x => x.late && x.s.due && x.s.due <= today);
  if (!todo.length) return;
  if (!confirm(`Set the completion date of ${todo.length} late milestone${todo.length > 1 ? 's' : ''} to their due date?\n\nThey will count as met on time. Each change is recorded in the objective's history.`)) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  let ok = 0, ko = 0;
  for (const x of todo) {
    try { await _obtPutDate(x.fo, x.o.id, x.s.id, x.s.due); ok++; } catch { ko++; }
  }
  toast(ko ? `${ok} corrected, ${ko} failed.` : `${ok} milestone${ok > 1 ? 's' : ''} corrected.`, ko ? 'error' : 'success');
  _obtPaint();
  obtFixOpen(ObjTrack.fixAll);
}

// ── Le rappel en exergue ──────────────────────────────────────
// Ce qui a dépassé son échéance, en haut, en rouge, avec les noms. Une
// alerte qui se contente d'un compte oblige à chercher qui est concerné ;
// on nomme donc les agents et on renvoie directement sur leur ligne.
function _obtRenderAlert(rows) {
  const el = document.getElementById('obt-alert');
  if (!el) return;

  const over = rows.filter(r => r.overdue && !r.done);
  const stepsOnly = rows.filter(r => !r.overdue && !r.done && r.lateSteps > 0);

  if (!over.length && !stepsOnly.length) {
    el.innerHTML = `<div class="obt-ok">
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
           stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
      <span>No objective past its deadline. ${rows.length
        ? `${rows.length} objective${rows.length > 1 ? 's' : ''} on track.`
        : 'Nothing is being tracked yet.'}</span>
    </div>`;
    return;
  }

  // Groupé par agent : « 3 objectifs dépassés » sur trois agents
  // différents n'appelle pas la même conversation que trois sur un seul.
  const byFo = {};
  over.forEach(r => { (byFo[r.fo] = byFo[r.fo] || []).push(r); });
  const worst = over[0];

  el.innerHTML = `
    ${over.length ? `
    <div class="obt-alert" role="alert">
      <div class="obt-alert-ico">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
             stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      </div>
      <div class="obt-alert-body">
        <div class="obt-alert-t">${over.length} objectif${over.length > 1 ? 's' : ''} dépassé${over.length > 1 ? 's' : ''}</div>
        <div class="obt-alert-d">
          Across ${Object.keys(byFo).length} agent${Object.keys(byFo).length > 1 ? 's' : ''}.
          The longest overrun is <b>${esc(worst.fo)}</b> —
          « ${esc(worst.o.title)} », ${worst.daysOver} day${worst.daysOver > 1 ? 's' : ''} past due.
        </div>
        <div class="obt-alert-chips">
          ${Object.entries(byFo).map(([fo, list]) => `
            <button type="button" class="obt-chip" onclick="obtFocus('${esc(fo).replace(/'/g, "\\'")}')">
              <b>${esc(fo)}</b><span>${list.length}</span></button>`).join('')}
        </div>
      </div>
    </div>` : ''}

    ${stepsOnly.length ? `
    <div class="obt-alert is-warn">
      <div class="obt-alert-ico">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
             stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><path d="M12 7v5l3 2"/></svg>
      </div>
      <div class="obt-alert-body">
        <div class="obt-alert-t">${stepsOnly.reduce((n, r) => n + r.lateSteps, 0)} jalon(s) en retard</div>
        <div class="obt-alert-d">
          On ${stepsOnly.length} objective${stepsOnly.length > 1 ? 's' : ''} still within their own deadline.
          A milestone met late counts for half in the progress shown.
        </div>
      </div>
    </div>` : ''}`;
}

function _obtRenderKpis(rows) {
  const el = document.getElementById('obt-kpis');
  if (!el) return;
  if (!rows.length) { el.innerHTML = ''; return; }
  const done = rows.filter(r => r.done).length;
  const over = rows.filter(r => r.overdue && !r.done).length;
  const lateSteps = rows.reduce((n, r) => n + r.lateSteps, 0);
  const avg = Math.round(rows.reduce((n, r) => n + r.pct, 0) / rows.length);

  const tile = (v, l, tone) => `<div class="obt-kpi${tone ? ' is-' + tone : ''}">
    <div class="obt-kpi-v">${v}</div><div class="obt-kpi-l">${l}</div></div>`;
  el.innerHTML = `<div class="obt-kpis">
    ${tile(rows.length, 'objectifs suivis', '')}
    ${tile(avg + '%', 'avancement moyen', avg >= 70 ? 'ok' : avg < 40 ? 'bad' : 'warn')}
    ${tile(done, 'atteints', done ? 'ok' : '')}
    ${tile(over, 'dépassés', over ? 'bad' : 'ok')}
    ${tile(lateSteps, 'jalons en retard', lateSteps ? 'warn' : 'ok')}
  </div>`;
}

function obtView(v) { ObjTrack.view = v; _obtPaint(); }
function obtFilterFo(v) { ObjTrack.fo = v; _obtPaint(); }

// Depuis une pastille d'alerte : on filtre sur l'agent et on bascule sur
// la vue qui montre ses lignes, plutôt que de laisser chercher.
function obtFocus(fo) {
  ObjTrack.fo = fo;
  ObjTrack.view = 'retard';
  _obtPaint();
  document.getElementById('obt-body')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function _obtRenderBody(rows) {
  const el = document.getElementById('obt-body');
  if (!el) return;

  // L'agent filtré reste dans la liste même sans objectif approuvé : sinon
  // la liste affichait « Tous les agents » sur un résultat qui était le sien.
  const foList = [...new Set([...rows.map(r => r.fo), ...(ObjTrack.fo ? [ObjTrack.fo] : [])])].sort();
  let shown = rows;
  if (ObjTrack.fo) shown = shown.filter(r => r.fo === ObjTrack.fo);
  if (ObjTrack.view === 'retard') shown = shown.filter(r => (r.overdue || r.lateSteps) && !r.done);
  if (ObjTrack.view === 'encours') shown = shown.filter(r => !r.done);
  if (ObjTrack.view === 'atteints') shown = shown.filter(r => r.done);

  const counts = {
    retard: rows.filter(r => (r.overdue || r.lateSteps) && !r.done).length,
    encours: rows.filter(r => !r.done).length,
    atteints: rows.filter(r => r.done).length,
    tous: rows.length,
  };
  const tab = (id, label) => `<button class="obt-tab${ObjTrack.view === id ? ' is-on' : ''}"
    onclick="obtView('${id}')">${label}<span>${counts[id]}</span></button>`;

  el.innerHTML = `
    <div class="obt-bar">
      <div class="obt-tabs">
        ${tab('retard', 'En retard')}${tab('encours', 'En cours')}
        ${tab('atteints', 'Atteints')}${tab('tous', 'Tous')}
      </div>
      ${typeof objTeamSwitch === 'function' ? objTeamSwitch() : ''}
      <select class="form-control obt-sel" onchange="obtFilterFo(this.value)">
        <option value="">Tous les agents</option>
        ${foList.map(fo => `<option value="${esc(fo)}"${
          fo === ObjTrack.fo ? ' selected' : ''}>${esc(fo)}</option>`).join('')}
      </select>
    </div>
    ${shown.length
      ? `<div class="obt-list">${shown.map(_obtCard).join('')}</div>`
      : `<div class="gsla-card"><div class="or-none">${
          ObjTrack.view === 'retard'
            ? 'Nothing overdue in this scope — good.'
            : 'No objective in this scope.'}</div></div>`}`;
}

function _obtCard(r) {
  const { fo, o, pct } = r;
  const steps = _obtSteps(o);
  const today = _obtToday();
  const tone = r.overdue ? 'bad' : r.lateSteps ? 'warn' : r.done ? 'ok' : '';

  // Jalons en lignes, chacun avec sa deadline : la puce seule ne disait
  // pas quand un jalon était attendu, ni s'il avait été tenu.
  const jour = d => { const [y, m, dd] = String(d).split('-'); return dd && m ? `${dd}/${m}` : d; };
  const stepRows = steps.length ? `<div class="obt-ms">
    ${steps.map(s => {
      const late = _stepLate(s, today);
      const cls = s.done ? (late ? 'is-late' : 'is-done') : (late ? 'is-over' : '');
      const mark = s.done ? (late ? '◑' : '✓') : (late ? '!' : '○');
      const quand = s.done
        ? `done ${s.done_at ? jour(String(s.done_at).slice(0, 10)) : ''}${late ? ' · late' : ''}`
        : late ? 'overdue' : '';
      return `<div class="obt-ms-row ${cls}">
        <span class="obt-ms-mark">${mark}</span>
        <span class="obt-ms-l">${esc(_stepTitle(s) || 'milestone')}</span>
        <span class="obt-ms-due" title="Deadline">${s.due ? esc(jour(s.due)) : '—'}</span>
        <span class="obt-ms-st">${esc(quand)}</span>
      </div>`;
    }).join('')}
  </div>` : `<div class="obt-nosteps">No milestone — progress can only be read from the overall status.</div>`;

  const kpis = (o.kpis || []).filter(k => k.state === 'approved');
  const cibleK = k => { const t = String(k.target || '').trim(), u = String(k.unit || '').trim();
    return u && !t.toLowerCase().endsWith(u.toLowerCase()) ? `${t} ${u}`.trim() : t; };
  const kpiRows = kpis.length ? `<div class="obt-kpis">${kpis.map(k => `<span class="obt-kpi">
      <b>${esc(k.name || 'KPI')}</b>${cibleK(k) ? `<i>${esc(cibleK(k))}</i>` : ''}</span>`).join('')}</div>`
    : `<div class="obt-nokpi">No KPI</div>`;

  // La carte s'ouvre sur la fiche complète (obtOpen) : le résumé seul ne
  // montrait ni le pourquoi, ni les KPI, ni les dates des jalons.
  return `<div class="obt-card obt-card-click${tone ? ' is-' + tone : ''}" role="button" tabindex="0"
    onclick="obtOpen('${esc(fo).replace(/'/g, "\\'")}','${o.id}')"
    onkeydown="if(event.key==='Enter')obtOpen('${esc(fo).replace(/'/g, "\\'")}','${o.id}')">
    <div class="obt-card-head">
      <span class="obt-av" style="background:${foAvatarColor(fo)}">${foInitials(fo)}</span>
      <div class="obt-card-id">
        <div class="obt-card-t">${esc(o.title)}</div>
        <div class="obt-card-fo">${esc(fo)}</div>
      </div>
      <div class="obt-card-due">
        ${o.due ? `<span class="${r.overdue ? 'obt-late' : ''}">${esc(o.due)}</span>` : '<span>—</span>'}
        ${r.overdue ? `<b>+${r.daysOver} j</b>` : ''}
      </div>
    </div>
    <div class="obt-prog">
      <div class="obt-prog-bar"><i style="width:${pct}%"></i></div>
      <span class="obt-prog-v">${pct}%</span>
    </div>
    ${r.lateSteps ? `<div class="obt-note">${r.lateSteps} milestone${
      r.lateSteps > 1 ? 's' : ''} met or pending past deadline — counted at half weight.</div>` : ''}
    <div class="obt-sec-k">KPI</div>
    ${kpiRows}
    <div class="obt-sec-k">Milestones <span>deadline</span></div>
    ${stepRows}
  </div>`;
}

// ── Fiche d'un objectif ───────────────────────────────────────
// Tout ce que l'agent a posé : pourquoi, KPI et cibles, jalons avec
// échéance et date de réalisation. La date de réalisation d'un jalon fait
// se corrige ici : c'est elle qui décide « tenu » ou « en retard », et un
// agent qui a coché après coup doit pouvoir être rétabli.
function obtOpen(fo, id) {
  const o = ((ObjTrack.data?.objectives || {})[fo] || []).find(x => x.id === id);
  if (!o) return;
  const today = _obtToday();
  const late = _obtLate(o, today);
  const kpis = (o.kpis || []).filter(k => k.state === 'approved');
  const steps = _obtSteps(o);
  // L'unité n'est ajoutée que si la cible ne la porte pas déjà (« < 6h »).
  const cible = k => { const t = String(k.target || '').trim(), u = String(k.unit || '').trim();
    return u && !t.toLowerCase().endsWith(u.toLowerCase()) ? `${t} ${u}`.trim() : t; };
  const etat = s => s.done ? (_stepLate(s, today) ? ['is-late', 'Met late — counts for half'] : ['is-done', 'Met on time'])
    : (_stepLate(s, today) ? ['is-over', 'Past due'] : ['', s.due ? 'Planned' : 'No deadline']);
  const fid = `${fo}|${id}`.replace(/[^\w|]/g, '_');
  let box = document.getElementById('obt-modal');
  if (!box) {
    box = document.createElement('div');
    box.id = 'obt-modal';
    box.className = 'obt-modal';
    box.addEventListener('click', e => { if (e.target === box) obtClose(); });
    document.body.appendChild(box);
  }
  box.innerHTML = `
    <div class="obt-dlg" role="dialog" aria-modal="true" aria-label="${esc(o.title)}">
      <div class="obt-dlg-h">
        <span class="obt-av" style="background:${foAvatarColor(fo)}">${foInitials(fo)}</span>
        <div class="obt-dlg-id">
          <div class="obt-dlg-t">${esc(o.title)}</div>
          <div class="obt-dlg-fo">${esc(fo)}${o.due ? ` · due <b class="${late.overdue ? 'obt-late' : ''}">${esc(o.due)}</b>` : ''} · ${_obtPct(o)}%</div>
        </div>
        <button class="obt-dlg-x" onclick="obtClose()" aria-label="Close">×</button>
      </div>
      ${o.why ? `<div class="obt-dlg-sec"><div class="obt-dlg-k">Why it matters</div><div>${esc(o.why)}</div></div>` : ''}
      <div class="obt-dlg-sec"><div class="obt-dlg-k">KPIs</div>
        ${kpis.length ? kpis.map(k => `<div class="obt-dlg-kpi"><b>${esc(k.name || '—')}</b>
          ${cible(k) ? `<span class="obt-dlg-target">${esc(cible(k))}</span>` : ''}
          ${k.source ? `<span class="obt-dlg-src">${esc(k.source)}</span>` : ''}</div>`).join('')
          : '<div class="obt-dlg-none">No approved KPI.</div>'}
      </div>
      <div class="obt-dlg-sec"><div class="obt-dlg-k">Milestones</div>
        ${steps.length ? steps.map(s => { const [cls, lbl] = etat(s); return `
          <div class="obt-dlg-step ${cls}">
            <span class="obt-dlg-mark">${s.done ? (cls === 'is-late' ? '◑' : '●') : '○'}</span>
            <span class="obt-dlg-lbl">${esc(_stepTitle(s) || 'milestone')}</span>
            <span class="obt-dlg-due">${s.due ? `due ${esc(s.due)}` : 'no deadline'}</span>
            <span class="obt-dlg-st">${lbl}</span>
            ${s.done ? `<label class="obt-dlg-when">done on
              <input type="date" max="${today}" value="${s.done_at ? String(s.done_at).slice(0, 10) : ''}"
                     onchange="obtSetDoneDate('${esc(fo).replace(/'/g, "\\'")}','${o.id}','${s.id}',this.value,this)"></label>` : ''}
          </div>`; }).join('') : '<div class="obt-dlg-none">No milestone.</div>'}
        <div class="obt-dlg-hint">A milestone met after its due date counts for half. If the agent ticked it late but did it on time, correct the date here.</div>
      </div>
    </div>`;
  box.classList.add('open');
  box.dataset.fid = fid;
}
function obtClose() { document.getElementById('obt-modal')?.classList.remove('open'); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') obtClose(); });

async function obtSetDoneDate(fo, id, sid, date, input) {
  if (!date) return;
  try {
    const o = await _objRevApi('PUT', `/${encodeURIComponent(fo)}/${id}/steps/${sid}/done-date`, { date, by: 'admin' });
    const list = (ObjTrack.data?.objectives || {})[fo] || [];
    const i = list.findIndex(x => x.id === id);
    if (i >= 0) list[i] = o;
    toast('Completion date saved.', 'success');
    _obtPaint();
    obtOpen(fo, id);
  } catch (e) {
    toast(e.message, 'error');
    if (input) input.value = '';
  }
}

window.obtOpen = obtOpen;
window.obtFixOpen = obtFixOpen;
window.obtFixSet = obtFixSet;
window.obtFixAllToDue = obtFixAllToDue;
window.obtFixMarkDone = obtFixMarkDone;
window.obtDueSet = obtDueSet;
window.obtDueAllToObjective = obtDueAllToObjective;
window.obtClose = obtClose;
window.obtSetDoneDate = obtSetDoneDate;
window.renderObjTrack = renderObjTrack;
window.obtView = obtView;
window.obtFilterFo = obtFilterFo;
window.obtFocus = obtFocus;

// Reprise du plan trimestriel dans la session ouverte, depuis le profil
// agent. Le geste existait déjà dans Performance FO › Approbations, mais
// c'est ici qu'on constate le problème : obliger à traverser deux écrans
// pour corriger ce qu'on a sous les yeux garantissait que personne ne le
// ferait — et huit agents sur dix sont restés sur un plan figé d'août.
//
// La reprise vaut pour toute l'équipe, pas pour le seul agent affiché :
// c'est ainsi que la route est faite, et reprendre agent par agent
// laisserait une équipe à deux régimes.
async function o2osCarryOver() {
  const sess = (state.config.objective_sessions || []).find(x => x.state === 'open');
  if (!sess) { toast('Aucune session ouverte.', 'error'); return; }

  let preview = null;
  try {
    const r = await fetch(`${API}/api/objective-sessions/import-o2o/preview`, {
      headers: AdminSession.headers(), credentials: 'same-origin' });
    if (r.ok) preview = await r.json();
  } catch (_) {}

  const n = preview?.total || 0;
  const agents = preview?.agents || 0;
  if (!n) { toast('Rien à reprendre : le plan est déjà dans la session.', 'info'); return; }

  if (!confirm(
    `Reprendre ${n} objectif(s) du plan trimestriel dans « ${sess.name} » ?\n\n`
    + `Cela concerne ${agents} agent(s), et non le seul profil affiché.\n`
    + `Ils arrivent déjà approuvés, avec leurs KPI et leurs jalons, et `
    + `deviennent visibles par les agents dans My Performance.`)) return;

  try {
    const res = await fetch(`${API}/api/objective-sessions/${sess.id}/import-o2o`, {
      method: 'POST', headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
      credentials: 'same-origin', body: JSON.stringify({ by: 'admin' }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Reprise impossible');
    toast(`${d.objectives} objectif(s) repris pour ${d.agents} agent(s).`, 'success');
    await loadConfig();
    _o2osRenderProfil(o2osUI.fo);
  } catch (e) {
    toast(e.message, 'error');
  }
}
window.o2osCarryOver = o2osCarryOver;

