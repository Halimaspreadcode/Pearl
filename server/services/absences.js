const { FILES } = require('../config/paths');
const { readCfg, readHolidays, readJSON, readShiftsPlan, writeJSON, personSiteCodes } = require('../core/store');

// ── ABSENCES ──────────────────────────────────────────────────
// Toutes les routes sont derrière `requireAbsence` : le verrou est
// réel, pas seulement un écran côté client.
function readAbsences() {
  const list = readJSON(FILES.absences, []);
  // Rattrapage des enregistrements écrits avant la garde du POST : un
  // statut vide les rendait invisibles aux soldes et au taux d'absence,
  // alors qu'ils s'affichaient dans la liste. On les relit comme
  // « Demandée », le statut par défaut à la création, et on réécrit une
  // seule fois : la réparation est ainsi durable plutôt que recalculée à
  // chaque lecture.
  let patched = false;
  for (const a of list) {
    if (a && !a.status) { a.status = 'Demandée'; patched = true; }
  }
  if (patched) writeJSON(FILES.absences, list);
  return list;
}

// Types d'absence. `deducts` : l'absence consomme le solde de congés.
// `paid` sert au calcul du coût, `planned` distingue le prévu (posé à
// l'avance) du subi (maladie, urgence) — un taux d'absentéisme non
// planifié est le vrai signal opérationnel.
const ABSENCE_TYPES = {
  'Congés payés':      { deducts: true,  paid: true,  planned: true  },
  'RTT':               { deducts: true,  paid: true,  planned: true  },
  'Maladie':           { deducts: false, paid: true,  planned: false },
  'Accident travail':  { deducts: false, paid: true,  planned: false },
  'Maternité':         { deducts: false, paid: true,  planned: true  },
  'Paternité':         { deducts: false, paid: true,  planned: true  },
  'Formation':         { deducts: false, paid: true,  planned: true  },
  // Déplacement chez le client : l'agent travaille, il n'est simplement
  // pas sur site. Ni décompté du solde, ni subi — d'où planned:true.
  'On-Site (Delivery)': { deducts: false, paid: true,  planned: true  },
  'Sans solde':        { deducts: false, paid: false, planned: true  },
  'Absence injustifiée': { deducts: false, paid: false, planned: false },
  'Autre':             { deducts: false, paid: true,  planned: true  },
};

const ABSENCE_STATUSES = ['Demandée', 'Validée', 'Refusée', 'Annulée'];

// Prévenu ou pas. Distinct du statut (qui dit où en est la demande) et
// du caractère planifié du type : une maladie reste non planifiable,
// mais l'agent qui appelle à 6 h du matin ne laisse pas le même trou
// qu'un agent qui ne prévient jamais. `ok:false` = non couvert.
const ABSENCE_NOTICES = {
  'Prévenu à l\'avance': { ok: true,  rank: 0 },
  'Prévenu le jour même': { ok: true,  rank: 1 },
  'Prévenu en retard':    { ok: false, rank: 2 },
  'Non prévenu':          { ok: false, rank: 3 },
};

// Un préavis qu'on ne sait pas lire n'est pas un préavis prouvé : il
// compte comme non conforme plutôt que de faire planter l'agrégat.
function noticeOk(n) {
  return ABSENCE_NOTICES[n]?.ok === true;
}

// Itère les jours d'une plage, bornes incluses, en UTC pour éviter les
// glissements de date liés au fuseau local du serveur.
function eachDay(from, to, fn) {
  const d = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  if (isNaN(d) || isNaN(end) || end < d) return;
  // Garde-fou : une plage aberrante ne doit pas boucler indéfiniment.
  let guard = 0;
  while (d <= end && guard++ < 3660) {
    fn(d.toISOString().slice(0, 10), d.getUTCDay());
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

// Jours décomptés : on exclut le week-end et les fériés du pays, sinon
// un congé posé du vendredi au lundi coûterait 4 jours au lieu de 2.
// Une demi-journée compte 0,5 et n'a de sens que sur une plage d'un jour.
function absenceWorkingDays(a, holidaySet) {
  if (a.half_day && a.date_from === a.date_to) return 0.5;
  let n = 0;
  eachDay(a.date_from, a.date_to, (iso, dow) => {
    if (dow === 0 || dow === 6) return;
    if (holidaySet.has(iso)) return;
    n++;
  });
  return n;
}

function holidaySetFor(country) {
  const set = new Set();
  for (const h of readHolidays()) {
    if (!country || !h.country || h.country === country) set.add(h.date);
  }
  return set;
}

// Le reste du serveur ne valide rien ; ici les dates pilotent des
// soldes et des conflits de planning, donc une plage inversée ou un
// type inconnu doit être refusé à l'entrée plutôt que corrompre les
// calculs en aval.
function validateAbsence(a) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!a.fo_name || !String(a.fo_name).trim()) return 'Agent requis';
  if (!iso.test(a.date_from || '')) return 'Invalid start date';
  if (!iso.test(a.date_to   || '')) return 'Date de fin invalide';
  if (a.date_to < a.date_from)      return 'The end date is before the start date';
  if (!ABSENCE_TYPES[a.type])       return 'Type d\'absence inconnu';
  if (a.status && !ABSENCE_STATUSES.includes(a.status)) return 'Statut inconnu';
  if (a.notice && !ABSENCE_NOTICES[NOTICE_ALIASES[a.notice] || a.notice])
    return 'Unknown notice level';
  if (a.half_day && a.date_from !== a.date_to)
    return 'A half day must fall on a single date';
  return null;
}

