/* ══════════════════════════════════════════════════════════════
   MY SPACE (page « mon-espace ») — l'espace personnel de l'agent

   Les écrans personnels (My Tasks, My Requests, My Performance avec les
   objectifs, Quiz) étaient rangés dans « Operational » au milieu des
   écrans d'équipe. Ils sont réunis ici derrière une seule entrée, juste
   après Dashboard :
     · Today       — ce qu'il faut faire maintenant, un bouton par ligne,
                     puis quatre repères (mois, shift, objectifs, semaine) ;
     · les onglets — les écrans existants, montés tels quels.

   Même démarche que les pages Équipe et Rapports : chaque onglet déplace
   dans #mes-mount le conteneur d'un écran (#page-weekly-progress…) et
   appelle son rendu habituel. Le style de ces écrans est ancré sur leur
   identifiant, qui ne change pas ; mon-espace.css masque ce que
   l'en-tête commun rend redondant (titre, sélecteur d'agent).

   Qui voit quoi : comme pour Rapports, chaque onglet suit la règle de son
   ANCIENNE entrée de menu (weekly-progress, my-requests, my-perf, quiz) —
   vue du profil, pages réservées. Les réglages déjà enregistrés gardent
   leur sens sans migration ; l'entrée My Space s'affiche dès qu'un
   onglet est permis (mesNavVisible, appelée par applyNavMode).

   Identité : celle du profil (identity.js), rappelée une fois dans
   l'en-tête. La note et les objectifs restent derrière le code personnel
   de l'agent : le formulaire d'accès de My Performance est simplement
   prérempli avec son ID, il ne reste que le code à taper. Le serveur
   vérifie toujours la paire ID + code.

   Les anciens noms de page passent par mesLegacyRedirect(), appelé par
   page-dispatch.js : liens, rappels de la cloche et épingles existants
   mènent au bon onglet. Adresse : #mon-espace/<onglet>.
   ══════════════════════════════════════════════════════════════ */

