// ── THEME ────────────────────────────────────────────────────
(function() {
  const saved = localStorage.getItem('fo-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  document.addEventListener('DOMContentLoaded', () => syncThemeIcon(saved));
})();

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('fo-theme', next);
  syncThemeIcon(next);
  broadcastTheme(next);
}

// L'événement `storage` ne se déclenche QUE dans les autres onglets,
// jamais dans le document qui a appelé setItem() — les iframes de cette
// page (Analyseur) ne le recevaient donc jamais et restaient en clair.
// On les prévient explicitement.
function broadcastTheme(theme) {
  document.querySelectorAll('iframe').forEach(f => {
    try { f.contentWindow?.postMessage({ type: 'fo-theme', theme }, '*'); }
    catch (e) { /* iframe pas encore prête : elle lira fo-theme à son init */ }
  });
}
function syncThemeIcon(theme) {
  document.getElementById('theme-icon-sun').style.display  = theme === 'dark'  ? '' : 'none';
  document.getElementById('theme-icon-moon').style.display = theme === 'light' ? '' : 'none';
}

// ── SIDEBAR COLLAPSIBLE SECTIONS ──────────────────────────────
const SIDEBAR_COLLAPSE_KEY = 'fo-sidebar-collapsed';
// Sections repliées par défaut, tant que l'utilisateur n'a rien décidé.
// La barre compte une trentaine d'entrées : tout déplier d'emblée oblige
// à la parcourir en entier pour atteindre le bas. Repliée, on voit les
// rubriques, on ouvre celle dont on a besoin.
//
// Le défaut ne s'applique qu'à la première visite : dès qu'on plie ou
// déplie une section, le choix est enregistré et fait foi — y compris
// « tout déplié », qui s'écrit comme une liste vide et non comme une
// absence de préférence.
const SIDEBAR_DEFAULT_COLLAPSED = ['operational', 'reporting', 'admin'];

function getCollapsedSections() {
  try {
    const raw = localStorage.getItem(SIDEBAR_COLLAPSE_KEY);
    if (raw === null) return [...SIDEBAR_DEFAULT_COLLAPSED];
    return JSON.parse(raw);
  }
  catch (e) { return [...SIDEBAR_DEFAULT_COLLAPSED]; }
}
function toggleSidebarSection(el) {
  const name = el.dataset.section;
  const group = document.querySelector(`.sidebar-group[data-group="${name}"]`);
  if (!group) return;
  const collapsed = getCollapsedSections();
  const isCollapsed = el.classList.toggle('collapsed');
  group.classList.toggle('collapsed', isCollapsed);
  const next = isCollapsed ? [...new Set([...collapsed, name])] : collapsed.filter(n => n !== name);
  localStorage.setItem(SIDEBAR_COLLAPSE_KEY, JSON.stringify(next));
}
function collapseSection(name) {
  const section = document.querySelector(`.sidebar-section[data-section="${name}"]`);
  const group   = document.querySelector(`.sidebar-group[data-group="${name}"]`);
  if (!section || !group) return;
  section.classList.add('collapsed');
  group.classList.add('collapsed');
  const collapsed = getCollapsedSections();
  localStorage.setItem(SIDEBAR_COLLAPSE_KEY, JSON.stringify([...new Set([...collapsed, name])]));
}
// `persist` distingue un geste de l'utilisateur d'une ouverture de
// confort. Naviguer vers une page d'une section repliée l'ouvre pour
// qu'on voie où l'on est — ce n'est pas pour autant une préférence, et
// l'enregistrer dépliait la barre définitivement au bout de quelques
// visites, sans que personne n'ait demandé à la déplier.
function expandSection(name, persist = true) {
  const section = document.querySelector(`.sidebar-section[data-section="${name}"]`);
  const group   = document.querySelector(`.sidebar-group[data-group="${name}"]`);
  if (!section || !group) return;
  section.classList.remove('collapsed');
  group.classList.remove('collapsed');
  if (!persist) return;
  const collapsed = getCollapsedSections();
  localStorage.setItem(SIDEBAR_COLLAPSE_KEY, JSON.stringify(collapsed.filter(n => n !== name)));
}
document.addEventListener('DOMContentLoaded', () => restoreSidebarSections());

