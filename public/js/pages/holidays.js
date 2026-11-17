// ── HOLIDAYS ──────────────────────────────────────────────────
// Ces dates pilotent le décompte des jours ouvrés (absences, SLA en mode
// business). Elles doivent donc être corrigeables : un férié se déplace
// par décret, un pont s'ajoute, une date lunaire se précise tard.
let _holYear = null;      // onglet d'année actif (null = tout)
let _holEditing = null;   // id de la ligne en cours d'édition

function openHolidaysModal() {
  // On ouvre sur l'année courante : c'est celle qu'on vient corriger.
  const years = _holYears();
  const now = String(new Date().getFullYear());
  _holYear = years.includes(now) ? now : (years[0] || null);
  _holEditing = null;
  renderHolidaysList();
  document.getElementById('holidays-modal').classList.add('open');
}

function _holYears() {
  return [...new Set((state.holidays || [])
    .map(h => String(h.date || '').slice(0, 4)).filter(Boolean))].sort();
}

const HOL_COUNTRY_LABEL = new Proxy({}, { get: (_, c) => (typeof c === 'string' ? siteName(c) : undefined) });

function renderHolidaysList() {
  const el = document.getElementById('holidays-list');
  if (!el) return;

  // Onglets d'année : 36 fériés sur trois ans se parcourent mal d'un bloc.
  const years = _holYears();
  const tabs = document.getElementById('hol-year-tabs');
  if (tabs) {
    tabs.innerHTML = [
      `<button class="hol-yr ${_holYear === null ? 'active' : ''}" onclick="holSetYear(null)">Tout</button>`,
      ...years.map(y =>
        `<button class="hol-yr ${_holYear === y ? 'active' : ''}" onclick="holSetYear('${y}')">${y}</button>`),
    ].join('');
  }

  const all = [...(state.holidays || [])]
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const list = _holYear ? all.filter(h => String(h.date || '').startsWith(_holYear)) : all;

  const countEl = document.getElementById('hol-count');
  if (countEl) countEl.textContent = list.length
    ? `${list.length} public holiday${list.length > 1 ? 's' : ''}`
    : '';

  if (!list.length) {
    el.innerHTML = '<div class="hol-empty">No public holiday for this period.</div>';
    return;
  }

  const todayISO = new Date().toISOString().slice(0, 10);
  el.innerHTML = list.map(h => {
    if (_holEditing === h.id) return _holEditRow(h);

    const d = h.date ? new Date(h.date + 'T00:00:00') : null;
    const day = d ? String(d.getDate()).padStart(2, '0') : '--';
    const mon = d ? d.toLocaleDateString('en-GB', { month: 'short' }).replace('.', '') : '--';
    const wd  = d ? d.toLocaleDateString('en-GB', { weekday: 'long' }) : '';
    const cc  = String(h.country || '').toUpperCase();
    const tag = cc
      ? `<span class="hol-tag ${cc.toLowerCase()}">${HOL_COUNTRY_LABEL[cc] || cc}</span>`
      : '<span class="hol-tag">Both sites</span>';
    /* Les fêtes lunaires (Korité, Tabaski, Maouloud, Tamkharit, Magal)
       dépendent de l'observation de la lune : la date n'est arrêtée que
       quelques jours avant. On le signale plutôt que de laisser croire à
       une date certaine, puisque ces jours pilotent le décompte des
       jours ouvrés. */
    const tc = h.to_confirm
      ? '<span class="hol-tag warn" title="Lunar date: to be confirmed nearer the time">to confirm</span>'
      : '';
    // Un férié passé reste utile (il a compté dans les décomptes) mais
    // n'appelle plus d'action : on le met en retrait sans le cacher.
    const past = h.date && h.date < todayISO ? ' hol-past' : '';

    return `<div class="hol-row${past}">
      <div class="hol-cal"><div class="hol-cal-d">${day}</div><div class="hol-cal-m">${mon}</div></div>
      <div class="hol-main">
        <div class="hol-name">${esc(h.name || '-')}</div>
        <div class="hol-meta">${esc(wd)}${d ? ' ' + d.getFullYear() : ''} ${tag}${tc}</div>
      </div>
      <div class="hol-actions">
        <button class="hol-ico" title="Edit" aria-label="Edit ${esc(h.name || '')}"
                onclick="holEdit('${h.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
        </button>
        <button class="hol-ico danger" title="Delete" aria-label="Delete ${esc(h.name || '')}"
                onclick="deleteHoliday('${h.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');
}

// Ligne en mode édition : mêmes champs que l'ajout, posés en place.
function _holEditRow(h) {
  const cc = String(h.country || '').toUpperCase();
  const opt = (v, label) =>
    `<option value="${v}"${cc === v ? ' selected' : ''}>${label}</option>`;
  return `<div class="hol-row is-editing">
    <div class="hol-edit">
      <input class="form-control hol-edit-date" type="date" id="hol-e-date" value="${esc(h.date || '')}">
      <input class="form-control hol-edit-name" id="hol-e-name" value="${esc(h.name || '')}"
             placeholder="Holiday name"
             onkeydown="if(event.key==='Enter')holSave('${h.id}');if(event.key==='Escape')holCancel()">
      <select class="form-control hol-edit-country" id="hol-e-country">
        ${opt('', 'All sites')}${siteList().map(s => opt(s.code, siteName(s.code))).join('')}
      </select>
    </div>
    <div class="hol-actions">
      <button class="hol-ico" title="Enregistrer" onclick="holSave('${h.id}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
             stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
      </button>
      <button class="hol-ico" title="Annuler" onclick="holCancel()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
             stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>
      </button>
    </div>
  </div>`;
}

function holSetYear(y) { _holYear = y; _holEditing = null; renderHolidaysList(); }
function holEdit(id)   { _holEditing = id; renderHolidaysList();
                         setTimeout(() => document.getElementById('hol-e-name')?.focus(), 30); }
function holCancel()   { _holEditing = null; renderHolidaysList(); }

// Toutes les écritures passent par ici : le serveur refuse (400/409) et
// ces refus doivent se voir. Auparavant la réponse était ignorée, si bien
// qu'un échec ressemblait à « rien ne se passe » — c'est exactement le
// symptôme « je n'arrive pas à modifier les fériés ».
async function _holWrite(url, opts, okMsg) {
  let res;
  try {
    res = await fetch(url, opts);
  } catch (e) {
    toast('Network error — server unreachable', 'error');
    return false;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    toast(body.error || `Failed (${res.status})`, 'error');
    return false;
  }

  /* L'écriture a réussi. Tout ce qui suit n'est que du rafraîchissement
     d'affichage : si une de ces étapes échoue, la modification est déjà
     enregistrée côté serveur et l'utilisateur doit le savoir. Auparavant
     une exception ici (rechargement global, redessin du planning) faisait
     échouer l'ensemble en silence — la suppression avait bien eu lieu mais
     l'écran ne bougeait pas, ce qui se lit comme « ça ne marche pas ». */
  _holEditing = null;
  try {
    await loadAll();
  } catch (e) {
    // Repli : on retire l'entrée du cache local pour que la liste soit
    // juste malgré l'échec du rechargement.
    if (opts.method === 'DELETE') {
      const id = String(url).split('/').pop();
      state.holidays = (state.holidays || []).filter(h => h.id !== id);
    }
    console.error('[holidays] rechargement partiel', e);
  }

  try { renderHolidaysList(); } catch (e) { console.error('[holidays] rendu', e); }
  // Le planning colore les fériés : il doit suivre immédiatement.
  try {
    if (document.getElementById('page-shift-planning')?.classList.contains('active')) {
      renderShiftPlanning();
    }
  } catch (e) { console.error('[holidays] planning', e); }

  if (okMsg) toast(okMsg, 'success');
  return true;
}

async function addHoliday() {
  const date = document.getElementById('holiday-date-input').value;
  const name = document.getElementById('holiday-name-input').value.trim();
  const country = document.getElementById('holiday-country-input')?.value || '';
  if (!date || !name) { toast('Date and name are required', 'error'); return; }

  const ok = await _holWrite(`${API}/api/holidays`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, name, country }),
  }, 'Public holiday added');
  if (!ok) return;

  document.getElementById('holiday-date-input').value = '';
  document.getElementById('holiday-name-input').value = '';
  // On bascule sur l'année du férié ajouté, sinon il apparaît « nulle part ».
  const y = String(date).slice(0, 4);
  if (_holYear && _holYear !== y) { _holYear = y; renderHolidaysList(); }
}

async function holSave(id) {
  const date = document.getElementById('hol-e-date')?.value || '';
  const name = (document.getElementById('hol-e-name')?.value || '').trim();
  const country = document.getElementById('hol-e-country')?.value || '';
  if (!date || !name) { toast('Date and name are required', 'error'); return; }
  await _holWrite(`${API}/api/holidays/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, name, country }),
  }, 'Public holiday updated');
}

async function deleteHoliday(id) {
  const h = (state.holidays || []).find(x => x.id === id);
  if (!confirm(`Delete “${h?.name || 'this holiday'}”?`)) return;
  await _holWrite(`${API}/api/holidays/${id}`, { method: 'DELETE' },
    'Public holiday deleted');
}


