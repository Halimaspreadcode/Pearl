// ── QUIZ ─────────────────────────────────────────────────────
let editingQuizQuestionId = null;
let editingQuizId = null;
let _quizActiveTab = 'play';
let _quizPlayingId = null; // id of the quiz currently selected/playing
let _quizManagingId = null; // id of the quiz being edited in Configuration
let _quizSession = null; // { quizId, questions:[...], current:0, score:0, answers:[], timeLeft, timer }
let _quizAwarenessAcked = false;
const QUIZ_TIME_PER_QUESTION = 30; // seconds

function _quizTimerLabel(quiz) {
  const mode = quiz.timer_mode || 'per_question';
  const value = quiz.timer_value || (mode === 'global' ? 10 : QUIZ_TIME_PER_QUESTION);
  return mode === 'global' ? `${value} min total` : `${value}s/question`;
}

function _quizRoundLabel(quiz) {
  const pool = (quiz.questions || []).length;
  const round = quiz.questions_per_round && quiz.questions_per_round > 0 ? Math.min(quiz.questions_per_round, pool) : pool;
  return round < pool ? `${round}/${pool} questions` : `${pool} question${pool>1?'s':''}`;
}

// ── Gamification ─────────────────────────────────────────────
// Le niveau d'un cours est sa difficulté, choisie par le manager en
// Configuration. Elle sert à trois choses : ordonner le parcours,
// doser la récompense, et fixer ce qu'il faut avoir réussi avant.
// Six paliers : c'est le découpage du cursus déjà en place côté
// données (bank-l1 à bank-l6), pas un choix arbitraire.
const QZ_LEVELS = [
  { n: 1, label: 'Fundamentals',  xp: 10, c: 'var(--g-green)',  cc: 'var(--g-green-c)'  },
  { n: 2, label: 'Beginner',      xp: 20, c: 'var(--g-blue)',   cc: 'var(--g-blue-c)'   },
  { n: 3, label: 'Intermediate', xp: 30, c: 'var(--g-purple)', cc: 'var(--g-purple-c)' },
  { n: 4, label: 'Advanced',      xp: 45, c: 'var(--g-gold)',   cc: 'var(--g-gold-c)'   },
  { n: 5, label: 'Expert',        xp: 60, c: 'var(--g-fire)',   cc: 'var(--g-fire-c)'   },
  { n: 6, label: 'Expert',        xp: 80, c: 'var(--g-red)',    cc: 'var(--g-red-c)'    },
];
const QZ_LEVEL_MAX = QZ_LEVELS.length;

// Les quiz créés avant l'ajout du champ n'ont pas de `level` : on les
// range en niveau 1 plutôt que de les exclure du parcours.
function _quizLevel(quiz) {
  const n = Number(quiz?.level);
  const i = Math.min(QZ_LEVEL_MAX, Math.max(1, Number.isFinite(n) && n ? Math.round(n) : 1));
  return QZ_LEVELS[i - 1];
}

// Le seuil de réussite. Les quiz du cursus le portent sous le nom
// `pass_mark` ; les quiz créés depuis Configuration sous
// `pass_threshold`. Ignorer le premier ferait passer un quiz à 60 %
// alors que sa fiche annonce 80 %.
function _quizThreshold(quiz) {
  const v = quiz?.pass_threshold ?? quiz?.pass_mark;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 60;
}

// Un cours vaut la récompense de son niveau ; l'admin peut la forcer
// via `xp_reward` quand un cours mérite plus que sa difficulté.
function _quizXp(quiz) {
  const forced = Number(quiz?.xp_reward);
  return Number.isFinite(forced) && forced > 0 ? Math.round(forced) : _quizLevel(quiz).xp;
}

// Meilleur score personnel, en pourcentage. `null` si jamais tenté :
// « jamais fait » et « fait, 0 % » ne se racontent pas pareil.
function _quizBest(quiz, user) {
  const me = user || currentUser?.name || 'Unknown';
  const mine = (state.quizResults || []).filter(r => r.quiz_id === quiz.id && r.user === me);
  if (!mine.length) return null;
  return Math.max(...mine.map(r => (r.total ? Math.round(r.score / r.total * 100) : 0)));
}

function _quizPassed(quiz, user) {
  const best = _quizBest(quiz, user);
  return best !== null && best >= _quizThreshold(quiz);
}

