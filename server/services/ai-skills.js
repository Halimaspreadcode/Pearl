const { readCfg } = require('../core/store');
const { chat } = require('./ai');

// ══════════════════════════════════════════════════════════════
// SKILLS DE L'ASSISTANT IA
//
// Un skill = une tâche précise, avec ses consignes, ses champs et, au
// besoin, les données d'EMOC qu'il lit lui-même côté serveur. La page
// n'envoie que ce que l'admin a saisi ; le serveur ajoute le reste.
//
// Données envoyées au modèle : le strict nécessaire. Les noms d'agents
// sont remplacés par « l'agent » (objectifs, One-to-One) ; les tickets
// ne partent jamais en détail. Chaque skill dit dans `donnees` ce qu'il envoie, et
// la page l'affiche avant l'appel.
// ══════════════════════════════════════════════════════════════

const clamp = (v, n) => String(v == null ? '' : v).slice(0, n).trim();
const H = 3600000;

// Remplace un nom d'agent (et ses variantes de casse) par « l'agent ».
function anonymiser(texte, noms) {
  let t = String(texte || '');
  for (const n of noms.filter(Boolean)) {
    const re = new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    t = t.replace(re, "l'agent");
  }
  return t;
}

// Extrait le premier objet JSON d'une réponse (le modèle l'entoure parfois
// de texte ou de ```json).
function lireJson(txt) {
  const s = String(txt || '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0) return null;
  if (b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch { /* coupé ou abîmé : on répare */ } }
  return reparerJson(s.slice(a));
}

// Réponse coupée en plein milieu (limite de jetons) : on garde tout ce qui
// est complet et on referme. Les éléments inachevés sont perdus, le reste
// s'affiche normalement au lieu d'un bloc de JSON brut. `_tronque` le dit.
function reparerJson(s) {
  const pile = [];
  const coupes = [];          // [position, fermetures à ajouter]
  let chaine = false, echap = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (chaine) {
      if (echap) echap = false;
      else if (c === '\\') echap = true;
      else if (c === '"') chaine = false;
      continue;
    }
    if (c === '"') { chaine = true; continue; }
    if (c === '{' || c === '[') pile.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') { pile.pop(); coupes.push([i + 1, pile.slice().reverse().join('')]); }
    else if (c === ',') coupes.push([i, pile.slice().reverse().join('')]);
  }
  for (let k = coupes.length - 1, essais = 0; k >= 0 && essais < 400; k--, essais++) {
    const [pos, fin] = coupes[k];
    try {
      const v = JSON.parse(s.slice(0, pos) + fin);
      if (v && typeof v === 'object' && !Array.isArray(v)) { v._tronque = true; return v; }
    } catch { /* position suivante */ }
  }
  return null;
}

// ── Données d'EMOC ────────────────────────────────────────────

function scoreLigne(l) {
  const n = (l && l.notes && l.notes[0]) || {};
  const p = (l && l.notes && l.notes[1]) || {};
  return { score: n.score ?? null, precedent: p.score ?? null };
}

function objectifPourIa(fo, id) {
  const OBJ = require('./objectives');
  const { readObjectives, sessionById, openSession } = require('./objectives-store');
  const o = (readObjectives()[fo] || []).find(x => x.id === id);
  if (!o) { const e = new Error('Objectif introuvable.'); e.status = 404; throw e; }
  const noms = [fo, ...String(fo).split(/\s+/).filter(x => x.length > 2)];
  const session = (o.session && sessionById(o.session)) || openSession();
  const val = k => (o.pending && o.pending[k] !== undefined ? o.pending[k] : o[k]);
  const smart = OBJ.smartReport({ title: val('title'), why: val('why'), due: val('due'), kpis: o.kpis, steps: o.steps }, session);
  return {
    objectif: {
      intitule: anonymiser(val('title'), noms),
      pourquoi: anonymiser(val('why'), noms),
      echeance: val('due') || '',
      kpis: (o.kpis || []).map(k => ({ nom: anonymiser(k.name, noms), cible: k.target, unite: k.unit, source: k.source })),
      jalons: (o.steps || []).map(s => ({ libelle: anonymiser(s.label, noms), echeance: s.due || '' })),
      modification_demandee: o.pending ? Object.keys(o.pending) : [],
    },
    session: session ? { nom: session.name, debut: session.start, fin: session.end } : null,
    controle_automatique: { score: smart.score, conforme: smart.pass, remarques: smart.issues || [] },
  };
}

function weeklyPourIa(date) {
  const { buildCombinedAnalysis } = require('./weekly-combined');
  const a = buildCombinedAnalysis(date || undefined);
  const min = ms => (ms == null ? null : Math.round(ms / 60000));
  const h = ms => (ms == null ? null : Math.round(ms / H * 10) / 10);
  return {
    semaine: `${a.week_start} → ${a.week_end}`,
    sites: a.sites.map(s => ({
      site: s.ville,
      ouverts: s.kpis.opened_this_week, clos: s.kpis.resolved_this_week,
      encours_fin: s.kpis.overall_open, encours_semaine_precedente: s.prev.overall_open,
      ouverts_semaine_precedente: s.prev.total ?? s.prev.opened_this_week ?? null,
      sla_pct: s.kpis.sla_compliance, ruptures_sla: s.kpis.breach,
      mttd_min: min(s.kpis.mttd_ms), mttr_h: h(s.kpis.mttr_ms),
      par_jour: s.labels.map((l, i) => `${l}: ${s.opened[i]} ouverts / ${s.closed[i]} clos`),
      moyenne_jour: s.avg_day, moyenne_semaine: s.avg_week,
    })),
    presence_dakar: a.attendance ? {
      jours_absence: a.attendance.absence_days, taux_absence_pct: a.attendance.absence_rate,
      non_planifiees: a.attendance.unplanned_days,
    } : null,
    a_expliquer: a.to_explain.map(x => x.title),
    observations: a.observations.map(o => `${o.date || ''} ${o.site}: ${o.text}`.trim()).slice(0, 30),
  };
}

