// ══════════════════════════════════════════════════════════════
// ACCUEIL DE PEAR AI (affiché dans la page Pear AI, ai.js)
//
// Ce qui attend l'admin aujourd'hui, en widgets : sa journée (planning et
// absents), ses sujets à décider (tickets, équipe, absences, One-to-One…),
// les inquiétudes relevées en One-to-One à suivre, les absences, les
// opérations, et ce que Pear AI lit.
//
// Deux couches :
//   · les signaux, calculés sans IA et affichés tout de suite : ceux de
//     l'équipe avec les mêmes règles que la page Équipe (eqTeamSignals),
//     ceux des opérations par le serveur (/api/ai/cockpit) ;
//   · l'IA par-dessus : un brief qui priorise les actions du jour, et
//     un « Impact » à la demande sur chaque élément.
// Le modèle ne voit que des alias d'agents ; le serveur remet les noms.
// L'IA est un plus : sans elle (tunnel éteint), la page reste utile.
// ══════════════════════════════════════════════════════════════
const AIC = { loading: false, team: [], ops: { items: [], resume: {} }, conf: null,
  brief: null, briefBusy: false, briefErr: '', briefAt: null, impact: {}, filtre: 'todo', abs: [], pins: [], pinJobs: {} };

const _AIC_LVL = { urgent: { t: 'Urgent', c: 'is-urgent' }, todo: { t: 'À décider', c: 'is-todo' }, info: { t: 'À savoir', c: 'is-info' } };

async function _aicGet(url) {
  const r = await fetch(`${API}${url}`, { headers: AdminSession.headers(), credentials: 'same-origin' });
  if (r.status === 401) throw new Error('Session admin expirée : reconnectez-vous.');
  return r.ok ? r.json() : null;
}
async function _aicPost(url, body) {
  const r = await fetch(`${API}${url}`, { method: 'POST', credentials: 'same-origin',
    headers: AdminSession.headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body || {}) });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error('Session admin expirée : reconnectez-vous.');
  if (!r.ok) {
    const m = d.error || `Erreur ${r.status}`;
    throw new Error(/tunnel|injoignable|délai/i.test(m) ? `${m} (sur ton PC : ia on)` : m);
  }
  return d;
}

async function renderAiCockpit() {
  const root = document.getElementById('aic-root');
  if (!root) return;
  // Le pays affiché a changé (sélecteur de l'en-tête ou du tableau) : on recharge.
  const pays = _aicPays();
  if (!AIC.loadedAt || Date.now() - AIC.loadedAt > 60000 || AIC.pays !== pays) {
    if (AIC.pays !== pays) { AIC.brief = null; AIC.briefErr = ''; AIC.impact = {}; }
    await aicReload(false);
  }
  _aicPaint();
}

async function aicReload(paint = true) {
  AIC.loading = true; if (paint) _aicPaint();
  try {
    const [abs, trn, obj, ops, conf, pins] = await Promise.all([
      _aicGet('/api/absences').catch(() => null), _aicGet('/api/trainings').catch(() => null),
      _aicGet('/api/objectives').catch(() => null), _aicGet(`/api/ai/cockpit?country=${_aicPays()}`).catch(() => null),
      _aicGet('/api/ai/config').catch(() => null), _aicGet('/api/ai/pins').catch(() => null),
    ]);
    AIC.pins = (pins && pins.pins) || [];
    const ctx = {
      abs: Array.isArray(abs) ? abs : undefined,
      trainings: Array.isArray(trn) ? trn : undefined,
      objectives: obj && obj.objectives ? obj.objectives : undefined,
    };
    AIC.team = typeof eqTeamSignals === 'function' ? eqTeamSignals(_eqFoList(), ctx) : [];
    AIC.abs = Array.isArray(abs) ? abs : [];
    AIC.ops = ops || { items: [], resume: {} };
    AIC.conf = conf;
    AIC.pays = _aicPays();
    AIC.loadedAt = Date.now();
  } catch (e) { AIC.briefErr = e.message; }
  AIC.loading = false;
  _aicPaint();
  // Premier passage avec l'IA prête : le brief se prépare tout seul.
  if (AIC.conf?.has_key && !AIC.brief && !AIC.briefBusy && !AIC.briefErr) aicBrief();
}

