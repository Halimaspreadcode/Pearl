// ── HEATMAP FO WORKLOAD ──────────────────────────────────────
window._hmPeriod = 'day';

function setHeatmapPeriod(period) {
  window._hmPeriod = period;
  document.querySelectorAll('.hm-tab').forEach(function(t){ t.classList.toggle('active', t.dataset.period === period); });
  renderFOHeatmap(period);
}

function renderFOHeatmap(period) {
  const hbody = document.getElementById('dc-heatmap-body');
  if (!hbody) return;

  // La carte suivait sa propre logique : tous les tickets, tous les FO,
  // sans tenir compte du pays ni de la période choisis en haut de page.
  // Elle contredisait donc le reste du dashboard. Elle applique
  // maintenant les mêmes filtres.
  const country = typeof getActiveCountry === 'function' ? getActiveCountry() : 'ALL';
  const range   = typeof getDashPeriodRange === 'function' ? getDashPeriodRange() : null;
  let allTickets = [
    ...(country !== 'CI' ? (state.sn || []) : []),
    ...(country !== 'SN' ? (state.ci || []) : []),
  ];
  if (range) {
    allTickets = allTickets.filter(t => {
      if (!t.open_date) return false;
      const d = new Date(t.open_date);
      return d >= range.from && d < range.to;
    });
  }

  const foList = state.config.fo_list || [];
  if (!foList.length) {
    hbody.innerHTML = '<div class="d-empty">No Front Office configured</div>';
    return;
  }

  const now = new Date();
  const MONTHS = ['Jan','Feb','Mar','Avr','Mai','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let cols = [];
  if (period === 'day') {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now); d.setDate(now.getDate()-i); d.setHours(0,0,0,0);
      const d2 = new Date(d); d2.setDate(d.getDate()+1);
      cols.push({ label: d.getDate()+'/'+(d.getMonth()+1), from: d, to: d2 });
    }
  } else if (period === 'week') {
    for (let i = 9; i >= 0; i--) {
      const wEnd = new Date(now); wEnd.setDate(now.getDate()-i*7); wEnd.setHours(23,59,59,999);
      const wStart = new Date(wEnd); wStart.setDate(wEnd.getDate()-6); wStart.setHours(0,0,0,0);
      cols.push({ label: 'S'+wEnd.getDate()+'/'+(wEnd.getMonth()+1), from: wStart, to: new Date(wEnd.getTime()+1) });
    }
  } else {
    for (let i = 7; i >= 0; i--) {
      const m = new Date(now.getFullYear(), now.getMonth()-i, 1);
      const mEnd = new Date(now.getFullYear(), now.getMonth()-i+1, 0, 23, 59, 59);
      cols.push({ label: MONTHS[m.getMonth()], from: m, to: new Date(mEnd.getTime()+1) });
    }
  }

  // Un seul passage sur les tickets au lieu de foList × cols filtrages
  // complets (10 × 12 = 120 parcours de la liste auparavant).
  const counts = new Map();
  const totals = new Map();
  allTickets.forEach(t => {
    if (!t.open_date) return;
    const d = new Date(t.open_date);
    let ci = -1;
    for (let i = 0; i < cols.length; i++) {
      if (d >= cols[i].from && d < cols[i].to) { ci = i; break; }
    }
    if (ci === -1) return;
    // Un ticket compte pour son porteur ET son assigné s'ils diffèrent.
    const who = new Set([t.fo_owner, t.assigned_to].filter(Boolean));
    who.forEach(fo => {
      const key = fo + '|' + ci;
      counts.set(key, (counts.get(key) || 0) + 1);
      totals.set(fo, (totals.get(fo) || 0) + 1);
    });
  });

  // Seuils relatifs au volume réel : un palier fixe (1/3/6) affichait
  // tout en rouge dès qu'une équipe montait en charge.
  const maxN = Math.max(1, ...counts.values());
  const toV = n => {
    if (n === 0) return 0;
    const r = n / maxN;
    return r <= 0.25 ? 1 : r <= 0.5 ? 2 : r <= 0.75 ? 3 : 4;
  };

  // On masque les FO sans aucun ticket sur la période, et on trie par
  // charge décroissante : les lignes vides n'apprenaient rien et
  // repoussaient les FO chargés en bas de la carte.
  const active = foList
    .filter(fo => (totals.get(fo) || 0) > 0)
    .sort((a, b) => (totals.get(b) || 0) - (totals.get(a) || 0));

  if (!active.length) {
    hbody.innerHTML = '<div class="d-empty">No ticket in the selected period</div>';
    return;
  }

  const hidden = foList.length - active.length;

  // En-têtes : la trame temporelle n'a plus une étiquette par colonne
  // (12 dates illisibles à 9px) mais une seule mention de la plage.
  const spanLabel = cols[0].label + ' → ' + cols[cols.length - 1].label;
  const colLabels = '<div class="hm-col-labels">' +
    '<div class="hm-col-head">Front Office</div>' +
    '<div class="hm-col-head trend">' + spanLabel + '</div>' +
    '<div class="hm-col-head">Load</div>' +
    '<div class="hm-total-label">Total</div></div>';

  // Charge relative au FO le plus chargé : c'est la comparaison utile.
  const maxTotal = Math.max(1, ...active.map(fo => totals.get(fo) || 0));

  const rows = active.map((fo, idx) => {
    const foShort = fo.split(' ').slice(-1)[0];
    const tot = totals.get(fo) || 0;
    const cells = cols.map((col, i) => {
      const n = counts.get(fo + '|' + i) || 0;
      const lbl = fo + ' · ' + col.label + ' : ' + n + ' ticket' + (n > 1 ? 's' : '');
      return '<div class="hm-cell" data-v="' + toV(n) + '" data-label="' + lbl + '"' +
             ' onmouseenter="showHMHover(this)" onmouseleave="hideHMHover()"></div>';
    }).join('');
    const pct = Math.round((tot / maxTotal) * 100);
    return '<div class="hm-row"' + (idx === 0 ? ' data-top="1"' : '') + '>' +
           '<div class="hm-label" title="' + fo + '">' + foShort + '</div>' +
           '<div class="hm-cells">' + cells + '</div>' +
           '<div class="hm-bar" title="' + tot + ' ticket' + (tot > 1 ? 's' : '') + '">' +
             '<span class="hm-bar-fill" style="width:' + pct + '%"></span></div>' +
           '<div class="hm-total">' + tot + '</div></div>';
  }).join('');

  const foot = hidden > 0
    ? '<div class="hm-foot">' + hidden + ' FOs with no ticket in the period — hidden</div>'
    : '';

  hbody.innerHTML = '<div class="hm-grid">' + colLabels + rows + '</div>' + foot;
}

