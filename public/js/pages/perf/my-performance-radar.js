// ── Toile d'araignée « My Performance » ───────────────────────
// Six barres alignées se lisent comme six verdicts séparés : chacune
// invite à contester sa ligne. La toile, elle, montre un profil — un
// creux se lit relativement aux autres axes, pas comme une sanction.
// Les barres détaillées restent dessous : masquer le chiffre ferait
// venir la question au lieu de l'éviter.
//
// Géométrie propre à cette page : le radar O2O est calé sur la mise en
// page manager (#page-cfg-o2o), on ne peut pas le réutiliser tel quel.
// Le viewBox est nettement plus large que le cercle : les étiquettes des
// axes de gauche et de droite sont ancrées vers l'extérieur et s'étendent
// au-delà du rayon. Serré sur le tracé, « Objectives » sortait du cadre.
const MYPERF_RADAR = { r: 72, cx: 175, cy: 106, niveaux: 4 };

// Sommet i sur l'anneau `ratio` (0 = centre, 1 = bord), en partant du
// haut pour que le premier critère soit au sommet et non à droite.
function _myPerfRadarPoint(i, total, ratio) {
  const a = (Math.PI * 2 * i) / total - Math.PI / 2;
  const dist = MYPERF_RADAR.r * ratio;
  return [
    MYPERF_RADAR.cx + Math.cos(a) * dist,
    MYPERF_RADAR.cy + Math.sin(a) * dist,
  ];
}

// Étiquettes courtes : à cette taille, « Individual objectives » sur un
// axe déborde du cadre et pousse le tracé hors du viewBox.
const _MYPERF_RADAR_SHORT = {
  individual: 'Objectives',
  attendance: 'Attendance',
  process:    'Process',
  skills:     'Skills',
  sla:        'SLA',
  tasks:      'Tasks',
};

