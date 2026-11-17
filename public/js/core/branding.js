// ══════════════════════════════════════════════════════════════
// MARQUE BLANCHE ET MODULES DE L'ORGANISATION
//
// Lit /api/platform/me (ou /api/platform/brand avant connexion) et
// applique : nom de l'organisation, logo, couleur principale, titre de
// l'onglet ; masque les entrées de menu des modules non activés.
// window.PearlOrg garde la réponse pour les autres écrans.
// ══════════════════════════════════════════════════════════════
(function () {
  window.PearlOrg = { tenant: null, modules: null, pages: null, all_pages: [], account: null, accounts: false, pret: false };

  const HEX = /^#[0-9a-f]{6}$/i;
  function appliquerMarque(name, b) {
    b = b || {};
    const nom = b.name || name;
    if (nom) {
      document.title = nom;
      document.querySelectorAll('.sidebar-brand-name').forEach(el => { el.textContent = nom; });
    }
    document.querySelectorAll('.sidebar-brand-sub').forEach(el => { el.textContent = b.tagline || ''; });
    if (b.logo) {
      document.querySelectorAll('svg.sidebar-logo').forEach(svg => {
        const img = document.createElement('img');
        img.className = 'sidebar-logo'; img.alt = ''; img.src = b.logo;
        img.style.objectFit = 'contain';
        svg.replaceWith(img);
      });
    }
    if (HEX.test(b.primary || '')) {
      const r = document.documentElement.style;
      r.setProperty('--accent', b.primary);
      r.setProperty('--m3-primary', b.primary);
    }
  }

  // Pages des modules non activés : masquées dans la barre, quoi qu'en
  // disent les profils de navigation.
  function appliquerModules() {
    const o = window.PearlOrg;
    if (!o.pages || !o.all_pages) return;
    const off = new Set(o.all_pages.filter(p => !o.pages.includes(p)));
    let st = document.getElementById('pearl-mod-style');
    if (!st) { st = document.createElement('style'); st.id = 'pearl-mod-style'; document.head.appendChild(st); }
    st.textContent = [...off].map(p => `.nav-item[data-page="${CSS.escape(p)}"]`).join(',') + (off.size ? '{display:none !important}' : '');
  }
  window.pearlModuleOn = id => !window.PearlOrg.modules || window.PearlOrg.modules.includes(id);
  window.pearlPageOn = p => !window.PearlOrg.pages || !window.PearlOrg.all_pages.includes(p) || window.PearlOrg.pages.includes(p);

  function charger() {
    return fetch('/api/platform/me', { credentials: 'same-origin', cache: 'no-store' })
      .then(r => (r.ok ? r.json() : fetch('/api/platform/brand', { credentials: 'same-origin' }).then(x => x.json()).then(j => ({ brandOnly: j }))))
      .then(j => {
        if (j.brandOnly) {
          Object.assign(window.PearlOrg, { accounts: !!j.brandOnly.accounts, switch_url: j.brandOnly.switch_url || null, pret: true });
          appliquerMarque(j.brandOnly.name, j.brandOnly.branding);
          return;
        }
        Object.assign(window.PearlOrg, j, { pret: true });
        appliquerMarque(j.tenant && j.tenant.name, j.tenant && j.tenant.branding);
        appliquerModules();
      })
      .catch(() => { window.PearlOrg.pret = true; });
  }
  window.pearlReloadOrg = charger;
  const go = () => charger();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
