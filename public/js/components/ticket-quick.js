// ── SAISIE RAPIDE D'UN TICKET ────────────────────────────────
// Le formulaire comptait dix menus déroulants : deux clics et une lecture
// de liste pour chaque champ. Ici :
//   · les champs à 3–5 valeurs (Type, Priorité, Sévérité, Statut) deviennent
//     des puces : un clic, et la valeur se voit sans ouvrir de liste ;
//   · les menus d'origine restent dans le formulaire (cachés) : FormData,
//     la validation et les suggestions (ticket-suggest.js) n'ont rien changé ;
//   · l'enregistrement est possible dès l'étape 1, Ctrl+Entrée enregistre ;
//   · le pied du panneau dit combien de champs obligatoires restent.
(function () {
  'use strict';
  const GROUPS = {
    type:     [['Incident', 'Incident'], ['Problem Bug', 'Problem bug'], ['Problem non Bug', 'Problem non-bug']],
    priority: [['P1', 'P1'], ['P2', 'P2'], ['P3', 'P3'], ['P4', 'P4']],
    severity: [['Critical', 'Critical'], ['Major', 'Major'], ['Minor', 'Minor'], ['Warning', 'Warning']],
    status:   [['Open', 'Open'], ['In Progress', 'In progress'], ['On Hold', 'On hold'], ['Resolved', 'Resolved'], ['Closed', 'Closed']],
  };
  // Mêmes puces pour le formulaire d'observation.
  const OBS_GROUPS = {
    source:   [['SN', 'SN'], ['CI', 'CI']],
    priority: [['Critical', 'Critical'], ['High', 'High'], ['Medium', 'Medium'], ['Low', 'Low']],
    status:   [['Open', 'Open'], ['In Progress', 'In progress'], ['Closed', 'Closed']],
  };
  const form = () => document.getElementById('ticket-form');
  const modal = () => document.getElementById('ticket-modal');
  const isOpen = () => !!modal()?.classList.contains('open');

  function build(f = form(), groups = GROUPS) {
    if (!f || f.dataset.tq) return;
    f.dataset.tq = '1';
    Object.entries(groups).forEach(([name, opts]) => {
      const sel = f.querySelector(`select[name="${name}"]`);
      if (!sel) return;
      const wrap = document.createElement('div');
      wrap.className = 'tq-chips';
      wrap.setAttribute('role', 'radiogroup');
      wrap.dataset.for = name;
      wrap.innerHTML = opts.map(([v, l]) =>
        `<button type="button" role="radio" aria-checked="false" class="tq-chip tq-${name}-${v.toLowerCase().replace(/\s+/g, '-')}" data-v="${v}">${l}</button>`).join('');
      wrap.addEventListener('click', e => {
        const b = e.target.closest('.tq-chip');
        if (!b) return;
        sel.value = b.dataset.v;
        sel.classList.remove('invalid');
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        syncChips(f);
      });
      sel.classList.add('tq-hidden');
      sel.setAttribute('tabindex', '-1');
      sel.after(wrap);
    });
    f.addEventListener('input', () => syncChips(f));
    f.addEventListener('change', () => syncChips(f));
  }
  function syncChips(f) {
    f.querySelectorAll('.tq-chips').forEach(w => {
      const v = f.querySelector(`select[name="${w.dataset.for}"]`)?.value || '';
      w.querySelectorAll('.tq-chip').forEach(b => {
        const on = b.dataset.v === v;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', String(on));
      });
    });
    if (f === form()) sync();
  }
  window.TicketQuick = { build, syncChips, OBS_GROUPS };

  // Les puces suivent la valeur du menu, qu'elle vienne d'un clic, d'une
  // suggestion, de l'ouverture d'un ticket existant ou d'un reset.
  function sync() {
    const f = form();
    if (!f) return;
    f.querySelectorAll('.tq-chips').forEach(w => {
      const v = f.querySelector(`select[name="${w.dataset.for}"]`)?.value || '';
      w.querySelectorAll('.tq-chip').forEach(b => {
        const on = b.dataset.v === v;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', String(on));
      });
      w.classList.toggle('invalid', !!f.querySelector(`select[name="${w.dataset.for}"].invalid`));
    });
    const left = [...f.querySelectorAll('#step-1 [required]')].filter(el => !String(el.value || '').trim()).length;
    const lab = document.getElementById('tq-left');
    if (lab) {
      lab.textContent = left ? `${left} required field${left > 1 ? 's' : ''} left` : 'Ready to save';
      lab.classList.toggle('is-ready', !left);
    }
  }

  // Ouverture : on attend que le formulaire soit rempli, puis on aligne.
  function hook(name) {
    const fn = window[name];
    if (typeof fn !== 'function' || fn.__tq) return;
    window[name] = function () {
      const r = fn.apply(this, arguments);
      build();
      sync();
      setTimeout(sync, 60);
      // Premier champ utile : le titre en création.
      if (name === 'openNewTicket') setTimeout(() => form()?.querySelector('[name="title"]')?.focus(), 80);
      return r;
    };
    window[name].__tq = true;
  }

  function init() {
    build();
    const of = document.getElementById('obs-form');
    if (of) build(of, OBS_GROUPS);
    const on = window.openNewObs;
    if (typeof on === 'function' && !on.__tq) {
      window.openNewObs = function () { const r = on.apply(this, arguments); if (of) syncChips(of); return r; };
      window.openNewObs.__tq = true;
    }
    hook('openNewTicket');
    hook('openEditTicket');
    // Les suggestions et le préremplissage posent des valeurs sans
    // événement : un léger rappel tant que le panneau est ouvert.
    setInterval(() => { if (isOpen()) sync(); }, 500);
    document.addEventListener('keydown', e => {
      if (!isOpen()) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (typeof saveTicket === 'function') saveTicket();
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
