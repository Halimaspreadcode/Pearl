// - History -
// Vue d'équipe réservée à l'admin en session ; chacun voit les siens.
// Le serveur ne renvoie déjà que les résultats de la personne : ce filtre
// couvre l'installation sans identité, où il ne peut pas savoir qui lit.
function _quizTeamView() { return typeof AdminSession !== 'undefined' && !!AdminSession.active; }
function _quizMe() { return (typeof currentUser !== 'undefined' && currentUser && currentUser.name) || ''; }

function _quizFilteredResults() {
  let results = [...(state.quizResults || [])].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  if (!_quizTeamView()) results = results.filter(r => r.user === _quizMe());
  const quizFilter = (document.getElementById('quiz-hist-filter-quiz') || {}).value || '';
  const userFilter = (document.getElementById('quiz-hist-filter-user') || {}).value || '';
  const periodFilter = (document.getElementById('quiz-hist-filter-period') || {}).value || 'all';
  if (quizFilter) results = results.filter(r => (r.quiz_name || '') === quizFilter);
  if (userFilter) results = results.filter(r => r.user === userFilter);
  if (periodFilter !== 'all') {
    const now = new Date();
    let from;
    if (periodFilter === 'today') {
      from = new Date(now); from.setHours(0,0,0,0);
    } else if (periodFilter === 'week') {
      from = new Date(now); from.setHours(0,0,0,0);
      from.setDate(from.getDate() - (from.getDay()===0?6:from.getDay()-1));
    } else if (periodFilter === 'month') {
      from = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    results = results.filter(r => new Date(r.created_at) >= from);
  }
  return results;
}

function _quizStats(results) {
  const n = results.length;
  if (!n) return null;
  const pctOf = r => r.total ? (r.score / r.total) * 100 : 0;
  const avgPct = results.reduce((s,r) => s + pctOf(r), 0) / n;
  const byQuiz = {}, byUser = {};
  results.forEach(r => {
    const qn = r.quiz_name || 'Unknown';
    const un = r.user || 'Unknown';
    (byQuiz[qn] ||= []).push(r);
    (byUser[un] ||= []).push(r);
  });
  const passRateFor = (quiz, list) => {
    const threshold = _quizThreshold(quiz);
    return Math.round((list.filter(r => pctOf(r) >= threshold).length / list.length) * 100);
  };
  const quizzesByName = Object.fromEntries((state.quizzes || []).map(q => [q.name, q]));
  const overallThreshold = 60;
  const passRate = Math.round((results.filter(r => pctOf(r) >= (quizzesByName[r.quiz_name] ? _quizThreshold(quizzesByName[r.quiz_name]) : overallThreshold)).length / n) * 100);

  // - Error trends: hardest questions / categories, weakest quizzes -
  const byQuestion = {}, byCategory = {};
  results.forEach(r => {
    (r.answer_log || []).forEach(a => {
      const qKey = a.question_id || a.question;
      if (qKey) {
        const slot = (byQuestion[qKey] ||= { question: a.question || qKey, total: 0, wrong: 0 });
        slot.total++;
        if (!a.correct) slot.wrong++;
      }
      if (a.category) {
        const slot = (byCategory[a.category] ||= { total: 0, wrong: 0 });
        slot.total++;
        if (!a.correct) slot.wrong++;
      }
    });
  });
  const hardestQuestions = Object.values(byQuestion)
    .map(q => ({ ...q, failRate: Math.round((q.wrong / q.total) * 100) }))
    .filter(q => q.total >= 2)
    .sort((a,b) => b.failRate - a.failRate || b.wrong - a.wrong)
    .slice(0, 5);
  const hardestCategories = Object.entries(byCategory)
    .map(([name, c]) => ({ name, ...c, failRate: Math.round((c.wrong / c.total) * 100) }))
    .sort((a,b) => b.failRate - a.failRate)
    .slice(0, 5);
  const weakestQuizzes = Object.entries(byQuiz)
    .map(([name, list]) => ({
      name, attempts: list.length,
      avgPct: Math.round(list.reduce((s,r) => s + pctOf(r), 0) / list.length),
      passRate: passRateFor(quizzesByName[name], list),
    }))
    .sort((a,b) => a.avgPct - b.avgPct)
    .slice(0, 5);

  return {
    attempts: n,
    avgPct: Math.round(avgPct),
    passRate,
    byQuiz: Object.entries(byQuiz).map(([name, list]) => ({
      name, attempts: list.length,
      avgPct: Math.round(list.reduce((s,r) => s + pctOf(r), 0) / list.length),
      passRate: passRateFor(quizzesByName[name], list),
    })).sort((a,b) => b.attempts - a.attempts),
    byUser: Object.entries(byUser).map(([name, list]) => ({
      name, attempts: list.length,
      avgPct: Math.round(list.reduce((s,r) => s + pctOf(r), 0) / list.length),
    })).sort((a,b) => b.avgPct - a.avgPct),
    hardestQuestions,
    hardestCategories,
    weakestQuizzes,
  };
}

// Échelle de couleur commune à tout l'onglet Résultats : un même
// pourcentage doit avoir la même couleur, qu'il décrive une personne,
// un quiz ou une tentative.
function _qzTone(pct, threshold = 60) {
  if (pct >= threshold) return { c: 'var(--qz-ok)', bg: 'var(--qz-ok-c)' };
  if (pct >= threshold / 2) return { c: 'var(--qz-mid)', bg: 'var(--qz-mid-c)' };
  return { c: 'var(--qz-no)', bg: 'var(--qz-no-c)' };
}

function _renderQuizStatsSummary(results) {
  const el = document.getElementById('quiz-stats-summary');
  if (!el) return;
  const stats = _quizStats(results);
  if (!stats) { el.innerHTML = ''; return; }

  const avgTone = _qzTone(stats.avgPct);
  const passTone = _qzTone(stats.passRate);

  const row = (name, sub, value, tone) => `
    <div class="qz-row">
      <div class="qz-row-main">
        <div class="qz-row-name">${esc(name)}</div>
        <div class="qz-row-sub">${esc(sub)}</div>
      </div>
      <span class="qz-row-v" style="background:${tone.bg};color:${tone.c}">${esc(value)}</span>
    </div>`;

  const panel = (title, body) => `
    <div class="qz-panel">
      <div class="qz-panel-t">${title}</div>
      ${body}
    </div>`;

  // Ce qui pêche : c'est la seule partie qui débouche sur une action
  // (retravailler une notion), donc elle mérite ses propres cartes.
  const hardQ = stats.hardestQuestions.length
    ? stats.hardestQuestions.map(q => row(q.question, `${q.wrong}/${q.total} failed attempts`, `${q.failRate}%`, _qzTone(100 - q.failRate))).join('')
    : `<div class="qz-empty-s">Not enough attempts yet to draw a conclusion.</div>`;

  const hardC = stats.hardestCategories.length
    ? stats.hardestCategories.map(c => row(c.name, `${c.wrong}/${c.total} wrong answers`, `${c.failRate}%`, _qzTone(100 - c.failRate))).join('')
    : `<div class="qz-empty-s">No category is set on the questions.</div>`;

  el.innerHTML = `
    <div class="qz-stats">
      <div class="qz-stat">
        <div class="qz-stat-k">Attempts</div>
        <div class="qz-stat-v">${stats.attempts}</div>
        <div class="qz-stat-h">over the selected period</div>
      </div>
      <div class="qz-stat">
        <div class="qz-stat-k">Average score</div>
        <div class="qz-stat-v" style="color:${avgTone.c}">${stats.avgPct}%</div>
        <div class="qz-stat-h">across all attempts</div>
      </div>
      <div class="qz-stat">
        <div class="qz-stat-k">Pass rate</div>
        <div class="qz-stat-v" style="color:${passTone.c}">${stats.passRate}%</div>
        <div class="qz-stat-h">attempts above the threshold</div>
      </div>
    </div>

    <div class="qz-panels${_quizTeamView() ? '' : ' is-one'}">
      ${panel(_quizTeamView() ? 'By quiz' : 'My quizzes', stats.byQuiz.map(q =>
        row(q.name, `${q.attempts} attempt${q.attempts > 1 ? 's' : ''} · ${q.avgPct}% average`, `${q.passRate}% pass`, _qzTone(q.passRate))).join(''))}
      ${_quizTeamView() ? panel('By person', stats.byUser.map(u =>
        row(u.name, `${u.attempts} attempt${u.attempts > 1 ? 's' : ''}`, `${u.avgPct}% average`, _qzTone(u.avgPct))).join('')) : ''}
    </div>

    <div class="qz-panels">
      ${panel('Most failed questions', hardQ)}
      ${panel('Topics to revisit', hardC)}
    </div>`;
}

function renderQuizHistory() {
  const el = document.getElementById('quiz-tab-history');
  const tableEl = document.getElementById('quiz-history-table');
  if (!el || !tableEl) return;

  const quizSel = document.getElementById('quiz-hist-filter-quiz');
  const userSel = document.getElementById('quiz-hist-filter-user');
  if (quizSel && !quizSel.dataset.filled) {
    const quizNames = [...new Set((state.quizzes || []).map(q => q.name))];
    quizSel.innerHTML = `<option value="">All quizzes</option>`
      + quizNames.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    quizSel.dataset.filled = '1';
  }
  // Le choix de la personne n'a de sens que pour la vue d'équipe.
  if (userSel) userSel.hidden = !_quizTeamView();
  // L'export Excel est un outil de suivi d'équipe.
  const exp = document.getElementById('quiz-hist-export');
  if (exp) exp.hidden = !_quizTeamView();
  if (userSel && !userSel.dataset.filled) {
    const users = [...new Set((state.quizResults || []).map(r => r.user))].sort();
    userSel.innerHTML = `<option value="">Whole team</option>`
      + users.map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join('');
    userSel.dataset.filled = '1';
  }

  const results = _quizFilteredResults();
  _renderQuizStatsSummary(results);

  if (!results.length) {
    tableEl.innerHTML = `<div class="qz-empty">
      <div class="qz-empty-ico"><svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M13 3a9 9 0 0 0-9 9H1l4 4 4-4H6a7 7 0 1 1 7 7v2a9 9 0 0 0 0-18m-1 5v5l4.25 2.52.75-1.23-3.5-2.07V8z"/></svg></div>
      <div class="qz-empty-t">${_quizTeamView() ? 'No attempt' : 'No result yet'}</div>
      <div class="qz-empty-d">${_quizTeamView()
        ? 'Nobody has taken a quiz in this period yet. Change the filters or start one from the Quiz tab.'
        : (_quizMe() ? 'Your attempts will show here — only you can see them.' : 'Set your profile to see your results.')}</div>
      ${_quizTeamView() ? '' : '<button class="qz-empty-act" onclick="switchQuizTab(\'play\')">Take a quiz</button>'}
    </div>`;
    return;
  }

  const quizzesByName = Object.fromEntries((state.quizzes || []).map(q => [q.name, q]));
  const { locale, tz } = getLangConfig();

  tableEl.innerHTML = `<div class="qz-hist">${results.map(r => {
    const pct = r.total ? Math.round((r.score / r.total) * 100) : 0;
    const threshold = _quizThreshold(quizzesByName[r.quiz_name]);
    const passed = pct >= threshold;
    const tone = passed ? { c: 'var(--qz-ok)', bg: 'var(--qz-ok-c)' } : { c: 'var(--qz-no)', bg: 'var(--qz-no-c)' };
    const d = new Date(r.created_at);
    const dateStr = d.toLocaleDateString(locale, { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric' })
      + ' · ' + d.toLocaleTimeString(locale, { timeZone: tz, hour: '2-digit', minute: '2-digit' });

    return `<div class="qz-att">
      <div class="qz-att-score" style="background:${tone.bg};color:${tone.c}">${pct}%</div>
      <div class="qz-att-main">
        <div class="qz-att-name">${esc(r.quiz_name || 'Quiz')}</div>
        <div class="qz-att-meta">
          ${_quizTeamView() ? `<span>${esc(r.user || '—')}</span><span style="opacity:.45">·</span>` : ''}<span>${esc(dateStr)}</span>
        </div>
      </div>
      <div class="qz-att-right">
        <div class="qz-att-raw">${r.score} / ${r.total}</div>
        <div class="qz-att-tag" style="color:${tone.c}">${passed ? 'Passed' : 'Failed'}</div>
      </div>
    </div>`;
  }).join('')}</div>`;
}

async function exportQuizHistoryExcel() {
  const results = _quizFilteredResults();
  const stats = _quizStats(results);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Quiz results');
  ws.columns = [{ width: 20 }, { width: 24 }, { width: 20 }, { width: 12 }, { width: 10 }];

  ws.mergeCells(1, 1, 1, 5);
  const title = ws.getCell(1, 1);
  title.value = 'QUIZ RESULTS REPORT';
  xlFill(title, XL_RED);
  xlFont(title, { bold: true, color: { argb: XL_WHITE }, size: 13 });
  xlCenter(title);
  ws.getRow(1).height = 26;

  ws.mergeCells(2, 1, 2, 5);
  const sub = ws.getCell(2, 1);
  sub.value = 'Generated on ' + new Date().toLocaleString('en-GB');
  xlFill(sub, XL_BLACK);
  xlFont(sub, { color: { argb: XL_WHITE }, size: 9 });
  xlCenter(sub);

  let r = 4;
  if (stats) {
    xlBar(ws, r, 1, 5, 'SUMMARY'); r++;
    xlHdr(ws, r, [1,2,3], ['Attempts', 'Average score', 'Pass rate']); r++;
    xlCell(ws, r, 1, stats.attempts, { center: true });
    xlCell(ws, r, 2, stats.avgPct + '%', { center: true });
    xlCell(ws, r, 3, stats.passRate + '%', { center: true });
    r += 2;

    xlBar(ws, r, 1, 5, 'BY QUIZ'); r++;
    xlHdr(ws, r, [1,2,3,4], ['Quiz', 'Attempts', 'Avg score', 'Pass rate']); r++;
    stats.byQuiz.forEach((q, i) => {
      xlCell(ws, r, 1, q.name, { zebra: i % 2 === 1 });
      xlCell(ws, r, 2, q.attempts, { zebra: i % 2 === 1, center: true });
      xlCell(ws, r, 3, q.avgPct + '%', { zebra: i % 2 === 1, center: true });
      xlCell(ws, r, 4, q.passRate + '%', { zebra: i % 2 === 1, center: true });
      r++;
    });
    r++;

    xlBar(ws, r, 1, 5, 'BY USER'); r++;
    xlHdr(ws, r, [1,2,3], ['User', 'Attempts', 'Avg score']); r++;
    stats.byUser.forEach((u, i) => {
      xlCell(ws, r, 1, u.name, { zebra: i % 2 === 1 });
      xlCell(ws, r, 2, u.attempts, { zebra: i % 2 === 1, center: true });
      xlCell(ws, r, 3, u.avgPct + '%', { zebra: i % 2 === 1, center: true });
      r++;
    });
    r++;

    xlBar(ws, r, 1, 5, 'HARDEST QUESTIONS'); r++;
    xlHdr(ws, r, [1,2,3,4,5], ['Question', 'Category', 'Wrong', 'Total', 'Fail rate']); r++;
    if (stats.hardestQuestions.length) {
      stats.hardestQuestions.forEach((q, i) => {
        xlCell(ws, r, 1, q.question, { zebra: i % 2 === 1 });
        xlCell(ws, r, 2, q.category || '-', { zebra: i % 2 === 1 });
        xlCell(ws, r, 3, q.wrong, { zebra: i % 2 === 1, center: true });
        xlCell(ws, r, 4, q.total, { zebra: i % 2 === 1, center: true });
        xlCell(ws, r, 5, q.failRate + '%', { zebra: i % 2 === 1, center: true });
        r++;
      });
    } else {
      ws.mergeCells(r, 1, r, 5);
      xlCell(ws, r, 1, 'Not enough data yet', { center: true });
      r++;
    }
    r++;

    xlBar(ws, r, 1, 5, 'HARDEST CATEGORIES'); r++;
    xlHdr(ws, r, [1,2,3,4], ['Category', 'Wrong', 'Total', 'Fail rate']); r++;
    if (stats.hardestCategories.length) {
      stats.hardestCategories.forEach((c, i) => {
        xlCell(ws, r, 1, c.name, { zebra: i % 2 === 1 });
        xlCell(ws, r, 2, c.wrong, { zebra: i % 2 === 1, center: true });
        xlCell(ws, r, 3, c.total, { zebra: i % 2 === 1, center: true });
        xlCell(ws, r, 4, c.failRate + '%', { zebra: i % 2 === 1, center: true });
        r++;
      });
    } else {
      ws.mergeCells(r, 1, r, 5);
      xlCell(ws, r, 1, 'No categories tagged yet', { center: true });
      r++;
    }
    r++;
  }

  xlBar(ws, r, 1, 5, 'DETAILED RESULTS'); r++;
  xlHdr(ws, r, [1,2,3,4,5], ['Date', 'Quiz', 'User', 'Score', '%']); r++;
  if (results.length) {
    results.forEach((res, i) => {
      const pct = res.total ? Math.round((res.score / res.total) * 100) : 0;
      const { locale: _xl, tz: _xtz } = getLangConfig();
      xlCell(ws, r, 1, new Date(res.created_at).toLocaleString(_xl, { timeZone: _xtz }), { zebra: i % 2 === 1 });
      xlCell(ws, r, 2, res.quiz_name || '-', { zebra: i % 2 === 1 });
      xlCell(ws, r, 3, res.user, { zebra: i % 2 === 1 });
      xlCell(ws, r, 4, `${res.score} / ${res.total}`, { zebra: i % 2 === 1, center: true });
      xlCell(ws, r, 5, pct + '%', { zebra: i % 2 === 1, center: true });
      r++;
    });
  } else {
    ws.mergeCells(r, 1, r, 5);
    xlCell(ws, r, 1, 'No quiz attempts yet', { center: true });
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `quiz-results-${date}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

