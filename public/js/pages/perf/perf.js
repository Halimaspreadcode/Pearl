// ══════════════════════════════════════════════════════════════
// PERFORMANCE FO — notation individuelle
// Le barème reprend le plan trimestriel : six critères pondérés qui
// font 100. Deux d'entre eux se mesurent depuis le Tracker (SLA et
// volume traité) : on les pré-remplit plutôt que de les faire ressaisir,
// mais ils restent modifiables — un mois atypique se corrige à la main.
// Les notes sont rangées par mois pour garder l'historique, sous
// config.fo_scorecards[mois][fo].
// ══════════════════════════════════════════════════════════════
const PERF_CRITERIA = [
  { id: 'sla',       label: 'SLA',                  weight: 20, auto: 'sla',
    hint: 'Tickets handled within SLA.' },
  // Handover a rejoint Process : un rapport de relève incomplet est un
  // écart de process comme un autre, et deux critères à 10-15 % pesaient
  // trop face aux objectifs individuels.
  { id: 'process',   label: 'Process & handover',   weight: 10,
    hint: 'Compliant escalations and notifications, complete handover report at every rotation.' },
  { id: 'attendance',label: 'Attendance',            weight: 15, auto: 'attendance',
    hint: 'Lateness and unexcused absences.' },
  { id: 'skills',    label: 'Skills',          weight: 10, auto: 'skills',
    hint: 'Certification (100) or internal quiz passed (80 max).' },
  { id: 'individual',label: 'Individual objectives',weight: 35, auto: 'individual',
    hint: 'Personal SMART objectives for the quarter.' },
  { id: 'tasks',     label: 'Tasks',                weight: 10, auto: 'tasks',
    hint: 'Completion rate of the tasks assigned for the month.' },
];

// Fiches notées avant la fusion : elles portent encore `handover` à part.
// On le replie dans Process (moyenne des deux s'ils sont tous deux notés)
// plutôt que de l'ignorer, sans quoi un mois noté seulement en handover
// perdrait cette note. Même règle côté serveur (services/perf.js).
function _perfLegacyCard(card) {
  if (!card || card.handover === undefined || card.handover === null || card.handover === '') return card;
  const h = Number(card.handover), p = Number(card.process);
  if (!isFinite(h)) return card;
  const hasP = card.process !== undefined && card.process !== null && card.process !== '' && isFinite(p);
  return { ...card, process: hasP ? Math.round((p + h) / 2) : h };
}

// État de la page : quel agent, quel mois, quelle vue.
const perfUI = { fo: null, month: null, tab: 'note' };

// Bascule entre les vues. Les onglets sont ceux de la page Équipe
// (team-hub.js), qui pose perfUI.tab puis appelle renderPerfPage().
const PERF_TABS = ['note', 'o2o', 'team', 'review', 'sessions'];

function setPerfTab(tab) {
  if (!PERF_TABS.includes(tab)) return;
  // Ne pas perdre une notation en cours de saisie en changeant de vue.
  if (perfUI.tab === 'note' && tab !== 'note') _perfCaptureInputs();
  perfUI.tab = tab;
  if (tab === 'review') loadObjReview();
  if (tab === 'sessions') renderObjSessions();

  PERF_TABS.forEach(t => {
    const view = document.getElementById(`perf-view-${t}`);
    if (view) view.hidden = t !== tab;
  });

  // Le bouton « Enregistrer » ne concerne que la notation : les deux
  // autres vues enregistrent d'elles-mêmes à chaque geste, un bouton
  // inerte y ferait douter que le travail est sauvegardé.
  const fab = document.querySelector('#page-cfg-perf .gsla-fab');
  if (fab) fab.hidden = tab !== 'note';
}

function _perfMonthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function _perfScorecards() { return state.config.fo_scorecards || {}; }
// Le critère Tasks se lit en direct : enregistré dans la fiche, il restait
// figé à sa valeur du jour de la notation, et une tâche terminée ensuite ne
// comptait jamais. Seule une note saisie à la main (_ovr.tasks) le fige.
//
// `tous` : ajoute aussi les agents sans fiche ce mois-ci mais avec des
// tâches échues — leur critère Tasks compte alors seul (classement
// d'équipe). Sans ce drapeau, un agent non noté reste non noté.
function _perfMonthData(month, tous) {
  const brut = { ..._perfScorecards()[month] || {} };
  if (tous) for (const fo of state.config.fo_list || []) if (!brut[fo]) brut[fo] = {};
  const out = {};
  for (const [fo, card] of Object.entries(brut)) {
    if (!card || typeof card !== 'object' || card._ovr?.tasks || card._neutre) { out[fo] = card; continue; }
    const d = typeof _taskBreakdown === 'function' ? _taskBreakdown(fo, month) : null;
    const c = { ...card };
    if (d) c.tasks = d.score; else delete c.tasks;
    if (Object.keys(c).length) out[fo] = c;
  }
  return out;
}

// Les deux critères mesurables, tirés du dashboard courant.
// Trois critères sur six se calculent à partir de ce que le Tracker sait
// déjà. Ils restent modifiables : la mesure propose, le FO Leader
// dispose — un mois atypique, un contexte que la donnée ignore, et la
// note saisie prime (voir _perfValue).
//
//  • sla        — tickets tenus dans les délais (déjà en place)
//  • individual — suivi O2O : avancement, échéances tenues et actions
//                 convenues effectivement reprises en entretien
//  • skills     — certification (100), sinon parcours quiz : maîtrise,
//                 couverture, constance et progression
//  • attendance — servi par /api/absences/scores, chargé à part
//  • tasks      — taux de réalisation des tâches assignées du mois
// SLA de l'agent sur le mois noté : tickets ouverts ou clos ce mois-là,
// dans le périmètre SLA. Pas de ticket ce mois-ci → pas de note (null),
// plutôt que le taux de tout son historique, qui donnait une note SLA à
// des agents sans shift depuis des mois.
function _perfSlaMonth(fo, month) {
  const m = ((state.dashboard?.by_fo_sla_monthly || {})[fo] || {})[month || perfUI.month || _perfMonthKey()];
  if (!m || !m.scope) return { scope: 0, breach: 0, rate: null };
  return { scope: m.scope, breach: m.breach || 0, rate: Math.round((1 - (m.breach || 0) / m.scope) * 100) };
}

function _perfAutoValues(fo) {
  const out = {
    sla: _perfSlaMonth(fo).rate,
    individual: _autoObjectiveScore(fo),
    skills: _autoSkillScore(fo),
    attendance: (state.attendanceScores || {})[fo]?.score ?? null,
    tasks: _autoTaskScore(fo),
  };
  return out;
}

