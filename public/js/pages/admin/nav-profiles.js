/* ══════════════════════════════════════════════════════════════
   VUES PAR PROFIL (Admin › Vues par profil)

   La barre latérale compte une trentaine d'entrées. Chacune est
   justifiée, mais aucun métier ne les utilise toutes : un Back Office ne
   planifie pas de rotations, un observateur ne saisit rien. Le résultat
   est une barre qu'on parcourt au lieu de la lire.

   Plutôt que de décider à la place de l'équipe ce que chaque métier
   doit voir, l'admin compose ici la vue de chaque profil.

   C'est un réglage de confort, pas un contrôle d'accès : les pages
   protégées le restent par la session admin côté serveur. Retirer une
   entrée épargne un parcours, ça n'interdit pas d'y accéder par l'URL —
   et l'écran le dit, pour que personne ne s'en serve comme d'un verrou.
   ══════════════════════════════════════════════════════════════ */

// Les profils configurables. L'admin n'y figure pas : il voit tout, par
// construction, sinon il pourrait se retirer l'écran qui sert à revenir
// en arrière.
const NVP_PROFILS_BASE = [
  { key: 'FO',       label: 'Front Office', desc: 'Saisit les tickets, tient les rotations' },
  { key: 'BO',       label: 'Back Office',  desc: 'Traite ce que le FO escalade' },
  { key: 'Observer', label: 'Observateur',  desc: 'Consultation seule' },
  // Ceux qui ont ouvert Pear avec le mot de passe d'équipe, sans code
  // personnel : ils ne sont personne en particulier, on choisit ce qu'on
  // leur montre.
  { key: 'Guest',    label: 'Non connecté', desc: 'Mot de passe d’équipe, sans code personnel' },
];
// Rôles créés dans Configuration › Rôles et parties prenantes (SMC,
// DRPS…) : chacun a sa vue, placée avant Observateur.
function _nvpProfils() {
  const extra = ((state.config && state.config.parties && state.config.parties.roles) || [])
    .map(r => ({ key: r.key, label: r.key, desc: r.label }));
  const i = NVP_PROFILS_BASE.findIndex(p => p.key === 'Observer');
  return [...NVP_PROFILS_BASE.slice(0, i), ...extra, ...NVP_PROFILS_BASE.slice(i)];
}

// Les pages proposées, groupées comme dans la barre. Le libellé est
// celui de la barre : l'admin coche ce qu'il lit à l'écran. Daily
// Check-up (fo-tasks) n'y figure plus : son entrée est masquée pour tous,
// la cocher ne montrait rien.
const NVP_PAGES = [
  { grp: 'Général', items: [
    { id: 'dashboard',   l: 'Dashboard', fixe: true },
  ]},
  // Onglets de My Space (l'espace personnel de l'agent). Comme pour
  // Rapports, les clés restent celles des anciennes pages : les vues déjà
  // enregistrées gardent leur sens, et l'entrée My Space apparaît dès
  // qu'un onglet est coché (mon-espace.js). Today suit l'entrée.
  { grp: 'My Space', items: [
    { id: 'mes-today',       l: 'Today',       alias: 'onglet de My Space', resOnly: true },
    { id: 'weekly-progress', l: 'Tasks',       alias: 'onglet de My Space' },
    { id: 'my-requests',     l: 'Requests',    alias: 'onglet de My Space' },
    { id: 'my-perf',         l: 'Performance', alias: 'onglet de My Space' },
    { id: 'quiz',            l: 'Quiz',        alias: 'onglet de My Space' },
  ]},
  { grp: 'Trackers', items: [
    { id: 'site',        l: 'Tracker du site' },
    { id: 'global',      l: 'Tracker tous sites' },
  ]},
  { grp: 'Opérationnel', items: [
    { id: 'observations',    l: 'Observations' },
    { id: 'fo-dashboard',    l: 'FO Dashboard' },
    { id: 'fo-handover',     l: 'Handover Board' },
    { id: 'shift-planning',  l: 'Shift Planning' },
    { id: 'absences',        l: 'Absences' },
  ]},
  // Onglets de la page Rapports. Les clés restent celles des anciennes
  // pages : les vues déjà enregistrées gardent leur sens, et l'entrée
  // Rapports apparaît dès qu'un des trois est coché (reports-hub.js).
  { grp: 'Rapports', items: [
    { id: 'daily-report',   l: 'Daily',   alias: 'onglet de Rapports' },
    { id: 'weekly-report',  l: 'Weekly',  alias: 'onglet de Rapports' },
    { id: 'monthly-report', l: 'Monthly', alias: 'onglet de Rapports' },
    // Onglets admin : affichés pour que l'admin sache qu'ils existent et
    // pourquoi ils ne se cochent pas — aucun profil ne les voit.
    { id: 'ops-review', l: 'Ops Review', admin: true },
    { id: 'mailing',    l: 'Diffusion',  admin: true },
    { id: 'export',     l: 'Exports',    admin: true },
  ]},
  { grp: 'Outils', items: [
    { id: 'academy',      l: 'Academy (formations)' },
    { id: 'ideas',        l: 'Idea box' },
  ]},
  // Rappel de ce qui reste à l'admin quel que soit le profil. Rien à
  // cocher : ces entrées n'apparaissent qu'avec une session admin.
  { grp: 'Admin', items: [
    { id: 'config',          l: 'Vue d’ensemble', admin: true },
    { id: 'equipe',          l: 'Équipe',         admin: true },
    { id: 'cfg-annonces',    l: 'Annonces',       admin: true },
    { id: 'data-quality',    l: 'Data Quality',   admin: true },
    { id: 'audit',           l: 'Audit Trail',    admin: true },
    { id: 'ai',              l: 'Pear AI',    admin: true },
    { id: 'shift-approvals', l: 'Approbations',   admin: true },
  ]},
];

