// ── Hideable report sections (excluded from export when hidden) ──
const RPT_RENDER_FNS = { daily: 'renderPage_daily', weekly: 'renderPage_weekly', monthly: 'renderMonthlyReport' };
const RPT_SECTIONS = {
  daily: [
    ['metrics',    'Global Metrics'],
    ['today',      'Today TT Overview'],
    ['breaches',   'Active SLA Breaches'],
    ['highlights', 'Operational Highlights'],
    ['risks',      'Risks & Issues'],
    ['actions',    'Tomorrow Priority Action Items'],
  ],
  weekly: [
    ['metrics',    'Global Metrics'],
    ['breakdown',  'By Domain / By Priority'],
    ['fo',         'FO Performance'],
    ['highlights', 'Operational Highlights'],
    ['risks',      'Risks & Issues'],
    ['actions',    'Next Week Actions'],
    // Le commentaire du manager ferme le rapport, comme la slide
    // « Commentary » ferme le deck : il se rédige une fois les chiffres lus.
    ['notes',      'Manager Commentary'],
  ],
  monthly: [
    ['metrics',    'Global Metrics'],
    ['weekly',     'Weekly Breakdown'],
    ['breakdown',  'By Domain / Priority / Type / Status'],
    ['fo',         'FO Performance'],
    ['highlights', 'Operational Highlights'],
    ['risks',      'Risks & Issues'],
    ['actions',    'Next Month Priority Action Items'],
  ],
};
// ── REPORT LAYOUT (section order, hidden sections, custom columns) ──
// Shared across all users/devices: persisted server-side in data/report_layout.json,
// unlike the per-date draft content (highlights/risks/actions text) which stays local.
let _reportLayout = { order: {}, hidden: {}, customCols: {} };

async function loadReportLayout() {
  try {
    const d = await fetch(`${API}/api/report-layout`).then(r => r.json());
    // Le fichier vaut `{}` tant que personne n'a rien réglé : sans ces
    // valeurs par défaut, `customCols[reportType]` plantait et la page
    // Weekly report s'arrêtait en erreur au chargement.
    _reportLayout = { order: {}, hidden: {}, customCols: {}, ...(d && typeof d === 'object' ? d : {}) };
  } catch (e) { /* keep defaults if the fetch fails */ }
  // Apply any persisted custom columns onto the in-memory forms.
  ['daily', 'weekly', 'monthly'].forEach(reportType => {
    const form = _rptFormFor(reportType);
    const cols = _reportLayout.customCols[reportType];
    if (form && cols) form.customCols = cols;
  });
}

function pushReportLayout(reportType, patch) {
  fetch(`${API}/api/report-layout`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reportType, ...patch }),
  }).catch(() => {});
}

// Le rapport hebdomadaire n'a plus de sections masquables : toutes sont
// visibles, toujours. Masquer une section la retirait aussi de l'export,
// donc un réglage posé une fois par quelqu'un — et partagé par tous, ce
// fichier étant côté serveur — faisait disparaître des pages du deck sans
// que personne ne comprenne pourquoi.
const RPT_ALWAYS_VISIBLE = { weekly: true };

function isSectionHidden(reportType, key) {
  if (RPT_ALWAYS_VISIBLE[reportType]) return false;
  return !!(_reportLayout.hidden[reportType] && _reportLayout.hidden[reportType][key]);
}

function toggleReportSection(reportType, key) {
  if (RPT_ALWAYS_VISIBLE[reportType]) return;   // pas de bascule à offrir
  if (!_reportLayout.hidden[reportType]) _reportLayout.hidden[reportType] = {};
  _reportLayout.hidden[reportType][key] = !_reportLayout.hidden[reportType][key];
  pushReportLayout(reportType, { hidden: _reportLayout.hidden[reportType] });
  const fn = window[RPT_RENDER_FNS[reportType]];
  if (typeof fn === 'function') fn();
}

// ── SECTION ORDER (drag & drop, shared across all users) ──────
function getOrderedSections(reportType) {
  const defs = RPT_SECTIONS[reportType] || [];
  const order = _reportLayout.order[reportType];
  if (!order || !order.length) return defs;
  const byKey = Object.fromEntries(defs.map(d => [d[0], d]));
  const ordered = order.filter(k => byKey[k]).map(k => byKey[k]);
  defs.forEach(d => { if (!order.includes(d[0])) ordered.push(d); });
  return ordered;
}

