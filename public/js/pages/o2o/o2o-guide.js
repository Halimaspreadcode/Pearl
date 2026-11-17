// ══════════════════════════════════════════════════════════════
// ONE-TO-ONE — SESSION GUIDÉE
//
// Le formulaire « Run a meeting » se remplit après coup. La session
// guidée se mène PENDANT l'entretien, écran partagé ou projeté : une
// trame en huit étapes, chacune avec ses questions, un minuteur qui dit
// si l'on déborde, les chiffres de l'agent sous les yeux, et un atelier
// SMART qui construit l'objectif avec lui et le note en direct.
//
// Les questions forment un modèle : modifiables pendant la séance, et
// enregistrables comme trame par défaut (config.o2o_guide). Le brouillon
// est gardé localement par agent : une coupure ne perd rien.
//
// À la fin, l'entretien est rangé comme les autres (fo_o2o[fo].meetings),
// actions comprises : elles se suivent ensuite au même endroit.
// ══════════════════════════════════════════════════════════════

const O2O_GUIDE_DEFAULT = [
  { id: 'open', label: 'Ouverture', min: 3,
    intro: 'Mettre à l\'aise et prendre la température avant de parler chiffres.',
    questions: [
      'Comment te sens-tu en ce moment, au travail ?',
      'Qu\'est-ce qui t\'a le plus marqué depuis notre dernier échange ?',
      'De quoi es-tu le plus fier ce mois-ci ?',
    ] },
  { id: 'review', label: 'Bilan chiffré', min: 5,
    intro: 'Lire les chiffres ensemble. L\'agent explique, le manager écoute.',
    questions: [
      'Que retiens-tu de ces chiffres ? Qu\'est-ce qui les explique ?',
      'Quel indicateur veux-tu améliorer en priorité, et de combien ?',
      'Un ticket ou un incident t\'a-t-il posé problème ? Qu\'aurais-tu fait différemment ?',
    ] },
  { id: 'objectives', label: 'Objectifs en cours', min: 7,
    intro: 'Faire le point sur chaque objectif de la session : où, quoi, quel besoin.',
    questions: [
      'Où en es-tu, en pourcentage, et qu\'est-ce qui le prouve ?',
      'Qu\'est-ce qui te bloque ou te ralentit ?',
      'L\'échéance est-elle toujours réaliste ? Sinon, quelle date proposes-tu ?',
      'De quoi as-tu besoin de ma part pour avancer ?',
    ] },
  { id: 'smart', label: 'Nouvel objectif SMART', min: 8,
    intro: 'Construire l\'objectif avec l\'agent, lettre par lettre. La note SMART se met à jour en direct.' },
  { id: 'growth', label: 'Développement', min: 4,
    intro: 'Compétences, formation, perspectives : ce que l\'agent veut devenir.',
    questions: [
      'Quelle compétence veux-tu développer dans les trois prochains mois ?',
      'Quelle formation, certification ou quel shadowing t\'aiderait le plus ?',
      'Où te vois-tu dans un an ? Qu\'est-ce qui t\'en rapproche ?',
      'Comment puis-je mieux t\'accompagner ? Que devrais-je faire différemment ?',
    ] },
  { id: 'feedback', label: 'Feedback', min: 3,
    intro: 'Un point fort et un axe de progrès, chacun avec un exemple concret.',
    questions: [
      'Point fort observé ce mois-ci (fait précis, impact).',
      'Axe de progrès : la situation, ce qui était attendu, ce qu\'on fera différemment.',
      'Comment reçois-tu ce feedback ? Es-tu d\'accord ?',
    ] },
  { id: 'actions', label: 'Actions convenues', min: 3,
    intro: 'Qui fait quoi, pour quand. Une action sans date ne se suit pas.' },
  { id: 'close', label: 'Clôture', min: 2,
    intro: 'Récapituler, vérifier l\'accord, prendre la température de fin.',
    questions: [
      'Qu\'est-ce qui t\'a été le plus utile dans cet échange ?',
      'Y a-t-il un sujet qu\'on n\'a pas abordé et dont tu voudrais parler ?',
    ] },
];

// Questions guides de l'atelier SMART : une lettre, deux questions, un
// repère. Les réponses alimentent directement les champs de l'objectif.
const O2O_SMART_GUIDE = [
  { k: 'S', name: 'Spécifique', q: ['Que veux-tu accomplir exactement ?', 'Quelle action concrète, sur quel périmètre ?'],
    tip: 'Commencer par un verbe d\'action : réduire, livrer, obtenir, former, documenter.' },
  { k: 'M', name: 'Mesurable', q: ['Comment saura-t-on que c\'est atteint ?', 'Quel chiffre, et d\'où vient-il ?'],
    tip: 'Une cible chiffrée, son unité et sa source (ServiceNow, tracker, rapport).' },
  { k: 'A', name: 'Atteignable', q: ['Est-ce réaliste avec ta charge actuelle ?', 'De quoi as-tu besoin : temps, outil, formation, aide ?'],
    tip: 'Ambitieux mais tenable. Une cible à 100 % ne laisse aucune marge.' },
  { k: 'R', name: 'Pertinent', q: ['Pourquoi est-ce important pour toi et pour l\'équipe ce trimestre ?', 'À quel indicateur de l\'équipe cela contribue-t-il ?'],
    tip: 'Relier l\'objectif à un enjeu du poste ou de l\'équipe.' },
  { k: 'T', name: 'Temporel', q: ['Pour quand ?', 'Quelles étapes intermédiaires, et à quelles dates ?'],
    tip: 'Une échéance dans la session, des jalons datés pour voir venir.' },
];
const O2O_SMART_PARTS = { S: 'specific', M: 'measurable', A: 'achievable', R: 'relevant', T: 'timebound' };

