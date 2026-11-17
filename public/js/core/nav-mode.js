// ══════════════════════════════════════════════════════════════
// BASCULE SIMPLE / ADMIN
// Deux interfaces sur la même barre : en mode Admin on ne montre que
// les écrans d'administration, en mode Simple que les écrans courants.
// On utilise `nav-mode-off` et non `nav-hidden` : ce dernier appartient
// au filtre de recherche, et les deux se marcheraient dessus.
// ══════════════════════════════════════════════════════════════
// Liste de repli, utilisée avant que page-dispatch.js ne soit évalué : cette
// fonction tourne au DOMContentLoaded, donc parfois plus tôt.
//
// La liste qui fait foi est ADMIN_ONLY_PAGES (js/core/page-dispatch.js) — c'est elle qui
// commande l'accès aux pages. On la lit à chaque appel plutôt que de
// recopier son contenu ici : la consigne « doit rester alignée » n'a pas
// tenu, sept pages admin ajoutées depuis n'ont jamais été reportées, et
// trois d'entre elles s'affichaient donc en mode Simple — exactement
// l'inverse de ce qui était voulu. Une copie qu'il faut penser à mettre
// à jour finit toujours par diverger ; on supprime la copie.
const NAV_ADMIN_FALLBACK = ['config', 'audit', 'shift-approvals', 'data-quality', 'ops-review', 'export', 'mailing',
  'cfg-annonces', 'cfg-general', 'cfg-sla', 'cfg-goals', 'cfg-perf', 'cfg-rota',
  'cfg-security', 'cfg-data', 'cfg-quiz', 'cfg-glossary', 'cfg-sessions', 'cfg-training',
  'cfg-o2o', 'cfg-assign', 'cfg-myteam', 'cfg-objectifs', 'cfg-vues', 'equipe', 'ai', 'ai-cockpit'];

function navAdminPages() {
  return (typeof ADMIN_ONLY_PAGES !== 'undefined' && Array.isArray(ADMIN_ONLY_PAGES))
    ? ADMIN_ONLY_PAGES : NAV_ADMIN_FALLBACK;
}

// ── Vues par profil ───────────────────────────────────────────
// La barre porte une trentaine d'entrées ; personne n'a besoin des
// trente. L'admin compose la liste de chaque profil dans
// Admin › Vues par profil, et elle est appliquée ici.
//
// Réglage de confort, pas de sécurité : ce qui protège une page reste la
// session admin côté serveur. Masquer une entrée évite d'avoir à la
// parcourir, ça n'interdit pas d'y aller par son URL.
function navProfileKey() {
  // Est « non connecté » qui n'a pas d'identité vérifiée, quel que soit le
  // mode : mot de passe d'équipe seul (consultation), code personnel exigé
  // ou délivré sans session ouverte, ou aucun profil du tout. L'admin en
  // session n'est jamais concerné.
  const ti = window.TeamIdentity;
  if (ti && ti.admin) return _navRoleKey();
  if (ti && ti.pret && (ti.actif || ti.exige || ti.codes) && (ti.lecture || !ti.user)) return 'Guest';
  if (ti && ti.pret && !ti.user && !(typeof currentUser !== 'undefined' && currentUser)) return 'Guest';
  return _navRoleKey();
}
// Profil d'un utilisateur identifié (ou du nom choisi, hors verrou).
function _navRoleKey() {
  const r = (typeof currentUser !== 'undefined' && currentUser && currentUser.role) || '';
  if (r === 'FO' || r === 'BO') return r;
  // Rôle créé par l'admin (SMC, DRPS…) : il a sa propre vue.
  const extra = (typeof state !== 'undefined' && state.config && state.config.parties && state.config.parties.roles) || [];
  if (r && extra.some(x => x.key === r)) return r;
  return r ? 'Observer' : '';
}

// Identifiant employé de l'utilisateur courant, normalisé. C'est la seule
// donnée d'identité stable : le nom se saisit à la main et varie, l'ID
// est validé à la saisie et sert déjà de clé pour les accès FO.
function navUserId() {
  const v = (typeof currentUser !== 'undefined' && currentUser && currentUser.employeeId) || '';
  return String(v).trim().toLowerCase();
}

