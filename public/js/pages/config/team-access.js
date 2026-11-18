// ══════════════════════════════════════════════════════════════
// ACCÈS ÉQUIPE — mot de passe demandé à l'ouverture de Pear
// (voir server/auth/team-gate.js). Le condensé reste côté serveur,
// hors de git ; l'écran n'en montre que l'état.
// ══════════════════════════════════════════════════════════════
async function renderTeamAccess() {
  const box = document.getElementById('team-access-state');
  if (!box) return;
  const res = await fetch(`${API}/api/team/password`, {
    headers: AdminSession.headers(), credentials: 'same-origin',
  }).catch(() => null);
  const d = res && res.ok ? await res.json().catch(() => ({})) : null;
  const btn = document.getElementById('team-disable-btn');
  if (!d) { box.textContent = 'État indisponible.'; return; }
  if (d.actif) {
    const depuis = d.updated_at ? ` depuis le ${new Date(d.updated_at).toLocaleDateString()}` : '';
    box.innerHTML = `<span style="color:var(--ok-fg);font-weight:600">● Actif${esc(depuis)}</span>`
      + ` <span style="color:var(--mute)">— ${d.sessions} session(s) d'équipe ouverte(s)</span>`;
  } else {
    box.innerHTML = '<span style="color:var(--red);font-weight:600">● Inactif</span>'
      + ' <span style="color:var(--mute)">— toute personne du réseau peut lire les données de Pear.</span>';
  }
  if (btn) btn.style.display = d.actif && !d.via_env ? '' : 'none';
  const req = document.getElementById('team-required');
  if (req) { req.checked = !!d.identity_required || d.actif; req.disabled = d.actif; }
}

async function setIdentityRequired(on) {
  const res = await fetch(`${API}/api/team/required`, {
    method: 'PUT', headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
    credentials: 'same-origin', body: JSON.stringify({ on }),
  });
  if (!res.ok) { toast('Échec de l\'enregistrement', 'error'); renderTeamAccess(); return; }
  toast(on ? 'Code personnel exigé pour modifier' : 'Code personnel facultatif', 'success');
  if (typeof loadConfig === 'function') loadConfig().catch(() => {});
  renderTeamAccess();
}

async function saveTeamPassword() {
  const input = document.getElementById('team-newpw');
  const pw = input?.value || '';
  if (pw.length < 10) { absMsg('team-newpw-msg', 'Au moins 10 caractères.', false); return; }
  const res = await fetch(`${API}/api/team/password`, {
    method: 'PUT',
    headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
    credentials: 'same-origin',
    body: JSON.stringify({ password: pw }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) { absMsg('team-newpw-msg', d.error || 'Échec de l\'enregistrement.', false); return; }
  if (input) input.value = '';
  absMsg('team-newpw-msg', 'Enregistré. Communique-le à l\'équipe.', true);
  toast('Accès équipe activé', 'success');
  renderTeamAccess();
}

async function disableTeamPassword() {
  if (!confirm('Désactiver le verrou ? Toute personne du réseau pourra de nouveau lire les données.')) return;
  const res = await fetch(`${API}/api/team/password`, {
    method: 'DELETE', headers: AdminSession.headers(), credentials: 'same-origin',
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) { absMsg('team-newpw-msg', d.error || 'Échec.', false); return; }
  absMsg('team-newpw-msg', 'Verrou désactivé.', true);
  renderTeamAccess();
}
