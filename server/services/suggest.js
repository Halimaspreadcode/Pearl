// Suggestions de champs à la création d'un ticket, déduites de l'historique.
//
// Principe — déterministe et explicable, sans bibliothèque de ML :
//   1. Les titres (et descriptions) des tickets du tracker sont découpés en
//      mots utiles (minuscules, sans accents, sans mots vides FR/EN, sans
//      nombres seuls) et pondérés en TF-IDF.
//   2. Le titre saisi est comparé à chaque ticket (similarité cosinus) ; on
//      garde les K plus proches au-dessus d'un seuil.
//   3. Pour chaque champ, les voisins « votent » pour leur valeur avec un
//      poids égal à leur similarité. On propose la valeur gagnante seulement
//      si elle porte ≥ MIN_CONFIDENCE des votes ET au moins MIN_SUPPORT
//      tickets — sinon rien : mieux vaut aucun conseil qu'un mauvais.
//   4. Seules les valeurs présentes dans les listes configurées (domaines,
//      BO, équipe FO…) peuvent être proposées : un ancien ticket portant un
//      domaine supprimé ne doit pas le faire revivre.
//
// Chaque suggestion porte ses preuves (nombre de tickets, exemples), pour que
// l'agent sache POURQUOI la valeur lui est proposée.
//
// L'index est mis en cache par tracker et reconstruit quand le fichier change
// (mtime + taille) : une requête ne relit ni ne retokenise l'historique.
const fs = require('fs');
const { FILES } = require('../config/paths');
const { readCfg, readTracker, readBO } = require('../core/store');

const K               = 15;     // voisins retenus
const MIN_SIMILARITY  = 0.25;   // en dessous, un ticket n'est pas « similaire »
const MIN_CONFIDENCE  = 0.6;    // part des votes pondérés de la valeur gagnante
const MIN_SUPPORT     = 3;      // tickets portant la valeur gagnante
const DUP_SIMILARITY  = 0.75;   // ticket ouvert quasi identique → doublon possible
const REUSE_SIMILARITY = 0.6;   // texte RCA repris d'un seul ticket très proche
const DESC_WEIGHT     = 0.5;    // la description compte moitié moins que le titre
const CLOSED          = ['Resolved', 'Closed'];

// Valeurs figées dans le formulaire (public/index.html) — à garder alignées.
const SEVERITIES   = ['Critical', 'Major', 'Minor', 'Warning'];
const RC_CATEGORIES = ['Hardware', 'Software', 'Network', 'Configuration', 'Human Error', 'Process', 'Unknown'];
const DEFAULT_TYPES = ['Incident', 'Problem Bug', 'Problem non Bug'];
// Règle « sévérité = priorité » quand rien d'autre ne la fixe.
const PRIORITY_SEVERITY = { P1: 'Critical', P2: 'Major', P3: 'Minor', P4: 'Warning' };

// Champs à valeur discrète, votés ; et champs texte, repris tels quels.
const VOTE_FIELDS = ['type', 'domain', 'priority', 'severity', 'bo_handling', 'assigned_to', 'rc_category'];
const TEXT_FIELDS = ['root_cause', 'corrective_actions'];

// Mots vides français et anglais. Les mots métier (fibre, fh, nms, u2020,
// noms de sites…) ne sont PAS ici : ce sont eux qui font la similarité.
const STOPWORDS = new Set((
  // FR
  'a au aux avec ce ces cet cette dans de des du elle en et est il ils je la le les leur leurs lui ' +
  'ma mais me meme mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta ' +
  'te tes toi ton tu un une vos votre vous y d l j m n s t c qu sans sous entre vers chez plus moins ' +
  'tres ete etre avoir fait faire sont ont suite lors apres avant depuis pendant non oui aussi ' +
  'tout tous toute toutes autre autres deja encore car donc ni or si lorsque puis ' +
  // EN
  'the an and or of to in on at for from by with without is are was were be been being it its this ' +
  'that these those as into over under after before since during not no yes also all any some ' +
  'has have had do does did can could will would should may might than then there their our your ' +
  'we you they he she him her them his hers ours about between via per'
).split(/\s+/).filter(Boolean));