function reorderSection(reportType, key, dir) {
  const sections = getOrderedSections(reportType);
  const idx = sections.findIndex(s => s[0] === key);
  const swapIdx = idx + dir;
  if (idx === -1 || swapIdx < 0 || swapIdx >= sections.length) return;
  [sections[idx], sections[swapIdx]] = [sections[swapIdx], sections[idx]];
  _reportLayout.order[reportType] = sections.map(s => s[0]);
  pushReportLayout(reportType, { order: _reportLayout.order[reportType] });
  const fn = window[RPT_RENDER_FNS[reportType]];
  if (typeof fn === 'function') fn();
}

let _dragSectionKey = null;
function onSectionDragStart(reportType, key, ev) {
  _dragSectionKey = key;
  ev.dataTransfer.effectAllowed = 'move';
}
function onSectionDragOver(ev) {
  ev.preventDefault();
}
function onSectionDrop(reportType, targetKey, ev) {
  ev.preventDefault();
  if (!_dragSectionKey || _dragSectionKey === targetKey) return;
  const sections = getOrderedSections(reportType).map(s => s[0]);
  const from = sections.indexOf(_dragSectionKey);
  const to   = sections.indexOf(targetKey);
  if (from === -1 || to === -1) return;
  sections.splice(to, 0, sections.splice(from, 1)[0]);
  _reportLayout.order[reportType] = sections;
  pushReportLayout(reportType, { order: sections });
  _dragSectionKey = null;
  const fn = window[RPT_RENDER_FNS[reportType]];
  if (typeof fn === 'function') fn();
}

const RPT_AUTHORS = ['Halima GUEYE - Front Office Leader', 'Steven TOME - Front Office Leader'];
const RPT_AUTHOR_INPUT_IDS = { daily: 'daily-author', weekly: 'wk-author', monthly: 'mo-author' };

// Who signs a report by default. Previously hard-coded to one name, so every
// other user published reports under that signature unless they noticed the
// field. Falls back to the known signatory list when nobody is identified.
function rptDefaultAuthor() {
  if (typeof currentUser !== 'undefined' && currentUser && currentUser.name) {
    const known = RPT_AUTHORS.find(a => a.startsWith(currentUser.name));
    if (known) return known;                     // keep the configured job title
    return currentUser.role && currentUser.role !== 'Observer'
      ? `${currentUser.name} - ${currentUser.role}`
      : currentUser.name;
  }
  return RPT_AUTHORS[0];
}

// dailyForm/weeklyForm/monthlyForm are declared with const, so they don't hang off window - look them up directly.
function _rptFormFor(reportType) {
  if (reportType === 'daily') return dailyForm;
  if (reportType === 'weekly') return weeklyForm;
  if (reportType === 'monthly') return monthlyForm;
  return null;
}

function setReportAuthor(reportType, author) {
  const form = _rptFormFor(reportType);
  if (!form) return;
  form.author = author;
  const input = document.getElementById(RPT_AUTHOR_INPUT_IDS[reportType]);
  if (input) input.value = author; // keep DOM in sync so the next save*Form() doesn't overwrite it
  const fn = window[RPT_RENDER_FNS[reportType]];
  if (typeof fn === 'function') fn();
}

// Panneau « Customize » : replié par défaut, ouvert par le bouton de la
// barre. La signature et les sections ne servent qu'à préparer l'envoi :
// elles n'ont pas à occuper une colonne en permanence.
function rptToggleCustomize(reportType) {
  const el = document.getElementById(`rpt-side-${reportType}`);
  const b = document.getElementById(`rpt-cust-${reportType}`);
  if (!el) return;
  const open = !el.classList.contains('is-open');
  el.classList.toggle('is-open', open);
  if (b) b.setAttribute('aria-expanded', String(open));
}

