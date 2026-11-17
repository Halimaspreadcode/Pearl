/* ══════════════════════════════════════════════════════════════
   ÉQUIPE (Admin › Équipe)

   Une seule entrée pour suivre les agents, sur deux niveaux :
     · l'équipe  — une carte par agent, ce qui demande une action, puis
                   les vues d'ensemble (Classement, Objectifs, One-to-One,
                   Tâches, Formation) ;
     · la fiche  — un agent, et tout ce qui le concerne, par onglet.

   Rien n'est réécrit : chaque onglet déplace dans #eq-mount le conteneur
   d'un écran existant (#page-cfg-perf, #page-cfg-o2o…) et appelle son
   rendu habituel, après avoir préréglé son sélecteur d'agent quand il en
   a un. Le style de ces écrans est ancré sur leur identifiant : un
   nœud déplacé garde le sien, donc son apparence. L'attribut data-eq
   posé sur le nœud dit dans quel rôle il est monté ; team.css s'en sert
   pour masquer ce que l'onglet rend redondant (titre, sélecteur d'agent).

   Les anciens noms de page (cfg-perf, cfg-o2o…) passent par
   eqLegacyRedirect(), appelé par page-dispatch.js : liens, boutons et
   raccourcis existants mènent à l'onglet correspondant.
   ══════════════════════════════════════════════════════════════ */

const EQ_TEAM_TABS = [
  { id: 'agents',     l: 'Vue d\'ensemble' },
  { id: 'classement', l: 'Classement', subs: [['rank', 'Classement'], ['trust', 'Trust Matrix']] },
  { id: 'objectifs',  l: 'Objectifs',  subs: [['suivi', 'Suivi'], ['approbations', 'Approbations'], ['sessions', 'Sessions']] },
  { id: 'o2o',        l: 'One-to-One' },
  { id: 'taches',     l: 'Tâches' },
  { id: 'formation',  l: 'Formation' },
];

const EQ_AGENT_TABS = [
  { id: 'perf',      l: 'Performance' },
  { id: 'objectifs', l: 'Objectifs',  subs: [['objectifs', 'Objectifs & approbations'], ['suivi', 'Suivi']] },
  { id: 'o2o',       l: 'One-to-One', subs: [['profil', 'Profil'], ['entretiens', 'Entretiens & plan']] },
  { id: 'taches',    l: 'Tâches' },
  { id: 'absences',  l: 'Absences' },
  { id: 'formation', l: 'Formation' },
];

// Anciennes pages, désormais montées dans un onglet. Tenue à jour ici et
// lue par page-dispatch.js : une seule liste, pas de copie à aligner.
const EQ_LEGACY_PAGES = ['cfg-myteam', 'cfg-perf', 'cfg-objectifs', 'cfg-o2o', 'cfg-assign', 'cfg-training'];

const EqUI = {
  view: 'team',            // 'team' | 'agent'
  tab: 'agents',           // onglet d'équipe
  sub: { classement: 'rank', objectifs: 'suivi' },
  fo: null,                // agent de la fiche
  atab: 'perf',            // onglet de la fiche
  asub: { objectifs: 'objectifs', o2o: 'profil' },
  q: '', filtre: 'tous',   // recherche et filtre de la grille
  pending: null,           // intention posée par eqOpen() avant renderPage
  hashRead: false,
  // Lectures faites à l'ouverture de la page. `null` = pas encore reçu :
  // les signaux correspondants sont omis plutôt que comptés à zéro.
  abs: null, trainings: null, objectives: null, summary: null, loadedAt: 0,
  // Réglages posés sur les écrans montés, à défaire en revenant à l'équipe.
  forced: {},
};

function _eqEl(id) { return document.getElementById(id); }

function _eqQ(s) { return escAttrArg(s); }

function _eqFoList() { return _perfFoList(); }

function _eqCtx() {
  return { objectives: EqUI.objectives, abs: EqUI.abs, trainings: EqUI.trainings };
}

// ── Navigation ────────────────────────────────────────────────
// Point d'entrée des liens internes : on pose l'intention, puis on passe
// par renderPage pour que toute la chaîne (barre latérale, présence,
// épingles, dernière page) suive comme pour n'importe quelle page.
function eqOpen(opts) {
  EqUI.pending = opts || { tab: 'agents' };
  window.renderPage('equipe');
}
function eqOpenAgent(fo, atab, asub) { eqOpen({ fo, atab, asub }); }
function eqBack() { eqOpen({ tab: 'agents' }); }

function _eqApply(p) {
  if (p.fo) {
    EqUI.view = 'agent';
    EqUI.fo = p.fo;
    EqUI.atab = EQ_AGENT_TABS.some(t => t.id === p.atab) ? p.atab : 'perf';
    if (p.asub) EqUI.asub[EqUI.atab] = p.asub;
  } else {
    EqUI.view = 'team';
    EqUI.tab = EQ_TEAM_TABS.some(t => t.id === p.tab) ? p.tab : 'agents';
    if (p.sub) EqUI.sub[EqUI.tab] = p.sub;
  }
}

function _eqActive() { return !!_eqEl('page-equipe')?.classList.contains('active'); }

