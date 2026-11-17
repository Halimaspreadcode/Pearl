const { readTracker, siteCodes, normSite } = require('./store');
const { enrichTicket } = require('./sla');
const { workedMs } = require('./time');

// ── HELPERS ──────────────────────────────────────────────────
/* Un ticket est « encours » tant qu'il n'est pas soldé. « On Hold » en
   fait partie : c'est une attente (pièce, tiers, fenêtre de maintenance),
   pas une clôture. Le traiter comme terminé faisait disparaître du
   rapport 4 des 5 ruptures SLA encore ouvertes — précisément les tickets
   bloqués, ceux qu'une revue doit voir.

   Les deux listes sont explicites plutôt que déduites l'une de l'autre :
   un statut ajouté en configuration doit être classé sciemment, pas
   basculer d'un côté par défaut. */
const CLOSED_STATUSES = ['Resolved', 'Closed'];
const OPEN_STATUSES   = ['Open', 'In Progress', 'On Hold'];
const isClosed = t => CLOSED_STATUSES.includes(t && t.status);
const isOpen   = t => OPEN_STATUSES.includes(t && t.status);

function avgMs(tickets, fn) {
  const vals = tickets.map(fn).filter(v => v !== null && !isNaN(v) && v >= 0);
  return vals.length ? vals.reduce((a,b) => a+b, 0) / vals.length : null;
}
// `country` : code d'un site (« SN », « LYON »…), 'ALL' ou absent — le
// sélecteur de site de l'en-tête. Le nom `country` est historique : un
// site peut être un pays, une ville, une agence, un plateau.
/* Le fichier d'origine ne fait pas foi à lui seul : un ticket transféré
   d'un site à l'autre, ou saisi dans le mauvais tracker, porte des marques
   sans ambiguïté. On qualifie donc chaque ticket, sans écraser une valeur
   explicite (`country`/`tracker` posé sur la ligne l'emporte toujours) :
     1. la référence externe commence par un préfixe déclaré pour un site
        (site.ref_prefixes, ex. ["OCI"]) ;
     2. le porteur n'appartient qu'à un seul site (rotations par site,
        puis rattachement fo_trackers). */
const normName = n => String(n || '').trim().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// nom normalisé → ensemble des codes de site où la personne travaille.
function personSites(cfg) {
  const out = new Map();
  const add = (name, code) => {
    const n = normName(name), c = String(code || '').toUpperCase();
    if (!n || !c) return;
    (out.get(n) || out.set(n, new Set()).get(n)).add(c);
  };
  for (const site of (cfg.rota_config && cfg.rota_config.sites) || [])
    for (const team of site.teams || [])
      for (const m of team.members || []) add(m, site.tracker);
  for (const [name, tr] of Object.entries(cfg.fo_trackers || {})) add(name, tr);
  return out;
}

function ticketSite(t, sites, people) {
  const codes = sites.map(s => s.code);
  const explicit = String(t.country || t.tracker || '').trim().toUpperCase();
  if (codes.includes(explicit)) return explicit;

  const ref = String(t.imoc_tt || t.external_ref || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (ref) for (const s of sites)
    for (const p of s.ref_prefixes || [])
      if (p && ref.startsWith(String(p).toUpperCase())) return s.code;

  const fo = normName(t.fo_owner || t.assigned_to);
  const set = fo && people.get(fo);
  if (set && set.size === 1) { const c = [...set][0]; if (codes.includes(c)) return c; }
  return null;   // indéterminé — on garde le fichier d'origine
}

function allEnriched(cfg, country) {
  const raw = Array.isArray(cfg.sites) ? cfg.sites : [];
  const sites = raw.map(r => ({ ...normSite(r), ref_prefixes: (r && r.ref_prefixes) || [] }))
    .filter(s => /^[A-Z0-9]{2,8}$/.test(s.code));
  const want = c => !country || country === 'ALL' || country === c;
  const people = personSites(cfg);
  return sites.flatMap(s => readTracker(s.code).map(t => ({
    ...enrichTicket(t, cfg),
    tracker: ticketSite(t, sites, people) || s.code,
  }))).filter(t => want(t.tracker));
}

// Normalise le paramètre de requête : un code de site connu, 'ALL', ou
// undefined (chaque route choisit alors son défaut).
function reqCountry(req) {
  const c = String(req.query.country || '').toUpperCase();
  if (c === 'ALL') return 'ALL';
  return siteCodes().includes(c) ? c : undefined;
}

// Is `iso` inside [from, to]? Tolerates missing/unparseable dates.
function inRange(iso, from, to) {
  if (!iso) return false;
  const ms = new Date(iso).getTime();
  return !isNaN(ms) && ms >= from.getTime() && ms <= to.getTime();
}

// KPIs for one reporting period.
//
// These describe the period the report covers, NOT the whole database. Quoting
// all-time SLA on a "Daily Report" made every day - and every empty month -
// read 79%, which is what this replaces. Routes that also need the live
// picture expose it separately as overall_* fields.
//
// `opened` = tickets opened during the period; `closed` = tickets resolved or
// closed during it. SLA compliance is measured over the opened set, since those
// are the tickets whose SLA this period is accountable for.
function periodKpis(opened, closed, cfg) {
  // « On Hold » sort du calcul comme « N/A » : un ticket gelé n'est ni
  // conforme ni en rupture tant que son SLA est arrêté.
  const rated = opened.filter(t => !['N/A', 'On Hold'].includes(t.sla_status));
  const inSLA = rated.filter(t => ['In SLA','Near Breach'].includes(t.sla_status)).length;

  return {
    total:  opened.length,
    open:   opened.filter(t => ['Open','In Progress'].includes(t.status)).length,
    breach: opened.filter(t => t.sla_status === 'Breach').length,
    // null (→ "N/A" in the UI) when nothing in the period carried an SLA,
    // rather than a misleading 0% or a stale all-time percentage.
    sla_compliance: rated.length ? Math.round(inSLA / rated.length * 100) : null,
    // Detection and resolution time, counted in worked hours: in drill mode
    // only 08:30-17:30 accrues, so overnight gaps no longer inflate the mean.
    mttd_ms: avgMs(opened.filter(t => t.occur_time && t.detection_time),
                   t => workedMs(t.occur_time, t.detection_time, cfg)),
    mttr_ms: avgMs(closed.filter(t => t.open_date && t.close_date),
                   t => workedMs(t.open_date, t.close_date, cfg)),
  };
}

module.exports = {
  isOpen, allEnriched, reqCountry, inRange, periodKpis,
};
