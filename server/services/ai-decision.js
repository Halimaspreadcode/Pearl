const { readCfg, readWeeklyProgress, readShiftsPlan, readObs } = require('../core/store');

// ══════════════════════════════════════════════════════════════
// RAPPORT D'AIDE À LA DÉCISION
//
// Le serveur calcule les faits ; Big Brother ne fait que les lire. Chaque
// décision qu'il propose doit pouvoir se vérifier dans ces chiffres, qui
// sont aussi affichés tels quels à côté de sa lecture.
//
//   · Opérations : flux, backlog, SLA, ruptures, MTTR sur la période, et
//     la même chose sur la période précédente pour la tendance ; d'où
//     viennent les ruptures (type, priorité, domaine).
//   · Charge : tickets par agent, part des deux plus chargés.
//   · Équipe : notes, objectifs, One-to-One, tâches (bilan d'équipe).
//   · Planning : couverture des 7 prochains jours, absences comprises
//     (nombre seulement, jamais le motif).
//   · Qualité des données : ce qui fausse les chiffres.
//
// Les agents partent sous alias (« Agent 01 ») ; les vrais noms ne
// reviennent qu'à l'affichage.
// ══════════════════════════════════════════════════════════════

const H = 3600000, J = 24 * H;
const iso = d => new Date(d).toISOString().slice(0, 10);
const pct = (a, b) => (b ? Math.round(a / b * 1000) / 10 : null);
const evol = (a, b) => (a == null || b == null || !b ? null : Math.round((a - b) / b * 100));

function bornes(periode) {
  const fin = new Date();
  const jours = periode === 'mois' ? 30 : 7;
  const debut = new Date(fin.getTime() - jours * J);
  const avant = new Date(debut.getTime() - jours * J);
  return { jours, debut, fin, avant };
}

function estClos(t) { return ['Resolved', 'Closed'].includes(t.status); }
function fin(t) { return t.close_date || t.closed_by_at || t.modified_at || null; }
const dans = (v, a, b) => { const x = v ? new Date(v) : null; return !!x && !isNaN(x) && x >= a && x < b; };
function ouvertA(t, at) {
  const o = t.open_date ? new Date(t.open_date) : null;
  if (!o || isNaN(o) || o > at) return false;
  if (!estClos(t)) return true;
  const c = fin(t);
  return !!c && new Date(c) > at;
}

function statsOps(tickets, a, b) {
  const ouverts = tickets.filter(t => dans(t.open_date, a, b));
  const clos = tickets.filter(t => estClos(t) && dans(fin(t), a, b));
  const evalues = clos.filter(t => !['N/A', 'On Hold'].includes(t.sla_status));
  const ruptures = evalues.filter(t => t.sla_status === 'Breach');
  const durees = clos.map(t => (t.open_date && fin(t) ? new Date(fin(t)) - new Date(t.open_date) : null))
    .filter(v => v != null && v >= 0).sort((x, y) => x - y);
  const med = durees.length ? durees[Math.floor(durees.length / 2)] : null;
  return {
    ouverts: ouverts.length, clos: clos.length,
    backlog_debut: tickets.filter(t => ouvertA(t, a)).length,
    backlog_fin: tickets.filter(t => ouvertA(t, b)).length,
    sla_pct: pct(evalues.length - ruptures.length, evalues.length),
    ruptures: ruptures.length,
    p1_p2: ouverts.filter(t => ['P1', 'P2'].includes(String(t.priority).toUpperCase())).length,
    resolution_mediane_h: med == null ? null : Math.round(med / H * 10) / 10,
    _ruptures: ruptures, _clos: clos, _ouverts: ouverts,
  };
}

function top(liste, cle, n = 4) {
  const m = new Map();
  for (const t of liste) { const k = cle(t) || 'non renseigné'; m.set(k, (m.get(k) || 0) + 1); }
  return [...m].sort((x, y) => y[1] - x[1]).slice(0, n).map(([k, v]) => ({ valeur: k, nombre: v, part_pct: pct(v, liste.length) }));
}

