// ══════════════════════════════════════════════════════════════
// BOUTON « ŒIL » SUR TOUS LES CHAMPS MOT DE PASSE
// Traité globalement plutôt que champ par champ : plusieurs écrans
// (modales, pages admin) créent leurs champs à la volée, et un
// MutationObserver les couvre sans avoir à modifier chaque appel.
// ══════════════════════════════════════════════════════════════
const PW_EYE_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const PW_EYE_OFF  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

function attachPwEye(input) {
  if (!input || input.dataset.pwEye === '1') return;
  // Un champ déjà enveloppé (re-render partiel) ne doit pas l'être deux fois.
  if (input.parentElement?.classList.contains('pw-wrap')) { input.dataset.pwEye = '1'; return; }
  input.dataset.pwEye = '1';

  const wrap = document.createElement('span');
  wrap.className = 'pw-wrap';
  // Le conteneur reprend les contraintes de mise en page du champ
  // (flex:1, largeurs) : sinon un champ en ligne perdrait son gabarit.
  const cs = input.style;
  if (cs.flex)     { wrap.style.flex = cs.flex; cs.flex = ''; }
  if (cs.width)    { wrap.style.width = cs.width; }
  if (cs.maxWidth) { wrap.style.maxWidth = cs.maxWidth; cs.maxWidth = ''; }
  if (cs.minWidth) { wrap.style.minWidth = cs.minWidth; cs.minWidth = ''; }
  if (cs.marginBottom) { wrap.style.marginBottom = cs.marginBottom; cs.marginBottom = ''; }

  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pw-eye';
  btn.innerHTML = PW_EYE_OPEN;
  btn.setAttribute('aria-label', 'Show password');
  btn.title = 'Show password';
  btn.tabIndex = -1; // ne coupe pas l'enchaînement champ → bouton de validation

  btn.addEventListener('click', e => {
    e.preventDefault();
    const shown = input.type === 'text';
    input.type = shown ? 'password' : 'text';
    btn.innerHTML = shown ? PW_EYE_OPEN : PW_EYE_OFF;
    const label = shown ? 'Show password' : 'Hide password';
    btn.setAttribute('aria-label', label);
    btn.title = label;
    input.focus();
  });

  wrap.appendChild(btn);
}

function scanPwFields(root) {
  (root || document).querySelectorAll('input[type="password"]').forEach(attachPwEye);
}

document.addEventListener('DOMContentLoaded', () => {
  scanPwFields();
  // Les champs créés après coup (modales, rendus dynamiques) sont
  // équipés à leur arrivée dans le document.
  new MutationObserver(muts => {
    for (const m of muts)
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches?.('input[type="password"]')) attachPwEye(n);
        else scanPwFields(n);
      }
  }).observe(document.body, { childList: true, subtree: true });
});
