/* ══════════════════════════════════════════════════════════════
   ÉCRANS ÉPINGLÉS

   Chaque profil travaille sur une poignée d'écrans et traverse le reste
   du menu pour y arriver. Les épinglés remontent ces écrans en haut de
   la barre latérale.

   La préférence suit la PERSONNE et non le poste : elle est stockée côté
   serveur sur l'ID employé. Le reste des réglages d'interface (thème,
   sections repliées) reste en localStorage, ce qui convient à un choix
   d'affichage local — mais pas à une organisation de travail qu'on
   refait sinon sur chaque machine.
   ══════════════════════════════════════════════════════════════ */

/* Défauts par rôle : ce que la personne ouvre en premier le matin. Un FO
   vit dans les trackers et son plan de shift ; un BO arbitre et rapporte ;
   un observateur consulte. Ce ne sont que des valeurs de départ —
   dès que l'utilisateur épingle ou retire quoi que ce soit, son choix
   remplace le défaut et rien n'y revient. */
const PIN_DEFAULTS = {
  FO:       ['site', 'fo-dashboard', 'shift-planning', 'mon-espace'],
  BO:       ['site', 'observations', 'shift-approvals', 'rapports'],
  Observer: ['dashboard', 'site', 'rapports'],
};

// Daily, Weekly, Monthly, Ops Review, Diffusion et Export sont devenus
// des onglets de Rapports, sans entrée de menu : une épingle enregistrée
// sous l'un de ces noms devient l'épingle Rapports (une seule fois).
// Même chose pour My Tasks, My Requests, My Performance et Quiz, devenus
// des onglets de My Space (MES_LEGACY_PAGES).
function _pinNormalize(list) {
  const legacy = typeof RP_LEGACY_PAGES !== 'undefined' ? RP_LEGACY_PAGES : {};
  const mes = typeof MES_LEGACY_PAGES !== 'undefined' ? MES_LEGACY_PAGES : {};
  return [...new Set((list || []).map(p => legacy[p] ? 'rapports' : mes[p] ? 'mon-espace' : p))];
}

// Libellés repris du menu : une seule source, sinon les deux divergent au
// premier renommage.
function pinLabelFor(page) {
  const el = document.querySelector(`.nav-item[data-page="${page}"] .nav-item-label`);
  return el ? el.textContent.trim() : page;
}
function pinIconFor(page) {
  const el = document.querySelector(`.nav-item[data-page="${page}"] .nav-icon`);
  return el ? el.outerHTML : '';
}

let _pinned = null;     // null = pas encore chargé

const PIN_LOCAL_KEY = 'fo-pinned';   // repli hors-ligne

function _pinApiBase() {
  const id = (typeof currentUser !== 'undefined' && currentUser?.employeeId) || '';
  return id ? `${API}/api/user-prefs/${encodeURIComponent(id)}` : null;
}

async function loadPinned() {
  const url = _pinApiBase();
  // Sans identité, on retombe sur le cache local : la barre doit
  // fonctionner même avant identification.
  if (!url) {
    _pinned = _pinNormalize(JSON.parse(localStorage.getItem(PIN_LOCAL_KEY) || 'null') || []);
    renderPinnedNav();
    return;
  }
  try {
    const p = await fetch(url).then(r => r.json());
    // Distinction essentielle : « jamais choisi » (pas de clé `pinned`)
    // n'est pas « tout désépinglé » (tableau vide). Confondre les deux
    // faisait réapparaître les défauts du rôle à chaque rechargement,
    // et le désépinglage complet semblait ne pas être enregistré.
    _pinned = _pinNormalize(Array.isArray(p.pinned)
      ? p.pinned
      : (PIN_DEFAULTS[currentUser?.role] || PIN_DEFAULTS.Observer).slice());
  } catch (e) {
    _pinned = _pinNormalize(JSON.parse(localStorage.getItem(PIN_LOCAL_KEY) || 'null') || []);
  }
  localStorage.setItem(PIN_LOCAL_KEY, JSON.stringify(_pinned));
  renderPinnedNav();
}