// Fixed side panel (right column): author picker + section visibility checkboxes.
function renderRptSidePanel(reportType) {
  const el = document.getElementById(`rpt-side-${reportType}`);
  if (!el) return;
  const sections = RPT_SECTIONS[reportType] || [];
  const form = _rptFormFor(reportType) || {};
  el.innerHTML = `
    <div class="rpt-side-panel-group">
      <div class="rpt-side-panel-title">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        Signature
      </div>
      ${RPT_AUTHORS.map(author => `
        <label>
          <input type="radio" name="rpt-author-${reportType}" ${form.author === author ? 'checked' : ''} onchange="setReportAuthor('${reportType}', '${esc(author)}')">
          <span>${esc(author.split(' - ')[0])}</span>
        </label>`).join('')}
      <div class="rpt-side-note">Signs the exported report.</div>
    </div>
    ${RPT_ALWAYS_VISIBLE[reportType] ? '' : `
    <div class="rpt-side-panel-group">
      <div class="rpt-side-panel-title">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="9" x2="9" y2="21"/></svg>
        Report Sections
      </div>
      ${sections.map(([key, title]) => `
        <label>
          <input type="checkbox" ${isSectionHidden(reportType, key) ? '' : 'checked'} onchange="toggleReportSection('${reportType}','${key}')">
          <span>${title}</span>
        </label>`).join('')}
      <div class="rpt-side-note">Unticked sections are left out of the export. Drag a section title to reorder.</div>
    </div>`}`;
}

// Les rapports hebdo/mensuel se lisent comme une page normale : pas de
// poignée de glisser-déposer ni de flèches monter/descendre dans les
// titres de section. L'ordre et la visibilité restent pilotables depuis
// le panneau latéral / report_layout.json.
const RPT_REORDERABLE = { daily: true, weekly: false, monthly: false };

// Returns the bar HTML + the wrapping markup needed; use rptSection() to wrap a whole section.
function rptBar(reportType, key, title, extraStyle = '', tail = '') {
  const hidden = isSectionHidden(reportType, key);
  const hiddenNote = hidden ? ` <span style="font-weight:400;text-transform:none;letter-spacing:0;opacity:.8">(hidden - excluded from export)</span>` : '';
  const draggable = RPT_REORDERABLE[reportType] !== false;
  const dragAttrs = draggable
    ? ` draggable="true" ondragstart="onSectionDragStart('${reportType}','${key}',event)" ondragover="onSectionDragOver(event)" ondrop="onSectionDrop('${reportType}','${key}',event)"`
    : '';
  const handle = draggable
    ? `<span class="rpt-handle" title="Drag to reorder" style="cursor:grab;font-size:13px;letter-spacing:-1px;user-select:none">⠿</span>
       <span class="rpt-handle" style="display:inline-flex;gap:2px">
         <span onclick="reorderSection('${reportType}','${key}',-1)" title="Move up" style="cursor:pointer;font-size:10px">▲</span>
         <span onclick="reorderSection('${reportType}','${key}',1)" title="Move down" style="cursor:pointer;font-size:10px">▼</span>
       </span>`
    : '';
  const base = draggable ? RPT_BAR : RPT_HEAD;
  return `<div class="rpt-sec-bar" style="${base}${extraStyle}${hidden ? ';opacity:.5' : ''}"${dragAttrs}>
    ${handle}
    <span style="flex:1">${title}${hiddenNote}</span>${tail}
  </div>`;
}

// Wraps section content; if hidden, only the (dimmed) bar is rendered and body is skipped.
function rptSection(reportType, key, title, bodyHtml, extraStyle = '') {
  const hidden = isSectionHidden(reportType, key);
  return rptBar(reportType, key, title, extraStyle) + (hidden ? '' : bodyHtml);
}

/* Champ de saisie d'un tableau de rapport.

   Il n'utilise plus `.form-control`, qui impose `min-height:72px` aux
   textarea : chaque cellule vide s'affichait en grande boîte creuse, et
   une ligne vierge occupait la hauteur de cinq lignes de texte. Ici la
   hauteur part d'une ligne et grandit avec le contenu.

   Le style vit dans une classe (.rpt-in) plutôt qu'en style inline :
   les états focus/hover se déclarent en CSS au lieu de trois gestionnaires
   d'événements qui réécrivaient les couleurs à la main. */
