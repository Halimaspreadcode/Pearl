// ── CIEL EN ARRIÈRE-PLAN ──────────────────────────────────────
// Un ciel dessiné en CSS derrière l'application. Le thème décide de
// l'ambiance : thème clair, ciel bleu de jour ; thème sombre, nuit étoilée.
// Aucune image : rien à télécharger, rien ne passe par le réseau.
// Désactivé par défaut (fond uni) ; activable depuis la barre de commande
// (« ciel »), choix gardé sur ce poste.
(function () {
  'use strict';
  const KEY = 'fo-sky';
  const root = document.documentElement;

  function actif() { try { return localStorage.getItem(KEY) === 'on'; } catch { return false; } }

  function monter() {
    if (document.getElementById('fo-sky')) return;
    const el = document.createElement('div');
    el.id = 'fo-sky';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML =
      '<div class="sky-l sky-day"><i class="sky-clouds"></i></div>' +
      '<div class="sky-d sky-night"><i class="sky-stars"></i><i class="sky-stars sky-stars-2"></i><i class="sky-clouds"></i></div>';
    document.body.prepend(el);
  }

  function maj() {
    const on = actif();
    root.classList.toggle('sky-on', on);
    if (!on) return;
    monter();
  }

  window.FoSky = {
    actif,
    basculer() { try { localStorage.setItem(KEY, actif() ? 'off' : 'on'); } catch {} maj(); },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', maj); else maj();
})();