async function savePinned() {
  localStorage.setItem(PIN_LOCAL_KEY, JSON.stringify(_pinned || []));
  const url = _pinApiBase();
  if (!url) return;   // pas d'identité : le cache local suffit
  try {
    await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pinned: _pinned,
        name: currentUser?.name || '',
        role: currentUser?.role || '',
      }),
    });
  } catch (e) {
    // L'épinglage reste actif localement ; il repartira au prochain
    // enregistrement réussi.
    console.error('[pins] enregistrement', e);
  }
}

const PIN_MAX = 8;

function isPinned(page) { return (_pinned || []).includes(page); }

async function togglePin(page, ev) {
  // Le clic sur la punaise ne doit pas naviguer vers la page.
  if (ev) { ev.stopPropagation(); ev.preventDefault(); }
  if (!_pinned) _pinned = [];
  if (isPinned(page)) {
    _pinned = _pinned.filter(p => p !== page);
  } else {
    if (_pinned.length >= PIN_MAX) {
      toast(`${PIN_MAX} pinned screens maximum`, 'error');
      return;
    }
    _pinned = [..._pinned, page];
  }
  renderPinnedNav();
  await savePinned();
}

// Icône de punaise. `filled` distingue « épinglé » de « épinglable ».
function _pinSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76V4h6v6.76l2 2.24v2H7v-2z"/></svg>`;
}

/* Rend la section épinglée ET pose le bouton de punaise sur chaque entrée
   du menu. Les deux vont ensemble : la punaise est le seul moyen de
   composer la liste. */
function renderPinnedNav() {
  const wrap = document.getElementById('nav-pinned-wrap');
  const host = document.getElementById('nav-pinned');
  if (!wrap || !host) return;
  const list = (_pinned || []).filter(p =>
    document.querySelector(`.nav-item[data-page="${p}"]`));

  // Boutons de punaise sur toutes les entrées du menu principal.
  document.querySelectorAll('.sidebar-body > .nav-item, .sidebar-group .nav-item')
    .forEach(item => {
      const page = item.dataset.page;
      if (!page) return;
      item.classList.toggle('is-pinned', list.includes(page));
      // Un écran épinglé remonte en haut : le laisser AUSSI dans sa
      // section d'origine le fait apparaître deux fois dans le même
      // menu. On masque l'original — la punaise de la copie épinglée
      // reste le moyen de le remettre à sa place.
      item.classList.toggle('nav-dup', list.includes(page));
      let btn = item.querySelector(':scope > .nav-pin');
      if (!btn) {
        btn = document.createElement('button');
        btn.className = 'nav-pin';
        btn.type = 'button';
        btn.innerHTML = _pinSvg();
        item.appendChild(btn);
      }
      const on = list.includes(page);
      btn.title = on ? 'Unpin' : 'Pin to top';
      btn.setAttribute('aria-label', `${btn.title} : ${pinLabelFor(page)}`);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.onclick = ev => togglePin(page, ev);
    });

  wrap.hidden = list.length === 0;
  if (!list.length) { host.innerHTML = ''; return; }

  const current = document.querySelector('.nav-item.active')?.dataset.page;
  host.innerHTML = list.map(page => `
    <div class="nav-item${page === current ? ' active' : ''} is-pinned" data-page="${page}">
      <div class="nav-item-left">${pinIconFor(page)}
        <span class="nav-item-label">${esc(pinLabelFor(page))}</span>
      </div>
      <button type="button" class="nav-pin" title="Unpin"
        aria-label="Unpin: ${esc(pinLabelFor(page))}"
        onclick="togglePin('${page}', event)">${_pinSvg()}</button>
    </div>`).join('');

  // La copie épinglée doit naviguer comme l'originale.
  host.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => window.renderPage(el.dataset.page));
  });
}