// Ce que la barre fait de ces cases, pour que l'écran ne surprenne pas.
const NVP_NOTES = {
  'My Space': 'Une seule entrée « My Space » dans la barre, avec les onglets cochés.',
  'Trackers': 'Un seul tracker dans la barre : celui du site choisi en haut. S\'il n\'est pas coché, c\'est un tracker coché qui s\'affiche à la place.',
  'Rapports': 'Une seule entrée « Rapports » dans la barre, avec les rapports cochés en onglets.',
};

// Pages qu'un profil peut réellement recevoir (hors entrées admin).
function _nvpItems(g) { return g.items.filter(i => !i.admin && !i.resOnly); }
// Today n'a pas de case dans les vues par profil (il suit l'entrée My
// Space) mais se réserve comme les autres onglets.
function _nvpResItems(g) { return g.items.filter(i => !i.admin); }

// Vue par défaut d'un profil, proposée tant que rien n'a été composé.
// Elle ne s'applique pas toute seule : c'est un point de départ à
// accepter, pas une décision prise à la place de l'admin.
const NVP_DEFAUTS = {
  FO: ['dashboard', 'site', 'observations', 'fo-dashboard', 'fo-handover',
       'shift-planning', 'my-requests', 'my-perf', 'absences',
       'weekly-progress', 'quiz', 'daily-report', 'academy', 'ideas'],
  BO: ['dashboard', 'site', 'global', 'observations', 'absences',
       'daily-report', 'weekly-report', 'ideas'],
  Observer: ['dashboard', 'global', 'fo-dashboard', 'daily-report',
             'weekly-report', 'monthly-report'],
  Guest: ['dashboard', 'global', 'daily-report', 'academy', 'ideas'],
};

const NvpUI = { profil: 'FO', draft: null, res: null };

function _nvpStored() { return (state.config && state.config.nav_profiles) || {}; }

// Brouillon de travail : on ne touche la config qu'à l'enregistrement,
// pour que quitter la page sans enregistrer ne change rien.
function _nvpDraft() {
  if (!NvpUI.draft) {
    const st = _nvpStored();
    NvpUI.draft = {};
    _nvpProfils().forEach(p => {
      NvpUI.draft[p.key] = Array.isArray(st[p.key]) ? [...st[p.key]] : null;
    });
  }
  return NvpUI.draft;
}

