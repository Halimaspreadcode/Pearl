/* ══════════════════════════════════════════════════════════════
   RAPPORTS (menu › Reporting › Rapports)

   Une seule entrée pour ce qui se produit, se diffuse et s'exporte :
   Daily · Weekly · Monthly · Ops Review · Diffusion · Exports. Six
   écrans répartis entre le menu Reporting, la Vue d'ensemble (Diffusion)
   et le groupe Admin (Export) sont réunis ici, en onglets.

   Rien n'est réécrit : chaque onglet déplace dans #rp-mount le conteneur
   d'un écran existant (#page-daily-report, #page-mailing…) et appelle son
   rendu habituel. Le style de ces écrans est ancré sur leur identifiant :
   un nœud déplacé garde le sien, donc son apparence.

   Qui voit quoi :
     · Daily, Weekly, Monthly — tout le monde, selon « Vues par profil »
       et les pages réservées, lus sur les ANCIENNES clés (daily-report,
       weekly-report, monthly-report) : les réglages déjà enregistrés
       gardent leur sens, sans migration ;
     · Ops Review, Diffusion, Exports — session admin seulement : leurs
       écrans vivent dans le fragment admin, et le serveur garde ses
       propres verrous.

   Audit Trail reste une entrée à part : ce n'est pas un rapport qu'on
   produit ou qu'on diffuse, c'est l'historique des modifications qu'on
   consulte pour retrouver qui a changé quoi — un outil de traçabilité
   admin, pas une vue de l'activité.

   Les anciens noms de page passent par rpLegacyRedirect(), appelé par
   page-dispatch.js : liens, épingles et raccourcis existants mènent à
   l'onglet correspondant. Adresse : #rapports/<onglet>.
   ══════════════════════════════════════════════════════════════ */

// `page` : l'écran monté, qui est aussi l'ancienne clé de page (menu,
// Vues par profil, épingles). `render` : sa fonction de rendu, appelée
// par window[…] pour passer par les enveloppes (page-wrappers.js).
const RP_TABS = [
  { id: 'daily',      l: 'Daily',      page: 'daily-report',   render: 'renderPage_daily' },
  { id: 'weekly',     l: 'Weekly',     page: 'weekly-report',  render: 'renderPage_weekly' },
  { id: 'monthly',    l: 'Monthly',    page: 'monthly-report', render: 'renderMonthlyReport' },
  { id: 'ops-review', l: 'Ops Review', page: 'ops-review',     render: '_renderOpsReviewPage', admin: true },
  { id: 'diffusion',  l: 'Diffusion',  page: 'mailing',        render: 'renderMailingPage',    admin: true },
  { id: 'exports',    l: 'Exports',    page: 'export',         admin: true },
];

// Ancienne page → onglet. Lue par page-dispatch.js, init.js et pinned.js :
// une seule table, pas de copie à aligner.
const RP_LEGACY_PAGES = Object.fromEntries(RP_TABS.map(t => [t.page, t.id]));

const RP_TAB_KEY = 'emoc-rapports-tab';

const RpUI = {
  tab: null,          // onglet affiché
  pending: null,      // intention posée par rpOpen() avant renderPage
  hashRead: false,
};

function _rpEl(id) { return document.getElementById(id); }
function _rpDef(id) { return RP_TABS.find(t => t.id === id) || null; }
function _rpActive() { return !!_rpEl('page-rapports')?.classList.contains('active'); }
function _rpCanAdmin() { return typeof AdminSession !== 'undefined' && !!AdminSession.active; }

// Mode Admin effectif, calculé comme dans applyNavMode (nav-mode.js) :
// la barre et les onglets doivent dire la même chose.
function _rpAdminMode() {
  return _rpCanAdmin() && !!_rpEl('page-config')
    && typeof getNavMode === 'function' && getNavMode() === 'admin';
}

// ── Droits par onglet ─────────────────────────────────────────
// Un onglet d'admin demande la session. Un onglet de rapport suit les
// mêmes règles que son ancienne entrée de menu : vue du profil (sauf en
// mode Admin), puis pages réservées (sauf pour l'admin en session).
function _rpTabAllowed(t) {
  if (!t) return false;
  if (t.admin) return _rpCanAdmin();
  if (_rpAdminMode()) return true;
  const allowed = typeof navAllowedPages === 'function' ? navAllowedPages() : null;
  // Même règle que la barre : un ID inscrit sur une page réservée la voit
  // même si la vue de son profil ne la contient pas.
  if (typeof navPageVisible === 'function') return navPageVisible(t.page, allowed, _rpCanAdmin());
  return !allowed || allowed.has(t.page);
}

