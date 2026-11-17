// ── REPORTS ──────────────────────────────────────────────────
let lastDailyReport = null;
const RPT_HL_ROWS = 1, RPT_RISK_ROWS = 1, RPT_ACTION_ROWS = 1;
const PRI_OPTS = ['', 'Critical', 'High', 'Medium', 'Low'];
const STA_OPTS = ['', 'Open', 'In Progress', 'Closed'];

const dailyForm = {
  // Resolved at render time via rptDefaultAuthor() - currentUser is not known yet here.
  author:     '',
  highlights: Array(RPT_HL_ROWS).fill(null).map(() => ({ source: '', observation: '', priority: '', status: '' })),
  risks:      Array(RPT_RISK_ROWS).fill(null).map(() => ({ description: '', priority: '', status: '' })),
  actions:    Array(RPT_ACTION_ROWS).fill(null).map(() => ({ action: '', owner: '', priority: '', eta: '' })),
  customCols: { highlights: [], risks: [], actions: [] },
};
let lastWeeklyReport = null;
const weeklyForm = {
  // Resolved at render time via rptDefaultAuthor() - currentUser is not known yet here.
  author:     '',
  highlights: Array(RPT_HL_ROWS).fill(null).map(() => ({ source: '', observation: '', priority: '', status: '' })),
  risks:      Array(RPT_RISK_ROWS).fill(null).map(() => ({ description: '', priority: '', status: '' })),
  actions:    Array(RPT_ACTION_ROWS).fill(null).map(() => ({ action: '', owner: '', priority: '', eta: '' })),
  notes:      [],
  customCols: { highlights: [], risks: [], actions: [] },
};
// Dernier rapport mensuel affiché. Jamais déclaré jusqu'ici : l'export
// mensuel plantait (ReferenceError) avant le premier affichage du mois.
let lastMonthlyReport = null;
const monthlyForm = {
  // Resolved at render time via rptDefaultAuthor() - currentUser is not known yet here.
  author:     '',
  highlights: Array(RPT_HL_ROWS).fill(null).map(() => ({ source: '', observation: '', priority: '', status: '' })),
  risks:      Array(RPT_RISK_ROWS).fill(null).map(() => ({ description: '', priority: '', status: '' })),
  actions:    Array(RPT_ACTION_ROWS).fill(null).map(() => ({ action: '', owner: '', priority: '', eta: '' })),
  customCols: { highlights: [], risks: [], actions: [] },
};