// Liste effective d'un profil : ce qui est composé, sinon rien (= pas de
// restriction). `null` et `[]` ne veulent pas dire la même chose — le
// premier est « non configuré », le second « tout masqué sauf le fixe ».
function _nvpListe(key) {
  const d = _nvpDraft()[key];
  return d === null || d === undefined ? null : d;
}

function renderNavProfiles() {
  const tabs = document.getElementById('nvp-tabs');
  if (tabs) {
    const n_res = Object.values(_nvpResDraft())
      .filter(v => Array.isArray(v) && v.length).length;
    tabs.innerHTML = _nvpProfils().map(p => {
      const l = _nvpListe(p.key);
      const on = p.key === NvpUI.profil && NvpUI.profil !== '_res';
      const n = l === null ? 'tout' : String(l.length);
      return `<button class="nvp-tab${on ? ' is-on' : ''}" role="tab" aria-selected="${on}"
        onclick="nvpSelect('${p.key}')">${esc(p.label)}<span>${n}</span></button>`;
    }).join('')
    + `<button class="nvp-tab nvp-tab-res${NvpUI.profil === '_res' ? ' is-on' : ''}"
        role="tab" aria-selected="${NvpUI.profil === '_res'}"
        onclick="nvpSelect('_res')">Pages réservées<span>${n_res}</span></button>`
    + `<button class="nvp-tab${NvpUI.profil === '_new' ? ' is-on' : ''}"
        role="tab" aria-selected="${NvpUI.profil === '_new'}"
        onclick="nvpSelect('_new')">Badge New<span>${Object.keys(_nvpNewActifs(_nvpNewDraft())).length}</span></button>`;
  }
  _nvpRenderBody();
}

function nvpSelect(key) { NvpUI.profil = key; renderNavProfiles(); }

// ── Pages réservées ───────────────────────────────────────────
// Couche distincte des vues par profil : celles-ci allègent une barre
// trop longue, celle-ci restreint. Une page réservée n'est visible que
// de l'admin en session et des ID nommément inscrits.
//
// Réglage de confort renforcé, pas un contrôle d'accès : ce qui protège
// réellement une page reste la session admin côté serveur. Masquer une
// entrée évite de la proposer, ça n'interdit pas d'y aller par l'URL —
// et l'écran le dit, pour que personne ne s'y fie comme à un verrou.
function _nvpResStored() { return (state.config && state.config.nav_reserved) || {}; }

function _nvpResDraft() {
  if (!NvpUI.res) {
    const st = _nvpResStored();
    NvpUI.res = {};
    Object.entries(st).forEach(([k, v]) => {
      if (Array.isArray(v) && v.length) NvpUI.res[k] = [...v];
    });
  }
  return NvpUI.res;
}

// Toutes les pages réservables : celles de la barre (vues par profil)
// plus les écrans d'administration, qui sont justement ceux qu'on veut
// pouvoir réserver à quelques personnes.
function _nvpResPages() {
  const nav = NVP_PAGES.flatMap(g => _nvpResItems(g).filter(i => !i.fixe)
    .map(i => ({ id: i.id, l: i.l, grp: g.grp })));
  // Les anciennes rubriques d'équipe ne sont plus que des onglets de la
  // page Équipe, sans entrée de menu : les réserver ne masquerait rien.
  // Idem pour Ops Review, Diffusion et Export, onglets admin de Rapports.
  const legacy = [...(typeof EQ_LEGACY_PAGES !== 'undefined' ? EQ_LEGACY_PAGES : []),
    ...(typeof RP_LEGACY_PAGES !== 'undefined' ? Object.keys(RP_LEGACY_PAGES) : [])];
  const admin = (typeof ADMIN_ONLY_PAGES !== 'undefined' ? ADMIN_ONLY_PAGES : [])
    .filter(id => !legacy.includes(id))
    .map(id => ({ id, l: _nvpAdminLabel(id), grp: 'Admin' }));
  return [...nav, ...admin];
}

