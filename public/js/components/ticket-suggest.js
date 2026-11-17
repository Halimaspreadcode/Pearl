// ── SUGGESTIONS À LA CRÉATION D'UN TICKET ────────────────────
// Bandeau « Suggestions » sous le titre du formulaire ticket, en création
// seulement. Le serveur (GET /api/:tracker/suggest, services/suggest.js)
// compare le titre saisi à l'historique et renvoie, par champ, la valeur
// majoritaire des tickets similaires avec sa confiance et ses preuves.
//
// Règle d'or : on ne remplace JAMAIS ce que l'agent a saisi. Une puce ne
// s'affiche que pour un champ vide, et disparaît dès qu'il est rempli.
//
// Valeurs par défaut non statistiques, posées si le champ est vide :
//   FO Owner  = l'agent connecté (s'il figure dans l'équipe)
//   Severity  = déduite de la priorité (P1 Critical … P4 Warning)
//   Shift     = créneau du planning (rota) contenant l'heure d'occurrence
// L'heure d'occurrence n'est jamais devinée par ce module.
const TicketSuggest = (() => {
  const LABELS = {
    type: 'Type', domain: 'Domain', priority: 'Priority', severity: 'Severity',
    bo_handling: 'BO Handling', assigned_to: 'Assigned To', rc_category: 'RC Category',
    root_cause: 'Root Cause', corrective_actions: 'Corrective Actions',
  };
  const TEXT_FIELDS = ['root_cause', 'corrective_actions'];
  // Même table que PRIORITY_SEVERITY côté serveur (services/suggest.js).
  const PRIORITY_SEVERITY = { P1: 'Critical', P2: 'Major', P3: 'Minor', P4: 'Warning' };
  const QUERY_FIELDS = ['title', 'sn_tt', 'imoc_tt'];
  const DEBOUNCE_MS = 400;

  let active = false, tracker = null, timer = null, ctrl = null, seq = 0;
  let result = null;            // dernière réponse du serveur
  let auto = {};                // champ → valeur posée par nous (défaut ou « Apply all »)
  let wired = false;

  const h = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const form  = () => document.getElementById('ticket-form');
  const field = n => form()?.querySelector(`[name="${n}"]`);
  const pct   = x => `${Math.round((x || 0) * 100)}%`;
  const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  function stripEl() {
    let el = document.getElementById('ticket-suggest');
    if (el) return el;
    const lead = form()?.querySelector('#step-1 .sp-lead');
    if (!lead) return null;
    el = document.createElement('div');
    el.id = 'ticket-suggest';
    el.className = 'form-group full ts-strip';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Suggestions from similar tickets');
    el.hidden = true;
    lead.after(el);
    el.addEventListener('click', onStripClick);
    return el;
  }

  // Un champ vide accepte une puce. Un défaut (sévérité, shift, FO owner)
  // peut aussi remplacer une valeur que nous avions posée nous-mêmes — par
  // exemple la sévérité suit un changement de priorité — mais jamais une
  // valeur saisie ou appliquée par l'agent.
  const isEmpty = name => { const el = field(name); return !!el && !(el.value || '').trim(); };
  function isFree(name) {
    const el = field(name);
    return !!el && (isEmpty(name) || (auto[name] !== undefined && auto[name] === el.value));
  }

  // Pose une valeur si elle est proposable dans ce champ (option existante
  // pour un <select>). Renvoie true si la valeur est bien en place.
  function setValue(el, value) {
    if (el.tagName === 'SELECT' && ![...el.options].some(o => o.value === value)) return false;
    el.value = value;
    return el.value === value;
  }

  function refreshTabs() { if (typeof updateStepTabState === 'function') updateStepTabState(); }

  // ── Valeurs par défaut non statistiques ─────────────────────
  function shiftAt(date) {
    const sites = (state.rotaConfig && state.rotaConfig.sites) || [];
    const withShifts = sites.filter(s => (s.shifts || []).length);
    const T = String(tracker || '').toUpperCase();
    const site = withShifts.find(s => String(s.tracker || '').toUpperCase() === T) || withShifts[0];
    if (!site || isNaN(date)) return '';
    // Libellé de l'option : même dédoublonnage par id que getConfiguredShifts().
    const names = new Map();
    sites.forEach(s => (s.shifts || []).forEach(sh => { if (!names.has(sh.id)) names.set(sh.id, sh.name || sh.id); }));
    const toMin = s => { const r = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return r ? (+r[1]) * 60 + (+r[2]) : null; };
    const m = date.getHours() * 60 + date.getMinutes();
    for (const sh of site.shifts) {
      const a = toMin(sh.start), b = toMin(sh.end);
      if (a === null || b === null || a === b) continue;
      if (a < b ? (m >= a && m < b) : (m >= a || m < b)) return names.get(sh.id) || '';
    }
    return '';
  }

  function applyDefault(name, value) {
    const el = field(name);
    if (!el || !value || !isFree(name)) return;
    if (el.value === value) { auto[name] = value; return; }
    if (setValue(el, value)) auto[name] = value;
  }

  function applyDefaults() {
    if (!active) return;
    if (typeof currentUser !== 'undefined' && currentUser && currentUser.name)
      applyDefault('fo_owner', currentUser.name);
    const sev = PRIORITY_SEVERITY[field('priority')?.value];
    if (sev) applyDefault('severity', sev);
    const occ = field('occur_time')?.value;
    applyDefault('shift', shiftAt(occ ? new Date(occ) : new Date()));
    refreshTabs();
  }

  // ── Appel serveur ───────────────────────────────────────────
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(fetchSuggestions, DEBOUNCE_MS);
  }

  async function fetchSuggestions() {
    if (!active) return;
    const q = {};
    QUERY_FIELDS.forEach(k => { q[k] = (field(k)?.value || '').trim(); });
    const dom = field('domain');
    if (dom && dom.value && auto.domain !== dom.value) q.domain = dom.value;
    if (q.title.length < 3 && !q.sn_tt && !q.imoc_tt) { result = null; render(); return; }
    if (ctrl) ctrl.abort();
    ctrl = new AbortController();
    const my = ++seq;
    try {
      const r = await fetch(`${API}/api/tickets/${tracker}/suggest?${new URLSearchParams(q)}`, { signal: ctrl.signal });
      if (!r.ok) return;
      const data = await r.json();
      if (my !== seq || !active) return;       // réponse périmée
      result = data;
      render();
    } catch { /* annulée ou hors ligne : le formulaire reste utilisable sans aide */ }
  }

  // ── Rendu ───────────────────────────────────────────────────
  function visibleChips() {
    const s = (result && result.suggestions) || {};
    return Object.keys(LABELS).filter(f => {
      const sg = s[f];
      if (!sg || !isEmpty(f)) return false;
      const el = field(f);
      return el.tagName !== 'SELECT' || [...el.options].some(o => o.value === sg.value);
    });
  }

  function chipMeta(sg) {
    if (sg.kind === 'rule') return 'from priority';
    if (sg.kind === 'reuse') return `from ${sg.examples[0]?.sn_tt || 'similar ticket'} · ${pct(sg.confidence)} match`;
    return `${pct(sg.confidence)} · ${sg.support} similar`;
  }

  function chipTitle(f, sg) {
    const lines = [];
    if (sg.kind === 'rule') lines.push(`Rule: ${sg.rule}`);
    else if (sg.kind === 'reuse') lines.push('Reused from the most similar ticket');
    else lines.push(`${sg.support} of ${sg.total} similar tickets (${pct(sg.confidence)} of weighted votes)`);
    (sg.examples || []).forEach(e => lines.push(`• ${e.sn_tt || e.id} — ${short(e.title, 60)} (${pct(e.similarity)})`));
    if (TEXT_FIELDS.includes(f)) lines.push('', sg.value);
    return lines.join('\n');
  }

  function render() {
    const el = stripEl();
    if (!el) return;
    if (!active || !result) { el.hidden = true; el.innerHTML = ''; el._html = ''; return; }
    const s = result.suggestions || {};
    const chips = visibleChips();
    const dups = result.possible_duplicates || [];
    if (!chips.length && !dups.length) { el.hidden = true; el.innerHTML = ''; el._html = ''; return; }

    let html = '';
    if (dups.length) {
      html += `<div class="sp-note sp-note-alert ts-dups" role="status">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <div><strong>Possible duplicate${dups.length > 1 ? 's' : ''}</strong>
        <ul class="ts-dup-list">${dups.map(d => `<li>
          <button type="button" class="ts-link" data-open="${h(d.id)}" aria-label="Open existing ticket ${h(d.sn_tt || d.id)}">${h(d.sn_tt || d.imoc_tt || d.id)}</button>
          <span class="ts-dup-title">${h(short(d.title, 70))}</span>
          <span class="ts-dup-meta">${h(d.status)} · ${d.reason === 'same_ref' ? 'same reference' : `${pct(d.similarity)} similar`}</span>
        </li>`).join('')}</ul></div></div>`;
    }
    if (chips.length) {
      const bulk = chips.filter(f => !TEXT_FIELDS.includes(f));
      html += `<div class="ts-head">
        <span class="ts-title">Suggestions</span>
        <span class="ts-sub">from ${result.similar_count} similar ticket${result.similar_count > 1 ? 's' : ''}</span>
        ${bulk.length > 1 ? `<button type="button" class="ts-all" data-apply-all title="Applies every suggested field except reused text">Apply all</button>` : ''}
      </div><div class="ts-chips">${chips.map(f => {
        const sg = s[f];
        const val = TEXT_FIELDS.includes(f) ? short(sg.value, 42) : sg.value;
        return `<div class="ts-chip${sg.kind === 'reuse' ? ' ts-chip-reuse' : ''}" title="${h(chipTitle(f, sg))}">
          <span class="ts-chip-k">${LABELS[f]}</span>
          <span class="ts-chip-v">${h(val)}</span>
          <span class="ts-chip-m">${h(chipMeta(sg))}</span>
          <button type="button" class="ts-chip-apply" data-apply="${f}" aria-label="Apply ${LABELS[f]}: ${h(val)}">Apply</button>
        </div>`;
      }).join('')}</div>`;
    }
    // Contenu inchangé : ne pas toucher au DOM. Le « change » d'un champ
    // texte part quand il perd le focus, c.-à-d. pendant un Tab ou un clic
    // vers ce bandeau : recréer les boutons à ce moment-là perdrait le
    // focus ou le clic en cours.
    if (html === el._html && !el.hidden) return;
    el._html = html;
    // Garder le focus clavier sur le bouton équivalent après re-rendu.
    const focused = el.contains(document.activeElement) ? document.activeElement : null;
    const key = focused && (focused.dataset.apply ? `[data-apply="${focused.dataset.apply}"]`
      : focused.dataset.open ? `[data-open="${focused.dataset.open}"]` : null);
    el.innerHTML = html;
    el.hidden = false;
    if (focused) {
      const next = (key && el.querySelector(key)) || el.querySelector('button');
      (next || field('title'))?.focus({ preventScroll: true });
    }
  }

  // ── Actions ─────────────────────────────────────────────────
  function apply(f, bulk) {
    const sg = result?.suggestions?.[f];
    const el = field(f);
    if (!sg || !el || !isEmpty(f)) return false;
    if (!setValue(el, sg.value)) return false;
    delete auto[f];                       // appliqué par l'agent : c'est sa valeur
    if (!bulk) el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function onStripClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.apply) { apply(b.dataset.apply); return; }
    if (b.hasAttribute('data-apply-all')) {
      const done = visibleChips().filter(f => !TEXT_FIELDS.includes(f) && apply(f, true));
      if (done.length) {
        // Un seul événement suffit à rafraîchir les onglets et l'état
        // « modifié » du panneau ; les défauts (sévérité ← priorité) suivent.
        field(done[0]).dispatchEvent(new Event('change', { bubbles: true }));
        applyDefaults();
        render();
        field('title')?.focus({ preventScroll: true });
      }
      return;
    }
    if (b.dataset.open) {
      const panel = document.querySelector('#ticket-modal .side-panel');
      if (panel && panel._dirty && !confirm('Open the existing ticket? The new ticket you are typing will be discarded.')) return;
      const t = tracker;
      stop();
      openEditTicket(t, b.dataset.open);
    }
  }

  function onInput(e) {
    if (!active || !e.target.name) return;
    const n = e.target.name;
    if (e.isTrusted) delete auto[n];      // saisi à la main : plus notre valeur
    if (QUERY_FIELDS.includes(n)) schedule();
    render();
  }

  function onChange(e) {
    if (!active || !e.target.name) return;
    const n = e.target.name;
    if (e.isTrusted) delete auto[n];
    if (n === 'priority' || n === 'occur_time') applyDefaults();
    if (n === 'domain') schedule();
    render();
  }

  function wire() {
    const f = form();
    if (wired || !f) return;
    wired = true;
    f.addEventListener('input', onInput);
    f.addEventListener('change', onChange);
  }

  // ── API publique ────────────────────────────────────────────
  function start(t) {
    wire();
    active = true; tracker = t; result = null; auto = {};
    clearTimeout(timer); if (ctrl) ctrl.abort();
    render();
    applyDefaults();
  }

  function stop() {
    active = false; result = null; auto = {};
    clearTimeout(timer); if (ctrl) ctrl.abort();
    render();
  }

  return { start, stop, _shiftAt: shiftAt };
})();
