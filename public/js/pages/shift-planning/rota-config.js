// ── ROTA CONFIG UI ───────────────────────────────────────────
let _rotaActiveSite = null;
let _rotaPreviewData = null;

function renderRotaConfig() {
  const rc = state.rotaConfig || { sites: [] };
  rc.sites = rc.sites || [];
  state.rotaConfig = rc;

  if (!_rotaActiveSite || !rc.sites.some(s => s.id === _rotaActiveSite)) {
    _rotaActiveSite = rc.sites[0]?.id || null;
  }

  // Site tabs
  const tabsEl = document.getElementById('rota-site-tabs');
  if (tabsEl) {
    tabsEl.innerHTML = rc.sites.map(s => `
      <button class="hm-tab${s.id===_rotaActiveSite?' active':''}" style="border-bottom:${s.id===_rotaActiveSite?'2px solid var(--red)':'2px solid transparent'};margin-bottom:-2px;border-radius:0;padding:8px 16px;font-size:12px;font-weight:600" onclick="_rotaActiveSite='${s.id}';renderRotaConfig()">
        ${esc(s.name)} <span style="font-size:10px;color:var(--mute);font-weight:400">(${(s.teams||[]).reduce((a,t)=>a+(t.members||[]).length,0)} FOs)</span>
      </button>`).join('') +
      `<button class="btn btn-ghost btn-sm" style="margin-bottom:-2px;padding:8px 14px;font-size:12px;font-weight:600" onclick="_rotaOpenAddSite()">+ Add site</button>`;
  }

  const addSiteForm = document.getElementById('rota-add-site-form');
  if (addSiteForm) addSiteForm.style.display = 'none';

  const site = rc.sites.find(s => s.id === _rotaActiveSite);
  const panel = document.getElementById('rota-site-panel');
  if (!panel) return;
  if (!site) { panel.innerHTML = `<div style="padding:20px;text-align:center;color:var(--mute);font-size:12px">No site configured yet - click "+ Add site" to create one.</div>`; return; }

  // Shift hours editor
  const shiftRows = (site.shifts||[]).map((sh, si) => `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      <span style="min-width:80px;font-size:12px;font-weight:600;color:var(--dark)">${esc(sh.name)}</span>
      <input class="form-control" style="width:90px" type="time" value="${sh.start||''}" oninput="_rotaUpdateShift('${site.id}',${si},'start',this.value)">
      <span style="color:var(--mute);font-size:11px">→</span>
      <input class="form-control" style="width:90px" type="time" value="${sh.end||''}" oninput="_rotaUpdateShift('${site.id}',${si},'end',this.value)">
      <span style="font-size:10px;color:var(--mute)">(8h)</span>
    </div>`).join('');

  // Teams
  const teamCards = (site.teams||[]).map((team) => {
    const memberChips = (team.members||[]).map(m => `
      <span style="display:inline-flex;align-items:center;gap:4px;background:var(--bg2);border-radius:20px;padding:3px 10px;font-size:11px">
        ${esc(m)}
        <button onclick="_rotaRemoveMember('${site.id}','${team.id}','${esc(m)}')" style="background:none;border:none;cursor:pointer;color:var(--mute);font-size:13px;line-height:1;padding:0 0 0 2px">×</button>
      </span>`).join('');

    // Available FOs not yet in any team of this site
    const usedFOs = new Set((site.teams||[]).flatMap(t => t.members||[]));
    const availFOs = (state.config.fo_list||[]).filter(f => !usedFOs.has(f));
    const addOpts = availFOs.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('');

    return `
    <div style="border:1px solid var(--line);border-radius:var(--r);padding:12px;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="font-size:12px;font-weight:700;color:var(--dark);flex:1">${esc(team.name)}</span>
        <span style="font-size:10px;padding:2px 7px;border-radius:10px;background:var(--bg2);color:var(--mute)">${team.tracker||'-'}</span>
        <button class="btn btn-ghost btn-sm" style="color:var(--red);padding:2px 6px;font-size:11px" onclick="_rotaRemoveTeam('${site.id}','${team.id}')">Remove</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px">${memberChips || '<span style="font-size:11px;color:var(--mute)">No members yet</span>'}</div>
      ${availFOs.length ? `<div style="display:flex;gap:6px;align-items:center">
        <select class="form-control" id="add-member-${team.id}" style="font-size:11px;max-width:200px">
          <option value="">+ Add FO…</option>${addOpts}
        </select>
        <button class="btn btn-ghost btn-sm" onclick="_rotaAddMember('${site.id}','${team.id}')">Add</button>
      </div>` : '<span style="font-size:11px;color:var(--mute)">All FOs assigned</span>'}
    </div>`;
  }).join('');

  panel.innerHTML = `
    <div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--mute);margin-bottom:10px">Shift hours - ${esc(site.name)}</div>
      ${shiftRows}
      <button class="btn btn-ghost btn-sm" style="margin-top:4px" onclick="_rotaSaveShiftHours()">Save hours</button>
    </div>
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--mute)">Teams - ${esc(site.name)}</div>
        <button class="btn btn-primary btn-sm" onclick="_rotaOpenAddTeam('${site.id}')">+ New team</button>
      </div>
      ${teamCards || '<div style="color:var(--mute);font-size:12px;padding:8px 0">No teams yet. Create a team to start.</div>'}
      <div id="rota-add-team-form" style="display:none;border:1px dashed var(--line);border-radius:var(--r);padding:12px;margin-top:8px">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
          <div><label class="form-label">Team name</label><input class="form-control" id="new-team-name" placeholder="e.g. SN Team A" style="width:160px"></div>
          <div><label class="form-label">Tracker</label>
            <select class="form-control" id="new-team-tracker" style="width:90px">
              <option>SN</option><option>CI</option>
            </select>
          </div>
          <button class="btn btn-primary btn-sm" onclick="_rotaCreateTeam('${site.id}')">Create</button>
          <button class="btn btn-ghost btn-sm" onclick="document.getElementById('rota-add-team-form').style.display='none'">Cancel</button>
        </div>
      </div>
    </div>`;

  // Update generator site dropdown
  const genSite = document.getElementById('rota-gen-site');
  if (genSite) {
    genSite.innerHTML = rc.sites.map(s => `<option value="${esc(s.id)}"${s.id===_rotaActiveSite?' selected':''}>${esc(s.name)}</option>`).join('');
  }
  // Default start = next Monday
  const startInp = document.getElementById('rota-gen-start');
  if (startInp && !startInp.value) {
    const today = new Date(); const dow = today.getDay();
    const daysToMon = dow === 1 ? 7 : (8 - dow) % 7 || 7;
    today.setDate(today.getDate() + daysToMon);
    startInp.value = today.toISOString().slice(0,10);
  }
}

