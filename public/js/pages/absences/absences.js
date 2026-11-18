/* ══════════════════════════════════════════════════════════════
   SUIVI DES ABSENCES
   Page verrouillée par un mot de passe propre, distinct de l'admin.
   Contrairement aux autres gates du produit — qui masquent des données
   déjà chargées — ici les routes serveur exigent le jeton : sans
   déverrouillage, le client n'a jamais les données en mémoire.
══════════════════════════════════════════════════════════════ */

const ABSENCE_TOKEN_KEY = 'fo-absence-token';

const AbsenceSession = {
  get token() { return sessionStorage.getItem(ABSENCE_TOKEN_KEY) || ''; },
  set(t)      { sessionStorage.setItem(ABSENCE_TOKEN_KEY, t); },
  clear()     { sessionStorage.removeItem(ABSENCE_TOKEN_KEY); },
  headers(extra) {
    // Le jeton admin part avec : le serveur accepte l'un ou l'autre pour
    // les routes d'absence, ce qui évite un second mot de passe à
    // quelqu'un déjà authentifié comme administrateur.
    const h = { 'X-Absence-Token': this.token };
    if (typeof AdminSession !== 'undefined' && AdminSession.active)
      h['X-Admin-Token'] = AdminSession.token;
    return Object.assign(h, extra || {});
  },
  async login(password) {
    try {
      // L'identifiant part avec le mot de passe : le serveur vérifie
      // qu'il figure dans la liste blanche définie côté admin.
      const res = await fetch(`${API}/api/absences/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          employeeId: (typeof currentUser !== 'undefined' && currentUser?.employeeId) || '',
        }),
      });
      if (res.status === 429) return { ok: false, error: 'Too many attempts. Try again later.' };
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) return { ok: false, error: d.error || 'Access denied' };
      this.set(d.token);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Serveur injoignable' };
    }
  },
  async check() {
    // Une session admin vaut déverrouillage : inutile de demander le
    // secret Absences à quelqu'un qui a déjà prouvé son identité.
    if (typeof AdminSession !== 'undefined' && AdminSession.active) return true;
    if (!this.token) return false;
    try {
      const res = await fetch(`${API}/api/absences/session`, { headers: this.headers() });
      const d = await res.json().catch(() => ({}));
      if (!d.ok) this.clear();
      return !!d.ok;
    } catch { return false; }
  },
  async logout() {
    try {
      await fetch(`${API}/api/absences/logout`, { method: 'POST', headers: this.headers() });
    } catch { /* le jeton est purgé côté client de toute façon */ }
    this.clear();
    absState.data = null;
    absState.summary = null;
    // Sous session admin, la page se rouvrirait aussitôt : le verrou
    // Absences n'est plus ce qui la garde fermée. On le dit, plutôt que
    // de laisser un bouton qui semble ne rien faire.
    if (typeof AdminSession !== 'undefined' && AdminSession.active) {
      if (typeof toast === 'function')
        toast('Session admin active : les absences restent accessibles.', 'success');
      window.renderPage('dashboard');
      return;
    }
    window.renderPage('absences');
  },
};

// État local de la page. `month` pilote le calendrier, `year` la
// période de calcul ; les deux sont indépendants pour qu'on puisse
// feuilleter les mois sans recharger la synthèse annuelle.
const absState = {
  data: null,      // liste brute des absences
  summary: null,   // soldes / KPI / conflits calculés serveur
  month: null,     // 'YYYY-MM' affiché dans le calendrier
  year: null,
  foReqOpen: false, // « Demandes des agents » replié par défaut
};

// Palette : une teinte par type, alignée sur les variables CSS de la
// page pour que calendrier, légende et tableau ne divergent jamais.
const ABS_COLORS = {
  'Paid leave':        'var(--abs-conges)',
  'RTT':                 'var(--abs-rtt)',
  'Maladie':             'var(--abs-sick)',
  'Accident travail':    'var(--abs-sick)',
  'Maternity leave':           'var(--abs-family)',
  'Paternity leave':           'var(--abs-family)',
  'Formation':           'var(--abs-train)',
  'On-Site (Delivery)':  'var(--abs-onsite)',
  'Unpaid leave':        'var(--abs-unpaid)',
  'Unexcused absence': 'var(--abs-abs)',
  'Autre':               'var(--abs-other)',
};
const absColor = t => ABS_COLORS[t] || 'var(--abs-other)';

// Les valeurs restent en français : elles sont écrites telles quelles
// dans data/absences.json et servent aussi de suffixe de classe CSS
// (.st-Validée). Les renommer orphelinerait les enregistrements
// existants. Seul l'affichage passe en anglais, via ABS_STATUS_LABEL.
const ABS_STATUSES = ['Demandée', 'Validée', 'Refusée', 'Annulée'];
const ABS_STATUS_LABEL = {
  'Demandée': 'Requested',
  'Validée':  'Approved',
  'Refusée':  'Rejected',
  'Rejected':  'Rejected',
  'Annulée':  'Cancelled',
};
const absStatusLabel = s => ABS_STATUS_LABEL[s] || s;

// Niveaux de préavis, dans l'ordre du meilleur au pire. Les clés
// doivent rester alignées sur ABSENCE_NOTICES côté serveur.
const ABS_NOTICES = [
  "Prévenu à l'avance",
  'Prévenu le jour même',
  'Prévenu en retard',
  'Non prévenu',
];
// Mêmes précautions que pour les statuts : ces libellés servent de clés
// (serveur, classes, données enregistrées), seul l'affichage est traduit.
const ABS_NOTICE_LABEL = {
  "Prévenu à l'avance":   'Notified in advance',
  'Prévenu le jour même': 'Notified same day',
  'Prévenu en retard':    'Notified late',
  'Non prévenu':          'No notice',
  'À qualifier':          'To be qualified',
};
const absNoticeLabel = n => ABS_NOTICE_LABEL[n] || n;

// Les types d'absence sont eux aussi stockés en clair dans les données.
const ABS_TYPE_LABEL = {
  'Paid leave':         'Paid leave',
  'RTT':                  'TOIL',
  'Maladie':              'Sick leave',
  'Formation':            'Training',
  'Unexcused absence':  'Unexcused absence',
  'Time off in lieu':         'Time off in lieu',
  'Unpaid leave':     'Unpaid leave',
  'Maternity leave':            'Maternity leave',
  'Paternity leave':            'Paternity leave',
};
const absTypeLabel = t => ABS_TYPE_LABEL[t] || t;

// Classe CSS par niveau : porte la lecture couleur de la colonne.
const ABS_NOTICE_CLS = {
  "Prévenu à l'avance":   'ok',
  'Prévenu le jour même': 'ok',
  'Prévenu en retard':    'late',
  'Non prévenu':          'ko',
};
// Un préavis absent n'est pas « non prévenu » : c'est une donnée
// manquante, souvent sur une absence saisie après coup.
const absNoticeCls = n => (n ? (ABS_NOTICE_CLS[n] || 'unknown') : 'unknown');

// ── Verrou ─────────────────────────────────────────────────────
async function verifyAbsenceAccess() {
  const input = document.getElementById('abs-password');
  const errEl = document.getElementById('abs-auth-error');
  const btn   = document.getElementById('abs-submit');
  const pw    = input ? input.value : '';

  if (!pw) {
    if (errEl) { errEl.textContent = 'Enter the password.'; errEl.style.display = 'block'; }
    input?.focus();
    return;
  }
  if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Checking…'; }
  if (errEl) errEl.style.display = 'none';

  const r = await AbsenceSession.login(pw);

  if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label || 'Sign in'; }
  if (!r.ok) {
    if (errEl) { errEl.textContent = r.error; errEl.style.display = 'block'; }
    if (input) { input.value = ''; input.focus(); }
    return;
  }
  if (input) input.value = '';
  _renderAbsencePage();
}

// Point d'entrée de la page : montre le verrou ou le contenu.
async function _renderAbsencePage() {
  const lock = document.getElementById('abs-login-screen');
  const main = document.getElementById('abs-main-screen');
  const ok   = await AbsenceSession.check();
  if (lock) lock.style.display = ok ? 'none' : 'flex';
  if (main) main.style.display = ok ? 'block' : 'none';
  if (!ok) {
    const i = document.getElementById('abs-password');
    if (i) i.value = '';
    const e = document.getElementById('abs-auth-error');
    if (e) e.style.display = 'none';
    // Le badge ne doit pas fuiter un compte de demandes quand la page
    // est verrouillée.
    const b = document.getElementById('abs-pending-badge');
    if (b) b.style.display = 'none';
    return;
  }
  await renderAbsences();
}

// ── Chargement + rendu global ──────────────────────────────────
async function renderAbsences() {
  const yearSel = document.getElementById('abs-year');
  // Années sélectionnables : l'an dernier, l'année en cours, l'an
  // prochain — les congés se posent souvent à cheval sur deux années.
  if (yearSel && !yearSel.options.length) {
    const y = new Date().getFullYear();
    yearSel.innerHTML = [y - 1, y, y + 1]
      .map(v => `<option value="${v}"${v === y ? ' selected' : ''}>${v}</option>`).join('');
  }
  absState.year = Number(yearSel?.value) || new Date().getFullYear();
  if (!absState.month || !absState.month.startsWith(String(absState.year))) {
    const now = new Date();
    absState.month = now.getFullYear() === absState.year
      ? `${absState.year}-${String(now.getMonth() + 1).padStart(2, '0')}`
      : `${absState.year}-01`;
  }

  const country = (typeof currentCountry !== 'undefined' && currentCountry !== 'ALL')
    ? currentCountry : '';
  const qs = `year=${absState.year}${country ? `&country=${country}` : ''}`;

  try {
    const [listRes, sumRes] = await Promise.all([
      fetch(`${API}/api/absences`, { headers: AbsenceSession.headers() }),
      fetch(`${API}/api/absences/summary?${qs}`, { headers: AbsenceSession.headers() }),
    ]);
    // Session expirée côté serveur (redémarrage, 8 h écoulées) : on
    // repasse par le verrou plutôt que d'afficher une page vide.
    if (listRes.status === 401 || sumRes.status === 401) {
      AbsenceSession.clear();
      return _renderAbsencePage();
    }
    absState.data    = await listRes.json();
    absState.summary = await sumRes.json();
  } catch {
    toast('Could not load absences', 'error');
    return;
  }

  _absFillFilters();
  _absRenderKpis();
  _absRenderConflicts();
  _absRenderFoRequests();
  _absRenderCalendar();
  _absRenderBalances();
  renderAbsenceList();

  const lbl = document.getElementById('abs-period-label');
  const s = absState.summary || {};
  if (lbl) {
    lbl.textContent = `${s.headcount || 0} agents · ${s.working_days || 0} working days in ${absState.year}`
      + (country ? ` · ${country}` : '');
  }
  const badge = document.getElementById('abs-pending-badge');
  if (badge) {
    const n = s.pending_count || 0;
    badge.textContent = n;
    badge.style.display = n ? '' : 'none';
  }
}

// Alimente les listes déroulantes de filtre à partir des données.
function _absFillFilters() {
  const s = absState.summary || {};
  // `lab` traduit l'étiquette affichée sans toucher à la valeur envoyée
  // au serveur : les filtres continuent de porter la chaîne enregistrée.
  const keep = (sel, opts, all, lab = x => x) => {
    const el = document.getElementById(sel);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = `<option value="">${all}</option>` +
      opts.map(o => `<option value="${esc(o)}">${esc(lab(o))}</option>`).join('');
    if (opts.includes(cur)) el.value = cur;
  };
  const agents = (s.balances || []).map(b => b.fo_name);
  // Un agent sorti de fo_list peut encore porter des absences passées :
  // on l'ajoute pour qu'il reste filtrable.
  for (const a of absState.data || []) if (!agents.includes(a.fo_name)) agents.push(a.fo_name);
  keep('abs-f-agent', agents.sort(), 'All agents');
  keep('abs-f-type', Object.keys(s.types || ABS_COLORS), 'All types', absTypeLabel);
  keep('abs-f-status', s.statuses || ABS_STATUSES, 'All statuses', absStatusLabel);
  // « À qualifier » est une valeur de filtre à part entière : c'est la
  // liste de travail pour compléter les préavis manquants.
  keep('abs-f-notice', Object.keys(s.notices || {}).length
    ? Object.keys(s.notices).concat('À qualifier')
    : ABS_NOTICES.concat('À qualifier'), 'All notice periods', absNoticeLabel);
}

// ── KPI ────────────────────────────────────────────────────────
function _absRenderKpis() {
  const el = document.getElementById('abs-kpis');
  if (!el) return;
  const s = absState.summary || {};
  const byType = s.by_type || {};
  const totalMix = Object.values(byType).reduce((a, b) => a + b, 0);
  const mix = Object.entries(byType).sort((a, b) => b[1] - a[1]);

  // Le taux non planifié est le signal opérationnel : c'est lui qu'on
  // ne peut pas anticiper dans le planning.
  const warn = (s.unplanned_rate || 0) >= 3;

  el.innerHTML = `
    <div class="abs-kpi">
      <div class="abs-kpi-lbl">Taux d'absence</div>
      <div class="abs-kpi-val">${(s.absence_rate ?? 0).toFixed(1).replace('.', ',')}<span class="unit">%</span></div>
      <div class="abs-kpi-note">${s.total_days || 0} j sur ${(s.working_days || 0) * (s.headcount || 0)} j·agent</div>
    </div>
    <div class="abs-kpi${warn ? ' warn' : ''}">
      <div class="abs-kpi-lbl">Of which unplanned</div>
      <div class="abs-kpi-val">${(s.unplanned_rate ?? 0).toFixed(1).replace('.', ',')}<span class="unit">%</span></div>
      <div class="abs-kpi-note">${s.unplanned_days || 0} d — sickness, work accident, unexcused</div>
    </div>
    <div class="abs-kpi">
      <div class="abs-kpi-lbl">En attente</div>
      <div class="abs-kpi-val">${s.pending_count || 0}</div>
      <div class="abs-kpi-note">demande${(s.pending_count || 0) > 1 ? 's' : ''} to approve</div>
    </div>
    <div class="abs-kpi${(s.notice_rate != null && s.notice_rate < 80) ? ' warn' : ''}">
      <div class="abs-kpi-lbl">Notice respected</div>
      <div class="abs-kpi-val">${
        s.notice_rate == null ? '—'
          : `${s.notice_rate.toFixed(0)}<span class="unit">%</span>`
      }</div>
      <div class="abs-kpi-note">${
        s.notice_rate == null
          ? 'no notice recorded'
          : `${s.notice_ok || 0} notified, `
            + `${s.notice_ko || 0} non`
            + ((s.notice_unknown || 0)
                ? ` · ${s.notice_unknown} to qualify` : '')
      }</div>
    </div>
    <div class="abs-kpi">
      <div class="abs-kpi-lbl">Breakdown</div>
      <div class="abs-kpi-val">${Math.round(totalMix)}<span class="unit">j</span></div>
      <div class="abs-mix">${
        totalMix
          ? mix.map(([t, v]) =>
              `<i style="width:${(v / totalMix) * 100}%;background:${absColor(t)}"
                  title="${esc(t)} : ${v} j"></i>`).join('')
          : ''
      }</div>
      <div class="abs-kpi-note">${mix.length ? esc(mix[0][0]) + ' leading' : 'No absence'}</div>
    </div>`;
}

/* ── Demandes FO (lecture seule) ────────────────────────────────
   Deux registres distincts se croisent ici : `absences` (saisie RH,
   soldes, motifs) et `shift_requests` (demandes des agents). Le suivi
   RH a besoin de voir arriver les secondes — mais la décision reste
   en Admin, d'où l'absence volontaire de tout bouton Approuver /
   Refuser dans ce bloc. */
function _absRenderFoRequests() {
  const el = document.getElementById('abs-fo-requests');
  if (!el) return;

  // Périmètre : même année que la page, pour ne pas afficher un
  // historique sans rapport avec la période consultée.
  const y = String(absState.year || new Date().getUTCFullYear());
  const all = (state.shiftRequests || []).filter(r => String(r.date || '').startsWith(y));
  if (!all.length) { el.innerHTML = ''; return; }

  const pending = all.filter(r => r.status === 'pending');
  // En attente d'abord : c'est ce qui appelle une action ailleurs.
  const list = [...all].sort((a, b) => {
    const w = s => (s === 'pending' ? 0 : 1);
    return w(a.status) - w(b.status) ||
           String(b.created_at || '').localeCompare(String(a.created_at || ''));
  }).slice(0, 12);

  // Replié par défaut : la décision se prend dans Admin › Approbations,
  // cette liste n'est qu'un rappel. L'en-tête porte déjà le seul chiffre
  // qui compte — le nombre en attente. On garde l'état d'ouverture d'un
  // rendu à l'autre pour ne pas refermer la liste sous les yeux de
  // quelqu'un qui vient de la déplier.
  el.innerHTML = `
    <details class="abs-card abs-foreq-card" style="margin-bottom:18px"${absState.foReqOpen ? ' open' : ''}>
      <summary class="abs-card-head abs-foreq-summary" onclick="_absToggleFoReq(event)">
        <div>
          <div class="abs-card-title">Agent requests</div>
          <div class="abs-card-sub">
            ${pending.length
              ? `${pending.length} awaiting decision`
              : 'No pending request'} · ${all.length} of ${y}
          </div>
        </div>
        <span class="abs-foreq-chev" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </span>
      </summary>
      <div class="abs-foreq-body">
        <div style="display:flex;justify-content:flex-end;margin-bottom:8px">
          <button class="btn btn-ghost btn-sm" onclick="window.renderPage('shift-approvals')">
            Decide in Admin ›
          </button>
        </div>
        <div class="abs-foreq-list">
          ${list.map(_absFoReqRow).join('')}
          ${all.length > list.length
            ? `<div class="abs-foreq-more">+${all.length - list.length} autre${all.length - list.length > 1 ? 's' : ''}</div>`
            : ''}
        </div>
      </div>
    </details>`;
}

// L'état d'ouverture survit au prochain rendu. `open` n'est pas encore
// basculé au moment du clic : on prend donc l'inverse.
function _absToggleFoReq(ev) {
  const d = ev.currentTarget.closest('details');
  if (d) absState.foReqOpen = !d.open;
}

const ABS_FOREQ_STATE = {
  pending:  ['is-pending',  'En attente'],
  approved: ['is-approved', 'Approved'],
  rejected: ['is-rejected', 'Rejected'],
};

function _absFoReqRow(r) {
  const [cls, label] = ABS_FOREQ_STATE[r.status] || ABS_FOREQ_STATE.pending;
  const type = (typeof AP_TYPE !== 'undefined' && AP_TYPE[r.type]) || { label: r.type || 'Autre' };
  const cur  = r.current_shift_name || r.current_shift || '—';
  return `<div class="abs-foreq">
    <div class="abs-foreq-main">
      <div class="abs-foreq-l1">
        <b>${esc(r.fo_name || '—')}</b>
        <span class="abs-foreq-chip ${cls}">${label}</span>
        <span class="abs-foreq-chip">${esc(type.label)}</span>
      </div>
      <div class="abs-foreq-l2">
        ${esc(_absFmtDay(r.date))} · ${esc(cur)}
        ${r.swap_with ? ` · avec ${esc(r.swap_with)}` : ''}
        ${r.note ? ` — ${esc(r.note)}` : ''}
      </div>
    </div>
  </div>`;
}

// ── Conflits planning ──────────────────────────────────────────
function _absRenderConflicts() {
  const el = document.getElementById('abs-conflicts');
  if (!el) return;
  // Un conflit passé n'appelle plus d'arbitrage : le shift a eu lieu, le
  // planning ne peut plus être réajusté. Les afficher noyait les conflits
  // à venir — les seuls sur lesquels on peut encore agir.
  // Date locale en AAAA-MM-JJ : Date.parse décalerait le jour selon le
  // fuseau, et un conflit du jour même doit rester visible.
  const today = new Date().toLocaleDateString('sv-SE');
  const list = ((absState.summary || {}).conflicts || []).filter(c => c.date >= today);
  if (!list.length) { el.innerHTML = ''; return; }

  // Les 8 premiers en pastilles ; au-delà, un compteur — la liste
  // complète est dans le planning, pas ici.
  const head = list.slice(0, 8);
  el.innerHTML = `
    <div class="abs-conflict">
      <div class="abs-conflict-h">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        ${list.length} conflit${list.length > 1 ? 's' : ''} avec le planning
      </div>
      <div class="abs-conflict-sub">These agents are scheduled on a shift while declared absent. The rota must be adjusted.</div>
      <div class="abs-conflict-list">
        ${head.map(c => `
          <span class="abs-conflict-chip" onclick="window.renderPage('shift-planning')"
                title="Open the rota">
            <b>${esc(c.fo_name)}</b>
            <small>${esc(_absFmtDay(c.date))} · ${esc(c.shift_name)}</small>
          </span>`).join('')}
        ${list.length > head.length
          ? `<span class="abs-conflict-chip" onclick="window.renderPage('shift-planning')">
               +${list.length - head.length} autre${list.length - head.length > 1 ? 's' : ''}</span>`
          : ''}
      </div>
    </div>`;
}

function _absFmtDay(iso) {
  return new Date(iso + 'T00:00:00Z')
    .toLocaleDateString((globalThis.PEAR_LOCALE || 'fr-FR'), { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

// ── Calendrier ─────────────────────────────────────────────────
function absShiftMonth(delta) {
  const [y, m] = absState.month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  absState.month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  // Changer d'année via les flèches doit recharger la synthèse, sinon
  // les soldes affichés ne correspondent plus au mois montré.
  if (d.getUTCFullYear() !== absState.year) {
    const sel = document.getElementById('abs-year');
    if (sel && [...sel.options].some(o => Number(o.value) === d.getUTCFullYear())) {
      sel.value = String(d.getUTCFullYear());
      return renderAbsences();
    }
  }
  _absRenderCalendar();
}

function _absRenderCalendar() {
  const el = document.getElementById('abs-calendar');
  if (!el) return;
  const [y, m] = absState.month.split('-').map(Number);
  const first  = new Date(Date.UTC(y, m - 1, 1));
  const days   = new Date(Date.UTC(y, m, 0)).getUTCDate();
  // Lundi en tête : getUTCDay() renvoie 0 pour dimanche.
  const lead   = (first.getUTCDay() + 6) % 7;
  const todayISO = new Date().toISOString().slice(0, 10);

  // Index des absences par jour, tous statuts « vivants » confondus.
  const perDay = {};
  for (const a of absState.data || []) {
    if (a.status === 'Refusée' || a.status === 'Rejected' || a.status === 'Annulée') continue;
    let cur = new Date(a.date_from + 'T00:00:00Z');
    const end = new Date(a.date_to + 'T00:00:00Z');
    let guard = 0;
    while (cur <= end && guard++ < 400) {
      const iso = cur.toISOString().slice(0, 10);
      if (iso.startsWith(absState.month)) (perDay[iso] = perDay[iso] || []).push(a);
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  }

  const holidays = new Set((state.holidays || [])
    .filter(h => !currentCountry || currentCountry === 'ALL' || !h.country || h.country === currentCountry)
    .map(h => h.date));

  const dows = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  let html = dows.map(d => `<div class="abs-cal-dow">${d}</div>`).join('');
  for (let i = 0; i < lead; i++) html += '<div class="abs-cell pad"></div>';

  for (let d = 1; d <= days; d++) {
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dow = new Date(iso + 'T00:00:00Z').getUTCDay();
    const list = perDay[iso] || [];
    const cls = [
      'abs-cell',
      (dow === 0 || dow === 6) ? 'we' : '',
      holidays.has(iso) ? 'hol' : '',
      iso === todayISO ? 'today' : '',
      list.length ? 'has' : '',
    ].filter(Boolean).join(' ');
    // 4 points max par cellule : au-delà le compteur est plus lisible
    // qu'une grille de pastilles illisibles.
    const dots = list.slice(0, 4).map(a =>
      `<span class="abs-dot" style="background:${absColor(a.type)}"></span>`).join('');
    const more = list.length > 4 ? `<span class="abs-cell-more">+${list.length - 4}</span>` : '';
    const title = list.length
      ? list.map(a => `${a.fo_name} — ${absTypeLabel(a.type)} (${absStatusLabel(a.status)})`).join('\n')
      : (holidays.has(iso) ? 'Public holiday' : '');
    html += `<div class="${cls}"${title ? ` title="${esc(title)}"` : ''}${
      list.length ? ` onclick="absFilterByDate('${iso}')"` : ''}>
      <span class="abs-cell-n">${d}</span>
      <span class="abs-dots">${dots}${more}</span>
    </div>`;
  }
  el.innerHTML = html;

  const sub = document.getElementById('abs-cal-sub');
  if (sub) {
    const n = Object.keys(perDay).length;
    sub.textContent = first.toLocaleDateString((globalThis.PEAR_LOCALE || 'fr-FR'), { month: 'long', year: 'numeric', timeZone: 'UTC' })
      + ` · ${n} day${n > 1 ? 's' : ''} with absence`;
  }

  // Légende : uniquement les types réellement présents, sinon dix
  // pastilles dont huit inutiles.
  const leg = document.getElementById('abs-legend');
  if (leg) {
    const used = [...new Set(Object.values(perDay).flat().map(a => a.type))];
    leg.innerHTML = used.length
      ? used.map(t => `<span><i style="background:${absColor(t)}"></i>${esc(t)}</span>`).join('')
      : '<span>No absence this month</span>';
  }
}

// Clic sur un jour du calendrier : filtre la liste sur cette date.
function absFilterByDate(iso) {
  const s = document.getElementById('abs-f-search');
  if (s) s.value = iso;
  renderAbsenceList();
  document.getElementById('abs-table')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ── Soldes ─────────────────────────────────────────────────────
function _absRenderBalances() {
  const el = document.getElementById('abs-balances');
  if (!el) return;
  const bal = ((absState.summary || {}).balances || [])
    .slice()
    // Le plus consommé d'abord : c'est là que se pose la question du
    // reste à poser avant la fin de l'année.
    .sort((a, b) => (b.taken + b.pending) - (a.taken + a.pending));

  const sub = document.getElementById('abs-bal-sub');
  if (sub) {
    const ent = bal[0]?.entitlement || 0;
    sub.textContent = `Annual entitlement: ${ent} working days · ${bal.length} agents · deducted: approved and requested paid leave and RTT (sick leave, training and on-site do not count)`;
  }

  if (!bal.length) { el.innerHTML = '<div class="abs-empty">No agent configured</div>'; return; }

  el.innerHTML = bal.map(b => {
    const ent = b.entitlement || 1;
    const wT  = Math.min(100, (b.taken   / ent) * 100);
    const wP  = Math.min(100 - wT, (b.pending / ent) * 100);
    const over = b.remaining < 0;
    return `<div class="abs-bal${over ? ' over' : ''}">
      <div class="abs-bal-top">
        <span class="abs-bal-name">${esc(b.fo_name)}${
          b.no_notice_episodes
            ? `<span class="abs-bal-flag" title="${b.no_notice_episodes} absence(s) without notice, i.e. ${b.no_notice_days} j">
                 ${b.no_notice_episodes} without notice</span>`
            : ''}</span>
        <span class="abs-bal-v"><b>${b.remaining}</b> d left${
          b.taken ? ` · ${b.taken} taken` : ''}${b.pending ? ` · ${b.pending} pending` : ''}</span>
      </div>
      <div class="abs-bal-bar" title="${b.taken} j pris, ${b.pending} d requested, of ${ent} j">
        <i class="taken" style="width:${wT}%"></i>
        <i class="pending" style="width:${wP}%"></i>
      </div>
    </div>`;
  }).join('');
}

