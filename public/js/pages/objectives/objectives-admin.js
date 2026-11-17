// ══════════════════════════════════════════════════════════════
// OBJECTIFS — arbitrage (page Admin)
//
// La question à laquelle cette vue répond est « qu'est-ce qui attend une
// décision de ma part ? ». Elle liste donc d'abord les dépôts en
// attente, tous agents confondus, plutôt que de faire ouvrir chaque
// profil pour les découvrir.
//
// Un refus exige un motif : c'est lui qui permet à l'agent de corriger
// au lieu de deviner. L'interface le réclame avant d'envoyer.
// ══════════════════════════════════════════════════════════════

const ObjRev = {
  data: null, busy: false, tab: 'pending', rejecting: null, creating: null,
  q: '', fFo: '', fState: '', fProg: '',   // recherche et filtres
  deleting: null,                          // objectif dont la suppression est à confirmer
  pending2import: 0,                       // objectifs du plan encore hors du flux
};

// ── Équipe affichée (SN, CI ou toutes) ────────────────────────
// Partagée par le Suivi, les approbations et les exports d'une session :
// on regarde un trimestre pour un site ou pour tous.
// L'équipe d'un agent vient de fo_trackers (premier site par défaut).
const OBJ_TEAM_KEY = 'obj-team';
function objTeam() {
  try { const t = localStorage.getItem(OBJ_TEAM_KEY); return isSiteCode(t) ? t : 'ALL'; }
  catch (_) { return 'ALL'; }
}
function objTeamOf(fo) {
  return [].concat(personSite(fo)).map(x => String(x).toUpperCase());
}
function objInTeam(fo) { const t = objTeam(); return t === 'ALL' || objTeamOf(fo).includes(t); }
function objTeamFilter(map) {
  return Object.fromEntries(Object.entries(map || {}).filter(([fo]) => objInTeam(fo)));
}
function objSetTeam(t) {
  try { localStorage.setItem(OBJ_TEAM_KEY, t); } catch (_) {}
  if (typeof renderObjReview === 'function' && ObjRev.data) renderObjReview();
  if (typeof _obtPaint === 'function' && typeof ObjTrack !== 'undefined' && ObjTrack.data) _obtPaint();
}
function objTeamSwitch() {
  const t = objTeam();
  return `<div class="obj-team" role="group" aria-label="Team">${[['ALL', 'All teams'], ...siteList().map(s => [s.code, `${s.code} · ${siteName(s.code)}`])]
    .map(([k, l]) => `<button type="button" class="${t === k ? 'is-on' : ''}" aria-pressed="${t === k}" onclick="objSetTeam('${k}')">${l}</button>`).join('')}</div>`;
}

