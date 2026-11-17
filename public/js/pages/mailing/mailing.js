/* ══════════════════════════════════════════════════════════════
   PAGE DIFFUSION — envoi programmé des rapports
   L'état vit ici plutôt que dans le DOM : les groupes et les
   planifications s'ajoutent et se suppriment, et relire des champs
   d'un tableau qu'on vient de réécrire est une source d'erreurs.
══════════════════════════════════════════════════════════════ */
const mlState = { smtp: {}, groups: [], schedules: [], reports: [], tz: 'UTC', log: [] };
// État d'affichage, distinct des données : quelles cartes sont dépliées,
// quel filtre du journal est actif, s'il reste des saisies à enregistrer.
const mlUI = { open: new Set(), filter: 'all', dirty: false, logAt: 0, timer: null };

const _ML_ICON = {
  ok:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  ko:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 7v6M12 17h.01"/></svg>',
  send: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
  edit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  del:  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
  eye:  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
  x:    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
};
const _ML_JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const _ML_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const _mlLabel = id => (mlState.reports.find(r => r.id === id) || {}).label || id || 'Rapport';
// Pays d'un envoi : le code sert au serveur et à l'objet du mail.
const _ML_PAYS = { SN: { code: 'SN', fr: 'Sénégal (Dakar)' }, CI: { code: 'CI', fr: 'Côte d’Ivoire (Abidjan)' }, ALL: { code: 'SN + CI', fr: 'Les deux (SN + CI)' } };
const _mlPays = sc => _ML_PAYS[sc && sc.country] ? sc.country : 'SN';
const _mlGroup = id => mlState.groups.find(g => g.id === id);
const _mlPad = n => String(n).padStart(2, '0');

// Date du jour dans le fuseau des rapports ('YYYY-MM-DD') : c'est dans ce
// fuseau que l'ordonnanceur décide, pas dans celui du navigateur.
function _mlTodayTZ(offsetDays) {
  const d = new Date(Date.now() + (offsetDays || 0) * 86400000);
  try { return d.toLocaleDateString('en-CA', { timeZone: mlState.tz }); }
  catch { return d.toISOString().slice(0, 10); }
}
// '2026-09-27 08:00' (heure murale du fuseau) → « aujourd'hui 08:00 ».
function _mlWhen(wall) {
  if (!wall) return '';
  const [date, time] = wall.split(' ');
  if (date === _mlTodayTZ(0)) return `aujourd’hui ${time}`;
  if (date === _mlTodayTZ(1)) return `demain ${time}`;
  const d = new Date(date + 'T12:00:00Z');
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
       + ` ${time}`;
}
function _mlRel(iso) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (!isFinite(s)) return '';
  if (s < 45) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  const j = Math.round(s / 86400);
  return j === 1 ? 'hier' : `il y a ${j} j`;
}
function _mlAbs(iso, opts) {
  try {
    return new Date(iso).toLocaleString('fr-FR', Object.assign(
      { timeZone: mlState.tz, hour: '2-digit', minute: '2-digit' }, opts || {}));
  } catch { return String(iso || '').replace('T', ' ').slice(0, 16); }
}
function _mlFreqText(sc) {
  const h = `${_mlPad(sc.hour ?? 8)}:${_mlPad(sc.minute ?? 0)}`;
  if (sc.freq === 'once')    return `Le ${sc.date ? new Date(sc.date + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' }) : '—'} à ${h}`;
  if (sc.freq === 'weekly')  return `Chaque ${_ML_JOURS[Number(sc.day) || 0]} à ${h}`;
  if (sc.freq === 'monthly') return `Le ${sc.day || 1} de chaque mois à ${h}`;
  return `Chaque jour à ${h}`;
}
// Dernier envoi d'une planification. Les entrées récentes portent son
// identifiant ; les plus anciennes se retrouvent par rapport + groupe.
function _mlLastFor(sc) {
  const g = _mlGroup(sc.group_id);
  return mlState.log.find(e => e.schedule_id
    ? e.schedule_id === sc.id
    : e.origin !== 'test' && e.kind === sc.report && g && e.group === g.name) || null;
}

