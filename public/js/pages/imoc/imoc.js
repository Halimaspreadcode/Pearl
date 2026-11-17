// ══════════════════════════════════════════════════════════════
// TICKETS IMOC (Admin › Tickets IMOC)
//
// Visualisation des tickets relevés dans IMOC (eTicket). L'admin lance une
// requête : période, statut, puis ses identifiants IMOC. Le serveur se
// connecte, relève, ferme la session. Les identifiants ne sont jamais
// enregistrés ; les tickets, eux, sont gardés et s'accumulent d'une
// requête à l'autre (un ticket connu est mis à jour).
// ══════════════════════════════════════════════════════════════
const IMOC = {
  inst: (() => { try { return localStorage.getItem('imoc-inst') || 'sn'; } catch (e) { return 'sn'; } })(),
  data: null, conf: null, err: '', panel: '', job: null, jobTimer: null,
  q: '', pays: 'ALL', statut: '', etape: '', type: '', page: 1, tri: 'opened', sens: -1,
};
const IMOC_PAR_PAGE = 50;

async function _imocFetch(url, opts = {}) {
  const r = await fetch(`${API}${url}`, { ...opts, credentials: 'same-origin',
    headers: AdminSession.headers({ 'Content-Type': 'application/json' }) });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error('Session admin expirée : reconnecte-toi.');
  if (!r.ok) throw new Error(d.error || `Erreur ${r.status}`);
  return d;
}

async function renderImocPage() {
  const root = document.getElementById('imoc-root');
  if (!root) return;
  if (!IMOC.data) {
    root.innerHTML = '<div class="im"><p class="im-empty">Chargement…</p></div>';
    try {
      [IMOC.data, IMOC.conf] = await Promise.all([_imocFetch('/api/imoc/tickets'), _imocFetch('/api/imoc/config')]);
    } catch (e) { IMOC.err = e.message; IMOC.data = { tickets: [], runs: [] }; }
  }
  _imocPaint();
  // Le compteur de l'onglet « Mises à jour » se voit dès l'ouverture.
  if (IMOC.data.tickets?.length) imocChargerMaj();
}

const _imocJours = iso => {
  const t = Date.parse(String(iso || '').replace(' ', 'T'));
  return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 864e5)) : null;
};
const _imocDate = iso => {
  const s = String(iso || '');
  return s.length >= 16 ? `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}` : s;
};
const _MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const _imocJour = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(String(iso || '')); return m ? `${+m[3]} ${_MOIS[+m[2] - 1]}${m[4] ? ` · ${m[4]}` : ''}` : '—'; };
const _imocRel = iso => {
  const t = Date.parse(String(iso || '').replace(' ', 'T') + (/[zZ+]/.test(String(iso)) ? '' : 'Z'));
  if (!Number.isFinite(t)) return '—';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'à l\'instant'; if (m < 60) return `il y a ${m} min`;
  if (m < 1440) return `il y a ${Math.round(m / 60)} h`; return `il y a ${Math.round(m / 1440)} j`;
};
const _imocDepuis = iso => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!(m >= 0)) return '';
  if (m < 1) return 'à l\'instant';
  if (m < 60) return `il y a ${m} min`;
  if (m < 1440) return `il y a ${Math.round(m / 60)} h`;
  return `le ${new Date(iso).toLocaleDateString('fr-FR')}`;
};
const _imocOuvert = t => !t.closed && !/^(closed|finished|completed|cancel|archiv)/i.test(t.status || '');

function _imocFiltres() {
  const n = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const mots = n(IMOC.q).split(/\s+/).filter(Boolean);
  return (IMOC.data?.tickets || []).filter(t =>
    (IMOC.pays === 'ALL' || t.country === IMOC.pays)
    && (!IMOC.statut || (IMOC.statut === '_ouverts' ? _imocOuvert(t) : t.status === IMOC.statut))
    && (!IMOC.etape || t.step === IMOC.etape)
    && (!IMOC.type || t.type === IMOC.type)
    && (!mots.length || mots.every(m => n(`${t.number} ${t.title} ${t.handlers} ${t.creator} ${(t.groups || []).join(' ')}`).includes(m))));
}

