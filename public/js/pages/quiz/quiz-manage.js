// Ordre des modules à l'intérieur d'un niveau. Le socle d'abord : c'est
// le parcours principal, les autres l'approfondissent. Un quiz maison
// (sans `module`) passe en dernier, après la banque.
const QZ_MODULE_ORDER = ['socle', 'terrain', 'outils', 'client', 'pieges'];
function _quizModuleRank(quiz) {
  const i = QZ_MODULE_ORDER.indexOf(quiz?.module);
  return i === -1 ? QZ_MODULE_ORDER.length : i;
}

// Étiquette courte du module, pour ne pas répéter le nom du niveau sur
// chaque carte : sous un en-tête « Niveau 3 », « SLA & engagement ·
// Relation client » se lit « Relation client ». Le socle porte le nom du
// niveau lui-même — sous l'en-tête, il devient « Parcours principal ».
// Un quiz maison garde son nom entier : lui, il n'est pas déductible.
function _quizModuleLabel(quiz) {
  if (quiz?.module === 'socle') return 'Core course';
  const name = String(quiz?.name || '');
  const cut = name.lastIndexOf(' · ');
  return cut === -1 ? name : name.slice(cut + 3);
}

// Une carte de la liste Configuration → Quiz.
function _quizManageCard(qz, term) {
  // Un quiz non publié n'existe pas pour les apprenants. Le dire
  // franchement ici : sans marque visible, un cours resté en brouillon
  // passe pour un cours en ligne que personne ne fait.
  const pub = qz.published !== false;
  return `
      <div class="obs-card"${pub ? '' : ' style="opacity:.62"'}>
        <div style="flex:1;padding:14px 16px">
          <div class="obs-text" style="margin-bottom:4px">
            ${_cfgqMark(_quizModuleLabel(qz), term)}
            ${qz.module === 'socle' ? '<span style="font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--accent);border:1px solid var(--accent);border-radius:20px;padding:1px 7px;margin-left:6px;vertical-align:1px">Socle</span>' : ''}
            ${!qz.builtin ? '<span style="font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--mute);border:1px solid var(--line);border-radius:20px;padding:1px 7px;margin-left:6px;vertical-align:1px">Maison</span>' : ''}
            ${pub ? '' : '<span style="font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--mute);border:1px solid var(--line);border-radius:20px;padding:1px 7px;margin-left:6px;vertical-align:1px">Brouillon</span>'}
          </div>
          ${qz.description ? `<div style="font-size:11px;color:var(--mute);margin-bottom:4px">${_cfgqMark(qz.description, term)}</div>` : ''}
          <div class="obs-meta">${(qz.questions || []).length} question${(qz.questions || []).length > 1 ? 's' : ''} · +${_quizXp(qz)} XP · ${_quizRoundLabel(qz)}${qz.max_attempts ? ` · max ${qz.max_attempts} attempt${qz.max_attempts>1?'s':''}/user` : ' · unlimited attempts'} · pass ≥ ${_quizThreshold(qz)}%</div>
        </div>
        <div class="obs-actions">
          <button class="btn btn-ghost btn-sm" onclick="toggleQuizPublished('${qz.id}', ${!pub})"${pub ? '' : ' style="color:var(--accent);font-weight:600"'}>${pub ? 'Unpublish' : 'Publish'}</button>
          <button class="btn btn-ghost btn-sm" onclick="manageQuizQuestions('${qz.id}')"${qz.id === _quizManagingId ? ' style="color:var(--gm-pri,var(--dark));font-weight:700"' : ''}>Questions${(qz.questions || []).length ? ` (${(qz.questions || []).length})` : ''}</button>
          ${qz.builtin
            ? '<span style="font-size:11px;color:var(--mute);padding:0 8px">Lecture seule</span>'
            : `<button class="btn btn-ghost btn-sm" onclick="openEditQuiz('${qz.id}')">Edit</button>
               <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deleteQuizDirect('${qz.id}')">Delete</button>`}
        </div>
      </div>`;
}

// Recherche : on compare sans accents ni casse, sinon « épingle » ne
// répond pas à « epingle » et la barre passe pour cassée.
function _cfgqNorm(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// Surligne le terme trouvé dans un texte déjà échappé. On travaille sur
// la version normalisée pour repérer les positions, puis on découpe le
// texte d'origine aux mêmes index : les deux chaînes ont la même
// longueur, NFD mis à part les diacritiques qu'on retire.
function _cfgqMark(text, term) {
  const raw = String(text == null ? '' : text);
  if (!term) return esc(raw);
  const hay = _cfgqNorm(raw), needle = _cfgqNorm(term);
  // La normalisation peut décaler les index (ligatures, caractères
  // composés) : dans ce cas on renonce au surlignage plutôt que de
  // couper le texte au mauvais endroit.
  if (hay.length !== raw.length || !needle) return esc(raw);
  let out = '', i = 0;
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, i)) {
    out += esc(raw.slice(i, at)) + '<mark class="cfgq-hit">' + esc(raw.slice(at, at + needle.length)) + '</mark>';
    i = at + needle.length;
  }
  return out + esc(raw.slice(i));
}

// Niveaux repliés en Configuration → Quiz. En mémoire seulement : c'est
// un confort de lecture pour la session en cours, pas une préférence.
const _cfgqCollapsed = new Set();

function resetQuizManageSearch() {
  const s = document.getElementById('cfg-quiz-search');
  const f = document.getElementById('cfg-quiz-filter');
  if (s) s.value = '';
  if (f) f.value = '';
  renderQuizManage();
  s?.focus();
}

function resetQuizQuestionSearch() {
  const s = document.getElementById('cfg-question-search');
  const c = document.getElementById('cfg-question-cat');
  if (s) s.value = '';
  if (c) c.value = '';
  renderQuizQuestionsManage();
  s?.focus();
}

function toggleQuizLevel(n) {
  const k = String(n);
  if (_cfgqCollapsed.has(k)) _cfgqCollapsed.delete(k); else _cfgqCollapsed.add(k);
  renderQuizManage();
}

// Replie tout, ou déplie tout si au moins un niveau est déjà replié.
function toggleQuizLevels() {
  const levels = new Set((state.quizzes || []).map(qz => String(_quizLevel(qz).n)));
  if (_cfgqCollapsed.size) _cfgqCollapsed.clear();
  else levels.forEach(n => _cfgqCollapsed.add(n));
  renderQuizManage();
}

// - Manage Quizzes (Configuration → Quiz) -
function renderQuizManage() {
  const el = document.getElementById('config-quiz-list');
  if (!el) return;
  const all = state.quizzes || [];

  const term = (document.getElementById('cfg-quiz-search')?.value || '').trim();
  const mode = document.getElementById('cfg-quiz-filter')?.value || '';
  const q = _cfgqNorm(term);

  // Le texte fouillé par la recherche : ce qui est visible sur la carte,
  // plus le niveau et son étiquette — on cherche autant « niveau 3 » ou
  // « avancé » qu'un nom de module.
  const matches = qz => {
    if (!q) return true;
    const lv = _quizLevel(qz);
    const hay = _cfgqNorm([
      qz.name, qz.description, _quizModuleLabel(qz), qz.module,
      `niveau ${lv.n}`, lv.label,
      ...(qz.questions || []).map(x => `${x.question} ${x.category || ''}`),
    ].join(' '));
    return hay.includes(q);
  };
  const passesFilter = qz => {
    if (mode === 'online') return qz.published !== false;
    if (mode === 'draft') return qz.published === false;
    if (mode === 'custom') return !qz.builtin;
    if (mode === 'empty') return !(qz.questions || []).length;
    return true;
  };

  const quizzes = all.filter(qz => matches(qz) && passesFilter(qz));
  const filtering = !!q || !!mode;

  // Ce que le compteur doit dire : combien de cours on regarde, et
  // combien sont réellement exposés aux apprenants.
  const countEl = document.getElementById('config-quiz-count');
  if (countEl) {
    const online = quizzes.filter(qz => qz.published !== false).length;
    countEl.textContent = !all.length ? ''
      : filtering
        ? `${quizzes.length} of ${all.length} courses · ${online} online`
        : `${all.length} cours · ${online} en ligne · ${all.reduce((n, qz) => n + (qz.questions || []).length, 0)} questions`;
  }
  const collapseBtn = document.getElementById('cfg-quiz-collapse');
  if (collapseBtn) {
    collapseBtn.textContent = _cfgqCollapsed.size ? 'Expand all' : 'Collapse all';
    collapseBtn.style.display = filtering ? 'none' : '';
  }

  if (!all.length) {
    el.innerHTML = '<div style="text-align:center;padding:32px;color:var(--mute)">No quizzes yet</div>';
  } else if (!quizzes.length) {
    // Une recherche vide doit se distinguer d'une banque vide, et
    // proposer la sortie plutôt que de laisser l'utilisateur bloqué.
    el.innerHTML = `<div style="text-align:center;padding:28px 16px;color:var(--mute)">
      <div style="font-size:12.5px">No course matches${term ? ` “${esc(term)}”` : ''}.</div>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="resetQuizManageSearch()">Reset</button>
    </div>`;
  } else {
    // Rangé comme le parcours de l'apprenant : un bloc par niveau, les
    // modules dans l'ordre à l'intérieur. Une liste à plat de 30 cours
    // éparpillait les six niveaux sur toute la page, alors que publier
    // se décide niveau par niveau.
    const byTier = new Map();
    [...quizzes]
      .sort((a, b) =>
        _quizLevel(a).n - _quizLevel(b).n ||
        _quizModuleRank(a) - _quizModuleRank(b) ||
        String(a.name || '').localeCompare(String(b.name || '')))
      .forEach(qz => {
        const n = _quizLevel(qz).n;
        if (!byTier.has(n)) byTier.set(n, []);
        byTier.get(n).push(qz);
      });

    el.innerHTML = [...byTier.keys()].sort((a, b) => a - b).map(n => {
      const list = byTier.get(n);
      const lv = QZ_LEVELS[n - 1];
      const online = list.filter(q => q.published !== false).length;
      // Le thème du niveau (« Réseau & supervision ») est plus parlant
      // que son étiquette de difficulté (« Confirmé ») pour choisir quoi
      // publier. Il vient du socle ; à défaut, on retombe sur QZ_LEVELS.
      const socle = list.find(q => q.module === 'socle');
      const theme = socle ? String(socle.name).replace(/^Niveau \d+ — /, '') : lv.label;
      // Pendant une recherche, tout reste déplié : masquer un résultat
      // derrière un niveau replié ferait croire qu'il n'existe pas.
      const shut = !filtering && _cfgqCollapsed.has(String(n));
      const nQ = list.reduce((a, qz) => a + (qz.questions || []).length, 0);
      // Le compteur « en ligne / total » évite d'avoir à parcourir les
      // cartes pour savoir ce que le niveau expose réellement.
      const head = `
        <div class="cfgq-level-head" style="display:flex;align-items:center;gap:9px;margin:18px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--line)"
             onclick="toggleQuizLevel(${n})" role="button" tabindex="0"
             onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleQuizLevel(${n})}"
             aria-expanded="${!shut}" title="${shut ? 'Expand' : 'Collapse'} level ${n}">
          <svg class="cfgq-caret" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
          <span style="font-size:10px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:${lv.c};background:${lv.cc};border-radius:20px;padding:2px 9px">Niveau ${n}</span>
          <span style="font-size:13px;font-weight:600;color:var(--m3-on-surface)">${_cfgqMark(theme, term)}</span>
          ${theme === lv.label ? '' : `<span style="font-size:11px;color:var(--mute)">${esc(lv.label)}</span>`}
          <span style="margin-left:auto;font-size:11px;color:var(--mute)">${online}/${list.length} en ligne · ${nQ} question${nQ > 1 ? 's' : ''}</span>
        </div>`;
      return `<div class="cfgq-level${shut ? ' collapsed' : ''}">${head}
        <div class="cfgq-level-body">${list.map(qz => _quizManageCard(qz, term)).join('')}</div>
      </div>`;
    }).join('');
  }

  renderQuizQuestionsManage();
}

function renderQuizQuestionsManage() {
  const el = document.getElementById('config-quiz-questions');
  if (!el) return;
  const quiz = (state.quizzes || []).find(qz => qz.id === _quizManagingId);

  if (!quiz) {
    el.innerHTML = '';
    document.getElementById('config-quiz-questions-wrap').style.display = 'none';
    return;
  }

  document.getElementById('config-quiz-questions-wrap').style.display = '';
  document.getElementById('config-quiz-questions-title').textContent = `Questions - ${quiz.name}`;
  // Ajouter une question à un quiz de la banque échouerait côté serveur :
  // on retire le bouton plutôt que de laisser tenter.
  const addBtn = document.querySelector('#config-quiz-questions-wrap .btn-primary');
  if (addBtn) addBtn.style.display = quiz.builtin ? 'none' : '';

  const all = quiz.questions || [];

  // Le filtre par thème est alimenté depuis les questions du quiz
  // affiché. On préserve la valeur choisie si elle existe encore, sinon
  // le sélecteur se réinitialiserait à chaque changement de quiz.
  const catSel = document.getElementById('cfg-question-cat');
  const cats = [...new Set(all.map(q => q.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (catSel) {
    const keep = catSel.value;
    catSel.innerHTML = '<option value="">All topics</option>' +
      cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    catSel.value = cats.includes(keep) ? keep : '';
    catSel.style.display = cats.length > 1 ? '' : 'none';
  }

  const term = (document.getElementById('cfg-question-search')?.value || '').trim();
  const q = _cfgqNorm(term);
  const cat = catSel?.value || '';

  // La recherche porte aussi sur les réponses et l'explication : c'est
  // souvent par là qu'on retrouve une question dont on a oublié l'intitulé.
  const questions = all.filter(x => {
    if (cat && x.category !== cat) return false;
    if (!q) return true;
    return _cfgqNorm([
      x.question, x.category, x.explanation,
      x.option_a, x.option_b, x.option_c, x.option_d,
    ].join(' ')).includes(q);
  });

  const countEl = document.getElementById('config-quiz-questions-count');
  if (countEl) {
    const pts = all.reduce((n, x) => n + (x.points || 1), 0);
    countEl.textContent = !all.length ? ''
      : (q || cat)
        ? `${questions.length} question${questions.length > 1 ? 's' : ''} of ${all.length}`
        : `${all.length} question${all.length > 1 ? 's' : ''} · ${pts} pt${pts > 1 ? 's' : ''}${cats.length ? ` · ${cats.length} topic${cats.length > 1 ? 's' : ''}` : ''}`;
  }

  if (!all.length) {
    el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--mute)">No questions yet</div>';
    return;
  }
  if (!questions.length) {
    el.innerHTML = `<div style="text-align:center;padding:26px 16px;color:var(--mute)">
      <div style="font-size:12.5px">No question matches${term ? ` “${esc(term)}”` : ''}.</div>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="resetQuizQuestionSearch()">Reset</button>
    </div>`;
    return;
  }

  // Les réponses sont affichées, la bonne repérée : relire une question
  // ne devait pas obliger à ouvrir le formulaire d'édition — c'est là
  // qu'on vérifie qu'un intitulé et ses options se tiennent.
  el.innerHTML = questions.map(x => {
    const opts = ['a', 'b', 'c', 'd']
      .map(k => ({ k, v: x[`option_${k}`] }))
      .filter(o => o.v != null && String(o.v).trim() !== '');
    const good = String(x.correct || '').trim().toLowerCase();
    return `
    <div class="obs-card">
      <div style="flex:1;padding:14px 16px">
        <div class="obs-meta">#${all.indexOf(x) + 1}${x.category ? ' · ' + _cfgqMark(x.category, term) : ''} · Correct: <strong>${esc(x.correct)}</strong> · ${x.points || 1} pt${(x.points||1)>1?'s':''}</div>
        <div class="obs-text" style="margin:4px 0">${_cfgqMark(x.question, term)}</div>
        ${opts.length ? `<div style="display:flex;flex-direction:column;gap:2px;margin:6px 0 2px">${opts.map(o => {
          const ok = o.k === good;
          return `<div style="font-size:11.5px;line-height:1.45;color:${ok ? 'var(--g-green-sh,#46A302)' : 'var(--mute)'};${ok ? 'font-weight:600' : ''}">
            <span style="display:inline-block;min-width:15px;font-weight:700;text-transform:uppercase">${o.k}</span>${_cfgqMark(o.v, term)}${ok ? ' ✓' : ''}
          </div>`;
        }).join('')}</div>` : ''}
        ${x.explanation ? `<div style="font-size:11.5px;color:var(--mute);line-height:1.45;margin-top:4px;padding-left:9px;border-left:2px solid var(--line)">${_cfgqMark(x.explanation, term)}</div>` : ''}
      </div>
      <div class="obs-actions">
        ${quiz.builtin
          ? '<span style="font-size:11px;color:var(--mute);padding:0 8px">Lecture seule</span>'
          : `<button class="btn btn-ghost btn-sm" onclick="openEditQuizQuestion('${x.id}')">Edit</button>`}
      </div>
    </div>`;
  }).join('');
}

function manageQuizQuestions(id) {
  // Changer de quiz remet la recherche à zéro : un filtre hérité du quiz
  // précédent donnerait un panneau vide sans raison apparente.
  if (id !== _quizManagingId) {
    const s = document.getElementById('cfg-question-search');
    const c = document.getElementById('cfg-question-cat');
    if (s) s.value = '';
    if (c) c.value = '';
  }
  _quizManagingId = id;
  renderQuizManage();
  document.getElementById('config-quiz-questions-wrap')
    ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Refermer le panneau : sans quiz sélectionné, renderQuizQuestionsManage()
// le masque lui-même, ce qui garde un seul endroit qui décide de l'affichage.
function closeQuizQuestions() {
  _quizManagingId = null;
  // Passer par renderQuizManage : la liste doit aussi perdre la marque
  // du quiz actif, et c'est elle qui rappelle le rendu du panneau.
  renderQuizManage();
}

// - Quiz (name/description) side panel -
function updateQuizTimerLabel(mode) {
  const label = document.getElementById('quiz-timer-value-label');
  const input = document.querySelector('#quiz-form [name="timer_value"]');
  if (!label || !input) return;
  if (mode === 'global') {
    label.textContent = 'Minutes for the whole quiz';
    input.placeholder = '10';
  } else {
    label.textContent = 'Seconds per question';
    input.placeholder = '30';
  }
}

// Le niveau décide de la place du cours dans le parcours : le dire
// dans le formulaire évite qu'on le choisisse au hasard.
function updateQuizXpHint(value) {
  const el = document.getElementById('quiz-level-hint');
  if (!el) return;
  const lv = QZ_LEVELS[Math.min(QZ_LEVEL_MAX, Math.max(1, parseInt(value, 10) || 1)) - 1];
  el.textContent = `Tier “${lv.label}” of the path · ${lv.xp} XP on success. `
    + `Courses at this tier stay locked until the previous tiers are completed.`;
}

function openNewQuiz() {
  editingQuizId = null;
  const form = document.getElementById('quiz-form');
  form.reset();
  document.getElementById('quiz-modal-title').textContent = 'New quiz';
  document.getElementById('quiz-btn-delete').style.display = 'none';
  form.querySelector('[name="timer_mode"]').value = 'per_question';
  updateQuizTimerLabel('per_question');
  form.querySelector('[name="level"]').value = '1';
  updateQuizXpHint('1');
  document.getElementById('quiz-qpr-hint').textContent = '(optional, blank = all questions)';
  document.getElementById('quiz-modal').classList.add('open');
}

function openEditQuiz(id) {
  editingQuizId = id;
  const quiz = (state.quizzes || []).find(x => x.id === id);
  if (!quiz) return;
  const form = document.getElementById('quiz-form');
  form.reset();
  document.getElementById('quiz-modal-title').textContent = 'Edit quiz';
  document.getElementById('quiz-btn-delete').style.display = '';
  form.querySelector('[name="name"]').value = quiz.name || '';
  form.querySelector('[name="description"]').value = quiz.description || '';
  form.querySelector('[name="max_attempts"]').value = quiz.max_attempts || '';
  form.querySelector('[name="pass_threshold"]').value = quiz.pass_threshold || '';
  form.querySelector('[name="questions_per_round"]').value = quiz.questions_per_round || '';
  const level = String(_quizLevel(quiz).n);
  form.querySelector('[name="level"]').value = level;
  form.querySelector('[name="xp_reward"]').value = quiz.xp_reward || '';
  updateQuizXpHint(level);
  const poolSize = (quiz.questions || []).length;
  document.getElementById('quiz-qpr-hint').textContent = `(optional, blank = all ${poolSize} question${poolSize===1?'':'s'})`;
  const timerMode = quiz.timer_mode || 'per_question';
  form.querySelector('[name="timer_mode"]').value = timerMode;
  form.querySelector('[name="timer_value"]').value = quiz.timer_value || '';
  updateQuizTimerLabel(timerMode);
  document.getElementById('quiz-modal').classList.add('open');
}

const saveQuiz = withSaveGuard(async function() {
  const form = document.getElementById('quiz-form');
  if (!form.checkValidity()) { form.reportValidity(); return; }
  const data = {}; new FormData(form).forEach((v,k) => { data[k]=v; });
  data.max_attempts = data.max_attempts ? parseInt(data.max_attempts, 10) : null;
  data.pass_threshold = data.pass_threshold ? parseInt(data.pass_threshold, 10) : 60;
  // Le niveau est borné ici et pas seulement dans le select : le
  // parcours indexe QZ_LEVELS avec cette valeur.
  data.level = Math.min(QZ_LEVEL_MAX, Math.max(1, parseInt(data.level, 10) || 1));
  data.xp_reward = data.xp_reward ? parseInt(data.xp_reward, 10) : null;
  data.questions_per_round = data.questions_per_round ? parseInt(data.questions_per_round, 10) : null;
  data.timer_value = data.timer_value ? parseInt(data.timer_value, 10) : (data.timer_mode === 'global' ? 10 : 30);
  try {
    if (editingQuizId) {
      await fetch(`${API}/api/quizzes/${editingQuizId}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
      toast('Quiz updated', 'success');
    } else {
      await fetch(`${API}/api/quizzes`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
      toast('Quiz created', 'success');
    }
    closeModal('quiz-modal'); await loadAll(); renderQuizManage();
  } catch(e) { toast('Error saving quiz', 'error'); }
});

