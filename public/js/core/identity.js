// ── USER IDENTITY ────────────────────────────────────────────
const AVATAR_COLORS = ['#C7000B','#2563EB','#059669','#7C3AED','#D97706','#0891B2','#BE185D','#65A30D'];
let currentUser = JSON.parse(localStorage.getItem('fo-user') || 'null');

// ── IDENTITÉ VÉRIFIÉE PAR LE SERVEUR ─────────────────────────
// Quand le verrou d'équipe est actif, « qui je suis » vient de la session
// ouverte avec le code personnel (server/auth/identity.js) : le profil ne
// se choisit plus dans une liste. On le recopie ici pour que tout l'écran
// (pastille, Mon espace, rappels) parle de la bonne personne.
// Identité gérée par le serveur dès qu'une session nominative existe, que
// le code est exigé, ou simplement que des codes personnels ont été
// délivrés : on se connecte alors avec son code au lieu de choisir un nom.
function _serverIdentityActive() {
  const t = window.TeamIdentity;
  return !!(t && (t.actif || t.exige || t.codes || t.user));
}

function applyServerIdentity(t) {
  if (!t || !_serverIdentityActive()) return;
  const u = t.user;
  if (!u) {
    // Consultation seule : aucun profil n'est revendiqué.
    if (currentUser && !t.admin) {
      currentUser = null;
      try { localStorage.removeItem('fo-user'); } catch {}
    }
    // Non connecté : la barre suit la vue « Non connecté » des vues par profil.
    if (typeof applyNavMode === 'function') try { applyNavMode(); } catch {}
    return;
  }
  const meme = currentUser && currentUser.name === u.name && currentUser.huaweiId === u.huaweiId;
  currentUser = {
    name: u.name, huaweiId: u.huaweiId, role: u.role || 'Observer',
    color: (meme && currentUser.color) || _autoAvatarColor(u.name),
    initials: getInitials(u.name), verified: true,
  };
  try { localStorage.setItem('fo-user', JSON.stringify(currentUser)); } catch {}
  try { updateUserPill(); } catch {}
  if (!meme) {
    if (typeof applyNavMode === 'function') try { applyNavMode(); } catch {}
    if (typeof loadPinned === 'function') try { loadPinned(); } catch {}
    if (window.NF) try { NF.render(); } catch {}
  }
}
window.applyServerIdentity = applyServerIdentity;
if (window.TeamIdentity && window.TeamIdentity.pret) applyServerIdentity(window.TeamIdentity);

// forceMode = true → modal bloquante (pas de croix, pas d'annuler)
function openUserModal(forceMode) {
  // Identité vérifiée : on ne la change pas ici, on se déconnecte.
  if (_serverIdentityActive()) {
    const t = window.TeamIdentity;
    if (t.user) {
      if (confirm(`Connecté(e) en tant que ${t.user.name} (${t.user.huaweiId}).\n\nSe déconnecter ?`)) teamLogout();
    } else if (typeof teamLogin === 'function') teamLogin();
    return;
  }
  const forced = forceMode || !currentUser;

  // Les suggestions FO/BO sont rendues en puces par
  // renderIdentitySuggestions(), appelé depuis updateIdentityPreview().

  // titre selon contexte
  document.getElementById('identity-modal-title').textContent = forced ? 'Identify yourself to continue' : 'My profile';
  document.getElementById('identity-modal-sub').textContent   = forced
    ? 'All your actions are logged - your name is required'
    : 'Edit your identity';

  document.getElementById('identity-submit-label').textContent = forced
    ? 'Confirm my identity' : 'Save';

  // croix + annuler seulement si on modifie (pas forcé)
  document.getElementById('identity-modal-close').style.display  = forced ? 'none' : '';
  document.getElementById('identity-cancel-wrap').style.display  = forced ? 'none' : '';

  // empêcher fermeture par clic overlay si forcé
  const overlay = document.getElementById('user-identity-modal');
  overlay._forced = forced;

  const inp = document.getElementById('identity-name-input');
  inp.value = currentUser?.name || '';
  const hwInp = document.getElementById('identity-huawei-input');
  if (hwInp) hwInp.value = currentUser?.huaweiId || '';

  // La couleur n'est plus un choix : un champ de moins à remplir pour une
  // décision sans enjeu. On garde celle déjà attribuée, sinon on en dérive
  // une du nom au moment d'enregistrer.
  _identityColor = currentUser?.color || null;

  updateIdentityPreview();   // rend aussi les suggestions
  overlay.classList.add('open');
  setTimeout(() => inp.focus(), 120);
}