// Signaux d'équipe regroupés par type : « One-to-One à planifier ·
// 7 agents » au lieu de sept lignes. La liste ne grossit plus avec
// l'équipe, et un même geste (planifier, noter, approuver) se lit d'un coup.
const AIC_GROUPES = {
  'obj-late': 'Objectifs en retard', 'obj-steps': 'Jalons d\'objectifs en retard',
  'obj-review': 'Objectifs à approuver', 'o2o': 'One-to-One à planifier',
  'o2o-actions': 'Actions de One-to-One en retard', score: 'Notes du mois à saisir',
  'perf-update': 'Performance à mettre à jour', 'tasks-late': 'Tâches en retard',
  tasks: 'Tâches ouvertes', 'abs-now': 'Absents en ce moment', 'abs-soon': 'Absences à venir',
  'abs-request': 'Demandes d\'absence à traiter', training: 'Formations prévues',
};
const _aicKind = k => (k === 'o2o-none' || k === 'o2o-old') ? 'o2o' : k;
const AIC_RANG = { urgent: 0, todo: 1, info: 2 };

function _aicItems() {
  const groupes = new Map();
  for (const a of AIC.team) for (const i of a.items) {
    const k = _aicKind(i.kind);
    const g = groupes.get(k) || { kind: k, src: 'team', id: `g|${k}`, lvl: i.lvl, agents: [] };
    if (AIC_RANG[i.lvl] < AIC_RANG[g.lvl]) g.lvl = i.lvl;
    g.agents.push({ fo: a.fo, txt: i.txt, atab: i.atab, asub: i.asub });
    groupes.set(k, g);
  }
  const t = [...groupes.values()].map(g => g.agents.length === 1 && g.kind !== 'o2o-concern'
    // Un seul agent : la ligne garde son texte précis (et l'Impact).
    ? { ...g, fo: g.agents[0].fo, txt: g.agents[0].txt, atab: g.agents[0].atab, asub: g.agents[0].asub }
    : { ...g, txt: `${AIC_GROUPES[g.kind] || g.agents[0].txt} · ${g.agents.length} agents` });
  // Inquiétudes de One-to-One encore à suivre (voir _aicInquietudes).
  const inq = _aicInquietudes().filter(c => !_aicSuivis()[c.id]);
  if (inq.length) groupes.set('o2o-concern', { kind: 'o2o-concern', src: 'team', id: 'g|o2o-concern', lvl: 'todo',
    agents: inq.map(c => ({ fo: c.fo, txt: c.txt, atab: 'o2o', asub: 'entretiens' })) });
  const o = (AIC.ops.items || []).map(i => ({ ...i, src: 'ops', id: `o|${i.kind}` }));
  return [...o, ...t].sort((x, y) => AIC_RANG[x.lvl] - AIC_RANG[y.lvl] || (y.agents?.length || 1) - (x.agents?.length || 1));
}

// « Masquer jusqu'à demain » : confort propre à ce poste (stockage local).
const AIC_MASQUE_KEY = 'aic-masques';
function _aicMasques() {
  let m = {};
  try { m = JSON.parse(localStorage.getItem(AIC_MASQUE_KEY) || '{}') || {}; } catch {}
  const auj = new Date().toISOString().slice(0, 10);
  return Object.fromEntries(Object.entries(m).filter(([, d]) => d >= auj));
}
function aicMasquer(id) {
  const m = _aicMasques();
  // Masqué pour aujourd'hui : il revient demain s'il est toujours d'actualité.
  m[id] = new Date().toISOString().slice(0, 10);
  try { localStorage.setItem(AIC_MASQUE_KEY, JSON.stringify(m)); } catch {}
  _aicPaint();
}
function aicVoirMasques() { AIC.voirMasques = !AIC.voirMasques; _aicPaint(); }
function aicDemasquer() { try { localStorage.removeItem(AIC_MASQUE_KEY); } catch {} AIC.voirMasques = false; _aicPaint(); }


// ── Pays ──────────────────────────────────────────────────────
// Même périmètre que le reste de l'appli (sélecteur Global / SN / CI de
// l'en-tête) : changer ici change partout, et inversement.
function _aicPays() { return typeof getActiveCountry === 'function' ? (getActiveCountry() || 'ALL') : 'ALL'; }
const AIC_PAYS_LIST = () => [['ALL', 'Global'], ...siteList().map(s => [s.code, siteName(s.code)])];
const _aicPerimetre = () => (_aicPays() === 'ALL' ? 'Global' : siteLabel(_aicPays()));
function aicPays(v) {
  if (typeof setActiveCountry === 'function') setActiveCountry(v);
  // La barre de Pear AI porte le sélecteur : on la repeint avec l'accueil.
  if (typeof _aiPaint === 'function') _aiPaint(); else renderAiCockpit();
}
const _aicTracker = () => (_aicPays() !== 'ALL' && isSiteCode(_aicPays()) ? _aicPays().toLowerCase() : 'global');
const _aicQ = v => `'${esc(String(v)).replace(/'/g, "\\'")}'`;
const _aicAuj = () => new Date().toISOString().slice(0, 10);
const _aicJours = iso => Math.round((Date.parse(_aicAuj()) - Date.parse(String(iso).slice(0, 10))) / 864e5);
const _aicDm = iso => { const s = String(iso || ''); return s.length >= 10 ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : s; };