async function renderMailingPage() {
  try {
    const res = await fetch(`${API}/api/mailing`, {
      headers: AdminSession.headers(), credentials: 'same-origin' });
    if (!res.ok) throw new Error(String(res.status));
    const d = await res.json();
    mlState.smtp = d.smtp || {};
    mlState.groups = d.groups || [];
    mlState.schedules = d.schedules || [];
    mlState.reports = d.reports || [];
    mlState.tz = d.tz || 'UTC';
    mlState.alert_email = d.alert_email || '';
    mlState.health = d.health || { failed: [], retrying: [] };
    _mlApplyHealth(mlState.health);
  } catch {
    toast('Chargement de la diffusion impossible', 'error');
    return;
  }

  const v = (id, val) => { const e = document.getElementById(id); if (e) e.value = val ?? ''; };
  v('ml-host', mlState.smtp.host);
  v('ml-port', mlState.smtp.port);
  v('ml-user', mlState.smtp.user);
  v('ml-from', mlState.smtp.from);
  v('ml-pass', '');
  v('ml-alert-email', mlState.alert_email);
  _mlRenderPassState();

  const sel = document.getElementById('ml-test-report');
  if (sel) sel.innerHTML = mlState.reports
    .map(r => `<option value="${esc(r.id)}">${esc(r.label)}</option>`).join('');
  const tzn = document.getElementById('ml-tz-note');
  if (tzn) tzn.textContent = `Heures exprimées dans le fuseau des rapports (${mlState.tz})`;

  // Serveur incomplet : on déplie ses réglages, c'est la seule chose à faire.
  const fold = document.getElementById('ml-smtp-fold');
  if (fold) fold.open = !_mlReady();

  mlUI.open.clear();
  _mlDirty(null, false);
  _mlRenderAll();
  await mlLoadLog();
  _mlStartAutoRefresh();
}

function _mlReady() {
  const sm = mlState.smtp || {};
  return !!(sm.host && sm.port && sm.user && sm.has_pass);
}
function _mlRenderPassState() {
  const ps = document.getElementById('ml-pass-state');
  if (!ps) return;
  ps.textContent = !mlState.smtp.has_pass
    ? 'Aucun mot de passe enregistré — l’envoi échouera tant qu’il manque.'
    : mlState.smtp.pass_from_env
      ? 'Mot de passe fourni par SMTP_PASS dans le fichier .env. Saisir une valeur ici le remplacera.'
      : 'Un mot de passe est enregistré. Laisser vide pour le conserver.';
  const sum = document.getElementById('ml-smtp-sum');
  if (sum) sum.innerHTML = _mlReady()
    ? `<span class="ml-dot is-ok"></span>${esc(mlState.smtp.host)} · ${esc(mlState.smtp.user)}`
    : '<span class="ml-dot is-bad"></span>Configuration incomplète';
}

function _mlRenderAll() {
  _mlRenderStatus();
  _mlRenderSchedules();
  _mlRenderGroups();
  _mlRenderLog();
}

// Rafraîchit le journal toutes les 30 s tant que la page est affichée.
// Sans cela, un envoi programmé parti pendant qu'on regardait la page
// n'apparaissait jamais — le journal semblait ne rien enregistrer.
function _mlStartAutoRefresh() {
  if (mlUI.timer) return;
  mlUI.timer = setInterval(() => {
    const page = document.getElementById('page-mailing');
    if (!page || !page.offsetParent) { clearInterval(mlUI.timer); mlUI.timer = null; return; }
    if (document.hidden) return;
    mlLoadLog({ quiet: true });
  }, 30000);
}

