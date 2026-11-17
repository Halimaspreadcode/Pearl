// ── TICKET MODAL ─────────────────────────────────────────────
// ── RCA ENFORCEMENT ──────────────────────────────────────────
// Called whenever the status field changes or a modal opens.
function onStatusChange(val) {
  _syncRcaRequired(val === 'Closed');
  if (val === 'Closed') {
    goStep(2);
    toast('Closed status — RCA is mandatory (Details & RCA tab)', 'error');
  }
}

function _syncRcaRequired(required) {
  const banner     = document.getElementById('rca-required-banner');
  const tabBadge   = document.getElementById('rca-tab-badge');
  const sectionLbl = document.getElementById('rca-section-label');
  const groups = [
    document.getElementById('rca-group-root-cause'),
    document.getElementById('rca-group-rc-category'),
    document.getElementById('rca-group-corrective'),
  ];
  const inputs = [
    document.getElementById('form-root-cause'),
    document.getElementById('form-rc-category'),
    document.getElementById('form-corrective-actions'),
  ];
  if (banner)     banner.style.display     = required ? 'flex' : 'none';
  if (tabBadge)   tabBadge.style.display   = required ? '' : 'none';
  if (sectionLbl) sectionLbl.classList.toggle('rca-active', required);
  groups.forEach(g => { if (g) g.classList.toggle('rca-required', required); });
  inputs.forEach(el => {
    if (!el) return;
    if (required) el.setAttribute('data-rca-required', '1');
    else          el.removeAttribute('data-rca-required');
  });
}

function openNewTicket(tracker) {
  currentTracker = tracker; editingId = null;
  goStep(1);
  document.getElementById('modal-title').textContent = `New ${tracker.toUpperCase()} ticket`;
  document.getElementById('ticket-form').reset();
  const local = toLocalDT(new Date().toISOString());
  document.querySelector('[name=open_date]').value = local;
  document.querySelector('[name=occur_time]').value = local;
  populateFormDropdowns();
  goStep(1);
  _syncRcaRequired(false);
  document.getElementById('update-block').style.display='none';
  const delBtn = document.getElementById('btn-delete');
  if (delBtn) delBtn.style.display='none';
  _setTicketPanelBadge(tracker, true);
  // Suggestions tirées de l'historique + défauts (voir ticket-suggest.js).
  if (typeof TicketSuggest !== 'undefined') TicketSuggest.start(tracker);
  document.getElementById('ticket-modal').classList.add('open');
}

function openEditTicket(tracker, id) {
  currentTracker = tracker; editingId = id;
  const ticket = state[tracker].find(t => t.id === id);
  if (!ticket) return;
  if (typeof TicketSuggest !== 'undefined') TicketSuggest.stop();   // création seulement
  document.getElementById('modal-title').textContent = `Edit - ${ticket.sn_tt}`;
  populateFormDropdowns();
  const form = document.getElementById('ticket-form');
  form.reset();
  Object.keys(ticket).forEach(key => {
    const el = form.querySelector(`[name="${key}"]`);
    if (!el) return;
    if (el.type === 'datetime-local') el.value = toLocalDT(ticket[key]);
    else el.value = ticket[key] || '';
  });
  const delBtn2 = document.getElementById('btn-delete');
  if (delBtn2) delBtn2.style.display='';
  document.getElementById('update-block').style.display='';
  _syncRcaRequired(ticket.status === 'Closed');
  goStep(1);
  document.getElementById('btn-save').style.display='';
  document.getElementById('btn-next').style.display='none';
  _setTicketPanelBadge(tracker, false);
  document.getElementById('ticket-modal').classList.add('open');
}

// Updates the small eyebrow badge in the ticket side-panel header
function _setTicketPanelBadge(tracker, isNew) {
  const badge = document.getElementById('sp-tracker-badge');
  if (!badge) return;
  badge.textContent = `${tracker.toUpperCase()} · ${isNew ? 'NEW TICKET' : 'EDIT TICKET'}`;
}

function getConfiguredShifts() {
  const sites = (state.rotaConfig && state.rotaConfig.sites) || [];
  const seen = new Map();
  sites.forEach(site => (site.shifts || []).forEach(sh => {
    if (!seen.has(sh.id)) seen.set(sh.id, sh.name || sh.id);
  }));
  return [...seen.values()];
}