// ── Points à suivre des One-to-One ────────────────────────────
// Pour chaque agent : actions convenues encore ouvertes (entretiens des
// 120 derniers jours), humeur « point de vigilance », difficultés et
// demandes du dernier entretien. Un agent reste dans « à suivre » tant
// que l'admin ne l'a pas marqué suivi (marque propre à ce poste) ; un
// nouvel entretien ou une nouvelle action le fait revenir.
const AIC_SUIVIS_KEY = 'aic-suivis';
function _aicSuivis() { try { return JSON.parse(localStorage.getItem(AIC_SUIVIS_KEY) || '{}') || {}; } catch { return {}; } }
function aicSuivi(id) {
  const m = _aicSuivis(); m[id] = _aicAuj();
  try { localStorage.setItem(AIC_SUIVIS_KEY, JSON.stringify(m)); } catch {}
  _aicPaint();
}
function _aicInquietudes() {
  const all = (state.config && state.config.fo_o2o) || {};
  const sec = (m, id) => {
    const x = (Array.isArray(m.sections) ? m.sections : []).find(s => s.id === id);
    if (!x) return '';
    return String(x.text || (Array.isArray(x.items) ? x.items.map(i => i.text || i).join(' · ') : '') || '').trim();
  };
  const auj = _aicAuj();
  const out = [];
  // Tous les agents du périmètre, quelle que soit l'humeur de l'entretien :
  // actions convenues encore ouvertes (tous entretiens des 120 derniers
  // jours), plus les difficultés et demandes du dernier entretien.
  for (const fo of (typeof _eqFoList === 'function' ? _eqFoList() : [])) {
    const ms = ((all[fo] || {}).meetings || []).filter(x => x && x.date && _aicJours(x.date) <= 120)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    if (!ms.length) continue;
    const m = ms[0];
    const actions = ms.flatMap(x => (typeof _o2oActionsOf === 'function' ? _o2oActionsOf(x) : (Array.isArray(x.actions) ? x.actions : []))
      .filter(t => t && typeof t === 'object' && (t.status || 'todo') === 'todo')
      .map(t => ({ text: String(t.text || ''), due: t.due || '', retard: !!t.due && t.due < auj, owner: t.owner || '' })))
      .filter(t => t.text);
    const diff = sec(m, 'blocked'), dem = sec(m, 'agent');
    if (m.mood !== 'down' && !diff && !dem && !actions.length) continue;
    const retards = actions.filter(t => t.retard).length;
    out.push({ id: `c|${fo}|${m.id || m.date}|${actions.length}`, fo, date: m.date, mood: m.mood, diff, dem, actions, retards,
      txt: diff || dem || (actions.length ? `${actions.length} action(s) convenue(s) ouverte(s)` : 'Point de vigilance noté'),
      jours: _aicJours(m.date) });
  }
  return out.sort((a, b) => (b.mood === 'down') - (a.mood === 'down') || b.retards - a.retards || a.jours - b.jours);
}

