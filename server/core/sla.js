const { ON_HOLD, periodesAttente } = require('./holds');

// ── SLA CALCULATION ───────────────────────────────────────────
//
// work_mode (global) = 'live'  → 24/7 (all hours count)
//                    = 'drill' → only 08:30–17:30 (= 9 h/day)
//
// sla_mode (per-entry) = 'calendar' → all days (incl. weekends)
//                      = 'business' → Mon–Fri only, skip Sat/Sun
//
// Each SLA entry in cfg.sla_hours can be:
//   - a number (legacy):  { "Incident P1": 4 }              → defaults to 'calendar'
//   - an object (new):    { "Incident P1": { hours: 4, mode: "business" } }
//
// Resulting combinations:
//   live + calendar  → straight ms addition (trivial)
//   live + business  → skip weekends (24h/day, Mon–Fri)
//   drill + calendar → 9h/day every day (incl. weekends)
//   drill + business → 9h/day Mon–Fri only - typical "5×9" SLA

const DRILL_START_H = 8.5;   // 08:30
const DRILL_END_H   = 17.5;  // 17:30

// Normalize a sla_hours entry → { hours, mode }
function normSLAEntry(v) {
  if (v && typeof v === 'object') return { hours: Number(v.hours) || 0, mode: v.mode || 'calendar' };
  return { hours: Number(v) || 0, mode: 'calendar' };
}

// Décalage (ms) entre le fuseau `tz` et UTC à un instant donné. Recopié
// ici plutôt qu'importé de time.js, qui dépend déjà de ce module : l'import
// croisé créerait une dépendance circulaire.
// Un formateur par fuseau, réutilisé : en construire un à chaque appel
// coûtait ~3 s sur /api/sn (des milliers de calculs d'échéance).
const _formateurs = new Map();
function formateur(tz) {
  let f = _formateurs.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    _formateurs.set(tz, f);
  }
  return f;
}
// Décalage mémorisé par heure pleine et par fuseau : les échéances de tous
// les tickets parcourent en grande partie les mêmes heures, chacune n'est
// calculée qu'une fois. Borné pour ne pas grossir indéfiniment.
const _decalages = new Map();
function offsetMs(ms, tz) {
  // UTC n'a ni décalage ni changement d'heure : cas de Dakar, le plus courant.
  if (tz === 'UTC' || tz === 'Etc/UTC') return 0;
  const heure = Math.floor(ms / 3600000);
  const cle = `${tz}|${heure}`;
  let off = _decalages.get(cle);
  if (off === undefined) {
    const t = heure * 3600000;
    const p = formateur(tz).formatToParts(new Date(t)).reduce((a, x) => (a[x.type] = x.value, a), {});
    off = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - t;
    if (_decalages.size > 200000) _decalages.clear();
    _decalages.set(cle, off);
  }
  return off;
}

