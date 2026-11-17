// ══════════════════════════════════════════════════════════════
// MES OBJECTIFS — côté agent
//
// L'agent écrit ses objectifs, l'admin les approuve. Toute la difficulté
// d'affichage tient dans une idée : ce qui est en attente d'approbation
// doit être visible sans jamais être confondu avec ce qui est acquis.
// D'où, partout, la même règle de rendu — la valeur en vigueur en
// pleine lecture, la proposition en dessous et signalée comme telle.
// ══════════════════════════════════════════════════════════════

// État local. `form` porte l'objectif en cours de saisie, y compris ses
// KPIs et ses jalons, pour que le contrôle SMART puisse le noter avant
// même qu'il existe côté serveur.
const MyObj = {
  data: null,
  open: null,          // id de l'objectif déplié
  form: null,          // brouillon en cours de saisie
  smart: null,         // dernier verdict SMART du formulaire
  adding: null,        // { id, kind } — ajout de KPI ou de jalon déplié
  busy: false,
};

const OBJ_STATE_LABEL = {
  draft:     { t: 'Draft',           c: 'draft' },
  submitted: { t: 'Awaiting review', c: 'wait'  },
  approved:  { t: 'Approved',        c: 'ok'    },
  rejected:  { t: 'Changes needed',  c: 'ko'    },
  lapsed:    { t: 'Not carried over',c: 'off'   },
};

const OBJ_SMART_AXES = [
  ['specific',   'Specific',    'Says what will actually be done.'],
  ['measurable', 'Measurable',  'Carries a figure you can check.'],
  ['achievable', 'Achievable',  'The target is realistic.'],
  ['relevant',   'Relevant',    'Tied to your role this quarter.'],
  ['timebound',  'Time-bound',  'Has a deadline inside the session.'],
];

