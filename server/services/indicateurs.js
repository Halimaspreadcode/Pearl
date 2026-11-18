// ══════════════════════════════════════════════════════════════
// INDICATEURS (KPI / PI)
//
// L'admin décrit un indicateur en français (« le MTTD, c'est le temps
// entre l'occurrence et la détection ») ou donne sa formule. L'IA traduit
// cette demande en une DÉFINITION : un petit objet déclaratif (filtres,
// mesure, période, sens, vues). L'admin la relit, la corrige, la valide.
//
// Ensuite, plus d'IA : ce module calcule l'indicateur à chaque ouverture
// de la page, à partir des trackers, de façon déterministe. Le même
// tracker donne toujours le même chiffre.
//
// La définition n'est jamais du code : seuls les champs, opérations et
// types de vue listés ici sont acceptés. Ce que l'IA invente d'autre est
// écarté et signalé.
// ══════════════════════════════════════════════════════════════
const crypto = require('crypto');
const { FILES } = require('../config/paths');
const { readJSON, writeJSON, withFileLock, readCfg } = require('../core/store');
const { allEnriched } = require('../core/enrich');
const { workedMs } = require('../core/time');

// ── Ce sur quoi un indicateur peut porter ──
const DATES = {
  occur_time: 'Occurrence', detection_time: 'Détection', open_date: 'Ouverture',
  close_date: 'Clôture', workaround_date: 'Contournement',
};
const CATEGORIES = {
  tracker: 'Tracker (SN / CI)', type: 'Type', priority: 'Priorité', severity: 'Sévérité',
  status: 'Statut', domain: 'Domaine', fo_owner: 'FO', assigned_to: 'Assigné à',
  bo_handling: 'BO', sla_status: 'Statut SLA', rc_category: 'Catégorie de cause', shift: 'Shift',
};
const FONCTIONS = {
  moyenne: 'Moyenne', mediane: 'Médiane', p90: '90e centile', min: 'Minimum', max: 'Maximum',
  somme: 'Somme', nombre: 'Nombre de tickets', taux: 'Taux (% des tickets)',
};
const OPS = ['=', '!=', 'dans', 'hors', 'vide', 'renseigne'];
const PERIODES = { jour: 'Jour', semaine: 'Semaine', mois: 'Mois' };
const UNITES_DUREE = { min: 60000, h: 3600000, j: 86400000 };
const VUES = {
  courbe: 'Par période', series: 'Par période et par groupe', classement: 'Classement',
  evolution: 'Qui progresse / qui se dégrade', tableau: 'Tableau par période',
};
// Types de graphique proposés pour chaque vue (le premier est le défaut).
const GRAPHES = {
  courbe: ['colonnes', 'ligne', 'aire'],
  series: ['lignes', 'colonnes', 'chaleur'],
  classement: ['barres', 'colonnes', 'anneau'],
  evolution: ['tableau', 'barres'],
  tableau: ['tableau', 'chaleur'],
};

// ── Nettoyage d'une définition ──
// Tout passe par ici : ce que l'IA propose comme ce que l'admin enregistre.
const str = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const num = v => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

function nettoyerFiltres(list, avert, ou) {
  const out = [];
  for (const f of Array.isArray(list) ? list.slice(0, 12) : []) {
    if (!f || typeof f !== 'object') continue;
    const champ = str(f.champ, 40);
    if (!CATEGORIES[champ] && !DATES[champ]) { avert.push(`${ou} : champ « ${champ} » inconnu, filtre ignoré.`); continue; }
    const op = OPS.includes(f.op) ? f.op : (Array.isArray(f.valeur) ? 'dans' : '=');
    let valeur = null;
    if (op === 'dans' || op === 'hors') valeur = (Array.isArray(f.valeur) ? f.valeur : String(f.valeur ?? '').split(',')).map(x => str(x, 80)).filter(Boolean).slice(0, 30);
    else if (op === '=' || op === '!=') valeur = str(f.valeur, 80);
    out.push({ champ, op, valeur });
  }
  return out;
}