function populateFormDropdowns() {
  const cfg = state.config;
  const domEl = document.getElementById('form-domain');
  domEl.innerHTML = '<option value="">-</option>';
  (cfg.domains||[]).forEach(d => { const o=document.createElement('option'); o.value=d; o.textContent=d; domEl.appendChild(o); });

  ['form-fo-owner','form-assigned-to','form-modified-by'].forEach(id => {
    const el = document.getElementById(id);
    el.innerHTML = '<option value="">-</option>';
    (cfg.fo_list||[]).forEach(fo => { const o=document.createElement('option'); o.value=fo; o.textContent=fo; el.appendChild(o); });
  });

  const boEl = document.getElementById('form-bo-handling');
  if (boEl) {
    boEl.innerHTML = '<option value="">-</option>';
    (state.boList||[]).forEach(bo => {
      const o=document.createElement('option');
      o.value = bo.phone ? `${bo.name} ${bo.phone}` : bo.name;
      o.textContent = bo.phone ? `${bo.name} (${bo.phone})` : bo.name;
      boEl.appendChild(o);
    });
  }

  const sh = document.getElementById('form-shift');
  sh.innerHTML = '<option value="">-</option>';
  getConfiguredShifts().forEach(s => { const o=document.createElement('option'); o.value=s; o.textContent=s; sh.appendChild(o); });
}

const saveTicket = withSaveGuard(async function() {
  if (!requireUser('create/edit a ticket')) return;
  const form = document.getElementById('ticket-form');
  if (!form.checkValidity()) { form.reportValidity(); return; }
  const data = {};
  new FormData(form).forEach((v,k) => { data[k] = v; });

  // RCA guard: when status is Closed, root_cause, rc_category and corrective_actions are mandatory.
  if (data.status === 'Closed') {
    const missing = [];
    if (!data.root_cause?.trim())        missing.push('Root Cause');
    if (!data.rc_category?.trim())       missing.push('RC Category');
    if (!data.corrective_actions?.trim()) missing.push('Corrective Actions');
    if (missing.length) {
      // Highlight the missing fields
      const fieldMap = { 'Root Cause': 'form-root-cause', 'RC Category': 'form-rc-category', 'Corrective Actions': 'form-corrective-actions' };
      missing.forEach(label => {
        const el = document.getElementById(fieldMap[label]);
        if (el) { el.classList.add('invalid'); el.focus(); }
      });
      goStep(2);
      toast(`RCA required to close a ticket — missing fields: ${missing.join(', ')}`, 'error');
      return;
    }
    // Clear any lingering invalid state
    ['form-root-cause','form-rc-category','form-corrective-actions'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('invalid');
    });
  }

  // Duplicate guard (creation only): same Océane TT# or IMOC TT# already in this tracker.
  if (!editingId) {
    const dup = (state[currentTracker] || []).find(t =>
      (data.sn_tt && t.sn_tt && t.sn_tt.trim().toLowerCase() === data.sn_tt.trim().toLowerCase()) ||
      (data.imoc_tt && t.imoc_tt && t.imoc_tt.trim().toLowerCase() === data.imoc_tt.trim().toLowerCase())
    );
    if (dup) {
      const ref = dup.sn_tt || dup.imoc_tt;
      if (!confirm(`A ticket with reference "${ref}" already exists in this tracker (status: ${dup.status}). Create anyway?`)) return;
    }
  }

  // auto-inject identity
  if (typeof currentUser !== 'undefined' && currentUser) {
    if (!data.modified_by) data.modified_by = currentUser.name;
    data._operator_id = currentUser.employeeId || '';
  }
  ['occur_time','detection_time','open_date','close_date','workaround_date','modified_at'].forEach(f => {
    data[f] = data[f] ? new Date(data[f]).toISOString() : null;
  });
  try {
    let res;
    if (editingId) {
      res = await fetch(`${API}/api/${currentTracker}/${editingId}`, {
        method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data)
      });
    } else {
      res = await fetch(`${API}/api/${currentTracker}`, {
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data)
      });
    }
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
      throw new Error(msg);
    }
    toast(editingId ? 'Ticket updated' : 'Ticket created', 'success');
    closeModal('ticket-modal');
    await loadAll();
    renderTracker(currentTracker);
    renderDashboard();
  } catch(e) {
    console.error('saveTicket failed:', e);
    toast(`Error saving ticket: ${e.message}`, 'error');
  }
});

const deleteTicket = withSaveGuard(async function() {
  if (!requireUser('delete a ticket')) return;
  if (!editingId) return;
  if (!confirm('Delete this ticket permanently?')) return;
  await fetch(`${API}/api/${currentTracker}/${editingId}`, { method:'DELETE' });
  toast('Ticket deleted', 'success');
  closeModal('ticket-modal');
  await loadAll();
  renderTracker(currentTracker);
  renderDashboard();
});

