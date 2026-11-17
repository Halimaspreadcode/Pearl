// ══════════════════════════════════════════════════════════════
// RECHERCHE EN LANGAGE NATUREL DANS FOPS
//
// « Trouve celui qui a oublié de fermer son ticket vendredi », « combien
// d'absences par agent en septembre », « les P1 encore ouverts à
// Abidjan »… Big Brother ne voit pas les données : il traduit la question
// en requête sur un schéma décrit (source, filtres, tri, regroupement),
// et c'est FOps qui l'exécute. Le résultat s'affiche tel quel, avec la
// lecture que Big Brother a faite de la question pour la vérifier.
//
// Les agents sont des alias pour le modèle (« Agent 03 ») : un nom cité
// dans la question est remplacé avant l'envoi, puis remis dans la requête.
// ══════════════════════════════════════════════════════════════

const { readCfg, readShiftsPlan, readObs, readWeeklyProgress } = require('../core/store');

const J = 86400000;
const jour = v => (v ? String(v).slice(0, 10) : '');
const jours = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / J * 10) / 10 : null);
const CLOS = ['Resolved', 'Closed'];

// Chaque source : ses champs (type, valeurs connues, sens) et ses lignes.
const SOURCES = {
  tickets: {
    libelle: 'Tickets SN et CI',
    champs: {
      ticket: { type: 'texte', desc: 'numéro du ticket' },
      titre: { type: 'texte' },
      pays: { type: 'liste', valeurs: ['SN', 'CI'] },
      type: { type: 'liste', valeurs: ['Incident', 'Request', 'Problem', 'Change'] },
      priorite: { type: 'liste', valeurs: ['P1', 'P2', 'P3', 'P4'] },
      statut: { type: 'liste', valeurs: ['Open', 'In Progress', 'On Hold', 'Resolved', 'Closed'], desc: 'Resolved et Closed = fermé' },
      ferme: { type: 'liste', valeurs: ['oui', 'non'], desc: 'oui si statut Resolved ou Closed' },
      domaine: { type: 'texte' },
      agent: { type: 'agent', desc: 'agent assigné (à défaut, propriétaire FO)' },
      ouvert_le: { type: 'date' }, clos_le: { type: 'date', desc: 'vide si pas fermé ou date oubliée' },
      clos_par: { type: 'agent' }, modifie_par: { type: 'agent' }, modifie_le: { type: 'date' },
      sla: { type: 'liste', valeurs: ['In SLA', 'Near Breach', 'Breach', 'On Hold', 'N/A'] },
      duree_jours: { type: 'nombre', desc: 'jours entre ouverture et fermeture, ou jusqu\'à aujourd\'hui si ouvert' },
      shift: { type: 'texte' },
    },
    lignes: (cfg, pays, auj) => {
      let t = [];
      try { t = require('../core/enrich').allEnriched(cfg, pays); } catch {}
      return t.map(x => {
        const ferme = CLOS.includes(x.status);
        return {
          ticket: x.sn_tt || x.id, titre: x.title || '', pays: x.tracker, type: x.type || '', priorite: x.priority || '',
          statut: x.status || '', ferme: ferme ? 'oui' : 'non', domaine: x.domain || '', agent: x.assigned_to || x.fo_owner || '',
          ouvert_le: x.open_date || '', clos_le: x.close_date || '', clos_par: x.closed_by || '',
          modifie_par: x.modified_by || '', modifie_le: x.modified_at || '', sla: x.sla_status || '',
          duree_jours: jours(x.open_date, ferme ? (x.close_date || x.modified_at) : auj + 'T23:59:59Z'), shift: x.shift || '',
        };
      });
    },
  },
  absences: {
    libelle: 'Absences et congés',
    champs: {
      agent: { type: 'agent' }, type: { type: 'texte', desc: 'Congés payés, Maladie, Formation…' },
      statut: { type: 'liste', valeurs: ['Demandée', 'Validée', 'Refusée', 'Annulée'] },
      du: { type: 'date' }, au: { type: 'date' }, demandee_le: { type: 'date' },
      jours: { type: 'nombre' },
    },
    lignes: (cfg, pays) => {
      let a = [];
      try { a = require('./absences').readAbsences() || []; } catch {}
      const agents = new Set(require('./ai-team').agentsDuPays(cfg, pays));
      return a.filter(x => x && (!pays || pays === 'ALL' || agents.has(x.fo_name))).map(x => ({
        agent: x.fo_name || '', type: x.type || '', statut: x.status || '', du: x.date_from || '', au: x.date_to || x.date_from || '',
        demandee_le: x.created_at || '', jours: x.date_from ? (jours(x.date_from, x.date_to || x.date_from) || 0) + 1 : null,
      }));
    },
  },
  planning: {
    libelle: 'Planning des shifts',
    champs: { date: { type: 'date' }, agent: { type: 'agent' }, shift: { type: 'texte', desc: 'Matin, Après-midi, Nuit…' }, site: { type: 'texte' }, repos: { type: 'liste', valeurs: ['oui', 'non'] } },
    lignes: (cfg, pays) => {
      const agents = new Set(require('./ai-team').agentsDuPays(cfg, pays));
      return (readShiftsPlan() || []).filter(x => x && (!pays || pays === 'ALL' || agents.has(x.fo_name))).map(x => ({
        date: x.date || '', agent: x.fo_name || '', shift: x.shift_name || x.shift_id || '', site: x.site_name || '',
        repos: x.is_rest || x.shift_id === 'rest' ? 'oui' : 'non',
      }));
    },
  },
  taches: {
    libelle: 'Tâches (suivi hebdo et tâches assignées)',
    champs: {
      tache: { type: 'texte' }, agent: { type: 'agent' }, statut: { type: 'texte', desc: 'Done = terminée' },
      priorite: { type: 'texte' }, echeance: { type: 'date' }, assignee_par: { type: 'texte' }, semaine: { type: 'date' },
      en_retard: { type: 'liste', valeurs: ['oui', 'non'] },
    },
    lignes: (cfg, pays, auj) => {
      const agents = new Set(require('./ai-team').agentsDuPays(cfg, pays));
      return (readWeeklyProgress() || []).filter(x => x && (!pays || pays === 'ALL' || agents.has(x.modified_by))).map(x => ({
        tache: x.task || '', agent: x.modified_by || '', statut: x.status || '', priorite: x.priority || '',
        echeance: x.due_date || '', assignee_par: x.assigned_by || '', semaine: x.week_start || '',
        en_retard: x.status !== 'Done' && x.due_date && x.due_date < auj ? 'oui' : 'non',
      }));
    },
  },
  one_to_one: {
    libelle: 'Entretiens One-to-One',
    champs: {
      agent: { type: 'agent' }, date: { type: 'date' }, humeur: { type: 'liste', valeurs: ['up', 'flat', 'down'], desc: 'down = point de vigilance' },
      sujet: { type: 'texte' }, actions_ouvertes: { type: 'nombre' }, actions_en_retard: { type: 'nombre' },
    },
    lignes: (cfg, pays, auj) => {
      const out = [];
      for (const fo of require('./ai-team').agentsDuPays(cfg, pays)) {
        for (const m of ((cfg.fo_o2o || {})[fo] || {}).meetings || []) {
          const acts = (m.actions || []).filter(a => a && typeof a === 'object' && a.status !== 'done' && a.status !== 'drop');
          out.push({ agent: fo, date: m.date || '', humeur: m.mood || '', sujet: m.topic || '',
            actions_ouvertes: acts.length, actions_en_retard: acts.filter(a => a.due && a.due < auj).length });
        }
      }
      return out;
    },
  },
  observations: {
    libelle: 'Observations et pannes',
    champs: { date: { type: 'date' }, site: { type: 'texte' }, statut: { type: 'liste', valeurs: ['Open', 'Closed'] }, observation: { type: 'texte' }, impact: { type: 'texte' }, auteur: { type: 'texte' } },
    lignes: () => (readObs() || []).map(x => ({
      date: x.date || x.created_at || '', site: x.site || '', statut: x.status || '', observation: x.observation || x.text || '',
      impact: x.impact || '', auteur: x.author || '',
    })),
  },
};

