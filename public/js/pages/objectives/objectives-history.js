// Télécharge le bilan de session. L'en-tête d'admin ne peut pas voyager
// sur un lien classique : on récupère le fichier par fetch, puis on le
// remet au navigateur comme un téléchargement ordinaire.
// ── HISTORIQUE DES SESSIONS D'OBJECTIFS ───────────────────────
// Vue dédiée : l'onglet Approbations sert à trancher ce qui arrive, pas
// à relire ce qui s'est passé. Un bilan de trimestre se consulte des
// mois plus tard, quand plus rien n'attend de décision.
async function renderObjSessions() {
  const el = document.getElementById('perf-sessions');
  if (!el) return;
  el.innerHTML = '<div class="or-sess-past-t">Chargement…</div>';

  let sessions = [];
  try {
    const res = await fetch(`${API}/api/objective-sessions`, {
      headers: AdminSession.headers(), credentials: 'same-origin' });
    if (!res.ok) throw new Error(String(res.status));
    sessions = await res.json();
  } catch {
    el.innerHTML = '<div class="or-sess-past-t">Chargement impossible.</div>';
    return;
  }

  if (!sessions.length) {
    el.innerHTML = `<div class="config-card">
      <div class="gsla-card-t">Sessions d'objectifs</div>
      <p class="gsla-card-d">Aucune session pour le moment. Ouvrez-en une depuis
      l'onglet Approbations pour que les agents puissent déposer leurs objectifs.</p>
    </div>`;
    return;
  }

  // Ouverte d'abord, puis les closes de la plus récente à la plus
  // ancienne : c'est l'ordre dans lequel on les cherche.
  const tri = [...sessions].sort((a, b) => {
    if (a.state !== b.state) return a.state === 'open' ? -1 : 1;
    return String(b.closed_at || b.start || '').localeCompare(String(a.closed_at || a.start || ''));
  });

  el.innerHTML = `<div class="config-card">
    <div class="gsla-card-t">Sessions d'objectifs</div>
    <p class="gsla-card-d">
      Le bilan détaillé reste disponible après la clôture — synthèse, vue par
      agent, détail des objectifs et historique des décisions.
    </p>
    <div class="os-list">
      ${tri.map(s => `<div class="os-row${s.state === 'open' ? ' is-open' : ''}">
        <div class="os-main">
          <div class="os-name">${esc(s.name || s.id)}
            <span class="os-state os-${esc(s.state)}">${s.state === 'open' ? 'ouverte' : 'fermée'}</span>
          </div>
          <div class="os-meta">${esc(s.start || '?')} → ${esc(s.end || '?')}${
            s.closed_at ? ` · clôturée le ${esc(String(s.closed_at).slice(0, 10))}` : ''}</div>
        </div>
        <div class="os-actions">
          <button class="btn btn-secondary btn-sm" onclick="objRevExport('${esc(s.id)}','pptx')"
                  title="Deck de présentation pour le comité">PowerPoint</button>
          <button class="btn btn-ghost btn-sm" onclick="objRevExport('${esc(s.id)}','xlsx')"
                  title="Détail complet, filtrable">Excel</button>
          ${s.state === 'closed' ? `<button class="btn btn-ghost btn-sm" onclick="objRevReopen('${esc(s.id)}','${esc(String(s.name || s.id)).replace(/'/g, "\\'")}','${esc(s.end || '')}')"
                  title="Rouvrir la session : les objectifs retrouvent leur état d'avant la clôture">Rouvrir</button>` : ''}
        </div>
      </div>`).join('')}
    </div>
  </div>`;
}