// ── État en cartes ──────────────────────────────────────────────
function _mlRenderStatus() {
  const el = document.getElementById('ml-status');
  if (!el) return;
  const pret = _mlReady();
  const actifs = mlState.schedules.filter(s => s.enabled !== false);
  const prochain = actifs.filter(s => s.next_run).sort((a, b) => a.next_run < b.next_run ? -1 : 1)[0];
  const dernier = mlState.log[0];
  const semaine = Date.now() - 7 * 86400000;
  const recents = mlState.log.filter(e => new Date(e.at).getTime() >= semaine);
  const echecs = recents.filter(e => !e.ok).length;

  const card = (tone, label, value, sub, onclick) => `
    <div class="ml-kpi${tone ? ' is-' + tone : ''}"${onclick ? ` role="button" tabindex="0" onclick="${onclick}"` : ''}>
      <div class="ml-kpi-l">${label}</div>
      <div class="ml-kpi-v">${value}</div>
      <div class="ml-kpi-s">${sub}</div>
    </div>`;

  el.innerHTML =
    card(pret ? 'ok' : 'bad', 'Serveur d’envoi',
      `<span class="ml-dot is-${pret ? 'ok' : 'bad'}"></span>${pret ? 'Opérationnel' : 'À compléter'}`,
      pret ? esc(mlState.smtp.host) : 'Aucun rapport ne peut partir',
      "mlFocusSmtp()")
    + card(prochain ? '' : 'warn', 'Prochain envoi',
      prochain ? esc(_mlWhen(prochain.next_run)) : '—',
      prochain ? `${esc(_mlLabel(prochain.report))} → ${esc((_mlGroup(prochain.group_id) || {}).name || '?')}`
               : actifs.length ? 'Aucune échéance à venir' : 'Aucun envoi actif')
    + card(dernier ? (dernier.ok ? 'ok' : 'bad') : '', 'Dernier envoi',
      dernier ? esc(_mlRel(dernier.at)) : '—',
      dernier ? `${dernier.ok ? 'Réussi' : 'Échec'} · ${esc(_mlLabel(dernier.kind))}` : 'Aucun envoi pour le moment',
      "document.getElementById('ml-sec-log').scrollIntoView({behavior:'smooth'})")
    + card(echecs ? 'bad' : '', '7 derniers jours',
      `${recents.length - echecs}<small> envoyé${recents.length - echecs > 1 ? 's' : ''}</small>`,
      echecs ? `${echecs} échec${echecs > 1 ? 's' : ''}` : 'Aucun échec',
      echecs ? "mlLogFilter('ko');document.getElementById('ml-sec-log').scrollIntoView({behavior:'smooth'})" : '');

  // Bandeau : un seul message, le plus urgent.
  const al = document.getElementById('ml-alert');
  if (!al) return;
  const dernierAuto = mlState.log.find(e => e.origin !== 'test');
  let msg = '';
  if (!pret) {
    msg = `<b>Le serveur d’envoi est incomplet.</b> Les envois programmés échoueront tant qu’il n’est pas configuré.
           <button class="ml-btn ml-btn-text" onclick="mlFocusSmtp()">Compléter</button>`;
  } else if (dernierAuto && !dernierAuto.ok) {
    msg = `<b>Le dernier envoi a échoué</b> (${esc(_mlAbs(dernierAuto.at, { day: '2-digit', month: '2-digit' }))}) :
           ${esc(dernierAuto.error || 'erreur inconnue')}`;
  } else if (!mlState.groups.length) {
    msg = '<b>Aucun groupe de destinataires.</b> Créez-en un pour pouvoir programmer un envoi.';
  }
  al.innerHTML = msg;
  al.hidden = !msg;
}

function mlFocusSmtp() {
  const f = document.getElementById('ml-smtp-fold');
  if (f) f.open = true;
  document.getElementById('ml-sec-smtp')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => document.getElementById(_mlReady() ? 'ml-host' : (mlState.smtp.has_pass ? 'ml-host' : 'ml-pass'))?.focus(), 350);
}