// Ordre du parcours : par niveau, puis par module, puis par date de
// création. Un ordre stable est indispensable : le déverrouillage
// dépend du rang.
// Le module passe avant la date parce que les 30 quiz de la banque
// portent tous la même `created_at` : sans lui, l'ordre à l'intérieur
// d'un palier retombait sur l'alphabet et le socle — le parcours
// principal — ne se présentait pas en premier.
function _quizPathOrder() {
  // Un quiz dépublié sort du parcours : il ne compte ni dans les cours
  // à faire, ni dans le déverrouillage des paliers suivants.
  return (state.quizzes || []).filter(q => q.published !== false).sort((a, b) =>
    _quizLevel(a).n - _quizLevel(b).n ||
    _quizModuleRank(a) - _quizModuleRank(b) ||
    String(a.created_at || '').localeCompare(String(b.created_at || '')) ||
    String(a.name || '').localeCompare(String(b.name || '')));
}

// Palier verrouillé tant que le précédent n'est pas réussi. On ne
// verrouille qu'entre niveaux différents : à l'intérieur d'un même
// palier, l'ordre des cours est arbitraire et bloquer serait injuste.
// Un palier dont aucun cours n'a de question reste ouvert, sinon un
// cours vide en amont bloquerait tout le parcours.
function _quizPathState() {
  const ordered = _quizPathOrder();
  const byTier = new Map();
  ordered.forEach(qz => {
    const n = _quizLevel(qz).n;
    if (!byTier.has(n)) byTier.set(n, []);
    byTier.get(n).push(qz);
  });

  const tiers = [...byTier.keys()].sort((a, b) => a - b);
  const locked = new Set();
  let blocked = false;
  tiers.forEach(n => {
    const list = byTier.get(n);
    if (blocked) list.forEach(qz => locked.add(qz.id));
    // Le palier suivant s'ouvre quand tout ce qui est jouable ici
    // est réussi.
    const playable = list.filter(qz => (qz.questions || []).length);
    if (!blocked && playable.length && !playable.every(qz => _quizPassed(qz))) blocked = true;
  });

  // Le « cours du jour » : le premier ouvert et non réussi.
  const current = ordered.find(qz =>
    !locked.has(qz.id) && (qz.questions || []).length && !_quizPassed(qz)) || null;

  return { ordered, tiers, byTier, locked, currentId: current?.id || null };
}

// XP total : la somme des cours réussis. On ne cumule pas par
// tentative, sinon repasser un quiz déjà acquis ferait monter le
// score sans rien apprendre.
// La progression enregistrée de la personne, telle que le serveur l'a
// figée à chaque tentative (data/quiz_progress.json).
function _quizProgressEntry(user) {
  const me = user || currentUser?.name || 'Unknown';
  return (state.quizProgress || []).find(e => e && e.user === me) || null;
}

// XP total. On lit d'abord le total enregistré : il est figé au barème
// du jour de chaque réussite, donc changer le niveau d'un cours ne
// réécrit pas rétroactivement le score de tout le monde. Le calcul
// local ne sert que de repli, le temps que le serveur réponde.
function _quizXpTotal() {
  const saved = _quizProgressEntry();
  if (saved && Number.isFinite(Number(saved.xp_total))) return Number(saved.xp_total);
  return _quizPathOrder().reduce((s, qz) => s + (_quizPassed(qz) ? _quizXp(qz) : 0), 0);
}

// Niveau de l'apprenant : un palier tous les 100 XP. Simple à
// comprendre de tête, ce qui est tout l'intérêt.
const QZ_XP_PER_LEVEL = 100;
function _quizUserLevel() {
  const xp = _quizXpTotal();
  const level = Math.floor(xp / QZ_XP_PER_LEVEL) + 1;
  const into = xp % QZ_XP_PER_LEVEL;
  return { xp, level, into, need: QZ_XP_PER_LEVEL - into, pct: Math.round(into / QZ_XP_PER_LEVEL * 100) };
}

// Record de série. Celui-là ne peut qu'être lu : une série cassée ne
// laisse aucune trace dans l'historique des tentatives.
function _quizStreakBest() {
  return Number(_quizProgressEntry()?.streak_best) || 0;
}