function _rotaOpenAddSite() {
  const form = document.getElementById('rota-add-site-form');
  if (!form) return;
  form.style.display = '';
  document.getElementById('new-site-name').focus();
}
function _rotaCreateSite() {
  const name = document.getElementById('new-site-name').value.trim();
  const tracker = document.getElementById('new-site-tracker').value;
  if (!name) return;
  const rc = state.rotaConfig || { sites: [] };
  rc.sites = rc.sites || [];
  let id = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
  if (!id || rc.sites.some(s => s.id === id)) id = `${id || 'site'}-${Date.now()}`;
  rc.sites.push({
    id, name, tracker,
    shifts: [
      { id:'morning', name:'Morning', start:'06:00', end:'14:00' },
      { id:'afternoon', name:'Afternoon', start:'14:00', end:'22:00' },
      { id:'night', name:'Night', start:'22:00', end:'06:00' },
    ],
    teams: []
  });
  _rotaActiveSite = id;
  document.getElementById('rota-add-site-form').style.display = 'none';
  _rotaSaveAndRefresh();
}
function _rotaOpenAddTeam() {
  document.getElementById('rota-add-team-form').style.display = '';
  document.getElementById('new-team-name').focus();
}
function _rotaCreateTeam(siteId) {
  const name = document.getElementById('new-team-name').value.trim();
  const tracker = document.getElementById('new-team-tracker').value;
  if (!name) return;
  const site = (state.rotaConfig.sites||[]).find(s => s.id === siteId);
  if (!site) return;
  site.teams = site.teams || [];
  site.teams.push({ id: 'team-' + Date.now(), name, tracker, members: [] });
  document.getElementById('rota-add-team-form').style.display = 'none';
  _rotaSaveAndRefresh();
}
function _rotaRemoveTeam(siteId, teamId) {
  if (!confirm('Remove this team?')) return;
  const site = (state.rotaConfig.sites||[]).find(s => s.id === siteId);
  if (site) site.teams = (site.teams||[]).filter(t => t.id !== teamId);
  _rotaSaveAndRefresh();
}
function _rotaAddMember(siteId, teamId) {
  const sel = document.getElementById(`add-member-${teamId}`);
  if (!sel || !sel.value) return;
  const site = (state.rotaConfig.sites||[]).find(s => s.id === siteId);
  const team = site && (site.teams||[]).find(t => t.id === teamId);
  if (!team) return;
  team.members = team.members || [];
  if (!team.members.includes(sel.value)) team.members.push(sel.value);
  _rotaSaveAndRefresh();
}
function _rotaRemoveMember(siteId, teamId, foName) {
  const site = (state.rotaConfig.sites||[]).find(s => s.id === siteId);
  const team = site && (site.teams||[]).find(t => t.id === teamId);
  if (!team) return;
  team.members = (team.members||[]).filter(m => m !== foName);
  _rotaSaveAndRefresh();
}
function _rotaUpdateShift(siteId, shiftIdx, field, value) {
  const site = (state.rotaConfig.sites||[]).find(s => s.id === siteId);
  if (site && site.shifts[shiftIdx]) site.shifts[shiftIdx][field] = value;
  // don't save on every keystroke - save button handles it
}
function _rotaSaveShiftHours() {
  _rotaSaveAndRefresh();
}
async function _rotaSaveAndRefresh() {
  await fetch(`${API}/api/rota/config`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state.rotaConfig)
  });
  await loadConfig();
  renderRotaConfig();
  toast('Rota config saved', 'success');
}

