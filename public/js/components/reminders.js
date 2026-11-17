// ══════════════════════════════════════════════════════════════
// RAPPELS FO
//
// Réservé au rôle FO : ce sont des rappels sur SON propre travail.
// Un BO ou un observateur n'a rien à y faire — la cloche reste
// masquée pour eux, plutôt que d'afficher un compteur vide.
//
// Trois principes qui gouvernent tout le fichier :
//
//  1. Un rappel n'existe que s'il débouche sur un geste précis.
//     « Vous êtes en retard » sans bouton n'est pas un rappel,
//     c'est un reproche. Chaque entrée ouvre l'écran concerné.
//
//  2. Le rouge est rationné. La plateforme en est déjà pleine
//     (breach, SLA, marque) ; si les rappels en rajoutent, plus
//     rien ne ressort. Bleu = routine, ambre = c'est le moment,
//     rouge = vrai retard uniquement.
//
//  3. Rien à faire est un résultat valable. Le panneau félicite
//     au lieu d'inventer une tâche pour justifier son existence.
//
// Tout est calculé côté client à partir de `state` : aucun
// nouvel appel réseau, aucun schéma serveur à migrer.
// ══════════════════════════════════════════════════════════════

const NF_SNOOZE_KEY = 'fo-nf-snooze';   // { [id]: ISO-date de réveil }
const NF_ANNONCE_KEY = 'fo-nf-annonces-lues'; // { [id]: ISO-date de lecture }

const NF_ICO = {
  progress: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  ticket:   '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 6v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-6z"/><path d="M13 5v14"/></svg>',
  quiz:     '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="10"/></svg>',
  task:     '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  shift:    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
  handover: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8l4 4-4 4"/><path d="M3 12h18"/></svg>',
  chevron:  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
  done:     '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
};

// Trois niveaux, trois couleurs. `late` est le seul rouge de tout
// le module — voir le principe 2 en tête de fichier.
const NF_TONE = {
  info: { c: 'var(--nf-info)', cc: 'var(--nf-info-c)', rank: 2 },
  due:  { c: 'var(--nf-warn)', cc: 'var(--nf-warn-c)', rank: 1 },
  late: { c: 'var(--nf-late)', cc: 'var(--nf-late-c)', rank: 0 },
};

// ── Catalogue des règles de rappel ────────────────────────────
// Chaque rappel produit par build() porte un `rule` qui pointe ici.
// Ce catalogue est la seule source de vérité pour l'écran Annonces :
// il donne le libellé, la fréquence d'évaluation et l'état par défaut.
// Sans lui, l'admin ne pourrait pas savoir ce que la cloche est
// susceptible d'afficher — les règles resteraient enfouies dans build().
//
// `freq` décrit QUAND la règle peut se déclencher, pas un envoi
// périodique : tout est réévalué toutes les 60 s, mais une règle de
// shift ne peut être vraie que pendant le créneau du FO.
const NF_RULES = [
  { id: 'wp-empty',  cat: 'My Tasks',      label: 'Progression hebdo non remplie',
    freq: 'All week, while nothing is entered',      tone: 'due',  def: true },
  { id: 'wp-open',   cat: 'My Tasks',      label: 'Unfinished items this week',
    freq: 'All week, if items remain open',   tone: 'info', def: true },
  { id: 'wp-late',   cat: 'My Tasks',      label: 'Overdue items from past weeks',
    freq: 'Continuously until resolved',                    tone: 'late', def: true },
  { id: 'tk-shift',  cat: 'Trackers',      label: 'Log today\'s tickets',
    freq: 'During the shift only',                      tone: 'due',  def: true },
  { id: 'tk-open',   cat: 'Trackers',      label: 'Tickets still open',
    freq: 'During the shift only',                      tone: 'info', def: true },
  { id: 'qz-week',   cat: 'Formation',     label: 'Weekly quiz not taken',
    freq: 'Once a week, if no quiz',              tone: 'due',  def: true },
  { id: 'tk-late',   cat: 'Daily Check-up', label: 'Tasks past their due date',
    freq: 'Continuously until resolved',                    tone: 'late', def: true },
  { id: 'tk-today',  cat: 'Daily Check-up', label: 'Tasks due today',
    freq: 'On the due date',                            tone: 'due',  def: true },
  { id: 'tk-blocked', cat: 'Daily Check-up', label: 'Blocked tasks',
    freq: 'Continuously while the status is Blocked',        tone: 'due',  def: true },
  { id: 'ho-end',    cat: 'Handover',      label: 'Handover preparation',
    freq: 'The last 30 minutes of the shift',                tone: 'due',  def: true },
];