async function _objApi(method, path, body) {
  const res = await fetch(`${API}/api/my-objectives${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-FO-Token': MyPerf.token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { MyPerf.clear(); _myPerfShowLogin(); throw new Error('Session expired.'); }
  if (!res.ok) throw new Error(data.error || 'Action impossible');
  return data;
}

async function loadMyObjectives() {
  const host = document.getElementById('myobj-host');
  if (!host) return;
  try {
    MyObj.data = await _objApi('GET', '');
    renderMyObjectives();
  } catch (e) {
    host.innerHTML = `<div class="myperf-sec"><div class="myperf-sec-d">${esc(e.message)}</div></div>`;
  }
}

// Enveloppe commune aux gestes : évite le double-clic, remonte l'erreur
// et recharge. Sans elle, chaque appel répéterait les cinq mêmes lignes.
async function _objDo(fn) {
  if (MyObj.busy) return;
  MyObj.busy = true;
  try { await fn(); MyObj.data = await _objApi('GET', ''); renderMyObjectives(); }
  catch (e) { toast(e.message, 'error'); }
  finally { MyObj.busy = false; }
}

// ── Formulaire ────────────────────────────────────────────────

function myObjNew() {
  MyObj.form = { id: null, title: '', why: '', due: '', kpis: [], steps: [] };
  MyObj.smart = null;
  renderMyObjectives();
  _objSmartCheck();
}

function myObjEditForm(id) {
  const o = (MyObj.data?.objectives || []).find(x => x.id === id);
  if (!o) return;
  // On édite la valeur proposée si elle existe : c'est celle que l'agent
  // vient d'écrire, la reprendre évite de lui faire retaper sa correction.
  MyObj.form = {
    id: o.id,
    title: o.pending?.title ?? o.title,
    why:   o.pending?.why   ?? o.why,
    due:   o.pending?.due   ?? o.due,
    // KPIs et jalons se gèrent par leurs propres boutons une fois
    // l'objectif créé : le formulaire ne porte que le tronc commun.
    kpis: [], steps: [], existing: true,
  };
  MyObj.smart = null;
  renderMyObjectives();
  _objSmartCheck();
}

function myObjCancelForm() { MyObj.form = null; MyObj.smart = null; renderMyObjectives(); }

function _objFormRead() {
  const g = id => document.getElementById(id)?.value ?? '';
  if (!MyObj.form) return;
  MyObj.form.title = g('myobj-title');
  MyObj.form.why   = g('myobj-why');
  MyObj.form.due   = g('myobj-due');
}

// Contrôle SMART en direct. Il est indicatif : il éclaire la saisie, il
// n'interdit rien. Le débounce évite un appel par frappe.
let _objSmartT = null;
function _objSmartDebounced() {
  clearTimeout(_objSmartT);
  _objSmartT = setTimeout(_objSmartCheck, 400);
}

async function _objSmartCheck() {
  if (!MyObj.form) return;
  _objFormRead();
  try {
    const f = MyObj.form;
    // Sur un objectif existant, les KPIs et jalons déjà posés comptent
    // dans la note : les ignorer afficherait « aucun KPI » à tort.
    const cur = f.id ? (MyObj.data?.objectives || []).find(x => x.id === f.id) : null;
    MyObj.smart = await _objApi('POST', '/smart-check', {
      title: f.title, why: f.why, due: f.due,
      kpis:  f.id ? (cur?.kpis  || []) : f.kpis,
      steps: f.id ? (cur?.steps || []) : f.steps,
    });
  } catch { MyObj.smart = null; }
  _objRenderSmart();
}

// Seul le panneau SMART se redessine : refaire tout le formulaire à
// chaque frappe ferait perdre le curseur dans le champ en cours.
function _objRenderSmart() {
  const el = document.getElementById('myobj-smart');
  if (el) el.innerHTML = _objSmartHtml(MyObj.smart);
}

function _objSmartHtml(r) {
  if (!r) return '';
  const cls = r.pass ? 'ok' : (r.score >= 50 ? 'warn' : 'ko');

  // Cinq pastilles au lieu de cinq jauges : sur 20 points chacune, la
  // barre n'ajoutait rien au chiffre et faisait un tableau de bord de
  // débogage au milieu d'un formulaire.
  const axes = OBJ_SMART_AXES.map(([k, label, hint]) => {
    const p = r.parts?.[k] || { score: 0, max: 20, issues: [] };
    const lv = p.score >= p.max * .9 ? 'is-ok' : p.score >= p.max * .5 ? 'is-mid' : 'is-low';
    return `<span class="mo-ax ${lv}" title="${esc(hint)}">${esc(label)}</span>`;
  }).join('');

  // Anneau de score : même langage visuel que la progression des
  // objectifs, plutôt qu'un nombre posé dans un coin.
  const R = 20, C = 2 * Math.PI * R;
  const issues = (r.issues || []).slice(0, 5);

  return `
    <div class="mo-smart ${cls}">
      <div class="mo-smart-h">
        <div class="mo-smart-ring">
          <svg viewBox="0 0 48 48">
            <circle cx="24" cy="24" r="${R}"/>
            <circle cx="24" cy="24" r="${R}" class="mo-smart-arc"
                    stroke-dasharray="${C.toFixed(1)}"
                    stroke-dashoffset="${(C - C * r.score / 100).toFixed(1)}"/>
          </svg>
          <span>${r.score}</span>
        </div>
        <div class="mo-smart-txt">
          <div class="mo-smart-t">${r.pass ? 'This objective looks solid' : 'This could be sharper'}</div>
          <div class="mo-smart-d">Guidance only — you can submit either way, and
            your manager makes the final call.</div>
        </div>
      </div>
      <div class="mo-axes">${axes}</div>
      ${issues.length ? `<ul class="mo-fix">${issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
    </div>`;
}

// Ajout d'un KPI ou d'un jalon dans le formulaire de création. Sur un
// objectif déjà créé, ils passent par l'API (donc par l'admin).
function myObjFormAddKpi() {
  if (!MyObj.form) return;
  _objFormRead();
  MyObj.form.kpis.push({ id: 'tmp' + Math.random().toString(36).slice(2, 7), name: '', target: '', unit: '', source: '' });
  renderMyObjectives(); _objSmartCheck();
}
function myObjFormDelKpi(i) {
  _objFormRead(); MyObj.form.kpis.splice(i, 1); renderMyObjectives(); _objSmartCheck();
}
function myObjFormKpi(i, field, v) {
  if (!MyObj.form?.kpis[i]) return;
  MyObj.form.kpis[i][field] = v; _objSmartDebounced();
}
function myObjFormAddStep() {
  if (!MyObj.form) return;
  _objFormRead();
  MyObj.form.steps.push({ id: 'tmp' + Math.random().toString(36).slice(2, 7), label: '', due: '' });
  renderMyObjectives(); _objSmartCheck();
}
function myObjFormDelStep(i) {
  _objFormRead(); MyObj.form.steps.splice(i, 1); renderMyObjectives(); _objSmartCheck();
}
function myObjFormStep(i, field, v) {
  if (!MyObj.form?.steps[i]) return;
  MyObj.form.steps[i][field] = v; _objSmartDebounced();
}

async function myObjSave(alsoSubmit) {
  _objFormRead();
  const f = MyObj.form;
  if (!f) return;
  if (!f.title.trim()) return toast('A title is required.', 'error');
  // Règle : pas de jalon sans date limite (le serveur refuse aussi).
  const sansDate = f.steps.filter(s => s.label.trim() && !s.due);
  if (sansDate.length) {
    MyObj.form.showMissing = true; renderMyObjectives();
    return toast(`Every milestone needs a deadline — missing for “${sansDate[0].label.trim()}”.`, 'error');
  }

  await _objDo(async () => {
    let id = f.id;
    if (id) {
      await _objApi('PUT', `/${id}`, { title: f.title, why: f.why, due: f.due });
    } else {
      const created = await _objApi('POST', '', {
        title: f.title, why: f.why, due: f.due,
        kpis:  f.kpis.filter(k => k.name.trim()).map(({ id, ...k }) => k),
        steps: f.steps.filter(s => s.label.trim()).map(({ id, ...s }) => s),
      });
      id = created.id;
    }
    if (alsoSubmit) await _objApi('POST', `/${id}/submit`);
    MyObj.form = null; MyObj.smart = null;
    MyObj.open = id;
    toast(alsoSubmit ? 'Sent to your manager.' : 'Draft saved.', 'success');
  });
}

// ── Gestes sur un objectif existant ───────────────────────────

// Ouverts par défaut : l'agent voit KPI et jalons sans cliquer. On retient
// ceux qu'il a repliés, pas ceux qu'il a ouverts.
function myObjToggle(id) {
  MyObj.closed = MyObj.closed || new Set();
  MyObj.closed.has(id) ? MyObj.closed.delete(id) : MyObj.closed.add(id);
  MyObj.open = null;
  renderMyObjectives();
}

function myObjSubmit(id)  { _objDo(async () => { await _objApi('POST', `/${id}/submit`); toast('Sent to your manager.', 'success'); }); }
function myObjDelete(id)  {
  if (!confirm('Delete this objective? This cannot be undone.')) return;
  _objDo(async () => { await _objApi('DELETE', `/${id}`); toast('Deleted.', 'success'); });
}

// Cocher un jalon dont l'échéance est passée : on demande d'abord quand il
// a été fait. Un agent coche souvent après coup ; sans cette date, un jalon
// tenu à temps mais coché le lendemain de l'échéance passait en retard.
function myObjCheckStep(id, sid, done) {
  const o = ((MyObj.data && MyObj.data.objectives) || []).find(x => x.id === id);
  const st = o && (o.steps || []).find(x => x.id === sid);
  if (done && st && st.due && st.due < _o2oToday()) {
    MyObj.ticking = { id, sid };
    renderMyObjectives();
    setTimeout(() => document.getElementById('mo-done-date')?.focus(), 30);
    return;
  }
  _objSendCheck(id, sid, done);
}
function myObjTickCancel() { MyObj.ticking = null; renderMyObjectives(); }
function myObjTickConfirm() {
  const t = MyObj.ticking; if (!t) return;
  const v = document.getElementById('mo-done-date')?.value || '';
  if (!v || v > _o2oToday()) { toast('Pick the day it was done (not in the future).', 'error'); return; }
  MyObj.ticking = null;
  _objSendCheck(t.id, t.sid, true, v);
}
function _objSendCheck(id, sid, done, doneAt) {
  _objDo(async () => {
    const o = await _objApi('POST', `/${id}/steps/${sid}/check`, doneAt ? { done, done_at: doneAt } : { done });
    const s = (o.steps || []).find(x => x.id === sid);
    // Le message dit ce qui vient réellement de se passer : sur un jalon
    // approuvé, cocher ne coche pas — cela dépose une demande.
    toast(s?.pending ? 'Sent to your manager for approval.' : 'Updated.', 'success');
  });
}

// Ajout d'un KPI ou d'un jalon : un formulaire déplié sous la section,
// pas une file de boîtes de dialogue du navigateur. Trois `prompt()`
// enchaînés ne montraient jamais les trois champs ensemble et se
// perdaient au premier Échap.
function myObjAddKpi(id)  { MyObj.adding = { id, kind: 'kpis'  }; renderMyObjectives(); }
function myObjAddStep(id) { MyObj.adding = { id, kind: 'steps' }; renderMyObjectives(); }
function myObjCancelAdd() { MyObj.adding = null; renderMyObjectives(); }

function myObjSaveAdd() {
  const a = MyObj.adding;
  if (!a) return;
  const g = i => document.getElementById(i)?.value.trim() || '';
  if (a.kind === 'kpis') {
    const name = g('moa-name');
    if (!name) return toast('Say what is being measured.', 'error');
    const body = { name, target: g('moa-target'), unit: g('moa-unit'), source: g('moa-source') };
    _objDo(async () => {
      await _objApi('POST', `/${a.id}/kpis`, body);
      MyObj.adding = null;
      toast('KPI added — awaiting approval.', 'success');
    });
  } else {
    const label = g('moa-label');
    if (!label) return toast('The milestone needs a wording.', 'error');
    if (!g('moa-due')) {
      document.getElementById('moa-due')?.classList.add('is-missing');
      return toast('The milestone needs a deadline.', 'error');
    }
    _objDo(async () => {
      await _objApi('POST', `/${a.id}/steps`, { label, due: g('moa-due') });
      MyObj.adding = null;
      toast('Milestone added — awaiting approval.', 'success');
    });
  }
}

function _objAddFormHtml(kind) {
  return kind === 'kpis' ? `
    <div class="mo-addform">
      <div class="mo-hint">One thing measured and the number to hit — the figure
        that will say, at the end of the quarter, whether the objective was met.</div>
      <div class="mo-addgrid">
        <input class="form-control" id="moa-name"   placeholder="What is measured (e.g. P2 MTTR)">
        <input class="form-control" id="moa-target" placeholder="Target (e.g. 16 h, 95 %)">
        <input class="form-control" id="moa-unit"   placeholder="Unit (optional)">
        <input class="form-control" id="moa-source" placeholder="Source (e.g. ServiceNow)">
      </div>
      <div class="mo-addfoot">
        <button class="btn btn-ghost btn-sm" onclick="myObjCancelAdd()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="myObjSaveAdd()">Add the KPI</button>
      </div>
    </div>`
  : `
    <div class="mo-addform">
      <div class="mo-hint">A step you can tick off before the deadline, with the
        date you expect to reach it.</div>
      <div class="mo-addgrid two">
        <input class="form-control" id="moa-label" placeholder="Milestone (e.g. Analysis of the last 10 P2s)">
        <input class="form-control" id="moa-due" type="date" required aria-required="true"
               aria-label="Deadline (required)" title="Deadline — required"
               oninput="this.classList.remove('is-missing')">
      </div>
      <div class="mo-addfoot">
        <button class="btn btn-ghost btn-sm" onclick="myObjCancelAdd()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="myObjSaveAdd()">Add the milestone</button>
      </div>
    </div>`;
}

function myObjDelSub(id, kind, sid) {
  _objDo(async () => { await _objApi('DELETE', `/${id}/${kind}/${sid}`); toast('Removed.', 'success'); });
}

// ── Rendu ─────────────────────────────────────────────────────

function renderMyObjectives() {
  const host = document.getElementById('myobj-host');
  if (!host || !MyObj.data) return;
  const d = MyObj.data;
  const sess = d.session;
  // Navigation par session : la session ouverte par défaut (sinon la plus
  // récente), les précédentes en un clic. Avant, les objectifs encore
  // ouverts d'un trimestre clos restaient mêlés à ceux du trimestre en
  // cours, et les autres partaient en vrac dans « Previous quarters ».
  // Ne sont proposées que les sessions où l'agent a des objectifs, plus
  // la session ouverte — une session vide d'il y a un an n'apprend rien.
  const objs = d.objectives || [];
  const sessions = (d.sessions || []).filter(x =>
    x.state === 'open' || objs.some(o => o.session === x.id));
  const sid = objCurSessionId(sessions, 'me');
  const shown = sessions.find(x => x.id === sid) || null;
  // La session ouverte récupère les objectifs sans session (repris d'une
  // ancienne version) : c'est là qu'ils se travaillent.
  const list = objs.filter(o => sid === 'all' || o.session === sid
    || (sess && sid === sess.id && !sessions.some(x => x.id === o.session)));
  // On n'écrit que dans la session ouverte : une session close se relit.
  const editable = !!sess && sid === sess.id;

  host.innerHTML = `
    <div class="myperf-sec mo-wrap">
      <div class="myperf-sec-h">
        <div class="myperf-sec-t">My objectives</div>
        ${objSessionPicker('renderMyObjectives', sessions, 'me')}
      </div>
      ${shown ? `<div class="mo-sess">
        <span class="mo-sess-dot"${shown.state === 'open' ? '' : ' style="opacity:.35"'}></span>${esc(shown.name)}
        <span class="mo-sess-d">${esc(shown.start)} → ${esc(shown.end)}${
          shown.state === 'open' ? '' : ' · closed'}</span>
      </div>` : ''}
      <div class="myperf-sec-d">
        ${editable || !sess
          ? `You write them, your manager approves them. Any change to a wording,
             a KPI or a milestone takes effect once it is approved.`
          : `A past session, kept for reading. Go back to ${esc(sess.name)} to
             write or update your objectives.`}
      </div>

      ${!sess ? `<div class="mo-empty">
        <b>No session is open just yet.</b>
        Objectives are set one quarter at a time. Your manager opens the next
        session when the period starts, and you can write yours from then on.
      </div>` : ''}

      <!-- Le formulaire de création s'ouvre en tête de liste ; celui
           d'édition prend la place de la carte concernée (voir plus bas).
           Afficher les deux aurait montré deux fois le même objectif. -->
      ${editable && MyObj.form && !MyObj.form.id ? _objFormHtml() : ''}

      ${editable && !MyObj.form && !list.length ? `<div class="mo-empty">
        <b>Your ${esc(sess.name)} is a blank page.</b>
        Start with the two or three objectives that will define your quarter —
        you can refine the wording later, nothing is final until you send it.
      </div>` : ''}
      ${!editable && sid !== 'all' && shown && !list.length ? `<div class="mo-empty">
        No objective in ${esc(shown.name)}.</div>` : ''}

      ${list.length ? `<div class="mo-list">${list.map(o =>
        // L'objectif en cours d'édition cède sa place au formulaire : la
        // carte et le formulaire côte à côte donnaient le même objectif
        // écrit deux fois, l'un modifiable et l'autre non.
        MyObj.form && MyObj.form.id === o.id ? _objFormHtml() : _objCardHtml(o)
      ).join('')}</div>` : ''}

      ${editable && !MyObj.form ? `<button class="btn btn-primary btn-sm mo-add" onclick="myObjNew()">
        Add an objective</button>` : ''}
    </div>`;
}

function _objFormHtml() {
  const f = MyObj.form;
  const kpis = f.kpis.map((k, i) => `
    <div class="mo-krow">
      <input class="form-control" placeholder="What is measured" value="${esc(k.name)}"
             oninput="myObjFormKpi(${i},'name',this.value)">
      <input class="form-control" placeholder="Target (e.g. 16 h)" value="${esc(k.target)}"
             oninput="myObjFormKpi(${i},'target',this.value)">
      <input class="form-control" placeholder="Source" value="${esc(k.source)}"
             oninput="myObjFormKpi(${i},'source',this.value)">
      <button class="mo-x" onclick="myObjFormDelKpi(${i})" title="Remove">×</button>
    </div>`).join('');

  const steps = f.steps.map((s, i) => `
    <div class="mo-srow">
      <input class="form-control" placeholder="Milestone" value="${esc(s.label)}"
             oninput="myObjFormStep(${i},'label',this.value)">
      <input class="form-control${f.showMissing && s.label.trim() && !s.due ? ' is-missing' : ''}"
             type="date" value="${esc(s.due)}" required aria-required="true"
             aria-label="Deadline (required)" title="Deadline — required"
             oninput="myObjFormStep(${i},'due',this.value);this.classList.remove('is-missing')">
      <button class="mo-x" onclick="myObjFormDelStep(${i})" title="Remove">×</button>
    </div>`).join('');

  // À l'édition, le formulaire occupe la place de la carte : il doit donc
  // rappeler de quel objectif il s'agit et ce qui est en vigueur, sinon
  // on perd la référence en modifiant l'intitulé.
  const cur = f.id ? (MyObj.data?.objectives || []).find(x => x.id === f.id) : null;

  // En-tête et corps sont deux surfaces distinctes : l'en-tête dit sur
  // quoi on travaille et sous quelle règle, le corps est la saisie. Tout
  // à plat, le rappel de l'intitulé se lisait comme un premier champ.
  return `
    <div class="mo-form">
      <div class="mo-form-h">
        <div class="mo-form-t">${f.id ? 'Edit the objective' : 'New objective'}</div>
        ${cur ? `<div class="mo-form-cur">
          <span>Currently in force</span>${esc(cur.title)}
        </div>` : ''}
        ${f.id ? `<div class="mo-form-note">${cur?.state === 'approved'
          ? `This objective is already approved — your changes go to your manager,
             and the wording above stays in force until they are accepted.`
          : `This objective has not been approved yet, so your changes apply
             straight away.`}</div>` : ''}
      </div>

      <div class="mo-form-b">
      <label class="mo-lbl">Objective</label>
      <div class="mo-hint">One sentence saying what you will do, starting with an
        action verb, and carrying the figure you are aiming at. Written well, it
        already contains its own KPI.</div>
      <input class="form-control" id="myobj-title" value="${esc(f.title)}"
             placeholder="e.g. “Reduce P2 MTTR from 24 h to 18 h”"
             oninput="_objSmartDebounced()">

      <label class="mo-lbl">Why it matters</label>
      <div class="mo-hint">The reason this is worth doing this quarter — what it
        changes for the team or for the client. It is what your manager reads to
        judge the objective, not just the wording above.</div>
      <textarea class="form-control" id="myobj-why" rows="2"
                placeholder="e.g. “Every hour of P2 downtime costs the branch a full morning of counter service.”"
                oninput="_objSmartDebounced()">${esc(f.why)}</textarea>

      <label class="mo-lbl">Due date</label>
      <div class="mo-hint">The day the objective is expected to be met — usually
        the last day of the quarter.</div>
      <input class="form-control mo-date" id="myobj-due" type="date" value="${esc(f.due)}"
             oninput="_objSmartDebounced()">

      ${!f.id ? `
        <label class="mo-lbl">KPIs</label>
        <div class="mo-hint">A <b>KPI</b> is the figure that says whether the
          objective was reached — one thing measured, and the number to hit.
          “P2 MTTR, target 18 h” is a KPI; “improve response time” is not, because
          nothing can be checked against it at the end of the quarter.</div>
        <div class="mo-krows">${kpis}</div>
        <button class="mo-mini" onclick="myObjFormAddKpi()">+ Add a KPI</button>

        <label class="mo-lbl">Milestones</label>
        <div class="mo-hint">A <b>milestone</b> is a step along the way, with a
          date — something you can tick off before the deadline. They are what
          make progress visible in March instead of only in June.</div>
        <div class="mo-srows">${steps}</div>
        <button class="mo-mini" onclick="myObjFormAddStep()">+ Add a milestone</button>
      ` : `<div class="mo-form-note">KPIs and milestones are managed from the
           objective itself, once saved.</div>`}

      <div id="myobj-smart">${_objSmartHtml(MyObj.smart)}</div>

      <div class="mo-form-foot">
        <button class="btn btn-ghost btn-sm" onclick="myObjCancelForm()">Cancel</button>
        <button class="btn btn-ghost btn-sm" onclick="myObjSave(false)">Save as draft</button>
        <button class="btn btn-primary btn-sm" onclick="myObjSave(true)">
          ${f.id ? 'Send changes' : 'Send for approval'}</button>
      </div>
      </div>
    </div>`;
}

// Cible d'un KPI. L'unité n'est ajoutée que si la cible n'en porte pas
// déjà une : saisir « 18 h » avec l'unité « heures » donnait « 18 h
// heures ». On ne compare pas les deux chaînes — « h » et « heures »
// sont la même unité écrite autrement — on regarde si la cible contient
// autre chose que le nombre.
function _objTarget(k) {
  const t = String(k.target ?? '').trim();
  if (!t) return '—';
  const bare = /^[\d.,\s]+$/.test(t);          // « 18 », « 3,5 » : rien que le nombre
  const unit = String(k.unit ?? '').trim();
  return bare && unit ? `${t} ${unit}` : t;
}

// Ligne « valeur en vigueur / proposition en attente ». C'est le motif
// qui revient partout : il doit être impossible de prendre l'une pour
// l'autre.
function _objPendingLine(label, from, to) {
  return `<div class="mo-pend">
    <span class="mo-pend-tag">Awaiting approval</span>
    <span class="mo-pend-txt">${esc(label)} — <s>${esc(from)}</s> → <b>${esc(to)}</b></span>
  </div>`;
}

function _objCardHtml(o) {
  const st = OBJ_STATE_LABEL[o.state] || OBJ_STATE_LABEL.draft;
  const open = MyObj.open === o.id || !(MyObj.closed && MyObj.closed.has(o.id));
  const pct = o.progress_pct || 0;
  const kpis = (o.kpis || []);
  const steps = (o.steps || []);

  // Un KPI se lit « quoi → combien », la source en appui. La cible est
  // l'information qui décide, elle est donc posée juste après le nom
  // plutôt que repoussée au bord opposé de la carte.
  const kpiRows = kpis.map(k => `
    <div class="mo-kpi ${k.state !== 'approved' ? 'is-wait' : ''}">
      <div class="mo-kpi-main">
        <span class="mo-kpi-n">${esc(k.name || '—')}</span>
        <span class="mo-kpi-t">${esc(_objTarget(k))}</span>
        ${k.state === 'rejected' ? `<span class="mo-chip ko">Rejected</span>`
        : k.state !== 'approved' ? `<span class="mo-chip wait">Waiting for your manager</span>` : ''}
      </div>
      ${k.source ? `<div class="mo-kpi-s">${esc(k.source)}</div>` : ''}
      ${o.set_by_manager && k.state !== 'approved' ? `<div class="mo-mine">You added this
        KPI — it applies once your manager approves it.</div>` : ''}
      ${o.editable && k.state !== 'approved'
        ? `<button class="mo-x" onclick="myObjDelSub('${o.id}','kpis','${k.id}')" title="Remove">×</button>` : ''}
      ${k.pending ? _objPendingLine('KPI', k.name + ' · ' + (k.target || ''),
          (k.pending.name ?? k.name) + ' · ' + (k.pending.target ?? k.target ?? '')) : ''}
      ${k.reject_reason ? `<div class="mo-why">Manager: ${esc(k.reject_reason)}</div>` : ''}
    </div>`).join('');

  // Sur un objectif posé par le manager, un jalon ajouté par l'agent doit
  // se distinguer : sans cela, sa proposition se noie dans la liste et il
  // ne voit pas qu'elle n'est pas encore acquise. L'état porte déjà
  // l'information, on la met en toutes lettres.
  const stepRows = steps.map(s => {
    const wantsDone = s.pending ? s.pending.done : null;
    const mine = o.set_by_manager && s.state !== 'approved';
    return `
    <div class="mo-step ${s.state !== 'approved' ? 'is-wait' : ''} ${mine ? 'is-mine' : ''}">
      <label class="mo-step-l">
        <input type="checkbox" ${s.done ? 'checked' : ''}
               ${o.editable ? '' : 'disabled'}
               onchange="myObjCheckStep('${o.id}','${s.id}',this.checked)">
        <span class="${s.done ? 'is-done' : ''}">${esc(s.label || '—')}</span>
      </label>
      ${s.due ? `<span class="mo-step-d${
        s.state === 'approved' && _stepLate(s) ? ' is-late' : ''}"${
        s.state === 'approved' && _stepLate(s)
          ? ` title="${s.done
              ? 'Met after its deadline — counts for half in your progress'
              : 'Past its deadline'}"` : ''}>${esc(s.due)}${
        s.state === 'approved' && _stepLate(s) ? (s.done ? ' ◑' : ' !') : ''}</span>` : ''}
      ${s.state === 'rejected' ? `<span class="mo-chip ko">Rejected</span>`
        : s.state !== 'approved' ? `<span class="mo-chip wait">Waiting for your manager</span>` : ''}
      ${o.editable && s.state !== 'approved'
        ? `<button class="mo-x" onclick="myObjDelSub('${o.id}','steps','${s.id}')" title="Remove">×</button>` : ''}
      ${MyObj.ticking && MyObj.ticking.id === o.id && MyObj.ticking.sid === s.id ? `
        <div class="mo-tick">
          <span>Its due date (${esc(s.due)}) has passed. When was it done?</span>
          <input type="date" id="mo-done-date" class="form-control" value="${_o2oToday()}" max="${_o2oToday()}"
                 onkeydown="if(event.key==='Enter')myObjTickConfirm();if(event.key==='Escape')myObjTickCancel()">
          <button class="btn btn-primary btn-sm" onclick="myObjTickConfirm()">Mark as done</button>
          <button class="btn btn-ghost btn-sm" onclick="myObjTickCancel()">Cancel</button>
        </div>` : ''}
      ${s.done && s.done_at ? `<span class="mo-step-when" title="Completion date">done ${esc(String(s.done_at).slice(0, 10))}</span>` : ''}
      ${mine ? `<div class="mo-mine">You added this milestone — it counts towards
        your progress once your manager approves it.</div>` : ''}
      ${wantsDone !== null ? _objPendingLine('Progress', s.done ? 'done' : 'not done', wantsDone ? 'done' : 'not done') : ''}
      ${s.reject_reason ? `<div class="mo-why">Manager: ${esc(s.reject_reason)}</div>` : ''}
    </div>`;
  }).join('');

  // Anneau de progression plutôt qu'un chiffre posé dans un coin : il
  // porte le pourcentage en son centre, donc la valeur et sa lecture
  // visuelle tiennent au même endroit, à côté de l'intitulé.
  const R = 16, C = 2 * Math.PI * R;
  const ring = `
    <div class="mo-ring ${pct >= 100 ? 'is-full' : ''} ${pct === 0 ? 'is-zero' : ''}" aria-label="${pct}%">
      <svg viewBox="0 0 40 40">
        <circle cx="20" cy="20" r="${R}"/>
        <circle cx="20" cy="20" r="${R}" class="mo-ring-v"
                stroke-dasharray="${C.toFixed(1)}"
                stroke-dashoffset="${(C - C * pct / 100).toFixed(1)}"/>
      </svg>
      <span>${pct}</span>
    </div>`;

  const doneSteps = steps.filter(s => s.done).length;

  return `
    <div class="mo-card ${open ? 'is-open' : ''} st-${st.c}">
      <div class="mo-head" onclick="myObjToggle('${o.id}')">
        ${ring}
        <div class="mo-head-main">
          <div class="mo-title">${esc(o.title)}</div>
          <div class="mo-meta">
            <span class="mo-chip ${st.c}">${esc(st.t)}</span>
            ${o.set_by_manager ? `<span class="mo-chip mgr">Set by your manager</span>` : ''}
            ${o.has_pending ? `<span class="mo-chip wait">Changes pending</span>` : ''}
            ${o.due ? (() => {
              // Échéance dépassée : l'agent doit le voir sur la carte, pas
              // seulement dans le rappel en tête de page — c'est ici qu'il
              // agit sur l'objectif.
              const over = o.state === 'approved' && o.progress !== 'done'
                && o.due < _o2oToday();
              return `<span class="mo-due${over ? ' is-late' : ''}"${
                over ? ' title="Past its deadline"' : ''}>${esc(o.due)}${
                over ? ' · en retard' : ''}</span>`;
            })() : ''}
            ${kpis.length ? `<span class="mo-cnt">${kpis.length} KPI${kpis.length > 1 ? 's' : ''}</span>` : ''}
            ${steps.length ? `<span class="mo-cnt">${doneSteps}/${steps.length} milestones</span>` : ''}
          </div>
        </div>
        <svg class="mo-caret" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M8.6 16.6 13.2 12 8.6 7.4 10 6l6 6-6 6z"/>
        </svg>
      </div>

      ${o.pending ? Object.entries(o.pending).map(([k, v]) =>
        _objPendingLine(k === 'title' ? 'Wording' : k === 'due' ? 'Due date' : 'Reason',
                        o[k] || '—', v || '—')).join('') : ''}

      ${o.state === 'rejected' && o.reject_reason
        ? `<div class="mo-why is-block"><b>Your manager asked for changes:</b> ${esc(o.reject_reason)}</div>` : ''}

      ${open ? `
        <div class="mo-body">
          ${o.why ? `<div class="mo-why-txt"><span>Why it matters</span>${esc(o.why)}</div>` : ''}

          <div class="mo-sub">
            <div class="mo-sub-h">
              <span>KPIs <i>— what is measured, and the target</i></span>
              ${o.editable ? `<button class="mo-mini" onclick="myObjAddKpi('${o.id}')">+ Add</button>` : ''}
            </div>
            ${kpis.length ? `<div class="mo-kpis">${kpiRows}</div>`
              : `<div class="mo-none">No KPI yet. Adding one figure now is what
                 lets you show, at the end of the quarter, how far you got.</div>`}
            ${MyObj.adding?.id === o.id && MyObj.adding.kind === 'kpis' ? _objAddFormHtml('kpis') : ''}
          </div>

          <div class="mo-sub">
            <div class="mo-sub-h">
              <span>Milestones <i>— the steps along the way, with dates</i></span>
              ${o.editable ? `<button class="mo-mini" onclick="myObjAddStep('${o.id}')">+ Add</button>` : ''}
            </div>
            ${steps.length ? `<div class="mo-steps">${stepRows}</div>`
              : o.set_by_manager
              ? `<div class="mo-none">Your manager set this objective without
                 milestones. Add your own steps — each needs their approval, and
                 ticking an approved one is what moves your progress.</div>`
              : `<div class="mo-none">No milestone yet. Cutting the objective into
                 a few steps keeps progress visible well before the deadline.</div>`}
            ${MyObj.adding?.id === o.id && MyObj.adding.kind === 'steps' ? _objAddFormHtml('steps') : ''}
          </div>

          ${o.smart ? `<details class="mo-det"><summary>SMART check — ${o.smart.score}/100</summary>
            ${_objSmartHtml(o.smart)}</details>` : ''}

          ${o.editable ? `<div class="mo-acts">
            <button class="btn btn-ghost btn-sm" onclick="myObjEditForm('${o.id}')">Edit</button>
            ${['draft', 'rejected'].includes(o.state)
              ? `<button class="btn btn-primary btn-sm" onclick="myObjSubmit('${o.id}')">Send for approval</button>` : ''}
            ${o.state !== 'approved'
              ? `<button class="btn btn-ghost btn-sm mo-del" onclick="myObjDelete('${o.id}')">Delete</button>` : ''}
          </div>` : ''}
        </div>` : ''}
    </div>`;
}

