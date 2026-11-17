// ── Liste ──────────────────────────────────────────────────────
// ── TRAITEMENT GROUPÉ DES DEMANDES D'ABSENCE ──────────────────
// Valider les demandes une par une impose d'ouvrir, changer le statut,
// enregistrer, refermer — pour chaque ligne. La sélection multiple ne
// change rien au calcul : elle envoie les mêmes PUT que le formulaire,
// simplement en série.
const _absSel = new Set();

function _absSelectedIds() {
  return [...document.querySelectorAll('.abs-sel:checked')].map(c => c.value);
}

function _absToggleAll(on) {
  document.querySelectorAll('.abs-sel').forEach(c => { c.checked = on; });
  _absSyncBatchBar();
}

// Barre d'actions affichée seulement quand une ligne est cochée : une
// barre toujours visible mais inerte encombre sans rien apporter.
function _absSyncBatchBar() {
  const ids = _absSelectedIds();
  _absSel.clear(); ids.forEach(i => _absSel.add(i));

  const bar = document.getElementById('abs-batch-bar');
  const lbl = document.getElementById('abs-batch-count');
  if (bar) bar.style.display = ids.length ? 'flex' : 'none';
  if (lbl) lbl.textContent = `${ids.length} demande${ids.length > 1 ? 's' : ''} sélectionnée${ids.length > 1 ? 's' : ''}`;

  const all = document.getElementById('abs-sel-all');
  const boxes = document.querySelectorAll('.abs-sel');
  if (all) {
    all.checked = boxes.length > 0 && ids.length === boxes.length;
    // État intermédiaire : dit « certaines » sans mentir dans un sens
    // ou dans l'autre.
    all.indeterminate = ids.length > 0 && ids.length < boxes.length;
  }
}

