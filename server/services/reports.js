const { readCfg, readObs, readShiftsPlan, readWeeklyProgress } = require('../core/store');
const { reportTZ, tzEndOfDay, tzParts, tzStartOfDay, tzStartOfWeek } = require('../core/time');
const { allEnriched, inRange, isOpen, periodKpis } = require('../core/enrich');
const { holidaySetFor } = require('./absences');

// ── Clôture et encours, une seule définition ──────────────────
// L'encours « semaine dernière » était reconstitué par la Close Date,
// l'encours « cette semaine » par le statut. Un ticket passé en Closed
// sans Close Date restait donc ouvert dans l'historique pour toujours :
// la semaine dernière affichait 13, celle-ci 0, avec un seul ticket fermé
// entre les deux. Les deux encours et les décomptes de clôture passent
// désormais par les mêmes fonctions.
//
// Date de clôture retenue : la Close Date, sinon la dernière modification
// du ticket (c'est en général à ce moment qu'il a été fermé sans saisir la
// date). Un ticket fermé sans aucune date n'est jamais compté ouvert.
const STATUTS_CLOS = ['Resolved', 'Closed'];
const estClos = t => STATUTS_CLOS.includes(t && t.status);
function dateCloture(t) {
  if (!estClos(t)) return null;
  return t.close_date || t.modified_at || null;
}
// Ouvert à l'instant `at` : ouvert avant, et pas encore clos à ce moment.
function ouvertA(t, at) {
  if (!t || !t.open_date) return false;
  const o = new Date(t.open_date);
  if (isNaN(o) || o > at) return false;
  if (!estClos(t)) return true;
  const c = dateCloture(t);
  return !!c && new Date(c) > at;
}
const closDans = (t, from, to) => estClos(t) && inRange(dateCloture(t), from, to);
const sansCloseDate = t => estClos(t) && !t.close_date;

// ── DAILY REPORT ─────────────────────────────────────────────
// Extrait de la route pour que l'ordonnanceur puisse produire le même
// rapport sans requête HTTP : un envoi automatique à 8 h n'a pas de
// client pour l'appeler.
function buildDailyReport(dateQuery, country) {
  const cfg     = readCfg();
  const tz      = reportTZ(cfg);
  const tickets = allEnriched(cfg, country);
  const ref     = dateQuery ? new Date(dateQuery) : new Date();
  const today   = tzStartOfDay(ref, tz);
  const dayEnd  = tzEndOfDay(ref, tz);

  const todayTickets = tickets.filter(t => inRange(t.open_date, today, dayEnd));
  const closedToday  = tickets.filter(t => closDans(t, today, dayEnd));

  // Scoped to the day this report covers - a period report must not quote
  // whole-database figures (see periodKpis).
  const scoped = periodKpis(todayTickets, closedToday, cfg);

  return {
    date: today.toISOString(),
    kpis: {
      ...scoped,
      today: todayTickets.length,
      resolved_today: closedToday.length,
      // Live-wide figures kept alongside, clearly named, for the "as of now"
      // panels that legitimately need them.
      overall_total:  tickets.length,
      overall_open:   tickets.filter(t => ['Open','In Progress'].includes(t.status)).length,
      overall_breach: tickets.filter(t => t.sla_status === 'Breach').length,
    },
    today_tickets: todayTickets,
    breach_tickets: tickets
      .filter(t => t.sla_status === 'Breach' && !['Resolved','Closed'].includes(t.status))
      .sort((a, b) => (a.time_left_ms ?? 0) - (b.time_left_ms ?? 0)),
    // Le registre n'était pas filtré par pays ici, contrairement au
    // rapport hebdomadaire : un Daily SN listait donc les observations
    // ivoiriennes. Même règle que buildWeeklyReport — une observation
    // sans `source` est conservée, c'est une saisie ancienne et non la
    // donnée d'un autre site.
    observations_open: readObs().filter(o => obsInScope(o, country)).filter(o => {
      if (o.status !== 'Closed') return true;
      if (!o.closed_at) return false;
      const d = new Date(o.closed_at); d.setHours(0,0,0,0);
      return d.getTime() === today.getTime();
    }),
  };
}

