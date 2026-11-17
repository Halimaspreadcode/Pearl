const { FILES } = require('../config/paths');
const { readCfg, readJSON, writeJSON, withFileLock, writeCfg } = require('../core/store');

// ══════════════════════════════════════════════════════════════
// INSIGHT DE PERFORMANCE POUR L'AGENT (Big Brother)
//
// L'agent lit, sur sa page My Performance, une lecture courte de sa
// propre fiche : ce qui va bien, où gagner des points, la prochaine étape.
//
// Génération automatique, agent par agent (l'agent n'a rien à demander) :
// une passe toutes les 20 minutes, et dès que l'admin active un agent.
// Une passe traite, dans l'ordre, les agents activés dont l'insight du
// mois manque, ou dont la fiche a changé depuis le dernier insight (au
// plus un par jour). Si Big Brother est injoignable (tunnel éteint), la
// passe s'arrête et les agents restants attendent la suivante. L'admin
// voit l'état de chaque agent et peut lancer une passe ou un agent.
//
// Activation manuelle par l'admin : config.ai_insights =
//   { enabled: bool, agents: { "<nom>": true } }
// Rien n'est généré tant que l'admin n'a pas allumé l'interrupteur
// général ET coché l'agent.
//
// Données envoyées au modèle : la fiche que l'agent voit déjà
// (buildPerfView), sans son nom ni ceux des autres agents.
//
// Stockage : data/ai_insights.json garde TOUS les insights de chaque
// agent, du plus récent au plus ancien ({ "<nom>": [ insight… ] }), comme
// un historique de sa fiche. Il part dans les sauvegardes quotidiennes
// avec les autres .json de data/. L'insight du mois en cours sert de
// cache : rouvrir la page ne rappelle pas le modèle, un nouvel insight
// n'est possible qu'une fois par jour.
// ══════════════════════════════════════════════════════════════

const DELAI_MS = 24 * 3600 * 1000;

function reglages() {
  const r = readCfg().ai_insights || {};
  return { enabled: !!r.enabled, agents: { ...(r.agents || {}) } };
}

function actifPour(fo) {
  const r = reglages();
  return r.enabled && !!r.agents[fo] && (readCfg().fo_list || []).includes(fo);
}

async function majReglages(body) {
  const b = body || {};
  const foList = readCfg().fo_list || [];
  let out;
  await withFileLock(FILES.config, () => {
    const cfg = readCfg();
    const cur = cfg.ai_insights || {};
    const agents = { ...(cur.agents || {}) };
    if (b.agents && typeof b.agents === 'object') {
      for (const [fo, v] of Object.entries(b.agents)) {
        if (!foList.includes(fo)) continue;
        if (v) agents[fo] = true; else delete agents[fo];
      }
    }
    cfg.ai_insights = { enabled: b.enabled === undefined ? !!cur.enabled : !!b.enabled, agents };
    writeCfg(cfg);
    out = cfg.ai_insights;
  });
  return out;
}

const MAX_PAR_AGENT = 120;   // dix ans à raison d'un par mois, bien plus qu'assez

// Historique de tous les agents. L'ancien format (un seul insight par
// agent, objet) est lu comme un historique d'un élément.
function lireTout() {
  const brut = readJSON(FILES.ai_insights, {});
  const out = {};
  for (const [fo, v] of Object.entries(brut || {})) {
    const l = Array.isArray(v) ? v : (v && typeof v === 'object' ? [v] : []);
    out[fo] = l.filter(x => x && x.at).map((x, i) => ({ id: x.id || `i${Date.parse(x.at).toString(36)}${i}`, ...x }))
      .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }
  return out;
}
const historique = fo => lireTout()[fo] || [];

function cachePour(fo, periode) {
  return historique(fo).find(x => x.periode === periode) || null;
}

// Liste courte pour l'interface : de quoi choisir un insight passé.
const resume = l => l.map(x => ({ id: x.id, periode: x.periode, at: x.at, headline: x.data?.headline || '' }));

// Vue publique d'un insight gardé.
function vue(c) {
  if (!c) return null;
  const prochain = Date.parse(c.at) + DELAI_MS;
  return { id: c.id, periode: c.periode, at: c.at, data: c.data, peut_actualiser: Date.now() >= prochain, prochain: new Date(prochain).toISOString() };
}

// Un insight précis de l'historique d'un agent (le sien, pour l'agent).
function insightParId(fo, id) {
  return vue(historique(fo).find(x => x.id === String(id)) || null);
}

function etatPour(fo) {
  const { buildPerfView } = require('./perf');
  const actif = actifPour(fo);
  if (!actif) return { actif: false };
  const periode = buildPerfView(fo).periode;
  return { actif: true, insight: vue(cachePour(fo, periode)), historique: resume(historique(fo)) };
}

