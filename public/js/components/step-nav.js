// ── STEP NAVIGATION ──────────────────────────────────────────
let currentStep = 1;

function goStep(n) {
  if (n === 2) {
    const required = document.querySelectorAll('#step-1 [required]');
    let valid = true;
    required.forEach(el => { if (!el.value) { el.classList.add('invalid'); valid = false; } else el.classList.remove('invalid'); });
    if (!valid) { toast('Please fill in all required fields', 'error'); return; }
  }
  currentStep = n;
  document.getElementById('step-1').style.display = n === 1 ? 'grid' : 'none';
  document.getElementById('step-2').style.display = n === 2 ? 'grid' : 'none';
  document.getElementById('btn-prev').style.display = n === 2 ? '' : 'none';
  document.getElementById('btn-next').style.display = n === 1 ? '' : 'none';
  // L'enregistrement est possible dès l'étape 1 : les détails et la RCA
  // sont facultatifs à la création (sauf statut Closed, contrôlé à
  // l'enregistrement, qui ramène alors à l'étape 2).
  document.getElementById('btn-save').style.display = '';
  document.getElementById('modal-step-label').textContent =
    n === 1 ? 'Essential information' : 'Details & root cause analysis';
  // side-panel tabs use CSS classes
  const t1 = document.getElementById('step-tab-1');
  const t2 = document.getElementById('step-tab-2');
  if (t1 && t2) {
    t1.classList.toggle('active', n === 1);
    t2.classList.toggle('active', n === 2);
    t1.setAttribute('aria-selected', String(n === 1));
    t2.setAttribute('aria-selected', String(n === 2));
    // reset any leftover inline styles from old modal
    [t1,t2].forEach(t => { t.style.borderBottomColor=''; t.style.color=''; t.style.fontWeight=''; });
  }
  updateStepTabState();
  // Nouvelle étape = nouveau contenu : on repart en haut et on
  // recalcule les traits de profondeur.
  const body = document.querySelector('#ticket-modal .side-panel-body');
  if (body) body.scrollTop = 0;
  const panel = document.querySelector('#ticket-modal .side-panel');
  if (panel && panel._syncScroll) requestAnimationFrame(panel._syncScroll);
}

// Reflète l'état de remplissage sur les pastilles d'onglet : coche verte
// quand l'étape est complète, pastille rouge quand il manque des champs.
// Avant, l'onglet 2 ne disait rien de ce qui restait à faire.
function updateStepTabState() {
  [1, 2].forEach(i => {
    const tab  = document.getElementById(`step-tab-${i}`);
    const step = document.getElementById(`step-${i}`);
    if (!tab || !step) return;
    const required = [...step.querySelectorAll('[required]')]
      .filter(el => el.offsetParent !== null || step.style.display === 'none');
    const missing  = required.filter(el => !el.value).length;
    const num = tab.querySelector('.sp-tab-num');
    tab.classList.toggle('has-error',   missing > 0 && required.length > 0);
    tab.classList.toggle('is-complete', missing === 0 && required.length > 0);
    if (num) num.textContent = (missing === 0 && required.length > 0) ? '✓' : String(i);
    tab.title = missing ? `${missing} champ(s) requis manquant(s)` : '';
  });
}

// Close ticket side panel when clicking the dark backdrop (not the panel itself).
// Passe par requestClose : un formulaire entamé demande confirmation.
function handleTicketPanelOverlayClick(e) {
  if (e.target === document.getElementById('ticket-modal')) SidePanel.requestClose('ticket-modal');
}

// L'appel de démarrage vit dans js/core/boot.js, chargé en dernier : `init()` entre dans
// loadConfig() de façon synchrone jusqu'au premier `await`, et y lit
// AdminSession — un `const` déclaré plus bas. Lancé ici, cet accès
// tombait dans la zone morte temporelle : ReferenceError, init()
// rejeté, et les squelettes du tableau de bord restaient affichés
// indéfiniment. Voir js/core/boot.js.