function rptInp(id, val, ph = '') {
  return `<textarea class="rpt-in" id="${id}" placeholder="${esc(ph)}" rows="1"
    oninput="rptGrow(this)">${esc(val)}</textarea>`;
}

// Auto-dimensionnement : on remet la hauteur à zéro avant de mesurer,
// sinon scrollHeight ne redescend jamais quand on efface du texte.
function rptGrow(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.max(el.scrollHeight, 32) + 'px';
}

// Après chaque rendu, les champs déjà remplis doivent adopter leur
// hauteur : sans ça un texte long s'affiche coupé jusqu'à la première
// frappe.
function rptGrowAll(root) {
  (root || document).querySelectorAll('textarea.rpt-in').forEach(rptGrow);
}

function rptSel(id, val, opts) {
  return `<select class="rpt-sel" id="${id}">${opts.map(o =>
    `<option value="${esc(o)}"${val === o ? ' selected' : ''}>${o || '-'}</option>`).join('')}</select>`;
}
function rptAutoDescCell(id, r, ph) {
  const isNB = r._autoType === 'near-breach';
  const badge = isNB
    ? `<span style="font-size:9px;font-weight:700;color:#fff;background:#DC2626;border-radius:4px;padding:2px 7px;white-space:nowrap;letter-spacing:.03em">NEAR BREACH</span>`
    : `<span style="font-size:9px;font-weight:700;color:#1D4ED8;background:rgba(37,99,235,.12);border-radius:4px;padding:2px 7px;white-space:nowrap">P1/P2 OPEN</span>`;
  const timeTag = r._timeLeft
    ? `<span style="font-size:10px;font-weight:600;color:${isNB ? '#DC2626' : 'var(--mute)'};font-family:'DM Mono',monospace;white-space:nowrap">${esc(r._timeLeft)}${isNB ? ' left' : ''}</span>`
    : '';
  return `<div style="display:flex;flex-direction:column;gap:4px">
    <div style="display:flex;align-items:center;gap:6px">${badge}${timeTag}</div>
    ${rptInp(id, r.description, ph)}
  </div>`;
}
// Footnote under the metrics table. Readers of an exported report need to know
// what the figures cover: the period only, and - in drill mode - that MTTD/MTTR
// count worked hours rather than wall-clock, or 39h looks wrong next to 105h.
function rptMetricsNote(periodWord) {
  const drill = (state.config || {}).work_mode === 'drill';
  const scope = { today: 'this day', week: 'this week', month: 'this month' }[periodWord] || periodWord;
  const clock = drill
    ? 'MTTD / MTTR in worked hours only (08:30–17:30)'
    : 'MTTD / MTTR in elapsed time (24/7)';
  return `<div style="font-size:10.5px;color:var(--m3-on-surf-var,var(--mute));margin:2px 0 4px;padding:0 2px;line-height:1.5">
    Figures cover ${scope} only${drill ? ' · drill mode' : ''} · ${clock} · SLA % over tickets opened in the period
  </div>`;
}

/* ── Fiches de saisie : highlights / risques ───────────────────
   Les fonctions ci-dessous remplacent les tableaux larges. Contrainte
   forte : saveWeeklyForm()/saveMonthlyForm() lisent les valeurs par
   getElementById sur des identifiants précis. Les puces de priorité et de
   statut écrivent donc dans un <input hidden> qui porte l'identifiant
   attendu — la collecte du formulaire reste inchangée. */

// Classe de couleur d'une valeur de priorité / statut.
const _rfPrio = v => ({ Critical: 'critical', High: 'high', Medium: 'medium', Low: 'low' }[v] || '');
const _rfStat = v => ({ Open: 'open', 'In Progress': 'progress', Closed: 'closed' }[v] || '');

// Zone de texte auto-dimensionnée. `oninput` remonte la valeur dans le
// champ caché quand l'id visé n'est pas celui du textarea lui-même.
function rfText(id, val, ph) {
  return `<div class="rf-body"><textarea id="${id}" placeholder="${esc(ph)}" rows="1"
    oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'"
    >${esc(val || '')}</textarea></div>`;
}

