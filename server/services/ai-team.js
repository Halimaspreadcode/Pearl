const { readCfg, readWeeklyProgress, readObs, personSiteCodes, siteByCode, siteCodes } = require('../core/store');

// ══════════════════════════════════════════════════════════════
// DONNÉES D'ÉQUIPE POUR L'ASSISTANT IA
//
// Bilan d'équipe, récap des One-to-One et tableau de bord parlent de
// plusieurs agents à la fois : on ne peut pas tous les appeler
// « l'agent ». Chaque agent reçoit donc un alias stable le temps d'un
// appel (« Agent 01 », « Agent 02 »…). Le modèle ne voit que les alias ;
// le serveur remet les vrais noms dans la réponse avant de l'afficher.
// ══════════════════════════════════════════════════════════════

const H = 3600000, J = 24 * H;
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const echapRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Alias réversibles pour une liste de noms.
function pseudonymes(noms) {
  const liste = [...new Set((noms || []).filter(Boolean))];
  const alias = new Map(liste.map((n, i) => [n, `Agent ${String(i + 1).padStart(2, '0')}`]));
  // Remplacements : nom complet d'abord, puis chaque partie significative
  // (prénom ou nom seul, 3 lettres et plus), sans toucher aux mots communs.
  const regles = [];
  for (const [n, a] of alias) {
    regles.push([new RegExp(`\\b${echapRe(n)}\\b`, 'gi'), a]);
    for (const p of n.split(/\s+/).filter(x => x.length >= 3)) regles.push([new RegExp(`\\b${echapRe(p)}\\b`, 'gi'), a]);
  }
  regles.sort((x, y) => y[0].source.length - x[0].source.length);
  const versAlias = t => regles.reduce((s, [re, a]) => s.replace(re, a), String(t ?? ''));
  const inverse = new Map([...alias].map(([n, a]) => [Number(a.slice(6)), n]));
  // « Agent 01 », « Agent 1 », « agent-01 », « l'Agent 01 » → vrai nom.
  const versNom = t => String(t ?? '').replace(/\bAgent[\s\-]?0?(\d{1,2})\b/gi, (m, d) => inverse.get(Number(d)) || m);
  return { alias: n => alias.get(n) || n, versAlias, versNom };
}

// Remet les vrais noms dans une réponse, texte ou objet JSON.
function reidentifier(v, versNom) {
  if (typeof v === 'string') return versNom(v);
  if (Array.isArray(v)) return v.map(x => reidentifier(x, versNom));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, reidentifier(x, versNom)]));
  return v;
}

// ── Notes de performance ──
function scoreDe(carte) {
  try { return require('./perf').perfScoreOf(carte); } catch { return null; }
}

// Agents rattachés à un site (fo_trackers, premier site par défaut),
// comme le sélecteur de site du reste de l'appli.
function agentsDuPays(cfg, country = 'ALL') {
  const liste = cfg.fo_list || [];
  if (!country || country === 'ALL') return liste.slice();
  return liste.filter(n => personSiteCodes(n, cfg).includes(country));
}

