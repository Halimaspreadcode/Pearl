// ══════════════════════════════════════════════════════════════
// ÉTAT DE L'INTERFACE DATA QUALITY
// Les trois <select> ont été remplacés par des puces et une
// recherche : l'état vit ici plutôt que dans le DOM, sinon chaque
// re-render (déclenché à chaque frappe) perdait les sélections.
// ══════════════════════════════════════════════════════════════
const dqUI = {
  tracker : '',      // '' | code de site
  severity: '',      // '' | 'error' | 'warning' | 'info'
  category: '',      // '' | nom de catégorie
  scope   : '',      // '' | 'open'  → anomalies corrigeables maintenant
  search  : '',
  open    : new Set(),   // ruleIds dépliés
  expanded: new Set(),   // ruleIds dont le tableau est affiché en entier
  autoOpened: false,     // l'ouverture par défaut ne s'applique qu'une fois
};
const DQ_ROWS_COLLAPSED = 8;   // lignes visibles avant « voir tout »

let _dqSearchTimer = null;
function dqOnSearch() {
  const v = document.getElementById('dq-search')?.value || '';
  const clr = document.getElementById('dq-search-clear');
  if (clr) clr.style.display = v ? '' : 'none';
  // Debounce : la recherche re-filtre et re-rend toutes les cartes.
  clearTimeout(_dqSearchTimer);
  _dqSearchTimer = setTimeout(() => {
    dqUI.search = v.trim().toLowerCase();
    renderDataQuality();
  }, 160);
}

function dqClearSearch() {
  const inp = document.getElementById('dq-search');
  if (inp) inp.value = '';
  dqUI.search = '';
  const clr = document.getElementById('dq-search-clear');
  if (clr) clr.style.display = 'none';
  renderDataQuality();
}

// Puces : un second clic sur la puce active la désélectionne.
function dqSetFilter(key, value) {
  dqUI[key] = dqUI[key] === value ? '' : value;
  renderDataQuality();
}

function dqResetFilters() {
  dqUI.tracker = dqUI.severity = dqUI.category = dqUI.scope = '';
  dqClearSearch();   // déclenche le rendu
}

function dqToggleRule(ruleId) {
  if (dqUI.open.has(ruleId)) dqUI.open.delete(ruleId);
  else dqUI.open.add(ruleId);
  renderDataQuality();
}

function dqExpandRows(ruleId, ev) {
  if (ev) ev.stopPropagation();
  dqUI.expanded.add(ruleId);
  renderDataQuality();
}

function dqToggleAll() {
  // Si au moins une carte est ouverte, tout replier ; sinon tout ouvrir.
  if (dqUI.open.size) dqUI.open.clear();
  else _dqLastRuleIds.forEach(id => dqUI.open.add(id));
  renderDataQuality();
}
let _dqLastRuleIds = [];

// Surligne les occurrences du terme recherché, sur du texte déjà échappé.
function dqHi(text) {
  const s = esc(text == null ? '' : String(text));
  if (!dqUI.search) return s;
  const needle = dqUI.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return s.replace(new RegExp(`(${needle})`, 'gi'), '<mark class="dq-mark">$1</mark>');
}

