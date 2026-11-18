// ══════════════════════════════════════════════════════════════
// TABLEAU DE BORD COMPOSABLE (serveur : services/home.js)
//
// L'accueil est une grille de blocs choisis par l'organisation :
// indicateurs business, équipe, performance, tickets si le module est
// actif… Un administrateur compose la disposition de l'organisation ;
// chacun peut ensuite garder la sienne (« Personnaliser »), et revenir
// à celle de l'organisation quand il veut.
//
// Le bloc « Détail des tickets » réutilise le tableau d'origine
// (.dash-panel), déplacé dans la grille : rien n'est recalculé deux fois.
// ══════════════════════════════════════════════════════════════
const HM = { data: null, period: 'month', edit: false, draft: null, dragId: null };
const _hmT = s => (window.pearTr ? window.pearTr(s) : s);
const _hmLoc = () => (globalThis.PEAR_LOCALE || 'fr-FR');

function _hmFmt(m, v) {
  if (v == null) return '—';
  if (m.format === 'currency') {
    const cur = /\$/.test(m.unit) ? 'USD' : /£/.test(m.unit) ? 'GBP' : /fcfa|xof/i.test(m.unit) ? 'XOF' : 'EUR';
    try { return new Intl.NumberFormat(_hmLoc(), { style: 'currency', currency: cur, maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 }).format(v); } catch (_) {}
  }
  const n = new Intl.NumberFormat(_hmLoc(), { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 1 }).format(v);
  if (m.format === 'percent') return `${n} %`;
  return m.unit ? `${n} ${m.unit}` : n;
}
const _hmPct = v => (v == null ? '—' : `${v} %`);

async function renderHome(period) {
  const box = document.getElementById('home');
  if (!box) return;
  if (period) HM.period = period;
  try {
    const r = await fetch(`/api/home?period=${HM.period}`, { cache: 'no-store' });
    // Session pas encore ouverte (écran de connexion) : on réessaie.
    if (r.status === 401) { HM.retry = (HM.retry || 0) + 1; if (HM.retry < 20) setTimeout(() => renderHome(), 1500); return; }
    HM.retry = 0;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    HM.data = await r.json();
  } catch (e) {
    box.innerHTML = `<div class="hm-empty">${esc(_hmT('Tableau de bord indisponible'))} (${esc(e.message)})</div>`;
    return;
  }
  if (!HM.edit) HM.draft = null;
  _hmPaint();
}

const _hmLayout = () => HM.draft || HM.data.layout;
const _hmMetric = id => HM.data.metrics.find(m => m.id === id);
const _hmCat = t => HM.data.catalog.find(c => c.type === t) || { label: t, group: 'other', sizes: ['s'] };

