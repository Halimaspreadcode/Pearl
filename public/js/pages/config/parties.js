// ══════════════════════════════════════════════════════════════
// RÔLES ET PARTIES PRENANTES (Configuration)
//
// FO et BO, plus les autres acteurs des tickets : SMC, DRPS… L'admin crée
// un rôle, y range des personnes (pays, graphies vues dans IMOC). Le rôle
// suit partout : vue par profil, code personnel, présence, IMOC.
// ══════════════════════════════════════════════════════════════
const PTY = { data: null, sel: '', err: '', edit: null, editRole: null, test: '', res: null };

async function _ptyFetch(url, opts = {}) {
  const r = await fetch(`${API}${url}`, { ...opts, credentials: 'same-origin', headers: AdminSession.headers({ 'Content-Type': 'application/json' }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Erreur ${r.status}`);
  return d;
}
async function renderParties() {
  try { PTY.data = await _ptyFetch('/api/parties'); PTY.err = ''; } catch (e) { PTY.err = e.message; PTY.data = PTY.data || { roles: [], people: [] }; }
  if (!PTY.sel) PTY.sel = PTY.data.roles[0]?.key || 'FO';
  _ptyPaint();
  // Les listes de rôles servies au reste de l'appli (barre, identité).
  if (typeof state !== 'undefined' && state.config) state.config.parties = { roles: PTY.data.roles, people: PTY.data.people.map(({ id, name, role, country }) => ({ id, name, role, country })) };
}

const _ptyPays = c => ({ SN: '🇸🇳 Sénégal', CI: '🇨🇮 Côte d\'Ivoire' }[c] || '—');

function _ptyPaint() {
  const root = document.getElementById('parties-root');
  if (!root || !PTY.data) return;
  const D = PTY.data;
  const nb = k => D.people.filter(p => p.role === k).length;
  const role = D.roles.find(r => r.key === PTY.sel);
  const rail = `
    <button type="button" class="pt-r${PTY.sel === 'FO' ? ' is-on' : ''}" onclick="ptySel('FO')"><i style="background:var(--pt-ink)"></i><span><b>FO</b><small>Front Office</small></span><em>${D.fo}</em></button>
    <button type="button" class="pt-r${PTY.sel === 'BO' ? ' is-on' : ''}" onclick="ptySel('BO')"><i style="background:var(--pt-mute)"></i><span><b>BO</b><small>Back Office</small></span><em>${D.bo}</em></button>
    ${D.roles.length ? '<div class="pt-sep">Autres rôles</div>' : ''}
    ${D.roles.map(r => `<button type="button" class="pt-r${PTY.sel === r.key ? ' is-on' : ''}" onclick="ptySel(${escAttrArg(r.key)})"><i style="background:${esc(r.color)}"></i><span><b>${esc(r.key)}</b><small>${esc(r.label)}</small></span><em>${nb(r.key)}</em></button>`).join('')}
    <button type="button" class="pt-add" onclick="ptyRoleEdit(null)">+ Nouveau rôle</button>`;
  let corps;
  if (PTY.editRole !== null) corps = _ptyRoleForm();
  else if (PTY.sel === 'FO' || PTY.sel === 'BO') corps = `<section class="pt-card">
      <h2>${PTY.sel === 'FO' ? 'Front Office' : 'Back Office'}</h2>
      <p class="pt-mute">Les ${PTY.sel} se gèrent dans leur liste habituelle : ${PTY.sel === 'FO' ? 'Configuration › Général (équipe FO) et la Shift Rota' : 'Configuration › Données (équipe Back Office)'}. Ils sont reconnus ici comme les autres rôles, notamment dans IMOC.</p>
      <button type="button" class="pt-btn" onclick="renderPage('${PTY.sel === 'FO' ? 'cfg-general' : 'cfg-data'}')">Ouvrir la liste ${PTY.sel}</button></section>`;
  else if (role) {
    const gens = D.people.filter(p => p.role === role.key).sort((a, b) => a.name.localeCompare(b.name));
    corps = `<section class="pt-card">
      <header class="pt-h"><div><span class="pt-tag" style="--c:${esc(role.color)}"><i></i>${esc(role.key)}</span><h2>${esc(role.label)}</h2>${role.desc ? `<p class="pt-mute">${esc(role.desc)}</p>` : ''}</div>
        <div class="pt-h-a"><button type="button" class="pt-btn" onclick="ptyRoleEdit(${escAttrArg(role.key)})">Modifier</button>
        <button type="button" class="pt-btn is-ghost" onclick="ptyRoleSuppr(${escAttrArg(role.key)})">Supprimer</button></div></header>
      <div class="pt-people">${gens.length ? gens.map(p => PTY.edit === p.id ? _ptyPersonneForm(p) : `<article class="pt-p">
          <div class="pt-av" style="background:${esc(role.color)}">${esc(p.name.split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase())}</div>
          <div class="pt-p-b"><b>${esc(p.name)}</b><small>${_ptyPays(p.country)}${p.email ? ` · ${esc(p.email)}` : ''}${p.phone ? ` · ${esc(p.phone)}` : ''}</small>
            ${(p.aliases || []).length ? `<div class="pt-alias">${p.aliases.map(a => `<span title="Graphie reconnue">${esc(a)}</span>`).join('')}</div>` : ''}</div>
          <button type="button" class="pt-btn is-sm" onclick="PTY.edit=${escAttrArg(p.id)};_ptyPaint()">Modifier</button></article>`).join('')
        : '<p class="pt-mute">Personne dans ce rôle pour l\'instant.</p>'}
        ${PTY.edit === 'new' ? _ptyPersonneForm({ role: role.key, country: '' }) : `<button type="button" class="pt-add" onclick="PTY.edit='new';_ptyPaint()">+ Ajouter une personne</button>`}
      </div></section>`;
  } else corps = '<section class="pt-card"><p class="pt-mute">Crée un premier rôle (ex. SMC — Service Management Center).</p></section>';

  const r = PTY.res;
  const test = `<section class="pt-card pt-test">
    <h3>Reconnaître un nom vu ailleurs</h3>
    <p class="pt-mute">Colle un nom tel qu'il apparaît dans IMOC (Initiator, Managing Owner technician…) : Pearl dit à qui il correspond.</p>
    <form onsubmit="event.preventDefault();ptyTester(this.q.value)"><input name="q" value="${esc(PTY.test)}" placeholder="ex. DIR/OPS/SMC-N/QSM MOREAU PIERRE ANTOINE" autocomplete="off"><button type="submit" class="pt-btn">Reconnaître</button></form>
    ${r ? (r.sur ? `<div class="pt-res is-ok"><span class="pt-tag" style="--c:${esc(r.color || '#141518')}"><i></i>${esc(r.role)}</span><b>${esc(r.name)}</b><small>${esc(r.role_label)}${r.country ? ` · ${_ptyPays(r.country)}` : ''} · reconnu par ${esc(r.via)}</small></div>`
      : `<div class="pt-res"><p>Nom lu : <b>${esc(r.nom)}</b>${r.org ? ` <small>· organisation « ${esc(r.org)} »</small>` : ''} — personne de connu.</p>
        ${(r.suggestions || []).length ? `<p class="pt-mute">C'est peut-être : ${r.suggestions.filter(x => x.id).map(x => `<button type="button" class="pt-chip" onclick="ptyAlias(${escAttrArg(x.id)},${escAttrArg(r.brut)})">${esc(x.name)} · ${esc(x.role)}</button>`).join(' ')}</p>` : ''}
        ${D.roles.length ? `<form class="pt-quick" onsubmit="event.preventDefault();ptyCreerDepuis(this)">
          <input name="name" value="${esc(r.nom)}" aria-label="Nom">
          <select name="role">${D.roles.map(x => `<option value="${esc(x.key)}"${x.key === r.role_devine ? ' selected' : ''}>${esc(x.key)} — ${esc(x.label)}</option>`).join('')}</select>
          <select name="country"><option value="">Pays…</option><option value="SN">Sénégal</option><option value="CI">Côte d'Ivoire</option></select>
          <button type="submit" class="pt-btn is-pri">Ajouter</button></form>
          <p class="pt-mute">La graphie « ${esc(r.brut)} » sera retenue : ce nom sera reconnu d'office la prochaine fois.</p>` : '<p class="pt-mute">Crée d\'abord un rôle pour pouvoir l\'y ranger.</p>'}</div>`) : ''}
  </section>`;

  root.innerHTML = `<div class="pt">
    <header class="pt-head"><div><h1 class="page-title">Rôles et parties prenantes</h1>
      <p class="page-sub">FO et BO, plus les autres acteurs des tickets (SMC, DRPS…). Un rôle créé ici a sa vue par profil, ses codes personnels, et ses membres sont reconnus dans IMOC.</p></div></header>
    ${PTY.err ? `<div class="pt-alert">${esc(PTY.err)}</div>` : ''}
    <div class="pt-cols"><nav class="pt-rail">${rail}</nav><div class="pt-main">${corps}${test}</div></div>
  </div>`;
}

function _ptyRoleForm() {
  const r = PTY.data.roles.find(x => x.key === PTY.editRole) || {};
  return `<section class="pt-card"><h2>${r.key ? `Modifier ${esc(r.key)}` : 'Nouveau rôle'}</h2>
    <form class="pt-form" onsubmit="event.preventDefault();ptyRoleSave(this)">
      <label><span>Sigle</span><input name="key" value="${esc(r.key || '')}" placeholder="SMC" maxlength="16" required></label>
      <label class="is-wide"><span>Nom</span><input name="label" value="${esc(r.label || '')}" placeholder="Service Management Center" required></label>
      <label class="is-wide"><span>Rôle dans les tickets</span><input name="desc" value="${esc(r.desc || '')}" placeholder="Ouvre et suit les incidents côté client"></label>
      <label><span>Couleur</span><input type="color" name="color" value="${esc(r.color || '#8E5BD9')}"></label>
      <div class="pt-form-a"><button type="button" class="pt-btn" onclick="PTY.editRole=null;_ptyPaint()">Annuler</button><button type="submit" class="pt-btn is-pri">Enregistrer</button></div>
    </form></section>`;
}
function _ptyPersonneForm(p) {
  return `<form class="pt-form pt-p-form" onsubmit="event.preventDefault();ptyPersonneSave(this,${escAttrArg(p.id || '')})">
    <label class="is-wide"><span>Nom</span><input name="name" value="${esc(p.name || '')}" placeholder="Pierre Antoine Moreau" required></label>
    <label><span>Rôle</span><select name="role">${PTY.data.roles.map(x => `<option value="${esc(x.key)}"${x.key === p.role ? ' selected' : ''}>${esc(x.key)}</option>`).join('')}</select></label>
    <label><span>Pays</span><select name="country"><option value="">—</option><option value="SN"${p.country === 'SN' ? ' selected' : ''}>Sénégal</option><option value="CI"${p.country === 'CI' ? ' selected' : ''}>Côte d'Ivoire</option></select></label>
    <label><span>E-mail</span><input name="email" value="${esc(p.email || '')}"></label>
    <label><span>Téléphone</span><input name="phone" value="${esc(p.phone || '')}"></label>
    <label class="is-full"><span>Graphies reconnues (une par ligne, telles que dans IMOC)</span><textarea name="aliases" rows="2" placeholder="DIR/OPS/SMC-N/QSM MOREAU PIERRE ANTOINE">${esc((p.aliases || []).join('\n'))}</textarea></label>
    <div class="pt-form-a">${p.id ? `<button type="button" class="pt-btn is-ghost" onclick="ptyPersonneSuppr(${escAttrArg(p.id)})">Retirer</button>` : ''}
      <button type="button" class="pt-btn" onclick="PTY.edit=null;_ptyPaint()">Annuler</button><button type="submit" class="pt-btn is-pri">Enregistrer</button></div>
  </form>`;
}

function ptySel(k) { PTY.sel = k; PTY.edit = null; PTY.editRole = null; _ptyPaint(); }
function ptyRoleEdit(k) { PTY.editRole = k || ''; _ptyPaint(); }
async function _ptyAct(fn) {
  try { await fn(); PTY.err = ''; } catch (e) { PTY.err = e.message; }
  await renderParties();
  if (typeof applyNavMode === 'function') try { applyNavMode(); } catch (_) {}
}
function ptyRoleSave(f) {
  const ancien = PTY.editRole || undefined;
  const body = { key: f.key.value, label: f.label.value, desc: f.desc.value, color: f.color.value, ancien };
  _ptyAct(async () => { const r = await _ptyFetch('/api/parties/roles', { method: 'POST', body: JSON.stringify(body) }); PTY.sel = r.key; PTY.editRole = null; });
}
function ptyRoleSuppr(k) {
  if (!confirm(`Supprimer le rôle ${k} ?`)) return;
  _ptyAct(async () => { await _ptyFetch(`/api/parties/roles/${encodeURIComponent(k)}`, { method: 'DELETE' }); PTY.sel = 'FO'; });
}
function ptyPersonneSave(f, id) {
  const body = { id: id || undefined, name: f.name.value, role: f.role.value, country: f.country.value, email: f.email.value, phone: f.phone.value, aliases: f.aliases.value };
  _ptyAct(async () => { const p = await _ptyFetch('/api/parties/people', { method: 'POST', body: JSON.stringify(body) }); PTY.edit = null; PTY.sel = p.role; });
}
function ptyPersonneSuppr(id) {
  if (!confirm('Retirer cette personne ?')) return;
  _ptyAct(async () => { await _ptyFetch(`/api/parties/people/${encodeURIComponent(id)}`, { method: 'DELETE' }); PTY.edit = null; });
}
async function ptyTester(q) {
  PTY.test = q;
  try { PTY.res = q.trim() ? await _ptyFetch(`/api/parties/reconnaitre?q=${encodeURIComponent(q)}`) : null; } catch (e) { PTY.err = e.message; }
  _ptyPaint();
}
function ptyAlias(id, alias) { _ptyAct(async () => { await _ptyFetch(`/api/parties/people/${encodeURIComponent(id)}/alias`, { method: 'POST', body: JSON.stringify({ alias }) }); PTY.res = null; }).then(() => ptyTester(PTY.test)); }
function ptyCreerDepuis(f) {
  const body = { name: f.name.value, role: f.role.value, country: f.country.value, aliases: [PTY.res.brut] };
  _ptyAct(async () => { const p = await _ptyFetch('/api/parties/people', { method: 'POST', body: JSON.stringify(body) }); PTY.sel = p.role; }).then(() => ptyTester(PTY.test));
}