// ── Une action par type de sujet ──────────────────────────────
const AIC_ACTIONS = {
  'sla-breach':    { t: 'Tickets en rupture de SLA', cta: 'Voir', go: () => `renderPage('${_aicTracker()}')` },
  'sla-near':      { t: 'Tickets proches de la rupture', cta: 'Voir', go: () => `renderPage('${_aicTracker()}')` },
  'p12-open':      { t: 'P1 / P2 ouverts', cta: 'Voir', go: () => `renderPage('${_aicTracker()}')` },
  'old-open':      { t: 'Tickets ouverts depuis plus de 30 jours', cta: 'Trier', go: () => `renderPage('${_aicTracker()}')` },
  'backlog-up':    { t: 'Backlog en hausse', cta: 'Rapport', go: () => `renderPage('rapports')` },
  'outage':        { t: 'Panne de plateforme en cours', cta: 'Voir', go: () => `renderPage('observations')` },
  'obs-open':      { t: 'Observations ouvertes', cta: 'Voir', go: () => `renderPage('observations')` },
  'no-close-date': { t: 'Tickets fermés sans date de clôture', cta: 'Corriger', go: () => `renderPage('data-quality')` },
  'perf-update':   { t: 'Nouvelles mesures de performance à reporter', cta: 'Tout reporter', go: () => `aicPerfMaj()` },
  'score':         { t: 'Notes du mois à saisir', cta: 'Noter', go: g => `eqOpenAgent(${_aicQ(g.agents[0].fo)}, 'perf')` },
  'obj-review':    { t: 'Objectifs à approuver', cta: 'Approuver', go: () => `eqOpen({ tab: 'objectifs', sub: 'approbations' })` },
  'obj-late':      { t: 'Objectifs en retard', cta: 'Suivi', go: () => `eqOpen({ tab: 'objectifs', sub: 'suivi' })` },
  'obj-steps':     { t: 'Jalons d\'objectifs en retard', cta: 'Suivi', go: () => `eqOpen({ tab: 'objectifs', sub: 'suivi' })` },
  'o2o':           { t: 'One-to-One à planifier', cta: 'Planifier', go: () => `eqOpen({ tab: 'o2o' })` },
  'o2o-actions':   { t: 'Actions de One-to-One en retard', cta: 'Relancer', go: () => `eqOpen({ tab: 'o2o' })` },
  'o2o-concern':   { t: 'Points de One-to-One à suivre', cta: 'Voir', go: () => `document.getElementById('aic-w-inq')?.scrollIntoView({ behavior: 'smooth', block: 'center' })` },
  'tasks-late':    { t: 'Tâches en retard', cta: 'Relancer', go: () => `eqOpen({ tab: 'taches' })` },
  'tasks':         { t: 'Tâches ouvertes', cta: 'Voir', go: () => `eqOpen({ tab: 'taches' })` },
  'abs-request':   { t: 'Demandes d\'absence à traiter', cta: 'Traiter', go: () => `renderPage('absences')` },
  'abs-now':       { t: 'Absents en ce moment', cta: 'Voir', go: () => `renderPage('absences')` },
  'abs-soon':      { t: 'Absences à venir', cta: 'Voir', go: () => `renderPage('absences')` },
  'training':      { t: 'Formations prévues', cta: 'Voir', go: () => `eqOpen({ tab: 'formation' })` },
};

async function aicPerfMaj() {
  if (typeof perfMajTout !== 'function') return eqOpen({ tab: 'agents' });
  await perfMajTout(_perfMonthKey());
  AIC.loadedAt = 0; renderAiCockpit();
}

// ── Accueil ───────────────────────────────────────────────────
function _aicPaint() {
  const root = document.getElementById('aic-root');
  if (!root) return;
  const ia = AIC.conf?.has_key ?? (typeof aiUI !== 'undefined' && aiUI.conf?.has_key);
  const masques = _aicMasques();
  const items = _aicItems().filter(i => !masques[i.id]);
  const nDec = items.filter(i => i.lvl !== 'info').length;
  // Sous le « Bonjour » : la date, le périmètre et ce qui attend.
  const hero = document.getElementById('aic-hero');
  if (hero) {
    const date = new Date().toLocaleDateString((globalThis.PEAR_LOCALE || 'fr-FR'), { weekday: 'long', day: 'numeric', month: 'long' });
    hero.innerHTML = `${esc(date.charAt(0).toUpperCase() + date.slice(1))} · ${esc(_aicPerimetre())} · ${nDec
      ? `<b>${nDec} sujet${nDec > 1 ? 's' : ''} à décider</b>` : 'rien d\'urgent'}${AIC.loading ? ' · actualisation…' : ''}`;
  }
  const sug = [
    ['decision', 'Mes décisions de la semaine', { periode: 'Semaine', perimetre: _aicPerimetre() }],
    ['decision', 'Revue du mois', { periode: 'Mois', perimetre: _aicPerimetre() }],
    ['bilan-equipe', 'Bilan de l\'équipe', { pays: _aicPerimetre() }],
    ['insights', 'Insights des agents', {}],
  ];
  root.innerHTML = `
    ${ia ? `<div class="b3-quick">${sug.map(([id, t, f]) => `<button onclick="aiLaunchSkill('${id}', ${JSON.stringify(f).replace(/"/g, '&quot;')})">${typeof _aiIco === 'function' ? _aiIco('spark') : ''}${esc(t)}</button>`).join('')}</div>` : ''}
    <div class="b3-grid">
      ${_aicTodo(items, ia)}
      <div class="b3-col">${_aicToday()}${_aicTeam()}${_aicO2o()}</div>
    </div>
    ${_aicEpingles()}
    ${_aicTools(ia)}`;
}

