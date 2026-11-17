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

// ── ACTIVE COUNTRY ───────────────────────────────────────────
let currentCountry = localStorage.getItem('emoc-active-country') || 'SN';

function getActiveCountry() { return currentCountry; }

function _applyCountryNav() {
  const snLink     = document.querySelector('.nav-item[data-page="sn"]');
  const ciLink     = document.querySelector('.nav-item[data-page="ci"]');
  const globalLink = document.querySelector('.nav-item[data-page="global"]');
  // Un seul tracker dans la barre : celui du pays choisi. Si la vue du
  // profil ne le permet pas mais en permet un autre (ex. « non connecté »
  // n'a que le Global), c'est celui-là qu'on montre plutôt qu'aucun.
  let cible = currentCountry === 'ALL' ? 'global' : (currentCountry === 'CI' ? 'ci' : 'sn');
  if (typeof navAllowedPages === 'function' && typeof navPageVisible === 'function') {
    const canAdmin = typeof AdminSession !== 'undefined' && AdminSession.active;
    const allowed = navAllowedPages();
    const permis = ['sn', 'ci', 'global'].filter(t => navPageVisible(t, allowed, canAdmin));
    if (permis.length && !permis.includes(cible)) cible = permis.includes('global') ? 'global' : permis[0];
  }
  if (snLink)     snLink.style.display     = cible === 'sn' ? '' : 'none';
  if (ciLink)     ciLink.style.display     = cible === 'ci' ? '' : 'none';
  if (globalLink) globalLink.style.display = cible === 'global' ? '' : 'none';
  // Bascule seulement si la page affichée est le tracker qu'on vient de
  // masquer (SN/CI/Global). Se fier à .nav-item.active renvoyait sur un
  // tracker depuis n'importe quelle rubrique admin, puisque l'entrée
  // active y est restée sur « Vue d'ensemble ».
  const page = _currentPageId();
  if (['sn', 'ci', 'global'].includes(page) && page !== cible) window.renderPage(cible);
  _applyPptxAvailability();
}

/* Le deck hebdomadaire est un rapport Sénégal : le serveur force ce
   périmètre, quel que soit le sélecteur de site. Laisser le bouton actif
   sur Abidjan ou Global produisait donc un fichier qui ne correspondait
   pas à l'écran — un rapport « CI » rempli de chiffres SN.

   Plutôt que de générer un document trompeur, le bouton est désactivé
   hors Sénégal, avec la raison en infobulle. */
function _applyPptxAvailability() {
  const btn = document.getElementById('weekly-pptx-btn');
  if (!btn) return;
  const ok = currentCountry === 'SN';
  btn.disabled = !ok;
  btn.classList.toggle('is-unavailable', !ok);
  btn.title = ok
    ? ''
    : 'Export available on the Senegal scope only: '
      + 'the weekly report does not cover Abidjan.';
  // Note visible sous le bouton : une infobulle ne se découvre qu'au
  // survol, et l'absence d'explication se lit comme une panne.
  let note = document.getElementById('weekly-pptx-note');
  if (!ok && !note) {
    note = document.createElement('div');
    note.id = 'weekly-pptx-note';
    note.className = 'pptx-scope-note';
    note.textContent = 'Report available on the Senegal scope only.';
    btn.parentElement?.appendChild(note);
  } else if (ok && note) {
    note.remove();
  }
}

function _syncCountryDot() {
  const allBtn = document.getElementById('country-btn-all');
  const snBtn  = document.getElementById('country-btn-sn');
  const ciBtn  = document.getElementById('country-btn-ci');
  [[allBtn,'ALL'], [snBtn,'SN'], [ciBtn,'CI']].forEach(([btn, val]) => {
    if (!btn) return;
    btn.classList.toggle('active', currentCountry === val);
  });
}

function _syncCountryDropdowns() {
  const foDashSel = document.getElementById('fo-dash-tracker');
  const auditSel  = document.getElementById('audit-filter-tracker');
  const obsSel    = document.getElementById('obs-filter-source');
  if (currentCountry === 'ALL') {
    if (foDashSel) { foDashSel.value = 'both'; foDashSel.style.display = 'none'; }
    if (auditSel)  { auditSel.value  = '';     auditSel.style.display  = 'none'; }
    if (obsSel)    { obsSel.value    = '';     obsSel.style.display    = 'none'; }
    return;
  }
  if (foDashSel) { foDashSel.value = currentCountry.toLowerCase(); foDashSel.style.display = 'none'; }
  if (auditSel)  { auditSel.value  = currentCountry; auditSel.style.display = 'none'; }
  if (obsSel)    { obsSel.value    = currentCountry; obsSel.style.display = 'none'; }
}

// Page réellement affichée. La classe .active de la barre latérale ne
// suffit pas : les rubriques de Configuration s'ouvrent depuis la Vue
// d'ensemble et n'ont pas d'entrée de menu, donc .active y reste sur
// « Vue d'ensemble ». On se fie d'abord à la page portant .page.active
// dans le document, puis à la dernière page mémorisée.
function _currentPageId() {
  const el = document.querySelector('.page.active');
  if (el && el.id && el.id.startsWith('page-')) return el.id.slice(5);
  try { return localStorage.getItem('emoc-last-page') || ''; } catch (_) { return ''; }
}

function setActiveCountry(val) {
  currentCountry = (val === 'CI' || val === 'ALL') ? val : 'SN';
  localStorage.setItem('emoc-active-country', currentCountry);
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