function o2oPourIa(fo) {
  const OBJ = require('./objectives');
  const { readObjectives, openSession } = require('./objectives-store');
  const cfg = readCfg();
  if (!(cfg.fo_list || []).includes(fo)) { const e = new Error('Agent inconnu.'); e.status = 404; throw e; }
  const noms = [fo, ...String(fo).split(/\s+/).filter(x => x.length > 2)];
  const sess = openSession();
  const objs = (readObjectives()[fo] || []).filter(o => !sess || o.session === sess.id);
  const mois = Object.keys(cfg.fo_scorecards || {}).sort().reverse();
  const derniere = mois.map(m => ({ m, v: (cfg.fo_scorecards[m] || {})[fo] })).find(x => x.v);
  const notes = derniere ? Object.fromEntries(Object.entries(derniere.v)
    .filter(([k, v]) => typeof v === 'number' || /^\d+$/.test(String(v))).map(([k, v]) => [k, Number(v)])) : null;
  return {
    session: sess ? { nom: sess.name, debut: sess.start, fin: sess.end } : null,
    objectifs: objs.map(o => {
      const steps = o.steps || [];
      return {
        intitule: anonymiser(o.title, noms), etat: o.state, avancement: o.progress,
        avancement_pct: OBJ.objProgressPct ? OBJ.objProgressPct(o) : null,
        echeance: o.due || '', jalons_faits: steps.filter(s => s.done).length, jalons_total: steps.length,
        jalons_en_retard: steps.filter(s => !s.done && s.due && s.due < new Date().toISOString().slice(0, 10)).length,
        kpis: (o.kpis || []).map(k => `${anonymiser(k.name, noms)} → ${k.target || '?'}${k.unit ? ' ' + k.unit : ''}`),
      };
    }),
    derniere_evaluation: derniere ? { mois: derniere.m, notes_sur_100: notes } : null,
  };
}

// ── Catalogue ─────────────────────────────────────────────────

const SORTIE_MD = 'Réponds en Markdown simple : titres courts en **gras**, listes à puces, pas de tableau. Pas d\'introduction ni de formule de politesse.';

// Le pays limite les données envoyées au modèle : sans lui, une
// question sur Dakar ramène aussi le bruit d'Abidjan. La page le
// pré-remplit avec le pays actif de l'appli.
const PAYS_OPTIONS = ['Global', 'Dakar (SN)', 'Abidjan (CI)'];
const CHAMP_PAYS = { id: 'pays', label: 'Pays', type: 'select', options: PAYS_OPTIONS, pays: true };
const codePays = v => /SN/.test(v || '') ? 'SN' : /CI/.test(v || '') ? 'CI' : 'ALL';