// Entrée « Rapports » de la barre (appelé par applyNavMode) : visible en
// mode Admin, et en mode Simple dès qu'un des trois rapports l'est — un
// profil qui voyait Daily Report voit Rapports.
function rpNavVisible() {
  return _rpAdminMode() || RP_TABS.some(t => !t.admin && _rpTabAllowed(t));
}

// Onglets affichés. La vue par profil est un réglage de confort, pas un
// verrou : un rapport ouvert explicitement (ancien lien, adresse) reste
// affiché, comme l'ancienne page l'était par son nom.
function _rpVisibleTabs() {
  return RP_TABS.filter(t => _rpTabAllowed(t) || (!t.admin && t.id === RpUI.tab));
}

// ── Navigation ────────────────────────────────────────────────
// Point d'entrée des liens internes : on pose l'intention, puis on passe
// par renderPage pour que toute la chaîne (barre latérale, présence,
// épingles, dernière page) suive comme pour n'importe quelle page.
function rpOpen(tab) {
  RpUI.pending = { tab: tab || null };
  window.renderPage('rapports');
}
function rpLegacyRedirect(page) { rpOpen(RP_LEGACY_PAGES[page]); }

function _rpRemembered() {
  try { return localStorage.getItem(RP_TAB_KEY) || ''; } catch (_) { return ''; }
}
function _rpRemember(id) {
  try { localStorage.setItem(RP_TAB_KEY, id); } catch (_) {}
}

// ── Adresse ───────────────────────────────────────────────────
function _rpParseHash(h) {
  const m = /^#rapports(?:\/([a-z-]*))?$/.exec(h || '');
  if (!m) return null;
  return { tab: _rpDef(m[1]) ? m[1] : null };
}

function _rpWriteHash() {
  const h = `#rapports/${RpUI.tab}`;
  if (location.hash === h) return;
  try { history.replaceState(null, '', location.pathname + location.search + h); } catch (_) {}
}

