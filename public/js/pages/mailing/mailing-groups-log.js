// ── Groupes ─────────────────────────────────────────────────────
function _mlRenderGroups() {
  const el = document.getElementById('ml-groups');
  if (!el) return;
  if (!mlState.groups.length) {
    el.innerHTML = '<div class="ml-empty ml-empty-sm">Aucun groupe pour le moment.</div>';
    return;
  }
  el.innerHTML = mlState.groups.map((g, i) => {
    const used = mlState.schedules.filter(s => s.group_id === g.id && g.id).length;
    return `
    <div class="ml-gp">
      <div class="ml-gp-h">
        <input class="ml-gp-name" value="${esc(g.name)}" placeholder="Nom du groupe" aria-label="Nom du groupe"
               oninput="mlState.groups[${i}].name=this.value;_mlDirty('groups',true)"
               onchange="_mlRenderSchedules()">
        <span class="ml-muted ml-gp-n">${(g.emails || []).length} adresse${(g.emails || []).length > 1 ? 's' : ''} · ${used} envoi${used > 1 ? 's' : ''}</span>
        <button class="ml-icon-btn is-danger" title="Supprimer le groupe" aria-label="Supprimer le groupe"
                onclick="mlDelGroup(${i})">${_ML_ICON.del}</button>
      </div>
      <div class="ml-chips" onclick="this.querySelector('input')?.focus()">
        ${(g.emails || []).map((e, k) => `
          <span class="ml-chip${_ML_EMAIL.test(e) ? '' : ' is-bad'}" title="${_ML_EMAIL.test(e) ? '' : 'Adresse invalide — elle sera ignorée'}">
            ${esc(e)}<button aria-label="Retirer ${esc(e)}" onclick="event.stopPropagation();mlDelEmail(${i},${k})">${_ML_ICON.x}</button>
          </span>`).join('')}
        <input class="ml-chip-in" type="email" placeholder="${(g.emails || []).length ? 'Ajouter…' : 'adresse@exemple.com — Entrée pour ajouter'}"
               onkeydown="_mlEmailKey(event,${i})" onblur="_mlEmailCommit(this,${i})"
               onpaste="setTimeout(()=>_mlEmailCommit(this,${i}),0)">
      </div>
    </div>`;
  }).join('');
}

function _mlEmailKey(ev, i) {
  const inp = ev.target;
  if (['Enter', ',', ';', ' ', 'Tab'].includes(ev.key) && inp.value.trim()) {
    if (ev.key !== 'Tab') ev.preventDefault();
    _mlEmailCommit(inp, i, true);
  } else if (ev.key === 'Backspace' && !inp.value) {
    const list = mlState.groups[i].emails || [];
    if (list.length) mlDelEmail(i, list.length - 1, true);
  }
}
function _mlEmailCommit(inp, i, refocus) {
  const vals = inp.value.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
  if (!vals.length) return;
  const g = mlState.groups[i];
  g.emails = g.emails || [];
  vals.forEach(v => { if (!g.emails.includes(v)) g.emails.push(v); });
  inp.value = '';
  _mlDirty('groups', true);
  _mlRenderGroups(); _mlRenderSchedules(); _mlRenderStatus();
  if (refocus) document.querySelectorAll('#ml-groups .ml-chip-in')[i]?.focus();
}
function mlDelEmail(i, k, refocus) {
  mlState.groups[i].emails.splice(k, 1);
  _mlDirty('groups', true);
  _mlRenderGroups(); _mlRenderSchedules();
  if (refocus) document.querySelectorAll('#ml-groups .ml-chip-in')[i]?.focus();
}

