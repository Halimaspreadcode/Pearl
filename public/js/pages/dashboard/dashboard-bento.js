// ══════════════════════════════════════════════════════════════
// BENTO EXPRESSIF — 4 cartes
// Toutes les valeurs viennent de _computeDashboardKpis() et des
// tickets réellement chargés. Aucune projection, aucune tendance
// extrapolée : quand la donnée manque, la carte le dit.
// ══════════════════════════════════════════════════════════════

// Taux d'absence sur la période affichée, calculé depuis le planning.
//
// ⚠ Limite des données : shifts_plan ne connaît que "Scheduled" et
// "Rest" — aucun statut d'absence. Les absences réelles vivent dans
// shift_requests (type 'absence'), table aujourd'hui vide. Le taux
// vaut donc 0 % tant qu'aucune demande n'est enregistrée ; ce n'est
// pas un bug d'affichage mais une absence de source.
function _bxAbsenceStats() {
  const country = typeof getActiveCountry === 'function' ? getActiveCountry() : 'ALL';
  const range   = typeof getDashPeriodRange === 'function' ? getDashPeriodRange() : null;
  const inRange = iso => {
    if (!range || !iso) return true;
    const d = new Date(iso + 'T00:00:00Z');
    return d >= range.from && d < range.to;
  };

  // Shifts effectivement planifiés (les jours de repos ne comptent pas
  // dans le dénominateur : on ne peut pas être absent d'un repos).
  const planned = (state.shiftsPlan || []).filter(s =>
    !s.is_rest &&
    (country === 'ALL' || (s.tracker || 'SN') === country) &&
    inRange(s.date));

  const absences = (state.shiftRequests || []).filter(r =>
    r.type === 'absence' && r.status !== 'rejected' && inRange(r.date));

  const denom = planned.length;
  const n     = absences.length;

  // Répartition par agent : un taux global ne distingue pas un congé
  // long d'une poussière d'absences ponctuelles. Trié décroissant,
  // le premier nom porte donc l'essentiel de l'explication.
  const byFo = {};
  absences.forEach(r => {
    const k = r.fo_name || '—';
    byFo[k] = (byFo[k] || 0) + 1;
  });
  const top = Object.entries(byFo).sort((a, b) => b[1] - a[1]);

  return {
    n, denom,
    pct: denom > 0 ? Math.round((n / denom) * 100) : 0,
    people: top.length,
    top,
  };
}

// Teintes des domaines. Codées en dur et non dérivées d'un index de
// tableau : un domaine doit garder la même couleur quel que soit le
// tri ou la période affichée, sinon la légende ment d'un mois à l'autre.
// Choisies pour rester distinguables côte à côte sur fond sombre.
const BX_DOMAIN_COLORS = {
  MMC:      '#6EA8FE',   // bleu
  HCS:      '#5FD4A6',   // vert d'eau
  INFRA:    '#F0B354',   // ambre
  LTS:      '#B79BFF',   // violet
  SECURITY: '#F4788B',   // rose-rouge
  DB:       '#4FC3D9',   // cyan
  DM:       '#D9A066',   // terre
};

// Palette : dérivée des tokens, pas de teinte codée en dur.
function _bxSegColor(key) {
  const map = {
    P1: 'var(--p1-fg)', P2: 'var(--p2-fg)', P3: 'var(--p3-fg)', P4: 'var(--p4-fg)',
    'Open': 'var(--c-blue)', 'In Progress': 'var(--c-violet)',
    'Resolved': 'var(--ok-fg)', 'Closed': 'var(--mute)',
    // Couleurs des drapeaux : vert pour le Sénégal, orange pour la Côte d'Ivoire.
    SN: 'var(--c-sn)', CI: 'var(--c-ci)',
  };
  if (map[key]) return map[key];

  // Domaine connu → teinte dédiée ; domaine inattendu → teinte stable
  // tirée de la même palette par hachage du nom (jamais le gris neutre,
  // qui rendait tous les segments identiques).
  const dk = String(key || '').trim().toUpperCase();
  if (BX_DOMAIN_COLORS[dk]) return BX_DOMAIN_COLORS[dk];
  if (dk && dk !== '—') {
    const pool = Object.values(BX_DOMAIN_COLORS);
    let h = 0;
    for (let i = 0; i < dk.length; i++) h = (h * 31 + dk.charCodeAt(i)) >>> 0;
    return pool[h % pool.length];
  }
  return 'var(--m3-on-surf-var)';
}

