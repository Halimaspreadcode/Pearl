// ── SHIFT APPROVALS ───────────────────────────────────────────
// Cette page est une file de triage. Le superviseur doit décider vite, donc
// tout ce qui aide à décider (urgence, conflit, transition de shift) est
// calculé ici et rendu visible sur la carte — pas caché dans le texte libre.

const AP_TYPE = {
  swap:    { label:'Permutation', icon:'M6.99 11 3 15l3.99 4v-3H14v-2H6.99zM21 9l-3.99-4v3H10v2h7.01v3z' },
  change:  { label:'Changement',  icon:'M12 6v3l4-4-4-4v3a8 8 0 0 0-6.55 12.6l1.46-1.46A6 6 0 0 1 12 6m6.09 1.4-1.46 1.46A6 6 0 0 1 12 18v-3l-4 4 4 4v-3a8 8 0 0 0 6.09-12.6' },
  absence: { label:'Absence',     icon:'M19 3h-1V1h-2v2H8V1H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2m0 16H5V8h14zm-2.5-6.9L15.1 10.7 12 13.8l-1.4-1.4-1.4 1.4L12 16.6z' },
  onsite:  { label:'On-Site (Delivery)', icon:'M20 8h-3V4H3a2 2 0 0 0-2 2v11h2a3 3 0 0 0 6 0h6a3 3 0 0 0 6 0h2v-5zM6 18.5A1.5 1.5 0 1 1 7.5 17 1.5 1.5 0 0 1 6 18.5m12 0A1.5 1.5 0 1 1 19.5 17 1.5 1.5 0 0 1 18 18.5M17 12V9.5h2.5l1.96 2.5z' },
  other:   { label:'Autre',       icon:'M11 7h2v2h-2zm0 4h2v6h-2zm1-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20m0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16' },
};
const AP_STATUS = {
  pending:  { label:'En attente', tone:'wait', icon:'M11.99 2A10 10 0 1 0 12 22a10 10 0 0 0 0-20m.01 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16m.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z' },
  approved: { label:'Approved',  tone:'ok',   icon:'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z' },
  rejected: { label:'Rejected',    tone:'no',   icon:'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z' },
};

// Filtre actif piloté par les tuiles de la vue d'ensemble.
let _apFilter = 'pending';

// ── Décision groupée ──────────────────────────────────────────
// La pastille ronde d'une demande en attente se coche : un clic la
// sélectionne. Dès qu'une demande l'est, une barre propose de tout
// approuver ou refuser d'un coup — même fenêtre (mot de passe, motif) que
// pour une seule demande. La sélection ne garde que les demandes encore
// en attente et visibles : une décision ne porte jamais sur une carte
// qu'on ne voit pas.
const _apSel = new Set();
let _apVisiblePending = [];

function apToggleSel(id, ev) {
  if (ev) ev.stopPropagation();
  _apSel.has(id) ? _apSel.delete(id) : _apSel.add(id);
  renderShiftApprovals();
}
function apSelectAllPending() {
  _apVisiblePending.forEach(id => _apSel.add(id));
  renderShiftApprovals();
}
function apClearSel() { _apSel.clear(); renderShiftApprovals(); }
function apBatch(status) {
  const ids = [..._apSel].filter(id => _apVisiblePending.includes(id));
  if (!ids.length) return;
  _apSel.clear();
  _apOpenDecideModal(ids, status);
}

function _apRenderBatchBar() {
  const bar = document.getElementById('ap-batch');
  if (!bar) return;
  for (const id of [..._apSel]) if (!_apVisiblePending.includes(id)) _apSel.delete(id);
  const n = _apSel.size, total = _apVisiblePending.length;
  if (total < 2 && !n) { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false;
  bar.innerHTML = n
    ? `<span class="ap-batch-n"><b>${n}</b> selected</span>
       ${n < total ? `<button class="ap-batch-link" onclick="apSelectAllPending()">Select all ${total}</button>` : ''}
       <button class="ap-batch-link" onclick="apClearSel()">Clear</button>
       <span class="ap-batch-sp"></span>
       <button class="ap-act ap-act-reject" onclick="apBatch('rejected')">Refuser ${n}</button>
       <button class="ap-act ap-act-approve" onclick="apBatch('approved')">Approuver ${n}</button>`
    : `<span class="ap-batch-hint">Tip: tap the round icon of a request to select it.</span>
       <span class="ap-batch-sp"></span>
       <button class="ap-batch-link" onclick="apSelectAllPending()">Select all ${total} pending</button>`;
}

function _apDaysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d)) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}

