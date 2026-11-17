// restore selectors & user pill after the app scripts load
document.addEventListener('DOMContentLoaded', () => {
  ['lang-select', 'lang-select-sb'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = currentLang;
  });
  _applyCountryNav();
  _syncCountryDropdowns();
  _syncCountryDot();
  if (currentUser) { updateUserPill(); startPresence(); }
  // Les épinglés dépendent du profil : on les charge dès que l'identité
  // est connue, et de nouveau après une (ré)identification.
  if (typeof loadPinned === 'function') loadPinned();
  if (!currentUser) {
    // Verrou d'équipe actif : c'est la session qui dit qui l'on est, pas
    // la fenêtre « choisis ton nom ». On attend sa réponse avant de décider.
    const demander = (n = 0) => {
      const t = window.TeamIdentity;
      if (t && !t.pret && n < 20) return setTimeout(() => demander(n + 1), 200);
      if (t && t.actif) return;
      // Admin en session : il travaille déjà identifié, pas d'invite.
      if ((t && t.admin) || (typeof AdminSession !== 'undefined' && AdminSession.active)) return;
      // Des codes existent : la connexion par code, refermable — on peut
      // consulter sans s'identifier, pas modifier quand le code est exigé.
      if (t && (t.codes || t.exige)) {
        // Pas d'invite sur la boîte à idées : tout le monde y colle un
        // post-it, code ou pas. Ni après un « plus tard » dans la session.
        const surIdees = !!document.getElementById('page-ideas')?.classList.contains('active');
        let plusTard = false; try { plusTard = sessionStorage.getItem('tg-plus-tard') === '1'; } catch (_) {}
        if (!t.user && !surIdees && !plusTard && typeof teamLogin === 'function') teamLogin();
        return;
      }
      if (!currentUser) openUserModal(true);
    };
    setTimeout(demander, 600);
  } else {
    // Identité déjà en localStorage : elle a pu être créée quand le champ
    // nom était libre (« sddd »). On la revalide contre les listes FO / BO
    // une fois la config chargée, et on force la ré-identification si elle
    // ne tient plus. Sans ça, les comptes inventés survivent au correctif.
    revalidateStoredIdentity();
  }
});

// Attend que la config (fo_list / boList) soit chargée, puis vérifie que
// l'identité stockée est toujours légitime.
function revalidateStoredIdentity(tries = 0) {
  // Verrou d'équipe actif : l'identité vient du serveur (identity.js).
  const t = window.TeamIdentity;
  if (t && (t.actif || t.exige || t.codes || t.user)) return;
  if (window.TeamIdentity && !window.TeamIdentity.pret && tries < 10)
    return setTimeout(() => revalidateStoredIdentity(tries + 1), 300);
  const known = _identityKnownNames();
  if (!known.length) {
    // Config pas encore là — on retente, sans boucler indéfiniment.
    if (tries < 20) return setTimeout(() => revalidateStoredIdentity(tries + 1), 400);
    return;
  }
  const stored = currentUser?.name || '';
  // Même règle qu'à la saisie : listes FO / BO, ou nom cohérent en
  // Observateur. Seules les identités inventées (« sddd ») sont chassées.
  const nameOk = known.some(n => n.toLowerCase() === stored.toLowerCase())
              || _isPlausibleName(stored);
  const idOk   = /^[a-zA-Z]{1,2}\d{7,8}$/.test(currentUser?.huaweiId || '');
  if (nameOk && idOk) return;

  stopPresence();
  localStorage.removeItem('fo-user');
  currentUser = null;
  toast('Your identity must be confirmed — select your name from the list', 'error');
  openUserModal(true);
}
// patch openNewTicket / openEditTicket to prefill modified_by
const _origOpenNew  = window.openNewTicket;
const _origOpenEdit = window.openEditTicket;
if (_origOpenNew) window.openNewTicket = function(t) { _origOpenNew(t); prefillModifiedBy(); };
if (_origOpenEdit) window.openEditTicket = function(t,id) { _origOpenEdit(t,id); prefillModifiedBy(); };