// ── Bilan d'équipe ────────────────────────────────────────────
// Par agent : notes des deux derniers mois, objectifs de la session,
// One-to-One, tâches, tickets du mois. Plus les totaux de l'équipe.
function bilanEquipe(foFiltre, country = 'ALL') {
  const OBJ = require('./objectives');
  const { readObjectives, openSession } = require('./objectives-store');
  const cfg = readCfg();
  const foList = (foFiltre ? (cfg.fo_list || []) : agentsDuPays(cfg, country)).filter(f => !foFiltre || f === foFiltre);
  const ps = pseudonymes(cfg.fo_list || []);
  const auj = today();
  const sess = openSession();
  const objs = readObjectives();
  const mois = Object.keys(cfg.fo_scorecards || {}).sort().reverse().slice(0, 2);
  const taches = readWeeklyProgress().filter(t => t && t.admin_task);
  let tickets = [];
  try { tickets = require('../core/enrich').allEnriched(cfg, foFiltre ? 'ALL' : country); } catch {}
  const debutMois = auj.slice(0, 7);

  const agents = foList.map(fo => {
    const os = (objs[fo] || []).filter(o => !sess || o.session === sess.id);
    const actifs = os.filter(o => o.state === 'approved' && !['done', 'dropped'].includes(o.progress));
    const late = actifs.map(o => OBJ.objLateInfo(o, auj));
    const o2o = (cfg.fo_o2o || {})[fo] || {};
    const meetings = (o2o.meetings || []).map(m => m.date).filter(Boolean).sort();
    const dernier = meetings[meetings.length - 1] || null;
    const actionsO2o = (o2o.meetings || []).flatMap(m => m.actions || []);
    const mesTaches = taches.filter(t => t.modified_by === fo);
    const ouvertes = mesTaches.filter(t => t.status !== 'Done');
    const mesTickets = tickets.filter(t => (t.assigned_to || t.fo_owner) === fo
      && (String(t.open_date || '').slice(0, 7) === debutMois || String(t.close_date || '').slice(0, 7) === debutMois));
    const evalue = mesTickets.filter(t => !['N/A', 'On Hold'].includes(t.sla_status));
    return {
      agent: ps.alias(fo),
      notes: mois.map(m => {
        const c = (cfg.fo_scorecards[m] || {})[fo];
        return c ? { mois: m, score: scoreDe(c), detail: Object.fromEntries(Object.entries(c).filter(([, v]) => typeof v === 'number')) } : { mois: m, score: null };
      }),
      objectifs: {
        total: os.length, en_attente: os.filter(o => o.state === 'submitted' || o.pending).length,
        actifs: actifs.length, atteints: os.filter(o => o.progress === 'done').length,
        en_retard: late.filter(l => l.overdue).length, jalons_en_retard: late.reduce((n, l) => n + (l.late_steps || 0), 0),
        intitules: actifs.slice(0, 4).map(o => ps.versAlias(o.title)),
      },
      one_to_one: {
        dernier, jours_depuis: dernier ? Math.round((Date.parse(auj) - Date.parse(dernier)) / J) : null,
        nb_90j: meetings.filter(d => d >= addDays(auj, -90)).length,
        actions_ouvertes: actionsO2o.filter(a => a.status !== 'done').length,
        actions_en_retard: actionsO2o.filter(a => a.status !== 'done' && a.due && a.due < auj).length,
      },
      taches: { ouvertes: ouvertes.length, en_retard: ouvertes.filter(t => t.due_date && t.due_date < auj).length, faites: mesTaches.length - ouvertes.length },
      tickets_mois: { traites: mesTickets.length, evalues_sla: evalue.length, ruptures_sla: evalue.filter(t => t.sla_status === 'Breach').length },
    };
  });

  const equipe = {
    agents: foList.length,
    score_moyen: (() => { const s = agents.map(a => a.notes[0]?.score).filter(x => x != null); return s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length) : null; })(),
    objectifs_en_retard: agents.reduce((n, a) => n + a.objectifs.en_retard, 0),
    one_to_one_a_planifier: agents.filter(a => a.one_to_one.jours_depuis == null || a.one_to_one.jours_depuis > 45).length,
    taches_en_retard: agents.reduce((n, a) => n + a.taches.en_retard, 0),
  };
  // Le tableau affiché : mêmes chiffres, vrais noms (jamais envoyés au modèle).
  const faits = {
    date: auj, session: sess ? sess.name : null, equipe,
    lignes: agents.map((a, i) => ({
      agent: foList[i],
      score: a.notes[0]?.score ?? null, mois: a.notes[0]?.mois || null, precedent: a.notes[1]?.score ?? null,
      obj_actifs: a.objectifs.actifs, obj_retard: a.objectifs.en_retard, obj_attente: a.objectifs.en_attente, obj_atteints: a.objectifs.atteints,
      o2o_jours: a.one_to_one.jours_depuis, o2o_actions_retard: a.one_to_one.actions_en_retard,
      taches_ouvertes: a.taches.ouvertes, taches_retard: a.taches.en_retard,
      tickets: a.tickets_mois.traites, ruptures: a.tickets_mois.ruptures_sla,
    })),
  };
  return { donnees: { date: auj, session: sess ? { nom: sess.name, fin: sess.end } : null, equipe, agents }, ps, faits };
}

// ── Récap des One-to-One ──────────────────────────────────────
function recapO2o(foFiltre, jours, country = 'ALL') {
  const cfg = readCfg();
  const ps = pseudonymes(cfg.fo_list || []);
  const depuis = addDays(today(), -(Number(jours) || 90));
  const all = cfg.fo_o2o || {};
  const foList = (foFiltre ? (cfg.fo_list || []) : agentsDuPays(cfg, country)).filter(f => !foFiltre || f === foFiltre);
  const parAgent = foFiltre ? 6 : 3;           // entretiens gardés par agent
  const parSection = foFiltre ? 900 : 400;     // caractères par rubrique
  const faitsAgents = [];
  const agents = foList.map(fo => {
    const e = all[fo] || {};
    const tous = (e.meetings || []).filter(m => (m.date || '') >= depuis);
    const acts = tous.flatMap(m => (m.actions || []).filter(x => x && typeof x === 'object'));
    faitsAgents.push({
      agent: fo, entretiens: tous.length,
      dernier: tous.map(m => m.date).sort().pop() || null,
      humeurs: tous.map(m => m.mood).filter(Boolean),
      actions_ouvertes: acts.filter(x => x.status !== 'done').length,
      actions_retard: acts.filter(x => x.status !== 'done' && x.due && x.due < today()).length,
    });
    const ms = (e.meetings || []).filter(m => (m.date || '') >= depuis)
      .sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, parAgent);
    return {
      agent: ps.alias(fo),
      entretiens: ms.map(m => ({
        date: m.date, sujet: ps.versAlias(m.topic || ''), humeur: m.mood || null,
        contenu: (m.sections || []).map(s => `${s.label} : ${ps.versAlias(String(s.text || '').slice(0, parSection))}`)
          .concat(m.notes ? [ps.versAlias(String(m.notes).slice(0, parSection))] : []),
        actions: (m.actions || []).map(a => `${ps.versAlias(typeof a === 'string' ? a : a.text)}${a.status ? ` [${a.status === 'done' ? 'fait' : 'à faire'}${a.due ? `, ${a.due}` : ''}]` : ''}`),
      })),
      objectifs_o2o: (e.objectives || []).slice(0, 6).map(o => `${ps.versAlias(o.title)} (${o.status || '?'}${o.due ? `, ${o.due}` : ''})`),
    };
  }).filter(a => a.entretiens.length || foFiltre);
  return { donnees: { periode: `depuis le ${depuis}`, agents }, ps, faits: { depuis, agents: faitsAgents } };
}

