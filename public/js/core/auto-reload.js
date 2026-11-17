// ══════════════════════════════════════════════════════════════
// RECHARGEMENT AUTOMATIQUE APRÈS REDÉMARRAGE OU MISE À JOUR
//
// Le serveur expose /api/version, qui change à chaque démarrage. Chaque
// onglet note celle qu'il a chargée, puis la relit toutes les 20 s (60 s
// en arrière-plan). Si elle a changé — serveur redémarré, nouvelle
// version installée par le watchdog — la page se recharge seule : plus
// personne ne reste sur un écran d'hier qui appelle une API d'aujourd'hui.
//
// Sans rien faire perdre : on ne recharge jamais pendant une saisie
// (champ actif, fenêtre ouverte) ni dans les 8 s qui suivent une frappe
// ou un clic. Un bandeau prévient ; un onglet en arrière-plan, que
// personne ne regarde, se recharge aussitôt.
// ══════════════════════════════════════════════════════════════
(function () {
  const PERIODE = 20000, PERIODE_CACHE = 60000, CALME = 8000;
  let connue = null;       // version chargée par cet onglet
  let enAttente = false;   // nouvelle version vue, rechargement différé
  let dernierGeste = Date.now();
  let timer = null;

  ['keydown', 'input', 'pointerdown', 'wheel'].forEach(ev =>
    document.addEventListener(ev, () => { dernierGeste = Date.now(); }, { capture: true, passive: true }));

  function saisieEnCours() {
    const a = document.activeElement;
    if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return true;
    // Une fenêtre modale ouverte porte souvent un formulaire à moitié rempli.
    // « Ouverte » = réellement à l'écran : les panneaux latéraux restent
    // dans le document avec role="dialog", poussés hors champ une fois
    // fermés — les compter bloquerait le rechargement pour toujours.
    const aLEcran = e => {
      const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight
        && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
    };
    const fenetres = document.querySelectorAll('.modal-overlay.open, .modal.open, .obt-modal.open, [role="dialog"][aria-modal="true"]');
    if ([...fenetres].some(aLEcran)) return true;
    return Date.now() - dernierGeste < CALME;
  }

  // Avis de nouvelle version : une bande pleine largeur en haut de la zone
  // de contenu, rangée avec les annonces (au-dessus d'elles, dans le flux),
  // et non une pastille flottante qui les recouvrait.
  function bandeau() {
    if (document.getElementById('auto-reload-bar')) return;
    const main = document.querySelector('.main');
    if (!main) return;
    let host = document.getElementById('ann-bands');
    if (!host) { host = document.createElement('div'); host.id = 'ann-bands'; main.prepend(host); }
    host.hidden = false;
    const b = document.createElement('div');
    b.id = 'auto-reload-bar';
    b.className = 'ann-band ann-band-update';
    b.setAttribute('role', 'status');
    b.innerHTML = '<svg class="ann-band-i" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>'
      + '<div class="ann-band-txt"><span class="ann-band-tag">Update</span>'
      + '<b class="ann-band-t">New version available</b>'
      + '<span class="ann-band-b">The page will refresh as soon as you are done — nothing you are typing will be lost.</span></div>'
      + '<button type="button" class="ann-band-cta">Refresh now</button>';
    b.querySelector('button').onclick = () => location.reload();
    host.prepend(b);
    if (typeof annBandsLayout === 'function') annBandsLayout();
  }

  function recharger() {
    if (document.hidden || !saisieEnCours()) { location.reload(); return; }
    bandeau();
    setTimeout(recharger, 3000);
  }

  async function verifier() {
    try {
      const r = await fetch('/api/version', { cache: 'no-store', credentials: 'same-origin' });
      if (r.ok) {
        const v = (await r.json()).boot;
        if (v) {
          if (connue === null) connue = v;
          else if (v !== connue && !enAttente) { enAttente = true; recharger(); return; }
        }
      }
    } catch { /* serveur en cours de redémarrage : on réessaie au prochain passage */ }
    planifier();
  }

  function planifier() {
    clearTimeout(timer);
    timer = setTimeout(verifier, document.hidden ? PERIODE_CACHE : PERIODE);
  }

  // Revenir sur l'onglet : vérifier tout de suite plutôt qu'attendre.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !enAttente) verifier(); });
  verifier();
})();
