// ── KPI CONFIG MODAL ─────────────────────────────────────────
let _kpiConfigPwUnlocked = false;
let _kpiConfigPendingChanges = {};

function openKpiConfigModal() {
  _kpiConfigPwUnlocked = false;
  _kpiConfigPendingChanges = {};
  const authWrap   = document.getElementById('kpi-auth-wrap');
  const toggleWrap = document.getElementById('kpi-toggle-wrap');
  const errEl      = document.getElementById('kpi-auth-error');
  const pwEl       = document.getElementById('kpi-config-pw');
  if (authWrap)   authWrap.style.display   = 'block';
  if (toggleWrap) toggleWrap.style.display = 'none';
  if (errEl)      errEl.style.display      = 'none';
  if (pwEl)       pwEl.value = '';
  document.getElementById('kpi-config-modal').classList.add('open');
  setTimeout(() => { if (pwEl) pwEl.focus(); }, 80);
}

async function unlockKpiConfig() {
  const pwEl  = document.getElementById('kpi-config-pw');
  const errEl = document.getElementById('kpi-auth-error');
  const pw    = (pwEl && pwEl.value) ? pwEl.value.trim() : '';
  if (!pw) return;
  try {
    const r = await AdminSession.login(pw);
    if (!r.ok) {
      if (errEl) { errEl.textContent = r.error; errEl.style.display = 'block'; }
      if (pwEl)  { pwEl.value = ''; pwEl.focus(); }
      return;
    }
    // On ne conserve plus le mot de passe en mémoire : la session
    // délivre un jeton, seul celui-ci circule ensuite.
    if (pwEl) pwEl.value = '';
    _kpiConfigPwUnlocked = true;
    const vis = await _loadKpiVisibility();
    _renderKpiToggles(vis);
    const authWrap   = document.getElementById('kpi-auth-wrap');
    const toggleWrap = document.getElementById('kpi-toggle-wrap');
    if (authWrap)   authWrap.style.display   = 'none';
    if (toggleWrap) toggleWrap.style.display = 'block';
  } catch { toast('Network error', 'error'); }
}

function _renderKpiToggles(vis) {
  const list = document.getElementById('kpi-toggle-list');
  if (!list) return;
  list.innerHTML = FO_KPI_DEFS.map(k => {
    const isOn = vis[k.id] !== false;
    return `<label style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px;cursor:pointer;user-select:none">
      <span style="font-size:13px;font-weight:500">${k.label}</span>
      <input type="checkbox" data-kpi="${k.id}" ${isOn?'checked':''}
        style="width:16px;height:16px;cursor:pointer;accent-color:var(--ok-fg)"
        onchange="_kpiConfigPendingChanges['${k.id}']=this.checked">
    </label>`;
  }).join('');
}

async function saveKpiConfig() {
  if (!_kpiConfigPwUnlocked) return;
  const vis    = await _loadKpiVisibility();
  const merged = { ...vis, ..._kpiConfigPendingChanges };
  try {
    const res = await fetch(`${API}/api/kpi-config`, {
      method: 'PUT',
      headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
      credentials: 'same-origin',
      body: JSON.stringify({ visibility: merged })
    });
    if (!res.ok) { toast('KPI save error', 'error'); return; }
    const data = await res.json();
    // Invalidate cache so next render fetches fresh data
    _kpiVisibility = data.kpi_visibility;
    _kpiConfigPwUnlocked = false;
    _kpiConfigPendingChanges = {};
    closeModal('kpi-config-modal');
    toast('KPI configuration saved', 'success');
    renderFoDashboard();
  } catch { toast('Network error', 'error'); }
}