// Pages réservées : visibles de l'admin en session, et des seuls ID
// nommément autorisés. C'est une couche distincte des vues par profil —
// celles-ci allègent une barre trop longue, celle-ci restreint.
//
// Une page réservée à personne n'est réservée à rien : tant qu'aucun ID
// n'est inscrit, elle reste soumise aux seules vues par profil. Sans
// cette règle, cocher « réservée » la ferait disparaître pour tout le
// monde d'un coup, y compris pour ceux qui l'utilisent.
// L'utilisateur figure-t-il dans une liste d'ID réservés ? Même règle que le
// serveur (auth/identity.js, idsDe) : reconnu par l'ID de son code, celui de
// sa fiche agent ou son nom.
function navIdsMatch(ids) {
  const cfg = (typeof state !== 'undefined' && state.config) || {};
  const nom = (typeof currentUser !== 'undefined' && currentUser && currentUser.name) || '';
  const miens = [navUserId(), (cfg.fo_ids || {})[nom], nom]
    .map(x => String(x || '').trim().toLowerCase()).filter(Boolean);
  return (ids || []).some(id => miens.includes(String(id).trim().toLowerCase()));
}

function navReservedFor(page) {
  const cfg = (typeof state !== 'undefined' && state.config && state.config.nav_reserved) || null;
  const ids = cfg && cfg[page];
  return Array.isArray(ids) && ids.length
    ? ids.map(x => String(x).trim().toLowerCase()).filter(Boolean)
    : null;
}

// Visibilité d'une page hors admin, vues par profil et pages réservées
// composées. Une page réservée à un ID est visible de cet ID même si la
// vue de son profil ne la contient pas : c'est tout l'intérêt de la
// réserver à quelqu'un. Jusqu'ici la réservation ne faisait que retirer,
// et l'ID inscrit ne voyait rien si son profil n'avait pas la page.
function navPageVisible(page, allowed, canAdmin) {
  const ids = navReservedFor(page);
  if (ids) {
    if (canAdmin) return true;
    return navIdsMatch(ids);
  }
  // L'Academy remplace les entrées DigitalView et Process ITSM : un profil
  // composé avant elle, qui cochait l'une des deux, la voit.
  if (page === 'academy' && allowed && (allowed.has('digitalview') || allowed.has('process-training'))) return true;
  // L'Idea box est arrivée après les premières vues composées : une vue
  // enregistrée avant elle (sans nav_profiles_v) la montre, pour ne pas la
  // faire disparaître à la mise à jour. Le prochain enregistrement tranche.
  if (page === 'ideas' && allowed && !((typeof state !== 'undefined' && state.config && state.config.nav_profiles_v) >= 2)) return true;
  return !allowed || allowed.has(page);
}

// `null` = aucune restriction (profil inconnu, ou vue non configurée :
// tant que l'admin n'a rien décidé, on n'ampute la barre de personne).
function navAllowedPages() {
  const key = navProfileKey();
  if (!key) return null;
  const cfg = (typeof state !== 'undefined' && state.config && state.config.nav_profiles) || null;
  const list = cfg && cfg[key];
  if (!Array.isArray(list) || !list.length) return null;
  // Le tableau de bord n'est jamais retirable : c'est la page d'atterrissage.
  return new Set([...list, 'dashboard']);
}

function getNavMode() {
  // Sous /admin/app on est en Admin : c'est ce que la page sert, et un
  // « simple » mémorisé y afficherait une barre vide. Ailleurs, seul le
  // mode Simple existe (les écrans admin ne sont pas dans le document).
  // Le mode vit en mémoire depuis que la bascule ne navigue plus.
  return _navMode;
}

// Mode courant en mémoire : hors de /admin/app, la bascule ne navigue
// plus, donc l'URL ne peut plus porter l'information à elle seule.
let _navMode = location.pathname.startsWith('/admin') ? 'admin' : 'simple';

// Le fragment admin n'est présent dans l'app publique qu'une fois
// injecté ; on ne le redemande pas à chaque bascule.
let _adminFragmentLoaded = false;
let _adminFragmentPending = null;

// Récupère le fragment admin et le pose dans l'emplacement laissé vide
// par le serveur. Renvoie false si le serveur refuse (session absente
// ou expirée) : l'appelant retombe alors sur l'écran de connexion.
async function ensureAdminFragment() {
  if (_adminFragmentLoaded) return true;
  if (document.getElementById('page-config')) { _adminFragmentLoaded = true; return true; }
  // Un double clic ne doit pas lancer deux requêtes ni injecter deux fois.
  if (_adminFragmentPending) return _adminFragmentPending;

  _adminFragmentPending = (async () => {
    try {
      const res = await fetch('/api/admin/config-page', {
        headers: (typeof AdminSession !== 'undefined') ? AdminSession.headers() : {},
        credentials: 'same-origin',
      });
      if (!res.ok) return false;
      const html = await res.text();

      const slot = document.getElementById('admin-slot');
      if (!slot) return false;
      // insertAdjacentHTML et non innerHTML sur un conteneur : le fragment
      // est une suite de <div class="page">, qui doivent devenir frères
      // des autres pages pour que renderPage les trouve.
      slot.insertAdjacentHTML('afterend', html);

      // Le fragment arrive après le câblage initial : les écrans admin
      // ont besoin de leurs listes déroulantes et de leurs écouteurs.
      if (typeof populateFilterDropdowns === 'function') {
        try { populateFilterDropdowns(); } catch {}
      }
      if (typeof SidePanel !== 'undefined' && SidePanel._ready) {
        SidePanel._ready = false; SidePanel.init();
      }
      _adminFragmentLoaded = true;
      return true;
    } catch {
      return false;
    } finally {
      _adminFragmentPending = null;
    }
  })();
  return _adminFragmentPending;
}