window.addEventListener('hashchange', () => {
  if (!/^#rapports(\/|$)/.test(location.hash)) return;
  const p = _rpParseHash(location.hash);
  if (!p || (p.tab === RpUI.tab && _rpActive())) return;
  rpOpen(p.tab);
});

// ── Rendu ─────────────────────────────────────────────────────
// Appelé par page-dispatch.js. `wasActive` : la page était déjà à
// l'écran (changement de pays, de langue) — on garde l'onglet ouvert.
function renderRapportsPage(wasActive) {
  let p = RpUI.pending;
  RpUI.pending = null;
  if (!p && !RpUI.hashRead) p = _rpParseHash(location.hash);
  RpUI.hashRead = true;

  const asked = p && p.tab;
  let tab = asked || (wasActive && RpUI.tab) || _rpRemembered();
  const def = _rpDef(tab);
  // Onglet d'admin sans session, onglet inconnu, ou onglet mémorisé que
  // le profil ne propose plus : on retombe sur le premier onglet permis.
  if (!def || (def.admin && !_rpCanAdmin()) || (!asked && !_rpTabAllowed(def))) {
    tab = (RP_TABS.find(_rpTabAllowed) || RP_TABS[0]).id;
  }
  RpUI.tab = tab;

  // L'entrée de menu suit la page, y compris quand on y arrive par un
  // ancien lien : la présence et les épingles lisent cette classe.
  document.querySelectorAll('.nav-item').forEach(n =>
    n.classList.toggle('active', n.dataset.page === 'rapports'));

  _rpRender();
}

function _rpRender() {
  _rpRenderHead();
  _rpRenderTabs();
  _rpRenderContent();
  _rpWriteHash();
  _rpRemember(RpUI.tab);
}

function _rpRenderHead() {
  const el = _rpEl('rp-head');
  if (!el) return;
  const admin = RP_TABS.some(t => t.admin && _rpTabAllowed(t));
  el.innerHTML = `<div class="rp-head">
    <h1 class="page-title">Reports</h1>
    <div class="page-sub">${admin
      ? 'Daily, weekly and monthly reports, Ops Review, mailing and exports'
      : 'Daily, weekly and monthly reports'}</div>
  </div>`;
}

// Envois programmés en échec : même source que le badge du menu
// (mailing.js, _mlApplyHealth). Un rapport qui n'est pas parti doit se
// voir avant d'ouvrir l'onglet.
function _rpBadge(id) {
  if (id !== 'diffusion' || typeof mlState === 'undefined') return 0;
  return ((mlState.health && mlState.health.failed) || []).length;
}

function _rpRenderTabs() {
  const el = _rpEl('rp-tabs');
  if (!el) return;
  el.innerHTML = _rpVisibleTabs().map(t => {
    const on = t.id === RpUI.tab;
    const n = _rpBadge(t.id);
    return `<button type="button" class="rp-tab${on ? ' is-on' : ''}" role="tab" id="rp-tab-${t.id}"
        aria-selected="${on}" aria-controls="rp-panel" tabindex="${on ? 0 : -1}"
        onclick="rpTab('${t.id}')" onkeydown="_rpTabKey(event)">${esc(t.l)}${n
          ? `<span class="rp-badge" title="${n} envoi(s) programmé(s) en échec">${n}</span>` : ''}</button>`;
  }).join('');
  _rpEl('rp-panel')?.setAttribute('aria-labelledby', `rp-tab-${RpUI.tab}`);
  // Sur un téléphone la barre défile : l'onglet ouvert doit y être visible.
  const on = el.querySelector('.rp-tab.is-on');
  if (on && el.scrollWidth > el.clientWidth) {
    const l = on.offsetLeft - el.offsetLeft, r = l + on.offsetWidth;
    if (l < el.scrollLeft) el.scrollLeft = l - 8;
    else if (r > el.scrollLeft + el.clientWidth) el.scrollLeft = r - el.clientWidth + 8;
  }
}

// Redessine en-tête et onglets sans recharger l'écran monté : appelé
// quand la session admin change (applyNavMode) ou que la santé de la
// Diffusion arrive (mailing.js). Un onglet d'admin dont la session vient
// de tomber n'est plus affiché : on repart sur un onglet permis.
function rpRefreshTabs() {
  if (!_rpActive()) return;
  const def = _rpDef(RpUI.tab);
  if (def && def.admin && !_rpCanAdmin()) { renderRapportsPage(true); return; }
  _rpRenderHead();
  _rpRenderTabs();
}

function rpTab(id) {
  if (!_rpDef(id)) return;
  RpUI.tab = id;
  _rpRender();
}

// Clavier de la liste d'onglets (WAI-ARIA) : flèches, Début, Fin. Le
// focus suit l'onglet activé, qui se redessine.
function _rpTabKey(e) {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!keys.includes(e.key)) return;
  const tabs = [...e.currentTarget.closest('[role="tablist"]').querySelectorAll('[role="tab"]')];
  const i = tabs.indexOf(e.currentTarget);
  const j = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1
    : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  e.preventDefault();
  const id = tabs[j].id;
  tabs[j].click();
  _rpEl(id)?.focus();
}

// ── Montage des écrans existants ──────────────────────────────
function _rpUnmountAll() {
  const host = _rpEl('rp-mount');
  if (!host) return;
  host.querySelectorAll(':scope > .page').forEach(p => p.classList.remove('active'));
}

function _rpRenderContent() {
  const own = _rpEl('rp-own');
  const host = _rpEl('rp-mount');
  if (own) own.innerHTML = '';
  _rpUnmountAll();
  const def = _rpDef(RpUI.tab);
  if (!def || !host) return;

  const node = _rpEl('page-' + def.page);
  if (!node) {
    // Écran d'admin pas encore injecté (application publique) : on le
    // demande, puis on revient ici. Sans fragment, retour au premier
    // rapport plutôt qu'un onglet vide.
    if (def.admin && typeof ensureAdminFragment === 'function') {
      if (own) own.innerHTML = '<div class="rp-note">Chargement…</div>';
      ensureAdminFragment().then(ok => {
        if (!_rpActive() || RpUI.tab !== def.id) return;
        if (ok && _rpEl('page-' + def.page)) _rpRenderContent();
        else rpTab('daily');
      });
    }
    return;
  }
  if (node.parentNode !== host) host.appendChild(node);
  node.classList.add('active');
  if (def.id === 'exports' && typeof _expStatus === 'function') _expStatus('');
  if (def.render && typeof window[def.render] === 'function') window[def.render]();
}