function nettoyerVue(v, avert) {
  if (v && v.type === 'carte') return null;   // le résumé en tête la remplace
  if (!v || typeof v !== 'object' || !VUES[v.type]) { avert.push(`Vue « ${v && v.type} » inconnue, ignorée.`); return null; }
  const out = { id: str(v.id, 20) || crypto.randomBytes(4).toString('hex'), type: v.type, titre: str(v.titre, 120) || VUES[v.type] };
  const g = GRAPHES[v.type];
  out.graphe = g.includes(v.graphe) ? v.graphe : g[0];
  if (['classement', 'evolution', 'tableau', 'series'].includes(v.type)) {
    out.par = CATEGORIES[v.par] ? v.par : 'fo_owner';
    if (v.par && !CATEGORIES[v.par]) avert.push(`Vue « ${out.titre} » : regroupement « ${v.par} » inconnu, remplacé par FO.`);
  }
  if (v.type === 'classement') out.ordre = v.ordre === 'meilleur' ? 'meilleur' : 'pire';
  if (v.type === 'evolution') out.filtre = ['degrade', 'ameliore', 'tous'].includes(v.filtre) ? v.filtre : 'degrade';
  if (['classement', 'evolution', 'tableau', 'series'].includes(v.type)) out.limite = Math.min(50, Math.max(1, Math.round(num(v.limite) || (v.type === 'series' ? 5 : 10))));
  if (v.type === 'evolution') {
    const s = num(v.seuil_pct); if (s !== null && s > 0) out.seuil_pct = Math.min(1000, s);
  }
  const mt = num(v.min_tickets); out.min_tickets = mt && mt > 0 ? Math.min(1000, Math.round(mt)) : 1;
  return out;
}

function nettoyer(def) {
  const d = def && typeof def === 'object' ? def : {};
  const avert = [];
  const m = d.mesure && typeof d.mesure === 'object' ? d.mesure : {};
  const fn = FONCTIONS[m.fn] ? m.fn : 'moyenne';
  if (m.fn && !FONCTIONS[m.fn]) avert.push(`Fonction « ${m.fn} » inconnue, remplacée par la moyenne.`);
  const mesure = { fn };
  if (!['nombre', 'taux'].includes(fn)) {
    const v = m.valeur && typeof m.valeur === 'object' ? m.valeur : {};
    if (!DATES[v.de] || !DATES[v.a]) {
      avert.push('La mesure doit être une durée entre deux dates des tickets (ex. occurrence → détection).');
      mesure.valeur = { de: DATES[v.de] ? v.de : 'occur_time', a: DATES[v.a] ? v.a : 'detection_time' };
    } else mesure.valeur = { de: v.de, a: v.a };
    mesure.valeur.ouvre = v.ouvre !== false;
  }
  if (fn === 'taux') {
    mesure.condition = nettoyerFiltres(m.condition, avert, 'Condition du taux');
    if (!mesure.condition.length) avert.push('Un taux a besoin d\'une condition (ex. Statut SLA = Breach).');
  }
  const unite = fn === 'taux' ? '%' : fn === 'nombre' ? 'tickets' : (UNITES_DUREE[d.unite] ? d.unite : 'min');
  const out = {
    id: str(d.id, 40) || null,
    nom: str(d.nom, 120) || 'Nouvel indicateur',
    sigle: str(d.sigle, 16),
    genre: d.genre === 'PI' ? 'PI' : 'KPI',
    description: str(d.description, 600),
    formule: str(d.formule, 300),
    filtres: nettoyerFiltres(d.filtres, avert, 'Filtre'),
    mesure,
    date: DATES[d.date] ? d.date : (mesure.valeur ? mesure.valeur.de : 'open_date'),
    periode: PERIODES[d.periode] ? d.periode : 'semaine',
    reference: d.reference === 'en_cours' ? 'en_cours' : 'terminee',
    nb_periodes: Math.min(26, Math.max(2, Math.round(num(d.nb_periodes) || 8))),
    sens: d.sens === 'haut' ? 'haut' : 'bas',
    unite,
    cible: num(d.cible),
    vues: [],
  };
  for (const v of Array.isArray(d.vues) ? d.vues.slice(0, 12) : []) { const x = nettoyerVue(v, avert); if (x) out.vues.push(x); }
  if (!out.vues.length) out.vues.push({ id: 'courbe', type: 'courbe', titre: VUES.courbe, min_tickets: 1 });
  return { def: out, avertissements: avert };
}

