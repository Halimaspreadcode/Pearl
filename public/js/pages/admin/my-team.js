/* ══════════════════════════════════════════════════════════════
   MY TEAM — classement d'équipe (Admin)

   Performance FO note un agent à la fois : c'est l'outil de la
   notation. Cet écran répond à l'autre question, celle qu'on se pose
   avant d'ouvrir une fiche — qui porte l'équipe, qui décroche, et sur
   quel critère l'écart se creuse.

   Le classement est composite, et c'est délibéré : la note du mois
   (Performance FO) dit la tenue de l'agent, la livraison de tickets dit
   son volume. Prises seules, chacune ment — un agent noté 90 qui n'a
   rien traité, un gros volume avec 40 % de hors-SLA. On mêle les deux
   quand les deux existent, sinon on se rabat sur celle dont on dispose,
   et la colonne « Base » dit toujours laquelle a servi.
   ══════════════════════════════════════════════════════════════ */

const mtUI = { tab: 'rank', month: null, sort: 'rank', dir: -1, open: null };

// Poids du composite. La note du mois pèse plus lourd que la livraison :
// elle intègre déjà le SLA, l'assiduité et les objectifs, là où le score
// de livraison ne voit que les tickets.
const MT_W_CARD = 0.6;
const MT_W_DELIVERY = 0.4;

function _mtMonth() {
  return mtUI.month || (typeof _perfMonthKey === 'function' ? _perfMonthKey() : '');
}

// Même périmètre que le reste de l'application : le sélecteur
// de site de la barre du haut. Comparer plusieurs sites dans une
// même grille n'aurait pas de sens sur « SN ».
function _mtFoList() {
  const scope = (typeof getActiveCountry === 'function') ? getActiveCountry() : 'ALL';
  return (state.config.fo_list || []).filter(fo =>
    scope === 'ALL' || personInScope(fo, scope));
}

// Score de livraison ramené sur 100. _foScoreBreakdown produit des
// points bruts, non bornés : sur une échelle /100 il faut une référence.
// On prend le meilleur de l'équipe — le classement est relatif, ce qui
// est la lecture attendue ici.
function _mtDeliveryScores(foList) {
  const raw = foList.map(fo => {
    const stats = _calcFoStats(fo);
    const quizBonus = (typeof _foQuizBonus === 'function') ? _foQuizBonus(fo) : 0;
    const { items, score } = _foScoreBreakdown({ ...stats, quizBonus });
    return { fo, stats, quizBonus, items, raw: score };
  });
  const max = Math.max(...raw.map(r => r.raw), 1);
  raw.forEach(r => { r.delivery = Math.round((r.raw / max) * 100); });
  return raw;
}