const O2O_MOOD_FACES = [
  { v: 1, e: '😟', l: 'Difficile' }, { v: 2, e: '🙁', l: 'Tendu' }, { v: 3, e: '😐', l: 'Neutre' },
  { v: 4, e: '🙂', l: 'Bien' }, { v: 5, e: '😄', l: 'Très bien' },
];

const O2O_REVIEW_STATUS = [
  { id: 'ahead', l: 'En avance' }, { id: 'ontrack', l: 'Dans les temps' },
  { id: 'late', l: 'En retard' }, { id: 'blocked', l: 'Bloqué' },
];

let OG = null;            // état de la session en cours
let _ogTimer = null;
let _ogSmartT = null;
let _ogSaveT = null;

// Trame : modèle enregistré s'il existe, sinon le jeu par défaut.
function _ogTemplate() {
  const saved = state.config.o2o_guide;
  return O2O_GUIDE_DEFAULT.map(p => ({
    ...p,
    questions: p.questions
      ? (saved && Array.isArray(saved[p.id]) && saved[p.id].length ? saved[p.id] : p.questions)
      : undefined,
  }));
}

function _ogDraftKey(fo) { return `o2o-guide-${fo}`; }
function _ogSaveDraft() {
  clearTimeout(_ogSaveT);
  _ogSaveT = setTimeout(() => {
    if (!OG) return;
    try { localStorage.setItem(_ogDraftKey(OG.fo), JSON.stringify({ ...OG, savedAt: Date.now() })); }
    catch { /* stockage indisponible : la séance continue sans brouillon */ }
  }, 300);
}

function _ogNew(fo) {
  const tpl = _ogTemplate();
  return {
    fo, phase: 0, started: Date.now(),
    spent: {}, visited: { open: true },
    q: Object.fromEntries(tpl.filter(p => p.questions)
      .map(p => [p.id, p.questions.map((t, i) => ({ id: `${p.id}-${i}`, t }))])),
    answers: {}, asked: {},
    mood: 0, moodEnd: 0,
    review: {},
    smartTab: 'S',
    smart: _ogBlankSmart(),
    smartReport: null,
    created: [],
    actions: [{ text: '', owner: 'Agent', due: '' }],
  };
}

function _ogBlankSmart() {
  return { title: '', scope: '', why: '', contrib: '', need: '', due: '',
           kpi: { name: '', target: '', unit: '', source: '' },
           steps: [{ label: '', due: '' }] };
}

// ── Ouverture / fermeture ─────────────────────────────────────
function o2oGuideOpen(fo) {
  if (!fo) return;
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(_ogDraftKey(fo)) || 'null'); } catch { draft = null; }
  if (draft && draft.fo === fo
      && confirm(`Une session guidée avec ${fo} est en cours (${new Date(draft.savedAt || draft.started).toLocaleString('fr-FR')}).\n\nOK : la reprendre\nAnnuler : en démarrer une nouvelle`)) {
    OG = draft;
  } else {
    OG = _ogNew(fo);
  }
  let el = document.getElementById('og-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'og-overlay';
    el.className = 'og-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    document.body.appendChild(el);
  }
  el.classList.add('open');
  document.addEventListener('keydown', _ogKeys);
  clearInterval(_ogTimer);
  _ogTimer = setInterval(_ogTick, 1000);
  _ogRender();
  _ogSmartCheck();
}

function o2oGuideClose() {
  const el = document.getElementById('og-overlay');
  if (el) el.classList.remove('open');
  clearInterval(_ogTimer);
  document.removeEventListener('keydown', _ogKeys);
  if (OG) _ogSaveDraft();
}

function _ogKeys(e) {
  if (!OG) return;
  const tag = (e.target && e.target.tagName) || '';
  if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); o2oGuideGo(OG.phase + 1); }
  if (e.key === 'ArrowLeft')  { e.preventDefault(); o2oGuideGo(OG.phase - 1); }
  if (e.key === 'Escape') o2oGuideClose();
}

// ── Minuteur ──────────────────────────────────────────────────
const _ogFmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function _ogTotalMin() { return _ogTemplate().reduce((n, p) => n + p.min, 0); }

function _ogTick() {
  if (!OG) return;
  const ph = _ogTemplate()[OG.phase];
  OG.spent[ph.id] = (OG.spent[ph.id] || 0) + 1;
  _ogPaintClock();
  if (Math.floor((Date.now() - OG.started) / 1000) % 10 === 0) _ogSaveDraft();
}

// Affichage seul, sans compter de seconde : appelé aussi au rendu.
function _ogPaintClock() {
  if (!OG) return;
  const ph = _ogTemplate()[OG.phase];
  const total = Math.floor((Date.now() - OG.started) / 1000);
  const tEl = document.getElementById('og-clock');
  if (tEl) {
    tEl.textContent = `${_ogFmt(total)} / ${_ogTotalMin()}:00`;
    tEl.classList.toggle('is-over', total > _ogTotalMin() * 60);
  }
  const s = OG.spent[ph.id] || 0, cap = ph.min * 60;
  const bar = document.getElementById('og-phase-bar');
  if (bar) {
    bar.style.width = `${Math.min(100, s / cap * 100)}%`;
    bar.className = 'og-phase-fill' + (s > cap * 1.25 ? ' is-over' : s > cap ? ' is-warn' : '');
  }
  const lbl = document.getElementById('og-phase-time');
  if (lbl) lbl.textContent = `${_ogFmt(s)} / ${ph.min}:00`;
}