// Libellé lisible d'une page admin : on le prend dans la barre si elle
// y figure, sinon dans le sommaire de Configuration, sinon l'identifiant.
function _nvpAdminLabel(id) {
  const el = document.querySelector(`.nav-item[data-page="${id}"] .nav-item-label`);
  if (el && el.textContent.trim()) return el.textContent.trim();
  const r = (typeof CFG_RUBRIQUES !== 'undefined' ? CFG_RUBRIQUES : [])
    .find(x => x.page === id);
  return (r && r.titre) || id;
}

// Nom de la personne derrière un ID (fiche agent), pour vérifier d'un coup
// d'œil qu'on a inscrit la bonne personne.
function _nvpNomDeId(id) {
  const x = String(id || '').trim().toLowerCase();
  const e = Object.entries((state.config && state.config.fo_ids) || {})
    .find(([, v]) => String(v || '').trim().toLowerCase() === x);
  return e ? e[0] : '';
}

function nvpResToggle(page, on) {
  const d = _nvpResDraft();
  if (on) { if (!d[page]) d[page] = []; }
  else delete d[page];
  renderNavProfiles();
}

function nvpResAddId(page) {
  const inp = document.getElementById(`nvp-res-in-${page}`);
  const raw = (inp && inp.value || '').trim();
  if (!raw) return;
  const d = _nvpResDraft();
  d[page] = d[page] || [];
  // Plusieurs ID d'un coup : on colle une liste sans avoir à les saisir
  // un par un. Doublons et casse écartés — l'ID est comparé en minuscules.
  raw.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean).forEach(id => {
    if (!d[page].some(x => x.toLowerCase() === id.toLowerCase())) d[page].push(id);
  });
  if (inp) inp.value = '';
  renderNavProfiles();
}

function nvpResDelId(page, id) {
  const d = _nvpResDraft();
  if (!d[page]) return;
  d[page] = d[page].filter(x => x !== id);
  renderNavProfiles();
}

function _nvpRenderReserved() {
  const d = _nvpResDraft();
  const pages = _nvpResPages();
  const grpOrder = [...new Set(pages.map(p => p.grp))];

  const bloc = grp => {
    const items = pages.filter(p => p.grp === grp);
    return `<div class="nvp-grp">
      <div class="nvp-grp-h"><span class="nvp-grp-t">${esc(grp)}</span></div>
      ${items.map(it => {
        const ids = d[it.id];
        const on = Array.isArray(ids);
        return `<div class="nvp-res${on ? ' is-on' : ''}">
          <label class="nvp-row">
            <input type="checkbox" ${on ? 'checked' : ''}
                   onchange="nvpResToggle('${it.id}',this.checked)">
            <span class="nvp-row-l">${esc(it.l)}</span>
            ${on && !ids.length ? '<span class="nvp-res-warn">aucun ID — sans effet</span>' : ''}
            ${on && ids.length ? `<span class="nvp-res-n">${ids.length}</span>` : ''}
          </label>
          ${on ? `<div class="nvp-res-body">
            <div class="nvp-res-ids">
              ${ids.length
                ? ids.map(id => `<span class="nvp-res-id">${esc(id)}${_nvpNomDeId(id) ? ` <em style="opacity:.7;font-style:normal">· ${esc(_nvpNomDeId(id))}</em>` : ''}
                    <button type="button" onclick="nvpResDelId('${it.id}','${esc(id)}')"
                            title="Retirer">×</button></span>`).join('')
                : '<span class="nvp-res-none">Personne n\'y a accès en dehors de l\'admin.</span>'}
            </div>
            <div class="nvp-res-add">
              <input class="form-control" id="nvp-res-in-${it.id}"
                     placeholder="ID employé (ex. wx1234567)"
                     onkeydown="if(event.key==='Enter'){event.preventDefault();nvpResAddId('${it.id}')}">
              <button type="button" class="nvp-mini" onclick="nvpResAddId('${it.id}')">Ajouter</button>
            </div>
          </div>` : ''}
        </div>`;
      }).join('')}
    </div>`;
  };

  return `
    <div class="gsla-card nvp-card">
      <div class="gsla-card-head">
        <h3 class="gsla-card-t">Pages réservées</h3>
        <p class="gsla-card-d">
          Cochez une page pour la réserver, puis inscrivez les ID employé
          autorisés. Elle disparaît alors de la barre de tout le monde,
          sauf de la vôtre — l'administrateur en session voit toujours tout —
          et de celle des ID inscrits, qui la voient même si la vue de leur
          profil ne la contient pas.
          Les onglets de <strong>My Space</strong> (Today, Tasks, Requests,
          Performance, Quiz) se réservent un par un, et la réservation est
          <strong>appliquée par le serveur</strong> dès que l'accès équipe est actif :
          l'identité y est prouvée par le code personnel. Pour les autres pages,
          c'est un réglage d'affichage ; ce qui les protège reste la session admin.
        </p>
      </div>
      <div class="nvp-state">
        <span class="nvp-badge${Object.keys(d).length ? ' is-on' : ''}">${
          Object.keys(d).length} page(s) réservée(s)</span>
        <span>Une page cochée sans aucun ID reste visible : on ne masque
          rien tant que personne n'est désigné.</span>
      </div>
      <div class="nvp-grid">${grpOrder.map(bloc).join('')}</div>
    </div>`;
}