const SKILLS = [
  {
    id: 'objectif-check', titre: 'Avis sur un objectif', icone: 'target', categorie: 'Équipe',
    desc: 'Relit un objectif comme un manager : clarté, mesure, réalisme, jalons. Propose une reformulation et un message pour l\'agent.',
    donnees: 'L\'objectif choisi (intitulé, raison, KPI, jalons, échéances) et les dates de la session. Le nom de l\'agent est remplacé par « l\'agent ».',
    champs: [], // lancé depuis la validation des objectifs
    interne: true,
    max_tokens: 3000, temperature: 0.2,
    system: [
      'Tu es manager d\'une équipe Front Office de supervision ITSM. Tu relis un objectif individuel proposé par un agent pour le trimestre.',
      'Juge-le selon SMART (spécifique, mesurable, atteignable, pertinent pour une équipe de supervision, temporellement borné) et la qualité des KPI et des jalons.',
      'Le « controle_automatique » est un pré-contrôle par règles : tiens-en compte sans le recopier.',
      'Réponds UNIQUEMENT par un objet JSON valide, sans texte autour, de la forme :',
      '{"verdict":"approuver"|"a_revoir","resume":"une phrase","forces":["…"],"risques":["…"],',
      '"reformulation":"intitulé amélioré ou chaîne vide","kpis_suggeres":["…"],"jalons_suggeres":["…"],',
      '"impact":{"niveau":"fort"|"moyen"|"faible","kpis":["SLA","MTTD","MTTR","qualité","charge","compétences"…],"explication":"en une phrase, ce que l\'objectif change pour l\'équipe et ses KPI"},',
      '"message_agent":"message bienveillant et précis à l\'agent si à revoir, sinon chaîne vide"}',
      'Au plus 3 éléments par liste. En français.',
    ].join('\n'),
    construire: ({ fo, id }) => ({ user: JSON.stringify(objectifPourIa(fo, id)), json: true }),
  },
  {
    id: 'weekly', titre: 'Commentaire du weekly', icone: 'chart', categorie: 'Rapports',
    desc: 'Analyse la semaine Dakar et Abidjan : faits marquants, explication des pics et écarts, actions. Prêt à coller dans le deck.',
    donnees: 'Chiffres agrégés de la semaine par site (volumes, SLA, MTTD/MTTR, encours, présence Dakar) et les observations. Aucun nom d\'agent, aucun ticket détaillé.',
    champs: [
      { id: 'date', label: 'Semaine (un jour de la semaine)', type: 'date' },
      { id: 'contexte', label: 'Contexte à prendre en compte (facultatif)', type: 'textarea', max: 2000,
        placeholder: 'Ex. migration de la plateforme X mardi, 2 agents en formation…' },
      { id: 'langue', label: 'Langue', type: 'select', options: ['Français', 'English'] },
    ],
    max_tokens: 3000, temperature: 0.3,
    system: [
      'Tu prépares le commentaire du weekly performance Dakar × Abidjan d\'une équipe de supervision ITSM.',
      'Appuie-toi uniquement sur les chiffres fournis ; n\'invente aucun chiffre ni cause. Si une explication manque, dis-le et propose la question à poser.',
      'Structure : **Synthèse** (3 phrases max), **Dakar**, **Abidjan**, **Points à expliquer** (une ligne par élément de "a_expliquer", avec une explication plausible tirée des observations ou "à confirmer"), **Actions proposées**.',
      'Phrases courtes, sans tiret long.',
    ].join('\n'),
    construire: (inp) => ({
      user: `Langue de la réponse : ${inp.langue || 'Français'}.\n`
        + (inp.contexte ? `Contexte donné par le manager : ${inp.contexte}\n` : '')
        + `Données de la semaine :\n${JSON.stringify(weeklyPourIa(inp.date))}`,
    }),
  },
  {
    id: 'rca', titre: 'Analyse de cause (RCA)', icone: 'search', categorie: 'Opérations',
    desc: 'Aide à l\'analyse d\'un problème : 5 pourquoi, causes probables, données à collecter, actions correctives et préventives.',
    donnees: 'Uniquement ce que tu saisis.',
    champs: [
      { id: 'probleme', label: 'Le problème', type: 'textarea', max: 3000, required: true,
        placeholder: 'Symptômes, service, récurrence, impact…' },
      { id: 'chronologie', label: 'Chronologie / éléments connus', type: 'textarea', max: 3000,
        placeholder: '10:02 alarme X, 10:15 redémarrage…' },
    ],
    max_tokens: 3000, temperature: 0.3,
    system: 'Tu es expert Problem Management ITIL pour une équipe de supervision. Structure : **Résumé**, **5 pourquoi** (hypothèses à valider, marquées comme telles), **Causes probables** (classées), **Données à collecter** pour confirmer, **Contournement**, **Actions correctives**, **Actions préventives**. Ne présente jamais une hypothèse comme un fait.',
    construire: (inp) => ({ user: `Problème : ${inp.probleme}\nÉléments connus : ${inp.chronologie || 'aucun'}` }),
  },
  {
    id: 'o2o', titre: 'Préparer un One-to-One', icone: 'user', categorie: 'Équipe', vue: 'prep',
    desc: 'Une fiche de préparation pour l\'entretien d\'un agent : où il en est, quoi aborder, quelles questions poser.',
    donnees: 'Objectifs de la session, dernière note, dernier One-to-One et actions ouvertes de l\'agent. Son nom n\'est pas envoyé.',
    champs: [
      { id: 'fo', label: 'Agent', type: 'agent', required: true },
      { id: 'focus', label: 'Un sujet précis à aborder ? (facultatif)', type: 'textarea', max: 1500,
        placeholder: 'Ex. retards répétés, envie d\'évoluer vers le L2…' },
    ],
    max_tokens: 3000, temperature: 0.4,
    system: [
      'Tu aides un manager à préparer un One-to-One avec un agent de supervision ITSM. Parle de « l\'agent ».',
      'Appuie-toi uniquement sur les données fournies. Une donnée absente est un manque de suivi à mentionner, pas un défaut de l\'agent.',
      'Réponds UNIQUEMENT par un objet JSON valide :',
      '{"accroche":"une phrase d\'ouverture chaleureuse et concrète","points_forts":["…"],"points_attention":["…"],',
      '"questions":["5 questions ouvertes et bienveillantes"],"objectif_propose":{"titre":"objectif SMART","kpi":"mesure","echeance":"AAAA-MM-JJ"},',
      '"a_eviter":"un piège à éviter pendant l\'entretien"}',
      'Au plus 3 points forts et 3 points d\'attention, phrases courtes. En français.',
    ].join('\n'),
    construire: (inp) => {
      const { bilanEquipe } = require('./ai-team');
      const d = o2oPourIa(inp.fo);
      const ligne = bilanEquipe(inp.fo).donnees.agents[0] || {};
      const contexte = { ...d, one_to_one: ligne.one_to_one, taches: ligne.taches, tickets_mois: ligne.tickets_mois };
      return {
        user: (inp.focus ? `Sujet du manager : ${anonymiser(inp.focus, [inp.fo, ...inp.fo.split(/\s+/).filter(x => x.length > 2)])}\n` : '') + `Données :\n${JSON.stringify(contexte)}`,
        json: true,
        faits: {
          agent: inp.fo, session: d.session?.nom || null,
          objectifs: d.objectifs.map(o => ({ titre: o.intitule, avancement: o.avancement_pct, jalons: `${o.jalons_faits}/${o.jalons_total}`, retard: o.jalons_en_retard, echeance: o.echeance })),
          note: d.derniere_evaluation ? { mois: d.derniere_evaluation.mois, ...scoreLigne(ligne) } : null,
          one_to_one: ligne.one_to_one || null, taches: ligne.taches || null,
        },
      };
    },
  },
  {
    id: 'o2o-recap', titre: 'Récap des One-to-One', icone: 'list', categorie: 'Équipe', vue: 'recap',
    desc: 'Ce qui ressort des entretiens d\'un agent ou de toute l\'équipe : thèmes, engagements tenus ou non, humeur, ce qu\'il faut reprendre.',
    donnees: 'Comptes rendus des One-to-One de la période, sous alias (« Agent 01 »…). Les vrais noms sont remis à l\'affichage.',
    champs: [
      CHAMP_PAYS,
      { id: 'fo', label: 'Pour qui ?', type: 'agent', tous: true },
      { id: 'periode', label: 'Période', type: 'select', options: ['90 jours', '30 jours', '180 jours'] },
    ],
    max_tokens: 3000, temperature: 0.3, max_chars: 24000,
    system: [
      'Tu résumes des comptes rendus de One-to-One pour un manager d\'équipe de supervision. Les agents sont des alias (« Agent 01 »…) : réutilise-les exactement.',
      'Uniquement ce qui est écrit dans les comptes rendus, phrases courtes.',
      'Réponds UNIQUEMENT par un objet JSON valide :',
      '{"themes_communs":["…"],"actions_manager":["…"],',
      '"agents":[{"agent":"Agent 01","resume":"une phrase","themes":["…"],"engagements":[{"texte":"…","statut":"tenu"|"en_cours"|"en_retard"}],"humeur":"une phrase ou chaîne vide","a_reprendre":["…"]}]}',
      'Seulement les agents qui ont des entretiens. Au plus 3 éléments par liste.',
    ].join('\n'),
    construire: (inp) => {
      const { recapO2o } = require('./ai-team');
      const jours = parseInt(inp.periode, 10) || 90;
      const { donnees, ps, faits } = recapO2o(inp.fo || '', jours, codePays(inp.pays));
      faits.perimetre = inp.fo ? '' : (inp.pays || 'Global');
      const total = faits.agents.reduce((n, a) => n + a.entretiens, 0);
      // Rien à résumer : on le dit sans appeler le modèle, qui inventerait.
      if (!total) return { court: { faits, message: inp.fo
        ? `Aucun One-to-One enregistré pour ${inp.fo} sur les ${jours} derniers jours.`
        : `Aucun One-to-One enregistré ${codePays(inp.pays) === 'ALL' ? 'dans l\'équipe' : `pour ${inp.pays}`} sur les ${jours} derniers jours.` } };
      return { user: `Données :\n${JSON.stringify(donnees)}`, json: true, versNom: ps.versNom, faits };
    },
  },
  {
    id: 'bilan-equipe', titre: 'Bilan de l\'équipe', icone: 'team', categorie: 'Équipe', vue: 'bilan',
    desc: 'Le tableau de l\'équipe agent par agent, puis la lecture de Big Brother : forces, vigilances, qui valoriser, qui accompagner, quoi faire.',
    donnees: 'Indicateurs par agent (notes, objectifs de la session, One-to-One, tâches, tickets du mois) sous alias. Les vrais noms sont remis à l\'affichage.',
    champs: [
      CHAMP_PAYS,
      { id: 'angle', label: 'Pour quoi faire ?', type: 'select', options: ['Bilan complet', 'Revue mensuelle', 'Entretiens du trimestre', 'Risques seulement'] },
      { id: 'contexte', label: 'Contexte à prendre en compte (facultatif)', type: 'textarea', max: 1500,
        placeholder: 'Ex. sous-effectif en septembre, nouvelle plateforme…' },
    ],
    max_tokens: 3000, temperature: 0.3, max_chars: 24000,
    system: [
      'Tu lis le tableau d\'une équipe Front Office de supervision ITSM pour son manager. Les agents sont des alias (« Agent 01 »…) : réutilise-les exactement.',
      'Chaque constat s\'appuie sur un chiffre fourni. Une donnée absente (note null, aucun entretien) est un manque de suivi du manager, pas une faiblesse de l\'agent.',
      'Réponds UNIQUEMENT par un objet JSON valide :',
      '{"synthese":"2 à 3 phrases","forces":["…"],"vigilances":["…"],',
      '"agents":[{"agent":"Agent 01","statut":"valoriser"|"accompagner"|"suivre","constat":"factuel, avec le chiffre","action":"ce que le manager fait"}],',
      '"recommandations":[{"titre":"…","action":"…","priorite":"haute"|"moyenne"|"basse"}],"suivi_manquant":["donnée à compléter"]}',
      'Au plus 3 forces, 3 vigilances, 5 recommandations. Mets dans "agents" seulement ceux qui méritent une mention. Phrases courtes.',
    ].join('\n'),
    construire: (inp) => {
      const { bilanEquipe } = require('./ai-team');
      const { donnees, ps, faits } = bilanEquipe(undefined, codePays(inp.pays));
      faits.perimetre = inp.pays || 'Global';
      return {
        user: `Usage : ${inp.angle || 'Bilan complet'}. Périmètre : ${inp.pays || 'Global'}.\n` + (inp.contexte ? `Contexte : ${ps.versAlias(inp.contexte)}\n` : '')
          + `Données :\n${JSON.stringify(donnees)}`,
        json: true, versNom: ps.versNom, faits,
      };
    },
  },
  {
    id: 'recherche', titre: 'Rechercher dans FOps', icone: 'search', categorie: 'Outils', vue: 'recherche',
    desc: 'Pose une question sur les données (tickets, absences, planning, tâches, One-to-One, observations) : Big Brother la traduit en recherche, FOps renvoie les lignes trouvées.',
    donnees: 'Ta question (noms remplacés par des alias) et la liste des champs disponibles. Aucune donnée n\'est envoyée : la recherche tourne dans FOps.',
    champs: [
      { id: 'question', label: 'Ta question', type: 'textarea', max: 600, required: true,
        placeholder: 'Ex. Qui n\'a pas fermé son ticket vendredi ? Combien d\'absences par agent en septembre ? Les P1 encore ouverts ?' },
      CHAMP_PAYS,
    ],
    max_tokens: 1200, temperature: 0,
    system: '',
    construire: (inp) => {
      const { pseudonymes } = require('./ai-team');
      const { systeme } = require('./ai-recherche');
      const cfg = readCfg();
      const ps = pseudonymes(cfg.fo_list || []);
      const auj = new Date().toISOString().slice(0, 10);
      return {
        system: systeme((cfg.fo_list || []).map(ps.alias), auj),
        user: `Question : ${ps.versAlias(inp.question)}` + (codePays(inp.pays) !== 'ALL' ? `\nPérimètre déjà filtré : ${inp.pays}.` : ''),
        json: true, versNom: ps.versNom, faits: { question: inp.question, perimetre: inp.pays || 'Global', date: auj },
      };
    },
    // La requête lue (vrais noms remis) est exécutée par FOps.
    apres: (plan, inp, faits) => {
      if (!plan || plan.impossible) return plan || {};
      const { executer } = require('./ai-recherche');
      return { ...plan, resultat: executer(plan, { pays: codePays(inp.pays), auj: faits.date }) };
    },
  },
  {
    id: 'decision', titre: 'Rapport de décision', icone: 'decision', categorie: 'Pilotage', vue: 'decision',
    desc: 'Les décisions à prendre sur la période : constat chiffré, options, recommandation, risque si rien n\'est fait. Plus ce qu\'il faut surveiller et ce qui n\'est pas sûr.',
    donnees: 'Chiffres calculés par FOps sur la période et la précédente (flux, backlog, SLA, ruptures et leur origine, charge par agent, équipe, couverture du planning à 7 jours, qualité des données). Agents sous alias, vrais noms remis à l\'affichage. Aucun motif d\'absence, aucun ticket détaillé.',
    champs: [
      { id: 'periode', label: 'Période', type: 'select', options: ['Semaine', 'Mois'] },
      { id: 'perimetre', label: 'Pays', type: 'select', options: PAYS_OPTIONS, pays: true },
      { id: 'contexte', label: 'Contexte que FOps ne connaît pas (facultatif)', type: 'textarea', max: 2000,
        placeholder: 'Ex. demande client de réduire le MTTR, 2 recrutements prévus en novembre, migration X la semaine prochaine…' },
    ],
    max_tokens: 6000, temperature: 0.2, max_chars: 30000,
    system: [
      'Tu es l\'assistant de décision du manager d\'une équipe Front Office de supervision ITSM (Dakar et Abidjan).',
      'On te donne des chiffres calculés par l\'outil. Tu aides à DÉCIDER, pas seulement à constater.',
      'Règles :',
      '- Chaque constat cite au moins un chiffre fourni. N\'invente aucun chiffre, aucune cause, aucun nom. Une cause non prouvée est une hypothèse, dis-le.',
      '- Les agents sont des alias (« Agent 01 »…) : réutilise-les exactement.',
      '- Une donnée manquante ou douteuse va dans "incertitudes", jamais comblée par une supposition.',
      '- Au plus 3 décisions, les plus importantes d\'abord (clients et SLA, puis capacité de l\'équipe, puis accompagnement, puis process).',
      '- Chaque décision a 2 ou 3 options réalistes pour une équipe de supervision, avec leur avantage et leur limite.',
      '- Sois bref : chaque texte tient en une phrase de 20 mots au plus ; « pour » et « contre » en 8 mots au plus.',
      '- Si les chiffres ne justifient aucune décision, dis-le et renvoie des décisions vides plutôt que d\'en inventer.',
      'Réponds UNIQUEMENT par un objet JSON valide :',
      '{"situation":"3 phrases maximum : ce qui va, ce qui ne va pas, ce qui se dégrade",',
      '"decisions":[{"titre":"la décision, formulée comme une question","constat":"faits chiffrés","options":[{"option":"…","pour":"…","contre":"…"}],',
      '"recommandation":"l\'option conseillée et pourquoi","si_rien":"ce qui arrive si on ne décide pas","urgence":"haute"|"moyenne"|"basse","echeance":"aujourd\'hui"|"cette semaine"|"ce mois","indicateur_de_suivi":"le chiffre qui dira si ça a marché"}],',
      '"a_surveiller":["signal faible, avec son chiffre"],"incertitudes":["donnée manquante ou douteuse et son effet"],',
      '"message_hierarchie":"2 à 3 phrases à porter à la hiérarchie"}',
      'Au plus 3 a_surveiller, 3 incertitudes. Phrases courtes, en français, sans tiret long.',
    ].join('\n'),
    secours: (f, raison) => require('./ai-decision').decisionSansIa(f, raison),
    construire: (inp) => {
      const { donneesDecision } = require('./ai-decision');
      const perimetre = /SN/.test(inp.perimetre || '') ? 'SN' : /CI/.test(inp.perimetre || '') ? 'CI' : 'ALL';
      const { donnees, faits, ps } = donneesDecision({ periode: inp.periode === 'Mois' ? 'mois' : 'semaine', perimetre });
      return {
        user: (inp.contexte ? `Contexte donné par le manager : ${ps.versAlias(inp.contexte)}\n` : '')
          + `Données :\n${JSON.stringify(donnees)}`,
        json: true, versNom: ps.versNom, faits,
      };
    },
  },
  {
    id: 'cockpit-brief', titre: 'Brief du tableau de bord', icone: 'spark', categorie: 'Pilotage', interne: true,
    max_tokens: 3000, temperature: 0.2, max_chars: 24000,
    system: [
      'Tu es l\'assistant de pilotage d\'un manager d\'équipe de supervision ITSM. On te donne les signaux calculés par l\'outil (équipe et opérations).',
      'Les agents sont désignés par des alias (« Agent 01 »…) : réutilise exactement ces alias.',
      'Priorise ce que le manager doit faire AUJOURD\'HUI : d\'abord ce qui touche les clients et les SLA, puis ce qui bloque l\'équipe, puis le suivi RH.',
      'Réponds UNIQUEMENT par un objet JSON valide :',
      '{"synthese":"2 phrases","priorites":[{"titre":"…","agent":"alias ou chaîne vide","pourquoi":"…","action":"verbe à l\'infinitif, concret","urgence":"haute"|"moyenne"|"basse","delai":"aujourd\'hui"|"cette semaine"|"ce mois"}],',
      '"vigilance":["…"],"bonnes_nouvelles":["…"]}',
      'Au plus 6 priorités, 3 vigilances, 3 bonnes nouvelles. Ne cite que des faits présents dans les signaux.',
    ].join('\n'),
    construire: (inp) => ({ user: inp.user, json: true, versNom: inp.versNom }),
  },
  {
    id: 'impact', titre: 'Impact d\'un élément', icone: 'spark', categorie: 'Pilotage', interne: true,
    max_tokens: 3000, temperature: 0.2, max_chars: 16000,
    system: [
      'Tu évalues l\'impact d\'un signal remonté par l\'outil de pilotage d\'une équipe de supervision ITSM, avec le contexte fourni.',
      'Les agents sont désignés par des alias : réutilise-les. N\'invente aucun chiffre.',
      'Réponds UNIQUEMENT par un objet JSON valide :',
      '{"gravite":"forte"|"moyenne"|"faible","resume":"une phrase","impacts":[{"sur":"clients|SLA|MTTR|charge équipe|performance agent|motivation|conformité","effet":"…"}],',
      '"si_rien":"ce qui arrive si personne n\'agit","action":"action recommandée, concrète","delai":"aujourd\'hui"|"cette semaine"|"ce mois"}',
      'Au plus 4 impacts.',
    ].join('\n'),
    construire: (inp) => ({ user: inp.user, json: true, versNom: inp.versNom }),
  },
  {
    id: 'redaction', titre: 'Rédaction pro', icone: 'pen', categorie: 'Outils',
    desc: 'Corrige, reformule ou traduit un texte : mail, annonce, compte rendu, message à l\'équipe.',
    donnees: 'Uniquement ce que tu saisis.',
    champs: [
      { id: 'texte', label: 'Ton texte', type: 'textarea', max: 5000, required: true },
      { id: 'ton', label: 'Ton', type: 'select', options: ['Professionnel', 'Direct et court', 'Bienveillant', 'Formel'] },
      { id: 'langue', label: 'Langue de sortie', type: 'select', options: ['Français', 'English'] },
    ],
    max_tokens: 3000, temperature: 0.4,
    system: 'Tu réécris le texte fourni. Garde le sens et les faits, corrige la langue, rends-le clair et adapté au ton demandé. Rends uniquement le texte final, sans commentaire. Pas de tiret long.',
    construire: (inp) => ({ user: `Ton : ${inp.ton || 'Professionnel'}. Langue : ${inp.langue || 'Français'}.\nTexte :\n${inp.texte}` }),
  },
];