// Tâches (10 % du barème) : taux de réalisation des tâches assignées sur
// le mois noté. Mêmes deux registres que l'activité du FO Dashboard
// (fo-activity.js) : Daily Check-up (fo_tasks, assigned_to) et toutes les
// tâches de son espace Tâches (weekly_progress, modified_by) : données
// depuis Équipe › Tâches, envoyées d'un One-to-One ou ajoutées par l'agent.
// Ne compter que les premières laissait de côté tout ce que l'agent voit
// terminé dans son espace. Une tâche n'existe que dans l'un des deux.
//
// Ne comptent que les tâches déjà exigibles — échéance passée ou du jour —
// plus celles faites en avance : le 3 du mois, les occurrences des
// semaines suivantes ne doivent pas tirer la note vers le bas. La tâche
// parente d'une récurrence n'est qu'un gabarit : seules ses occurrences
// sont des unités de travail.
function _taskBreakdown(fo, month) {
  const range = _attendanceRange(month || perfUI.month || _perfMonthKey());
  if (!range) return null;
  const today = new Date().toISOString().slice(0, 10);
  const until = today < range.to ? today : range.to;
  const day = d => d ? String(d).slice(0, 10) : '';
  const enMois = d => d >= range.from && d <= range.to;
  const compte = (d, done) => enMois(d) && (done || d <= until);

  const chk = (state.foTasks || []).filter(t => t.assigned_to === fo
    && !(!t.is_occurrence && t.status === 'Recurring')
    && compte(day(t.due_date || t.created_at), t.status === 'Done'));
  const asg = (state.weeklyProgress || []).filter(p => p.modified_by === fo
    && compte(day(p.due_date || p.week_start || p.created_at), p.status === 'Done'));

  const total = chk.length + asg.length;
  // Sans tâche exigible, on ne propose rien : un zéro dirait « rien fait »
  // là où il n'y avait simplement rien à faire.
  if (!total) return null;
  const done = chk.filter(t => t.status === 'Done').length
             + asg.filter(p => p.status === 'Done').length;
  return { score: Math.round(done / total * 100), done, total };
}

// Tâches du mois pas encore échues : elles ne comptent pas dans la note,
// mais l'écran doit dire qu'elles existent — sinon « aucune tâche » laisse
// croire que l'agent n'a rien à faire.
function _taskUpcoming(fo, month) {
  const range = _attendanceRange(month || perfUI.month || _perfMonthKey());
  if (!range) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const day = d => d ? String(d).slice(0, 10) : '';
  const futur = d => d > today && d >= range.from && d <= range.to;
  return (state.foTasks || []).filter(t => t.assigned_to === fo && t.status !== 'Done'
      && !(!t.is_occurrence && t.status === 'Recurring') && futur(day(t.due_date || t.created_at))).length
    + (state.weeklyProgress || []).filter(p => p.modified_by === fo && p.status !== 'Done'
      && futur(day(p.due_date || p.week_start || p.created_at))).length;
}

// ── MISES À JOUR DE PERFORMANCE ──────────────────────────────
// Une fiche enregistrée fige les mesures du jour (SLA, objectifs,
// compétences, assiduité). Les jours suivants, les chiffres bougent —
// tickets clos, quiz passés, jalons tenus — sans que rien ne le signale :
// il fallait ouvrir chaque fiche pour s'en apercevoir. On compare donc la
// mesure actuelle à celle enregistrée.
//
// À l'enregistrement, la fiche garde la photo des mesures (_mesures). Une
// note égale à sa mesure suit la mesure ; une note qui s'en écarte est un
// choix de l'admin : signalée, jamais écrasée sans clic. Les fiches
// enregistrées avant cette photo sont comparées directement.
// Tasks n'est pas suivi ici : il se lit déjà en direct (_perfMonthData).
const PERF_SUIVIS = ['sla', 'individual', 'skills', 'attendance'];

function _perfAvecMois(month, fn) {
  const avant = perfUI.month;
  perfUI.month = month;
  try {
    const r = fn();
    // L'assiduité chargée vaut pour un mois précis : pour un autre, pas de mesure.
    if (r && typeof r === 'object' && 'attendance' in r && state.attendanceMonth && state.attendanceMonth !== month) r.attendance = null;
    return r;
  } finally { perfUI.month = avant; }
}

function perfMisesAJour(fo, month) {
  month = month || _perfMonthKey();
  const carte = _perfLegacyCard(((_perfScorecards()[month] || {})[fo]) || null);
  if (carte && carte._neutre) return { fo, month, etat: 'neutre', changes: [] };
  const auto = _perfAvecMois(month, () => _perfAutoValues(fo));
  const num = v => (v === undefined || v === null || v === '' || !isFinite(Number(v))) ? null : Number(v);
  const notee = carte && PERF_CRITERIA.some(c => num(carte[c.id]) !== null);
  const changes = [];
  for (const id of PERF_SUIVIS) {
    const a = num(auto[id]);
    if (a === null) continue;
    const def = PERF_CRITERIA.find(c => c.id === id);
    const enregistre = notee ? num(carte[id]) : null;
    const photo = carte && carte._mesures ? num(carte._mesures[id]) : null;
    if (!notee) { changes.push({ id, label: def?.label || id, avant: null, maintenant: a, manuel: false }); continue; }
    if (enregistre === null) { changes.push({ id, label: def?.label || id, avant: null, maintenant: a, manuel: false }); continue; }
    const ref = photo !== null ? photo : enregistre;
    if (Math.abs(a - ref) < 1) continue;
    // Note saisie à la main (différente de la mesure du jour d'enregistrement).
    const manuel = photo !== null && Math.abs(enregistre - photo) >= 1;
    changes.push({ id, label: def?.label || id, avant: enregistre, maintenant: a, manuel });
  }
  return { fo, month, etat: !notee ? (changes.length ? 'non_note' : 'vide') : (changes.length ? 'a_jour_a_faire' : 'a_jour'), changes };
}

function perfMisesAJourEquipe(month) {
  return _perfFoList().map(fo => perfMisesAJour(fo, month))
    .filter(r => r.etat === 'a_jour_a_faire');
}

// Reporte les mesures dans la fiche. `forcer` : y compris les notes
// saisies à la main (sur demande explicite, ligne par ligne).
async function perfAppliquerMesures(fos, month, forcer) {
  month = month || _perfMonthKey();
  const cards = JSON.parse(JSON.stringify(_perfScorecards()));
  cards[month] = cards[month] || {};
  let n = 0;
  for (const fo of [].concat(fos)) {
    const r = perfMisesAJour(fo, month);
    const ok = r.changes.filter(c => forcer || !c.manuel);
    if (!ok.length || r.etat === 'non_note') continue;
    const carte = { ...(cards[month][fo] || {}) };
    ok.forEach(c => { carte[c.id] = c.maintenant; });
    const auto = _perfAvecMois(month, () => _perfAutoValues(fo));
    carte._mesures = { ...(carte._mesures || {}), ...Object.fromEntries(ok.map(c => [c.id, auto[c.id]])) };
    carte._mesures_at = new Date().toISOString();
    cards[month][fo] = carte;
    n++;
  }
  if (!n) return 0;
  const res = await fetch(`${API}/api/config`, {
    method: 'PUT', headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
    credentials: 'same-origin', body: JSON.stringify({ ...state.config, fo_scorecards: cards }),
  });
  if (!res.ok) throw new Error('Enregistrement impossible');
  await loadConfig();
  return n;
}

const _perfMajTxt = c => c.avant === null ? `${c.label} : ${c.maintenant}` : `${c.label} ${c.avant} → ${c.maintenant}${c.manuel ? ' (note saisie à la main)' : ''}`;