// Couverture des 7 prochains jours : agents planifiés (hors repos) moins
// les absents (absence validée ou demandée couvrant le jour).
function couverture(ps) {
  let plan = [], abs = [];
  try { plan = readShiftsPlan() || []; } catch {}
  try { abs = require('./absences').readAbsences() || []; } catch {}
  const auj = iso(Date.now());
  const jours = Array.from({ length: 7 }, (_, i) => iso(Date.now() + i * J));
  const absent = (fo, d) => abs.some(a => a && a.fo_name === fo && ['Validée', 'Demandée'].includes(a.status)
    && String(a.date_from || '') <= d && d <= String(a.date_to || a.date_from || ''));
  const parJour = jours.map(d => {
    const lignes = plan.filter(s => s && s.date === d && !s.is_rest && s.shift_id !== 'rest');
    const creneaux = {};
    for (const s of lignes) {
      const k = `${s.site_name || s.tracker || ''} · ${s.shift_name || s.shift_id}`.trim();
      const c = creneaux[k] = creneaux[k] || { planifies: 0, absents: 0, agents_absents: [] };
      c.planifies++;
      if (absent(s.fo_name, d)) { c.absents++; c.agents_absents.push(ps.alias(s.fo_name)); }
    }
    return { date: d, creneaux: Object.entries(creneaux).map(([k, v]) => ({ creneau: k, ...v, presents: v.planifies - v.absents })) };
  });
  // Fragile : un créneau qui perd quelqu'un (absence sur un shift planifié)
  // ou qui n'a plus personne. Un créneau tenu à une personne par conception
  // (nuit) n'est pas signalé tant que cette personne est là.
  const fragiles = parJour.flatMap(j => j.creneaux.filter(c => c.absents > 0 || c.presents === 0).map(c => ({ date: j.date, ...c })));
  return { depuis: auj, planning_saisi: plan.some(s => s && s.date >= auj), jours: parJour, creneaux_fragiles: fragiles.slice(0, 12) };
}

