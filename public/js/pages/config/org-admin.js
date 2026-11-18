// ══════════════════════════════════════════════════════════════
// ORGANISATION (comptes SaaS)
//
// Réservé au propriétaire et aux administrateurs de l'organisation.
// Onglets :
//   · Membres     : membres, rôles, invitations par lien, sièges occupés ;
//   · Abonnement  : offre, nombre de sièges, paiement mensuel ou annuel
//                   (propriétaire seulement), historique des changements ;
//   · Marque      : nom affiché, logo importé, couleur, slogan, aperçu ;
//   · Modules     : fonctions activées pour l'organisation ;
//   · Journal     : connexions, membres, invitations, abonnement, marque.
// ══════════════════════════════════════════════════════════════
const ORG_ROLES = [
  ['owner', 'Propriétaire', 'Tous les droits, abonnement compris.'],
  ['admin', 'Administrateur', 'Gère les membres, la marque et le paramétrage.'],
  ['manager', 'Manager', "Encadre l'équipe : planning, objectifs, rapports."],
  ['agent', 'Membre', 'Travaille au quotidien : tickets, tâches, demandes.'],
  ['observer', 'Lecture seule', 'Consulte sans modifier. Gratuit.'],
];
const ORG_ACTIONS = {
  'auth.login': 'Connexion', 'org.created': "Création de l'espace", 'org.branding': 'Marque modifiée', 'org.modules': 'Modules modifiés',
  'member.added': 'Membre ajouté', 'member.removed': 'Membre retiré', 'member.role': 'Rôle modifié',
  'invite.sent': 'Invitation envoyée', 'invite.accepted': 'Invitation acceptée', 'invite.revoked': 'Invitation révoquée', 'invite.renewed': 'Invitation renouvelée',
  'billing.changed': 'Abonnement modifié',
};
const _org = { tab: 'membres', data: null, mods: null, logo: undefined, draft: null };