// Bandeau de l'onglet Agents : qui a bougé depuis sa dernière notation.
function perfMajPanelHtml(month) {
  month = month || _perfMonthKey();
  const liste = perfMisesAJourEquipe(month);
  if (!liste.length) return '';
  const q = v => `'${esc(v).replace(/'/g, "\\'")}'`;
  const auto = liste.filter(r => r.changes.some(c => !c.manuel));
  return `<section class="perf-maj">
    <div class="perf-maj-h">
      <div><b>Performance : ${liste.length} fiche${liste.length > 1 ? 's' : ''} à mettre à jour</b>
        <span>Les mesures de ${esc(typeof _eqMonthLabel === 'function' ? _eqMonthLabel(month) : month)} ont bougé depuis la dernière notation.</span></div>
      ${auto.length > 1 ? `<button type="button" class="eq-btn is-pri" onclick="perfMajTout('${month}')">Tout reporter (${auto.length})</button>` : ''}
    </div>
    <ul>${liste.map(r => `<li>
      <span class="perf-maj-n">${esc(r.fo)}</span>
      <span class="perf-maj-c">${r.changes.map(c => `<em class="${c.manuel ? 'is-man' : ''}">${esc(_perfMajTxt(c))}</em>`).join('')}</span>
      <span class="perf-maj-a">
        ${r.changes.some(c => !c.manuel) ? `<button type="button" class="eq-btn" onclick="perfMajUn(${q(r.fo)},'${month}')">Reporter</button>` : ''}
        <button type="button" class="eq-btn is-ghost" onclick="eqOpenAgent(${q(r.fo)},'perf')">Ouvrir</button>
      </span></li>`).join('')}</ul>
  </section>`;
}

async function perfMajUn(fo, month) {
  try { const n = await perfAppliquerMesures(fo, month); toast(n ? `Fiche de ${fo} mise à jour` : 'Rien à reporter', n ? 'success' : 'info'); }
  catch (e) { toast(e.message, 'error'); }
  if (typeof _eqRenderContent === 'function') _eqRenderContent();
}

async function perfMajFiche() {
  try { await perfAppliquerMesures(perfUI.fo, perfUI.month); toast('Fiche mise à jour', 'success'); }
  catch (e) { toast(e.message, 'error'); }
  renderPerfSheet();
}

async function perfMajTout(month) {
  const fos = perfMisesAJourEquipe(month).filter(r => r.changes.some(c => !c.manuel)).map(r => r.fo);
  if (!fos.length) return;
  if (!confirm(`Reporter les nouvelles mesures dans ${fos.length} fiche(s) ?\n\nLes notes saisies à la main ne sont pas touchées.`)) return;
  try { const n = await perfAppliquerMesures(fos, month); toast(`${n} fiche(s) mise(s) à jour`, 'success'); }
  catch (e) { toast(e.message, 'error'); }
  if (typeof _eqRenderContent === 'function') _eqRenderContent();
}

function _autoTaskScore(fo) {
  const d = _taskBreakdown(fo);
  return d ? d.score : null;
}

// Objectifs individuels (35 % du barème). L'avancement seul ne disait pas
// tout : un objectif avancé à 80 % mais en retard de deux mois, ou une
// action convenue en entretien jamais reprise, ne se voyaient nulle part.
// Trois dimensions, toutes issues du suivi O2O :
//
//   Avancement 60 %  moyenne d'avancement des objectifs actifs
//   Échéances  20 %  part des objectifs actifs qui ne sont pas en retard
//   Actions    20 %  part des actions convenues effectivement suivies
//
// Un objectif abandonné sort du calcul — il ne pénalise pas, il n'a
// simplement plus cours. Sans objectif ni entretien, on ne propose rien
// plutôt que d'inventer un zéro.
function _autoObjectiveScore(fo) {
  const d = _o2oBreakdown(fo);
  return d ? d.score : null;
}

// Détail du calcul, réutilisé par l'infobulle et par la page Suivi O2O :
// une note qu'on ne peut pas expliquer à l'agent est indéfendable.
// Les objectifs de la note viennent du flux agent (fo_objectives) dès
// qu'il en porte pour cet agent, sinon de l'ancien plan (fo_o2o).
//
// C'est ce qui permet aux deux mondes de coexister le temps de la
// bascule : un agent déjà repris est noté sur ce qu'il suit vraiment,
// un agent pas encore repris continue d'être noté comme avant. Une fois
// tout le monde repris, la branche fo_o2o ne sert plus.
//
// Seuls les objectifs approuvés comptent : un brouillon ou une
// proposition en attente ne doit pas peser sur une note mensuelle.
// Même règle que le serveur (server/objectives.js) : un jalon tenu hors
// délai ne compte que pour moitié. Le client recalcule l'avancement pour
// les vues qui n'ont pas la réponse serveur sous la main — si les deux
// barèmes divergeaient, la même barre afficherait deux valeurs selon
// l'écran, et plus personne ne saurait laquelle croire.
const LATE_STEP_WEIGHT = 0.5;

function _stepLate(s, today) {
  if (!s || !s.due) return false;
  const ref = today || _o2oToday();
  if (s.done) return !!s.done_at && String(s.done_at).slice(0, 10) > s.due;
  return s.due < ref;
}

// Avancement pondéré sur une liste de jalons déjà filtrée (approuvés).
function _stepsPct(steps, today) {
  if (!steps || !steps.length) return null;
  const gagne = steps.filter(s => s.done)
    .reduce((n, s) => n + (_stepLate(s, today) ? LATE_STEP_WEIGHT : 1), 0);
  return Math.round(gagne / steps.length * 100);
}

// ── Session d'objectifs affichée ─────────────────────────────
// Les objectifs approuvés s'accumulent d'une session à l'autre : sans
// filtre, le Profil One-to-One et Équipe › Objectifs mêlaient ceux du
// trimestre clos à ceux du trimestre en cours. Par défaut on montre la
// session ouverte (à défaut la plus récente) ; le sélecteur permet de
// remonter aux précédentes. Le choix est partagé entre les deux vues :
// regarder le T2 d'un agent puis passer au suivi d'équipe reste sur T2.
//
// ObjSess.sid : null = session par défaut, 'all' = toutes, sinon un id.
// La page My Performance garde sa propre sélection (scope 'me') : ce que
// l'agent consulte ne doit pas déplacer les vues du manager, ni l'inverse
// quand l'admin contrôle la fiche d'un agent.
const ObjSess = { sid: null };
const _OBJ_SESS_SCOPES = { team: ObjSess, me: { sid: null } };
function _objSessState(scope) { return _OBJ_SESS_SCOPES[scope] || ObjSess; }

// Sessions de la plus récente à la plus ancienne.
function _objSessions(list) {
  return [...(list || state.config.objective_sessions || [])]
    .sort((a, b) => String(b.start || b.created || '').localeCompare(String(a.start || a.created || '')));
}

function _objDefaultSessionId(list) {
  const all = _objSessions(list);
  return (all.find(s => s.state === 'open') || all[0] || {}).id || null;
}

// Session effectivement affichée : 'all', un id, ou 'all' s'il n'existe
// aucune session (on montre alors tout, faute de mieux).
function objCurSessionId(list, scope) {
  const all = _objSessions(list);
  const st = _objSessState(scope);
  if (st.sid === 'all') return 'all';
  if (st.sid && all.some(s => s.id === st.sid)) return st.sid;
  return _objDefaultSessionId(list) || 'all';
}