function _nvpRenderBody() {
  const el = document.getElementById('nvp-body');
  if (!el) return;
  if (NvpUI.profil === '_res') { el.innerHTML = _nvpRenderReserved(); return; }
  if (NvpUI.profil === '_new') { el.innerHTML = _nvpRenderNew(); return; }
  const prof = _nvpProfils().find(p => p.key === NvpUI.profil) || _nvpProfils()[0];
  const liste = _nvpListe(prof.key);
  const total = NVP_PAGES.reduce((n, g) => n + _nvpItems(g).length, 0);

  const groupes = NVP_PAGES.map(g => {
    const rows = g.items.filter(it => !it.resOnly).map(it => {
      if (it.admin) return `<div class="nvp-row is-fixed is-admin">
        <input type="checkbox" disabled aria-label="${esc(it.l)} : admin seulement">
        <span class="nvp-row-l">${esc(it.l)}</span>
        <span class="nvp-fixed">admin</span>
      </div>`;
      const coche = it.fixe || (liste === null ? true : liste.includes(it.id));
      return `<label class="nvp-row${it.fixe ? ' is-fixed' : ''}">
        <input type="checkbox" ${coche ? 'checked' : ''} ${it.fixe ? 'disabled' : ''}
               onchange="nvpToggle('${it.id}',this.checked)">
        <span class="nvp-row-l">${esc(it.l)}${
          it.alias ? `<em class="nvp-alias">${esc(it.alias)}</em>` : ''}</span>
        ${it.fixe ? `<span class="nvp-fixed">toujours affiché</span>` : ''}
      </label>`;
    }).join('');
    const ids = _nvpItems(g).filter(i => !i.fixe).map(i => i.id);
    // Nombre coché sur total : un groupe dont rien n'est coché ne doit
    // pas se lire comme un groupe vide — c'est ce qui a fait chercher
    // « Weekly Report » ailleurs alors qu'il était là, simplement décoché.
    const conf = _nvpItems(g);
    const nOn = conf.filter(i =>
      i.fixe || (liste === null ? true : liste.includes(i.id))).length;
    return `<div class="nvp-grp">
      <div class="nvp-grp-h">
        <span class="nvp-grp-t">${esc(g.grp)}${conf.length ? `<em>${nOn}/${conf.length}</em>` : ''}</span>
        ${ids.length ? `<span class="nvp-grp-a">
          <button type="button" onclick="nvpSet(${JSON.stringify(ids).replace(/"/g, '&quot;')},true)">tout</button>
          <button type="button" onclick="nvpSet(${JSON.stringify(ids).replace(/"/g, '&quot;')},false)">aucun</button>
        </span>` : ''}
      </div>
      ${NVP_NOTES[g.grp] ? `<p class="nvp-grp-n">${NVP_NOTES[g.grp]}</p>` : ''}
      ${rows}
    </div>`;
  }).join('');

  const n = liste === null ? total : liste.length;

  el.innerHTML = `
    <div class="gsla-card nvp-card">
      <div class="gsla-card-head">
        <h3 class="gsla-card-t">${esc(prof.label)}</h3>
        <p class="gsla-card-d">
          ${esc(prof.desc)}. Les pages cochées apparaissent dans la barre
          de ce profil. Ops Review, Diffusion, Exports et les écrans Admin
          restent réservés à la session admin, quel que soit le profil.
          <strong>Réglage d'affichage, pas une permission :</strong> masquer
          une entrée n'empêche pas d'ouvrir la page par son adresse.
        </p>
      </div>

      <div class="nvp-state">
        ${liste === null
          ? `<span class="nvp-badge">Non configuré</span>
             <span>Ce profil voit toutes les pages hors admin (${total}).
             Partez de la vue conseillée, puis ajustez.</span>
             <button type="button" class="nvp-mini" onclick="nvpApplyDefault()">
               Partir de la vue conseillée</button>`
          : `<span class="nvp-badge is-on">${n} / ${total} pages</span>
             <span>Barre composée pour ce profil.</span>
             <button type="button" class="nvp-mini" onclick="nvpReset()">
               Revenir à « tout afficher »</button>`}
      </div>

      <div class="nvp-grid">${groupes}</div>
    </div>`;
}