// Le schéma tel que le modèle le lit : noms de champs, types, valeurs.
function schema(alias) {
  return Object.entries(SOURCES).map(([id, s]) => `- ${id} (${s.libelle}) : ` + Object.entries(s.champs).map(([c, d]) => {
    const vals = d.type === 'agent' ? `alias parmi ${alias.slice(0, 3).join(', ')}…` : d.valeurs ? d.valeurs.join('|') : '';
    return `${c} [${d.type}${vals ? ` : ${vals}` : ''}${d.desc ? ` ; ${d.desc}` : ''}]`;
  }).join(', ')).join('\n');
}

const OPS = ['=', '!=', 'contient', 'dans', '<', '<=', '>', '>=', 'entre', 'vide', 'non_vide'];

function systeme(alias, auj) {
  const d = new Date(auj + 'T12:00:00Z');
  const nomJour = d.toLocaleDateString('fr-FR', { weekday: 'long', timeZone: 'UTC' });
  return [
    'Tu traduis une question de manager en requête sur les données de FOps (outil de suivi d\'une équipe Front Office de supervision ITSM).',
    `Aujourd'hui : ${auj} (${nomJour}). Résous les dates relatives (« vendredi », « la semaine dernière », « en septembre ») en dates AAAA-MM-JJ.`,
    'Les agents sont des alias (« Agent 01 »…) : réutilise-les exactement.',
    'Sources et champs :', schema(alias),
    `Opérateurs : ${OPS.join(', ')}. « dans » prend une liste ; « entre » prend [début, fin] inclus ; sur une date, « = » compare le jour.`,
    'Choisis la source la plus juste. Pour « qui » ou « combien par … », utilise regrouper_par. Pour un ticket oublié ou pas fermé, pense à ferme = non et à clos_le vide.',
    'Réponds UNIQUEMENT par un objet JSON valide :',
    '{"source":"tickets","filtres":[{"champ":"…","op":"…","valeur":…}],"tri":{"champ":"…","ordre":"asc"|"desc"},"regrouper_par":null|"champ","colonnes":["…"],"limite":50,',
    '"interpretation":"une phrase : ce que tu cherches exactement, dates résolues","impossible":"chaîne vide, ou pourquoi les données ne permettent pas de répondre"}',
  ].join('\n');
}

