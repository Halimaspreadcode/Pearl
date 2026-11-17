// ══════════════════════════════════════════════════════════════
// ACCÈS ABSENCES — liste blanche d'identifiants + reset du mot de passe
// La liste n'est renvoyée par /api/config que pour une session admin :
// hors de la zone admin, `absence_allowed_ids` est simplement absent.
// ══════════════════════════════════════════════════════════════
function absMsg(id, text, ok) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.style.color = ok ? 'var(--ok-fg)' : 'var(--red)';
}

function renderAbsenceAllowList() {
  const wrap = document.getElementById('abs-allow-list');
  if (!wrap) return;
  const ids = state.config?.absence_allowed_ids || [];
  wrap.innerHTML = ids.length
    ? ids.map(id => `
        <span style="background:var(--bg2);border:1px solid var(--line);padding:4px 10px;border-radius:20px;font-size:12px;display:inline-flex;align-items:center;gap:6px;font-family:'DM Mono',monospace">
          ${esc(id)}<button onclick="removeAbsenceAllowedId('${esc(id).replace(/'/g, "\\'")}')"
            title="Retirer" style="background:none;border:none;cursor:pointer;color:var(--mute);font-size:15px;line-height:1;padding:0">×</button>
        </span>`).join('')
    : `<span style="font-size:12px;color:var(--red)">No ID allowed — the Absences page is closed to everyone.</span>`;
}

async function saveAbsenceAllowedIds(ids) {
  const res = await fetch(`${API}/api/config`, {
    method: 'PUT',
    headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
    credentials: 'same-origin',
    body: JSON.stringify({ absence_allowed_ids: ids }),
  });
  if (!res.ok) {
    absMsg('abs-allow-msg', 'Save failed.', false);
    return false;
  }
  // On repart de la réponse du serveur : c'est elle qui porte la liste
  // normalisée (doublons et espaces retirés).
  const saved = await res.json().catch(() => null);
  state.config.absence_allowed_ids = saved?.absence_allowed_ids ?? ids;
  renderAbsenceAllowList();
  return true;
}

async function addAbsenceAllowedId() {
  const input = document.getElementById('abs-allow-input');
  const id = (input?.value || '').trim();
  if (!id) { absMsg('abs-allow-msg', 'Enter an ID.', false); return; }

  const current = state.config?.absence_allowed_ids || [];
  if (current.some(v => v.toLowerCase() === id.toLowerCase())) {
    absMsg('abs-allow-msg', 'This ID is already allowed.', false);
    return;
  }
  if (await saveAbsenceAllowedIds([...current, id])) {
    if (input) input.value = '';
    absMsg('abs-allow-msg', `“${id}” added.`, true);
  }
}

async function removeAbsenceAllowedId(id) {
  const current = state.config?.absence_allowed_ids || [];
  const next = current.filter(v => v.toLowerCase() !== String(id).toLowerCase());
  if (await saveAbsenceAllowedIds(next))
    absMsg('abs-allow-msg', `“${id}” removed.`, true);
}

async function resetAbsencePassword() {
  const input = document.getElementById('abs-newpw');
  const pw = input?.value || '';
  if (pw.length < 8) {
    absMsg('abs-newpw-msg', 'The password must be at least 8 characters.', false);
    return;
  }
  const res = await fetch(`${API}/api/absences/password`, {
    method: 'POST',
    headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
    credentials: 'same-origin',
    body: JSON.stringify({ password: pw }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) {
    absMsg('abs-newpw-msg', d.error || 'Reset failed.', false);
    return;
  }
  if (input) input.value = '';
  absMsg('abs-newpw-msg', 'Password reset. Open sessions have been closed.', true);
  toast('Absences password reset', 'success');
}


