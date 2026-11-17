// ── DATA QUALITY ──────────────────────────────────────────────
function _renderDQPage() {
  // La session est revalidée côté serveur : si elle tient toujours, on
  // n'exige pas de ressaisir le mot de passe à chaque navigation.
  adminGate('dq', () => { dqUnlocked = true; renderDataQuality(); });
}

// ── DATA QUALITY RULES CATALOGUE ─────────────────────────────
// Each rule: { id, severity, category, title, description, fix }
const DQ_RULES = {
  'E01': { severity:'error',   category:'Lifecycle', title:'Closed ticket without close date',
    description:'A ticket with status Closed or Resolved must always have a close date. Without it, duration, SLA calculations and reports are wrong.',
    fix:'Open the ticket and fill in the close date/time.' },
  'E02': { severity:'error',   category:'Lifecycle', title:'Close date on an open ticket',
    description:'A close date is set while the ticket is still in an active status (Open, In Progress…). This suggests a data entry error or a status that was never updated.',
    fix:'Check whether the ticket is really closed and update its status, or remove the incorrect close date.' },
  'E03': { severity:'error',   category:'Dates', title:'Close date before the open date',
    description:'The close date is chronologically before the open date. This is physically impossible and indicates a data entry error.',
    fix:'Correct one of the two dates. Check whether a timezone caused the shift.' },
  'E04': { severity:'error',   category:'Mandatory', title:'Missing title',
    description:'The ticket has no title. This is a mandatory field — without a title the ticket cannot be identified in lists and reports.',
    fix:'Enter a descriptive title for the incident.' },
  'E05': { severity:'error',   category:'Mandatory', title:'Missing open date',
    description:'No open date is recorded. This field is fundamental for SLA calculations, ticket age and time-based statistics.',
    fix:'Enter the exact date and time the ticket was opened.' },
  'E06': { severity:'error',   category:'Duplicates', title:'Duplicate TT# (same site)',
    description:'Two or more tickets share the same SN TT number on the same tracker (SN or CI). Each TT# must be unique per site, otherwise the data is ambiguous.',
    fix:'Identify the duplicate ticket, merge the relevant information and delete or archive the duplicate.' },
  'E07': { severity:'error',   category:'Lifecycle', title:'Status inconsistent with resolution',
    description:'The ticket has a workaround_date or resolve_date set but its status is still "Open". The status must reflect actual progress.',
    fix:'Update the status to "In Progress" or "Resolved" depending on the real state.' },
  'E08': { severity:'error',   category:'Dates', title:'Occurrence date after the open date',
    description:'The incident occurrence time is later than the ticket open date. An incident cannot happen after it was reported.',
    fix:'Check both dates and correct the wrong one. Often a timezone issue.' },
  'E09': { severity:'error',   category:'SLA', title:'SLA cannot be computed',
    description:'The SLA needs the ticket Type, its Occurrence time and an SLA rule for "Type + Priority" in the configuration. When one is missing the ticket shows SLA "N/A" and silently drops out of every SLA compliance figure — a report can then read "n/a" or look better than reality.',
    fix:'Open the ticket and fill in the Type and Occurrence time. If both are set, add the missing "Type Priority" rule in Configuration › SLA.' },
  'W01': { severity:'warning', category:'Mandatory', title:'Missing SN TT#',
    description:'No SN ticket number is linked. This number ties the ticket to the TT system and is essential for operator follow-up and SN reports.',
    fix:'Enter the TT# as soon as it is created in the SN system.' },
  'W02': { severity:'warning', category:'Mandatory', title:'Missing FO Owner',
    description:'No Front Office owner is assigned to the ticket. Without an owner, responsibility is unclear and follow-ups cannot be targeted.',
    fix:'Assign the FO responsible for following up this ticket.' },
  'W03': { severity:'warning', category:'Mandatory', title:'Missing domain',
    description:'The technical domain (Transmission, IP, Access…) is not set. This field drives filters, per-domain KPIs and reports.',
    fix:'Select the technical domain matching the incident.' },
  'W04': { severity:'warning', category:'Mandatory', title:'Priority not set',
    description:'No priority (P1/P2/P3/P4) is assigned. Priority determines the applicable SLA and the handling order. A ticket without priority escapes every escalation rule.',
    fix:'Assign a priority based on service impact and the service contract.' },
  'W05': { severity:'warning', category:'Quality', title:'Closed ticket without root cause',
    description:'The ticket is closed (Closed/Resolved) but the "Root Cause" field is empty. The root cause is essential for lessons learned, prevention and quality reports.',
    fix:'Fill in the root cause before finally closing the ticket.' },
  'W07': { severity:'warning', category:'SLA', title:'P1 open for more than 72h',
    description:'A P1 ticket is still open (Open or In Progress) after 72 hours. P1s require urgent resolution. A P1 older than 3 days suggests insufficient follow-up or a lack of escalation.',
    fix:'Escalate immediately if not already done. Update the status and document the actions in progress.' },
  'W08': { severity:'warning', category:'SLA', title:'P2 open for more than 5 days',
    description:'A P2 ticket has been active for more than 5 days without resolution. The P2 SLA requires fast resolution — beyond 5 days the breach risk is high.',
    fix:'Push the handling forward, escalate if needed, and document progress.' },
  'W09': { severity:'warning', category:'Duplicates', title:'Duplicate IMOC TT#',
    description:'Several tickets share the same IMOC TT number. One IMOC incident can affect several sites, but this must be justified — otherwise it is probably a data entry error.',
    fix:'Check whether these tickets really are the same multi-site incident. Otherwise fix the wrong IMOC TT#.' },

  'W11': { severity:'warning', category:'Lifecycle', title:'"In Progress" ticket with no recent activity',
    description:'The ticket is in "In Progress" status but has not been modified for more than 7 days. An in-progress ticket without activity can indicate an unreported blocker or an oversight.',
    fix:'Update the ticket with the current state of the actions. If resolved, change the status.' },
  'E09': { severity:'error',   category:'Lifecycle', title:'"Open" ticket not picked up (+30 min)',
    description:'A ticket has been in "Open" status for more than 30 minutes. This means no FO has taken the incident yet. Every ticket must move to "In Progress" within 30 minutes of opening to guarantee fast handling and SLA compliance.',
    fix:'Assign the ticket to an FO and move the status to "In Progress" immediately.' },
  'W12': { severity:'warning', category:'Quality', title:'SN ticket without a linked IMOC TT#',
    description:'For escalated incidents an IMOC TT# must be linked. An SN ticket without an IMOC reference can indicate that the escalation was never documented.',
    fix:'Enter the IMOC TT# if an escalation took place, or leave it empty only if the incident was handled locally.' },
};

