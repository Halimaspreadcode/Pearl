// ══════════════════════════════════════════════════════════════
// ACADEMY — l'entrée unique des formations (page « academy »)
//
// Les formations DigitalView et Process ITSM avaient chacune leur entrée
// de menu et s'ouvraient directement sur leur parcours. L'Academy les
// réunit : un accueil qui montre où l'on en est
// (heatmap d'activité, carte de progression module par module), et le
// cours lui-même, la barre latérale de l'app repliée en icônes.
//
// Les cours restent ceux du moteur (public/formation/*.html, dans une
// iframe) : l'Academy ne réécrit rien, elle lit la progression enregistrée
// (serveur + état local du navigateur) et la structure des cours
// (/api/academy, lue dans les pages elles-mêmes).
//
// L'admin ouvre et ferme cours et modules (mode « Gérer ») et voit la
// heatmap d'équipe. Un module fermé disparaît du cours pour les agents
// (filtré par le pont, formation/digitalview-bridge.js).
// ══════════════════════════════════════════════════════════════

const AC = {
  data: null,           // catalogue : [{ id, title, modules: [...] }]
  prog: {},             // id cours → état fusionné { done, pos, days, xp, streak, last }
  view: 'hub',          // 'hub' | 'course'
  course: null,         // cours ouvert dans le lecteur
  manage: false,        // mode « Gérer » de l'admin
  teamCourse: null,     // heatmap d'équipe : cours affiché
  team: {},             // id cours → export d'équipe
  loading: false,
};

// Clés locales des cours (cf. digitalview-bridge.js : rangées par agent).
const AC_LOCAL_KEY = { digitalview: 'dvf-state', process: 'itf-state', mobilemoney: 'mmf-state', datacenter: 'dcf-state', reseau: 'rsf-state' };
const AC_API = { digitalview: '/api/formation/progress', process: '/api/formation/process/progress', mobilemoney: '/api/formation/mobilemoney/progress', datacenter: '/api/formation/datacenter/progress', reseau: '/api/formation/reseau/progress' };
const AC_LEVELS = [[0, 'Recrue'], [150, 'Vigie'], [400, 'Sentinelle'], [800, 'Analyste'], [1300, 'Stratège'], [2000, 'Architecte'], [3000, 'Légende']];

function _acIsAdmin() { return typeof AdminSession !== 'undefined' && AdminSession.active; }
function _acMe() {
  try { return JSON.parse(localStorage.getItem('fo-user') || 'null') || {}; } catch { return {}; }
}
function _acUid() { const m = _acMe(); return m.employeeId ? String(m.employeeId).trim().toLowerCase() : ''; }

// ── Barre latérale ────────────────────────────────────────────
// Dans l'Academy, la barre de l'app reste là mais repliée en icônes par
// défaut, pour laisser la place au cours. On mémorise l'état d'avant
// l'entrée et on le rend à la sortie (page-dispatch.js) ; si l'utilisateur
// la déplie pendant qu'il est dans l'Academy, son choix est respecté.
let _acRailAvant = null;
function academyFocus(on) {
  const app = document.querySelector('.app');
  if (!app || typeof applySidebarRail !== 'function') return;
  if (on && _acRailAvant === null) {
    _acRailAvant = app.classList.contains('sb-rail');
    applySidebarRail(true);
  } else if (!on && _acRailAvant !== null) {
    applySidebarRail(_acRailAvant);
    _acRailAvant = null;
  }
}

// ── Données ───────────────────────────────────────────────────
// Fusion serveur + local : le cours pousse sa progression avec un léger
// délai, et l'état local peut être en avance de quelques secondes.
function _acMerge(a, b) {
  const out = { done: {}, pos: {}, days: [], xp: 0, streak: 0, last: null, miss: [] };
  [a, b].filter(Boolean).forEach(s => {
    Object.keys(s.done || {}).forEach(k => { if (s.done[k]) out.done[k] = true; });
    Object.entries(s.pos || {}).forEach(([k, v]) => { if (!out.done[k] && (out.pos[k] || 0) < v) out.pos[k] = v; });
    (s.days || []).forEach(d => { if (!out.days.includes(d)) out.days.push(d); });
    (s.miss || []).forEach(d => { if (!out.miss.includes(d)) out.miss.push(d); });
    out.xp = Math.max(out.xp, s.xp || 0);
    const n = d => { if (!d) return 0; const p = String(d).split('-'); return +p[0] * 10000 + +p[1] * 100 + +p[2]; };
    if (n(s.last) > n(out.last) || (s.last === out.last && (s.streak || 0) > out.streak)) {
      out.last = s.last || null; out.streak = s.streak || 0;
    }
  });
  Object.keys(out.pos).forEach(k => { if (out.done[k]) delete out.pos[k]; });
  return out;
}