// Une demande dont le shift tombe dans les 48 h est urgente : passé ce délai
// le planning est déjà diffusé et la décision ne sert plus à rien.
function _apIsUrgent(r) {
  if (r.status !== 'pending') return false;
  const d = _apDaysUntil(r.date);
  return d !== null && d <= 2;
}

// Deux demandes en attente sur le même FO et la même date se contredisent :
// on ne peut pas les approuver toutes les deux, il faut le signaler.
function _apConflicts(requests) {
  const seen = new Map();
  requests.forEach(r => {
    if (r.status !== 'pending') return;
    const key = `${r.fo_name}|${r.date}`;
    seen.set(key, (seen.get(key) || 0) + 1);
  });
  return seen;
}

// Le shift visé après approbation, quand la demande le précise.
function _apTargetShift(r) {
  if (r.new_shift_name || r.new_shift_id) return r.new_shift_name || r.new_shift_id;
  if (r.type === 'swap' && r.swap_with) {
    const other = (state.shiftsPlan || []).find(s => s.fo_name === r.swap_with && s.date === r.date);
    if (other) return other.shift_name || other.shift_id;
  }
  if (r.type === 'absence') return 'Repos';
  return null;
}

function _apRelative(iso) {
  if (!iso) return '';
  const t = new Date(iso);
  if (isNaN(t)) return '';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1)   return "just now";
  if (mins < 60)  return `il y a ${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 24)     return `il y a ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30)     return `il y a ${d} j`;
  return t.toLocaleDateString('en-GB');
}

function _apDateLabel(dateStr) {
  const d = _apDaysUntil(dateStr);
  const pretty = dateStr
    ? new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' })
    : '-';
  if (d === 0)  return `${pretty} · today`;
  if (d === 1)  return `${pretty} · demain`;
  if (d > 1)    return `${pretty} · in ${d} d`;
  if (d < 0)    return `${pretty} · past`;
  return pretty;
}

// Les demandes visibles : périmètre pays + recherche libre. Le filtre de
// statut n'est PAS appliqué ici, la vue d'ensemble doit compter tout le lot.
function _apScopedRequests() {
  const trackers = state.config.fo_trackers || {};
  const country  = typeof getActiveCountry === 'function' ? getActiveCountry() : 'ALL';
  const q = (document.getElementById('ap-search')?.value || '').trim().toLowerCase();

  return (state.shiftRequests || []).filter(r => {
    if (country !== 'ALL' && !personInScope(r.fo_name, country)) return false;
    if (!q) return true;
    return [r.fo_name, r.requested_by, r.date, r.note, r.swap_with,
            r.current_shift_name, r.current_shift, AP_TYPE[r.type]?.label]
      .some(v => v && String(v).toLowerCase().includes(q));
  });
}

