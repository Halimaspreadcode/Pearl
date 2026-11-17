// ── PRESENCE (who is online right now) ────────────────────────
// The client announces itself on a fixed heartbeat; the dashboard polls the
// roster a little more slowly. Both intervals stay well inside the server's
// 90s TTL so a live user never flickers out between two ticks.
const PRESENCE_PING_MS  = 30000;
const PRESENCE_POLL_MS  = 20000;
const PRESENCE_MAX_AV   = 5;   // avatars shown before collapsing into "+N"

let _presenceTimers = null;

// Page courante, telle qu'affichée dans le menu. On lit le libellé du DOM
// plutôt que de maintenir une table page -> nom : la barre latérale fait
// déjà foi, et une entrée renommée reste automatiquement cohérente.
function currentPageInfo() {
  let page = '';
  try { page = localStorage.getItem('emoc-last-page') || ''; } catch (_) {}
  const active = document.querySelector('.nav-item.active');
  if (active?.dataset.page) page = active.dataset.page;
  if (!page) return { page: '', pageLabel: '' };

  const label = document.querySelector(
    `.nav-item[data-page="${page}"] .nav-item-label`)?.textContent?.trim();
  // Repli sur le sommaire de Configuration : ses rubriques n'ont pas toutes
  // une entrée de menu, et afficher « cfg-sessions » ne dirait rien.
  const rub = (typeof CFG_RUBRIQUES !== 'undefined')
    ? CFG_RUBRIQUES.find(r => r.page === page)?.titre : null;
  return { page, pageLabel: label || rub || page };
}

function presencePayload() {
  if (typeof currentUser === 'undefined' || !currentUser) return null;
  const { name, huaweiId, initials, color, role } = currentUser;
  return { name, huaweiId, initials, color, role, ...currentPageInfo() };
}

async function pingPresence() {
  const body = presencePayload();
  if (!body) return;
  try {
    const res = await fetch(`${API}/api/presence/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    // 401 = session fermée depuis la page Admin. C'est la seule réponse qui
    // déconnecte : un 403 (identité refusée) est déjà traité ailleurs.
    if (res.status === 401) forcePresenceSignOut();
  } catch { /* offline or server down - the next tick retries */ }
}

// Déconnexion imposée par un administrateur. Même effet qu'une identité
// invalidée : on coupe les pings, on oublie l'identité, on redemande le nom.
function forcePresenceSignOut() {
  stopPresence();
  try { localStorage.removeItem('fo-user'); } catch (_) {}
  currentUser = null;
  try { toast('Your session was closed by an administrator', 'error'); } catch (_) {}
  if (window.TeamIdentity && window.TeamIdentity.actif && typeof teamLogout === 'function') { teamLogout(); return; }
  try { openUserModal(true); } catch (_) {}
}

// Un changement de page ne doit pas attendre le prochain battement (30 s)
// pour se voir. Appelé par renderPage(), sans effet si la présence est à
// l'arrêt (identité non validée, ou utilisateur déconnecté).
function notePresencePage() {
  if (_presenceTimers) pingPresence();
}

async function refreshPresence() {
  const wrap = document.getElementById('dash-presence');
  if (!wrap) return;
  try {
    const res  = await fetch(`${API}/api/presence`);
    const data = await res.json();
    renderPresence(data.users || []);
  } catch {
    wrap.style.display = 'none';   // never leave a stale roster on screen
  }
}

function presenceAgo(sec) {
  if (sec < 60) return 'active now';
  const m = Math.floor(sec / 60);
  return `active ${m} min ago`;
}

function presenceAvatar(u, extraClass) {
  const initials = esc(u.initials || (u.name || '?').slice(0, 2).toUpperCase());
  const color    = esc(u.color || '#636C77');
  return `<div class="presence-av ${extraClass || ''}" style="background:${color}"
    title="${esc(u.name)} — ${esc(presenceAgo(u.secondsAgo))}">${initials}</div>`;
}

function renderPresence(users) {
  const wrap  = document.getElementById('dash-presence');
  const stack = document.getElementById('dash-presence-stack');
  const label = document.getElementById('dash-presence-label');
  const panel = document.getElementById('dash-presence-panel');
  if (!wrap || !stack || !label || !panel) return;

  if (!users.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'flex';

  const shown  = users.slice(0, PRESENCE_MAX_AV);
  const hidden = users.length - shown.length;

  stack.innerHTML = shown.map(u => presenceAvatar(u, u.secondsAgo < 60 ? 'is-fresh' : ''))
    .join('') + (hidden > 0 ? `<div class="presence-av is-more">+${hidden}</div>` : '');

  label.textContent = users.length === 1 ? '1 online' : `${users.length} online`;

  panel.innerHTML = `<div class="presence-panel-head">Online now — ${users.length}</div>` +
    users.map(u => `
      <div class="presence-row">
        ${presenceAvatar(u)}
        <div>
          <div class="presence-row-name">${esc(u.name)}</div>
          <div class="presence-row-meta">${esc(u.role || 'Observer')} · ${esc(presenceAgo(u.secondsAgo))}</div>
        </div>
      </div>`).join('');
}