/* Filet de sécurité contre l'autofill du filtre de menu.

   Un délai fixe ne suffit pas : selon la machine et le gestionnaire de
   mots de passe, le remplissage arrive parfois plusieurs secondes après
   `load`, ou au retour arrière (bfcache). On surveille donc réellement
   le champ pendant les premières secondes, au lieu de parier sur un
   instant précis.

   La règle est simple : tant que l'utilisateur n'a pas mis le focus
   dans le champ, toute valeur qui y apparaît vient du navigateur et
   doit être effacée. Après le premier focus, on ne touche plus à rien —
   ce qu'il tape lui appartient. */
(function () {
  const el = () => document.getElementById('nav-filter');

  // Nom aléatoire : sans clé stable, le gestionnaire de mots de passe
  // n'a rien à quoi rattacher une valeur enregistrée.
  const input = el();
  if (input) input.name = 'nf-' + Math.random().toString(36).slice(2, 10);

  let userTouched = false;
  const markTouched = () => { userTouched = true; };
  if (input) {
    input.addEventListener('focus', markTouched);
    input.addEventListener('keydown', markTouched);
  }

  const clear = () => {
    const i = el();
    if (!i || userTouched || !i.value) return;
    i.value = '';
    if (typeof filterNav === 'function') filterNav('');
  };

  /* Pas de fenêtre de temps : l'autofill peut arriver très tard, et
     tout délai choisi finit par être trop court. On intercepte plutôt
     l'écriture elle-même — le setter de `value` est redéfini sur cette
     instance, si bien qu'une valeur posée par le navigateur (donc hors
     frappe) est refusée à la source, quel que soit le moment.
     La frappe réelle passe par le clavier, jamais par ce setter. */
  if (input) {
    const proto = Object.getPrototypeOf(input);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set && desc.get) {
      Object.defineProperty(input, 'value', {
        configurable: true,
        get() { return desc.get.call(this); },
        set(v) {
          // Avant le premier focus, seule une remise à vide est légitime.
          if (!userTouched && v) return;
          desc.set.call(this, v);
        },
      });
    }
  }

  /* L'autofill natif de Chrome écrit sans passer par le setter JS :
     on double donc l'interception par une surveillance, active tant
     que l'utilisateur n'a pas touché le champ. Elle s'arrête d'elle-même
     au premier focus, donc elle ne tourne jamais pendant la frappe. */
  const tick = setInterval(() => {
    if (userTouched) { clearInterval(tick); return; }
    const i = el();
    if (i && i.value) {
      const raw = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(i), 'value');
      if (raw && raw.set) raw.set.call(i, ''); else i.value = '';
      if (typeof filterNav === 'function') filterNav('');
    }
  }, 200);

  window.addEventListener('load', clear);
  // Retour arrière : la page est restaurée telle quelle, valeur comprise.
  window.addEventListener('pageshow', e => { if (e.persisted) clear(); });
})();

// ── SIDEBAR : accordéon + filtre ─────────────────────────────
// 23 entrées sur 7 sections : le repli est persisté dans
// fo-sidebar-collapsed et restauré tel quel au chargement. La navigation
// ne fait qu'ouvrir la section de la page visitée, jamais replier les
// autres — et plus rien du tout dès que l'utilisateur a cliqué un titre.
const SIDEBAR_AUTO_KEY = 'fo-sidebar-auto';