// Les bornes métier (week-end, 08:30–17:30) se lisent dans le fuseau des
// opérations (`tz`, config.timezone), pas dans celui de la VM : avec
// getDay()/getHours(), déplacer le serveur sur une machine réglée sur un
// autre fuseau décalait toutes les échéances en mode ouvré ou drill.
function addSLAMs(startMs, durationMs, workMode, slaMode, tz = 'UTC') {
  // live + calendar: trivial - no iteration needed
  if (workMode === 'live' && slaMode === 'calendar') {
    return startMs + durationMs;
  }

  let remaining = durationMs;
  let cur = startMs;
  // Le décalage ne change qu'aux changements d'heure, toujours sur une
  // heure pleine : on le relit une fois par heure parcourue. Jour et heure
  // se déduisent ensuite par calcul, sans créer d'objet Date à chaque
  // minute (des milliers d'itérations par ticket).
  let off = offsetMs(cur, tz);
  let offValidUntil = cur + 3600000;

  // Walk forward in 1-minute increments, consuming only "working" time
  const TICK = 60000, JOUR = 86400000;
  while (remaining > 0) {
    if (cur >= offValidUntil) {
      off = offsetMs(cur, tz);
      offValidUntil = cur + 3600000;
    }
    const local = cur + off;
    const jour  = Math.floor(local / JOUR);
    const dow   = ((jour + 4) % 7 + 7) % 7;            // 1970-01-01 était un jeudi (4) ; 0=Sun, 6=Sat
    const hh    = (local - jour * JOUR) / 3600000;     // heure décimale locale

    const isWeekend  = (dow === 0 || dow === 6);
    const isWorkHour = (hh >= DRILL_START_H && hh < DRILL_END_H);

    let count = false;
    if      (workMode === 'live'  && slaMode === 'business') count = !isWeekend;
    else if (workMode === 'drill' && slaMode === 'business') count = !isWeekend && isWorkHour;
    else if (workMode === 'drill' && slaMode === 'calendar') count = isWorkHour;

    if (count) remaining -= Math.min(remaining, TICK);
    cur += TICK;
  }
  return cur;
}

// Temps SLA « utile » écoulé entre deux instants, selon les mêmes règles
// que addSLAMs (week-end, plage drill, fuseau). Sert à savoir combien de
// SLA a été consommé avant une mise en attente.
function countSLAMs(fromMs, toMs, workMode, slaMode, tz = 'UTC') {
  if (toMs <= fromMs) return 0;
  if (workMode === 'live' && slaMode === 'calendar') return toMs - fromMs;
  const TICK = 60000, JOUR = 86400000;
  let cur = fromMs, total = 0;
  let off = offsetMs(cur, tz), offValidUntil = cur + 3600000;
  while (cur < toMs) {
    if (cur >= offValidUntil) { off = offsetMs(cur, tz); offValidUntil = cur + 3600000; }
    const local = cur + off;
    const jour  = Math.floor(local / JOUR);
    const dow   = ((jour + 4) % 7 + 7) % 7;
    const hh    = (local - jour * JOUR) / 3600000;
    const weekend = dow === 0 || dow === 6, ouvre = hh >= DRILL_START_H && hh < DRILL_END_H;
    const compte = (workMode === 'live' && slaMode === 'business') ? !weekend
      : (workMode === 'drill' && slaMode === 'business') ? !weekend && ouvre
      : (workMode === 'drill' && slaMode === 'calendar') ? ouvre : true;
    const pas = Math.min(TICK, toMs - cur);
    if (compte) total += pas;
    cur += pas;
  }
  return total;
}

// Échéance d'une jambe de SLA en tenant compte des mises en attente : le
// temps consommé s'arrête au début de chaque période On Hold et reprend à
// sa fin. `finMs` = instant où la jambe est tenue (contournement, clôture),
// au-delà duquel une attente ne compte plus. Renvoie soit une échéance,
// soit — si la jambe est gelée en ce moment — le temps SLA restant figé.
function jambeAvecAttentes(baseMs, dureeMs, workMode, mode, tz, periodes, finMs) {
  let debut = baseMs, reste = dureeMs;
  for (const p of periodes) {
    if (finMs != null && p.from >= finMs) break;          // attente postérieure à la jambe
    const from = Math.max(p.from, debut);
    if (p.to !== null && p.to <= debut) continue;          // attente entièrement avant le départ
    const echeance = addSLAMs(debut, reste, workMode, mode, tz);
    if (echeance <= from) break;                           // échue avant d'être gelée
    reste -= countSLAMs(debut, from, workMode, mode, tz);
    if (p.to === null) return { gele: true, reste };
    debut = Math.max(p.to, debut);
  }
  return { gele: false, echeance: addSLAMs(debut, reste, workMode, mode, tz) };
}

function isDualSLAEntry(raw) {
  return !!(raw && typeof raw === 'object' && (raw.workaround || raw.final));
}

