// ── TIMEZONE + LANGUAGE ──────────────────────────────────────
// The platform always operates in UTC+0 - no per-user offset.
// L'interface est en anglais : dates, jours et mois doivent suivre, sinon
// le tableau de bord affiche « lundi 16 août » sous un titre anglais.
// Le sélecteur de langue n'existe plus dans la page ; on ignore donc une
// préférence « fr » qui traînerait encore dans localStorage — sans quoi
// les anciens postes resteraient en dates françaises indéfiniment.
const LOCALE_MAP = { fr: 'en-GB', en: 'en-GB' };
let currentLang      = 'en';
const currentUTCOffset = '+0';

function _currentTZ() {
  return 'UTC';
}

function applyLang(val) {
  currentLang = val;
  localStorage.setItem('fo-lang2', val);
  ['lang-select', 'lang-select-sb'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = val;
  });
  const active = document.querySelector('.nav-item.active');
  if (active && active.dataset.page) window.renderPage(active.dataset.page);
}

// ── PÉRIMÈTRE (SITE ACTIF) ───────────────────────────────────
// Un code de site de l'organisation, ou 'ALL'. Le nom « country » est
// historique : un site peut être un pays, une ville, une agence…
let currentCountry = localStorage.getItem('pearl-active-country') || 'ALL';

function getActiveCountry() {
  // Un site retiré de la configuration ne reste pas sélectionné.
  if (currentCountry !== 'ALL' && typeof isSiteCode === 'function' && siteList().length && !isSiteCode(currentCountry)) currentCountry = 'ALL';
  return currentCountry;
}

function _applyCountryNav() {
  const siteLink   = document.querySelector('.nav-item[data-page="site"]');
  const globalLink = document.querySelector('.nav-item[data-page="global"]');
  const scope = getActiveCountry();
  // Un seul tracker dans la barre : celui du site choisi, ou la vue de
  // tous les sites. Avec un seul site, la vue globale n'apporte rien.
  const unSite = siteList().length <= 1;
  let cible = scope === 'ALL' && !unSite ? 'global' : 'site';
  if (typeof navAllowedPages === 'function' && typeof navPageVisible === 'function') {
    const canAdmin = typeof AdminSession !== 'undefined' && AdminSession.active;
    const allowed = navAllowedPages();
    const permis = ['site', 'global'].filter(t => navPageVisible(t, allowed, canAdmin));
    if (permis.length && !permis.includes(cible)) cible = permis[0];
  }
  if (siteLink)   siteLink.style.display   = cible === 'site' ? '' : 'none';
  if (globalLink) globalLink.style.display = cible === 'global' ? '' : 'none';
  const lbl = document.getElementById('sb-site-label');
  if (lbl) lbl.textContent = siteList().length > 1 ? `Tickets · ${siteName(activeSiteKey())}` : 'Tickets';
  const page = _currentPageId();
  if (['site', 'global'].includes(page) && page !== cible) window.renderPage(cible);
}

function _syncCountryDot() {
  document.querySelectorAll('#country-toggle .country-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.scope === getActiveCountry());
  });
}

// Boutons du sélecteur : « All » puis un par site. Masqué avec un seul site.
function renderCountryToggle() {
  const box = document.getElementById('country-toggle');
  if (!box) return;
  const sites = siteList();
  box.style.display = sites.length > 1 ? '' : 'none';
  const globe = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
  box.innerHTML = [`<button type="button" class="country-toggle-btn" data-scope="ALL" onclick="setActiveCountry('ALL')" title="All sites">${globe}<span>All</span></button>`]
    .concat(sites.map(s => `<button type="button" class="country-toggle-btn" data-scope="${esc(s.code)}" onclick="setActiveCountry('${esc(s.code)}')" title="${esc(siteLabel(s.code))}">`
      + `<span class="site-dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${siteColor(s.code)}"></span><span>${esc(s.code)}</span></button>`))
    .join('');
  _syncCountryDot();
  _applyCountryNav();
}

function _syncCountryDropdowns() {
  const foDashSel = document.getElementById('fo-dash-tracker');
  const auditSel  = document.getElementById('audit-filter-tracker');
  const obsSel    = document.getElementById('obs-filter-source');
  const scope = getActiveCountry();
  if (scope === 'ALL') {
    if (foDashSel) { foDashSel.value = 'both'; foDashSel.style.display = 'none'; }
    if (auditSel)  { auditSel.value  = '';     auditSel.style.display  = 'none'; }
    if (obsSel)    { obsSel.value    = '';     obsSel.style.display    = 'none'; }
    return;
  }
  if (foDashSel) { foDashSel.value = scope.toLowerCase(); foDashSel.style.display = 'none'; }
  if (auditSel)  { auditSel.value  = scope; auditSel.style.display = 'none'; }
  if (obsSel)    { obsSel.value    = scope; obsSel.style.display = 'none'; }
}

// Page réellement affichée. La classe .active de la barre latérale ne
// suffit pas : les rubriques de Configuration s'ouvrent depuis la Vue
// d'ensemble et n'ont pas d'entrée de menu, donc .active y reste sur
// « Vue d'ensemble ». On se fie d'abord à la page portant .page.active
// dans le document, puis à la dernière page mémorisée.
function _currentPageId() {
  const el = document.querySelector('.page.active');
  if (el && el.id && el.id.startsWith('page-')) return el.id.slice(5);
  try { return localStorage.getItem('pearl-last-page') || ''; } catch (_) { return ''; }
}

function setActiveCountry(val, opts) {
  const v = String(val || '').toUpperCase();
  currentCountry = isSiteCode(v) ? v : 'ALL';
  localStorage.setItem('pearl-active-country', currentCountry);
  if (opts && opts.silent) { _syncCountryDot(); return; }
  _applyCountryNav();
  _syncCountryDropdowns();
  _syncCountryDot();
  // On réaffiche la page en cours pour qu'elle recalcule avec le nouveau
  // périmètre — sans changer de page, ce qui renvoyait jusqu'ici
  // l'utilisateur sur « Vue d'ensemble » depuis toute rubrique admin.
  const page = _currentPageId();
  if (page) window.renderPage(page);
}

function getLangConfig() {
  const tz = _currentTZ() || 'UTC';
  return { locale: LOCALE_MAP[currentLang] || 'en-GB', tz };
}

// Format a date ISO string in UTC
function _fmtWithOffset(iso, opts) {
  if (!iso) return '-';
  const locale = LOCALE_MAP[currentLang] || 'en-GB';
  return new Date(iso).toLocaleString(locale, { timeZone: 'UTC', ...opts });
}

function fmtDate(iso, opts) {
  return _fmtWithOffset(iso, opts);
}
function fmtDtShort(iso) {
  return fmtDate(iso, { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

