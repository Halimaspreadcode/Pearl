// ── INIT ─────────────────────────────────────────────────────
async function init() {
  showSkeletons();
  await loadConfig();
  await loadAll();
  initNav();
  startClock();
  startCountdowns();
  // Revalide la session pour afficher (ou non) la bascule Simple/Admin.
  // `check()` appelle syncIndicator(), qui applique le mode à la barre.
  AdminSession.check();
  // Sur /admin/app le serveur a déjà validé la session : on ouvre
  // directement la Configuration plutôt que la dernière page visitée.
  let lastPage = location.pathname.startsWith('/admin')
    ? 'config'
    : (localStorage.getItem('pearl-last-page') || 'dashboard');
  // Une dernière page devenue réservée à l'admin renverrait aussitôt vers
  // /admin à l'ouverture de l'app publique : on retombe sur le tableau
  // de bord plutôt que d'imposer le mot de passe au démarrage.
  // Lien direct vers la page Équipe ou une fiche agent (#equipe/<agent>) :
  // l'adresse dit explicitement où aller, elle prime sur la dernière page.
  if (/^#equipe(\/|$)/.test(location.hash)
      && (document.getElementById('page-equipe') || AdminSession.active)) lastPage = 'equipe';
  // Idem pour la page Rapports (#rapports/<onglet>) ; une dernière page
  // devenue onglet de Rapports (weekly-report, mailing…) y rouvre.
  if (/^#rapports(\/|$)/.test(location.hash)) lastPage = 'rapports';
  else if (typeof RP_LEGACY_PAGES !== 'undefined' && RP_LEGACY_PAGES[lastPage]) {
    RpUI.pending = { tab: RP_LEGACY_PAGES[lastPage] };
    lastPage = 'rapports';
  }
  // Idem pour My Space (#mon-espace/<onglet>) ; une ancienne page
  // personnelle mémorisée (my-perf, quiz…) y mène aussi.
  if (/^#mon-espace(\/|$)/.test(location.hash)) lastPage = 'mon-espace';
  else if (typeof MES_LEGACY_PAGES !== 'undefined' && MES_LEGACY_PAGES[lastPage]) {
    MesUI.pending = { tab: MES_LEGACY_PAGES[lastPage] };
    lastPage = 'mon-espace';
  }
  if (!document.getElementById(`page-${lastPage}`) && lastPage !== 'equipe') lastPage = 'dashboard';
  const navItem = document.querySelector(`.nav-item[data-page="${lastPage}"]`);
  if (navItem) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    navItem.classList.add('active');
  }
  // window.renderPage et non renderPage : la restauration passait par la
  // déclaration nue, donc sautait les wrappers de dispatch. Une page
  // rouverte au démarrage (rapports, audit, absences) n'affichait alors
  // que son conteneur vide.
  // Les wrappers sont assignés dans des scripts chargés plus loin, mais les
  // `await` ci-dessus rendent la main au parseur : à ce point, la
  // chaîne complète est en place.
  window.renderPage(navItem ? lastPage : 'dashboard');
}

function showSkeletons() {
  ['dc-total-val','dc-open-val','dc-breach-val','dc-sla-val','dc-res-val','dc-today-val'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<span class="skeleton" style="display:inline-block;width:56px;height:36px;border-radius:6px"></span>';
  });
  ['dc-domain-list','dc-prio-list','dc-status-list','dc-heatmap-body'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = Array(4).fill('<div class="skeleton" style="height:12px;width:100%;margin:7px 0;border-radius:4px"></div>').join('');
  });
}

