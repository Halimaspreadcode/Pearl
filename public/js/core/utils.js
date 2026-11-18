// ── UTILS ────────────────────────────────────────────────────
function formatTimeLeft(ms, status) {
  if (ms === null || ms === undefined) return '-';
  if (status === 'Resolved' || status === 'Closed') {
    const abs = Math.abs(ms);
    const h = Math.floor(abs/3600000); const m = Math.floor((abs%3600000)/60000);
    const s = ms >= 0 ? '+' : '−';
    return `${s}${h}h${String(m).padStart(2,'0')}m (audit)`;
  }
  // SLA gelé (On Hold) : temps restant figé, affiché sans secondes et
  // marqué d'un flocon pour qu'on ne le lise pas comme un compte à rebours.
  if (status === 'On Hold') {
    const abs = Math.abs(ms);
    const d = Math.floor(abs/86400000), h = Math.floor((abs%86400000)/3600000), m = Math.floor((abs%3600000)/60000);
    return `❄ ${ms >= 0 ? '+' : '−'}${d > 0 ? `${d}d ` : ''}${h}h ${String(m).padStart(2,'0')}m`;
  }
  const abs = Math.abs(ms);
  const d = Math.floor(abs/86400000);
  const h = Math.floor((abs%86400000)/3600000);
  const m = Math.floor((abs%3600000)/60000);
  const s2 = Math.floor((abs%60000)/1000);
  const sign = ms >= 0 ? '+' : '−';
  if (d > 0) return `${sign}${d}d ${h}h ${String(m).padStart(2,'0')}m`;
  return `${sign}${h}h ${String(m).padStart(2,'0')}m ${String(s2).padStart(2,'0')}s`;
}
function timeLeftClass(ms, status) {
  if (status === 'Closed' || status === 'Resolved') return 'closed';
  if (status === 'On Hold') return 'frozen';
  if (ms === null || ms === undefined) return '';
  return ms >= 0 ? 'ok' : 'breach';
}
function priorityClass(p) {
  return `badge badge-${{P1:'p1',P2:'p2',P3:'p3',P4:'p4'}[p]||'p4'}`;
}
function statusClass(s) {
  return `badge badge-${{ 'Open':'open','In Progress':'inprogress','Resolved':'resolved','Closed':'closed','On Hold':'onhold'}[s]||'open'}`;
}
function slaClass(s) {
  if (s === 'In SLA') return 'badge badge-insla';
  if (s === 'Near Breach') return 'badge badge-nearbreach';
  if (s === 'Breach')  return 'badge badge-breach';
  if (s === 'On Hold') return 'badge badge-onhold';
  return 'badge badge-na';
}
function normSLAEntry(v) {
  if (v && typeof v === 'object') return { hours: Number(v.hours)||0, mode: v.mode||'calendar' };
  return { hours: Number(v)||0, mode: 'calendar' };
}
function isDualSLAEntry(raw) {
  return !!(raw && typeof raw === 'object' && (raw.workaround || raw.final));
}
function _slaLegLabel(leg) {
  const { hours, mode } = normSLAEntry(leg);
  if (!hours) return null;
  const label = hours < 24 ? `${hours}h` : `${Math.round(hours/24)}d`;
  const tag   = mode === 'business'
    ? '<span style="font-size:9px;background:#fef3c7;color:#92400e;border-radius:3px;padding:1px 4px;margin-left:3px;font-weight:700">BIZ</span>'
    : '';
  return label + tag;
}
function slaTarget(ticket) {
  const key = `${ticket.type} ${ticket.priority}`;
  const raw = state.config.sla_hours?.[key];
  if (!raw) return '-';
  if (isDualSLAEntry(raw)) {
    const wa    = raw.workaround ? _slaLegLabel(raw.workaround) : null;
    const final = raw.final ? _slaLegLabel(raw.final) : null;
    const parts = [];
    if (wa)    parts.push(`WA ${wa}`);
    if (final) parts.push(`Final ${final}`);
    return parts.length ? parts.join(' &middot; ') : '-';
  }
  const { hours, mode } = normSLAEntry(raw);
  if (!hours) return '-';
  const label = hours < 24 ? `${hours}h` : `${Math.round(hours/24)}d`;
  const tag   = mode === 'business'
    ? '<span style="font-size:9px;background:#fef3c7;color:#92400e;border-radius:3px;padding:1px 4px;margin-left:3px;font-weight:700">BIZ</span>'
    : '';
  return label + tag;
}

// Plain-text variant of slaTarget() for spreadsheet/export cells, which can't render HTML.
function slaTargetText(ticket) {
  return slaTarget(ticket).replace(/<[^>]+>/g, '').replace(/&middot;/g, '·');
}

function fmtDt(iso) {
  if (!iso) return '-';
  if (typeof fmtDtShort === 'function') return fmtDtShort(iso);
  return new Date(iso).toLocaleString((globalThis.PEAR_LOCALE || 'fr-FR'), {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
function toLocalDT(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d - d.getTimezoneOffset()*60000).toISOString().slice(0,16);
}