async function objRevExport(id, format) {
  const ext = format === 'pptx' ? 'pptx' : 'xlsx';
  try {
    const res = await fetch(`${API}/api/objective-sessions/${encodeURIComponent(id)}/report.${ext}?team=${objTeam()}`, {
      headers: AdminSession.headers(), credentials: 'same-origin' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Échec (${res.status})`);
    const blob = await res.blob();
    // Le nom vient du serveur : il porte celui de la session, pas un
    // identifiant technique.
    const nom = (res.headers.get('Content-Disposition') || '')
      .match(/filename="([^"]+)"/)?.[1] || `objectifs.${ext}`;
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: nom });
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    toast('Rapport généré', 'success');
  } catch (e) {
    toast(`Export impossible : ${e.message}`, 'error');
  }
}

function objRevCloseSession(id, name) {
  if (!confirm(`Close “${name}”?\n\nApproved objectives that are not finished will be
recorded as not met, and anything still awaiting approval will not carry over.`)) return;
  _objRevDo(async () => {
    const res = await fetch(`${API}/api/objective-sessions/${id}/close`, {
      method: 'POST', headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
      credentials: 'same-origin', body: JSON.stringify({ by: 'admin' }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Impossible');
    toast(`Session closed — ${d.closed} settled, ${d.lapsed} not carried over.`, 'success');
  });
}

// Réouverture d'une session close. Si sa date de fin est passée, on
// propose d'en fixer une nouvelle (sinon les objectifs rouverts seraient
// aussitôt « en retard » sur la session).
function objRevReopen(id, name, end) {
  const today = new Date().toLocaleDateString('sv-SE');
  let nouvelleFin = '';
  if (end && end < today) {
    const d = new Date(); d.setDate(d.getDate() + 30);
    const prop = d.toLocaleDateString('sv-SE');
    const v = prompt(`“${name}” ended on ${end}.\nNew end date (YYYY-MM-DD) — leave as is to keep ${end}:`, prop);
    if (v === null) return;
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) { toast('Invalid date (YYYY-MM-DD).', 'error'); return; }
    nouvelleFin = v.trim() !== end ? v.trim() : '';
  }
  if (!confirm(`Reopen “${name}”?\n\nAgents can write and revise their objectives again, and each objective goes back to how it was before the session was closed.`)) return;
  _objRevDo(async () => {
    const res = await fetch(`${API}/api/objective-sessions/${encodeURIComponent(id)}/reopen`, {
      method: 'POST', headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
      credentials: 'same-origin', body: JSON.stringify({ by: 'admin', ...(nouvelleFin ? { end: nouvelleFin } : {}) }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Impossible');
    toast(`“${name}” reopened — ${(d.restored || 0) + (d.reconstructed || 0)} objective(s) back in the session.`, 'success');
    if (typeof loadConfig === 'function') await loadConfig();
    if (typeof renderObjSessions === 'function') renderObjSessions();
  });
}

// ── Rendu ─────────────────────────────────────────────────────

function renderObjReview() {
  const el = document.getElementById('perf-obj-review');
  if (!el || !ObjRev.data) return;
  const { sessions } = ObjRev.data;
  // Équipe choisie (SN, CI ou toutes) : file, liste et exports la suivent.
  const objectives = objTeamFilter(ObjRev.data.objectives);
  const pending = _objRevPending(objectives);
  const open = (sessions || []).find(s => s.state === 'open');
  const all = _objRevAll(objectives, sessions);

  el.innerHTML = `
    <div class="gsla-card or-sess">
      <div class="gsla-card-head">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <h3 class="gsla-card-t">Objectives session</h3>${objTeamSwitch()}</div>
        <p class="gsla-card-d">
          Objectives run in quarterly sessions. While a session is open, agents
          write and revise theirs; closing it settles the quarter and clears the
          slate for the next one.
        </p>
      </div>
      ${open ? `
        <div class="or-sess-on">
          <div>
            <div class="or-sess-n">${esc(open.name)}</div>
            <div class="or-sess-d">${esc(open.start)} → ${esc(open.end)} · open</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="objRevExport('${open.id}')">
            Rapport détaillé</button>
          <button class="btn btn-ghost btn-sm" onclick="objRevCloseSession('${open.id}','${esc(open.name)}')">
            Close the session</button>
        </div>
        <!-- Rattrapage : une session ouverte sans la case de reprise
             laissait les objectifs existants hors du flux, invisibles
             pour l'agent comme pour la file d'arbitrage. -->
        ${ObjRev.pending2import > 0 ? `<div class="or-sess-imp">
          <div>
            <b>${ObjRev.pending2import} objective${ObjRev.pending2import > 1 ? 's' : ''}
            from One-to-One ${ObjRev.pending2import > 1 ? 'are' : 'is'} not in this session.</b>
            They stay invisible to the agents until you carry them over. They come
            in already approved, with their KPI and milestones.
          </div>
          <span style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="or-btn is-ok" onclick="objRevImportInto('${open.id}')">
              Carry them over</button>
            <button class="or-btn" onclick="objRevDeletePending()" title="Delete these One-to-One objectives">
              Delete them</button>
          </span>
        </div>` : ''}`
      : `<div class="or-sess-off">
          <div>No session is open — agents cannot write objectives right now.</div>
          <button class="btn btn-primary btn-sm" onclick="objRevOpenSession()">Open a session</button>
        </div>
        ${ObjRev.pending2import > 0 ? `<div class="or-sess-imp">
          <div><b>${ObjRev.pending2import} objective${ObjRev.pending2import > 1 ? 's' : ''} from One-to-One</b>
            ${ObjRev.pending2import > 1 ? 'have' : 'has'} never been carried over into a session.</div>
          <button class="or-btn" onclick="objRevDeletePending()">Delete them</button>
        </div>` : ''}`}
      ${(sessions || []).filter(s => s.state === 'closed').length ? `
        <div class="or-sess-past">
          <div class="or-sess-past-t">Sessions passées</div>
          ${(sessions || []).filter(s => s.state === 'closed')
            .sort((a, b) => String(b.closed_at || '').localeCompare(String(a.closed_at || '')))
            .map(s => `<div class="or-sess-past-i">
              <span>${esc(s.name)}${s.closed_at
                ? ` <span class="or-sess-past-d">clôturée le ${esc(String(s.closed_at).slice(0, 10))}</span>`
                : ''}</span>
              <span style="display:flex;gap:6px">
                <button class="btn btn-ghost btn-sm" onclick="objRevExport('${esc(s.id)}')">
                  Rapport détaillé</button>
                <button class="btn btn-ghost btn-sm" onclick="objRevReopen('${esc(s.id)}','${esc(String(s.name || s.id)).replace(/'/g, "\\'")}','${esc(s.end || '')}')">
                  Reopen</button>
              </span>
            </div>`).join('')}
        </div>` : ''}
    </div>

    <div class="or-bar">
      <div class="or-tabs">
        <button class="or-tab ${ObjRev.tab === 'pending' ? 'is-on' : ''}" onclick="objRevTab('pending')">
          Awaiting decision${pending.length ? ` (${pending.length})` : ''}</button>
        <button class="or-tab ${ObjRev.tab === 'all' ? 'is-on' : ''}" onclick="objRevTab('all')">
          All objectives (${all.length})</button>
      </div>
      <!-- Le suivi du trimestre a sa propre page : arbitrer une demande
           et suivre l'avancement ne se font ni au même rythme ni avec le
           même regard. On laisse le renvoi, pour que la séparation ne se
           traduise pas par « où est passé le suivi ? ». -->
      <button class="or-btn is-ghost" onclick="window.renderPage('cfg-objectifs')">
        Voir le suivi des objectifs →</button>
      ${ObjRev.tab === 'all' ? objSessionPicker('renderObjReview', sessions) : ''}
      ${open ? `<button class="or-btn" onclick="objRevNewForAgent()">
        Set an objective for an agent</button>` : ''}
    </div>

    ${ObjRev.creating ? _objRevNewFormHtml() : ''}

    <!-- Recherche et filtres. Sur 36 objectifs répartis sur 10 agents,
         parcourir la liste pour retrouver un cas précis n'est plus
         praticable. La recherche porte sur l'intitulé, l'agent, les KPIs
         et les jalons — c'est-à-dire sur tout ce qui est affiché. -->
    <div class="or-filters">
      <div class="or-search">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor"
          d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14"/></svg>
        <input id="or-q" type="search" placeholder="Search an objective, an agent, a KPI…"
               value="${esc(ObjRev.q || '')}" oninput="objRevSearch(this.value)">
        <button class="or-search-x" onclick="objRevClearSearch()" aria-label="Clear"
                ${ObjRev.q ? '' : 'hidden'}>×</button>
      </div>

      <select class="or-sel" onchange="objRevFilter('fo',this.value)">
        <option value="">All agents</option>
        ${(state.config.fo_list || []).map(f =>
          `<option value="${esc(f)}" ${ObjRev.fFo === f ? 'selected' : ''}>${esc(f)}</option>`).join('')}
      </select>

      <select class="or-sel" onchange="objRevFilter('state',this.value)">
        <option value="">Any state</option>
        ${['approved', 'submitted', 'draft', 'rejected', 'lapsed'].map(s =>
          `<option value="${s}" ${ObjRev.fState === s ? 'selected' : ''}>${
            esc(OBJ_STATE_LABEL[s]?.t || s)}</option>`).join('')}
      </select>

      <select class="or-sel" onchange="objRevFilter('prog',this.value)">
        <option value="">Any progress</option>
        ${[['todo', 'To start'], ['doing', 'In progress'], ['done', 'Met'],
           ['dropped', 'Not met'], ['late', 'Overdue']].map(([v, l]) =>
          `<option value="${v}" ${ObjRev.fProg === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
      </select>

      ${(ObjRev.q || ObjRev.fFo || ObjRev.fState || ObjRev.fProg)
        ? `<button class="or-btn" onclick="objRevClearFilters()">Clear</button>` : ''}
    </div>

    <!-- La liste est rendue à part : taper dans la recherche ne doit pas
         reconstruire le champ dans lequel on tape. -->
    <div id="or-results"></div>`;

  _objRevRenderList();
}

// Rendu de la seule liste, filtres appliqués.
function _objRevRenderList() {
  const host = document.getElementById('or-results');
  if (!host || !ObjRev.data) return;
  const objectives = objTeamFilter(ObjRev.data.objectives);
  const pending = _objRevPending(objectives);
  const all = _objRevAll(objectives, ObjRev.data.sessions);
  const filtering = !!(ObjRev.q || ObjRev.fFo || ObjRev.fState || ObjRev.fProg);

  if (ObjRev.tab === 'pending') {
    const rows = pending.filter(p => _objRevMatch(p.fo, p.o));
    host.innerHTML = rows.length
      ? `${filtering ? `<div class="or-count">${rows.length} of ${pending.length}</div>` : ''}
         <div class="or-list">${rows.map(_objRevRow).join('')}</div>`
      : `<div class="gsla-card"><div class="or-none">${filtering
          ? 'No pending request matches these filters.'
          : 'Nothing is waiting on you.'}</div></div>`;
    return;
  }
  const rows = all.filter(x => _objRevMatch(x.fo, x.o));
  host.innerHTML = rows.length
    ? `${filtering ? `<div class="or-count">${rows.length} of ${all.length}</div>` : ''}
       <div class="or-list">${rows.map(x => _objRevFull(x.fo, x.o)).join('')}</div>`
    : `<div class="gsla-card"><div class="or-none">${filtering
        ? 'No objective matches these filters.'
        : objCurSessionId(ObjRev.data.sessions) === 'all' ? 'No objective recorded yet.'
        : 'No objective in this session.'}</div></div>`;
}

// « All objectives » : ceux de la session choisie (ouverte par défaut),
// comme le Suivi et le One-to-One. Sans ce filtre, Q3 et Q4 se
// mélangeaient. « Toutes les sessions » reste au bout du sélecteur.
// La file « Awaiting decision » n'est pas filtrée : une demande en
// attente doit rester visible quelle que soit la session affichée.
function _objRevAll(objectives, sessions) {
  const sid = objCurSessionId(sessions);
  return Object.entries(objectives || {})
    .flatMap(([fo, l]) => (l || []).map(o => ({ fo, o })))
    .filter(x => objInSession(x.o, sid));
}

// Une entrée de la file. Elle dit qui, quoi, et ce qui change — puis
// propose les deux seules actions possibles.
function _objRevRow(p) {
  const { fo, o, kind, kpis, steps, isNew, isEdit } = p;
  const label = { objective: 'New objective', edit: 'Wording change',
                  kpi: 'New KPI', step: 'New milestone', parts: 'Additions' }[kind];
  const sm = o.smart;
  const r = ObjRev.rejecting;
  const rej = r && r.fo === fo && r.id === o.id;

  // L'intitulé de l'objectif est toujours en tête : c'est le contexte
  // sans lequel « nouveau KPI : 14 » ne veut rien dire.
  const head = `
    <div class="or-what">${esc(o.title)}</div>
    ${isNew && o.why ? `<div class="or-why">${esc(o.why)}</div>` : ''}
    ${isNew && o.due ? `<div class="or-when">Due ${esc(o.due)}</div>` : ''}`;

  // Ce qui change, listé sous l'objectif. Chaque ligne dit sa nature.
  const changes = [];
  if (isEdit) {
    for (const [k, v] of Object.entries(o.pending || {})) {
      const name = k === 'title' ? 'Wording' : k === 'due' ? 'Due date' : 'Reason';
      changes.push(`<li><span class="or-tag">${esc(name)}</span>
        <s>${esc(o[k] || '—')}</s> → <b>${esc(v || '—')}</b></li>`);
    }
  }
  for (const k of kpis) {
    changes.push(k.pending
      ? `<li><span class="or-tag">KPI</span> ${esc(k.name)} —
         <s>${esc(_objTarget(k))}</s> → <b>${esc(k.pending.target ?? k.target ?? '')}</b></li>`
      : `<li><span class="or-tag">KPI</span> ${esc(k.name)} → <b>${esc(_objTarget(k))}</b>
         ${k.source ? `<span class="or-src">${esc(k.source)}</span>` : ''}</li>`);
  }
  for (const s of steps) {
    changes.push(s.pending
      ? `<li><span class="or-tag">Progress</span> ${esc(s.label)} →
         <b>${s.pending.done ? 'done' : 'not done'}</b></li>`
      : `<li><span class="or-tag">Milestone</span> ${esc(s.label)}
         ${s.due ? `<span class="or-src">${esc(s.due)}</span>` : ''}</li>`);
  }

  // Sur un objectif neuf, KPIs et jalons font partie du tout : on les
  // montre en appui, pas comme des décisions distinctes.
  const bundled = isNew ? `
    ${(o.kpis || []).length ? `<div class="or-sub">${(o.kpis || [])
      .map(k => `<span class="or-pill">${esc(k.name)} · <b>${esc(_objTarget(k))}</b></span>`).join('')}</div>` : ''}
    ${(o.steps || []).length ? `<div class="or-sub">${(o.steps || [])
      .map(s => `<span class="or-pill soft">${esc(s.label)}</span>`).join('')}</div>` : ''}` : '';

  // Initiales de l'agent : identifie la ligne d'un coup d'œil dans une
  // file qui mélange les personnes.
  const ini = (fo || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return `
    <div class="or-row ${rej ? 'is-rej' : ''}">
      <div class="or-top">
        <div class="or-av">${esc(ini)}</div>
        <div class="or-id">
          <div class="or-fo">${esc(fo)}</div>
          <div class="or-kindline">
            <span class="or-kind ${kind}">${esc(label)}</span>
            ${sm && isNew ? `<span class="or-smart ${sm.pass ? 'ok' : 'warn'}"
              title="${esc((sm.issues || []).join(' · '))}">SMART ${sm.score}</span>` : ''}
          </div>
        </div>
      </div>

      <div class="or-body">
        ${head}
        ${bundled}
        ${changes.length ? `<ul class="or-changes">${changes.join('')}</ul>` : ''}
        ${sm && isNew && !sm.pass && (sm.issues || []).length ? `
          <ul class="or-issues">${sm.issues.slice(0, 3).map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
      </div>

      ${_objRevAiHtml(fo, o)}
      ${rej ? `
        <div class="or-reason">
          <textarea class="form-control" id="or-reason" rows="2"
            placeholder="What should change? The agent will see this — e.g. “Target too ambitious, aim for 18 h.”"></textarea>
          <div class="or-reason-foot">
            <button class="or-btn" onclick="objRevCancelReason()">Cancel</button>
            <button class="or-btn is-send" onclick="objRevSendReason()">Send back</button>
          </div>
        </div>`
      : `<div class="or-acts">
          <button class="or-btn is-ai" onclick="objRevAiCheck('${esc(fo)}','${o.id}')"
            ${ObjRev.ai?.[fo + '|' + o.id]?.busy ? 'disabled' : ''} title="Avis de Pear AI sur cet objectif">
            ${ObjRev.ai?.[fo + '|' + o.id]?.busy ? 'Analyse…' : 'Check'}</button>
          <button class="or-btn is-rej" onclick="objRevAskReason('${esc(fo)}','${o.id}')">Ask for changes</button>
          <button class="or-btn is-ok" onclick="objRevApproveAll('${esc(fo)}','${o.id}')">
            Approve${changes.length > 1 ? ' all' : ''}</button>
        </div>`}
    </div>`;
}

// Vue « tout » : lecture d'un objectif quel que soit son état, avec le
// pilotage de l'avancement, qui n'appartient qu'à l'admin.
// Vue « tout » : une ligne de lecture, pas une demande à arbitrer. Elle
// suit donc la même carte que la file mais en plus dense — l'anneau
// d'avancement en tête, le sélecteur de statut en pied.
function _objRevFull(fo, o) {
  const st = OBJ_STATE_LABEL[o.state] || OBJ_STATE_LABEL.draft;
  const pct = o.progress_pct || 0;
  const R = 15, C = 2 * Math.PI * R;

  // Retard : seul un objectif non soldé peut l'être. Un objectif atteint
  // après sa date reste atteint, le signaler en rouge serait faux.
  const today = new Date().toLocaleDateString('sv-SE');
  const late = !!o.due && o.due < today && !['done', 'dropped'].includes(o.progress);
  const days = o.due
    ? Math.round((new Date(o.due) - new Date(today)) / 86400000) : null;
  const daysTxt = days === null || ['done', 'dropped'].includes(o.progress) ? ''
    : late ? ` · ${Math.abs(days)} d late`
    : days === 0 ? ' · today' : ` · ${days} d left`;

  const steps = o.steps || [];
  const doneSteps = steps.filter(s => s.done).length;
  const sess = (ObjRev.data?.sessions || []).find(s => s.id === o.session);

  return `
    <div class="or-row is-full ${late ? 'is-late' : ''}">
      <div class="or-top">
        <div class="or-ring ${pct >= 100 ? 'is-full' : ''}"
             title="${pct}% of approved milestones completed">
          <svg viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="${R}"/>
            <circle cx="18" cy="18" r="${R}" class="or-ring-v"
                    stroke-dasharray="${C.toFixed(1)}"
                    stroke-dashoffset="${(C - C * pct / 100).toFixed(1)}"/>
          </svg>
          <span>${pct}<i>%</i></span>
        </div>
        <div class="or-id">
          <div class="or-fo">${esc(fo)}</div>
          <div class="or-kindline">
            <span class="mo-chip ${st.c}">${esc(st.t)}</span>
            ${o.set_by_manager ? `<span class="or-kind">Set by you</span>`
              : `<span class="or-kind">Written by the agent</span>`}
            ${o.smart ? `<span class="or-smart ${o.smart.pass ? 'ok' : 'warn'}"
              title="SMART quality score out of 100">SMART ${o.smart.score}/100</span>` : ''}
          </div>
        </div>
        ${o.state === 'approved' ? `
          <label class="or-sellbl">
            <span>Status</span>
            <select class="or-sel" onchange="objRevProgress('${esc(fo)}','${o.id}',this.value)">
              ${['todo', 'doing', 'done', 'dropped'].map(p =>
                `<option value="${p}" ${o.progress === p ? 'selected' : ''}>${
                  { todo: 'To start', doing: 'In progress', done: 'Met', dropped: 'Not met' }[p]}</option>`).join('')}
            </select>
          </label>` : ''}
      </div>

      <div class="or-body or-body-last">
        <div class="or-what">${esc(o.title)}</div>
        ${o.why ? `<div class="or-why">${esc(o.why)}</div>` : ''}

        <!-- Chaque valeur porte son étiquette : un chiffre nu dans une
             pastille n'apprend rien à qui découvre la carte. -->
        <div class="or-facts">
          ${o.due ? `<span class="or-fact ${late ? 'is-late' : ''}">
            <i>${late ? 'Overdue since' : 'Deadline'}</i>${esc(o.due)}${daysTxt}</span>` : ''}
          <span class="or-fact"><i>Milestones done</i>${doneSteps} of ${steps.length || 0}</span>
          <span class="or-fact"><i>Progress</i>${pct}%</span>
          ${sess ? `<span class="or-fact"><i>Session</i>${esc(sess.name)}</span>` : ''}
        </div>

        ${(o.kpis || []).length ? `
          <div class="or-sec">
            <div class="or-sec-t">Indicators — how success is measured</div>
            <div class="or-kpis">${(o.kpis || []).map(k => `
              <div class="or-kpi">
                <span class="or-kpi-n">${esc(k.name)}</span>
                <span class="or-kpi-t">target ${esc(_objTarget(k))}</span>
                ${k.source ? `<span class="or-kpi-s">from ${esc(k.source)}</span>` : ''}
              </div>`).join('')}</div>
          </div>` : ''}

        ${steps.length ? `
          <div class="or-sec">
            <div class="or-sec-t">Milestones — ${doneSteps} of ${steps.length} completed</div>
            <div class="or-steps">${steps.map(s => `
              <div class="or-step ${s.done ? 'is-done' : ''}">
                <span class="or-step-b">${s.done ? '✓' : ''}</span>
                <span class="or-step-l">${esc(s.label)}</span>
                ${s.due ? `<span class="or-step-d">by ${esc(s.due)}</span>` : ''}
              </div>`).join('')}</div>
          </div>` : ''}

        ${o.reject_reason ? `<div class="or-lastnote">
          <i>Last feedback you sent</i>${esc(o.reject_reason)}</div>` : ''}

        <!-- Suppression : réservée à l'admin, et repliée derrière une
             confirmation qui rappelle ce qui disparaît. L'agent, lui, ne
             peut pas effacer un objectif approuvé. -->
        ${ObjRev.deleting === o.id ? `
          <div class="or-del">
            <div>
              <b>Delete this objective?</b>
              It disappears for ${esc(fo)} too, along with its KPIs, milestones and
              history. This cannot be undone — drop it instead if you only want to
              record that it was not met.
            </div>
            <div class="or-del-acts">
              <button class="or-btn" onclick="objRevCancelDelete()">Cancel</button>
              <button class="or-btn is-send" onclick="objRevDelete('${esc(fo)}','${o.id}')">Delete</button>
            </div>
          </div>`
        : `<div class="or-rowfoot">
            <button class="or-link" onclick="objRevAskDelete('${o.id}')">Delete</button>
          </div>`}
      </div>
    </div>`;
}


// ── Check : avis de l'assistant IA ────────────────────────────
// Le serveur relit l'objectif lui-même (nom de l'agent remplacé par
// « l'agent ») et rend un avis structuré. Il ne décide rien : l'avis aide
// à approuver ou à rédiger la demande de changements.
function _objRevAiHtml(fo, o) {
  const st = ObjRev.ai?.[fo + '|' + o.id];
  if (!st || st.busy) return st?.busy ? `<div class="or-ai is-busy">Pear AI relit l'objectif…</div>` : '';
  if (st.err) return `<div class="or-ai is-err">${esc(st.err)}
      <button class="or-btn is-ghost" onclick="objRevAiClose('${esc(fo)}','${o.id}')">Fermer</button></div>`;
  const d = st.data;
  const liste = (t, l) => (l && l.length) ? `<div class="or-ai-col"><div class="or-ai-st">${t}</div>
      <ul>${l.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
  if (!d) return `<div class="or-ai"><div class="or-ai-h"><b>Avis de Pear AI</b></div>
      <div class="or-ai-raw">${esc(st.content || '').replace(/\n/g, '<br>')}</div></div>`;
  const ok = d.verdict === 'approuver';
  return `<div class="or-ai">
      <div class="or-ai-h"><b>Avis de Pear AI</b>
        <span class="or-ai-v ${ok ? 'is-ok' : 'is-warn'}">${ok ? 'Peut être approuvé' : 'À revoir'}</span>
        <button class="or-ai-x" onclick="objRevAiClose('${esc(fo)}','${o.id}')" aria-label="Fermer">×</button></div>
      ${d.resume ? `<p class="or-ai-r">${esc(d.resume)}</p>` : ''}
      <div class="or-ai-cols">${liste('Points forts', d.forces)}${liste('Risques', d.risques)}</div>
      ${d.reformulation ? `<div class="or-ai-st">Reformulation proposée</div><p class="or-ai-q">${esc(d.reformulation)}</p>` : ''}
      <div class="or-ai-cols">${liste('KPI suggérés', d.kpis_suggeres)}${liste('Jalons suggérés', d.jalons_suggeres)}</div>
      ${d.impact && d.impact.explication ? `<div class="or-ai-st">Impact sur l'équipe</div>
        <p class="or-ai-imp"><span class="or-ai-n is-${esc(d.impact.niveau || 'moyen')}">${esc(d.impact.niveau || '?')}</span>
          ${esc(d.impact.explication)}${(d.impact.kpis || []).length ? ` <em>(${d.impact.kpis.map(esc).join(', ')})</em>` : ''}</p>` : ''}
      ${d.message_agent ? `<div class="or-ai-st">Message proposé pour l'agent</div>
        <p class="or-ai-q">${esc(d.message_agent)}</p>
        <button class="or-btn" onclick="objRevAiUse('${esc(fo)}','${o.id}')">Utiliser comme demande de changements</button>` : ''}
      <div class="or-ai-meta">${esc(st.meta || '')} · avis indicatif, la décision reste la tienne</div>
    </div>`;
}

async function objRevAiCheck(fo, id) {
  ObjRev.ai = ObjRev.ai || {};
  const k = fo + '|' + id;
  ObjRev.ai[k] = { busy: true };
  _objRevRenderList();
  try {
    const res = await fetch(`${API}/api/ai/objective-check`, {
      method: 'POST', credentials: 'same-origin',
      headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ fo, id }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.status === 404 && !d.error) throw new Error("Pear AI n'est pas disponible sur ce serveur.");
    if (!res.ok) throw new Error(d.error || `Erreur ${res.status}`);
    ObjRev.ai[k] = { data: d.data || null, content: d.content, meta: `${d.model} · ${(d.ms / 1000).toFixed(1)} s` };
  } catch (e) {
    const m = /tunnel|injoignable|délai/i.test(e.message) ? `${e.message} (sur ton PC : ia on)` : e.message;
    ObjRev.ai[k] = { err: `Avis indisponible : ${m}` };
  }
  _objRevRenderList();
}

function objRevAiClose(fo, id) { if (ObjRev.ai) delete ObjRev.ai[fo + '|' + id]; _objRevRenderList(); }

// Ouvre la demande de changements, pré-remplie avec le message proposé.
function objRevAiUse(fo, id) {
  const msg = ObjRev.ai?.[fo + '|' + id]?.data?.message_agent || '';
  objRevAskReason(fo, id);
  const t = document.getElementById('or-reason');
  if (t) { t.value = msg; t.focus(); }
}
