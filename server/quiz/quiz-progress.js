/**
 * PROGRESSION DE FORMATION — XP, niveau, séries.
 *
 * Pourquoi stocker, alors que tout serait déductible de quiz_results :
 * deux informations ne se reconstituent pas après coup.
 *
 *   1. Le record de série. Une fois une série cassée, l'historique des
 *      tentatives ne dit plus qu'elle a existé : il faut l'avoir noté
 *      au moment où elle vivait.
 *   2. Les XP réellement gagnés. Ils sont figés au barème du jour de
 *      la réussite. Si un manager change le niveau d'un cours ou son
 *      `xp_reward`, un total recalculé changerait rétroactivement le
 *      score de tout le monde — une progression acquise ne doit pas
 *      pouvoir diminuer.
 *
 * Le reste (cours acquis, verrouillage du parcours) reste déduit des
 * résultats : ce sont des états courants, pas des acquis, et les
 * déduire évite toute désynchronisation.
 */

// Barème XP par niveau de difficulté. Doit rester d'accord avec
// QZ_LEVELS côté client (public/js/app.js), qui l'affiche.
const XP_BY_LEVEL = { 1: 10, 2: 20, 3: 30, 4: 45, 5: 60, 6: 80 };
const XP_PER_USER_LEVEL = 100;

function xpForQuiz(quiz) {
  const forced = Number(quiz && quiz.xp_reward);
  if (Number.isFinite(forced) && forced > 0) return Math.round(forced);
  const n = Number(quiz && quiz.level);
  const lvl = Number.isFinite(n) && n ? Math.min(6, Math.max(1, Math.round(n))) : 1;
  return XP_BY_LEVEL[lvl];
}

// Le seuil de réussite vit sous deux noms : `pass_mark` pour les quiz
// de la banque, `pass_threshold` pour ceux créés depuis l'interface.
function thresholdForQuiz(quiz) {
  const v = quiz && (quiz.pass_threshold != null ? quiz.pass_threshold : quiz.pass_mark);
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 60;
}

function pctOf(score, total) {
  return total ? Math.round((Number(score) || 0) / total * 100) : 0;
}

const dayKey = iso => String(iso).slice(0, 10);

// Écart en jours entre deux dates au format AAAA-MM-JJ. On passe par
// UTC midi pour ne pas se faire piéger par les changements d'heure,
// qui rendraient certains écarts égaux à 0 ou 2 au lieu de 1.
function daysBetween(fromKey, toKey) {
  const at = k => Date.parse(`${k}T12:00:00Z`);
  return Math.round((at(toKey) - at(fromKey)) / 864e5);
}

function emptyEntry(user) {
  return {
    user,
    xp_total: 0,
    level: 1,
    streak_current: 0,
    streak_best: 0,
    last_activity: null,
    passed: [],      // ids des cours déjà validés, pour ne payer qu'une fois
    xp_log: [],      // trace de chaque gain : d'où vient le total
    updated_at: null,
  };
}

/**
 * Applique une tentative à la progression et renvoie l'entrée à jour.
 *
 * `entry` peut être absent (première tentative de la personne).
 * `quiz` est le quiz joué, banque ou maison, déjà résolu par l'appelant.
 */
function applyAttempt(entry, quiz, attempt) {
  const e = entry ? { ...entry } : emptyEntry(attempt.user);
  e.passed = Array.isArray(e.passed) ? [...e.passed] : [];
  e.xp_log = Array.isArray(e.xp_log) ? [...e.xp_log] : [];

  const today = dayKey(attempt.created_at);

  // ── Série ──
  // Une tentative le même jour ne rallonge pas la série : c'est un
  // jour de pratique, pas deux. Un trou d'un jour la remet à 1, sans
  // effacer le record.
  if (!e.last_activity) {
    e.streak_current = 1;
  } else {
    const gap = daysBetween(e.last_activity, today);
    if (gap === 1) e.streak_current = (e.streak_current || 0) + 1;
    else if (gap > 1) e.streak_current = 1;
    // gap <= 0 : même jour (ou saisie antidatée) → on ne touche à rien.
  }
  e.streak_best = Math.max(e.streak_best || 0, e.streak_current);
  // On ne recule jamais la dernière activité : une tentative antidatée
  // ne doit pas rouvrir une série déjà close.
  if (!e.last_activity || today > e.last_activity) e.last_activity = today;

  // ── XP ──
  // Payés une seule fois par cours, à la première réussite. Refaire un
  // cours acquis ne rapporte rien : sinon on farme le même quiz.
  const passed = pctOf(attempt.score, attempt.total) >= thresholdForQuiz(quiz);
  if (passed && quiz && !e.passed.includes(quiz.id)) {
    const xp = xpForQuiz(quiz);
    e.passed.push(quiz.id);
    e.xp_total = (e.xp_total || 0) + xp;
    e.xp_log.push({
      quiz_id: quiz.id,
      quiz_name: quiz.name || null,
      xp,
      level: Number(quiz.level) || 1,
      at: attempt.created_at,
    });
  }

  e.level = Math.floor((e.xp_total || 0) / XP_PER_USER_LEVEL) + 1;
  e.updated_at = new Date().toISOString();
  return e;
}

/**
 * Reconstruit la progression de tout le monde depuis l'historique des
 * tentatives. Sert à initialiser le fichier sur une installation qui
 * a déjà des résultats, et à réparer si le fichier est perdu.
 *
 * Les records de série ainsi obtenus sont ceux que l'historique permet
 * de prouver ; une série cassée avant l'existence de ce fichier n'est
 * pas inventée.
 */
function rebuild(results, quizzes) {
  const byId = new Map((quizzes || []).map(q => [q.id, q]));
  const sorted = [...(results || [])]
    .filter(r => r && r.user && r.created_at)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

  const acc = new Map();
  sorted.forEach(r => {
    const quiz = byId.get(r.quiz_id);
    if (!quiz) return; // quiz supprimé : on ne sait plus ce qu'il valait
    acc.set(r.user, applyAttempt(acc.get(r.user), quiz, r));
  });
  return [...acc.values()];
}

module.exports = {
  XP_BY_LEVEL, XP_PER_USER_LEVEL,
  xpForQuiz, thresholdForQuiz, emptyEntry, applyAttempt, rebuild,
};