// Groupe de puces exclusives adossé à un champ caché.
// `kind` : 'p' pour priorité (couleurs P1..P4), 's' pour statut.
function rfChips(id, val, opts, kind) {
  const cls = kind === 'p' ? _rfPrio : _rfStat;
  return `<input type="hidden" id="${id}" value="${esc(val || '')}">
    <span class="rf-chips" data-kind="${kind}">${opts.filter(Boolean).map(o => `<button type="button"
      class="rf-chip ${val === o ? 'on ' + (kind === 'p' ? 'c-' : 's-') + cls(o) : ''}"
      onclick="rfPick('${id}',${JSON.stringify(o).replace(/"/g, '&quot;')})"
      >${esc(o)}</button>`).join('')}</span>`;
}

// Sélection d'une puce : écrit dans le champ caché puis rebascule les
// classes sans re-rendre la page — un re-rendu ferait perdre le focus et
// la position de saisie dans les textes en cours d'édition.
function rfPick(id, value) {
  const input = document.getElementById(id);
  if (!input) return;
  const group = input.parentElement.querySelector('.rf-chips');
  if (!group) return;
  // Re-cliquer la puce active la désélectionne : sans ça, une priorité
  // posée par erreur ne pouvait plus être retirée (l'ancien <select> avait
  // une option vide, les puces non).
  const next = input.value === value ? '' : value;
  input.value = next;
  const kind = group.dataset.kind || (id.includes('-pri-') ? 'p' : 's');
  const cls = kind === 'p' ? _rfPrio : _rfStat;
  group.querySelectorAll('.rf-chip').forEach(b => {
    const on = b.textContent.trim() === next;
    b.className = 'rf-chip' + (on ? ' on ' + (kind === 'p' ? 'c-' : 's-') + cls(next) : '');
  });
  // Le liseré de la fiche suit la priorité choisie.
  if (kind === 'p') {
    const card = input.closest('.rf-card');
    if (card) {
      card.classList.remove('p-critical', 'p-high', 'p-medium', 'p-low');
      if (cls(next)) card.classList.add('p-' + cls(next));
    }
  }
}

// Champ court souligné (FO, BO, colonne personnalisée).
function rfInput(id, val, ph, w) {
  return `<input class="rf-inp" id="${id}" value="${esc(val || '')}"
    placeholder="${esc(ph)}"${w ? ` style="width:${w}"` : ''}>`;
}

function rfDelBtn(section, i, disabled) {
  return `<button class="rf-del" type="button" title="${disabled
    ? 'Row derived from tickets — handle the ticket to remove it'
    : 'Delete this row'}"${disabled ? ' disabled' : ''}
    onclick="removeReportRow('${section}',${i})">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
  </button>`;
}

// Barre d'outils sous une liste de fiches : ajout + décompte.
function rfTools(section, reportType, key, n) {
  return `<div class="rf-tools">${rptAddRowBtn(section)}${rptAddColBtn(reportType, key)}
    <span class="rf-count">${n} ligne(s)</span></div>`;
}

// Colonnes personnalisées d'une fiche, rendues comme champs courts.
function rfCustom(cols, prefix, i, row, reportType, key) {
  return cols.map(c => `<span class="rf-field">
    <span class="rf-lbl">${esc(c.label)}
      <span onclick="removeReportCustomCol('${reportType}','${key}','${c.id}')"
        title="Delete column" style="cursor:pointer;opacity:.6;margin-left:2px">×</span></span>
    ${rfInput(`${prefix}-${c.id}-${i}`, row[c.id], '')}
  </span>`).join('');
}

