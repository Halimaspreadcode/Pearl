// ══════════════════════════════════════════════════════════════
// SESSION ADMIN — partagée par Configuration, Data Quality et Ops Review
// Trois pages dupliquaient le même code de déverrouillage, chacune avec
// son drapeau : il fallait retaper le mot de passe pour chacune, et
// l'accès était perdu à chaque rechargement. Une seule session sert
// désormais les trois, avec expiration.
// ══════════════════════════════════════════════════════════════
const ADMIN_TOKEN_KEY = 'fo-admin-token';

const AdminSession = {
  get token() { return sessionStorage.getItem(ADMIN_TOKEN_KEY) || ''; },

  // sessionStorage et non localStorage : l'accès admin ne doit pas
  // survivre à la fermeture de l'onglet.
  set(token) { sessionStorage.setItem(ADMIN_TOKEN_KEY, token); },
  clear()    { sessionStorage.removeItem(ADMIN_TOKEN_KEY); },
  get active(){ return !!this.token; },

  headers(extra) {
    return Object.assign({ 'X-Admin-Token': this.token }, extra || {});
  },

  async login(password) {
    const res = await fetch(`${API}/api/config/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
      credentials: 'same-origin',
    });
    if (res.status === 429) return { ok: false, error: 'Too many attempts. Try again in a few minutes.' };
    let data = {};
    try { data = await res.json(); } catch { /* réponse non JSON */ }
    if (!res.ok || !data.ok) return { ok: false, error: data.error || 'Incorrect password.' };
    this.set(data.token);
    this.syncIndicator();
    return { ok: true };
  },

  // Revalide côté serveur : un jeton peut avoir expiré ou le serveur
  // avoir redémarré (les sessions sont en mémoire).
  // On interroge le serveur même sans jeton local : la session peut tenir
  // par le cookie posé sur /admin (nouvel onglet, sessionStorage vide).
  async check() {
    try {
      const res = await fetch(`${API}/api/config/session`, {
        headers: this.headers(),
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (data.ok && data.token) this.set(data.token);
      if (!data.ok) this.clear();
      this.syncIndicator();
      return !!data.ok;
    } catch { return false; }
  },

  // Reflète l'état de la session dans la barre du haut.
  syncIndicator() {
    const b = document.getElementById('admin-session-btn');
    if (b) b.style.display = this.active ? 'flex' : 'none';
    // La bascule Simple/Admin n'existe que pour une session ouverte.
    if (typeof applyNavMode === 'function') applyNavMode();
  },

  async logout() {
    try {
      await fetch(`${API}/api/config/logout`, {
        method: 'POST',
        headers: this.headers(),
        credentials: 'same-origin',
      });
    } catch {}
    this.clear();
    this.syncIndicator();
    // Depuis la zone admin, rester sur place afficherait une page dont le
    // serveur vient de retirer l'accès : on repart vers l'app publique.
    if (location.pathname.startsWith('/admin')) { location.href = '/'; return; }
    if (typeof toast === 'function') toast('Admin session closed', 'success');
    if (typeof renderPage === 'function') renderPage('dashboard');
  },
};

// Écran de déverrouillage générique : une seule implémentation pour les
// trois pages, avec message d'erreur explicite et état de chargement.
async function adminUnlock(prefix, onSuccess) {
  const input = document.getElementById(`${prefix}-password`);
  const errEl = document.getElementById(`${prefix}-auth-error`);
  const btn   = document.getElementById(`${prefix}-submit`);
  const pw    = input ? input.value : '';

  if (!pw) {
    if (errEl) { errEl.textContent = 'Enter the password.'; errEl.style.display = 'block'; }
    input?.focus();
    return;
  }
  if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Checking…'; }
  if (errEl) errEl.style.display = 'none';

  const r = await AdminSession.login(pw);

  if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label || 'Sign in'; }
  if (!r.ok) {
    if (errEl) { errEl.textContent = r.error; errEl.style.display = 'block'; }
    if (input) { input.value = ''; input.focus(); }
    return;
  }
  if (input) input.value = '';
  onSuccess();
}

// Affiche l'écran verrouillé ou le contenu, selon la session en cours.
async function adminGate(prefix, onUnlocked) {
  const lock = document.getElementById(`${prefix}-login-screen`);
  const main = document.getElementById(`${prefix}-main-screen`);
  const ok   = await AdminSession.check();
  if (lock) lock.style.display = ok ? 'none' : 'flex';
  if (main) main.style.display = ok ? 'block' : 'none';
  if (ok) onUnlocked();
  else {
    const i = document.getElementById(`${prefix}-password`);
    if (i) i.value = '';
    const e = document.getElementById(`${prefix}-auth-error`);
    if (e) e.style.display = 'none';
  }
  return ok;
}

async function verifyConfig() {
  await adminUnlock('config', () => {
    configUnlocked = true;
    document.getElementById('config-login-screen').style.display = 'none';
    document.getElementById('config-main-screen').style.display  = 'block';
  });
}

async function verifyDQAccess() {
  await adminUnlock('dq', () => {
    dqUnlocked = true;
    document.getElementById('dq-login-screen').style.display = 'none';
    document.getElementById('dq-main-screen').style.display  = 'block';
    renderDataQuality();
  });
}