// À décider : la seule liste de travail de l'accueil.
function _aicTodo(items, ia) {
  const f = AIC.filtre || 'todo';
  const vis = items.filter(i => f === 'all' ? true : f === 'todo' ? i.lvl !== 'info' : i.lvl === f);
  const nb = l => items.filter(i => i.lvl === l).length;
  const prio = (AIC.brief && AIC.brief.data && AIC.brief.data.priorites) || [];
  return `<section class="b3-card b3-todo">
    <header class="b3-card-h"><h2>À décider</h2>
      <div class="b3-tabs">${[['todo', 'À traiter', nb('urgent') + nb('todo')], ['urgent', 'Urgent', nb('urgent')], ['info', 'À savoir', nb('info')]]
        .map(([v, l, n]) => `<button class="${f === v ? 'is-on' : ''}" onclick="aicFiltre('${v}')">${l}<span>${n}</span></button>`).join('')}</div>
      ${ia ? `<button class="b3-ghost" onclick="aicBrief()" ${AIC.briefBusy ? 'disabled' : ''}>${AIC.briefBusy ? 'Classement…' : '✦ Prioriser'}</button>` : ''}
    </header>
    ${prio.length ? `<ol class="b3-prio">${prio.slice(0, 3).map(p => `<li><b>${esc(p.titre || '')}</b><span>${esc(p.action || '')}${p.delai ? ` · ${esc(p.delai)}` : ''}</span></li>`).join('')}</ol>`
      : AIC.briefErr ? `<p class="b3-msg is-bad">${esc(AIC.briefErr)}</p>` : ''}
    <ul class="hm-tasks">${vis.length ? vis.map(i => _aicLigne(i, ia)).join('')
      : `<li class="b3-empty">${AIC.loading ? 'Chargement…' : f === 'info' ? 'Rien à signaler.' : 'Tout est à jour. Rien à décider pour l\'instant.'}</li>`}</ul>
  </section>`;
}

// Aujourd'hui : les chiffres des opérations, une ligne chacun, cliquables.
function _aicToday() {
  const r = AIC.ops.resume || {};
  const row = (v, l, alerte) => `<button class="b3-kv${v && alerte ? ' is-alert' : ''}" onclick="renderPage('${_aicTracker()}')"><span>${l}</span><b>${v ?? '—'}</b></button>`;
  return `<section class="b3-card"><header class="b3-card-h"><h2>Opérations</h2><button class="b3-link" onclick="renderPage('${_aicTracker()}')">Tickets ↗</button></header>
    <div class="b3-kvs">${row(r.ouverts, 'Tickets ouverts')}${row(r.breach, 'En rupture de SLA', true)}${row(r.near, 'Proches de la rupture', true)}${row(r.p12, 'P1 / P2 ouverts', true)}${row(r.pannes, 'Pannes en cours', true)}</div></section>`;
}

// Équipe du jour : qui est en poste, qui est absent, ce qui attend côté absences.
function _aicTeam() {
  const auj = _aicAuj();
  const fos = new Set(typeof _eqFoList === 'function' ? _eqFoList() : []);
  const plan = (state.shiftsPlan || []).filter(s => s && s.date === auj && !s.is_rest && s.shift_id !== 'rest' && (!fos.size || fos.has(s.fo_name)));
  const absents = _aicAbsentsLe(auj);
  const dem = (AIC.abs || []).filter(a => a && a.status === 'Demandée' && (!fos.size || fos.has(a.fo_name)));
  const cren = {};
  plan.forEach(s => { const k = s.shift_name || s.shift_id || 'Shift'; (cren[k] = cren[k] || []).push(s.fo_name); });
  const prenom = n => esc(String(n).split(/\s+/)[0]);
  return `<section class="b3-card"><header class="b3-card-h"><h2>Équipe du jour</h2><button class="b3-link" onclick="renderPage('shift-planning')">Planning ↗</button></header>
    ${Object.keys(cren).length ? `<ul class="b3-shifts">${Object.entries(cren).map(([k, noms]) => `<li><span>${esc(k)}</span><b>${noms.map(prenom).join(', ')}</b></li>`).join('')}</ul>`
      : '<p class="b3-empty">Pas de planning saisi pour aujourd\'hui.</p>'}
    <div class="b3-kvs">
      <button class="b3-kv${absents.length ? ' is-warn' : ''}" onclick="renderPage('absences')"><span>Absents aujourd'hui${absents.length ? ` · ${absents.map(a => prenom(a.fo_name)).join(', ')}` : ''}</span><b>${absents.length}</b></button>
      <button class="b3-kv${dem.length ? ' is-warn' : ''}" onclick="renderPage('absences')"><span>Demandes d'absence à traiter</span><b>${dem.length}</b></button>
    </div></section>`;
}

