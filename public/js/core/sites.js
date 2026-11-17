// ══════════════════════════════════════════════════════════════
// SITES — liste des sites de l'organisation et tickets par site
//
// Les sites (agences, plateaux, pays, zones…) viennent de la configuration
// de l'organisation (GET /api/tickets → { sites, tickets }). Rien n'est
// écrit en dur : un écran qui a besoin d'un site passe par ces fonctions.
//
//   state.sites   : [{ code, name, city, country, tz }]
//   state.tickets : { CODE: [tickets enrichis] }
//
// Le « périmètre » (getActiveCountry) vaut un code de site ou 'ALL'.
// Clé de page/DOM d'un site : son code en minuscules (« lyo »).
// ══════════════════════════════════════════════════════════════

function siteList()  { return Array.isArray(state.sites) ? state.sites : []; }
function siteCodes() { return siteList().map(s => s.code); }
function siteByCode(code) { const c = String(code || '').toUpperCase(); return siteList().find(s => s.code === c) || null; }
function defaultSite() { return siteCodes()[0] || ''; }
function isSiteCode(code) { return siteCodes().includes(String(code || '').toUpperCase()); }

// Libellés : « Lyon » (ville sinon nom), « Lyon (LYO) », « Lyon + Paris ».
function siteName(code)  { const s = siteByCode(code); return s ? (s.city || s.name || s.code) : String(code || ''); }
function siteLabel(code) { const s = siteByCode(code); return s ? `${s.city || s.name} (${s.code})` : String(code || ''); }
function scopeLabel(scope) {
  if (scope && scope !== 'ALL') return siteName(scope);
  const l = siteList();
  return l.length ? l.map(s => s.city || s.name || s.code).join(' + ') : 'All sites';
}
function scopeCodes(scope) { return scope && scope !== 'ALL' ? scope : (siteCodes().join(' + ') || 'ALL'); }

// Tickets d'un site (tableau, jamais undefined), ou de tous, marqués de
// leur site dans `_tracker` (code en minuscules) et `tracker` (code).
function ticketsOf(code) { return (state.tickets || {})[String(code || '').toUpperCase()] || []; }
function ticketsInScope(scope) {
  const codes = !scope || scope === 'ALL' ? siteCodes() : [String(scope).toUpperCase()];
  return codes.flatMap(c => ticketsOf(c).map(t => ({ ...t, _tracker: c.toLowerCase(), tracker: t.tracker || c })));
}
function allTickets() { return ticketsInScope('ALL'); }
function allTicketsRaw() { return siteCodes().flatMap(c => ticketsOf(c)); }

// Site d'une personne (fo_trackers : code ou liste), à défaut le premier.
function personSites(name) {
  const v = ((state.config || {}).fo_trackers || {})[name];
  const l = [].concat(v || []).map(x => String(x).toUpperCase()).filter(Boolean);
  return l.length ? l : (defaultSite() ? [defaultSite()] : []);
}
function personSite(name) { return personSites(name)[0] || ''; }
function personInScope(name, scope) { return !scope || scope === 'ALL' || personSites(name).includes(scope); }

// Couleur d'un site, stable dans l'ordre de la configuration.
const SITE_COLORS = [
  ['var(--ok-fg)', 'var(--ok-bg)'], ['var(--p2-fg)', 'var(--p2-bg)'], ['#1D4ED8', 'rgba(37,99,235,.1)'],
  ['#7C3AED', 'rgba(124,58,237,.1)'], ['#B45309', 'rgba(180,83,9,.1)'], ['#0F766E', 'rgba(15,118,110,.1)'],
];
function siteColor(code) { const i = Math.max(0, siteCodes().indexOf(String(code || '').toUpperCase())); return SITE_COLORS[i % SITE_COLORS.length][0]; }
function siteBg(code)    { const i = Math.max(0, siteCodes().indexOf(String(code || '').toUpperCase())); return SITE_COLORS[i % SITE_COLORS.length][1]; }

// Remplit les <select data-sites="…"> de la page :
//   data-sites="all"   → « tous les sites » (valeur '') puis chaque site
//   data-sites="only"  → chaque site
//   data-sites-lower   → valeurs en minuscules (clés de tracker)
//   data-sites-all     → libellé de l'option « tous » (défaut : All sites)
function fillSiteSelects(root) {
  (root || document).querySelectorAll('select[data-sites]').forEach(sel => {
    const keep = sel.value;
    const lower = sel.hasAttribute('data-sites-lower');
    const v = c => (lower ? c.toLowerCase() : c);
    const opts = siteList().map(s => `<option value="${esc(v(s.code))}">${esc(siteLabel(s.code))}</option>`);
    if (sel.dataset.sites === 'all') opts.unshift(`<option value="${esc(sel.dataset.sitesAllValue || '')}">${esc(sel.dataset.sitesAll || 'All sites')}</option>`);
    sel.innerHTML = opts.join('');
    if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
  });
}

// Charge sites et tickets en un appel.
async function fetchSitesAndTickets() {
  const r = await fetch(`${API}/api/tickets`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j || !Array.isArray(j.sites)) return { sites: [], tickets: {} };
  return { sites: j.sites, tickets: j.tickets || {} };
}

// Tracker affiché par la page « site » : le site du périmètre, ou le
// premier site quand le périmètre est « tous ».
function activeSiteKey() {
  const c = typeof getActiveCountry === 'function' ? getActiveCountry() : 'ALL';
  return (c && c !== 'ALL' && isSiteCode(c) ? c : defaultSite()).toLowerCase();
}

// <optgroup data-sites-group> : un <option> par site (filtres mêlant sites
// et autres valeurs, ex. le journal d'audit).
function fillSiteGroups(root) {
  (root || document).querySelectorAll('optgroup[data-sites-group]').forEach(g => {
    g.innerHTML = siteList().map(s => `<option value="${esc(s.code)}">${esc(s.code)}</option>`).join('');
  });
}