// Instant où le ticket a été soldé. Un ticket Resolved/Closed sans date de
// clôture laissait tourner le chrono jusqu'à « maintenant » : fermé vendredi
// avant l'échéance, il ressortait lundi en rupture (« −3h », Breach). On
// retombe alors sur l'instant de clôture enregistré par le serveur, puis sur
// la dernière modification.
const STATUTS_CLOS = ['Resolved', 'Closed'];
function finTicketMs(ticket) {
  const ms = v => { const n = v ? new Date(v).getTime() : NaN; return Number.isFinite(n) ? n : null; };
  const close = ms(ticket.close_date);
  if (close !== null) return close;
  if (!STATUTS_CLOS.includes(ticket.status)) return null;
  return ms(ticket.closed_by_at) ?? ms(ticket.modified_at) ?? ms(ticket.created_at);
}

function computeSLA(ticket, cfg) {
  const key   = `${ticket.type} ${ticket.priority}`;
  const raw   = cfg.sla_hours?.[key];
  if (!raw || !ticket.occur_time) {
    return { sla_hours: null, time_left_ms: null, sla_status: 'N/A' };
  }

  const workMode = cfg.work_mode || 'live';
  const tz       = (cfg && cfg.timezone) || process.env.REPORT_TZ || 'UTC';
  const base     = ticket.detection_time || ticket.occur_time;
  const baseMs   = new Date(base).getTime();
  const periodes = periodesAttente(ticket);
  // Ticket gelé : statut « On Hold », jamais compté en rupture ni dans les
  // taux de conformité. Le temps restant affiché est celui figé à la mise
  // en attente ; `sla_frozen_status` dit où en était le SLA à ce moment.
  const gele = ticket.status === ON_HOLD;
  const ouverte = periodes.find(p => p.to === null);
  const extraGel = (reste, total) => ({
    sla_status: 'On Hold',
    sla_frozen_status: slaStatusFromRatio(reste, total),
    sla_hold_since: ouverte ? new Date(ouverte.from).toISOString() : null,
  });

  if (isDualSLAEntry(raw)) {
    const legs = {};
    const statuts = [];
    let minLeftMs = null;

    if (raw.workaround) {
      const { hours, mode } = normSLAEntry(raw.workaround);
      if (hours) {
        // Contournement tenu à sa date ; à défaut, au plus tard à la clôture :
        // un ticket clos sans date de contournement n'est pas en retard sur lui.
        const finMs = ticket.workaround_date ? new Date(ticket.workaround_date).getTime() : finTicketMs(ticket);
        const j = jambeAvecAttentes(baseMs, hours * 3600000, workMode, mode, tz, periodes, finMs);
        const timeLeftMs = j.gele ? j.reste : j.echeance - (finMs ?? Date.now());
        legs.sla_workaround = { hours, mode, deadline: j.gele ? null : new Date(j.echeance).toISOString(),
                                time_left_ms: timeLeftMs, ...(j.gele ? { frozen: true } : {}) };
        statuts.push(slaStatusFromRatio(timeLeftMs, hours * 3600000));
        minLeftMs = minLeftMs === null ? timeLeftMs : Math.min(minLeftMs, timeLeftMs);
      }
    }
    if (raw.final) {
      const { hours, mode } = normSLAEntry(raw.final);
      if (hours) {
        const finMs = finTicketMs(ticket);
        const j = jambeAvecAttentes(baseMs, hours * 3600000, workMode, mode, tz, periodes, finMs);
        const timeLeftMs = j.gele ? j.reste : j.echeance - (finMs ?? Date.now());
        legs.sla_final = { hours, mode, deadline: j.gele ? null : new Date(j.echeance).toISOString(),
                           time_left_ms: timeLeftMs, ...(j.gele ? { frozen: true } : {}) };
        statuts.push(slaStatusFromRatio(timeLeftMs, hours * 3600000));
        minLeftMs = minLeftMs === null ? timeLeftMs : Math.min(minLeftMs, timeLeftMs);
      }
    }
    if (minLeftMs === null) return { sla_hours: null, time_left_ms: null, sla_status: 'N/A' };
    // Statut = le plus grave des deux jambes, chacune jugée sur SA propre
    // fenêtre. L'ancien calcul rapportait le temps restant de la jambe la
    // plus serrée aux heures du contournement : 3 h restantes sur une
    // résolution de 72 h donnaient 3/4 = 75 % → « In SLA » au lieu de
    // « Near Breach ».
    const GRAVITE = ['In SLA', 'Near Breach', 'Breach'];
    const pire = statuts.reduce((a, b) => (GRAVITE.indexOf(b) > GRAVITE.indexOf(a) ? b : a), 'In SLA');
    const totalMin = Math.min(...[raw.workaround, raw.final].filter(Boolean)
      .map(e => normSLAEntry(e).hours * 3600000).filter(Boolean));
    return {
      sla_hours:    null,
      sla_mode:     'dual',
      time_left_ms: minLeftMs,
      sla_status:   pire,
      ...(gele ? extraGel(minLeftMs, totalMin) : {}),
      ...legs
    };
  }

  const { hours, mode } = normSLAEntry(raw);
  if (!hours) return { sla_hours: null, time_left_ms: null, sla_status: 'N/A' };

  const finMs = finTicketMs(ticket);
  const j = jambeAvecAttentes(baseMs, hours * 3600000, workMode, mode, tz, periodes, finMs);
  const timeLeftMs = j.gele ? j.reste : j.echeance - (finMs ?? Date.now());
  return {
    sla_hours:    hours,
    sla_mode:     mode,
    deadline:     j.gele ? null : new Date(j.echeance).toISOString(),
    time_left_ms: timeLeftMs,
    sla_status:   slaStatusFromRatio(timeLeftMs, hours * 3600000),
    ...(gele ? extraGel(timeLeftMs, hours * 3600000) : {}),
  };
}