const parId = id => SKILLS.find(s => s.id === id);

// Ce que la page reçoit : la description, jamais les consignes.
function catalogue() {
  return SKILLS.filter(s => !s.interne).map(s => ({
    id: s.id, titre: s.titre, icone: s.icone, categorie: s.categorie, desc: s.desc, donnees: s.donnees,
    vue: s.vue || null,
    champs: s.champs.map(c => c.type === 'agent' ? { ...c, options: (readCfg().fo_list || []).slice() } : c),
  }));
}

// Contrôle des saisies : seuls les champs déclarés passent, bornés.
function entrees(skill, brut) {
  const b = brut || {};
  const out = {};
  for (const c of skill.champs) {
    let v = b[c.id];
    if (c.type === 'checkbox') { out[c.id] = !!v; continue; }
    v = clamp(v, c.max || 200);
    if ((c.type === 'select') && v && !c.options.includes(v)) v = c.options[0];
    if (c.type === 'agent' && v && !(readCfg().fo_list || []).includes(v)) v = '';
    if (c.type === 'date' && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) v = '';
    if (c.required && !v) { const e = new Error(`Champ requis : ${c.label}.`); e.status = 400; throw e; }
    out[c.id] = v;
  }
  return out;
}

// ── Ce que Big Brother lit, en phrases ────────────────────────
// Pendant l'appel au modèle, la page affiche une phrase à la fois. Elles
// décrivent les données réellement envoyées (chiffres compris), pas une
// progression inventée.
const nb = (n, un, plusieurs) => `${n} ${n > 1 ? (plusieurs || un + 's') : un}`;
function apercu(faits) {
  const f = faits || {};
  const out = [];
  if (Array.isArray(f.lignes)) out.push(nb(f.lignes.length, 'agent'));
  else if (Array.isArray(f.agents)) out.push(nb(f.agents.length, 'agent'));
  const k = f.indicateurs;
  if (k) out.push(`${nb(k.tickets_ouverts?.valeur ?? 0, 'ticket ouvert', 'tickets ouverts')} sur la période`);
  if (f.perimetre) out.push(f.perimetre);
  return out.join(' · ');
}
const LECTURE = {
  decision: (f) => {
    const k = f.indicateurs || {};
    return [
      `Big Brother compare les ${String(f.periode || 'derniers jours').split(' (')[0]} à la période précédente…`,
      k.ruptures_sla?.valeur ? `Il cherche d'où viennent les ${nb(k.ruptures_sla.valeur, 'rupture')} de SLA…` : 'Il vérifie la tenue du SLA…',
      (f.charge || []).length ? `Il regarde comment la charge se répartit entre ${nb(f.charge.length, 'agent')}…` : '',
      `Il vérifie la couverture du planning des 7 prochains jours${(f.creneaux_fragiles || []).length ? ` (${nb(f.creneaux_fragiles.length, 'créneau fragile', 'créneaux fragiles')})` : ''}…`,
      'Il pèse les options de chaque décision…',
      'Il rédige le message pour la hiérarchie…',
    ];
  },
  'bilan-equipe': (f) => {
    const l = f.lignes || [];
    const retard = l.reduce((n, x) => n + (x.obj_retard || 0), 0);
    return [
      `Big Brother lit les notes de ${nb(l.length, 'agent')}…`,
      retard ? `Il repère les ${nb(retard, 'objectif')} en retard…` : 'Il passe en revue les objectifs de la session…',
      'Il regarde depuis quand chacun n\'a pas eu de One-to-One…',
      'Il classe qui valoriser, qui accompagner, qui suivre…',
      'Il prépare ses recommandations…',
    ];
  },
  'o2o-recap': (f) => {
    const a = (f.agents || []).filter(x => x.entretiens);
    const total = a.reduce((n, x) => n + x.entretiens, 0);
    const ouvertes = a.reduce((n, x) => n + (x.actions_ouvertes || 0), 0);
    return [
      `Big Brother lit ${nb(total, 'compte rendu', 'comptes rendus')} de One-to-One${a.length > 1 ? ` (${nb(a.length, 'agent')})` : ''}…`,
      ouvertes ? `Il fait le point sur les ${nb(ouvertes, 'engagement')} encore ouverts…` : 'Il fait le point sur les engagements pris…',
      'Il cherche les thèmes qui reviennent…',
      'Il note l\'humeur qui ressort des échanges…',
    ];
  },
  o2o: (f) => [
    `Big Brother relit les objectifs de ${f.agent || 'l\'agent'}…`,
    'Il regarde le dernier One-to-One et les actions ouvertes…',
    'Il prépare les questions à poser…',
    'Il propose un objectif SMART…',
  ],
  weekly: () => ['Big Brother compare Dakar et Abidjan…', 'Il cherche une explication aux écarts de la semaine…', 'Il prépare les actions proposées…'],
  rca: () => ['Big Brother remonte la chaîne des « pourquoi »…', 'Il classe les causes probables…', 'Il liste les données à collecter…'],
  redaction: () => ['Big Brother relit ton texte…', 'Il ajuste le ton…'],
  recherche: () => ['Big Brother traduit ta question en recherche…', 'Il choisit la source et les filtres…', 'Il résout les dates de ta question…'],
};

