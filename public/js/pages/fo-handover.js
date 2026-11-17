// ── FO HANDOVER BOARD ─────────────────────────────────────────
const SHIFT_SCHEDULE = [
  { id: 'morning',   name: 'Matin',       start: [7,30],  end: [11,30] },
  { id: 'afternoon', name: 'Afternoon',  start: [11,30], end: [14,30] },
  { id: 'night',     name: 'Nuit',        start: [14,30], end: [17,30] },
];

function getCurrentAndPreviousShift() {
  const { tz } = getLangConfig();
  const now = new Date();
  const localStr = now.toLocaleString('en-CA', { timeZone: tz, hour12: false });
  const [datePart, timePart] = localStr.split(', ');
  const [h, m] = timePart.split(':').map(Number);
  const todayMin = h * 60 + m;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toLocaleDateString('en-CA', { timeZone: tz });

  let currentIdx = -1;
  for (let i = 0; i < SHIFT_SCHEDULE.length; i++) {
    const s = SHIFT_SCHEDULE[i];
    const startMin = s.start[0] * 60 + s.start[1];
    const endMin   = s.end[0]   * 60 + s.end[1];
    if (todayMin >= startMin && todayMin < endMin) { currentIdx = i; break; }
  }
  if (currentIdx === -1) {
    currentIdx = todayMin < SHIFT_SCHEDULE[0].start[0] * 60 + SHIFT_SCHEDULE[0].start[1]
      ? SHIFT_SCHEDULE.length - 1  // before morning → last shift was night
      : SHIFT_SCHEDULE.length - 1; // after last shift
  }

  const prevIdx  = (currentIdx - 1 + SHIFT_SCHEDULE.length) % SHIFT_SCHEDULE.length;
  const prevDate = prevIdx > currentIdx ? yesterdayStr : datePart;

  return {
    current:  { ...SHIFT_SCHEDULE[currentIdx], date: datePart },
    previous: { ...SHIFT_SCHEDULE[prevIdx],    date: prevDate },
  };
}

// Returns the last N shifts going backwards from (shiftIdx, date), skipping none
// Returns array of { shift, date } objects
function getRecentShifts(n) {
  const { tz } = getLangConfig();
  const { current } = getCurrentAndPreviousShift();
  const result = [];
  let idx  = SHIFT_SCHEDULE.findIndex(s => s.id === current.id);
  let date = current.date;
  for (let i = 0; i < n; i++) {
    idx--;
    if (idx < 0) {
      idx = SHIFT_SCHEDULE.length - 1;
      const d = new Date(date + 'T12:00:00');
      d.setDate(d.getDate() - 1);
      date = d.toLocaleDateString('en-CA', { timeZone: tz });
    }
    result.push({ shift: SHIFT_SCHEDULE[idx], date });
  }
  return result;
}

// Find the last shift that had at least one FO planned (skipping gaps)
// Returns { shift, date, skipped: [{shift,date}] }
function getLastCoveredShift() {
  const recentShifts = getRecentShifts(20); // look back up to 20 shifts
  const plan = state.shiftsPlan || [];
  const skipped = [];
  for (const { shift, date } of recentShifts) {
    const hasFO = plan.some(e => e.date === date && e.shift_id === shift.id && !e.is_rest);
    if (hasFO) return { shift, date, skipped };
    skipped.push({ shift, date });
  }
  return { shift: recentShifts[0]?.shift, date: recentShifts[0]?.date, skipped: recentShifts.slice(1) };
}

