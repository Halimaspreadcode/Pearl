// Commun aux pages de la plateforme : thème (partagé avec l'app, clé
// fo-theme, sombre par défaut comme le tableau de bord), logo, échappement.
(function () {
  var t = 'dark';
  try { t = localStorage.getItem('fo-theme') || 'dark'; } catch (e) {}
  document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
})();

window.esc = function (v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
};

window.PEARL_LOGO = '<svg viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="pl-g" x1="0" y1="1" x2="1" y2="0">'
  + '<stop offset="0" stop-color="#3FB7A0"/><stop offset="1" stop-color="#4F6A85"/></linearGradient></defs>'
  + '<path d="M6 34A28 28 0 0 1 34 6" fill="none" stroke="url(#pl-g)" stroke-width="4.5" stroke-linecap="round"/>'
  + '<path d="M13 34A21 21 0 0 1 34 13" fill="none" stroke="url(#pl-g)" stroke-width="4.5" stroke-linecap="round" opacity=".7"/>'
  + '<path d="M20 34A14 14 0 0 1 34 20" fill="none" stroke="url(#pl-g)" stroke-width="4.5" stroke-linecap="round" opacity=".45"/>'
  + '<circle cx="31" cy="31" r="4.5" fill="#F2A65A"/></svg>';

document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('[data-logo]').forEach(function (el) { el.insertAdjacentHTML('afterbegin', window.PEARL_LOGO); });
  var btn = document.getElementById('theme-btn');
  if (!btn) return;
  var paint = function () {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    btn.innerHTML = dark
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
    btn.setAttribute('aria-label', dark ? 'Thème clair' : 'Thème sombre');
  };
  paint();
  btn.addEventListener('click', function () {
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('fo-theme', next); } catch (e) {}
    paint();
  });
});
