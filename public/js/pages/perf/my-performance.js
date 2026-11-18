// ── CODES « MA PERFORMANCE » (page Admin) ─────────────────────
// L'admin délivre un code par agent. Le code en clair n'existe qu'entre
// la réponse du serveur et l'écran : il n'est stocké que haché, et cette
// page ne peut donc pas le réafficher plus tard.
async function renderFoAccess() {
  const tb = document.getElementById('foacc-tbody');
  if (!tb) return;

  const sel = document.getElementById('foacc-fo');
  if (sel) {
    const cur = sel.value;
    // Toute l'équipe : le code personnel est aussi la connexion à Pear
    // (seule une session nominative peut modifier quand le verrou d'équipe
    // est actif). « Autre personne » couvre qui n'est ni FO ni BO.
    const fos = state.config.fo_list || [];
    const bos = (state.boList || []).map(b => b.name).filter(n => n && !fos.includes(n));
    const opt = fo => {
      const fid = foIdOf(fo);
      // L'absence d'ID se voit dès la liste : sans lui la génération
      // échouera, autant le dire avant le clic.
      return `<option value="${esc(fo)}">${esc(fo)}${fid ? ' — ' + esc(fid) : ''}</option>`;
    };
    sel.innerHTML = `<optgroup label="Front Office">${fos.map(opt).join('')}</optgroup>`
      + (bos.length ? `<optgroup label="Back Office">${bos.map(opt).join('')}</optgroup>` : '')
      + (() => {
        // Rôles créés par l'admin (SMC, DRPS…) : un groupe chacun.
        const p = state.config.parties || {};
        return (p.roles || []).map(r => {
          const gens = (p.people || []).filter(x => x.role === r.key).map(x => x.name).filter(n => !fos.includes(n) && !bos.includes(n));
          return gens.length ? `<optgroup label="${esc(r.key)} — ${esc(r.label)}">${gens.map(opt).join('')}</optgroup>` : '';
        }).join('');
      })()
      + `<option value="__autre">Autre personne…</option>`;
    if (cur) sel.value = cur;
    // onchange et non addEventListener : renderFoAccess() est rappelé à
    // chaque visite de la page, les écouteurs s'empileraient.
    sel.onchange = syncFoAccessId;
    syncFoAccessId();
  }

  try {
    const res = await fetch(`${API}/api/fo-access`, {
      headers: AdminSession.headers(), credentials: 'same-origin',
    });
    if (!res.ok) throw new Error(res.status === 401 ? 'Admin session expired' : await _myPerfErreurServeur(res));
    const list = await res.json();

    tb.innerHTML = list.length ? list.map(r => `
      <tr>
        <td style="font-weight:600">${esc(r.fo)}</td>
        <td style="font-family:monospace;font-size:12px">${esc(r.employee_id || '—')}</td>
        <td>${r.updated_at ? esc(new Date(r.updated_at).toLocaleDateString((globalThis.PEAR_LOCALE || 'fr-FR'))) : '—'}</td>
        <td>${r.sessions || 0}</td>
        <td style="text-align:right">
          <button class="btn btn-ghost btn-sm" onclick="unlockFoCode('${esc(r.fo).replace(/'/g, "\\'")}')"
            title="Lever le blocage après trop de codes erronés">Débloquer</button>
          <button class="btn btn-ghost btn-sm" onclick="revokeFoCode('${esc(r.fo).replace(/'/g, "\\'")}')">Revoke</button>
        </td>
      </tr>`).join('')
      : `<tr><td colspan="5" style="padding:16px;text-align:center;color:var(--mute)">
           No code issued yet.</td></tr>`;
  } catch (e) {
    tb.innerHTML = `<tr><td colspan="5" style="padding:16px;text-align:center;color:var(--mute)">${esc(e.message)}</td></tr>`;
  }
}

// Reprend l'ID enregistré sur la fiche de l'agent. Le champ reste
// modifiable : on peut délivrer un code avec un ID corrigé sans passer
// d'abord par la page Général.
function syncFoAccessId() {
  const fo = document.getElementById('foacc-fo')?.value;
  const el = document.getElementById('foacc-id');
  if (!el) return;
  el.value = fo && fo !== '__autre' ? foIdOf(fo) : '';
  el.placeholder = el.value ? '' : 'Employee ID — to be set in General';
}