// Export CSV des anomalies actuellement filtrées.
function exportDataQualityCSV() {
  const issues = _dqFilteredIssues();
  if (!issues.length) { alert('No anomaly to export for the current filters.'); return; }
  const head = ['Regle','Severite','Categorie','Site','TT#','Titre','Priorite','Statut','FO Owner','Probleme'];
  const cell = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const lines = [head.join(',')].concat(issues.map(i => [
    i.ruleId, i.severity, i.rule.category, i.ticket._tracker,
    i.ticket.sn_tt || i.ticket.id, i.ticket.title || '', i.ticket.priority || '',
    i.ticket.status || '', i.ticket.fo_owner || '', i.detail,
  ].map(cell).join(',')));
  // BOM pour qu'Excel lise correctement les accents.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `data-quality-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// Filtres appliqués — partagé par le rendu et l'export, pour qu'ils ne
// puissent pas diverger.
function _dqFilteredIssues() {
  let issues = _runDataQualityChecks();
  if (dqUI.tracker)  issues = issues.filter(i => i.ticket._tracker === dqUI.tracker);
  if (dqUI.severity) issues = issues.filter(i => i.severity === dqUI.severity);
  if (dqUI.category) issues = issues.filter(i => i.rule.category === dqUI.category);
  if (dqUI.scope === 'open')
    issues = issues.filter(i => !['Resolved', 'Closed'].includes(i.ticket.status));
  if (dqUI.search) {
    const q = dqUI.search;
    issues = issues.filter(i => {
      const t = i.ticket;
      return [t.sn_tt, t.imoc_tt, t.title, t.fo_owner, t.domain, t.status,
              t.priority, i.ruleId, i.rule.title, i.rule.category, i.detail]
        .some(v => v && String(v).toLowerCase().includes(q));
    });
  }
  return issues;
}

function renderDataQuality() {
  const el = document.getElementById('dq-content');
  if (!el) return;

  const { locale, tz } = getLangConfig();
  const fmtD = v => v ? new Date(v).toLocaleDateString(locale, { timeZone: tz, day:'2-digit', month:'short', year:'numeric' }) : '—';

  // ── Badge latéral : toujours sur le total non filtré ──────────
  const allIssues = _runDataQualityChecks();
  const badge = document.getElementById('sb-count-dq');
  if (badge) {
    const n = allIssues.filter(i => i.severity === 'error' || i.severity === 'warning').length;
    badge.textContent = n > 0 ? n : '';
    badge.style.display = n > 0 ? '' : 'none';
  }

  const issues = _dqFilteredIssues();
  const allTk  = allTicketsRaw();

  const errCount  = issues.filter(i => i.severity === 'error').length;
  const warnCount = issues.filter(i => i.severity === 'warning').length;
  const infoCount = issues.filter(i => i.severity === 'info').length;
  const affected  = new Set(issues.map(i => i.ticket.id)).size;

  // Le score se calcule toujours sur l'ensemble : un score qui remonte
  // parce qu'on a filtré sur « CI seulement » ne veut rien dire.
  const A     = _dqAnalyse(issues, allTk);
  const Aglob = _dqAnalyse(allIssues, allTk);

  // ── Héro : anneau de score + composition ──────────────────────
  const heroEl = document.getElementById('dq-hero');
  if (heroEl) {
    const score = Aglob.score;
    const mod   = score >= 90 ? 'ok' : score >= 70 ? 'warn' : 'err';
    const R = 56, C = 2 * Math.PI * R;
    const off = C * (1 - score / 100);

    const gErr  = allIssues.filter(i => i.severity === 'error').length;
    const gWarn = allIssues.filter(i => i.severity === 'warning').length;
    const gInfo = allIssues.filter(i => i.severity === 'info').length;
    const gTot  = gErr + gWarn + gInfo;
    const pct   = n => gTot ? (n / gTot * 100) : 0;

    const verdict = gTot === 0
      ? 'No inconsistency detected'
      : score >= 90 ? 'Data quality is healthy'
      : score >= 70 ? 'A few fixes to schedule'
      : 'Fixes needed before reporting';

    const sub = gTot === 0
      ? `The <b>${allTk.length}</b> loaded tickets comply with the ${Object.keys(DQ_RULES).length} control rules.`
      : `<b>${gTot}</b> anomal${gTot > 1 ? 'ies' : 'y'} of which <b>${Aglob.actionable}</b> fixable immediately · <b>${new Set(allIssues.map(i => i.ticket.id)).size}</b>/${allTk.length} tickets affected`;

    // Les statistiques servent de raccourcis de filtre : cliquer
    // « Erreurs » applique le filtre plutôt que d'obliger à
    // redescendre vers la barre de puces.
    const stat = (cls, n, label, key, val) => `
      <button class="dq-stat ${cls}" ${key ? `aria-pressed="${dqUI[key] === val}" onclick="dqSetFilter('${key}','${val}')"` : 'disabled class="dq-stat static"'}>
        <span class="dq-stat-n">${n}</span>${label}
      </button>`;

    heroEl.innerHTML = `
      <div class="dq-gauge ${mod}">
        <svg viewBox="0 0 132 132">
          <circle class="dq-gauge-track" cx="66" cy="66" r="${R}"/>
          <circle class="dq-gauge-fill"  cx="66" cy="66" r="${R}"
                  stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
        </svg>
        <div class="dq-gauge-mid">
          <div class="dq-gauge-n">${score}<small>%</small></div>
          <div class="dq-gauge-l">Score</div>
        </div>
      </div>
      <div class="dq-hero-body">
        <div class="dq-hero-verdict">${verdict}</div>
        <div class="dq-hero-sub">${sub}</div>
        ${gTot ? `<div class="dq-stack">
          <div class="dq-stack-seg err"  style="width:${pct(gErr)}%"></div>
          <div class="dq-stack-seg warn" style="width:${pct(gWarn)}%"></div>
          <div class="dq-stack-seg info" style="width:${pct(gInfo)}%"></div>
        </div>` : ''}
        <div class="dq-stats">
          ${stat('err',  gErr,  'erreurs',      'severity', 'error')}
          ${stat('warn', gWarn, 'avertissements','severity', 'warning')}
          ${gInfo ? stat('info', gInfo, 'informations', 'severity', 'info') : ''}
          ${stat('ok',   Aglob.actionable, 'sur tickets ouverts', 'scope', 'open')}
        </div>
      </div>`;
  }

  // ── Recommandations ───────────────────────────────────────────
  const recEl = document.getElementById('dq-reco');
  if (recEl) {
    const recos = _dqRecommendations(A, issues);
    recEl.innerHTML = recos.map(r => `
      <div class="dq-reco-item ${r.tone}">
        <div class="dq-reco-text">${r.text}</div>
        <div class="dq-reco-hint">${r.hint}</div>
      </div>`).join('');
    recEl.style.display = recos.length ? 'grid' : 'none';
  }

  // ── Tickets cumulant plusieurs anomalies ──────────────────────
  const hotEl = document.getElementById('dq-hotspots');
  if (hotEl) {
    hotEl.innerHTML = A.hotspots.length ? `
      <div class="dq-panel-title">Fix first</div>
      <div class="dq-panel-sub">These tickets have several anomalies — one fix resolves many.</div>
      ${A.hotspots.map(h => `
        <div class="dq-hot-row" onclick="openEditTicket(${escAttrArg((h.ticket._tracker||'').toLowerCase())},${escAttrArg(h.ticket.id)})">
          <span class="dqr-site dqr-site-${(h.ticket._tracker||'').toLowerCase()}">${h.ticket._tracker || ''}</span>
          <span class="dq-hot-tt">${esc(h.ticket.sn_tt || h.ticket.id)}</span>
          <span class="dq-hot-title" title="${esc(h.ticket.title||'')}">${esc(h.ticket.title || '—')}</span>
          <span class="dq-hot-badge">${h.rules.length} anomalies</span>
        </div>`).join('')}` : '';
    hotEl.style.display = A.hotspots.length ? 'block' : 'none';
  }

  // ── Répartition par FO ────────────────────────────────────────
  const ownEl = document.getElementById('dq-owners');
  if (ownEl) {
    const tops = A.owners.slice(0, 6);
    const max  = tops.length ? tops[0].total : 1;
    ownEl.innerHTML = tops.length ? `
      <div class="dq-panel-title">Anomalies by FO Owner</div>
      <div class="dq-panel-sub">Where to focus the reminder — the bars compare volumes, not performance.</div>
      ${tops.map(o => `
        <div class="dq-own-row">
          <div class="dq-own-name" title="${esc(o.fo)}">${esc(o.fo)}</div>
          <div class="dq-own-track">
            <div class="dq-own-fill err"  style="width:${Math.round(o.errors / max * 100)}%"></div>
            <div class="dq-own-fill warn" style="width:${Math.round((o.total - o.errors) / max * 100)}%"></div>
          </div>
          <div class="dq-own-n">${o.total}</div>
        </div>`).join('')}
      <div class="dq-panel-foot">
        <span class="dq-key err"></span>erreurs
        <span class="dq-key warn"></span>avertissements
      </div>` : '';
    ownEl.style.display = tops.length ? 'block' : 'none';
  }

  // ── Puces de filtre ───────────────────────────────────────────
  // Chaque puce porte son compte : on voit ce qu'un filtre donnera
  // avant de cliquer, au lieu de l'essayer pour tomber sur du vide.
  const chipEl = document.getElementById('dq-chips');
  if (chipEl) {
    // Comptes calculés hors du filtre concerné, pour rester utiles.
    const countBy = (skipKey, pred) => {
      const save = dqUI[skipKey];
      dqUI[skipKey] = '';
      const n = _dqFilteredIssues().filter(pred).length;
      dqUI[skipKey] = save;
      return n;
    };
    const chip = (key, val, label, n, ico) => `
      <button class="dq-chip ${dqUI[key] === val ? 'active' : ''}" onclick="dqSetFilter('${key}','${val}')">
        ${dqUI[key] === val ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' : (ico || '')}
        ${label}${n != null ? `<span class="dq-chip-n">${n}</span>` : ''}
      </button>`;

    const cats = ['Lifecycle','Dates','Mandatory','Duplicates','Quality','SLA'];
    const catLbl = { Mandatory:'Champs obligatoires', Duplicates:'Doublons', Quality:'Quality' };

    chipEl.innerHTML =
        siteCodes().map(c => chip('tracker', c, c, countBy('tracker', i => i.ticket._tracker === c))).join('')
      + '<span class="dq-chip-sep"></span>'
      + cats.map(c => {
          const n = countBy('category', i => i.rule.category === c);
          return n ? chip('category', c, catLbl[c] || c, n) : '';
        }).join('');
  }

  // ── Regroupement par règle ────────────────────────────────────
  const byRule = {};
  issues.forEach(i => {
    if (!byRule[i.ruleId]) byRule[i.ruleId] = { rule: i.rule, ruleId: i.ruleId, severity: i.severity, items: [] };
    byRule[i.ruleId].items.push(i);
  });
  const sevOrder = { error: 0, warning: 1, info: 2 };
  const ruleOrder = Object.values(byRule).sort((a, b) => {
    const sa = sevOrder[a.severity] ?? 9, sb = sevOrder[b.severity] ?? 9;
    if (sa !== sb) return sa - sb;
    return b.items.length - a.items.length;
  });
  _dqLastRuleIds = ruleOrder.map(r => r.ruleId);

  // Au premier affichage, seules les règles en erreur sont dépliées :
  // tout ouvrir enterrait les erreurs sous les avertissements.
  if (!dqUI.autoOpened && ruleOrder.length) {
    ruleOrder.filter(r => r.severity === 'error').forEach(r => dqUI.open.add(r.ruleId));
    dqUI.autoOpened = true;
  }
  // Une recherche active déplie tout : sinon les correspondances
  // restent invisibles dans des cartes fermées.
  const forceOpen = !!dqUI.search;

  // ── Ligne de résultats ────────────────────────────────────────
  const barEl = document.getElementById('dq-resultbar');
  if (barEl) {
    const filtered = !!(dqUI.tracker || dqUI.severity || dqUI.category || dqUI.scope || dqUI.search);
    barEl.innerHTML = `
      <div><b>${issues.length}</b> anomal${issues.length > 1 ? 'ies' : 'y'} · <b>${ruleOrder.length}</b> rule${ruleOrder.length > 1 ? 's' : ''} · <b>${affected}</b> ticket${affected > 1 ? 's' : ''} affected</div>
      <div class="dq-resultbar-right">
        ${filtered ? `<button class="dq-linkbtn" onclick="dqResetFilters()">Reset filters</button>` : ''}
        ${ruleOrder.length ? `<button class="dq-linkbtn" onclick="dqToggleAll()">${dqUI.open.size ? 'Collapse all' : 'Expand all'}</button>` : ''}
      </div>`;
  }

  // ── État vide ─────────────────────────────────────────────────
  if (!issues.length) {
    const filtered = !!(dqUI.tracker || dqUI.severity || dqUI.category || dqUI.scope || dqUI.search);
    el.innerHTML = `<div class="dq-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      <div class="dq-empty-title">${filtered ? 'No result for these filters' : 'No inconsistency detected'}</div>
      <div class="dq-empty-sub">${filtered
        ? 'Widen the search or reset the filters.'
        : 'All tickets comply with the quality rules.'}</div>
      ${filtered ? '<button class="dq-linkbtn" style="margin-top:12px" onclick="dqResetFilters()">Reset filters</button>' : ''}
    </div>`;
    return;
  }

  const catColors = {
    'Lifecycle': '#1A73E8', 'Dates': '#4285F4', 'Mandatory': '#D93025',
    'Duplicates': '#5E97F6', 'Quality': '#1E8E3E', 'SLA': '#F9AB00'
  };

  el.innerHTML = ruleOrder.map(({ ruleId, rule, severity, items }) => {
    const isOpen = forceOpen || dqUI.open.has(ruleId);
    const mod    = severity === 'error' ? 'err' : severity === 'info' ? 'info' : 'warn';
    const sevLbl = severity === 'error' ? 'Erreur' : severity === 'info' ? 'Info' : 'Warning';
    const sevIco = severity === 'warning'
      ? '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'
      : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>';
    const catCol = catColors[rule.category] || 'var(--m3-on-surf-var)';

    // Grandes règles tronquées : 40 lignes de « TT# manquant » repoussent
    // les règles suivantes hors de l'écran.
    const showAll  = dqUI.expanded.has(ruleId) || items.length <= DQ_ROWS_COLLAPSED;
    const shown    = showAll ? items : items.slice(0, DQ_ROWS_COLLAPSED);
    const hidden   = items.length - shown.length;

    const rows = shown.map(({ ticket: t, detail }) => {
      const tn = t._tracker;
      const closeMissing = !t.close_date && (t.status === 'Closed' || t.status === 'Resolved');
      return `<tr onclick="openEditTicket(${escAttrArg(tn.toLowerCase())},${escAttrArg(t.id)})">
        <td><span class="dqr-site dqr-site-${esc(tn.toLowerCase())}">${esc(tn)}</span></td>
        <td class="dqr-tt">${dqHi(t.sn_tt || '—')}</td>
        <td class="dqr-title" title="${esc(t.title || '')}">${dqHi(t.title || '—')}</td>
        <td>${t.priority ? `<span class="badge badge-${esc((t.priority).toLowerCase())}">${esc(t.priority)}</span>` : '<span class="dqr-dim">—</span>'}</td>
        <td class="dqr-dim">${esc(t.status || '—')}</td>
        <td class="dqr-dim">${fmtD(t.open_date)}</td>
        <td class="${closeMissing ? 'dqr-miss' : 'dqr-dim'}">${fmtD(t.close_date)}</td>
        <td class="dqr-detail" title="${esc(detail)}">${dqHi(detail)}</td>
      </tr>`;
    }).join('');

    return `<div class="dqr ${mod} ${isOpen ? 'open' : ''}">
      <div class="dqr-head" onclick="dqToggleRule('${ruleId}')">
        <div class="dqr-accent"></div>
        <div class="dqr-head-main">
          <div class="dqr-tags">
            <span class="dqr-sev">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">${sevIco}</svg>${sevLbl}
            </span>
            <span class="dqr-cat" style="color:${catCol};background:${catCol}1F">${rule.category}</span>
            <code class="dqr-id">${ruleId}</code>
          </div>
          <div class="dqr-title-main">${dqHi(rule.title)}</div>
          <div class="dqr-desc">${esc(rule.description)}</div>
          <div class="dqr-fix">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            <span><strong>Action :</strong> ${esc(rule.fix)}</span>
          </div>
        </div>
        <div class="dqr-count">
          <span class="dqr-count-n">${items.length}</span>
          <span class="dqr-count-l">ticket${items.length > 1 ? 's' : ''}</span>
        </div>
        <span class="dqr-caret">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </span>
      </div>
      <div class="dqr-body">
        <div class="dqr-tablewrap">
          <table class="dqr-table">
            <thead><tr>
              <th>Site</th><th>TT#</th><th>Titre</th><th>Priority</th>
              <th>Statut</th><th>Ouverture</th><th>Closure</th>
              <th class="dqr-th-problem">Issue detected</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ${hidden > 0 ? `<button class="dqr-more" onclick="dqExpandRows('${ruleId}',event)">Show the ${hidden} ticket${hidden > 1 ? 's' : ''} restant${hidden > 1 ? 's' : ''}</button>` : ''}
      </div>
    </div>`;
  }).join('');
}