// `page` : l'écran monté, qui est aussi l'ancienne clé de page (menu,
// Vues par profil, pages réservées, épingles). `sl` : libellé court
// affiché sur téléphone quand le long ne tient pas.
const MES_TABS = [
  { id: 'today',       l: 'Today',       ico: '<path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/><circle cx="12" cy="12" r="4"/>' },
  { id: 'tasks',       l: 'Tasks',       page: 'weekly-progress', ico: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>' },
  { id: 'requests',    l: 'Requests',    page: 'my-requests',     ico: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>' },
  { id: 'performance', l: 'Performance', sl: 'Perf', page: 'my-perf', ico: '<path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/>' },
  { id: 'quiz',        l: 'Quiz',        page: 'quiz',            ico: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>' },
];

// Ancienne page → onglet. Lue par page-dispatch.js (redirection), init.js
// (dernière page) et pinned.js (épingles) : une seule table.
const MES_LEGACY_PAGES = Object.fromEntries(MES_TABS.filter(t => t.page).map(t => [t.page, t.id]));

// Identifiants de la première version (onglet mémorisé, adresse copiée).
const MES_TAB_ALIAS = { aujourdhui: 'today', taches: 'tasks', demandes: 'requests' };

// Nom actuel d'une page : une ancienne page personnelle devient My Space.
function mesCanonPage(p) { return MES_LEGACY_PAGES[p] ? 'mon-espace' : p; }

const MES_TAB_KEY = 'mes-tab';

const MesUI = {
  tab: 'today',
  pending: null,       // intention posée par mesOpen() avant renderPage
  go: null,            // détail de l'intention (semaine, ancre…), lu une fois
  hashRead: false,
  items: [],           // lignes « Today » affichées (le bouton pointe dessus)
  // Note et objectifs, lus avec le jeton de l'agent. `tok` : le jeton
  // qui a servi — un autre jeton (autre agent, nouvelle session) relit.
  perf: null, obj: null, tok: '', at: 0, loading: false,
  wpPreset: false,     // le filtre « mes tâches » n'est posé qu'une fois
};

function _mesEl(id) { return document.getElementById(id); }
function _mesActive() { return !!_mesEl('page-mon-espace')?.classList.contains('active'); }
function _mesDef(id) { return MES_TABS.find(t => t.id === id) || null; }
function _mesValidTab(t) { const id = MES_TAB_ALIAS[t] || t; return _mesDef(id) ? id : null; }
function _mesUser() { return (typeof currentUser !== 'undefined' && currentUser) || null; }

// L'agent de My Space : le profil, s'il est Front Office. Un BO ou un
// observateur y trouve ses onglets, sans rappels personnels.
function mesMe() {
  const u = _mesUser();
  return u && u.role === 'FO' && (state.config?.fo_list || []).includes(u.name) ? u.name : null;
}

function _mesCtx() {
  // La note lue avec un jeton qui n'est plus celui de la session courante
  // (fermée, ou ouverte par un collègue) ne compte plus.
  const ok = MyPerf.token && MesUI.tok === MyPerf.token;
  return { me: mesMe(), perf: ok ? MesUI.perf : null, obj: ok ? MesUI.obj : null };
}

// ── Droits par onglet ─────────────────────────────────────────
// Mêmes règles que l'ancienne entrée de menu de l'écran : vue du profil
// (sauf en mode Admin), puis pages réservées (sauf pour l'admin en
// session). Today n'a pas de règle propre : il suit l'entrée My Space.
function _mesCanAdmin() { return typeof AdminSession !== 'undefined' && !!AdminSession.active; }
function _mesAdminMode() {
  return _mesCanAdmin() && !!_mesEl('page-config')
    && typeof getNavMode === 'function' && getNavMode() === 'admin';
}
function _mesTabAllowed(t) {
  if (!t) return false;
  if (_mesAdminMode()) return true;
  // Today se réserve comme les autres onglets (clé « mes-today »). Hors
  // réservation, il suit l'entrée My Space, comme avant.
  if (!t.page) {
    const ids = typeof navReservedFor === 'function' ? navReservedFor('mes-today') : null;
    return !ids || _mesCanAdmin() || (typeof navIdsMatch === 'function' && navIdsMatch(ids));
  }
  const allowed = typeof navAllowedPages === 'function' ? navAllowedPages() : null;
  // Même règle que la barre : un ID inscrit sur une page réservée la voit
  // même si la vue de son profil ne la contient pas.
  if (typeof navPageVisible === 'function') return navPageVisible(t.page, allowed, _mesCanAdmin());
  return !allowed || allowed.has(t.page);
}

// Entrée « My Space » de la barre (appelé par applyNavMode) : visible en
// mode Simple dès qu'un de ses écrans l'est — un profil qui voyait
// My Tasks voit My Space. En mode Admin la barre ne montre que l'admin.
function mesNavVisible() {
  return !_mesAdminMode() && MES_TABS.some(t => t.page && _mesTabAllowed(t));
}

// Onglets affichés. La vue par profil est un réglage de confort, pas un
// verrou : un écran ouvert explicitement (ancien lien, rappel) reste
// affiché, comme l'ancienne page l'était par son nom.
function _mesVisibleTabs() {
  // Un onglet réservé à d'autres ne s'affiche jamais, même ouvert par un
  // ancien lien : la réservation est une restriction, pas un confort.
  return MES_TABS.filter(t => _mesTabAllowed(t) || (t.id === MesUI.tab && !_mesReservedAway(t)));
}

function _mesReservedAway(t) {
  if (_mesAdminMode() || _mesCanAdmin()) return false;
  const key = t.page || 'mes-today';
  const ids = typeof navReservedFor === 'function' ? navReservedFor(key) : null;
  return !!ids && !(typeof navIdsMatch === 'function' && navIdsMatch(ids));
}

// ── Navigation ────────────────────────────────────────────────
// Point d'entrée des liens internes : on pose l'intention, puis on passe
// par renderPage pour que toute la chaîne (barre latérale, présence,
// épingles, dernière page) suive comme pour n'importe quelle page.
function mesOpen(opts) {
  MesUI.pending = opts || { tab: 'today' };
  window.renderPage('mon-espace');
}

// Ancien lien. Venant d'un manager en session (One-to-One, FO Dashboard),
// l'écran s'ouvre sur la vue qu'il connaissait ; venant de l'agent (rappel
// de la cloche, épingle), sur ses propres tâches.
function mesLegacyRedirect(page) {
  mesOpen({ tab: MES_LEGACY_PAGES[page] || 'today', legacy: _mesCanAdmin() });
}

function _mesRemembered() {
  try { return _mesValidTab(localStorage.getItem(MES_TAB_KEY) || ''); } catch (_) { return null; }
}

// #mon-espace, #mon-espace/<onglet> : un onglet se partage et survit à un
// rechargement.
function _mesHash() { return MesUI.tab === 'today' ? '#mon-espace' : `#mon-espace/${MesUI.tab}`; }
function _mesParseHash(h) {
  const m = /^#mon-espace(?:\/([\w-]*))?$/.exec(h || '');
  return m ? { tab: _mesValidTab(m[1]) || 'today', explicit: true } : null;
}
function _mesWriteHash() {
  const h = _mesHash();
  if (location.hash === h) return;
  try { history.replaceState(null, '', location.pathname + location.search + h); } catch (_) {}
}

window.addEventListener('hashchange', () => {
  if (!/^#mon-espace(\/|$)/.test(location.hash)) return;
  if (location.hash === _mesHash() && _mesActive()) return;
  const p = _mesParseHash(location.hash);
  if (p) mesOpen(p);
});

// ── Rendu ─────────────────────────────────────────────────────
// Appelé par page-dispatch.js. `wasActive` : la page était déjà à
// l'écran (changement de pays, de langue) — on garde l'onglet ouvert.
function renderMonEspace(wasActive) {
  let p = MesUI.pending;
  MesUI.pending = null;
  if (!p && !MesUI.hashRead) p = _mesParseHash(location.hash);
  MesUI.hashRead = true;
  // Entrée par le menu : l'onglet de la dernière visite, s'il est
  // toujours proposé à ce profil.
  if (!p && !wasActive) {
    const t = _mesRemembered();
    p = { tab: t && _mesTabAllowed(_mesDef(t)) ? t : 'today' };
  }
  if (p) {
    MesUI.tab = _mesValidTab(p.tab) || 'today';
    MesUI.go = p;
  }
  // L'entrée de menu suit la page, y compris quand on y arrive par un
  // ancien lien : la présence et les épingles lisent cette classe.
  document.querySelectorAll('.nav-item').forEach(n =>
    n.classList.toggle('active', n.dataset.page === 'mon-espace'));
  _mesRender();
}

function mesTab(id, go) {
  MesUI.tab = _mesValidTab(id) || 'today';
  MesUI.go = go || { tab: MesUI.tab };
  _mesRender();
  // Depuis l'accueil (bouton d'une ligne), l'onglet ouvert doit
  // apparaître en haut de l'écran, surtout sur téléphone.
  if (go && go.scroll !== false) _mesEl('mes-tabs')?.scrollIntoView?.({ block: 'nearest' });
}

function _mesRender() {
  try { localStorage.setItem(MES_TAB_KEY, MesUI.tab); } catch (_) {}
  _mesRenderHead();
  _mesRenderTabs();
  _mesRenderContent();
  _mesWriteHash();
  mesRefreshBadge();
  _mesLoadPerso();
}

// Redessine en-tête et onglets sans recharger l'écran monté : appelé par
// applyNavMode (session admin ouverte ou fermée, vues rechargées).
function mesRefreshTabs() {
  if (!_mesActive()) return;
  _mesRenderHead();
  _mesRenderTabs();
}

// Note et objectifs de l'agent, s'il a ouvert sa session. Relus au plus
// toutes les 60 s ; l'accueil s'affiche sans les attendre.
async function _mesLoadPerso(force) {
  const tok = MyPerf.token;
  if (!tok) { MesUI.perf = MesUI.obj = null; MesUI.tok = ''; return; }
  // L'onglet Performance lit déjà la note et les objectifs : on reprend
  // les siens (voir les branchements en fin de fichier).
  if (MesUI.loading || MesUI.tab === 'performance') return;
  if (!force && MesUI.tok === tok && Date.now() - MesUI.at < 60000) return;
  MesUI.loading = true;
  try {
    const h = { headers: { 'X-FO-Token': tok } };
    const [rp, ro] = await Promise.all([fetch(`${API}/api/my-perf`, h), fetch(`${API}/api/my-objectives`, h)]);
    if (rp.status === 401) { MyPerf.clear(); MesUI.perf = MesUI.obj = null; MesUI.tok = ''; }
    else {
      MesUI.perf = rp.ok ? await rp.json() : null;
      MesUI.obj = ro.ok ? await ro.json() : null;
      MesUI.tok = tok;
      MesUI.at = Date.now();
    }
  } catch (_) { /* réseau : on garde l'affichage tel quel */ }
  finally { MesUI.loading = false; }
  mesOnData();
}

// Données rechargées (loadAll → NF.render), identité changée, session de
// code ouverte ou fermée : on redessine ce qui ne porte aucune saisie.
function mesOnData() {
  mesRefreshBadge();
  if (!_mesActive()) return;
  _mesRenderHead();
  _mesRenderTabs();
  if (MesUI.tab === 'today') _mesRenderToday();
}

// Lignes « Today » dont la destination est proposée à ce profil : un
// rappel vers un onglet que l'admin a retiré n'aurait pas de sens.
function _mesItems(ctx) {
  return mesTodayItems(ctx).filter(i => !i.go?.tab || _mesTabAllowed(_mesDef(i.go.tab)));
}
function _mesUrgent(items) { return items.filter(i => i.lvl !== 'info').length; }

// Pastille de l'entrée de menu : ce qui attend l'agent (retards et dû).
// Menu replié en icônes : l'infobulle (data-tip, voir syncRailTips) le
// dit en toutes lettres, la pastille seule n'est qu'un point.
function mesRefreshBadge() {
  const b = _mesEl('mes-badge');
  if (!b) return;
  let n = 0;
  try { n = _mesUrgent(_mesItems(_mesCtx())); } catch (_) {}
  b.textContent = n > 9 ? '9+' : String(n);
  b.style.display = n ? '' : 'none';
  b.setAttribute('aria-label', n ? `${n} to do` : '');
  document.querySelectorAll('.sidebar .nav-item[data-page="mon-espace"]').forEach(it =>
    it.setAttribute('data-tip', n ? `My Space · ${n} to do` : 'My Space'));
}

// ── En-tête : le titre, l'état du jour, l'identité ────────────
function _mesRenderHead() {
  const el = _mesEl('mes-head');
  if (!el) return;
  const u = _mesUser();
  const me = mesMe();
  const first = u ? String(u.name || '').split(' ')[0] : '';
  const code = !!MyPerf.token;
  const perfFo = code && MesUI.tok === MyPerf.token ? MesUI.perf?.fo : null;
  // Session de code ouverte au nom d'un autre agent (poste partagé) :
  // on le dit, et on propose de la fermer.
  const autre = perfFo && me && perfFo !== me;

  // En-tête épuré : la salutation fait titre, la date et l'état du jour
  // (une pastille) disent en un regard s'il y a quelque chose à faire.
  const h = new Date().getHours();
  const salut = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const titre = u ? `${salut}, ${esc(first)}` : 'My Space';
  const jour = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  let etat = '';
  if (me) {
    const n = _mesUrgent(_mesItems(_mesCtx()));
    etat = n
      ? `<span class="mes-state is-todo"><i></i>${n} thing${n > 1 ? 's' : ''} need${n > 1 ? '' : 's'} you now</span>`
      : `<span class="mes-state is-ok"><i></i>All caught up</span>`;
  }
  const sub = u ? '' : 'Your tasks, requests, score and quizzes in one place.';

  // Titre seul, en grand ; une ligne discrète dessous (salutation, date).
  // L'état du jour est porté par la pastille de l'onglet Today.
  void etat; void sub;
  el.innerHTML = `<div class="mes-head mx-head">
    <h1 class="page-title mx-title">My Space</h1>
    <div class="mx-sub">${u ? `${esc(titre)} · ` : ''}${esc(jour)}${u ? ` · <button type="button" class="mes-link mx-notyou" onclick="openUserModal(false)" title="Signed in as ${esc(u.name)}">Not ${esc(first)}?</button>` : ''}
      ${code ? `<button type="button" class="mx-lock" onclick="mesLock()" title="Close your personal session (score and objectives)">${_mesSvg('lock', 13)}Lock my score</button>` : ''}</div>
  </div>
  ${autre ? `<div class="mes-warn" role="status">Score and objectives are open for <b>${esc(perfFo)}</b>, not for you.
      <button type="button" class="mes-link" onclick="mesLock()">Close that session</button></div>` : ''}`;
}

function mesLock() {
  if (typeof myPerfLogout === 'function') myPerfLogout();
  MesUI.perf = MesUI.obj = null; MesUI.tok = '';
  _mesRender();
}

// ── Onglets ───────────────────────────────────────────────────
function _mesTabBadge(id, ctx, items) {
  if (id === 'today') return _mesUrgent(items);
  if (!ctx.me) return 0;
  // Les tâches en retard, tant que le rappel correspondant est actif :
  // un rappel reporté ne doit pas survivre en pastille.
  if (id === 'tasks') return items.filter(i => i.go?.tab === 'tasks' && i.lvl === 'late')
    .reduce((s, i) => s + (i.n || 1), 0);
  if (id === 'requests') return (state.shiftRequests || []).filter(r =>
    (r.fo_name === ctx.me || r.requested_by === ctx.me) && r.status === 'pending').length;
  return 0;
}

function _mesRenderTabs() {
  const el = _mesEl('mes-tabs');
  if (!el) return;
  const ctx = _mesCtx();
  const items = _mesItems(ctx);
  const tabs = _mesVisibleTabs();
  el.style.setProperty('--mes-n', tabs.length);
  el.innerHTML = tabs.map(t => {
    const on = t.id === MesUI.tab;
    const n = _mesTabBadge(t.id, ctx, items);
    const lock = t.id === 'performance' && !MyPerf.token && ctx.me;
    const tip = t.id === 'requests' && n ? `${n} pending` : n ? `${n} to do` : lock ? 'Needs your personal code' : '';
    return `<button type="button" class="mes-tab${on ? ' is-on' : ''}" role="tab" id="mes-tab-${t.id}"
        aria-selected="${on}" aria-controls="mes-panel" tabindex="${on ? 0 : -1}"${tip ? ` title="${tip}"` : ''}
        onclick="mesTab('${t.id}',{scroll:false})" onkeydown="_eqTabKey(event)">
        <svg class="mes-tab-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${t.ico}</svg>
        <span class="mes-tab-l${t.sl ? ' has-sl' : ''}">${esc(t.l)}</span>${t.sl ? `<span class="mes-tab-sl" aria-hidden="true">${esc(t.sl)}</span>` : ''}${n ? `<span class="mes-badge" aria-label="${tip}">${n > 9 ? '9+' : n}</span>`
          : lock ? `<span class="mes-tab-lock" aria-label="locked">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></span>` : ''}
      </button>`;
  }).join('');
  _mesEl('mes-panel')?.setAttribute('aria-labelledby', `mes-tab-${MesUI.tab}`);
}

// ── Montage des écrans existants ──────────────────────────────
function _mesMount(page) {
  const node = _mesEl('page-' + page);
  const host = _mesEl('mes-mount');
  if (!node || !host) return null;
  if (node.parentNode !== host) host.appendChild(node);
  node.dataset.mes = '1';
  node.classList.add('active');
  return node;
}

function _mesUnmountAll() {
  _mesEl('mes-mount')?.querySelectorAll(':scope > .page').forEach(p => p.classList.remove('active'));
}

function _mesRenderContent() {
  const own = _mesEl('mes-own');
  _mesUnmountAll();
  if (own) own.innerHTML = '';
  const go = MesUI.go || {};
  MesUI.go = null;
  const me = mesMe();

  switch (MesUI.tab) {
    case 'today':
      _mesRenderToday();
      break;

    case 'tasks': {
      const node = _mesMount('weekly-progress');
      // La page montre toute l'équipe ; ici elle s'ouvre sur l'agent, une
      // fois — ensuite le filtre reste le sien (« Whole team » y est).
      // Pas depuis un lien de manager : il voulait la vue qu'il connaissait.
      if (me && !go.legacy && !MesUI.wpPreset && !wpOwner) wpOwner = me;
      if (!go.legacy) MesUI.wpPreset = true;
      if (go.week) progressAnchorDate = go.week;
      if (go.filtre !== undefined) wpFilter = go.filtre;
      if (node) renderWeeklyProgress();
      if (go.add) setTimeout(() => openNewProgressItem(), 0);
      break;
    }

    case 'requests': {
      const node = _mesMount('my-requests');
      const sel = _mesEl('mr-who');
      if (node) {
        // L'agent est déjà identifié en haut : son propre sélecteur
        // disparaît, sa file s'ouvre directement.
        if (me && sel && sel.options.length) sel.value = me;
        renderMyRequests();
        if (me && sel && sel.value !== me && [...sel.options].some(o => o.value === me)) { sel.value = me; renderMyRequests(); }
        if (me && sel?.value === me) node.dataset.mesMe = '1'; else delete node.dataset.mesMe;
      }
      if (me) { mesMarkDecisionsSeen(me); mesRefreshBadge(); }
      break;
    }

    case 'performance': {
      const node = _mesMount('my-perf');
      if (!node) break;
      _mesPrepGate(node);
      renderMyPerf();
      if (go.anchor) _mesScrollWhenReady(go.anchor, go.add);
      else if (!MyPerf.token) setTimeout(() => _mesEl('myperf-code')?.focus({ preventScroll: true }), 50);
      break;
    }

    case 'quiz':
      if (_mesMount('quiz')) renderQuiz();
      break;
  }
}

// Formulaire d'accès de My Performance : l'agent est déjà identifié, son
// ID Huawei est repris du profil (ou de sa fiche) et seul le code reste
// à saisir. Le serveur vérifie toujours la paire ID + code.
function _mesPrepGate(node) {
  const u = _mesUser();
  const me = mesMe();
  const id = (u && /^[a-zA-Z]{1,2}\d{7,8}$/.test(u.huaweiId || '') && u.huaweiId)
    || (me && typeof foIdOf === 'function' && foIdOf(me)) || '';
  const inp = _mesEl('myperf-id');
  let who = _mesEl('mes-gate-who');
  if (id && inp) {
    if (!inp.value) inp.value = id;
    node.dataset.mesId = '1';
    if (!who) {
      who = document.createElement('div');
      who.id = 'mes-gate-who';
      who.className = 'mes-gate-who';
      inp.parentNode.insertBefore(who, inp);
    }
    who.innerHTML = `Type the personal code your manager gave you. Only you can see this page.
      <span class="mes-gate-id">${esc(u?.name || me || '')} · ${esc(inp.value)}
      <button type="button" class="mes-link" onclick="mesGateOtherId()">Not your ID?</button></span>`;
  } else {
    delete node.dataset.mesId;
    if (who) who.remove();
  }
  const code = _mesEl('myperf-code');
  if (code) code.placeholder = 'Your personal code';
  // Ce que le code ouvre, à côté du formulaire : la carte n'est plus un
  // cadenas isolé au milieu de l'écran.
  const card = node.querySelector('.myperf-gate-card');
  if (card && !card.querySelector('.mes-gate-aside')) {
    const aside = document.createElement('div');
    aside.className = 'mes-gate-aside';
    aside.innerHTML = `<div class="mes-welcome-eb">Private</div>
      <div class="mes-welcome-t">Your performance</div>
      <p class="mes-welcome-d">Only you can open it — not your teammates.</p>
      ${_mesPerksHtml([
        ['score', 'Your score of the month', 'With the details behind it.'],
        ['goal', 'Your objectives', 'Propose them, follow their progress.'],
        ['check', 'Your action plan', 'What was agreed with your manager.'],
      ])}`;
    card.prepend(aside);
    card.classList.add('mes-gate-card');
  }
}

function mesGateOtherId() {
  const node = _mesEl('page-my-perf');
  if (node) delete node.dataset.mesId;
  _mesEl('mes-gate-who')?.remove();
  const inp = _mesEl('myperf-id');
  if (inp) { inp.value = ''; inp.focus(); }
}

// Les objectifs et les actions arrivent après la note (deux appels) :
// on attend qu'ils soient là pour y descendre.
function _mesScrollWhenReady(anchor, add) {
  let n = 0;
  const tick = () => {
    if (MesUI.tab !== 'performance' || !_mesActive()) return;
    const find = () => anchor === 'actions' ? document.querySelector('#myperf-result .myperf-acts')?.closest('.myperf-sec')
      : _mesEl('myobj-host')?.firstElementChild;
    if (find()) {
      // Le formulaire redessine la section : on descend après, sur le
      // nœud final, et sans animation — l'agent est pressé.
      if (add && typeof myObjNew === 'function' && MyObj.data?.session && !MyObj.form) myObjNew();
      requestAnimationFrame(() => {
        find()?.scrollIntoView({ block: 'start' });
        if (add) _mesEl('myobj-title')?.focus({ preventScroll: true });
      });
      return;
    }
    if (++n < 30 && MyPerf.token) setTimeout(tick, 150);
  };
  setTimeout(tick, 100);
}

// ── Today ─────────────────────────────────────────────────────
const MES_ICO = {
  task:     '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  assign:   '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 14l2 2 4-4"/>',
  check:    '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12l3 3 5-6"/>',
  ticket:   '<path d="M4 9V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 6v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-6z"/><path d="M13 5v14"/>',
  quiz:     '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  handover: '<path d="M17 8l4 4-4 4"/><path d="M3 12h18"/>',
  request:  '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  ok:       '<circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-6"/>',
  o2o:      '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/>',
  goal:     '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  shift:    '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  score:    '<path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/>',
  lock:     '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  arrow:    '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  user:     '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
};
const MES_LVL_LABEL = { late: 'Overdue', due: 'To do', info: 'For info' };

function _mesSvg(k, size) {
  return `<svg viewBox="0 0 24 24" width="${size || 20}" height="${size || 20}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${MES_ICO[k] || MES_ICO.task}</svg>`;
}

function _mesRenderToday() {
  const own = _mesEl('mes-own');
  if (!own) return;
  const u = _mesUser();
  const ctx = _mesCtx();

  if (!u) {
    own.innerHTML = _mesWelcomeHtml();
    setTimeout(() => _mesEl('mes-si-1')?.focus({ preventScroll: true }), 50);
    return;
  }
  if (!ctx.me) {
    own.innerHTML = `<div class="mes-note">Reminders here are made for Front Office agents.
      Your tasks, requests, score and quizzes are in the tabs above.</div>`;
    return;
  }

  const items = _mesItems(ctx);
  MesUI.items = items;
  const urgent = _mesUrgent(items);

  const row = (i, k) => `
    <button type="button" class="mes-row is-${i.lvl}" onclick="mesDo(${k})">
      <span class="mes-row-i" role="img" aria-label="${MES_LVL_LABEL[i.lvl]}" title="${MES_LVL_LABEL[i.lvl]}">${_mesSvg(i.icon)}</span>
      <span class="mes-row-b">
        <span class="mes-row-t">${esc(i.t)}</span>
        <span class="mes-row-d">${esc(i.d)}</span>
      </span>
      <span class="mes-row-cta">${esc(i.cta)}${_mesSvg('arrow', 16)}</span>
    </button>`;

  // Carte « à faire » : un titre avec le compte, puis les lignes. Rien
  // d'urgent : on le dit d'abord, clairement ; ce qui reste « pour info »
  // vient dessous, sans fausse alerte.
  const clear = urgent ? '' : `<div class="mes-clear" role="status">
      <div class="mes-clear-ico">${_mesSvg('ok', 26)}</div>
      <div>
        <div class="mes-clear-t">All caught up</div>
        <div class="mes-clear-d">Nothing needs you right now.${MyPerf.token ? ' Nice work.'
          : ' To check your objectives too, <button type="button" class="mes-link mes-inline" onclick="mesTab(\'performance\',{tab:\'performance\'})">enter your code</button>.'}</div>
      </div>
    </div>`;
  const todo = `<section class="mes-card" aria-labelledby="mes-todo-t">
      <div class="mes-card-h">
        <span class="mes-card-ico">${_mesSvg('check', 18)}</span>
        <div><h2 class="mes-card-t" id="mes-todo-t">${urgent ? 'To do now' : 'Your day'}</h2>
          <div class="mes-card-s">${urgent ? `${urgent} item${urgent > 1 ? 's' : ''} need${urgent > 1 ? '' : 's'} you` : items.length ? 'Worth a look when you have a minute' : 'Nothing pending'}</div></div>
      </div>
      ${clear}${items.length ? `<div class="mes-list">${items.map(row).join('')}</div>` : ''}
    </section>`;

  // Deux zones : ce qu'il y a à faire et ses tickets, puis les repères.
  // Sur grand écran elles se placent côte à côte (voir mon-espace.css).
  // Parcours de la journée, en colonnes : à faire, mes tickets, ma
  // semaine ; puis les repères. Chaque colonne : un panneau épuré, une
  // légende dessous. (todo et _mesMyTicketsHtml restent pour mémoire.)
  void todo;
  own.innerHTML = `<div class="mx">
    ${_mxTodoCol(items, urgent)}
    ${_mxTicketsCol(ctx.me)}
    ${_mxWeekCol(ctx.me)}
    ${_mxTiles(mesGlance(ctx))}
  </div>`;
}

// ── Mise en page « parcours » ─────────────────────────────────
const _mxCircle = (ico, onclick, label) =>
  `<button type="button" class="mx-cbtn" onclick="${onclick}" aria-label="${esc(label)}" title="${esc(label)}">${_mesSvg(ico, 16)}</button>`;
const _mxCol = (cap, n, body, more) => `<section class="mx-col">
    <div class="mx-panel">${body}</div>
    <div class="mx-cap"><span>${cap}</span>${n !== '' ? `<b>${n}</b>` : ''}${more || ''}</div>
  </section>`;
const _mxEmpty = (ico, t) => `<div class="mx-empty"><span class="mx-ico is-ok">${_mesSvg(ico, 18)}</span><span>${t}</span></div>`;

function _mxTodoCol(items, urgent) {
  const rows = items.map((i, k) => `<div class="mx-row${i.lvl === 'late' ? ' is-late' : ''}${i.lvl === 'info' ? ' is-quiet' : ''}">
      <span class="mx-ico">${_mesSvg(i.icon, 18)}</span>
      <button type="button" class="mx-txt" onclick="mesDo(${k})"><b>${esc(i.t)}</b><small>${esc(i.d)}</small></button>
      ${_mxCircle('arrow', `mesDo(${k})`, i.cta)}
    </div>`).join('');
  return _mxCol('To do now', urgent || '', items.length ? rows : _mxEmpty('ok', 'All caught up — nothing needs you.'));
}

function _mxTicketsCol(me) {
  const clos = t => t.status === 'Resolved' || t.status === 'Closed';
  const list = [...(state.sn || []).map(t => ({ ...t, _tr: 'sn' })), ...(state.ci || []).map(t => ({ ...t, _tr: 'ci' }))]
    .filter(t => (t.fo_owner === me || t.assigned_to === me) && !clos(t));
  const left = t => (typeof t.time_left_ms === 'number' ? t.time_left_ms : Infinity);
  const br = t => t.sla_status === 'Breach' || left(t) < 0;
  list.sort((a, b) => (br(b) - br(a)) || String(a.priority || 'P9').localeCompare(String(b.priority || 'P9')) || left(a) - left(b));
  const tr = _mesTracker(me).toLowerCase() === 'ci' ? 'ci' : 'sn';
  const rows = list.slice(0, 5).map(t => {
    const prio = String(t.priority || '').toUpperCase();
    const tl = typeof formatTimeLeft === 'function' && typeof t.time_left_ms === 'number' ? formatTimeLeft(t.time_left_ms, t.status) : (t.status || '');
    return `<div class="mx-row${br(t) ? ' is-late' : ''}">
      <span class="mx-ico mx-prio${prio === 'P1' ? ' is-p1' : ''}">${esc(prio || '—')}</span>
      <button type="button" class="mx-txt" onclick="navigateToTicket('${t._tr}','${esc(t.id)}')"><b>${esc(t.title || 'Untitled')}</b>
        <small><span class="mx-mono">${esc(t.sn_tt || t.imoc_tt || '—')}</span> · ${br(t) ? '<em>SLA breach</em>' : esc(tl)}</small></button>
      ${_mxCircle('arrow', `navigateToTicket('${t._tr}','${esc(t.id)}')`, 'Open ticket')}
    </div>`;
  }).join('');
  return _mxCol('My open tickets', list.length || '',
    list.length ? rows : _mxEmpty('ok', 'No open ticket assigned to you.'),
    list.length ? `<button type="button" class="mx-cap-link" onclick="mesOpenMyTickets('${tr}')">See all</button>` : '');
}

function _mxWeekCol(me) {
  const wk = (typeof _wpCurWeek === 'function') ? _wpCurWeek() : '';
  const mine = typeof _mesMyProgress === 'function' ? _mesMyProgress(me).filter(p => p.week_start === wk) : [];
  const order = { 'In Progress': 0, 'To Do': 1, 'Planned': 1, 'Done': 2 };
  mine.sort((a, b) => (order[a.status] ?? 1) - (order[b.status] ?? 1));
  const done = mine.filter(p => p.status === 'Done').length;
  const go = "mesTab('tasks',{tab:'tasks',filtre:'',week:_mesToday()})";
  const rows = mine.slice(0, 5).map(p => {
    const d = p.status === 'Done';
    return `<div class="mx-row${d ? ' is-done' : ''}">
      <span class="mx-ico${d ? ' is-ok' : ''}">${_mesSvg(d ? 'ok' : (p.admin_task ? 'assign' : 'task'), 18)}</span>
      <button type="button" class="mx-txt" onclick="${go}"><b>${esc(p.task || 'Task')}</b>
        <small>${esc(d ? 'Done' : p.status || 'To do')}${p.admin_task ? ' · from your manager' : ''}${p.due_date ? ` · due ${esc(_mesDay(p.due_date))}` : ''}</small></button>
      ${d ? '<span class="mx-check" aria-label="Done">✓✓</span>' : _mxCircle('arrow', go, 'Open my tasks')}
    </div>`;
  }).join('');
  const add = `<div class="mx-row is-add">
      <span class="mx-ico">${'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>'}</span>
      <button type="button" class="mx-txt" onclick="mesTab('tasks',{tab:'tasks',add:true,week:_mesToday(),filtre:''})"><b>Add a task</b><small>What you plan to deliver this week</small></button>
    </div>`;
  return _mxCol('This week', mine.length ? `${done}/${mine.length}` : '', rows + add);
}

function _mxTiles(g) {
  const code = !!MyPerf.token;
  const m = g.month;
  const scored = g.perf && g.perf.score !== null && g.perf.score !== undefined;
  const sh = _mesShiftTxt(g.shift);
  const o = g.obj;
  const tile = (cls, onclick, k, v, sub) => `<button type="button" class="mx-tile ${cls}" onclick="${onclick}">
      <span class="mx-tile-k">${k}</span><span class="mx-tile-v">${v}</span><span class="mx-tile-s">${sub}</span></button>`;
  return `<section class="mx-col mx-tiles-col">
    <div class="mx-tiles">
      ${tile('is-dark', "window.renderPage('shift-planning')", 'Next shift', esc(sh.v), esc(sh.m || ''))}
      ${tile('', "mesTab('performance',{tab:'performance'})", scored ? 'Score' : esc(m.label),
        scored ? `${g.perf.score}<small>/100</small>` : `${m.tickets}`, scored ? esc(g.perf.niveau || '') : 'tickets logged')}
      ${tile('', "mesTab('performance',{tab:'performance',anchor:'objectifs'})", 'Objectives',
        !code ? _mesSvg('lock', 20) : !o ? '…' : `${o.actifs}`, !code ? 'Enter your code' : o && o.progress !== null ? `${o.progress}% done` : 'in progress')}
      ${tile('', "mesTab('quiz',{tab:'quiz'})", 'Quiz', _mesSvg('quiz', 22), 'This week’s questions')}
    </div>
    <div class="mx-cap"><span>At a glance</span></div>
  </section>`;
}

// ── Accueil sans profil : se présenter sur place ─────────────
// Avant : une carte « Who are you? » et un bouton qui ouvrait une fenêtre.
// Maintenant : ce que l'espace apporte, à gauche ; le formulaire, à
// droite, directement dans la page. Trois cas :
//   · codes personnels délivrés → ID Huawei + code : une seule saisie
//     ouvre à la fois le profil et la note (même appel que Performance) ;
//   · verrou d'équipe sans codes → bouton « Sign in » (fenêtre d'équipe) ;
//   · sinon → son nom (puces des FO) et son ID Huawei.
function _mesPerksHtml(list) {
  return `<ul class="mes-perks">${list.map(([ico, t, d]) => `<li>
      <span class="mes-perk-i">${_mesSvg(ico, 18)}</span>
      <span><b>${t}</b><small>${d}</small></span></li>`).join('')}</ul>`;
}

function _mesWelcomeHtml() {
  const t = window.TeamIdentity || {};
  const perks = _mesPerksHtml([
    ['task', 'Your tasks and deadlines', 'What your manager gave you, and what you planned this week.'],
    ['ticket', 'Your open tickets', 'Out of SLA first, then by priority.'],
    ['score', 'Your score and objectives', 'Private — only you can see them.'],
  ]);
  let form;
  if (t.codes) {
    form = `<form class="mes-si" onsubmit="event.preventDefault();mesSignIn()">
      <div class="mes-si-t">Sign in</div>
      <div class="mes-si-d">With your Huawei ID and the personal code your manager gave you.</div>
      <label class="mes-fl"><span>Huawei ID</span><input id="mes-si-1" class="mes-in" autocomplete="username" placeholder="h50056630" spellcheck="false"></label>
      <label class="mes-fl"><span>Personal code</span><input id="mes-si-2" class="mes-in" type="password" autocomplete="current-password" placeholder="••••••"></label>
      <div class="mes-si-err" id="mes-si-err" role="alert"></div>
      <button class="mes-si-btn" id="mes-si-go" type="submit">Open my space${_mesSvg('arrow', 16)}</button>
      <div class="mes-si-foot">Lost your code? Ask your manager for a new one.</div>
    </form>`;
  } else if (t.actif) {
    form = `<div class="mes-si">
      <div class="mes-si-t">Sign in</div>
      <div class="mes-si-d">You are browsing in read-only mode. Sign in to see what is waiting for you.</div>
      <button class="mes-si-btn" type="button" onclick="teamLogin()">Sign in${_mesSvg('arrow', 16)}</button>
    </div>`;
  } else {
    const fos = (state.config?.fo_list || []).slice().sort();
    form = `<form class="mes-si" onsubmit="event.preventDefault();mesPickMe()">
      <div class="mes-si-t">Who are you?</div>
      <div class="mes-si-d">Once, on this computer. You can change it any time from your avatar.</div>
      <label class="mes-fl"><span>Your name</span><input id="mes-si-1" class="mes-in" list="mes-si-names" autocomplete="name" placeholder="First and last name" oninput="_mesChipSync()"></label>
      ${fos.length ? `<div class="mes-chips" role="group" aria-label="Front Office">${fos.slice(0, 8).map(n =>
        `<button type="button" class="mes-chip" onclick="_mesChip(this)" data-n="${esc(n)}">${esc(n)}</button>`).join('')}</div>
        <datalist id="mes-si-names">${fos.map(n => `<option value="${esc(n)}">`).join('')}</datalist>` : ''}
      <label class="mes-fl"><span>Huawei ID</span><input id="mes-si-2" class="mes-in" autocomplete="username" placeholder="h50056630" spellcheck="false"></label>
      <div class="mes-si-err" id="mes-si-err" role="alert"></div>
      <button class="mes-si-btn" type="submit">Continue${_mesSvg('arrow', 16)}</button>
    </form>`;
  }
  return `<div class="mes-welcome">
    <div class="mes-welcome-l">
      <div class="mes-welcome-eb">Welcome</div>
      <h2 class="mes-welcome-t">Your personal space</h2>
      <p class="mes-welcome-d">Everything that is yours, in one place.</p>
      ${perks}
    </div>
    <div class="mes-welcome-r">${form}</div>
  </div>`;
}

function _mesChip(b) {
  const i = _mesEl('mes-si-1');
  if (i) { i.value = b.dataset.n; _mesChipSync(); _mesEl('mes-si-2')?.focus(); }
}
function _mesChipSync() {
  const v = (_mesEl('mes-si-1')?.value || '').trim().toLowerCase();
  document.querySelectorAll('#page-mon-espace .mes-chip').forEach(c => c.classList.toggle('on', c.dataset.n.toLowerCase() === v));
}
function _mesSiErr(m) { const e = _mesEl('mes-si-err'); if (e) e.textContent = m || ''; }

// Sans verrou d'équipe : on passe par le formulaire de profil existant
// (mêmes contrôles de nom et d'ID), sans ouvrir sa fenêtre.
function mesPickMe() {
  const name = (_mesEl('mes-si-1')?.value || '').trim();
  const id = (_mesEl('mes-si-2')?.value || '').trim();
  if (!name) { _mesSiErr('Enter your name.'); _mesEl('mes-si-1')?.focus(); return; }
  if (!/^[a-zA-Z]{1,2}\d{7,8}$/.test(id)) { _mesSiErr('Huawei ID format: h50056630 or wx1488808.'); _mesEl('mes-si-2')?.focus(); return; }
  const n = document.getElementById('identity-name-input');
  const h = document.getElementById('identity-huawei-input');
  if (!n || !h || typeof saveIdentity !== 'function') { openUserModal(true); return; }
  n.value = name; h.value = id;
  saveIdentity();
  if (typeof currentUser !== 'undefined' && currentUser) _mesRender();
}

// Codes personnels : une seule saisie ouvre le profil et la note.
async function mesSignIn() {
  const id = (_mesEl('mes-si-1')?.value || '').trim();
  const code = (_mesEl('mes-si-2')?.value || '').trim();
  if (!id || !code) { _mesSiErr('Enter your Huawei ID and your code.'); return; }
  const btn = _mesEl('mes-si-go');
  if (btn) btn.disabled = true;
  _mesSiErr('');
  try {
    const res = await fetch(`${API}/api/fo-access/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ huaweiId: id, code }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 429) throw new Error(data.error || 'Too many attempts — try again in 15 minutes.');
    if (!res.ok) throw new Error(data.error || 'Wrong Huawei ID or code.');
    MyPerf.set(data.token);
    location.reload();
  } catch (e) {
    _mesSiErr(e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Mes tickets ouverts ───────────────────────────────────────
// Ce que l'agent consulte le plus : ses tickets encore ouverts, les
// ruptures SLA d'abord, puis par priorité et temps restant. Un clic
// ouvre la fiche ; le lien du bas ouvre le tracker filtré sur lui.
function _mesMyTicketsHtml(me) {
  const clos = t => t.status === 'Resolved' || t.status === 'Closed';
  const list = [...(state.sn || []).map(t => ({ ...t, _tr: 'sn' })), ...(state.ci || []).map(t => ({ ...t, _tr: 'ci' }))]
    .filter(t => (t.fo_owner === me || t.assigned_to === me) && !clos(t));
  const left = t => (typeof t.time_left_ms === 'number' ? t.time_left_ms : Infinity);
  const br = t => t.sla_status === 'Breach' || left(t) < 0;
  list.sort((a, b) => (br(b) - br(a)) || String(a.priority || 'P9').localeCompare(String(b.priority || 'P9')) || left(a) - left(b));
  const nBr = list.filter(br).length;
  const tr = _mesTracker(me).toLowerCase() === 'ci' ? 'ci' : 'sn';
  const rows = list.slice(0, 5).map(t => {
    const prio = String(t.priority || '').toUpperCase();
    const tl = typeof formatTimeLeft === 'function' && typeof t.time_left_ms === 'number' ? formatTimeLeft(t.time_left_ms, t.status) : '';
    return `<button type="button" class="mes-tk${br(t) ? ' is-br' : ''}" onclick="navigateToTicket('${t._tr}','${esc(t.id)}')" title="${esc(t.title || '')}">
      <span class="mes-tk-p mes-tk-${esc(prio.toLowerCase())}">${esc(prio || '—')}</span>
      <span class="mes-tk-b"><span class="mes-tk-n">${esc(t.sn_tt || t.imoc_tt || '—')}</span><span class="mes-tk-t">${esc(t.title || 'Untitled')}</span></span>
      <span class="mes-tk-r">${br(t) ? '<span class="mes-tk-br">SLA breach</span>' : esc(t.status || '')}${tl ? `<span class="mes-tk-tl">${esc(tl)}</span>` : ''}</span>
    </button>`;
  }).join('');
  return `<section class="mes-card" aria-labelledby="mes-tk-t">
    <div class="mes-card-h">
      <span class="mes-card-ico">${_mesSvg('ticket', 18)}</span>
      <div><h2 class="mes-card-t" id="mes-tk-t">My open tickets</h2>
        <div class="mes-card-s">${list.length ? `${list.length} open${nBr ? ` · <b class="mes-bad-t">${nBr} out of SLA</b>` : ''}` : 'None open — well done'}</div></div>
      ${list.length ? `<button type="button" class="mes-card-more" onclick="mesOpenMyTickets('${tr}')">See all${_mesSvg('arrow', 14)}</button>` : ''}
    </div>
    ${list.length ? `<div class="mes-tks">${rows}</div>` : `<div class="mes-tk-empty">${_mesSvg('ok', 20)}<span>No open ticket assigned to you.</span></div>`}
  </section>`;
}

// Tracker de l'agent, filtré sur son nom.
function mesOpenMyTickets(tr) {
  const me = mesMe();
  const nav = document.querySelector(`.nav-item[data-page="${tr}"]`);
  if (nav) nav.click(); else window.renderPage(tr);
  setTimeout(() => {
    const fo = document.getElementById(`${tr}-filter-fo`);
    if (fo && me && [...fo.options].some(o => o.value === me)) fo.value = me;
    if (typeof filterTable === 'function') filterTable(tr);
  }, 80);
}

function _mesShiftTxt(s) {
  if (!s) return { v: 'None planned', m: 'Nothing in the rota for you yet' };
  if (s.now) return { v: 'On shift now', m: [s.end ? `until ${s.end}` : '', s.name].filter(Boolean).join(' · ') };
  // Le jour se lit d'abord ; les horaires et le nom du créneau dessous.
  const day = _mesDay(s.date);
  return { v: `${day.charAt(0).toUpperCase()}${day.slice(1)}`,
           m: [s.start && s.end ? `${s.start}–${s.end}` : s.start, s.name].filter(Boolean).join(' · ') };
}

function _mesGlanceHtml(g) {
  // Même modèle que les indicateurs du dashboard : pastille d'icône,
  // libellé, un chiffre en grand, une ligne de contexte.
  const tile = (onclick, ico, label, v, m, extra, cls) => `<button type="button" class="mes-tile${cls ? ' ' + cls : ''}" onclick="${onclick}">
      <span class="mes-tile-top"><span class="mes-tile-h">${esc(label)}</span><span class="mes-tile-ico">${_mesSvg(ico, 16)}</span></span>
      <span class="mes-tile-v">${v}</span>
      ${extra || ''}
      <span class="mes-tile-m">${m}</span>
    </button>`;
  const code = !!MyPerf.token;
  const lockV = `<span class="mes-tile-lock">${_mesSvg('lock', 18)}</span>`;

  // Le mois : l'activité (servie à tous) se lit sans code ; la note,
  // elle, reste derrière le code personnel.
  const m = g.month;
  const scored = g.perf && g.perf.score !== null && g.perf.score !== undefined;
  const tk = scored ? `${m.tickets} ticket${m.tickets === 1 ? '' : 's'} logged` : `ticket${m.tickets === 1 ? '' : 's'} logged this month`;
  const monthV = scored ? `${g.perf.score}<small>/100</small>` : `${m.tickets}`;
  const monthM = scored ? esc([g.perf.niveau, tk].filter(Boolean).join(' · '))
    : code ? (g.perf ? `${tk} · not rated yet` : tk)
    : `${tk} · <span class="mes-tile-k">enter your code for your score</span>`;

  const sh = _mesShiftTxt(g.shift);

  const o = g.obj;
  const objV = !code ? lockV : !o ? '…' : `${o.actifs}`;
  const objM = !code ? 'Locked — enter your personal code'
    : o ? esc([o.actifs ? 'in progress' : 'none approved yet', o.progress !== null ? `${o.progress}% done` : '', o.attente ? `${o.attente} awaiting review` : ''].filter(Boolean).join(' · ')) : '';

  const w = g.week;
  const pct = w.total ? Math.round(w.done / w.total * 100) : 0;

  return `<section class="mes-glance" aria-labelledby="mes-glance-t">
    <h2 class="mes-h2" id="mes-glance-t">At a glance</h2>
    <div class="mes-tiles">
      ${tile("mesTab('performance',{tab:'performance'})", 'score', scored ? `Score · ${m.label}` : m.label, monthV, monthM)}
      ${tile("mesTab('tasks',{tab:'tasks',filtre:'',week:_mesToday()})", 'task', 'This week',
        w.total ? `${w.done}<small>/${w.total}</small>` : '0',
        w.total ? (w.done === w.total ? 'All delivered' : `${w.total - w.done} task${w.total - w.done > 1 ? 's' : ''} left`) : 'No task planned yet',
        `<span class="mes-bar" aria-hidden="true"><i style="width:${pct}%"></i></span>`)}
      ${tile("window.renderPage('shift-planning')", 'shift', 'Next shift', `<span class="mes-tile-vs">${esc(sh.v)}</span>`, esc(sh.m || ''))}
      ${tile("mesTab('performance',{tab:'performance',anchor:'objectifs'})", 'goal', 'Objectives', objV, objM, '', code ? '' : 'is-locked')}
    </div>
  </section>`;
}

// Bouton d'une ligne « Today » : un onglet d'ici, ou une autre page.
function mesDo(k) {
  const i = MesUI.items[k];
  if (!i) return;
  const go = i.go || {};
  if (go.page) {
    if (window.NF) NF.go(go.page); else window.renderPage(go.page);
    return;
  }
  mesTab(go.tab, go);
}

// ── Branchements ──────────────────────────────────────────────
// La cloche se recalcule à chaque rechargement des données (loadAll),
// à chaque changement d'identité et toutes les 60 s : My Space suit
// le même rythme, sans minuterie à lui.
(function () {
  if (!window.NF || NF.__mes) return;
  const render = NF.render;
  NF.render = function () {
    const out = render.apply(this, arguments);
    try { mesOnData(); } catch (_) {}
    return out;
  };
  NF.__mes = true;
})();

// Session de code ouverte ou fermée depuis l'onglet Performance : l'en-tête
// (bouton Lock) et l'accueil doivent le refléter. La consultation admin
// d'une fiche (adminViewFoPerf) ne concerne pas l'agent : ignorée.
(function () {
  if (typeof _renderMyPerf !== 'function' || _renderMyPerf.__mes) return;
  const orig = _renderMyPerf;
  _renderMyPerf = function (d) {
    const out = orig.apply(this, arguments);
    if (!_adminPerfFo && MyPerf.token) {
      if (MesUI.tok !== MyPerf.token) MesUI.obj = null;
      MesUI.perf = d; MesUI.tok = MyPerf.token; MesUI.at = Date.now();
      try { mesOnData(); } catch (_) {}
    }
    return out;
  };
  _renderMyPerf.__mes = true;
  // Les objectifs suivent la note (loadMyObjectives) : même capture.
  const objs = renderMyObjectives;
  renderMyObjectives = function () {
    const r = objs.apply(this, arguments);
    if (!_adminPerfFo && MyPerf.token && MyObj.data && MesUI.tok === MyPerf.token) {
      MesUI.obj = MyObj.data;
      try { mesOnData(); } catch (_) {}
    }
    return r;
  };
  const out = myPerfLogout;
  myPerfLogout = function () {
    const r = out.apply(this, arguments);
    MesUI.perf = MesUI.obj = null; MesUI.tok = '';
    try { mesOnData(); } catch (_) {}
    return r;
  };
})();