async function _objRevApi(method, path, body) {
  const res = await fetch(`${API}/api/objectives${path}`, {
    method,
    headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
    credentials: 'same-origin',
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Action impossible');
  return data;
}

async function loadObjReview() {
  const el = document.getElementById('perf-obj-review');
  if (!el) return;
  try {
    ObjRev.data = await _objRevApi('GET', '');
    // Combien d'objectifs du plan restent hors du flux : c'est ce qui
    // déclenche la proposition de rattrapage.
    try {
      const r = await fetch(`${API}/api/objective-sessions/import-o2o/preview`, {
        headers: AdminSession.headers(), credentials: 'same-origin' });
      ObjRev.pending2import = r.ok ? (await r.json()).total || 0 : 0;
    } catch { ObjRev.pending2import = 0; }
    renderObjReview();
  } catch (e) {
    el.innerHTML = `<div class="gsla-card"><div class="gsla-card-d">${esc(e.message)}</div></div>`;
  }
}

// Reprise dans la session déjà ouverte.
function objRevImportInto(id) {
  _objRevDo(async () => {
    const res = await fetch(`${API}/api/objective-sessions/${id}/import-o2o`, {
      method: 'POST', headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
      credentials: 'same-origin', body: JSON.stringify({ by: 'admin' }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Impossible');
    toast(`${d.objectives} objectives carried over for ${d.agents} agents.`, 'success');
  });
}

// Suppression des objectifs de plan One-to-One jamais repris. Confirmation
// explicite : c'est définitif, et ces objectifs portent KPI et jalons.
function objRevDeletePending() {
  const n = ObjRev.pending2import || 0;
  if (!n) return;
  if (!confirm(`Delete the ${n} One-to-One objective${n > 1 ? 's' : ''} that were never carried over?\n\n`
    + 'Their KPI and milestones go with them. Objectives already carried over, and meetings, are kept. This cannot be undone.')) return;
  _objRevDo(async () => {
    const res = await fetch(`${API}/api/objective-sessions/import-o2o`, {
      method: 'DELETE', headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
      credentials: 'same-origin', body: JSON.stringify({ by: 'admin' }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Impossible');
    if (typeof loadConfig === 'function') await loadConfig();
    toast(`${d.objectives} One-to-One objective${d.objectives > 1 ? 's' : ''} deleted.`, 'success');
  });
}

async function _objRevDo(fn) {
  if (ObjRev.busy) return;
  ObjRev.busy = true;
  // On repasse par loadObjReview : il rafraîchit aussi le compte des
  // objectifs restant à reprendre, qui sinon resterait figé après un
  // import et proposerait de reprendre ce qui vient de l'être.
  try { await fn(); await loadObjReview(); }
  catch (e) { toast(e.message, 'error'); }
  finally { ObjRev.busy = false; }
}

// Ce qui attend une décision : un objectif déposé, ou un élément déposé
// sur un objectif déjà approuvé. Les deux se traitent au même endroit.
// Un objectif = une entrée dans la file, quel que soit le nombre de
// choses qui y attendent. Lister séparément l'objectif, chacun de ses
// KPIs et chacun de ses jalons donnait trois cartes pour une seule
// soumission, sans dire qu'elles parlaient de la même chose — et
// obligeait à trois décisions là où une seule a du sens.
//
// Les éléments en attente sont donc rassemblés sous leur objectif, et
// la décision s'applique à l'ensemble. Le cas « un KPI ajouté seul sur
// un objectif déjà approuvé » reste distingué : l'objectif n'est pas
// remis en cause, seule la pièce ajoutée l'est.
function _objRevPending(list) {
  const out = [];
  for (const [fo, objs] of Object.entries(list || {})) {
    for (const o of objs || []) {
      const kpis  = (o.kpis  || []).filter(k => k.state === 'submitted' || k.pending);
      const steps = (o.steps || []).filter(s => s.state === 'submitted' || s.pending);
      const isNew  = o.state === 'submitted';
      const isEdit = !!o.pending;
      if (!isNew && !isEdit && !kpis.length && !steps.length) continue;
      out.push({
        fo, o, kpis, steps, isNew, isEdit,
        // Ce que la carte demande d'arbitrer, en un mot.
        kind: isNew ? 'objective' : isEdit ? 'edit' : (kpis.length && !steps.length) ? 'kpi'
            : (steps.length && !kpis.length) ? 'step' : 'parts',
      });
    }
  }
  return out;
}

// Le changement d'onglet met à jour les compteurs de la barre, donc il
// redessine tout — mais on n'est alors pas en train de taper.
function objRevTab(t) { ObjRev.tab = t; renderObjReview(); }

// Recherche. Le champ vit dans la zone que renderObjReview() réécrit :
// le redessiner à chaque frappe détruisait l'input en cours de saisie,
// et rendre le focus après coup ne suffisait pas — la frappe suivante
// partait dans un élément déjà remplacé.
//
// On ne réécrit donc que la liste, en laissant la barre de filtres
// intacte. Le champ n'est jamais recréé pendant qu'on y tape.
function objRevSearch(v) {
  ObjRev.q = v;
  _objRevRenderList();
  const x = document.querySelector('.or-search-x');
  if (x) x.hidden = !v;
}
// Effacer depuis la croix : le champ existe déjà, on le vide sur place
// plutôt que de le reconstruire.
function objRevClearSearch() {
  const el = document.getElementById('or-q');
  if (el) { el.value = ''; el.focus(); }
  objRevSearch('');
}

// Les listes déroulantes ne sont pas en cours de saisie : les
// redessiner ne gêne pas, et il faut le faire pour que la sélection
// reste affichée après un « Clear ».
function objRevFilter(which, v) {
  ObjRev[{ fo: 'fFo', state: 'fState', prog: 'fProg' }[which]] = v;
  _objRevRenderList();
}
function objRevClearFilters() {
  ObjRev.q = ''; ObjRev.fFo = ''; ObjRev.fState = ''; ObjRev.fProg = '';
  renderObjReview();
}

// La recherche porte sur tout ce que la carte affiche — intitulé, agent,
// raison, KPIs, jalons. Chercher « ITIL » doit trouver l'objectif dont
// seul un jalon mentionne ITIL, sinon le champ ment sur son périmètre.
function _objRevHay(fo, o) {
  return [
    fo, o.title, o.why,
    ...(o.kpis  || []).flatMap(k => [k.name, k.target, k.source]),
    ...(o.steps || []).map(s => s.label),
  ].filter(Boolean).join(' ').toLowerCase();
}

function _objRevMatch(fo, o) {
  const q = (ObjRev.q || '').trim().toLowerCase();
  if (q && !_objRevHay(fo, o).includes(q)) return false;
  if (ObjRev.fFo    && fo !== ObjRev.fFo) return false;
  if (ObjRev.fState && o.state !== ObjRev.fState) return false;
  if (ObjRev.fProg) {
    const today = new Date().toLocaleDateString('sv-SE');
    if (ObjRev.fProg === 'late') {
      if (!(o.due && o.due < today && !['done', 'dropped'].includes(o.progress))) return false;
    } else if (o.progress !== ObjRev.fProg) return false;
  }
  return true;
}

// Décision. Le motif est demandé ici plutôt que côté serveur seulement :
// l'admin doit le voir exigé au moment où il refuse, pas le découvrir
// dans un message d'erreur.
// Refuser demande un motif : on ouvre donc une zone de saisie sous la
// ligne concernée plutôt qu'une boîte du navigateur. L'admin voit ce
// qu'il refuse pendant qu'il écrit pourquoi.
function objRevAskReason(fo, id) {
  ObjRev.rejecting = { fo, id };
  renderObjReview();
  document.getElementById('or-reason')?.focus();
}
function objRevCancelReason() { ObjRev.rejecting = null; renderObjReview(); }

function objRevSendReason() {
  const r = ObjRev.rejecting;
  if (!r) return;
  const note = document.getElementById('or-reason')?.value.trim() || '';
  if (!note) return toast('A reason is required — the agent needs to know what to change.', 'error');
  ObjRev.rejecting = null;
  _objRevBatch(r.fo, r.id, 'reject', note);
}

function objRevApproveAll(fo, id) { _objRevBatch(fo, id, 'approve', ''); }

// Une décision porte sur tout ce qui attend sur l'objectif. Les
// sous-éléments passent en premier : approuver l'objectif approuve déjà
// ce qui est déposé avec lui, donc les traiter après ne trouverait plus
// rien à faire — et sur un refus, l'ordre inverse laisserait des pièces
// en attente sur un objectif redevenu brouillon.
async function _objRevBatch(fo, id, decision, note) {
  const entry = _objRevPending(ObjRev.data?.objectives).find(p => p.fo === fo && p.o.id === id);
  if (!entry) return;
  const by = (state.config && state.config._admin_name) || 'admin';
  const enc = encodeURIComponent(fo);

  await _objRevDo(async () => {
    for (const k of entry.kpis)
      await _objRevApi('POST', `/${enc}/${id}/kpis/${k.id}/decide`, { decision, note, by });
    for (const s of entry.steps)
      await _objRevApi('POST', `/${enc}/${id}/steps/${s.id}/decide`, { decision, note, by });
    // L'objectif lui-même n'est arbitré que s'il est en jeu : une pièce
    // ajoutée sur un objectif déjà approuvé ne doit pas le remettre en
    // cause, et un refus ne doit pas le renvoyer en brouillon.
    if (entry.isNew || entry.isEdit)
      await _objRevApi('POST', `/${enc}/${id}/decide`, { decision, note, by });
    toast(decision === 'approve' ? 'Approved.' : 'Sent back to the agent.', 'success');
  });
}

// Objectif posé par l'admin : décidé en entretien, il n'a pas à
// attendre que l'agent le ressaisisse puis à repasser par une
// approbation que l'admin se donnerait à lui-même.
function objRevNewForAgent() { ObjRev.creating = { fo: '' }; renderObjReview(); }
function objRevCancelNew()   { ObjRev.creating = null; renderObjReview(); }

function _objRevNewFormHtml() {
  const list = (state.config.fo_list || []);
  return `
    <div class="or-newform">
      <div class="or-newform-t">Set an objective for an agent</div>
      <div class="or-newform-d">
        You are writing it, so it comes in already approved. The agent sees it
        straight away and can propose changes, which come back here.
      </div>

      <label class="mo-lbl">Agent</label>
      <select class="form-control" id="orn-fo">
        <option value="">Choose an agent…</option>
        ${list.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('')}
      </select>

      <label class="mo-lbl">Objective</label>
      <input class="form-control" id="orn-title"
             placeholder="e.g. Reduce P2 MTTR from 24 h to 18 h">

      <label class="mo-lbl">Why it matters</label>
      <textarea class="form-control" id="orn-why" rows="2"
                placeholder="What it changes for the team this quarter."></textarea>

      <div class="or-newform-row">
        <div>
          <label class="mo-lbl">Due date</label>
          <input class="form-control" id="orn-due" type="date">
        </div>
        <div>
          <label class="mo-lbl">KPI — what is measured</label>
          <input class="form-control" id="orn-kpi" placeholder="e.g. P2 MTTR">
        </div>
        <div>
          <label class="mo-lbl">Target</label>
          <input class="form-control" id="orn-target" placeholder="e.g. 18 h">
        </div>
      </div>

      <div class="or-newform-foot">
        <button class="or-btn" onclick="objRevCancelNew()">Cancel</button>
        <button class="or-btn is-ok" onclick="objRevSaveNew()">Add the objective</button>
      </div>
    </div>`;
}

function objRevSaveNew() {
  const g = i => document.getElementById(i)?.value.trim() || '';
  const fo = g('orn-fo'), title = g('orn-title');
  if (!fo)    return toast('Choose an agent.', 'error');
  if (!title) return toast('A title is required.', 'error');
  const kpi = g('orn-kpi');
  _objRevDo(async () => {
    await _objRevApi('POST', `/${encodeURIComponent(fo)}`, {
      title, why: g('orn-why'), due: g('orn-due'), by: 'admin',
      kpis: kpi ? [{ name: kpi, target: g('orn-target') }] : [],
    });
    ObjRev.creating = null;
    toast(`Objective added for ${fo}.`, 'success');
  });
}

// Suppression. La confirmation est en place plutôt qu'en boîte de
// dialogue : elle rappelle que l'objectif disparaît aussi chez l'agent,
// et propose l'alternative — « non atteint » garde la trace.
function objRevAskDelete(id) { ObjRev.deleting = id; _objRevRenderList(); }
function objRevCancelDelete() { ObjRev.deleting = null; _objRevRenderList(); }

function objRevDelete(fo, id) {
  ObjRev.deleting = null;
  _objRevDo(async () => {
    await _objRevApi('DELETE', `/${encodeURIComponent(fo)}/${id}`);
    toast('Objective deleted.', 'success');
  });
}

function objRevProgress(fo, id, progress) {
  _objRevDo(async () => {
    await _objRevApi('PUT', `/${encodeURIComponent(fo)}/${id}/progress`, { progress });
    toast('Status updated.', 'success');
  });
}

// ── Sessions ──────────────────────────────────────────────────

// Ouverture d'une session. Deux chemins depuis le même écran : partir
// d'une liste vide, ou reprendre les objectifs déjà posés en entretien.
// Le second est le cas courant tant que le plan trimestriel vit dans
// One-to-One — d'où l'aperçu du nombre d'objectifs concernés.
async function objRevOpenSession() {
  let pv = { total: 0, agents: 0, skipped: 0 };
  try {
    const r = await fetch(`${API}/api/objective-sessions/import-o2o/preview`, {
      headers: AdminSession.headers(), credentials: 'same-origin' });
    if (r.ok) pv = await r.json();
  } catch (_) {}

  // Trimestre courant proposé par défaut : c'est la borne la plus
  // probable, et elle reste modifiable.
  const now = new Date();
  const q  = Math.floor(now.getMonth() / 3);
  const s  = new Date(now.getFullYear(), q * 3, 1);
  const e  = new Date(now.getFullYear(), q * 3 + 3, 0);
  const iso = d => d.toLocaleDateString('sv-SE');

  const body = document.getElementById('obj-session-body');
  if (!body) return;
  body.innerHTML = `
    <p class="or-modal-d">
      A session is the window agents write their objectives for. While it is
      open they can add and revise; closing it settles the quarter.
    </p>

    <label class="mo-lbl">Name</label>
    <input class="form-control" id="ors-name" value="Q${q + 1} ${now.getFullYear()}"
           placeholder="e.g. Q4 2026">

    <div class="or-modal-dates">
      <div>
        <label class="mo-lbl">From</label>
        <input class="form-control" id="ors-start" type="date" value="${iso(s)}">
      </div>
      <div>
        <label class="mo-lbl">To</label>
        <input class="form-control" id="ors-end" type="date" value="${iso(e)}">
      </div>
    </div>

    ${pv.total ? `
      <label class="or-modal-imp">
        <input type="checkbox" id="ors-import" checked>
        <span>
          <b>Carry over the ${pv.total} objective${pv.total > 1 ? 's' : ''} already
          in One-to-One</b> (${pv.agents} agent${pv.agents > 1 ? 's' : ''}).
          They come in already approved, with their KPI and milestones — agents
          see them straight away instead of retyping them.
          ${pv.skipped ? `<i>${pv.skipped} already carried over, they will be skipped.</i>` : ''}
        </span>
      </label>`
    : `<div class="or-modal-none">No objective to carry over from One-to-One.</div>`}

    <div class="or-modal-foot">
      <button class="btn btn-ghost btn-sm" onclick="closeModal('obj-session-modal')">Cancel</button>
      <button class="btn btn-primary btn-sm" onclick="objRevOpenSessionGo()">Open the session</button>
    </div>`;
  document.getElementById('obj-session-modal')?.classList.add('open');
}

function objRevOpenSessionGo() {
  const name  = document.getElementById('ors-name')?.value.trim();
  const start = document.getElementById('ors-start')?.value;
  const end   = document.getElementById('ors-end')?.value;
  const imp   = !!document.getElementById('ors-import')?.checked;
  if (!name)          return toast('A name is required.', 'error');
  if (!start || !end) return toast('Both dates are required.', 'error');
  if (end < start)    return toast('The end date falls before the start date.', 'error');

  closeModal();
  _objRevDo(async () => {
    const url = imp ? '/api/objective-sessions/import-o2o' : '/api/objective-sessions';
    const res = await fetch(`${API}${url}`, {
      method: 'POST', headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
      credentials: 'same-origin', body: JSON.stringify({ name, start, end, by: 'admin' }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Impossible');
    toast(imp
      ? `Session opened — ${d.objectives} objectives carried over for ${d.agents} agents.`
      : 'Session opened — agents can now write their objectives.', 'success');
  });
}

