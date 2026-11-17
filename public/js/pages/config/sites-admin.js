// ══════════════════════════════════════════════════════════════
// CONFIGURATION › SITES
//
// Liste éditable des sites de l'organisation (PUT /api/sites). Un site
// retiré qui porte des tickets est refusé par le serveur ; l'admin peut
// alors confirmer l'archivage (les tickets sont conservés à part).
// ══════════════════════════════════════════════════════════════
let _sitesDraft = null;

function renderSitesAdmin() {
  const box = document.getElementById('sites-admin');
  if (!box) return;
  if (!_sitesDraft) _sitesDraft = siteList().map(s => ({ ...s, _known: true }));
  const row = (s, i) => `
    <div class="sites-row" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
      <input class="form-control idt-mono" style="width:96px;text-transform:uppercase" maxlength="8" placeholder="CODE"
        value="${esc(s.code)}" ${s._known && ticketsOf(s.code).length ? 'readonly title="Ce site a des tickets : son code est figé."' : ''}
        oninput="_sitesDraft[${i}].code = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '')" aria-label="Code">
      <input class="form-control" style="flex:1;min-width:140px" maxlength="60" placeholder="Nom (ex. Agence Lyon)"
        value="${esc(s.name || '')}" oninput="_sitesDraft[${i}].name = this.value" aria-label="Nom">
      <input class="form-control" style="width:140px" maxlength="60" placeholder="Ville"
        value="${esc(s.city || '')}" oninput="_sitesDraft[${i}].city = this.value" aria-label="Ville">
      <input class="form-control" style="width:140px" maxlength="60" placeholder="Pays"
        value="${esc(s.country || '')}" oninput="_sitesDraft[${i}].country = this.value" aria-label="Pays">
      <span class="text-muted" style="font-size:12px;min-width:70px">${s._known ? `${ticketsOf(s.code).length} ticket(s)` : 'nouveau'}</span>
      <button type="button" class="btn btn-ghost btn-sm" onclick="_sitesDraft.splice(${i}, 1); renderSitesAdmin()" aria-label="Retirer">Retirer</button>
    </div>`;
  box.innerHTML = (_sitesDraft.length ? _sitesDraft.map(row).join('') : '<div class="text-muted" style="margin-bottom:8px">Aucun site : ajoutez-en un pour créer des tickets.</div>')
    + `<div style="display:flex;gap:8px;margin-top:6px">
         <button type="button" class="btn btn-ghost btn-sm" onclick="_sitesDraft.push({ code: '', name: '', city: '', country: '' }); renderSitesAdmin()">+ Ajouter un site</button>
         <button type="button" class="btn btn-primary btn-sm" onclick="saveSitesAdmin()">Enregistrer les sites</button>
       </div>`;
}

async function saveSitesAdmin(archive) {
  const sites = (_sitesDraft || []).map(({ code, name, city, country }) => ({ code, name, city, country }));
  if (sites.some(s => !/^[A-Z0-9]{2,8}$/.test(s.code))) { toast('Chaque site a besoin d’un code de 2 à 8 lettres ou chiffres', 'error'); return; }
  const r = await fetch(`${API}/api/sites`, {
    method: 'PUT', headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ sites, archive: !!archive }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 409 && !archive) {
    if (confirm(`${j.error}\n\nArchiver ces tickets et retirer le(s) site(s) ?`)) return saveSitesAdmin(true);
    return;
  }
  if (!r.ok) { toast(j.error || 'Enregistrement impossible', 'error'); return; }
  toast('Sites enregistrés', 'success');
  _sitesDraft = null;
  await loadAll();
  renderSitesAdmin();
}