// Cocher/décocher. Le premier geste sur un profil « non configuré »
// matérialise la liste complète avant d'en retirer l'élément : sans ça,
// décocher une seule page semblerait n'avoir aucun effet.
function nvpToggle(id, on) {
  const d = _nvpDraft();
  const key = NvpUI.profil;
  if (d[key] === null) {
    d[key] = NVP_PAGES.flatMap(g => _nvpItems(g).map(i => i.id));
  }
  const set = new Set(d[key]);
  if (on) set.add(id); else set.delete(id);
  d[key] = [...set];
  renderNavProfiles();
}

function nvpSet(ids, on) {
  const d = _nvpDraft();
  const key = NvpUI.profil;
  if (d[key] === null) d[key] = NVP_PAGES.flatMap(g => _nvpItems(g).map(i => i.id));
  const set = new Set(d[key]);
  ids.forEach(i => { if (on) set.add(i); else set.delete(i); });
  d[key] = [...set];
  renderNavProfiles();
}

function nvpApplyDefault() {
  _nvpDraft()[NvpUI.profil] = [...(NVP_DEFAUTS[NvpUI.profil] || [])];
  renderNavProfiles();
}

function nvpReset() {
  _nvpDraft()[NvpUI.profil] = null;
  renderNavProfiles();
}