// Série de jours consécutifs avec au moins une tentative, en partant
// d'aujourd'hui. Une tentative hier mais rien aujourd'hui garde la
// série vivante : la casser avant la fin de la journée serait faux.
function _quizStreak() {
  const me = currentUser?.name || 'Unknown';
  // La série enregistrée fait foi : c'est elle qui a suivi les jours
  // au fil de l'eau. Mais elle ne « périme » pas toute seule dans le
  // fichier — si la dernière activité est plus vieille qu'hier, la
  // série est morte même si le fichier affiche encore son compte.
  const saved = _quizProgressEntry(me);
  if (saved && saved.last_activity) {
    const at = k => Date.parse(`${k}T12:00:00Z`);
    const todayKey = new Date().toISOString().slice(0, 10);
    const gap = Math.round((at(todayKey) - at(saved.last_activity)) / 864e5);
    return gap <= 1 ? Number(saved.streak_current) || 0 : 0;
  }

  const days = new Set((state.quizResults || [])
    .filter(r => r.user === me && r.created_at)
    .map(r => String(r.created_at).slice(0, 10)));
  if (!days.size) return 0;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const key = d => new Date(d).toISOString().slice(0, 10);
  const cursor = new Date(today);
  if (!days.has(key(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!days.has(key(cursor))) return 0;
  }
  let n = 0;
  while (days.has(key(cursor))) { n++; cursor.setDate(cursor.getDate() - 1); }
  return n;
}

function ackQuizAwareness() {
  _quizAwarenessAcked = true;
  renderQuizPlay();
}

function switchQuizTab(tab) {
  _quizActiveTab = tab;
  document.querySelectorAll('[data-quiz-tab]').forEach(el => el.classList.toggle('active', el.dataset.quizTab === tab));
  document.querySelectorAll('.quiz-tab-content').forEach(el => el.style.display = 'none');
  const el = document.getElementById(`quiz-tab-${tab}`);
  if (el) el.style.display = '';
  // La recherche ne filtre que la liste des quiz : l'afficher au-dessus
  // des résultats promettrait un filtrage qui n'existe pas.
  const search = document.querySelector('#page-quiz .qz-search');
  if (search) search.style.display = tab === 'play' ? '' : 'none';
  renderQuiz();
}

function renderQuiz() {
  if (_quizActiveTab === 'play') renderQuizPlay();
  if (_quizActiveTab === 'history') renderQuizHistory();
}

// - Take Quiz -
function _closeQuizFullscreen() {
  document.getElementById('quiz-fullscreen').style.display = 'none';
}

function _openQuizFullscreen(html) {
  document.getElementById('quiz-fullscreen-content').innerHTML = html;
  document.getElementById('quiz-fullscreen').style.display = 'block';
}

// Icônes du lecteur. Regroupées ici pour que les vues restent
// lisibles et que le jeu d'icônes soit cohérent d'un écran à l'autre.
const QZ_ICO = {
  check: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
  cross: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m1 10.59 4.24 2.45-.75 1.3L11.5 13V7h1.5z"/></svg>',
  book: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2M8 5h8v2H8zm0 4h8v2H8zm0 4h5v2H8z"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>',
  // Jeu d'icônes du parcours. Elles portent l'état d'un cours à elles
  // seules (cadenas, étoile, coche), donc sans lire le texte.
  lock:  '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M18 8h-1V6a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2M9 6a3 3 0 0 1 6 0v2H9zm3 12a2 2 0 1 1 0-4 2 2 0 0 1 0 4"/></svg>',
  star:  '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="m12 17.27 6.18 3.73-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>',
  star14:'<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="m12 17.27 6.18 3.73-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>',
  done:  '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path fill="currentColor" d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
  fire:  '<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path fill="currentColor" d="M13.5 1S15 4 15 6.5a3 3 0 0 1-6 .1C9 4 10.5 1 10.5 1S9 2.5 7.5 4.5 5 9 5 11a7 7 0 0 0 14 0c0-2.5-2-5-3-6.5S13.5 1 13.5 1"/></svg>',
  gem:   '<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path fill="currentColor" d="M7 2h10l4 6-9 14L3 8zm1.5 2L6 7.5h12L15.5 4z"/></svg>',
  crown: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M3 18h18l1-11-6 4-4-7-4 7-6-4z"/></svg>',
  shield:'<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path fill="currentColor" d="M12 1 3 5v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V5z"/></svg>',
};

// ── Géométrie du serpentin ───────────────────────────────────
// Tous les ronds vivent dans une même voie à gauche du texte ; c'est
// leur décalage *à l'intérieur* de cette voie qui fait onduler le
// tracé. Faire passer les ronds d'un bord à l'autre du parcours
// obligerait les courbes à traverser le texte, ce qui le barre.
// Ces valeurs doivent rester d'accord avec le CSS (`--g-lane`,
// `.g-orb`), sinon la courbe ne tombe pas sur le centre des ronds.
const GX_LANE = 132, GX_ORB = 60;
const GX_ROW = 98; // hauteur d'une rangée : pas du tracé vertical
// Les positions du cycle, en centre de rond. L'amplitude reste faible
// et sans retour en arrière : le tracé glisse d'un bord à l'autre en
// quatre pas au lieu de faire des S serrés, qui donnaient au chemin
// l'allure d'un ressort plutôt que d'une pente.
const GX_SEATS = [42, 62, 82, 62];

function _gxCenter(step) { return GX_SEATS[step % GX_SEATS.length]; }

// La liaison, en deux segments qui se rejoignent aux frontières de
// rangée : `lead` monte du rond vers le haut de la rangée (où
// l'attend le segment du maillon précédent), `tail` descend du rond
// vers le bas. Découper ainsi est ce qui permet au tracé de rester
// continu alors que les rangées n'ont pas la même hauteur.
// Le viewBox est étiré verticalement par le CSS ; on raisonne donc
// en unités de 0 (haut de rangée) à 100 (bas), le rond étant à 50.
// `hasLead` / `hasTail` disent si le maillon a un voisin *dans le même
// palier*. Un chapitre est une unité : relier son dernier cours au
// premier du chapitre suivant ferait passer le tracé derrière le titre
// de palier et suggérerait une continuité qui n'existe pas — chaque
// palier se termine, puis un autre commence.
function _quizLinkSvg(step, nextStep, hasLead, hasTail) {
  const x = _gxCenter(step);
  const xNext = _gxCenter(nextStep);
  // Les deux demi-segments se rejoignent sur la frontière de rangée, et
  // doivent donc y arriver à la même abscisse. Le `tail` de la rangée
  // précédente s'est déjà déplacé jusqu'ici : il finit à l'aplomb de
  // *ce* rond, pas de celui d'avant. Le `lead` repart donc de `x`, et
  // toute l'inflexion se joue dans le `tail`. Faire partir le `lead` de
  // l'abscisse précédente rejouait le décalage une seconde fois : les
  // deux moitiés ne se touchaient plus et le tracé apparaissait coupé.
  const lead = `M ${x} 0 L ${x} 50`;
  const tail = `M ${x} 50 C ${x} 84, ${xNext} 66, ${xNext} 100`;
  return `<svg class="g-link" viewBox="0 0 ${GX_LANE} 100"
               preserveAspectRatio="none" aria-hidden="true">
      ${hasLead ? `<path class="lead" d="${lead}"/>` : ''}
      ${hasTail ? `<path class="tail" d="${tail}"/>` : ''}
    </svg>`;
}

// Bandeau de statut. Ce qu'on y met est ce qui se gagne en jouant
// (série, XP, niveau, cours acquis) et rien d'autre : c'est le
// tableau de bord de la personne, pas celui de la formation.
function _quizGamifyHeader(path) {
  const u = _quizUserLevel();
  const streak = _quizStreak();
  const best = _quizStreakBest();
  const playable = path.ordered.filter(qz => (qz.questions || []).length);
  const done = playable.filter(qz => _quizPassed(qz)).length;

  const stat = (ico, c, cc, v, k) => `
    <div class="g-stat">
      <span class="g-stat-ico" style="background:${cc};color:${c}">${ico}</span>
      <span><span class="g-stat-v">${esc(String(v))}</span><span class="g-stat-k">${esc(k)}</span></span>
    </div>`;

  return `<div class="g-bar">
    ${stat(QZ_ICO.fire,
        streak ? 'var(--g-fire)' : 'var(--g-lock)',
        streak ? 'var(--g-fire-c)' : 'var(--g-lock-c)',
        streak,
        // Le record n'apparaît que s'il dit quelque chose de plus que
        // la série en cours : sinon c'est deux fois le même chiffre.
        best > streak
          ? `day${streak > 1 ? 's' : ''} streak · best ${best}`
          : (streak === 1 ? 'day streak' : 'day streak'))}
    ${stat(QZ_ICO.gem, 'var(--g-blue)', 'var(--g-blue-c)', u.xp, 'XP earned')}
    ${stat(QZ_ICO.shield, 'var(--g-green)', 'var(--g-green-c)', `${done}/${playable.length}`, 'courses passed')}

    <div class="g-stat g-stat-wide">
      <span class="g-stat-ico" style="background:var(--g-gold-c);color:var(--g-gold-sh)">${QZ_ICO.star14}</span>
      <span class="g-stat-grow">
        <span class="g-stat-v">Level ${u.level}</span>
        <span class="g-xpbar"><i style="width:${u.pct}%"></i></span>
        <span class="g-stat-hint">${u.need} XP to level ${u.level + 1}</span>
      </span>
    </div>
  </div>`;
}

// Le parcours : un palier par niveau de difficulté, un maillon par
// cours. Chaque maillon dit trois choses : où j'en suis, ce que ça
// rapporte, et ce qui reste à faire pour l'ouvrir.
// Le tracé serpente à l'intérieur de chaque palier et s'interrompt à
// sa frontière : un chapitre est une unité qui se termine.
function _quizPathHtml(path, shown, filtering) {
  // Anneau de maîtrise : le viewBox doit coller à la boîte CSS de
  // l'anneau (orbe 60px + inset 6px de chaque côté = 72), sinon le
  // cercle est rogné et il n'en reste qu'un arc parasite.
  const RING_BOX = 72, R = 33, C = 2 * Math.PI * R;
  const html = [];
  // Le cycle de positions court sur tout le parcours, pas par palier :
  // sinon le serpentin repartirait du même point à chaque titre.
  let seat = 0;

  path.tiers.forEach(n => {
    const list = path.byTier.get(n);
    // Sous recherche, un palier dont aucun cours ne correspond n'a
    // rien à montrer : son titre seul serait du bruit.
    const kept = list.filter(qz => shown.has(qz.id));
    if (filtering && !kept.length) return;

    const lv = QZ_LEVELS[n - 1];
    const playable = list.filter(qz => (qz.questions || []).length);
    const passed = playable.filter(qz => _quizPassed(qz)).length;

    html.push(`<div class="g-tier" style="--g-tier:${lv.c};--g-tier-c:${lv.cc}">
      <div class="g-tier-n">${n}</div>
      <div style="min-width:0">
        <div class="g-tier-t">${esc(lv.label)}</div>
        <div class="g-tier-d">${playable.length
          ? `${passed}/${playable.length} courses passed · ${lv.xp} XP per course`
          : 'No playable course at this tier'}</div>
      </div>
      <div class="g-tier-stars" aria-hidden="true">
        ${QZ_LEVELS.map(l =>
          QZ_ICO.star14.replace('<svg', `<svg class="${l.n <= n ? 'on' : ''}"`)).join('')}
      </div>
    </div>`);

    // Le cycle de positions redémarre à chaque palier : le tracé d'un
    // chapitre est indépendant de celui du précédent, il doit donc
    // toujours partir du même bord.
    seat = 0;
    const tierList = filtering ? kept : list;
    tierList.forEach((qz, idxInTier) => {
      const lvq = _quizLevel(qz);
      const qCount = (qz.questions || []).length;
      const threshold = _quizThreshold(qz);
      const best = _quizBest(qz);
      const passedQz = _quizPassed(qz);
      const locked = path.locked.has(qz.id);
      const attemptsLeft = _quizAttemptsLeft(qz);
      const exhausted = attemptsLeft !== null && attemptsLeft <= 0;
      const isCurrent = qz.id === path.currentId;
      const xp = _quizXp(qz);

      // Un rond ne peut être cliqué que si le cours est réellement
      // jouable : verrouillé, vide ou épuisé, il ne promet rien.
      const playableNow = qCount && !locked && !exhausted;

      // L'anneau montre la progression vers le seuil, pas le score
      // brut : à 55 % pour un seuil de 60, on veut voir qu'il ne
      // manque presque rien.
      const ringPct = best === null ? 0 : Math.min(100, Math.round(best / threshold * 100));

      const orbIco = locked ? QZ_ICO.lock : passedQz ? QZ_ICO.done : QZ_ICO.star;
      const orbC = locked ? 'var(--m3-surf-2)' : passedQz ? 'var(--g-green)' : lvq.c;

      // Le cours bloquant, nommé : « verrouillé » sans dire par quoi
      // est une impasse pour la personne.
      const blocker = locked
        ? path.ordered.find(o => _quizLevel(o).n < lvq.n
            && (o.questions || []).length && !_quizPassed(o))
        : null;

      const cta = locked
        ? `<div class="g-lockmsg">${QZ_ICO.lock}${blocker
            ? `Pass “${esc(blocker.name)}” to unlock`
            : 'Complete the previous tier to unlock'}</div>`
        : `<div class="g-node-cta">
             <button class="g-btn" style="--g-c:${orbC}"
                     ${playableNow ? '' : 'disabled'} onclick="selectQuiz('${qz.id}')">
               ${playableNow
                 ? `${QZ_ICO.play}${passedQz ? 'Retake' : best !== null ? 'Try again' : 'Start'}`
                 : (exhausted ? 'No attempts left' : 'No question')}
             </button>
           </div>`;

      // Position du rond dans sa voie. Le décalage suit un cycle de
      // quatre positions (proche, milieu, loin, milieu) : c'est ce qui
      // donne une ondulation plutôt qu'un zigzag brutal.
      const step = seat++ % GX_SEATS.length;
      const nextStep = (step + 1) % GX_SEATS.length;
      // Les liaisons ne franchissent pas les bornes du palier.
      const hasLead = idxInTier > 0;
      const hasTail = idxInTier < tierList.length - 1;

      html.push(`<div class="g-node ${passedQz ? 'done' : ''} ${locked ? 'locked' : ''}"
                      style="--g-x:${_gxCenter(step) - GX_ORB / 2}px">
        ${_quizLinkSvg(step, nextStep, hasLead, hasTail)}
        <div class="g-orb-slot">
          <div class="g-orb-wrap">
            ${best !== null && !locked ? `
              <svg class="g-orb-ring" width="${RING_BOX}" height="${RING_BOX}"
                   viewBox="0 0 ${RING_BOX} ${RING_BOX}" aria-hidden="true">
                <circle class="bg" cx="${RING_BOX / 2}" cy="${RING_BOX / 2}" r="${R}"/>
                <circle class="fg" cx="${RING_BOX / 2}" cy="${RING_BOX / 2}" r="${R}"
                  style="stroke-dasharray:${C.toFixed(1)};stroke-dashoffset:${(C * (1 - ringPct / 100)).toFixed(1)}"/>
              </svg>` : ''}
            <button class="g-orb ${locked ? 'locked' : ''} ${isCurrent ? 'current' : ''}"
                    style="--g-c:${orbC}"
                    ${playableNow ? '' : 'disabled'}
                    onclick="selectQuiz('${qz.id}')"
                    aria-label="${esc(qz.name)}${locked ? ' (locked)' : ''}">
              ${isCurrent ? '<span class="g-orb-crown">Up next</span>' : ''}
              ${orbIco}
            </button>
          </div>
        </div>

        <div class="g-node-body">
          <div class="g-node-name">${esc(_quizModuleLabel(qz))}</div>
          ${qz.description ? `<div class="g-node-desc">${esc(qz.description)}</div>` : ''}
          <div class="g-node-chips">
            <span class="g-xp">${QZ_ICO.gem}+${xp} XP</span>
            <span class="qz-chip">${esc(_quizRoundLabel(qz))}</span>
            <span class="qz-chip">${QZ_ICO.clock}${esc(_quizTimerLabel(qz))}</span>
            <span class="qz-chip">Pass mark ${threshold}%</span>
            ${best !== null
              ? `<span class="qz-chip ${passedQz ? 'ok' : ''}">Meilleur ${best}%</span>`
              : ''}
            ${qz.max_attempts && !locked
              ? `<span class="qz-chip ${exhausted ? 'warn' : ''}">${exhausted
                  ? 'No attempts left'
                  : `${attemptsLeft} tentative${attemptsLeft > 1 ? 's' : ''} restante${attemptsLeft > 1 ? 's' : ''}`}</span>`
              : ''}
          </div>
          ${cta}
        </div>
      </div>`);
    });
  });

  // Parcours bouclé : le dire explicitement, sinon la dernière coche
  // verte ressemble à un cours de plus.
  const playableAll = path.ordered.filter(qz => (qz.questions || []).length);
  if (!filtering && playableAll.length && playableAll.every(qz => _quizPassed(qz))) {
    html.push(`<div class="g-crown">
      <div class="g-crown-ico">${QZ_ICO.crown}</div>
      <div>
        <div class="g-crown-t">Path complete · ${_quizXpTotal()} XP</div>
        <div class="g-crown-d">All available courses are completed. Retake one now and then: what is not revised is lost.</div>
      </div>
    </div>`);
  }

  return html.join('');
}

