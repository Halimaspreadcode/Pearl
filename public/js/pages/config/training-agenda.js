// ── AGENDA TRAINING (page Admin) ──────────────────────────────
// Calendrier des séances de formation : l'admin planifie, l'équipe consulte.
// Le formulaire sert à la fois à créer et à modifier — `trn-id` vide signifie
// création, rempli signifie mise à jour de la séance correspondante.
let _trainings = [];

function _trnEl(id) { return document.getElementById(id); }

function _trnStatus(msg, isError) {
  const el = _trnEl('trn-status');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? 'var(--red)' : 'var(--mute)';
}

async function renderTrainingAgenda() {
  const tb = _trnEl('trn-tbody');
  if (!tb) return;
  const past = _trnEl('trn-show-past');
  // Rebranché à chaque rendu, mais onchange (et non addEventListener) pour
  // ne pas empiler les écouteurs à chaque visite de la page.
  if (past) past.onchange = () => renderTrainingList();
  try {
    const res = await fetch(`${API}/api/trainings`);
    if (!res.ok) throw new Error('Chargement impossible');
    _trainings = await res.json();
    renderTrainingList();
  } catch (e) {
    tb.innerHTML = `<tr><td colspan="7" style="padding:18px;text-align:center;color:var(--mute)">
      ${esc(e.message)}</td></tr>`;
  }
}

function renderTrainingList() {
  const tb = _trnEl('trn-tbody');
  if (!tb) return;

  // Comparaison sur la date locale au format AAAA-MM-JJ : passer par
  // Date.parse décalerait le jour selon le fuseau.
  const today = new Date().toLocaleDateString('sv-SE');
  const showPast = !!_trnEl('trn-show-past')?.checked;
  const list = _trainings.filter(t => showPast || t.date >= today);

  if (!list.length) {
    tb.innerHTML = `<tr><td colspan="7" style="padding:18px;text-align:center;color:var(--mute)">
      ${showPast ? 'No session recorded.' : 'No upcoming session.'}</td></tr>`;
    return;
  }

  tb.innerHTML = list.map(t => {
    const d = new Date(t.date + 'T00:00:00');
    const jour = d.toLocaleDateString((globalThis.PEAR_LOCALE || 'fr-FR'), { weekday: 'short', day: '2-digit', month: 'short' });
    const horaire = t.start_time ? `${t.start_time}${t.end_time ? ' – ' + t.end_time : ''}` : '—';
    const passe = t.date < today;
    return `
    <tr${passe ? ' style="opacity:.55"' : ''}>
      <td style="white-space:nowrap;font-weight:600">${esc(jour)}</td>
      <td style="white-space:nowrap">${esc(horaire)}</td>
      <td>
        ${esc(t.title)}
        ${t.notes ? `<div style="font-size:11px;color:var(--mute);margin-top:2px">${esc(t.notes)}</div>` : ''}
      </td>
      <td>${esc(t.trainer  || '—')}</td>
      <td>${esc(t.location || '—')}</td>
      <td>${esc(t.audience || '—')}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-ghost btn-sm" onclick="editTraining('${t.id}')">Edit</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--red);border-color:var(--red-l)"
                onclick="deleteTraining('${t.id}')">Delete</button>
      </td>
    </tr>`;
  }).join('');
}

function editTraining(id) {
  const t = _trainings.find(x => x.id === id);
  if (!t) return;
  _trnEl('trn-id').value       = t.id;
  _trnEl('trn-title').value    = t.title    || '';
  _trnEl('trn-date').value     = t.date     || '';
  _trnEl('trn-start').value    = t.start_time || '';
  _trnEl('trn-end').value      = t.end_time   || '';
  _trnEl('trn-trainer').value  = t.trainer  || '';
  _trnEl('trn-location').value = t.location || '';
  _trnEl('trn-audience').value = t.audience || '';
  _trnEl('trn-notes').value    = t.notes    || '';

  _trnEl('trn-form-title').textContent = 'Edit session';
  _trnEl('trn-save').textContent = 'Enregistrer';
  _trnEl('trn-cancel').style.display = '';
  _trnStatus('');
  _trnEl('trn-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetTrainingForm() {
  ['trn-id','trn-title','trn-date','trn-start','trn-end',
   'trn-trainer','trn-location','trn-audience','trn-notes']
    .forEach(id => { const el = _trnEl(id); if (el) el.value = ''; });
  _trnEl('trn-form-title').textContent = 'New session';
  _trnEl('trn-save').textContent = 'Add session';
  _trnEl('trn-cancel').style.display = 'none';
  _trnStatus('');
}

async function saveTraining() {
  const id = _trnEl('trn-id').value;
  const body = {
    title:      _trnEl('trn-title').value.trim(),
    date:       _trnEl('trn-date').value,
    start_time: _trnEl('trn-start').value,
    end_time:   _trnEl('trn-end').value,
    trainer:    _trnEl('trn-trainer').value.trim(),
    location:   _trnEl('trn-location').value.trim(),
    audience:   _trnEl('trn-audience').value.trim(),
    notes:      _trnEl('trn-notes').value.trim(),
    author:     currentUser?.name || 'admin',
  };

  // Pré-contrôle : le serveur revalide de toute façon, mais signaler ici
  // évite un aller-retour pour les deux oublis les plus courants.
  if (!body.title) return _trnStatus('The title is required.', true);
  if (!body.date)  return _trnStatus('The date is required.', true);

  const btn = _trnEl('trn-save');
  if (btn) btn.disabled = true;
  _trnStatus('Enregistrement…');
  try {
    const res = await fetch(`${API}/api/trainings${id ? '/' + id : ''}`, {
      method: id ? 'PUT' : 'POST',
      headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || (res.status === 401 ? 'Admin session expired' : 'Save failed'));

    resetTrainingForm();
    await renderTrainingAgenda();
    toast(id ? 'Session updated' : 'Session added', 'success');
  } catch (e) {
    _trnStatus(e.message, true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function deleteTraining(id) {
  const t = _trainings.find(x => x.id === id);
  if (!confirm(`Delete the session “${t?.title || id}”?`)) return;
  try {
    const res = await fetch(`${API}/api/trainings/${id}`, {
      method: 'DELETE',
      headers: AdminSession.headers(),
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error(res.status === 401 ? 'Admin session expired' : 'Delete failed');
    // La séance en cours d'édition vient de disparaître : vider le formulaire
    // évite d'enregistrer ensuite sur un identifiant qui n'existe plus.
    if (_trnEl('trn-id').value === id) resetTrainingForm();
    await renderTrainingAgenda();
    toast('Session deleted', 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