async function loadAll() {
  const [st, obs, dash, bo, shiftsPlan, foTasks, rotaConfig, holidays, shiftRequests, quizzes, quizResults, weeklyProgress, quizProgress] = await Promise.all([
    fetchSitesAndTickets().catch(() => ({ sites: [], tickets: {} })),
    fetch(`${API}/api/observations`).then(r => r.json()),
    fetch(`${API}/api/dashboard`).then(r => r.json()),
    fetch(`${API}/api/bo`).then(r => r.json()),
    fetch(`${API}/api/shifts-plan`).then(r => r.json()),
    fetch(`${API}/api/fo-tasks`).then(r => r.json()),
    fetch(`${API}/api/rota/config`).then(r => r.json()).catch(() => ({ sites: [] })),
    fetch(`${API}/api/holidays`).then(r => r.json()).catch(() => []),
    fetch(`${API}/api/shift-requests`).then(r => r.json()).catch(() => []),
    fetch(`${API}/api/quizzes`).then(r => r.json()).catch(() => []),
    fetch(`${API}/api/quiz/results`).then(r => r.json()).catch(() => []),
    fetch(`${API}/api/weekly-progress`).then(r => r.json()).catch(() => []),
    fetch(`${API}/api/quiz/progress`).then(r => r.json()).catch(() => []),
  ]);
  // Une liste refusée (connexion requise, page réservée) arrive en objet
  // { error } : on la traite comme vide plutôt que de casser les écrans.
  const L = v => Array.isArray(v) ? v : [];
  state.sites = L(st.sites); state.tickets = st.tickets || {};
  for (const c of siteCodes()) state.tickets[c] = L(state.tickets[c]);
  fillSiteSelects();
  if (typeof renderCountryToggle === 'function') renderCountryToggle();
  state.observations = L(obs); state.dashboard = dash; state.boList = L(bo);
  state.shiftsPlan = L(shiftsPlan); state.foTasks = L(foTasks); state.rotaConfig = rotaConfig;
  state.holidays = L(holidays); state.shiftRequests = L(shiftRequests);
  state.quizzes = L(quizzes); state.quizResults = L(quizResults);
  state.weeklyProgress = L(weeklyProgress);
  state.quizProgress = Array.isArray(quizProgress) ? quizProgress : [];
  // Les compteurs se calculent par rapport à cet instant : le remettre à
  // jour ici couvre tous les appelants, pas seulement la synchronisation
  // périodique. Sans cela, un rechargement déclenché par une action
  // laisserait les comptes à rebours dériver du temps écoulé depuis la
  // dernière synchronisation.
  _dernierSync = Date.now();
  populateFilterDropdowns();
  _updateRequestsBadge();
  // Les rappels sont dérivés de `state` : ils se recalculent à chaque
  // rechargement, sinon la cloche resterait figée après une action.
  try { if (window.NF) NF.render(); } catch (_) {}
}

function _updateRequestsBadge() {
  const pending = (state.shiftRequests || []).filter(r => r.status === 'pending').length;
  const badge = document.getElementById('shift-requests-badge');
  if (badge) { badge.textContent = pending || ''; badge.style.display = pending ? '' : 'none'; }
}

async function loadConfig() {
  // L'en-tête d'administration est indispensable, pas optionnel : sans lui,
  // GET /api/config retire les blocs nominatifs (fo_o2o, fo_scorecards,
  // fo_performance, fo_engagement). state.config les aurait donc à
  // `undefined`, et le premier enregistrement les renverrait à `{}` — ce qui
  // les effaçait sur le disque. Le PUT était déjà authentifié ; c'est cette
  // lecture qui ne l'était pas.
  state.config = await fetch(`${API}/api/config`, {
    headers: AdminSession.headers(),
    credentials: 'same-origin',
  }).then(r => r.json());
  state.rotaConfig = await fetch(`${API}/api/rota/config`).then(r => r.json()).catch(() => ({ sites: [] }));
  // Agent renommé depuis la Configuration : le profil gardé dans ce
  // navigateur porte encore l'ancien nom, qui ne correspond plus à rien.
  const renomme = (state.config.fo_renames || {})[currentUser?.name];
  if (renomme) {
    currentUser = { ...currentUser, name: renomme };
    try { localStorage.setItem('fo-user', JSON.stringify(currentUser)); } catch {}
  }
  _hideWeekends = !!state.config.hide_weekends;
  _updateWeekendBtn();
  // La barre latérale dépend de `nav_profiles`, qui vit dans la config.
  // applyNavMode() ne tournait qu'au DOMContentLoaded et à la synchro de
  // session admin — dans les deux cas AVANT que la config ne soit
  // chargée. Elle lisait donc systématiquement une config vide, en
  // concluait « aucune restriction », et la vue enregistrée n'était
  // jamais appliquée : le réglage semblait sans effet.
  if (typeof applyNavMode === 'function') applyNavMode();
}

