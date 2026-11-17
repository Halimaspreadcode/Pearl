// ── AUDIT TRAIL ───────────────────────────────────────────────
let auditData = [];

async function loadAudit() {
  const res = await fetch(`${API}/api/audit`, {
    headers: AdminSession.headers(),
    credentials: 'same-origin',
  });
  if (!res.ok) { auditData = []; return; }
  auditData = await res.json();
}

async function renderAudit() {
  if (!auditData.length) await loadAudit();
  const tracker = document.getElementById('audit-filter-tracker')?.value || '';
  const action  = document.getElementById('audit-filter-action')?.value  || '';
  const search  = document.getElementById('audit-search')?.value.toLowerCase() || '';
  let entries = auditData;
  if (tracker) entries = entries.filter(a => (a.tracker||'').toUpperCase() === tracker.toUpperCase());
  if (action)  entries = entries.filter(a => a.action === action);
  if (search)  entries = entries.filter(a => {
    const ticket = (state[(a.tracker||'').toLowerCase()] || []).find(t => t.id === a.ticket_id);
    return [a.user, a.ticket_id, ticket?.sn_tt, JSON.stringify(a.changes)].join(' ').toLowerCase().includes(search);
  });
  const tbody = document.getElementById('audit-tbody');
  if (!entries.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--mute)">No entries</td></tr>`;
    return;
  }
  tbody.innerHTML = entries.map(a => {
    let changesHtml = '-';
    if (a.changes) {
      if (a.action === 'create') {
        // changes est l'objet ticket complet - on affiche les champs clés
        const keys = ['sn_tt','title','type','priority','domain','status','fo_owner'];
        changesHtml = keys.filter(k => a.changes[k]).map(k =>
          `<span style="font-size:10px"><b>${k}</b>: ${esc(String(a.changes[k]))}</span>`
        ).join('<br>');
      } else if (a.action === 'delete') {
        // changes contient {sn_tt, title}
        const tt    = a.changes.sn_tt  || a.changes['sn_tt']  || '-';
        const title = a.changes.title  || '-';
        changesHtml = `<span style="font-size:10px"><b>sn_tt</b>: ${esc(tt)}<br><b>title</b>: ${esc(title)}</span>`;
      } else {
        // update - structure {field: {from, to}}
        changesHtml = Object.entries(a.changes).map(([f, v]) => {
          const from = v && typeof v === 'object' && 'from' in v ? v.from : v;
          const to   = v && typeof v === 'object' && 'to'   in v ? v.to   : '';
          return `<span style="font-size:10px"><b>${esc(f)}</b>: ${esc(String(from??'-'))} → ${esc(String(to??'-'))}</span>`;
        }).join('<br>');
      }
    }
    const tracker = (a.tracker||'').toLowerCase();
    const ticket = (state[tracker] || []).find(t => t.id === a.ticket_id);
    const tt = ticket?.sn_tt || a.changes?.sn_tt || a.ticket_id || '-';
    const ttCell = ticket
      ? `<a href="#" onclick="openEditTicket('${tracker}','${a.ticket_id}');return false" class="td-mono" style="font-size:11px;color:var(--accent);text-decoration:underline">${esc(tt)}</a>`
      : `<span class="td-mono" style="font-size:11px">${esc(tt)}</span>`;
    return `<tr>
      <td style="font-size:11px;white-space:nowrap;font-family:'DM Mono',monospace">${fmtDt(a.ts)}</td>
      <td><span class="badge" style="background:var(--line);color:var(--mid)">${(a.tracker||'').toUpperCase()}</span></td>
      <td>${ttCell}</td>
      <td><span class="badge ${a.action==='create'?'badge-insla':a.action==='delete'?'badge-breach':'badge-inprogress'}">${a.action}</span></td>
      <td style="font-weight:500;font-size:12px">${a.user||'-'}</td>
      <td style="max-width:300px;font-size:11px;color:var(--mid)">${changesHtml}</td>
    </tr>`;
  }).join('');
}

// The server already handles audit recording on every PUT/POST.
// No duplicate client-side audit calls needed.