// ── Envois programmés ───────────────────────────────────────────
function _mlRenderSchedules() {
  const el = document.getElementById('ml-schedules');
  if (!el) return;
  if (!mlState.groups.length) {
    el.innerHTML = `<div class="ml-empty"><b>Commencez par un groupe de destinataires</b>
      <span>Un envoi programmé part toujours vers un groupe.</span>
      <button class="ml-btn ml-btn-tonal" onclick="mlAddGroup()">+ Créer un groupe</button></div>`;
    return;
  }
  if (!mlState.schedules.length) {
    el.innerHTML = `<div class="ml-empty"><b>Aucun envoi programmé</b>
      <span>Programmez l’envoi d’un rapport à heure fixe.</span>
      <button class="ml-btn ml-btn-tonal" onclick="mlAddSchedule()">+ Nouvel envoi</button></div>`;
    return;
  }
  el.innerHTML = mlState.schedules.map((sc, i) => {
    const g = _mlGroup(sc.group_id);
    const on = sc.enabled !== false;
    const open = mlUI.open.has(i);
    const last = _mlLastFor(sc);
    const nb = g ? (g.emails || []).length : 0;
    const lastHtml = last
      ? `<span class="ml-pill is-${last.ok ? 'ok' : 'bad'}" title="${esc(_mlAbs(last.at, { day: '2-digit', month: '2-digit', year: 'numeric' }))}${last.ok ? '' : ' — ' + esc(last.error || '')}">
           ${last.ok ? _ML_ICON.ok : _ML_ICON.ko} ${last.ok ? 'Envoyé' : 'Échec'} ${esc(_mlRel(last.at))}</span>`
      : '<span class="ml-pill">Jamais envoyé</span>';
    const nextHtml = !on
      ? '<span class="ml-sc-next is-off">En pause</span>'
      : sc.next_run
        ? `<span class="ml-sc-next">Prochain : <b>${esc(_mlWhen(sc.next_run))}</b></span>`
        : sc.id ? '<span class="ml-sc-next is-off">Aucune échéance</span>'
                : '<span class="ml-sc-next is-new">Non enregistré</span>';
    return `
    <article class="ml-sc${on ? '' : ' is-off'}${open ? ' is-open' : ''}">
      <div class="ml-sc-top">
        <label class="ml-switch" title="${on ? 'Mettre en pause' : 'Activer'}">
          <input type="checkbox"${on ? ' checked' : ''} onchange="mlToggleSchedule(${i},this.checked)">
          <span></span>
        </label>
        <div class="ml-sc-sum" onclick="mlToggleEdit(${i})">
          <div class="ml-sc-title">${esc(_mlLabel(sc.report))} <span class="ml-pill ml-pill-pays" title="${esc(_ML_PAYS[_mlPays(sc)].fr)}">${esc(_ML_PAYS[_mlPays(sc)].code)}</span></div>
          <div class="ml-sc-sub">${esc(_mlFreqText(sc))} → <b>${esc(g ? g.name : 'groupe manquant')}</b>
            <span class="ml-muted">· ${nb} destinataire${nb > 1 ? 's' : ''}</span></div>
          <div class="ml-sc-subj" title="Objet du mail">✉ ${esc(_mlSubjectPreview(sc))}</div>
          <div class="ml-sc-meta">${nextHtml}${sc.retry ? `
            <span class="ml-pill is-warn" title="${esc(sc.retry.last_error || '')}">
              ↻ Relance ${sc.retry.attempt}/3 à ${esc(_mlAbs(sc.retry.next_at))}</span>` : lastHtml}</div>
        </div>
        <div class="ml-sc-act">
          <button class="ml-icon-btn" title="Envoyer maintenant" aria-label="Envoyer maintenant"
                  onclick="mlSendNow(${i},this)"${sc.id ? '' : ' disabled'}>${_ML_ICON.send}</button>
          <button class="ml-icon-btn" title="Aperçu du mail" aria-label="Aperçu du mail"
                  onclick="mlPreview(${i},this)">${_ML_ICON.eye}</button>
          <button class="ml-icon-btn${open ? ' is-on' : ''}" title="Modifier" aria-label="Modifier"
                  onclick="mlToggleEdit(${i})">${_ML_ICON.edit}</button>
          <button class="ml-icon-btn is-danger" title="Supprimer" aria-label="Supprimer"
                  onclick="mlDelSchedule(${i})">${_ML_ICON.del}</button>
        </div>
      </div>
      ${open ? _mlScheduleForm(sc, i) : ''}
    </article>`;
  }).join('');
}