// Couleur de l'identité en cours d'édition (null tant qu'aucune n'est
// attribuée — elle sera dérivée du nom).
let _identityColor = null;

// Couleur dérivée du nom plutôt que tirée au sort à chaque frappe : le même
// agent garde le même avatar d'une session à l'autre, et l'aperçu ne
// clignote pas pendant la saisie.
function _autoAvatarColor(name) {
  const s = (name || '').trim().toLowerCase();
  if (!s) return AVATAR_COLORS[0];
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// Liste des noms connus (FO + BO), source des suggestions et du rôle.
function _identityKnownNames() {
  const cfg = state.config || {};
  return [...new Set([
    ...(cfg.fo_list || []),
    ...(state.boList || []).map(b => b.name),
  ])].filter(Boolean);
}

/* Un nom hors listes FO / BO est accepté (rôle Observateur), à condition
   qu'il ressemble à un nom. Le but n'est pas de valider un état civil —
   impossible — mais d'écarter les saisies qui n'en sont manifestement pas
   une : « sddd », « dncje », « test », une suite de touches.

   Le contrôle est calibré sur les noms réellement présents dans le
   tracker, patronymes sénégalais courts inclus (BA, DIA, FALL), donc il
   reste volontairement permissif : mieux vaut laisser passer un nom
   inhabituel que bloquer quelqu'un de légitime. */
const _NAME_STOPWORDS = new Set([
  'test', 'tests', 'testing', 'essai', 'demo', 'admin', 'user', 'utilisateur',
  'anonyme', 'anonymous', 'inconnu', 'unknown', 'moi', 'toto', 'azerty', 'qwerty',
  'aaa', 'abc', 'xxx', 'asdf', 'qwe',
]);

// Un mot ressemble-t-il à un mot prononçable ? On s'appuie sur deux
// signaux robustes : la présence d'une voyelle, et l'absence de longues
// suites de consonnes — ce qui est exactement ce qui trahit « sddd » et
// « dncje ».
function _looksLikeWord(w) {
  const s = w.toLowerCase();
  if (_NAME_STOPWORDS.has(s)) return false;
  // Une seule lettre répétée : « aaa », « sss ».
  if (/^(.)\1+$/.test(s)) return false;
  // Les patronymes d'une lettre n'existent pas ; deux lettres, si (BA, BA).
  if (s.length < 2) return false;
  // Voyelle obligatoire. 'y' compte, ainsi que les voyelles accentuées.
  if (!/[aeiouyàâäéèêëîïôöùûüÿ]/.test(s)) return false;
  // Quatre consonnes d'affilée : personne ne s'appelle « dncje » — mais on
  // tolère trois (Ndiaye, Mbaye commencent par deux).
  if (/[bcdfghjklmnpqrstvwxz]{4,}/.test(s)) return false;
  return true;
}

function _isPlausibleName(name) {
  const n = String(name || '').trim();
  if (n.length < 4) return false;
  // Chiffres et symboles n'ont rien à faire dans un nom. On autorise le
  // trait d'union, l'apostrophe et le point (Jean-Luc, N'Diaye, M. Fall).
  if (!/^[\p{L}][\p{L}\s'’.-]*$/u.test(n)) return false;
  const parts = n.split(/[\s.]+/).filter(Boolean);
  // Prénom + nom : un mot seul ne permet pas d'identifier quelqu'un dans
  // un audit, c'est justement le problème qu'on corrige. Une initiale
  // (« M. Fall ») compte comme élément, sans passer le test de
  // prononçabilité qui n'a pas de sens sur une lettre isolée.
  if (parts.length < 2) return false;
  const words = parts.filter(w => w.length > 1);
  // Au moins un vrai mot : « s. d » n'est qu'une suite d'initiales, il
  // passerait sinon sans qu'aucun test de prononçabilité ne s'applique.
  if (!words.length) return false;
  return words.every(_looksLikeWord);
}

// Personne rangée dans un rôle créé par l'admin (SMC, DRPS…).
function _identityPartie(name) {
  const p = (state.config && state.config.parties) || {};
  const n = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const x = (p.people || []).find(y => n(y.name) === n(name));
  const r = x && (p.roles || []).find(y => y.key === x.role);
  return r ? { personne: x, role: r } : null;
}

// Rôle déduit du nom. `note` explique ce que le rôle implique — un
// simple libellé « Observer » ne disait pas qu'on est en lecture seule.
function _identityRole(name) {
  const cfg  = state.config || {};
  if ((cfg.fo_list || []).includes(name))
    return { key: 'FO', cls: 'fo', label: 'Front Office',
             note: 'Your tickets and score appear in the FO Dashboard.',
             ico: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>' };
  if ((state.boList || []).some(b => b.name === name))
    return { key: 'BO', cls: 'bo', label: 'Back Office',
             note: 'Full write access, your actions are logged.',
             ico: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>' };
  // Parties prenantes (Configuration › Rôles et parties prenantes).
  const pp = _identityPartie(name);
  if (pp) return { key: pp.role.key, cls: 'obs', label: pp.role.label,
    note: `${pp.role.key} — your actions are logged under this name.`,
    ico: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17.5" cy="9" r="2.4"/><path d="M15.5 14.2A5 5 0 0 1 21.5 19"/>' };
  // Hors listes FO / BO : le rôle Observateur reste ouvert — des gens
  // légitimes consultent le tracker sans y être affectés. Mais il exige un
  // nom qui ressemble à un nom : « sddd » ou « dncje » ne sont pas des
  // identités, et c'est ce qu'on refuse.
  if (!_isPlausibleName(name))
    return { key: 'Invalid', cls: 'obs', label: 'Nom invalide',
             note: 'Enter your full name (first and last), as it appears in the directory.',
             ico: '<path d="M12 9v4"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="10"/>' };
  return { key: 'Observer', cls: 'obs', label: 'Observateur',
           note: 'Name not in the FO / BO lists — read access, your actions are still logged under this name.',
           ico: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>' };
}

// Puces de suggestion : rend visible la liste FO/BO, filtrée par ce
// qui est déjà saisi.
function renderIdentitySuggestions() {
  const el = document.getElementById('identity-suggest');
  if (!el) return;
  const typed = (document.getElementById('identity-name-input')?.value || '').trim().toLowerCase();
  let names = _identityKnownNames();
  if (typed) names = names.filter(n => n.toLowerCase().includes(typed));
  // Exact match : la puce n'apporte plus rien.
  if (names.length === 1 && names[0].toLowerCase() === typed) names = [];
  const MAX = 6;
  const shown = names.slice(0, MAX);
  const rest  = names.length - shown.length;
  el.innerHTML = shown.map(n =>
    `<button type="button" class="idt-sg" onclick="pickIdentityName(this)" data-name="${esc(n)}">${esc(n)}</button>`
  ).join('') + (rest > 0 ? `<span class="idt-sg idt-sg-more">+${rest} autre${rest > 1 ? 's' : ''}</span>` : '');
}

function pickIdentityName(btn) {
  const inp = document.getElementById('identity-name-input');
  if (!inp) return;
  inp.value = btn.dataset.name;
  updateIdentityPreview();   // re-rend aussi les suggestions
  document.getElementById('identity-huawei-input')?.focus();
}

// Entrée dans le champ nom : si une seule suggestion reste, la retenir.
function idtNameKey(ev) {
  if (ev.key !== 'Enter') return;
  const btns = document.querySelectorAll('#identity-suggest .idt-sg[data-name]');
  if (btns.length === 1) { ev.preventDefault(); pickIdentityName(btns[0]); return; }
  ev.preventDefault();
  document.getElementById('identity-huawei-input')?.focus();
}

// L'ID Huawei suit un format connu (une ou deux lettres + 8 chiffres,
// ex. h50056630). Le refus est dur : un ID libre laissait passer des
// identités non attribuables, et c'est précisément ce que l'audit doit
// empêcher.
function _identityHwState(v) {
  const s = (v || '').trim();
  if (!s) return { cls: '', msg: '' };
  // Format valide : pas de message, le check dans le champ suffit.
  if (/^[a-zA-Z]{1,2}\d{7,8}$/.test(s)) return { cls: 'ok', msg: '' };
  if (/^\d+$/.test(s)) return { cls: 'err', msg: 'Il manque la lettre initiale (ex : h50056630)' };
  if (s.length < 6) return { cls: 'err', msg: 'Trop court — attendu : une ou deux lettres puis 7 ou 8 chiffres' };
  return { cls: 'err', msg: 'Format invalide — attendu : une ou deux lettres puis 7 ou 8 chiffres (ex : h50056630, wx1488808)' };
}

function updateIdentityPreview() {
  const nameRaw  = document.getElementById('identity-name-input')?.value || '';
  const name     = nameRaw.trim();
  const huaweiId = document.getElementById('identity-huawei-input')?.value || '';
  const color    = _identityColor || _autoAvatarColor(name);
  const initials = getInitials(nameRaw);

  const av = document.getElementById('identity-preview-avatar');
  if (av) { av.textContent = initials || '?'; av.style.background = color; }

  // Rôle + ce qu'il implique
  const roleEl = document.getElementById('identity-preview-role');
  if (roleEl) {
    if (!name) { roleEl.innerHTML = ''; }
    else {
      const r = _identityRole(name);
      roleEl.innerHTML =
        `<span class="idt-role ${r.cls}">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${r.ico}</svg>
           ${r.label}${huaweiId.trim() ? ' · ' + esc(huaweiId.trim()) : ''}
         </span>
         <div class="idt-role-note">${r.note}</div>`;
    }
  }

  // Validation de l'ID
  const hwInp  = document.getElementById('identity-huawei-input');
  const hwHint = document.getElementById('identity-hw-hint');
  const hw     = _identityHwState(huaweiId);
  if (hwHint) { hwHint.textContent = hw.msg; hwHint.className = 'idt-hint ' + hw.cls; }
  if (hwInp)  hwInp.classList.toggle('is-err', hw.cls === 'err');
  document.getElementById('identity-hw-check')?.classList.toggle('show', hw.cls === 'ok');

  // Le bouton reflète l'état du formulaire plutôt que d'échouer au clic :
  // nom des listes FO / BO ou nom cohérent (Observateur), ET ID au format.
  const submit = document.getElementById('identity-submit');
  if (submit) {
    const nameOk = !!name && (
      _identityKnownNames().some(n => n.toLowerCase() === name.toLowerCase())
      || _isPlausibleName(name));
    submit.disabled = !nameOk || hw.cls !== 'ok';
  }

  renderIdentitySuggestions();
}

function getInitials(name) {
  if (!name) return '';
  return name.split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase();
}

function saveIdentity() {
  const name    = document.getElementById('identity-name-input')?.value.trim() || '';
  const huaweiId = document.getElementById('identity-huawei-input')?.value.trim() || '';
  if (!name)     { toast('Enter your name', 'error');       document.getElementById('identity-name-input').focus();    return; }
  if (!huaweiId) { toast('Enter your Huawei ID', 'error'); document.getElementById('identity-huawei-input').focus(); return; }

  // Deux cas légitimes : un nom des listes FO / BO, ou un nom cohérent
  // hors listes (rôle Observateur — des gens consultent le tracker sans y
  // être affectés). Ce qu'on refuse, c'est la saisie qui n'est pas un nom :
  // « sddd », « dncje », une suite de touches.
  const known = _identityKnownNames();
  const match = known.find(n => n.toLowerCase() === name.toLowerCase()) || null;
  if (!match && !_isPlausibleName(name)) {
    toast('Invalid name — enter your full name (first and last)', 'error');
    document.getElementById('identity-name-input').focus();
    return;
  }
  // L'ID Huawei suit le format interne (une ou deux lettres + 7 ou 8 chiffres).
  // Refus dur ici, contrairement au simple avertissement de la saisie : un
  // ID mal formé rend la trace d'audit inexploitable.
  if (!/^[a-zA-Z]{1,2}\d{7,8}$/.test(huaweiId)) {
    toast('ID Huawei invalide — format attendu : h50056630 ou wx1488808', 'error');
    document.getElementById('identity-huawei-input').focus();
    return;
  }

  const cfg     = state.config || {};
  // Hors listes, on garde la saisie de l'utilisateur ; dans les listes, on
  // stocke le nom canonique et non la casse tapée — deux graphies du même
  // agent donneraient deux identités dans l'audit.
  const finalName = match || name;
  // Couleur attribuée d'office : celle déjà en place, sinon dérivée du nom
  // canonique (et non de la casse tapée, pour rester stable).
  const color   = _identityColor || _autoAvatarColor(finalName);
  const isFO    = (cfg.fo_list || []).includes(finalName);
  const isBO    = (state.boList || []).some(b => b.name === finalName);
  const pp      = !isFO && !isBO ? _identityPartie(finalName) : null;
  const role    = isFO ? 'FO' : isBO ? 'BO' : pp ? pp.role.key : 'Observer';
  currentUser   = { name: finalName, huaweiId, color, initials: getInitials(finalName), role };
  localStorage.setItem('fo-user', JSON.stringify(currentUser));
  updateUserPill();
  startPresence();
  pingPresence();   // announce the new identity at once, don't wait a full tick
  // Le profil vient de changer : ses épinglés aussi.
  if (typeof loadPinned === 'function') loadPinned();
  // Le rôle conditionne la cloche de rappels : elle doit apparaître
  // (ou disparaître) au moment où l'identité est confirmée.
  if (window.NF) NF.render();
  // Le rôle commande aussi la vue de la barre latérale : changer de
  // profil doit la recomposer tout de suite, sinon l'utilisateur garde
  // la barre de son ancien rôle jusqu'au prochain rechargement.
  applyNavMode();
  // Autrefois : replier Reporting et Admin pour un FO, les déplier pour
  // les autres. Mais expandSection() écrit dans localStorage — confirmer
  // son identité écrasait donc définitivement l'état de l'accordéon, et
  // la barre revenait dépliée à chaque rechargement quel que soit le
  // réglage par défaut.
  //
  // On ne replie plus que pour un FO, et seulement la première fois :
  // l'accordéon appartient à l'utilisateur, pas au formulaire d'identité.
  if (isFO && localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === null) {
    ['reporting', 'admin'].forEach(collapseSection);
  }
  closeModal('user-identity-modal');
  toast(`Bienvenue, ${finalName.split(' ')[0]} (${role}) !`, 'success');
}

// Guard - appeler avant toute action d'écriture
function requireUser(action) {
  if (currentUser) return true;
  openUserModal(true);
  toast('Identify yourself first to ' + (action || 'perform this action'), 'error');
  return false;
}

function updateUserPill() {
  if (!currentUser) return;
  const av = document.getElementById('user-avatar-top');
  av.textContent = currentUser.initials;
  av.style.background = currentUser.color;
  document.getElementById('user-name-top').textContent = currentUser.name.split(' ')[0];
  const dot = document.getElementById('user-pill-dot');
  if (dot) dot.style.display = 'none';
  // sidebar footer
  const sbName = document.getElementById('sb-user-name');
  if (sbName) sbName.textContent = currentUser.name.split(' ')[0];
  const sbAv = document.getElementById('sb-avatar');
  if (sbAv) { sbAv.textContent = currentUser.initials; sbAv.style.background = currentUser.color; }
}

// pre-fill "modified_by" when opening ticket modal
function prefillModifiedBy() {
  if (!currentUser) return;
  const el = document.getElementById('form-modified-by');
  if (el && currentUser.name) {
    // set after options are populated
    setTimeout(() => { if ([...el.options].some(o => o.value === currentUser.name)) el.value = currentUser.name; }, 50);
  }
}

// Les deux bandeaux sont repliés par défaut : avec une dizaine de tickets
// ils occupaient tout le premier écran et repoussaient les KPI hors de vue.
// Le choix de l'utilisateur est mémorisé.
const BREACH_COLLAPSE_KEY = 'fo-breach-collapsed';

function _breachCollapseState() {
  try { return JSON.parse(localStorage.getItem(BREACH_COLLAPSE_KEY)) || {}; }
  catch { return {}; }
}
function _setBreachCollapse(key, collapsed) {
  const st = _breachCollapseState();
  st[key] = collapsed;
  localStorage.setItem(BREACH_COLLAPSE_KEY, JSON.stringify(st));
}

function toggleBreachCollapse() {
  const card = document.getElementById('breach-alert');
  if (!card) return;
  _setBreachCollapse('breach', card.classList.toggle('collapsed'));
}

function toggleNearBreachCollapse() {
  const card = document.getElementById('near-breach-alert');
  if (!card) return;
  _setBreachCollapse('near', card.classList.toggle('collapsed'));
}

// Applique l'état au chargement — replié sauf si l'utilisateur a déplié.
function applyBreachCollapseDefaults() {
  const st = _breachCollapseState();
  const b  = document.getElementById('breach-alert');
  const n  = document.getElementById('near-breach-alert');
  if (b) b.classList.toggle('collapsed', st.breach !== false);
  if (n) n.classList.toggle('collapsed', st.near   !== false);
}
document.addEventListener('DOMContentLoaded', applyBreachCollapseDefaults);
