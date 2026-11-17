const { readCI, readSN } = require('./store');
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
// `country` : 'SN' | 'CI' | 'ALL' (ou absent) — le sélecteur de site de
// l'en-tête. Les rapports l'ignoraient et cumulaient toujours les deux
// trackers, donc un rapport « CI » affichait les chiffres de SN.
/* Le fichier d'origine ne fait pas foi à lui seul. Des tickets ivoiriens
   se retrouvent dans sn.json : transférés depuis Abidjan, ou saisis là par
   erreur. Ils portent alors des marques sans ambiguïté — un numéro IMOC en
   « OCI… », un FO de la rota d'Abidjan — et se retrouvaient comptés dans
   les chiffres de Dakar.

   On qualifie donc chaque ticket, sans écraser une valeur explicite :
   `country`/`tracker` posé sur la ligne l'emporte toujours. */
function ciFoNames(cfg) {
  const out = new Set();
  for (const site of (cfg.rota_config && cfg.rota_config.sites) || []) {
    if (String(site.tracker || '').toUpperCase() !== 'CI') continue;
    for (const team of site.teams || [])
      for (const m of team.members || []) out.add(String(m).trim().toLowerCase());
  }
  // Le mapping FO → tracker de la config sert de second recours.
  for (const [name, tr] of Object.entries(cfg.fo_trackers || {}))
    if (String(tr).toUpperCase() === 'CI') out.add(String(name).trim().toLowerCase());
  return out;
}

// Un nom est « de CI » s'il figure dans la rota d'Abidjan. On compare sur
// une forme normalisée : les extractions varient sur les accents et la
// casse, et une comparaison stricte laisserait passer les variantes.
const normName = n => String(n || '').trim().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function ticketCountry(t, ciFo, snFo) {
  const explicit = String(t.country || t.tracker || '').trim().toUpperCase();
  if (explicit === 'SN' || explicit === 'CI') return explicit;

  // Numéro IMOC : « OCI… » désigne le tracker ivoirien, « OSN… » le
  // sénégalais. C'est la marque la plus fiable dont on dispose.
  const imoc = String(t.imoc_tt || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (imoc.startsWith('OCI')) return 'CI';
  if (imoc.startsWith('OSN')) return 'SN';

  // À défaut, le porteur. On ne conclut « CI » que si le nom est dans la
  // rota d'Abidjan ET absent de celle de Dakar : un FO de Dakar qui
  // reprend un ticket transféré reste du périmètre de Dakar.
  const fo = normName(t.fo_owner || t.assigned_to);
  if (fo && ciFo.has(fo) && !snFo.has(fo)) return 'CI';
  return null;   // indéterminé — on garde le fichier d'origine
}

function allEnriched(cfg, country) {
  const wantSN = !country || country === 'ALL' || country === 'SN';
  const wantCI = !country || country === 'ALL' || country === 'CI';

  const ciFo = new Set([...ciFoNames(cfg)].map(normName));
  const snFo = new Set((cfg.fo_list || []).map(normName));
  // Le tracker retenu est celui déduit du ticket, à défaut son fichier.
  const tag = (t, file) => ({
    ...enrichTicket(t, cfg),
    tracker: ticketCountry(t, ciFo, snFo) || file,
  });

  return [
    ...readSN().map(t => tag(t, 'SN')),
    ...readCI().map(t => tag(t, 'CI')),
  ].filter(t => t.tracker === 'SN' ? wantSN : wantCI);
}

// Normalise le paramètre de requête : tout ce qui n'est pas SN ou CI
// vaut « pas de filtre ».
function reqCountry(req) {
  const c = String(req.query.country || '').toUpperCase();
  if (c === 'SN' || c === 'CI') return c;
  // 'ALL' est un choix explicite (les deux trackers) ; l'absence de
  // paramètre laisse chaque route décider de son défaut.
  return c === 'ALL' ? 'ALL' : undefined;
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