const deleteQuiz = withSaveGuard(async function() {
  if (!editingQuizId) return;
  if (!confirm('Delete this quiz and all its questions?')) return;
  await fetch(`${API}/api/quizzes/${editingQuizId}`, { method:'DELETE' });
  toast('Quiz deleted', 'success');
  if (_quizManagingId === editingQuizId) _quizManagingId = null;
  closeModal('quiz-modal'); await loadAll(); renderQuizManage();
});

// Publier / dépublier. Vaut aussi pour la banque : l'état de
// publication est une décision d'exploitation, il ne touche pas au
// contenu du quiz — le serveur l'accepte donc sur un quiz en lecture
// seule. Dépublier retire le cours du parcours des apprenants et refuse
// les nouvelles tentatives ; les résultats déjà enregistrés restent.
async function toggleQuizPublished(id, publish) {
  const r = await fetch(`${API}/api/quizzes/${id}/published`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ published: publish }),
  });
  if (!r.ok) {
    toast((await r.json().catch(() => ({}))).error || 'Update failed', 'error');
    return;
  }
  toast(publish ? 'Quiz published' : 'Quiz unpublished', 'success');
  await loadAll(); renderQuizManage();
}

async function deleteQuizDirect(id) {
  if (!confirm('Delete this quiz and all its questions?')) return;
  await fetch(`${API}/api/quizzes/${id}`, { method:'DELETE' });
  toast('Quiz deleted', 'success');
  if (_quizManagingId === id) _quizManagingId = null;
  await loadAll(); renderQuizManage();
}