// ── Badge « NEW » ─────────────────────────────────────────────
// Pages signalées « NEW » dans le menu, jusqu'à une date (config.nav_new,
// { page: 'AAAA-MM-JJ' }). Affichage : js/core/nav-new.js.
function _nvpNewDraft() {
  if (!NvpUI.nw) NvpUI.nw = { ...((state.config && state.config.nav_new) || {}) };
  return NvpUI.nw;
}
function _nvpNewActifs(d) {
  const today = new Date().toLocaleDateString('sv-SE');
  return Object.fromEntries(Object.entries(d || {}).filter(([, u]) => typeof u === 'string' && u >= today));
}
function _nvpPlusJours(n) {
  const d = new Date(); d.setDate(d.getDate() + n - 1);
  return d.toLocaleDateString('sv-SE');
}
function nvpNewToggle(page, on) {
  const d = _nvpNewDraft();
  if (on) d[page] = d[page] && d[page] >= new Date().toLocaleDateString('sv-SE') ? d[page] : _nvpPlusJours(14);
  else delete d[page];
  renderNavProfiles();
}
function nvpNewDays(page, n) {
  const d = _nvpNewDraft();
  d[page] = _nvpPlusJours(Number(n) || 14);
  renderNavProfiles();
}
function _nvpRenderNew() {
  const d = _nvpNewActifs(_nvpNewDraft());
  // Toutes les entrées du menu, dans l'ordre de la barre, avec leur libellé.
  const vus = new Set();
  const pages = [...document.querySelectorAll('.sidebar .nav-item[data-page]')]
    .map(it => ({ id: it.dataset.page, l: (it.querySelector('.nav-item-label')?.textContent || it.dataset.page).trim() }))
    .filter(p => p.id && !vus.has(p.id) && vus.add(p.id));
  const fmt = iso => { const [y, m, j] = iso.split('-'); return `${j}/${m}`; };
  return `
    <div class="gsla-card nvp-card">
      <div class="gsla-card-head">
        <h3 class="gsla-card-t">Badge New</h3>
        <p class="gsla-card-d">
          Cochez les pages à signaler : une pastille <span class="nav-new" style="margin:0 2px">NEW</span>
          s'affiche sur leur entrée du menu, pour tout le monde, pendant toute la période —
          même après avoir ouvert la page. Elle disparaît à la date choisie.
        </p>
      </div>
      <div class="nvp-new-list">
        ${pages.map(p => {
          const on = !!d[p.id];
          return `<label class="nvp-row nvp-new-row${on ? ' is-on' : ''}">
            <input type="checkbox" ${on ? 'checked' : ''} onchange="nvpNewToggle('${p.id}',this.checked)">
            <span class="nvp-row-l">${esc(p.l)}${on ? ' <span class="nav-new">NEW</span>' : ''}</span>
            ${on ? `<span class="nvp-new-until">until ${fmt(d[p.id])}</span>
              <select class="nvp-new-sel" onclick="event.stopPropagation()" onchange="nvpNewDays('${p.id}',this.value)" aria-label="Duration">
                <option value="" selected disabled>Change…</option>
                ${[[7, '7 days'], [14, '14 days'], [30, '30 days']].map(([n, l]) => `<option value="${n}">${l} from today</option>`).join('')}
              </select>` : ''}
          </label>`;
        }).join('')}
      </div>
    </div>`;
}

async function saveNavProfiles() {
  const d = _nvpDraft();
  const out = {};
  _nvpProfils().forEach(p => { if (d[p.key] != null) out[p.key] = d[p.key]; });

  // Réservations : on ne persiste que les pages effectivement réservées à
  // au moins un ID. Une page cochée puis laissée vide ne masque rien —
  // l'enregistrer créerait une entrée sans effet, qu'on relirait plus
  // tard comme une restriction active.
  const reserves = {};
  Object.entries(_nvpResDraft()).forEach(([page, ids]) => {
    if (Array.isArray(ids) && ids.length) reserves[page] = ids;
  });

  try {
    // Badges « NEW » : seuls ceux encore en cours sont gardés.
    const nouveaux = _nvpNewActifs(_nvpNewDraft());
    // nav_profiles_v : 2 = la liste connaît l'Idea box (voir navPageVisible).
    const cfg = { ...state.config, nav_profiles: out, nav_profiles_v: 2, nav_reserved: reserves, nav_new: nouveaux };
    const res = await fetch(`${API}/api/config`, {
      method: 'PUT', headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
      credentials: 'same-origin', body: JSON.stringify(cfg) });
    if (!res.ok) throw new Error('Enregistrement impossible');
    await loadConfig();
    NvpUI.draft = null;
    NvpUI.res = null;
    NvpUI.nw = null;
    if (typeof navNewApply === 'function') navNewApply();
    // La barre de l'admin lui-même ne change pas — il voit tout — mais
    // le réglage doit prendre effet sans rechargement pour les sessions
    // qui rechargeront la config.
    if (typeof applyNavMode === 'function') applyNavMode();
    toast('Vues enregistrées.', 'success');
    renderNavProfiles();
  } catch (e) {
    toast(e.message, 'error');
  }
}

window.renderNavProfiles = renderNavProfiles;
window.nvpSelect = nvpSelect;
window.nvpToggle = nvpToggle;
window.nvpSet = nvpSet;
window.nvpApplyDefault = nvpApplyDefault;
window.nvpReset = nvpReset;
window.saveNavProfiles = saveNavProfiles;
window.nvpResToggle = nvpResToggle;
window.nvpResAddId = nvpResAddId;
window.nvpResDelId = nvpResDelId;