function objInSession(o, sid) {
  return !sid || sid === 'all' || o.session === sid;
}

// Sélecteur ‹ session › : `repaint` est le nom de la fonction globale à
// rappeler après changement, `scope` la sélection à modifier.
function objSessionPicker(repaint, list, scope) {
  const all = _objSessions(list);
  if (!all.length) return '';
  const sc = scope || 'team';
  const cur = objCurSessionId(list, sc);
  const i = all.findIndex(s => s.id === cur);
  // Flèches dans le sens de lecture : ‹ remonte le temps, › y revient.
  const older = cur === 'all' ? null : all[i + 1];
  const newer = cur === 'all' ? null : all[i - 1];
  const btn = (s, lbl, title) => `<button type="button" class="objsess-nav"
    ${s ? `onclick="objSetSession('${esc(s.id)}','${repaint}','${sc}')"` : 'disabled'}
    title="${title}" aria-label="${title}">${lbl}</button>`;
  const ouverte = sc === 'me' ? ' (current)' : ' (ouverte)';
  const toutes  = sc === 'me' ? 'All sessions' : 'Toutes les sessions';
  return `<span class="objsess">
    ${btn(older, '‹', sc === 'me' ? 'Previous session' : 'Session précédente')}
    <select class="form-control objsess-sel" aria-label="Session"
            onchange="objSetSession(this.value,'${repaint}','${sc}')">
      ${all.map(s => `<option value="${esc(s.id)}"${s.id === cur ? ' selected' : ''}>${
        esc(s.name || s.id)}${s.state === 'open' ? ouverte : ''}</option>`).join('')}
      <option value="all"${cur === 'all' ? ' selected' : ''}>${toutes}</option>
    </select>
    ${btn(newer, '›', sc === 'me' ? 'Next session' : 'Session suivante')}
  </span>`;
}

function objSetSession(sid, repaint, scope) {
  _objSessState(scope).sid = sid || null;
  if (typeof window[repaint] === 'function') window[repaint]();
}

// `sid` : session à retenir, 'all' pour toutes. Par défaut la session
// courante (ouverte, sinon la plus récente) et non celle du sélecteur :
// la note du mois ne doit pas changer parce que quelqu'un consulte un
// trimestre passé dans le Profil. Seuls les affichages qui portent le
// sélecteur passent objCurSessionId(). Un agent qui porte des objectifs approuvés dans le flux agent
// reste dans ce flux même si la session choisie n'en contient aucun : on
// ne retombe sur l'ancien plan que s'il n'a jamais été repris.
function _scoredObjectives(fo, sid) {
  const fresh = (state.config.fo_objectives || {})[fo] || [];
  const allApproved = fresh.filter(o => o.state === 'approved');
  const cur = sid || _objDefaultSessionId() || 'all';
  const approved = allApproved.filter(o => objInSession(o, cur));
  if (allApproved.length) {
    return approved.map(o => ({
      // L'intitulé est conservé : d'autres calculs le lisent, comme la
      // détection d'une certification acquise pour le critère « skills ».
      title: o.title,
      status: o.progress,
      due: o.due,
      // Champs d'affichage du flux agent, pour que la page Profil montre
      // l'objectif tel que l'agent le suit : ses indicateurs et ses
      // jalons, et non la ligne figée de l'ancien plan.
      id: o.id,
      kpi: (o.kpis || []).filter(k => k.state === 'approved')
        .map(k => [k.name, k.target, k.unit].filter(Boolean).join(' ').trim())
        .filter(Boolean).join(' · '),
      steps: (o.steps || []).filter(s => s.state === 'approved'),
      session: o.session,
      _fresh: true,
      // L'avancement du nouveau modèle ne compte que les jalons
      // approuvés ET faits — on le recalcule ici pour ne pas dépendre
      // de `progress_pct`, qui n'est posé que par le serveur.
      _pct: (() => {
        const st = (o.steps || []).filter(s => s.state === 'approved');
        if (!st.length) return o.progress === 'done' ? 100 : o.progress === 'doing' ? 50 : 0;
        return _stepsPct(st);
      })(),
    }));
  }
  return _o2oFor(fo).objectives;
}

function _o2oBreakdown(fo, sid) {
  const { meetings } = _o2oFor(fo);
  const objectives = _scoredObjectives(fo, sid);
  const actifs = objectives.filter(o => o.status !== 'dropped');
  if (!actifs.length && !meetings.length) return null;

  const today = _o2oToday();

  const avancement = actifs.length
    ? Math.round(actifs.reduce((n, o) => n + (o._pct ?? _objProgress(o)), 0) / actifs.length)
    : null;

  // Échéances : on ne juge que ce qui a une date. Un objectif atteint est
  // tenu quelle que soit sa date — c'est le retard en cours qui compte.
  const dates = actifs.filter(o => o.due);
  const retard = dates.filter(o => o.status !== 'done' && o.due < today);
  const echeances = dates.length
    ? Math.round((1 - retard.length / dates.length) * 100) : null;

  // Agreed actions: commitments made in review, with their status set by
  // hand. We score the share actually done among the decidable ones —
  // done or overdue. Anything still within its deadline is not judged,
  // and an owned drop does not penalise.
  const act = _o2oActionStats(fo, meetings);
  const actions = act.taux;

  // Somme pondérée sur les seules dimensions mesurables : sans échéance
  // ni action, la note reste celle de l'avancement, non diluée par des
  // zéros qui ne veulent rien dire.
  const parts = [[avancement, 0.60], [echeances, 0.20], [actions, 0.20]]
    .filter(([v]) => v !== null);
  const poids = parts.reduce((n, [, w]) => n + w, 0);
  if (!poids) return null;
  const score = Math.round(parts.reduce((n, [v, w]) => n + v * w, 0) / poids);

  return {
    score, avancement, echeances, actions,
    nbObjectifs: actifs.length,
    nbAtteints: actifs.filter(o => o.status === 'done').length,
    nbRetard: retard.length,
    actionsTotal: act.total, actionsSuivies: act.suivies, actionsOuvertes: act.ouvertes,
    actionsRetard: act.retard, actionsAbandon: act.abandonnees, actionsJugees: act.jugees,
    nbEntretiens: meetings.length,
    dernierEntretien: meetings.length
      ? meetings.map(m => m.date).sort().slice(-1)[0] : null,
  };
}

// ── Agreed actions ────────────────────────────────────────────
// An agreed action is a commitment made during a review. It therefore
// carries its own status, set by the FO Leader, instead of being inferred
// from the mere fact that a later review took place.
//
// The old rule — "followed up as soon as a later review happened" —
// mechanically validated every action from the previous month. It measured
// whether reviews were held, not whether the work was done: the only way
// to lower the score was to stop meeting the agent altogether.
const O2O_ACTION_STATUSES = [
  { id: 'todo', label: 'To do',    key: 'todo' },
  { id: 'done', label: 'Faite',      key: 'done' },
  { id: 'drop', label: 'Dropped', key: 'drop' },
];

function _o2oActionLabel(st) {
  return (O2O_ACTION_STATUSES.find(s => s.id === st) || O2O_ACTION_STATUSES[0]).label;
}