function _imocPaint() {
  const root = document.getElementById('imoc-root');
  if (!root) return;
  const all = IMOC.data?.tickets || [];
  const runs = IMOC.data?.runs || [];
  const der = runs[0];
  const vis = _imocFiltres();
  const tri = IMOC.tri, s = IMOC.sens;
  vis.sort((a, b) => (tri === 'age'
    ? ((_imocJours(a.opened) ?? -1) - (_imocJours(b.opened) ?? -1))
    : String(a[tri] || '').localeCompare(String(b[tri] || ''))) * s);
  const pages = Math.max(1, Math.ceil(vis.length / IMOC_PAR_PAGE));
  if (IMOC.page > pages) IMOC.page = pages;
  const tranche = vis.slice((IMOC.page - 1) * IMOC_PAR_PAGE, IMOC.page * IMOC_PAR_PAGE);
  const uniq = k => [...new Set(all.map(t => t[k]).filter(Boolean))].sort();

  // Chiffres de la sélection (pays et filtres compris, recherche comprise).
  const ouverts = vis.filter(_imocOuvert);
  const vieux = ouverts.filter(t => (_imocJours(t.opened) ?? 0) > 7).length;
  const parEtape = {};
  ouverts.forEach(t => { const k = t.step || '—'; parEtape[k] = (parEtape[k] || 0) + 1; });
  const etapes = Object.entries(parEtape).sort((a, b) => b[1] - a[1]).slice(0, 4);

  const th = (k, l) => `<th><button type="button" class="${IMOC.tri === k ? 'is-on' : ''}" onclick="imocTri('${k}')">${l}${IMOC.tri === k ? (IMOC.sens > 0 ? ' ↑' : ' ↓') : ''}</button></th>`;
  const sel = (id, v, opts, vide) => `<select onchange="imocFiltre('${id}',this.value)"><option value="">${vide}</option>${opts.map(o =>
    `<option value="${esc(o[0])}"${v === o[0] ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;

  root.innerHTML = `<div class="im${IMOC.panel ? ' has-panel' : ''}">
    <header class="im-head">
      <div>
        <h1 class="page-title">Tickets IMOC</h1>
        <p class="page-sub">${all.length ? `${all.length} ticket${all.length > 1 ? 's' : ''} gardé${all.length > 1 ? 's' : ''}` : 'Aucun ticket relevé pour l\'instant'}${der ? ` · dernière requête ${esc(_imocDepuis(der.at))}${der.instance_name ? ` sur ${esc(der.instance_name)}` : ''} : ${der.count} lu${der.count > 1 ? 's' : ''}${der.total != null && der.count < der.total ? ` sur ${der.total}` : ''}, ${der.new} nouveau${der.new > 1 ? 'x' : ''}` : ''}</p>
      </div>
      <div class="im-head-a">
        <button type="button" class="im-btn" onclick="imocPanel('hist')">Historique</button>
        <button type="button" class="im-icon" onclick="imocPanel('conf')" title="Réglages du connecteur" aria-label="Réglages">⚙</button>
        <button type="button" class="im-btn is-pri" onclick="imocPanel('query')">Nouvelle requête</button>
      </div>
    </header>
    ${IMOC.err ? `<div class="im-alert">${esc(IMOC.err)}</div>` : ''}
    ${IMOC.job ? _imocJobHtml() : ''}
    ${all.length ? `<nav class="im-tabs" role="tablist">
      <button type="button" role="tab" class="${IMOC.vue === 'liste' ? 'is-on' : ''}" onclick="imocVue('liste')">Tickets relevés<span>${all.length}</span></button>
      <button type="button" role="tab" class="${IMOC.vue === 'ajout' ? 'is-on' : ''}" onclick="imocVue('ajout')">Ajouter aux trackers${IMOC.cand ? `<span>${IMOC.cand.candidates.filter(c => !c.ignored).length}</span>` : ''}</button>
      <button type="button" role="tab" class="${IMOC.vue === 'maj' ? 'is-on' : ''}" onclick="imocVue('maj')">Mises à jour${IMOC.maj ? `<span class="${IMOC.maj.updates.filter(u => !u.ignored).length ? 'is-hot' : ''}">${IMOC.maj.updates.filter(u => !u.ignored).length}</span>` : ''}</button>
    </nav>` : ''}
    ${all.length && IMOC.vue === 'maj' ? _imocMajHtml() : all.length && IMOC.vue === 'ajout' ? _imocAjoutHtml() : all.length ? `
    <section class="im-kpis">
      <div class="im-kpi"><span>Ouverts</span><b>${ouverts.length}</b></div>
      <div class="im-kpi${vieux ? ' is-warn' : ''}"><span>Ouverts depuis plus de 7 j</span><b>${vieux}</b></div>
      ${etapes.map(([k, n]) => `<button type="button" class="im-kpi is-btn${IMOC.etape === k ? ' is-on' : ''}" onclick="imocFiltre('etape', ${escAttrArg(IMOC.etape === k ? '' : k)})"><span>${esc(k)}</span><b>${n}</b></button>`).join('')}
    </section>
    <div class="im-bar">
      <div class="im-search"><input type="search" placeholder="N° de ticket, titre, groupe, personne…" value="${esc(IMOC.q)}" oninput="imocRecherche(this.value)" aria-label="Rechercher"></div>
      <div class="im-seg">${[['ALL', 'Tous'], ['SN', 'Sénégal'], ['CI', 'Côte d\'Ivoire']].map(([v, l]) =>
        `<button type="button" class="${IMOC.pays === v ? 'is-on' : ''}" onclick="imocFiltre('pays','${v}')">${l}</button>`).join('')}</div>
      ${sel('statut', IMOC.statut, [['_ouverts', 'Ouverts seulement'], ...uniq('status').map(x => [x, x])], 'Tous les statuts')}
      ${sel('etape', IMOC.etape, uniq('step').map(x => [x, x]), 'Toutes les étapes')}
      ${sel('type', IMOC.type, uniq('type').map(x => [x, x]), 'Tous les types')}
    </div>
    <p class="im-count">${vis.length} ticket${vis.length > 1 ? 's' : ''}${vis.length !== all.length ? ` sur ${all.length}` : ''}</p>
    <div class="im-table-w"><table class="im-table im-list">
      <thead><tr>${th('number', 'Ticket')}${th('step', 'Étape')}${th('status', 'Statut')}${th('opened', 'Ouvert')}${th('updated', 'Mis à jour')}<th aria-label="Ouvrir"></th></tr></thead>
      <tbody>${tranche.map(t => {
        const j = _imocJours(t.opened);
        const ouvert = _imocOuvert(t);
        const drapeau = { SN: '🇸🇳', CI: '🇨🇮' }[t.country] || '';
        const pr = t.detail && t.detail.priority;
        return `<tr class="is-click" onclick="if(!event.target.closest('a'))imocFiche(${escAttrArg(t.number)})">
          <td class="im-l-t">
            <div class="im-l-n"><b>${esc(t.number)}</b>${pr ? `<span class="im-pr" style="--c:${IMOC_COUL[pr] || 'var(--im-mute)'}"><i></i>${esc(pr)}</span>` : ''}${drapeau ? `<span class="im-flag" title="${t.country === 'CI' ? 'Côte d\'Ivoire' : 'Sénégal'}">${drapeau}</span>` : ''}${t.vip ? '<span class="im-vip">VIP</span>' : ''}</div>
            <div class="im-l-s" title="${esc(t.title)}">${esc(t.title)}${t.type ? `<span>· ${esc(t.type)}</span>` : ''}</div>
          </td>
          <td><span class="im-step">${esc(t.step || '—')}</span>${(t.groups || []).length ? `<small class="im-grp">${esc(t.groups.join(', '))}</small>` : ''}</td>
          <td><span class="im-stat ${ouvert ? 'is-open' : 'is-done'}"><i></i>${esc(t.status || '—')}</span></td>
          <td class="im-l-d"><b>${esc(_imocJour(t.opened))}</b><small class="${ouvert && j > 7 ? 'is-warn' : ''}">${j == null ? '' : j === 0 ? 'aujourd\'hui' : `il y a ${j} j`}</small></td>
          <td class="im-l-d"><small>${esc(_imocRel(t.updated))}</small></td>
          <td class="im-l-a">${t.url ? `<a class="im-open" href="${esc(t.url)}" target="_blank" rel="noopener" title="Ouvrir dans IMOC" aria-label="Ouvrir ${esc(t.number)} dans IMOC"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9"/></svg></a>` : ''}</td>
        </tr>`;
      }).join('') || `<tr><td colspan="6" class="im-empty">Aucun ticket ne correspond aux filtres.</td></tr>`}</tbody>
    </table></div>
    ${pages > 1 ? `<nav class="im-pager"><button type="button" ${IMOC.page <= 1 ? 'disabled' : ''} onclick="imocPage(-1)">‹</button><span>${IMOC.page} / ${pages}</span><button type="button" ${IMOC.page >= pages ? 'disabled' : ''} onclick="imocPage(1)">›</button></nav>` : ''}
    ` : `<section class="im-start">
      <b>Récupère les tickets d'IMOC</b>
      <p>Choisis une période, saisis ton identifiant IMOC : FOps se connecte, relève les tickets, puis ferme la session. Tes identifiants ne sont pas enregistrés ; les tickets, eux, restent ici.</p>
      <button type="button" class="im-btn is-pri" onclick="imocPanel('query')">Nouvelle requête</button>
    </section>`}
    <div class="im-scrim" onclick="imocPanel('')"></div>
    <aside class="im-panel" aria-hidden="${!IMOC.panel}">${IMOC.panel === 'query' ? _imocQueryHtml() : IMOC.panel === 'conf' ? _imocConfHtml() : IMOC.panel === 'hist' ? _imocHistHtml() : IMOC.panel === 'fiche' ? _imocFicheHtml() : ''}</aside>
  </div>`;
  if (IMOC.panel === 'query') setTimeout(() => document.getElementById('imoc-user')?.focus(), 30);
}

function imocTri(k) { if (IMOC.tri === k) IMOC.sens = -IMOC.sens; else { IMOC.tri = k; IMOC.sens = k === 'title' || k === 'number' ? 1 : -1; } _imocPaint(); }
function imocFiltre(k, v) { IMOC[k] = v; IMOC.page = 1; _imocPaint(); }
let _imocQT = null;
function imocRecherche(v) {
  IMOC.q = v; IMOC.page = 1;
  clearTimeout(_imocQT);
  _imocQT = setTimeout(() => { const pos = document.activeElement?.selectionStart; _imocPaint(); const i = document.querySelector('#imoc-root .im-search input'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch (e) {} } }, 200);
}
function imocPage(d) { IMOC.page += d; _imocPaint(); document.querySelector('#imoc-root .im-table-w')?.scrollIntoView({ block: 'start' }); }
function imocPanel(p) { IMOC.panel = p; IMOC.err = p ? IMOC.err : ''; _imocPaint(); }

// ── Requête ──
function _imocQueryHtml() {
  const auj = new Date().toISOString().slice(0, 10);
  const il = j => new Date(Date.now() - j * 864e5).toISOString().slice(0, 10);
  return `<div class="im-p-h"><b>Nouvelle requête IMOC</b><button type="button" class="im-icon is-sm" onclick="imocPanel('')" aria-label="Fermer">×</button></div>
    <form class="im-form" onsubmit="event.preventDefault();imocLancer(this)" autocomplete="off">
      <fieldset><legend>IMOC à interroger</legend>
        <div class="im-inst">${(IMOC.conf?.instances || []).map(i => `<label class="${(IMOC.inst || 'sn') === i.id ? 'is-on' : ''}">
          <input type="radio" name="instance" value="${esc(i.id)}" ${(IMOC.inst || 'sn') === i.id ? 'checked' : ''} onchange="IMOC.inst=this.value;this.closest('.im-inst').querySelectorAll('label').forEach(l=>l.classList.toggle('is-on',l.contains(this)))">
          <b>${esc(i.name)}</b><small>${esc(i.base_url)}</small></label>`).join('')}</div>
      </fieldset>
      <fieldset><legend>Période (date d'ouverture)</legend>
        <p class="im-note">Comme l'écran de recherche d'IMOC : les tickets ouverts pendant cette période. IMOC propose 3 mois par défaut.</p>
        <div class="im-presets">${[[7, '7 jours'], [30, '30 jours'], [90, '3 mois'], [182, '6 mois'], [365, '1 an']].map(([j, l]) =>
          `<button type="button" onclick="this.form.from.value='${il(j)}';this.form.to.value='${auj}'">${l}</button>`).join('')}</div>
        <div class="im-row"><label>Du<input type="date" name="from" value="${il(90)}" max="${auj}" required></label>
          <label>Au<input type="date" name="to" value="${auj}" max="${auj}" required></label></div>
        <label>Statut<select name="status"><option value="">Tous</option><option value="processing">En cours (processing)</option></select></label>
      </fieldset>
      <fieldset><legend>Connexion IMOC</legend>
        <p class="im-note">Utilisés pour cette requête seulement, jamais enregistrés. La session IMOC est fermée à la fin.</p>
        <label>Identifiant<input id="imoc-user" name="username" autocomplete="off" spellcheck="false" required></label>
        <label>Mot de passe<input name="password" type="password" autocomplete="new-password" required></label>
      </fieldset>
      <div class="im-p-f"><button type="button" class="im-btn" onclick="imocPanel('')">Annuler</button>
        <button type="submit" class="im-btn is-pri" ${IMOC.job ? 'disabled' : ''}>Se connecter et récupérer</button></div>
    </form>`;
}

async function imocLancer(f) {
  const body = { instance: (f.instance && f.instance.value) || IMOC.inst || 'sn', from: f.from.value, to: f.to.value, status: f.status.value, username: f.username.value.trim(), password: f.password.value };
  IMOC.inst = body.instance;
  try { localStorage.setItem('imoc-inst', body.instance); } catch (e) {}
  // Les champs sont vidés tout de suite : rien ne reste dans la page.
  f.password.value = ''; f.username.value = '';
  try {
    const r = await _imocFetch('/api/imoc/query', { method: 'POST', body: JSON.stringify(body) });
    body.password = '';
    IMOC.job = { id: r.job.id, etape: r.job.etape, debut: Date.now() };
    IMOC.panel = ''; IMOC.err = '';
    _imocPaint();
    _imocSuivre();
  } catch (e) { body.password = ''; IMOC.err = e.message; IMOC.panel = ''; _imocPaint(); }
}

function _imocJobHtml() {
  const s = Math.round((Date.now() - IMOC.job.debut) / 1000);
  const c = IMOC.job.code;
  return `<section class="im-job${c ? ' has-code' : ''}"><span class="im-job-dot"></span>
    <div><small>Requête IMOC en cours · <span id="imoc-job-t">${s} s</span></small><p id="imoc-job-e">${esc(IMOC.job.etape || 'Préparation…')}</p></div>
    <button type="button" class="im-btn" onclick="imocStop()">Stop</button>
    ${c ? `<form class="im-code" onsubmit="event.preventDefault();imocCode(this.code.value)" autocomplete="off">
      <img src="data:image/png;base64,${c.image}" alt="Code de vérification affiché par IMOC">
      <div class="im-code-r">
        <label>${c.essai > 1 ? 'Code refusé : nouveau code' : 'Code affiché par IMOC'}<input name="code" id="imoc-code" autocomplete="off" spellcheck="false" autocapitalize="off" required></label>
        <div class="im-code-a"><button type="button" class="im-btn" onclick="imocCode(null, true)">Autre image</button><button type="submit" class="im-btn is-pri">Valider</button></div>
      </div>
    </form>` : ''}</section>`;
}
async function imocCode(code, refresh) {
  if (!IMOC.job) return;
  const id = IMOC.job.id;
  IMOC.job.code = null; IMOC.job.etape = refresh ? 'Nouvelle image…' : 'Connexion à IMOC…'; _imocPaint();
  try { await _imocFetch(`/api/imoc/jobs/${id}/code`, { method: 'POST', body: JSON.stringify(refresh ? { refresh: true } : { code }) }); }
  catch (e) { IMOC.err = e.message; _imocPaint(); }
}
function _imocSuivre() {
  clearInterval(IMOC.jobTimer);
  IMOC.jobTimer = setInterval(async () => {
    if (!IMOC.job) return clearInterval(IMOC.jobTimer);
    const t = document.getElementById('imoc-job-t');
    if (t) t.textContent = `${Math.round((Date.now() - IMOC.job.debut) / 1000)} s`;
    let j;
    try { j = await _imocFetch(`/api/imoc/jobs/${IMOC.job.id}`); } catch (e) { j = { etat: 'erreur', erreur: e.message }; }
    if (j.etat === 'en_cours') {
      // Une image de code arrive (ou change) : on la montre et on place le curseur.
      const img = j.code && j.code.image;
      if ((img || null) !== (IMOC.job.code?.image || null)) {
        IMOC.job.code = j.code || null; IMOC.job.etape = j.etape; _imocPaint();
        if (img) setTimeout(() => document.getElementById('imoc-code')?.focus(), 30);
        return;
      }
      if (j.etape !== IMOC.job.etape) { IMOC.job.etape = j.etape; const e = document.getElementById('imoc-job-e'); if (e) e.textContent = j.etape; }
      return;
    }
    clearInterval(IMOC.jobTimer);
    IMOC.job = null;
    if (j.etat === 'fini') {
      const r = j.resultat || {};
      if (typeof toast === 'function') toast(`IMOC : ${r.count} tickets lus, ${r.new} nouveaux, ${r.updated} mis à jour`, 'success');
      IMOC.data = await _imocFetch('/api/imoc/tickets').catch(() => IMOC.data);
      IMOC.cand = null;
      await imocChargerMaj(true);
      const nMaj = (IMOC.maj?.updates || []).filter(u => !u.ignored).length;
      if (nMaj && typeof toast === 'function') toast(`${nMaj} ticket${nMaj > 1 ? 's' : ''} des trackers ${nMaj > 1 ? 'ont' : 'a'} changé dans IMOC : onglet Mises à jour`, 'success');
    } else if (j.etat !== 'annule') IMOC.err = j.erreur || 'La requête a échoué.';
    _imocPaint();
  }, 1000);
}
async function imocStop() {
  if (!IMOC.job) return;
  await _imocFetch(`/api/imoc/jobs/${IMOC.job.id}/cancel`, { method: 'POST', body: '{}' }).catch(() => {});
  clearInterval(IMOC.jobTimer); IMOC.job = null; _imocPaint();
}

// ── Réglages et historique ──
function _imocConfHtml() {
  const c = IMOC.conf || {};
  return `<div class="im-p-h"><b>Réglages du connecteur</b><button type="button" class="im-icon is-sm" onclick="imocPanel('')" aria-label="Fermer">×</button></div>
    <form class="im-form" onsubmit="event.preventDefault();imocConf(this)">
      ${(c.instances || []).map(i => `<fieldset class="im-inst-conf"><legend>${esc(i.name)}</legend>
        <label>Nom affiché<input name="name_${esc(i.id)}" value="${esc(i.name)}" maxlength="60"></label>
        <label>Adresse<input name="url_${esc(i.id)}" value="${esc(i.base_url)}" spellcheck="false" placeholder="https://…"></label></fieldset>`).join('')}
      <label>Navigateur utilisé par le serveur<input name="browser_path" value="${esc(c.browser_path || '')}" spellcheck="false" placeholder="Détection automatique"></label>
      <p class="im-note">${c.browser_found ? `Trouvé : <code>${esc(c.browser_found)}</code>` : 'Aucun navigateur trouvé sur le serveur. Sur la VM, dans le dossier de FOps : <code>npx playwright-core install chromium</code> (sans droits admin), ou <code>sudo apt install chromium</code>. Ou indique le chemin ci-dessus.'}</p>
      <label class="im-check"><input type="checkbox" name="proxy" ${c.proxy ? 'checked' : ''}> Passer par le proxy du système (laisser décoché : IMOC est sur le réseau interne)</label>
      <div class="im-p-f"><button type="submit" class="im-btn is-pri">Enregistrer</button></div>
    </form>`;
}
async function imocConf(f) {
  try {
    const instances = (IMOC.conf?.instances || []).map(i => ({ id: i.id, name: f['name_' + i.id].value, base_url: f['url_' + i.id].value }));
    IMOC.conf = await _imocFetch('/api/imoc/config', { method: 'PUT', body: JSON.stringify({ instances, browser_path: f.browser_path.value, proxy: f.proxy.checked }) });
    if (typeof toast === 'function') toast('Réglages enregistrés', 'success');
  } catch (e) { IMOC.err = e.message; }
  _imocPaint();
}
// Personne reconnue (FO, BO ou partie prenante) ou nom IMOC brut, avec un
// lien pour la ranger dans Configuration › Rôles et parties prenantes.
function _imocQui(q) {
  if (!q) return '—';
  if (q.sur) return `<span class="im-qui"><i style="background:${esc(q.color || 'var(--im-ink)')}"></i><b>${esc(q.name)}</b><small>${esc(q.role)}${q.role_label && q.role_label !== q.role ? ` · ${esc(q.role_label)}` : ''}${q.country ? ` · ${q.country === 'CI' ? 'Côte d\'Ivoire' : 'Sénégal'}` : ''}</small></span>`;
  return `<span class="im-qui is-unk"><b>${esc(q.nom)}</b>${q.org ? `<small>${esc(q.org)}</small>` : ''}<button type="button" class="im-link" onclick="imocRanger(${escAttrArg(q.brut)})">Ranger dans un rôle…</button></span>`;
}
function imocRanger(brut) {
  if (typeof PTY !== 'undefined') { PTY.test = brut; PTY.res = null; }
  window.renderPage('cfg-parties');
  setTimeout(() => { if (typeof ptyTester === 'function') ptyTester(brut); }, 400);
}

// ── Fiche détaillée d'un ticket (lue dans IMOC pendant la requête) ──
function imocFiche(n) { IMOC.fiche = n; imocPanel('fiche'); }
const IMOC_CLE_CODE = { oceane: 'Oceane_Ticket', created: 'Created_on', start: 'Start_date', initiator: 'Initiator', last_status: 'Last_Status',
  impact: 'Resource_impact', ticket_type: 'Resource_Ticket_type', priority: 'Processing_priority', origin: 'Origin1', equipment: 'Equipment_resource',
  country: 'Country', technician: 'Managing_Owner_technician', freeze: 'Freeze_dates', unfreeze: 'Unfreeze_date', restoration: 'Restoration_dates',
  resolution: 'Resolution_dates', closure: 'Closure_date', short_label: 'Short_label', final_nature: 'Final_natures', problem_family: 'Problems_family',
  problem_detail: 'Resource_Problem_family', support_unavail_min: 'Contractual_duration_of_support', service_unavail_min: 'Contractual_duration_of_service',
  etr_min: 'ETR_mins', ctr_min: 'CTR_mins' };
const IMOC_FICHE_GROUPES = [
  ['Ticket', ['oceane', 'ticket_type', 'priority', 'country', 'origin', 'impact', 'equipment', 'last_status', 'technician', 'initiator']],
  ['Dates', ['created', 'start', 'restoration', 'resolution', 'closure', 'freeze', 'unfreeze']],
  ['Cause', ['final_nature', 'problem_family', 'problem_detail', 'short_label']],
  ['Durées', ['support_unavail_min', 'service_unavail_min', 'etr_min', 'ctr_min']],
];
function _imocFicheHtml() {
  const t = (IMOC.data?.tickets || []).find(x => x.number === IMOC.fiche);
  if (!t) return '';
  const d = t.detail;
  const champ = k => (d?.fields || []).find(f => IMOC_CLE_CODE[k] && f.code.startsWith(IMOC_CLE_CODE[k]));
  const deja = new Set(['title']);
  const groupes = d ? IMOC_FICHE_GROUPES.map(([titre, cles]) => {
    const lignes = cles.filter(k => d[k]).map(k => { const f = champ(k); if (f) deja.add(f.code); return `<div><dt>${esc(f ? f.label : k)}</dt><dd>${esc(d[k])}</dd></div>`; }).join('');
    return lignes ? `<section class="im-f-g"><h4>${titre}</h4><dl>${lignes}</dl></section>` : '';
  }).join('') : '';
  const autres = d ? (d.fields || []).filter(f => !deja.has(f.code) && f.code !== 'Description') : [];
  return `<div class="im-p-h"><b>${esc(t.number)}</b><button type="button" class="im-icon is-sm" onclick="imocPanel('')" aria-label="Fermer">×</button></div>
    <p class="im-f-t">${esc(t.title)}</p>
    ${t.qui && (t.qui.initiator || t.qui.technician) ? `<dl class="im-f-qui">${t.qui.initiator ? `<div><dt>Ouvert par</dt><dd>${_imocQui(t.qui.initiator)}</dd></div>` : ''}${t.qui.technician ? `<div><dt>Suivi par</dt><dd>${_imocQui(t.qui.technician)}</dd></div>` : ''}</dl>` : ''}
    <div class="im-f-meta"><span class="im-step">${esc(t.step || '—')}</span><span class="im-stat ${_imocOuvert(t) ? 'is-open' : 'is-done'}"><i></i>${esc(t.status || '—')}</span>
      ${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener">Ouvrir dans IMOC ↗</a>` : ''}</div>
    ${d ? `${groupes}
      ${autres.length ? `<section class="im-f-g"><h4>Autres champs</h4><dl>${autres.map(f => `<div><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join('')}</dl></section>` : ''}
      ${d.description ? `<section class="im-f-g"><h4>Description</h4><p class="im-f-desc">${esc(d.description)}</p></section>` : ''}
      ${(d.comments || []).length ? `<section class="im-f-g"><h4>Commentaires</h4><ul class="im-f-log">${d.comments.map(c => `<li><b>${esc(c.user)}</b><small>${esc(c.at)}</small><p>${esc(c.text)}</p></li>`).join('')}</ul></section>` : ''}
      ${(d.logs || []).length ? `<section class="im-f-g"><h4>Historique dans IMOC</h4><ul class="im-f-log">${d.logs.map(l => `<li><b>${esc(l.step)}</b> · ${esc(l.user)}<small>${esc(l.at)}</small>${l.opinion ? `<p>${esc(l.opinion)}</p>` : ''}</li>`).join('')}</ul></section>` : ''}
      <p class="im-f-at">Fiche lue le ${esc(new Date(d.at).toLocaleString('fr-FR'))}</p>`
    : '<p class="im-empty">Fiche pas encore lue : elle le sera à la prochaine requête.</p>'}`;
}

function _imocHistHtml() {
  const runs = IMOC.data?.runs || [];
  return `<div class="im-p-h"><b>Historique des requêtes</b><button type="button" class="im-icon is-sm" onclick="imocPanel('')" aria-label="Fermer">×</button></div>
    ${runs.length ? `<ul class="im-hist">${runs.map(r => `<li><b>${esc(new Date(r.at).toLocaleString('fr-FR'))}</b>
      <span>${r.instance_name ? `${esc(r.instance_name)} · ` : ''}${esc(r.from)} → ${esc(r.to)}${r.status ? ` · ${esc(r.status)}` : ''}</span>
      <small>IMOC en compte ${r.total ?? r.count} · ${r.count} lus · ${r.new} nouveaux · ${r.updated} mis à jour${r.details != null ? ` · ${r.details} fiche${r.details > 1 ? 's' : ''} lue${r.details > 1 ? 's' : ''}${r.details_failed ? ` (${r.details_failed} en échec)` : ''}` : ''}</small>${r.total != null && r.count < r.total ? '<em>Lecture incomplète : relance la requête.</em>' : ''}</li>`).join('')}</ul>`
      : '<p class="im-empty">Aucune requête pour l\'instant.</p>'}`;
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && IMOC.panel && document.getElementById('page-imoc')?.classList.contains('active')) imocPanel('');
});

// ══ Ajout aux trackers (sur validation) ═══════════════════════
// Les tickets IMOC absents de FOps, chacun avec un ticket FOps proposé :
// ce qui se déduit est prérempli (repère « déduit »), le reste est à
// compléter. Rien n'est créé sans clic sur « Ajouter ».
IMOC.vue = 'liste';
IMOC.cand = null; IMOC.edits = {}; IMOC.sel = new Set(); IMOC.voirIgnores = false; IMOC.res = null;

async function imocVue(v) {
  IMOC.vue = v;
  if (v === 'ajout' && !IMOC.cand) await imocChargerCand();
  else if (v === 'maj') await imocChargerMaj();
  else _imocPaint();
}
async function imocChargerCand() {
  try { IMOC.cand = await _imocFetch('/api/imoc/candidates'); } catch (e) { IMOC.err = e.message; IMOC.cand = { candidates: [], ref: {}, required: [] }; }
  _imocPaint();
}
const _imocChamps = c => ({ ...c.fields, ...(IMOC.edits[c.ticket.number] || {}) });
const _imocManque = c => { const f = _imocChamps(c); return (IMOC.cand?.required || []).filter(k => !String(f[k] ?? '').trim()); };

// Revue en deux volets : la liste à gauche, le ticket FOps proposé à
// droite. Les choix courts se font par puces (couleurs P1→P4 et
// Critical→Warning comme partout), les longs par liste.
IMOC.focus = null; IMOC.filtreAjout = 'tous'; IMOC.qAjout = ''; IMOC.tous = false;
const IMOC_COUL = { P1: '#D64545', P2: '#E8833A', P3: '#E5B931', P4: '#3D7FD9', Critical: '#D64545', Major: '#E8833A', Minor: '#E5B931', Warning: '#3D7FD9' };
const IMOC_LIB = { sn_tt: 'Oceane TT#', title: 'titre', type: 'type', priority: 'priorité', severity: 'sévérité', status: 'statut',
  domain: 'domaine', fo_owner: 'FO', bo_handling: 'BO', occur_time: 'heure', open_date: 'ouverture', tracker: 'tracker' };

function _imocListeAjout() {
  const C = IMOC.cand;
  const n = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const q = n(IMOC.qAjout);
  return C.candidates.filter(c => {
    if (IMOC.filtreAjout === 'ignores') { if (!c.ignored) return false; }
    else if (c.ignored) return false;
    const m = _imocManque(c).length;
    if (IMOC.filtreAjout === 'acompleter' && !m) return false;
    if (IMOC.filtreAjout === 'prets' && m) return false;
    return !q || n(`${c.ticket.number} ${c.ticket.title} ${c.ticket.step}`).includes(q);
  });
}

function _imocAjoutHtml() {
  const C = IMOC.cand;
  if (!C) return '<p class="im-empty">Chargement…</p>';
  if (!C.candidates.length) return `<section class="im-start"><b>Tout est déjà dans les trackers</b><p>Chaque ticket IMOC relevé a son ticket dans FOps (même n° IMOC ou même Oceane TT#).</p></section>`;
  const actifs = C.candidates.filter(c => !c.ignored);
  const nb = { tous: actifs.length, acompleter: actifs.filter(c => _imocManque(c).length).length,
    prets: actifs.filter(c => !_imocManque(c).length).length, ignores: C.candidates.length - actifs.length };
  const liste = _imocListeAjout();
  if (!IMOC.focus || !liste.some(c => c.ticket.number === IMOC.focus)) IMOC.focus = liste[0]?.ticket.number || null;
  const sel = [...IMOC.sel].filter(n => actifs.some(c => c.ticket.number === n));
  const pretsSel = sel.filter(n => !_imocManque(actifs.find(c => c.ticket.number === n)).length).length;
  const q = n => escAttrArg(n);
  const drapeau = c => ({ sn: '🇸🇳', ci: '🇨🇮' }[_imocChamps(c).tracker] || '');

  const lignes = liste.map(c => {
    const n = c.ticket.number, m = _imocManque(c), on = n === IMOC.focus;
    const f = _imocChamps(c);
    // Ce qui est déjà choisi, lisible sans ouvrir le ticket.
    const pastilles = [f.priority, f.severity].filter(Boolean).map(v => `<span class="im-r-p"${IMOC_COUL[v] ? ` style="--c:${IMOC_COUL[v]}"` : ''}><i></i>${esc(v)}</span>`).join('')
      + (f.fo_owner ? `<span class="im-r-p">${esc(f.fo_owner)}</span>` : '');
    const etat = c.ignored ? '<span class="im-r-s is-ign">Ignoré</span>'
      : m.length ? `<span class="im-r-s is-todo" title="À compléter : ${esc(m.map(k => IMOC_LIB[k] || k).join(', '))}">${m.length} à compléter</span>`
      : '<span class="im-r-s is-ok">Prêt</span>';
    return `<li class="im-r${on ? ' is-on' : ''}${IMOC.sel.has(n) ? ' is-sel' : ''}">
      <label class="im-r-c"><input type="checkbox" ${IMOC.sel.has(n) ? 'checked' : ''} onchange="imocSel(${q(n)},this.checked)" aria-label="Sélectionner ${esc(n)}"><span></span></label>
      <button type="button" class="im-r-b" onclick="imocFocus(${q(n)})">
        <span class="im-r-n"><b>${esc(n)}</b>${drapeau(c)}${etat}</span>
        <span class="im-r-t">${esc(c.ticket.title)}</span>
        ${pastilles ? `<span class="im-r-ps">${pastilles}</span>` : ''}
      </button></li>`;
  }).join('');

  const c = C.candidates.find(x => x.ticket.number === IMOC.focus);
  return `
    ${IMOC.res ? `<div class="im-res">${IMOC.res.created.length ? `<b>✓ ${IMOC.res.created.length} ticket${IMOC.res.created.length > 1 ? 's' : ''} ajouté${IMOC.res.created.length > 1 ? 's' : ''} aux trackers.</b>` : ''}
      ${IMOC.res.refused.length ? `<ul>${IMOC.res.refused.map(r => `<li>${esc(r.number || '?')} : ${esc(r.error)}</li>`).join('')}</ul>` : ''}</div>` : ''}
    <div class="im-rv">
      <aside class="im-rv-l">
        <div class="im-rv-f">
          <input type="search" placeholder="Chercher un ticket…" value="${esc(IMOC.qAjout)}" oninput="IMOC.qAjout=this.value;_imocPaintGarde(this)" aria-label="Chercher">
          <div class="im-seg im-seg-sm">${[['tous', 'Tous'], ['acompleter', 'À compléter'], ['prets', 'Prêts'], ['ignores', 'Ignorés']].filter(([k]) => k !== 'ignores' || nb.ignores).map(([k, l]) =>
            `<button type="button" class="${IMOC.filtreAjout === k ? 'is-on' : ''}" onclick="IMOC.filtreAjout='${k}';_imocPaint()">${l} <span>${nb[k]}</span></button>`).join('')}</div>
        </div>
        <label class="im-rv-all"><input type="checkbox" ${liste.length && liste.every(x => IMOC.sel.has(x.ticket.number)) ? 'checked' : ''} onchange="imocSelListe(this.checked)"> Tout cocher (${liste.length})</label>
        <ul class="im-rv-list">${lignes || '<li class="im-empty">Aucun ticket ici.</li>'}</ul>
      </aside>
      <section class="im-rv-d">${c ? _imocEditeur(c, sel.length) : '<p class="im-empty">Choisis un ticket dans la liste.</p>'}</section>
    </div>
    <div class="im-foot">
      <span>${sel.length ? `<b>${sel.length}</b> coché${sel.length > 1 ? 's' : ''} · ${pretsSel} prêt${pretsSel > 1 ? 's' : ''}${sel.length - pretsSel ? ` · <b class="is-warn">${sel.length - pretsSel} à compléter</b>` : ''}` : 'Coche les tickets à ajouter, ou ouvre-les un par un.'}</span>
      <button type="button" class="im-btn is-pri" onclick="imocImporter()" ${pretsSel ? '' : 'disabled'}>${pretsSel ? `Ajouter ${pretsSel} ticket${pretsSel > 1 ? 's' : ''} prêt${pretsSel > 1 ? 's' : ''}` : 'Ajouter aux trackers'}</button>
    </div>`;
}

// FO : pris dans « Managing Owner technician » de la fiche IMOC. Reconnu
// dans la liste des FO → choisi ; sinon le nom IMOC est gardé tel quel et
// les FO les plus proches sont proposés.
function _imocFoHtml(c, f, liste) {
  const fi = c.fo_imoc;
  const fos = (IMOC.cand.ref || {}).fos || [];
  const horsListe = f.fo_owner && !fos.includes(f.fo_owner);
  const sel = liste('fo_owner', horsListe ? [f.fo_owner, ...fos] : fos, 'Choisir un FO');
  if (!fi) return sel;
  const props = (fi.suggestions || []).filter(x => x !== f.fo_owner);
  return `${sel}<div class="im-fo-imoc">
    <span>IMOC : <b>${esc(fi.nom)}</b>${horsListe ? ' · <em>pas dans la liste des FO</em>' : fi.connu && f.fo_owner === fi.suggestions[0] ? ' · <em class="is-ok">reconnu</em>' : ''}</span>
    ${props.length ? `<div class="im-fo-sug">${horsListe ? 'Remplacer par :' : 'Ou :'} ${props.map(x => `<button type="button" class="im-chip is-sm" onclick="imocSet('fo_owner',${escAttrArg(x)})">${esc(x)}</button>`).join('')}</div>` : ''}
    ${!horsListe && f.fo_owner !== fi.nom && !fi.connu ? `<button type="button" class="im-chip is-sm" onclick="imocSet('fo_owner',${escAttrArg(fi.nom)})">Garder le nom IMOC</button>` : ''}
  </div>`;
}

function _imocEditeur(c, nSel) {
  const R = IMOC.cand.ref || {};
  const f = _imocChamps(c), n = c.ticket.number, q = escAttrArg(n);
  const m = _imocManque(c);
  const etat = k => m.includes(k) ? ' is-missing' : (c.deduced.includes(k) && !(IMOC.edits[n] || {}).hasOwnProperty(k)) ? ' is-deduced' : '';
  const note = k => m.includes(k) ? '<em class="im-need">à choisir</em>' : (c.deduced.includes(k) && !(IMOC.edits[n] || {}).hasOwnProperty(k)) ? '<em class="im-ded">déduit d\'IMOC</em>' : '';
  const puces = (k, vals, lib = v => v) => `<div class="im-chips${etat(k)}">${(vals || []).map(v =>
    `<button type="button" class="im-chip${f[k] === v ? ' is-on' : ''}" style="${IMOC_COUL[v] ? `--c:${IMOC_COUL[v]}` : ''}" onclick="imocSet('${k}',${escAttrArg(v)})">${IMOC_COUL[v] ? '<i></i>' : ''}${esc(lib(v))}</button>`).join('')}</div>`;
  const liste = (k, vals, vide) => `<select class="im-sel${etat(k)}" onchange="imocSet('${k}',this.value)"><option value="">${vide}</option>${(vals || []).map(v => `<option${f[k] === v ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
  const champ = (k, label, html) => `<div class="im-fld"><div class="im-fld-h"><span>${label}</span>${note(k)}</div>${html}</div>`;
  const sansOc = f.sn_tt === '-';
  const t = c.ticket;
  const idx = _imocListeAjout().findIndex(x => x.ticket.number === n);
  return `<header class="im-ed-h">
      <div><small>Ticket IMOC</small><h2>${esc(n)}</h2><p>${esc(t.title)}</p>
        ${c.initiateur ? `<div class="im-ed-qui">Ouvert par ${_imocQui(c.initiateur)}</div>` : ''}
        <div class="im-ed-meta"><span>${esc(t.step || '—')}</span><span>Ouvert ${esc(_imocJour(t.opened))}</span>${(t.groups || []).length ? `<span>${esc(t.groups.join(', '))}</span>` : ''}${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener">Voir dans IMOC ↗</a>` : ''}</div></div>
      <div class="im-ed-nav">
        <button type="button" class="im-icon is-sm" ${idx > 0 ? `onclick="imocPas(-1)"` : 'disabled'} aria-label="Précédent">‹</button>
        <button type="button" class="im-icon is-sm" ${idx >= 0 && idx < _imocListeAjout().length - 1 ? `onclick="imocPas(1)"` : 'disabled'} aria-label="Suivant">›</button>
      </div>
    </header>
    ${nSel > 1 ? `<label class="im-ed-tous${IMOC.tous ? ' is-on' : ''}"><input type="checkbox" ${IMOC.tous ? 'checked' : ''} onchange="IMOC.tous=this.checked;_imocPaint()">
      Appliquer chaque choix aussi aux <b>${nSel} tickets cochés</b></label>` : ''}
    <div class="im-ed-g"><h3>Identification</h3>
      ${champ('tracker', 'Tracker', puces('tracker', ['sn', 'ci'], v => v === 'sn' ? '🇸🇳 Sénégal' : '🇨🇮 Côte d\'Ivoire'))}
      ${champ('sn_tt', 'Oceane TT#', `<div class="im-oc2${etat('sn_tt')}"><input value="${sansOc ? '' : esc(f.sn_tt)}" maxlength="15" ${sansOc ? 'disabled' : ''} placeholder="${sansOc ? 'Pas de ticket Oceane' : 'Ex. 2610M87721'}" onchange="imocSet('sn_tt',this.value)" spellcheck="false">
        <label class="im-sw"><input type="checkbox" ${sansOc ? 'checked' : ''} onchange="imocSet('sn_tt',this.checked?'-':'')"><span></span>Pas de ticket Oceane</label></div>`)}
    </div>
    <div class="im-ed-g"><h3>Classement</h3>
      ${champ('type', 'Type', puces('type', R.types))}
      ${champ('priority', 'Priorité', puces('priority', R.priorites))}
      ${champ('severity', 'Sévérité', puces('severity', R.severites))}
      ${champ('status', 'Statut', puces('status', R.statuts))}
    </div>
    <div class="im-ed-g"><h3>Responsables</h3>
      ${champ('domain', 'Domaine', (R.domaines || []).length <= 8 ? puces('domain', R.domaines) : liste('domain', R.domaines, 'Choisir un domaine'))}
      <div class="im-ed-2">
        ${champ('fo_owner', 'FO responsable', _imocFoHtml(c, f, liste))}
        ${champ('bo_handling', 'BO', liste('bo_handling', R.bos, 'Choisir un BO'))}
      </div>
    </div>
    <footer class="im-ed-f">
      <button type="button" class="im-link" onclick="imocIgnorer(${q},${!c.ignored})">${c.ignored ? 'Reprendre ce ticket' : 'Ignorer ce ticket'}</button>
      <span>${m.length ? `<b class="is-warn">Il manque : ${m.map(k => IMOC_LIB[k] || k).join(', ')}</b>` : '<b class="is-ok">✓ Prêt à être ajouté</b>'}</span>
      ${IMOC.sel.has(n) ? '' : `<button type="button" class="im-btn" onclick="imocSel(${q},true)">Cocher</button>`}
      <button type="button" class="im-btn is-pri" onclick="imocSuivant()">Suivant à compléter ›</button>
    </footer>`;
}

// Garde le curseur dans la recherche pendant le rafraîchissement.
function _imocPaintGarde(el) {
  const pos = el.selectionStart;
  clearTimeout(_imocQT);
  _imocQT = setTimeout(() => { _imocPaint(); const i = document.querySelector('#imoc-root .im-rv-f input'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch (e) {} } }, 150);
}
function imocFocus(n) { IMOC.focus = n; _imocPaint(); document.querySelector('#imoc-root .im-rv-d')?.scrollTo({ top: 0 }); }
function imocPas(d) {
  const l = _imocListeAjout(); const i = l.findIndex(x => x.ticket.number === IMOC.focus);
  if (l[i + d]) imocFocus(l[i + d].ticket.number);
}
function imocSuivant() {
  const l = _imocListeAjout(); const i = l.findIndex(x => x.ticket.number === IMOC.focus);
  const apres = [...l.slice(i + 1), ...l.slice(0, i)].find(x => _imocManque(x).length);
  if (apres) imocFocus(apres.ticket.number);
  else if (typeof toast === 'function') toast('Tous les tickets de la liste sont complets', 'success');
}
// Un choix dans le formulaire : pour le ticket ouvert, et pour tous les
// cochés si l'admin l'a demandé.
function imocSet(k, v) {
  const cibles = new Set([IMOC.focus]);
  if (IMOC.tous) IMOC.sel.forEach(n => cibles.add(n));
  cibles.forEach(n => { if (n) (IMOC.edits[n] = IMOC.edits[n] || {})[k] = v; });
  _imocPaint();
}
function imocEdit(n, k, v) { (IMOC.edits[n] = IMOC.edits[n] || {})[k] = v; _imocPaint(); }
function imocSel(n, on) { if (on) IMOC.sel.add(n); else IMOC.sel.delete(n); _imocPaint(); }
function imocSelListe(on) { _imocListeAjout().forEach(c => on ? IMOC.sel.add(c.ticket.number) : IMOC.sel.delete(c.ticket.number)); _imocPaint(); }
async function imocIgnorer(n, ignore) {
  try { await _imocFetch('/api/imoc/ignore', { method: 'POST', body: JSON.stringify({ numbers: [n], ignore }) }); IMOC.sel.delete(n); }
  catch (e) { IMOC.err = e.message; }
  await imocChargerCand();
}
async function imocImporter() {
  const items = (IMOC.cand?.candidates || []).filter(c => IMOC.sel.has(c.ticket.number) && !c.ignored && !_imocManque(c).length).map(c => ({ fields: _imocChamps(c) }));
  if (!items.length) return;
  if (!confirm(`Ajouter ${items.length} ticket${items.length > 1 ? 's' : ''} aux trackers ?`)) return;
  try {
    IMOC.res = await _imocFetch('/api/imoc/import', { method: 'POST', body: JSON.stringify({ items }) });
    IMOC.res.created.forEach(c => { IMOC.sel.delete(c.number); delete IMOC.edits[c.number]; });
    if (IMOC.res.created.length && typeof loadAll === 'function') loadAll().catch(() => {});
  } catch (e) { IMOC.err = e.message; }
  await imocChargerCand();
}


// ══ Mises à jour : tickets déjà dans un tracker qui ont changé dans IMOC ══
// Clôture ou réouverture constatée dans IMOC, proposée ici avec l'avant /
// après. Rien n'est écrit dans les trackers sans « Appliquer ».
IMOC.maj = null; IMOC.majVoirIgn = false; IMOC.majRes = null;
async function imocChargerMaj(silencieux) {
  try { IMOC.maj = await _imocFetch('/api/imoc/updates'); } catch (e) { if (!silencieux) IMOC.err = e.message; IMOC.maj = IMOC.maj || { updates: [] }; }
  _imocPaint();
}
const IMOC_CHAMP_MAJ = { status: 'Statut', close_date: 'Clôture', workaround_date: 'Rétabli' };
const _imocValMaj = (k, v) => !v ? '—' : /_date$/.test(k) ? (typeof fmtDt === 'function' ? fmtDt(v) : v) : v;

function _imocMajHtml() {
  const M = IMOC.maj;
  if (!M) return '<p class="im-empty">Chargement…</p>';
  const actifs = M.updates.filter(u => !u.ignored), ign = M.updates.length - actifs.length;
  const liste = IMOC.majVoirIgn ? M.updates.filter(u => u.ignored) : actifs;
  const res = IMOC.majRes ? `<div class="im-res">${IMOC.majRes.applied.length ? `<b>✓ ${IMOC.majRes.applied.length} ticket${IMOC.majRes.applied.length > 1 ? 's' : ''} mis à jour dans les trackers.</b>` : ''}
    ${IMOC.majRes.skipped.length ? `<ul>${IMOC.majRes.skipped.map(r => `<li>${esc(r.number)} : ${esc(r.error)}</li>`).join('')}</ul>` : ''}</div>` : '';
  if (!M.updates.length) return `${res}<section class="im-start"><b>Les trackers sont à jour</b><p>Aucun ticket ajouté depuis IMOC n'a été clôturé ou rouvert là-bas depuis. Relance une requête pour vérifier à nouveau : les tickets des trackers dont IMOC a changé apparaîtront ici.</p></section>`;
  const cartes = liste.map(u => {
    const q = escAttrArg(u.number);
    const ferme = u.changes.status?.to === 'Resolved' || (!u.changes.status && u.changes.close_date);
    return `<article class="im-mj">
      <div class="im-mj-h">
        <div><span class="im-mj-n"><b>${esc(u.number)}</b>${u.tracker === 'ci' ? '🇨🇮' : '🇸🇳'}${u.sn_tt ? `<span>${esc(u.sn_tt)}</span>` : ''}</span>
          <p>${esc(u.title)}${u.fo_owner ? ` · ${esc(u.fo_owner)}` : ''}</p></div>
        <span class="im-mj-m ${ferme ? 'is-close' : 'is-open'}">${esc(u.motif)}</span>
      </div>
      <dl class="im-mj-d">${Object.entries(u.changes).map(([k, v]) => `<div><dt>${IMOC_CHAMP_MAJ[k] || k}</dt><dd><s>${esc(_imocValMaj(k, v.from))}</s><i>→</i><b>${esc(_imocValMaj(k, v.to))}</b></dd></div>`).join('')}</dl>
      <div class="im-mj-f">
        <span>IMOC : ${esc(u.imoc.step || u.imoc.status || '—')}${u.imoc.updated ? ` · modifié ${esc(u.imoc.updated)}` : ''}${u.imoc.url ? ` · <a href="${esc(u.imoc.url)}" target="_blank" rel="noopener">Voir dans IMOC ↗</a>` : ''}</span>
        ${u.ignored ? `<button type="button" class="im-btn" onclick="imocMajIgnorer(${q},false)">Remettre</button>`
          : `<button type="button" class="im-btn" onclick="imocMajIgnorer(${q},true)">Ignorer</button><button type="button" class="im-btn is-pri" onclick="imocMajAppliquer([${q}])">Appliquer</button>`}
      </div>
    </article>`;
  }).join('');
  return `${res}
    <div class="im-mj-top">
      <p>${actifs.length ? `<b>${actifs.length}</b> ticket${actifs.length > 1 ? 's' : ''} des trackers ${actifs.length > 1 ? 'ont' : 'a'} changé dans IMOC. Vérifie l'avant / après puis applique : seuls le statut et la date de clôture sont modifiés.` : 'Tout est traité.'}</p>
      <div>${ign ? `<button type="button" class="im-btn" onclick="IMOC.majVoirIgn=!IMOC.majVoirIgn;_imocPaint()">${IMOC.majVoirIgn ? 'Voir à valider' : `Ignorés (${ign})`}</button>` : ''}
        ${!IMOC.majVoirIgn && actifs.length > 1 ? `<button type="button" class="im-btn is-pri" onclick="imocMajAppliquer(null)">Tout appliquer (${actifs.length})</button>` : ''}</div>
    </div>
    <div class="im-mj-list">${cartes || '<p class="im-empty">Rien ici.</p>'}</div>`;
}
async function imocMajIgnorer(n, ignore) {
  try { await _imocFetch('/api/imoc/updates/ignore', { method: 'POST', body: JSON.stringify({ numbers: [n], ignore }) }); }
  catch (e) { IMOC.err = e.message; }
  await imocChargerMaj();
}
async function imocMajAppliquer(numeros) {
  const nums = numeros || (IMOC.maj?.updates || []).filter(u => !u.ignored).map(u => u.number);
  if (!nums.length) return;
  if (!numeros && !confirm(`Mettre à jour ${nums.length} ticket${nums.length > 1 ? 's' : ''} dans les trackers ?`)) return;
  try {
    IMOC.majRes = await _imocFetch('/api/imoc/updates/apply', { method: 'POST', body: JSON.stringify({ numbers: nums }) });
    if (IMOC.majRes.applied.length && typeof loadAll === 'function') loadAll().catch(() => {});
  } catch (e) { IMOC.err = e.message; }
  await imocChargerMaj();
}