function _hmPaint() {
  const box = document.getElementById('home');
  const d = HM.data;
  const src = { user: 'Votre disposition', org: "Disposition de l'organisation", default: 'Disposition proposée par Pear' }[d.source];
  const periods = [['week', 'Semaine'], ['month', 'Mois'], ['quarter', 'Trimestre'], ['year', 'Année']];
  box.innerHTML = `
    <div class="hm-bar">
      <div class="hm-bar-l"><span class="hm-title">${esc(_hmT('Tableau de bord'))}</span><span class="hm-src">${esc(_hmT(src))}</span></div>
      <div class="hm-bar-r">
        <div class="hm-seg" role="group" aria-label="${esc(_hmT('Période'))}">${periods.map(([k, l]) => `<button type="button" class="${HM.period === k ? 'on' : ''}" onclick="renderHome('${k}')">${esc(_hmT(l))}</button>`).join('')}</div>
        ${HM.edit ? '' : `<button type="button" class="hm-btn" onclick="hmStartEdit()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>${esc(_hmT('Personnaliser'))}</button>`}
      </div>
    </div>
    ${HM.edit ? `<div class="hm-edit-bar">
      <span>${esc(_hmT('Glissez les blocs pour les déplacer ; changez leur taille ou retirez-les.'))}</span><span class="sp"></span>
      ${d.can_edit_org ? `<button type="button" class="hm-btn" onclick="hmOpenMetrics()">${esc(_hmT('Indicateurs business'))}</button>` : ''}
      <button type="button" class="hm-btn ghost" onclick="hmCancelEdit()">${esc(_hmT('Annuler'))}</button>
      ${d.source === 'user' ? `<button type="button" class="hm-btn ghost" onclick="hmReset('me')">${esc(_hmT("Revenir à celle de l'organisation"))}</button>` : ''}
      ${d.personal ? `<button type="button" class="hm-btn${d.can_edit_org ? '' : ' pri'}" onclick="hmSave('me')">${esc(_hmT('Enregistrer pour moi'))}</button>` : ''}
      ${d.can_edit_org ? `<button type="button" class="hm-btn pri" onclick="hmSave('org')">${esc(_hmT("Enregistrer pour toute l'organisation"))}</button>` : ''}
    </div>` : ''}
    <div class="hm-grid${HM.edit ? ' hm-editing' : ''}" id="hm-grid">
      ${_hmLayout().map(_hmWidget).join('')}
      ${HM.edit ? `<button type="button" class="hm-add" style="grid-column:span 1" onclick="hmOpenCatalog()">+ ${esc(_hmT('Ajouter un bloc'))}</button>` : ''}
      ${!_hmLayout().length && !HM.edit ? `<div class="hm-w l"><div class="hm-empty">${esc(_hmT('Aucun bloc pour l’instant.'))} <button class="hm-link" onclick="hmStartEdit();hmOpenCatalog()">${esc(_hmT('Ajouter un bloc'))}</button></div></div>` : ''}
    </div>`;
  _hmMountTickets();
  if (HM.edit) _hmBindDrag();
}

function _hmTools(it) {
  const c = _hmCat(it.w);
  return `<div class="hm-tools">${c.sizes.length > 1 ? c.sizes.map(s => `<button type="button" class="${it.size === s ? 'on' : ''}" title="${esc(_hmT('Taille'))}" onclick="hmSize('${it.id}','${s}')">${s.toUpperCase()}</button>`).join('') : ''}
    ${it.w === 'note' || it.w === 'shortcuts' ? `<button type="button" title="${esc(_hmT('Modifier'))}" onclick="hmEditItem('${it.id}')">✎</button>` : ''}
    <button type="button" title="${esc(_hmT('Retirer'))}" onclick="hmRemove('${it.id}')">✕</button></div>`;
}

function _hmHead(it, title) {
  const c = _hmCat(it.w);
  return `<div class="hm-w-h"><div class="hm-w-t"><i class="${esc(c.group)}"></i><span>${esc(title || _hmT(c.label))}</span></div></div>`;
}

function _hmWidget(it) {
  const f = _hmRender[it.w];
  const inner = f ? f(it) : '';
  return `<div class="hm-w ${esc(it.size)}${it.w === 'tickets-detail' ? ' bare' : ''}" data-id="${esc(it.id)}" ${HM.edit ? 'draggable="true"' : ''}>${_hmTools(it)}${inner}</div>`;
}

function _hmDelta(m) {
  if (m.delta == null) return '';
  const good = m.better === 'down' ? m.delta < 0 : m.delta > 0;
  const cls = m.delta === 0 ? 'flat' : good ? 'up' : 'down';
  return `<span class="hm-delta ${cls}" title="${esc(_hmT('par rapport à la période précédente'))}">${m.delta > 0 ? '+' : ''}${m.delta} %</span>`;
}
function _hmSpark(series) {
  const vals = series.map(s => s.value).filter(v => v != null);
  const max = Math.max(...vals, 0) || 1;
  return `<div class="hm-spark">${series.map((s, i) => `<i class="${s.value == null ? 'nil' : i === series.length - 1 ? 'cur' : ''}" style="height:${s.value == null ? 4 : Math.max(6, Math.round(Math.abs(s.value) / max * 100))}%" title="${esc(s.label)} · ${s.value == null ? '—' : s.value}"></i>`).join('')}</div>`;
}
function _hmEntryForm(m) {
  if (!HM.data.can_edit_org || HM.edit) return '';
  const today = new Date().toISOString().slice(0, 10);
  return `<button type="button" class="hm-link" style="margin-top:10px;align-self:flex-start;font-size:13px" onclick="this.hidden=true;this.nextElementSibling.hidden=false;this.nextElementSibling.querySelector('[name=value]').focus()">+ ${esc(_hmT('Saisir une valeur'))}</button><form class="hm-entry" hidden onsubmit="hmAddEntry(event,'${m.id}')"><input type="date" name="date" value="${today}" aria-label="${esc(_hmT('Date'))}"><input type="number" step="any" name="value" placeholder="${esc(_hmT('Valeur'))}" aria-label="${esc(_hmT('Valeur'))}" required><button class="hm-btn" type="submit">${esc(_hmT('Saisir'))}</button></form>`;
}

const _hmRender = {
  metric(it) {
    const m = _hmMetric(it.metric);
    if (!m) return '';
    const nothing = m.entries_count === 0;
    return _hmHead(it, m.label) + (nothing
      ? `<div class="hm-v" style="color:var(--m3-on-surf-var)">—</div><div class="hm-sub">${esc(_hmT('Aucune valeur pour l’instant.'))}</div>${_hmEntryForm(m)}`
      : `<div><span class="hm-v">${esc(_hmFmt(m, m.value))}</span>${_hmDelta(m)}</div>
        <div class="hm-sub">${m.target != null ? `${esc(_hmT('Cible'))} ${esc(_hmFmt(m, m.target))}${m.progress != null ? ` · ${m.progress} %` : ''}` : esc(_hmT({ sum: 'Cumul de la période', avg: 'Moyenne de la période', last: 'Dernière valeur' }[m.agg]))}</div>
        ${m.target != null && m.progress != null ? `<div class="hm-prog"><i style="width:${Math.min(100, Math.max(0, m.progress))}%"></i></div>` : ''}
        ${it.size !== 's' ? _hmEntryForm(m) : ''}${_hmSpark(m.series)}`);
  },
  'metric-trend'(it) {
    const m = _hmMetric(it.metric);
    if (!m) return '';
    const vals = m.series.map(s => s.value).filter(v => v != null);
    const max = Math.max(...vals, m.target || 0, 0) || 1;
    return _hmHead(it, `${_hmT(m.label)} · ${_hmT({ day: 'par jour', week: 'par semaine', month: 'par mois' }[m.freq])}`)
      + (vals.length ? `<div class="hm-trend">${m.target ? `<div class="tgt" style="bottom:${Math.round(m.target / max * 100 * 0.82 + 12)}%"><span>${esc(_hmT('Cible'))} ${esc(_hmFmt(m, m.target))}</span></div>` : ''}
        ${m.series.map((s, i) => `<div class="col"><div class="bar ${s.value == null ? 'nil' : i === m.series.length - 1 ? 'cur' : ''}" style="height:${s.value == null ? 2 : Math.max(3, Math.round(Math.abs(s.value) / max * 82))}%" title="${esc(_hmFmt(m, s.value))}"></div><span class="lab">${esc(_hmLabel(s, m.freq))}</span></div>`).join('')}</div>`
        : `<div class="hm-empty">${esc(_hmT('Aucune valeur pour l’instant.'))}</div>${_hmEntryForm(m)}`);
  },
  'metrics-table'(it) {
    const ms = HM.data.metrics;
    return _hmHead(it) + (ms.length ? `<table class="hm-tbl"><thead><tr><th>${esc(_hmT('Indicateur'))}</th><th class="num">${esc(_hmT('Période'))}</th><th class="num">${esc(_hmT('Évolution'))}</th><th class="num">${esc(_hmT('Cible'))}</th></tr></thead><tbody>
      ${ms.map(m => `<tr><td>${esc(m.label)}</td><td class="num">${esc(_hmFmt(m, m.value))}</td><td class="num">${_hmDelta(m) || '—'}</td><td class="num">${m.target != null ? `${esc(_hmFmt(m, m.target))}${m.progress != null ? ` <span class="muted">(${m.progress} %)</span>` : ''}` : '—'}</td></tr>`).join('')}</tbody></table>`
      : `<div class="hm-empty">${esc(_hmT('Aucun indicateur business.'))}</div>`);
  },
  'team-today'(it) {
    const t = HM.data.data.team || {};
    return _hmHead(it) + `<div><span class="hm-v">${t.present_today != null ? t.present_today : t.headcount || 0}</span><small class="hm-sub" style="margin-left:6px">${esc(_hmT(t.present_today != null ? 'présents' : 'personnes'))}</small></div>
      <div class="hm-row" style="margin-top:12px">
        <div class="hm-mini"><small>${esc(_hmT('Effectif'))}</small><b>${t.headcount || 0}</b></div>
        ${t.absent_today != null ? `<div class="hm-mini"><small>${esc(_hmT('Absents'))}</small><b>${t.absent_today}</b></div><div class="hm-mini"><small>${esc(_hmT('En formation'))}</small><b>${t.training_today || 0}</b></div>` : ''}
      </div>${!t.headcount ? `<div class="hm-sub">${esc(_hmT('Ajoutez les personnes de l’équipe dans Paramètres › Général.'))}</div>` : ''}`;
  },
  absences(it) {
    const t = HM.data.data.team || {};
    return _hmHead(it) + `<div><span class="hm-v">${t.absence_rate != null ? t.absence_rate : 0}<small>%</small></span></div>
      <div class="hm-sub">${esc(_hmT('Taux d’absence de la période'))} · ${t.absent_days || 0} ${esc(_hmT('jours·personne'))}, ${t.unplanned_days || 0} ${esc(_hmT('imprévus'))}</div>`;
  },
  'upcoming-absences'(it) {
    const list = (HM.data.data.team || {}).upcoming || [];
    const day = iso => new Date(iso + 'T00:00:00').toLocaleDateString(_hmLoc(), { day: 'numeric', month: 'short' });
    return _hmHead(it) + (list.length ? `<ul class="hm-list">${list.map(a => `<li><span>${esc(a.name)} <span class="muted">· ${esc(_hmT(a.type || ''))}</span></span><span class="muted">${esc(day(a.from))}${a.to !== a.from ? ` → ${esc(day(a.to))}` : ''}</span></li>`).join('')}</ul>`
      : `<div class="hm-empty">${esc(_hmT('Aucune absence prévue dans les 14 prochains jours.'))}</div>`);
  },
  tasks(it) {
    const t = HM.data.data.tasks;
    if (!t) return _hmHead(it);
    return _hmHead(it) + `<div><span class="hm-v">${t.rate != null ? t.rate : '—'}<small>${t.rate != null ? '%' : ''}</small></span></div>
      <div class="hm-sub">${t.done}/${t.total} ${esc(_hmT('tâches réalisées'))}${t.overdue ? ` · <b style="color:#C2533F">${t.overdue} ${esc(_hmT('en retard'))}</b>` : ''}</div>
      ${t.total ? `<div class="hm-prog"><i style="width:${t.rate}%"></i></div>` : `<div class="hm-sub">${esc(_hmT('Aucune tâche sur la période.'))}</div>`}`;
  },
  'team-performance'(it) {
    const p = (HM.data.data.tasks || {}).people || [];
    return _hmHead(it) + (p.length ? p.map(x => `<div class="hm-pbar"><span class="n">${esc(x.name)}</span><span class="b"><i style="width:${x.rate}%"></i></span><span class="r">${x.done}/${x.total}</span></div>`).join('')
      : `<div class="hm-empty">${esc(_hmT('Aucune tâche confiée sur la période.'))}</div>`);
  },
  training(it) {
    const t = HM.data.data.training || {};
    return _hmHead(it) + (t.attempts ? `<div><span class="hm-v">${t.pass_rate}<small>%</small></span></div>
      <div class="hm-sub">${esc(_hmT('de réussite'))} · ${t.attempts} ${esc(_hmT('quiz passés'))} ${esc(_hmT('par'))} ${t.people} ${esc(_hmT('personnes'))} · ${esc(_hmT('score moyen'))} ${t.avg} %</div>`
      : `<div class="hm-empty">${esc(_hmT('Aucun quiz passé sur la période.'))}</div>`);
  },
  tickets(it) {
    const t = HM.data.data.tickets;
    if (!t) return _hmHead(it) + `<div class="hm-empty">—</div>`;
    const delta = t.prev_opened ? Math.round((t.opened - t.prev_opened) / t.prev_opened * 100) : null;
    return _hmHead(it) + `<div class="hm-row">
      <div class="hm-mini"><small>${esc(_hmT('En cours'))}</small><b>${t.open}</b></div>
      <div class="hm-mini"><small>${esc(_hmT('Hors délai'))}</small><b style="${t.overdue ? 'color:#C2533F' : ''}">${t.overdue}</b></div>
      <div class="hm-mini"><small>${esc(_hmT('Ouverts sur la période'))}</small><b>${t.opened}</b>${delta != null ? ` <span class="hm-delta ${delta > 0 ? 'down' : delta < 0 ? 'up' : 'flat'}">${delta > 0 ? '+' : ''}${delta} %</span>` : ''}</div>
      <div class="hm-mini"><small>${esc(_hmT('Respect des délais'))}</small><b>${_hmPct(t.on_time_rate)}</b></div>
    </div><div style="margin-top:auto;padding-top:10px"><button class="hm-link" onclick="renderPage('site')">${esc(_hmT('Voir les tickets'))} →</button></div>`;
  },
  'tickets-detail'() { return '<div class="hm-tickets-slot"></div>'; },
  note(it) {
    const can = HM.data.can_edit_org;
    return it.title || it.text
      ? `${it.title ? `<div class="hm-note-t">${esc(it.title)}</div>` : ''}<div class="hm-note">${esc(it.text || '')}</div>`
      : `${_hmHead(it)}<div class="hm-empty">${esc(_hmT(can ? 'Écrivez un message pour l’équipe : passez en mode Personnaliser, puis ✎.' : 'Rien pour l’instant.'))}</div>`;
  },
  shortcuts(it) {
    const pages = (it.pages && it.pages.length ? it.pages : ['site', 'shift-planning', 'absences', 'rapports', 'mon-espace', 'academy'])
      .filter(p => typeof pearlPageOn !== 'function' || pearlPageOn(p))
      .map(p => ({ p, l: (document.querySelector(`.nav-item[data-page="${CSS.escape(p)}"] .nav-item-label`) || {}).textContent }))
      .filter(x => x.l);
    return _hmHead(it) + `<div class="hm-sc">${pages.map(x => `<button type="button" onclick="renderPage('${esc(x.p)}')">${esc(x.l)}</button>`).join('')}</div>`;
  },
};

function _hmLabel(s, freq) {
  if (freq === 'month') return new Date(s.from + 'T00:00:00').toLocaleDateString(_hmLoc(), { month: 'short' });
  return new Date(s.from + 'T00:00:00').toLocaleDateString(_hmLoc(), { day: 'numeric', month: freq === 'day' ? undefined : 'numeric' });
}

// Le tableau des tickets d'origine, déplacé dans son bloc (ou rangé).
function _hmMountTickets() {
  const panel = document.querySelector('#page-dashboard .dash-panel');
  if (!panel) return;
  const slot = document.querySelector('#hm-grid .hm-tickets-slot');
  let park = document.getElementById('hm-park');
  if (!park) { park = document.createElement('div'); park.id = 'hm-park'; park.hidden = true; document.getElementById('page-dashboard').appendChild(park); }
  (slot || park).appendChild(panel);
}

// ── Mode édition ──
function hmStartEdit() { HM.edit = true; HM.draft = JSON.parse(JSON.stringify(HM.data.layout)); _hmPaint(); }
function hmCancelEdit() { HM.edit = false; HM.draft = null; _hmPaint(); }
function hmSize(id, s) { const it = HM.draft.find(x => x.id === id); if (it) { it.size = s; _hmPaint(); } }
function hmRemove(id) { HM.draft = HM.draft.filter(x => x.id !== id); _hmPaint(); }
async function hmSave(scope) {
  try {
    const r = await fetch('/api/home/layout', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope, layout: HM.draft }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status);
    if (scope === 'org' && HM.data.source === 'user') await fetch('/api/home/layout?scope=me', { method: 'DELETE' });
    HM.edit = false; HM.draft = null;
    toast(_hmT(scope === 'org' ? "Disposition enregistrée pour toute l'organisation" : 'Disposition enregistrée'), 'success');
    renderHome();
  } catch (e) { toast(e.message, 'error'); }
}
async function hmReset(scope) {
  await fetch(`/api/home/layout?scope=${scope}`, { method: 'DELETE' });
  HM.edit = false; HM.draft = null; renderHome();
}
function _hmBindDrag() {
  document.querySelectorAll('#hm-grid .hm-w[draggable]').forEach(el => {
    el.addEventListener('dragstart', e => { HM.dragId = el.dataset.id; el.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; });
    el.addEventListener('dragend', () => { el.classList.remove('drag'); HM.dragId = null; });
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', e => {
      e.preventDefault(); el.classList.remove('over');
      const from = HM.draft.findIndex(x => x.id === HM.dragId), to = HM.draft.findIndex(x => x.id === el.dataset.id);
      if (from < 0 || to < 0 || from === to) return;
      const [it] = HM.draft.splice(from, 1); HM.draft.splice(to, 0, it); _hmPaint();
    });
  });
}

// ── Panneau latéral ──
function _hmDrawer(title, html) {
  let bg = document.getElementById('hm-dbg'), dr = document.getElementById('hm-drawer');
  if (!dr) {
    bg = document.createElement('div'); bg.id = 'hm-dbg'; bg.className = 'hm-dbg'; bg.onclick = _hmClose;
    dr = document.createElement('aside'); dr.id = 'hm-drawer'; dr.className = 'hm-drawer';
    document.body.append(bg, dr);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') _hmClose(); });
  }
  dr.innerHTML = `<div class="hm-dh"><h3>${esc(_hmT(title))}</h3><button type="button" class="hm-btn ghost" onclick="_hmClose()" aria-label="${esc(_hmT('Fermer'))}">✕</button></div><div class="hm-db">${html}</div>`;
  requestAnimationFrame(() => { bg.classList.add('on'); dr.classList.add('on'); });
  return dr;
}
function _hmClose() { const bg = document.getElementById('hm-dbg'), dr = document.getElementById('hm-drawer'); if (bg) bg.classList.remove('on'); if (dr) dr.classList.remove('on'); }

function hmOpenCatalog() {
  const d = HM.data;
  const groups = Object.keys(d.groups).filter(g => d.catalog.some(c => c.group === g));
  _hmDrawer('Ajouter un bloc', groups.map(g => `<div class="hm-cat-g">${esc(_hmT(d.groups[g]))}</div>` + d.catalog.filter(c => c.group === g).map(c => {
    if (c.needs === 'metric') {
      if (!d.metrics.length) return `<div class="hm-cat" style="cursor:default"><span><b>${esc(_hmT(c.label))}</b><small>${esc(_hmT('Créez d’abord un indicateur business.'))}</small></span></div>`;
      return d.metrics.map(m => `<button type="button" class="hm-cat" onclick="hmAdd('${c.type}','${m.id}')"><span><b>${esc(_hmT(c.label))} · ${esc(m.label)}</b><small>${esc(_hmT(c.desc))}</small></span></button>`).join('');
    }
    if (c.type === 'tickets-detail' && _hmLayout().some(x => x.w === 'tickets-detail')) return '';
    return `<button type="button" class="hm-cat" onclick="hmAdd('${c.type}')"><span><b>${esc(_hmT(c.label))}</b><small>${esc(_hmT(c.desc))}</small></span></button>`;
  }).join('')).join('')
    + (d.can_edit_org ? `<div style="margin-top:18px"><button type="button" class="hm-btn" onclick="hmOpenMetrics()">${esc(_hmT('Gérer les indicateurs business'))}</button></div>` : ''));
}
function hmAdd(type, metric) {
  const c = _hmCat(type);
  const it = { id: Math.random().toString(36).slice(2, 10), w: type, size: c.sizes[0] };
  if (metric) it.metric = metric;
  if (!HM.edit) hmStartEdit();
  HM.draft.push(it); _hmClose(); _hmPaint();
  if (type === 'note') hmEditItem(it.id);
}
function hmEditItem(id) {
  const it = HM.draft.find(x => x.id === id);
  if (!it) return;
  if (it.w === 'note') {
    _hmDrawer('Note', `<div class="hm-form"><label>${esc(_hmT('Titre'))}</label><input id="hm-n-t" maxlength="80" value="${esc(it.title || '')}"><label>${esc(_hmT('Message'))}</label><textarea id="hm-n-x" rows="6" maxlength="1200">${esc(it.text || '')}</textarea>
      <div style="margin-top:14px"><button type="button" class="hm-btn pri" id="hm-n-ok">${esc(_hmT('Appliquer'))}</button></div></div>`);
    document.getElementById('hm-n-ok').onclick = () => { it.title = document.getElementById('hm-n-t').value.trim(); it.text = document.getElementById('hm-n-x').value.trim(); _hmClose(); _hmPaint(); };
  } else if (it.w === 'shortcuts') {
    const all = [...document.querySelectorAll('.nav-item[data-page]')].map(n => ({ p: n.dataset.page, l: (n.querySelector('.nav-item-label') || {}).textContent }))
      .filter(x => x.l && (typeof pearlPageOn !== 'function' || pearlPageOn(x.p)));
    const sel = new Set(it.pages || []);
    _hmDrawer('Raccourcis', `<div class="hm-form">${all.map(x => `<label style="display:flex;gap:8px;align-items:center;margin:6px 0;color:var(--m3-on-surface)"><input type="checkbox" style="width:auto;height:auto" value="${esc(x.p)}" ${sel.has(x.p) ? 'checked' : ''}> ${esc(x.l)}</label>`).join('')}
      <div style="margin-top:14px"><button type="button" class="hm-btn pri" id="hm-s-ok">${esc(_hmT('Appliquer'))}</button></div></div>`);
    document.getElementById('hm-s-ok').onclick = () => { it.pages = [...document.querySelectorAll('#hm-drawer input:checked')].map(x => x.value).slice(0, 8); _hmClose(); _hmPaint(); };
  }
}

// ── Indicateurs business ──
function hmOpenMetrics(editId) {
  const ms = HM.data.metrics;
  const m = editId ? ms.find(x => x.id === editId) : null;
  const opt = (v, cur, l) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(_hmT(l))}</option>`;
  _hmDrawer('Indicateurs business', `
    <p class="hm-sub" style="margin-top:0">${esc(_hmT('Ce qui compte pour votre activité : chiffre d’affaires, commandes, satisfaction, production… Définissez-les avec l’équipe, puis saisissez les valeurs ou collez-les depuis un tableur.'))}</p>
    <ul class="hm-mlist">${ms.map(x => `<li><b>${esc(x.label)}</b><span class="muted" style="font-size:12px">${x.entries_count} ${esc(_hmT('valeurs'))}</span><button class="hm-btn ghost" onclick="hmOpenMetrics('${x.id}')">${esc(_hmT('Modifier'))}</button></li>`).join('') || `<li class="muted">${esc(_hmT('Aucun indicateur pour l’instant.'))}</li>`}</ul>
    <div class="hm-form" style="margin-top:10px">
      <div class="hm-cat-g">${esc(_hmT(m ? 'Modifier l’indicateur' : 'Nouvel indicateur'))}</div>
      <label>${esc(_hmT('Nom'))}</label><input id="hm-m-l" maxlength="60" value="${esc(m ? m.label : '')}" placeholder="${esc(_hmT('Ex. Chiffre d’affaires'))}">
      <div class="two">
        <div><label>${esc(_hmT('Format'))}</label><select id="hm-m-f">${opt('number', m && m.format, 'Nombre')}${opt('currency', m && m.format, 'Montant')}${opt('percent', m && m.format, 'Pourcentage')}</select></div>
        <div><label>${esc(_hmT('Unité'))}</label><input id="hm-m-u" maxlength="12" value="${esc(m ? m.unit : '')}" placeholder="€, h, kg…"></div>
        <div><label>${esc(_hmT('Calcul sur la période'))}</label><select id="hm-m-a">${opt('sum', m && m.agg, 'Cumul')}${opt('avg', m && m.agg, 'Moyenne')}${opt('last', m && m.agg, 'Dernière valeur')}</select></div>
        <div><label>${esc(_hmT('Fréquence de saisie'))}</label><select id="hm-m-q">${opt('month', m && m.freq, 'Mensuelle')}${opt('week', m && m.freq, 'Hebdomadaire')}${opt('day', m && m.freq, 'Quotidienne')}</select></div>
        <div><label>${esc(_hmT('Cible (facultatif)'))}</label><input id="hm-m-t" type="number" step="any" value="${m && m.target != null ? m.target : ''}"></div>
        <div><label>${esc(_hmT('Le mieux, c’est'))}</label><select id="hm-m-b">${opt('up', m && m.better, 'Plus haut')}${opt('down', m && m.better, 'Plus bas')}</select></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        <button type="button" class="hm-btn pri" onclick="hmSaveMetric(${m ? `'${m.id}'` : 'null'})">${esc(_hmT(m ? 'Enregistrer' : 'Créer l’indicateur'))}</button>
        ${m ? `<button type="button" class="hm-btn ghost" onclick="hmOpenMetrics()">${esc(_hmT('Annuler'))}</button><span style="flex:1"></span><button type="button" class="hm-btn ghost" style="color:#C2533F" onclick="hmDeleteMetric('${m.id}')">${esc(_hmT('Supprimer'))}</button>` : ''}
      </div>
      ${m ? `<div class="hm-cat-g">${esc(_hmT('Importer des valeurs'))}</div>
        <p class="hm-sub" style="margin:0 0 6px">${esc(_hmT('Une ligne par valeur : date (AAAA-MM-JJ) puis valeur, séparées par une tabulation, un point-virgule ou une virgule.'))}</p>
        <textarea id="hm-m-imp" rows="5" placeholder="2026-10-01;125000&#10;2026-11-01;131500"></textarea>
        <div style="margin-top:8px"><button type="button" class="hm-btn" onclick="hmImport('${m.id}')">${esc(_hmT('Importer'))}</button></div>` : ''}
    </div>`);
}
async function _hmApi(url, method, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
async function hmSaveMetric(id) {
  const v = k => document.getElementById(k).value;
  const body = { label: v('hm-m-l').trim(), format: v('hm-m-f'), unit: v('hm-m-u').trim(), agg: v('hm-m-a'), freq: v('hm-m-q'), target: v('hm-m-t') === '' ? null : Number(v('hm-m-t')), better: v('hm-m-b') };
  try {
    const m = await _hmApi(id ? `/api/home/metrics/${id}` : '/api/home/metrics', id ? 'PUT' : 'POST', body);
    toast(_hmT('Indicateur enregistré'), 'success');
    await renderHome(); hmOpenMetrics(m.id);
  } catch (e) { toast(e.message, 'error'); }
}
async function hmDeleteMetric(id) {
  if (!confirm(_hmT('Supprimer cet indicateur et toutes ses valeurs ?'))) return;
  try { await _hmApi(`/api/home/metrics/${id}`, 'DELETE'); await renderHome(); hmOpenMetrics(); } catch (e) { toast(e.message, 'error'); }
}
async function hmImport(id) {
  const rows = document.getElementById('hm-m-imp').value.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    const [date, value] = l.split(/\t|;|,(?=\s*-?\d)/).map(x => x.trim());
    return { date, value: Number(String(value || '').replace(/\s/g, '').replace(',', '.')) };
  });
  try { const j = await _hmApi(`/api/home/metrics/${id}/entries`, 'POST', { entries: rows }); toast(`${j.added} ${_hmT('valeurs importées')}`, 'success'); await renderHome(); hmOpenMetrics(id); }
  catch (e) { toast(e.message, 'error'); }
}
async function hmAddEntry(ev, id) {
  ev.preventDefault();
  const f = ev.target;
  try { await _hmApi(`/api/home/metrics/${id}/entries`, 'POST', { entries: [{ date: f.date.value, value: Number(f.value.value) }] }); toast(_hmT('Valeur enregistrée'), 'success'); renderHome(); }
  catch (e) { toast(e.message, 'error'); }
}

// Premier affichage : l'accueil est la page ouverte au chargement.
document.addEventListener('DOMContentLoaded', () => setTimeout(() => {
  const p = document.getElementById('page-dashboard');
  if (p && p.classList.contains('active') && !HM.data) renderHome();
}, 200));