function _runDataQualityChecks() {
  const allTickets = [
    ...state.sn.map(t => ({ ...t, _tracker: 'SN' })),
    ...state.ci.map(t => ({ ...t, _tracker: 'CI' })),
  ];
  const issues = [];
  const { locale, tz } = getLangConfig();
  const fmtD = v => v ? new Date(v).toLocaleDateString(locale, { timeZone: tz, day:'2-digit', month:'short', year:'numeric' }) : null;

  function flag(t, ruleId, detail) {
    const rule = DQ_RULES[ruleId];
    issues.push({ ticket: t, severity: rule.severity, ruleId, rule, detail });
  }

  allTickets.forEach(t => {
    const isClosed   = t.status === 'Closed';
    const isResolved = t.status === 'Resolved';
    const isDone     = isClosed || isResolved;
    const isActive   = ['Open','In Progress'].includes(t.status);

    // E01 — Closed/Resolved without close_date
    if (isDone && !t.close_date)
      flag(t, 'E01', `Current status: "${t.status}" — close date: not set`);

    // E02 — close_date on open ticket
    if (!isDone && t.close_date)
      flag(t, 'E02', `Close date: ${fmtD(t.close_date)} — Current status: "${t.status}"`);

    // E03 — close before open
    if (t.close_date && t.open_date && new Date(t.close_date) < new Date(t.open_date))
      flag(t, 'E03', `Opened: ${fmtD(t.open_date)} → Closed: ${fmtD(t.close_date)} (${Math.round((new Date(t.open_date)-new Date(t.close_date))/3600000)}h gap)`);

    // E04 — Missing title
    if (!t.title || !t.title.trim())
      flag(t, 'E04', `ID ticket : ${t.id}`);

    // E05 — Missing open_date
    if (!t.open_date)
      flag(t, 'E05', `Ticket "${t.title||t.id}" — open_date field missing from the database`);

    // E07 — workaround_date or resolve_date but still Open
    if ((t.workaround_date || t.resolve_date) && t.status === 'Open')
      flag(t, 'E07', `Resolution/workaround date set (${fmtD(t.workaround_date||t.resolve_date)}) but status = "Open"`);

    // E08 — occur_time after open_date
    if (t.occur_time && t.open_date && new Date(t.occur_time) > new Date(t.open_date))
      flag(t, 'E08', `Occurrence : ${fmtD(t.occur_time)} — Ouverture ticket : ${fmtD(t.open_date)}`);

    // E09 — SLA non calculable : sans Type, sans heure d'occurrence ou sans
    // règle pour « Type Priorité », le ticket passe en N/A et sort de tous
    // les taux de conformité sans que rien ne le signale ailleurs.
    {
      const regles = (state.config || {}).sla_hours || {};
      const cle = `${t.type || ''} ${t.priority || ''}`.trim();
      const raison = !t.type ? 'Type missing'
        : !t.occur_time ? 'Occurrence time missing'
        : (t.priority && !regles[cle]) ? `No SLA rule configured for "${cle}"` : '';
      if (raison) flag(t, 'E09', `Ticket "${t.title || t.id}" — ${raison}`);
    }

    // W01 — Missing TT#
    if (!t.sn_tt || !t.sn_tt.trim())
      flag(t, 'W01', `Ticket: "${t.title||t.id}" — SN TT# field empty`);

    // W02 — Missing FO owner
    if (!t.fo_owner || !t.fo_owner.trim())
      flag(t, 'W02', `Ticket: "${t.title||t.id}" — FO Owner field unassigned`);

    // W03 — Missing domain
    if (!t.domain || !t.domain.trim())
      flag(t, 'W03', `Ticket: "${t.title||t.id}" — Domain field empty`);

    // W04 — Missing priority
    if (!t.priority || !t.priority.trim())
      flag(t, 'W04', `Ticket: "${t.title||t.id}" — no priority set`);

    // W05 — Closed without root cause
    if (isDone && (!t.root_cause || !t.root_cause.trim()))
      flag(t, 'W05', `Status: "${t.status}" — Root Cause field empty`);


    // W07 — P1 open >72h
    if (t.priority === 'P1' && isActive && t.open_date) {
      const ageH = (Date.now() - new Date(t.open_date).getTime()) / 3600000;
      if (ageH > 72)
        flag(t, 'W07', `Open for ${Math.round(ageH)}h (since ${fmtD(t.open_date)})`);
    }

    // W08 — P2 open >5 days
    if (t.priority === 'P2' && isActive && t.open_date) {
      const ageH = (Date.now() - new Date(t.open_date).getTime()) / 3600000;
      if (ageH > 120)
        flag(t, 'W08', `Open for ${Math.round(ageH/24)} days (since ${fmtD(t.open_date)})`);
    }


    // W11 — In Progress with no recent update
    if (t.status === 'In Progress' && t.updated_at) {
      const idleD = (Date.now() - new Date(t.updated_at).getTime()) / 86400000;
      if (idleD > 7)
        flag(t, 'W11', `Last modified: ${fmtD(t.updated_at)} (${Math.round(idleD)} days ago)`);
    }

    // W12 — SN ticket without IMOC TT# (P1/P2 escalated only)
    if (t._tracker === 'SN' && ['P1','P2'].includes(t.priority) && (!t.imoc_tt || !t.imoc_tt.trim()))
      flag(t, 'W12', `${t.priority} SN ticket without a linked IMOC TT# — "${t.title||t.id}"`);

    // E09 — Open ticket not picked up within 30 minutes
    if (t.status === 'Open' && t.open_date) {
      const ageMin = (Date.now() - new Date(t.open_date).getTime()) / 60000;
      if (ageMin > 30)
        flag(t, 'E09', `In "Open" status for ${ageMin < 60 ? Math.round(ageMin)+'min' : (ageMin/60).toFixed(1)+'h'} (opened ${fmtD(t.open_date)}) — no FO has picked it up`);
    }
  });

  // E06 — Duplicate TT# within same tracker
  const byTrackerTT = {};
  allTickets.forEach(t => {
    if (!t.sn_tt || !t.sn_tt.trim()) return;
    const key = `${t._tracker}::${t.sn_tt.trim().toUpperCase()}`;
    if (!byTrackerTT[key]) byTrackerTT[key] = [];
    byTrackerTT[key].push(t);
  });
  Object.values(byTrackerTT).forEach(group => {
    if (group.length > 1)
      group.forEach(t => flag(t, 'E06',
        `TT# "${t.sn_tt}" present ${group.length}× in tracker ${t._tracker} (IDs: ${group.map(x=>x.id).join(', ')})`));
  });

  // W09 — Duplicate IMOC TT#
  const byImoc = {};
  allTickets.forEach(t => {
    if (!t.imoc_tt || !t.imoc_tt.trim()) return;
    const key = t.imoc_tt.trim().toUpperCase();
    if (!byImoc[key]) byImoc[key] = [];
    byImoc[key].push(t);
  });
  Object.values(byImoc).forEach(group => {
    if (group.length > 1)
      group.forEach(t => flag(t, 'W09',
        `TT# IMOC "${t.imoc_tt}" shared across ${group.length} tickets (IDs: ${group.map(x=>x.id).join(', ')})`));
  });

  return issues;
}

