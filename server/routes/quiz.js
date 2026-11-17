const express     = require('express');
const { v4: uuidv4 } = require('uuid');
const { BANK, mergeWithBank } = require('../quiz/quiz-bank');
const QuizProgress = require('../quiz/quiz-progress');
const { FILES } = require('../config/paths');
const {
  isQuizPublished, readQuizProgress, readQuizPublished, readQuizResults, readQuizzes,
  withFileLock, writeQuizProgress, writeQuizPublished, writeQuizResults, writeQuizzes,
} = require('../core/store');
const { cleanBody } = require('../core/sanitize');

const router = express.Router();

// La banque intégrée est fusionnée à la lecture. Elle vit dans le code
// (server/quiz/quiz-bank.js) et non dans data/ : `npm run migrate` écrase
// data/*.json, une banque rangée là disparaîtrait à la première
// migration.
// Chaque quiz porte son état de publication. Un quiz dépublié reste
// visible en Configuration (pour être republié) mais disparaît du
// parcours des apprenants : `?published=1` sert cet usage.
// Ne pas filtrer côté client seulement — un quiz retiré ne doit pas
// partir dans la réponse, questions et bonnes réponses comprises.
router.get('/api/quizzes', (req, res) => {
  const flags = readQuizPublished();
  const list = mergeWithBank(readQuizzes())
    .map(q => ({ ...q, published: isQuizPublished(q, flags) }));
  res.json(req.query.published === '1' ? list.filter(q => q.published) : list);
});

// Publier / dépublier. Vaut pour la banque comme pour les quiz maison :
// l'état ne touche pas au contenu du quiz, donc `rejectBuiltin` n'a pas
// lieu de s'appliquer ici.
router.put('/api/quizzes/:id/published', (req, res) => {
  withFileLock(FILES.quiz_published, () => {
    const all = mergeWithBank(readQuizzes());
    if (!all.some(q => q.id === req.params.id)) {
      return res.status(404).json({ error: 'Quiz not found' });
    }
    const flags = readQuizPublished();
    const published = req.body.published !== false;
    // On écrit la décision explicitement, dans les deux sens : l'état
    // par défaut dépend du quiz (voir isQuizPublished), donc effacer la
    // clé ne veut plus dire « publié ». Une décision d'exploitation doit
    // survivre à une évolution des valeurs par défaut de la banque.
    flags[req.params.id] = published;
    writeQuizPublished(flags);
    res.json({ id: req.params.id, published });
  }).catch(err => res.status(500).json({ error: err.message }));
});

// Un quiz de la banque ne s'édite pas en place : il n'existe pas dans
// data/quizzes.json, une écriture y créerait un doublon silencieux.
// On répond explicitement plutôt que d'échouer de façon obscure.
function rejectBuiltin(req, res, next) {
  if (BANK.some(q => q.id === req.params.id))
    return res.status(403).json({
      error: 'Built-in bank quiz: not editable. Duplicate it to adapt it.',
    });
  next();
}

router.post('/api/quizzes', (req, res) => {
  withFileLock(FILES.quizzes, () => {
    const quizzes = readQuizzes();
    const entry = {
      id: uuidv4().slice(0, 8),
      created_at: new Date().toISOString(),
      questions: [],
      ...cleanBody(req.body)
    };
    quizzes.push(entry);
    writeQuizzes(quizzes);
    res.status(201).json(entry);
  }).catch(err => res.status(500).json({ error: err.message }));
});

