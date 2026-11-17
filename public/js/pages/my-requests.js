/* ══════════════════════════════════════════════════════════════
   MES DEMANDES — soumission FO
   La contrepartie publique d'Approbations. Le FO consulte et crée ;
   il ne décide pas. Aucune fonction de ce bloc n'écrit `status` :
   la décision passe uniquement par le dialogue admin, qui exige le
   mot de passe d'approbation côté serveur.
   ══════════════════════════════════════════════════════════════ */

// Identité mémorisée : un FO revient sur sa propre file, ne pas la
// lui faire re-sélectionner à chaque visite.
const MR_WHO_KEY = 'mr-who';

function _mrWho() {
  return document.getElementById('mr-who')?.value || localStorage.getItem(MR_WHO_KEY) || '';
}

// Demandes de l'agent choisi. Sans sélection, on montre tout : un
// écran vide au premier passage donnerait l'impression d'un bug.
function _mrRequests() {
  const who = _mrWho();
  const all = state.shiftRequests || [];
  const mine = who ? all.filter(r => r.fo_name === who || r.requested_by === who) : all;
  return [...mine].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

function renderMyRequests() {
  const sel = document.getElementById('mr-who');
  if (!sel) return;

  // Le sélecteur se peuple une fois : le reconstruire à chaque rendu
  // écraserait le choix courant au retour de loadAll().
  if (!sel.options.length) {
    // Default to the signed-in agent, so the page opens on their own file.
    const saved = _mrqDefaultAgent();
    sel.innerHTML = '<option value="">All agents</option>' +
      (state.config.fo_list || []).map(fo =>
        `<option value="${esc(fo)}"${fo === saved ? ' selected' : ''}>${esc(fo)}</option>`).join('');
  }
  localStorage.setItem(MR_WHO_KEY, sel.value);

  const list = _mrRequests();
  const n = s => list.filter(r => r.status === s).length;

  const kpis = document.getElementById('mr-kpis');
  if (kpis) {
    kpis.innerHTML = [
      ['Pending',  n('pending')],
      ['Approved', n('approved')],
      ['Rejected', n('rejected')],
    ].map(([lbl, v]) => `
      <div class="mr-kpi">
        <div class="mr-kpi-lbl">${lbl}</div>
        <div class="mr-kpi-val">${v}</div>
      </div>`).join('');
  }

  const el = document.getElementById('mr-list');
  if (!el) return;
  el.innerHTML = list.length
    ? list.map(_mrCard).join('')
    : `<div class="mr-empty">
         <div class="mr-empty-t">No requests yet</div>
         <div>Use “New request” to submit one.</div>
       </div>`;

  // Badge de la sidebar : ce qui est encore en attente pour cet agent.
  const badge = document.getElementById('myreq-badge');
  if (badge) {
    const p = n('pending');
    badge.textContent = p;
    badge.style.display = p ? '' : 'none';
  }
}

const MR_STATE = {
  pending:  { cls:'is-pending',  label:'Pending'  },
  approved: { cls:'is-approved', label:'Approved' },
  rejected: { cls:'is-rejected', label:'Rejected' },
};

function _mrCard(r) {
  const st   = MR_STATE[r.status] || MR_STATE.pending;
  const type = (typeof AP_TYPE !== 'undefined' && AP_TYPE[r.type]) || { label: r.type || 'Autre' };
  const cur  = r.current_shift_name || r.current_shift || '—';
  const tgt  = typeof _apTargetShift === 'function' ? _apTargetShift(r) : null;

  return `<div class="mr-card">
    <div class="mr-card-main">
      <div class="mr-l1">
        <span class="mr-who">${esc(r.fo_name || '—')}</span>
        <span class="mr-chip ${st.cls}">${st.label}</span>
        <span class="mr-chip">${esc(type.label)}</span>
      </div>
      <div class="mr-l2">
        <span>${typeof _apDateLabel === 'function' ? _apDateLabel(r.date) : esc(r.date || '—')}</span>
        <span>·</span>
        <span>${esc(cur)}</span>
        ${tgt ? `<span>→</span><span>${esc(tgt)}</span>` : ''}
        ${r.swap_with ? `<span>·</span><span>avec <b>${esc(r.swap_with)}</b></span>` : ''}
      </div>
      ${r.note ? `<div class="mr-note">${esc(r.note)}</div>` : ''}
      <div class="mr-meta">Submitted by <b>${esc(r.requested_by || '—')}</b>${
        r.created_at && typeof _apRelative === 'function' ? ` · ${_apRelative(r.created_at)}` : ''}</div>
      ${r.status && r.status !== 'pending' ? `<div class="mr-verdict">
        ${st.label}${r.approved_by ? ` by <b>${esc(r.approved_by)}</b>` : ''}
        ${r.rejection_reason ? `<br>Reason: ${esc(r.rejection_reason)}` : ''}
      </div>` : ''}
    </div>
  </div>`;
}

/* ── New-request form ───────────────────────────────────────────
   Standalone submission: the original modal starts from a planning
   cell (openEditShift) and inherits its shift. Here there is no cell,
   so the form resolves the roster itself from agent + date.

   The form is built to need as little input as possible: identity
   comes from the signed-in user, the date defaults to the next shift
   worth changing, and the reason offers one-tap presets. */

const MRQ_TYPES = [
  { v:'swap',    label:'Swap',       hint:'Trade with a colleague' },
  { v:'change',  label:'Change',     hint:'Move to another shift'  },
  { v:'absence', label:'Absence',    hint:'Leave or time off'      },
  { v:'onsite',  label:'On-Site',    hint:'Delivery at customer'   },
  { v:'other',   label:'Other',      hint:'Anything else'          },
];

// Reason presets per type. They fill the textarea but never lock it —
// an approver reads free text, so the field stays editable.
const MRQ_REASONS = {
  swap:    ['Personal commitment', 'Family reasons', 'Medical appointment', 'Agreed with colleague'],
  change:  ['Transport constraint', 'Personal commitment', 'Workload balance', 'Training'],
  absence: ['Annual leave', 'Sick leave', 'Family event', 'Medical appointment'],
  onsite:  ['Customer site intervention', 'Delivery support', 'Field survey', 'Installation'],
  other:   ['Personal commitment', 'Administrative'],
};

let _mrqShift    = null;   // roster row the request attaches to
let _mrqIdentity = '';     // agent the request is filed for

// Signed-in identity if it matches a known FO; otherwise the last
// picked agent. Falls back to empty, which reveals the picker.
function _mrqDefaultAgent() {
  const list = state.config.fo_list || [];
  const me = (typeof currentUser !== 'undefined' && currentUser?.name) || '';
  if (me && list.includes(me)) return me;

  /* The roster is "Firstname LASTNAME"; a profile name is typed by hand
     and drifts — case, accents, extra spaces, or the parts reversed
     ("NDIAYE Mamadou"). Compare on a sorted bag of normalised words so
     all of those still resolve to the same agent. */
  const norm = s => String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim().replace(/\s+/g, ' ');
  const key = s => norm(s).split(' ').filter(Boolean).sort().join(' ');

  const meKey = key(me);
  if (meKey) {
    const hit = list.find(f => key(f) === meKey);
    if (hit) return hit;
  }

  const saved = localStorage.getItem(MR_WHO_KEY) || '';
  if (saved && list.includes(saved)) return saved;
  return '';
}

// The next scheduled working day for this agent — the date a request is
// most likely about. Falls back to today when nothing is planned.
function _mrqDefaultDate(agent) {
  const today = new Date().toISOString().slice(0, 10);
  if (!agent) return today;
  const next = (state.shiftsPlan || [])
    .filter(s => s.fo_name === agent && !s.is_rest && s.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  return next ? next.date : today;
}

function openMyRequestModal() {
  const modal = document.getElementById('my-request-modal');
  if (!modal) return;

  _mrqIdentity = _mrqDefaultAgent();

  const foSel = document.getElementById('mrq-fo');
  foSel.innerHTML = '<option value="">- Select -</option>' +
    (state.config.fo_list || []).map(fo =>
      `<option value="${esc(fo)}"${fo === _mrqIdentity ? ' selected' : ''}>${esc(fo)}</option>`).join('');

  // No resolvable identity: no point showing a banner naming nobody.
  document.getElementById('mrq-fo-group').style.display  = _mrqIdentity ? 'none' : '';
  document.getElementById('mrq-id-banner').style.display = _mrqIdentity ? '' : 'none';
  _mrqPaintIdentity();

  document.getElementById('mrq-type').value = 'swap';
  document.getElementById('mrq-note').value = '';
  document.getElementById('mrq-date').value = _mrqDefaultDate(_mrqIdentity);
  document.getElementById('mrq-date-to').value = '';

  _mrqRenderTypes();
  _mrqRenderQuickDates();
  mrqSyncFields();

  document.getElementById('mrq-date').onchange = () => { _mrqRenderQuickDates(); mrqRenderContext(); };

  modal.classList.add('open');
}

function _mrqPaintIdentity() {
  const name = _mrqIdentity || '—';
  const el = document.getElementById('mrq-id-name');
  if (el) el.textContent = name;
  const av = document.getElementById('mrq-id-av');
  if (av) {
    av.textContent = name === '—' ? '?' : name.split(/\s+/).filter(Boolean)
      .slice(0, 2).map(w => w[0].toUpperCase()).join('');
  }
}

// Reveals the picker when the prefilled identity is not the right one.
function mrqToggleIdentity() {
  const g = document.getElementById('mrq-fo-group');
  const shown = g.style.display !== 'none';
  g.style.display = shown ? 'none' : '';
  if (!shown) document.getElementById('mrq-fo').focus();
}

function mrqOnIdentityPick() {
  _mrqIdentity = document.getElementById('mrq-fo').value;
  localStorage.setItem(MR_WHO_KEY, _mrqIdentity);
  _mrqPaintIdentity();
  document.getElementById('mrq-id-banner').style.display = _mrqIdentity ? '' : 'none';
  // A new agent means a different roster, so the date default is stale.
  document.getElementById('mrq-date').value = _mrqDefaultDate(_mrqIdentity);
  _mrqRenderQuickDates();
  mrqSyncFields();
}

function _mrqRenderTypes() {
  const el = document.getElementById('mrq-types');
  if (!el) return;
  const cur = document.getElementById('mrq-type').value;
  el.innerHTML = MRQ_TYPES.map(t => `
    <button type="button" class="mrq-type${t.v === cur ? ' is-on' : ''}"
            onclick="mrqPickType('${t.v}')" title="${esc(t.hint)}">
      ${esc(t.label)}
    </button>`).join('');
}

function mrqPickType(v) {
  document.getElementById('mrq-type').value = v;
  _mrqRenderTypes();
  mrqSyncFields();
}

// Next few working days for this agent, so the common case is one tap.
function _mrqRenderQuickDates() {
  const el = document.getElementById('mrq-quick');
  if (!el) return;
  const today = new Date().toISOString().slice(0, 10);
  const cur   = document.getElementById('mrq-date').value;
  const days  = (state.shiftsPlan || [])
    .filter(s => s.fo_name === _mrqIdentity && !s.is_rest && s.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 4);

  if (!days.length) { el.innerHTML = ''; return; }
  el.innerHTML = days.map(s => `
    <button type="button" class="mrq-chip${s.date === cur ? ' is-on' : ''}"
            onclick="mrqPickDate('${s.date}')">
      ${esc(_absFmtDay ? _absFmtDay(s.date) : s.date)}
      <small>${esc(s.shift_name || s.shift_id || '')}</small>
    </button>`).join('');
}

function mrqPickDate(d) {
  document.getElementById('mrq-date').value = d;
  _mrqRenderQuickDates();
  mrqRenderContext();
}

// Shows/hides the fields that only apply to certain types, repopulates
// their options, and refreshes the presets and the context banner.
function mrqSyncFields() {
  const t = document.getElementById('mrq-type').value;
  document.getElementById('mrq-swap-group').style.display   = t === 'swap'   ? '' : 'none';
  document.getElementById('mrq-target-group').style.display = t === 'change' ? '' : 'none';
  // Absence and on-site can span several days; the others are one shift.
  document.getElementById('mrq-range-group').style.display =
    (t === 'absence' || t === 'onsite') ? '' : 'none';

  const date = document.getElementById('mrq-date').value;
  const swapSel = document.getElementById('mrq-swap-with');
  const prev = swapSel.value;
  // Only colleagues actually rostered that day can take the swap —
  // offering the whole list invites requests that cannot be approved.
  const sameDay = (state.shiftsPlan || [])
    .filter(s => s.date === date && s.fo_name !== _mrqIdentity && !s.is_rest);
  swapSel.innerHTML = '<option value="">- Select -</option>' + (
    sameDay.length
      ? sameDay.map(s =>
          `<option value="${esc(s.fo_name)}">${esc(s.fo_name)} — ${esc(s.shift_name || s.shift_id || '')}</option>`).join('')
      : (state.config.fo_list || []).filter(f => f !== _mrqIdentity)
          .map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('')
  );
  if (prev) swapSel.value = prev;

  const tgtSel = document.getElementById('mrq-target-shift');
  const prevT = tgtSel.value;
  const shifts = typeof getConfiguredShifts === 'function' ? getConfiguredShifts() : [];
  tgtSel.innerHTML = '<option value="">- Select -</option>' +
    shifts.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('') +
    '<option value="rest">Rest day</option>';
  if (prevT) tgtSel.value = prevT;

  _mrqRenderReasons();
  mrqRenderContext();
}

function _mrqRenderReasons() {
  const el = document.getElementById('mrq-reason-chips');
  if (!el) return;
  const t = document.getElementById('mrq-type').value;
  el.innerHTML = (MRQ_REASONS[t] || []).map(r =>
    `<button type="button" class="mrq-chip" onclick="mrqPickReason(this)">${esc(r)}</button>`).join('');
}

// Presets fill the field rather than replace typing already in progress.
function mrqPickReason(btn) {
  const ta = document.getElementById('mrq-note');
  const val = btn.textContent.trim();
  ta.value = ta.value.trim() ? `${ta.value.trim()} — ${val}` : val;
  ta.focus();
}

/* Context banner: resolves the roster row and warns about anything that
   would make the request unapprovable — no shift that day, a rest day,
   or a date already gone. Better said here than discovered by an
   approver three days later. */
function mrqRenderContext() {
  const info = document.getElementById('mrq-current');
  if (!info) return;
  const date = document.getElementById('mrq-date').value;
  const type = document.getElementById('mrq-type').value;
  const hit  = (state.shiftsPlan || []).find(s => s.fo_name === _mrqIdentity && s.date === date);
  _mrqShift = hit || null;

  if (!_mrqIdentity || !date) {
    info.className = 'mrq-ctx';
    info.textContent = 'Select an agent and a date.';
    return;
  }

  const bits = [];
  let tone = '';
  if (hit) {
    bits.push(`Current shift: <b>${esc(hit.is_rest ? 'Rest' : (hit.shift_name || hit.shift_id || '—'))}</b>`);
    if (hit.is_rest && type === 'swap') {
      tone = 'is-warn';
      bits.push('You are on a rest day — a swap may not apply.');
    }
  } else {
    tone = 'is-warn';
    bits.push('No shift scheduled that day — the request will not be linked to the roster.');
  }

  const today = new Date().toISOString().slice(0, 10);
  if (date < today) { tone = 'is-warn'; bits.push('This date is in the past.'); }

  const swap = document.getElementById('mrq-swap-with').value;
  if (type === 'swap' && swap) {
    const other = (state.shiftsPlan || []).find(s => s.fo_name === swap && s.date === date);
    bits.push(other
      ? `${esc(swap)}: <b>${esc(other.is_rest ? 'Rest' : (other.shift_name || other.shift_id || '—'))}</b>`
      : `${esc(swap)} has no shift that day.`);
  }
  if (type === 'change') {
    const tgt = document.getElementById('mrq-target-shift').value;
    if (tgt) bits.push(`Requested: <b>${esc(tgt === 'rest' ? 'Rest day' : tgt)}</b>`);
  }

  info.className = 'mrq-ctx' + (tone ? ' ' + tone : '');
  info.innerHTML = bits.join('<br>');
}

async function submitMyRequest() {
  const date   = document.getElementById('mrq-date').value;
  const dateTo = document.getElementById('mrq-date-to').value;
  const type   = document.getElementById('mrq-type').value;
  const note   = document.getElementById('mrq-note').value.trim();
  const swap   = document.getElementById('mrq-swap-with').value;
  const target = document.getElementById('mrq-target-shift').value;

  if (!_mrqIdentity) { toast('Select who the request is for', 'error'); mrqToggleIdentity(); return; }
  if (!date)   { toast('Pick a date', 'error'); return; }
  if (!note)   { toast('Add a reason', 'error'); document.getElementById('mrq-note').focus(); return; }
  if (type === 'swap'   && !swap)   { toast('Choose the colleague to swap with', 'error'); return; }
  if (type === 'change' && !target) { toast('Choose the requested shift', 'error'); return; }
  if (dateTo && dateTo < date) { toast('The end date precedes the start date', 'error'); return; }

  const s = _mrqShift;
  const payload = {
    shift_entry_id: s ? s.id : null,
    fo_name:        _mrqIdentity,
    date,
    date_to:        dateTo || null,
    current_shift:      s ? s.shift_id : null,
    current_shift_name: s ? (s.shift_name || s.shift_id) : null,
    requested_by:   _mrqIdentity,
    type,
    swap_with:      type === 'swap' ? swap : null,
    note,
    status:         'pending',
  };
  if (type === 'change') {
    payload.new_shift_id   = target;
    payload.new_shift_name = target === 'rest' ? 'Rest' : target;
    payload.new_shift_type = target;
  }

  const btn = document.getElementById('mrq-submit');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    const res = await fetch(`${API}/api/shift-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('http');
    localStorage.setItem(MR_WHO_KEY, _mrqIdentity);
    toast('Request sent — pending approval', 'success');
    closeModal('my-request-modal');
    await loadAll();
    renderMyRequests();
  } catch (e) {
    toast('Could not send the request', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Send request'; }
  }
}

// ── Décision : un seul dialogue, ouvert depuis les boutons de la carte ──
let _apPending = null;   // { ids:[], status:'approved'|'rejected' }

function _apOpenDecideModal(ids, status) {
  const all = state.shiftRequests || [];
  const items = ids.map(id => all.find(r => r.id === id)).filter(Boolean);
  if (!items.length) return;
  _apPending = { ids: items.map(r => r.id), status };

  const approving = status === 'approved';
  document.getElementById('ap-decide-title').textContent =
    approving
      ? (items.length > 1 ? `Approuver ${items.length} demandes` : 'Approve request')
      : (items.length > 1 ? `Refuser ${items.length} demandes`   : 'Reject request');
  document.getElementById('ap-decide-confirm').textContent = approving ? 'Approuver' : 'Refuser';
  document.getElementById('ap-decide-reason-group').style.display = approving ? 'none' : '';

  const recap = document.getElementById('ap-decide-recap');
  recap.innerHTML = items.slice(0, 5).map(r => {
    const target = _apTargetShift(r);
    return `<div><b>${esc(r.fo_name)}</b> · ${_apDateLabel(r.date)} · ${esc(r.current_shift_name || r.current_shift || '—')}${target ? ` → ${esc(target)}` : ''}</div>`;
  }).join('') + (items.length > 5 ? `<div>+ ${items.length - 5} autre(s)…</div>` : '')
    + (approving ? `<div style="margin-top:4px;opacity:.75">Approving applies the change to the rota.</div>` : '');

  document.getElementById('ap-decide-reason').value = '';
  document.getElementById('ap-decide-password').value = '';
  document.getElementById('ap-decide-modal').classList.add('open');
  // Le nom de l'approbateur est stable d'une session à l'autre : on le
  // préremplit pour ne pas le retaper à chaque décision.
  const who = document.getElementById('ap-decide-approver');
  who.value = localStorage.getItem('ap-approver') || '';
  setTimeout(() => (who.value ? document.getElementById('ap-decide-password') : who).focus(), 60);
}

async function apConfirmDecision() {
  if (!_apPending) return;
  const { ids, status } = _apPending;
  const approver = document.getElementById('ap-decide-approver').value.trim();
  const password = document.getElementById('ap-decide-password').value;
  const reason   = document.getElementById('ap-decide-reason').value.trim();

  if (!approver) { toast('Please enter your name', 'error'); return; }
  if (status === 'rejected' && !reason) { toast('Please enter a rejection reason', 'error'); return; }
  if (!password) { toast('Password required', 'error'); return; }

  const btn = document.getElementById('ap-decide-confirm');
  btn.disabled = true;
  try {
    const body = status === 'approved'
      ? { status, approved_by: approver }
      : { status, approved_by: approver, rejection_reason: reason };

    let ok = 0, bad = 0, denied = false;
    for (const id of ids) {
      const res = await fetch(`${API}/api/shift-requests/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, password }),
      });
      if (res.status === 403) { denied = true; break; }
      res.ok ? ok++ : bad++;
    }

    if (denied) { toast('Incorrect password', 'error'); return; }
    localStorage.setItem('ap-approver', approver);
    closeModal('ap-decide-modal');
    _apPending = null;

    const verb = status === 'approved' ? 'approved' : 'rejected';
    if (bad) toast(`${ok} ${verb}${ok > 1 ? 's' : ''}, ${bad} failed`, 'error');
    else     toast(`${ok} demande${ok > 1 ? 's' : ''} ${verb}${ok > 1 ? 's' : ''}`, 'success');

    await loadAll();
    renderShiftApprovals();
    if (document.getElementById('page-shift-planning')?.classList.contains('active')) {
      renderShiftPlanning();
    }
  } catch (e) {
    toast('Error while saving', 'error');
  } finally {
    btn.disabled = false;
  }
}

function approveShiftRequest(id) { _apOpenDecideModal([id], 'approved'); }
function rejectShiftRequest(id)  { _apOpenDecideModal([id], 'rejected'); }

async function apDeleteRequest(id) {
  if (!confirm('Permanently delete this request from the history?')) return;
  try {
    await fetch(`${API}/api/shift-requests/${id}`, { method: 'DELETE' });
    toast('Request deleted', 'success');
    await loadAll();
    renderShiftApprovals();
  } catch (e) {
    toast('Error while deleting', 'error');
  }
}