// ══════════════════════════════════════════════════════════════
// ANALYSE DATA QUALITY
// Le catalogue de 21 règles produit une liste brute d'anomalies. Seul,
// il ne dit pas *par où commencer* : cette couche calcule les priorités,
// les responsables et les concentrations. Tout est dérivé des tickets
// chargés — aucune extrapolation.
// ══════════════════════════════════════════════════════════════
function _dqAnalyse(issues, allTickets) {
  const total = allTickets.length;

  // Score de qualité pondéré : une erreur ne pèse pas comme un warning.
  // Un simple "% de tickets touchés" mettait sur le même plan une date
  // incohérente et un champ de confort manquant.
  const W = { error: 3, warning: 1, info: 0.5 };
  const penalty = issues.reduce((s, i) => s + (W[i.severity] || 1), 0);
  const worst   = total * W.error;
  const score   = total ? Math.max(0, Math.round(100 * (1 - penalty / worst))) : 100;

  // Concentration par FO : qui a le plus de tickets à corriger.
  const byOwner = {};
  issues.forEach(i => {
    const fo = i.ticket.fo_owner || '— unassigned —';
    if (!byOwner[fo]) byOwner[fo] = { total: 0, errors: 0, tickets: new Set() };
    byOwner[fo].total++;
    if (i.severity === 'error') byOwner[fo].errors++;
    byOwner[fo].tickets.add(i.ticket.id);
  });
  const owners = Object.entries(byOwner)
    .map(([fo, v]) => ({ fo, ...v, tickets: v.tickets.size }))
    .sort((a, b) => b.errors - a.errors || b.total - a.total);

  // Tickets cumulant plusieurs anomalies : les corriger d'abord fait
  // tomber plusieurs lignes d'un coup.
  const perTicket = {};
  issues.forEach(i => {
    const k = i.ticket.id;
    if (!perTicket[k]) perTicket[k] = { ticket: i.ticket, rules: [] };
    perTicket[k].rules.push(i.ruleId);
  });
  const hotspots = Object.values(perTicket)
    .filter(x => x.rules.length >= 2)
    .sort((a, b) => b.rules.length - a.rules.length)
    .slice(0, 5);

  // Règle la plus fréquente : souvent un problème de process, pas de
  // saisie isolée.
  const byRule = {};
  issues.forEach(i => { byRule[i.ruleId] = (byRule[i.ruleId] || 0) + 1; });
  const topRule = Object.entries(byRule).sort((a, b) => b[1] - a[1])[0] || null;

  // Anomalies sur tickets encore ouverts : corrigeables tout de suite,
  // contrairement à celles sur des tickets clos depuis des semaines.
  const actionable = issues.filter(i =>
    !['Resolved', 'Closed'].includes(i.ticket.status)).length;

  return { score, owners, hotspots, topRule, actionable, byRule };
}