// Préavis par défaut, quand il n'est pas renseigné. Une absence posée
// avant son premier jour a forcément été annoncée ; une absence saisie
// après coup ne dit rien, on la laisse à qualifier plutôt que de
// supposer une faute.
// Anciens enregistrements importés : le préavis y est un slug anglais,
// alors que la table est indexée par libellé. Non traduits, ils sortaient
// `undefined` d'ABSENCE_NOTICES et faisaient planter les agrégats.
const NOTICE_ALIASES = {
  advance:   'Prévenu à l\'avance',
  same_day:  'Prévenu le jour même',
  late:      'Prévenu en retard',
  none:      'Non prévenu',
};

function defaultNotice(a) {
  if (a.notice) return NOTICE_ALIASES[a.notice] || a.notice;
  const created = (a.created_at || '').slice(0, 10);
  if (created && created < a.date_from)  return 'Prévenu à l\'avance';
  if (created && created === a.date_from) return 'Prévenu le jour même';
  // Saisie APRÈS le début de l'absence : personne n'a prévenu avant, on
  // l'a constatée. Ce cas retournait '' — et le test du score, écrit
  // `n && !noticeOk(n)`, ignore une chaîne vide : le pire cas ne coûtait
  // donc aucun point, alors qu'une absence simplement « prévenue en
  // retard » en coûtait 10.
  if (created && created > a.date_from) return 'Non prévenu';
  return '';
}