// Initiales pour les avatars empilés (2 lettres max).
function _bxInitials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

// Couleur d'avatar stable pour un même nom (hash → palette domaine).
function _bxAvatarColor(name) {
  let h = 0;
  const s = String(name || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return DOMAIN_COLORS[h % DOMAIN_COLORS.length];
}

function renderBentoCards(kpis) {
  // Appelée aussi par les contrôles internes (select, flèches) sans
  // argument : on recalcule alors sur le même périmètre que le dashboard.
  const d = kpis || _computeDashboardKpis(
    typeof getActiveCountry === 'function' ? getActiveCountry() : 'ALL',
    typeof getDashPeriodRange === 'function' ? getDashPeriodRange() : null
  );
  const country = typeof getActiveCountry === 'function' ? getActiveCountry() : 'ALL';
  const range   = typeof getDashPeriodRange === 'function' ? getDashPeriodRange() : null;

  // Périmètre de tickets identique à celui des KPI (pays + période).
  let tickets = [
    ...(country !== 'CI' ? (state.sn || []).map(t => ({ ...t, tracker: 'SN' })) : []),
    ...(country !== 'SN' ? (state.ci || []).map(t => ({ ...t, tracker: 'CI' })) : []),
  ];
  if (range) {
    tickets = tickets.filter(t => {
      if (!t.open_date) return false;
      const dt = new Date(t.open_date);
      return dt >= range.from && dt < range.to;
    });
  }

  _bxRenderVolume(d, tickets);
  _bxRenderRecent(tickets);
  _bxRenderForecast(d);
}

// ── Carte A : volume ────────────────────────────────────────
// Deux barres empilées = les deux derniers mois présents dans les
// données. Un mois sans ticket n'est pas dessiné plutôt qu'affiché
// à zéro (une barre vide se lit comme une donnée manquante).
function _bxRenderVolume(d, tickets) {
  const colsEl = document.getElementById('bx-volume-cols');
  const legEl  = document.getElementById('bx-volume-legend');
  if (!colsEl) return;

  const total = d.total || 0;
  const valEl = document.getElementById('bx-volume-val');
  if (valEl) valEl.textContent = total.toLocaleString('en-GB');

  const mode = document.getElementById('bx-volume-mode')?.value || 'tracker';
  const keyOf = t => mode === 'status'   ? (t.status   || '—')
               : mode === 'priority' ? (t.priority || '—')
               : mode === 'domain'   ? (t.domain   || '—')
               : (t.tracker  || '—');

  // Regroupement par mois calendaire (clé triable AAAA-MM).
  const months = new Map();
  tickets.forEach(t => {
    if (!t.open_date) return;
    const dt = new Date(t.open_date);
    if (isNaN(dt)) return;
    const mk = dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0');
    if (!months.has(mk)) months.set(mk, { n: 0, by: {} });
    const m = months.get(mk);
    m.n++;
    const k = keyOf(t);
    m.by[k] = (m.by[k] || 0) + 1;
  });

  const subEl = document.getElementById('bx-volume-sub');
  if (!months.size) {
    colsEl.innerHTML = '<div class="bx-empty" style="opacity:.7">No dated ticket in the period</div>';
    if (legEl) legEl.innerHTML = '';
    if (subEl) subEl.textContent = 'No data for the period';
    return;
  }

  const ordered = [...months.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const shown   = ordered.slice(-2);            // les 2 derniers mois présents
  const max     = Math.max(...shown.map(([, m]) => m.n), 1);
  const H       = 150;                           // hauteur de piste, en px

  if (subEl) {
    subEl.textContent = shown.length > 1
      ? `Last ${shown.length} months with activity`
      : 'Only one month with activity';
  }

  const monthName = mk => {
    const [y, m] = mk.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1))
      .toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  };

  const allKeys = new Set();
  colsEl.innerHTML = shown.map(([mk, m]) => {
    const stackH = Math.max(6, Math.round((m.n / max) * H));
    const segs = Object.entries(m.by).sort((a, b) => b[1] - a[1]);
    segs.forEach(([k]) => allKeys.add(k));
    const inner = segs.map(([k, v]) => {
      const h = Math.max(2, Math.round((v / m.n) * stackH));
      return `<div class="bx-seg" style="height:${h}px;background:${_bxSegColor(k)}"
                   title="${esc(k)} : ${v} ticket${v > 1 ? 's' : ''}"></div>`;
    }).join('');
    return `<div class="bx-col">
      <div class="bx-col-cap" title="${esc(monthName(mk))} — ${m.n} ticket${m.n > 1 ? 's' : ''}">
        ${esc(monthName(mk))}
      </div>
      <div class="bx-col-track" style="height:${H}px">
        <div class="bx-col-stack" style="height:${stackH}px">${inner}</div>
      </div>
    </div>`;
  }).join('');

  if (legEl) {
    legEl.innerHTML = [...allKeys].map(k =>
      `<span class="k"><i style="background:${_bxSegColor(k)}"></i>${esc(k)}</span>`
    ).join('');
  }

  // ── Répartition détaillée (colonne de droite) ──
  // Reprend l'axe sélectionné et le chiffre sur toute la période, pas
  // seulement sur les 2 mois dessinés : les barres montrent la
  // tendance, cette colonne donne le décompte.
  const brkEl = document.getElementById('bx-volume-break');
  if (brkEl) {
    const tally = {};
    tickets.forEach(t => { const k = keyOf(t); tally[k] = (tally[k] || 0) + 1; });
    const rows = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const sum  = rows.reduce((s, [, v]) => s + v, 0) || 1;
    const top  = rows.length ? rows[0][1] : 1;

    const MODE_LBL = { tracker:'country', status:'status', domain:'domain', priority:'priority' };
    brkEl.innerHTML = !rows.length
      ? '<div class="bx-empty" style="opacity:.7">No breakdown</div>'
      : `<div class="bx-break-h">Breakdown by ${MODE_LBL[mode] || mode}</div>` +
        rows.map(([k, v]) => {
          const pct = Math.round((v / sum) * 100);
          return `<div class="bx-break-row" title="${esc(k)} : ${v} ticket${v > 1 ? 's' : ''}">
            <span class="bx-break-k">
              <i class="bx-break-dot" style="background:${_bxSegColor(k)}"></i><b class="bx-break-t">${esc(k)}</b>
            </span>
            <span class="bx-break-bar">
              <i style="width:${Math.round((v / top) * 100)}%;background:${_bxSegColor(k)}"></i>
            </span>
            <span class="bx-break-v">${v}</span>
            <span class="bx-break-p">${pct}%</span>
          </div>`;
        }).join('') +
        (Object.keys(tally).length > rows.length
          ? `<div class="bx-break-more">+${Object.keys(tally).length - rows.length} autre${Object.keys(tally).length - rows.length > 1 ? 's' : ''}</div>`
          : '');
  }
}

