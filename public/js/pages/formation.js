// ══════════════════════════════════════════════════════════════
// FORMATION DIGITALVIEW (page « digitalview »)
//
// La formation vit dans public/formation/digitalview.html, ouverte en
// pleine page dans une iframe de même origine : elle lit l'agent identifié
// dans l'app et enregistre sa progression sur le serveur
// (digitalview-bridge.js, routes/formation.js).
//
// L'admin en session a en plus « Team progress » : où en est chacun.
// ══════════════════════════════════════════════════════════════
function renderDigitalView() {
  const f = document.getElementById('dv-frame');
  // Chargée à la première ouverture seulement ; ensuite on la garde telle
  // quelle, pour ne pas faire perdre la leçon en cours en changeant de page.
  if (f && !f.getAttribute('src')) f.setAttribute('src', '/formation/digitalview.html');
  const btn = document.getElementById('dv-team-btn');
  if (btn) btn.hidden = !(typeof AdminSession !== 'undefined' && AdminSession.active);
}

// Deux formations sur le même moteur : DigitalView et Process ITSM.
// `course` choisit la boîte, les routes et le titre de la vue d'équipe.
const DV_COURSES = {
  // La boîte vit dans l'Academy (seule page qui ouvre les formations).
  digitalview: { box: 'ac-team', titre: 'DigitalView', api: '/api/formation/progress' },
  process:     { box: 'ac-team', titre: 'Process ITSM', api: '/api/formation/process/progress' },
};

function renderProcessTraining() {
  const f = document.getElementById('pt-frame');
  if (f && !f.getAttribute('src')) f.setAttribute('src', '/formation/process.html');
  const btn = document.getElementById('pt-team-btn');
  if (btn) btn.hidden = !(typeof AdminSession !== 'undefined' && AdminSession.active);
}

async function dvTeamOpen(course) {
  const C = DV_COURSES[course] || DV_COURSES.digitalview;
  const key = DV_COURSES[course] ? course : 'digitalview';
  const box = document.getElementById(C.box);
  if (!box) return;
  box.hidden = false;
  box.innerHTML = `<div class="dv-team-dlg"><div class="dv-team-h"><b>${C.titre} · team progress</b>
    <span style="display:flex;gap:8px;align-items:center">
      <button type="button" class="dv-json" onclick="dvExportJson(this,'${key}')">Export JSON</button>
      <button type="button" class="dv-team-x" onclick="dvTeamClose('${key}')" aria-label="Close">×</button></span></div>
    <div class="dv-team-body">Loading…</div></div>`;
  const body = box.querySelector('.dv-team-body');
  try {
    const r = await fetch(`${API}${C.api}`, { headers: AdminSession.headers(), credentials: 'same-origin' });
    const list = r.ok ? await r.json() : [];
    if (!r.ok) throw new Error('Access denied');
    const fo = (state.config && state.config.fo_list) || [];
    const vus = new Set(list.map(x => String(x.name || '').toLowerCase()));
    const absents = fo.filter(n => !vus.has(String(n).toLowerCase()));
    const pct = x => x.total ? Math.round(x.done / x.total * 100) : null;
    body.innerHTML = (list.length ? `<div class="dv-row is-h"><span>Agent</span><span>Lessons</span><span>Streak · XP</span><span>To review</span><span>Last activity</span></div>`
      + list.map(x => `<div class="dv-row">
        <span><b>${esc(x.name || x.id)}</b><small>${esc(x.id)}</small></span>
        <span><span class="dv-bar"><i style="width:${pct(x) ?? 0}%"></i></span> ${x.done}${x.total ? ` / ${x.total}` : ''}</span>
        <span>${x.streak ? `🔥 ${x.streak} d` : '—'}${x.xp ? ` · ${x.xp} XP` : ''}</span>
        <span>${x.to_review || 0}</span>
        <span>${x.updated_at ? esc(fmtDt(x.updated_at)) : '—'}</span>
      </div>`).join('') : '<div class="dv-none">Nobody has started the training yet.</div>')
      + (absents.length ? `<div class="dv-absents"><b>Not started yet:</b> ${absents.map(esc).join(', ')}</div>` : '');
  } catch (e) {
    body.innerHTML = `<div class="dv-none">${esc(e.message)}</div>`;
  }
}
// Téléchargement du fichier JSON de progression (admin).
async function dvExportJson(btn, course) {
  const C = DV_COURSES[course] || DV_COURSES.digitalview;
  if (btn) btn.disabled = true;
  try {
    const r = await fetch(`${API}${C.api}.json`, { headers: AdminSession.headers(), credentials: 'same-origin' });
    if (!r.ok) throw new Error('Export impossible');
    const blob = await r.blob();
    const nom = (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'digitalview-progress.json';
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: nom });
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  } catch (e) { toast(e.message, 'error'); }
  finally { if (btn) btn.disabled = false; }
}

function dvTeamClose(course) {
  const C = DV_COURSES[course] || DV_COURSES.digitalview;
  const b = document.getElementById(C.box); if (b) b.hidden = true;
}

window.renderDigitalView = renderDigitalView;
window.renderProcessTraining = renderProcessTraining;
window.dvTeamOpen = dvTeamOpen;
window.dvTeamClose = dvTeamClose;
window.dvExportJson = dvExportJson;
