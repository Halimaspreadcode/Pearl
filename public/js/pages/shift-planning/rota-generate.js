// ── GENERATE FULL YEAR ROTA ───────────────────────────────────
const GEN_YEAR_WEEKS = 52;

// Paramètres de la génération en attente de confirmation. Calculés à
// l'ouverture du modal pour que le récapitulatif affiché soit exactement
// ce qui sera exécuté.
let _genYearPending = null;

function generateYearRota() {
  const rc = state.rotaConfig || { sites: [] };
  if (!rc.sites || !rc.sites.length) { toast('No site configured in Settings → Shift Rota', 'error'); return; }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dow = today.getDay() === 0 ? 7 : today.getDay();
  const monday = new Date(today); monday.setDate(today.getDate() - dow + 1);
  const startISO = monday.toISOString().slice(0, 10);

  const end = new Date(monday); end.setDate(monday.getDate() + GEN_YEAR_WEEKS * 7 - 1);
  const endISO = end.toISOString().slice(0, 10);

  _genYearPending = { sites: rc.sites, startISO, weeks: GEN_YEAR_WEEKS };

  const fmt = iso => new Date(iso).toLocaleDateString((globalThis.PEAR_LOCALE || 'fr-FR'), { day: 'numeric', month: 'long', year: 'numeric' });
  const recap = document.getElementById('genyear-recap');
  if (recap) recap.innerHTML = `
    <div class="genyear-recap-row"><span>Period</span><span>${fmt(startISO)} → ${fmt(endISO)}</span></div>
    <div class="genyear-recap-row"><span>Duration</span><span>${GEN_YEAR_WEEKS} semaines</span></div>
    <div class="genyear-recap-row"><span>Sites affected</span><span>${rc.sites.map(s => esc(s.name)).join(', ')}</span></div>`;

  const err = document.getElementById('genyear-error');
  if (err) { err.style.display = 'none'; err.textContent = ''; }
  const pw = document.getElementById('genyear-password');
  if (pw) pw.value = '';

  document.getElementById('genyear-modal').classList.add('open');
  setTimeout(() => pw?.focus(), 60);
}

async function confirmGenerateYear() {
  if (!_genYearPending) return;
  const { sites, startISO, weeks } = _genYearPending;

  const input = document.getElementById('genyear-password');
  const errEl = document.getElementById('genyear-error');
  const btn   = document.getElementById('genyear-submit');
  const pw    = input ? input.value : '';

  const fail = msg => {
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
    if (input) { input.value = ''; input.focus(); }
    if (btn) { btn.disabled = false; btn.textContent = 'Generate'; }
  };

  if (!pw) return fail('Enter the admin password.');

  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  if (errEl) errEl.style.display = 'none';

  // Le mot de passe ouvre une session admin ; le jeton obtenu autorise
  // ensuite les appels de génération, eux-mêmes contrôlés côté serveur.
  const auth = await AdminSession.login(pw);
  if (!auth.ok) return fail(auth.error);

  if (input) input.value = '';
  if (btn) btn.textContent = 'Generating…';

  let done = 0;
  const failed = [];
  try {
    for (const site of sites) {
      if (btn) btn.textContent = `Generating… ${done + 1}/${sites.length}`;

      const genRes = await fetch(`${API}/api/rota/generate`, {
        method: 'POST',
        headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ site_id: site.id, start_date: startISO, weeks, use_anchor: true }),
      });
      if (!genRes.ok) { failed.push(site.name); continue; }

      const entries = await genRes.json();
      const saveRes = await fetch(`${API}/api/rota/save`, {
        method: 'POST',
        headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ entries, site_id: site.id, start_date: startISO, weeks }),
      });
      if (!saveRes.ok) { failed.push(site.name); continue; }
      done++;
    }

    await loadAll();
    renderShiftPlanning();
    closeModal('genyear-modal');

    if (failed.length && !done) toast(`Generation failed: ${failed.join(', ')}`, 'error');
    else if (failed.length)     toast(`${done}/${sites.length} sites generated — failed: ${failed.join(', ')}`, 'error');
    else                        toast(`${weeks}-week rota generated for ${done} site${done > 1 ? 's' : ''}`, 'success');
  } catch (e) {
    fail('Erreur : ' + e.message);
    return;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Generate'; }
    _genYearPending = null;
  }
}

// ── AUTO-FILL ROTA ────────────────────────────────────────────
async function autoFillRotaIfEmpty() {
  const rc = state.rotaConfig || { sites: [] };
  if (!rc.sites || !rc.sites.length) return;

  // Find Monday of current week
  const today = new Date(); today.setHours(0,0,0,0);
  const dow = today.getDay() === 0 ? 7 : today.getDay();
  const monday = new Date(today); monday.setDate(today.getDate() - dow + 1);
  const startISO = monday.toISOString().slice(0,10);

  // Check if rota entries already exist for this period (4 weeks)
  const endDate = new Date(monday); endDate.setDate(monday.getDate() + 28);
  const endISO = endDate.toISOString().slice(0,10);
  const existing = (state.shiftsPlan||[]).filter(e => e.is_rota && e.date >= startISO && e.date < endISO);
  if (existing.length > 0) return; // already filled

  // Generate + save for each site
  for (const site of rc.sites) {
    try {
      const genRes = await fetch(`${API}/api/rota/generate`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ site_id: site.id, start_date: startISO, weeks: 4 })
      });
      if (!genRes.ok) continue;
      const entries = await genRes.json();
      await fetch(`${API}/api/rota/save`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ entries, site_id: site.id, start_date: startISO, weeks: 4 })
      });
    } catch(e) { /* silently skip if server error */ }
  }
  // Reload shifts
  const fresh = await fetch(`${API}/api/shifts-plan`).then(r=>r.json());
  state.shiftsPlan = fresh;
}