// Recommandations : au plus 4, ordonnées par gain attendu.
function _dqRecommendations(a, issues) {
  const out = [];
  const errs = issues.filter(i => i.severity === 'error').length;

  if (errs > 0) {
    out.push({ tone: 'crit',
      text: `<b>${errs}</b> blocking error(s) distort SLA calculations and reports.`,
      hint: 'Handle first: these anomalies make the KPIs wrong.' });
  }
  if (a.hotspots.length) {
    const h = a.hotspots[0];
    out.push({ tone: 'warn',
      text: `<b>${h.ticket.sn_tt || h.ticket.id}</b> cumule <b>${h.rules.length}</b> anomalies.`,
      hint: `${a.hotspots.length} ticket(s) have several issues — fixing them cuts the total quickly.` });
  }
  if (a.topRule) {
    const r = DQ_RULES[a.topRule[0]];
    if (r && a.topRule[1] >= 3) out.push({ tone: 'info',
      text: `<b>${a.topRule[1]}×</b> the same rule: “${r.title}”.`,
      hint: 'High recurrence — likely a process or form issue, not a one-off entry.' });
  }
  const top = a.owners[0];
  if (top && top.errors >= 2 && !top.fo.startsWith('—')) {
    out.push({ tone: 'info',
      text: `<b>${top.fo}</b> accounts for <b>${top.errors}</b> error(s) across ${top.tickets} ticket(s).`,
      hint: 'A targeted reminder will work better than a general announcement.' });
  }
  return out.slice(0, 4);
}

