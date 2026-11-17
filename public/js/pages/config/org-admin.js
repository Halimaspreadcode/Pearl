// ══════════════════════════════════════════════════════════════
// CONFIGURATION › ORGANISATION (comptes SaaS)
//
// Réservé au propriétaire et aux administrateurs de l'organisation :
//   · marque blanche : nom affiché, couleur, logo, slogan ;
//   · modules actifs ;
//   · membres : invitation (mot de passe provisoire montré une fois),
//     rôle, personne de l'équipe associée, retrait.
// ══════════════════════════════════════════════════════════════
const ORG_ROLES = [
  ['owner', 'Propriétaire'], ['admin', 'Administrateur'], ['manager', 'Manager'],
  ['agent', 'Agent'], ['observer', 'Lecture seule'],
];
let _orgMods = null;

function _orgPeut() {
  const o = window.PearlOrg || {};
  return !!(o.accounts && o.account && ['owner', 'admin'].includes(o.account.role));
}

async function renderOrgAdmin() {
  const box = document.getElementById('org-admin');
  if (!box) return;
  const card = box.closest('.config-card');
  if (!_orgPeut()) { if (card) card.style.display = 'none'; return; }
  if (card) card.style.display = '';
  const o = window.PearlOrg;
  const b = (o.tenant && o.tenant.branding) || {};
  if (!_orgMods) _orgMods = await fetch('/api/platform/modules-catalog').then(r => r.json()).catch(() => []);
  const members = await fetch('/api/platform/members').then(r => r.ok ? r.json() : []).catch(() => []);
  const people = [...new Set([...(state.config.fo_list || []), ...((state.boList || []).map(x => x.name))])].filter(Boolean);
  const peopleOpts = sel => `<option value="">—</option>` + people.map(p => `<option value="${esc(p)}"${p === sel ? ' selected' : ''}>${esc(p)}</option>`).join('');
  const roleOpts = sel => ORG_ROLES.map(([v, l]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${l}</option>`).join('');

  box.innerHTML = `
    <div class="org-sec">
      <h4 style="margin:0 0 8px">Marque</h4>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <label style="flex:1;min-width:180px"><span class="form-label">Nom affiché</span><input class="form-control" id="org-name" maxlength="60" value="${esc(b.name || o.tenant.name || '')}"></label>
        <label><span class="form-label">Couleur</span><input class="form-control" id="org-primary" type="color" value="${esc(b.primary || '#4F6A85')}" style="width:64px;padding:2px"></label>
        <label style="flex:1;min-width:180px"><span class="form-label">Slogan</span><input class="form-control" id="org-tagline" maxlength="80" value="${esc(b.tagline || '')}"></label>
        <label style="flex:2;min-width:220px"><span class="form-label">Logo (URL https)</span><input class="form-control" id="org-logo" placeholder="https://…/logo.svg" value="${esc(b.logo && !b.logo.startsWith('data:') ? b.logo : '')}"></label>
        <label><span class="form-label">ou fichier</span><input type="file" id="org-logo-file" accept="image/png,image/svg+xml,image/jpeg,image/webp"></label>
        <button type="button" class="btn btn-primary btn-sm" onclick="orgSaveBranding()">Enregistrer la marque</button>
      </div>
    </div>
    <div class="org-sec" style="margin-top:18px">
      <h4 style="margin:0 0 8px">Modules</h4>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${_orgMods.map(m => `
        <label class="badge" style="display:inline-flex;gap:6px;align-items:center;padding:6px 10px;cursor:${m.always ? 'default' : 'pointer'}" title="${esc(m.desc)}">
          <input type="checkbox" class="org-mod" value="${esc(m.id)}" ${o.modules.includes(m.id) ? 'checked' : ''} ${m.always ? 'disabled' : ''}> ${esc(m.label)}
        </label>`).join('')}</div>
      <button type="button" class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="orgSaveModules()">Enregistrer les modules</button>
    </div>
    <div class="org-sec" style="margin-top:18px">
      <h4 style="margin:0 0 8px">Membres</h4>
      <table class="table" style="width:100%"><thead><tr><th>Email</th><th>Rôle</th><th>Personne de l’équipe</th><th></th></tr></thead><tbody>
        ${members.map(m => `<tr>
          <td>${esc(m.email || m.user_id)}</td>
          <td><select class="form-control" onchange="orgUpdateMember('${esc(m.user_id)}', { role: this.value })">${roleOpts(m.role)}</select></td>
          <td><select class="form-control" onchange="orgUpdateMember('${esc(m.user_id)}', { person_name: this.value })">${peopleOpts(m.person_name)}</select></td>
          <td><button type="button" class="btn btn-ghost btn-sm" onclick="orgRemoveMember('${esc(m.user_id)}')">Retirer</button></td>
        </tr>`).join('')}
      </tbody></table>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center">
        <input class="form-control" id="org-inv-email" type="email" placeholder="email@entreprise.com" style="flex:1;min-width:200px">
        <select class="form-control" id="org-inv-role" style="width:150px">${roleOpts('agent')}</select>
        <select class="form-control" id="org-inv-person" style="width:180px">${peopleOpts('')}</select>
        <button type="button" class="btn btn-primary btn-sm" onclick="orgInvite()">Inviter</button>
      </div>
      <div id="org-inv-result" style="margin-top:8px"></div>
    </div>`;
}

async function _orgSend(url, method, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

async function orgSaveBranding() {
  const body = {
    name: document.getElementById('org-name').value.trim(),
    primary: document.getElementById('org-primary').value,
    tagline: document.getElementById('org-tagline').value.trim(),
    logo: document.getElementById('org-logo').value.trim(),
  };
  const f = document.getElementById('org-logo-file').files[0];
  if (f) {
    if (f.size > 150 * 1024) { toast('Logo trop lourd (150 Ko maximum)', 'error'); return; }
    body.logo = await new Promise((ok, ko) => { const rd = new FileReader(); rd.onload = () => ok(rd.result); rd.onerror = ko; rd.readAsDataURL(f); });
  } else if (!body.logo) {
    const cur = ((window.PearlOrg.tenant || {}).branding || {}).logo;
    if (cur && cur.startsWith('data:')) body.logo = cur;
  }
  try { await _orgSend('/api/platform/branding', 'PUT', body); toast('Marque enregistrée', 'success'); await pearlReloadOrg(); location.reload(); }
  catch (e) { toast(e.message, 'error'); }
}

async function orgSaveModules() {
  const modules = [...document.querySelectorAll('.org-mod:checked')].map(x => x.value);
  try { await _orgSend('/api/platform/modules', 'PUT', { modules }); toast('Modules enregistrés', 'success'); location.reload(); }
  catch (e) { toast(e.message, 'error'); }
}

async function orgInvite() {
  const email = document.getElementById('org-inv-email').value.trim();
  const role = document.getElementById('org-inv-role').value;
  const person_name = document.getElementById('org-inv-person').value;
  const out = document.getElementById('org-inv-result');
  try {
    const j = await _orgSend('/api/platform/members', 'POST', { email, role, person_name });
    out.innerHTML = j.temp_password
      ? `<div class="badge" style="padding:8px 10px">Compte créé pour <b>${esc(j.email)}</b>. Mot de passe provisoire, à transmettre une seule fois : <code>${esc(j.temp_password)}</code></div>`
      : `<div class="badge" style="padding:8px 10px"><b>${esc(j.email)}</b> avait déjà un compte : il a maintenant accès à l’organisation.</div>`;
    renderOrgAdmin().then(() => { document.getElementById('org-inv-result').innerHTML = out.innerHTML; });
  } catch (e) { toast(e.message, 'error'); }
}

async function orgUpdateMember(uid, patch) {
  try { await _orgSend(`/api/platform/members/${encodeURIComponent(uid)}`, 'PUT', patch); toast('Membre mis à jour', 'success'); }
  catch (e) { toast(e.message, 'error'); renderOrgAdmin(); }
}

async function orgRemoveMember(uid) {
  if (!confirm('Retirer ce membre de l’organisation ?')) return;
  try { await _orgSend(`/api/platform/members/${encodeURIComponent(uid)}`, 'DELETE'); renderOrgAdmin(); }
  catch (e) { toast(e.message, 'error'); }
}