// ── WEEKLY REPORT ─────────────────────────────────────────────
// Extrait en fonction pour que l'export PPTX parte exactement des mêmes
// chiffres que la page — un deck qui contredit l'écran ne sert à rien.
// Une observation porte son pays dans `source` ('SN' | 'CI'). Le registre
// n'était pas filtré : un rapport SN listait les observations ivoiriennes.
// Une source absente est conservée — c'est une saisie ancienne, pas une
// donnée d'un autre pays.
function obsInScope(o, country) {
  if (!country || country === 'ALL') return true;
  const src = String(o && o.source || '').trim().toUpperCase();
  return !src || src === country;
}

function buildWeeklyReport(dateQuery, country) {
  const cfg = readCfg();
  const tz  = reportTZ(cfg);
  const now = dateQuery ? new Date(dateQuery) : new Date();
  const wkStart = tzStartOfWeek(now, tz);
  const wkEnd   = tzEndOfDay(new Date(wkStart.getTime() + 6 * 86400000), tz);

  // Le périmètre suit le sélecteur de site de l'en-tête. Il était figé
  // sur SN — seul site opéré par le Front Office — mais du coup basculer
  // sur CI ou Global ne changeait rien à l'écran, ce qui se lisait comme
  // un bug. SN reste le défaut quand aucun pays n'est transmis.
  const scope   = country || 'SN';
  // Clé de semaine au format du client (« YYYY-MM-DD » du lundi). On la
  // dérive des composantes locales et non de toISOString() : wkStart est un
  // instant UTC, et sous un fuseau à l'est de Greenwich sa date UTC est
  // celle de la veille — le rapprochement avec le Weekly Progress tombait
  // alors systématiquement une semaine à côté.
  const wkP   = tzParts(wkStart, tz);
  const wkKey = `${wkP.year}-${String(wkP.month).padStart(2, '0')}-`
              + `${String(wkP.day).padStart(2, '0')}`;
  const tickets = allEnriched(cfg, scope);
  const weekTickets = tickets.filter(t => inRange(t.open_date, wkStart, wkEnd));
  const closedWeek  = tickets.filter(t => closDans(t, wkStart, wkEnd));

  const byDomain={}, byPriority={}, byFO={};
  weekTickets.forEach(t => {
    if (t.domain)   byDomain[t.domain]     = (byDomain[t.domain]||0)+1;
    if (t.priority) byPriority[t.priority] = (byPriority[t.priority]||0)+1;
  });
  /* Activité par agent, strictement sur la semaine affichée.
     Auparavant cette boucle parcourait `tickets` — tout l'historique —
     si bien qu'un rapport hebdomadaire affichait la charge de toujours,
     indépendante du créneau. Les trois compteurs sont maintenant datés :

       · open     — tickets OUVERTS pendant la semaine et encore en cours,
                    au porteur du ticket ;
       · resolved — tickets CLÔTURÉS pendant la semaine, au crédit de qui a
                    posé la clôture (closed_by) et non de l'initiateur ;
       · breach   — ruptures SLA sur des tickets ouverts dans la semaine,
                    au porteur.

     Un agent n'apparaît que s'il a une activité dans le créneau. */
  const bump = (fo, key) => {
    const n = String(fo || '').trim();
    if (!n) return;
    if (!byFO[n]) byFO[n] = { open: 0, resolved: 0, breach: 0 };
    byFO[n][key]++;
  };
  weekTickets.forEach(t => {
    const owner = t.assigned_to || t.fo_owner;
    if (isOpen(t)) bump(owner, 'open');
    if (t.sla_status === 'Breach')                  bump(owner, 'breach');
  });
  closedWeek.forEach(t => {
    // `closed_by` est posé à la transition vers Resolved/Closed. Les
    // tickets antérieurs à ce champ retombent sur le porteur — c'est la
    // meilleure approximation disponible pour l'historique.
    bump(t.closed_by || t.assigned_to || t.fo_owner, 'resolved');
  });
  const scoped = periodKpis(weekTickets, closedWeek, cfg);

  /* Semaine précédente, calculée sur exactement les mêmes règles que la
     semaine courante — même périmètre, mêmes filtres de dates, même
     fonction de KPI. C'est la condition pour que la comparaison ait un
     sens : deux méthodes de calcul différentes produiraient un écart qui
     ne dit rien de l'activité.

     Sert la slide « Trend », qui répond à la question que le deck ne
     traitait pas : est-ce que ça s'améliore ou se dégrade ? */
  const prevStart = new Date(wkStart.getTime() - 7 * 86400000);
  const prevEnd   = tzEndOfDay(new Date(prevStart.getTime() + 6 * 86400000), tz);
  const prevOpened = tickets.filter(t => inRange(t.open_date, prevStart, prevEnd));
  const prevClosed = tickets.filter(t => closDans(t, prevStart, prevEnd));
  const prevScoped = periodKpis(prevOpened, prevClosed, cfg);

  /* Historique court : les huit semaines qui précèdent, semaine courante
     incluse. Deux points ne disent pas si un écart est une tendance ou du
     bruit hebdomadaire — c'est précisément l'erreur de lecture que fait
     une revue devant une comparaison isolée. Ces séries alimentent les
     courbes de la slide Trend. */
  const HIST_WEEKS = 8;
  const history = [];
  for (let i = HIST_WEEKS - 1; i >= 0; i--) {
    const hs = new Date(wkStart.getTime() - i * 7 * 86400000);
    const he = tzEndOfDay(new Date(hs.getTime() + 6 * 86400000), tz);
    const op = tickets.filter(t => inRange(t.open_date, hs, he));
    const cl = tickets.filter(t => closDans(t, hs, he));
    const k  = periodKpis(op, cl, cfg);
    const p  = tzParts(hs, tz);
    history.push({
      week_start: hs.toISOString(),
      label: `${String(p.day).padStart(2,'0')}/${String(p.month).padStart(2,'0')}`,
      opened: op.length,
      closed: cl.length,
      breach: k.breach,
      sla_compliance: k.sla_compliance,
      mttr_ms: k.mttr_ms,
      // MTTD suit une cible chiffrée (5 min) dans le deck Weekly : sa
      // courbe sur huit semaines dit si un dépassement est ponctuel ou
      // installé, ce qu'une comparaison à la seule semaine passée ne dit pas.
      mttd_ms: k.mttd_ms,
    });
  }

  /* Mouvement par domaine : le total peut être stable alors qu'un domaine
     s'effondre et qu'un autre se calme. C'est là que se prend la décision
     — on ne réaffecte pas une équipe sur un total, mais sur un domaine. */
  const domMove = {};
  weekTickets.forEach(t => {
    if (!t.domain) return;
    (domMove[t.domain] = domMove[t.domain] || { now: 0, was: 0 }).now++;
  });
  prevOpened.forEach(t => {
    if (!t.domain) return;
    (domMove[t.domain] = domMove[t.domain] || { now: 0, was: 0 }).was++;
  });

  /* Contexte d'une semaine calme. Un deck à « 0 0 0 » se lit comme une
     panne ou un oubli de saisie ; ces éléments permettent de dire ce qui
     s'est réellement passé : depuis quand rien n'est entré, si la semaine
     comptait des jours fériés, si l'équipe était bien en poste. */
  const avant = t => t && new Date(t).getTime() < wkStart.getTime();
  const derniere = champ => tickets.map(t => t[champ]).filter(avant)
    .sort((x, y) => new Date(y) - new Date(x))[0] || null;
  const isoJour = d => { const q = tzParts(d, tz);
    return `${q.year}-${String(q.month).padStart(2, '0')}-${String(q.day).padStart(2, '0')}`; };
  const joursSemaine = Array.from({ length: 7 }, (_, i) => isoJour(new Date(wkStart.getTime() + i * 86400000 + 3600000)));
  const feries = holidaySetFor(scope === 'ALL' ? null : scope);
  let shifts = [];
  try {
    shifts = readShiftsPlan().filter(sh => sh && !sh.is_rest && joursSemaine.includes(sh.date)
      && (scope === 'ALL' || !sh.tracker || sh.tracker === scope));
  } catch {}
  const activityContext = {
    last_opened_before: derniere('open_date'),
    last_closed_before: derniere('close_date'),
    holidays: joursSemaine.filter(j => feries.has(j)),
    shifts_covered: shifts.length,
    agents_on_shift: new Set(shifts.map(sh => sh.fo_name).filter(Boolean)).size,
    // Observations saisies pendant la semaine, tous statuts : une panne
    // de supervision close le mercredi explique quand même un creux.
    week_observations: readObs().filter(o => o && o.observation && obsInScope(o, scope)
      && inRange(o.date || o.created_at, wkStart, wkEnd)),
  };

  return {
    week_start: wkStart, week_end: wkEnd,
    prev_week_start: prevStart, prev_week_end: prevEnd,
    activity_context: activityContext,
    // Même jeu de clés que `kpis` : la slide compare champ à champ sans
    // avoir à connaître deux vocabulaires.
    prev_kpis: {
      ...prevScoped,
      opened_this_week:   prevOpened.length,
      resolved_this_week: prevClosed.length,
      // Encours en fin de semaine précédente : tickets ouverts avant la
      // fin de cette semaine-là et non clos à cette date. Recalculé et non
      // déduit du compteur courant, qui bouge en continu.
      overall_open: tickets.filter(t => ouvertA(t, prevEnd)).length,
    },
    trend_history: history,
    domain_move: domMove,
    kpis:{
      ...scoped,
      opened_this_week: weekTickets.length,
      resolved_this_week: closedWeek.length,
      overall_total:  tickets.length,
      // Encours à la fin de la semaine affichée (ou maintenant, si elle est
      // en cours) : même calcul que la semaine précédente, pour que
      // encours précédent + ouverts − clos retombe sur ce chiffre.
      overall_open:   tickets.filter(t => ouvertA(t, new Date(Math.min(wkEnd.getTime(), Date.now())))).length,
      // Tickets fermés sans Close Date : leur clôture est datée par leur
      // dernière modification. Signalé pour qu'on les complète.
      closed_without_date: tickets.filter(sansCloseDate).length,
      overall_breach: tickets.filter(t=>t.sla_status==='Breach').length,
    },
    week_tickets: weekTickets,
    // Clôtures de la semaine, y compris des tickets ouverts avant elle, avec
    // leur date de clôture effective (Close Date, sinon dernière
    // modification). Les courbes « fermés par jour » des decks ne voyaient
    // que les tickets ouverts dans la semaine.
    closed_week_tickets: closedWeek.map(t => ({ ...t, close_date: dateCloture(t) })),
    active_tickets: tickets.filter(isOpen),
    by_domain: byDomain, by_priority: byPriority, by_fo: byFO,
    fo_list: cfg.fo_list||[],
    observations_open: readObs()
      .filter(o => o.status === 'Open' && obsInScope(o, scope)),
    // Weekly progress de la même semaine : ce que les agents déclarent
    // avoir fait (Done) et ce qu'ils portent encore (In Progress /
    // Planned). Le deck n'y avait pas accès, alors que c'est la seule
    // source de « ce qui a été accompli » qui ne se déduit pas des tickets.
    weekly_progress: readWeeklyProgress().filter(p => {
      if (!p) return false;
      if (p.week_start !== wkKey) return false;
      // `tracker` porte le pays sur ces entrées, comme sur les tickets.
      const tr = String(p.tracker || '').trim().toUpperCase();
      return !tr || scope === 'ALL' || tr === scope;
    }),
  };
}

module.exports = {
  buildDailyReport, buildWeeklyReport,
  // Exposés pour les tests
  ouvertA, closDans, dateCloture,
};