// One-to-One : les points à suivre, en bref.
function _aicO2o() {
  const s = _aicSuivis();
  const l = _aicInquietudes().filter(c => !s[c.id]);
  return `<section class="b3-card"><header class="b3-card-h"><h2>One-to-One à suivre</h2>${l.length ? `<span class="b3-count">${l.length}</span>` : ''}</header>
    ${l.length ? `<ul class="b3-o2o">${l.slice(0, 4).map(c => `<li>
        <button onclick="eqOpen({ fo: ${_aicQ(c.fo)}, atab: 'o2o', asub: 'entretiens' })"><b>${esc(c.fo)}</b>
          <span>${esc((c.diff || c.dem || (c.actions[0] && c.actions[0].text) || 'Point de vigilance').slice(0, 90))}</span></button>
        <button class="b3-done" onclick="aicSuivi(${_aicQ(c.id)})" title="Je m'en suis occupé" aria-label="Marquer comme suivi">✓</button></li>`).join('')}</ul>
      ${l.length > 4 ? `<p class="b3-more">+ ${l.length - 4} autre(s)</p>` : ''}`
      : '<p class="b3-empty">Rien à suivre des derniers entretiens.</p>'}</section>`;
}

// Tous les outils, rangés par usage : un clic ouvre le formulaire à droite.
function _aicTools(ia) {
  const skills = (typeof aiUI !== 'undefined' && aiUI.skills) || [];
  if (!skills.length) return '';
  const ordre = ['Pilotage', 'Équipe', 'Rapports', 'Opérations', 'Outils'];
  const rang = x => { const k = ordre.indexOf(x.categorie); return k < 0 ? 99 : k; };
  const tri = [...skills].sort((x, y) => rang(x) - rang(y));
  return `<section class="b3-tools"><h2>Outils <small>ou tape / dans la saisie</small></h2>
    <div class="b3-tools-g">${tri.map(x => `<button class="b3-tool" onclick="aiPick('${x.id}')" ${ia || x.local ? '' : 'disabled'}>
        <span class="b3-tool-i">${typeof _aiIco === 'function' ? _aiIco(x.icone) : ''}</span>
        <span class="b3-tool-t"><em>${esc(x.categorie || 'Autres')}</em><b>${esc(x.titre)}</b><small>${esc(x.desc)}</small></span></button>`).join('')}</div>
  </section>`;
}



function _aicAbsentsLe(d) {
  const fos = new Set(typeof _eqFoList === 'function' ? _eqFoList() : []);
  return (AIC.abs || []).filter(a => a && ['Validée', 'Demandée'].includes(a.status)
    && (!fos.size || fos.has(a.fo_name)) && String(a.date_from || '') <= d && d <= String(a.date_to || a.date_from || ''));
}


const AIC_CHIP = { urgent: ['Urgent', 'is-bad'], todo: ['À décider', 'is-warn'], info: ['À savoir', 'is-info'] };
function _aicLigne(i, ia) {
  const A = AIC_ACTIONS[i.kind] || {};
  const g = i.agents ? i : null;
  const n = g ? g.agents.length : 0;
  const titre = A.t || i.txt;
  const go = A.go ? A.go(g || { agents: [{ fo: i.fo }] }) : (i.src === 'ops' && i.cible ? `renderPage('${esc(i.cible)}')` : '');
  const [cl, cc] = AIC_CHIP[i.lvl] || AIC_CHIP.info;
  const qui = i.src === 'ops' ? (i.detail || i.txt) : n === 1 ? `${g.agents[0].fo} · ${g.agents[0].txt}` : g ? g.agents.map(a => a.fo.split(/\s+/)[0]).join(', ') : '';
  const imp = AIC.impact[i.id];
  return `<li class="hm-task">
      <span class="hm-dot ${cc}"></span>
      <div class="hm-task-b"><b>${esc(titre)}</b>
        <div class="hm-chips"><span class="hm-chip ${cc}">${cl}</span>${n > 1 ? `<span class="hm-chip">${n} agents</span>` : ''}
          ${qui ? `<span class="hm-task-q" title="${esc(qui)}">${esc(qui)}</span>` : ''}</div>
        ${imp ? _aicImpactHtml(imp, i.id) : ''}</div>
      <div class="hm-task-a">
        ${ia && i.lvl !== 'info' && (i.src === 'ops' || n === 1) ? `<button class="hm-ic is-sm" onclick="aicImpact(${_aicQ(i.id)})" title="Impact si je ne fais rien ?" ${imp?.busy ? 'disabled' : ''}>${imp?.busy ? '…' : '?'}</button>` : ''}
        ${go ? `<button class="hm-btn" onclick="${go}">${esc(A.cta || 'Ouvrir')}</button>` : ''}
        <button class="hm-x" onclick="aicMasquer(${_aicQ(i.id)})" title="Masquer jusqu'à demain" aria-label="Masquer">×</button>
      </div></li>`;
}