function donneesDecision({ periode = 'semaine', perimetre = 'ALL' } = {}) {
  const cfg = readCfg();
  const { pseudonymes, bilanEquipe, signauxOps } = require('./ai-team');
  const ps = pseudonymes(cfg.fo_list || []);
  const { jours, debut, fin: finP, avant } = bornes(periode);
  let tickets = [];
  try { tickets = require('../core/enrich').allEnriched(cfg, perimetre); } catch {}

  const cur = statsOps(tickets, debut, finP);
  const prev = statsOps(tickets, avant, debut);
  const ouvertsMaintenant = tickets.filter(t => !estClos(t));

  // Charge par agent sur la période (tickets ouverts ou clos par lui).
  const charge = new Map();
  for (const t of [...cur._ouverts, ...cur._clos]) {
    const fo = t.assigned_to || t.fo_owner;
    if (!fo) continue;
    const c = charge.get(fo) || { tickets: new Set(), ruptures: 0 };
    c.tickets.add(t.id);
    charge.set(fo, c);
  }
  for (const t of cur._ruptures) { const c = charge.get(t.assigned_to || t.fo_owner); if (c) c.ruptures++; }
  const lignesCharge = [...charge].map(([fo, c]) => ({ fo, tickets: c.tickets.size, ruptures: c.ruptures }))
    .sort((a, b) => b.tickets - a.tickets);
  const totalCharge = lignesCharge.reduce((n, l) => n + l.tickets, 0);
  const deuxPlus = lignesCharge.slice(0, 2).reduce((n, l) => n + l.tickets, 0);

  const equipe = bilanEquipe();
  const cov = couverture(ps);
  const ops = signauxOps();
  let pannes = 0;
  try { const { isOutage } = require('./weekly-combined'); pannes = readObs().filter(o => o.status === 'Open' && isOutage(o)).length; } catch {}
  const tachesAdmin = (readWeeklyProgress() || []).filter(t => t && t.admin_task);

  const qualite = {
    clos_sans_date_cloture: tickets.filter(t => estClos(t) && !t.close_date).length,
    sans_type_ou_sans_sla: tickets.filter(t => t.sla_status === 'N/A').length,
    notes_non_saisies_mois: (equipe.faits.lignes || []).filter(l => l.score == null).length,
    planning_non_saisi: !cov.planning_saisi,
  };

  const indicateurs = {
    tickets_ouverts: { valeur: cur.ouverts, avant: prev.ouverts, evolution_pct: evol(cur.ouverts, prev.ouverts) },
    tickets_clos: { valeur: cur.clos, avant: prev.clos, evolution_pct: evol(cur.clos, prev.clos) },
    backlog: { debut: cur.backlog_debut, fin: cur.backlog_fin, evolution: cur.backlog_fin - cur.backlog_debut },
    sla_pct: { valeur: cur.sla_pct, avant: prev.sla_pct },
    ruptures_sla: { valeur: cur.ruptures, avant: prev.ruptures },
    p1_p2_ouverts: { valeur: cur.p1_p2, avant: prev.p1_p2 },
    resolution_mediane_h: { valeur: cur.resolution_mediane_h, avant: prev.resolution_mediane_h },
    maintenant: { ouverts: ouvertsMaintenant.length, en_rupture: ops.resume.breach, proches_rupture: ops.resume.near, pannes_en_cours: pannes },
  };

  const donnees = {
    periode: `${periode === 'mois' ? '30 derniers jours' : '7 derniers jours'} (${iso(debut)} → ${iso(finP)})`,
    perimetre: perimetre === 'ALL' ? 'Dakar et Abidjan' : perimetre === 'SN' ? 'Dakar (SN)' : 'Abidjan (CI)',
    indicateurs,
    origine_des_ruptures: {
      par_type_priorite: top(cur._ruptures, t => `${t.type || '?'} ${t.priority || ''}`.trim()),
      par_domaine: top(cur._ruptures, t => t.domain),
    },
    volume_par_domaine: top(cur._ouverts, t => t.domain, 5),
    charge: {
      agents_actifs: lignesCharge.length,
      part_des_deux_plus_charges_pct: pct(deuxPlus, totalCharge),
      par_agent: lignesCharge.slice(0, 12).map(l => ({ agent: ps.alias(l.fo), tickets: l.tickets, ruptures: l.ruptures })),
    },
    equipe: {
      ...equipe.donnees.equipe,
      agents: equipe.donnees.agents.map(a => ({
        agent: a.agent, note: a.notes[0]?.score ?? null, note_avant: a.notes[1]?.score ?? null,
        objectifs_en_retard: a.objectifs.en_retard, one_to_one_jours: a.one_to_one.jours_depuis,
        taches_en_retard: a.taches.en_retard,
      })),
      taches_assignees_ouvertes: tachesAdmin.filter(t => t.status !== 'Done').length,
    },
    planning_7_jours: { creneaux_fragiles: cov.creneaux_fragiles, planning_saisi: cov.planning_saisi },
    signaux: ops.items.map(i => `[${i.lvl}] ${i.txt}`),
    qualite_des_donnees: qualite,
  };

  // Ce que la page affiche à côté de la lecture : mêmes chiffres, vrais noms.
  const faits = {
    periode: donnees.periode, perimetre: donnees.perimetre, indicateurs,
    ruptures_par_type: donnees.origine_des_ruptures.par_type_priorite,
    ruptures_par_domaine: donnees.origine_des_ruptures.par_domaine,
    charge: lignesCharge.slice(0, 8), part_deux_plus_charges: donnees.charge.part_des_deux_plus_charges_pct,
    creneaux_fragiles: cov.creneaux_fragiles.map(c => ({ ...c, agents_absents: c.agents_absents.map(ps.versNom) })),
    qualite,
  };
  return { donnees, faits, ps, jours };
}