function renderShiftApprovals() {
  const el = document.getElementById('shift-approvals-list');
  if (!el) return;

  const scoped = _apScopedRequests();
  const counts = {
    pending:  scoped.filter(r => r.status === 'pending').length,
    approved: scoped.filter(r => r.status === 'approved').length,
    rejected: scoped.filter(r => r.status === 'rejected').length,
    urgent:   scoped.filter(_apIsUrgent).length,
  };
  _apRenderOverview(counts, scoped.length);

  const sub = document.getElementById('ap-subtitle');
  if (sub) {
    // Sous une recherche, les compteurs décrivent le résultat filtré : parler
    // de « file à jour » serait faux, la file n'est simplement pas affichée.
    const q = (document.getElementById('ap-search')?.value || '').trim();
    if (q) {
      sub.textContent = `${scoped.length} result${scoped.length > 1 ? 's' : ''} for “${q}”`;
    } else {
      sub.textContent = counts.pending
        ? `${counts.pending} request${counts.pending > 1 ? 's' : ''} awaiting decision`
        : 'No pending request — the queue is up to date';
    }
  }

  const conflicts = _apConflicts(scoped);
  let list = scoped.filter(r => {
    if (_apFilter === 'all')    return true;
    if (_apFilter === 'urgent') return _apIsUrgent(r);
    return r.status === _apFilter;
  });

  const sort = document.getElementById('ap-sort')?.value || 'urgency';
  const byRecent = (a, b) => (b.created_at || '').localeCompare(a.created_at || '');
  list = list.slice().sort((a, b) => {
    if (sort === 'recent') return byRecent(a, b);
    if (sort === 'oldest') return -byRecent(a, b);
    if (sort === 'date')   return (a.date || '').localeCompare(b.date || '');
    // Priorité : en attente d'abord, puis shift le plus proche.
    const pa = a.status === 'pending' ? 0 : 1, pb = b.status === 'pending' ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const da = _apDaysUntil(a.date), db = _apDaysUntil(b.date);
    if (da !== null && db !== null && da !== db) return da - db;
    return byRecent(a, b);
  });

  _apVisiblePending = list.filter(r => r.status === 'pending').map(r => r.id);
  _apRenderBatchBar();
  if (!list.length) { el.innerHTML = _apEmptyState(); return; }

  // Regroupement par urgence uniquement en tri "Priority" : sur les autres
  // tris les en-têtes seraient dans le désordre et perdraient leur sens.
  const groupOf = r => {
    if (sort !== 'urgency' || r.status !== 'pending') return null;
    // Sous le filtre « Urgentes » toutes les cartes sont urgentes : l'en-tête
    // ne distinguerait plus rien.
    if (_apFilter === 'urgent') return null;
    const d = _apDaysUntil(r.date);
    if (d !== null && d <= 2) return 'Handle first';
    return 'En attente';
  };

  let html = '', lastGroup = null;
  list.forEach(r => {
    const g = groupOf(r);
    if (g && g !== lastGroup) { html += `<div class="ap-group">${g}</div>`; lastGroup = g; }
    html += _apCard(r, (conflicts.get(`${r.fo_name}|${r.date}`) || 0) > 1);
  });
  el.innerHTML = html;
}

function _apRenderOverview(counts, total) {
  const box = document.getElementById('ap-overview');
  if (!box) return;
  const tiles = [
    { key:'pending',  n:counts.pending,  label:'En attente', hint:'to decide',       tone:'wait' },
    { key:'urgent',   n:counts.urgent,   label:'Urgentes',   hint:'shift ≤ 48 h',    tone:'no'   },
    { key:'approved', n:counts.approved, label:'Approved', hint:'applied',      tone:'ok'   },
    { key:'rejected', n:counts.rejected, label:'Rejected',   hint:'reason recorded',tone:'no'   },
    { key:'all',      n:total,           label:'Toutes',     hint:'historique',      tone:null   },
  ];
  box.innerHTML = tiles.map(t => {
    const style = t.tone && t.n
      ? `--ap-tile-fg:var(--ap-${t.tone});--ap-tile-cont:var(--ap-${t.tone}-cont)`
      : '';
    return `<button class="ap-tile" style="${style}" aria-pressed="${_apFilter === t.key}"
      onclick="apSetFilter('${t.key}')">
      <span class="ap-tile-n">${t.n}</span>
      <span class="ap-tile-l">${t.label}</span>
      <span class="ap-tile-hint">${t.hint}</span>
    </button>`;
  }).join('');
}