// ── Navigation ────────────────────────────────────────────────
function o2oGuideGo(i) {
  const tpl = _ogTemplate();
  if (!OG || i < 0 || i >= tpl.length) return;
  OG.phase = i;
  OG.visited[tpl[i].id] = true;
  _ogSaveDraft();
  _ogRender();
  document.querySelector('#og-overlay .og-main')?.scrollTo({ top: 0 });
}

// Une étape « remplie » : au moins une réponse, un statut ou un champ.
function _ogPhaseDone(p) {
  if (p.id === 'smart') return OG.created.length > 0;
  if (p.id === 'actions') return OG.actions.some(a => a.text.trim());
  if (p.id === 'objectives' && Object.keys(OG.review).length) return true;
  if (p.id === 'open' && OG.mood) return true;
  return (OG.q[p.id] || []).some(q => (OG.answers[q.id] || '').trim());
}

// ── Rendu ─────────────────────────────────────────────────────
function _ogRender() {
  const el = document.getElementById('og-overlay');
  if (!el || !OG) return;
  const tpl = _ogTemplate();
  const ph = tpl[OG.phase];
  const fo = OG.fo;

  el.innerHTML = `
    <div class="og-shell">
      <header class="og-top">
        <span class="og-av" style="background:${foAvatarColor(fo)}">${foInitials(fo)}</span>
        <div class="og-who">
          <div class="og-who-n">${esc(fo)}</div>
          <div class="og-who-s">Session guidée One-to-One · ${new Date(OG.started).toLocaleDateString('fr-FR')}</div>
        </div>
        <div class="og-clock" id="og-clock" title="Temps écoulé / durée prévue">0:00</div>
        <button class="og-x" onclick="o2oGuideClose()" title="Fermer (le brouillon est gardé)" aria-label="Fermer">✕</button>
      </header>

      <nav class="og-rail" aria-label="Étapes">
        ${tpl.map((p, i) => `
          <button class="og-step${i === OG.phase ? ' is-on' : ''}${_ogPhaseDone(p) ? ' is-done' : ''}"
                  onclick="o2oGuideGo(${i})">
            <span class="og-step-n">${_ogPhaseDone(p) && i !== OG.phase ? '✓' : i + 1}</span>
            <span class="og-step-l">${esc(p.label)}</span>
            <span class="og-step-m">${p.min} min</span>
          </button>`).join('')}
        <div class="og-rail-foot">
          <button class="og-link" onclick="o2oGuideSaveTemplate()">Enregistrer les questions comme modèle</button>
          <button class="og-link" onclick="o2oGuideReset()">Recommencer</button>
        </div>
      </nav>

      <main class="og-main">
        <div class="og-ph-head">
          <div class="og-ph-k">Étape ${OG.phase + 1} sur ${tpl.length}</div>
          <h2 class="og-ph-t">${esc(ph.label)}</h2>
          <p class="og-ph-d">${esc(ph.intro || '')}</p>
          <div class="og-phase-track"><span class="og-phase-fill" id="og-phase-bar"></span></div>
          <div class="og-phase-time" id="og-phase-time"></div>
        </div>
        ${_ogPhaseBody(ph)}
      </main>

      <footer class="og-foot">
        <button class="btn btn-ghost" onclick="o2oGuideGo(${OG.phase - 1})" ${OG.phase === 0 ? 'disabled' : ''}>← Précédent</button>
        <span class="og-foot-k">Flèches ← → pour naviguer</span>
        ${OG.phase < tpl.length - 1
          ? `<button class="btn btn-primary" onclick="o2oGuideGo(${OG.phase + 1})">Suivant →</button>`
          : `<button class="btn btn-primary" onclick="o2oGuideFinish()">Enregistrer l'entretien</button>`}
      </footer>
    </div>`;
  _ogPaintClock();
  el.querySelectorAll('textarea').forEach(autoGrow);
}

function _ogPhaseBody(ph) {
  if (ph.id === 'smart') return _ogSmartBody();
  if (ph.id === 'actions') return _ogActionsBody();
  let pre = '';
  if (ph.id === 'open') pre = _ogMoodPicker('mood', 'Météo du moment');
  if (ph.id === 'review') pre = _ogReviewCards();
  if (ph.id === 'objectives') pre = _ogObjectivesReview();
  if (ph.id === 'close') pre = _ogRecap() + _ogMoodPicker('moodEnd', 'Météo de fin d\'entretien');
  return pre + _ogQuestions(ph.id);
}

function _ogQuestions(pid) {
  const list = OG.q[pid] || [];
  return `<div class="og-qs">
    ${list.map((q, i) => {
      const asked = !!OG.asked[q.id];
      const ans = OG.answers[q.id] || '';
      return `<div class="og-q${asked || ans.trim() ? ' is-asked' : ''}">
        <div class="og-q-h">
          <button class="og-q-chk" onclick="o2oGuideAsk('${q.id}')" title="Marquer comme posée"
                  aria-pressed="${asked}">${asked || ans.trim() ? '✓' : i + 1}</button>
          <div class="og-q-t">${esc(q.t)}</div>
          <button class="og-q-del" onclick="o2oGuideDelQ('${pid}','${q.id}')" title="Retirer la question" aria-label="Retirer">×</button>
        </div>
        <textarea class="og-q-a" rows="1" placeholder="Réponse, en quelques mots…"
          oninput="autoGrow(this);o2oGuideAnswer('${q.id}',this.value)">${esc(ans)}</textarea>
      </div>`;
    }).join('')}
    <div class="og-q-add">
      <input class="form-control" id="og-newq" maxlength="200" placeholder="Ajouter une question à cette étape"
             onkeydown="if(event.key==='Enter'){event.preventDefault();o2oGuideAddQ('${pid}')}">
      <button class="btn btn-ghost btn-sm" onclick="o2oGuideAddQ('${pid}')">Ajouter</button>
    </div>
  </div>`;
}

function _ogMoodPicker(field, title) {
  return `<div class="og-mood">
    <div class="og-mood-t">${esc(title)}</div>
    <div class="og-mood-faces">
      ${O2O_MOOD_FACES.map(f => `<button class="og-face${OG[field] === f.v ? ' is-on' : ''}"
          onclick="o2oGuideMood('${field}',${f.v})" title="${f.l}">
          <span class="og-face-e">${f.e}</span><span class="og-face-l">${f.l}</span></button>`).join('')}
    </div>
  </div>`;
}

// Les chiffres de l'agent, sous les yeux pendant le bilan. Mêmes
// calculs que la fiche de notation : on ne présente pas en entretien un
// chiffre différent de celui qui fera la note.
function _ogReviewCards() {
  const fo = OG.fo;
  const auto = typeof _perfAutoValues === 'function' ? _perfAutoValues(fo) : {};
  const card = typeof _perfMonthData === 'function' ? _perfMonthData(_perfMonthKey())[fo] : null;
  const note = typeof perfScore === 'function' ? perfScore(card).score : null;
  const tb = typeof _taskBreakdown === 'function' ? _taskBreakdown(fo, _perfMonthKey()) : null;
  const objs = _scoredObjectives(fo).filter(o => o.status !== 'dropped');
  const today = _o2oToday();
  const late = objs.filter(o => o.due && o.due < today && o.status !== 'done').length;
  const lateActs = _o2oAllActions(fo).filter(a => a.status === 'todo' && a.due && a.due < today).length;
  const tiles = [
    ['Score du mois', note == null ? 'n/a' : `${note}/100`, ''],
    ['SLA', auto.sla == null ? 'n/a' : `${auto.sla} %`, auto.sla != null && auto.sla < 90 ? 'warn' : ''],
    ['Tâches réalisées', tb ? `${tb.done}/${tb.total}` : 'n/a', tb && tb.score < 80 ? 'warn' : ''],
    ['Assiduité', auto.attendance == null ? 'n/a' : `${auto.attendance}/100`, ''],
    ['Compétences', auto.skills == null ? 'n/a' : `${auto.skills}/100`, ''],
    ['Objectifs en retard', String(late), late ? 'bad' : 'ok'],
    ['Actions en retard', String(lateActs), lateActs ? 'bad' : 'ok'],
  ];
  return `<div class="og-tiles">${tiles.map(([l, v, t]) => `
    <div class="og-tile${t ? ' is-' + t : ''}"><div class="og-tile-v">${esc(v)}</div><div class="og-tile-l">${esc(l)}</div></div>`).join('')}
  </div>`;
}

function _ogObjectivesReview() {
  const objs = _scoredObjectives(OG.fo).filter(o => o.status !== 'dropped');
  if (!objs.length) return '<div class="og-empty">Aucun objectif suivi dans la session en cours. L\'atelier SMART, à l\'étape suivante, permet d\'en poser un.</div>';
  return `<div class="og-objs">${objs.map(o => {
    const key = o.id || o.title;
    const r = OG.review[key] || {};
    const pct = o._pct ?? _objProgress(o);
    return `<div class="og-obj">
      <div class="og-obj-h">
        <div class="og-obj-t">${esc(o.title || '')}</div>
        <div class="og-obj-p"><span style="width:${pct}%"></span></div>
        <div class="og-obj-n">${pct} %${o.due ? ` · échéance ${esc(o.due)}` : ''}</div>
      </div>
      <div class="og-pills">${O2O_REVIEW_STATUS.map(s => `
        <button class="og-pill is-${s.id}${r.status === s.id ? ' is-on' : ''}"
          onclick="o2oGuideReview('${esc(String(key)).replace(/'/g, "\\'")}','${s.id}')">${s.l}</button>`).join('')}
      </div>
      <textarea class="og-q-a" rows="1" placeholder="Ce qui a été dit sur cet objectif"
        oninput="autoGrow(this);o2oGuideReviewNote('${esc(String(key)).replace(/'/g, "\\'")}',this.value)">${esc(r.note || '')}</textarea>
    </div>`;
  }).join('')}</div>`;
}

// ── Atelier SMART ─────────────────────────────────────────────
function _ogSmartBody() {
  const s = OG.smart;
  const g = O2O_SMART_GUIDE.find(x => x.k === OG.smartTab) || O2O_SMART_GUIDE[0];
  const rep = OG.smartReport;
  const part = k => rep?.parts?.[O2O_SMART_PARTS[k]];
  const tone = k => { const p = part(k); if (!p) return ''; return p.score >= 18 ? 'ok' : p.score >= 10 ? 'mid' : 'low'; };
  const sess = (state.config.objective_sessions || []).find(x => x.state === 'open');

  const fields = {
    S: `<label class="og-f">Objectif (verbe d'action + résultat)
          <input class="form-control" maxlength="400" value="${esc(s.title)}" placeholder="Ex. Réduire le MTTR des tickets P2 du domaine MMC"
                 oninput="o2oGuideSmart('title',this.value)"></label>
        <label class="og-f">Périmètre
          <input class="form-control" maxlength="200" value="${esc(s.scope)}" placeholder="Ex. tickets P2 MMC, site principal"
                 oninput="o2oGuideSmart('scope',this.value)"></label>`,
    M: `<div class="og-f-row">
          <label class="og-f">Indicateur<input class="form-control" maxlength="200" value="${esc(s.kpi.name)}" placeholder="MTTR P2 MMC" oninput="o2oGuideSmart('kpi.name',this.value)"></label>
          <label class="og-f og-f-s">Cible<input class="form-control" maxlength="100" value="${esc(s.kpi.target)}" placeholder="4" oninput="o2oGuideSmart('kpi.target',this.value)"></label>
          <label class="og-f og-f-s">Unité<input class="form-control" maxlength="30" value="${esc(s.kpi.unit)}" placeholder="h" oninput="o2oGuideSmart('kpi.unit',this.value)"></label>
        </div>
        <label class="og-f">Source de la mesure
          <input class="form-control" maxlength="200" value="${esc(s.kpi.source)}" placeholder="ServiceNow, rapport mensuel"
                 oninput="o2oGuideSmart('kpi.source',this.value)"></label>`,
    A: `<label class="og-f">Moyens nécessaires (temps, outil, formation, aide)
          <textarea class="form-control" rows="2" maxlength="500" oninput="autoGrow(this);o2oGuideSmart('need',this.value)"
                    placeholder="Ex. 2 h par semaine de revue avec le N2, accès au tableau de bord U2020">${esc(s.need)}</textarea></label>`,
    R: `<label class="og-f">Pourquoi c'est important
          <textarea class="form-control" rows="2" maxlength="600" oninput="autoGrow(this);o2oGuideSmart('why',this.value)"
                    placeholder="Ex. Le MTTR P2 MMC est le plus haut de l'équipe et pèse sur le SLA du site">${esc(s.why)}</textarea></label>
        <label class="og-f">Contribution à l'équipe
          <input class="form-control" maxlength="200" value="${esc(s.contrib)}" placeholder="Ex. SLA du site à 95 %"
                 oninput="o2oGuideSmart('contrib',this.value)"></label>`,
    T: `<label class="og-f og-f-s">Échéance
          <input class="form-control" type="date" value="${esc(s.due)}" ${sess ? `min="${esc(sess.start)}" max="${esc(sess.end)}"` : ''}
                 onchange="o2oGuideSmart('due',this.value)"></label>
        <div class="og-f">Jalons datés
          ${s.steps.map((st, i) => `<div class="og-f-row">
            <input class="form-control" maxlength="300" value="${esc(st.label)}" placeholder="Étape ${i + 1}"
                   oninput="o2oGuideStep(${i},'label',this.value)">
            <input class="form-control og-f-date" type="date" value="${esc(st.due)}" onchange="o2oGuideStep(${i},'due',this.value)">
            <button class="og-q-del" onclick="o2oGuideStepDel(${i})" aria-label="Retirer">×</button>
          </div>`).join('')}
          <button class="og-link" onclick="o2oGuideStepAdd()">+ Ajouter un jalon</button>
        </div>`,
  };

  return `<div class="og-smart">
    <div class="og-smart-l">
      <div class="og-letters">${O2O_SMART_GUIDE.map(x => `
        <button class="og-letter is-${tone(x.k)}${x.k === OG.smartTab ? ' is-on' : ''}" onclick="o2oGuideSmartTab('${x.k}')">
          <b>${x.k}</b><span>${x.name}</span></button>`).join('')}
      </div>
      <div class="og-card">
        <div class="og-card-q">${g.q.map(q => `<div>« ${esc(q)} »</div>`).join('')}</div>
        <div class="og-card-tip">${esc(g.tip)}</div>
        ${fields[g.k]}
        ${part(g.k)?.issues?.length ? `<ul class="og-issues">${part(g.k).issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
      </div>
    </div>
    <aside class="og-smart-r">
      ${_ogRing(rep)}
      <div class="og-prev-t">Aperçu</div>
      <div class="og-prev">${_ogSmartSentence()}</div>
      ${sess ? '' : '<div class="og-warn">Aucune session d\'objectifs ouverte : l\'objectif ne peut pas être créé.</div>'}
      <button class="btn btn-primary og-create" onclick="o2oGuideCreateObjective()" ${sess ? '' : 'disabled'}>
        Créer l'objectif pour ${esc(OG.fo)}</button>
      <div class="og-small">Il naît approuvé dans ${esc(sess ? sess.name : 'la session ouverte')} et compte dans la note « Individual objectives ».</div>
      ${OG.created.length ? `<div class="og-created"><div class="og-prev-t">Créés pendant la séance</div>
        ${OG.created.map(t => `<div class="og-created-i">✓ ${esc(t)}</div>`).join('')}</div>` : ''}
    </aside>
  </div>`;
}

function _ogRing(rep) {
  const v = rep ? rep.score : 0;
  const R = 34, C = 2 * Math.PI * R;
  const cls = !rep ? '' : rep.pass ? 'ok' : v >= 50 ? 'mid' : 'low';
  return `<div class="og-ring is-${cls}">
    <svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="${R}"/>
      <circle cx="40" cy="40" r="${R}" class="og-ring-arc" stroke-dasharray="${C.toFixed(1)}"
              stroke-dashoffset="${(C - C * v / 100).toFixed(1)}"/></svg>
    <div class="og-ring-v">${v}<small>/100</small></div>
    <div class="og-ring-l">${!rep ? 'Note SMART' : rep.pass ? 'Objectif solide' : 'À préciser'}</div>
  </div>`;
}

function _ogSmartSentence() {
  const s = OG.smart;
  if (!s.title.trim()) return '<span class="og-faint">L\'objectif s\'écrit ici au fil des réponses.</span>';
  const k = s.kpi;
  const bits = [`<b>${esc(s.title.trim())}</b>`];
  if (s.scope) bits.push(`sur ${esc(s.scope)}`);
  if (k.target) bits.push(`: ${esc(k.name || 'indicateur')} à ${esc(k.target)}${k.unit ? ' ' + esc(k.unit) : ''}${k.source ? ` (source : ${esc(k.source)})` : ''}`);
  if (s.due) bits.push(`d'ici le ${esc(new Date(s.due + 'T00:00:00').toLocaleDateString('fr-FR'))}`);
  const steps = s.steps.filter(x => x.label.trim());
  return bits.join(' ') + '.' + (steps.length ? `<br><span class="og-faint">${steps.length} jalon${steps.length > 1 ? 's' : ''}.</span>` : '')
    + (s.why ? `<br><span class="og-faint">Pourquoi : ${esc(s.why)}</span>` : '');
}

// Ce qui part au serveur : la raison réunit le « pourquoi », la
// contribution et les moyens — ce sont eux que l'admin relira.
function _ogSmartPayload() {
  const s = OG.smart;
  const why = [s.why.trim(), s.contrib.trim() && `Contribution : ${s.contrib.trim()}`,
               s.need.trim() && `Moyens : ${s.need.trim()}`].filter(Boolean).join('\n');
  const title = s.title.trim() + (s.scope.trim() ? ` (${s.scope.trim()})` : '');
  return {
    title, why, due: s.due,
    kpis: s.kpi.name.trim() || s.kpi.target.trim() ? [{ ...s.kpi }] : [],
    steps: s.steps.filter(x => x.label.trim()).map(x => ({ label: x.label.trim(), due: x.due })),
  };
}

function _ogSmartCheck() {
  clearTimeout(_ogSmartT);
  _ogSmartT = setTimeout(async () => {
    if (!OG) return;
    try {
      const res = await fetch(`${API}/api/objective-smart-check`, {
        method: 'POST', headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
        credentials: 'same-origin', body: JSON.stringify(_ogSmartPayload()) });
      if (res.ok) OG.smartReport = await res.json();
    } catch { /* note indisponible : l'atelier reste utilisable */ }
    // Seuls l'anneau, les lettres et les remarques bougent : refaire le
    // formulaire ferait perdre le curseur.
    if (OG && _ogTemplate()[OG.phase].id === 'smart') _ogRefreshSmartSide();
  }, 350);
}

function _ogRefreshSmartSide() {
  const host = document.querySelector('#og-overlay .og-smart');
  if (!host) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = _ogSmartBody();
  const fresh = tmp.firstElementChild;
  host.querySelector('.og-smart-r').replaceWith(fresh.querySelector('.og-smart-r'));
  host.querySelector('.og-letters').replaceWith(fresh.querySelector('.og-letters'));
  const iss = host.querySelector('.og-issues'), nIss = fresh.querySelector('.og-issues');
  if (iss && nIss) iss.replaceWith(nIss);
  else if (iss) iss.remove();
  else if (nIss) host.querySelector('.og-card').appendChild(nIss);
}

// ── Actions ───────────────────────────────────────────────────
function _ogActionsBody() {
  return `<div class="og-acts">
    ${OG.actions.map((a, i) => `<div class="og-act">
      <span class="og-act-n">${i + 1}</span>
      <input class="form-control" maxlength="300" value="${esc(a.text)}" placeholder="Action concrète"
             oninput="o2oGuideAct(${i},'text',this.value)">
      <select class="form-control og-act-o" onchange="o2oGuideAct(${i},'owner',this.value)">
        ${['Agent', 'Manager', 'Les deux'].map(o => `<option${o === a.owner ? ' selected' : ''}>${o}</option>`).join('')}
      </select>
      <input class="form-control og-f-date" type="date" value="${esc(a.due)}" onchange="o2oGuideAct(${i},'due',this.value)">
      <button class="og-q-del" onclick="o2oGuideActDel(${i})" aria-label="Retirer">×</button>
    </div>`).join('')}
    <button class="btn btn-ghost btn-sm" onclick="o2oGuideActAdd()">+ Ajouter une action</button>
    ${_ogActionHints()}
  </div>`;
}

// Propositions tirées de ce qui s'est dit : un besoin exprimé, un objectif
// bloqué. Un clic les transforme en action.
function _ogActionHints() {
  const hints = [];
  Object.entries(OG.review).forEach(([k, r]) => {
    if (r.status !== 'blocked' && r.status !== 'late') return;
    const o = _scoredObjectives(OG.fo).find(x => (x.id || x.title) === k);
    hints.push(`Débloquer l'objectif « ${o ? o.title : k} »`);
  });
  if ((OG.smart.need || '').trim()) hints.push(`Mettre en place : ${OG.smart.need.trim().slice(0, 120)}`);
  const growth = (OG.q.growth || []).map(q => OG.answers[q.id]).filter(x => x && x.trim());
  if (growth[1]) hints.push(`Inscrire à : ${growth[1].trim().slice(0, 120)}`);
  if (!hints.length) return '';
  return `<div class="og-hints"><div class="og-prev-t">Suggestions issues de l'échange</div>
    ${hints.map(h => `<button class="og-hint" onclick="o2oGuideActFromHint(this)">+ ${esc(h)}</button>`).join('')}</div>`;
}

function _ogRecap() {
  const answered = Object.values(OG.answers).filter(x => x && x.trim()).length;
  const acts = OG.actions.filter(a => a.text.trim());
  const sansDate = acts.filter(a => !a.due).length;
  const reviewed = Object.keys(OG.review).length;
  return `<div class="og-recap">
    <div class="og-tile"><div class="og-tile-v">${answered}</div><div class="og-tile-l">réponses notées</div></div>
    <div class="og-tile"><div class="og-tile-v">${reviewed}</div><div class="og-tile-l">objectifs revus</div></div>
    <div class="og-tile${OG.created.length ? ' is-ok' : ''}"><div class="og-tile-v">${OG.created.length}</div><div class="og-tile-l">objectif(s) SMART créés</div></div>
    <div class="og-tile${sansDate ? ' is-warn' : ''}"><div class="og-tile-v">${acts.length}</div><div class="og-tile-l">actions${sansDate ? `, ${sansDate} sans date` : ''}</div></div>
  </div>
  <label class="og-check"><input type="checkbox" id="og-push" checked> Envoyer les actions de l'agent dans My Tasks après l'enregistrement</label>`;
}

// ── Gestes ────────────────────────────────────────────────────
function o2oGuideAnswer(id, v) { OG.answers[id] = v; _ogSaveDraft(); }
function o2oGuideAsk(id) { OG.asked[id] = !OG.asked[id]; _ogSaveDraft(); _ogRender(); }
function o2oGuideMood(field, v) { OG[field] = v; _ogSaveDraft(); _ogRender(); }
function o2oGuideReview(key, status) {
  OG.review[key] = { ...(OG.review[key] || {}), status: OG.review[key]?.status === status ? '' : status };
  _ogSaveDraft(); _ogRender();
}
function o2oGuideReviewNote(key, v) { OG.review[key] = { ...(OG.review[key] || {}), note: v }; _ogSaveDraft(); }
function o2oGuideAddQ(pid) {
  const inp = document.getElementById('og-newq');
  const t = (inp?.value || '').trim();
  if (!t) return;
  OG.q[pid] = OG.q[pid] || [];
  OG.q[pid].push({ id: `${pid}-c${Date.now().toString(36)}`, t: t.slice(0, 200) });
  _ogSaveDraft(); _ogRender();
  document.getElementById('og-newq')?.focus();
}
function o2oGuideDelQ(pid, id) {
  OG.q[pid] = (OG.q[pid] || []).filter(q => q.id !== id);
  delete OG.answers[id];
  _ogSaveDraft(); _ogRender();
}
function o2oGuideSmartTab(k) { OG.smartTab = k; _ogSaveDraft(); _ogRender(); }
function o2oGuideSmart(path, v) {
  if (path.startsWith('kpi.')) OG.smart.kpi[path.slice(4)] = v; else OG.smart[path] = v;
  _ogSaveDraft();
  const prev = document.querySelector('#og-overlay .og-prev');
  if (prev) prev.innerHTML = _ogSmartSentence();
  _ogSmartCheck();
}
function o2oGuideStep(i, f, v) { OG.smart.steps[i][f] = v; _ogSaveDraft(); _ogSmartCheck(); }
function o2oGuideStepAdd() { OG.smart.steps.push({ label: '', due: '' }); _ogRender(); }
function o2oGuideStepDel(i) { OG.smart.steps.splice(i, 1); if (!OG.smart.steps.length) OG.smart.steps.push({ label: '', due: '' }); _ogRender(); _ogSmartCheck(); }
function o2oGuideAct(i, f, v) { OG.actions[i][f] = v; _ogSaveDraft(); }
function o2oGuideActAdd() { OG.actions.push({ text: '', owner: 'Agent', due: '' }); _ogRender(); }
function o2oGuideActDel(i) { OG.actions.splice(i, 1); if (!OG.actions.length) OG.actions.push({ text: '', owner: 'Agent', due: '' }); _ogRender(); }
function o2oGuideActFromHint(btn) {
  const t = btn.textContent.replace(/^\+\s*/, '').trim();
  const empty = OG.actions.find(a => !a.text.trim());
  if (empty) empty.text = t; else OG.actions.push({ text: t, owner: 'Agent', due: '' });
  _ogSaveDraft(); _ogRender();
}

function o2oGuideReset() {
  if (!confirm('Effacer la session en cours et recommencer ?')) return;
  try { localStorage.removeItem(_ogDraftKey(OG.fo)); } catch {}
  OG = _ogNew(OG.fo);
  _ogRender();
}

// Les questions de la séance deviennent la trame par défaut.
async function o2oGuideSaveTemplate() {
  if (!confirm('Enregistrer les questions actuelles comme modèle pour toutes les sessions guidées ?')) return;
  const tpl = Object.fromEntries(Object.entries(OG.q).map(([k, list]) => [k, list.map(q => q.t)]));
  const res = await fetch(`${API}/api/config`, {
    method: 'PUT', headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
    credentials: 'same-origin', body: JSON.stringify({ ...state.config, o2o_guide: tpl }) });
  if (!res.ok) { toast('Server error', 'error'); return; }
  await loadConfig();
  toast('Modèle de questions enregistré', 'success');
}

async function o2oGuideCreateObjective() {
  const p = _ogSmartPayload();
  if (!p.title) { OG.smartTab = 'S'; _ogRender(); toast('Écris d\'abord l\'objectif (S)', 'error'); return; }
  const sansDate = OG.smart.steps.some(x => x.label.trim() && !x.due);
  if (sansDate) { OG.smartTab = 'T'; _ogRender(); toast('Chaque jalon doit avoir une date', 'error'); return; }
  const rep = OG.smartReport;
  if (rep && !rep.pass && !confirm(`Note SMART ${rep.score}/100 : l'objectif reste à préciser. Le créer quand même ?`)) return;
  try {
    await _objRevApi('POST', `/${encodeURIComponent(OG.fo)}`, {
      ...p, by: (typeof rptDefaultAuthor === 'function' && rptDefaultAuthor()) || 'admin' });
  } catch (e) { toast(e.message, 'error'); return; }
  OG.created.push(p.title);
  OG.smart = _ogBlankSmart();
  OG.smartReport = null;
  OG.smartTab = 'S';
  _ogSaveDraft();
  await loadConfig();
  _ogRender();
  _ogSmartCheck();
  toast('Objectif créé et approuvé', 'success');
}

// ── Enregistrement ────────────────────────────────────────────
// L'entretien rejoint l'historique comme les autres : une rubrique par
// étape renseignée, au format question / réponse, et les actions
// structurées (statut, échéance) pour leur suivi.
async function o2oGuideFinish() {
  const tpl = _ogTemplate();
  const fo = OG.fo;
  const id = _o2oUid();
  const secs = [];
  tpl.forEach(ph => {
    const lines = [];
    if (ph.id === 'open' && OG.mood) lines.push(`Météo : ${O2O_MOOD_FACES.find(f => f.v === OG.mood)?.l}`);
    if (ph.id === 'objectives') {
      Object.entries(OG.review).forEach(([k, r]) => {
        const o = _scoredObjectives(fo).find(x => (x.id || x.title) === k);
        const st = O2O_REVIEW_STATUS.find(s => s.id === r.status)?.l;
        if (st || (r.note || '').trim()) lines.push(`• ${o ? o.title : k}${st ? ` [${st}]` : ''}${r.note?.trim() ? ` : ${r.note.trim()}` : ''}`);
      });
    }
    if (ph.id === 'smart' && OG.created.length) OG.created.forEach(t => lines.push(`• Objectif créé : ${t}`));
    (OG.q[ph.id] || []).forEach(q => {
      const a = (OG.answers[q.id] || '').trim();
      if (a) lines.push(`• ${q.t}\n  → ${a}`);
    });
    if (ph.id === 'close' && OG.moodEnd) lines.push(`Météo de fin : ${O2O_MOOD_FACES.find(f => f.v === OG.moodEnd)?.l}`);
    if (lines.length) secs.push({ id: `g-${ph.id}`, label: ph.label, text: lines.join('\n').slice(0, 4000) });
  });
  const acts = OG.actions.filter(a => a.text.trim());
  if (acts.length) {
    secs.push({ id: 'actions', label: 'Actions convenues', list: true,
      text: acts.map(a => `${a.text.trim()} (${a.owner}${a.due ? `, ${a.due}` : ''})`).join('\n') });
  }
  if (!secs.length) { toast('Rien à enregistrer pour l\'instant', 'error'); return; }

  const mood = OG.moodEnd || OG.mood;
  const minutes = Math.round((Date.now() - OG.started) / 60000);
  const m = {
    id, date: _o2oToday(), topic: `Session guidée (${minutes} min)`, sections: secs, guided: true,
    actions: acts.map((a, i) => ({ id: `${id}-a${i}`, text: a.text.trim(), owner: a.owner, status: 'todo', due: a.due || '' })),
  };
  if (mood) m.mood = mood >= 4 ? 'up' : mood === 3 ? 'flat' : 'down';
  const push = document.getElementById('og-push')?.checked;

  if (!(await _o2oCommit(fo, e => e.meetings.push(m)))) return;
  try { localStorage.removeItem(_ogDraftKey(fo)); } catch {}
  OG = null;
  o2oGuideClose();
  toast('Entretien enregistré', 'success');
  if (push && m.actions.some(a => a.owner !== 'Manager') && typeof o2oPushAllActions === 'function') o2oPushAllActions(fo);
}