function renderFOHandover() {
  const root = document.getElementById('fo-handover-root');
  if (!root) return;

  const { locale, tz } = getLangConfig();
  const ageStr = ms => {
    const h = ms / 3600000;
    if (h < 1)  return `${Math.round(h * 60)}min`;
    if (h < 24) return `${h.toFixed(1)}h`;
    return `${Math.floor(h/24)}j ${Math.round(h%24)}h`;
  };
  const mkInitials = name => name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  const { current, previous } = getCurrentAndPreviousShift();
  const plan = state.shiftsPlan || [];

  // FOs sortants : shift précédent
  const prevFOs = plan
    .filter(e => e.date === previous.date && e.shift_id === previous.id && !e.is_rest)
    .map(e => ({ fo: e.fo_name, tracker: e.tracker, site: e.site_name }));

  // FOs entrants : shift actuel
  const currentFONames = [...new Set(
    plan.filter(e => e.date === current.date && e.shift_id === current.id && !e.is_rest).map(e => e.fo_name)
  )].sort();

  // Fallback si planning vide
  const incomingFOs = currentFONames.length > 0 ? currentFONames : (state.config?.fo_list || []).slice().sort();

  // Handover confirmé — persisté par shift+date
  const hbKey = `pearl_hb_from_${current.date}_${current.id}`;
  const vpKey = `pearl_hb_vp_${current.date}_${current.id}`;
  const selFrom = localStorage.getItem(hbKey) || '';
  const selFO   = localStorage.getItem(vpKey)  || '';

  // Tickets actifs
  const allActive = [
    ...state.sn.map(t => ({ ...t, _tracker: 'SN' })),
    ...state.ci.map(t => ({ ...t, _tracker: 'CI' })),
  ].filter(t => ['Open', 'In Progress', 'On Hold'].includes(t.status))
   .sort((a, b) => (a.open_date ? new Date(a.open_date).getTime() : 0)
                 - (b.open_date ? new Date(b.open_date).getTime() : 0));

  const badge = document.getElementById('sb-count-handover');
  if (badge) { badge.textContent = allActive.length || ''; badge.style.display = allActive.length ? '' : 'none'; }

  // ── Helpers UI ─────────────────────────────────────────────────
  const sLabel = txt =>
    `<div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--mute);margin-bottom:10px">${txt}</div>`;

  const pillBtn = (label, active, onclick, accentBg, accentFg) => {
    const bg  = active ? accentBg  : 'var(--white)';
    const fg  = active ? accentFg  : 'var(--dark)';
    const bdr = active ? accentBg  : 'var(--line)';
    const avBg = active ? 'rgba(255,255,255,.25)' : 'var(--bg2)';
    const avFg = active ? accentFg : 'var(--gray)';
    return `<button onclick="${onclick}"
      style="display:inline-flex;align-items:center;gap:7px;padding:6px 14px 6px 8px;
             border:1.5px solid ${bdr};border-radius:20px;background:${bg};color:${fg};
             font-size:12px;font-weight:600;cursor:pointer;transition:all .12s;font-family:inherit;
             box-shadow:${active ? '0 2px 8px rgba(0,0,0,.14)' : 'none'}"
      onmouseover="if(!${active})this.style.borderColor='var(--mute)'"
      onmouseout="if(!${active})this.style.borderColor='var(--line)'">
      <span style="width:24px;height:24px;border-radius:50%;background:${avBg};color:${avFg};
                   display:flex;align-items:center;justify-content:center;
                   font-size:9px;font-weight:800;flex-shrink:0">${mkInitials(label)}</span>
      ${esc(label)}
    </button>`;
  };

  const ticketRow = t => {
    const ageMs  = t.open_date ? Date.now() - new Date(t.open_date).getTime() : 0;
    const ageCol = ageMs > 86400000 ? 'var(--red)' : ageMs > 14400000 ? '#B45309' : 'var(--ok-fg)';
    const slaCol = t.sla_status === 'Breach' ? 'var(--red)' : t.sla_status === 'Near Breach' ? '#B45309' : 'var(--ok-fg)';
    const lastAct = t.update_action || t.comments || t.observations || '—';
    return `<tr onclick="openEditTicket('${t._tracker.toLowerCase()}','${t.id}')" style="cursor:pointer"
      onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background=''">
      <td style="padding:8px 12px;white-space:nowrap">
        <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:5px;
          background:${t._tracker==='SN'?'rgba(37,99,235,.1)':'rgba(5,150,105,.1)'};
          color:${t._tracker==='SN'?'#1D4ED8':'#047857'}">${t._tracker}</span>
      </td>
      <td style="padding:8px 12px;font-family:monospace;font-size:11px;color:var(--mute);white-space:nowrap">${esc(t.sn_tt||'—')}</td>
      <td style="padding:8px 12px;font-size:12px;font-weight:500;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(t.title||'')}">${esc(t.title||'—')}</td>
      <td style="padding:8px 12px;white-space:nowrap">${t.priority?`<span class="badge badge-${t.priority.toLowerCase()}">${t.priority}</span>`:'—'}</td>
      <td style="padding:8px 12px;font-size:11px;white-space:nowrap;color:var(--mute)">${esc(t.status)}</td>
      <td style="padding:8px 12px;font-size:11px;white-space:nowrap;font-weight:600;color:${slaCol}">${t.sla_status||'—'}</td>
      <td style="padding:8px 12px;font-size:11px;white-space:nowrap;color:var(--mute)">${esc(t.fo_owner||t.assigned_to||'—')}</td>
      <td style="padding:8px 12px;font-size:11px;color:var(--mute);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(lastAct)}">${esc(lastAct.slice(0,80))}</td>
      <td style="padding:8px 12px;font-size:11px;white-space:nowrap;font-weight:600;color:${ageCol}">${ageMs ? ageStr(ageMs) : '—'}</td>
    </tr>`;
  };

  const tableWrap = rows => `
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:var(--bg2);border-bottom:1px solid var(--line)">
          ${['Tracker','TT#','Titre','Prio','Statut','SLA','FO Owner','Last action','Âge']
            .map(h=>`<th style="padding:7px 12px;text-align:left;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--mute)">${h}</th>`).join('')}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  const emptyCard = msg =>
    `<div style="text-align:center;padding:36px 20px;color:var(--mute);font-size:13px">${msg}</div>`;

  // ── Bloc sortants ──────────────────────────────────────────────
  const prevGroups = {};
  prevFOs.forEach(({ fo, tracker, site }) => {
    if (!prevGroups[fo]) prevGroups[fo] = { trackers: new Set(), sites: new Set(), tickets: [] };
    prevGroups[fo].trackers.add(tracker);
    prevGroups[fo].sites.add(site);
  });
  allActive.forEach(t => {
    const fo = t.fo_owner || t.assigned_to;
    if (fo && prevGroups[fo]) prevGroups[fo].tickets.push(t);
  });

  const outgoingCards = Object.entries(prevGroups).map(([fo, info]) => {
    const tCount = info.tickets.length;
    const breach = info.tickets.filter(t => t.sla_status === 'Breach').length;
    const ini = mkInitials(fo);
    return `<div style="background:var(--white);border:1px solid var(--line);border-radius:14px;padding:16px 18px;min-width:190px;flex:1;box-shadow:var(--sh-xs)">
      <div style="display:flex;align-items:center;gap:11px;margin-bottom:12px">
        <div style="width:40px;height:40px;border-radius:50%;background:var(--red);color:#fff;
                    display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;flex-shrink:0;
                    box-shadow:0 2px 8px rgba(199,0,11,.28)">${ini}</div>
        <div style="min-width:0">
          <div style="font-size:13px;font-weight:700;color:var(--dark)">${esc(fo)}</div>
          <div style="font-size:11px;color:var(--mute);margin-top:1px">${[...info.sites].filter(Boolean).join(', ')||'—'}</div>
        </div>
        <span style="margin-left:auto;font-size:10px;font-weight:700;padding:3px 8px;border-radius:20px;
                     background:rgba(37,99,235,.1);color:#1D4ED8;white-space:nowrap">${[...info.trackers].join('/')}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr${breach>0?' 1fr':''};gap:8px">
        <div style="background:var(--bg2);border-radius:10px;padding:10px;text-align:center">
          <div style="font-size:24px;font-weight:800;color:var(--dark);line-height:1">${tCount}</div>
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--mute);margin-top:3px">Tickets actifs</div>
        </div>
        ${breach > 0 ? `<div style="background:rgba(199,0,11,.07);border:1px solid rgba(199,0,11,.15);border-radius:10px;padding:10px;text-align:center">
          <div style="font-size:24px;font-weight:800;color:var(--red);line-height:1">${breach}</div>
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--red);margin-top:3px">Breach SLA</div>
        </div>` : ''}
      </div>
    </div>`;
  }).join('');

  // ── Bloc handover reçu (pills FO sortant) ─────────────────────
  const fromPills = incomingFOs.map(fo => {
    const safefo = fo.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    return pillBtn(fo, selFrom === fo,
      `localStorage.setItem('${hbKey}','${safefo}');renderFOHandover()`,
      'var(--ok-fg)', '#fff');
  }).join('');

  const noPlanHint = currentFONames.length === 0
    ? `<div style="margin-top:8px;font-size:11px;color:#B45309;background:rgba(217,119,6,.08);border-radius:6px;padding:5px 10px">
         Current shift rota not set — full list displayed
       </div>` : '';

  const handoverSection = `
    <div style="background:var(--white);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin-bottom:20px;box-shadow:var(--sh-xs)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
        <div style="width:30px;height:30px;border-radius:8px;background:rgba(46,125,50,.1);display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--ok-fg)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <div>
          <div style="font-size:13px;font-weight:700;color:var(--dark)">Handover received from</div>
          <div style="font-size:11px;color:var(--mute)">${esc(current.name)} · ${current.date}</div>
        </div>
        ${selFrom
          ? `<div style="margin-left:auto;display:flex;align-items:center;gap:8px">
               <span style="font-size:12px;font-weight:700;color:var(--ok-fg)">✓ ${esc(selFrom)}</span>
               <button onclick="localStorage.removeItem('${hbKey}');renderFOHandover()"
                 style="font-size:11px;color:var(--mute);background:none;border:1px solid var(--line);border-radius:6px;cursor:pointer;padding:3px 8px;font-family:inherit"
                 onmouseover="this.style.borderColor='var(--mute)'" onmouseout="this.style.borderColor='var(--line)'">Effacer</button>
             </div>` : ''}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${fromPills || '<span style="font-size:12px;color:var(--mute)">No FO available</span>'}</div>
      ${noPlanHint}
    </div>`;

  // ── Bloc tickets actifs ────────────────────────────────────────
  const ticketsSection = `
    <div style="background:var(--white);border:1px solid var(--line);border-radius:14px;overflow:hidden;margin-bottom:20px;box-shadow:var(--sh-xs)">
      <div style="display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line)">
        <div style="width:30px;height:30px;border-radius:8px;background:rgba(217,119,6,.1);display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#B45309" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <div>
          <div style="font-size:13px;font-weight:700;color:var(--dark)">Active tickets to hand over</div>
          <div style="font-size:11px;color:var(--mute)">Open · In Progress · On Hold</div>
        </div>
        <span style="margin-left:auto;font-size:12px;font-weight:700;padding:3px 11px;border-radius:20px;
                     background:${allActive.length ? 'rgba(217,119,6,.12)' : 'var(--bg2)'};
                     color:${allActive.length ? '#B45309' : 'var(--mute)'}">${allActive.length} ticket${allActive.length!==1?'s':''}</span>
      </div>
      ${allActive.length ? tableWrap(allActive.map(ticketRow).join('')) : emptyCard('Aucun ticket actif en cours. ✓')}
    </div>`;

  // ── Bloc vue personnelle (pills FO entrant) ────────────────────
  const vpPills = incomingFOs.map(fo => {
    const safefo = fo.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    return pillBtn(fo, selFO === fo,
      `localStorage.setItem('${vpKey}','${safefo}');renderFOHandover()`,
      'var(--red)', '#fff');
  }).join('');

  let vpContent = '';
  if (selFO) {
    const foTickets = allActive.filter(t => t.fo_owner === selFO || t.assigned_to === selFO);
    const foAtRisk  = foTickets.filter(t => ['Breach','Near Breach'].includes(t.sla_status));
    const foShift   = plan.find(e => e.fo_name === selFO && e.date === current.date && !e.is_rest);
    vpContent = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px">
        <div style="background:var(--bg2);border-radius:10px;padding:12px 14px">
          <div style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--mute);margin-bottom:4px">Shift actuel</div>
          <div style="font-size:13px;font-weight:700;color:var(--dark)">${foShift ? esc(foShift.shift_name||foShift.shift_id) : 'Off / Not scheduled'}</div>
        </div>
        <div style="background:var(--bg2);border-radius:10px;padding:12px 14px;text-align:center">
          <div style="font-size:26px;font-weight:800;color:var(--dark);line-height:1">${foTickets.length}</div>
          <div style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--mute);margin-top:3px">Tickets actifs</div>
        </div>
        <div style="background:${foAtRisk.length?'rgba(199,0,11,.07)':'var(--bg2)'};border:1px solid ${foAtRisk.length?'rgba(199,0,11,.15)':'transparent'};border-radius:10px;padding:12px 14px;text-align:center">
          <div style="font-size:26px;font-weight:800;color:${foAtRisk.length?'var(--red)':'var(--dark)'};line-height:1">${foAtRisk.length}</div>
          <div style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--mute);margin-top:3px">SLA at risk</div>
        </div>
      </div>
      ${foTickets.length ? tableWrap(foTickets.map(ticketRow).join('')) : emptyCard('Aucun ticket actif pour ce FO.')}`;
  } else {
    vpContent = emptyCard('Select an incoming FO above to see their workload.');
  }

  const vpSection = `
    <div style="background:var(--white);border:1px solid var(--line);border-radius:14px;overflow:hidden;box-shadow:var(--sh-xs)">
      <div style="padding:16px 18px;border-bottom:1px solid var(--line)">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
          <div style="width:30px;height:30px;border-radius:8px;background:rgba(199,0,11,.08);display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </div>
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--dark)">Vue personnelle FO entrant</div>
            <div style="font-size:11px;color:var(--mute)">${esc(current.name)} · ${current.date}</div>
          </div>
          ${selFO
            ? `<button onclick="localStorage.removeItem('${vpKey}');renderFOHandover()"
                style="margin-left:auto;font-size:11px;color:var(--mute);background:none;border:1px solid var(--line);border-radius:6px;cursor:pointer;padding:3px 8px;font-family:inherit"
                onmouseover="this.style.borderColor='var(--mute)'" onmouseout="this.style.borderColor='var(--line)'">Effacer</button>` : ''}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${vpPills}</div>
      </div>
      <div style="padding:16px">${vpContent}</div>
    </div>`;

  // ── Render ─────────────────────────────────────────────────────
  root.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:22px">
      <div>
        <div class="page-title">Handover Board</div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap">
          <span style="display:inline-flex;align-items:center;gap:5px;background:rgba(217,119,6,.1);color:#B45309;font-weight:700;font-size:12px;padding:4px 11px;border-radius:20px">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="5 12 3 12 12 3 21 12 19 12"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>
            ${esc(previous.name)} · ${previous.date}
          </span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--mute)" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          <span style="display:inline-flex;align-items:center;gap:5px;background:rgba(46,125,50,.1);color:var(--ok-fg);font-weight:700;font-size:12px;padding:4px 11px;border-radius:20px">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="19 12 21 12 12 21 3 12 5 12"/><path d="M19 12V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v7"/></svg>
            ${esc(current.name)} · ${current.date}
          </span>
          <span style="color:var(--mute);font-size:12px">${new Date().toLocaleDateString(locale, { timeZone: tz, weekday:'long', day:'numeric', month:'long' })}</span>
        </div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="renderFOHandover()">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-1px;margin-right:4px"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>Actualiser
      </button>
    </div>

    ${handoverSection}

    <div style="margin-bottom:20px">
      ${sLabel(`FOs sortants — ${previous.name} · ${previous.date}`)}
      ${Object.keys(prevGroups).length
        ? `<div style="display:flex;gap:10px;flex-wrap:wrap">${outgoingCards}</div>`
        : `<div style="background:var(--white);border:1px solid var(--line);border-radius:12px;padding:20px 18px;color:var(--mute);font-size:13px;box-shadow:var(--sh-xs)">No FO scheduled on this shift.</div>`}
    </div>

    ${ticketsSection}
    ${vpSection}`;
}

