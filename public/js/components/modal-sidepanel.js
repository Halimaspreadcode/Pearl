// ── MODAL / TOAST ────────────────────────────────────────────
function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('open');
  if (el.classList.contains('side-panel-overlay')) SidePanel.onClosed(el);
}
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.modal-overlay').forEach(el => {
    el.addEventListener('click', e => { if (e.target === el && !el._forced) el.classList.remove('open'); });
  });
  SidePanel.init();
  if (window.NF) NF.init();
});
// Les scripts de l'app sont chargés en fin de <body> : selon le cache, DOMContentLoaded
// peut déjà être passé et l'écouteur ci-dessus ne se déclencherait jamais.
if (document.readyState !== 'loading') { SidePanel.init(); if (window.NF) NF.init(); }

/* ══════════════════════════════════════════════════════════════
   SIDE PANEL — contrôleur
   Les panneaux étaient de simples div qu'on ouvrait en posant une
   classe : pas de gestion clavier, pas de focus, aucun repère de
   défilement, et un panneau à demi rempli se fermait sur un clic
   à côté sans prévenir. Ce contrôleur ajoute ce comportement une
   fois pour toutes, en observant l'attribut class — donc sans
   toucher aux ~16 appels `classList.add('open')` existants.
══════════════════════════════════════════════════════════════ */
const SidePanel = {
  _lastFocus: null,

  init() {
    // Idempotent : appelé depuis DOMContentLoaded et depuis le chemin
    // « document déjà prêt », sans doubler les écouteurs.
    if (this._ready) return;
    this._ready = true;

    document.querySelectorAll('.side-panel-overlay').forEach(ov => {
      const panel = ov.querySelector('.side-panel');
      if (!panel) return;

      // Sémantique d'accessibilité : c'est une boîte de dialogue modale.
      ov.setAttribute('aria-hidden', 'true');
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      const title = panel.querySelector('.side-panel-title');
      if (title) {
        if (!title.id) title.id = `${ov.id}-title`;
        panel.setAttribute('aria-labelledby', title.id);
      }

      // Traits d'en-tête / de pied pilotés par la position du défilement.
      const body = panel.querySelector('.side-panel-body');
      if (body) {
        const sync = () => this._syncScroll(panel, body);
        body.addEventListener('scroll', sync, { passive: true });
        // Le contenu des panneaux est injecté après coup (options des
        // selects, aperçus) : on resuit la taille au lieu de mesurer une
        // seule fois à l'ouverture.
        if (window.ResizeObserver) {
          const ro = new ResizeObserver(sync);
          ro.observe(body);
          if (body.firstElementChild) ro.observe(body.firstElementChild);
        }
        panel._syncScroll = sync;
      }

      // Marque le panneau comme « touché » dès la première saisie,
      // pour l'avertissement de fermeture.
      panel.addEventListener('input', () => { panel._dirty = true; });
      panel.addEventListener('change', () => { panel._dirty = true; });

      // Le panneau ticket est le seul à étapes : ses pastilles d'onglet
      // suivent le remplissage en direct.
      if (ov.id === 'ticket-modal') {
        const refresh = () => { if (typeof updateStepTabState === 'function') updateStepTabState(); };
        panel.addEventListener('input', refresh);
        panel.addEventListener('change', refresh);
      }

      // Ctrl/Cmd+Entrée valide, comme dans les composeurs Google.
      panel.addEventListener('keydown', e => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          const save = panel.querySelector('.side-panel-footer .btn-primary:not([style*="display:none"])');
          if (save) { e.preventDefault(); save.click(); }
        }
        if (e.key === 'Tab') this._trapFocus(e, panel);
      });

      // Suit l'ouverture/fermeture, quelle que soit sa provenance.
      new MutationObserver(() => {
        const open = ov.classList.contains('open');
        if (open && !ov._wasOpen)      this.onOpened(ov);
        else if (!open && ov._wasOpen) this.onClosed(ov);
        ov._wasOpen = open;
      }).observe(ov, { attributes: true, attributeFilter: ['class'] });
    });

    // Échap ferme le panneau le plus haut. Ignoré si un select natif
    // ou un autocomplete est déployé — le navigateur consomme la touche.
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      const open = [...document.querySelectorAll('.side-panel-overlay.open')].pop();
      if (!open) return;
      e.stopPropagation();
      this.requestClose(open.id);
    });
  },

  onOpened(ov) {
    const panel = ov.querySelector('.side-panel');
    ov.setAttribute('aria-hidden', 'false');
    this._lastFocus = document.activeElement;
    // Le corps de la page ne doit pas défiler derrière le panneau.
    document.body.style.overflow = 'hidden';
    if (!panel) return;
    panel._dirty = false;
    const body = panel.querySelector('.side-panel-body');
    if (body) { body.scrollTop = 0; if (panel._syncScroll) requestAnimationFrame(panel._syncScroll); }
    // Focus sur le premier champ vide, sinon sur le bouton fermer :
    // ouvrir un panneau et pouvoir taper immédiatement.
    requestAnimationFrame(() => {
      const first = [...panel.querySelectorAll(
        '.side-panel-body input:not([type=hidden]):not([disabled]),' +
        '.side-panel-body select:not([disabled]),' +
        '.side-panel-body textarea:not([disabled])'
      )].find(el => el.offsetParent !== null && !el.value);
      (first || panel.querySelector('.side-panel-close'))?.focus({ preventScroll: true });
    });
  },

  onClosed(ov) {
    if (!ov) return;
    ov._wasOpen = false;
    ov.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.side-panel-overlay.open')) document.body.style.overflow = '';
    // Rend le focus à l'élément déclencheur (ligne de tableau, bouton…).
    if (this._lastFocus && document.contains(this._lastFocus)) {
      this._lastFocus.focus({ preventScroll: true });
    }
    this._lastFocus = null;
  },

  // Fermeture demandée par l'utilisateur (Échap, clic sur le scrim) :
  // on confirme si des champs ont été saisis sans enregistrement.
  requestClose(id) {
    const ov = document.getElementById(id);
    const panel = ov?.querySelector('.side-panel');
    if (panel?._dirty && !confirm('Close without saving? Changes will be lost.')) return;
    closeModal(id);
  },

  _syncScroll(panel, body) {
    panel.classList.toggle('scrolled', body.scrollTop > 4);
    // `can-scroll` = il reste du contenu sous le pli → on montre le trait
    // du pied pour signaler que la liste continue.
    const remaining = body.scrollHeight - body.clientHeight - body.scrollTop;
    panel.classList.toggle('can-scroll', remaining > 4);
  },

  _trapFocus(e, panel) {
    const focusables = [...panel.querySelectorAll(
      'button:not([disabled]),input:not([type=hidden]):not([disabled]),select:not([disabled]),' +
      'textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])'
    )].filter(el => el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (!e.shiftKey && document.activeElement === last)  { e.preventDefault(); first.focus(); }
    if ( e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  },
};
function toast(msg, type='success') {
  const c = document.getElementById('toasts');
  const t = document.createElement('div'); t.className=`toast ${type}`;
  t.innerHTML = `<span>${type==='success'?'✓':'!'}</span> ${msg}`;
  c.appendChild(t); setTimeout(()=>t.remove(), 3500);
}