// Une réponse structurée utilisable : un objet avec au moins un champ réel.
const utilisable = d => !!d && typeof d === 'object' && Object.keys(d).some(k => k !== '_tronque');
const CONCIS = 'IMPORTANT : ta réponse précédente était trop longue ou illisible. Sois deux fois plus concis : phrases de 15 mots au plus, listes réduites au minimum. Réponds uniquement par le JSON demandé et termine-le toujours.';

async function lancer(id, brut, progres = () => {}, { fond = false } = {}) {
  const skill = parId(id);
  if (!skill) { const e = new Error('Skill inconnu.'); e.status = 404; throw e; }
  const inp = skill.interne ? (brut || {}) : entrees(skill, brut);
  progres('Lecture des données de FOps…');
  const { user, json, versNom, faits, court, system: sys } = skill.construire(inp);
  if (court) return { skill: skill.id, vue: skill.vue, faits: court.faits, vide: true, content: court.message, ms: 0, model: '' };
  const vu = apercu(faits);
  const lecture = (LECTURE[skill.id] ? LECTURE[skill.id](faits || {}, inp) : ['Big Brother analyse ta demande…', 'Il structure sa réponse…']).filter(Boolean);
  progres(`${vu ? `Données prêtes : ${vu}. ` : ''}Envoi à Big Brother${versNom ? ', noms remplacés par des alias' : ''}…`, lecture);
  const opts = { system: `${sys || skill.system}\n${json ? '' : SORTIE_MD}`, max_tokens: skill.max_tokens, temperature: skill.temperature, max_chars: skill.max_chars, fond };
  // Le modèle ne répond pas (délai, service en panne) : un skill qui sait
  // se passer de lui rend sa version calculée plutôt qu'une erreur.
  const secours = (raison) => {
    if (!skill.secours) return null;
    progres('Big Brother n\'a pas pu répondre : FOps calcule une version sans IA…');
    console.warn(`[ai] ${skill.id} : version de secours (${raison})`);
    return { content: '', model: '', ms: 0, skill: skill.id, vue: skill.vue, faits, data: skill.secours(faits || {}, raison) };
  };
  let r;
  try { r = await chat([{ role: 'user', content: user }], opts); }
  catch (e) { if (e.arret) throw e; const s = secours(e.message); if (s) return s; throw e; }
  // Réponse structurée coupée ou illisible : un second essai, plus de marge
  // et la consigne d'être bref. Si elle reste coupée, lireJson la répare.
  let data = json ? lireJson(r.content) : undefined;
  if (json && (r.finish_reason === 'length' || !utilisable(data))) {
    console.warn(`[ai] ${skill.id} : réponse ${r.finish_reason === 'length' ? 'coupée' : 'illisible'}, second essai plus concis`);
    progres(`Réponse ${r.finish_reason === 'length' ? 'trop longue' : 'mal formée'} (${Math.round(r.ms / 1000)} s) : Big Brother recommence en plus concis…`,
      ['Il resserre chaque section…', 'Il garde l\'essentiel de chaque point…']);
    try {
      const r2 = await chat([{ role: 'user', content: user }], { ...opts, retry: true, max_tokens: 8000, system: `${opts.system}\n${CONCIS}` });
      const d2 = lireJson(r2.content);
      // On garde le meilleur des deux essais.
      if (utilisable(d2) && (!utilisable(data) || !d2._tronque || data._tronque)) { r = { ...r2, ms: r.ms + r2.ms }; data = d2; }
    } catch { /* on garde le premier essai */ }
    if (!utilisable(data)) { const s = secours('réponse illisible'); if (s) return s; }
  }
  progres(json ? 'Lecture de la réponse et mise en forme du rapport…' : 'Mise en forme de la réponse…');
  if (versNom) progres('Remise des vrais noms à la place des alias…');
  // Alias → vrais noms, dans le texte comme dans le JSON lu.
  const { reidentifier } = require('./ai-team');
  const content = versNom ? versNom(r.content) : r.content;
  let lu = data && versNom ? reidentifier(data, versNom) : data;
  if (skill.apres) { progres('FOps exécute la recherche…'); lu = skill.apres(lu, inp, faits || {}); }
  return { ...r, content, skill: skill.id, vue: skill.vue, faits, data: lu };
}

