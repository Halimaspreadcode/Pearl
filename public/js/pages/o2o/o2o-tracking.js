// ══════════════════════════════════════════════════════════════
// SUIVI O2O — bilan, actions et profil agent
// ══════════════════════════════════════════════════════════════
// Puts what was entered in Performance FO into perspective. Two angles —
// a team overview saying where to focus, and an individual profile
// gathering everything known about an agent before receiving them.
//
// The page used to be read-only; it no longer is for agreed actions. This
// is where they get ticked and sent to My Tasks: reopening Performance FO
// just to tick a box, right after reading the profile, forced a pointless
// round trip.
const o2osUI = { tab: 'bilan', fo: null };

function setO2OSTab(tab) {
  o2osUI.tab = tab;
  document.querySelectorAll('#page-cfg-o2o .o2os-tab')
    .forEach(b => b.classList.toggle('is-on', b.dataset.tab === tab));
  const b = document.getElementById('o2os-bilan');
  const p = document.getElementById('o2os-profil');
  if (b) b.style.display = tab === 'bilan'  ? '' : 'none';
  if (p) p.style.display = tab === 'profil' ? '' : 'none';
  renderO2OSuivi();
}

function onO2OSAgentChange() {
  o2osUI.fo = document.getElementById('o2os-fo')?.value || null;
  renderO2OSuivi();
}

function renderO2OSuivi() {
  const foList = _perfFoList();          // même périmètre Global/SN/CI
  const sel = document.getElementById('o2os-fo');
  if (sel) {
    const cur = o2osUI.fo && foList.includes(o2osUI.fo) ? o2osUI.fo : foList[0] || null;
    o2osUI.fo = cur;
    sel.innerHTML = foList.map(fo =>
      `<option value="${esc(fo)}"${fo === cur ? ' selected' : ''}>${esc(fo)}</option>`).join('');
  }
  if (o2osUI.tab === 'bilan') _o2osRenderBilan(foList);
  else _o2osRenderProfil(o2osUI.fo);
}

// ── Onglet Bilan & suivi ──────────────────────────────────────
function _o2osRenderBilan(foList) {
  const el = document.getElementById('o2os-bilan');
  if (!el) return;
  if (!foList.length) {
    el.innerHTML = '<div class="o2os-empty">No agent in this scope.</div>';
    return;
  }

  const today = _o2oToday();
  const lignes = foList.map(fo => {
    const d = _o2oBreakdown(fo);
    const { objectives, meetings } = _o2oFor(fo);
    const retards = objectives.filter(o =>
      o.due && o.status !== 'done' && o.status !== 'dropped' && o.due < today);
    return { fo, d, retards, meetings, entry: _o2oAll()[fo] || {} };
  });

  // Ce qui appelle une action, avant les tableaux : un bilan qui ne dit
  // pas par quoi commencer n'est qu'un rapport de plus.
  const sansEntretien = lignes.filter(l => !l.meetings.length);
  const anciens = lignes.filter(l => l.d?.dernierEntretien
    && _o2osJours(l.d.dernierEntretien) > 45);
  const enRetard = lignes.filter(l => l.retards.length);
  const actionsOuvertes = lignes.reduce((n, l) => n + (l.d?.actionsOuvertes || 0), 0);
  // Overdue actions are now a fact rather than an inference: they weigh
  // on the score and therefore deserve their own alert.
  const actionsRetard = lignes.filter(l => l.d?.actionsRetard);

  const alerte = (titre, items, rendu) => items.length ? `
    <div class="o2os-alert">
      <div class="o2os-alert-t">${esc(titre)} <span>${items.length}</span></div>
      <div class="o2os-alert-l">${items.map(rendu).join('')}</div>
    </div>` : '';

  const chip = (nom, detail) => `<button class="o2os-chip" onclick="o2osOpenProfil('${esc(nom).replace(/'/g, "\\'")}')">
      <b>${esc(nom)}</b>${detail ? `<small>${esc(detail)}</small>` : ''}</button>`;

  el.innerHTML = `
    <div class="o2os-kpis">
      ${_o2osKpi(lignes.length, 'agents suivis')}
      ${_o2osKpi(lignes.reduce((n, l) => n + (l.d?.nbObjectifs || 0), 0), 'objectifs actifs')}
      ${_o2osKpi(enRetard.reduce((n, l) => n + l.retards.length, 0), 'objectifs en retard', enRetard.length ? 'warn' : '')}
      ${_o2osKpi(actionsOuvertes, 'open actions')}
      ${_o2osKpi(actionsRetard.reduce((n, l) => n + l.d.actionsRetard, 0), 'actions en retard', actionsRetard.length ? 'warn' : '')}
      ${_o2osKpi(lignes.reduce((n, l) => n + l.meetings.length, 0), 'entretiens tenus')}
    </div>

    ${alerte('No meeting recorded', sansEntretien, l => chip(l.fo, ''))}
    ${alerte('Last meeting more than 45 days ago', anciens,
      l => chip(l.fo, `${_o2osJours(l.d.dernierEntretien)} j`))}
    ${alerte('Overdue objectives', enRetard,
      l => chip(l.fo, `${l.retards.length} en retard`))}
    ${alerte('Agreed actions overdue', actionsRetard,
      l => chip(l.fo, `${l.d.actionsRetard} overdue`))}

    <div class="config-card">
      <h3>Per-agent review</h3>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Agent</th><th>Objectives score</th><th>Progress</th>
            <th>Deadlines</th><th>Actions</th><th>Last meeting</th><th style="width:90px"></th>
          </tr></thead>
          <tbody>${lignes.map(l => _o2osLigne(l)).join('')}</tbody>
        </table>
      </div>
    </div>`;
}

