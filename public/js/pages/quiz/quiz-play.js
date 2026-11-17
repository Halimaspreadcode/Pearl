function renderQuizPlay() {
  const el = document.getElementById('quiz-play-area');
  if (!el) return;
  // Le lecteur ne connaît que les quiz publiés : un quiz retiré ne doit
  // ni s'afficher, ni pouvoir être relancé depuis un état resté en
  // mémoire (`_quizPlayingId`).
  const quizzes = (state.quizzes || []).filter(q => q.published !== false);

  if (!quizzes.length) {
    _stopQuizTimer();
    _closeQuizFullscreen();
    el.innerHTML = `<div class="qz-empty">
      <div class="qz-empty-ico">${QZ_ICO.book}</div>
      <div class="qz-empty-t">No quiz yet</div>
      <div class="qz-empty-d">Ask your manager to create one from Configuration → Quiz.</div>
    </div>`;
    return;
  }

  // ── Liste / sélection ──
  if (!_quizSession && !_quizPlayingId) {
    _closeQuizFullscreen();
    const search = (document.getElementById('quiz-search-input')?.value || '').trim().toLowerCase();
    const visible = search
      ? quizzes.filter(qz => (qz.name || '').toLowerCase().includes(search)
                          || (qz.description || '').toLowerCase().includes(search))
      : quizzes;

    if (!visible.length) {
      el.innerHTML = `<div class="qz-empty">
        <div class="qz-empty-ico"><svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14"/></svg></div>
        <div class="qz-empty-t">No quiz matches</div>
        <div class="qz-empty-d">Try another keyword.</div>
      </div>`;
      return;
    }

    // Le parcours est calculé sur l'ensemble des cours, pas sur la
    // sélection : un cours reste verrouillé par ce qui le précède,
    // même quand une recherche masque le cours bloquant.
    const path = _quizPathState();
    const shown = new Set(visible.map(qz => qz.id));
    el.innerHTML = _quizGamifyHeader(path)
      + `<div class="g-path">${_quizPathHtml(path, shown, !!search)}</div>`;
    return;
  }

  const quiz = quizzes.find(qz => qz.id === _quizPlayingId);
  if (!quiz) { _quizPlayingId = null; _quizSession = null; return renderQuizPlay(); }
  const questions = quiz.questions || [];
  const attemptsLeft = _quizAttemptsLeft(quiz);
  const exhausted = attemptsLeft !== null && attemptsLeft <= 0;

  // ── Écrans d'avant-partie ──
  if (!_quizSession) {
    _stopQuizTimer();

    if (!_quizAwarenessAcked) {
      // Le cadrage n'est pas décoratif : un quiz noté fait peur, et la
      // peur fausse le résultat autant que l'ignorance.
      const points = [
        { t: 'This is for you', d: 'This quiz is for your own learning. It is neither a test nor a performance review.',
          i: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10m0 2c-4 0-8 2-8 4.5V21h16v-2.5c0-2.5-4-4.5-8-4.5"/></svg>' },
        { t: 'Au calme', d: 'Find a quiet spot: it is hard to think while being interrupted.',
          i: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 3a7 7 0 0 0-7 7v4l-2 3v1h18v-1l-2-3v-4a7 7 0 0 0-7-7m0 19a2.5 2.5 0 0 0 2.5-2.5h-5A2.5 2.5 0 0 0 12 22"/></svg>' },
        { t: 'No judgement', d: 'Your result is not shared with your manager. Go at your own pace.',
          i: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M18 8h-1V6a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2M9 6a3 3 0 0 1 6 0v2H9z"/></svg>' },
        { t: 'The clock is running', d: 'The timer starts as soon as you begin. Make sure you are ready.',
          i: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m1 10.59 4.24 2.45-.75 1.3L11.5 13V7h1.5z"/></svg>' },
        { t: 'You can try again', d: 'If you are not happy with the score, retake the quiz — within the allowed attempts.',
          i: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8"/></svg>' },
      ];
      _openQuizFullscreen(`
        <div class="qp-card">
          <div class="qp-card-h">
            <div class="qp-card-t">Before you start</div>
            <div class="qp-card-d">A few points to keep in mind</div>
          </div>
          <div class="qp-points">
            ${points.map(p => `
              <div class="qp-point">
                <div class="qp-point-ico">${p.i}</div>
                <div><div class="qp-point-t">${esc(p.t)}</div><div class="qp-point-d">${esc(p.d)}</div></div>
              </div>`).join('')}
          </div>
          <button class="qp-btn" style="width:100%" onclick="ackQuizAwareness()">J'ai compris, continuer</button>
          <div style="margin-top:16px;text-align:center">
            <button class="qp-btn ghost" style="height:36px;font-size:12.5px" onclick="backToQuizList()">Choose another quiz</button>
          </div>
        </div>`);
      return;
    }

    const threshold = _quizThreshold(quiz);
    _openQuizFullscreen(`
      <div class="qp-card" style="text-align:center">
        <div class="qp-card-h">
          <div class="qp-card-t">${esc(quiz.name)}</div>
          ${quiz.description ? `<div class="qp-card-d">${esc(quiz.description)}</div>` : ''}
        </div>
        <div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin-bottom:28px">
          <span class="qz-chip" style="background:${_quizLevel(quiz).c};color:#fff;padding:6px 14px;border-radius:999px;font-size:12px;font-weight:700">Niv. ${_quizLevel(quiz).n} · ${esc(_quizLevel(quiz).label)}</span>
          <span class="qz-chip" style="background:var(--g-gold);color:#3d2f00;padding:6px 14px;border-radius:999px;font-size:12px;font-weight:700">+${_quizXp(quiz)} XP</span>
          <span class="qz-chip" style="background:var(--qz-surf2);color:var(--qz-ink-var);padding:6px 14px;border-radius:999px;font-size:12px;font-weight:600">${esc(_quizRoundLabel(quiz))}</span>
          <span class="qz-chip" style="background:var(--qz-surf2);color:var(--qz-ink-var);padding:6px 14px;border-radius:999px;font-size:12px;font-weight:600">${esc(_quizTimerLabel(quiz))}</span>
          <span class="qz-chip" style="background:var(--qz-surf2);color:var(--qz-ink-var);padding:6px 14px;border-radius:999px;font-size:12px;font-weight:600">Pass mark ${threshold}%</span>
          ${quiz.max_attempts ? `<span class="qz-chip" style="background:var(--qz-surf2);color:var(--qz-ink-var);padding:6px 14px;border-radius:999px;font-size:12px;font-weight:600">${attemptsLeft} tentative${attemptsLeft > 1 ? 's' : ''} restante${attemptsLeft > 1 ? 's' : ''}</span>` : ''}
        </div>
        <button class="qp-btn" ${exhausted ? 'disabled' : ''} onclick="startQuiz()">
          ${exhausted ? 'No attempts left' : `${QZ_ICO.play}Start the quiz`}
        </button>
        <div style="margin-top:16px">
          <button class="qp-btn ghost" style="height:36px;font-size:12.5px" onclick="backToQuizList()">Choose another quiz</button>
        </div>
      </div>`);
    return;
  }

  // ── Récapitulatif ──
  if (_quizSession.current >= _quizSession.questions.length) {
    _stopQuizTimer();
    const { score, total } = _quizSession;
    const attemptsLeftAfter = _quizAttemptsLeft(quiz);
    const canRetry = attemptsLeftAfter === null || attemptsLeftAfter > 0;
    const pct = total ? Math.round((score / total) * 100) : 0;
    const threshold = _quizThreshold(quiz);
    const passed = pct >= threshold;
    const color = passed ? 'var(--qz-ok)' : 'var(--qz-no)';
    const cont = passed ? 'var(--qz-ok-c)' : 'var(--qz-no-c)';
    const R = 58, C = 2 * Math.PI * R;

    // Le détail question par question est ce qui transforme un score
    // en apprentissage : sans lui, on ne sait pas quoi réviser.
    const recap = _quizSession.questions.map((q, i) => {
      const a = _quizSession.answers[i];
      const ok = a === q.correct;
      return `<div class="qp-recap-i">
        <span style="color:${ok ? 'var(--qz-ok)' : 'var(--qz-no)'}">${ok ? QZ_ICO.check : QZ_ICO.cross}</span>
        <span>${esc(q.question)}${!ok ? `<br><span style="color:var(--qz-ink-var);font-size:12px">Correct answer: ${esc(q[`option_${String(q.correct).toLowerCase()}`] || q.correct)}</span>` : ''}</span>
      </div>`;
    }).join('');

    _openQuizFullscreen(`
      <div class="qp-card" style="text-align:center">
        <div style="font-size:11.5px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--qz-ink-var);margin-bottom:18px">${esc(quiz.name)}</div>

        <div class="qp-ring">
          <svg width="132" height="132" viewBox="0 0 132 132" aria-hidden="true">
            <circle class="bg" cx="66" cy="66" r="${R}" stroke-width="9"/>
            <circle class="fg" cx="66" cy="66" r="${R}" stroke-width="9"
              style="stroke:${color};stroke-dasharray:${C.toFixed(1)};stroke-dashoffset:${(C * (1 - pct / 100)).toFixed(1)}"/>
          </svg>
          <div class="qp-ring-in">
            <div class="qp-ring-pct">${pct}%</div>
            <div class="qp-ring-raw">${score} / ${total} pts</div>
          </div>
        </div>

        <div class="qp-verdict" style="background:${cont};color:${color}">
          ${passed ? QZ_ICO.check : QZ_ICO.cross}${passed ? 'Passed' : 'Non atteint'}
        </div>
        <div style="font-size:12.5px;color:var(--qz-ink-var);margin-top:10px">
          Pass mark: ${threshold}%${!passed ? ` — you were ${threshold - pct} percentage points short.` : ''}
        </div>

        <div class="qp-recap">${recap}</div>

        <div style="display:flex;gap:10px;justify-content:center;margin-top:28px;flex-wrap:wrap">
          <button class="qp-btn ghost" onclick="backToQuizList()">Back to the list</button>
          <button class="qp-btn" ${canRetry ? '' : 'disabled'} onclick="startQuiz()">
            ${canRetry ? 'Try again' : 'No attempts left'}
          </button>
        </div>
      </div>`);
    return;
  }

  // ── Question en cours ──
  const q = _quizSession.questions[_quizSession.current];
  if (!_quizSession.optOrder) _quizSession.optOrder = [];
  if (!_quizSession.optOrder[_quizSession.current]) {
    _quizSession.optOrder[_quizSession.current] = ['A', 'B', 'C', 'D']
      .filter(k => q[`option_${k.toLowerCase()}`])
      .sort(() => Math.random() - 0.5);
  }
  const opts = _quizSession.optOrder[_quizSession.current];
  const answered = _quizSession.answers[_quizSession.current];
  const timeLeft = _quizSession.timeLeft;
  const total = _quizSession.questions.length;
  // La barre compte la question courante comme entamée : rester à 0 %
  // sur la première donne l'impression que rien ne se passe.
  const progressPct = Math.round(((_quizSession.current + (answered ? 1 : 0)) / total) * 100);
  const timeDisplay = _quizSession.timerMode === 'global'
    ? `${String(Math.floor(timeLeft / 60)).padStart(2, '0')}:${String(Math.max(0, timeLeft) % 60).padStart(2, '0')}`
    : `${Math.max(0, timeLeft)}s`;
  const timedOut = answered === '_timeout';

  _openQuizFullscreen(`
    <div class="qp-top">
      <div class="qp-eyebrow">
        ${esc(quiz.name)} · Question ${_quizSession.current + 1}/${total}${q.category ? ' · ' + esc(q.category) : ''} · ${q.points || 1} pt${(q.points || 1) > 1 ? 's' : ''}
      </div>
      <button class="qp-exit" onclick="exitQuiz()">Quit</button>
    </div>

    <div class="qp-meter">
      <span class="qp-bar"><i style="width:${progressPct}%"></i></span>
      <span class="qp-time ${timeLeft <= 5 && !answered ? 'urgent' : ''}">${QZ_ICO.clock}${timeDisplay}</span>
    </div>

    <div class="qp-q">${esc(q.question)}</div>

    <div class="qp-opts">
      ${opts.map(k => {
        let cls = '';
        if (answered) {
          if (k === q.correct) cls = 'good';
          else if (k === answered) cls = 'bad';
          else cls = 'dim';
        }
        const mark = cls === 'good' ? QZ_ICO.check : cls === 'bad' ? QZ_ICO.cross : '';
        return `<button class="qp-opt ${cls}" ${answered ? 'disabled' : ''} onclick="answerQuiz('${k}')">
          <span class="qp-key">${k}</span>
          <span>${esc(q[`option_${k.toLowerCase()}`])}</span>
          ${mark ? `<span class="qp-mark">${mark}</span>` : ''}
        </button>`;
      }).join('')}
    </div>

    ${timedOut ? `<div class="qp-expl" style="background:var(--qz-no-c);color:var(--qz-no)"><b>Time is up.</b> The correct answer is highlighted above.</div>` : ''}
    ${answered && q.explanation ? `<div class="qp-expl"><b>Explication :</b> ${esc(q.explanation)}</div>` : ''}

    ${answered ? `
      <div class="qp-next">
        <span class="qp-hint"><kbd>Enter</kbd> to continue</span>
        <button class="qp-btn" onclick="nextQuizQuestion()">
          ${_quizSession.current + 1 < total ? 'Next question' : 'View result'}
        </button>
      </div>` : `
      <div class="qp-next"><span class="qp-hint">Keys <kbd>A</kbd> <kbd>B</kbd> <kbd>C</kbd> <kbd>D</kbd> to answer</span></div>`}

    ${answered && answered === q.correct
      ? `<div class="qp-cheer">${QZ_ICO.check}${esc(_quizEncouragement())}</div>`
      : ''}`);
}

// Clavier : répondre par A–D, avancer par Entrée. Un quiz se joue plus
// vite au clavier qu'à la souris, et l'aide est affichée sous la
// question pour que le raccourci se découvre tout seul.
document.addEventListener('keydown', e => {
  const fs = document.getElementById('quiz-fullscreen');
  if (!fs || fs.style.display === 'none' || !_quizSession) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (_quizSession.current >= _quizSession.questions.length) return;

  const answered = _quizSession.answers[_quizSession.current];
  if (!answered) {
    const k = e.key.toUpperCase();
    if (['A', 'B', 'C', 'D'].includes(k)) {
      const q = _quizSession.questions[_quizSession.current];
      if (q[`option_${k.toLowerCase()}`]) { e.preventDefault(); answerQuiz(k); }
    }
    return;
  }
  if (e.key === 'Enter') { e.preventDefault(); nextQuizQuestion(); }
});

function _quizAttemptsLeft(quiz) {
  if (!quiz.max_attempts) return null;
  const used = (state.quizResults || []).filter(r => r.quiz_id === quiz.id && r.user === (currentUser?.name || 'Unknown')).length;
  return Math.max(0, quiz.max_attempts - used);
}

function selectQuiz(id) {
  _quizPlayingId = id;
  _quizSession = null;
  renderQuizPlay();
}

function backToQuizList() {
  _stopQuizTimer();
  _quizPlayingId = null;
  _quizSession = null;
  _quizAwarenessAcked = false;
  renderQuizPlay();
}

function _quizEncouragement() {
  const messages = [
    'Correct! Well done',
    'Nice one! Keep it up',
    'Great job!',
    'Spot on!',
    'Excellent! Keep going',
    'You got it!',
  ];
  return messages[Math.floor(Math.random() * messages.length)];
}

function exitQuiz() {
  if (_quizSession && _quizSession.current < _quizSession.questions.length) {
    if (!confirm('Quit this quiz? Your progress will be lost.')) return;
  }
  backToQuizList();
}

function _stopQuizTimer() {
  if (_quizSession?.timer) { clearInterval(_quizSession.timer); _quizSession.timer = null; }
}

function _startQuizTimer() {
  _stopQuizTimer();
  _quizSession.timer = setInterval(() => {
    if (!_quizSession) return;
    _quizSession.timeLeft--;
    if (_quizSession.timeLeft <= 0) {
      _stopQuizTimer();
      if (_quizSession.timerMode === 'global') {
        // global time is up - mark current question timed out and jump straight to results
        if (!_quizSession.answers[_quizSession.current]) {
          _quizSession.answers[_quizSession.current] = '_timeout';
        }
        _quizSession.current = _quizSession.questions.length;
        finishQuiz();
        return;
      }
      if (!_quizSession.answers[_quizSession.current]) {
        _quizSession.answers[_quizSession.current] = '_timeout';
      }
    }
    renderQuizPlay();
  }, 1000);
}

function startQuiz() {
  const quiz = (state.quizzes || []).find(qz => qz.id === _quizPlayingId);
  if (!quiz) return;
  const pool = [...(quiz.questions || [])].sort(() => Math.random() - 0.5);
  const roundSize = quiz.questions_per_round && quiz.questions_per_round > 0 ? quiz.questions_per_round : pool.length;
  const questions = pool.slice(0, roundSize);
  const totalPoints = questions.reduce((s,q) => s + (q.points || 1), 0);
  const timerMode = quiz.timer_mode || 'per_question';
  const timerValue = quiz.timer_value || (timerMode === 'global' ? 10 : QUIZ_TIME_PER_QUESTION);
  const timeLeft = timerMode === 'global' ? timerValue * 60 : timerValue;
  _quizSession = {
    quizId: quiz.id, questions, current: 0, score: 0, total: totalPoints, answers: [],
    timerMode, timePerQuestion: timerValue, timeLeft, timer: null,
  };
  _startQuizTimer();
  renderQuizPlay();
}

function answerQuiz(choice) {
  if (!_quizSession) return;
  if (_quizSession.answers[_quizSession.current]) return; // already answered - block double-click
  _stopQuizTimer();
  const q = _quizSession.questions[_quizSession.current];
  _quizSession.answers[_quizSession.current] = choice;
  if (choice === q.correct) _quizSession.score += (q.points || 1);
  renderQuizPlay();
}

async function finishQuiz() {
  _stopQuizTimer();
  try {
    const quiz = (state.quizzes || []).find(qz => qz.id === _quizSession.quizId);
    const answerLog = _quizSession.questions.map((q, i) => ({
      question_id: q.id,
      question: q.question,
      category: q.category || null,
      correct: _quizSession.answers[i] === q.correct,
    }));
    await fetch(`${API}/api/quiz/results`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        quiz_id: _quizSession.quizId,
        quiz_name: quiz?.name || 'Unknown',
        user: currentUser?.name || 'Unknown',
        score: _quizSession.score,
        total: _quizSession.total,
        answer_log: answerLog,
        created_at: new Date().toISOString(),
      })
    });
    await loadAll();
  } catch (e) {}
  renderQuizPlay();
}

async function nextQuizQuestion() {
  if (!_quizSession) return;
  _stopQuizTimer();
  _quizSession.current++;
  if (_quizSession.current >= _quizSession.questions.length) {
    await finishQuiz();
  } else {
    if (_quizSession.timerMode === 'global') {
      _startQuizTimer(); // keep counting down on the shared clock
    } else {
      _quizSession.timeLeft = _quizSession.timePerQuestion;
      _startQuizTimer();
    }
    renderQuizPlay();
  }
}