function _mlScheduleForm(sc, i) {
  const set = (k, expr, rerender) =>
    `onchange="mlState.schedules[${i}].${k}=${expr};_mlDirty('sched',true)${rerender ? ';_mlRenderSchedules()' : ''}"`;
  return `
    <div class="ml-sc-form">
      <label class="ml-f">Rapport
        <select class="form-control" ${set('report', 'this.value', true)}>
          ${mlState.reports.map(r => `<option value="${esc(r.id)}"${r.id === sc.report ? ' selected' : ''}>${esc(r.label)}</option>`).join('')}
        </select></label>
      <label class="ml-f">Pays
        <select class="form-control" ${set('country', 'this.value', true)}>
          ${Object.entries(_ML_PAYS).map(([k, p]) => `<option value="${k}"${k === _mlPays(sc) ? ' selected' : ''}>${esc(p.fr)}</option>`).join('')}
        </select></label>
      <label class="ml-f">Destinataires
        <select class="form-control" ${set('group_id', 'this.value', true)}>
          ${mlState.groups.map(g => `<option value="${esc(g.id)}"${g.id === sc.group_id ? ' selected' : ''}>${esc(g.name || 'Sans nom')}</option>`).join('')}
        </select></label>
      <label class="ml-f">Fréquence
        <select class="form-control" ${set('freq', 'this.value', true)}>
          <option value="once"${sc.freq === 'once' ? ' selected' : ''}>Une seule fois</option>
          <option value="daily"${sc.freq === 'daily' ? ' selected' : ''}>Chaque jour</option>
          <option value="weekly"${sc.freq === 'weekly' ? ' selected' : ''}>Chaque semaine</option>
          <option value="monthly"${sc.freq === 'monthly' ? ' selected' : ''}>Chaque mois</option>
        </select></label>
      ${sc.freq === 'once' ? `<label class="ml-f">Date
        <input class="form-control" type="date" value="${esc(sc.date || '')}" ${set('date', 'this.value', true)}></label>` : ''}
      ${sc.freq === 'weekly' ? `<label class="ml-f">Jour
        <select class="form-control" ${set('day', '+this.value', true)}>
          ${[1, 2, 3, 4, 5, 6, 0].map(n => `<option value="${n}"${Number(sc.day) === n ? ' selected' : ''}>${_ML_JOURS[n][0].toUpperCase() + _ML_JOURS[n].slice(1)}</option>`).join('')}
        </select></label>` : ''}
      ${sc.freq === 'monthly' ? `<label class="ml-f">Jour du mois
        <input class="form-control" type="number" min="1" max="28" value="${sc.day || 1}"
               title="1 à 28, pour exister tous les mois" ${set('day', 'Math.min(28,Math.max(1,+this.value||1))', true)}></label>` : ''}
      <label class="ml-f">Heure
        <input class="form-control" type="time"
               value="${_mlPad(sc.hour ?? 8)}:${_mlPad(sc.minute ?? 0)}"
               onchange="(()=>{const[h,m]=this.value.split(':');mlState.schedules[${i}].hour=+h;mlState.schedules[${i}].minute=+m;_mlDirty('sched',true);_mlRenderSchedules();})()"></label>
      <label class="ml-f ml-f-subject">Objet du mail
        <input class="form-control" value="${esc(sc.subject || '')}" maxlength="200"
               placeholder="${esc(_mlSubjectDefault(sc))}"
               oninput="mlState.schedules[${i}].subject=this.value;_mlDirty('sched',true);this.closest('.ml-sc-form').querySelector('.ml-subj-prev').textContent=_mlSubjectPreview(mlState.schedules[${i}])">
        <span class="ml-subj-help">Jetons : <code>{report}</code> <code>{country}</code> <code>{date}</code> <code>{week}</code> <code>{month}</code>
          · Aperçu : <b class="ml-subj-prev">${esc(_mlSubjectPreview(sc))}</b></span></label>
    </div>`;
}

// Objet du mail : même substitution que le serveur (mailSubject), pour
// que l'aperçu affiché soit exactement l'objet reçu.
const _ML_LABEL_EN = { daily: 'Daily Report', weekly: 'Weekly Report', monthly: 'Monthly Report',
  absences: 'Absence Report', weekly_pptx: 'Weekly Review' };
function _mlSubjectDefault(sc) { return `${_ML_LABEL_EN[sc.report] || sc.report} ${_ML_PAYS[_mlPays(sc)].code} — {date}`; }
function _mlSubjectPreview(sc) {
  const date = _mlTodayTZ(0);
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const wk = Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  const month = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const label = _ML_LABEL_EN[sc.report] || sc.report;
  const tpl = String(sc.subject || '').trim() || `${label} {country} — {date}`;
  return tpl.replace(/\{report\}/gi, label).replace(/\{date\}/gi, date)
            .replace(/\{country\}/gi, _ML_PAYS[_mlPays(sc)].code)
            .replace(/\{week\}/gi, `W${String(wk).padStart(2, '0')}`).replace(/\{month\}/gi, month);
}

function mlToggleEdit(i) {
  mlUI.open.has(i) ? mlUI.open.delete(i) : mlUI.open.add(i);
  _mlRenderSchedules();
}
function mlToggleSchedule(i, on) {
  mlState.schedules[i].enabled = on;
  _mlDirty('sched', true);
  _mlRenderSchedules(); _mlRenderStatus();
}