async function _acLoad() {
  AC.loading = true;
  const uid = _acUid();
  try {
    const r = await fetch(`${API}/api/academy`, { cache: 'no-store' });
    AC.data = r.ok ? (await r.json()).courses : [];
  } catch { AC.data = AC.data || []; }
  await Promise.all((AC.data || []).map(async c => {
    let local = null, remote = null;
    try { local = JSON.parse(localStorage.getItem(`${AC_LOCAL_KEY[c.id]}:${uid || 'anonyme'}`) || 'null'); } catch {}
    if (uid && AC_API[c.id]) {
      try {
        const r = await fetch(`${API}${AC_API[c.id]}/${encodeURIComponent(uid)}`, { cache: 'no-store' });
        if (r.ok) remote = (await r.json()).state;
      } catch {}
    }
    AC.prog[c.id] = _acMerge(remote, local);
  }));
  AC.loading = false;
}

// ── Calculs ───────────────────────────────────────────────────
function _acOpenModules(c) { return (c.modules || []).filter(m => !m.locked || _acIsAdmin()); }
function _acSessions(c) { return _acOpenModules(c).flatMap(m => m.sessions.map(s => ({ ...s, mod: m }))); }
function _acState(c, key) {
  const p = AC.prog[c.id] || {};
  if (p.done && p.done[key]) return 'done';
  if (p.pos && p.pos[key]) return 'doing';
  return 'todo';
}
function _acPct(c) {
  const all = _acSessions(c);
  if (!all.length) return 0;
  return Math.round(all.filter(s => _acState(c, s.key) === 'done').length / all.length * 100);
}
function _acNext() {
  // Reprendre là où l'on s'est arrêté : une session commencée d'abord,
  // sinon la première non faite du premier cours ouvert.
  for (const c of (AC.data || []).filter(x => !x.locked)) {
    const s = _acSessions(c).find(x => _acState(c, x.key) === 'doing');
    if (s) return { c, s };
  }
  for (const c of (AC.data || []).filter(x => !x.locked)) {
    const s = _acSessions(c).find(x => _acState(c, x.key) === 'todo');
    if (s) return { c, s };
  }
  return null;
}
function _acTotals() {
  const cs = AC.data || [];
  const xp = cs.reduce((n, c) => n + ((AC.prog[c.id] || {}).xp || 0), 0);
  const streak = Math.max(0, ...cs.map(c => (AC.prog[c.id] || {}).streak || 0));
  const done = cs.reduce((n, c) => n + _acSessions(c).filter(s => _acState(c, s.key) === 'done').length, 0);
  const total = cs.reduce((n, c) => n + _acSessions(c).length, 0);
  const days = new Set(cs.flatMap(c => ((AC.prog[c.id] || {}).days || []).map(_acDay)));
  let i = 0;
  while (i < AC_LEVELS.length - 1 && xp >= AC_LEVELS[i + 1][0]) i++;
  const next = AC_LEVELS[i + 1];
  return { xp, streak, done, total, days: days.size, level: i + 1, levelName: AC_LEVELS[i][1],
           levelPct: next ? Math.round((xp - AC_LEVELS[i][0]) / (next[0] - AC_LEVELS[i][0]) * 100) : 100 };
}
// Les cours notent les jours « 2026-10-2 » : on normalise en ISO.
function _acDay(d) {
  const p = String(d).split('-');
  return p.length === 3 ? `${p[0]}-${p[1].padStart(2, '0')}-${p[2].padStart(2, '0')}` : String(d);
}

// ── Entrée ────────────────────────────────────────────────────
async function renderAcademy(opts) {
  opts = opts || {};
  academyFocus(true);
  const root = document.getElementById('academy-root');
  if (!root) return;
  const loading = _acLoad();
  if (!AC.data) root.innerHTML = '<div class="ac-wait">Chargement de l\'Academy…</div>';
  await loading;
  if (opts.course) return academyOpenCourse(opts.course, opts.module);
  AC.view = 'hub';
  _acRenderHub();
}