// Le choix de la bonne réponse se fait sur la ligne de l'option ; le
// select [name=correct] (masqué) reste la source de vérité pour la
// validation HTML et l'enregistrement.
function syncQuizCorrect() {
  const form = document.getElementById('quiz-question-form');
  if (!form) return;
  const picked = form.querySelector('[name=correct_pick]:checked');
  const select = form.querySelector('[name=correct]');
  if (select) select.value = picked ? picked.value : '';
  form.querySelectorAll('.sp-answer').forEach(row => {
    const radio = row.querySelector('[name=correct_pick]');
    row.classList.toggle('is-correct', !!radio && radio.checked);
  });
}

// Inverse : repositionne la coche depuis la valeur stockée (édition).
function _applyQuizCorrect(value) {
  const form = document.getElementById('quiz-question-form');
  if (!form) return;
  const radio = form.querySelector(`[name=correct_pick][value="${value || ''}"]`);
  if (radio) radio.checked = true;
  syncQuizCorrect();
}

// - Question side panel -
function openNewQuizQuestion() {
  if (!_quizManagingId) return;
  editingQuizQuestionId = null;
  const form = document.getElementById('quiz-question-form');
  form.reset();
  _applyQuizCorrect('');
  document.getElementById('quiz-question-modal-title').textContent = 'Add question';
  document.getElementById('quiz-question-btn-delete').style.display = 'none';
  document.getElementById('quiz-question-modal').classList.add('open');
}