// Le panneau garde sa place en permanence : le masquer au mouseleave
// faisait rétrécir la carte et recomprimait la grille à chaque
// aller-retour de la souris. Seul son contenu change.
const HM_HOVER_IDLE =
  '<div class="hm-hover-idle">Hover a cell<br>for details</div>';

function showHMHover(el) {
  const panel = document.getElementById('hm-hover-panel');
  if (!panel) return;
  const label = el.getAttribute('data-label') || '';
  // parse "FO · date : N ticket(s)"
  const parts = label.split(' : ');
  const who   = parts[0] || '';
  const count = parts[1] || '0';
  const n = parseInt(count);
  const v = parseInt(el.getAttribute('data-v') || 0);
  panel.innerHTML = `
    <div class="hm-hover-name">${who.split(' · ')[0]}</div>
    <div class="hm-hover-date">${who.split(' · ')[1] || ''}</div>
    <div class="hm-hover-val"${v >= 3 ? ' data-hot="1"' : ''}>${n}</div>
    <div class="hm-hover-unit">ticket${n !== 1 ? 's' : ''}</div>
  `;
}
function hideHMHover() {
  const panel = document.getElementById('hm-hover-panel');
  if (panel) panel.innerHTML = HM_HOVER_IDLE;
}

// ── BY DOMAIN BAR CHART ──────────────────────────────────────
// Palette Google/Pixel : bleu dominant, accents mesurés. L'arc-en-ciel
// précédent (indigo + cyan + émeraude + ambre + violet + rose) donnait
// un rendu bariolé, très loin du langage Material.
const DOMAIN_COLORS = ['#1A73E8','#5E97F6','#7BAAF7','#A8C7FA','#174EA6','#4285F4','#8AB4F8','#C2D7FD'];
const STATUS_COLORS = { 'Open':'#1A73E8', 'In Progress':'#F9AB00', 'Resolved':'#1E8E3E', 'Closed':'#9AA0A6' };
const PRIO_COLORS   = { P1:'#D93025', P2:'#F9AB00', P3:'#1A73E8', P4:'#9AA0A6' };
const STATUS_ORDER  = ['Open','In Progress','Resolved','Closed'];
const PRIO_ORDER    = ['P1','P2','P3','P4'];

function _domainBreakdown(domain) {
  const tickets = [...(state.sn||[]), ...(state.ci||[])].filter(t => t.domain === domain);
  const byStatus = {}, byPrio = {};
  tickets.forEach(t => {
    const s = t.status   || 'Unknown';
    const p = t.priority || 'Unknown';
    byStatus[s] = (byStatus[s]||0) + 1;
    byPrio[p]   = (byPrio[p]||0)   + 1;
  });
  return { total: tickets.length, byStatus, byPrio };
}