async function generateFoCode() {
  let fo = document.getElementById('foacc-fo')?.value;
  if (fo === '__autre') {
    fo = (prompt('Nom complet de la personne (ex. Prénom NOM) :') || '').trim().replace(/\s+/g, ' ');
    if (!fo) return;
  }
  const id = document.getElementById('foacc-id')?.value.trim();
  if (!fo) return toast('Choose an agent', 'error');
  if (!id)  return toast(`Enter ${fo}'s Employee ID`, 'error');

  if (!confirm(`Generate a code for ${fo} ?\n\nIf they already had one, it will stop working immediately.`))
    return;

  try {
    const res = await fetch(`${API}/api/fo-access/${encodeURIComponent(fo)}`, {
      method: 'POST',
      headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
      credentials: 'same-origin',
      body: JSON.stringify({ employeeId: id }),
    });
    const data = await res.json().catch(() => ({}));
    // On remonte le message du serveur tel quel : « Agent inconnu » et
    // « ID employé invalide » demandent deux corrections différentes, un
    // message unique obligeait à deviner laquelle.
    if (!res.ok) throw new Error(
      data.error
      || (res.status === 401 ? 'Admin session expired — re-enter the password.'
      : (res.status === 429 ? 'Too many attempts, please wait a few minutes.'
      : `Generation failed (error ${res.status})`)));

    // Seul moment où le code est lisible : on le met en évidence et on
    // dit clairement qu'il ne réapparaîtra pas.
    const box = document.getElementById('foacc-new');
    if (box) {
      box.style.display = '';
      box.innerHTML = `
        <div style="padding:14px 16px;border:1px solid var(--accent);border-radius:10px;
                    background:var(--bg2);margin-bottom:12px">
          <div style="font-size:12px;color:var(--mute);margin-bottom:6px">
            Code pour <b>${esc(data.fo)}</b> — hand it over in person.
            It will not be shown again.
          </div>
          <div style="font-family:monospace;font-size:22px;font-weight:700;
                      letter-spacing:.14em;color:var(--dark)">${esc(data.code)}</div>
        </div>`;
    }
    document.getElementById('foacc-id').value = '';
    renderFoAccess();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function unlockFoCode(fo) {
  const res = await fetch(`${API}/api/fo-access/${encodeURIComponent(fo)}/unlock`, {
    method: 'POST', headers: AdminSession.headers(), credentials: 'same-origin',
  });
  if (!res.ok) return toast('Déblocage impossible', 'error');
  toast(`${fo} peut de nouveau se connecter`, 'success');
}

async function revokeFoCode(fo) {
  if (!confirm(`Revoke the code of ${fo} ?\n\nThey will not be able to view their level until a new code is issued.`))
    return;
  try {
    const res = await fetch(`${API}/api/fo-access/${encodeURIComponent(fo)}`, {
      method: 'DELETE', headers: AdminSession.headers(), credentials: 'same-origin',
    });
    if (!res.ok) throw new Error('Revocation failed');
    toast(`${fo}'s code revoked`, 'success');
    renderFoAccess();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ── MA PERFORMANCE (consultation par l'agent) ─────────────────
// Le jeton vit en sessionStorage et non en localStorage : la consultation
// ne doit pas survivre à la fermeture de l'onglet, ces postes étant
// souvent partagés. Le serveur borne de toute façon la session à 30 min.
const FO_TOKEN_KEY = 'fo-perf-token';

// Connecté(e) avec son code personnel (session nominative) : pas besoin de
// le ressaisir ici, le serveur reconnaît la session (auth/identity.js,
// agentDe). « session » n'est qu'un repère côté client.
const MyPerf = {
  get token() {
    let t = '';
    try { t = sessionStorage.getItem(FO_TOKEN_KEY) || ''; } catch {}
    return t || (window.TeamIdentity && window.TeamIdentity.user ? 'session' : '');
  },
  set(t) { try { sessionStorage.setItem(FO_TOKEN_KEY, t); } catch (_) {} },
  clear() { try { sessionStorage.removeItem(FO_TOKEN_KEY); } catch (_) {} },
};

function _myPerfError(msg) {
  const el = document.getElementById('myperf-error');
  if (el) el.textContent = msg || '';
}

// Point d'entrée de la page. Une session encore valide évite de
// redemander le code à chaque navigation.
function renderMyPerf() {
  _myPerfError('');
  const code = document.getElementById('myperf-code');
  if (code) code.value = '';
  _myPerfSyncAdminBar();
  // Une consultation admin en cours survit au retour sur la page : on la
  // ré-affiche plutôt que de retomber sur l'écran de code.
  if (_adminPerfFo) { adminViewFoPerf(_adminPerfFo); return; }
  if (MyPerf.token) loadMyPerf();
  else _myPerfShowLogin();
}

// ── CONTRÔLE ADMIN DE LA FICHE AGENT ──────────────────────────
// L'admin note les agents depuis Configuration › Performance FO, mais
// n'y voit pas ce que l'agent voit : mise en page, libellés, mentions
// « non évalué ». Ce bandeau sert à vérifier cet affichage, en appelant
// une route admin dédiée qui produit la fiche par le même calcul que
// celui servi à l'agent.
let _adminPerfFo = null;

function _myPerfSyncAdminBar() {
  const bar = document.getElementById('myperf-admin-bar');
  if (!bar) return;
  const isAdmin = typeof AdminSession !== 'undefined' && AdminSession.active;
  bar.style.display = isAdmin ? '' : 'none';
  if (!isAdmin) { _adminPerfFo = null; return; }

  const sel = document.getElementById('myperf-admin-fo');
  if (!sel) return;
  const list = (state.config?.fo_list) || [];
  // Reconstruit seulement si la liste a changé, pour ne pas perdre la
  // sélection courante à chaque rendu de la page.
  if (sel.dataset.n !== String(list.length)) {
    sel.innerHTML = '<option value="">— Choisir un agent —</option>'
      + list.map(fo => `<option value="${esc(fo)}">${esc(fo)}</option>`).join('');
    sel.dataset.n = String(list.length);
  }
  sel.value = _adminPerfFo || '';
}

async function adminViewFoPerf(fo) {
  if (!fo) { adminExitFoPerf(); return; }
  _myPerfError('');
  try {
    const res = await fetch(`${API}/api/fo-perf/${encodeURIComponent(fo)}`, {
      headers: AdminSession.headers(), credentials: 'same-origin',
    });
    if (res.status === 401) throw new Error('Session admin expirée.');
    if (res.status === 404) throw new Error('Agent inconnu.');
    if (!res.ok) throw new Error(await _myPerfErreurServeur(res));
    _adminPerfFo = fo;
    _myPerfSyncAdminBar();
    // Même fonction de rendu que pour l'agent : c'est ce qui fait de cet
    // écran un contrôle fidèle et non une seconde présentation.
    _renderMyPerf(await res.json());
  } catch (e) {
    _adminPerfFo = null;
    _myPerfError(e.message);
    _myPerfShowLogin();
  }
}

function adminExitFoPerf() {
  _adminPerfFo = null;
  _myPerfSyncAdminBar();
  _myPerfError('');
  if (MyPerf.token) loadMyPerf();
  else _myPerfShowLogin();
}

function _myPerfShowLogin() {
  const l = document.getElementById('myperf-login');
  const r = document.getElementById('myperf-result');
  if (l) l.style.display = '';
  if (r) { r.style.display = 'none'; r.innerHTML = ''; }
}

async function myPerfLogin() {
  const id   = document.getElementById('myperf-id')?.value.trim();
  const code = document.getElementById('myperf-code')?.value.trim();
  if (!id || !code) return _myPerfError('Identifiant et code requis.');

  const btn = document.getElementById('myperf-submit');
  if (btn) btn.disabled = true;
  _myPerfError('');
  try {
    const res = await fetch(`${API}/api/fo-access/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: id, code }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 429) throw new Error(data.error || 'Trop d\'essais : réessaie dans 15 minutes.');
    if (!res.ok) throw new Error(data.error || 'Identifiant ou code incorrect.');
    MyPerf.set(data.token);
    // Le serveur a aussi ouvert la session nominative : on recharge pour que
    // tout l'écran passe au nom de la personne (pastille, Mon espace…).
    if (window.TeamIdentity && !window.TeamIdentity.user && window.TeamIdentity.codes) { location.reload(); return; }
    await loadMyPerf();
  } catch (e) {
    _myPerfError(e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Le message du serveur et son code, plutôt qu'un « Chargement impossible »
// muet : c'est ce qui permet de savoir quoi corriger.
async function _myPerfErreurServeur(res) {
  const d = await res.json().catch(() => ({}));
  const quoi = res.status === 429 ? 'Trop de requêtes, réessaie dans une minute'
    : res.status === 403 ? (d.error || 'Accès refusé')
    : d.error || 'Chargement impossible';
  return `${quoi} (erreur ${res.status})`;
}

async function loadMyPerf() {
  try {
    const res = await fetch(`${API}/api/my-perf`, { headers: { 'X-FO-Token': MyPerf.token } });
    if (res.status === 401) { MyPerf.clear(); _myPerfShowLogin(); return; }
    if (!res.ok) throw new Error(await _myPerfErreurServeur(res));
    _renderMyPerf(await res.json());
    // Les objectifs se chargent après la note : la page reste lisible même
    // si cet appel échoue, et l'agent n'attend pas deux requêtes pour voir
    // son score.
    loadMyObjectives();
  } catch (e) {
    _myPerfError(e.message);
    _myPerfShowLogin();
  }
}

function myPerfLogout() {
  const t = MyPerf.token;
  if (t === 'session' && typeof teamLogout === 'function') { teamLogout(); return; }
  MyPerf.clear();
  if (t) fetch(`${API}/api/fo-access/logout`, {
    method: 'POST', headers: { 'X-FO-Token': t },
  }).catch(() => {});
  renderMyPerf();
}

const _MYPERF_TENDANCE = {
  hausse:   { txt: 'improving',   ico: '↗', cls: 'up' },
  baisse:   { txt: 'declining',   ico: '↘', cls: 'down' },
  stable:   { txt: 'stable',      ico: '→', cls: 'flat' },
  inconnue: { txt: '',            ico: '',  cls: '' },
};

// Ce que dit le palier, une fois qu'on l'a nommé. Le niveau seul est une
// étiquette ; la phrase dit à l'agent où il se situe et ce qu'on attend.
const _MYPERF_NIVEAU_D = {
  4: 'You are above expectations on the whole of the scorecard. Keep this level and take on the coaching of newer agents.',
  3: 'The whole of your scorecard is at the expected level. A couple of criteria still stand between you and the top band.',
  2: 'The essentials are there, but several criteria stay under target. The lowest ones below are where the next points are.',
  1: 'Several criteria are clearly under target. The points listed below are the ones to work on first with your manager.',
  0: 'No score has been recorded for you yet over the period.',
};

// Libellés courts pour l'axe des mois de l'historique.
const _MYPERF_M_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function _myPerfMonthLabel(key, long) {
  const [y, m] = String(key || '').split('-');
  if (!y || !m) return String(key || '—');
  // Page de l'agent, en anglais : le mois long suit la même langue.
  return long ? new Date(+y, +m - 1, 1).toLocaleDateString((globalThis.PEAR_LOCALE || 'fr-FR'), { month: 'long', year: 'numeric' }) : _MYPERF_M_ABBR[+m - 1];
}

// Une note se lit en couleur avant de se lire en chiffre : même barème
// que les paliers du score global, pour ne pas avoir deux lectures.
function _myPerfTone(v) {
  if (v === null || v === undefined) return '';
  if (v >= 85) return 'g';
  if (v >= 70) return '';
  if (v >= 55) return 'o';
  return 'r';
}