function _aicImpactHtml(st, id) {
  if (st.busy) return `<div class="aic-imp is-busy">Évaluation de l'impact…</div>`;
  if (st.err) return `<div class="aic-imp is-err">${esc(st.err)}</div>`;
  const d = st.data;
  if (!d) return `<div class="aic-imp">${esc(st.content || '').replace(/\n/g, '<br>')}</div>`;
  const G = { forte: 'is-urgent', moyenne: 'is-todo', faible: 'is-info' };
  return `<div class="aic-imp">
      <div class="aic-imp-h"><span class="aic-pill ${G[d.gravite] || 'is-info'}">Gravité ${esc(d.gravite || '?')}</span>
        <span>${esc(d.resume || '')}</span>
        <button class="aic-x" onclick="aicImpactClose('${esc(id).replace(/'/g, "\\'")}')" aria-label="Fermer">×</button></div>
      ${(d.impacts || []).length ? `<ul>${d.impacts.map(x => `<li><b>${esc(x.sur || '')}</b> : ${esc(x.effet || '')}</li>`).join('')}</ul>` : ''}
      ${d.si_rien ? `<div class="aic-imp-l"><b>Si rien n'est fait :</b> ${esc(d.si_rien)}</div>` : ''}
      ${d.action ? `<div class="aic-imp-l"><b>À faire :</b> ${esc(d.action)}${d.delai ? ` <em>(${esc(d.delai)})</em>` : ''}</div>` : ''}
    </div>`;
}

function aicFiltre(v) { AIC.filtre = v; _aicPaint(); }

async function aicBrief() {
  AIC.briefBusy = true; AIC.briefErr = ''; _aicPaint();
  try {
    const equipe = AIC.team.map(a => ({ fo: a.fo, items: a.items.map(i => ({ lvl: i.lvl, kind: i.kind, txt: i.txt })) }))
      .filter(a => a.items.length);
    AIC.brief = await _aicPost('/api/ai/cockpit/brief', { equipe, country: _aicPays() });
    AIC.briefAt = new Date().toLocaleTimeString((globalThis.PEAR_LOCALE || 'fr-FR'), { hour: '2-digit', minute: '2-digit' });
  } catch (e) { AIC.briefErr = `Brief indisponible : ${e.message}`; }
  AIC.briefBusy = false; _aicPaint();
}

async function aicImpact(id) {
  const it = _aicItems().find(i => i.id === id);
  if (!it) return;
  AIC.impact[id] = { busy: true }; _aicPaint();
  try {
    const r = await _aicPost('/api/ai/cockpit/impact', { item: { lvl: it.lvl, kind: it.kind, txt: it.txt, detail: it.detail || '', fo: it.fo || '' } });
    AIC.impact[id] = { data: r.data, content: r.content };
  } catch (e) { AIC.impact[id] = { err: `Impact indisponible : ${e.message}` }; }
  _aicPaint();
}
function aicImpactClose(id) { delete AIC.impact[id]; _aicPaint(); }


// ── Résultats épinglés ────────────────────────────────────────
// Une réponse de skill épinglée depuis la conversation devient un widget :
// aperçu, date de mise à jour, et quatre gestes — actualiser (le skill
// repart avec les mêmes réglages, en arrière-plan), PDF, ouvrir, retirer.
function _aicDepuis(iso) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!(m >= 0)) return '';
  if (m < 1) return 'à l\'instant';
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return `le ${_aicDm(iso)}`;
}
function _aicEpingles() {
  const l = AIC.pins || [];
  if (!l.length) return '';
  return `<section class="hm-pins" aria-label="Résultats épinglés">${l.map(p => {
    const job = AIC.pinJobs[p.id];
    const sk = (typeof aiUI !== 'undefined' ? aiUI.skills || [] : []).find(x => x.id === p.skill);
    const chips = Object.entries(p.input || {})
      .filter(([k, v]) => v && typeof v === 'string' && v.length <= 30 && (!sk || (sk.champs || []).some(c => c.id === k && c.type !== 'textarea')))
      .map(([, v]) => `<span class="hm-chip">${esc(v)}</span>`).join('');
    const corps = job
      ? `<div class="hm-pin-run"><span class="bb-job-dot"></span><p>${esc(job.etape || 'Actualisation…')}</p></div>`
      : `<div class="hm-pin-b">${typeof _aiApercu === 'function' ? _aiApercu(p.resultat || {}) : ''}</div>`;
    const ico = { decision: 'decision', 'bilan-equipe': 'team', 'o2o-recap': 'list', recherche: 'search', o2o: 'user', weekly: 'chart' }[p.skill] || 'pin';
    return `<article class="hm-w is-pin" data-skill="${esc(p.skill)}">
      <div class="hm-w-h"><span class="hm-w-i">${typeof _aiIco === 'function' ? _aiIco(ico) : ''}</span>
        <div class="hm-pin-tt"><b>${esc(p.titre)}</b><small>${job ? 'Actualisation en cours…' : `Mis à jour ${esc(_aicDepuis(p.maj))}`}</small></div>
        <button class="hm-x hm-pin-x" onclick="aicPinRetirer('${p.id}')" title="Retirer de l'accueil" aria-label="Retirer">×</button></div>
      ${chips ? `<div class="hm-chips">${chips}</div>` : ''}
      ${corps}
      <div class="hm-pin-f">
        <button class="hm-pin-btn" onclick="aicPinOuvrir('${p.id}')">Ouvrir</button>
        <button class="hm-pin-btn" onclick="aicPinRefresh('${p.id}')" ${job ? 'disabled' : ''}>⟳ Actualiser</button>
        <button class="hm-pin-btn" onclick="aicPinPdf('${p.id}')">PDF</button>
      </div></article>`;
  }).join('')}</section>`;
}
const _aicPin = id => (AIC.pins || []).find(p => p.id === id);
function aicPinOuvrir(id) { if (typeof aiOuvrirEpingle === 'function') aiOuvrirEpingle(_aicPin(id)); }
async function aicPinRetirer(id) {
  const p = _aicPin(id);
  if (!p || !confirm(`Retirer « ${p.titre} » de l'accueil ?`)) return;
  const r = await fetch(`${API}/api/ai/pins/${id}`, { method: 'DELETE', headers: AdminSession.headers(), credentials: 'same-origin' });
  if (!r.ok) { if (typeof toast === 'function') toast('Retrait impossible', 'error'); return; }
  AIC.pins = AIC.pins.filter(x => x.id !== id);
  // La conversation d'origine peut de nouveau épingler cette réponse.
  if (typeof aiUI !== 'undefined') aiUI.convs.forEach(cv => cv.msgs.forEach(m => { if (m.epingle === id) delete m.epingle; }));
  _aicPaint();
}
function aicPinPdf(id) {
  const p = _aicPin(id);
  if (!p || typeof aiPdfMsg !== 'function') return;
  // Même export que depuis la conversation.
  aiPdfMsg({ role: 'assistant', ...(p.resultat || {}), skill: p.skill, input: p.input });
}
async function aicPinRefresh(id) {
  if (AIC.pinJobs[id]) return;
  try {
    const r = await _aicPost(`/api/ai/pins/${id}/refresh`, {});
    AIC.pinJobs[id] = { job: r.job.id, etape: r.job.etape };
  } catch (e) { if (typeof toast === 'function') toast(e.message, 'error'); return; }
  _aicPaint();
  _aicSuivrePins();
}
let _aicPinTimer = null;
function _aicSuivrePins() {
  if (_aicPinTimer) return;
  _aicPinTimer = setInterval(async () => {
    const ids = Object.keys(AIC.pinJobs);
    if (!ids.length) { clearInterval(_aicPinTimer); _aicPinTimer = null; return; }
    let fini = false;
    for (const id of ids) {
      const st = AIC.pinJobs[id];
      const j = await _aicGet(`/api/ai/jobs/${st.job}`).catch(() => null);
      if (!j) { delete AIC.pinJobs[id]; fini = true; continue; }
      if (j.etat === 'en_cours') {
        if (j.etape !== st.etape) { st.etape = j.etape; const el = document.querySelector(`.hm-pin-run p`); if (el) _aicPaint(); }
        continue;
      }
      delete AIC.pinJobs[id]; fini = true;
      if (j.etat === 'erreur' && typeof toast === 'function') toast(`Actualisation impossible : ${j.erreur}`, 'error');
    }
    if (fini) {
      const r = await _aicGet('/api/ai/pins').catch(() => null);
      if (r) AIC.pins = r.pins || [];
      _aicPaint();
    }
  }, 1200);
}