function openEditQuizQuestion(id) {
  const quiz = (state.quizzes || []).find(qz => qz.id === _quizManagingId);
  if (!quiz) return;
  editingQuizQuestionId = id;
  const q = (quiz.questions || []).find(x => x.id === id);
  if (!q) return;
  const form = document.getElementById('quiz-question-form');
  form.reset();
  document.getElementById('quiz-question-modal-title').textContent = 'Edit question';
  document.getElementById('quiz-question-btn-delete').style.display = '';
  Object.keys(q).forEach(k => {
    const el = form.querySelector(`[name="${k}"]`);
    if (el) el.value = q[k] || '';
  });
  _applyQuizCorrect(q.correct);
  document.getElementById('quiz-question-modal').classList.add('open');
}

const saveQuizQuestion = withSaveGuard(async function() {
  if (!_quizManagingId) return;
  const form = document.getElementById('quiz-question-form');
  // Le select `correct` est masqué : reportValidity() ne peut pas afficher
  // de bulle dessus, ce qui bloquerait l'enregistrement sans message.
  // On valide la bonne réponse à la main, avec un toast explicite.
  syncQuizCorrect();
  if (!form.querySelector('[name=correct]').value) {
    toast('Tick the correct answer (A, B, C or D)', 'error');
    form.querySelector('.sp-answers')?.scrollIntoView({ block:'center', behavior:'smooth' });
    return;
  }
  if (!form.checkValidity()) { form.reportValidity(); return; }
  const data = {}; new FormData(form).forEach((v,k) => { data[k]=v; });
  delete data.correct_pick; // champ d'interface uniquement — `correct` porte la valeur
  data.points = data.points ? parseInt(data.points, 10) : 1;
  try {
    if (editingQuizQuestionId) {
      await fetch(`${API}/api/quizzes/${_quizManagingId}/questions/${editingQuizQuestionId}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
      toast('Question updated', 'success');
    } else {
      await fetch(`${API}/api/quizzes/${_quizManagingId}/questions`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
      toast('Question added', 'success');
    }
    closeModal('quiz-question-modal'); await loadAll(); renderQuizManage();
  } catch(e) { toast('Error saving question', 'error'); }
});

const deleteQuizQuestion = withSaveGuard(async function() {
  if (!editingQuizQuestionId || !_quizManagingId) return;
  if (!confirm('Delete this question?')) return;
  await fetch(`${API}/api/quizzes/${_quizManagingId}/questions/${editingQuizQuestionId}`, { method:'DELETE' });
  toast('Question deleted', 'success');
  closeModal('quiz-question-modal'); await loadAll(); renderQuizManage();
});