router.put('/api/quizzes/:id', rejectBuiltin, (req, res) => {
  withFileLock(FILES.quizzes, () => {
    const quizzes = readQuizzes();
    const idx = quizzes.findIndex(q => q.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    quizzes[idx] = { ...quizzes[idx], ...cleanBody(req.body), updated_at: new Date().toISOString() };
    writeQuizzes(quizzes);
    res.json(quizzes[idx]);
  }).catch(err => res.status(500).json({ error: err.message }));
});

router.delete('/api/quizzes/:id', rejectBuiltin, (req, res) => {
  withFileLock(FILES.quizzes, () => {
    const quizzes = readQuizzes();
    writeQuizzes(quizzes.filter(q => q.id !== req.params.id));
    res.json({ ok: true });
  }).catch(err => res.status(500).json({ error: err.message }));
});

// - Questions within a quiz -
router.post('/api/quizzes/:id/questions', rejectBuiltin, (req, res) => {
  withFileLock(FILES.quizzes, () => {
    const quizzes = readQuizzes();
    const quiz = quizzes.find(q => q.id === req.params.id);
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
    const question = { id: uuidv4().slice(0, 8), ...cleanBody(req.body) };
    quiz.questions = quiz.questions || [];
    quiz.questions.push(question);
    writeQuizzes(quizzes);
    res.status(201).json(question);
  }).catch(err => res.status(500).json({ error: err.message }));
});

router.put('/api/quizzes/:id/questions/:qid', rejectBuiltin, (req, res) => {
  withFileLock(FILES.quizzes, () => {
    const quizzes = readQuizzes();
    const quiz = quizzes.find(q => q.id === req.params.id);
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
    const idx = (quiz.questions || []).findIndex(q => q.id === req.params.qid);
    if (idx === -1) return res.status(404).json({ error: 'Question not found' });
    quiz.questions[idx] = { ...quiz.questions[idx], ...cleanBody(req.body) };
    writeQuizzes(quizzes);
    res.json(quiz.questions[idx]);
  }).catch(err => res.status(500).json({ error: err.message }));
});

router.delete('/api/quizzes/:id/questions/:qid', rejectBuiltin, (req, res) => {
  withFileLock(FILES.quizzes, () => {
    const quizzes = readQuizzes();
    const quiz = quizzes.find(q => q.id === req.params.id);
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
    quiz.questions = (quiz.questions || []).filter(q => q.id !== req.params.qid);
    writeQuizzes(quizzes);
    res.json({ ok: true });
  }).catch(err => res.status(500).json({ error: err.message }));
});

// Les résultats sont personnels : chacun ne reçoit que les siens. L'admin
// (session admin) voit toute l'équipe — c'est lui qui suit les progrès.
// Consultation seule (verrou d'équipe sans identité) : rien. Sans aucun
// dispositif d'identité (installation ouverte), le serveur ne peut pas
// savoir qui demande : tout part, et l'écran filtre sur le profil local.
router.get('/api/quiz/results', (req, res) => {
  const all = readQuizResults();
  const qui = req.qui;
  if (!qui) return res.json(all);
  if (qui.admin) return res.json(all);
  if (qui.lecture || !qui.name) return res.json([]);
  res.json(all.filter(r => r.user === qui.name));
});

router.post('/api/quiz/results', (req, res) => {
  withFileLock(FILES.quiz_results, () => {
    const results = readQuizResults();
    // La liste fusionnée : un quiz de la banque n'est pas dans data/.
    const quizzes = mergeWithBank(readQuizzes());
    const quiz = quizzes.find(q => q.id === req.body.quiz_id);
    // Un quiz non publié n'accepte pas de tentative : sans ce contrôle,
    // un onglet resté ouvert continuerait d'en enregistrer. On passe par
    // le quiz lui-même, car « non publié » recouvre aussi le brouillon
    // jamais ouvert, pas seulement le quiz retiré après coup.
    if (quiz && !isQuizPublished(quiz)) {
      return res.status(403).json({ error: 'This quiz is no longer published.' });
    }
    if (quiz && quiz.max_attempts) {
      const attempts = results.filter(r => r.quiz_id === quiz.id && r.user === req.body.user).length;
      if (attempts >= quiz.max_attempts) {
        return res.status(403).json({ error: 'Maximum attempts reached for this quiz' });
      }
    }
    const entry = {
      id: uuidv4().slice(0, 8),
      ...cleanBody(req.body),
      created_at: req.body.created_at || new Date().toISOString(),
    };
    results.push(entry);
    writeQuizResults(results);

    // La progression (XP, série, record) se met à jour ici, au moment
    // où la tentative est enregistrée : c'est le seul instant où l'on
    // sait qu'une série est vivante et à quel barème le cours a été
    // validé. Un échec d'écriture ne doit pas perdre la tentative
    // elle-même, déjà écrite : on renvoie la progression telle qu'on a
    // pu la calculer, et on ne casse pas la réponse.
    let progress = null;
    try {
      progress = _bumpQuizProgress(entry);
    } catch (err) {
      console.error('[quiz-progress] mise à jour impossible :', err.message);
    }
    res.status(201).json({ ...entry, progress });
  }).catch(err => res.status(500).json({ error: err.message }));
});

// Applique une tentative à la progression de son auteur et renvoie
// l'entrée à jour. Le quiz est résolu sur la liste fusionnée : un quiz
// de la banque n'existe pas dans data/quizzes.json, et sans la fusion
// il ne rapporterait aucun XP.
function _bumpQuizProgress(attempt) {
  if (!attempt || !attempt.user) return null;
  const quizzes = mergeWithBank(readQuizzes());
  const quiz = quizzes.find(q => q.id === attempt.quiz_id);
  if (!quiz) return null;

  const all = readQuizProgress();
  const idx = all.findIndex(e => e && e.user === attempt.user);
  const updated = QuizProgress.applyAttempt(idx === -1 ? null : all[idx], quiz, attempt);
  if (idx === -1) all.push(updated); else all[idx] = updated;
  writeQuizProgress(all);
  return updated;
}

// ── PROGRESSION DE FORMATION ──────────────────────────────────
// Le fichier est reconstruit à la volée s'il est absent alors que des
// tentatives existent déjà : une installation antérieure à cette
// fonctionnalité retrouve ainsi sa progression sans geste manuel.
router.get('/api/quiz/progress', (req, res) => {
  let all = readQuizProgress();
  if (!all.length) {
    const results = readQuizResults();
    if (results.length) {
      all = QuizProgress.rebuild(results, mergeWithBank(readQuizzes()));
      if (all.length) writeQuizProgress(all);
    }
  }
  const user = req.query.user;
  if (!user) return res.json(all);
  res.json(all.find(e => e && e.user === user) || QuizProgress.emptyEntry(user));
});

// Recalcul explicite depuis l'historique. Utile après un import de
// données ou une correction de barème. Les records de série non
// prouvables par l'historique sont préservés : on ne rétrograde pas un
// acquis parce que la trace a disparu.
router.post('/api/quiz/progress/rebuild', (req, res) => {
  withFileLock(FILES.quiz_progress, () => {
    const previous = readQuizProgress();
    const rebuilt = QuizProgress.rebuild(readQuizResults(), mergeWithBank(readQuizzes()));
    const byUser = new Map(rebuilt.map(e => [e.user, e]));
    previous.forEach(old => {
      if (!old || !old.user) return;
      const next = byUser.get(old.user);
      if (!next) { byUser.set(old.user, old); return; }
      next.streak_best = Math.max(next.streak_best || 0, old.streak_best || 0);
    });
    const all = [...byUser.values()];
    writeQuizProgress(all);
    res.json({ ok: true, users: all.length });
  }).catch(err => res.status(500).json({ error: err.message }));
});

module.exports = router;