// Calcul de la synthèse, partagé par la route JSON, le rapport PDF et
// la diffusion e-mail. Paramètres au format de la query string.
// `agentsDuPays` : ne garder que les agents rattachés au pays (fo_trackers,
// premier site par défaut) et leurs absences — pour le rapport envoyé par site.
// Sans lui, le pays ne règle que les jours fériés, comme la page Absences.
function computeAbsenceSummary({ country: qCountry, year: qYear, from: qFrom, to: qTo, agentsDuPays = false } = {}) {
    const cfg      = readCfg();
    const country  = qCountry && qCountry !== 'ALL' ? qCountry : null;
    const year     = Number(qYear) || new Date().getUTCFullYear();
    const from     = qFrom || `${year}-01-01`;
    const to       = qTo   || `${year}-12-31`;
    const holidays = holidaySetFor(country);
    const trackerDe = n => personSiteCodes(n, cfg);
    const agentsPays = agentsDuPays && country ? (cfg.fo_list || []).filter(n => trackerDe(n).includes(country)) : null;
    const all      = agentsPays ? readAbsences().filter(a => agentsPays.includes(a.fo_name)) : readAbsences();

    // Une absence compte si elle recouvre la période, même partiellement.
    const inRange = all.filter(a => a.date_from <= to && a.date_to >= from);
    // Les refusées et annulées ne consomment ni solde ni capacité.
    const counted = inRange.filter(a => a.status === 'Validée' || a.status === 'Demandée');

    const entitlement = Number(cfg.leave_entitlement_days) || 30;
    const foList = agentsPays || cfg.fo_list || [];

    // Soldes : seuls les types `deducts` entament le droit à congés, et
    // seules les absences validées le consomment réellement.
    const balances = foList.map(name => {
      const mine = counted.filter(a => a.fo_name === name);
      const days = a => absenceWorkingDays(a, holidays);
      const taken = mine
        .filter(a => a.status === 'Validée' && ABSENCE_TYPES[a.type]?.deducts)
        .reduce((s, a) => s + days(a), 0);
      const pending = mine
        .filter(a => a.status === 'Demandée' && ABSENCE_TYPES[a.type]?.deducts)
        .reduce((s, a) => s + days(a), 0);
      const sick = mine
        .filter(a => a.type === 'Maladie' || a.type === 'Accident travail')
        .reduce((s, a) => s + days(a), 0);
      const total = mine.reduce((s, a) => s + days(a), 0);
      // Manquements au préavis : seuls les épisodes qualifiés comptent,
      // un préavis vide est « à qualifier », pas une faute.
      const qualified = mine.filter(a => defaultNotice(a));
      const noNotice  = qualified.filter(a => !noticeOk(defaultNotice(a)));
      return {
        fo_name: name,
        entitlement,
        taken, pending,
        remaining: Math.round((entitlement - taken - pending) * 10) / 10,
        sick_days: sick,
        total_days: total,
        // Nombre d'épisodes distincts : 5 arrêts d'un jour ne pèsent pas
        // comme un arrêt de 5 jours dans un suivi d'absentéisme.
        episodes: mine.length,
        no_notice_episodes: noNotice.length,
        no_notice_days: Math.round(noNotice.reduce((s, a) => s + days(a), 0) * 10) / 10,
        unqualified: mine.length - qualified.length,
      };
    });

    // Jours ouvrés de la période : dénominateur du taux d'absentéisme.
    let workingDays = 0;
    eachDay(from, to, (isoDay, dow) => {
      if (dow !== 0 && dow !== 6 && !holidays.has(isoDay)) workingDays++;
    });

    const totalDays     = counted.reduce((s, a) => s + absenceWorkingDays(a, holidays), 0);
    const unplannedDays = counted
      .filter(a => !ABSENCE_TYPES[a.type]?.planned)
      .reduce((s, a) => s + absenceWorkingDays(a, holidays), 0);
    const capacity = workingDays * (foList.length || 1);

    // Répartition par type, pour la barre de composition du client.
    const byType = {};
    for (const a of counted) {
      byType[a.type] = (byType[a.type] || 0) + absenceWorkingDays(a, holidays);
    }

    // Préavis : répartition et taux de couverture. Le taux se calcule
    // sur les seuls épisodes qualifiés, sinon un backlog non renseigné
    // ferait chuter artificiellement l'indicateur.
    const byNotice = {};
    let noticeOkCount = 0, noticeKo = 0, noticeUnknown = 0;
    for (const a of counted) {
      const n = defaultNotice(a);
      if (!n) { noticeUnknown++; continue; }
      byNotice[n] = (byNotice[n] || 0) + 1;
      if (noticeOk(n)) noticeOkCount++; else noticeKo++;
    }
    const noticeQualified = noticeOkCount + noticeKo;

    // Conflits : un agent absent alors qu'il est planifié sur un shift.
    // C'est le vrai apport du croisement — le planning ne sait pas seul
    // qu'une personne est en congé.
    const absentByDay = new Map(); // 'iso|nom' -> absence
    for (const a of counted) {
      if (a.status === 'Refusée' || a.status === 'Annulée') continue;
      eachDay(a.date_from, a.date_to, isoDay => {
        absentByDay.set(`${isoDay}|${a.fo_name}`, a);
      });
    }
    const conflicts = [];
    if (absentByDay.size) {
      for (const s of readShiftsPlan()) {
        if (s.is_rest || !s.date || s.date < from || s.date > to) continue;
        if (country && s.tracker && s.tracker !== country) continue;
        const hit = absentByDay.get(`${s.date}|${s.fo_name}`);
        if (!hit) continue;
        conflicts.push({
          date: s.date,
          fo_name: s.fo_name,
          shift_name: s.shift_name || s.shift_id || '—',
          shift_entry_id: s.id,
          absence_id: hit.id,
          absence_type: hit.type,
          absence_status: hit.status,
        });
      }
      conflicts.sort((a, b) => a.date.localeCompare(b.date));
    }

    // Effectif absent par jour : sert la courbe de couverture et
    // signale les jours où l'équipe passe sous le seuil.
    const perDay = {};
    for (const a of counted) {
      eachDay(a.date_from, a.date_to, (isoDay, dow) => {
        if (dow === 0 || dow === 6 || holidays.has(isoDay)) return;
        if (isoDay < from || isoDay > to) return;
        (perDay[isoDay] = perDay[isoDay] || []).push(a.fo_name);
      });
    }

    return {
      from, to, year, country,
      headcount: foList.length,
      working_days: workingDays,
      total_days: Math.round(totalDays * 10) / 10,
      unplanned_days: Math.round(unplannedDays * 10) / 10,
      absence_rate: capacity ? Math.round((totalDays / capacity) * 1000) / 10 : 0,
      unplanned_rate: capacity ? Math.round((unplannedDays / capacity) * 1000) / 10 : 0,
      pending_count: inRange.filter(a => a.status === 'Demandée').length,
      by_type: byType,
      by_notice: byNotice,
      notice_ok: noticeOkCount,
      notice_ko: noticeKo,
      notice_unknown: noticeUnknown,
      // Part des absences correctement annoncées, parmi celles dont le
      // préavis est renseigné.
      notice_rate: noticeQualified ? Math.round((noticeOkCount / noticeQualified) * 1000) / 10 : null,
      balances,
      conflicts,
      per_day: perDay,
      types: ABSENCE_TYPES,
      statuses: ABSENCE_STATUSES,
      notices: ABSENCE_NOTICES,
    };
}

module.exports = {
  readAbsences, ABSENCE_TYPES, noticeOk, eachDay, holidaySetFor,
  validateAbsence, defaultNotice, computeAbsenceSummary,
};