// Signale les saisies non enregistrées par une barre unique en bas de
// page. Sans ce repère, on quitte la page en croyant avoir sauvegardé —
// c'est ce qui a fait perdre les groupes et les planifications.
function _mlDirty(_quoi, actif) {
  mlUI.dirty = !!actif;
  const bar = document.getElementById('ml-savebar');
  if (bar) bar.hidden = !actif;
}
window.addEventListener('beforeunload', e => {
  if (mlUI.dirty && document.getElementById('page-mailing')?.offsetParent) { e.preventDefault(); e.returnValue = ''; }
});

function mlAddGroup() {
  mlState.groups.push({ id: '', name: '', emails: [] });
  _mlDirty('groups', true);
  _mlRenderGroups(); _mlRenderSchedules(); _mlRenderStatus();
  const names = document.querySelectorAll('#ml-groups .ml-gp-name');
  names[names.length - 1]?.focus();
}
function mlDelGroup(i) {
  const g = mlState.groups[i];
  // Une planification qui viserait un groupe supprimé n'enverrait plus
  // rien sans le dire : on prévient plutôt que de laisser un envoi muet.
  const liees = g.id ? mlState.schedules.filter(s => s.group_id === g.id).length : 0;
  if (liees && !confirm(`${liees} envoi(s) programmé(s) visent ce groupe. Les supprimer aussi ?`)) return;
  if (g.id) mlState.schedules = mlState.schedules.filter(s => s.group_id !== g.id);
  mlState.groups.splice(i, 1);
  mlUI.open.clear();
  _mlDirty('groups', true);
  _mlRenderAll();
}
function mlAddSchedule() {
  if (!mlState.groups.length) { mlAddGroup(); toast('Créez d’abord un groupe de destinataires', 'error'); return; }
  // Date pré-remplie à aujourd'hui : basculer sur « Une seule fois »
  // avec un champ vide produirait une planification qui ne part jamais.
  mlState.schedules.push({ id: '', report: (mlState.reports[0] || {}).id || 'daily',
    group_id: (mlState.groups[0] || {}).id || '', freq: 'daily', hour: 8, minute: 0,
    day: 1, date: _mlTodayTZ(0), enabled: true,
    // Pays affiché à l'écran par défaut ; « Global » devient « les deux ».
    country: typeof getActiveCountry === 'function' ? getActiveCountry() : 'SN' });
  mlUI.open.add(mlState.schedules.length - 1);
  _mlDirty('sched', true);
  _mlRenderSchedules(); _mlRenderStatus();
}
function mlDelSchedule(i) {
  const sc = mlState.schedules[i];
  if (sc.id && !confirm(`Supprimer l’envoi « ${_mlLabel(sc.report)} — ${_mlFreqText(sc)} » ?`)) return;
  mlState.schedules.splice(i, 1);
  mlUI.open.clear();
  _mlDirty('sched', true);
  _mlRenderSchedules(); _mlRenderStatus();
}