// Reviews recorded before this version only carry the free-text field.
// They are read on the fly, one line = one "to do" action, without
// rewriting the config: migration happens on the first status change,
// which avoids a mass write of data we can already derive.
function _o2oActionsOf(meeting) {
  if (Array.isArray(meeting.actions)) return meeting.actions;
  const sec = (meeting.sections || []).find(s => s.id === 'actions');
  if (!sec || !sec.text) return [];
  return String(sec.text).split('\n').map(s => s.trim()).filter(Boolean)
    .map((text, i) => ({
      id: `${meeting.id}-a${i}`,
      text,
      status: 'todo',
      due: '',
      legacy: true,      // derived from text, not yet materialised
    }));
}

// Every action for an agent, each one knowing where it came from.
function _o2oAllActions(fo, meetings) {
  const list = meetings || _o2oFor(fo).meetings;
  const out = [];
  [...list].sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .forEach(m => _o2oActionsOf(m).forEach(a => out.push({ ...a, meetingId: m.id, date: m.date })));
  return out;
}

// An action is overdue when its due date has passed and it is neither
// done nor dropped.
function _o2oActionLate(a, today) {
  return a.status === 'todo' && !!a.due && a.due < (today || _o2oToday());
}

// Statistics feeding the score. The rate is computed over *decidable*
// actions: done, or overdue. A to-do action whose due date has not been
// reached counts neither for nor against — judging it early would punish
// a deadline that is still running.
//
// Drops leave the calculation, like dropped objectives: an action the
// context has made moot is not a failure of the agent.
function _o2oActionStats(fo, meetings) {
  const today = _o2oToday();
  const all = _o2oAllActions(fo, meetings);

  const faites   = all.filter(a => a.status === 'done').length;
  const retard   = all.filter(a => _o2oActionLate(a, today)).length;
  const drop     = all.filter(a => a.status === 'drop').length;
  // "Open": to do, due date not passed (or no due date at all).
  const ouvertes = all.filter(a => a.status === 'todo' && !_o2oActionLate(a, today)).length;

  const jugees = faites + retard;
  return {
    total: all.length,
    suivies: faites,
    ouvertes,
    retard,
    abandonnees: drop,
    jugees,
    taux: jugees > 0 ? Math.round(faites / jugees * 100) : null,
  };
}

// Compétences (10 %). Une certification officielle vaut 100 : elle est
// attestée par un tiers, rien d'interne ne s'y substitue.
//
// À défaut, on note le parcours interne sur quatre dimensions plutôt que
// sur le seul meilleur score. Ne retenir que le meilleur résultat
// revenait à traiter identiquement un agent ayant réussi un quiz une
// fois et un agent en formant dix avec régularité — et le plafond fixe
// à 80 rendait la note insensible à tout effort supplémentaire une fois
// ce seuil atteint.
//
//   Maîtrise   45 %  moyenne des meilleurs scores par cours
//   Couverture 25 %  part des cours publiés effectivement validés
//   Constance  20 %  série de jours consécutifs (référence : 10 jours)
//   Progression 10 % niveau atteint (référence : niveau 5)
//
// Aucun plafond : atteindre 100 suppose tous les cours validés au meilleur
// score, la série de référence et le niveau abouti — c'est un parcours
// complet, pas un quiz réussi une fois. Le brider aurait rendu la note
// insensible à l'effort au-delà d'un seuil, ce qui était le défaut de la
// version précédente (plafond à 80 atteint dès le premier quiz réussi).
const SKILL_STREAK_REF = 10;   // série considérée comme exemplaire
const SKILL_LEVEL_REF  = 5;    // niveau considéré comme abouti

function _autoSkillScore(fo) {
  // Une certification acquise se lit sur les objectifs suivis : c'est là
  // qu'elle vit, avec sa preuve (« Transmettre le certificat »). On passe
  // par _scoredObjectives pour la trouver quel que soit le stockage —
  // sinon une certification menée dans le nouveau flux ne compterait pas.
  // Une certification reste acquise d'une session à l'autre : 'all'.
  const certDone = _scoredObjectives(fo, 'all').some(o =>
    /certification/i.test(o.title || '') && o.status === 'done');
  if (certDone) return 100;

  const d = _skillBreakdown(fo);
  return d ? d.score : null;
}

// Détail du calcul, réutilisé par l'infobulle : afficher une note sans
// pouvoir l'expliquer à l'agent la rendrait indéfendable en entretien.
function _skillBreakdown(fo) {
  const pct = r => {
    if (typeof r.percentage === 'number') return r.percentage;
    if (typeof r.score === 'number' && typeof r.total === 'number' && r.total)
      return Math.round(r.score / r.total * 100);
    return null;
  };

  const tries = (state.quizResults || [])
    .filter(r => r.user === fo)
    .map(r => ({ quiz: r.quiz_id, v: pct(r) }))
    .filter(r => r.v !== null);

  const prog = (state.quizProgress || []).find(e => e && e.user === fo) || null;

  // Sans tentative ni progression, on ne propose rien : un zéro
  // signifierait « mauvais » là où l'on ne sait simplement rien.
  if (!tries.length && !prog) return null;

  // Maîtrise : meilleur score par cours, puis moyenne. Repasser dix fois
  // le même quiz ne doit pas peser plus qu'en valider dix différents.
  const bestPer = new Map();
  tries.forEach(t => bestPer.set(t.quiz, Math.max(bestPer.get(t.quiz) ?? 0, t.v)));
  const maitrise = bestPer.size
    ? Math.round([...bestPer.values()].reduce((a, b) => a + b, 0) / bestPer.size)
    : 0;

  // Couverture : cours validés sur cours disponibles. On se fie à
  // `passed`, qui fait foi côté serveur, et on retombe sur les cours
  // distincts tentés si la progression n'est pas encore constituée.
  const dispo = (state.quizzes || []).filter(q => q.published !== false).length;
  const valides = Array.isArray(prog?.passed) && prog.passed.length
    ? prog.passed.length : bestPer.size;
  // Sans cours publié, la couverture n'a pas de sens : on n'en tient pas
  // compte plutôt que de compter 0, ce qui pénaliserait l'agent pour une
  // banque de quiz vide — une situation dont il n'est pas responsable.
  const couvNA = dispo === 0;
  const couverture = couvNA ? null : Math.round(Math.min(1, valides / dispo) * 100);

  // Constance : on retient la meilleure série connue, pas seulement celle
  // en cours — une série interrompue par des congés reste un acquis.
  const serie = Math.max(Number(prog?.streak_current) || 0, Number(prog?.streak_best) || 0);
  const constance = Math.round(Math.min(1, serie / SKILL_STREAK_REF) * 100);

  const niveau = Number(prog?.level) || 1;
  const progression = Math.round(Math.min(1, (niveau - 1) / (SKILL_LEVEL_REF - 1)) * 100);

  // Somme pondérée sur les seules dimensions applicables : quand la
  // couverture est écartée, son poids se répartit sur les autres au
  // prorata, au lieu de compter comme un zéro.
  const parts = [
    [maitrise,    0.45],
    [couverture,  0.25],
    [constance,   0.20],
    [progression, 0.10],
  ].filter(([v]) => v !== null);
  const poids = parts.reduce((n, [, w]) => n + w, 0);
  const brut = poids ? parts.reduce((n, [v, w]) => n + v * w, 0) / poids : 0;
  const score = Math.round(brut);

  return {
    score, maitrise, couverture, constance, progression,
    quizValides: valides, quizDispo: dispo, serie, niveau,
  };
}