function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Découpe un texte en jetons utiles. Pluriel simple retiré (alarmes →
// alarme, liens → lien) pour rapprocher les variantes d'un même mot, sans
// racinisation agressive qui confondrait des termes techniques.
function tokenize(text) {
  if (!text) return [];
  const out = [];
  for (let w of stripAccents(String(text).toLowerCase()).split(/[^a-z0-9]+/)) {
    if (w.length < 2 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    if (w.length > 4 && /[sx]$/.test(w) && !/ss$/.test(w)) w = w.slice(0, -1);
    out.push(w);
  }
  return out;
}

// Fréquences de termes : tf = 1 + ln(n).
function termFreq(tokens, weight = 1, into = new Map()) {
  const counts = new Map();
  for (const t of tokens) counts.set(t, (counts.get(t) || 0) + 1);
  for (const [t, n] of counts) into.set(t, (into.get(t) || 0) + weight * (1 + Math.log(n)));
  return into;
}

function norm(vec) {
  let s = 0;
  for (const v of vec.values()) s += v * v;
  return Math.sqrt(s);
}

// Construit l'index d'un tableau de tickets. Pur : testable sans fichier.
function buildIndex(tickets) {
  const docs = [];
  const df = new Map();
  for (const t of tickets) {
    const titleTf = termFreq(tokenize(t.title));
    const fullTf  = termFreq(tokenize(t.description), DESC_WEIGHT, new Map(titleTf));
    for (const term of fullTf.keys()) df.set(term, (df.get(term) || 0) + 1);
    docs.push({ ticket: t, titleTf, fullTf });
  }
  const N = docs.length;
  const idf = new Map();
  for (const [term, n] of df) idf.set(term, Math.log((N + 1) / (n + 1)) + 1);
  const weigh = tf => {
    const v = new Map();
    for (const [term, f] of tf) v.set(term, f * idf.get(term));
    return v;
  };
  for (const d of docs) {
    d.title = weigh(d.titleTf); d.titleNorm = norm(d.title);
    d.full  = weigh(d.fullTf);  d.fullNorm  = norm(d.full);
    delete d.titleTf; delete d.fullTf;
  }
  return { docs, idf, N };
}

// Vecteur de la requête, dans l'espace de l'index : un mot jamais vu
// n'apporte rien (son idf n'existe pas), on l'ignore.
function queryVector(index, text) {
  const tf = termFreq(tokenize(text));
  const v = new Map();
  for (const [term, f] of tf) { const w = index.idf.get(term); if (w) v.set(term, f * w); }
  return v;
}

function cosine(q, qNorm, vec, vNorm) {
  if (!qNorm || !vNorm) return 0;
  let dot = 0;
  for (const [term, w] of q) { const x = vec.get(term); if (x) dot += w * x; }
  return dot / (qNorm * vNorm);
}

// Tous les tickets classés par similarité décroissante (égalité : id, pour
// un ordre stable d'une requête à l'autre).
function rank(index, title) {
  const q = queryVector(index, title);
  const qn = norm(q);
  if (!qn) return [];
  const out = [];
  for (const d of index.docs) {
    const s = Math.max(cosine(q, qn, d.title, d.titleNorm), cosine(q, qn, d.full, d.fullNorm));
    if (s > 0) out.push({ ticket: d.ticket, similarity: s });
  }
  out.sort((a, b) => b.similarity - a.similarity
    || String(a.ticket.id).localeCompare(String(b.ticket.id)));
  return out;
}

// ── Cache par tracker ────────────────────────────────────────
const _cache = {};
function indexFor(tracker) {
  let st = null;
  try { st = fs.statSync(FILES[tracker]); } catch { /* fichier absent : index vide */ }
  const key = st ? `${st.mtimeMs}:${st.size}` : 'none';
  const c = _cache[tracker];
  if (c && c.key === key) return c.index;
  const index = buildIndex(st ? readTracker(tracker) : []);
  _cache[tracker] = { key, index };
  return index;
}

// ── Listes autorisées ────────────────────────────────────────
// Une valeur historique est ramenée à sa forme canonique actuelle, ou
// écartée si elle n'existe plus. Le BO est enregistré sous la forme
// « Nom Téléphone » (valeur de l'option du formulaire) : on accepte aussi
// le nom seul d'un ancien ticket.
function allowedLists(cfg, boList) {
  const exact = arr => {
    const m = new Map();
    (arr || []).forEach(v => { if (v) m.set(String(v).trim().toLowerCase(), String(v)); });
    return m;
  };
  const types = [...new Set(Object.keys(cfg.sla_hours || {}).map(k => k.replace(/\s+P\d$/i, '')))];
  const bo = new Map();
  (boList || []).forEach(b => {
    if (!b || !b.name) return;
    const val = b.phone ? `${b.name} ${b.phone}` : b.name;
    bo.set(val.trim().toLowerCase(), val);
    bo.set(String(b.name).trim().toLowerCase(), val);
  });
  return {
    type:        exact(types.length ? types : DEFAULT_TYPES),
    domain:      exact(cfg.domains),
    priority:    exact(cfg.ticket_priorities && cfg.ticket_priorities.length ? cfg.ticket_priorities : Object.keys(PRIORITY_SEVERITY)),
    severity:    exact(SEVERITIES),
    bo_handling: bo,
    assigned_to: exact(cfg.fo_list),
    rc_category: exact(RC_CATEGORIES),
  };
}

const ref = t => ({ id: t.id, sn_tt: t.sn_tt || t.imoc_tt || t.tt_number || '', title: t.title || '' });
const round = x => Math.round(x * 100) / 100;

// Vote pondéré d'un champ parmi les voisins.
function vote(neighbors, field, allowed, weightOf) {
  const tally = new Map();       // valeur → { weight, items }
  let total = 0, voters = 0;
  for (const n of neighbors) {
    const raw = n.ticket[field];
    if (raw == null || raw === '') continue;
    const value = allowed.get(String(raw).trim().toLowerCase());
    if (!value) continue;        // hors liste : ne vote pas
    const w = weightOf(n);
    total += w; voters++;
    const e = tally.get(value) || { weight: 0, items: [] };
    e.weight += w; e.items.push(n);
    tally.set(value, e);
  }
  if (!total) return null;
  let best = null;
  for (const [value, e] of tally) {
    if (!best || e.weight > best.weight || (e.weight === best.weight && value < best.value))
      best = { value, ...e };
  }
  const confidence = best.weight / total;
  if (confidence < MIN_CONFIDENCE || best.items.length < MIN_SUPPORT) return null;
  return {
    value: best.value, kind: 'vote',
    confidence: round(confidence),
    support: best.items.length, total: voters,
    examples: best.items.slice(0, 3).map(n => ({ ...ref(n.ticket), similarity: round(n.similarity) })),
  };
}

// Texte RCA : soit un texte identique chez ≥ MIN_SUPPORT voisins (vote),
// soit la reprise du ticket le plus proche s'il est très proche.
function textSuggestion(neighbors, field, weightOf) {
  const canon = s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const withText = neighbors.filter(n => canon(n.ticket[field]));
  if (!withText.length) return null;
  const allowed = new Map(withText.map(n => [canon(n.ticket[field]), String(n.ticket[field]).trim()]));
  const v = vote(withText, field, allowed, weightOf);
  if (v) return v;
  const top = withText[0];
  if (top.similarity < REUSE_SIMILARITY) return null;
  return {
    value: String(top.ticket[field]).trim(), kind: 'reuse',
    confidence: round(top.similarity), support: 1, total: withText.length,
    examples: [{ ...ref(top.ticket), similarity: round(top.similarity) }],
  };
}

const sameRef = (a, b) => a && b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

// Cœur, pur : tickets + listes → suggestions. `query` : { title, sn_tt, imoc_tt, domain }.
function suggestFrom(index, query, lists) {
  const ranked = rank(index, query.title || '');
  const neighbors = ranked.filter(r => r.similarity >= MIN_SIMILARITY).slice(0, K);

  // Domaine déjà choisi : les voisins d'un autre domaine pèsent moitié moins.
  const chosenDomain = query.domain ? String(query.domain).trim().toLowerCase() : '';
  const weightOf = n => n.similarity *
    (chosenDomain && String(n.ticket.domain || '').trim().toLowerCase() !== chosenDomain ? 0.5 : 1);

  const suggestions = {};
  if (neighbors.length >= MIN_SUPPORT) {
    for (const f of VOTE_FIELDS) {
      if (f === 'domain' && chosenDomain) continue;
      const s = vote(neighbors, f, lists[f], weightOf);
      if (s) suggestions[f] = s;
    }
  }
  for (const f of TEXT_FIELDS) {
    const s = textSuggestion(neighbors, f, weightOf);
    if (s) suggestions[f] = s;
  }
  // Règle : sans sévérité établie par l'historique, elle suit la priorité.
  if (!suggestions.severity && suggestions.priority) {
    const sev = PRIORITY_SEVERITY[suggestions.priority.value];
    if (sev && lists.severity.has(sev.toLowerCase())) {
      suggestions.severity = {
        value: sev, kind: 'rule', rule: `severity follows priority ${suggestions.priority.value}`,
        confidence: suggestions.priority.confidence,
        support: suggestions.priority.support, total: suggestions.priority.total,
        examples: suggestions.priority.examples,
      };
    }
  }

  // Doublons : même référence (tout statut), ou ticket OUVERT quasi identique.
  const dups = new Map();
  if (query.sn_tt || query.imoc_tt) {
    for (const d of index.docs) {
      const t = d.ticket;
      if (sameRef(query.sn_tt, t.sn_tt) || sameRef(query.imoc_tt, t.imoc_tt)) {
        const r = ranked.find(x => x.ticket === t);
        dups.set(t.id, { t, similarity: r ? r.similarity : 0, reason: 'same_ref' });
      }
    }
  }
  for (const r of ranked) {
    if (r.similarity < DUP_SIMILARITY) break;
    if (CLOSED.includes(r.ticket.status) || dups.has(r.ticket.id)) continue;
    dups.set(r.ticket.id, { t: r.ticket, similarity: r.similarity, reason: 'similar_title' });
  }
  const possible_duplicates = [...dups.values()]
    .sort((a, b) => (a.reason === 'same_ref' ? -1 : 0) - (b.reason === 'same_ref' ? -1 : 0)
      || b.similarity - a.similarity)
    .slice(0, 5)
    .map(({ t, similarity, reason }) => ({
      id: t.id, sn_tt: t.sn_tt || '', imoc_tt: t.imoc_tt || '', title: t.title || '',
      status: t.status || '', similarity: round(similarity), reason,
    }));

  return {
    tokens: [...queryVector(index, query.title || '').keys()],
    similar_count: neighbors.length,
    suggestions,
    possible_duplicates,
  };
}

// Point d'entrée des routes : lit l'index en cache et les listes à jour.
function suggest(tracker, query) {
  const t0 = process.hrtime.bigint();
  const index = indexFor(tracker);
  const lists = allowedLists(readCfg(), readBO());
  const out = suggestFrom(index, query || {}, lists);
  out.tracker = tracker;
  out.indexed = index.N;
  out.took_ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return out;
}

module.exports = {
  suggest, suggestFrom, buildIndex, rank, tokenize, allowedLists,
  PRIORITY_SEVERITY, K, MIN_SIMILARITY, MIN_CONFIDENCE, MIN_SUPPORT, DUP_SIMILARITY,
  _cache,
};