const SYSTEM = [
  'You are a supportive performance coach for an agent of an ITSM monitoring Front Office team.',
  'You read the agent\'s own scorecard (criteria scored /100, trend, six-month history, objectives, one-to-one actions, manager comments) and speak directly to the agent ("you").',
  'Be encouraging, concrete and honest. Base every point on the data given; never invent figures. A missing score is "not scored yet", not a weakness.',
  'Never compare with colleagues. Do not mention salary, sanctions or HR decisions.',
  'Reply ONLY with a valid JSON object:',
  '{"headline":"one sentence that sums up the month","strengths":["…"],"focus":[{"area":"criterion or topic","why":"what the data shows","how":"one concrete action"}],',
  '"next_step":"the single most useful thing to do this week","encouragement":"one short motivating sentence"}',
  'At most 3 strengths and 3 focus areas. Short sentences. In English.',
].join('\n');

// Ce que le modèle reçoit : la fiche sans le nom de l'agent ni d'autres
// noms (commentaires et actions peuvent en contenir).
function fichePourIa(v) {
  const { anonymiser } = require('./ai-skills');
  const noms = [v.fo, ...String(v.fo).split(/\s+/).filter(x => x.length > 2), ...(readCfg().fo_list || [])];
  const a = t => anonymiser(t, noms).replace(/l'agent/g, 'the agent');
  return {
    month: v.periode, overall_score: v.score, level: v.niveau || null, trend: v.tendance, previous_score: v.score_precedent,
    criteria: (v.criteres || []).map(c => ({ criterion: c.id, weight_pct: c.weight, score: c.valeur, previous: c.precedent })),
    history: (v.historique || []).map(h => ({ month: h.periode, score: h.score })),
    objectives: (v.objectifs || []).slice(0, 8).map(o => ({
      title: a(o.title || ''), progress_pct: o.progress_pct ?? null, state: o.progress || null,
      overdue: !!(o.late && o.late.overdue), late_milestones: (o.late && o.late.late_steps) || 0, due: o.due || null,
    })),
    one_to_one_actions: (v.actions || []).slice(0, 10).map(x => ({ action: a(x.text), status: x.status, due: x.due || null, late: !!x.late })),
    manager_comments: (v.commentaires || []).slice(0, 6).map(c => ({ criterion: c.critere || 'general', comment: a(c.text || '') })).filter(c => c.comment),
  };
}

// Empreinte de la fiche envoyée : un insight est à jour tant que la fiche
// n'a pas changé (nouvelle note, commentaire, objectif…).
const empreinte = f => require('crypto').createHash('sha1').update(JSON.stringify(f)).digest('hex').slice(0, 16);

function situation(fo) {
  const { buildPerfView } = require('./perf');
  const v = buildPerfView(fo);
  const fiche = fichePourIa(v);
  const emp = empreinte(fiche);
  const dernier = cachePour(fo, v.periode);
  // Un insight d'avant l'empreinte (sans champ) est tenu pour à jour.
  const change = !!dernier && !!dernier.empreinte && dernier.empreinte !== emp;
  const recent = !!dernier && Date.now() < Date.parse(dernier.at) + DELAI_MS;
  return { v, fiche, emp, dernier, aFaire: !dernier || (change && !recent), change };
}

// Génère l'insight d'un agent si besoin (ou toujours avec force).
async function genererPour(fo, { force } = {}) {
  if (!actifPour(fo)) { const e = new Error('Insight non activé pour cet agent.'); e.status = 403; throw e; }
  const st = situation(fo);
  if (!force && !st.aFaire) return { genere: false, insight: vue(st.dernier) };
  const { chat } = require('./ai');
  const { lireJson } = require('./ai-skills');
  const r = await chat([{ role: 'user', content: `Scorecard:\n${JSON.stringify(st.fiche)}` }],
    { system: SYSTEM, max_tokens: 3000, temperature: 0.4, max_chars: 16000 });
  const data = lireJson(r.content);
  if (!data || !data.headline) { const e = new Error('Réponse de Big Brother illisible.'); e.status = 502; throw e; }
  const entree = { id: `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, periode: st.v.periode, at: new Date().toISOString(), data, model: r.model, empreinte: st.emp };
  // On ajoute, on n'écrase pas : chaque insight reste consultable.
  await withFileLock(FILES.ai_insights, () => {
    const all = lireTout();
    all[fo] = [entree, ...(all[fo] || [])].slice(0, MAX_PAR_AGENT);
    writeJSON(FILES.ai_insights, all);
  });
  return { genere: true, insight: vue(entree) };
}

// ── Passe de génération, agent par agent ─────────────────────
const JOB = { encours: false, liste: [], courant: null, fait: 0, debut: null, fin: null, motif: '', etats: {} };
const RESEAU = /injoignable|délai|tunnel|proxy|refus|connexion|ECONN|ENOTFOUND|ETIMEDOUT/i;

function lancerPasse({ fo, force } = {}) {
  if (JOB.encours) return false;
  const r = reglages();
  const actifs = (readCfg().fo_list || []).filter(x => r.enabled && r.agents[x]);
  let liste;
  if (fo) liste = actifs.includes(fo) ? [fo] : [];
  else liste = actifs.filter(x => { try { return force || situation(x).aFaire; } catch { return false; } });
  if (!liste.length) return false;
  Object.assign(JOB, { encours: true, liste, courant: null, fait: 0, debut: new Date().toISOString(), fin: null, motif: '' });
  liste.forEach(x => { JOB.etats[x] = { etat: 'attente', at: null }; });
  (async () => {
    const { addAudit } = require('../core/audit');
    for (let i = 0; i < liste.length; i++) {
      const x = liste[i];
      JOB.courant = x;
      JOB.etats[x] = { etat: 'en_cours', at: new Date().toISOString() };
      try {
        const g = await genererPour(x, { force: !!force || !!fo });
        JOB.etats[x] = { etat: g.genere ? 'fait' : 'a_jour', at: new Date().toISOString() };
        if (g.genere) addAudit('AI', 'insight', 'auto', 'insight', { agent: x, periode: g.insight.periode });
      } catch (e) {
        JOB.etats[x] = { etat: 'echec', at: new Date().toISOString(), erreur: String(e.message).slice(0, 160) };
        console.error('[ai] insight', x, ':', e.message);
        // Big Brother injoignable : inutile d'insister sur les suivants.
        if (RESEAU.test(e.message)) {
          JOB.motif = 'Big Brother injoignable (tunnel éteint ?) : la passe reprendra plus tard.';
          liste.slice(i + 1).forEach(y => { JOB.etats[y] = { etat: 'attente', at: null, erreur: 'Big Brother injoignable' }; });
          break;
        }
      }
      JOB.fait = i + 1;
    }
    Object.assign(JOB, { encours: false, courant: null, fin: new Date().toISOString() });
  })();
  return true;
}

// Passes automatiques : peu après le démarrage, puis toutes les 20 min.
let _minuteur = null;
function demarrerAuto() {
  if (_minuteur) return;
  const tick = () => { try { if (reglages().enabled) lancerPasse(); } catch (e) { console.error('[ai] passe insights :', e.message); } };
  setTimeout(tick, 90 * 1000).unref();
  _minuteur = setInterval(tick, 20 * 60 * 1000);
  _minuteur.unref();
}

// Vue admin : réglages, état de chaque agent, passe en cours.
function vueAdmin() {
  const r = reglages();
  const tout = lireTout();
  const agents = (readCfg().fo_list || []).map(fo => {
    const actif = r.enabled && !!r.agents[fo];
    let etat = 'inactif', aJour = null;
    if (actif) {
      try { const st = situation(fo); aJour = !st.aFaire; etat = st.dernier ? (st.aFaire ? 'a_refaire' : 'fait') : 'a_faire'; }
      catch { etat = 'a_faire'; }
    }
    // L'état de la dernière passe prime tant qu'il dit quelque chose
    // de plus récent (en cours, échec, en attente).
    const j = JOB.etats[fo];
    if (actif && j) {
      if (JOB.encours && JOB.liste.includes(fo)) etat = j.etat;   // en_cours, attente, fait, echec
      // Un échec reste visible jusqu'au prochain succès, même si l'insight
      // précédent est encore valable ; une attente, seulement s'il manque.
      else if (j.etat === 'echec' || (j.etat === 'attente' && etat !== 'fait')) etat = j.etat;
    }
    const d = tout[fo]?.[0];
    return { fo, coche: !!r.agents[fo], actif, etat, a_jour: aJour, erreur: j?.erreur || null,
      dernier: d ? { periode: d.periode, at: d.at } : null, total: (tout[fo] || []).length };
  });
  return {
    enabled: r.enabled, agents,
    passe: { encours: JOB.encours, fait: JOB.fait, total: JOB.liste.length, courant: JOB.courant, debut: JOB.debut, fin: JOB.fin, motif: JOB.motif },
  };
}

function insightAdmin(fo) { const l = historique(fo); return { insight: vue(l[0] || null), historique: resume(l) }; }

module.exports = { reglages, actifPour, majReglages, etatPour, genererPour, lancerPasse, demarrerAuto, vueAdmin, insightAdmin, insightParId, historique, fichePourIa, JOB };