// D'où sort la valeur proposée. Dire « pré-rempli depuis le Tracker »
// ne suffit pas quand quatre critères le sont : il faut pouvoir vérifier
// le chiffre sans quitter l'écran, sinon on ne lui fait pas confiance.
function _autoSourceLabel(id, fo) {
  if (id === 'sla') return `Tickets within SLA, ${_perfSlaMonth(fo).scope} this month`;
  if (id === 'individual') {
    const d = _o2oBreakdown(fo);
    if (!d) return 'No objective defined';
    const bits = [`${d.nbAtteints}/${d.nbObjectifs} objectif${d.nbObjectifs > 1 ? 's' : ''}`];
    if (d.nbRetard) bits.push(`${d.nbRetard} en retard`);
    if (d.actionsTotal) bits.push(`${d.actionsSuivies}/${d.actionsTotal} actions suivies`);
    return bits.join(' · ');
  }
  if (id === 'skills') {
    const cert = _scoredObjectives(fo, 'all').some(o =>
      /certification/i.test(o.title || '') && o.status === 'done');
    if (cert) return 'Certification obtenue';
    const d = _skillBreakdown(fo);
    if (!d) return 'No quiz taken';
    // Le détail tient dans une ligne : chaque part est vérifiable dans la
    // page Quiz, et l'agent peut voir ce qui ferait monter la note.
    return `Mastery ${d.maitrise} · `
         + (d.couverture === null ? 'no course published' : `${d.quizValides}/${d.quizDispo} cours`)
         + ` · ${d.serie}-day streak · level ${d.niveau}`;
  }
  if (id === 'tasks') {
    const d = _taskBreakdown(fo);
    const n = _taskUpcoming(fo);
    const later = n ? ` · ${n} upcoming, not scored yet` : '';
    if (!d) return n ? `No task due yet${later}` : 'No task assigned this month';
    return `${d.done}/${d.total} task${d.total > 1 ? 's' : ''} done${later}`;
  }
  if (id === 'attendance') {
    const s = (state.attendanceScores || {})[fo];
    if (!s) return 'Attendance';
    const bits = [];
    if (s.unjustified) bits.push(`${s.unjustified} unexcused`);
    if (s.late_notice) bits.push(`${s.late_notice} without notice`);
    return bits.length ? bits.join(', ') : 'No discrepancy found';
  }
  return 'Measured';
}

// Repose la valeur mesurée dans le champ et recalcule le score.
function perfRevertAuto(id, val) {
  const inp = document.getElementById(`perf-${id}`);
  if (!inp) return;
  inp.value = val;
  refreshPerfScore();
  // Le brouillon suit, sinon changer d'agent restaurerait l'ancienne
  // saisie manuelle.
  _perfCaptureInputs();
  renderPerfSheet();
}