async function mlSave(opts) {
  const silencieux = !!(opts && opts.silent);
  const g = id => document.getElementById(id)?.value ?? '';
  // Une adresse encore dans le champ de saisie compte : l'avoir tapée
  // sans appuyer sur Entrée ne doit pas la perdre.
  document.querySelectorAll('#ml-groups .ml-chip-in').forEach((inp, i) => {
    const vals = inp.value.split(/[,;\s]+/).filter(Boolean);
    if (vals.length) mlState.groups[i].emails = [...(mlState.groups[i].emails || []), ...vals];
  });
  const payload = {
    smtp: {
      host: g('ml-host').trim(), port: Number(g('ml-port')) || 587,
      user: g('ml-user').trim(), from: g('ml-from').trim(),
      pass: g('ml-pass'),          // vide = on conserve celui déjà en place
    },
    groups: mlState.groups,
    // next_run est calculé par le serveur, il n'a pas à y retourner.
    schedules: mlState.schedules.map(({ next_run, ...s }) => s),
    alert_email: g('ml-alert-email').trim(),
  };
  const btn = document.getElementById('ml-save-btn');
  if (btn && !silencieux) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }
  try {
    const res = await fetch(`${API}/api/mailing`, {
      method: 'PUT',
      headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(String(res.status));
    // Les marqueurs tombent seulement après confirmation du serveur :
    // les effacer avant ferait croire à une sauvegarde qui a échoué.
    _mlDirty(null, false);
    if (!silencieux) { toast('Diffusion enregistrée', 'success'); renderMailingPage(); }
  } catch (e) {
    if (!silencieux) toast('Enregistrement impossible', 'error');
    throw e;   // l'appelant doit savoir que rien n'a été enregistré
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer'; }
  }
}

async function mlTest(btn) {
  const to = document.getElementById('ml-test-to')?.value.trim();
  const report = document.getElementById('ml-test-report')?.value || 'daily';
  const country = document.getElementById('ml-test-country')?.value || 'SN';
  const st = document.getElementById('ml-test-state');
  const say = (txt, tone) => { if (st) { st.textContent = txt; st.dataset.tone = tone || ''; } };
  if (!to || !_ML_EMAIL.test(to)) { say('Indiquez une adresse valide.', 'bad'); return; }

  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Envoi…'; }
  say('Enregistrement puis envoi…');
  try {
    // Le test part de la configuration enregistrée côté serveur, pas des
    // champs à l'écran : on enregistre d'abord, sinon saisir le mot de
    // passe puis tester enverrait avec l'ancienne configuration.
    await mlSave({ silent: true });
    const res = await fetch(`${API}/api/mailing/test`, {
      method: 'POST',
      headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
      credentials: 'same-origin',
      body: JSON.stringify({ to, report, country }),
    });
    const d = await res.json().catch(() => ({}));
    // Le message d'erreur du relais est repris tel quel : « authentification
    // refusée » et « serveur injoignable » appellent des corrections
    // différentes, les confondre ferait perdre du temps.
    if (!res.ok) throw new Error(d.error || `Échec (${res.status})`);
    say(`Envoyé à ${to}.`, 'ok');
    toast('Test envoyé', 'success');
  } catch (e) {
    say(`Échec : ${e.message}`, 'bad');
    toast('Envoi de test échoué', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label; }
    const pass = document.getElementById('ml-pass');
    if (pass && pass.value) { pass.value = ''; mlState.smtp.has_pass = true; mlState.smtp.pass_from_env = false; }
    _mlRenderPassState();
    mlLoadLog();
  }
}

// ── Journal ─────────────────────────────────────────────────────
async function mlLoadLog(opts) {
  const el = document.getElementById('ml-log');
  if (!el) return;
  try {
    const res = await fetch(`${API}/api/mailing/log`, {
      headers: AdminSession.headers(), credentials: 'same-origin', cache: 'no-store' });
    // Un 401 renvoie { error } : sans ce test, l'objet passait pour un
    // journal vide et la page affichait « aucun envoi ».
    if (!res.ok) throw new Error(res.status === 401 ? 'Session admin expirée — reconnectez-vous.' : `Erreur ${res.status}`);
    const log = await res.json();
    if (!Array.isArray(log)) throw new Error('Réponse inattendue');
    const nouveaux = mlState.log.length && log.length && log[0].id !== mlState.log[0].id;
    mlState.log = log;
    mlUI.logAt = Date.now();
    _mlRenderLog();
    _mlRenderStatus();
    // Les pastilles « dernier envoi » des cartes dépendent du journal ;
    // on ne redessine pas une carte en cours de modification.
    if (!mlUI.open.size) _mlRenderSchedules();
    if (nouveaux && opts && opts.quiet) toast('Nouvel envoi dans le journal', 'success');
  } catch (e) {
    if (!(opts && opts.quiet)) el.innerHTML = `<div class="ml-empty ml-empty-sm is-bad">Journal indisponible : ${esc(e.message)}</div>`;
  }
}

function mlLogFilter(f) {
  mlUI.filter = f;
  document.querySelectorAll('#ml-log-filter button').forEach(b => b.classList.toggle('is-on', b.dataset.f === f));
  _mlRenderLog();
}

function _mlRenderLog() {
  const el = document.getElementById('ml-log');
  if (!el) return;
  const upd = document.getElementById('ml-log-upd');
  if (upd) upd.textContent = mlUI.logAt
    ? `${mlState.log.length} entrée${mlState.log.length > 1 ? 's' : ''} · mis à jour à ${new Date(mlUI.logAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · actualisation auto`
    : 'Chargement…';

  const ko = mlState.log.filter(e => !e.ok).length;
  const segKo = document.querySelector('#ml-log-filter [data-f="ko"]');
  if (segKo) segKo.innerHTML = ko ? `Échecs <span class="ml-seg-n">${ko}</span>` : 'Échecs';

  const rows = mlState.log.filter(e => mlUI.filter === 'all' || (mlUI.filter === 'ok' ? e.ok : !e.ok));
  if (!mlUI.logAt) { el.innerHTML = '<div class="ml-empty ml-empty-sm">Chargement…</div>'; return; }
  if (!rows.length) {
    el.innerHTML = `<div class="ml-empty ml-empty-sm">${mlState.log.length
      ? 'Aucune entrée pour ce filtre.' : 'Aucun envoi pour le moment. Les envois programmés et les tests apparaîtront ici.'}</div>`;
    return;
  }
  // Regroupé par jour : « aujourd'hui / hier » se lit plus vite qu'une
  // colonne de dates ISO.
  const auj = _mlTodayTZ(0), hier = _mlTodayTZ(-1);
  const jourDe = iso => { try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: mlState.tz }); } catch { return String(iso).slice(0, 10); } };
  const ORIG = { test: ['Test', 'test'], manual: ['Manuel', 'manual'], auto: ['Programmé', 'auto'],
                 retry: ['Relance', 'retry'], alert: ['Alerte', 'alert'] };
  let cur = '', html = '';
  for (const e of rows) {
    const j = jourDe(e.at);
    if (j !== cur) {
      cur = j;
      const titre = j === auj ? 'Aujourd’hui' : j === hier ? 'Hier'
        : new Date(j + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
      html += `<div class="ml-lg-day">${esc(titre)}</div>`;
    }
    const [olbl0, ocls] = ORIG[e.origin] || ORIG.auto;
    const olbl = e.origin === 'retry' && e.attempt ? `${olbl0} ${e.attempt}/3` : olbl0;
    const to = e.to || [];
    html += `
      <div class="ml-lg${e.ok ? '' : ' is-ko'}">
        <span class="ml-lg-ic">${e.ok ? _ML_ICON.ok : _ML_ICON.ko}</span>
        <div class="ml-lg-main">
          <div class="ml-lg-t"><b>${esc(_mlLabel(e.kind))}</b>${e.country ? ` <span class="ml-muted">${esc((_ML_PAYS[e.country] || {}).code || e.country)}</span>` : ''}
            ${e.group ? `<span class="ml-muted">→</span> ${esc(e.group)}` : ''}
            <span class="ml-org ml-org-${ocls}">${olbl}</span></div>
          <div class="ml-lg-s" title="${esc(to.join(', '))}">
            ${to.length ? esc(to.length > 2 ? `${to.slice(0, 2).join(', ')} +${to.length - 2}` : to.join(', ')) : ''}
            ${e.file ? `<span class="ml-lg-file">${esc(e.file)}</span>` : ''}
          </div>
          ${e.ok ? '' : `<div class="ml-lg-err">${esc(e.error || 'Échec')}</div>`}
        </div>
        <time class="ml-lg-time" datetime="${esc(e.at)}" title="${esc(_mlAbs(e.at, { day: '2-digit', month: '2-digit', year: 'numeric' }))}">
          ${esc(_mlAbs(e.at))}</time>
      </div>`;
  }
  el.innerHTML = html;
}