function _o2osKpi(val, label, cls) {
  return `<div class="o2os-kpi ${cls || ''}">
    <div class="o2os-kpi-v">${val}</div><div class="o2os-kpi-l">${esc(label)}</div></div>`;
}

function _o2osJours(iso) {
  if (!iso) return null;
  return Math.round((Date.now() - new Date(iso + 'T00:00:00').getTime()) / 864e5);
}

function _o2osBarre(v) {
  if (v === null || v === undefined) return '<span class="o2os-na">—</span>';
  // Une seule classe teintée : sous 50 %, la jauge passe au rouge de
  // marque. Au-dessus elle reste grise — trois couleurs sur la colonne
  // ne disaient rien que le pourcentage juste à côté ne dise déjà.
  const cls = v < 50 ? 'low' : '';
  return `<div class="o2os-bar"><span class="${cls}" style="width:${Math.max(0, Math.min(100, v))}%"></span></div>
          <small class="o2os-bar-v">${v}</small>`;
}

function _o2osLigne(l) {
  const d = l.d;
  const j = d?.dernierEntretien ? _o2osJours(d.dernierEntretien) : null;
  const q = esc(l.fo).replace(/'/g, "\\'");
  return `<tr>
    <td style="font-weight:600">${esc(l.fo)}</td>
    <td>${d ? `<b>${d.score}</b>` : '<span class="o2os-na">—</span>'}</td>
    <td>${_o2osBarre(d?.avancement ?? null)}</td>
    <td>${_o2osBarre(d?.echeances ?? null)}</td>
    <td>${d?.actionsTotal
      ? `${d.actionsSuivies}/${d.actionsTotal} done`
        + (d.actionsRetard ? ` <small class="o2os-late">${d.actionsRetard} overdue</small>` : '')
        + (!d.actionsRetard && d.actionsOuvertes ? ` <small>(${d.actionsOuvertes} open)</small>` : '')
      : '<span class="o2os-na">—</span>'}</td>
    <td>${d?.dernierEntretien
      ? `${esc(_absFmtDay(d.dernierEntretien))} <small class="${j > 45 ? 'o2os-late' : ''}">${j} j</small>`
      : '<span class="o2os-late">jamais</span>'}</td>
    <td style="text-align:right">
      <button class="btn btn-ghost btn-sm" onclick="o2osOpenProfil('${q}')">Profil</button>
    </td>
  </tr>`;
}

function o2osOpenProfil(fo) {
  // Monté dans la vue d'équipe de la page Équipe : le profil est celui de
  // la fiche de l'agent, on y va plutôt que d'en ouvrir une copie ici.
  if (document.getElementById('page-cfg-o2o')?.dataset.eq === 'team' && typeof eqOpenAgent === 'function') return eqOpenAgent(fo, 'o2o', 'profil');
  o2osUI.fo = fo;
  const sel = document.getElementById('o2os-fo');
  if (sel) sel.value = fo;
  setO2OSTab('profil');
}

// ── Onglet Profil agent ───────────────────────────────────────
// Tout ce que l'application sait de l'agent, rassemblé pour préparer un
// entretien sans avoir à ouvrir cinq écrans. Rien n'est inventé : chaque
// bloc dit d'où il vient, et ce qui manque est signalé comme manquant
// plutôt que comblé par une valeur par défaut.
function _o2osRenderProfil(fo) {
  const el = document.getElementById('o2os-profil');
  if (!el) return;
  if (!fo) { el.innerHTML = '<div class="o2os-empty">No agent selected.</div>'; return; }

  const entry = _o2oAll()[fo] || {};
  // Les objectifs affichés doivent être ceux sur lesquels l'agent est
  // réellement suivi. _o2oFor ne rend que l'ancien plan trimestriel :
  // pour un agent déjà repris dans le flux agent, la page montrait donc
  // des lignes figées d'août pendant que l'intéressé avançait ailleurs,
  // et la liste contredisait les compteurs juste au-dessus — eux
  // passent par _o2oBreakdown, donc par _scoredObjectives.
  // On lit la même source qu'eux, celle qui bascule d'elle-même.
  const { meetings } = _o2oFor(fo);
  // Liste et compteurs suivent la session choisie dans le sélecteur des
  // objectifs ; la note du mois, elle, reste sur la session courante.
  const sid = objCurSessionId();
  const objectives = _scoredObjectives(fo, sid);
  const d = _o2oBreakdown(fo, sid);
  const today = _o2oToday();

  const tracker = personSite(fo);
  const fid = (state.config.fo_ids || {})[fo] || '';
  const card = _perfMonthData(perfUI.month || _perfMonthKey())[fo];
  const note = typeof perfScore === 'function' ? perfScore(card).score : null;

  const stats = (state.dashboard?.by_fo || {})[fo] || {};
  const sla = stats.total ? Math.round((1 - (stats.breach || 0) / stats.total) * 100) : null;
  const skill = _skillBreakdown(fo);
  const att = (state.attendanceScores || {})[fo] || null;

  const tries = [...meetings].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const humeurs = tries.filter(m => m.mood);

  el.innerHTML = `
    <div class="o2os-prof">
      <div class="o2os-prof-head">
        <div class="o2os-prof-av" style="background:${foAvatarColor(fo)}">${foInitials(fo)}</div>
        <div class="o2os-prof-id">
          <div class="o2os-prof-nom">${esc(fo)}</div>
          <div class="o2os-prof-meta">
            <span class="o2os-tag">${esc(tracker)}</span>
            ${entry.domain ? `<span class="o2os-tag">${esc(entry.domain)}</span>` : ''}
            ${fid ? `<span class="o2os-tag mono">${esc(fid)}</span>` : '<span class="o2os-tag warn">ID manquant</span>'}
          </div>
          ${entry.focus ? `<div class="o2os-prof-focus">${esc(entry.focus)}</div>` : ''}
        </div>
        <div class="o2os-prof-note">
          <div class="o2os-prof-note-v">${note ?? '—'}</div>
          <div class="o2os-prof-note-l">score for the month</div>
        </div>
      </div>

      <div class="o2os-cards">
        ${_o2osCarte('Where they stand', [
          ['Active objectives', d ? `${d.nbAtteints} met of ${d.nbObjectifs}` : 'none'],
          ['Overdue objectives', d?.nbRetard ? `${d.nbRetard}` : 'none'],
          ['Meetings held', String(meetings.length)],
          ['Last meeting', d?.dernierEntretien
            ? `${_absFmtDay(d.dernierEntretien)} (${_o2osJours(d.dernierEntretien)} j)` : 'jamais'],
        ])}
        ${_o2osCarte('What the numbers say', [
          ['SLA met', sla === null ? 'no ticket' : `${sla} %`],
          ['Tickets handled', String(stats.resolved || 0)],
          ['Breaches', String(stats.breach || 0)],
          ['Attendance', att ? `${att.score} /100` : 'not calculated'],
          ['Skills', skill ? `${skill.score} /100` : 'no quiz'],
        ])}
      </div>

      ${_o2osPrep(fo, { d, objectives, meetings, today, fid, att, stats })}
      ${_o2osRadar(fo, card, _perfAutoValues(fo))}
      ${_o2osForces(fo, { d, sla, skill, att, stats })}
      ${_o2osHumeurs(humeurs)}
      ${_o2osObjectifs(objectives, today)}
      ${_o2osActions(fo, meetings)}
      ${_o2osEntretiens(tries)}
    </div>`;
}

// ── To prepare for the next review ─────────────────────────────
// The profile said what we knew about the agent without ever saying where
// to start. This band recomputes nothing: it surfaces what is already
// shown further down and calls for a decision, with the matching action.
//
// Nothing to report is a result in itself — write it, rather than leaving
// a blank that would read as a screen that failed to load.
function _o2osPrep(fo, ctx) {
  const { d, objectives, meetings, today, fid, att, stats } = ctx;
  const q = esc(fo).replace(/'/g, "\\'");
  const pts = [];

  // 1. Actions convenues en retard — elles pèsent sur la note.
  const late = _o2oAllActions(fo, meetings).filter(a => _o2oActionLate(a, today));
  if (late.length) pts.push({
    ton: 'bad',
    txt: `${late.length} agreed action${late.length > 1 ? 's' : ''} past due`,
    det: late.slice(0, 3).map(a => a.text).join(' · '),
    act: { l: 'View actions', on: `document.querySelector('.o2os-actions')?.scrollIntoView({behavior:'smooth',block:'center'})` },
  });

  // 2. Objectifs dépassés.
  const objLate = objectives.filter(o =>
    o.due && o.status !== 'done' && o.status !== 'dropped' && o.due < today);
  if (objLate.length) pts.push({
    ton: 'bad',
    txt: `${objLate.length} objective${objLate.length > 1 ? 's' : ''} past due`,
    det: objLate.slice(0, 3).map(o => o.title).join(' · '),
  });

  // 3. Rythme des entretiens.
  const j = d?.dernierEntretien ? _o2osJours(d.dernierEntretien) : null;
  if (!meetings.length) pts.push({
    ton: 'bad', txt: 'No meeting recorded',
    det: 'Nothing to refer to for gauging progress.',
  });
  else if (j > 45) pts.push({
    ton: 'warn', txt: `Last review ${j} days ago`,
    det: 'Beyond 45 days, the follow-up loses its thread.',
  });

  // 4. Actions en cours à envoyer dans My Tasks — pour que l'agent les
  //    retrouve dans son outil de travail et non dans un compte rendu.
  const aEnvoyer = _o2oAllActions(fo, meetings)
    .filter(a => a.status === 'todo' && !_o2oTaskFor(fo, a.id)).length;
  if (aEnvoyer) pts.push({
    ton: 'info',
    txt: `${aEnvoyer} action${aEnvoyer > 1 ? 's' : ''} not yet in My Tasks`,
    det: 'Once sent, they appear in the week of their due date.',
    act: { l: 'Send all', on: `o2oPushAllActions('${q}')` },
  });

  // 5. Actions sans échéance : impossible de les juger en retard, donc
  //    invisibles dans la note tant qu'elles ne sont pas datées.
  const sansDate = _o2oAllActions(fo, meetings).filter(a => a.status === 'todo' && !a.due).length;
  if (sansDate) pts.push({
    ton: 'info',
    txt: `${sansDate} action${sansDate > 1 ? 's' : ''} without a due date`,
    det: 'Without a date, they can never be counted as met.',
  });

  // 6. Trous de données : ils se voyaient passivement dans les cartes,
  //    on en fait une consigne.
  if (!fid) pts.push({
    ton: 'warn', txt: 'Employee ID missing',
    det: 'Without it, no “My Performance” code can be issued.',
  });
  if (!att) pts.push({
    ton: 'info', txt: 'Attendance not calculated',
    det: 'The criterion is excluded from the scale until an absence is recorded.',
  });
  if (!stats.total) pts.push({
    ton: 'info', txt: 'No ticket in the period',
    det: 'The displayed SLA is not based on anything measured.',
  });

  return `<div class="config-card o2os-prep">
    <div class="o2os-act-head">
      <h3>To prepare for the next meeting</h3>
      ${pts.length ? `<span class="o2os-prep-n">${pts.length}</span>` : ''}
    </div>
    ${pts.length ? `<div class="o2os-prep-l">
      ${pts.map(p => `<div class="o2os-prep-i is-${p.ton}">
        <div class="o2os-prep-b">
          <div class="o2os-prep-t">${esc(p.txt)}</div>
          ${p.det ? `<div class="o2os-prep-d">${esc(p.det)}</div>` : ''}
        </div>
        ${p.act ? `<button class="btn btn-ghost btn-sm" onclick="${p.act.on}">${esc(p.act.l)}</button>` : ''}
      </div>`).join('')}
    </div>`
    : '<div class="o2os-na">Nothing to report: actions kept, deadlines met, file complete.</div>'}
  </div>`;
}

// ── Toile d'araignée ──────────────────────────────────────────
// Les six critères du barème, sur un hexagone. Un tableau de six chiffres
// se lit ligne à ligne ; la forme, elle, se lit d'un coup — un creux se
// repère avant d'avoir lu les intitulés.
//
// SVG écrit à la main : aucune bibliothèque de graphiques dans le projet,
// et en ajouter une pour six points serait disproportionné.
const O2OS_RADAR = { r: 78, cx: 128, cy: 108, niveaux: 4 };

// Sommet i sur l'anneau `ratio` (0 = centre, 1 = bord). On part du haut
// (−90°) pour que le premier critère soit au sommet, pas à droite.
function _o2osPoint(i, total, ratio) {
  const a = (Math.PI * 2 * i) / total - Math.PI / 2;
  const d = O2OS_RADAR.r * ratio;
  return [
    O2OS_RADAR.cx + Math.cos(a) * d,
    O2OS_RADAR.cy + Math.sin(a) * d,
  ];
}

function _o2osPolygone(vals, ratioMax) {
  return vals.map((v, i) => {
    const [x, y] = _o2osPoint(i, vals.length, (v / 100) * (ratioMax ?? 1));
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function _o2osRadar(fo, card, auto) {
  // Valeur retenue par critère : la note saisie prime, sinon la mesure
  // automatique — exactement la règle de la fiche de notation, pour que
  // la toile et la note du mois racontent la même chose.
  card = _perfLegacyCard(card);
  const axes = PERF_CRITERIA.map(c => {
    const saisi = card && card[c.id] !== undefined && card[c.id] !== null && card[c.id] !== '';
    const v = saisi ? Number(card[c.id]) : (auto[c.id] ?? null);
    return {
      label: c.label,
      court: c.id === 'individual' ? 'Objectifs' : c.id === 'process' ? 'Process' : c.label,
      v: Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : null,
      mesure: !saisi && auto[c.id] != null,
      poids: c.weight,
    };
  });

  const connus = axes.filter(a => a.v !== null);
  if (connus.length < 3) {
    return `<div class="config-card">
      <h3>Skills profile</h3>
      <div class="o2os-na">
        At least three criteria must be filled in to draw the web —
        ${connus.length} sur ${axes.length} so far. Complete the sheet in
        Performance FO.
      </div>
    </div>`;
  }

  // Un critère non renseigné est tracé à 0 pour fermer le polygone, mais
  // signalé comme manquant : un creux dû à l'absence de note ne doit pas
  // se lire comme une faiblesse.
  const vals = axes.map(a => a.v ?? 0);
  const moy = Math.round(connus.reduce((n, a) => n + a.v, 0) / connus.length);

  const grille = Array.from({ length: O2OS_RADAR.niveaux }, (_, k) => {
    const ratio = (k + 1) / O2OS_RADAR.niveaux;
    const pts = axes.map((_, i) => {
      const [x, y] = _o2osPoint(i, axes.length, ratio);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `<polygon class="o2os-rd-grid" points="${pts}"/>`;
  }).join('');

  const rayons = axes.map((_, i) => {
    const [x, y] = _o2osPoint(i, axes.length, 1);
    return `<line class="o2os-rd-axis" x1="${O2OS_RADAR.cx}" y1="${O2OS_RADAR.cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
  }).join('');

  // Étiquettes : l'ancrage suit la position autour du cercle, sinon les
  // textes de gauche débordent du cadre.
  const etiquettes = axes.map((a, i) => {
    const [x, y] = _o2osPoint(i, axes.length, 1.24);
    const dx = x - O2OS_RADAR.cx;
    const anchor = Math.abs(dx) < 6 ? 'middle' : (dx > 0 ? 'start' : 'end');
    return `<text class="o2os-rd-lab${a.v === null ? ' is-na' : ''}" x="${x.toFixed(1)}" y="${y.toFixed(1)}"
      text-anchor="${anchor}" dominant-baseline="middle">${esc(a.court)}</text>
      <text class="o2os-rd-val" x="${x.toFixed(1)}" y="${(y + 11).toFixed(1)}"
      text-anchor="${anchor}" dominant-baseline="middle">${a.v === null ? '—' : a.v}</text>`;
  }).join('');

  const sommets = axes.map((a, i) => {
    if (a.v === null) return '';
    const [x, y] = _o2osPoint(i, axes.length, a.v / 100);
    return `<circle class="o2os-rd-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3"/>`;
  }).join('');

  const manquants = axes.filter(a => a.v === null).map(a => a.label);
  const mesures   = axes.filter(a => a.mesure).length;

  return `<div class="config-card">
    <h3>Skills profile</h3>
    <p style="font-size:11.5px;color:var(--mute);margin:-4px 0 6px">
      The six scoring criteria, out of 100. The entered score takes precedence over the
      mesure automatique — comme dans la fiche.
    </p>
    <div class="o2os-rdwrap">
      <svg class="o2os-rd" viewBox="0 0 256 224" role="img"
           aria-label="${esc(fo)}'s profile across the six scoring criteria">
        ${grille}${rayons}
        <polygon class="o2os-rd-area" points="${_o2osPolygone(vals)}"/>
        ${sommets}${etiquettes}
      </svg>
      <div class="o2os-rd-side">
        <div class="o2os-rd-moy">
          <b>${moy}</b><span>average of known criteria</span>
        </div>
        ${connus.length === axes.length
          ? '<div class="o2os-na">All six criteria are filled in.</div>'
          : `<div class="o2os-rd-warn">Not filled in: ${esc(manquants.join(', '))}</div>`}
        ${mesures ? `<div class="o2os-na">${mesures} criteri${mesures > 1 ? 'a' : 'on'} pre-filled by automatic measurement.</div>` : ''}
      </div>
    </div>
  </div>`;
}

function _o2osCarte(titre, lignes) {
  return `<div class="o2os-card">
    <div class="o2os-card-t">${esc(titre)}</div>
    ${lignes.map(([k, v]) => `<div class="o2os-card-r"><span>${esc(k)}</span><b>${esc(String(v))}</b></div>`).join('')}
  </div>`;
}

// Points forts et points de vigilance, déduits des mesures disponibles.
// Seuils explicites, et rien n'est affirmé sans donnée : un critère non
// mesuré n'apparaît ni en force ni en faiblesse.
function _o2osForces(fo, m) {
  const forts = [], faibles = [];
  const push = (ok, txt) => (ok ? forts : faibles).push(txt);

  if (m.sla !== null) {
    if (m.sla >= 95) forts.push(`SLA met at ${m.sla} % — very reliable on deadlines`);
    else if (m.sla < 85) faibles.push(`SLA at ${m.sla} % — deadlines are slipping`);
  }
  if (m.skill) {
    if (m.skill.score >= 75) forts.push(`Solid training path (${m.skill.quizValides}/${m.skill.quizDispo} courses)`);
    else if (m.skill.score < 45) faibles.push(`Training barely advanced (${m.skill.quizValides}/${m.skill.quizDispo} courses)`);
    if (m.skill.serie >= 7) forts.push(`Regular training — ${m.skill.serie}-day streak`);
  }
  if (m.att) {
    if (m.att.score >= 95) forts.push('Attendance with no discrepancy');
    else if (m.att.score < 85) faibles.push(`Attendance at ${m.att.score} — ${m.att.unjustified || 0} unexcused, ${m.att.late_notice || 0} without notice`);
  }
  if (m.d) {
    if (m.d.avancement >= 70) forts.push(`Objectives well advanced (${m.d.avancement} %)`);
    else if (m.d.avancement !== null && m.d.avancement < 30) faibles.push(`Objectives barely advanced (${m.d.avancement} %)`);
    if (m.d.nbRetard) faibles.push(`${m.d.nbRetard} objective(s) past due`);
    if (m.d.echeances === 100 && m.d.nbObjectifs) forts.push('All deadlines met');
    if (m.d.actions !== null && m.d.actions >= 80) forts.push(`Agreed actions kept (${m.d.actionsSuivies}/${m.d.actionsJugees})`);
    else if (m.d.actions !== null && m.d.actions < 50) faibles.push(`Agreed actions rarely kept (${m.d.actionsSuivies}/${m.d.actionsJugees})`);
    if (m.d.actionsRetard) faibles.push(`${m.d.actionsRetard} agreed action(s) past due`);
    if (!m.d.nbEntretiens) faibles.push('No meeting recorded — nothing to refer to');
  }

  const col = (titre, items, cls) => `
    <div class="o2os-sw ${cls}">
      <div class="o2os-sw-t">${esc(titre)}</div>
      ${items.length
        ? `<ul>${items.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`
        : '<div class="o2os-na">Nothing notable in the available data.</div>'}
    </div>`;

  return `<div class="o2os-swwrap">
    ${col('Points d’appui', forts, 'is-up')}
    ${col('Points of concern', faibles, 'is-down')}
  </div>`;
}

function _o2osHumeurs(list) {
  if (!list.length) return '';
  const lab = { up: 'Bonne dynamique', flat: 'Stable', down: 'Vigilance' };
  const ord = [...list].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return `<div class="config-card">
    <h3>Meeting dynamics</h3>
    <p style="font-size:11.5px;color:var(--mute);margin:-4px 0 12px">
      Mood recorded at each meeting, from oldest to most recent.</p>
    <div class="o2os-moods">
      ${ord.map(m => `<span class="o2os-mood is-${esc(m.mood)}" title="${esc(_absFmtDay(m.date))} — ${esc(lab[m.mood] || m.mood)}">
        <i></i><small>${esc(_absFmtDay(m.date))}</small></span>`).join('')}
    </div>
  </div>`;
}

function _o2osObjectifs(objs, today) {
  const actifs = objs.filter(o => o.status !== 'dropped');
  // Navigation entre sessions : sans elle, les objectifs du trimestre
  // clos restaient mêlés à ceux du trimestre en cours.
  const head = `<div class="o2os-obj-head"><h3>Objectifs</h3>${objSessionPicker('renderO2OSuivi')}</div>`;
  if (!actifs.length) {
    const sid = objCurSessionId();
    const sess = (state.config.objective_sessions || []).find(x => x.id === sid);
    return `<div class="config-card">${head}
    <div class="o2os-na">${sess
      ? `No approved objective for this agent in ${esc(sess.name || sess.id)}.`
      : 'No objective defined for this agent.'}</div></div>`;
  }
  const st = id => (O2O_STATUSES.find(s => s.id === id) || O2O_STATUSES[0]).label;

  // D'où vient la liste. Les deux modèles coexistent le temps de la
  // bascule, et une liste d'objectifs sans sa provenance laisse croire
  // que l'agent n'a rien entrepris depuis le plan de départ.
  const fresh = actifs.filter(o => o._fresh);
  let src;
  if (fresh.length) {
    const sid = objCurSessionId();
    const sess = sid === 'all' ? null
      : (state.config.objective_sessions || []).find(x => x.id === sid);
    src = `<span class="o2os-tag">${esc(sess ? sess.name : sid === 'all' ? 'Toutes les sessions' : 'flux agent')}</span>
      <small>Approved objectives the agent is tracking${
        sess && sess.end ? ` · until ${esc(_absFmtDay(sess.end))}` : ''}</small>`;
  } else {
    // Rien d'approuvé dans le flux agent : la liste affichée est donc
    // l'ancien plan trimestriel, figé. Dire « ancien plan » ne suffisait
    // pas — on ne savait pas quoi en faire. Ce bandeau nomme la cause
    // (l'objectif n'a jamais été repris dans la session) et porte le
    // geste qui la corrige, au lieu d'obliger à aller le chercher dans
    // l'onglet Approbations de Performance FO.
    const sess = (state.config.objective_sessions || []).find(x => x.state === 'open');
    const en_attente = ((state.config.fo_objectives || {})[o2osUI.fo] || [])
      .filter(o => o.state !== 'approved');
    src = `<span class="o2os-tag warn">Ancien plan</span>
      <small>Frozen quarterly plan — nothing approved in the agent flow for this agent.</small>`;
    if (en_attente.length) {
      src += `<button type="button" class="o2os-obj-cta"
        onclick="perfUI.tab='review';window.renderPage('cfg-perf')">
        ${en_attente.length} objectif(s) en attente de décision →</button>`;
    } else if (sess) {
      src += `<button type="button" class="o2os-obj-cta"
        onclick="o2osCarryOver()">Reprendre ce plan dans ${esc(sess.name)}</button>`;
    }
  }

  return `<div class="config-card">
    ${head}
    <div class="o2os-obj-src">${src}</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Objectif</th><th>Indicateur</th><th>Avancement</th><th>Due date</th><th>Statut</th></tr></thead>
        <tbody>${actifs.map(o => {
          const retard = o.due && o.status !== 'done' && o.due < today;
          return `<tr>
            <td>${esc(o.title || '—')}</td>
            <td><small>${esc(o.kpi || '—')}</small></td>
            <td>${_o2osBarre(o._pct ?? _objProgress(o))}${
              (o.steps || []).length
                ? `<small class="o2os-obj-steps">${
                    o.steps.filter(x => x.done).length}/${o.steps.length} jalons</small>`
                : ''}</td>
            <td>${o.due ? `<span class="${retard ? 'o2os-late' : ''}">${esc(_absFmtDay(o.due))}</span>` : '—'}</td>
            <td><span class="o2os-tag">${esc(st(o.status))}</span>${
              // Les jalons se cochent indépendamment du statut d'ensemble :
              // tous faits alors que l'objectif reste « à démarrer » est un
              // état réel, pas une erreur d'affichage. On le signale au lieu
              // de laisser la barre et le badge se contredire en silence —
              // c'est justement ce qu'il faut trancher pendant l'entretien.
              (o.steps || []).length && o.steps.every(x => x.done) && o.status !== 'done'
                ? `<small class="o2os-obj-flag" title="All approved milestones are done, but the objective is still marked « ${esc(st(o.status))} »">statut à confirmer</small>`
                : ''}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>
  </div>`;
}

// Agreed actions are worked here: ticked, dated, sent to My Tasks. The
// status is entered — no longer inferred from whether a review was held —
// and it accounts for 20% of the Objectives criterion.
function _o2osActions(fo, meetings) {
  const today = _o2oToday();
  const all = _o2oAllActions(fo, meetings);
  if (!all.length) return `<div class="config-card">
    <h3>Agreed actions</h3>
    <div class="o2os-na">No agreed action yet. They are entered in the
      « Agreed actions » field of the review, one per line.</div>
  </div>`;

  const st = _o2oActionStats(fo, meetings);
  const q = esc(fo).replace(/'/g, "\\'");

  // Whatever needs a decision rises: overdue, then to do, then the rest
  // by descending date.
  const rank = a => _o2oActionLate(a, today) ? 0 : a.status === 'todo' ? 1 : 2;
  const rows = [...all].sort((a, b) =>
    rank(a) - rank(b) || String(b.date).localeCompare(String(a.date)));

  const aFaire = all.filter(a => a.status === 'todo' && !_o2oTaskFor(fo, a.id)).length;

  return `<div class="config-card">
    <div class="o2os-act-head">
      <h3>Agreed actions</h3>
      ${aFaire ? `<button class="btn btn-ghost btn-sm" onclick="o2oPushAllActions('${q}')">
        Send ${aFaire} action${aFaire > 1 ? 's' : ''} to My Tasks</button>` : ''}
    </div>
    <p style="font-size:11.5px;color:var(--mute);margin:-4px 0 12px">
      The rate only judges what is decidable —
      done or overdue: an action still within its deadline is not counted,
      and a deliberate drop does not penalise.</p>

    <div class="o2os-act-stats">
      <div class="o2os-act-kpi${st.taux === null ? ' is-na' : st.taux >= 80 ? ' is-ok' : st.taux < 50 ? ' is-bad' : ''}">
        <b>${st.taux === null ? '—' : st.taux + ' %'}</b>
        <small>${st.jugees ? `${st.suivies}/${st.jugees} kept` : 'nothing decidable'}</small>
      </div>
      <div class="o2os-act-kpi"><b>${st.ouvertes}</b><small>on track</small></div>
      <div class="o2os-act-kpi${st.retard ? ' is-bad' : ''}"><b>${st.retard}</b><small>overdue</small></div>
      <div class="o2os-act-kpi"><b>${st.abandonnees}</b><small>dropped</small></div>
    </div>

    <div class="o2os-actions">
      ${rows.map(r => {
        const late = _o2oActionLate(r, today);
        const task = _o2oTaskFor(fo, r.id);
        const cls = r.status === 'done' ? 'is-done' : r.status === 'drop' ? 'is-drop' : late ? 'is-late' : 'is-todo';
        const badge = r.status === 'done' ? 'done'
          : r.status === 'drop' ? 'dropped'
          : late ? 'overdue' : 'to do';
        const args = `'${q}','${esc(r.meetingId)}','${esc(r.id)}'`;
        return `<div class="o2os-action ${cls}">
          <button class="o2os-act-check" title="${r.status === 'done' ? 'Reopen action' : 'Mark as done'}"
                  aria-label="${r.status === 'done' ? 'Reopen action' : 'Mark as done'}"
                  onclick="o2oCycleAction(${args})">
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
          </button>
          <div class="o2os-act-body">
            <div class="o2os-act-t">${esc(r.text)}</div>
            <div class="o2os-act-meta">
              <span>Review of ${esc(_absFmtDay(r.date))}</span>
              ${r.due ? `<span class="o2os-sep">·</span><span class="${late ? 'o2os-late' : ''}">due ${esc(_absFmtDay(r.due))}</span>` : ''}
              ${r.doneAt ? `<span class="o2os-sep">·</span><span>done ${esc(_absFmtDay(r.doneAt.slice(0, 10)))}</span>` : ''}
              ${task ? `<span class="o2os-sep">·</span><span class="o2os-act-link"
                onclick="o2oGoToTask('${esc(task.id)}')">in My Tasks</span>` : ''}
            </div>
          </div>
          <span class="o2os-tag ${cls}">${badge}</span>
          <div class="o2os-act-acts">
            <button class="o2os-iact" title="Set a due date" aria-label="Set a due date"
                    onclick="o2oSetActionDue(${args})">
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m0 16H5V10h14z"/></svg>
            </button>
            ${task ? '' : `<button class="o2os-iact" title="Send to My Tasks" aria-label="Send to My Tasks"
                    onclick="o2oPushActionToTasks(${args})">
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"/></svg>
            </button>`}
            ${r.status === 'drop'
              ? `<button class="o2os-iact" title="Reactivate action" aria-label="Reactivate action"
                    onclick="o2oSetActionStatus(${args},'todo')">
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8"/></svg>
            </button>`
              : `<button class="o2os-iact danger" title="Drop action" aria-label="Drop action"
                    onclick="o2oSetActionStatus(${args},'drop')">
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>`}
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function _o2osEntretiens(tries) {
  if (!tries.length) return `<div class="config-card"><h3>Meeting history</h3>
    <div class="o2os-na">No meeting recorded. Entry is done in Performance FO › Objectives &amp; meetings.</div></div>`;
  return `<div class="config-card">
    <h3>Meeting history</h3>
    ${tries.map(m => `
      <details class="o2os-meet">
        <summary>
          <b>${esc(_absFmtDay(m.date))}</b>
          ${m.topic ? `<span>${esc(m.topic)}</span>` : ''}
          ${m.mood ? `<i class="o2os-mood is-${esc(m.mood)}"></i>` : ''}
        </summary>
        <div class="o2os-meet-b">
          ${(m.sections || []).map(s => `
            <div class="o2os-meet-s">
              <div class="o2os-meet-l">${esc(s.label || s.id)}</div>
              <div class="o2os-meet-x">${esc(s.text || '').replace(/\n/g, '<br>')}</div>
            </div>`).join('') || '<div class="o2os-na">Meeting with no content.</div>'}
        </div>
      </details>`).join('')}
  </div>`;
}