async function previewRota() {
  const siteId = document.getElementById('rota-gen-site')?.value;
  const start  = document.getElementById('rota-gen-start')?.value;
  const weeks  = parseInt(document.getElementById('rota-gen-weeks')?.value || '4');
  if (!siteId || !start) { toast('Select a site and start date', 'error'); return; }

  // Jeton admin joint : au-delà de ROTA_BULK_WEEKS le serveur exige une
  // session, et ce formulaire accepte un nombre de semaines libre.
  const res  = await fetch(`${API}/api/rota/generate`, {
    method: 'POST', headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ site_id: siteId, start_date: start, weeks })
  });
  if (res.status === 401) { toast('Admin session expired — please sign in again.', 'error'); return; }
  const data = await res.json();
  _rotaPreviewData = { assignments: data, site_id: siteId, start_date: start, weeks };

  // Show compact summary
  const preview = document.getElementById('rota-preview');
  const site = (state.rotaConfig.sites||[]).find(s => s.id === siteId);
  if (!site || !data.length) { preview.innerHTML = '<div style="color:var(--mute);font-size:12px">No data generated - configure teams first.</div>'; return; }

  // Group by team, then by week
  const byTeam = {};
  data.forEach(a => {
    if (!byTeam[a.team_id]) byTeam[a.team_id] = { name: a.team_name, tracker: a.tracker, byFO: {} };
    if (!byTeam[a.team_id].byFO[a.fo_name]) byTeam[a.team_id].byFO[a.fo_name] = [];
    byTeam[a.team_id].byFO[a.fo_name].push(a);
  });

  const shiftColor = { morning:'#2563EB', afternoon:'#D97706', night:'#7C3AED', rest:'#8B949E' };
  const shiftAbbr  = { morning:'M', afternoon:'A', night:'N', rest:'-' };

  let html = `<div style="font-size:11px;color:var(--mute);margin-bottom:10px">${data.filter(a=>!a.is_rest).length} work shifts · ${data.filter(a=>a.is_rest).length} rest days · ${weeks} weeks</div>`;

  Object.values(byTeam).forEach(team => {
    html += `<div style="margin-bottom:14px"><div style="font-size:11px;font-weight:700;color:var(--dark);margin-bottom:6px">${esc(team.name)} <span style="font-size:10px;color:var(--mute);font-weight:400">${team.tracker}</span></div>`;
    html += `<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:10.5px;white-space:nowrap">`;
    html += `<thead><tr><th style="padding:3px 8px;text-align:left;color:var(--mute);font-weight:600">FO</th>`;
    // week headers
    for (let w = 0; w < weeks; w++) {
      const wd = new Date(start); wd.setDate(wd.getDate() + w*7);
      html += `<th colspan="7" style="padding:3px 8px;text-align:center;color:var(--mute);font-weight:600;border-left:1px solid var(--line)">W${w+1} · ${wd.toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}</th>`;
    }
    html += `</tr></thead><tbody>`;

    Object.entries(team.byFO).forEach(([fo, days]) => {
      html += `<tr style="border-top:1px solid var(--line)"><td style="padding:4px 8px;font-weight:500;white-space:nowrap">${esc(fo)}</td>`;
      days.forEach(a => {
        const c = shiftColor[a.shift_id] || '#8B949E';
        const ab = shiftAbbr[a.shift_id] || a.shift_id[0]?.toUpperCase() || '?';
        html += `<td style="padding:3px 4px;text-align:center${a.is_rest?';border-left:none':''}">${a.is_rest
          ? `<span style="color:#8B949E;font-size:9px">-</span>`
          : `<span style="background:${c}22;color:${c};border-radius:3px;padding:2px 4px;font-weight:700;font-size:9.5px">${ab}</span>`
        }</td>`;
      });
      html += `</tr>`;
    });

    html += `</tbody></table></div></div>`;
  });

  // Legend
  html += `<div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap">`;
  [['Morning','#2563EB','M'],['Afternoon','#D97706','A'],['Night','#7C3AED','N'],['Rest','#8B949E','-']].forEach(([label,c,ab]) => {
    html += `<span style="font-size:10px;display:flex;align-items:center;gap:4px"><span style="background:${c}22;color:${c};border-radius:3px;padding:1px 5px;font-weight:700">${ab}</span>${label}</span>`;
  });
  html += `</div>`;

  preview.innerHTML = html;
  document.getElementById('rota-save-btn').style.display = '';
}

async function saveRotaToPlanning() {
  if (!_rotaPreviewData) return;
  const res = await fetch(`${API}/api/rota/save`, {
    method: 'POST', headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(_rotaPreviewData)
  });
  if (res.status === 401) { toast('Admin session expired — please sign in again.', 'error'); return; }
  const d = await res.json();
  toast(`${d.saved} shifts saved to planning`, 'success');
  document.getElementById('rota-save-btn').style.display = 'none';
  document.getElementById('rota-preview').innerHTML = '';
  _rotaPreviewData = null;
  await loadAll();
}

