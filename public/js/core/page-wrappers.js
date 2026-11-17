
/* Les trois rapports partagent le même besoin post-rendu : redimensionner
   les champs. On enveloppe plutôt que d'éditer chaque fonction, pour que
   l'appel ne puisse pas être oublié dans une des trois. */
/* La copie épinglée doit refléter la page courante comme le menu : sans
   ça, deux entrées « actives » ou aucune. */
(function () {
  const orig = window.renderPage;
  if (typeof orig !== 'function' || orig.__pinWrapped) return;
  const wrapped = function (...args) {
    const out = orig.apply(this, args);
    try { if (typeof renderPinnedNav === 'function') renderPinnedNav(); } catch (e) {}
    return out;
  };
  wrapped.__pinWrapped = true;
  window.renderPage = wrapped;
})();

['renderPage_daily', 'renderPage_weekly', 'renderMonthlyReport'].forEach(fn => {
  const orig = window[fn];
  if (typeof orig !== 'function' || orig.__rptWrapped) return;
  const wrapped = function (...args) {
    const out = orig.apply(this, args);
    if (out && typeof out.then === 'function') return out.then(v => (rptAfterRender(), v));
    rptAfterRender();
    return out;
  };
  wrapped.__rptWrapped = true;
  window[fn] = wrapped;
});