// ── Signaux opérationnels (tableau de bord) ──────────────────
function signauxOps(country = 'ALL') {
  const cfg = readCfg();
  const out = [];
  const push = (lvl, kind, txt, cible, detail) => out.push({ lvl, kind, txt, cible, detail: detail || '' });
  let tickets = [];
  try { tickets = require('../core/enrich').allEnriched(cfg, country); } catch {}
  const ouverts = tickets.filter(t => ['Open', 'In Progress', 'On Hold'].includes(t.status));
  const breach = ouverts.filter(t => t.sla_status === 'Breach');
  const near = ouverts.filter(t => t.sla_status === 'Near Breach');
  const p12 = ouverts.filter(t => ['P1', 'P2'].includes(String(t.priority).toUpperCase()));
  const ref = t => `${t.sn_tt || t.id} (${t.priority || '?'}, ${t.tracker || ''})`;
  if (breach.length) push('urgent', 'sla-breach', `${breach.length} ticket(s) ouvert(s) en rupture de SLA`, 'site', breach.slice(0, 6).map(ref).join(', '));
  if (near.length) push('urgent', 'sla-near', `${near.length} ticket(s) proche(s) de la rupture de SLA`, 'site', near.slice(0, 6).map(ref).join(', '));
  if (p12.length) push('todo', 'p12-open', `${p12.length} ticket(s) P1/P2 ouvert(s)`, 'site', p12.slice(0, 6).map(ref).join(', '));
  const vieux = ouverts.filter(t => t.open_date && Date.now() - Date.parse(t.open_date) > 30 * J);
  if (vieux.length) push('todo', 'old-open', `${vieux.length} ticket(s) ouvert(s) depuis plus de 30 jours`, 'site', vieux.slice(0, 6).map(ref).join(', '));
  const sansDate = tickets.filter(t => ['Resolved', 'Closed'].includes(t.status) && !t.close_date);
  if (sansDate.length) push('info', 'no-close-date', `${sansDate.length} ticket(s) fermé(s) sans Close Date (faussent le backlog)`, 'data-quality');
  let resumePannes = 0;
  try {
    const obs = readObs().filter(o => o.status === 'Open');
    const { isOutage } = require('./weekly-combined');
    // Observations du site choisi seulement (celles sans site restent partout).
    const site = country === 'ALL' ? null : siteByCode(country, cfg);
    const noms = site ? [site.code, site.name, site.city].filter(Boolean).map(x => x.toLowerCase()) : [];
    const duSite = o => country === 'ALL' || !o.site || noms.some(n => String(o.site).toLowerCase().includes(n));
    const pannes = obs.filter(o => isOutage(o) && duSite(o));
    resumePannes = pannes.length;
    if (pannes.length) push('urgent', 'outage', `${pannes.length} panne(s) de plateforme en cours dans les observations`, 'observations', pannes.slice(0, 4).map(o => o.observation || o.text).join(' · ').slice(0, 300));
    else if (obs.filter(duSite).length) push('info', 'obs-open', `${obs.filter(duSite).length} observation(s) ouverte(s)`, 'observations');
  } catch {}
  try {
    const { buildWeeklyReport } = require('./reports');
    for (const site of (country === 'ALL' ? siteCodes(cfg) : [country])) {
      const w = buildWeeklyReport(undefined, site);
      const a = w.kpis.overall_open, b = w.prev_kpis.overall_open;
      if (b != null && a > b && a - b >= 5) push('todo', 'backlog-up', `Backlog ${site} en hausse : ${b} → ${a} cette semaine`, 'rapports');
    }
  } catch {}
  const resume = { ouverts: ouverts.length, breach: breach.length, near: near.length, p12: p12.length, pannes: resumePannes, country };
  return { items: out, resume };
}

module.exports = { pseudonymes, reidentifier, bilanEquipe, recapO2o, signauxOps, agentsDuPays };