// "Near Breach" = still in SLA but less than 20% of the total SLA window remains
function slaStatusFromRatio(timeLeftMs, totalMs) {
  if (timeLeftMs < 0) return 'Breach';
  if (totalMs > 0 && timeLeftMs / totalMs < 0.2) return 'Near Breach';
  return 'In SLA';
}

function enrichTicket(ticket, cfg) {
  const sla     = computeSLA(ticket, cfg);
  const openDate = new Date(ticket.open_date);
  const fin      = finTicketMs(ticket);
  const endDate  = fin !== null ? new Date(fin) : new Date();
  return { ...ticket, ...sla, duration_ms: endDate - openDate };
}

// Cible SLA en texte (« 4h », « 2d BIZ », « WA 4h · Final 2d ») — même
// écriture que slaTargetText() côté page, pour la colonne « SLA Target »
// du classeur et du mail produits par le serveur.
function slaTargetLabel(ticket, cfg) {
  const raw = ((cfg && cfg.sla_hours) || {})[`${ticket.type} ${ticket.priority}`];
  if (!raw) return '-';
  const jambe = leg => {
    const { hours, mode } = normSLAEntry(leg);
    if (!hours) return null;
    return (hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`) + (mode === 'business' ? ' BIZ' : '');
  };
  if (isDualSLAEntry(raw)) {
    const parts = [];
    const wa = raw.workaround ? jambe(raw.workaround) : null;
    const fin = raw.final ? jambe(raw.final) : null;
    if (wa) parts.push(`WA ${wa}`);
    if (fin) parts.push(`Final ${fin}`);
    return parts.length ? parts.join(' · ') : '-';
  }
  return jambe(raw) || '-';
}

module.exports = {
  DRILL_START_H, DRILL_END_H, enrichTicket, countSLAMs, slaTargetLabel, computeSLA, finTicketMs,
};
