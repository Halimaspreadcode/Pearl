// ══════════════════════════════════════════════════════════════
// BADGE « NEW » SUR LES ENTRÉES DU MENU
//
// L'admin coche des pages dans Admin › Vues par profil › Badge New, avec
// une durée : config.nav_new = { "<page>": "AAAA-MM-JJ" (dernier jour) }.
// La pastille reste affichée pour tout le monde pendant toute la période,
// même une fois la page ouverte, et disparaît d'elle-même après la date.
// ══════════════════════════════════════════════════════════════

// Badges en cours : ceux dont la date n'est pas passée.
function navNewActive() {
  const cfg = (typeof state !== 'undefined' && state.config && state.config.nav_new) || {};
  const today = new Date().toLocaleDateString('sv-SE');
  return Object.fromEntries(Object.entries(cfg).filter(([, until]) => typeof until === 'string' && until >= today));
}

function navNewApply() {
  const actifs = navNewActive();
  document.querySelectorAll('.sidebar .nav-item[data-page]').forEach(item => {
    const montrer = !!actifs[item.dataset.page];
    let b = item.querySelector(':scope .nav-new');
    if (montrer && !b) {
      b = document.createElement('span');
      b.className = 'nav-new';
      b.textContent = 'NEW';
      b.title = 'New';
      (item.querySelector('.nav-item-left') || item).appendChild(b);
    } else if (!montrer && b) b.remove();
    // L'infobulle du menu replié le dit aussi.
    const lbl = item.querySelector('.nav-item-label');
    if (lbl) item.setAttribute('data-tip', lbl.textContent.trim() + (montrer ? ' · New' : ''));
  });
}

// Ancienne mémoire « déjà vu » de ce navigateur : plus utilisée.
try { localStorage.removeItem('fo-nav-new-seen'); } catch (_) {}