// ── Accueil ───────────────────────────────────────────────────
function _acRenderHub() {
  const root = document.getElementById('academy-root');
  if (!root || !AC.data) return;
  const t = _acTotals();
  const me = _acMe();
  const prenom = me.name ? String(me.name).trim().split(/\s+/)[0] : '';
  const nx = _acNext();
  const admin = _acIsAdmin();

  root.innerHTML = `
  <div class="ac">
    <section class="ac-hero2 ac-in" style="--k:0">
      <header class="ac-nav">
        <span class="ac-tag-w">Academy</span>
        <nav class="ac-nav-r">
          ${admin ? `<button class="ac-nav-b${AC.manage ? ' is-on' : ''}" onclick="academyToggleManage()">${AC.manage ? 'Terminer' : 'Gérer'}</button>` : ''}
          <button class="ac-nav-b" onclick="academyExit()" title="Quitter l'Academy">Quitter</button>
        </nav>
      </header>
      <div class="ac-hero2-main">
        <div class="ac-hero2-txt">
          <h1 class="ac-display">${prenom ? `Apprends à ton rythme, ${esc(prenom)}.` : 'Apprends à ton rythme.'}</h1>
          <p class="ac-hero2-lead">Des sessions de cinq minutes, des schémas interactifs et des quiz pour ancrer.</p>
          <div class="ac-hero2-row">
            ${nx ? `<button class="ac-btn-w" onclick="academyOpenCourse('${nx.c.id}','${nx.s.mod.id}')">${_acState(nx.c, nx.s.key) === 'doing' ? 'Reprendre' : t.done ? 'Continuer' : 'Commencer'}</button>` : ''}
            <span class="ac-stat"><b>${t.total ? Math.round(t.done / t.total * 100) : 0} %</b> terminé</span>
            <span class="ac-stat"><b>${t.xp}</b> XP</span>
            <span class="ac-stat"><b>${t.streak}</b> j de série</span>
          </div>
        </div>
        ${nx ? `<button class="ac-next" onclick="academyOpenCourse('${nx.c.id}','${nx.s.mod.id}')">
            <span class="ac-next-k">${_acState(nx.c, nx.s.key) === 'doing' ? 'À reprendre' : 'Prochaine session'}</span>
            <span class="ac-next-t">${esc(nx.s.t)}</span>
            <span class="ac-next-m">${esc(nx.c.title)} · ${esc(nx.s.mod.t)}</span>
            <span class="ac-next-go" aria-hidden="true">→</span>
          </button>`
          : `<div class="ac-next is-done"><span class="ac-next-k">Parcours terminé</span><span class="ac-next-t">Bravo, tout est fait.</span><span class="ac-next-m">Passe l'examen final de chaque formation pour ancrer.</span></div>`}
      </div>
    </section>

    <section class="ac-row ac-in" style="--k:1">
      <div class="ac-card ac-heat">
        <div class="ac-card-h"><b>Activité</b><span>26 dernières semaines</span></div>
        ${_acHeatmap()}
      </div>
      <div class="ac-card ac-rings">
        <div class="ac-card-h"><b>Progression</b><span>par formation</span></div>
        <div class="ac-rings-in">${AC.data.map(c => _acRing(c)).join('')}</div>
      </div>
    </section>

    <h2 class="ac-h2 ac-in" style="--k:2">Formations</h2>
    <section class="ac-courses ac-in" style="--k:2">${AC.data.map(_acCourseCard).join('')}</section>

    ${admin && AC.manage ? `<h2 class="ac-h2 ac-in" style="--k:3">Modules <span>ouvrir ou fermer aux agents</span></h2>
      <section class="ac-maps ac-in" style="--k:3">${AC.data.map(_acModulesAdmin).join('')}</section>` : ''}

    ${admin ? `<h2 class="ac-h2 ac-in" style="--k:4">Équipe <span>avancement par module, admin seulement</span></h2>
      <section class="ac-card ac-team ac-in" style="--k:4" id="ac-team-map">${_acTeamShell()}</section>` : ''}
    <div class="dv-team" id="ac-team" hidden></div>
  </div>`;
  if (admin) _acLoadTeam(AC.teamCourse || AC.data[0]?.id);
}

// Heatmap d'activité : une colonne par semaine, du lundi au dimanche.
// Intensité = nombre de formations pratiquées ce jour-là.
function _acHeatmap() {
  const cs = AC.data || [];
  const count = {};
  cs.forEach(c => ((AC.prog[c.id] || {}).days || []).forEach(d => { const k = _acDay(d); count[k] = (count[k] || 0) + 1; }));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(today.getDate() - ((today.getDay() + 6) % 7) - 25 * 7);
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const MOIS = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
  let cols = '', mois = '', prevM = -1;
  for (let w = 0; w < 26; w++) {
    let col = '';
    const d0 = new Date(start); d0.setDate(start.getDate() + w * 7);
    mois += `<span>${d0.getMonth() !== prevM ? MOIS[d0.getMonth()] : ''}</span>`;
    prevM = d0.getMonth();
    for (let j = 0; j < 7; j++) {
      const d = new Date(start); d.setDate(start.getDate() + w * 7 + j);
      const k = iso(d), n = count[k] || 0;
      const fut = d > today;
      col += `<i class="ac-hc l${Math.min(n, 2)}${fut ? ' is-fut' : ''}${k === iso(today) ? ' is-today' : ''}" title="${d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}${n ? ` · ${n} formation${n > 1 ? 's' : ''}` : ''}"></i>`;
    }
    cols += `<div class="ac-hcol">${col}</div>`;
  }
  return `<div class="ac-hm"><div class="ac-hm-days"><span>L</span><span></span><span>M</span><span></span><span>V</span><span></span><span>D</span></div>
    <div><div class="ac-hm-mois">${mois}</div><div class="ac-hm-grid">${cols}</div></div></div>
    <div class="ac-hm-leg">Moins <i class="ac-hc l0"></i><i class="ac-hc l1"></i><i class="ac-hc l2"></i> Plus</div>`;
}

function _acRing(c) {
  const p = _acPct(c), R = 30, C = 2 * Math.PI * R;
  return `<button class="ac-ring" onclick="academyOpenCourse('${c.id}')" style="--h1:${c.hue[0]};--h2:${c.hue[1]}" ${c.locked && !_acIsAdmin() ? 'disabled' : ''}>
    <svg viewBox="0 0 76 76">
      <circle cx="38" cy="38" r="${R}" class="ac-ring-bg"/>
      <circle cx="38" cy="38" r="${R}" stroke="${c.hue[0]}" class="ac-ring-fg" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C - C * p / 100).toFixed(1)}"/></svg>
    <span class="ac-ring-v">${p}%</span><span class="ac-ring-l">${esc(c.title)}</span></button>`;
}

function _acCourseCard(c) {
  const admin = _acIsAdmin();
  const all = _acSessions(c), done = all.filter(s => _acState(c, s.key) === 'done').length;
  const fermes = (c.modules || []).filter(m => m.locked).length;
  const lock = c.locked && !admin;
  return `<div class="ac-course${c.locked ? ' is-locked' : ''}" style="--h1:${c.hue[0]};--h2:${c.hue[1]}">
    <button class="ac-course-in" onclick="academyOpenCourse('${c.id}')" ${lock ? 'disabled' : ''}>
      <span class="ac-course-tag">${esc(c.tag)}</span>
      <span class="ac-course-t">${esc(c.title)}</span>
      <span class="ac-course-d">${esc(c.desc)}</span>
      <span class="ac-course-meta">${_acOpenModules(c).length} modules · ${all.length} sessions${fermes ? ` · ${fermes} fermé${fermes > 1 ? 's' : ''}` : ''}</span>
      <span class="ac-course-bar"><i style="width:${all.length ? Math.round(done / all.length * 100) : 0}%"></i></span>
      <span class="ac-course-cta">${lock ? '🔒 Bientôt disponible' : done ? `Continuer · ${done}/${all.length}` : 'Commencer'}</span>
    </button>
    ${admin ? `<div class="ac-admin-row">
        ${AC.manage ? _acSwitch(`academyLockCourse('${c.id}',${!c.locked})`, !c.locked, c.locked ? 'Fermée aux agents' : 'Ouverte') : ''}
        <button class="ac-ghost is-sm" onclick="dvTeamOpen('${c.id}')">Progression équipe</button>
      </div>` : ''}
  </div>`;
}

function _acSwitch(action, on, label) {
  return `<button class="ac-switch${on ? ' is-on' : ''}" onclick="event.stopPropagation();${action}" role="switch" aria-checked="${on}">
    <span class="ac-sw-track"><span class="ac-sw-knob"></span></span><span>${esc(label)}</span></button>`;
}

// Liste des modules en mode « Gérer » (admin) : un interrupteur par
// module pour l'ouvrir ou le fermer aux agents.
function _acModulesAdmin(c) {
  return `<div class="ac-card ac-map">
    <div class="ac-card-h"><b>${esc(c.title)}</b><span>${c.modules.filter(m => !m.locked).length} / ${c.modules.length} ouverts</span></div>
    <div class="ac-map-rows">
      ${c.modules.map((m, i) => `<div class="ac-mrow${m.locked ? ' is-locked' : ''}" style="--deep:${m.deep}">
        <span class="ac-mname"><span class="ac-mnum">${i + 1}</span><span class="ac-mt">${esc(m.t)}</span></span>
        <span class="ac-mcount">${m.sessions.length} session${m.sessions.length > 1 ? 's' : ''}</span>
        ${_acSwitch(`academyLockModule('${c.id}','${m.id}',${!m.locked})`, !m.locked, m.locked ? 'Fermé' : 'Ouvert')}
      </div>`).join('')}
    </div>
  </div>`;
}

// ── Heatmap d'équipe (admin) ──────────────────────────────────
function _acTeamShell() {
  return `<div class="ac-card-h"><b>Avancement par agent</b>
    <span class="ac-tabs">${(AC.data || []).map(c => `<button class="${(AC.teamCourse || AC.data[0].id) === c.id ? 'is-on' : ''}" onclick="academyTeamCourse('${c.id}')">${esc(c.title)}</button>`).join('')}</span></div>
    <div id="ac-team-body"><div class="ac-wait">Chargement…</div></div>`;
}

function academyTeamCourse(id) {
  AC.teamCourse = id;
  const box = document.getElementById('ac-team-map');
  if (box) box.innerHTML = _acTeamShell();
  _acLoadTeam(id);
}

async function _acLoadTeam(id) {
  if (!id) return;
  AC.teamCourse = id;
  const body = document.getElementById('ac-team-body');
  try {
    if (!AC.team[id]) {
      const r = await fetch(`${API}${AC_API[id]}.json`, { headers: AdminSession.headers(), credentials: 'same-origin' });
      if (!r.ok) throw new Error('Accès refusé');
      AC.team[id] = await r.json();
    }
  } catch (e) { if (body) body.innerHTML = `<div class="ac-wait">${esc(e.message)}</div>`; return; }
  if (!body) return;
  const c = AC.data.find(x => x.id === id);
  const agents = AC.team[id].agents || [];
  const vus = new Set(agents.map(a => String(a.name || '').toLowerCase()));
  const absents = ((state.config && state.config.fo_list) || []).filter(n => !vus.has(String(n).toLowerCase()));
  if (!agents.length) { body.innerHTML = '<div class="ac-wait">Personne n\'a encore commencé cette formation.</div>'; return; }
  body.innerHTML = `<div class="ac-tm" style="--n:${c.modules.length}">
    <div class="ac-tm-h"><span></span>${c.modules.map((m, i) => `<span title="${esc(m.t)}" style="--deep:${m.deep}">${m.locked ? '🔒' : 'M' + (i + 1)}</span>`).join('')}<span>Total</span></div>
    ${agents.map(a => {
      const fait = new Set(a.done || []);
      const cells = c.modules.map(m => {
        const p = m.sessions.length ? Math.round(m.sessions.filter(s => fait.has(s.key)).length / m.sessions.length * 100) : 0;
        return `<i style="--deep:${m.deep};--a:${p ? 18 + p * 0.82 : 0}%" title="${esc(a.name || a.id)} · ${esc(m.t)} : ${p}%">${p ? p : ''}</i>`;
      }).join('');
      return `<div class="ac-tm-r"><b>${esc(a.name || a.id)}</b>${cells}<span>${a.percent ?? 0}%</span></div>`;
    }).join('')}
  </div>${absents.length ? `<div class="ac-tm-abs"><b>Pas encore commencé :</b> ${absents.map(esc).join(', ')}</div>` : ''}`;
}

// ── Gestion (admin) ───────────────────────────────────────────
function academyToggleManage() { AC.manage = !AC.manage; _acRenderHub(); }

async function _acPutLocks(body) {
  const res = await fetch(`${API}/api/academy/locks`, {
    method: 'PUT', headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
    credentials: 'same-origin',
    body: JSON.stringify({ ...body, by: (typeof rptDefaultAuthor === 'function' && rptDefaultAuthor()) || 'admin' }),
  });
  if (!res.ok) throw new Error('Enregistrement impossible');
}

async function academyLockCourse(id, lock) {
  const c = AC.data.find(x => x.id === id);
  if (!c) return;
  try { await _acPutLocks({ courses: { [id]: lock } }); c.locked = lock; }
  catch (e) { toast(e.message, 'error'); return; }
  toast(lock ? `${c.title} fermée aux agents` : `${c.title} ouverte`, 'success');
  _acRenderHub();
}

async function academyLockModule(id, mid, lock) {
  const c = AC.data.find(x => x.id === id);
  const m = c && c.modules.find(x => x.id === mid);
  if (!m) return;
  try { await _acPutLocks({ modules: { [`${id}:${mid}`]: lock } }); m.locked = lock; }
  catch (e) { toast(e.message, 'error'); return; }
  toast(lock ? `Module « ${m.t} » fermé` : `Module « ${m.t} » ouvert`, 'success');
  _acRenderHub();
}

// ── Lecteur de cours ──────────────────────────────────────────
async function academyOpenCourse(id, moduleId) {
  if (!AC.data) await _acLoad();
  const c = (AC.data || []).find(x => x.id === id);
  if (!c) return;
  if (c.locked && !_acIsAdmin()) { toast('Cette formation est fermée pour le moment', 'info'); return; }
  const root = document.getElementById('academy-root');
  if (!root) return;
  academyFocus(true);
  AC.view = 'course';
  AC.course = id;
  root.innerHTML = `<div class="ac-player" style="--h1:${c.hue[0]};--h2:${c.hue[1]}">
    <div class="ac-pbar">
      <button class="ac-pback" onclick="academyBack()" title="Retour à l'Academy" aria-label="Retour à l'Academy"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></button>
      <span class="ac-pbar-t"><i></i>${esc(c.title)}</span>
      <nav class="ac-ptabs" aria-label="Navigation du cours">
        <button data-v="home" aria-current="page">Parcours</button>
        <button data-v="lex">Lexique</button>
        <button data-v="rev">Révision <b class="ac-ptabs-n" hidden></b></button>
      </nav>
      ${c.locked ? '<span class="ac-pbar-lock">🔒 Fermée aux agents (aperçu admin)</span>' : ''}
      ${_acIsAdmin() ? `<button class="ac-pteam" onclick="dvTeamOpen('${c.id}')">Progression équipe</button>` : ''}
    </div>
    <iframe id="ac-frame" title="${esc(c.title)}" src="${c.url}"></iframe>
    <div class="dv-team" id="ac-team" hidden></div>
  </div>`;
  // Le cours expose sa navigation (go2, apply) : la barre de l'Academy le
  // pilote, et suit l'écran affiché pour marquer l'onglet actif.
  const f = document.getElementById('ac-frame');
  const tabs = [...root.querySelectorAll('.ac-ptabs button')];
  tabs.forEach(b => b.addEventListener('click', () => {
    try { f.contentWindow.go2({ v: b.dataset.v }); } catch (_) {}
  }));
  f.addEventListener('load', () => {
    const w = f.contentWindow;
    const sync = () => {
      let v = 'home', n = 0;
      try { v = (w.route && w.route.v) || 'home'; n = (w.st && w.st.miss || []).length; } catch (_) {}
      tabs.forEach(b => b.setAttribute('aria-current', (b.dataset.v === v || (b.dataset.v === 'home' && (v === 'mod' || v === 'course'))) ? 'page' : 'false'));
      const badge = root.querySelector('.ac-ptabs-n');
      if (badge) { badge.hidden = !n; badge.textContent = n; }
    };
    try {
      const apply0 = w.apply;
      if (typeof apply0 === 'function') w.apply = function (r) { const out = apply0.apply(this, arguments); sync(); return out; };
      const save0 = w.save;
      if (typeof save0 === 'function') w.save = function () { const out = save0.apply(this, arguments); sync(); return out; };
      if (moduleId) w.go2({ v: 'mod', m: moduleId }, true);
    } catch (_) {}
    sync();
  }, { once: true });
}

async function academyBack() {
  AC.view = 'hub';
  await _acLoad();          // la session qu'on vient de faire doit se voir
  _acRenderHub();
}

function academyExit() {
  academyFocus(false);
  let last = 'dashboard';
  try { last = localStorage.getItem('pearl-last-page') || 'dashboard'; } catch {}
  if (last === 'academy' || last === 'digitalview' || last === 'process-training') last = 'dashboard';
  window.renderPage(last);
}

window.renderAcademy = renderAcademy;
window.academyFocus = academyFocus;
window.academyOpenCourse = academyOpenCourse;
window.academyBack = academyBack;
window.academyExit = academyExit;
window.academyToggleManage = academyToggleManage;
window.academyLockCourse = academyLockCourse;
window.academyLockModule = academyLockModule;
window.academyTeamCourse = academyTeamCourse;