function formatDuration(ms) {
  if (ms === null || ms === undefined) return '0h 00m';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/* Échappement HTML. `&` passe en premier, sinon il ré-échapperait les
   entités produites par les remplacements suivants.

   `>` et `'` sont traités au même titre que `<` et `"` : un `>` seul
   referme une balise ouverte plus haut dans un gabarit, et l'apostrophe
   sort d'un attribut écrit en quotes simples — deux cas que cette
   fonction laissait passer alors qu'elle était appelée précisément pour
   les couvrir.

   `s || ''` est conservé tel quel : 442 appels s'appuient sur ce
   comportement, qui rend un 0 ou un false comme chaîne vide. Le changer
   pour `??` ferait apparaître des « 0 » dans des cellules aujourd'hui
   vides — un tout autre sujet que l'échappement. */
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* Argument de chaîne pour un gestionnaire inline (`onclick="f(...)"`).

   Deux couches se superposent dans ce contexte, et `esc()` seul n'en
   couvre qu'une : le navigateur décode d'abord les entités HTML, puis
   passe le résultat à l'analyseur JavaScript. Une valeur comme
   `x'),alert(1)//` refermait donc l'appel et injectait du code, alors
   même qu'elle ne contient aucun caractère HTML dangereux.

   On produit ici le littéral complet, quotes comprises — l'appelant
   écrit `f(${escAttrArg(v)})` sans poser ses propres apostrophes :
   JSON.stringify échappe pour JavaScript, esc() pour l'attribut HTML. */
function escAttrArg(v) {
  return esc(JSON.stringify(String(v ?? '')));
}

/* Les champs « Lien RCA » et « Lien Alarme » sont saisis à la main et
   partent directement dans un href. Échapper ne suffit pas ici : un
   `javascript:alert(1)` ne contient aucun caractère à échapper et
   s'exécuterait au clic. On n'autorise donc que http/https et les liens
   relatifs, et on rejette le reste plutôt que d'essayer de le nettoyer.

   Renvoie l'URL si elle est acceptable, sinon la chaîne vide — l'appelant
   affiche alors « - » comme pour un champ non renseigné. */
function safeUrl(u) {
  const raw = String(u || '').trim();
  if (!raw) return '';
  // Les caractères de contrôle servent à casser le préfixe (« java\tscript: »)
  // et un navigateur les ignore à la lecture du schéma.
  const clean = raw.replace(/[\x00-\x1F\x7F]/g, '');
  if (/^(https?:)?\/\//i.test(clean)) return clean;   // absolu ou //hôte
  if (/^\/(?!\/)/.test(clean)) return clean;          // chemin relatif à la racine
  // Tout ce qui porte un schéma explicite non listé (javascript:, data:,
  // vbscript:, file:…) est refusé.
  if (/^[a-z][a-z0-9+.-]*:/i.test(clean)) return '';
  // Reste les saisies du type « intranet/rca/42 » : on les préfixe pour
  // qu'elles ne soient pas interprétées comme un schéma.
  return 'https://' + clean;
}

/* ══════════════════════════════════════════════════════════════
   RÉCAP — blocs visuels des pages Weekly et Monthly
   Ces pages listaient les tickets un par un, ce que les trackers font
   déjà mieux. Elles deviennent des récapitulatifs : chiffres clés,
   proportions et constats. Le langage visuel reprend celui du PPTX
   pour que l'écran et le deck se lisent pareil.
══════════════════════════════════════════════════════════════ */

// Ton -> couleur. Une seule table pour toute la page, sinon les
// nuances divergent d'un bloc à l'autre.
const RC_TONE = {
  good:  'var(--ok-fg, #1E8E3E)',
  warn:  '#E8710A',
  alert: 'var(--red)',
  info:  '#1A73E8',
};

// Tuile de KPI : valeur dominante, libellé en casse normale (comme
// .d-card-label du dashboard) et badge de variation optionnel.
function rcTile({ label, value, note, tone, delta }) {
  return `<div class="rc-kpi${tone === 'alert' ? ' alert' : tone === 'good' ? ' good' : ''}">
    <div class="rc-kpi-l">${esc(label)}</div>
    <div class="rc-kpi-v">${value}${
      delta ? `<span class="rc-delta ${delta.tone}">${esc(delta.text)}</span>` : ''}</div>
    ${note ? `<div class="rc-kpi-n">${esc(note)}</div>` : ''}
  </div>`;
}

// Rond d'icône du bento (= .bx-ico). `tone` : 'dark' ou 'accent'.
// Les tracés sont ceux du dashboard, pour que les mêmes idées portent les
// mêmes signes d'une page à l'autre.
const RC_ICONS = {
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.5" x2="15.4" y2="6.5"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/>',
  trend: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  gauge: '<path d="M12 20a8 8 0 1 0-8-8"/><line x1="12" y1="12" x2="16.5" y2="8.5"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/>',
  // Glyphes des cartes de constats.
  'trend-up':   '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  'trend-down': '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
  shield:       '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',
  alert:        '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  clock:        '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>',
  timer:        '<circle cx="12" cy="13" r="8"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="9" y1="2" x2="15" y2="2"/>',
};
function rcIco(name, tone = 'dark') {
  const d = RC_ICONS[name];
  if (!d) return '';
  return `<span class="rc-ico ${tone}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</svg></span>`;
}

// Carte bento, au format `.bx` du dashboard : aplat plein très arrondi
// (28px), sans bordure ni ombre. `variant` : 'dark' pour la carte qui
// porte le chiffre clé, 'plain' pour une surface à filet, sinon l'aplat
// tonal. `icon` ajoute le rond d'icône à gauche du titre.
function rcCard({ title, sub, body, variant, span, right, icon, iconTone }) {
  // Un `sub` seul est légitime : quand le titre de section nomme déjà la
  // carte, on ne garde que la légende (sinon elle disparaissait).
  const head = `<div style="min-width:0">
        ${title ? `<div class="rc-card-t">${esc(title)}</div>` : ''}
        ${sub ? `<div class="rc-card-s"${title ? '' : ' style="margin-top:0"'}>${esc(sub)}</div>` : ''}
      </div>`;
  return `<div class="rc-card${variant ? ' ' + variant : ''}${span ? ' rc-span' + span : ''}">
    ${title || sub || right ? `<div class="rc-card-h">
      ${icon
        ? `<div style="display:flex;align-items:center;gap:14px;min-width:0">${rcIco(icon, iconTone)}${head}</div>`
        : head}
      ${right || ''}
    </div>` : ''}
    ${body}
  </div>`;
}

// Chiffre clé de la carte d'ouverture : le volume de la période, avec son
// net en badge. C'est la première lecture de la page.
function rcHero({ label, value, delta, note }) {
  return `<div class="rc-figure-lbl">${esc(label)}
      <span class="rc-arrow"><svg width="10" height="10" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line
        x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg></span>
    </div>
    <div class="rc-figure">${value}${
      delta ? `<span class="rc-delta ${delta.tone}">${esc(delta.text)}</span>` : ''}</div>
    ${note ? `<div class="rc-figure-note">${esc(note)}</div>` : ''}`;
}

// Grande statistique : le pourcentage en gros corps, sa lecture littérale
// dessous, puis la barre. C'est la forme des tuiles du dashboard — un
// chiffre qu'on lit avant de lire la longueur, l'inverse d'une jauge.
function rcStat({ label, value, unit, note, pct, tone }) {
  const w = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  return `<div class="rc-stat">
    <div class="rc-stat-l">${esc(label)}</div>
    <div class="rc-stat-v">${esc(String(value))}${unit ? `<u>${esc(unit)}</u>` : ''}</div>
    ${note ? `<div class="rc-stat-n">${esc(note)}</div>` : ''}
    <div class="rc-stat-bar"><i style="width:${w}%;background:${RC_TONE[tone] || 'var(--m3-primary,#C7000B)'}"></i></div>
  </div>`;
}


// Palette catégorielle des répartitions. _bxSegColor ne connaît que les
// priorités et les statuts : sur les domaines il renvoyait un gris
// uniforme, et toutes les barres se ressemblaient. Même séquence que le
// PPTX, rouge de marque en tête.
const RC_CAT = ['var(--red)', '#1A73E8', '#12B5CB', '#E8710A', '#1E8E3E', '#9334E6', '#5F6368'];
// Couleur stable par libellé, sans collision dans une même liste : un
// simple hash donnait deux domaines de la même teinte côte à côte, ce
// qui suggère un lien qui n'existe pas. On mémorise les teintes déjà
// prises pour le rendu en cours et on décale à la première libre.
let _rcCatSeen = new Map();
function rcCatReset() { _rcCatSeen = new Map(); }
function rcCatColor(key) {
  const s = String(key || '');
  if (_rcCatSeen.has(s)) return _rcCatSeen.get(s);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const used = new Set(_rcCatSeen.values());
  let idx = Math.abs(h) % RC_CAT.length;
  for (let n = 0; n < RC_CAT.length && used.has(RC_CAT[idx]); n++) {
    idx = (idx + 1) % RC_CAT.length;
  }
  _rcCatSeen.set(s, RC_CAT[idx]);
  return RC_CAT[idx];
}

// Barres de répartition, triées par volume décroissant. Remplace les
// tableaux "By Domain" / "By Priority" : même donnée, lecture immédiate.
// Répartition en colonnes verticales, comme les barres "juillet / août" du
// dashboard. Les bandes horizontales donnaient une pile de jauges : sur six
// catégories on lisait une liste, pas une comparaison.
//
// Au-delà de MAX_COLS les colonnes deviendraient des traits : on garde les
// plus grosses et on regroupe la queue dans "Autres", plutôt que de tronquer
// silencieusement une part du volume.
function rcBars(rows, colorFn) {
  if (!rows.length) return '<div class="rc-empty">No data for the period</div>';
  const MAX_COLS = 7;
  let cols = rows;
  if (rows.length > MAX_COLS) {
    const head = rows.slice(0, MAX_COLS - 1);
    const tail = rows.slice(MAX_COLS - 1);
    cols = [...head, [`Autres (${tail.length})`, tail.reduce((s, [, v]) => s + v, 0)]];
  }
  const top = Math.max(...cols.map(([, v]) => v), 1);
  const sum = rows.reduce((s, [, v]) => s + v, 0);
  return `<div class="rc-cols">${cols.map(([k, v]) => {
    const h = Math.max(Math.round((v / top) * 100), v > 0 ? 7 : 0);
    return `<div class="rc-col" title="${esc(k)} : ${v}">
      <div class="rc-col-track" style="height:100%">
        <div class="rc-col-fill" style="height:${h}%;background:${colorFn ? colorFn(k) : 'var(--m3-primary,#C7000B)'}">
          ${h >= 18 ? `<span class="rc-col-v">${v}</span>` : ''}
        </div>
      </div>
      <div>
        <div class="rc-col-cap">${esc(k)}</div>
        <div class="rc-col-pct">${h < 18 ? v + ' · ' : ''}${sum ? Math.round((v / sum) * 100) : 0}%</div>
      </div>
    </div>`;
  }).join('')}</div>`;
}

/* Répartition classée, sur le modèle du bloc « Breakdown by … » de la
   carte Ticket volume du dashboard.

   Les colonnes de `rcBars()` montrent une forme : on voit quel domaine
   domine, pas combien il pèse — l'effectif exact demandait de survoler
   chaque barre, ce qui ne marche ni à l'impression ni en revue projetée.
   Cette variante range les catégories par volume décroissant et donne
   sur chaque ligne le nom, une jauge relative au premier, l'effectif et
   la part du total.

   `limit` borne l'affichage ; le reliquat est annoncé en pied plutôt
   que fondu dans une catégorie « Autres », qui laissait croire à un
   domaine réel de ce nom. */
function rcBreak(rows, colorFn, { limit = 8 } = {}) {
  if (!rows.length) return '<div class="rc-empty">No data for the period</div>';
  const sum   = rows.reduce((s, [, v]) => s + v, 0) || 1;
  const shown = rows.slice(0, limit);
  // Jauge relative au premier, pas au total : sur une répartition plate
  // (5 domaines à 20 %) des barres au cinquième de la largeur ne se
  // comparent plus entre elles.
  const top   = shown.length ? Math.max(...shown.map(([, v]) => v), 1) : 1;
  const rest  = rows.length - shown.length;

  return `<div class="rc-break">` + shown.map(([k, v]) => {
    const pct = Math.round((v / sum) * 100);
    const col = colorFn ? colorFn(k) : 'var(--m3-primary,#C7000B)';
    return `<div class="rc-break-row" title="${esc(k)} : ${v} ticket${v > 1 ? 's' : ''} (${pct}%)">
      <span class="rc-break-k">
        <i class="rc-break-dot" style="background:${col}"></i><b class="rc-break-t">${esc(k)}</b>
      </span>
      <span class="rc-break-bar"><i style="width:${Math.round((v / top) * 100)}%;background:${col}"></i></span>
      <span class="rc-break-v">${v}</span>
      <span class="rc-break-p">${pct}%</span>
    </div>`;
  }).join('') +
    (rest > 0 ? `<div class="rc-break-more">+${rest} autre${rest > 1 ? 's' : ''}</div>` : '') +
  `</div>`;
}

// Constats déduits des données, en pastilles colorées. Pendant écran
// des "key highlights" du deck.
// Constats en cartes plutôt qu'en liste à puces : chaque item porte son
// icône, sa valeur détachée et une phrase d'explication. La valeur se
// lit d'abord, le texte ensuite — l'inverse d'une puce qu'il faut lire
// en entier pour savoir si elle compte.
function rcInsights(list) {
  if (!list.length) return '<div class="rc-empty">No automatic finding for this period</div>';
  return `<div class="rc-insights">${list.map(h => {
    const tone = h.tone || 'info';
    const glyph = RC_ICONS[h.icon] || RC_ICONS.layers;
    return `<div class="rc-insight t-${tone}">
      <span class="rc-ins-ico">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">${glyph}</svg>
      </span>
      <span class="rc-ins-body">
        <span class="rc-ins-top">
          <span class="rc-ins-lbl">${esc(h.label || '')}</span>
          <span class="rc-ins-val">${esc(String(h.value ?? ''))}</span>
        </span>
        <span class="rc-ins-txt">${esc(h.text || '')}</span>
      </span>
    </div>`;
  }).join('')}</div>`;
}

// Classement des agents : barre empilée clôturés / ouverts / hors SLA.
// La longueur totale est la charge portée, la couleur ce qu'il en reste.
// Performance par FO : pilules avec avatar, sur le modèle des lignes
// "Derniers tickets" du dashboard. Les pistes empilées horizontales sont
// abandonnées — trois segments de quelques pixels ne se comparaient pas
// d'un agent à l'autre, et la ligne se lisait comme une jauge.
//
// Ce qu'on veut savoir d'un agent : combien il a soldé, sur combien porté,
// et s'il traîne des ruptures. Les deux premiers deviennent un ratio
// chiffré, la troisième un badge — visible seulement s'il y a lieu.
function rcFoRanking(byFo, foList) {
  // L'union des deux sources, et non la seule `foList` : un agent qui porte
  // des tickets sans figurer dans la config (départ, renfort ponctuel)
  // disparaissait de la carte alors que sa charge est bien réelle.
  const names = [...new Set([...(foList || []), ...Object.keys(byFo || {})])];
  const rows = names
    .map(fo => [fo, (byFo || {})[fo] || { open: 0, resolved: 0, breach: 0 }])
    .filter(([, d]) => d.open || d.resolved || d.breach)
    .sort((a, b) => (b[1].resolved + b[1].open) - (a[1].resolved + a[1].open));
  if (!rows.length) return '<div class="rc-empty">No activity attributed in the period</div>';

  return `<div class="rc-fo">${rows.map(([fo, d]) => {
    const carried = d.resolved + d.open;
    const rate = carried ? Math.round((d.resolved / carried) * 100) : null;
    return `<div class="rc-fo-row">
      <span class="rc-fo-av" style="background:${foAvatarColor(fo)}">${esc(foInitials(fo))}</span>
      <span class="rc-fo-main">
        <span class="rc-fo-name">${esc(fo)}</span>
        <span class="rc-fo-meta">${d.resolved} closed · ${d.open} in progress${
          d.breach ? ` · <b class="rc-fo-breach">${d.breach} SLA breach</b>` : ''}</span>
      </span>
      <span class="rc-fo-v">${rate == null ? 'n/a' : rate + '%'}<span>${carried} carried</span></span>
    </div>`;
  }).join('')}</div>`;
}

// Constats déduits, côté client. Même grammaire que deriveHighlights()
// du générateur PPTX, mais sur les champs disponibles ici.
function rcDeriveInsights(data, opened, resolved, activeList) {
  const k = data.kpis || {};
  const out = [];
  // Chaque constat porte une valeur détachée du texte : c'est elle qu'on
  // lit en diagonale, la phrase ne fait que l'expliquer.
  if (opened || resolved) {
    const net = resolved - opened;
    out.push({
      tone: net >= 0 ? 'good' : (opened - resolved > 5 ? 'alert' : 'warn'),
      icon: net >= 0 ? 'trend-down' : 'trend-up',
      label: net >= 0 ? 'Backlog absorbed' : 'Load increasing',
      value: (net >= 0 ? '+' : '') + net,
      text: `${resolved} closed against ${opened} opened in the period.`,
    });
  }
  if (k.sla_compliance != null) {
    out.push({
      tone: k.sla_compliance >= 95 ? 'good' : k.sla_compliance >= 85 ? 'warn' : 'alert',
      icon: 'shield',
      label: 'SLA Compliance',
      value: k.sla_compliance + '%',
      text: k.breach ? `${k.breach} breach(es) recorded in the period.`
                     : 'No SLA breach in the period.',
    });
  }
  const breach = (activeList || []).filter(t => t.sla_status === 'Breach');
  if (breach.length) {
    const hi = breach.filter(t => ['P1', 'P2'].includes(t.priority)).length;
    out.push({
      tone: 'alert', icon: 'alert',
      label: 'Breached and still open',
      value: breach.length,
      text: hi ? `Including ${hi} at P1 or P2 - handle first.`
               : 'None at P1 or P2.',
    });
  }
  const dom = Object.entries(data.by_domain || {}).sort((a, b) => b[1] - a[1])[0];
  if (dom && opened) {
    out.push({
      tone: 'info', icon: 'layers',
      label: 'Busiest domain',
      value: dom[0],
      text: `${dom[1]} ticket(s), ${Math.round((dom[1] / opened) * 100)}% of volume.`,
    });
  }
  const now = Date.now();
  const stale = (activeList || []).filter(t =>
    t.open_date && (now - new Date(t.open_date).getTime()) > 7 * 86400000);
  if (stale.length) {
    out.push({
      tone: stale.length > 3 ? 'warn' : 'info',
      icon: 'clock',
      label: 'Open for over 7 days',
      value: stale.length,
      text: 'To arbitrate or chase with the back office.',
    });
  }
  if (k.mttr_ms) {
    out.push({
      tone: 'info', icon: 'timer',
      label: 'Mean time to resolve',
      value: formatDuration(k.mttr_ms),
      text: 'Average over tickets closed in the period.',
    });
  }
  return out;
}

const RPT_BAR = 'background:transparent;color:var(--dark);padding:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;text-align:left;margin-top:28px;border-bottom:2px solid var(--line);display:flex;align-items:center;gap:8px';
// Titre de section pour les rapports non réordonnables (hebdo/mensuel) :
// une vraie hiérarchie de page — casse normale, plus grand, sans filet ni
// poignée — au lieu du bandeau d'édition en petites majuscules.
const RPT_HEAD = 'background:transparent;color:var(--m3-on-surface,var(--dark));padding:0;font-size:17px;font-weight:600;letter-spacing:-.01em;text-transform:none;text-align:left;margin:40px 0 16px;border-bottom:none;display:flex;align-items:center;gap:8px';
// En-têtes/cellules des tableaux de rapport (Ops Review et rapports
// quotidiens/hebdo/mensuels). Étaient en 9,5px MAJUSCULES très serré :
// illisible et loin du langage Material. Repris en 11,5px casse
// normale, avec plus d'air vertical.
const RPT_TH  = 'padding:9px 12px;text-align:left;color:var(--m3-on-surf-var,var(--mute));font-size:11px;font-weight:600;letter-spacing:.02em;text-transform:none;background:var(--m3-surf-2,var(--bg2));border-bottom:none;white-space:nowrap';
// `overflow-wrap:anywhere` : une référence ou une URL sans espace ne peut
// plus élargir sa colonne indéfiniment — elle se coupe dans la cellule au
// lieu de faire déborder tout le tableau.
const RPT_TD  = 'padding:5px 8px;border-bottom:1px solid var(--m3-outline-var,var(--line));font-size:12.5px;vertical-align:middle;text-align:left;color:var(--m3-on-surface,var(--dark));max-width:none;white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere;word-break:break-word';
const RPT_TBL = 'width:100%;border-collapse:separate;border-spacing:0;margin-bottom:0;border:none';
const RPT_TBL_WRAP = 'margin-bottom:24px';
// Conteneur de défilement pour les tableaux larges (métriques, tickets,
// breaches) : sans lui, une ligne longue élargit la page entière et le
// contenu déborde sous le panneau latéral. `max-width:100%` empêche le
// conteneur lui-même de pousser la mise en page.
const RPT_SCROLL = 'overflow-x:auto;max-width:100%;-webkit-overflow-scrolling:touch';