// ── Exécution d'une requête ───────────────────────────────────
const estDate = (src, champ) => SOURCES[src]?.champs[champ]?.type === 'date';
function compare(v, op, val, date) {
  const s = v == null ? '' : String(v);
  const n = x => (typeof x === 'number' ? x : parseFloat(x));
  const a = date ? jour(s) : s;
  const b = x => (date ? jour(x) : String(x ?? ''));
  const num = typeof v === 'number' && !date;
  switch (op) {
    case '=': return num ? v === n(val) : a.toLowerCase() === b(val).toLowerCase();
    case '!=': return num ? v !== n(val) : a.toLowerCase() !== b(val).toLowerCase();
    case 'contient': return s.toLowerCase().includes(String(val ?? '').toLowerCase());
    case 'dans': return (Array.isArray(val) ? val : [val]).some(x => (num ? v === n(x) : a.toLowerCase() === b(x).toLowerCase()));
    case '<': return a !== '' && (num ? v < n(val) : a < b(val));
    case '<=': return a !== '' && (num ? v <= n(val) : a <= b(val));
    case '>': return a !== '' && (num ? v > n(val) : a > b(val));
    case '>=': return a !== '' && (num ? v >= n(val) : a >= b(val));
    case 'entre': { const [x, y] = Array.isArray(val) ? val : [val, val]; return a !== '' && (num ? v >= n(x) && v <= n(y) : a >= b(x) && a <= b(y)); }
    case 'vide': return s === '';
    case 'non_vide': return s !== '';
    default: return true;
  }
}

function executer(plan, { pays = 'ALL', auj, cfg = readCfg() } = {}) {
  const src = SOURCES[plan.source] ? plan.source : null;
  if (!src) return { erreur: `Source inconnue : ${plan.source || '?'}.` };
  const S = SOURCES[src];
  const ignores = [];
  const filtres = (Array.isArray(plan.filtres) ? plan.filtres : []).filter(f => {
    const ok = f && S.champs[f.champ] && OPS.includes(f.op);
    if (!ok && f) ignores.push(`${f.champ || '?'} ${f.op || ''}`.trim());
    return ok;
  });
  let lignes = S.lignes(cfg, pays, auj).filter(l => filtres.every(f => compare(l[f.champ], f.op, f.valeur, estDate(src, f.champ))));
  const total = lignes.length;
  const g = plan.regrouper_par && S.champs[plan.regrouper_par] ? plan.regrouper_par : null;
  if (g) {
    const m = new Map();
    for (const l of lignes) { const k = (estDate(src, g) ? jour(l[g]) : l[g]) || '(vide)'; m.set(k, (m.get(k) || 0) + 1); }
    return { source: src, total, groupe: g, colonnes: [g, 'nombre'], lignes: [...m].sort((a, b) => b[1] - a[1]).slice(0, 200).map(([k, n]) => ({ [g]: k, nombre: n })), ignores };
  }
  const tri = plan.tri && S.champs[plan.tri.champ] ? plan.tri : null;
  if (tri) {
    const sens = tri.ordre === 'asc' ? 1 : -1;
    lignes = lignes.slice().sort((a, b) => {
      const x = a[tri.champ], y = b[tri.champ];
      if (x === y) return 0;
      if (x === '' || x == null) return 1;
      if (y === '' || y == null) return -1;
      return (x > y ? 1 : -1) * sens;
    });
  }
  const colonnes = (Array.isArray(plan.colonnes) ? plan.colonnes : []).filter(c => S.champs[c]);
  const cols = colonnes.length ? colonnes : Object.keys(S.champs).slice(0, 6);
  const limite = Math.max(1, Math.min(200, parseInt(plan.limite, 10) || 50));
  return {
    source: src, total, colonnes: cols, ignores,
    lignes: lignes.slice(0, limite).map(l => Object.fromEntries(cols.map(c => [c, estDate(src, c) && l[c] ? String(l[c]).slice(0, 16).replace('T', ' ') : l[c]]))),
  };
}

module.exports = { SOURCES, OPS, schema, systeme, executer, compare };