// Une ligne par agent : note du mois, livraison, composite, et de quoi
// afficher le détail sans recalculer.
function _mtRows() {
  const foList = _mtFoList();
  if (!foList.length) return [];
  const month = _mtMonth();
  // Fiches avec le critère Tasks en direct (voir _perfMonthData).
  const cards = _perfMonthData(month, true);
  const rows = _mtDeliveryScores(foList);

  rows.forEach(r => {
    const card = _perfLegacyCard(cards[r.fo]);
    const { score, covered } = (typeof perfScore === 'function')
      ? perfScore(card) : { score: null, covered: 0 };
    r.card = card || null;
    r.cardScore = score;
    r.covered = covered;
    // Poids total du barème, pour dire « 3 critères sur 6 » sans
    // supposer que PERF_CRITERIA en contient toujours six.
    const totalW = PERF_CRITERIA.reduce((s, c) => s + c.weight, 0);
    r.coverPct = totalW ? Math.round((covered / totalW) * 100) : 0;
    // Une notation partielle ne pèse que ce qu'elle couvre. Sans cette
    // pondération, un agent noté 58 sur deux critères tombait sous un
    // agent pas noté du tout : la notation devenait une punition pour
    // qui s'y était soumis, et le bas de classement désignait le mauvais
    // agent — précisément ce que cet écran doit dire juste.
    if (score !== null) {
      const cov = Math.max(0, Math.min(1, r.coverPct / 100));
      const w = MT_W_CARD * cov;
      r.rankScore = Math.round(score * w + r.delivery * (1 - w));
      r.basis = cov >= 1 ? 'both' : 'partial';
    } else {
      r.rankScore = r.delivery;
      r.basis = 'delivery';
    }
  });

  rows.sort((a, b) => b.rankScore - a.rankScore
    || b.stats.resolved - a.stats.resolved
    || a.stats.breach - b.stats.breach);
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

function setMyTeamTab(tab) {
  if (!['rank', 'extremes', 'criteria'].includes(tab)) return;
  mtUI.tab = tab;
  ['rank', 'extremes', 'criteria'].forEach(t => {
    const btn  = document.getElementById(`mt-tab-${t}`);
    const view = document.getElementById(`mt-view-${t}`);
    const on   = t === tab;
    if (btn)  { btn.classList.toggle('is-on', on); btn.setAttribute('aria-selected', String(on)); }
    if (view) view.hidden = !on;
  });
  renderMyTeam();
}

function onMyTeamMonthChange() {
  mtUI.month = document.getElementById('mt-month')?.value || _perfMonthKey();
  renderMyTeam();
}

function _mtSort(key) {
  // Reclic sur la même colonne : on inverse le sens.
  if (mtUI.sort === key) mtUI.dir = -mtUI.dir;
  else { mtUI.sort = key; mtUI.dir = (key === 'breach' || key === 'fo') ? 1 : -1; }
  renderMyTeam();
}

function _mtToggle(fo) {
  mtUI.open = (mtUI.open === fo) ? null : fo;
  renderMyTeam();
}

function renderMyTeam() {
  const page = document.getElementById('page-cfg-myteam');
  if (!page) return;

  const monthEl = document.getElementById('mt-month');
  if (monthEl) {
    if (!mtUI.month) mtUI.month = monthEl.value || _perfMonthKey();
    monthEl.value = mtUI.month;
  }

  const rows = _mtRows();
  _mtRenderSummary(rows);
  if (mtUI.tab === 'rank')     { _mtRenderSortbar(); _mtRenderRank(rows); }
  if (mtUI.tab === 'extremes') _mtRenderExtremes(rows);
  if (mtUI.tab === 'criteria') _mtRenderCriteria(rows);
}

// ── Ligne de contexte ─────────────────────────────────────────
// Cinq tuiles et un podium occupaient tout l'écran avant le premier
// agent : la page servait à comparer des gens, et il fallait défiler
// pour en voir un. Les mêmes chiffres tiennent sur une ligne, en
// retrait, et le classement commence tout de suite.
function _mtRenderSummary(rows) {
  const el = document.getElementById('mt-summary');
  if (!el) return;
  if (!rows.length) { el.innerHTML = ''; return; }

  const avg    = Math.round(rows.reduce((s, r) => s + r.rankScore, 0) / rows.length);
  const spread = rows[0].rankScore - rows[rows.length - 1].rankScore;
  const scored = rows.filter(r => r.cardScore !== null).length;
  const breach = rows.reduce((s, r) => s + r.stats.breach, 0);

  const bit = (v, l, tone) =>
    `<span class="mt-sum-i${tone ? ' is-' + tone : ''}"><b>${v}</b>${l}</span>`;

  el.innerHTML = `
    ${bit(rows.length, 'agents', '')}
    ${bit(avg, 'moyenne', avg >= 70 ? 'ok' : avg < 50 ? 'bad' : '')}
    ${bit(spread + ' pts', 'écart', spread >= 40 ? 'warn' : '')}
    ${bit(`${scored}/${rows.length}`, 'notés', scored < rows.length ? 'warn' : 'ok')}
    ${bit(breach, 'hors SLA', breach ? 'bad' : 'ok')}`;
}

// ── Classement ────────────────────────────────────────────────
const MT_COLS = [
  { key: 'rank',     label: 'Rank' },
  { key: 'fo',       label: 'Agent' },
  { key: 'rankScore',label: 'Score' },
  { key: 'cardScore',label: 'Notation' },
  { key: 'delivery', label: 'Livraison' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'slaRate',  label: 'SLA' },
  { key: 'breach',   label: 'Breach' },
];

function _mtRenderSortbar() {
  const el = document.getElementById('mt-sortbar');
  if (!el) return;
  el.innerHTML = MT_COLS.filter(c => c.key !== 'rank').map(c => {
    const on = mtUI.sort === c.key;
    const arrow = on ? (mtUI.dir === 1 ? ' ↑' : ' ↓') : '';
    return `<button type="button" class="mt-sort${on ? ' is-on' : ''}"
      onclick="_mtSort('${c.key}')">${c.label}${arrow}</button>`;
  }).join('');
}

// Valeur triable pour une colonne. Les colonnes venant des stats
// tickets ne sont pas à la racine de la ligne : elles vivent sous
// `stats`, et un accès direct renverrait undefined — donc un tri inerte.
function _mtSortVal(r, key) {
  if (key === 'fo') return r.fo.toLowerCase();
  if (key === 'rank' || key === 'rankScore' || key === 'delivery') return r[key];
  // Un agent non noté n'a pas de note : -1 le range en bas en ordre
  // décroissant, sans lui inventer un zéro qui se lirait comme une
  // mauvaise note.
  if (key === 'cardScore') return r.cardScore === null ? -1 : r.cardScore;
  return r.stats[key] ?? 0;
}

function _mtRenderRank(rows) {
  const el = document.getElementById('mt-rank');
  if (!el) return;
  if (!rows.length) {
    const scope = (typeof getActiveCountry === 'function') ? getActiveCountry() : 'ALL';
    el.innerHTML = `<div class="mt-empty">${scope === 'ALL'
      ? 'No FO configured.'
      : `No FO assigned to ${esc(scope)}. Change scope, or edit the assignment in Configuration › General.`}</div>`;
    return;
  }

  let list = rows;
  if (mtUI.sort !== 'rank') {
    list = [...rows].sort((a, b) => {
      const va = _mtSortVal(a, mtUI.sort), vb = _mtSortVal(b, mtUI.sort);
      if (typeof va === 'string') return va.localeCompare(vb) * -mtUI.dir;
      return (va - vb) * -mtUI.dir;
    });
  }

  const max = Math.max(...rows.map(r => r.rankScore), 1);

  el.innerHTML = `<div class="mt-rank">${list.map(r => {
    const safe = esc(r.fo).replace(/'/g, "\\'");
    const tr   = personSite(r.fo);
    const open = mtUI.open === r.fo;
    // Le rang reste celui du classement composite même quand on trie sur
    // une autre colonne : c'est l'identité de la ligne, pas sa position.
    // Les trois premiers se distinguent par un filet, pas par une
    // médaille : c'est un écran de revue d'équipe, pas un podium.
    const top = r.rank <= 3 ? ` is-top is-top${r.rank}` : '';
    return `
    <div class="mt-row${open ? ' is-open' : ''}${top}">
      <button type="button" class="mt-row-head" onclick="_mtToggle('${safe}')"
              aria-expanded="${open}">
        <span class="mt-rank-n">${r.rank}</span>
        <span class="mt-av" style="background:${foAvatarColor(r.fo)}">${foInitials(r.fo)}</span>
        <span class="mt-name">
          ${esc(r.fo)}
          <span class="mt-tracker" style="color:${siteColor(tr)};background:${siteBg(tr)}">${esc(tr)}</span>
        </span>
        <span class="mt-bar"><i style="width:${Math.round(r.rankScore / max * 100)}%"></i></span>
        <span class="mt-score">${r.rankScore}</span>
        <span class="mt-cell">${r.cardScore === null
          ? '<span class="mt-na" title="Not scored for this month">—</span>'
          : r.cardScore}</span>
        <span class="mt-cell">${r.delivery}</span>
        <span class="mt-cell">${r.stats.resolved}</span>
        <span class="mt-cell">${r.stats.slaRate}%</span>
        <span class="mt-cell${r.stats.breach ? ' is-bad' : ''}">${r.stats.breach}</span>
      </button>
      ${open ? _mtDetail(r) : ''}
    </div>`;
  }).join('')}</div>`;
}

// Détail d'une ligne : d'où vient le score, critère par critère puis
// point par point. Sans ça, un classement n'est qu'une opinion.
function _mtDetail(r) {
  const crit = PERF_CRITERIA.map(c => {
    const v = r.card?.[c.id];
    const has = v !== undefined && v !== null && v !== '';
    return `<div class="mt-det-crit${has ? '' : ' is-na'}">
      <span class="mt-det-crit-l">${esc(c.label)}<em>${c.weight}%</em></span>
      <span class="mt-det-crit-bar"><i style="width:${has ? Math.max(0, Math.min(100, Number(v))) : 0}%"></i></span>
      <span class="mt-det-crit-v">${has ? Number(v) : '—'}</span>
    </div>`;
  }).join('');

  const pts = (r.items || []).map(it => `
    <div class="mt-det-pt">
      <span>${esc(it.label)}</span>
      <span class="mt-det-pt-d">${esc(it.detail)}</span>
      <span class="mt-det-pt-v${it.pts < 0 ? ' is-bad' : ''}">${it.pts > 0 ? '+' : ''}${it.pts}</span>
    </div>`).join('');

  const safe = esc(r.fo).replace(/'/g, "\\'");
  return `<div class="mt-det">
    <div class="mt-det-col">
      <div class="mt-det-t">Notation ${esc(_mtMonth())}
        <span class="mt-det-cov">${r.cardScore === null
          ? 'not scored — rank on delivery only'
          : `${r.coverPct}% of the scale · weighs ${Math.round(MT_W_CARD * r.coverPct)}% of the rank`}</span></div>
      ${crit}
      <button type="button" class="mt-det-link" onclick="_mtOpenPerf('${safe}')">
        Open the scorecard →</button>
    </div>
    <div class="mt-det-col">
      <div class="mt-det-t">Livraison
        <span class="mt-det-cov">${r.raw} pts → ${r.delivery}/100</span></div>
      ${pts}
      <div class="mt-det-pt mt-det-pt-tot">
        <span>Avg. resolution</span><span class="mt-det-pt-d"></span>
        <span class="mt-det-pt-v">${esc(r.stats.avgResolution)}</span>
      </div>
    </div>
  </div>`;
}

// Rebond vers la fiche de notation de l'agent, sur le mois regardé ici :
// l'écran dit qui décroche, on veut pouvoir agir sans re-sélectionner.
function _mtOpenPerf(fo) {
  if (typeof perfUI === 'object') {
    perfUI.fo = fo;
    perfUI.month = _mtMonth();
    perfUI.tab = 'note';
  }
  window.renderPage('cfg-perf');
  // Le champ mois de la page Performance porte sa propre valeur : sans
  // cette recopie, la fiche s'ouvrirait sur un autre mois que celui
  // d'où l'on vient.
  const el = document.getElementById('perf-month');
  if (el) el.value = _mtMonth();
}

// ── Forts & faibles ───────────────────────────────────────────
// Deux colonnes plutôt qu'une liste : la question « qui décroche »
// n'est pas la fin du classement, c'est une lecture à part entière.
function _mtRenderExtremes(rows) {
  const el = document.getElementById('mt-extremes');
  if (!el) return;
  if (rows.length < 2) {
    el.innerHTML = `<div class="mt-empty">At least two agents are needed to compare.</div>`;
    return;
  }
  // Un tiers de l'équipe à chaque extrémité, trois au minimum, et jamais
  // de chevauchement : à quatre agents, deux et deux.
  const n = Math.max(1, Math.min(Math.ceil(rows.length / 3), Math.floor(rows.length / 2)));
  const top = rows.slice(0, n);
  const bottom = rows.slice(-n).reverse();
  const avg = rows.reduce((s, r) => s + r.rankScore, 0) / rows.length;

  const card = (title, sub, list, tone) => `
    <div class="gsla-card mt-ex mt-ex-${tone}">
      <div class="gsla-card-head">
        <h3 class="gsla-card-t">${title}</h3>
        <p class="gsla-card-d">${sub}</p>
      </div>
      ${list.map(r => {
        const d = Math.round(r.rankScore - avg);
        const safe = esc(r.fo).replace(/'/g, "\\'");
        return `<button type="button" class="mt-ex-row" onclick="_mtOpenPerf('${safe}')">
          <span class="mt-av" style="background:${foAvatarColor(r.fo)}">${foInitials(r.fo)}</span>
          <span class="mt-ex-main">
            <span class="mt-ex-name">${esc(r.fo)}</span>
            <span class="mt-ex-sub">${_mtWhy(r, tone)}</span>
          </span>
          <span class="mt-ex-score">${r.rankScore}
            <em class="${d >= 0 ? 'is-up' : 'is-down'}">${d >= 0 ? '+' : ''}${d}</em></span>
        </button>`;
      }).join('')}
    </div>`;

  el.innerHTML =
    card('Top performers', `Above the team average (${Math.round(avg)}/100).`, top, 'top') +
    card('Needs support', 'Lowest of the scope — the gap is shown against the team average.', bottom, 'low');
}

// Une phrase qui dit pourquoi l'agent est là. Le classement seul ne
// donne pas de prise : ce qui est actionnable, c'est le critère qui
// l'écarte le plus de l'équipe.
function _mtWhy(r, tone) {
  const bits = [];
  if (tone === 'low') {
    if (r.stats.breach > 0) bits.push(`${r.stats.breach} SLA breach`);
    if (r.cardScore === null) bits.push('not scored this month');
    else if (r.coverPct < 100) bits.push(`scored on ${r.coverPct}% of the scale`);
    if (r.stats.resolved === 0) bits.push('no ticket resolved');
  } else {
    bits.push(`${r.stats.resolved} resolved`);
    if (r.stats.slaRate >= 90) bits.push(`${r.stats.slaRate}% SLA`);
    if (r.cardScore !== null) bits.push(`notation ${r.cardScore}`);
  }
  if (!bits.length) bits.push(`${r.stats.resolved} resolved · ${r.stats.slaRate}% SLA`);
  return esc(bits.slice(0, 3).join(' · '));
}

// ── Par critère ───────────────────────────────────────────────
// La moyenne d'équipe masque le critère qui plombe tout le monde.
// Ici on la casse : un critère par ligne, sa moyenne, et les deux
// agents aux extrémités.
function _mtRenderCriteria(rows) {
  const el = document.getElementById('mt-criteria');
  if (!el) return;
  if (!rows.length) { el.innerHTML = `<div class="mt-empty">No FO configured.</div>`; return; }

  el.innerHTML = PERF_CRITERIA.map(c => {
    const vals = rows
      .map(r => ({ fo: r.fo, v: r.card?.[c.id] }))
      .filter(x => x.v !== undefined && x.v !== null && x.v !== '' && isFinite(Number(x.v)))
      .map(x => ({ fo: x.fo, v: Number(x.v) }))
      .sort((a, b) => b.v - a.v);

    if (!vals.length) {
      return `<div class="mt-crit is-na">
        <div class="mt-crit-head">
          <span class="mt-crit-l">${esc(c.label)}<em>${c.weight}%</em></span>
          <span class="mt-crit-v">not scored</span>
        </div>
        <div class="mt-crit-hint">${esc(c.hint)}</div>
      </div>`;
    }

    const avg = Math.round(vals.reduce((s, x) => s + x.v, 0) / vals.length);
    const best = vals[0], worst = vals[vals.length - 1];
    const tone = avg >= 80 ? 'ok' : avg >= 60 ? 'warn' : 'bad';
    return `<div class="mt-crit is-${tone}">
      <div class="mt-crit-head">
        <span class="mt-crit-l">${esc(c.label)}<em>${c.weight}%</em></span>
        <span class="mt-crit-v">${avg}<span class="mt-crit-n">/100 · ${vals.length} scored</span></span>
      </div>
      <div class="mt-crit-bar"><i style="width:${avg}%"></i></div>
      <div class="mt-crit-ends">
        <span class="mt-crit-end is-up">▲ ${esc(best.fo)} <b>${best.v}</b></span>
        ${vals.length > 1
          ? `<span class="mt-crit-end is-down">▼ ${esc(worst.fo)} <b>${worst.v}</b></span>` : ''}
      </div>
      <div class="mt-crit-hint">${esc(c.hint)}</div>
    </div>`;
  }).join('');
}

window.setMyTeamTab = setMyTeamTab;
window.onMyTeamMonthChange = onMyTeamMonthChange;
window._mtSort = _mtSort;
window._mtToggle = _mtToggle;
window._mtOpenPerf = _mtOpenPerf;
window.renderMyTeam = renderMyTeam;