// Ancienne page → onglet. Le contexte compte : depuis la fiche d'un
// agent, « Voir le suivi des objectifs » doit rester sur cet agent.
function eqLegacyRedirect(page) {
  const fo = (EqUI.view === 'agent' && _eqActive() && EqUI.fo) || null;
  let t = { tab: 'agents' };
  if (page === 'cfg-myteam')   t = { tab: 'classement', sub: 'rank' };
  if (page === 'cfg-assign')   t = { tab: 'taches' };
  if (page === 'cfg-training') t = { tab: 'formation' };
  if (page === 'cfg-o2o')      t = { tab: 'o2o' };
  if (page === 'cfg-objectifs') t = fo ? { fo, atab: 'objectifs', asub: 'suivi' } : { tab: 'objectifs', sub: 'suivi' };
  if (page === 'cfg-perf') {
    // Performance FO mêlait vues d'agent et vues d'équipe : l'onglet
    // demandé (perfUI.tab, que les appelants posent avant de naviguer)
    // dit laquelle on voulait.
    const pt = (typeof perfUI === 'object' && perfUI.tab) || 'note';
    if (pt === 'team') t = { tab: 'classement', sub: 'trust' };
    else if (pt === 'sessions') t = { tab: 'objectifs', sub: 'sessions' };
    else if (pt === 'review') t = fo ? { fo, atab: 'objectifs', asub: 'objectifs' } : { tab: 'objectifs', sub: 'approbations' };
    else {
      const cible = perfUI.fo || fo || _eqFoList()[0] || null;
      t = cible ? { fo: cible, atab: pt === 'o2o' ? 'o2o' : 'perf', asub: pt === 'o2o' ? 'entretiens' : undefined }
                : { tab: 'agents' };
    }
  }
  eqOpen(t);
}

// ── Adresse ───────────────────────────────────────────────────
// #equipe, #equipe/<onglet>, #equipe/<agent>[/<onglet>] : une fiche se
// partage et survit à un rechargement.
function _eqHash() {
  if (EqUI.view === 'agent' && EqUI.fo) {
    const sub = EQ_AGENT_TABS.find(t => t.id === EqUI.atab)?.subs ? `/${EqUI.asub[EqUI.atab]}` : '';
    return `#equipe/${encodeURIComponent(EqUI.fo)}/${EqUI.atab}${sub}`;
  }
  if (EqUI.tab === 'agents') return '#equipe';
  const sub = EQ_TEAM_TABS.find(t => t.id === EqUI.tab)?.subs ? `/${EqUI.sub[EqUI.tab]}` : '';
  return `#equipe/${EqUI.tab}${sub}`;
}

function _eqParseHash(h) {
  const m = /^#equipe(?:\/(.*))?$/.exec(h || '');
  if (!m) return null;
  const parts = (m[1] || '').split('/').map(s => { try { return decodeURIComponent(s); } catch (_) { return s; } });
  const p1 = parts[0] || '';
  if (!p1) return { tab: 'agents' };
  if (EQ_TEAM_TABS.some(t => t.id === p1)) return { tab: p1, sub: parts[1] || undefined };
  const fo = (state.config?.fo_list || []).find(f => _cfgFold(f) === _cfgFold(p1));
  return fo ? { fo, atab: parts[1] || 'perf', asub: parts[2] || undefined } : { tab: 'agents' };
}

function _eqWriteHash() {
  const h = _eqHash();
  if (location.hash === h) return;
  try { history.replaceState(null, '', location.pathname + location.search + h); } catch (_) {}
}