// ── Calcul ──
const normal = v => String(v ?? '').trim().toLowerCase();
function passe(t, f) {
  const v = t[f.champ];
  switch (f.op) {
    case 'vide': return v === undefined || v === null || String(v).trim() === '' || v === '-';
    case 'renseigne': return !(v === undefined || v === null || String(v).trim() === '' || v === '-');
    case '=': return normal(v) === normal(f.valeur);
    case '!=': return normal(v) !== normal(f.valeur);
    case 'dans': return (f.valeur || []).some(x => normal(x) === normal(v));
    case 'hors': return !(f.valeur || []).some(x => normal(x) === normal(v));
  }
  return true;
}
const passeTout = (t, fs) => (fs || []).every(f => passe(t, f));

const JOUR = 86400000;
function debutPeriode(ms, periode) {
  const d = new Date(ms);
  if (periode === 'mois') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const j = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (periode === 'jour') return j;
  return j - ((d.getUTCDay() + 6) % 7) * JOUR;   // lundi
}
function suivante(ms, periode) {
  if (periode === 'mois') { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); }
  return ms + (periode === 'jour' ? 1 : 7) * JOUR;
}
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function libelle(ms, periode) {
  const d = new Date(ms);
  if (periode === 'mois') return `${MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return `${periode === 'semaine' ? 'sem. du ' : ''}${d.getUTCDate()} ${MOIS[d.getUTCMonth()]}`;
}

// Liste des périodes affichées : les `n` dernières jusqu'à la référence
// (en cours, ou dernière terminée).
function periodes(def, maintenant) {
  let cur = debutPeriode(maintenant, def.periode);
  if (def.reference === 'terminee') cur = debutPeriode(cur - 1, def.periode);
  const out = [];
  for (let i = 0; i < def.nb_periodes; i++) {
    out.unshift({ debut: cur, fin: suivante(cur, def.periode), libelle: libelle(cur, def.periode) });
    cur = debutPeriode(cur - 1, def.periode);
  }
  out[out.length - 1].en_cours = def.reference === 'en_cours';
  return out;
}

function agreger(def, tickets, cfg) {
  const m = def.mesure;
  if (m.fn === 'nombre') return { valeur: tickets.length, n: tickets.length };
  if (m.fn === 'taux') {
    if (!tickets.length) return { valeur: null, n: 0 };
    const k = tickets.filter(t => passeTout(t, m.condition)).length;
    return { valeur: Math.round(k / tickets.length * 1000) / 10, n: tickets.length, k };
  }
  const div = UNITES_DUREE[def.unite] || 60000;
  const vals = [];
  for (const t of tickets) {
    const a = t[m.valeur.de], b = t[m.valeur.a];
    if (!a || !b) continue;
    const ms = m.valeur.ouvre ? workedMs(a, b, cfg) : (new Date(b) - new Date(a));
    if (ms === null || !Number.isFinite(ms) || ms < 0) continue;
    vals.push(ms / div);
  }
  if (!vals.length) return { valeur: null, n: 0 };
  vals.sort((x, y) => x - y);
  let v;
  switch (m.fn) {
    case 'somme': v = vals.reduce((s, x) => s + x, 0); break;
    case 'min': v = vals[0]; break;
    case 'max': v = vals[vals.length - 1]; break;
    case 'mediane': { const k = vals.length >> 1; v = vals.length % 2 ? vals[k] : (vals[k - 1] + vals[k]) / 2; break; }
    case 'p90': v = vals[Math.min(vals.length - 1, Math.ceil(vals.length * 0.9) - 1)]; break;
    default: v = vals.reduce((s, x) => s + x, 0) / vals.length;
  }
  return { valeur: Math.round(v * 10) / 10, n: vals.length };
}

// Écart entre deux valeurs et lecture selon le sens de l'indicateur.
function ecart(def, cur, prev) {
  if (cur === null || prev === null || cur === undefined || prev === undefined) return { delta: null, delta_pct: null, tendance: null };
  const delta = Math.round((cur - prev) * 10) / 10;
  const delta_pct = prev !== 0 ? Math.round((cur - prev) / Math.abs(prev) * 1000) / 10 : null;
  const tendance = delta === 0 ? 'stable' : (delta > 0) === (def.sens === 'haut') ? 'mieux' : 'pire';
  return { delta, delta_pct, tendance };
}
const surCible = (def, v) => def.cible === null || v === null ? null : def.sens === 'haut' ? v >= def.cible : v <= def.cible;

function calculer(defBrute, opts = {}) {
  const { def } = nettoyer(defBrute);
  const cfg = opts.cfg || readCfg();
  const tickets = (opts.tickets || allEnriched(cfg, opts.country)).filter(t => passeTout(t, def.filtres));
  const pers = periodes(def, opts.maintenant || Date.now());
  const debut = pers[0].debut, fin = pers[pers.length - 1].fin;
  // Ticket → période, par la date choisie.
  const dans = pers.map(() => []);
  for (const t of tickets) {
    const ms = Date.parse(t[def.date]);
    if (!Number.isFinite(ms) || ms < debut || ms >= fin) continue;
    const i = pers.findIndex(p => ms >= p.debut && ms < p.fin);
    if (i >= 0) dans[i].push(t);
  }
  const serie = pers.map((p, i) => ({ libelle: p.libelle, debut: new Date(p.debut).toISOString(), en_cours: !!p.en_cours, ...agreger(def, dans[i], cfg) }));
  const n = serie.length, cur = serie[n - 1], prev = serie[n - 2];
  const resume = { valeur: cur.valeur, n: cur.n, periode: cur.libelle, precedente: prev.valeur, ...ecart(def, cur.valeur, prev.valeur), sur_cible: surCible(def, cur.valeur) };

  const groupes = (par, liste) => {
    const g = new Map();
    for (const t of liste) { const k = String(t[par] ?? '').trim() || '(vide)'; if (!g.has(k)) g.set(k, []); g.get(k).push(t); }
    return g;
  };
  const pire = (a, b) => def.sens === 'haut' ? a - b : b - a;   // pire en premier
  const vues = def.vues.map(v => {
    const base = { ...v };
    if (v.type === 'carte' || v.type === 'courbe') return base;
    const gc = groupes(v.par, dans[n - 1]), gp = groupes(v.par, dans[n - 2]);
    if (v.type === 'classement') {
      const lignes = [...gc].map(([k, l]) => ({ nom: k, ...agreger(def, l, cfg) })).filter(x => x.valeur !== null && x.n >= v.min_tickets)
        .map(x => ({ ...x, sur_cible: surCible(def, x.valeur) }));
      lignes.sort((a, b) => v.ordre === 'meilleur' ? -pire(a.valeur, b.valeur) : pire(a.valeur, b.valeur));
      return { ...base, lignes: lignes.slice(0, v.limite), total: lignes.length };
    }
    if (v.type === 'evolution') {
      const noms = new Set([...gc.keys(), ...gp.keys()]);
      let lignes = [...noms].map(k => {
        const a = agreger(def, gc.get(k) || [], cfg), b = agreger(def, gp.get(k) || [], cfg);
        return { nom: k, valeur: a.valeur, n: a.n, precedente: b.valeur, n_prec: b.n, ...ecart(def, a.valeur, b.valeur) };
      }).filter(x => x.delta !== null && x.n >= v.min_tickets && x.n_prec >= v.min_tickets);
      if (v.filtre === 'degrade') lignes = lignes.filter(x => x.tendance === 'pire');
      if (v.filtre === 'ameliore') lignes = lignes.filter(x => x.tendance === 'mieux');
      if (v.seuil_pct) lignes = lignes.filter(x => x.delta_pct === null || Math.abs(x.delta_pct) >= v.seuil_pct);
      const force = x => x.delta_pct !== null ? Math.abs(x.delta_pct) : Math.abs(x.delta) * 1e6;
      lignes.sort((a, b) => force(b) - force(a));
      return { ...base, lignes: lignes.slice(0, v.limite), total: lignes.length };
    }
    if (v.type === 'tableau' || v.type === 'series') {
      const tous = new Map();
      dans.forEach((l, i) => { for (const [k, sous] of groupes(v.par, l)) { if (!tous.has(k)) tous.set(k, Array(n).fill(null)); tous.get(k)[i] = agreger(def, sous, cfg); } });
      const lignes = [...tous].map(([k, cells]) => ({ nom: k, cellules: cells.map(c => c ? { valeur: c.valeur, n: c.n } : { valeur: null, n: 0 }) }))
        .filter(l => l.cellules[n - 1].n >= v.min_tickets || l.cellules.some(c => c.n >= v.min_tickets));
      const volume = l => l.cellules.reduce((s, c) => s + c.n, 0);
      lignes.sort((a, b) => v.type === 'series' ? volume(b) - volume(a) || a.nom.localeCompare(b.nom)
        : (b.cellules[n - 1].n - a.cellules[n - 1].n) || a.nom.localeCompare(b.nom));
      return { ...base, colonnes: serie.map(s => s.libelle), lignes: lignes.slice(0, v.limite), total: lignes.length };
    }
    return base;
  });
  return { def, resume, serie, vues, calcule_le: new Date().toISOString() };
}

// ── Stockage ──
function lire() { const b = readJSON(FILES.indicateurs, null); return Array.isArray(b && b.items) ? b.items : []; }
async function enregistrer(defBrute, auteur) {
  const { def, avertissements } = nettoyer(defBrute);
  return withFileLock(FILES.indicateurs, () => {
    const items = lire();
    const now = new Date().toISOString();
    const i = def.id ? items.findIndex(x => x.id === def.id) : -1;
    if (i >= 0) items[i] = { ...def, cree_le: items[i].cree_le, cree_par: items[i].cree_par, maj_le: now, maj_par: auteur || 'admin', ordre: items[i].ordre };
    else { def.id = crypto.randomBytes(6).toString('hex'); items.push({ ...def, cree_le: now, cree_par: auteur || 'admin', maj_le: now }); }
    writeJSON(FILES.indicateurs, { items });
    return { item: items[i >= 0 ? i : items.length - 1], avertissements };
  });
}
async function supprimer(id) {
  return withFileLock(FILES.indicateurs, () => {
    const items = lire(); const k = items.filter(x => x.id !== id);
    if (k.length === items.length) return false;
    writeJSON(FILES.indicateurs, { items: k }); return true;
  });
}

// ── Modèles prêts à l'emploi (sans IA) ──
const MODELES = [
  { nom: 'Temps moyen de détection', sigle: 'MTTD', genre: 'KPI', description: 'Temps entre l\'occurrence de l\'incident et sa détection par le FO.',
    formule: 'moyenne(détection − occurrence)', mesure: { fn: 'moyenne', valeur: { de: 'occur_time', a: 'detection_time' } }, date: 'occur_time', unite: 'min', sens: 'bas',
    vues: [{ type: 'courbe' }, { type: 'evolution', par: 'fo_owner', filtre: 'degrade', titre: 'FO qui se dégradent' }] },
  { nom: 'Temps moyen de résolution', sigle: 'MTTR', genre: 'KPI', description: 'Temps entre l\'ouverture et la clôture du ticket.',
    formule: 'moyenne(clôture − ouverture)', mesure: { fn: 'moyenne', valeur: { de: 'open_date', a: 'close_date' } }, date: 'close_date', unite: 'h', sens: 'bas',
    vues: [{ type: 'courbe' }, { type: 'classement', par: 'bo_handling', ordre: 'pire', titre: 'BO les plus lents' }] },
  { nom: 'Taux de respect du SLA', sigle: 'SLA', genre: 'KPI', description: 'Part des tickets ouverts dans la période qui restent dans le SLA.',
    formule: 'tickets dans le SLA ÷ tickets notés', filtres: [{ champ: 'sla_status', op: 'hors', valeur: ['N/A', 'On Hold'] }],
    mesure: { fn: 'taux', condition: [{ champ: 'sla_status', op: 'dans', valeur: ['In SLA', 'Near Breach'] }] }, date: 'open_date', sens: 'haut', cible: 95,
    vues: [{ type: 'courbe' }, { type: 'classement', par: 'domain', ordre: 'pire', titre: 'Domaines les moins conformes' }] },
  { nom: 'Volume de tickets P1', sigle: 'P1', genre: 'PI', description: 'Nombre d\'incidents P1 ouverts par période.',
    filtres: [{ champ: 'priority', op: '=', valeur: 'P1' }], mesure: { fn: 'nombre' }, date: 'open_date', sens: 'bas',
    vues: [{ type: 'courbe' }, { type: 'tableau', par: 'domain' }] },
];

// ── Traduction par l'IA ──
function consigne() {
  const liste = o => Object.entries(o).map(([k, v]) => `${k} (${v})`).join(', ');
  return `Tu configures des indicateurs (KPI ou PI) pour une équipe d'exploitation télécom (Front Office FO / Back Office BO) qui suit des tickets d'incident.
Tu réponds UNIQUEMENT par un objet JSON, sans texte autour, de la forme :
{"reponse":"une ou deux phrases en français qui expliquent ce que tu as configuré ou ce qui manque","definition":{...}}

Schéma de "definition" :
- nom, sigle (court, ex. MTTD), genre ("KPI" ou "PI"), description (phrase simple), formule (texte lisible, ex. "moyenne(détection − occurrence)")
- filtres : liste de {"champ","op","valeur"} qui restreignent les tickets comptés. op ∈ ${OPS.join(', ')} ("dans"/"hors" prennent une liste ; "vide"/"renseigne" sans valeur).
- mesure : {"fn", "valeur", "condition"}
   fn ∈ ${Object.keys(FONCTIONS).join(', ')}
   valeur (pour moyenne, mediane, p90, min, max, somme) : durée {"de":<date>,"a":<date>,"ouvre":true} ; ouvre=true compte les heures ouvrées selon la config.
   condition (pour taux) : liste de filtres ; le taux = % des tickets qui la remplissent.
- date : la date qui place un ticket dans une période (souvent la date de début de la durée mesurée).
- periode : jour, semaine ou mois. reference : "terminee" (dernière période complète, par défaut) ou "en_cours". nb_periodes : 2 à 26.
- sens : "bas" si plus bas = mieux (durées, nombre d'incidents), "haut" si plus haut = mieux (taux de conformité).
- unite : min, h ou j pour une durée (ignorée pour taux et nombre). cible : nombre ou null.
- vues : liste parmi
   {"type":"courbe","graphe":"colonnes"|"ligne"|"aire"} évolution globale sur les périodes
   {"type":"series","par":<catégorie>,"graphe":"lignes"|"colonnes"|"chaleur","limite":5} une courbe par groupe (ex. par FO) sur les périodes
   {"type":"classement","par":<catégorie>,"ordre":"pire"|"meilleur","limite":10,"graphe":"barres"|"colonnes"|"anneau"} (anneau : surtout pour un nombre de tickets)
   {"type":"evolution","par":<catégorie>,"filtre":"degrade"|"ameliore"|"tous","limite":10,"seuil_pct":null,"min_tickets":1} : compare la période à la précédente pour chaque groupe, avec l'écart en valeur et en %
   {"type":"tableau","par":<catégorie>,"graphe":"tableau"|"chaleur"} groupes × périodes ; "evolution" accepte aussi "graphe":"tableau"|"barres"
   chaque vue peut avoir un "titre" en français.

Dates disponibles : ${liste(DATES)}.
Catégories disponibles : ${liste(CATEGORIES)}.
Valeurs usuelles : priority P1..P4 ; severity Critical, Major, Minor, Warning ; status Open, In Progress, On Hold, Resolved, Closed ; sla_status In SLA, Near Breach, Breach, On Hold, N/A ; type Incident, Problem Bug ; tracker SN, CI.

Règles :
- N'utilise que ces champs. Si la demande demande une donnée qui n'existe pas, dis-le dans "reponse" et propose l'approche la plus proche.
- Si on te donne une définition existante, renvoie la définition COMPLÈTE modifiée : garde tout ce qui n'est pas concerné par la demande, ajoute les vues demandées sans retirer les autres.
- "le FO qui a dégradé, de combien de pourcent" = vue evolution par fo_owner, filtre degrade.
- MTTD = moyenne(detection_time − occur_time) ; MTTR = moyenne(close_date − open_date) en général.`;
}

function extraireJson(texte) {
  const s = String(texte || '').replace(/```(?:json)?/gi, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

async function traduire({ demande, def, historique }, progres = () => {}) {
  const ai = require('./ai');
  const q = str(demande, 2000);
  if (!q) { const e = new Error('Décris l\'indicateur ou la vue voulue.'); e.status = 400; throw e; }
  const msgs = [];
  for (const h of (Array.isArray(historique) ? historique : []).slice(-6)) {
    if (h && (h.role === 'user' || h.role === 'assistant') && h.content) msgs.push({ role: h.role, content: str(h.content, 1500) });
  }
  const actuelle = def ? nettoyer(def).def : null;
  msgs.push({ role: 'user', content: (actuelle ? `Définition actuelle :\n${JSON.stringify({ ...actuelle, id: undefined })}\n\n` : '') + `Demande : ${q}` });
  progres('Pear AI traduit ta demande en indicateur…', ['Choix des champs des trackers…', 'Choix de la mesure et de la période…', 'Préparation des vues…']);
  let r = await ai.chat(msgs, { system: consigne(), temperature: 0.1, fond: true });
  let j = extraireJson(r.content);
  if (!j || !j.definition) {
    progres('Réponse illisible, nouvel essai…');
    r = await ai.chat([...msgs, { role: 'assistant', content: String(r.content).slice(0, 2000) }, { role: 'user', content: 'Réponds uniquement par l\'objet JSON demandé, sans aucun texte autour.' }], { system: consigne(), temperature: 0, fond: true });
    j = extraireJson(r.content);
  }
  if (!j || !j.definition) { const e = new Error('Pear AI n\'a pas rendu de définition exploitable. Reformule ou pars d\'un modèle.'); e.status = 502; throw e; }
  const { def: propre, avertissements } = nettoyer({ ...j.definition, id: actuelle ? actuelle.id : null });
  if (actuelle) { // l'IA ne doit pas perdre les vues existantes
    for (const v of actuelle.vues) if (!propre.vues.some(x => x.id === v.id || (x.type === v.type && x.par === v.par && x.filtre === v.filtre))) propre.vues.unshift(v);
  }
  progres('Calcul sur les trackers…');
  return { reponse: str(j.reponse, 800), definition: propre, avertissements, ms: r.ms };
}

const catalogue = () => ({ graphes: GRAPHES, dates: DATES, categories: CATEGORIES, fonctions: FONCTIONS, ops: OPS, periodes: PERIODES, unites: Object.keys(UNITES_DUREE), vues: VUES, modeles: MODELES });

module.exports = { nettoyer, calculer, lire, enregistrer, supprimer, traduire, catalogue, extraireJson, periodes, MODELES };