async function mlSendNow(i, btn) {
  const sc = mlState.schedules[i];
  if (!sc || !sc.id) return;
  if (mlUI.dirty) { toast('Enregistrez d’abord vos modifications', 'error'); return; }
  const g = _mlGroup(sc.group_id);
  const html = btn.innerHTML;
  btn.disabled = true; btn.classList.add('is-busy');
  try {
    const res = await fetch(`${API}/api/mailing/send`, {
      method: 'POST',
      headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
      credentials: 'same-origin',
      body: JSON.stringify({ schedule_id: sc.id }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || `Échec (${res.status})`);
    toast(`${_mlLabel(sc.report)} envoyé à ${g ? g.name : 'groupe'}`, 'success');
  } catch (e) {
    toast(`Envoi échoué : ${e.message}`, 'error');
  } finally {
    btn.disabled = false; btn.classList.remove('is-busy'); btn.innerHTML = html;
    mlLoadLog();
  }
}


// ── Aperçu d'un mail ───────────────────────────────────────────
// Le serveur construit le mail exactement comme à l'envoi (même code) ;
// l'objet en cours de saisie est pris en compte sans enregistrer.
async function mlPreview(i, btn) {
  const sc = mlState.schedules[i];
  if (!sc) return;
  if (btn) btn.classList.add('is-busy');
  try {
    const res = await fetch(`${API}/api/mailing/preview`, {
      method: 'POST',
      headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
      credentials: 'same-origin',
      body: JSON.stringify({ schedule_id: sc.id || '', report: sc.report, subject: sc.subject || '', country: _mlPays(sc) }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || `Erreur ${res.status}`);
    const g = _mlGroup(sc.group_id);
    const to = (g && g.emails && g.emails.length ? g.emails : d.to) || [];
    document.getElementById('ml-pv-subject').textContent = d.subject;
    document.getElementById('ml-pv-to').textContent = to.length ? to.join(', ') : '—';
    const kb = Math.max(1, Math.round((d.attachment?.size || 0) / 1024));
    document.getElementById('ml-pv-att').textContent = d.attachment ? `${d.attachment.filename} · ${kb} Ko` : '—';
    // srcdoc + sandbox vide : le HTML du mail est affiché isolé, sans script.
    document.getElementById('ml-pv-frame').srcdoc =
      `<!doctype html><meta charset="utf-8"><body style="margin:16px;background:#fff">${d.html}</body>`;
    const m = document.getElementById('ml-preview');
    m.hidden = false;
    m.querySelector('.ml-icon-btn')?.focus();
  } catch (e) {
    toast(`Aperçu impossible : ${e.message}`, 'error');
  } finally {
    if (btn) btn.classList.remove('is-busy');
  }
}
function mlClosePreview() {
  const m = document.getElementById('ml-preview');
  if (m) { m.hidden = true; document.getElementById('ml-pv-frame').srcdoc = ''; }
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !document.getElementById('ml-preview')?.hidden) mlClosePreview();
});

// ── Santé de la Diffusion ──────────────────────────────────────
// Un rapport programmé non parti doit se voir même quand le mail
// d'alerte n'a pas pu partir (serveur SMTP en panne) : badge sur l'entrée
// « Rapports » du menu et sur l'onglet Diffusion, pastille « échec » sur
// la carte Rapports de la Vue d'ensemble. Lu au chargement pour un
// admin, puis toutes les 5 minutes.
function _mlApplyHealth(h) {
  mlState.health = h || { failed: [], retrying: [] };
  const n = (mlState.health.failed || []).length;
  if (typeof rpRefreshTabs === 'function') rpRefreshTabs();
  const item = document.querySelector('.sidebar-group .nav-item[data-page="rapports"]');
  if (!item) return;
  let b = item.querySelector('.ml-nav-badge');
  if (!n) { if (b) b.remove(); return; }
  if (!b) {
    b = document.createElement('span');
    b.className = 'nav-item-badge ml-nav-badge';
    b.style.background = 'var(--red)';
    b.style.color = '#fff';
    item.appendChild(b);
  }
  b.textContent = String(n);
  b.title = `${n} envoi(s) programmé(s) en échec — voir Diffusion`;
}
async function mlRefreshHealth() {
  if (typeof AdminSession === 'undefined' || !AdminSession.active) return;
  try {
    const r = await fetch(`${API}/api/mailing/health`, { headers: AdminSession.headers(), credentials: 'same-origin' });
    if (r.ok) {
      _mlApplyHealth(await r.json());
      // La vue d'ensemble a pu s'afficher avant l'arrivée de l'état : on
      // redessine ses pastilles pour qu'elle ne reste pas sur « — ».
      const vue = document.getElementById('page-config');
      if (vue && vue.classList.contains('active') && typeof _renderConfigPage === 'function') _renderConfigPage();
    }
  } catch {}
}
setTimeout(mlRefreshHealth, 2000);
setInterval(mlRefreshHealth, 5 * 60 * 1000);