async function setNavMode(mode) {
  const next = mode === 'admin' ? 'admin' : 'simple';

  // Sous /admin/app le serveur a déjà tout envoyé : rien à charger, et
  // repartir vers '/' relancerait justement le rechargement qu'on évite.
  if (next === 'admin' && !location.pathname.startsWith('/admin')) {
    // Sans session, inutile de demander le fragment : le serveur le
    // refuserait. On envoie à l'écran de connexion, comme avant.
    const canAdmin = typeof AdminSession !== 'undefined' && AdminSession.active;
    if (!canAdmin) { location.href = '/admin'; return; }
    const ok = await ensureAdminFragment();
    if (!ok) { location.href = '/admin'; return; }
  }

  _navMode = next;
  applyNavMode();
}

function applyNavMode() {
  const sw = document.getElementById('nav-mode-switch');
  // La bascule est toujours visible : c'est elle qui sert de porte
  // d'entrée vers l'admin. Sans session, cliquer « Admin » emmène à
  // l'écran de connexion — d'où le cadenas affiché sur le bouton.
  if (sw) sw.hidden = false;

  const canAdmin = typeof AdminSession !== 'undefined' && AdminSession.active;
  const adminBtn = sw?.querySelector('.nav-mode-btn[data-mode="admin"]');
  if (adminBtn) {
    adminBtn.classList.toggle('needs-auth', !canAdmin);
    adminBtn.title = canAdmin ? '' : 'Connexion administrateur requise';
  }

  // Le mode Admin n'a de sens que si les écrans admin sont réellement
  // dans le document : sous /admin/app le serveur les a envoyés, ailleurs
  // c'est ensureAdminFragment() qui les a injectés. Sans eux, la barre
  // afficherait des entrées menant à des pages inexistantes.
  const adminPagesPresent = !!document.getElementById('page-config');
  const mode = (canAdmin && adminPagesPresent) ? getNavMode() : 'simple';
  sw?.querySelectorAll('.nav-mode-btn').forEach(b =>
    b.classList.toggle('is-active', b.dataset.mode === mode));

  // Vue du profil courant : la liste des pages qu'un FO, un BO ou un
  // observateur doit voir. Elle se compose avec le mode Simple/Admin —
  // elle ne le remplace pas : masquer une page ici ne la déverrouille
  // jamais, et une page admin reste derrière la session admin.
  //
  // L'admin en session voit tout : sans cette exception, se restreindre
  // soi-même reviendrait à se couper l'accès à l'écran qui sert à le
  // corriger.
  const allowed = (canAdmin && mode === 'admin') ? null : navAllowedPages();

  const adminPages = navAdminPages();
  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    const page = item.dataset.page;
    // Rapports sert les deux modes : ses onglets de rapport sont ceux de
    // tout le monde, Ops Review, Diffusion et Exports ceux de l'admin. Sa
    // visibilité se déduit des onglets permis (reports-hub.js), et la page
    // ouverte suit une session qui s'ouvre ou se ferme.
    if (page === 'rapports' && typeof rpNavVisible === 'function') {
      item.classList.toggle('nav-mode-off', !rpNavVisible());
      if (typeof rpRefreshTabs === 'function') rpRefreshTabs();
      return;
    }
    // My Space : même logique, ses onglets suivent les anciennes clés
    // (weekly-progress, my-requests, my-perf, quiz) — mon-espace.js.
    if (page === 'mon-espace' && typeof mesNavVisible === 'function') {
      item.classList.toggle('nav-mode-off', !mesNavVisible());
      if (typeof mesRefreshTabs === 'function') mesRefreshTabs();
      return;
    }
    const isAdmin = adminPages.includes(page);
    let off = mode === 'admin' ? !isAdmin : isAdmin;
    // Vue du profil et pages réservées (navPageVisible) : l'admin en
    // session voit toujours une page réservée ; un ID inscrit la voit même
    // si son profil ne l'a pas.
    if (!off && mode !== 'admin' && !navPageVisible(page, allowed, canAdmin)) off = true;
    item.classList.toggle('nav-mode-off', off);
  });

  // Un titre de section dont tous les items sont masqués n'a plus lieu
  // d'être : on le retire aussi, sinon la barre garde des en-têtes vides.
  document.querySelectorAll('.sidebar-group[data-group]').forEach(g => {
    const alive = !!g.querySelector('.nav-item:not(.nav-mode-off)');
    g.classList.toggle('nav-mode-off', !alive);
    const section = document.querySelector(`.sidebar-section[data-section="${g.dataset.group}"]`);
    if (section) section.classList.toggle('nav-mode-off', !alive);
  });
  // Le sous-titre « Configuration » suit ses rubriques : en mode
  // Simple elles disparaissent, l'intitulé n'a plus rien à coiffer.
  document.querySelectorAll('.sidebar-subsection').forEach(sub => {
    let alive = false;
    for (let el = sub.nextElementSibling; el && el.classList.contains('nav-item'); el = el.nextElementSibling) {
      if (!el.classList.contains('nav-mode-off')) { alive = true; break; }
    }
    sub.classList.toggle('nav-mode-off', !alive);
  });

  // Le tracker affiché dépend aussi de la vue du profil (locale.js).
  if (typeof _applyCountryNav === 'function') { try { _applyCountryNav(); } catch (e) {} }

  // Badges « NEW » posés par l'admin (nav-new.js).
  if (typeof navNewApply === 'function') navNewApply();

  document.querySelectorAll('.sidebar-section:not([data-section])').forEach(section => {
    let alive = false;
    for (let el = section.nextElementSibling; el && !el.classList.contains('sidebar-section'); el = el.nextElementSibling) {
      if (el.classList.contains('nav-item') && !el.classList.contains('nav-mode-off')) { alive = true; break; }
    }
    section.classList.toggle('nav-mode-off', !alive);
  });
}