function _myPerfRadar(crits) {
  // Même ordre que PERF_CRITERIA plutôt que l'ordre trié par poids des
  // barres : sur un polygone, l'ordre des axes change la forme, il doit
  // donc rester stable d'un mois à l'autre pour être comparable.
  const axes = PERF_CRITERIA.map(def => {
    const c = crits.find(x => x.id === def.id);
    const v = c && c.valeur !== null && c.valeur !== undefined ? Number(c.valeur) : null;
    return {
      label: def.label,
      court: _MYPERF_RADAR_SHORT[def.id] || def.label,
      v: Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : null,
      poids: def.weight,
    };
  });

  const connus = axes.filter(a => a.v !== null);
  // Sous trois points, un polygone n'a pas de forme : deux axes donnent
  // un segment, un seul un point. Le détail chiffré suffit dans ce cas.
  if (connus.length < 3) return '';

  // Un axe non noté est tracé à 0 pour fermer le polygone, mais son
  // étiquette porte « — » : un creux dû à l'absence de note ne doit pas
  // se lire comme une faiblesse.
  const vals = axes.map(a => a.v ?? 0);
  const moy  = Math.round(connus.reduce((n, a) => n + a.v, 0) / connus.length);

  const grille = Array.from({ length: MYPERF_RADAR.niveaux }, (_, k) => {
    const ratio = (k + 1) / MYPERF_RADAR.niveaux;
    const pts = axes.map((_, i) => {
      const [x, y] = _myPerfRadarPoint(i, axes.length, ratio);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `<polygon class="myperf-rd-grid" points="${pts}"/>`;
  }).join('');

  const rayons = axes.map((_, i) => {
    const [x, y] = _myPerfRadarPoint(i, axes.length, 1);
    return `<line class="myperf-rd-axis" x1="${MYPERF_RADAR.cx}" y1="${MYPERF_RADAR.cy}"
      x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
  }).join('');

  // Anneau de référence à 70 — le seuil déjà utilisé pour les points
  // d'attention. Sans repère, la forme ne dit pas si elle est bonne.
  const cible = axes.map((_, i) => {
    const [x, y] = _myPerfRadarPoint(i, axes.length, 0.7);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const aire = axes.map((a, i) => {
    const [x, y] = _myPerfRadarPoint(i, axes.length, (a.v ?? 0) / 100);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const sommets = axes.map((a, i) => {
    if (a.v === null) return '';
    const [x, y] = _myPerfRadarPoint(i, axes.length, a.v / 100);
    return `<circle class="myperf-rd-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3"/>`;
  }).join('');

  // Étiquettes sans les notes : poser « 79 » sous chaque axe redonnerait
  // la lecture chiffre par chiffre que la toile remplace — c'est cette
  // lecture-là qui fait contester ligne à ligne. La forme situe, le
  // détail chiffré reste disponible dans le repli en dessous.
  const etiquettes = axes.map((a, i) => {
    const [x, y] = _myPerfRadarPoint(i, axes.length, 1.26);
    const dx = x - MYPERF_RADAR.cx;
    // L'ancrage suit la position autour du cercle : centré en haut et en
    // bas, sinon les textes de gauche débordent du cadre.
    const anchor = Math.abs(dx) < 6 ? 'middle' : (dx > 0 ? 'start' : 'end');
    return `<text class="myperf-rd-lab${a.v === null ? ' is-na' : ''}" x="${x.toFixed(1)}" y="${y.toFixed(1)}"
      text-anchor="${anchor}" dominant-baseline="middle">${esc(a.court)}</text>`;
  }).join('');

  const manquants = axes.filter(a => a.v === null).map(a => a.label);

  return `
    <div class="myperf-rdwrap">
      <svg class="myperf-rd" viewBox="24 8 288 196" role="img"
           aria-label="Your profile across the ${axes.length} scoring criteria: ${
             esc(axes.map(a => `${a.label} ${a.v === null ? 'not rated' : a.v + ' out of 100'}`).join(', '))}">
        ${grille}${rayons}
        <polygon class="myperf-rd-target" points="${cible}"/>
        <polygon class="myperf-rd-area" points="${aire}"/>
        ${sommets}${etiquettes}
      </svg>
      <div class="myperf-rd-side">
        <div class="myperf-rd-moy"><b>${moy}</b><span>average of rated criteria</span></div>
        <div class="myperf-rd-legend">
          <span class="myperf-rd-key you"></span> Your profile
          <span class="myperf-rd-key tgt"></span> Target (70)
        </div>
        <div class="myperf-rd-note">
          The shape matters more than any single point: a dip on one axis is
          read against the others, not on its own.
        </div>
        ${manquants.length
          ? `<div class="myperf-rd-note">Not rated: ${esc(manquants.join(', '))} — drawn at the centre, not counted in the average.</div>`
          : ''}
      </div>
    </div>`;
}

// ── Rappel de dépassement, côté agent ─────────────────────────
// La page disait la note sans jamais dire ce qui avait glissé. Un
// objectif dépassé n'apparaissait qu'en dépliant sa carte, tout en bas :
// l'agent apprenait le retard en entretien, quand il est trop tard pour
// le rattraper. On le pose donc en tête, avant le score.
//
// Le ton reste factuel : c'est un rappel d'échéance, pas une sanction —
// la page est lue par la personne concernée, seule devant son écran.
function _myPerfLateBanner(objectifs) {
  const list = objectifs || [];
  if (!list.length) return '';

  const over = list.filter(o => o.late?.overdue);
  const lateSteps = list.filter(o => !o.late?.overdue && o.late?.late_steps > 0);
  if (!over.length && !lateSteps.length) return '';

  const item = o => `<li><b>${esc(o.title)}</b>${
    o.due ? ` — due ${esc(o.due)}` : ''}${
    o.late.days_over ? `, <b>${o.late.days_over} day${o.late.days_over > 1 ? 's' : ''} over</b>` : ''}</li>`;

  return `
    ${over.length ? `
    <div class="myperf-late" role="alert">
      <div class="myperf-late-ico">
        <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor"
             stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      </div>
      <div class="myperf-late-body">
        <div class="myperf-late-t">${over.length === 1
          ? 'One of your objectives is past its deadline'
          : `${over.length} of your objectives are past their deadline`}</div>
        <ul class="myperf-late-l">${over.map(item).join('')}</ul>
        <div class="myperf-late-d">
          Objectives weigh ${(PERF_CRITERIA.find(c => c.id === 'individual') || {}).weight}% of your score. If a date is no longer realistic,
          raise it with your manager rather than letting it run.
        </div>
      </div>
    </div>` : ''}
    ${lateSteps.length ? `
    <div class="myperf-late is-warn">
      <div class="myperf-late-ico">
        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor"
             stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><path d="M12 7v5l3 2"/></svg>
      </div>
      <div class="myperf-late-body">
        <div class="myperf-late-t">${lateSteps.reduce((n, o) => n + o.late.late_steps, 0)} milestone(s) behind schedule</div>
        <div class="myperf-late-d">
          On ${lateSteps.map(o => `« ${esc(o.title)} »`).join(', ')}.
          These objectives are still within their own deadline — a milestone met
          after its date counts for half in the progress shown.
        </div>
      </div>
    </div>` : ''}`;
}

// ── Ce que votre manager a écrit ──────────────────────────────
// La note arrivait sans les mots. Un chiffre seul ne se travaille pas :
// il se conteste. Les commentaires existaient déjà dans la fiche de
// notation, ils ne sortaient simplement jamais côté agent.
function _myPerfComments(commentaires, crits) {
  const list = commentaires || [];
  if (!list.length) return '';
  const nom = id => {
    const c = (crits || []).find(x => x.id === id);
    return (c && c.def && c.def.label) || id;
  };
  return `
    <div class="myperf-sec">
      <div class="myperf-sec-h">
        <div class="myperf-sec-t">What your manager noted</div>
        <div class="myperf-sec-n">${list.length}</div>
      </div>
      <div class="myperf-sec-d">
        Remarks written when you were rated. They say why a criterion
        is where it is — the material for your next one-to-one.
      </div>
      <ul class="myperf-cmts">
        ${list.map(c => `
          <li class="myperf-cmt">
            <div class="myperf-cmt-h">
              ${c.critere
                ? `<span class="myperf-cmt-c">${esc(nom(c.critere))}</span>`
                : `<span class="myperf-cmt-c is-gen">General</span>`}
              <span class="myperf-cmt-d">${esc(_myPerfWhen(c.at))}</span>
            </div>
            <div class="myperf-cmt-t">${esc(c.text)}</div>
          </li>`).join('')}
      </ul>
    </div>`;
}

function _myPerfWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ── Actions convenues en entretien ────────────────────────────
// Ce que l'agent s'est engagé à faire. L'engagement est le sien, mais
// il ne le voyait que du côté manager : il ne pouvait ni le suivre, ni
// constater qu'une date était passée. Le taux de suivi pèse par ailleurs
// 20 % du critère « objectifs individuels ».
function _myPerfActions(actions) {
  const list = actions || [];
  if (!list.length) return '';
  const late = list.filter(a => a.late).length;
  const done = list.filter(a => a.status === 'done').length;
  const LBL = { done: 'Done', todo: 'To do', drop: 'Dropped' };

  return `
    <div class="myperf-sec">
      <div class="myperf-sec-h">
        <div class="myperf-sec-t">Your agreed actions</div>
        <div class="myperf-sec-n">${done}/${list.length}</div>
      </div>
      <div class="myperf-sec-d">
        What you agreed on in your one-to-one. ${late
          ? `<b class="myperf-act-warn">${late} past ${late > 1 ? 'their' : 'its'} date.</b>`
          : 'Nothing is past its date.'}
      </div>
      <ul class="myperf-acts">
        ${list.map(a => `
          <li class="myperf-act${a.late ? ' is-late' : ''}${a.status === 'done' ? ' is-done' : ''}">
            <span class="myperf-act-m">${a.status === 'done' ? '✓' : a.status === 'drop' ? '—' : '○'}</span>
            <span class="myperf-act-t">${esc(a.text)}</span>
            <span class="myperf-act-d">
              ${a.due ? esc(a.due) : '<i>no date</i>'}
              <em>${esc(LBL[a.status] || a.status)}</em>
            </span>
          </li>`).join('')}
      </ul>
    </div>`;
}

// Tâches du mois : toutes, y compris celles qui ne sont pas encore échues.
// Seules les échues (ou faites) entrent dans le critère Tasks ; les autres
// sont listées « upcoming » pour que l'agent voie ce qui l'attend.
const _MYPERF_TASK_ETAT = {
  faite: ['Done', 'ok'], en_retard: ['Overdue', 'late'],
  aujourdhui: ['Due today', 'today'], a_venir: ['Upcoming', 'next'],
};
function _myPerfTasks(t) {
  if (!t || !t.total) return '';
  const rows = t.items.map(i => {
    const [lbl, cls] = _MYPERF_TASK_ETAT[i.etat] || ['', ''];
    return `<div class="myperf-task">
      <span class="myperf-task-s ${cls}">${esc(lbl)}</span>
      <span class="myperf-task-t">${esc(i.titre || 'Task')}</span>
      <span class="myperf-task-d">${esc(i.echeance)}</span>
    </div>`;
  }).join('');
  const resume = t.exigibles
    ? `${t.faites}/${t.exigibles} due task${t.exigibles > 1 ? 's' : ''} done · ${t.score}%`
    : 'None due yet — not scored yet';
  return `<div class="myperf-sec">
    <div class="myperf-sec-h">
      <div class="myperf-sec-t">Your tasks this month</div>
      <div class="myperf-sec-n">${esc(resume)}</div>
    </div>
    <div class="myperf-sec-d">A task counts in the Tasks criterion once its due date
      is reached or as soon as it is done.${t.a_venir ? ` ${t.a_venir} upcoming.` : ''}</div>
    <div class="myperf-tasks">${rows}</div>
  </div>`;
}

function _renderMyPerf(d) {
  const l = document.getElementById('myperf-login');
  const r = document.getElementById('myperf-result');
  if (!r) return;
  if (l) l.style.display = 'none';
  r.style.display = '';

  const mois  = _myPerfMonthLabel(d.periode, true);
  const t     = _MYPERF_TENDANCE[d.tendance] || _MYPERF_TENDANCE.inconnue;
  const score = (d.score === null || d.score === undefined) ? null : d.score;
  const lv    = `lv${d.rang || 0}`;

  // Anneau de progression : le tracé est un cercle de rayon 76, donc une
  // circonférence de 2πr. L'offset restant matérialise ce qui manque à 100.
  const C    = 2 * Math.PI * 76;
  const dash = score === null ? 0 : (C * score) / 100;

  // Jauge en paliers : donne une position sans exiger de lire un chiffre.
  const steps = Array.from({ length: d.sur || 4 }, (_, i) =>
    `<span class="myperf-step${i < d.rang ? ' on' : ''}"></span>`).join('');
  // Libellés courts : le nom complet du palier est déjà en titre au-dessus,
  // ici il ne s'agit que de situer la marche atteinte sur l'échelle.
  const stepLabels = ['To improve', 'Correct', 'Good', 'Very good']
    .map(s => `<span>${esc(s)}</span>`).join('');

  // Écart chiffré avec le mois précédent : la flèche dit le sens, le
  // nombre dit de combien. Sans le second, « en baisse » reste vague.
  const delta = (score !== null && d.score_precedent !== null && d.score_precedent !== undefined)
    ? score - d.score_precedent : null;
  const deltaTxt = delta === null ? ''
    : (delta === 0 ? '' : ` <b>${delta > 0 ? '+' : ''}${delta} pts</b>`);

  // ── Critères ────────────────────────────────────────────────
  // L'ordre suit le poids décroissant : ce qui pèse le plus dans la note
  // se lit en premier, c'est là que se gagnent ou se perdent les points.
  const crits = (d.criteres || [])
    .map(c => ({ ...c, def: PERF_CRITERIA.find(p => p.id === c.id) }))
    .filter(c => c.def)
    .sort((a, b) => b.weight - a.weight);

  const critRows = crits.map(c => {
    const v = c.valeur;
    const dv = (v !== null && c.precedent !== null) ? v - c.precedent : null;
    const arrow = (dv === null || dv === 0) ? ''
      : `<i class="${dv > 0 ? 'up' : 'down'}">${dv > 0 ? '▲' : '▼'} ${Math.abs(dv)}</i>`;
    return `
      <div class="myperf-crit-row">
        <div class="myperf-crit-l">
          <span class="myperf-crit-n">${esc(c.def.label)}</span>
          <span class="myperf-crit-w">${c.weight}%</span>
        </div>
        <div class="myperf-crit-v${v === null ? ' na' : ''}">
          ${v === null ? 'Not rated' : v + '<span style="font-size:10.5px;font-weight:500;color:var(--mute)">/100</span>'}${arrow}
        </div>
        <div class="myperf-bar"><i class="${_myPerfTone(v)}" style="width:${v === null ? 0 : v}%"></i></div>
        <div class="myperf-crit-h">${esc(c.def.hint || '')}</div>
      </div>`;
  }).join('');

  const noted = crits.filter(c => c.valeur !== null);

  // La toile ouvre la section ; le détail chiffré passe alors dans un
  // repli. Quand la toile ne peut pas être tracée (moins de trois
  // critères notés), le repli s'ouvre : sinon la section serait vide.
  const radarHtml = _myPerfRadar(crits);

  // ── Historique ──────────────────────────────────────────────
  // Hauteur relative au meilleur mois affiché plutôt qu'à 100 : sur une
  // plage resserrée, les écarts réels resteraient invisibles sinon.
  const hist = d.historique || [];
  const hmax = Math.max(60, ...hist.map(h => h.score || 0));
  const histCols = hist.map(h => {
    const now = h.periode === d.periode;
    const s = h.score;
    return `
      <div class="myperf-hcol" title="${esc(_myPerfMonthLabel(h.periode, true))}${s === null ? ' — not rated' : ' — ' + s + '/100'}">
        <div class="myperf-hval${s === null ? ' na' : ''}">${s === null ? '—' : s}</div>
        <div class="myperf-hbar${s === null ? ' empty' : ' ' + (_myPerfTone(s) || 'b')}${now ? ' now' : ''}"
             style="height:${s === null ? 4 : Math.max(6, (s / hmax) * 100)}%"></div>
        <div class="myperf-hm${now ? ' now' : ''}">${esc(_myPerfMonthLabel(h.periode))}</div>
      </div>`;
  }).join('');

  // Faits marquants : deux chiffres qui se déduisent de l'historique et
  // du détail, et qu'on ne veut pas faire calculer de tête à l'agent.
  const rated   = hist.filter(h => h.score !== null);
  const best    = rated.length ? Math.max(...rated.map(h => h.score)) : null;
  const avg     = rated.length
    ? Math.round(rated.reduce((s, h) => s + h.score, 0) / rated.length) : null;

  // ── Points d'attention ──────────────────────────────────────
  // Les trois critères notés les plus bas, sous 70. Au-dessus, il n'y a
  // rien à corriger : afficher un « conseil » y serait du bruit.
  const tips = noted.filter(c => c.valeur < 70)
    .sort((a, b) => a.valeur - b.valeur)
    .slice(0, 3);

  // Trois cas distincts : rien de noté, tout au-dessus de la cible, ou une
  // liste. Les confondre ferait dire « rien à corriger » à une page vide.
  const tipsHtml = !noted.length
    ? `<div class="myperf-tip-d">Nothing is rated over this period yet — there is
       nothing to work from until your manager records the assessment.</div>`
    : tips.length
    ? tips.map((c, i) => `
        <div class="myperf-tip">
          <div class="myperf-tip-i">${i + 1}</div>
          <div>
            <div class="myperf-tip-t">${esc(c.def.label)} — ${c.valeur}/100</div>
            <div class="myperf-tip-d">Weighs ${c.weight}% of the score. ${esc(c.def.hint || '')}</div>
          </div>
        </div>`).join('')
    : `<div class="myperf-tip-d">No criterion is under target over this period.</div>`;

  r.innerHTML = `
    <div class="myperf-res">

      <!-- Identité, période, état de la notation, et la sortie tout à droite -->
      <div class="myperf-idbar">
        <div class="myperf-av">${esc((d.fo || '?').trim().slice(0, 2).toUpperCase())}</div>
        <div class="myperf-idtxt">
          <div class="myperf-who">${esc(d.fo)}</div>
          <div class="myperf-period">Period · ${esc(mois)}</div>
        </div>
        <div class="myperf-idbar-sp"></div>
        <span class="myperf-pill ${d.evalue ? 'live' : 'draft'}">
          ${d.neutre ? 'Not scored this month' : d.evalue ? 'Rated' : 'Not rated yet'}
        </span>
        <button class="btn btn-ghost btn-sm" onclick="myPerfLogout()">Close session</button>
      </div>

      ${_myPerfLateBanner(d.objectifs)}

      <!-- Le score, et ce qu'il vaut -->
      <div class="myperf-hero ${lv}">
        <div class="myperf-ring ${lv}">
          <svg viewBox="0 0 172 172" aria-hidden="true">
            <circle class="myperf-ring-track" cx="86" cy="86" r="76"/>
            <circle class="myperf-ring-val" cx="86" cy="86" r="76"
                    stroke-dasharray="${C.toFixed(1)}"
                    stroke-dashoffset="${(C - dash).toFixed(1)}"/>
          </svg>
          <div class="myperf-ring-mid">
            <div class="myperf-score${score === null ? ' na' : ''}">
              ${score === null ? 'Not rated' : score + '<span>/100</span>'}
            </div>
            ${score === null ? '' : `<div class="myperf-score-cap">Overall score</div>`}
          </div>
        </div>

        <div class="myperf-heroside">
          <div class="myperf-level">${esc(d.niveau)}</div>
          <div class="myperf-level-d">${esc(_MYPERF_NIVEAU_D[d.rang || 0] || '')}</div>

          <div class="myperf-gauge">${steps}</div>
          <div class="myperf-steplabels">${stepLabels}</div>

          <div class="myperf-herokpis">
            <div><b>${delta === null ? '—' : (delta > 0 ? '+' : '') + delta}</b><span>vs last month</span></div>
            <div><b>${avg === null ? '—' : avg}</b><span>6-month average</span></div>
            <div><b>${best === null ? '—' : best}</b><span>Best month</span></div>
          </div>
          ${t.txt ? `<div class="myperf-trend ${t.cls}">
            ${t.ico} ${t.txt} compared with the previous month${deltaTxt}
          </div>` : ''}
        </div>
      </div>

      ${d.neutre ? `<div class="myperf-note">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
        <div>This month is set as neutral by your manager: there is no score for it,
        and it does not count in your history.</div>
      </div>` : !d.evalue ? `<div class="myperf-note">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
        <div>The current month is not scored yet — everything shown here is your
        last completed assessment.</div>
      </div>` : ''}

      <!-- Objectifs personnels, juste sous la note : c'est ce que l'agent
           vient chercher et fait avancer. Chargés séparément, d'où le
           conteneur vide rempli par renderMyObjectives(). -->
      <div id="myobj-host"></div>

      ${_myPerfTasks(d.taches)}

      <div class="myperf-grid">
        <div class="myperf-col">

          <!-- Détail par critère : ce qui compose la note -->
          <div class="myperf-sec">
            <div class="myperf-sec-h">
              <div class="myperf-sec-t">What makes up your score</div>
              <div class="myperf-sec-n">${noted.length}/${crits.length} rated</div>
            </div>
            <div class="myperf-sec-d">
              Each criterion is marked out of 100, then weighted. An unrated
              criterion is left out of the calculation instead of counting as zero.
            </div>
            <!-- Le repli « Criterion by criterion » redoublait la toile
                 juste au-dessus : mêmes six critères, mêmes valeurs, une
                 lecture en barres au lieu d'une lecture en forme. Retiré.
                 La toile reste le détail par critère ; quand elle ne peut
                 pas être tracée (moins de trois critères notés), les
                 barres la remplacent au lieu de la doubler. -->
            ${radarHtml || ''}
            <!-- Les valeurs, critère par critère : la toile montre la forme,
                 la liste donne les chiffres et l'évolution. -->
            <div class="myperf-crit${radarHtml ? ' is-compact' : ''}">${
              critRows || '<div class="myperf-crit-h">No criterion recorded.</div>'}</div>
          </div>

        </div>

        <div class="myperf-col">

          <!-- Trajectoire sur 6 mois -->
          <div class="myperf-sec">
            <div class="myperf-sec-h">
              <div class="myperf-sec-t">Your last 6 months</div>
            </div>
            <div class="myperf-sec-d">A single score says little; the slope says more.</div>
            <div class="myperf-hist">${histCols}</div>
            <div class="myperf-stats" style="margin-top:16px">
              <div class="myperf-stat">
                <div class="myperf-stat-v">${avg === null ? '—' : avg}</div>
                <div class="myperf-stat-l">6-month average</div>
              </div>
              <div class="myperf-stat">
                <div class="myperf-stat-v">${best === null ? '—' : best}</div>
                <div class="myperf-stat-l">Best month recorded</div>
              </div>
            </div>
          </div>

          <!-- Ce que le manager a écrit : juste après le détail de la
               note, parce que c'est ce qui l'explique. -->
          ${_myPerfComments(d.commentaires, crits)}

          <!-- Où sont les points à gagner -->
          <div class="myperf-sec">
            <div class="myperf-sec-h">
              <div class="myperf-sec-t">Where the next points are</div>
            </div>
            <div class="myperf-sec-d">
              Your lowest-rated criteria, heaviest first.
            </div>
            <div class="myperf-tips">${tipsHtml}</div>
          </div>

          <!-- Les engagements pris en entretien : dans la colonne du
               suivi, à côté de la trajectoire, parce qu'ils s'inscrivent
               dans le même temps long que la note. -->
          ${_myPerfActions(d.actions)}

        </div>
      </div>

      <div class="myperf-foot">
        These figures are yours alone — no colleague's score and no ranking is
        shown on this page. Objectives and the qualitative side of the review
        are discussed with your manager during your one-to-one.
      </div>
    </div>`;
}