function populateFilterDropdowns() {
  const cfg = state.config;

  function fillSelect(id, items, firstOptionHTML) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = firstOptionHTML + (items||[]).map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
  }

  // SN filters
  fillSelect('sn-filter-status',   cfg.ticket_statuses||[],  '<option value="">All statuses</option>');
  fillSelect('sn-filter-priority', cfg.ticket_priorities||[], '<option value="">All priorities</option>');
  fillSelect('sn-filter-domain',   cfg.domains||[],           '<option value="">All domains</option>');
  fillSelect('sn-filter-fo',       cfg.fo_list||[],           '<option value="">All FOs</option>');

  // CI filters
  fillSelect('ci-filter-status',   cfg.ticket_statuses||[],  '<option value="">All statuses</option>');
  fillSelect('ci-filter-priority', cfg.ticket_priorities||[], '<option value="">All priorities</option>');
  fillSelect('ci-filter-domain',   cfg.domains||[],           '<option value="">All domains</option>');
  fillSelect('ci-filter-fo',       cfg.fo_list||[],           '<option value="">All FOs</option>');

  // Global filters
  fillSelect('global-filter-status',   cfg.ticket_statuses||[],  '<option value="">All statuses</option>');
  fillSelect('global-filter-priority', cfg.ticket_priorities||[], '<option value="">All priorities</option>');
  fillSelect('global-filter-domain',   cfg.domains||[],           '<option value="">All domains</option>');
  fillSelect('global-filter-fo',       cfg.fo_list||[],           '<option value="">All FOs</option>');

  // Table generator filters (if page is open)
  fillSelect('tgen-filter-status',   cfg.ticket_statuses||[],  '<option value="">All</option>');
  fillSelect('tgen-filter-priority', cfg.ticket_priorities||[], '<option value="">All</option>');
  fillSelect('tgen-filter-domain',   cfg.domains||[],           '<option value="">All</option>');
  fillSelect('tgen-filter-fo',       cfg.fo_list||[],           '<option value="">All</option>');
}

// ── NAV ──────────────────────────────────────────────────────
function initNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      window.renderPage(item.dataset.page);
      localStorage.setItem('pearl-last-page', item.dataset.page);
      closeSidebar();
    });
  });
}

function toggleSidebar() {
  const sb = document.querySelector('.sidebar');
  const ov = document.getElementById('sidebar-overlay');
  if (!sb) return;
  sb.classList.toggle('sb-open');
  if (ov) ov.style.display = sb.classList.contains('sb-open') ? 'block' : 'none';
}
function closeSidebar() {
  const sb = document.querySelector('.sidebar');
  const ov = document.getElementById('sidebar-overlay');
  if (sb) sb.classList.remove('sb-open');
  if (ov) ov.style.display = 'none';
}

function renderPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const el = document.getElementById(`page-${page}`);
  if (el) el.classList.add('active');
  if (page === 'dashboard')      { renderDashboard(); if (typeof renderHome === 'function') renderHome(); }
  if (page === 'site')           renderTracker(activeSiteKey());
  if (page === 'global')         renderGlobalTracker();
  if (page === 'observations')   renderObservations();
  if (page === 'fo-dashboard')   renderFoDashboard();
  if (page === 'fo-tasks')       renderFOTasks();
  if (page === 'weekly-progress') renderWeeklyProgress();
  if (page === 'quiz')           renderQuiz();
  if (page === 'config')         renderConfig();
  if (page === 'ops-review')     _renderOpsReviewPage();
  // report pages are handled by the override wrappers below - do NOT call them here
}


// ── MOTIVATIONAL QUOTES ──────────────────────────────────────
const QUOTES = [
  { text: "Excellence is not a destination but a continuous journey.", author: "Brian Tracy" },
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "Quality is not an act, it is a habit.", author: "Aristote" },
  { text: "Do not wait for the perfect moment, take the moment and make it perfect.", author: "Zoey Sayward" },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { text: "Success is the sum of small efforts, repeated day in and day out.", author: "Robert Collier" },
  { text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Discipline is the bridge between goals and accomplishment.", author: "Jim Rohn" },
  { text: "An ounce of prevention is worth a pound of cure.", author: "Benjamin Franklin" },
  { text: "Perseverance is not a long race; it is many short races one after the other.", author: "Walter Elliot" },
  { text: "The harder you work, the luckier you get.", author: "Gary Player" },
];

function getDailyQuote() {
  const idx = new Date().getDate() % QUOTES.length;
  return QUOTES[idx];
}