// ── Tableau de bord : brief et impact ─────────────────────────
// Les signaux d'équipe sont calculés par la page (mêmes règles que
// l'écran Équipe) ; le serveur les borne, vérifie les agents et met les
// alias. Les signaux opérationnels sont recalculés ici.
const NIVEAUX = ['urgent', 'todo', 'info'];
function signauxEquipe(brut) {
  const foList = readCfg().fo_list || [];
  return (Array.isArray(brut) ? brut : []).slice(0, 60)
    .filter(a => a && foList.includes(a.fo))
    .map(a => ({ fo: a.fo, items: (Array.isArray(a.items) ? a.items : []).slice(0, 12)
      .filter(i => i && NIVEAUX.includes(i.lvl))
      .map(i => ({ lvl: i.lvl, kind: clamp(i.kind, 30), txt: clamp(i.txt, 200) })) }))
    .filter(a => a.items.length);
}

async function briefTableau(equipeBrut, country = 'ALL') {
  const { pseudonymes, signauxOps } = require('./ai-team');
  const ps = pseudonymes(readCfg().fo_list || []);
  const equipe = signauxEquipe(equipeBrut).map(a => ({ agent: ps.alias(a.fo), signaux: a.items.map(i => `[${i.lvl}] ${ps.versAlias(i.txt)}`) }));
  const ops = signauxOps(country);
  const site = country === 'SN' ? 'Dakar (SN)' : country === 'CI' ? 'Abidjan (CI)' : 'Dakar et Abidjan';
  const user = `Date : ${new Date().toISOString().slice(0, 10)}\nPérimètre : ${site}\nSignaux opérationnels :\n${JSON.stringify({ resume: ops.resume, signaux: ops.items.map(i => `[${i.lvl}] ${i.txt}${i.detail ? ' : ' + i.detail : ''}`) })}`
    + `\nSignaux d'équipe :\n${JSON.stringify(equipe)}`;
  return lancer('cockpit-brief', { user, versNom: ps.versNom });
}

async function impactElement(brut) {
  const { pseudonymes, bilanEquipe, signauxOps } = require('./ai-team');
  const cfg = readCfg();
  const ps = pseudonymes(cfg.fo_list || []);
  const b = brut || {};
  const fo = (cfg.fo_list || []).includes(b.fo) ? b.fo : '';
  const item = { niveau: NIVEAUX.includes(b.lvl) ? b.lvl : 'info', type: clamp(b.kind, 30), signal: ps.versAlias(clamp(b.txt, 300)), detail: ps.versAlias(clamp(b.detail, 600)) };
  const contexte = fo
    ? { agent: ps.alias(fo), indicateurs: bilanEquipe(fo).donnees.agents[0] || null }
    : { operations: signauxOps().resume };
  const user = `Signal :\n${JSON.stringify(item)}\nContexte :\n${JSON.stringify(contexte)}`;
  return lancer('impact', { user, versNom: ps.versNom });
}

module.exports = { briefTableau, impactElement, catalogue, lancer, anonymiser, lireJson, entrees, SKILLS, objectifPourIa };
