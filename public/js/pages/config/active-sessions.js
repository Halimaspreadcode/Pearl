// ── SESSIONS ACTIVES (page Admin) ─────────────────────────────
// Vue d'administration : le détail que /api/presence ne donne pas (ID employé,
// page consultée) et la possibilité de fermer une session. Le rafraîchissement
// s'arrête dès qu'on quitte la page — inutile d'interroger le serveur en fond.
const SESSIONS_POLL_MS = 15000;
let _sessionsTimer = null;

function startSessionsAdmin() {
  refreshSessionsAdmin();
  if (_sessionsTimer) clearInterval(_sessionsTimer);
  _sessionsTimer = setInterval(() => {
    // La page n'est plus à l'écran : on coupe plutôt que de continuer.
    if (!document.getElementById('page-cfg-sessions')?.classList.contains('active')) {
      clearInterval(_sessionsTimer); _sessionsTimer = null; return;
    }
    if (document.getElementById('sess-auto')?.checked) refreshSessionsAdmin();
  }, SESSIONS_POLL_MS);
}

async function refreshSessionsAdmin() {
  const tb = document.getElementById('sess-tbody');
  if (!tb) return;
  try {
    const res = await fetch(`${API}/api/presence/admin`, {
      headers: AdminSession.headers(), credentials: 'same-origin',
    });
    if (!res.ok) throw new Error(res.status === 401 ? 'Admin session expired' : 'Erreur serveur');
    const data = await res.json();
    renderSessionsAdmin(data.users || []);
  } catch (e) {
    tb.innerHTML = `<tr><td colspan="6" style="padding:18px;text-align:center;color:var(--mute)">
      ${esc(e.message || 'Chargement impossible')}</td></tr>`;
  }
}

function renderSessionsAdmin(users) {
  const tb = document.getElementById('sess-tbody');
  if (!tb) return;

  const count = document.getElementById('sess-count');
  if (count) count.textContent = users.length === 1 ? '1 session active' : `${users.length} sessions actives`;
  const upd = document.getElementById('sess-updated');
  if (upd) upd.textContent = `updated at ${new Date().toLocaleTimeString('en-GB')}`;

  if (!users.length) {
    tb.innerHTML = `<tr><td colspan="6" style="padding:18px;text-align:center;color:var(--mute)">
      Nobody is connected right now.</td></tr>`;
    return;
  }

  tb.innerHTML = users.map(u => `
    <tr>
      <td style="display:flex;align-items:center;gap:8px">
        ${presenceAvatar(u, u.secondsAgo < 60 ? 'is-fresh' : '')}
        <span style="font-weight:600">${esc(u.name)}</span>
      </td>
      <td style="font-family:monospace;font-size:12px">${esc(u.employeeId || '—')}</td>
      <td>${esc(u.role || 'Observer')}</td>
      <td>${u.pageLabel ? esc(u.pageLabel) : '<span style="color:var(--mute)">—</span>'}</td>
      <td style="white-space:nowrap">${esc(presenceAgo(u.secondsAgo))}</td>
      <td style="text-align:right">
        <button class="btn btn-ghost btn-sm" onclick="kickSession('${esc(u.key)}', '${esc(u.name).replace(/'/g, "\\'")}')">
          Sign out
        </button>
      </td>
    </tr>`).join('');
}

async function kickSession(key, name) {
  if (!confirm(`Close ${name}'s session?\n\nThey will be returned to the identification screen and can sign in again.`))
    return;
  try {
    const res = await fetch(`${API}/api/presence/kick`, {
      method: 'POST',
      headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
      credentials: 'same-origin',
      body: JSON.stringify({ key }),
    });
    if (!res.ok) throw new Error(res.status === 401 ? 'Admin session expired' : 'Sign-out failed');
    toast(`${name}'s session closed`, 'success');
    refreshSessionsAdmin();
  } catch (e) {
    toast(e.message || 'Sign-out failed', 'error');
  }
}

function startPresence() {
  if (_presenceTimers) return;          // guard against double-start
  pingPresence();
  refreshPresence();
  _presenceTimers = {
    ping: setInterval(pingPresence,    PRESENCE_PING_MS),
    poll: setInterval(refreshPresence, PRESENCE_POLL_MS),
  };
}

// Arrête les pings et retire l'avatar côté serveur. Utilisé quand une
// identité est invalidée (nom hors listes FO / BO) : sans ça, l'avatar
// d'un compte inventé reste affiché jusqu'à expiration du TTL.
function stopPresence() {
  const body = presencePayload();
  if (_presenceTimers) {
    clearInterval(_presenceTimers.ping);
    clearInterval(_presenceTimers.poll);
    _presenceTimers = null;
  }
  if (!body) return;
  fetch(`${API}/api/presence/leave`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {});   // best-effort : l'entrée expirera de toute façon
}

// Best-effort departure so the avatar drops immediately rather than
// waiting out the TTL. sendBeacon survives the page teardown; fetch does not.
window.addEventListener('pagehide', () => {
  const body = presencePayload();
  if (!body || !navigator.sendBeacon) return;
  navigator.sendBeacon(`${API}/api/presence/leave`,
    new Blob([JSON.stringify(body)], { type: 'application/json' }));
});

// A backgrounded tab gets its timers throttled; refresh on the way back so the
// roster is correct the moment the user returns.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && _presenceTimers) {
    pingPresence();
    refreshPresence();
  }
});