// ── CLOCK ────────────────────────────────────────────────────
function startClock() {
  // Heure compacte (« 15:31 UTC ») : la date complète reste dans l'infobulle.
  // L'heure est utile pour lire les SLA ; la date, rarement — elle ne mérite
  // plus la place la plus en vue de la barre.
  function update() {
    const el = document.getElementById('topbar-clock');
    if (!el) return;
    const now    = new Date();
    const locale = (typeof LOCALE_MAP !== 'undefined' ? LOCALE_MAP[currentLang] : null) || (globalThis.PEAR_LOCALE || 'fr-FR');
    el.textContent = now.toLocaleTimeString(locale, { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' }) + ' UTC';
    el.title = now.toLocaleString(locale, { timeZone: 'UTC', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' (UTC+0)';
  }
  update(); setInterval(update, 1000);
}

// ── COUNTDOWNS ───────────────────────────────────────────────
// Deux rythmes distincts, et c'est le cœur du sujet : l'affichage du temps
// restant est un calcul LOCAL, il n'a jamais eu besoin du serveur.
//
// Cette boucle appelait `loadAll()` — 14 requêtes — toutes les 30 s, pour
// ne réécrire qu'un compte à rebours. Soit 1 680 requêtes par heure et par
// onglet ouvert, chacune relisant les fichiers de données sur le disque.
// C'était la cause de la lenteur ressentie pendant l'utilisation.
//
// `time_left_ms` vient d'une échéance fixe calculée par le serveur : il
// suffit d'en retirer le temps écoulé depuis la dernière synchronisation.
// L'affichage devient donc plus fluide (chaque seconde au lieu de 30) tout
// en supprimant les requêtes.
const COUNTDOWN_TICK_MS = 1000;      // rafraîchissement de l'affichage
const RESYNC_MS = 5 * 60 * 1000;     // rechargement réel des données

function _rafraichirCompteurs() {
  // Temps écoulé depuis la dernière synchronisation : on le retranche des
  // échéances reçues, sans rien redemander au serveur.
  const ecoule = Date.now() - _dernierSync;
  siteCodes().forEach(code => {
    ticketsOf(code).forEach(t => {
      const el = document.getElementById(`tl-${t.id}`);
      if (!el) return;                       // ligne non affichée : rien à faire
      // Ticket On Hold : SLA gelé, le temps restant ne défile pas.
      const restant = t.time_left_ms === null || t.time_left_ms === undefined
        ? t.time_left_ms
        // Ticket clos : le temps est celui de la clôture, il ne défile plus.
        : (t.sla_status === 'On Hold' || t.status === 'Resolved' || t.status === 'Closed')
          ? t.time_left_ms : t.time_left_ms - ecoule;
      el.textContent = formatTimeLeft(restant, t.status);
      el.className = 'timeleft ' + timeLeftClass(restant, t.status);
    });
  });

  const b = (state.dashboard && state.dashboard.breach) || 0;
  const badge = document.getElementById('breach-badge');
  const bcl = document.getElementById('breach-count-label');
  if (!badge) return;
  if (b > 0) {
    // Le mot est à part : sur téléphone, seul le nombre reste affiché.
    if (bcl) bcl.innerHTML = `${Number(b)}<span class="bcl-word"> BREACH</span>`;
    badge.classList.add('visible');
  } else badge.classList.remove('visible');
}

function startCountdowns() {
  if (countdownInterval) clearInterval(countdownInterval);
  if (resyncInterval) clearInterval(resyncInterval);

  _rafraichirCompteurs();
  countdownInterval = setInterval(_rafraichirCompteurs, COUNTDOWN_TICK_MS);

  // La synchronisation reste nécessaire : elle fait apparaître les tickets
  // créés par les autres postes. Toutes les 5 minutes suffisent — un
  // changement de SLA ne se joue pas à la seconde.
  resyncInterval = setInterval(async () => {
    // Onglet en arrière-plan : personne ne regarde, on ne charge rien. Le
    // retour au premier plan déclenche une synchronisation immédiate.
    if (document.hidden) return;
    try {
      await loadAll();
      _dernierSync = Date.now();
      _rafraichirCompteurs();
    } catch (_) { /* réseau momentané : on retentera au prochain tour */ }
  }, RESYNC_MS);
}

// Revenir sur l'onglet après une absence prolongée doit montrer l'état réel,
// sans attendre la prochaine échéance de synchronisation.
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) return;
  if (Date.now() - _dernierSync < 60000) return;   // synchronisé à l'instant
  try {
    await loadAll();
    _dernierSync = Date.now();
    _rafraichirCompteurs();
  } catch (_) { /* sans conséquence : l'affichage reste sur les données en place */ }
});