// `statut` vaut 'Validée' ou 'Refusée' — les valeurs du serveur
// (ABSENCE_STATUSES). La constante ABS_STATUSES du client porte
// 'Rejected', qui est un libellé d'affichage : l'envoyer tel quel ferait
// échouer la validation serveur en 400. Les requêtes partent en série et
// non en parallèle : le serveur sérialise déjà les écritures sur le
// fichier (withFileLock), et une rafale de PUT concurrents ne ferait
// qu'allonger la file sans rien accélérer.
async function absBatchDecide(statut) {
  const ids = _absSelectedIds();
  if (!ids.length) return;

  const verbe = statut === 'Validée' ? 'Approuver' : 'Rejeter';
  if (!confirm(`${verbe} ${ids.length} demande${ids.length > 1 ? 's' : ''} d'absence ?`)) return;

  const bar = document.getElementById('abs-batch-bar');
  if (bar) bar.querySelectorAll('button').forEach(b => { b.disabled = true; });

  let ok = 0;
  const echecs = [];
  for (const id of ids) {
    try {
      const res = await fetch(`${API}/api/absences/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: AbsenceSession.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ status: statut }),
      });
      if (res.ok) ok++;
      else echecs.push(id);
    } catch {
      echecs.push(id);
    }
  }

  if (bar) bar.querySelectorAll('button').forEach(b => { b.disabled = false; });
  _absSel.clear();

  // On dit ce qui a échoué plutôt que d'annoncer un succès global : sur
  // un lot, un échec partiel est le cas qui compte.
  if (echecs.length) {
    toast(`${ok} traitée(s), ${echecs.length} en échec`, 'error');
  } else {
    toast(`${ok} demande${ok > 1 ? 's' : ''} ${statut === 'Validée' ? 'approuvée' : 'rejetée'}${ok > 1 ? 's' : ''}`, 'success');
  }
  await renderAbsences();
}

function renderAbsenceList() {
  const el = document.getElementById('abs-table');
  if (!el) return;
  const q      = (document.getElementById('abs-f-search')?.value || '').toLowerCase().trim();
  const fAgent = document.getElementById('abs-f-agent')?.value || '';
  const fType  = document.getElementById('abs-f-type')?.value || '';
  const fStat  = document.getElementById('abs-f-status')?.value || '';
  const fNote  = document.getElementById('abs-f-notice')?.value || '';

  // Jours en conflit, pour pastiller les lignes concernées.
  const conflictIds = new Set(((absState.summary || {}).conflicts || []).map(c => c.absence_id));

  const rows = (absState.data || [])
    .filter(a => {
      if (fAgent && a.fo_name !== fAgent) return false;
      if (fType  && a.type    !== fType)  return false;
      if (fStat  && a.status  !== fStat)  return false;
      if (fNote) {
        if (fNote === 'À qualifier') { if (a.notice) return false; }
        else if (a.notice !== fNote) return false;
      }
      if (!q) return true;
      // Une date saisie dans la recherche filtre les absences qui la
      // recouvrent, pas seulement celles qui commencent ce jour-là.
      if (/^\d{4}-\d{2}-\d{2}$/.test(q)) return a.date_from <= q && a.date_to >= q;
      return [a.fo_name, a.type, a.status, a.reason]
        .some(v => String(v || '').toLowerCase().includes(q));
    })
    .sort((a, b) => b.date_from.localeCompare(a.date_from));

  const sub = document.getElementById('abs-list-sub');
  if (sub) sub.textContent = `${rows.length} absence${rows.length > 1 ? 's' : ''} shown`;

  if (!rows.length) {
    el.innerHTML = '<div class="abs-empty">No absence matches the filters.</div>';
    return;
  }

  el.innerHTML = `<div style="overflow-x:auto"><table class="abs-tbl">
    <thead><tr>
      <th class="abs-sel-col"><input type="checkbox" id="abs-sel-all"
          onclick="event.stopPropagation();_absToggleAll(this.checked)"
          title="Tout sélectionner (demandes en attente)"></th>
      <th>Agent</th><th>Type</th><th>Du</th><th>Au</th>
      <th style="text-align:right">Jours</th><th>Statut</th><th>Prévenu</th><th>Motif</th>
    </tr></thead>
    <tbody>${rows.map(a => `
      <tr onclick="openAbsenceModal('${esc(a.id)}')" data-abs-id="${esc(a.id)}">
        <td class="abs-sel-col">${
          a.status === 'Demandée'
            ? `<input type="checkbox" class="abs-sel" value="${esc(a.id)}"
                 onclick="event.stopPropagation();_absSyncBatchBar()"${
                 _absSel.has(a.id) ? ' checked' : ''}>`
            : ''}</td>
        <td>${esc(a.fo_name)}${
          conflictIds.has(a.id)
            ? `<span class="abs-conflict-flag" title="Agent scheduled on a shift during this absence">
                 <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                 conflit</span>`
            : ''}</td>
        <td><span class="abs-type"><i style="background:${absColor(a.type)}"></i>${esc(absTypeLabel(a.type))}</span></td>
        <td>${esc(_absFmtDay(a.date_from))}</td>
        <td>${esc(_absFmtDay(a.date_to))}</td>
        <td style="text-align:right" class="abs-days">${
          _absDays(a) === '0'
            ? '<span title="Absence entirely on non-working days" style="opacity:.5;font-weight:400">—</span>'
            : _absDays(a)}</td>
        <td><span class="abs-pill st-${esc(a.status)}">${esc(absStatusLabel(a.status))}</span></td>
        <td><span class="abs-notice ${absNoticeCls(a.notice)}"${
          a.notice_date ? ` title="Notified on ${esc(_absFmtDay(a.notice_date))}"` : ''
        }>${esc(absNoticeLabel(a.notice || 'À qualifier'))}</span></td>
        <td style="color:var(--m3-on-surf-var);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
            title="${esc(a.reason || '')}">${esc(a.reason || '—')}</td>
      </tr>`).join('')}
    </tbody></table></div>`;
}

// Décompte client, aligné sur la règle serveur : week-ends et fériés
// exclus, demi-journée = 0,5.
function _absDays(a) {
  if (a.half_day && a.date_from === a.date_to) return '0,5';
  const holidays = new Set((state.holidays || [])
    .filter(h => !currentCountry || currentCountry === 'ALL' || !h.country || h.country === currentCountry)
    .map(h => h.date));
  let n = 0, guard = 0;
  const cur = new Date(a.date_from + 'T00:00:00Z');
  const end = new Date(a.date_to + 'T00:00:00Z');
  while (cur <= end && guard++ < 400) {
    const iso = cur.toISOString().slice(0, 10);
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6 && !holidays.has(iso)) n++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return String(n);
}

// ── Modale ─────────────────────────────────────────────────────
function openAbsenceModal(id) {
  const a = id ? (absState.data || []).find(x => x.id === id) : null;
  const types    = Object.keys((absState.summary || {}).types || ABS_COLORS);
  const statuses = (absState.summary || {}).statuses || ABS_STATUSES;
  const foList   = (state.config?.fo_list || []).slice();
  // Un agent qui n'est plus dans fo_list doit rester éditable.
  if (a && a.fo_name && !foList.includes(a.fo_name)) foList.push(a.fo_name);

  const set = (elId, html) => { const e = document.getElementById(elId); if (e) e.innerHTML = html; };
  set('abs-fo', '<option value="">- Select -</option>' +
    foList.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join(''));
  set('abs-type', types.map(t => `<option value="${esc(t)}">${esc(absTypeLabel(t))}</option>`).join(''));
  set('abs-status', statuses.map(s => `<option value="${esc(s)}">${esc(absStatusLabel(s))}</option>`).join(''));
  const notices = Object.keys((absState.summary || {}).notices || {});
  set('abs-notice', '<option value="">— To be qualified —</option>' +
    (notices.length ? notices : ABS_NOTICES)
      .map(n => `<option value="${esc(n)}">${esc(absNoticeLabel(n))}</option>`).join(''));

  const v = (elId, val) => { const e = document.getElementById(elId); if (e) e.value = val; };
  const today = new Date().toISOString().slice(0, 10);
  v('abs-id',     a ? a.id : '');
  v('abs-fo',     a ? a.fo_name : '');
  v('abs-type',   a ? a.type : types[0] || '');
  v('abs-from',   a ? a.date_from : today);
  v('abs-to',     a ? a.date_to : today);
  v('abs-status', a ? a.status : 'Demandée');
  v('abs-half',   a ? (a.half_day || '') : '');
  v('abs-reason', a ? (a.reason || '') : '');
  // À la création, le cas courant est l'absence posée à l'avance : on
  // préremplit, l'utilisateur corrige si l'agent n'a pas prévenu.
  v('abs-notice', a ? (a.notice || '') : "Prévenu à l'avance");
  v('abs-notice-date', a ? (a.notice_date || '') : today);

  const title = document.getElementById('absence-modal-title');
  if (title) title.textContent = a ? 'Edit absence' : 'New absence';
  const del = document.getElementById('abs-delete-btn');
  if (del) del.style.display = a ? '' : 'none';

  absSyncDates();
  document.getElementById('absence-modal').classList.add('open');
}

// Aperçu live : jours décomptés + conflits de planning, avant
// l'enregistrement. Le conflit se lit sur les données déjà chargées.
function absSyncDates() {
  const from = document.getElementById('abs-from')?.value;
  const to   = document.getElementById('abs-to')?.value;
  const half = document.getElementById('abs-half')?.value;
  const fo   = document.getElementById('abs-fo')?.value;
  const el   = document.getElementById('abs-preview');
  if (!el) return;

  // Une fin antérieure au début est l'erreur la plus fréquente : on la
  // corrige au lieu d'attendre le refus serveur.
  const toEl = document.getElementById('abs-to');
  if (from && to && to < from && toEl) toEl.value = from;

  const f = from, t = document.getElementById('abs-to')?.value;
  if (!f || !t) { el.innerHTML = 'Enter the dates to see the count.'; return; }
  if (half && f !== t) {
    el.innerHTML = '<span class="warn">A half day must fall on a single date.</span>';
    return;
  }

  const days = _absDays({ date_from: f, date_to: t, half_day: half });
  // Une plage entièrement sur des jours non ouvrés donne 0 : sans
  // explication, ça se lit comme un bug plutôt que comme la règle.
  let html = days === '0'
    ? `<span class="warn">No working day</span> in this range `
      + `<span style="opacity:.7">(weekend or holiday) — nothing will be deducted.</span>`
    : `<b>${days}</b> working day${days === '1' ? '' : 's'} deducted `
      + `<span style="opacity:.7">(weekends and holidays excluded)</span>`;

  // Cohérence du préavis : la date annoncée doit correspondre au niveau
  // déclaré, sinon les deux champs racontent deux histoires.
  const notice     = document.getElementById('abs-notice')?.value || '';
  const noticeDate = document.getElementById('abs-notice-date')?.value || '';
  if (notice && noticeDate) {
    const early = noticeDate < f;
    const sameDay = noticeDate === f;
    if (notice === "Prévenu à l'avance" && !early) {
      html += `<br><span class="warn">Notice “in advance” but announced on ${_absFmtDay(noticeDate)}</span>`
            + `, i.e. same day or later.`;
    } else if (notice === 'Prévenu le jour même' && !sameDay) {
      html += `<br><span class="warn">Notice “same day” but announced on ${_absFmtDay(noticeDate)}</span>.`;
    } else if (early) {
      // Délai de prévenance : l'information utile pour arbitrer.
      const d = Math.round((new Date(f + 'T00:00:00Z') - new Date(noticeDate + 'T00:00:00Z')) / 864e5);
      html += `<br>Announced <b>${d} day${d > 1 ? 's' : ''}</b> before the absence starts.`;
    }
  } else if (!notice) {
    html += `<br><span style="opacity:.7">Notice not qualified — the absence will not count towards the rate.</span>`;
  }

  if (fo) {
    // Shifts planifiés de cet agent sur la plage : le serveur ne peut
    // pas le dire avant l'enregistrement, on le calcule ici.
    const clash = (state.shiftsPlan || []).filter(s =>
      s.fo_name === fo && !s.is_rest && s.date >= f && s.date <= t);
    if (clash.length) {
      html += `<br><span class="warn">⚠ ${clash.length} shift${clash.length > 1 ? 's' : ''} already planned</span>`
            + ` in this period — the rota will need adjusting.`;
    }
    // Solde restant après cette absence, si le type consomme le droit.
    const bal = ((absState.summary || {}).balances || []).find(b => b.fo_name === fo);
    const type = document.getElementById('abs-type')?.value;
    const deducts = ((absState.summary || {}).types || {})[type]?.deducts;
    if (bal && deducts) {
      const id = document.getElementById('abs-id')?.value;
      // En édition, l'absence en cours est déjà comptée dans le solde :
      // on la retire pour ne pas la décompter deux fois.
      const prev = id ? (absState.data || []).find(x => x.id === id) : null;
      const back = prev ? Number(_absDays(prev)) : 0;
      const after = Math.round((bal.remaining + back - Number(days)) * 10) / 10;
      html += `<br>Balance after saving: <b${after < 0 ? ' class="warn"' : ''}>${after} j</b>`
            + ` <span style="opacity:.7">of ${bal.entitlement} d</span>`;
    }
  }
  el.innerHTML = html;
}

const saveAbsence = withSaveGuard(async function() {
  const g = id => document.getElementById(id)?.value || '';
  const id = g('abs-id');
  const payload = {
    fo_name:   g('abs-fo'),
    type:      g('abs-type'),
    date_from: g('abs-from'),
    date_to:   g('abs-to'),
    status:    g('abs-status'),
    half_day:  g('abs-half') || '',
    notice:    g('abs-notice') || '',
    // La date de préavis n'a de sens que si le préavis est qualifié.
    notice_date: g('abs-notice') ? (g('abs-notice-date') || '') : '',
    reason:    g('abs-reason').trim(),
  };
  if (!payload.fo_name)   { toast('Select an agent', 'error'); return; }
  if (!payload.date_from || !payload.date_to) { toast('Dates are required', 'error'); return; }
  if (payload.date_to < payload.date_from) { toast('The end date is before the start date', 'error'); return; }

  if (typeof currentUser !== 'undefined' && currentUser?.name) {
    payload[id ? 'modified_by' : 'created_by'] = currentUser.name;
  }

  const res = await fetch(`${API}/api/absences${id ? '/' + id : ''}`, {
    method: id ? 'PUT' : 'POST',
    headers: AbsenceSession.headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  if (res.status === 401) { AbsenceSession.clear(); _renderAbsencePage(); return; }
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    toast(d.error || 'Enregistrement impossible', 'error');
    return;
  }
  closeModal('absence-modal');
  toast(id ? 'Absence updated' : 'Absence saved', 'success');
  await renderAbsences();
});

async function deleteAbsence() {
  const id = document.getElementById('abs-id')?.value;
  if (!id) return;
  if (!confirm('Delete this absence?')) return;
  const res = await fetch(`${API}/api/absences/${id}`, {
    method: 'DELETE', headers: AbsenceSession.headers(),
  });
  if (res.status === 401) { AbsenceSession.clear(); _renderAbsencePage(); return; }
  if (!res.ok) { toast('Unable to delete', 'error'); return; }
  closeModal('absence-modal');
  toast('Absence deleted', 'success');
  await renderAbsences();
}