// ── Carte B : derniers tickets ouverts ──────────────────────
function _bxRenderRecent(tickets) {
  const rowsEl = document.getElementById('bx-recent-rows');
  const avsEl  = document.getElementById('bx-recent-avs');
  const subEl  = document.getElementById('bx-recent-sub');
  if (!rowsEl) return;

  const recent = tickets
    .filter(t => t.open_date && !isNaN(new Date(t.open_date)))
    .sort((a, b) => new Date(b.open_date) - new Date(a.open_date))
    .slice(0, 4);

  if (subEl) {
    subEl.textContent = recent.length
      ? `${recent.length} most recent of ${tickets.length}`
      : 'No ticket in the period';
  }

  // Avatars : les FO distincts qui portent ces tickets.
  if (avsEl) {
    const owners = [...new Set(recent.map(t => t.fo_owner).filter(Boolean))].slice(0, 3);
    avsEl.innerHTML = owners.map(o =>
      `<span class="bx-av" style="background:${_bxAvatarColor(o)}" title="${esc(o)}">${esc(_bxInitials(o))}</span>`
    ).join('');
  }

  if (!recent.length) {
    rowsEl.innerHTML = '<div class="bx-empty">No ticket in the selected period</div>';
    return;
  }

  const fmt = dt => new Date(dt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

  rowsEl.innerHTML = recent.map(t => {
    // La priorité reste toujours visible ; la rupture SLA s'ajoute à côté
    // au lieu de la remplacer.
    const breached = t.sla_status === 'Breach';
    const prio = String(t.priority || '').toUpperCase();
    const right = (prio ? `<span class="bx-prio bx-prio-${esc(prio.toLowerCase())}">${esc(prio)}</span>` : '') +
                  (breached ? '<span class="bx-row-alert">SLA breach</span>' : '');
    // Numéro affiché : SN TT, sinon IMOC TT, jamais l'identifiant interne.
    const num = t.sn_tt || t.imoc_tt || '—';
    return `<button class="bx-row"
        onclick="navigateToTicket('${esc((t.tracker || '').toLowerCase())}','${esc(t.id)}')"
        title="${esc(t.title || '')}">
      <span class="bx-row-ico">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><line x1="7" y1="9" x2="13" y2="9"/><line x1="7" y1="13" x2="11" y2="13"/></svg>
      </span>
      <span class="bx-row-main">
        <span class="bx-row-t">[${esc(t.tracker)}] ${esc(num)}</span>
        <span class="bx-row-s">${esc(t.title || 'Untitled')} · ${fmt(t.open_date)}</span>
      </span>
      <span class="bx-row-v">${right}</span>
    </button>`;
  }).join('');
}

// ── Carte C : activité récente + tuiles ─────────────────────
function _bxRenderForecast(d) {
  const tlEl = document.getElementById('bx-forecast-tl');

  // Timeline : les 4 derniers jours de la série réelle (spark), du
  // plus ancien au plus récent. Le dernier point est marqué "on".
  if (tlEl) {
    const sp = d.spark || {};
    const days = sp.days || [];
    const idx = days.map((_, i) => i).slice(-4);
    if (!idx.length) {
      tlEl.innerHTML = '<div class="bx-empty">No history available</div>';
    } else {
      // Échelle commune aux 4 jours : les barres ne sont comparables
      // entre elles que si elles partagent le même dénominateur.
      const dayMax = Math.max(1, ...idx.map(i =>
        ((sp.created || [])[i] || 0) + ((sp.resolved || [])[i] || 0)));

      // Le jour le plus récent de la série n'est "aujourd'hui" que s'il
      // tombe réellement sur la date du jour : sur une période passée,
      // le badge mentirait.
      const todayISO = new Date().toISOString().slice(0, 10);

      tlEl.innerHTML = idx.map((i, n) => {
        const created  = (sp.created  || [])[i] || 0;
        const resolved = (sp.resolved || [])[i] || 0;
        // Majuscule initiale : "lundi 4 août" plutôt que "lundi 4 août"
        // en tête de ligne, sans passer par text-transform (qui
        // capitaliserait aussi le mois).
        const raw = new Date(days[i] + 'T00:00:00Z')
          .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
        const label = raw.charAt(0).toUpperCase() + raw.slice(1);
        const last = n === idx.length - 1;
        const none = !created && !resolved;
        // La colonne de droite était vide : on y met le volume du jour,
        // scindé ouverts / clôturés. La proportion se lit d'un coup
        // d'œil, ce que "5 ouverts · 2 clôturés" ne donne pas.
        const wC = Math.round((created  / dayMax) * 100);
        const wR = Math.round((resolved / dayMax) * 100);
        const bar = none
          ? '<span class="bx-tl-bar-empty"></span>'
          : `<span class="bx-tl-seg open" style="width:${wC}%" title="${created} opened"></span>` +
            `<span class="bx-tl-seg done" style="width:${wR}%" title="${resolved} closed"></span>`;
        const badge = last && days[i] === todayISO
          ? '<span class="bx-tl-now">Today</span>' : '';
        return `<div class="bx-tl-item${last ? ' on' : ''}">
          <span class="bx-tl-dot"></span>
          <span class="bx-tl-body">
            <span class="bx-tl-k">${esc(label)}${badge}</span>
            <span class="bx-tl-v">${none
              ? '<span class="bx-tl-chip">No movement</span>'
              : `<span class="bx-tl-chip in"><b>${created}</b> opened</span>` +
                `<span class="bx-tl-chip out"><b>${resolved}</b> closed</span>`}</span>
          </span>
          <span class="bx-tl-bar">${bar}</span>
        </div>`;
      }).join('') +
      // Légende unique : les pastilles des lignes n'ont plus à porter
      // leur propre explication.
      `<div class="bx-tl-key">
        <span><i style="background:var(--act-in)"></i>Open</span>
        <span><i style="background:var(--act-out)"></i>Closed</span>
      </div>`;
    }
  }

  const subEl = document.getElementById('bx-forecast-sub');
  if (subEl) {
    const med = d.median_resolution_h;
    subEl.textContent = med != null
      ? `Median resolution: ${med < 24 ? Math.round(med) + ' h' : (med / 24).toFixed(1) + ' d'}`
      : 'Median resolution unavailable';
  }

  _bxRenderAbsenceTile();
}

// ── Carte « Taux d'absence » (colonne de la carte C) ────────
// Le taux seul ne dit rien : sans dénominateur il se lit comme un
// score, et sans répartition on ne sait pas s'il vient d'un congé
// long ou d'absences dispersées. La carte porte donc les trois.
function _bxRenderAbsenceTile() {
  const card = document.getElementById('bx-tile-abs');
  if (!card) return;
  const a = _bxAbsenceStats();

  // Aucun shift planifié sur la période → pas de dénominateur, donc
  // pas de taux. On l'affiche comme absent, jamais comme 0 %.
  const noScope = !a.denom;
  card.classList.toggle('is-empty', noScope);

  const val = document.getElementById('bx-tile-abs-val');
  if (val) val.innerHTML = noScope
    ? '—'
    : `${a.pct}<span class="unit">%</span>`;

  const sub = document.getElementById('bx-tile-abs-sub');
  if (sub) sub.textContent = noScope
    ? 'No shift planned in the period'
    : `${a.n} absence${a.n > 1 ? 's' : ''} across ${a.denom} planned shift${a.denom > 1 ? 's' : ''}`;

  // Anneau : r=30 → circonférence 2πr. Périmètre vide = piste neutre.
  const ring = document.getElementById('bx-abs-ring');
  if (ring) {
    const circ = 2 * Math.PI * 30;
    ring.style.strokeDasharray  = circ.toFixed(1);
    ring.style.strokeDashoffset = (circ * (1 - (noScope ? 0 : a.pct) / 100)).toFixed(1);
    // Au-delà de 15 % d'absence l'effectif ne tient plus le planning :
    // l'anneau bascule alors sur la teinte d'alerte du dashboard.
    ring.style.stroke = noScope ? 'var(--line)'
      : (a.pct >= 15 ? 'var(--m3-error)' : 'var(--c-teal)');
  }

  // Répartition par agent, plafonnée à 4 lignes — au-delà la liste
  // concurrencerait la timeline voisine. Le reste part dans le pied.
  const list = document.getElementById('bx-tile-abs-list');
  if (list) {
    const top = (a.top || []).slice(0, 4);
    const max = top.length ? top[0][1] : 1;
    list.innerHTML = top.map(([name, cnt]) => `
      <div class="bx-abs-row" title="${esc(name)} — ${cnt} jour${cnt > 1 ? 's' : ''}">
        <span class="bx-abs-k">
          <span class="bx-abs-av" style="background:${_bxAvatarColor(name)}">${esc(_bxInitials(name))}</span>
          <span style="overflow:hidden;text-overflow:ellipsis">${esc(name)}</span>
        </span>
        <span class="bx-abs-bar"><i style="width:${Math.round((cnt / max) * 100)}%"></i></span>
        <span class="bx-abs-v">${cnt}</span>
      </div>`).join('');
  }

  const foot = document.getElementById('bx-tile-abs-foot');
  if (foot) {
    const rest = Math.max(0, (a.top || []).length - 4);
    foot.textContent = a.n === 0
      ? 'No absence recorded in the period'
      : `${a.people} agent${a.people > 1 ? 's' : ''} affected`
        + (rest ? ` · ${rest} other${rest > 1 ? 's' : ''} not shown` : '');
  }
}

// Courbe lissée : sert de forme, les valeurs restent dans les title.
function _bxSparkline(id, values) {
  const el = document.getElementById(id);
  if (!el) return;
  if (values.length < 2) { el.innerHTML = ''; return; }
  const W = 200, H = 54, pad = 4;
  // Le point terminal porte un halo de r=6 : sans marge droite dédiée il
  // sortait du viewBox et se faisait rogner à plat par le bord du SVG.
  const padR = 8;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => [
    pad + (i / (values.length - 1)) * (W - pad - padR),
    H - pad - (v / max) * (H - pad * 2),
  ]);
  // Lissage Catmull-Rom converti en cubiques : la ligne brisée faisait
  // paraître la série plus nerveuse qu'elle ne l'est. Le facteur 6 est
  // la tension standard — au-delà, la courbe dépasse ses propres points.
  const line = pts.map(([x, y], i) => {
    if (!i) return `M${x.toFixed(1)},${y.toFixed(1)}`;
    const [x0, y0] = pts[i - 2] || pts[i - 1];
    const [x1, y1] = pts[i - 1];
    const [x3, y3] = pts[i + 1] || pts[i];
    const c1x = x1 + (x - x0) / 6, c1y = y1 + (y - y0) / 6;
    const c2x = x  - (x3 - x1) / 6, c2y = y  - (y3 - y1) / 6;
    return `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z`;
  const [lx, ly] = pts[pts.length - 1];
  // Aire en dégradé vertical plutôt qu'en hachures : à 54px de haut, la
  // trame moirait. Les ids sont propres à l'élément pour que deux
  // sparklines ne se partagent pas leurs defs.
  const gid = id + '-grad';
  el.innerHTML = `
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="var(--m3-primary)" stop-opacity=".28"/>
        <stop offset="100%" stop-color="var(--m3-primary)" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${area}" fill="url(#${gid})"/>
    <path d="${line}" fill="none" stroke="var(--m3-primary)" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    <!-- Point terminal : le SVG est en preserveAspectRatio="none", donc un
         <circle> y serait étiré en ellipse. Un segment de longueur nulle avec
         stroke-linecap="round" et vector-effect="non-scaling-stroke" donne un
         disque parfaitement rond quel que soit l'étirement horizontal. -->
    <path d="M${lx.toFixed(1)},${ly.toFixed(1)} l0,0" stroke="var(--m3-primary)"
          stroke-width="12" stroke-linecap="round" opacity=".18"
          vector-effect="non-scaling-stroke"/>
    <path d="M${lx.toFixed(1)},${ly.toFixed(1)} l0,0" stroke="var(--m3-surface)"
          stroke-width="9" stroke-linecap="round"
          vector-effect="non-scaling-stroke"/>
    <path d="M${lx.toFixed(1)},${ly.toFixed(1)} l0,0" stroke="var(--m3-primary)"
          stroke-width="6" stroke-linecap="round"
          vector-effect="non-scaling-stroke"/>`;
}