// ── Version sans IA ───────────────────────────────────────────
// Quand le modèle ne répond pas ou rend un JSON illisible, le rapport se
// construit avec des règles simples sur les mêmes faits : rien d'inventé,
// pas de recommandation rédigée, mais les arbitrages évidents restent.
function decisionSansIa(f, raison) {
  const k = f.indicateurs || {};
  const v = x => (x && x.valeur != null ? x.valeur : null);
  const decisions = [];
  const ruptures = v(k.ruptures_sla) || 0;
  const sla = v(k.sla_pct);
  const topT = (f.ruptures_par_type || [])[0], topD = (f.ruptures_par_domaine || [])[0];
  if (ruptures > 0) {
    const origine = topD && topD.valeur !== 'non renseigné' ? topD : topT;
    decisions.push({
      titre: 'Faut-il traiter l\'origine des ruptures de SLA ?',
      constat: `${ruptures} rupture(s) sur la période${sla != null ? `, SLA tenu à ${sla} %` : ''}${origine ? `, dont ${origine.nombre} sur ${origine.valeur}` : ''}.`,
      options: [
        { option: origine ? `Analyse de cause sur ${origine.valeur}` : 'Analyse de cause des ruptures', pour: 'traite la cause', contre: 'une réunion à prévoir' },
        { option: 'Suivi rapproché des tickets proches de la rupture', pour: 'effet immédiat', contre: 'ne règle pas la cause' },
      ],
      recommandation: '', si_rien: 'Les ruptures risquent de se répéter.',
      urgence: ruptures >= 3 || (sla != null && sla < 90) ? 'haute' : 'moyenne', echeance: 'cette semaine',
      indicateur_de_suivi: 'Nombre de ruptures SLA la semaine suivante',
    });
  }
  const charge = f.charge || [];
  if (charge.length >= 3 && (f.part_deux_plus_charges || 0) >= 50) {
    decisions.push({
      titre: 'Faut-il rééquilibrer la charge ?',
      constat: `${charge[0].fo} et ${charge[1].fo} portent ${f.part_deux_plus_charges} % des tickets de la période.`,
      options: [
        { option: 'Réaffecter une partie des nouveaux tickets', pour: 'soulage vite', contre: 'montée en compétence des autres' },
        { option: 'Binômes sur les domaines concernés', pour: 'partage le savoir', contre: 'plus lent au début' },
      ],
      recommandation: '', si_rien: 'Fatigue et risque de rupture sur les agents les plus chargés.',
      urgence: 'moyenne', echeance: 'cette semaine', indicateur_de_suivi: 'Part des deux plus chargés',
    });
  }
  const fragiles = f.creneaux_fragiles || [];
  if (fragiles.length) {
    const vides = fragiles.filter(c => c.presents === 0).length;
    decisions.push({
      titre: 'Faut-il renforcer des créneaux du planning ?',
      constat: `${fragiles.length} créneau(x) fragile(s) sur 7 jours${vides ? `, dont ${vides} sans personne` : ''} (premier : ${fragiles[0].date}, ${fragiles[0].creneau}).`,
      options: [
        { option: 'Déplacer un agent sur ces créneaux', pour: 'couverture assurée', contre: 'affaiblit un autre créneau' },
        { option: 'Astreinte ou heures supplémentaires', pour: 'garde le planning', contre: 'coût et fatigue' },
      ],
      recommandation: '', si_rien: 'Tickets non pris en charge sur ces créneaux.',
      urgence: vides ? 'haute' : 'moyenne', echeance: vides ? 'aujourd\'hui' : 'cette semaine',
      indicateur_de_suivi: 'Créneaux fragiles à 7 jours',
    });
  }
  const ordre = { haute: 0, moyenne: 1, basse: 2 };
  decisions.sort((a, b) => ordre[a.urgence] - ordre[b.urgence]);
  const surv = [];
  const bl = k.backlog || {};
  if (bl.evolution > 0) surv.push(`Backlog en hausse : ${bl.debut} -> ${bl.fin}`);
  const med = k.resolution_mediane_h || {};
  if (med.valeur != null && med.avant != null && med.valeur > med.avant) surv.push(`Résolution médiane en hausse : ${med.avant} h -> ${med.valeur} h`);
  const q = f.qualite || {};
  const incertitudes = [
    q.clos_sans_date_cloture ? `${q.clos_sans_date_cloture} ticket(s) clos sans date de clôture` : '',
    q.sans_type_ou_sans_sla ? `${q.sans_type_ou_sans_sla} ticket(s) sans SLA calculable` : '',
    q.planning_non_saisi ? 'Planning des 7 prochains jours non saisi' : '',
  ].filter(Boolean);
  const situation = [
    `${v(k.tickets_ouverts) ?? 0} ticket(s) ouvert(s) et ${v(k.tickets_clos) ?? 0} clos sur la période${sla != null ? `, SLA tenu à ${sla} %` : ''}.`,
    ruptures ? `${ruptures} rupture(s) de SLA.` : 'Aucune rupture de SLA.',
    decisions.length ? '' : 'Les chiffres ne montrent pas d\'arbitrage évident.',
  ].filter(Boolean).join(' ');
  return { situation, decisions: decisions.slice(0, 3), a_surveiller: surv, incertitudes,
    message_hierarchie: '', _secours: true, _raison: String(raison || '').slice(0, 200) };
}

module.exports = { donneesDecision, statsOps, couverture, decisionSansIa };