/* Operational Highlights — une fiche par observation. */
function rfHighlights(rows, prefix, section, reportType, cols) {
  const list = rows.length
    ? rows.map((r, i) => `<div class="rf-card ${_rfPrio(r.priority) ? 'p-' + _rfPrio(r.priority) : ''}">
        <div class="rf-top">
          <span class="rf-num">${i + 1}</span>
          ${rfInput(`${prefix}-src-${i}`, r.source, 'Source / category', '190px')}
          ${rfDelBtn(section, i, false)}
        </div>
        ${rfText(`${prefix}-obs-${i}`, r.observation, 'Describe the observation…')}
        <div class="rf-foot">
          <span class="rf-field"><span class="rf-lbl">Priority</span>
            ${rfChips(`${prefix}-pri-${i}`, r.priority, PRI_OPTS, 'p')}</span>
          <span class="rf-field rf-sep"><span class="rf-lbl">Statut</span>
            ${rfChips(`${prefix}-sta-${i}`, r.status, STA_OPTS, 's')}</span>
          ${rfCustom(cols, prefix, i, r, reportType, 'highlights')}
        </div>
      </div>`).join('')
    : `<div class="rf-empty">No observation entered. Add a row to document
       a notable event from the period.</div>`;
  return `<div class="rf">${list}</div>${rfTools(section, reportType, 'highlights', rows.length)}`;
}

/* Risks & Issues — même fiche, plus les porteurs FO / BO. */
function rfRisks(rows, prefix, section, reportType, cols) {
  const list = rows.length
    ? rows.map((r, i) => {
        const isNB = r._autoType === 'near-breach';
        const badge = r._auto
          ? (isNB
            ? `<span class="rf-badge" style="color:#fff;background:#DC2626">NEAR BREACH</span>`
            : `<span class="rf-badge" style="color:#1D4ED8;background:rgba(37,99,235,.12)">P1/P2 OPEN</span>`)
          : '';
        const time = r._auto && r._timeLeft
          ? `<span class="rf-time" style="color:${isNB ? '#DC2626' : 'var(--m3-on-surf-var,var(--mute))'}"
             >${esc(r._timeLeft)}${isNB ? ' left' : ''}</span>`
          : '';
        return `<div class="rf-card ${r._auto ? 'auto ' : ''}${_rfPrio(r.priority) ? 'p-' + _rfPrio(r.priority) : ''}">
          <div class="rf-top">
            <span class="rf-num">${i + 1}</span>
            ${badge}${time}
            ${rfDelBtn(section, i, !!r._auto)}
          </div>
          ${rfText(`${prefix}-desc-${i}`, r.description, 'Describe the risk or blocker…')}
          <div class="rf-foot">
            <span class="rf-field"><span class="rf-lbl">FO</span>
              ${rfInput(`${prefix}-fo-${i}`, r.fo, 'Front Office')}</span>
            <span class="rf-field"><span class="rf-lbl">BO</span>
              ${rfInput(`${prefix}-bo-${i}`, r.bo, 'Back Office')}</span>
            <span class="rf-field rf-sep"><span class="rf-lbl">Priority</span>
              ${rfChips(`${prefix}-pri-${i}`, r.priority, PRI_OPTS, 'p')}</span>
            <span class="rf-field"><span class="rf-lbl">Statut</span>
              ${rfChips(`${prefix}-sta-${i}`, r.status, STA_OPTS, 's')}</span>
            ${rfCustom(cols, prefix, i, r, reportType, 'risks')}
          </div>
        </div>`;
      }).join('')
    : `<div class="rf-empty">No risk declared. Open P1/P2 tickets close
       to breach appear here automatically.</div>`;
  return `<div class="rf">${list}</div>${rfTools(section, reportType, 'risks', rows.length)}`;
}

/* Boutons d'outil sous un tableau. `primary` distingue l'action courante
   (ajouter une ligne) de l'action rare (ajouter une colonne) : les deux
   étaient rendus à l'identique et se disputaient l'attention. */
function rptToolBtn(label, onclick, primary) {
  return `<button type="button" class="rpt-tool${primary ? ' is-primary' : ''}" onclick="${onclick}">`
       + `<span class="rpt-tool-plus">+</span>${label}</button>`;
}
function rptAddRowBtn(section) {
  const fn = (section.startsWith('weekly') || section.startsWith('monthly')) ? `addReportRow('${section}')` : `addDailyRow('${section}')`;
  return rptToolBtn('Add a row', fn, true);
}

/* Après chaque rendu de rapport, les champs déjà remplis prennent leur
   hauteur. Sans ce passage, un texte long reste écrasé sur une ligne
   jusqu'à ce qu'on tape dedans. */
function rptAfterRender() {
  requestAnimationFrame(() => rptGrowAll(document));
}