// L'état replié/déplié persisté est la seule source de vérité : on se
// contente d'ouvrir la section qui contient la page visitée (sinon on
// naviguerait vers un item invisible), sans jamais replier les autres —
// replier ici écrasait le choix de l'utilisateur à chaque refresh.
function autoRevealSection(page) {
  if (!page) return;
  if (localStorage.getItem(SIDEBAR_AUTO_KEY) === 'off') return;
  const item = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (!item) return;
  const group = item.closest('.sidebar-group');
  if (!group || !group.dataset.group) return;
  // Ouverture de confort : on montre où l'on est, sans inscrire ça
  // comme une préférence — d'où persist=false.
  if (group.classList.contains('collapsed')) expandSection(group.dataset.group, false);
}

// Restaure l'accordéon depuis localStorage. Appelable plusieurs fois.
function restoreSidebarSections() {
  const collapsed = new Set(getCollapsedSections());
  document.querySelectorAll('.sidebar-group[data-group]').forEach(g => {
    const name = g.dataset.group;
    const section = document.querySelector(`.sidebar-section[data-section="${name}"]`);
    const isCollapsed = collapsed.has(name);
    g.classList.toggle('collapsed', isCollapsed);
    if (section) section.classList.toggle('collapsed', isCollapsed);
  });
}

// ══════════════════════════════════════════════════════════════
// RAIL — sidebar repliée en icônes
// Le menu compte ~70 entrées ; replié il ne garde que les icônes et
// rend de la largeur au contenu. L'état est mémorisé : c'est une
// préférence d'espace de travail, pas un geste à refaire à chaque page.
// ══════════════════════════════════════════════════════════════
const SIDEBAR_RAIL_KEY = 'fo-sidebar-rail';

// Le libellé n'est plus affiché en rail : on le recopie dans data-tip,
// que l'infobulle CSS lit. Recalculé à chaque bascule, car les libellés
// épinglés (renderPinnedNav) sont injectés après le chargement.
function syncRailTips() {
  document.querySelectorAll('.sidebar .nav-item').forEach(it => {
    const label = it.querySelector('.nav-item-label');
    const text  = label && label.textContent.trim();
    if (text) it.setAttribute('data-tip', text);
  });
  // Le badge « NEW » complète l'infobulle (nav-new.js).
  if (typeof navNewApply === 'function') navNewApply();
}

function applySidebarRail(on) {
  const app = document.querySelector('.app');
  if (!app) return;
  app.classList.toggle('sb-rail', on);
  const btn = document.getElementById('sb-rail-toggle');
  if (btn) {
    btn.setAttribute('aria-expanded', on ? 'false' : 'true');
    const label = on ? 'Expand menu' : 'Collapse menu';
    btn.setAttribute('aria-label', label);
    btn.title = `${label} (Ctrl+B)`;
  }
  // Le champ de filtre est caché en rail : une recherche encore active
  // y masquerait des icônes sans que rien n'explique pourquoi.
  if (on) {
    const f = document.getElementById('nav-filter');
    if (f && f.value) { f.value = ''; filterNav(''); }
    syncRailTips();
  }
}

function toggleSidebarRail() {
  const on = !document.querySelector('.app')?.classList.contains('sb-rail');
  applySidebarRail(on);
  try { localStorage.setItem(SIDEBAR_RAIL_KEY, on ? '1' : '0'); } catch (e) {}
}

// Replié par défaut : tant que l'utilisateur n'a rien choisi (clé absente),
// la barre s'ouvre en icônes et laisse la largeur au contenu. Déplier
// l'enregistre ('0') et fait foi ensuite.
function restoreSidebarRail() {
  let on = true;
  try { on = localStorage.getItem(SIDEBAR_RAIL_KEY) !== '0'; } catch (e) {}
  applySidebarRail(on);
}
document.addEventListener('DOMContentLoaded', restoreSidebarRail);

// Ctrl/Cmd+B — raccourci usuel pour un menu latéral. Ignoré pendant une
// saisie, sinon il volerait le gras d'un champ de texte.
document.addEventListener('keydown', e => {
  if (e.key !== 'b' && e.key !== 'B') return;
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
  const el = document.activeElement;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
  e.preventDefault();
  toggleSidebarRail();
});