function renderDomainTiles(byDomain) {
  const el = document.getElementById('dc-domain-list');
  if (!el) return;
  const entries = Object.entries(byDomain).sort((a,b) => b[1]-a[1]);
  if (!entries.length) {
    el.innerHTML = '<div style="color:var(--mute);font-size:12px;padding:8px 0">No data</div>';
    return;
  }
  const total = entries.reduce((s,[,v]) => s+v, 0) || 1;
  const max   = entries[0][1] || 1;

  el.innerHTML = entries.map(([k,v], i) => {
    const color = DOMAIN_COLORS[i % DOMAIN_COLORS.length];
    const pct   = Math.round(v / total * 100);
    const { byStatus } = _domainBreakdown(k);
    // stacked segments: Open/InProgress/Resolved/Closed proportional to v
    const segHtml = STATUS_ORDER.map(s => {
      const sv = byStatus[s] || 0;
      const sw = sv > 0 ? (sv / v * 100).toFixed(1) : 0;
      return `<div class="dom-bar-seg-part" style="width:0%;background:${STATUS_COLORS[s]||'#94a3b8'}" data-w="${sw}"></div>`;
    }).join('');
    // remaining bar fill (color) sized to ticket ratio vs max
    const barW = (v / max * 100).toFixed(1);
    return `<div class="dom-bar-row" data-domain="${k.replace(/"/g,'&quot;')}" data-idx="${i}"
        onclick="filterDomainDash('${k.replace(/'/g,"\\'")}')">
      <div class="dom-bar-label" title="${k}">${k}</div>
      <div class="dom-bar-track" data-total-w="${barW}">
        <div class="dom-bar-seg" style="width:0%">${segHtml}</div>
      </div>
      <div class="dom-bar-count">${v}</div>
      <div class="dom-bar-pct">${pct}%</div>
    </div>`;
  }).join('');

  // animate after paint
  requestAnimationFrame(() => {
    el.querySelectorAll('.dom-bar-row').forEach(row => {
      const track = row.querySelector('.dom-bar-track');
      const seg   = row.querySelector('.dom-bar-seg');
      if (seg) seg.style.width = track.dataset.totalW + '%';
      row.querySelectorAll('.dom-bar-seg-part').forEach(p => {
        p.style.width = p.dataset.w + '%';
      });
    });
  });

  // hover → show detail panel
  el.querySelectorAll('.dom-bar-row').forEach(row => {
    row.addEventListener('mouseenter', () => _showDomainDetail(row.dataset.domain, row.dataset.idx, row));
    row.addEventListener('mouseleave', () => row.classList.remove('active'));
  });

  // show first row detail by default
  const firstRow = el.querySelector('.dom-bar-row');
  if (firstRow) _showDomainDetail(firstRow.dataset.domain, firstRow.dataset.idx, firstRow);
}

function _showDomainDetail(domain, idx, rowEl) {
  const panel = document.getElementById('dc-domain-detail');
  if (!panel) return;

  // highlight active row
  document.querySelectorAll('.dom-bar-row').forEach(r => r.classList.remove('active'));
  if (rowEl) rowEl.classList.add('active');

  const color = DOMAIN_COLORS[idx % DOMAIN_COLORS.length];
  const { total, byStatus, byPrio } = _domainBreakdown(domain);

  const statusRows = STATUS_ORDER
    .filter(s => byStatus[s])
    .map(s => {
      const n = byStatus[s];
      const p = Math.round(n / total * 100);
      return `<div class="dom-detail-row">
        <div class="dom-detail-dot" style="background:${STATUS_COLORS[s]}"></div>
        <span class="dom-detail-label">${s}</span>
        <span class="dom-detail-val">${n}</span>
        <span style="font-size:10px;color:var(--mute);width:28px;text-align:right">${p}%</span>
      </div>`;
    }).join('') || '<div style="font-size:11px;color:var(--mute)">-</div>';

  const prioRows = PRIO_ORDER
    .filter(p => byPrio[p])
    .map(p => {
      const n = byPrio[p];
      return `<div class="dom-detail-row">
        <div class="dom-detail-sq" style="background:${PRIO_COLORS[p]}"></div>
        <span class="dom-detail-label">${p}</span>
        <span class="dom-detail-val">${n}</span>
      </div>`;
    }).join('') || '<div style="font-size:11px;color:var(--mute)">-</div>';

  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <div style="width:10px;height:10px;border-radius:3px;background:${color};flex-shrink:0"></div>
      <div class="dom-detail-title">${domain}</div>
    </div>
    <div style="font-size:22px;font-weight:800;color:var(--dark);letter-spacing:-.03em;line-height:1">${total}</div>
    <div style="font-size:10px;color:var(--mute);margin-bottom:10px">tickets</div>
    <div class="dom-detail-section">Status</div>
    ${statusRows}
    <div class="dom-detail-section">Priority</div>
    ${prioRows}
    <div class="dom-detail-hint">↗ click to filter</div>`;
}

function filterDomainDash(domain) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navEl = document.querySelector('.nav-item[data-page="sn"]');
  if (navEl) navEl.classList.add('active');
  renderPage('sn');
  setTimeout(() => {
    const df = document.getElementById('sn-filter-domain');
    if (df) { df.value = domain; filterTable('sn'); }
  }, 60);
}