// Notes d'assiduité, chargées une fois par session. L'endpoint est
// admin-only et ne renvoie que des chiffres — jamais un motif d'absence.
// Bornes du mois noté. L'assiduité doit porter sur la période évaluée :
// sans `from`/`to`, le serveur retombe sur 0000-01-01 → 9999-12-31 et
// calcule sur tout l'historique. Une absence injustifiée ancienne
// pénalisait alors la note de chaque mois suivant, indéfiniment.
function _attendanceRange(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(month || '') ;
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  const last = new Date(y, mo, 0).getDate();   // jour 0 du mois suivant
  return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${String(last).padStart(2,'0')}` };
}

async function loadAttendanceScores(month) {
  const mois  = month || perfUI.month || _perfMonthKey();
  const range = _attendanceRange(mois);
  try {
    const qs = range ? `?from=${range.from}&to=${range.to}` : '';
    const res = await fetch(`${API}/api/absences/scores${qs}`, {
      headers: AdminSession.headers(), credentials: 'same-origin' });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    state.attendanceScores = data.scores || {};
    // Mois couvert par les notes en cache : changer de mois dans la fiche
    // doit relancer l'appel, sinon on afficherait l'assiduité d'un autre.
    state.attendanceMonth = mois;
  } catch {
    // Un objet vide, et non `undefined` : l'appelant teste la présence de
    // la clé pour ne pas relancer la requête à chaque rendu. Sans notes,
    // le critère reste simplement à saisir à la main.
    state.attendanceScores = {};
    state.attendanceMonth = mois;
  }
}

// Score /100 : moyenne pondérée des critères renseignés, renormalisée
// sur le poids réellement saisi — noter 4 critères sur 6 ne doit pas
// mécaniquement plafonner le score à 55.
function perfScore(card) {
  // Mois neutralisé : pas de note du tout (ni 0, ni mesure automatique).
  if (card && card._neutre) return { score: null, covered: 0, neutre: true };
  card = _perfLegacyCard(card);
  let sum = 0, w = 0;
  PERF_CRITERIA.forEach(c => {
    const v = card?.[c.id];
    if (v === undefined || v === null || v === '') return;
    const n = Number(v);
    if (!isFinite(n)) return;
    sum += n * c.weight; w += c.weight;
  });
  return w ? { score: Math.round(sum / w), covered: w } : { score: null, covered: 0 };
}

// Les agents du périmètre courant. La page suit le sélecteur Global/SN/CI
// de la barre du haut, comme le FO Dashboard : sur « SN », noter un agent
// d'Abidjan n'a pas de sens et brouille la lecture d'équipe.
// Un seul accesseur pour toute la page — la liste et la fiche notée
// doivent voir exactement les mêmes agents.
function _perfFoList() {
  const scope = (typeof getActiveCountry === 'function') ? getActiveCountry() : 'ALL';
  return (state.config.fo_list || []).filter(fo =>
    scope === 'ALL' || ((state.config.fo_trackers || {})[fo] || 'SN') === scope);
}

function renderPerfPage() {
  const foList = _perfFoList();
  if (!perfUI.month) {
    const el = document.getElementById('perf-month');
    perfUI.month = el?.value || _perfMonthKey();
    if (el) el.value = perfUI.month;
  }
  // L'agent sélectionné peut sortir du périmètre après un changement de
  // pays : on retombe alors sur le premier du nouveau périmètre, sinon la
  // fiche resterait sur quelqu'un que la liste n'affiche plus.
  if (!perfUI.fo || !foList.includes(perfUI.fo)) perfUI.fo = foList[0] || null;
  renderPerfSheet();
  renderO2O();
  _renderTrustMatrixBody(document.getElementById('perf-trust'), state.dashboard || {});
  setPerfTab(perfUI.tab);

  // Les notes d'assiduité viennent d'un appel admin distinct. On ne bloque
  // pas l'affichage dessus : la fiche s'ouvre tout de suite, et le critère
  // se pré-remplit dès la réponse. Sans ce second rendu, la valeur
  // n'apparaîtrait qu'à la visite suivante.
  // Recharge aussi quand le mois change : les notes en cache valent pour
  // un mois précis, et les réutiliser pour un autre afficherait
  // l'assiduité de la mauvaise période.
  if (!state.attendanceScores || state.attendanceMonth !== perfUI.month) {
    loadAttendanceScores(perfUI.month).then(() => {
      // La page peut avoir été quittée entre-temps.
      if (document.getElementById('page-cfg-perf')?.classList.contains('active'))
        renderPerfSheet();
    });
  }
}

function onPerfMonthChange() {
  _perfCaptureInputs();
  perfUI.month = document.getElementById('perf-month')?.value || _perfMonthKey();
  renderPerfSheet();
}

// Recopie les champs affichés dans l'état mémoire, pour que naviguer
// entre agents ou mois ne jette pas ce qui vient d'être tapé.
let _perfDraft = {};
function _perfCaptureInputs() {
  const wrap = document.getElementById('perf-sheet');
  if (!wrap || !perfUI.fo) return;
  const inputs = wrap.querySelectorAll('[data-perf-key]');
  if (!inputs.length) return;
  // Mois neutre : rien à capturer, l'enregistrement ne doit pas le défaire.
  if (_perfScorecards()[perfUI.month]?.[perfUI.fo]?._neutre) return;
  const card = {};
  inputs.forEach(inp => {
    const v = inp.value.trim();
    if (v !== '') card[inp.getAttribute('data-perf-key')] = Number(v);
  });
  _perfDraft[perfUI.month] = _perfDraft[perfUI.month] || {};
  _perfDraft[perfUI.month][perfUI.fo] = card;
}

// Valeur affichée : brouillon en cours > valeur enregistrée > mesure auto.
function _perfValue(fo, id, auto) {
  const draft = _perfDraft[perfUI.month]?.[fo];
  if (draft && draft[id] !== undefined) return draft[id];
  const saved = _perfLegacyCard(_perfMonthData(perfUI.month)[fo]);
  if (saved && saved[id] !== undefined && saved[id] !== null) return saved[id];
  return auto ?? '';
}

function renderPerfSheet() {
  const el = document.getElementById('perf-sheet');
  if (!el) return;
  const fo = perfUI.fo;
  if (!fo) { el.innerHTML = ''; return; }

  const auto  = _perfAutoValues(fo);
  const stats = (state.dashboard?.by_fo || {})[fo] || {};
  const draft = _perfDraft[perfUI.month]?.[fo];
  const saved = _perfMonthData(perfUI.month)[fo];
  // Les commentaires ne transitent pas par le brouillon : chaque entrée
  // est enregistrée à l'ajout, elle ne peut donc pas être perdue en
  // changeant d'agent ou de mois.
  const notes = _noteList(saved);

  // Avancement par rapport aux objectifs d'équipe : on réutilise les
  // cibles de la page Objectifs pour ne pas définir un second barème.
  const goals = _foGoals();
  const slaMois = _perfSlaMonth(fo);
  const mesures = [
    { label: 'Taux SLA',        val: slaMois.rate,
      unit: '%', target: goals.sla_rate, dir: 'min' },
    { label: 'Resolved tickets', val: stats.resolved ?? null,
      unit: '',  target: goals.resolved, dir: 'min' },
    { label: 'Ruptures SLA',    val: slaMois.scope ? slaMois.breach : null,
      unit: '',  target: goals.breach,   dir: 'max' },
  ];

  const estNeutre = !!saved?._neutre;
  const rows = PERF_CRITERIA.map(c => {
    const a = c.auto ? auto[c.auto] : null;
    const v = estNeutre ? '' : _perfValue(fo, c.id, a);
    const hasAuto = c.auto && a !== null && a !== undefined;
    // Note saisie qui s'écarte de la mesure : on le dit, et on offre le
    // retour à la mesure. C'est ce qui distingue « j'ai corrigé » de
    // « la donnée est fausse ».
    const overridden = hasAuto && v !== '' && Number(v) !== Number(a);
    return `<div class="gsla-row gsla-row-goal${hasAuto ? ' is-measured' : ''}">
      <span class="gsla-goal-main">
        <label class="gsla-name" for="perf-${c.id}">${c.label}</label>
        <span class="gsla-goal-hint">
          ${c.hint}
          ${hasAuto ? `<em class="perf-src">${esc(_autoSourceLabel(c.id, fo))} → ${a}</em>`
            : c.id === 'tasks' ? `<em class="perf-src">${esc(_autoSourceLabel(c.id, fo))}</em>` : ''}
          ${overridden && !estNeutre ? `<button class="perf-revert" onclick="perfRevertAuto('${c.id}',${a})">Back to ${a}</button>` : ''}
        </span>
      </span>
      <span class="gsla-plan">${c.weight}%</span>
      <span class="gsla-num">
        <input id="perf-${c.id}" type="number" min="0" max="100" step="1"
               data-perf-key="${c.id}" value="${v === '' ? '' : v}" placeholder="—"
               oninput="refreshPerfScore()" aria-label="${c.label} — score out of 100"${estNeutre ? ' disabled' : ''}>
        <span class="gsla-unit">/100</span>
      </span>
    </div>`;
  }).join('');

  // Mesures qui ont bougé depuis la notation enregistrée.
  const maj = perfMisesAJour(fo, perfUI.month);
  const majHtml = maj.etat === 'a_jour_a_faire' ? `<div class="perf-maj is-one">
      <div class="perf-maj-h"><div><b>Nouvelles mesures depuis la notation</b>
        <span>${maj.changes.map(c => esc(_perfMajTxt(c))).join(' · ')}</span></div>
        ${maj.changes.some(c => !c.manuel) ? `<button type="button" class="eq-btn is-pri" onclick="perfMajFiche()">Reporter dans la fiche</button>` : ''}
      </div></div>` : '';

  // Mois neutre : la fiche n'est pas notée du tout pour ce mois.
  const neutre = !!saved?._neutre;
  const neutreHtml = neutre ? `<div class="perf-neutre">
      <div><b>Mois neutre</b><span>${esc(fo)} n'a pas de note pour ${esc(perfUI.month)} : ni 0, ni mesure automatique. Le mois ne compte pas dans son historique.</span></div>
      <button type="button" class="eq-btn" onclick="perfNeutraliser(false)">Rétablir la notation</button></div>` : '';

  el.innerHTML = (neutre ? neutreHtml : majHtml) + `
    <div class="gsla-card">
      <div class="perf-sheet-head">
        <span class="perf-sheet-av" style="background:${foAvatarColor(fo)}">${foInitials(fo)}</span>
        <div class="perf-sheet-id">
          <div class="perf-sheet-name">${esc(fo)}</div>
          <div class="perf-sheet-meta">${esc(perfUI.month)} · ${slaMois.scope} ticket${slaMois.scope > 1 ? 's' : ''} in SLA scope this month</div>
        </div>
        <div class="perf-scorebox">
          <div class="perf-score-val" id="perf-score-val">—</div>
          <div class="perf-score-lbl">Score / 100</div>
          <div class="perf-score-tag" id="perf-score-tag" hidden></div>
        </div>
      </div>

      <div class="perf-measures">
        ${mesures.map(m => {
          if (m.val === null) return `<div class="perf-measure is-void">
            <div class="perf-measure-lbl">${m.label}</div>
            <div class="perf-measure-val">—</div>
            <div class="perf-measure-goal">No data</div></div>`;
          const hasT = m.target !== undefined && m.target !== null;
          const ok = !hasT ? null : (m.dir === 'min' ? m.val >= m.target : m.val <= m.target);
          const goal = hasT
            ? `<span class="perf-measure-dot" aria-hidden="true"></span>Target ${m.dir === 'min' ? '≥' : '≤'} ${m.target}${m.unit} · ${ok ? 'tenu' : 'non tenu'}`
            : 'Pas d’objectif';
          return `<div class="perf-measure${ok === null ? '' : ok ? ' is-ok' : ' is-off'}">
            <div class="perf-measure-lbl">${m.label}</div>
            <div class="perf-measure-val">${m.val}${m.unit}</div>
            <div class="perf-measure-goal">${goal}</div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <div class="gsla-card">
      <div class="gsla-card-head perf-not-head">
        <h3 class="gsla-card-t">Notation</h3>
        ${neutre ? '' : `<button type="button" class="eq-btn is-ghost" onclick="perfNeutraliser(true)"
          title="Aucune note ce mois-ci pour cet agent (ni 0, ni mesure automatique)">Mettre le mois en neutre</button>`}
        <p class="gsla-card-d">
          One score out of 100 per criterion. The final score is the weighted
          average of the criteria filled in — leaving one empty excludes it from
          the calculation instead of counting it as zero.
        </p>
      </div>
      <div class="gsla-list${neutre ? ' is-neutre' : ''}">${rows}</div>
    </div>

    <div class="gsla-card">
      <div class="gsla-card-head o2o-head">
        <h3 class="gsla-card-t">Comments for the month</h3>
        <span class="o2o-tally">${notes.length}</span>
      </div>
      ${_noteThread('pn', notes, NT_FNS, 'Faits marquants, actions convenues…')}
    </div>`;

  refreshPerfScore();
}

function refreshPerfScore() {
  const el = document.getElementById('perf-score-val');
  if (!el) return;
  const card = {};
  document.querySelectorAll('#perf-sheet [data-perf-key]').forEach(inp => {
    const v = inp.value.trim();
    if (v !== '') card[inp.getAttribute('data-perf-key')] = Number(v);
  });
  const { score, covered } = perfScore(card);
  el.textContent = score === null ? '—' : score;
  el.title = covered < 100 && covered > 0 ? `${covered}% of the scale filled in` : '';

  // Le niveau est nommé plutôt que codé par la couleur du chiffre : un
  // score de 88 ne se distinguait d'un 92 que par une nuance de teinte,
  // ce que personne ne lit. Les seuils sont ceux du plan trimestriel.
  const tag = document.getElementById('perf-score-tag');
  if (!tag) return;
  if (score === null) { tag.hidden = true; return; }
  const level = score >= 90 ? { t: 'Above target', c: ' is-top' }
              : score >= 75 ? { t: 'On target',         c: '' }
              :               { t: 'Below target',         c: ' is-low' };
  tag.hidden = false;
  tag.textContent = level.t;
  tag.className = 'perf-score-tag' + level.c;
}

async function savePerfScorecard() {
  _perfCaptureInputs();
  const fo_scorecards = JSON.parse(JSON.stringify(_perfScorecards()));
  Object.entries(_perfDraft).forEach(([month, byFo]) => {
    Object.entries(byFo).forEach(([fo, card]) => {
      const clean = {};
      PERF_CRITERIA.forEach(c => {
        const v = card[c.id];
        if (v === undefined || v === null || v === '') return;
        const n = Number(v);
        if (!(isFinite(n) && n >= 0 && n <= 100)) return;
        // Tasks : la mesure n'est pas stockée (elle se recalcule en direct,
        // voir _perfMonthData) ; seule une note différente l'est, marquée.
        if (c.id === 'tasks') {
          const mesure = _taskBreakdown(fo, month)?.score ?? null;
          if (mesure !== null && n === mesure) return;
          clean._ovr = { ...(clean._ovr || {}), tasks: true };
        }
        clean[c.id] = n;
      });
      // Les commentaires sont enregistrés par leurs propres actions :
      // on les reprend tels quels, sinon enregistrer la notation les
      // effacerait.
      const prevNotes = _noteList(fo_scorecards[month]?.[fo]);
      if (prevNotes.length) clean._notes = prevNotes;
      // Photo des mesures du jour : sert à savoir plus tard si les chiffres
      // ont bougé depuis cette notation (perfMisesAJour).
      if (Object.keys(clean).some(k => PERF_CRITERIA.some(c => c.id === k))) {
        const auto = _perfAvecMois(month, () => _perfAutoValues(fo));
        clean._mesures = Object.fromEntries(PERF_SUIVIS.filter(id => auto[id] !== null && auto[id] !== undefined).map(id => [id, auto[id]]));
        clean._mesures_at = new Date().toISOString();
      }

      // Une fiche entièrement vidée est une suppression volontaire — mais
      // pas si elle porte encore des commentaires.
      if (Object.keys(clean).length) {
        fo_scorecards[month] = fo_scorecards[month] || {};
        fo_scorecards[month][fo] = clean;
      } else if (fo_scorecards[month]) {
        delete fo_scorecards[month][fo];
      }
    });
  });
  const cfg = { ...state.config, fo_scorecards };
  const res = await fetch(`${API}/api/config`, {
    method: 'PUT', headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
    credentials: 'same-origin', body: JSON.stringify(cfg) });
  if (!res.ok) { toast('Server error', 'error'); return; }
  _perfDraft = {};
  await loadConfig();
  renderPerfPage();
  toast('Scoring saved', 'success');
}



// ── Mois neutre ───────────────────────────────────────────────
// Un agent absent tout le mois, arrivé en fin de mois… : on ne le note pas
// du tout. La fiche garde ses commentaires et porte `_neutre` ; le score
// est nul partout (fiche, équipe, page de l'agent), sans repli sur les
// mesures automatiques, et le mois ne réclame plus de note.
async function perfNeutraliser(on) {
  const fo = perfUI.fo, month = perfUI.month;
  if (!fo || !month) return;
  if (on && !confirm(`Mettre ${month} en neutre pour ${fo} ?\n\nIl n'aura aucune note ce mois-ci (pas 0) : les critères saisis seront retirés, les commentaires gardés.`)) return;
  const fo_scorecards = JSON.parse(JSON.stringify(_perfScorecards()));
  const prev = fo_scorecards[month]?.[fo] || {};
  const notes = _noteList(prev);
  const carte = on ? { _neutre: true, _neutre_at: new Date().toISOString() } : {};
  if (notes.length) carte._notes = notes;
  fo_scorecards[month] = fo_scorecards[month] || {};
  if (Object.keys(carte).length) fo_scorecards[month][fo] = carte; else delete fo_scorecards[month][fo];
  if (_perfDraft[month]) delete _perfDraft[month][fo];
  const res = await fetch(`${API}/api/config`, {
    method: 'PUT', headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
    credentials: 'same-origin', body: JSON.stringify({ ...state.config, fo_scorecards }) });
  if (!res.ok) { toast('Server error', 'error'); return; }
  await loadConfig();
  renderPerfPage();
  // Dans Équipe, l'en-tête de l'agent (note du mois, signaux) suit aussi.
  if (typeof _eqRenderHead === 'function' && document.getElementById('page-equipe')?.classList.contains('active')) _eqRenderHead();
  toast(on ? `${month} en neutre pour ${fo}` : 'Notation rétablie', 'success');
}