const _orgT = s => (window.pearTr ? window.pearTr(s) : s);
const _orgRole = r => (ORG_ROLES.find(x => x[0] === r) || [r, r])[1];
const _orgMoney = (n, cur) => {
  try { return new Intl.NumberFormat(window.PEAR_LANG === 'en' ? 'en-GB' : 'fr-FR', { style: 'currency', currency: cur || 'EUR', maximumFractionDigits: n % 1 ? 2 : 0 }).format(n); }
  catch (_) { return `${n} €`; }
};
const _orgDate = (iso, time) => {
  if (!iso) return '—';
  const d = new Date(iso);
  const loc = window.PEAR_LANG === 'en' ? 'en-GB' : 'fr-FR';
  return time ? d.toLocaleString(loc, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(loc, { day: 'numeric', month: 'short', year: 'numeric' });
};
const _orgInitials = s => String(s || '?').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join('') || '?';

function _orgPeut() {
  const o = window.PearlOrg || {};
  return !!(o.accounts && o.account && ['owner', 'admin'].includes(o.account.role));
}

async function _orgSend(url, method, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

// Ancienne carte de Configuration › Général : elle renvoie à la page.
async function renderOrgAdmin() {
  const box = document.getElementById('org-admin');
  if (!box) return;
  const card = box.closest('.config-card');
  if (card) card.style.display = _orgPeut() ? '' : 'none';
  box.innerHTML = `<p class="org-sub" style="margin:0 0 10px">Membres, invitations, sièges, abonnement, marque et modules se gèrent dans la page Organisation.</p>
    <button type="button" class="btn btn-primary btn-sm" onclick="renderPage('organisation')">Ouvrir Organisation</button>`;
}

async function renderOrganisation(tab) {
  const box = document.getElementById('org-page');
  if (!box) return;
  if (tab) _org.tab = tab;
  if (!window.PearlOrg || !window.PearlOrg.pret) { setTimeout(() => renderOrganisation(), 200); return; }
  if (!_orgPeut()) {
    box.innerHTML = `<div class="org-locked"><h3>Accès réservé</h3><p>Seuls le propriétaire et les administrateurs de l'organisation gèrent cette page.</p></div>`;
    return;
  }
  try {
    const [d, mods] = await Promise.all([
      fetch('/api/platform/org', { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
      _org.mods ? _org.mods : fetch('/api/platform/modules-catalog').then(r => r.json()).catch(() => []),
    ]);
    _org.data = d; _org.mods = mods;
  } catch (e) {
    box.innerHTML = `<div class="org-locked">${esc(e.message)}</div>`;
    return;
  }
  _orgPaint();
}

function _orgPaint() {
  const box = document.getElementById('org-page');
  const d = _org.data, t = d.tenant, b = d.billing, br = t.branding || {};
  const plan = b.plans.find(p => p.id === b.plan) || {};
  const tabs = [
    ['membres', 'Membres', d.members.length], ['abonnement', 'Abonnement'], ['marque', 'Marque'],
    ['modules', 'Modules'], ['journal', 'Journal'],
  ];
  box.innerHTML = `
    <div class="org-head">
      <div class="org-head-id">
        <div class="org-head-logo">${br.logo ? `<img src="${esc(br.logo)}" alt="">` : `<span>${esc(_orgInitials(br.name || t.name))}</span>`}</div>
        <div>
          <div class="page-title" style="margin:0">${esc(br.name || t.name)}<span class="org-plan-chip"><i></i>${esc(plan.label || b.plan)}${b.trial ? ` · ${esc(_orgT('Essai'))}` : ''}</span></div>
          <div class="page-sub" style="margin:2px 0 0">${b.trial && b.trial_ends_at ? `${esc(_orgT("Essai gratuit jusqu'au"))} ${esc(_orgDate(b.trial_ends_at))}` : esc(_orgT('Espace de votre organisation'))}</div>
        </div>
      </div>
    </div>
    <div class="org-tabs" role="tablist">${tabs.map(([id, l, n]) => `<button type="button" role="tab" class="org-tab${_org.tab === id ? ' on' : ''}" onclick="renderOrganisation('${id}')">${esc(l)}${n != null ? `<span class="org-count">${n}</span>` : ''}</button>`).join('')}</div>
    <div id="org-body"></div>`;
  const body = document.getElementById('org-body');
  ({ membres: _orgMembres, abonnement: _orgAbonnement, marque: _orgMarque, modules: _orgModules, journal: _orgJournal })[_org.tab](body);
}

// ── Membres et invitations ────────────────────────────────────
function _orgSeatsHtml(b) {
  const pct = Math.min(100, Math.round((b.usage.used / b.seats) * 100));
  return `<div class="org-grid" style="margin-bottom:16px">
    <div class="org-kpi"><small>Sièges occupés</small><strong>${b.usage.used}</strong><em>/ ${b.seats}</em>
      <div class="org-seatbar${b.usage.used >= b.seats ? ' full' : ''}"><i style="width:${pct}%"></i></div></div>
    <div class="org-kpi"><small>Membres</small><strong>${b.usage.members}</strong><em>${b.free_observers ? `+ ${b.free_observers} ${esc(_orgT('en lecture seule'))}` : ''}</em></div>
    <div class="org-kpi"><small>Invitations en attente</small><strong>${_org.data.invites.length}</strong></div>
    <div class="org-kpi"><small>Sièges libres</small><strong>${Math.max(0, b.seats - b.usage.used)}</strong>
      ${_org.data.can_billing ? `<em><a href="#" onclick="renderOrganisation('abonnement');return false">${esc(_orgT('Ajouter des sièges'))}</a></em>` : ''}</div>
  </div>`;
}

function _orgMembres(body) {
  const d = _org.data, me = d.me || {};
  const isOwner = me.role === 'owner';
  const people = [...new Set([...(state.config.fo_list || []), ...((state.boList || []).map(x => x.name))])].filter(Boolean);
  const roleOpts = (sel, lock) => ORG_ROLES.filter(([v]) => v !== 'owner' || isOwner || sel === 'owner')
    .map(([v, l]) => `<option value="${v}"${v === sel ? ' selected' : ''}${lock && v !== sel ? ' disabled' : ''}>${esc(l)}</option>`).join('');
  const peopleOpts = sel => `<option value="">${esc(_orgT('Non associé'))}</option>` + people.map(p => `<option value="${esc(p)}"${p === sel ? ' selected' : ''}>${esc(p)}</option>`).join('');

  body.innerHTML = _orgSeatsHtml(d.billing) + `
    <div class="org-card">
      <h3>Inviter des personnes</h3>
      <p class="org-sub">Chaque personne reçoit un lien personnel, valable 7 jours, pour choisir son mot de passe. Les comptes en lecture seule ne consomment pas de siège.</p>
      <div class="org-row">
        <label style="flex:3;min-width:240px">Adresses email<input class="form-control" id="org-inv-emails" placeholder="prenom@entreprise.com, autre@entreprise.com" autocomplete="off"></label>
        <label style="min-width:170px">Rôle<select class="form-control" id="org-inv-role">${ORG_ROLES.filter(([v]) => v !== 'owner' || isOwner).map(([v, l]) => `<option value="${v}"${v === 'agent' ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <button type="button" class="btn btn-primary" id="org-inv-go" onclick="orgInvite()">Inviter</button>
      </div>
      <div class="org-note" id="org-role-help">${esc(_orgT(ORG_ROLES.find(r => r[0] === 'agent')[2]))}</div>
      <div id="org-inv-result"></div>
    </div>
    ${d.invites.length ? `<div class="org-card">
      <h3>Invitations en attente</h3>
      <table class="org-table"><thead><tr><th>Email</th><th>Rôle</th><th>Envoyée</th><th>Expire</th><th></th></tr></thead><tbody>
      ${d.invites.map(i => `<tr>
        <td><div class="org-person"><span class="org-avatar">${esc(_orgInitials(i.email))}</span><div>${esc(i.email)}<small>${esc(_orgT('par'))} ${esc(String(i.invited_by || '').replace(/^console:/, 'Pear · '))}</small></div></div></td>
        <td><span class="org-role">${esc(_orgRole(i.role))}</span></td>
        <td>${esc(_orgDate(i.created_at))}</td><td>${esc(_orgDate(i.expires_at))}</td>
        <td><div class="org-actions">
          <button type="button" class="btn btn-ghost btn-sm" onclick="orgRenewInvite('${esc(i.id)}')">Nouveau lien</button>
          <button type="button" class="btn btn-ghost btn-sm" onclick="orgRevokeInvite('${esc(i.id)}')">Révoquer</button></div></td>
      </tr>`).join('')}</tbody></table></div>` : ''}
    <div class="org-card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <h3 style="margin:0">Membres</h3>
        <input type="search" class="form-control" id="org-m-q" placeholder="Rechercher un membre…" style="max-width:260px" oninput="_orgFilterMembers(this.value)">
      </div>
      <table class="org-table" id="org-m-table"><thead><tr><th>Personne</th><th>Rôle</th><th>Fiche dans l’équipe</th><th>Depuis</th><th></th></tr></thead><tbody>
      ${d.members.map(m => {
        const self = m.user_id === me.id;
        const lock = (m.role === 'owner' && !isOwner) || self;
        return `<tr data-q="${esc(((m.email || '') + ' ' + (m.person_name || '')).toLowerCase())}">
          <td><div class="org-person"><span class="org-avatar">${esc(_orgInitials(m.person_name || m.email))}</span><div>${esc(m.person_name || m.email || m.user_id)}${self ? ` <span class="org-role">${esc(_orgT('vous'))}</span>` : ''}<small>${esc(m.email || '')}</small></div></div></td>
          <td><select class="form-control" ${lock ? 'disabled' : ''} onchange="orgUpdateMember('${esc(m.user_id)}', { role: this.value })">${roleOpts(m.role)}</select></td>
          <td><select class="form-control" onchange="orgUpdateMember('${esc(m.user_id)}', { person_name: this.value })">${peopleOpts(m.person_name)}</select></td>
          <td>${esc(_orgDate(m.created_at))}</td>
          <td><div class="org-actions">${lock ? '' : `<button type="button" class="btn btn-ghost btn-sm" onclick="orgRemoveMember('${esc(m.user_id)}', '${esc(m.email || '')}')">Retirer</button>`}</div></td>
        </tr>`;
      }).join('')}</tbody></table>
      <div class="org-note">La fiche dans l’équipe relie le compte à une personne du planning et des tickets : c'est sous ce nom que ses actions apparaissent.</div>
    </div>`;
  document.getElementById('org-inv-role').onchange = e => {
    document.getElementById('org-role-help').textContent = _orgT((ORG_ROLES.find(r => r[0] === e.target.value) || [])[2] || '');
  };
  document.getElementById('org-inv-emails').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); orgInvite(); } };
}

function _orgFilterMembers(q) {
  q = String(q || '').toLowerCase().trim();
  document.querySelectorAll('#org-m-table tbody tr').forEach(tr => { tr.hidden = q && !tr.dataset.q.includes(q); });
}

function _orgLinkHtml(inv) {
  const id = 'org-l-' + inv.id;
  return `<div class="org-link"><span style="min-width:180px;font-size:13px">${esc(inv.email)}${inv.mailed ? ` · <b>${esc(_orgT('email envoyé'))}</b>` : ''}</span>
    <input class="form-control" id="${id}" readonly value="${esc(inv.link)}" onclick="this.select()">
    <button type="button" class="btn btn-ghost btn-sm" onclick="orgCopy('${id}', this)">Copier</button></div>`;
}

async function orgCopy(id, btn) {
  const el = document.getElementById(id);
  try { await navigator.clipboard.writeText(el.value); } catch (_) { el.select(); document.execCommand('copy'); }
  const old = btn.textContent; btn.textContent = _orgT('Copié'); setTimeout(() => { btn.textContent = old; }, 1400);
}

async function orgInvite() {
  const emails = document.getElementById('org-inv-emails').value.trim();
  const role = document.getElementById('org-inv-role').value;
  const btn = document.getElementById('org-inv-go');
  if (!emails) { document.getElementById('org-inv-emails').focus(); return; }
  btn.disabled = true;
  try {
    const j = await _orgSend('/api/platform/invites', 'POST', { emails, role });
    await renderOrganisation('membres');
    const out = document.getElementById('org-inv-result');
    const mailedAll = j.invites.length && j.invites.every(i => i.mailed);
    out.innerHTML = `<div class="org-note" style="color:var(--m3-on-surface)"><b>${j.invites.length} ${esc(_orgT(j.invites.length > 1 ? 'invitations créées' : 'invitation créée'))}.</b> ${esc(_orgT(mailedAll ? 'Le lien est parti par email ; vous pouvez aussi le copier.' : 'Transmettez le lien à chaque personne (aucun serveur d’envoi configuré dans Diffusion).'))}</div>`
      + j.invites.map(_orgLinkHtml).join('')
      + (j.already_members.length ? `<div class="org-note">${esc(_orgT('Déjà membres'))} : ${esc(j.already_members.join(', '))}</div>` : '');
  } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
}

async function orgRenewInvite(id) {
  try {
    const j = await _orgSend(`/api/platform/invites/${encodeURIComponent(id)}/renew`, 'POST');
    await renderOrganisation('membres');
    document.getElementById('org-inv-result').innerHTML = `<div class="org-note">${esc(_orgT('Nouveau lien, valable 7 jours'))} :</div>` + _orgLinkHtml(j.invite);
  } catch (e) { toast(e.message, 'error'); }
}

async function orgRevokeInvite(id) {
  if (!confirm('Révoquer cette invitation ? Le lien ne fonctionnera plus.')) return;
  try { await _orgSend(`/api/platform/invites/${encodeURIComponent(id)}`, 'DELETE'); toast('Invitation révoquée', 'success'); renderOrganisation('membres'); }
  catch (e) { toast(e.message, 'error'); }
}

async function orgUpdateMember(uid, patch) {
  try { await _orgSend(`/api/platform/members/${encodeURIComponent(uid)}`, 'PUT', patch); toast('Membre mis à jour', 'success'); renderOrganisation(); }
  catch (e) { toast(e.message, 'error'); renderOrganisation(); }
}

async function orgRemoveMember(uid, email) {
  if (!confirm(`${_orgT("Retirer ce membre de l'organisation ?")}\n${email}`)) return;
  try { await _orgSend(`/api/platform/members/${encodeURIComponent(uid)}`, 'DELETE'); toast('Membre retiré', 'success'); renderOrganisation(); }
  catch (e) { toast(e.message, 'error'); }
}

// ── Abonnement ────────────────────────────────────────────────
function _orgAbonnement(body) {
  const b = _org.data.billing;
  const can = _org.data.can_billing;
  const dr = _org.draft || (_org.draft = { plan: b.plan, seats: b.seats, interval: b.interval });
  const plan = b.plans.find(p => p.id === dr.plan) || b.plans[0];
  const unit = dr.interval === 'year' ? plan.year_unit : plan.price;
  const monthly = Math.round(unit * dr.seats * 100) / 100;
  const changed = dr.plan !== b.plan || dr.seats !== b.seats || dr.interval !== b.interval;
  const minSeats = Math.max(1, b.usage.used);
  body.innerHTML = `
    <div class="org-grid" style="margin-bottom:16px">
      <div class="org-kpi"><small>Offre actuelle</small><strong style="font-size:20px">${esc((b.plans.find(p => p.id === b.plan) || {}).label || b.plan)}</strong><em>${esc(_orgT(b.interval === 'year' ? 'annuel' : 'mensuel'))}</em></div>
      <div class="org-kpi"><small>Sièges achetés</small><strong>${b.seats}</strong><em>${b.usage.used} ${esc(_orgT('occupés'))}</em></div>
      <div class="org-kpi"><small>Coût mensuel</small><strong>${esc(_orgMoney(b.price.monthly, b.currency))}</strong><em>HT</em></div>
      <div class="org-kpi"><small>${esc(_orgT(b.trial ? "Fin de l'essai" : 'Facturation'))}</small><strong style="font-size:18px">${esc(b.trial ? _orgDate(b.trial_ends_at) : _orgT(b.interval === 'year' ? 'Annuelle' : 'Mensuelle'))}</strong></div>
    </div>
    <div class="org-card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        <div><h3>Choisir l'offre</h3><p class="org-sub" style="margin:0">Le prix s'entend par siège et par mois. Les comptes en lecture seule sont gratuits.</p></div>
        <div class="org-seg">
          <button type="button" class="${dr.interval === 'month' ? 'on' : ''}" ${can ? '' : 'disabled'} onclick="_orgDraft({interval:'month'})">Mensuel</button>
          <button type="button" class="${dr.interval === 'year' ? 'on' : ''}" ${can ? '' : 'disabled'} onclick="_orgDraft({interval:'year'})">${esc(_orgT('Annuel'))} −${Math.round(b.year_discount * 100)} %</button>
        </div>
      </div>
      <div class="org-plans">${b.plans.map(p => `
        <button type="button" class="org-plan${p.id === dr.plan ? ' on' : ''}" ${can ? '' : 'disabled'} onclick="_orgDraft({plan:'${esc(p.id)}'})">
          <b>${esc(p.label)}</b>${p.id === b.plan ? ` <span class="org-role">${esc(_orgT('actuelle'))}</span>` : ''}
          <div class="org-price">${esc(_orgMoney(dr.interval === 'year' ? p.year_unit : p.price, b.currency))} <small>${esc(_orgT('/ siège / mois'))}</small></div>
          <div class="org-sub" style="margin:0">${esc(_orgT(p.desc))}</div>
          <ul>${p.features.map(f => `<li>${esc(_orgT(f))}</li>`).join('')}</ul>
        </button>`).join('')}</div>
      <div class="org-total">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <span style="font-weight:600">${esc(_orgT('Sièges'))}</span>
          <div class="org-stepper">
            <button type="button" aria-label="−" ${can ? '' : 'disabled'} onclick="_orgDraft({seats:${dr.seats - 1}})">−</button>
            <input type="number" id="org-seats" min="${minSeats}" max="10000" value="${dr.seats}" ${can ? '' : 'disabled'} onchange="_orgDraft({seats:Number(this.value)})">
            <button type="button" aria-label="+" ${can ? '' : 'disabled'} onclick="_orgDraft({seats:${dr.seats + 1}})">+</button>
          </div>
          <span class="org-note" style="margin:0">${esc(_orgT('Minimum'))} ${minSeats} : ${esc(_orgT('sièges occupés aujourd’hui'))}.</span>
        </div>
        <div style="text-align:right">
          <div><strong>${esc(_orgMoney(monthly, b.currency))}</strong> <span class="org-note">${esc(_orgT('HT / mois'))}</span></div>
          ${dr.interval === 'year' ? `<div class="org-note" style="margin:0">${esc(_orgMoney(Math.round(monthly * 12 * 100) / 100, b.currency))} ${esc(_orgT('facturés par an'))}</div>` : ''}
        </div>
      </div>
      ${can ? `<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
        ${changed ? `<button type="button" class="btn btn-ghost" onclick="_org.draft=null;renderOrganisation('abonnement')">Annuler</button>` : ''}
        <button type="button" class="btn btn-primary" ${changed ? '' : 'disabled'} onclick="orgSaveBilling()">Appliquer le changement</button></div>`
        : `<div class="org-note">Seul le propriétaire de l'organisation peut modifier l'abonnement.</div>`}
      ${b.provider === 'manual' ? `<div class="org-note">Le changement s'applique tout de suite ; la facture correspondante vous est adressée par Pear.</div>` : ''}
    </div>
    <div class="org-card">
      <h3>Historique</h3>
      ${b.history.length ? `<ul class="org-log">${b.history.map(h => `<li><time>${esc(_orgDate(h.at, true))}</time><div><span class="who">${esc(String(h.by).replace(/^console:/, 'Pear · '))}</span>
        <span class="what">${[h.plan && `${_orgT('offre')} ${_orgPlanLabel(h.plan[0])} → ${_orgPlanLabel(h.plan[1])}`, h.seats && `${_orgT('sièges')} ${h.seats[0]} → ${h.seats[1]}`, h.interval && `${_orgT('paiement')} ${_orgT(h.interval[0] === 'year' ? 'annuel' : 'mensuel')} → ${_orgT(h.interval[1] === 'year' ? 'annuel' : 'mensuel')}`].filter(Boolean).map(esc).join(' · ')}</span></div></li>`).join('')}</ul>`
        : `<div class="org-empty">Aucun changement pour l'instant.</div>`}
    </div>`;
}
const _orgPlanLabel = id => ((_org.data.billing.plans.find(p => p.id === id) || {}).label || id);

function _orgDraft(patch) {
  const b = _org.data.billing;
  const dr = _org.draft || { plan: b.plan, seats: b.seats, interval: b.interval };
  Object.assign(dr, patch);
  dr.seats = Math.max(Math.max(1, b.usage.used), Math.min(10000, Math.floor(Number(dr.seats) || 1)));
  _org.draft = dr;
  _orgAbonnement(document.getElementById('org-body'));
}

async function orgSaveBilling() {
  const dr = _org.draft;
  try {
    await _orgSend('/api/platform/billing', 'PUT', dr);
    _org.draft = null;
    toast('Abonnement mis à jour', 'success');
    renderOrganisation('abonnement');
  } catch (e) { toast(e.message, 'error'); }
}

// ── Marque ────────────────────────────────────────────────────
function _orgMarque(body) {
  const t = _org.data.tenant, br = t.branding || {};
  if (_org.logo === undefined) _org.logo = br.logo || '';
  const name = br.name || t.name || '';
  body.innerHTML = `
    <div class="org-card">
      <h3>Logo</h3>
      <p class="org-sub">Affiché dans la barre latérale, l'écran de connexion et les invitations. PNG, SVG, JPEG ou WebP, 200 Ko au plus ; un logo carré ou horizontal sur fond transparent rend le mieux.</p>
      <div class="org-drop" id="org-drop" tabindex="0" role="button">
        <div class="org-drop-prev" id="org-drop-prev">${_org.logo ? `<img src="${esc(_org.logo)}" alt="">` : `<span style="font-weight:700">${esc(_orgInitials(name))}</span>`}</div>
        <div style="flex:1"><b>Glissez votre logo ici</b><small>ou cliquez pour choisir un fichier</small></div>
        ${_org.logo ? `<button type="button" class="btn btn-ghost btn-sm" id="org-logo-rm">Retirer</button>` : ''}
      </div>
      <input type="file" id="org-logo-file" accept="image/png,image/svg+xml,image/jpeg,image/webp" hidden>
    </div>
    <div class="org-card">
      <h3>Identité</h3>
      <div class="org-row" style="margin-bottom:14px">
        <label style="flex:2;min-width:200px">Nom affiché<input class="form-control" id="org-name" maxlength="60" value="${esc(name)}"></label>
        <label style="flex:2;min-width:200px">Slogan<input class="form-control" id="org-tagline" maxlength="80" value="${esc(br.tagline || '')}" placeholder="Facultatif"></label>
        <label>Couleur<input class="form-control" id="org-primary" type="color" value="${esc(br.primary || '#4F6A85')}" style="width:64px;padding:2px;height:38px"></label>
      </div>
      <div class="org-sub" style="margin:0 0 8px">Aperçu</div>
      <div class="org-preview" id="org-preview"></div>
      <div style="display:flex;justify-content:flex-end;margin-top:14px"><button type="button" class="btn btn-primary" onclick="orgSaveBranding()">Enregistrer la marque</button></div>
    </div>`;
  const drop = document.getElementById('org-drop'), file = document.getElementById('org-logo-file');
  const pick = f => {
    if (!f) return;
    if (!/^image\/(png|svg\+xml|jpeg|webp)$/.test(f.type)) { toast('Format non pris en charge (PNG, SVG, JPEG ou WebP)', 'error'); return; }
    if (f.size > 150 * 1024) { toast('Logo trop lourd (150 Ko maximum)', 'error'); return; }
    const rd = new FileReader();
    rd.onload = () => { _org.logo = rd.result; _orgMarque(body); };
    rd.readAsDataURL(f);
  };
  drop.onclick = e => { if (e.target.id !== 'org-logo-rm') file.click(); };
  drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } };
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); pick(e.dataTransfer.files[0]); };
  file.onchange = () => pick(file.files[0]);
  const rm = document.getElementById('org-logo-rm');
  if (rm) rm.onclick = e => { e.stopPropagation(); _org.logo = ''; _orgMarque(body); };
  ['org-name', 'org-tagline', 'org-primary'].forEach(id => { document.getElementById(id).oninput = _orgPreview; });
  _orgPreview();
}

function _orgPreview() {
  const el = document.getElementById('org-preview');
  if (!el) return;
  const name = document.getElementById('org-name').value || '—';
  el.style.setProperty('--pv-accent', document.getElementById('org-primary').value);
  el.innerHTML = `<div class="org-preview-sb">
      <div class="org-preview-brand">${_org.logo ? `<img src="${esc(_org.logo)}" alt="">` : '<span class="ph"></span>'}<span>${esc(name)}</span></div>
      <div style="font-size:11px;color:var(--m3-on-surf-var)">${esc(document.getElementById('org-tagline').value)}</div>
      <div class="org-preview-item on" style="width:80%"></div><div class="org-preview-item" style="width:60%"></div><div class="org-preview-item" style="width:70%"></div>
    </div>
    <div class="org-preview-main"><div class="org-preview-item" style="width:40%;height:12px"></div><div class="org-preview-item" style="width:85%"></div><div class="org-preview-item" style="width:65%"></div>
      <span class="org-preview-btn">${esc(_orgT('Action'))}</span></div>`;
}

async function orgSaveBranding() {
  const body = {
    name: document.getElementById('org-name').value.trim(),
    primary: document.getElementById('org-primary').value,
    tagline: document.getElementById('org-tagline').value.trim(),
    logo: _org.logo || '',
  };
  try {
    await _orgSend('/api/platform/branding', 'PUT', body);
    toast('Marque enregistrée', 'success');
    setTimeout(() => location.reload(), 500);
  } catch (e) { toast(e.message, 'error'); }
}

// ── Modules ───────────────────────────────────────────────────
function _orgModules(body) {
  const on = new Set((window.PearlOrg && window.PearlOrg.modules) || []);
  body.innerHTML = `<div class="org-card">
      <h3>Modules de l'organisation</h3>
      <p class="org-sub">Un module désactivé disparaît du menu de tout le monde ; ses données sont conservées et reviennent si vous le réactivez.</p>
      <div class="org-mods">${_org.mods.map(m => `
        <label class="org-mod${m.always ? ' locked' : ''}">
          <input type="checkbox" class="org-modcb" value="${esc(m.id)}" ${on.has(m.id) ? 'checked' : ''} ${m.always ? 'disabled' : ''}>
          <span><b>${esc(m.label)}</b><small>${esc(m.desc || '')}${m.depends && m.depends.filter(x => x !== 'core').length ? ` · ${esc(_orgT('nécessite'))} ${esc(m.depends.filter(x => x !== 'core').map(x => (_org.mods.find(y => y.id === x) || {}).label || x).join(', '))}` : ''}</small></span>
        </label>`).join('')}</div>
      <div style="display:flex;justify-content:flex-end;margin-top:14px"><button type="button" class="btn btn-primary" onclick="orgSaveModules()">Enregistrer les modules</button></div>
    </div>`;
}

async function orgSaveModules() {
  const modules = [...document.querySelectorAll('.org-modcb:checked')].map(x => x.value);
  try { await _orgSend('/api/platform/modules', 'PUT', { modules }); toast('Modules enregistrés', 'success'); setTimeout(() => location.reload(), 500); }
  catch (e) { toast(e.message, 'error'); }
}

// ── Journal ───────────────────────────────────────────────────
async function _orgJournal(body) {
  body.innerHTML = `<div class="org-card"><div class="org-empty">…</div></div>`;
  const list = await fetch('/api/platform/activity?limit=300').then(r => (r.ok ? r.json() : [])).catch(() => []);
  const filters = [['', 'Tout'], ['auth', 'Connexions'], ['member', 'Membres'], ['invite', 'Invitations'], ['billing', 'Abonnement'], ['org', 'Organisation']];
  const f = _org.logFilter || '';
  const shown = f ? list.filter(e => e.action.startsWith(f + '.')) : list;
  const detail = e => {
    const d = e.details || {};
    if (e.action === 'member.role') return `${d.email} : ${_orgRole(d.from)} → ${_orgRole(d.to)}`;
    if (e.action === 'invite.sent') return `${(d.emails || []).join(', ')} (${_orgRole(d.role)})`;
    if (e.action === 'billing.changed') return [d.plan && `${_orgPlanLabel(d.plan[0])} → ${_orgPlanLabel(d.plan[1])}`, d.seats && `${d.seats[0]} → ${d.seats[1]} ${_orgT('sièges')}`, d.interval && `${d.interval[0]} → ${d.interval[1]}`].filter(Boolean).join(' · ');
    if (d.email) return d.email + (d.role ? ` (${_orgRole(d.role)})` : '');
    if (e.action === 'auth.login' && d.role) return _orgRole(d.role);
    return '';
  };
  body.innerHTML = `<div class="org-card">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
      <div><h3>Journal d'activité</h3><p class="org-sub" style="margin:0">Qui s'est connecté, qui a invité qui, ce qui a changé dans l'organisation.</p></div>
      <div class="org-seg">${filters.map(([v, l]) => `<button type="button" class="${f === v ? 'on' : ''}" onclick="_org.logFilter='${v}';_orgJournal(document.getElementById('org-body'))">${esc(_orgT(l))}</button>`).join('')}</div>
    </div>
    ${shown.length ? `<ul class="org-log">${shown.map(e => `<li><time>${esc(_orgDate(e.at, true))}</time><div><span class="who">${esc(String(e.actor).replace(/^console:/, 'Pear · '))}</span> <span class="what">· ${esc(_orgT(ORG_ACTIONS[e.action] || e.action))}${detail(e) ? ` · ${esc(detail(e))}` : ''}</span></div></li>`).join('')}</ul>`
      : `<div class="org-empty">Rien à afficher pour l'instant.</div>`}
  </div>`;
}
