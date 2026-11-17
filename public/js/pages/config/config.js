// ── CONFIG ───────────────────────────────────────────────────
// switchConfigTab a disparu avec la barre d'onglets : chaque rubrique
// est maintenant une page, atteinte par renderPage('cfg-…').

// ── GLOSSAIRE LOGS (localStorage) ──
const LOG_ANALYZER_DEFAULT_GLOSSARY = {
  "snmp": "Protocole de supervision reseau",
  "sftp": "Protocole de transfert de fichiers securise",
  "ftp": "Protocole de transfert de fichiers",
  "cpu": "Unite centrale de traitement",
  "mem": "Memoire",
  "disk": "Disque de stockage",
  "timeout": "Depassement de delai de reponse",
  "auth": "Authentification"
};
const LOG_ANALYZER_GLOSSARY_KEY = 'logAnalyzer.customGlossary';

function loadLogAnalyzerCustomGlossary() {
  try {
    const raw = localStorage.getItem(LOG_ANALYZER_GLOSSARY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveLogAnalyzerCustomGlossary(custom) {
  localStorage.setItem(LOG_ANALYZER_GLOSSARY_KEY, JSON.stringify(custom));
}

function renderGlossaryConfig() {
  const custom = loadLogAnalyzerCustomGlossary();
  const merged = { ...LOG_ANALYZER_DEFAULT_GLOSSARY, ...custom };
  const terms = Object.keys(merged).sort();
  const body = document.getElementById('config-glossary-body');
  if (!body) return;
  body.innerHTML = terms.map(term => {
    const isCustom = custom.hasOwnProperty(term);
    const termEsc = term.replace(/'/g, "\\'");
    return `<tr style="border-top:1px solid var(--line)">
      <td style="padding:8px 10px;font-family:monospace;font-weight:600;white-space:nowrap">${esc(term)}${isCustom ? ' <span style="font-size:9px;color:var(--accent,#2563eb);font-weight:700">PERSO</span>' : ''}</td>
      <td style="padding:8px 10px">${esc(merged[term])}</td>
      <td style="padding:8px 10px">${isCustom ? `<button onclick="removeGlossaryTermCfg('${termEsc}')" style="background:none;border:none;cursor:pointer;color:var(--mute);font-size:11px;font-weight:600">Suppr.</button>` : ''}</td>
    </tr>`;
  }).join('');
}

function addGlossaryTermCfg() {
  const termEl = document.getElementById('new-glossary-term');
  const defEl = document.getElementById('new-glossary-def');
  const term = (termEl.value || '').trim().toLowerCase();
  const def = (defEl.value || '').trim();
  if (!term || !def) return;
  const custom = loadLogAnalyzerCustomGlossary();
  custom[term] = def;
  saveLogAnalyzerCustomGlossary(custom);
  termEl.value = '';
  defEl.value = '';
  renderGlossaryConfig();
}

function removeGlossaryTermCfg(term) {
  const custom = loadLogAnalyzerCustomGlossary();
  delete custom[term];
  saveLogAnalyzerCustomGlossary(custom);
  renderGlossaryConfig();
}

function importGlossaryJsonCfg() {
  const input = document.getElementById('glossary-json-input');
  const status = document.getElementById('glossary-json-status');
  const raw = (input.value || '').trim();
  if (!raw) return;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    status.textContent = 'JSON invalide : ' + e.message;
    status.style.color = 'var(--red)';
    return;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    status.textContent = 'The JSON must be an object { "keyword": "definition", ... }';
    status.style.color = 'var(--red)';
    return;
  }
  const custom = loadLogAnalyzerCustomGlossary();
  let count = 0;
  Object.keys(parsed).forEach(key => {
    const term = key.trim().toLowerCase();
    const def = String(parsed[key] || '').trim();
    if (term && def) {
      custom[term] = def;
      count++;
    }
  });
  saveLogAnalyzerCustomGlossary(custom);
  input.value = '';
  status.textContent = count + ' terme(s) importe(s).';
  status.style.color = 'var(--mute)';
  renderGlossaryConfig();
}

function renderConfig() {
  const cfg = state.config;
  renderGoalsConfig();
  renderAbsenceAllowList();
  const tag = (label, onRemove) =>
    `<span style="background:var(--bg2);border:1px solid var(--line);padding:4px 10px;border-radius:20px;font-size:12px;display:inline-flex;align-items:center;gap:6px">
      ${esc(label)}<button onclick="${onRemove}" style="background:none;border:none;cursor:pointer;color:var(--mute);font-size:15px;line-height:1;padding:0">×</button>
    </span>`;

  document.getElementById('config-domains').innerHTML =
    (cfg.domains||[]).map(d => tag(d, `removeDomain('${d}')`)).join('');

  // Ticket statuses
  const tsEl = document.getElementById('config-ticket-statuses');
  if (tsEl) {
    tsEl.innerHTML = (cfg.ticket_statuses||[]).map(s => tag(s, `removeTicketStatus('${s.replace(/'/g,"\\'")}')`)).join('');
  }

  const foTrackers = cfg.fo_trackers || {};
  document.getElementById('config-fo-list').innerHTML =
    (cfg.fo_list||[]).map(fo => {
      const tr = foTrackers[fo] || 'SN';
      const trColor = tr === 'CI' ? 'var(--p2-fg)' : 'var(--ok-fg)';
      const trBg    = tr === 'CI' ? 'var(--p2-bg)'  : 'var(--ok-bg)';
      const foEsc = fo.replace(/'/g, "\\'");
      // L'ID est cliquable : c'est le seul moyen de le corriger, et un
      // agent sans ID doit rester repérable d'un coup d'œil.
      const fid = (cfg.fo_ids || {})[fo] || '';
      const idBtn = `<button onclick="editFoId('${foEsc}')" title="${fid ? 'Modifier' : 'Ajouter'} l’ID employé"
        style="font-size:10px;font-family:monospace;padding:1px 6px;border-radius:3px;cursor:pointer;
               border:1px dashed ${fid ? 'transparent' : 'var(--mute)'};
               background:${fid ? 'var(--white)' : 'transparent'};
               color:${fid ? 'var(--dark)' : 'var(--mute)'}">${fid ? esc(fid) : '+ ID'}</button>`;
      return `<span style="background:var(--bg2);border:1px solid var(--line);padding:4px 10px;border-radius:20px;font-size:12px;display:inline-flex;align-items:center;gap:6px">
        <button onclick="renameFo('${foEsc}')" title="Renommer partout"
          style="background:none;border:none;padding:0;cursor:pointer;font:inherit;color:inherit">${esc(fo)} <span style="color:var(--mute);font-size:11px">✎</span></button>
        ${idBtn}
        <button onclick="toggleFoTracker('${foEsc}')" style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;border:none;cursor:pointer;background:${trBg};color:${trColor}">${tr}</button>
        <button onclick="removeFo('${foEsc}')" style="background:none;border:none;cursor:pointer;color:var(--mute);font-size:15px;line-height:1;padding:0">×</button>
      </span>`;
    }).join('');

  document.getElementById('cfg-tref-osn').value = cfg.tref_osn||'Occur Time';
  document.getElementById('cfg-tref-oci').value = cfg.tref_oci||'Occur Time';

  // Work mode selector
  const wmEl = document.getElementById('cfg-work-mode');
  if (wmEl) wmEl.value = cfg.work_mode || 'live';
  updateSLAModeHint();

  // SLA table - hours + per-row Cal/Biz toggle (dual-leg rows for Workaround/Final SLAs)
  // Une ligne de réglage SLA, façon liste Material : nom, durée
  // soulignée, équivalent en jours, puis la bascule Cal/Biz.
  const _slaRow = (k, leg, hours, mode, label) => {
    const legAttr = leg ? ` data-sla-leg="${leg}"` : '';
    const seg = (val, txt, title) => `<button type="button" class="gsla-seg-btn"
        data-mode="${val}" aria-pressed="${mode === val}" title="${title}"
        onclick="toggleSLAMode(this)">${txt}</button>`;
    return `<div class="gsla-row${leg ? ' is-leg' : ''}">
      <span class="gsla-name" title="${esc(k)}">${esc(label)}</span>
      <span class="gsla-num">
        <input type="number" min="1" data-sla-key="${esc(k)}"${legAttr} value="${hours}"
          aria-label="${esc(label)} — time in hours" oninput="updateSlaEq(this)">
        <span class="gsla-unit">h</span>
      </span>
      <span class="gsla-eq">${slaEqLabel(hours)}</span>
      <span class="gsla-seg" role="group" aria-label="Counting mode"
            data-sla-mode-key="${esc(k)}"${legAttr} data-sla-mode-val="${mode}">
        ${seg('calendar', 'Cal', 'Calendaire — week-ends inclus')}
        ${seg('business', 'Biz', 'Business — weekends excluded')}
      </span>
    </div>`;
  };
  document.getElementById('config-sla').innerHTML = Object.entries(cfg.sla_hours||{}).map(([k,v]) => {
    if (isDualSLAEntry(v)) {
      const wa    = normSLAEntry(v.workaround || {});
      const final = normSLAEntry(v.final || {});
      return `<div class="gsla-group">
        <div class="gsla-group-t">${esc(k)}</div>
        ${_slaRow(k, 'workaround', wa.hours, wa.mode, 'Workaround')}
        ${_slaRow(k, 'final', final.hours, final.mode, 'Final Resolution')}
      </div>`;
    }
    const { hours, mode } = normSLAEntry(v);
    return _slaRow(k, '', hours, mode, k);
  }).join('');
  syncWorkModeRadios();

  // BO list
  renderBOList();

  // FO performance/engagement ratings
  renderFoRatings();

  // Rota config
  renderRotaConfig();

  // Quiz questions
  renderQuizManage();
}

function renderBOList() {
  const el = document.getElementById('bo-table-wrap');
  if (!el) return;
  const list = state.boList || [];
  if (!list.length) { el.innerHTML = '<div style="color:var(--mute);font-size:12px;padding:4px 0">No BO registered</div>'; return; }
  el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px">
    <thead><tr style="background:var(--bg2)">
      <th style="padding:7px 10px;text-align:left;font-weight:600;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--gray)">Nom</th>
      <th style="padding:7px 10px;text-align:left;font-weight:600;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--gray)">ID BO</th>
      <th style="padding:7px 10px;width:40px"></th>
    </tr></thead>
    <tbody>${list.map(bo => `
    <tr style="border-top:1px solid var(--line)">
      <td style="padding:7px 10px">${esc(bo.name)}</td>
      <td style="padding:7px 10px;font-family:'JetBrains Mono',monospace;color:var(--mute)">${esc(bo.phone||'-')}</td>
      <td style="padding:7px 10px">
        <button onclick="removeBO('${bo.id}')" style="background:none;border:none;cursor:pointer;color:var(--mute);font-size:16px;line-height:1;padding:0" title="Delete">×</button>
      </td>
    </tr>`).join('')}</tbody>
  </table>`;
}

async function saveApprovalPassword() {
  const input = document.getElementById('approval-password-input');
  const pw = input?.value.trim();
  if (!pw) { toast('Enter a password', 'error'); return; }
  const res = await fetch(`${API}/api/config`, { method: 'PUT', headers: AdminSession.headers({ 'Content-Type': 'application/json' }), credentials: 'same-origin', body: JSON.stringify({ approval_password: pw }) });
  state.config = await res.json();
  input.value = '';
  toast('Approval password updated', 'success');
}

async function addBO() {
  const name  = document.getElementById('new-bo-name')?.value.trim();
  const phone = document.getElementById('new-bo-phone')?.value.trim();
  if (!name) return;
  const res = await fetch(`${API}/api/bo`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name, phone}) });
  if (res.status === 409) { toast('This BO already exists', 'error'); return; }
  const bo = await res.json();
  state.boList.push(bo);
  document.getElementById('new-bo-name').value  = '';
  document.getElementById('new-bo-phone').value = '';
  renderBOList();
  toast('BO added', 'success');
}

async function removeBO(id) {
  await fetch(`${API}/api/bo/${id}`, { method:'DELETE' });
  state.boList = state.boList.filter(b => b.id !== id);
  renderBOList();
  toast('BO deleted', 'success');
}

async function saveSLAMode() {
  // Le choix se fait sur les cartes radio ; le <select> masqué reste la
  // source lue par le reste du code, on le remet d'abord d'aplomb.
  const picked = document.querySelector('input[name="cfg-work-mode-opt"]:checked');
  const sel    = document.getElementById('cfg-work-mode');
  if (picked && sel) sel.value = picked.value;
  const workMode = sel?.value || 'live';
  const cfg = { ...state.config, work_mode: workMode };
  await fetch(`${API}/api/config`, { method:'PUT', headers: AdminSession.headers({'Content-Type':'application/json'}), credentials:'same-origin', body: JSON.stringify(cfg) });
  await loadConfig();
  await loadAll();
  if (document.getElementById('page-sn')?.classList.contains('active'))  renderTracker('sn');
  if (document.getElementById('page-ci')?.classList.contains('active'))  renderTracker('ci');
  if (document.getElementById('page-dashboard')?.classList.contains('active')) renderDashboard();
  updateSLAModeHint();
  const labels = { live:'Live 24/7 - horloge continue', drill:'Drill 8:30–17:30 - business hours' };
  toast(`Work mode : ${labels[workMode]}`, 'success');
}

function updateSLAModeHint() {
  const wm   = document.getElementById('cfg-work-mode')?.value || 'live';
  const hint = document.getElementById('cfg-sla-hint');
  if (!hint) return;
  const desc = {
    live:  'Live - continuous 24/7 clock · the Cal/Biz mode of each SLA decides whether weekends count',
    drill: 'Drill - 8:30–17:30 only · the Cal/Biz mode decides whether weekends are included',
  };
  hint.textContent = desc[wm] || '';
}
async function addDomain() {
  const val = document.getElementById('new-domain').value.trim().toUpperCase();
  if (!val) return;
  const cfg = { ...state.config, domains: [...(state.config.domains||[]), val] };
  await fetch(`${API}/api/config`, { method:'PUT', headers: AdminSession.headers({'Content-Type':'application/json'}), credentials:'same-origin', body: JSON.stringify(cfg) });
  await loadConfig(); renderConfig(); document.getElementById('new-domain').value='';
}
async function removeDomain(d) {
  const cfg = { ...state.config, domains:(state.config.domains||[]).filter(x=>x!==d) };
  await fetch(`${API}/api/config`, { method:'PUT', headers: AdminSession.headers({'Content-Type':'application/json'}), credentials:'same-origin', body: JSON.stringify(cfg) });
  await loadConfig(); renderConfig();
}
async function addTicketStatus() {
  const val = document.getElementById('new-ticket-status').value.trim();
  if (!val) return;
  if ((state.config.ticket_statuses||[]).some(s => s.toLowerCase() === val.toLowerCase())) {
    toast('This status already exists', 'error'); return;
  }
  const cfg = { ...state.config, ticket_statuses: [...(state.config.ticket_statuses||[]), val] };
  await fetch(`${API}/api/config`, { method:'PUT', headers: AdminSession.headers({'Content-Type':'application/json'}), credentials:'same-origin', body: JSON.stringify(cfg) });
  await loadConfig(); renderConfig();
  document.getElementById('new-ticket-status').value='';
}
async function removeTicketStatus(s) {
  const cfg = { ...state.config, ticket_statuses:(state.config.ticket_statuses||[]).filter(x=>x!==s) };
  await fetch(`${API}/api/config`, { method:'PUT', headers: AdminSession.headers({'Content-Type':'application/json'}), credentials:'same-origin', body: JSON.stringify(cfg) });
  await loadConfig(); renderConfig();
}
// Format d'ID employé, aligné sur le contrôle serveur de /api/presence/ping
// et sur celui de la saisie d'identité. Un seul format pour toute l'app.
const FO_ID_RE = /^[a-zA-Z]{1,2}\d{7,8}$/;

// Les ID vivent dans config.fo_ids[nom], à côté de fo_trackers : même
// motif, et fo_list reste une simple liste de noms — la changer en objets
// casserait tous les écrans qui la parcourent.
function foIdOf(fo) { return (state.config.fo_ids || {})[fo] || ''; }

async function addFo() {
  const val = document.getElementById('new-fo').value.trim();
  const tracker = document.getElementById('new-fo-tracker')?.value || 'SN';
  const idEl = document.getElementById('new-fo-id');
  const id = (idEl?.value || '').trim();
  if (!val) return;
  if ((state.config.fo_list||[]).some(fo => fo.toLowerCase() === val.toLowerCase())) {
    toast('This FO already exists', 'error'); return;
  }
  // L'ID reste facultatif — on n'empêche pas d'ajouter un agent parce que
  // son ID n'est pas encore connu — mais s'il est saisi, il doit être valide.
  if (id && !FO_ID_RE.test(id)) {
    toast('ID employé invalide (ex : h50056630 ou wx1488808)', 'error'); return;
  }
  if (id && Object.entries(state.config.fo_ids || {})
      .some(([fo, v]) => fo !== val && String(v).toLowerCase() === id.toLowerCase())) {
    toast('This Employee ID is already assigned to another agent', 'error'); return;
  }

  const foTrackers = { ...(state.config.fo_trackers||{}), [val]: tracker };
  const foIds = { ...(state.config.fo_ids || {}) };
  if (id) foIds[val] = id;
  const cfg = { ...state.config, fo_list: [...(state.config.fo_list||[]), val], fo_trackers: foTrackers, fo_ids: foIds };
  await fetch(`${API}/api/config`, { method:'PUT', headers: AdminSession.headers({'Content-Type':'application/json'}), credentials:'same-origin', body: JSON.stringify(cfg) });
  await loadConfig(); renderConfig();
  document.getElementById('new-fo').value = '';
  if (idEl) idEl.value = '';
  toast('FO added', 'success');
}

// Saisie ou correction de l'ID d'un agent déjà dans la liste.
async function editFoId(fo) {
  const cur = foIdOf(fo);
  const val = prompt(`ID employé de ${fo} :\n\n(ex : h50056630 ou wx1488808 — laisser vide pour retirer)`, cur);
  if (val === null) return;                 // annulation
  const id = val.trim();
  if (id && !FO_ID_RE.test(id))
    return toast('ID employé invalide (ex : h50056630 ou wx1488808)', 'error');
  if (id && Object.entries(state.config.fo_ids || {})
      .some(([n, v]) => n !== fo && String(v).toLowerCase() === id.toLowerCase()))
    return toast('This Employee ID is already assigned to another agent', 'error');

  const foIds = { ...(state.config.fo_ids || {}) };
  if (id) foIds[fo] = id; else delete foIds[fo];
  const cfg = { ...state.config, fo_ids: foIds };
  await fetch(`${API}/api/config`, { method:'PUT', headers: AdminSession.headers({'Content-Type':'application/json'}), credentials:'same-origin', body: JSON.stringify(cfg) });
  await loadConfig(); renderConfig();
  toast(id ? `${fo}'s ID saved` : `${fo}'s ID removed`, 'success');
}
// Corrige le nom d'un agent dans TOUTES les données (tâches, notes,
// objectifs, planning, tickets…) : changer la seule liste le détacherait
// de tout son historique. Voir server/services/rename-agent.js.
async function renameFo(fo) {
  const val = prompt(`Nouveau nom pour ${fo} :\n\nIl sera corrigé partout : tâches, performance, objectifs, planning, tickets, rapports.`, fo);
  if (val === null) return;
  const to = val.trim().replace(/\s+/g, ' ');
  if (!to || to === fo) return;
  if (!confirm(`Renommer « ${fo} » en « ${to} » dans toutes les données ?`)) return;
  const envoyer = fusion => fetch(`${API}/api/fo/rename`, {
    method: 'POST', headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
    credentials: 'same-origin', body: JSON.stringify({ from: fo, to, fusion }),
  });
  let res = await envoyer(false);
  let d = await res.json().catch(() => ({}));
  if (res.status === 409 && d.fusion_possible) {
    if (!confirm(`« ${to} » existe déjà. Fusionner les deux : toutes les données de « ${fo} » passent sous « ${to} » ?`)) return;
    res = await envoyer(true);
    d = await res.json().catch(() => ({}));
  }
  if (!res.ok) return toast(d.error || 'Renommage impossible', 'error');
  await loadConfig(); renderConfig();
  if (typeof loadAll === 'function') loadAll().catch(() => {});
  toast(`« ${to} » : ${d.total} mention(s) corrigée(s)`, 'success');
}

async function toggleFoTracker(fo) {
  const cur = (state.config.fo_trackers||{})[fo] || 'SN';
  const next = cur === 'SN' ? 'CI' : 'SN';
  const foTrackers = { ...(state.config.fo_trackers||{}), [fo]: next };
  const cfg = { ...state.config, fo_trackers: foTrackers };
  await fetch(`${API}/api/config`, { method:'PUT', headers: AdminSession.headers({'Content-Type':'application/json'}), credentials:'same-origin', body: JSON.stringify(cfg) });
  await loadConfig(); renderConfig();
}
async function removeFo(fo) {
  const foTrackers = { ...(state.config.fo_trackers||{}) };
  delete foTrackers[fo];
  // L'ID part avec l'agent : le laisser réserverait un identifiant pour
  // quelqu'un qui n'est plus dans l'équipe.
  const foIds = { ...(state.config.fo_ids || {}) };
  delete foIds[fo];
  const cfg = { ...state.config, fo_list: (state.config.fo_list||[]).filter(x => x !== fo), fo_trackers: foTrackers, fo_ids: foIds };
  await fetch(`${API}/api/config`, { method:'PUT', headers: AdminSession.headers({'Content-Type':'application/json'}), credentials:'same-origin', body: JSON.stringify(cfg) });
  await loadConfig(); renderConfig();
  toast('FO deleted', 'success');
}

function renderFoRatings() {
  const el = document.getElementById('config-fo-ratings');
  if (!el) return;
  const foList = state.config.fo_list || [];
  const perf = state.config.fo_performance || {};
  const eng  = state.config.fo_engagement || {};
  if (!foList.length) { el.innerHTML = '<div style="color:var(--mute);font-size:12px">No FO configured</div>'; return; }
  el.innerHTML = foList.map(fo => `
    <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line)">
      <span style="flex:1;min-width:0;font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(fo)}">${esc(fo)}</span>
      <label style="display:flex;align-items:center;gap:5px;font-size:10.5px;color:var(--mute)">Perf.
        <input type="number" min="0" max="100" data-fo-perf="${esc(fo)}" value="${perf[fo] ?? 50}"
          style="width:54px;font-family:'JetBrains Mono',monospace;font-weight:600;border:1px solid var(--line);border-radius:4px;padding:2px 6px;font-size:12px;text-align:right;background:var(--input-bg)">
      </label>
      <label style="display:flex;align-items:center;gap:5px;font-size:10.5px;color:var(--mute)">Engag.
        <input type="number" min="0" max="100" data-fo-eng="${esc(fo)}" value="${eng[fo] ?? 50}"
          style="width:54px;font-family:'JetBrains Mono',monospace;font-weight:600;border:1px solid var(--line);border-radius:4px;padding:2px 6px;font-size:12px;text-align:right;background:var(--input-bg)">
      </label>
    </div>
  `).join('') + `<div style="margin-top:12px"><button class="btn btn-primary btn-sm" onclick="saveFoRatings()">Save ratings</button></div>`;
}

async function saveFoRatings() {
  const perf = {}, eng = {};
  document.querySelectorAll('#config-fo-ratings [data-fo-perf]').forEach(inp => {
    perf[inp.getAttribute('data-fo-perf')] = Math.max(0, Math.min(100, Number(inp.value) || 0));
  });
  document.querySelectorAll('#config-fo-ratings [data-fo-eng]').forEach(inp => {
    eng[inp.getAttribute('data-fo-eng')] = Math.max(0, Math.min(100, Number(inp.value) || 0));
  });
  const cfg = { ...state.config, fo_performance: perf, fo_engagement: eng };
  await fetch(`${API}/api/config`, { method:'PUT', headers: AdminSession.headers({'Content-Type':'application/json'}), credentials:'same-origin', body: JSON.stringify(cfg) });
  await loadConfig();
  if (document.getElementById('page-dashboard')?.classList.contains('active')) renderDashboard();
  toast('FO ratings saved', 'success');
}
async function saveTimeRef() {
  const cfg = { ...state.config, tref_osn: document.getElementById('cfg-tref-osn').value, tref_oci: document.getElementById('cfg-tref-oci').value };
  await fetch(`${API}/api/config`, { method:'PUT', headers: AdminSession.headers({'Content-Type':'application/json'}), credentials:'same-origin', body: JSON.stringify(cfg) });
  await loadConfig();
}
// Bascule Cal / Biz. L'état vit sur le conteneur (data-sla-mode-val) —
// c'est ce que relit saveSlaHours() — les deux boutons ne font que le
// refléter via aria-pressed.
function toggleSLAMode(btn) {
  const seg  = btn.closest('[data-sla-mode-key]');
  if (!seg) return;
  const next = btn.getAttribute('data-mode');
  seg.setAttribute('data-sla-mode-val', next);
  seg.querySelectorAll('.gsla-seg-btn').forEach(b => {
    b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === next));
  });
}

// Rappel de l'équivalent en jours à côté de la durée saisie : le
// contrat s'exprime en heures, l'exploitation raisonne en jours.
function slaEqLabel(hours) {
  const h = Number(hours);
  if (!isFinite(h) || h <= 0) return '';
  if (h < 24) return '';
  const d = h / 24;
  const txt = Number.isInteger(d) ? d : d.toFixed(1).replace(/\.0$/, '');
  return `≈ ${txt} j`;
}
function updateSlaEq(input) {
  const eq = input.closest('.gsla-row')?.querySelector('.gsla-eq');
  if (eq) eq.textContent = slaEqLabel(input.value);
}

// Les cartes radio pilotent le <select> masqué que le reste de
// l'application interroge encore par son identifiant.
function syncWorkModeRadios() {
  const sel = document.getElementById('cfg-work-mode');
  if (!sel) return;
  const wm = (state.config?.work_mode) || sel.value || 'live';
  sel.value = wm;
  document.querySelectorAll('input[name="cfg-work-mode-opt"]').forEach(r => {
    r.checked = (r.value === wm);
  });
  updateSLAModeHint();
}