window.addEventListener('hashchange', () => {
  if (!/^#equipe(\/|$)/.test(location.hash)) return;
  if (location.hash === _eqHash() && _eqActive()) return;
  const p = _eqParseHash(location.hash);
  if (p) eqOpen(p);
});

// ── Rendu ─────────────────────────────────────────────────────
// Appelé par page-dispatch.js. `wasActive` : la page était déjà à
// l'écran (changement de pays, rechargement après une saisie) — on garde
// alors l'onglet ouvert au lieu de revenir à la grille.
async function renderEquipePage(wasActive) {
  const ok = await AdminSession.check();
  if (!ok) { window.renderPage('config'); return; }

  let p = EqUI.pending;
  EqUI.pending = null;
  if (!p && !EqUI.hashRead) p = _eqParseHash(location.hash);
  EqUI.hashRead = true;
  if (p) _eqApply(p);
  else if (!wasActive) _eqApply({ tab: 'agents' });

  // L'entrée de menu suit la page, y compris quand on y arrive par un
  // ancien lien ou la Vue d'ensemble : la présence lit ce libellé.
  document.querySelectorAll('.nav-item').forEach(n =>
    n.classList.toggle('active', n.dataset.page === 'equipe'));

  _eqRender();
}

async function _eqLoad() {
  EqUI.loadedAt = Date.now();
  const get = (url, h) => fetch(`${API}${url}`, { headers: h || {}, credentials: 'same-origin' })
    .then(r => r.ok ? r.json() : null).catch(() => null);
  const adm = AdminSession.headers();
  const year = _eqToday().slice(0, 4);
  const [abs, trn, obj, sum] = await Promise.all([
    get('/api/absences', adm), get('/api/trainings'),
    get('/api/objectives', adm), get(`/api/absences/summary?year=${year}`, adm),
  ]);
  if (Array.isArray(abs)) EqUI.abs = abs;
  if (Array.isArray(trn)) EqUI.trainings = trn;
  if (obj && obj.objectives) EqUI.objectives = obj.objectives;
  if (sum && Array.isArray(sum.balances)) EqUI.summary = sum;
  if (!_eqActive()) return;
  // On ne redessine que ce qui lit ces données : un écran monté peut
  // porter une saisie en cours. Le focus clavier est rendu à l'élément
  // redessiné qui le portait (onglet, bouton de l'en-tête).
  const focus = document.activeElement?.id;
  _eqRenderRail();
  _eqRenderHead();
  _eqRenderTabs();
  if (focus && /^eq-/.test(focus) && document.activeElement === document.body) _eqEl(focus)?.focus();
  if (EqUI.view === 'team' && EqUI.tab === 'agents') _eqRenderGrid();
  if (EqUI.view === 'agent' && ['absences', 'formation'].includes(EqUI.atab)) _eqRenderContent();
}

function _eqRender() {
  _eqRenderRail();
  _eqRenderHead();
  _eqRenderTabs();
  _eqRenderContent();
  _eqWriteHash();
  // Les lectures complémentaires ne bloquent pas l'affichage : la grille
  // et l'en-tête se complètent à leur arrivée. Relues à chaque changement
  // d'onglet (au plus toutes les 5 s) : une approbation ou une tâche
  // donnée dans un onglet doit se refléter dans l'en-tête et les cartes.
  if (Date.now() - EqUI.loadedAt > 5000) _eqLoad();
}

// ── Liste de gauche ───────────────────────────────────────────
// « Toute l'équipe » puis chaque agent, avec ce qui l'attend. Elle reste
// à l'écran : la sélection dit où l'on est, un clic change d'agent en
// gardant l'onglet ouvert (One-to-One de l'un → One-to-One de l'autre).
function eqRailSearch(v) { EqUI.railQ = v || ''; _eqRenderRail(); }
function _eqRenderRail() {
  const el = _eqEl('eq-rail-list');
  if (!el) return;
  const all = _eqOrdered();
  const mots = _cfgFold(EqUI.railQ || '').split(/\s+/).filter(Boolean);
  const list = !mots.length ? all : all.filter(s => {
    const toks = _cfgFold(s.fo).split(/[^a-z0-9]+/).filter(Boolean);
    return mots.every(m => toks.some(t => t.startsWith(m)));
  });
  const nAct = all.filter(s => s.actions).length;
  const tracker = fo => (state.config?.fo_trackers || {})[fo] || 'SN';
  const ouvrir = fo => EqUI.view === 'agent' ? `eqOpenAgent(${_eqQ(fo)},'${EqUI.atab}')` : `eqOpenAgent(${_eqQ(fo)})`;
  el.innerHTML = `<button type="button" class="eq-rail-item is-team${EqUI.view === 'team' ? ' is-on' : ''}" onclick="eqBack()" aria-current="${EqUI.view === 'team' ? 'page' : 'false'}">
      <span class="eq-rail-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/></svg></span>
      <span class="eq-rail-t"><b>Toute l'équipe</b><small>${all.length} agent${all.length > 1 ? 's' : ''}</small></span>
      ${nAct ? `<span class="eq-rail-n">${nAct}</span>` : ''}
    </button>
    <div class="eq-rail-h">Agents</div>
    ${list.length ? list.map(s => {
      const on = EqUI.view === 'agent' && EqUI.fo === s.fo;
      const urg = s.items.some(x => x.lvl === 'urgent');
      const n = s.items.filter(x => x.lvl !== 'info').length;
      return `<button type="button" class="eq-rail-item${on ? ' is-on' : ''}" onclick="${ouvrir(s.fo)}" aria-current="${on ? 'page' : 'false'}">
        <span class="eq-av" style="background:${foAvatarColor(s.fo)}" aria-hidden="true">${esc(foInitials(s.fo))}</span>
        <span class="eq-rail-t"><b>${esc(s.fo)}</b><small>${esc(tracker(s.fo))}${s.stats.score != null ? ` · note ${s.stats.score}` : ''}</small></span>
        ${n ? `<span class="eq-rail-n${urg ? ' is-urgent' : ''}" title="${n} action${n > 1 ? 's' : ''} à faire">${n}</span>` : '<span class="eq-rail-ok" title="À jour">✓</span>'}
      </button>`;
    }).join('') : '<p class="eq-rail-e">Aucun agent ne correspond.</p>'}`;
}

// Fil d'Ariane : Équipe › Agent › Onglet. Chaque étape est cliquable.
function _eqCrumb() {
  const tabs = EqUI.view === 'agent' ? EQ_AGENT_TABS : EQ_TEAM_TABS;
  const t = tabs.find(x => x.id === _eqCurTab());
  const sub = t && t.subs ? t.subs.find(([id]) => id === (EqUI.view === 'agent' ? EqUI.asub[EqUI.atab] : EqUI.sub[EqUI.tab])) : null;
  const parts = [`<button type="button" onclick="eqBack()">Équipe</button>`];
  if (EqUI.view === 'agent') parts.push(`<button type="button" onclick="eqAgentTab('perf')">${esc(EqUI.fo)}</button>`);
  else parts.push('<span>Toute l\'équipe</span>');
  if (t) parts.push(`<span>${esc(t.l)}${sub && sub[1] !== t.l ? ` · ${esc(sub[1])}` : ''}</span>`);
  return `<nav class="eq-crumb" aria-label="Vous êtes ici">${parts.join('<i>›</i>')}</nav>`;
}

// ── En-tête ───────────────────────────────────────────────────
function _eqRenderHead() {
  const el = _eqEl('eq-head');
  if (!el) return;
  if (EqUI.view === 'team') {
    const all = _eqOrdered();
    const nAct = all.filter(s => s.actions).length;
    el.innerHTML = `${_eqCrumb()}<div class="eq-head eq-head-team">
      <span class="eq-team-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/></svg></span>
      <div>
        <h1 class="page-title">Toute l'équipe</h1>
        <div class="page-sub">${all.length} agents · ${nAct ? `${nAct} demande${nAct > 1 ? 'nt' : ''} une action` : 'tout le monde est à jour'} · choisis un agent à gauche pour ouvrir sa fiche</div>
      </div>
    </div>`;
    return;
  }
  const fo = EqUI.fo;
  const s = eqAgentSignals(fo, _eqCtx());
  const st = s.stats;
  const tracker = (state.config?.fo_trackers || {})[fo] || 'SN';
  // Précédent / suivant dans l'ordre de la grille : on traite la liste
  // des urgences sans repasser par l'équipe entre deux fiches.
  const ordre = _eqOrdered().map(x => x.fo);
  const i = ordre.indexOf(fo);
  const prev = i > 0 ? ordre[i - 1] : null;
  const next = i > -1 && i < ordre.length - 1 ? ordre[i + 1] : null;
  const bal = EqUI.summary?.balances?.find(b => b.fo_name === fo);
  const stat = (v, l) => `<div class="eq-stat"><div class="eq-stat-v">${v}</div><div class="eq-stat-l">${esc(l)}</div></div>`;
  const actions = s.items.filter(x => x.lvl !== 'info');

  el.innerHTML = `<div class="eq-fiche-nav">
      ${_eqCrumb()}
      <span class="eq-fiche-step">
        <button type="button" class="eq-icon-btn" ${prev ? `onclick="eqOpenAgent(${_eqQ(prev)},'${EqUI.atab}')"` : 'disabled'}
                aria-label="Agent précédent${prev ? ' : ' + esc(prev) : ''}" title="${prev ? esc(prev) : ''}">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg></button>
        <span class="eq-fiche-pos">${i + 1} / ${ordre.length}</span>
        <button type="button" class="eq-icon-btn" ${next ? `onclick="eqOpenAgent(${_eqQ(next)},'${EqUI.atab}')"` : 'disabled'}
                aria-label="Agent suivant${next ? ' : ' + esc(next) : ''}" title="${next ? esc(next) : ''}">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg></button>
      </span>
    </div>
    <div class="eq-fiche">
      <span class="eq-av eq-av-lg" style="background:${foAvatarColor(fo)}" aria-hidden="true">${esc(foInitials(fo))}</span>
      <div class="eq-fiche-id">
        <h1 class="page-title">${esc(fo)}</h1>
        <div class="eq-fiche-role">Front Office · ${esc(tracker)}${st.absentJusqua ? ` · <span class="eq-tag">absent jusqu'au ${esc(_eqDm(st.absentJusqua))}</span>` : ''}</div>
        ${actions.length ? `<div class="eq-fiche-sig">${actions.map(x =>
          `<button type="button" class="eq-chip is-${x.lvl}" onclick="eqAgentTab('${x.atab}'${x.asub ? `,'${x.asub}'` : ''})">${esc(x.txt)}</button>`).join('')}</div>`
          : `<div class="eq-fiche-sig"><span class="eq-chip is-ok">✓ À jour</span></div>`}
      </div>
      <div class="eq-stats">
        ${stat(st.score === null ? '—' : st.score, `note de ${_eqMonthLabel(st.mois)}`)}
        ${stat(`${st.objActifs}${st.objRetard ? ` <small>· ${st.objRetard} en retard</small>` : ''}`, st.objDepuisPlan ? 'objectifs du plan 1:1' : 'objectifs actifs')}
        ${stat(st.o2oJours === null ? '—' : `${st.o2oJours} j`, 'depuis le dernier One-to-One')}
        ${stat(st.tachesOuvertes, 'tâches ouvertes')}
        ${stat(bal ? bal.remaining : '…', 'jours de congé restants')}
      </div>
    </div>`;
}

// ── Onglets ───────────────────────────────────────────────────
function _eqTabsDef() { return EqUI.view === 'agent' ? EQ_AGENT_TABS : EQ_TEAM_TABS; }
function _eqCurTab() { return EqUI.view === 'agent' ? EqUI.atab : EqUI.tab; }

function _eqTeamBadge(id, all) {
  let n = 0;
  if (id === 'agents')    n = all.filter(s => s.actions).length;
  if (id === 'objectifs') n = all.reduce((k, s) => k + s.stats.objAttente, 0);
  if (id === 'o2o')       n = all.filter(s => s.items.some(x => x.kind === 'o2o-none' || x.kind === 'o2o-old')).length;
  if (id === 'taches')    n = all.reduce((k, s) => k + s.stats.tachesRetard, 0);
  return n;
}

function _eqRenderTabs() {
  const el = _eqEl('eq-tabs');
  if (!el) return;
  const cur = _eqCurTab();
  const fn = EqUI.view === 'agent' ? 'eqAgentTab' : 'eqTeamTab';
  const all = EqUI.view === 'team' ? _eqOrdered() : null;
  el.setAttribute('aria-label', EqUI.view === 'agent' ? `Fiche de ${EqUI.fo}` : 'Équipe');
  el.innerHTML = _eqTabsDef().map(t => {
    const on = t.id === cur;
    const n = all ? _eqTeamBadge(t.id, all) : 0;
    return `<button type="button" class="eq-tab${on ? ' is-on' : ''}" role="tab" id="eq-tab-${t.id}"
        aria-selected="${on}" aria-controls="eq-panel" tabindex="${on ? 0 : -1}"
        onclick="${fn}('${t.id}')" onkeydown="_eqTabKey(event)">${esc(t.l)}${n
          ? `<span class="eq-badge">${n}</span>` : ''}</button>`;
  }).join('');
  _eqEl('eq-panel')?.setAttribute('aria-labelledby', `eq-tab-${cur}`);
}

// Clavier des listes d'onglets (WAI-ARIA) : flèches, Début, Fin. Le
// focus suit l'onglet activé, qui se redessine.
function _eqTabKey(e) {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!keys.includes(e.key)) return;
  const list = e.currentTarget.closest('[role="tablist"]');
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const i = tabs.indexOf(e.currentTarget);
  const j = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1
    : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  e.preventDefault();
  const id = tabs[j].id;
  tabs[j].click();
  document.getElementById(id)?.focus();
}

function eqTeamTab(id) { EqUI.view = 'team'; EqUI.tab = id; _eqRender(); }
function eqAgentTab(id, sub) {
  EqUI.atab = id;
  if (sub) EqUI.asub[id] = sub;
  _eqRender();
}
function eqSub(id) {
  if (EqUI.view === 'agent') EqUI.asub[EqUI.atab] = id; else EqUI.sub[EqUI.tab] = id;
  _eqRender();
}

function _eqRenderSub(def, cur) {
  const el = _eqEl('eq-sub');
  if (!el) return;
  if (!def || !def.subs) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="eq-seg eq-subtabs" role="tablist" aria-label="${esc(def.l)}">${def.subs.map(([id, l]) => {
    const on = id === cur;
    return `<button type="button" role="tab" id="eq-sub-${id}" class="${on ? 'is-on' : ''}" aria-selected="${on}"
      tabindex="${on ? 0 : -1}" onclick="eqSub('${id}')" onkeydown="_eqTabKey(event)">${esc(l)}</button>`;
  }).join('')}</div>`;
}

// ── Montage des écrans existants ──────────────────────────────
function _eqMount(page, role) {
  const node = _eqEl('page-' + page);
  const host = _eqEl('eq-mount');
  if (!node || !host) return null;
  if (node.parentNode !== host) host.appendChild(node);
  node.dataset.eq = role;
  node.classList.add('active');
  return node;
}

function _eqUnmountAll() {
  const host = _eqEl('eq-mount');
  if (!host) return;
  host.querySelectorAll(':scope > .page').forEach(p => {
    p.classList.remove('active');
    delete p.dataset.eq;
  });
}

// Défait les préréglages de fiche avant une vue d'équipe : revenir à
// « Tâches » ne doit pas laisser la liste filtrée sur le dernier agent vu.
function _eqReleaseForced() {
  const f = EqUI.forced;
  if (f.objRev) { ObjRev.fFo = ''; ObjRev.tab = 'pending'; }
  if (f.objTrack) { ObjTrack.fo = ''; ObjTrack.view = 'retard'; }
  if (f.o2o) o2osUI.tab = 'bilan';
  if (f.asg) {
    asgPicked = new Set();
    const sel = _eqEl('asg-filter-fo');
    if (sel) sel.value = '';
  }
  EqUI.forced = {};
}

function _eqRenderContent() {
  const own = _eqEl('eq-own');
  const agents = _eqEl('eq-agents');
  _eqUnmountAll();
  if (own) own.innerHTML = '';
  if (agents) agents.hidden = true;

  if (EqUI.view === 'team') {
    const def = EQ_TEAM_TABS.find(t => t.id === EqUI.tab);
    const sub = EqUI.sub[EqUI.tab];
    _eqRenderSub(def, sub);
    _eqReleaseForced();
    switch (EqUI.tab) {
      case 'agents':
        if (agents) agents.hidden = false;
        _eqRenderGrid();
        // Fiches de performance dont les mesures ont bougé depuis la notation.
        if (own && typeof perfMajPanelHtml === 'function') {
          own.innerHTML = perfMajPanelHtml();
          // L'assiduité du mois se charge à part : une fois là, on recompte.
          if (typeof loadAttendanceScores === 'function' && state.attendanceMonth !== _perfMonthKey() && !EqUI._assiduiteDemandee) {
            EqUI._assiduiteDemandee = true;
            loadAttendanceScores(_perfMonthKey()).then(() => { if (EqUI.view === 'team' && EqUI.tab === 'agents') _eqRenderContent(); });
          }
        }
        break;
      case 'classement':
        if (sub === 'trust') { perfUI.tab = 'team'; _eqMount('cfg-perf', 'team-trust'); renderPerfPage(); }
        else { _eqMount('cfg-myteam', 'team'); renderMyTeam(); }
        break;
      case 'objectifs':
        if (sub === 'approbations' || sub === 'sessions') {
          perfUI.tab = sub === 'sessions' ? 'sessions' : 'review';
          _eqMount('cfg-perf', 'team-' + perfUI.tab);
          renderPerfPage();
        } else { _eqMount('cfg-objectifs', 'team'); renderObjTrack(); }
        break;
      case 'o2o':
        _eqMount('cfg-o2o', 'team');
        setO2OSTab(o2osUI.tab || 'bilan');
        break;
      case 'taches':
        _eqMount('cfg-assign', 'team');
        renderAssignPage();
        break;
      case 'formation':
        _eqMount('cfg-training', 'team');
        renderTrainingAgenda();
        break;
    }
    return;
  }

  // ── Fiche agent ──
  const fo = EqUI.fo;
  const def = EQ_AGENT_TABS.find(t => t.id === EqUI.atab);
  const sub = EqUI.asub[EqUI.atab];
  _eqRenderSub(def, sub);

  if (!(state.config?.fo_list || []).includes(fo)) {
    if (own) own.innerHTML = `<div class="eq-note">« ${esc(fo)} » ne fait plus partie de l'équipe.
      <button type="button" class="eq-btn" onclick="eqBack()">Retour à l'équipe</button></div>`;
    return;
  }
  // Performance, One-to-One et Tâches suivent le sélecteur Global/SN/CI :
  // un agent hors périmètre y serait remplacé en silence par un autre.
  const horsScope = !_eqFoList().includes(fo);
  const scopeNote = () => {
    if (own) own.innerHTML = `<div class="eq-note">${esc(fo)} n'est pas dans le périmètre
      ${esc(getActiveCountry())} affiché. <button type="button" class="eq-btn"
      onclick="setActiveCountry('ALL')">Afficher tous les pays</button></div>`;
  };

  switch (EqUI.atab) {
    case 'perf':
      if (horsScope) { scopeNote(); break; }
      perfUI.fo = fo; perfUI.tab = 'note';
      _eqMount('cfg-perf', 'agent-note');
      renderPerfPage();
      break;
    case 'objectifs':
      if (sub === 'suivi') {
        ObjTrack.fo = fo; ObjTrack.view = 'tous'; EqUI.forced.objTrack = true;
        _eqMount('cfg-objectifs', 'agent');
        renderObjTrack();
      } else {
        if (horsScope) { scopeNote(); break; }
        // Ce qui attend une décision d'abord, s'il y en a ; sinon la
        // liste complète des objectifs de l'agent, KPIs et jalons compris.
        if (ObjRev.fFo !== fo) {
          const attente = _objRevPending({ [fo]: _eqObjectivesOf(fo, _eqCtx()) }).length;
          ObjRev.tab = attente ? 'pending' : 'all';
        }
        ObjRev.fFo = fo; ObjRev.q = ''; ObjRev.fState = ''; ObjRev.fProg = '';
        EqUI.forced.objRev = true;
        perfUI.fo = fo; perfUI.tab = 'review';
        _eqMount('cfg-perf', 'agent-review');
        renderPerfPage();
      }
      break;
    case 'o2o':
      if (horsScope) { scopeNote(); break; }
      if (sub === 'entretiens') {
        perfUI.fo = fo; perfUI.tab = 'o2o';
        _eqMount('cfg-perf', 'agent-o2o');
        renderPerfPage();
      } else {
        o2osUI.fo = fo; EqUI.forced.o2o = true;
        _eqMount('cfg-o2o', 'agent');
        setO2OSTab('profil');
      }
      break;
    case 'taches': {
      if (horsScope) { scopeNote(); break; }
      // Le composeur s'ouvre destiné à l'agent, la liste filtrée sur lui :
      // assigner et relire ce qui a été donné se font au même endroit.
      if (!EqUI.forced.asg || EqUI.forced.asg !== fo) asgPicked = new Set([fo]);
      EqUI.forced.asg = fo;
      _eqMount('cfg-assign', 'agent');
      renderAssignPage();
      const sel = _eqEl('asg-filter-fo');
      if (sel) { sel.value = fo; _asgRenderList(); }
      break;
    }
    case 'absences':
      _eqRenderAbsences(fo);
      break;
    case 'formation':
      _eqRenderFormation(fo);
      break;
  }
}

// ── Grille des agents ─────────────────────────────────────────
function _eqOrdered() { return eqTeamSignals(_eqFoList(), _eqCtx()); }

function eqOnSearch(v) { EqUI.q = v || ''; _eqRenderGrid(); }
function eqSetFilter(f) { EqUI.filtre = f; _eqRenderGrid(); }

function _eqRenderGrid() {
  const grid = _eqEl('eq-grid');
  if (!grid) return;
  const q = _eqEl('eq-q');
  if (q && q.value !== EqUI.q && document.activeElement !== q) q.value = EqUI.q;

  const all = _eqOrdered();
  const aTraiter = all.filter(s => s.actions);
  const n = { tous: all.length, action: aTraiter.length, ok: all.length - aTraiter.length };
  const fEl = _eqEl('eq-filter');
  if (fEl) fEl.innerHTML = [['tous', 'Tous'], ['action', 'À traiter'], ['ok', 'À jour']].map(([id, l]) =>
    `<button type="button" class="${EqUI.filtre === id ? 'is-on' : ''}" aria-pressed="${EqUI.filtre === id}"
      onclick="eqSetFilter('${id}')">${l}<span>${n[id]}</span></button>`).join('');

  const sum = _eqEl('eq-summary');
  if (sum) {
    const urgents = all.filter(s => s.items.some(x => x.lvl === 'urgent')).length;
    const scope = getActiveCountry();
    sum.textContent = !all.length ? ''
      : aTraiter.length
        ? `${aTraiter.length === 1 ? '1 agent demande' : `${aTraiter.length} agents demandent`} une action`
          + ` sur ${all.length}${urgents ? ` · ${urgents} avec une échéance dépassée` : ''}`
          + (scope !== 'ALL' ? ` · périmètre ${scope}` : '')
        : `Toute l'équipe est à jour (${all.length} agents${scope !== 'ALL' ? `, périmètre ${scope}` : ''}).`;
  }

  const mots = _cfgFold(EqUI.q).split(/\s+/).filter(Boolean);
  let list = all;
  if (mots.length) list = list.filter(s => {
    const toks = _cfgFold(s.fo).split(/[^a-z0-9]+/).filter(Boolean);
    return mots.every(m => toks.some(t => t.startsWith(m)));
  });
  if (EqUI.filtre === 'action') list = list.filter(s => s.actions);
  if (EqUI.filtre === 'ok') list = list.filter(s => !s.actions);

  if (!all.length) {
    const scope = getActiveCountry();
    grid.innerHTML = `<div class="eq-empty">${scope === 'ALL'
      ? 'Aucun agent configuré — l\'équipe se compose dans Paramétrage › Général.'
      : `Aucun agent rattaché à ${esc(scope)}.`}</div>`;
    return;
  }
  if (!list.length) {
    grid.innerHTML = `<div class="eq-empty">Aucun agent ne correspond.</div>`;
    return;
  }
  grid.innerHTML = list.map(_eqCard).join('');
}

const EQ_DOT = {
  urgent: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m1 15h-2v-2h2zm0-4h-2V7h2z"/></svg>',
  todo:   '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16m.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>',
  info:   '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20m0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16"/></svg>',
};
const EQ_LVL_LABEL = { urgent: 'Échéance dépassée', todo: 'À faire', info: 'Information' };

function _eqCard(s) {
  const fo = s.fo;
  const st = s.stats;
  const tracker = (state.config?.fo_trackers || {})[fo] || 'SN';
  const top = s.items.find(x => x.lvl !== 'info');
  const urg = s.items.filter(x => x.lvl === 'urgent').length;
  const etat = s.actions
    ? `<span class="eq-state is-${urg ? 'urgent' : 'todo'}">${_eqPlural(s.actions, 'action')}</span>`
    : `<span class="eq-state is-ok">✓ À jour</span>`;
  const lignes = s.items.slice(0, 5).map(x =>
    `<span class="eq-sig is-${x.lvl}"><span class="eq-sig-i" title="${EQ_LVL_LABEL[x.lvl]}">${EQ_DOT[x.lvl]}</span>
      <span class="eq-sig-t"><span class="eq-sr">${EQ_LVL_LABEL[x.lvl]} : </span>${esc(x.txt)}</span></span>`).join('');
  const reste = s.items.length > 5 ? `<span class="eq-sig-more">+${s.items.length - 5} autre(s)</span>` : '';
  // La carte ouvre la fiche sur l'onglet de ce qui presse le plus.
  const arg = top ? `,'${top.atab}'${top.asub ? `,'${top.asub}'` : ''}` : '';
  return `<button type="button" class="eq-card" onclick="eqOpenAgent(${_eqQ(fo)}${arg})"
      aria-label="${esc(fo)} — ${s.actions ? _eqPlural(s.actions, 'action') + ' à traiter' : 'à jour'}. Ouvrir la fiche">
    <span class="eq-card-top">
      <span class="eq-av" style="background:${foAvatarColor(fo)}" aria-hidden="true">${esc(foInitials(fo))}</span>
      <span class="eq-card-id">
        <span class="eq-card-n">${esc(fo)}</span>
        <span class="eq-card-m">${esc(tracker)} · note ${st.score === null ? '—' : st.score}</span>
      </span>
      ${etat}
    </span>
    ${lignes || reste ? `<span class="eq-sigs">${lignes}${reste}</span>` : ''}
  </button>`;
}

// ── Fiche › Absences ──────────────────────────────────────────
// La page Absences reste l'endroit où l'on valide et saisit ; la fiche
// montre les soldes et l'historique de l'agent, lus sur les mêmes routes
// (une session admin y est admise, voir requireAbsence).
function _eqRenderAbsences(fo) {
  const own = _eqEl('eq-own');
  if (!own) return;
  if (!EqUI.abs || !EqUI.summary) {
    own.innerHTML = `<div class="eq-card-sec"><div class="eq-muted">${EqUI.loadedAt ? 'Chargement…' : ''}</div></div>`;
    if (!EqUI.loadedAt) _eqLoad();
    return;
  }
  const bal = EqUI.summary.balances.find(b => b.fo_name === fo);
  const today = _eqToday();
  const year = today.slice(0, 4);
  const mine = EqUI.abs.filter(a => a.fo_name === fo
    && (String(a.date_to || '') >= `${year}-01-01` || a.date_to >= today))
    .sort((a, b) => String(b.date_from).localeCompare(String(a.date_from)));
  const tile = (v, l, cls) => `<div class="eq-tile${cls ? ' is-' + cls : ''}"><div class="eq-tile-v">${v}</div><div class="eq-tile-l">${esc(l)}</div></div>`;
  const statut = s => `<span class="eq-status is-${s === 'Validée' ? 'ok' : s === 'Demandée' ? 'todo' : 'off'}">${esc(s || '—')}</span>`;

  own.innerHTML = `
    <div class="eq-card-sec">
      <div class="eq-sec-h">
        <div>
          <h2 class="eq-sec-t">Soldes ${esc(year)}</h2>
          <p class="eq-sec-d">Jours ouvrés. Seules les absences validées entament le droit à congés.</p>
        </div>
        <button type="button" class="eq-btn" onclick="window.renderPage('absences')">Gérer dans Absences →</button>
      </div>
      ${bal ? `<div class="eq-tiles">
        ${tile(bal.entitlement, 'droit annuel')}
        ${tile(bal.taken, 'pris')}
        ${tile(bal.pending, 'demandés, non validés', bal.pending ? 'todo' : '')}
        ${tile(bal.remaining, 'restants', bal.remaining < 0 ? 'urgent' : '')}
        ${tile(bal.sick_days, 'jours de maladie')}
        ${tile(bal.episodes, 'épisodes')}
      </div>` : `<div class="eq-muted">Pas de solde pour cet agent.</div>`}
    </div>
    <div class="eq-card-sec">
      <h2 class="eq-sec-t">Absences ${esc(year)} et à venir</h2>
      ${mine.length ? `<div class="table-wrap eq-table"><table>
        <thead><tr><th>Type</th><th>Du</th><th>Au</th><th>Statut</th><th>Préavis</th><th>Motif</th></tr></thead>
        <tbody>${mine.map(a => `<tr${a.date_from <= today && a.date_to >= today ? ' class="is-now"' : ''}>
          <td>${esc(a.type || '')}${a.half_day ? ' <small>(½ j)</small>' : ''}</td>
          <td>${esc(_eqDmy(a.date_from))}</td><td>${esc(_eqDmy(a.date_to))}</td>
          <td>${statut(a.status)}</td><td>${esc(a.notice || '—')}</td><td>${esc(a.reason || '')}</td>
        </tr>`).join('')}</tbody></table></div>`
        : `<div class="eq-muted">Aucune absence enregistrée cette année.</div>`}
    </div>`;
}

function _eqDmy(iso) {
  const s = String(iso || '');
  return s.length >= 10 ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : s;
}

// ── Fiche › Formation ─────────────────────────────────────────
// L'agenda n'a pas de liste de participants, seulement un texte libre :
// on distingue ce qui nomme l'agent du reste du programme, sans prétendre
// savoir qui assiste à une session « équipe ».
function _eqRenderFormation(fo) {
  const own = _eqEl('eq-own');
  if (!own) return;
  if (!EqUI.trainings) {
    own.innerHTML = `<div class="eq-card-sec"><div class="eq-muted">${EqUI.loadedAt ? 'Chargement…' : ''}</div></div>`;
    if (!EqUI.loadedAt) _eqLoad();
    return;
  }
  const today = _eqToday();
  const list = EqUI.trainings.slice().sort((a, b) =>
    (a.date + (a.start_time || '')).localeCompare(b.date + (b.start_time || '')));
  const aVenir = list.filter(t => t.date >= today);
  const passees = list.filter(t => t.date < today && _eqTrainingConcerns(t, fo)).reverse();
  const absForm = (EqUI.abs || []).filter(a => a.fo_name === fo && /formation/i.test(a.type || '')
    && a.status !== 'Refusée').sort((a, b) => String(b.date_from).localeCompare(String(a.date_from)));

  const row = t => {
    const moi = _eqTrainingConcerns(t, fo);
    return `<div class="eq-trn${moi ? ' is-me' : ''}">
      <div class="eq-trn-d"><b>${esc(_eqDm(t.date))}</b><small>${esc([t.start_time, t.end_time].filter(Boolean).join('–'))}</small></div>
      <div class="eq-trn-b">
        <div class="eq-trn-t">${esc(t.title || '')} ${moi ? '<span class="eq-tag is-pri">concerné·e</span>' : ''}</div>
        <div class="eq-trn-m">${esc([t.trainer, t.location, t.audience].filter(Boolean).join(' · '))}</div>
      </div>
    </div>`;
  };
  own.innerHTML = `
    <div class="eq-card-sec">
      <div class="eq-sec-h">
        <div>
          <h2 class="eq-sec-t">Sessions à venir</h2>
          <p class="eq-sec-d">Tout le programme ; les sessions dont les participants nomment ${esc(fo)} sont marquées.</p>
        </div>
        <button type="button" class="eq-btn" onclick="eqOpen({tab:'formation'})">Gérer l'agenda →</button>
      </div>
      ${aVenir.length ? `<div class="eq-trns">${aVenir.map(row).join('')}</div>`
        : '<div class="eq-muted">Aucune session planifiée.</div>'}
    </div>
    ${passees.length ? `<div class="eq-card-sec"><h2 class="eq-sec-t">Sessions suivies</h2>
      <div class="eq-trns">${passees.map(row).join('')}</div></div>` : ''}
    ${absForm.length ? `<div class="eq-card-sec"><h2 class="eq-sec-t">Absences pour formation</h2>
      <div class="eq-trns">${absForm.map(a => `<div class="eq-trn">
        <div class="eq-trn-d"><b>${esc(_eqDm(a.date_from))}</b><small>→ ${esc(_eqDm(a.date_to))}</small></div>
        <div class="eq-trn-b"><div class="eq-trn-t">${esc(a.reason || a.type)}</div>
        <div class="eq-trn-m">${esc(a.status || '')}</div></div></div>`).join('')}</div></div>` : ''}`;
}

// ── Vue d'ensemble ────────────────────────────────────────────
// État de la carte « Équipe » du sommaire, sur les seules données déjà
// chargées (voir _cfgEtat).
function eqHubEtat() {
  const foList = (typeof _perfFoList === 'function') ? _perfFoList() : [];
  if (!foList.length) return null;
  const all = eqTeamSignals(foList, _eqCtx());
  const n = all.filter(s => s.actions).length;
  return n ? { t: all.some(s => s.items.some(x => x.lvl === 'urgent')) ? 'bad' : 'warn', txt: `${n} à traiter` }
           : { t: 'ok', txt: 'à jour' };
}
