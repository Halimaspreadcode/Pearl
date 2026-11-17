// ── OBSERVATIONS ─────────────────────────────────────────────
function renderObservations() {
  const sf   = document.getElementById('obs-filter-status')?.value   || '';
  const spri = document.getElementById('obs-filter-priority')?.value || '';
  const ssrc = document.getElementById('obs-filter-source')?.value   || '';
  const sq   = (document.getElementById('obs-search')?.value || '').toLowerCase().trim();

  let obs = [...state.observations].sort((a, b) => new Date(b.date||0) - new Date(a.date||0));
  if (sf)   obs = obs.filter(o => o.status   === sf);
  if (spri) obs = obs.filter(o => o.priority === spri);
  if (ssrc) obs = obs.filter(o => o.source   === ssrc);
  if (sq)   obs = obs.filter(o =>
    (o.observation||'').toLowerCase().includes(sq) ||
    (o.impact||'').toLowerCase().includes(sq) ||
    (o.proposed_solution||'').toLowerCase().includes(sq) ||
    (o.author||'').toLowerCase().includes(sq) ||
    (o.tracker_tt||'').toLowerCase().includes(sq)
  );

  // Nombre par statut, avec les autres filtres appliqués : on voit ce que
  // chaque onglet contient avant d'y aller.
  const base = [...state.observations].filter(o =>
    (!spri || o.priority === spri) && (!ssrc || o.source === ssrc));
  const nOf = st => base.filter(o => !st || o.status === st).length;
  [['Open', 'Open'], ['In Progress', 'In Progress'], ['Closed', 'Closed'], ['all', '']].forEach(([id, st]) => {
    const n = document.getElementById('gobs-n-' + id);
    if (n) n.textContent = nOf(st);
  });

  const countEl = document.getElementById('obs-count');
  if (countEl) countEl.textContent = obs.length + ' observation' + (obs.length !== 1 ? 's' : '');

  // Reflet de l'état des filtres sur le segmenté et la recherche.
  document.querySelectorAll('.gobs-seg-btn').forEach(b =>
    b.setAttribute('aria-pressed', String(b.getAttribute('data-status') === sf)));
  document.getElementById('gobs-search-wrap')?.classList.toggle('has-value', !!sq);

  const el = document.getElementById('obs-list');
  if (!el) return;
  if (!obs.length) {
    const filtered = sf || spri || ssrc || sq;
    el.innerHTML = `<div class="gobs-empty">
      <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
      <div class="gobs-empty-t">${filtered ? 'No observation matches' : 'No observation'}</div>
      <div class="gobs-empty-d">${filtered
        ? 'Widen the filters or clear the search.'
        : 'Observations logged by the team will appear here.'}</div>
    </div>`;
    return;
  }

  // La priorité porte la couleur de la carte : c'est la seule dimension
  // qui doit accrocher l'œil dans une liste longue.
  const PRIO_TONE = { Critical:'crit', High:'high', Medium:'med', Low:'low' };

  const fmtDate = v => v
    ? new Date(v).toLocaleDateString('en-GB', { day:'2-digit', month:'short' })
      + ' · ' + new Date(v).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' })
    : null;

  const rows = obs.map(o => {
    const isClosed = o.status === 'Closed';
    const tone     = PRIO_TONE[o.priority] || 'none';
    const dateStr  = fmtDate(o.date) || '—';
    const closedAt = fmtDate(o.closed_at);

    const details = [
      o.impact && ['Impact', o.impact],
      o.proposed_solution && ['Solution', o.proposed_solution],
    ].filter(Boolean).map(([k, v]) =>
      `<div class="gobs-detail"><span class="gobs-detail-k">${k}</span><span class="gobs-detail-v">${esc(v)}</span></div>`
    ).join('');

    return `<article class="gobs-card t-${tone}${isClosed ? ' is-closed' : ''}">
      <div class="gobs-card-main">
        <div class="gobs-card-top">
          ${o.priority ? `<span class="gobs-prio">${esc(o.priority)}</span>` : ''}
          ${o.source ? `<span class="gobs-src s-${esc(o.source).toLowerCase()}">${esc(o.source)}</span>` : ''}
          ${o.tracker_tt ? `<span class="gobs-tt">${esc(o.tracker_tt)}</span>` : ''}
          ${isClosed ? `<span class="gobs-state">Closed${closedAt ? ` · ${closedAt}` : ''}</span>`
            : o.status === 'In Progress' ? '<span class="gobs-state is-wip">In progress</span>' : ''}
        </div>

        <p class="gobs-text">${esc(o.observation || '—')}</p>
        ${details ? `<div class="gobs-details">${details}</div>` : ''}

        <div class="gobs-card-foot">
          ${o.author ? `<span class="gobs-author">
            <span class="gobs-author-av" style="background:${esc(foAvatarColor(o.author))}">${esc(foInitials(o.author))}</span>
            ${esc(o.author)}</span>` : ''}
          <span class="gobs-date">${dateStr}</span>
        </div>
      </div>

      <div class="gobs-actions">
        ${o.status === 'Open' ? `<button class="gobs-act" onclick="obsSetProgress(${escAttrArg(o.id)})" title="Mark as in progress">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5v14l11-7z"/></svg>
        </button>` : ''}
        ${!isClosed ? `<button class="gobs-act" onclick="closeObs(${escAttrArg(o.id)})" title="Mark as closed">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
        </button>` : ''}
        <button class="gobs-act is-danger" onclick="deleteObs(${escAttrArg(o.id)})" title="Delete">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
        </button>
      </div>
    </article>`;
  }).join('');

  el.innerHTML = `<div class="gobs-list">${rows}</div>`;
}

// Le segmenté pilote le <select> masqué que renderObservations() lit.
function obsSetStatus(v) {
  const sel = document.getElementById('obs-filter-status');
  if (sel) sel.value = v;
  renderObservations();
}
function obsClearSearch() {
  const inp = document.getElementById('obs-search');
  if (inp) { inp.value = ''; inp.focus(); }
  renderObservations();
}

function openNewObs() {
  document.getElementById('obs-form').reset();
  const authorSel = document.getElementById('obs-author-select');
  if (authorSel) {
    authorSel.innerHTML = '<option value="">-</option>';
    (state.config.fo_list||[]).forEach(fo => {
      const o = document.createElement('option'); o.value=fo; o.textContent=fo; authorSel.appendChild(o);
    });
    if (typeof currentUser !== 'undefined' && currentUser?.name) authorSel.value = currentUser.name;
  }
  document.getElementById('obs-modal').classList.add('open');
}
async function saveObs() {
  if (!requireUser('add an observation')) return;
  const form = document.getElementById('obs-form');
  if (!form.checkValidity()) { form.reportValidity(); return; }
  const data = {}; new FormData(form).forEach((v,k) => { data[k]=v; }); data.date = new Date().toISOString();
  await fetch(`${API}/api/observations`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
  toast('Observation added', 'success'); closeModal('obs-modal'); await loadAll(); renderObservations();
}
async function obsSetProgress(id) {
  await fetch(`${API}/api/observations/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({status:'In Progress'}) });
  await loadAll(); renderObservations();
}
async function closeObs(id) {
  await fetch(`${API}/api/observations/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({status:'Closed'}) });
  await loadAll(); renderObservations();
}
async function deleteObs(id) {
  if (!confirm('Delete this observation?')) return;
  await fetch(`${API}/api/observations/${id}`, { method:'DELETE' });
  await loadAll(); renderObservations();
}

