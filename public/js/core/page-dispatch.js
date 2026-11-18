const _origRP = window.renderPage;
// Pages dont le balisage ne vit que dans la zone admin : hors de /admin
// elles ne sont pas dans le document, il faut y aller plutôt que de
// rendre un écran vide.

const ADMIN_ONLY_PAGES = ['config', 'audit', 'shift-approvals', 'data-quality', 'ops-review', 'export', 'mailing',
  'cfg-annonces', 'cfg-general', 'cfg-sla', 'cfg-goals', 'cfg-perf', 'cfg-rota',
  'cfg-security', 'cfg-data', 'cfg-quiz', 'cfg-glossary', 'cfg-sessions', 'cfg-training', 'cfg-o2o',
  'cfg-assign', 'cfg-myteam', 'cfg-objectifs', 'cfg-vues', 'equipe', 'ai', 'ai-cockpit', 'indicateurs', 'cfg-parties'];

window.renderPage = function(page) {
  // Anciennes entrées « sn », « ci » (ou tout code de site) : la page du
  // site, avec ce site comme périmètre.
  if (page !== 'site' && page !== 'global' && typeof isSiteCode === 'function' && isSiteCode(page)) {
    if (typeof setActiveCountry === 'function') setActiveCountry(page.toUpperCase(), { silent: true });
    page = 'site';
  }
  // Sélecteurs de site des écrans (y compris ceux injectés par la zone
  // admin) : remplis avec les sites de l'organisation.
  if (typeof fillSiteSelects === 'function') { try { fillSiteSelects(); fillSiteGroups(); if (typeof renderExportSites === 'function') renderExportSites(); } catch (_) {} }
  // L'Academy retire la barre latérale ; toute autre page la rend.
  if (page !== 'academy' && typeof academyFocus === 'function') academyFocus(false);
  // Les deux formations vivent désormais dans l'Academy.
  if (page === 'digitalview' || page === 'process-training') {
    _origRP('academy');
    renderAcademy({ course: page === 'digitalview' ? 'digitalview' : 'process' });
    return;
  }
  if (ADMIN_ONLY_PAGES.includes(page) && !document.getElementById(`page-${page}`)) {
    // La page admin peut simplement ne pas être encore injectée : on tente
    // de la charger avant d'envoyer l'utilisateur vers l'écran de connexion,
    // sinon la navigation rechargerait tout ce qu'on cherche à éviter.
    if (AdminSession.active && typeof ensureAdminFragment === 'function') {
      ensureAdminFragment().then(ok => {
        if (ok) window.renderPage(page); else location.href = '/admin';
      });
      return;
    }
    location.href = '/admin';
    return;
  }
  // Les six rubriques d'équipe vivent désormais dans les onglets de la
  // page Équipe (js/pages/team/team-hub.js) : leur ancien nom y mène.
  if (typeof EQ_LEGACY_PAGES !== 'undefined' && EQ_LEGACY_PAGES.includes(page)) { eqLegacyRedirect(page); return; }
  // L'adresse #equipe/… ne décrit que la page Équipe : la quitter l'efface.
  if (page !== 'equipe' && /^#equipe(\/|$)/.test(location.hash)) {
    try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {}
  }
  // Pages personnelles de l'agent → onglets de Mon espace (js/pages/espace/mon-espace.js).
  if (typeof MES_LEGACY_PAGES !== 'undefined' && MES_LEGACY_PAGES[page]) { mesLegacyRedirect(page); return; }
  if (page !== 'mon-espace' && /^#mon-espace(\/|$)/.test(location.hash)) { try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {} }
  if (page === 'mon-espace') { const was = !!document.getElementById('page-mon-espace')?.classList.contains('active'); _origRP(page); renderMonEspace(was); return; }
  if (page === 'equipe') {
    const wasActive = !!document.getElementById('page-equipe')?.classList.contains('active');
    _origRP(page); renderEquipePage(wasActive); return;
  }
  // Daily, Weekly, Monthly, Ops Review, Diffusion et Export sont des
  // onglets de la page Rapports (js/pages/reports/reports-hub.js).
  if (typeof RP_LEGACY_PAGES !== 'undefined' && RP_LEGACY_PAGES[page]) { rpLegacyRedirect(page); return; }
  if (page !== 'rapports' && /^#rapports(\/|$)/.test(location.hash)) {
    try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {}
  }
  if (page === 'rapports') {
    const wasActive = !!document.getElementById('page-rapports')?.classList.contains('active');
    _origRP(page); renderRapportsPage(wasActive); return;
  }
  if (page === 'audit')           { _origRP(page); renderAudit();         return; }
  if (page === 'ai')              { _origRP(page); renderAiPage();        return; }
  if (page === 'indicateurs')     { _origRP(page); if (typeof renderIndicateursPage === 'function') renderIndicateursPage(); return; }
  // Le tableau de bord est devenu l'accueil de Pear AI.
  if (page === 'ai-cockpit')      { window.renderPage('ai'); if (typeof aiAccueil === 'function') aiAccueil(); return; }
  if (page === 'academy')         { _origRP(page); renderAcademy();       return; }
  if (page === 'ideas') {
    _origRP(page);
    // Chargé à la première ouverture seulement ; le tableau se rafraîchit seul.
    const f = document.getElementById('ideas-frame');
    if (f && !f.getAttribute('src')) f.setAttribute('src', f.dataset.src);
    return;
  }
  if (page === 'shift-planning')  { _origRP(page); autoFillRotaIfEmpty().then(renderShiftPlanning); return; }
  if (page === 'shift-approvals') { _origRP(page); renderShiftApprovals(); return; }
  if (page === 'my-requests')     { _origRP(page); renderMyRequests();     return; }
  if (page === 'my-perf')         { _origRP(page); renderMyPerf();         return; }
  if (page === 'fo-tasks')        { _origRP(page); renderFOTasks();       return; }
  if (page === 'fo-handover')     { _origRP(page); renderFOHandover();    return; }
  if (page === 'data-quality')    { _origRP(page); _renderDQPage();       return; }
  if (page === 'absences')        { _origRP(page); _renderAbsencePage();  return; }
  if (page === 'config')          { _origRP(page); _renderConfigPage();   return; }
  // Rubriques de configuration : chacune est une page, toutes derrière
  // le même verrou admin que la page Configuration d'origine.
  if (page.startsWith('cfg-'))    { _origRP(page); _renderCfgSubPage(page); _admCrumb(page); return; }
  _origRP(page);
};

// L'accordéon de la sidebar suit la navigation : la section de la
// page courante s'ouvre, les autres se replient.
(function() {
  const _rp = window.renderPage;
  window.renderPage = function(page) {
    const r = _rp.apply(this, arguments);
    if (typeof autoRevealSection === 'function') autoRevealSection(page);
    return r;
  };
})();


// Rubriques de la Configuration : elles n'ont qu'une icône dans la barre,
// on ne savait plus comment revenir au sommaire. Un retour en tête de page.
function _admCrumb(page) {
  const el = document.getElementById('page-' + page);
  if (!el || el.querySelector(':scope > .adm-crumb')) return;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'adm-crumb';
  b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>Configuration';
  b.addEventListener('click', () => window.renderPage('config'));
  el.prepend(b);
}