// Applique le mode dès le chargement, sans attendre la revalidation de
// session : la barre doit être correcte au premier rendu. AdminSession
// (défini dans js/core/admin-session.js, chargé plus bas) rappellera applyNavMode() via
// syncIndicator() quand la session sera confirmée.
document.addEventListener('DOMContentLoaded', applyNavMode);

// Filtre : masque les items qui ne matchent pas et ouvre d'office
// toutes les sections encore porteuses de résultats.
function filterNav(q) {
  const term = (q || '').trim().toLowerCase();
  const groups = document.querySelectorAll('.sidebar-group[data-group]');

  if (!term) {
    document.querySelectorAll('.nav-item.nav-hidden,.sidebar-section.nav-hidden')
      .forEach(el => el.classList.remove('nav-hidden'));
    groups.forEach(g => g.classList.remove('nav-force-open'));
    restoreSidebarSections();
    const active = document.querySelector('.nav-item.active');
    if (active) autoRevealSection(active.dataset.page);
    return;
  }

  document.querySelectorAll('.nav-item').forEach(item => {
    const label = (item.querySelector('.nav-item-label')?.textContent || '').toLowerCase();
    item.classList.toggle('nav-hidden', !label.includes(term));
  });

  // une section n'est visible que si elle contient encore un résultat
  groups.forEach(g => {
    const hasHit = !!g.querySelector('.nav-item:not(.nav-hidden)');
    g.classList.toggle('nav-force-open', hasHit);
    const section = document.querySelector(`.sidebar-section[data-section="${g.dataset.group}"]`);
    if (section) section.classList.toggle('nav-hidden', !hasHit);
  });

  // titres de sections sans groupe (General, Trackers, Outils…)
  document.querySelectorAll('.sidebar-section:not([data-section])').forEach(section => {
    let hasHit = false;
    for (let el = section.nextElementSibling; el && !el.classList.contains('sidebar-section'); el = el.nextElementSibling) {
      if (el.classList.contains('nav-item') && !el.classList.contains('nav-hidden')) { hasHit = true; break; }
    }
    section.classList.toggle('nav-hidden', !hasHit);
  });
}

// Un repli/dépli manuel désactive l'accordéon automatique.
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.sidebar-section[data-section]').forEach(s => {
    s.addEventListener('click', () => localStorage.setItem(SIDEBAR_AUTO_KEY, 'off'));
  });
  restoreSidebarSections();
  const active = document.querySelector('.nav-item.active');
  if (active) autoRevealSection(active.dataset.page);

  // Top app bar : surface élevée dès que le contenu scrolle
  const main = document.querySelector('.main');
  const topbar = document.querySelector('.topbar');
  if (main && topbar) {
    main.addEventListener('scroll', () => {
      topbar.classList.toggle('m3-scrolled', main.scrollTop > 4);
    }, { passive: true });
  }
});