function _apCard(r, hasConflict) {
  const st   = AP_STATUS[r.status] || AP_STATUS.pending;
  const type = AP_TYPE[r.type] || AP_TYPE.other;
  const isPending = r.status === 'pending';
  const urgent = _apIsUrgent(r);
  const target = _apTargetShift(r);
  const current = r.current_shift_name || r.current_shift || '—';
  const tone = urgent ? 'no' : st.tone;

  // Demande en attente : la pastille est la case de sélection (voir
  // _apSel) — cochée, elle montre une coche et la carte se souligne.
  const sel = isPending && _apSel.has(r.id);
  const pastille = isPending
    ? `<button type="button" class="ap-icon ap-icon-sel${sel ? ' is-sel' : ''}" role="checkbox" aria-checked="${sel}"
         title="${sel ? 'Deselect' : 'Select'}" aria-label="Select ${esc(r.fo_name)}'s request"
         onclick="apToggleSel('${r.id}',event)"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${sel ? AP_STATUS.approved.icon : type.icon}"/></svg></button>`
    : `<div class="ap-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${st.icon}"/></svg></div>`;
  return `<div class="ap-card ${isPending ? '' : 'is-done'}${sel ? ' is-sel' : ''}"
    style="--ap-c-fg:var(--ap-${tone});--ap-c-cont:var(--ap-${tone}-cont)">
    ${pastille}
    <div class="ap-main">
      <div class="ap-line1">
        <span class="ap-who">${esc(r.fo_name)}</span>
        <span class="ap-chip ap-chip-state">${st.label}</span>
        <span class="ap-chip">${type.label}</span>
        ${urgent ? '<span class="ap-chip ap-chip-urgent">Urgent</span>' : ''}
        ${hasConflict ? '<span class="ap-chip ap-chip-conflict">Conflit</span>' : ''}
      </div>
      <div class="ap-line2">
        <span class="ap-date">${_apDateLabel(r.date)}</span>
        <span class="ap-dot">·</span>
        <span class="ap-shift">${esc(current)}</span>
        ${target ? `<span class="ap-arrow"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M10 17l5-5-5-5v10z"/></svg></span>
                    <span class="ap-shift is-target">${esc(target)}</span>` : ''}
        ${r.swap_with ? `<span class="ap-dot">·</span><span>avec <b>${esc(r.swap_with)}</b></span>` : ''}
      </div>
      ${r.note ? `<div class="ap-note">${esc(r.note)}</div>` : ''}
      <div class="ap-meta">Requested by <b>${esc(r.requested_by || '—')}</b> · ${_apRelative(r.created_at)}</div>
      ${!isPending ? `<div class="ap-verdict">
        ${st.label}${r.approved_by ? ` by <b>${esc(r.approved_by)}</b>` : ''}${r.updated_at ? ` · ${_apRelative(r.updated_at)}` : ''}
        ${r.rejection_reason ? `<br>Reason: ${esc(r.rejection_reason)}` : ''}
      </div>` : ''}
    </div>
    <div class="ap-actions">
      ${isPending ? `
        <button class="ap-act ap-act-reject" onclick="rejectShiftRequest('${r.id}')">Refuser</button>
        <button class="ap-act ap-act-approve" onclick="approveShiftRequest('${r.id}')">Approuver</button>
      ` : `
        <button class="ap-act ap-act-icon" title="Delete request"
                aria-label="Delete ${esc(r.fo_name)}'s request"
                onclick="apDeleteRequest('${r.id}')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z"/></svg>
        </button>
      `}
    </div>
  </div>`;
}

function _apEmptyState() {
  const M = {
    pending:  ['Queue up to date', 'No pending request. New requests will appear here.'],
    urgent:   ['Rien d’urgent', 'No request whose shift falls within the next 48 hours.'],
    approved: ['No approval', 'Approved requests will appear here with their author.'],
    rejected: ['No rejection', 'Rejected requests will appear here with their reason.'],
    all:      ['No request', 'FOs can create them from the Shift Planning page.'],
  };
  const q = (document.getElementById('ap-search')?.value || '').trim();
  const [t, s] = q ? ['No result', `No request matches “${q}”.`]
                   : (M[_apFilter] || M.all);
  return `<div class="ap-empty">
    <div class="ap-empty-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></div>
    <div class="ap-empty-t">${esc(t)}</div>
    <div class="ap-empty-s">${esc(s)}</div>
  </div>`;
}

function apSetFilter(key) {
  _apFilter = key;
  renderShiftApprovals();
}