const NF_RULE_BY_ID = Object.fromEntries(NF_RULES.map(r => [r.id, r]));

// Une règle désactivée par l'admin ne doit produire aucun rappel, pour
// personne. Le réglage vit dans la config serveur (et non en
// localStorage) : c'est une décision d'équipe, pas une préférence de
// navigateur — elle doit valoir sur tous les postes.
function nfRuleOn(id) {
  const rules = (typeof state !== 'undefined' && state.config?.nf_rules) || {};
  const r = NF_RULE_BY_ID[id];
  return id in rules ? !!rules[id] : (r ? r.def : true);
}

const NF = {
  _open: false,
  _items: [],
  // Annonces diffusées par l'administration. Elles concernent tout le
  // monde, contrairement aux rappels qui portent sur le travail du FO.
  _annonces: [],

  isFO() {
    return !!(typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'FO');
  },

  // ── Annonces ──────────────────────────────────────────────
  // L'accusé de lecture vit dans le navigateur : c'est un confort
  // d'affichage (ne pas re-signaler ce qu'on a vu), pas une preuve.
  // Le serveur ne prétend donc pas savoir qui a lu quoi.
  _annonceLue(id) {
    try {
      return !!JSON.parse(localStorage.getItem(NF_ANNONCE_KEY) || '{}')[id];
    } catch { return false; }
  },

  marquerAnnonceLue(id, ev) {
    ev?.stopPropagation();
    try {
      const raw = JSON.parse(localStorage.getItem(NF_ANNONCE_KEY) || '{}');
      raw[id] = new Date().toISOString();
      // On ne garde que les annonces encore diffusées : sinon la clé
      // grossit indéfiniment avec des identifiants disparus.
      const vivantes = new Set(this._annonces.map(a => a.id));
      const propre = {};
      Object.entries(raw).forEach(([k, v]) => { if (vivantes.has(k)) propre[k] = v; });
      localStorage.setItem(NF_ANNONCE_KEY, JSON.stringify(propre));
    } catch { /* stockage indisponible : on n'empêche pas l'affichage */ }
    this.render();
  },

  async loadAnnonces() {
    try {
      const res = await fetch(`${API}/api/announcements`);
      this._annonces = res.ok ? await res.json() : [];
    } catch {
      // Réseau indisponible : on garde ce qu'on avait plutôt que de
      // vider le panneau sur un simple hoquet de connexion.
    }
    this.render();
  },

  // ── Report ────────────────────────────────────────────────
  // Reporter, ce n'est pas ignorer : le rappel revient le jour
  // suivant. Sans ce geste, un FO qui ne peut pas agir tout de
  // suite n'a que l'option de subir le compteur toute la journée.
  _snoozed() {
    try {
      const raw = JSON.parse(localStorage.getItem(NF_SNOOZE_KEY) || '{}');
      const now = Date.now();
      const live = {};
      Object.entries(raw).forEach(([k, v]) => { if (Date.parse(v) > now) live[k] = v; });
      return live;
    } catch (_) { return {}; }
  },
  snooze(id, ev) {
    if (ev) ev.stopPropagation();
    const live = this._snoozed();
    // Réveil demain matin : le rappel a de nouveau du sens au
    // début d'une journée de travail, pas 24 h plus tard pile.
    const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(6, 0, 0, 0);
    live[id] = t.toISOString();
    try { localStorage.setItem(NF_SNOOZE_KEY, JSON.stringify(live)); } catch (_) {}
    this.render();
  },
  clearSnoozes() {
    try { localStorage.removeItem(NF_SNOOZE_KEY); } catch (_) {}
    this.render();
  },

  // ── Contexte de shift ─────────────────────────────────────
  // Le shift du jour donne l'heure à laquelle « saisir vos
  // tickets » devient pertinent. En dehors du créneau, ce rappel
  // n'a aucun sens et n'est pas produit.
  _todayShift() {
    const me = currentUser?.name;
    if (!me) return null;
    const today = new Date().toISOString().slice(0, 10);
    const row = (state.shiftsPlan || []).find(s =>
      s.fo_name === me && s.date === today && !s.is_rest && s.shift_id !== 'rest');
    if (!row) return null;

    // Les horaires vivent dans rota_config ; `shift_type` ne les
    // porte que sous forme de texte, trop fragile pour comparer.
    const site = (state.rotaConfig?.sites || []).find(s => s.id === row.site_id);
    const shift = (site?.shifts || []).find(s => s.id === row.shift_id);
    if (!shift?.start || !shift?.end) return { row, shift: null, active: false };

    const toMin = hhmm => {
      const [h, m] = String(hhmm).split(':').map(Number);
      return (h || 0) * 60 + (m || 0);
    };
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    const start = toMin(shift.start), end = toMin(shift.end);
    // Un shift de nuit franchit minuit : la fenêtre est alors
    // l'union [start,24h[ ∪ [0,end[.
    const active = start <= end ? (cur >= start && cur < end) : (cur >= start || cur < end);
    const soon = !active && start - cur > 0 && start - cur <= 60;
    return { row, shift, active, soon, start, end, cur };
  },

  _weekStart() {
    const d = new Date();
    const dow = d.getDay() === 0 ? 7 : d.getDay();
    d.setDate(d.getDate() - dow + 1); d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  },

  // ── Construction des rappels ──────────────────────────────
  build() {
    const me = currentUser?.name;
    if (!this.isFO() || !me) return [];

    const items = [];
    const today = new Date().toISOString().slice(0, 10);
    const weekStart = this._weekStart();
    const myTracker = personSite(me);
    const shift = this._todayShift();

    // 1 ── Weekly progress de la semaine en cours.
    const mine = (state.weeklyProgress || []).filter(p => p.modified_by === me);
    const thisWeek = mine.filter(p => p.week_start === weekStart);
    if (!thisWeek.length) {
      items.push({
        id: 'wp-empty', tone: 'due', icon: 'progress', page: 'weekly-progress',
        title: 'Your weekly progress is empty',
        desc: 'Log what you have planned or already delivered. This feeds the weekly report.',
        tag: 'My Tasks',
      });
    } else {
      const open = thisWeek.filter(p => p.status !== 'Done');
      if (open.length) {
        items.push({
          id: 'wp-open', tone: 'info', icon: 'progress', page: 'weekly-progress',
          title: `${open.length} item${open.length > 1 ? 's' : ''} to finish this week`,
          desc: `${thisWeek.length - open.length} sur ${thisWeek.length} already delivered${thisWeek.length - open.length > 1 ? 's' : ''}. Update the statuses as you go'eau.`,
          tag: 'My Tasks',
        });
      }
    }

    // Report des semaines passées : le seul vrai retard de ce bloc.
    const carry = mine.filter(p => p.status !== 'Done' && p.week_start < weekStart);
    if (carry.length) {
      const oldest = carry.reduce((a, b) => (a.week_start < b.week_start ? a : b));
      const weeks = Math.max(1, Math.round((Date.parse(weekStart) - Date.parse(oldest.week_start)) / 6048e5));
      items.push({
        id: 'wp-late', tone: 'late', icon: 'progress', page: 'weekly-progress',
        title: `${carry.length} item${carry.length > 1 ? 's' : ''} en retard`,
        desc: `The oldest has been dragging for ${weeks} semaine${weeks > 1 ? 's' : ''}. Finish it or explicitly carry it over to this week.`,
        tag: 'My Tasks',
      });
    }

    // 2 ── Saisie des tickets, pendant le shift uniquement.
    if (shift?.active) {
      const pool = ticketsOf(myTracker);
      const minesToday = pool.filter(t =>
        (t.fo_owner === me || t.assigned_to === me) &&
        String(t.created_at || '').slice(0, 10) === today);
      items.push({
        id: 'tk-shift', tone: 'due', icon: 'ticket',
        page: myTracker.toLowerCase(),
        title: minesToday.length ? 'Keep your tickets up to date' : 'Log your tickets',
        desc: minesToday.length
          ? `${minesToday.length} ticket${minesToday.length > 1 ? 's' : ''} logged today. Complete the statuses before the end of the shift (${shift.shift.end}).`
          : `You are on duty until ${shift.shift.end} and no ticket has been logged today yet.`,
        tag: `Tracker ${myTracker}`,
      });

      // Tickets actifs qui traînent : c'est ce qui casse le SLA.
      const stale = pool.filter(t =>
        (t.fo_owner === me || t.assigned_to === me) &&
        ['Open', 'In Progress'].includes(t.status));
      if (stale.length) {
        items.push({
          id: 'tk-open', tone: 'info', icon: 'ticket',
          page: myTracker.toLowerCase(),
          title: `${stale.length} ticket${stale.length > 1 ? 's' : ''} still open`,
          desc: 'Move them to Resolved or update the current action so tracking stays accurate.',
          tag: `Tracker ${myTracker}`,
        });
      }
    }

    // 3 ── Quiz : au moins un par semaine.
    const quizzes = state.quizzes || [];
    if (quizzes.length) {
      const myResults = (state.quizResults || []).filter(r => r.user === me);
      const thisWeekQuiz = myResults.filter(r => String(r.created_at || '').slice(0, 10) >= weekStart);
      if (!thisWeekQuiz.length) {
        const last = myResults.length
          ? myResults.map(r => r.created_at).sort().pop()
          : null;
        const days = last ? Math.floor((Date.now() - Date.parse(last)) / 864e5) : null;
        // Jamais passé, ou plus de deux semaines : c'est un retard.
        const veryLate = days === null || days > 14;
        items.push({
          id: 'qz-week', tone: veryLate ? 'late' : 'due', icon: 'quiz', page: 'quiz',
          title: 'No quiz taken this week',
          desc: last
            ? `Your last attempt was ${days} day${days > 1 ? 's' : ''} ago. The goal is at least one per week.`
            : 'You have never taken a quiz yet. Allow five minutes — it is not an assessment.',
          tag: 'Formation',
        });
      }
    }

    // 4 ── Tâches assignées (Daily Check-up).
    // Les occurrences récurrentes sont les vraies unités de travail ;
    // le gabarit parent (« Recurring ») n'est jamais à cocher.
    const myTasks = (state.foTasks || []).filter(t =>
      t.assigned_to === me && !(!t.is_occurrence && t.status === 'Recurring'));
    const lateTasks = myTasks.filter(t =>
      t.status !== 'Done' && t.due_date && t.due_date < today);
    const dueToday = myTasks.filter(t =>
      t.status !== 'Done' && t.due_date === today);
    const blocked = myTasks.filter(t => t.status === 'Blocked');

    if (lateTasks.length) {
      items.push({
        id: 'tk-late', tone: 'late', icon: 'task', page: 'fo-tasks',
        title: `${lateTasks.length} tâche${lateTasks.length > 1 ? 's' : ''} en retard`,
        desc: `Past due: ${lateTasks.slice(0, 2).map(t => t.title || t.task || 'untitled').join(', ')}${lateTasks.length > 2 ? '…' : ''}`,
        tag: 'Daily Check-up',
      });
    }
    if (dueToday.length) {
      items.push({
        id: 'tk-today', tone: 'due', icon: 'task', page: 'fo-tasks',
        title: `${dueToday.length} task${dueToday.length > 1 ? 's' : ''} due today`,
        desc: 'Tick them once done so tracking stays accurate.',
        tag: 'Daily Check-up',
      });
    }
    if (blocked.length) {
      items.push({
        id: 'tk-blocked', tone: 'due', icon: 'task', page: 'fo-tasks',
        title: `${blocked.length} task${blocked.length > 1 ? 's' : ''} blocked`,
        desc: 'A blocker that is not reported stays blocked. Raise it with your manager.',
        tag: 'Daily Check-up',
      });
    }

    // 5 ── Fin de shift : le handover se prépare avant de partir.
    if (shift?.active && shift.shift && (shift.end - shift.cur) <= 30 && (shift.end - shift.cur) > 0) {
      items.push({
        id: 'ho-end', tone: 'due', icon: 'handover', page: 'fo-handover',
        title: `Shift ends in ${shift.end - shift.cur} min`,
        desc: 'Prepare your handover: tickets updated, open points, instructions for the next team.',
        tag: 'Handover',
      });
    }

    // Trois filtres, dans cet ordre : règle désactivée par l'admin
    // (vaut pour toute l'équipe), puis report personnel du FO, puis
    // tri par urgence. Le filtre par règle passe en premier — un
    // rappel coupé ne doit même pas pouvoir être « reporté ».
    const snoozed = this._snoozed();
    return items
      .filter(i => nfRuleOn(i.id))
      .filter(i => !snoozed[i.id])
      .sort((a, b) => NF_TONE[a.tone].rank - NF_TONE[b.tone].rank);
  },

  // ── Rendu ─────────────────────────────────────────────────
  render() {
    const wrap = document.getElementById('nf-wrap');
    if (!wrap) return;

    // Les rappels personnels sont réservés aux FO, mais une annonce de
    // l'administration s'adresse à tout le monde : la cloche reste donc
    // visible pour un non-FO s'il y a au moins une annonce en cours.
    if (!this.isFO() && !this._annonces.length) { wrap.style.display = 'none'; this.close(); return; }
    wrap.style.display = '';

    this._items = this.isFO() ? this.build() : [];
    const badge = document.getElementById('nf-badge');
    const n = this._items.length + this._annonces.filter(a => !this._annonceLue(a.id)).length;
    if (badge) {
      badge.hidden = n === 0;
      badge.textContent = n > 9 ? '9+' : String(n);
      // Une annonce critique non lue prime sur le ton des rappels :
      // c'est le message le plus grave qui doit colorer la pastille.
      const critique = this._annonces.some(a => a.level === 'critical' && !this._annonceLue(a.id));
      const worst = critique ? 'late' : (this._items[0]?.tone || 'info');
      badge.className = 'nf-badge' + (worst === 'late' ? ' late' : worst === 'due' ? ' due' : '');
    }
    const bell = document.getElementById('nf-bell');
    if (bell) bell.title = n ? `${n} item${n > 1 ? 's' : ''} to review` : 'Nothing to report — all up to date';

    if (this._open) this._paint();
  },

  _paint() {
    const panel = document.getElementById('nf-panel');
    if (!panel) return;
    const shift = this._todayShift();
    const snoozedCount = Object.keys(this._snoozed()).length;

    // Le bandeau de shift n'est ni un rappel ni une alerte : c'est
    // le contexte qui rend les rappels compréhensibles.
    let shiftBanner = '';
    if (shift?.active && shift.shift) {
      shiftBanner = `<div class="nf-shift">
        ${NF_ICO.shift}
        <div>
          <div class="nf-shift-t">En poste — ${esc(shift.row.shift_name || '')} · ${esc(shift.shift.start)}–${esc(shift.shift.end)}</div>
          <div class="nf-shift-d">${esc(shift.row.site_name || '')} · now is the time to keep your tickets up to date.</div>
        </div>
      </div>`;
    } else if (shift?.soon && shift.shift) {
      shiftBanner = `<div class="nf-shift" style="background:var(--nf-info-c);color:var(--nf-info)">
        ${NF_ICO.shift}
        <div>
          <div class="nf-shift-t">Shift dans ${shift.start - shift.cur} min</div>
          <div class="nf-shift-d">${esc(shift.row.shift_name || '')} · ${esc(shift.shift.start)}–${esc(shift.shift.end)} at ${esc(shift.row.site_name || '')}.</div>
        </div>
      </div>`;
    }

    // Les annonces passent avant les rappels : elles viennent de
    // l'administration et concernent souvent tout le monde.
    // Les teintes viennent des jetons du panneau, qui ont chacun leur
    // variante sombre. Des hex en dur (l'ancien `#FFF3E0`) gardaient un
    // fond crème en thème sombre alors que l'encre, elle, passait au
    // clair : titre illisible sur fond pâle.
    const NIVEAUX = {
      info:     { c: 'var(--nf-info)', cc: 'var(--nf-info-c)', mot: 'Info' },
      warning:  { c: 'var(--nf-warn)', cc: 'var(--nf-warn-c)', mot: 'Important' },
      critical: { c: 'var(--nf-late)', cc: 'var(--nf-late-c)', mot: 'Critique' },
    };
    const annonces = this._annonces.length
      ? `<div class="nf-annonces">${this._annonces.map(a => {
          const n = NIVEAUX[a.level] || NIVEAUX.info;
          const lue = this._annonceLue(a.id);
          return `<div class="nf-annonce${lue ? ' is-read' : ''}" style="--nf-c:${n.c};--nf-cc:${n.cc}">
            <div class="nf-annonce-head">
              <span class="nf-annonce-tag">${n.mot}</span>
              <span class="nf-annonce-t">${esc(a.title)}</span>
            </div>
            ${a.body ? `<div class="nf-annonce-b">${esc(a.body)}</div>` : ''}
            <div class="nf-annonce-foot">
              <span>${esc(a.author || 'Administration')} · ${esc(fmtDt(a.created_at))}</span>
              ${lue
                ? '<span class="nf-annonce-ok">Lu</span>'
                : `<button type="button" class="nf-annonce-btn"
                     onclick="NF.marquerAnnonceLue('${a.id}',event)">J'ai lu</button>`}
            </div>
          </div>`;
        }).join('')}</div>`
      : '';

    const body = this._items.length
      ? `<div class="nf-list">${this._items.map(i => {
          const tone = NF_TONE[i.tone] || NF_TONE.info;
          return `<button class="nf-item" style="--nf-c:${tone.c};--nf-cc:${tone.cc}"
                    onclick="NF.go('${i.page}')">
            <span class="nf-ico">${NF_ICO[i.icon] || NF_ICO.task}</span>
            <span class="nf-main">
              <span class="nf-t">${esc(i.title)}</span>
              <span class="nf-d">${esc(i.desc)}</span>
              <span class="nf-meta">
                <span class="nf-tag">${esc(i.tag)}</span>
                <span role="button" tabindex="0" style="cursor:pointer;text-decoration:underline;text-underline-offset:2px"
                      onclick="NF.snooze('${i.id}',event)"
                      onkeydown="if(event.key==='Enter'){NF.snooze('${i.id}',event)}">Later</span>
              </span>
            </span>
            <span class="nf-cta">${NF_ICO.chevron}</span>
          </button>`;
        }).join('')}</div>`
      // Pas d'écran « tout est à jour » pour un non-FO : il n'a pas de
      // rappels personnels, l'annonce seule suffit à remplir le panneau.
      : (this.isFO()
          ? `<div class="nf-zero">
              <div class="nf-zero-ico">${NF_ICO.done}</div>
              <div class="nf-zero-t">All up to date</div>
              <div class="nf-zero-d">Progress logged, tasks up to date, weekly quiz done. Nothing is waiting for you.</div>
            </div>`
          : '');

    const titre = this.isFO() ? 'My reminders' : 'Announcements';
    const sousTitre = this.isFO()
      ? (this._items.length ? `${this._items.length} item${this._items.length > 1 ? 's' : ''} to handle` : 'Nothing to handle')
      : `${this._annonces.length} annonce${this._annonces.length > 1 ? 's' : ''}`;

    panel.innerHTML = `
      <div class="nf-head">
        <div style="flex:1;min-width:0">
          <div class="nf-head-t">${titre}</div>
          <div class="nf-head-s">${sousTitre}</div>
        </div>
        ${snoozedCount ? `<button class="nf-clear" onclick="NF.clearSnoozes()">View snoozed (${snoozedCount})</button>` : ''}
      </div>
      ${shiftBanner}
      ${annonces}
      ${body}
      <div class="nf-foot">${this.isFO()
        ? 'Announcements come from the administration; reminders are visible only to you.'
        : 'Announcements published by the administration.'}</div>`;
  },

  go(page) {
    this.close();
    try { window.renderPage(page); } catch (_) {}
    // La barre latérale doit suivre, sinon on se retrouve sur une
    // page dont aucune entrée de menu n'est active.
    // Une ancienne page personnelle (weekly-progress, quiz) s'ouvre dans
    // Mon espace : c'est cette entrée-là qui doit rester active.
    const nav = typeof mesCanonPage === 'function' ? mesCanonPage(page) : page;
    document.querySelectorAll('.nav-item').forEach(n =>
      n.classList.toggle('active', n.dataset.page === nav));
    try { localStorage.setItem('pearl-last-page', nav); } catch (_) {}
  },

  toggle(ev) {
    if (ev) ev.stopPropagation();
    this._open ? this.close() : this.open();
  },
  open() {
    const panel = document.getElementById('nf-panel');
    if (!panel) return;
    this._open = true;
    this._items = this.build();
    this._paint();
    panel.hidden = false;
    document.getElementById('nf-bell')?.setAttribute('aria-expanded', 'true');
  },
  close() {
    const panel = document.getElementById('nf-panel');
    this._open = false;
    if (panel) panel.hidden = true;
    document.getElementById('nf-bell')?.setAttribute('aria-expanded', 'false');
  },

  init() {
    if (this._ready) return;
    this._ready = true;
    // Fermeture au clic extérieur et à Échap : un panneau qui
    // reste ouvert derrière un clic est vécu comme un bug.
    document.addEventListener('click', e => {
      if (!this._open) return;
      if (!e.target.closest('#nf-wrap')) this.close();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this._open) this.close();
    });
    // Le contexte de shift dépend de l'heure : sans réévaluation
    // périodique, un FO qui prend son poste ne verrait rien changer
    // avant son prochain rechargement de page.
    setInterval(() => this.render(), 60000);
    this.render();
    // Annonces : chargées au démarrage puis rafraîchies périodiquement.
    // 5 min suffisent — une annonce n'est pas une alarme temps réel, et
    // interroger plus souvent chargerait le serveur sans bénéfice.
    this.loadAnnonces();
    setInterval(() => this.loadAnnonces(), 300000);
  },
};

window.NF = NF;

