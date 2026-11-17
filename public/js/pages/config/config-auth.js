// ── CONFIG AUTH ───────────────────────────────────────────────
let configUnlocked = false;
let dqUnlocked = false;

// Override renderPage to intercept protected pages
const _origRenderPage = renderPage;
window.renderPage = function(page) {
  _origRenderPage(page);
  // Mémorise la page réellement affichée. La barre latérale ne fait pas
  // foi : les rubriques ouvertes depuis la Vue d'ensemble n'ont pas
  // d'entrée de menu, et .nav-item.active reste alors sur « Vue
  // d'ensemble ». Sans cette trace, tout ce qui relit la page courante —
  // le sélecteur Global/SN/CI, la présence — y renvoyait l'utilisateur.
  try { if (page) localStorage.setItem('pearl-last-page', page); } catch (_) {}
  // Signale la nouvelle page à la présence. Après _origRenderPage : la
  // classe .active de la barre latérale doit être posée avant la lecture.
  try { notePresencePage(); } catch (_) {}
};

function _renderConfigPage() {
  adminGate('config', () => { configUnlocked = true; renderConfigHub(); });
}

// Sommaire de la page Configuration : les rubriques sont des pages,
// ces raccourcis évitent d'obliger à passer par la barre latérale.
// Le sommaire de la Configuration. Dix-sept rubriques à plat, rangées
// par ordre d'ajout, obligeaient à toutes les lire pour en trouver une :
// une liste n'est un sommaire que si elle est ordonnée par intention.
//
// Elles sont donc regroupées par ce qu'on vient y faire — piloter
// l'équipe, régler l'outil, administrer les accès — et chaque carte peut
// porter un état vivant (`etat`), pour que l'écran dise ce qui demande
// une décision avant qu'on ouvre quoi que ce soit.
const CFG_GROUPES = [
  { id: 'equipe',  titre: 'Équipe',        desc: 'Suivre et faire progresser les agents' },
  { id: 'pilot',   titre: 'Pilotage',      desc: 'Ce que l\'équipe doit atteindre' },
  { id: 'outil',   titre: 'Paramétrage',   desc: 'Comment l\'outil compte et classe' },
  { id: 'acces',   titre: 'Accès & données', desc: 'Qui voit quoi, et ce qui entre ou sort' },
];
// Icône de chaque rubrique (traits, comme le reste de l'appli).
const CFG_ICO = {
  equipe: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  'shift-approvals': '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>',
  'cfg-annonces': '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 8a5 5 0 0 1 0 8"/>',
  'cfg-goals': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  'cfg-sla': '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>',
  rapports: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 17v-3M12 17v-6M15 17v-2"/>',
  indicateurs: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  ai: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
  'cfg-general': '<path d="M4 6h16M4 12h16M4 18h10"/>',
  'cfg-rota': '<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M8 2v4M16 2v4M3 10h18"/>',
  'cfg-quiz': '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01"/>',
  'cfg-glossary': '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/>',
  'cfg-parties': '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17.5" cy="9" r="2.4"/><path d="M15.5 14.2A5 5 0 0 1 21.5 19"/>',
  'cfg-vues': '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  'cfg-security': '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'cfg-sessions': '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  'cfg-data': '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  'data-quality': '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  audit: '<path d="M12 8v4l3 2"/><path d="M3.05 11a9 9 0 1 1 .5 4M3 4v7h7"/>',
};

const CFG_RUBRIQUES = [
  // ── Équipe ──
  // Une seule carte : My Team, Performance FO, Suivi des objectifs,
  // One-to-One, Assigner des tâches et Agenda Training en sont devenus
  // les onglets. `kw` garde leurs anciens noms trouvables par la
  // recherche — qui tape « one-to-one » ou « training » doit arriver ici.
  { page: 'equipe',       grp: 'equipe', titre: 'Équipe',
    desc: 'Où en est chaque agent : performance, objectifs, One-to-One, tâches, absences, formation',
    kw: 'My Team classement Performance FO notation Trust Matrix Suivi des objectifs approbations sessions O2O entretiens Assigner des taches Agenda Training' },
  { page: 'shift-approvals', grp: 'equipe', titre: 'Approbations',
    desc: 'Demandes de shift, d\'absence et de présence sur site', kw: 'demandes requests shift absence onsite valider refuser' },
  { page: 'cfg-annonces', grp: 'equipe', titre: 'Annonces',
    desc: 'Messages à l\'équipe et rappels automatiques de la cloche', kw: 'notification cloche bande rappels' },

  // ── Pilotage ──
  { page: 'cfg-goals',    grp: 'pilot', titre: 'Objectifs d\'équipe',
    desc: 'Les cibles que le tableau de bord compare' },
  { page: 'cfg-sla',      grp: 'pilot', titre: 'SLA',
    desc: 'Durées et mode de décompte' },
  // Diffusion est devenue un onglet de Rapports, comme la page Export :
  // une seule carte, qui garde leurs noms trouvables par la recherche.
  { page: 'rapports',     grp: 'pilot', titre: 'Rapports',
    desc: 'Daily, Weekly, Monthly, Ops Review, diffusion par mail et exports',
    kw: 'Diffusion envoi mail SMTP groupes planification Export Excel PowerPoint JSON sauvegarde' },
  { page: 'indicateurs',  grp: 'pilot', titre: 'Indicateurs',
    desc: 'KPI et PI décrits à Pearl AI, suivis automatiquement', kw: 'KPI PI MTTD MTTR SLA indicateur formule degradation' },
  { page: 'ai',           grp: 'pilot', titre: 'Pearl AI',
    desc: 'L\'assistant IA, ses outils et sa base de connaissances', kw: 'IA AI assistant knowledge documents cle API modele' },

  // ── Paramétrage ──
  { page: 'cfg-general',  grp: 'outil', titre: 'Général',
    desc: 'Domaines, équipe FO, statuts' },
  { page: 'cfg-parties',  grp: 'outil', titre: 'Rôles et parties prenantes',
    desc: 'FO, BO, SMC, DRPS… : rôles, personnes et noms reconnus dans vos autres outils', kw: 'role stakeholder SMC DRPS initiator partie prenante' },
  { page: 'cfg-rota',     grp: 'outil', titre: 'Shift Rota',
    desc: 'Sites, créneaux, génération de la rota' },
  { page: 'cfg-quiz',     grp: 'outil', titre: 'Quiz',
    desc: 'Banque de questions et quiz de l\'équipe' },
  { page: 'cfg-glossary', grp: 'outil', titre: 'Glossaire Logs',
    desc: 'Termes reconnus par l\'Analyseur' },

  // ── Accès & données ──
  { page: 'cfg-vues',     grp: 'acces', titre: 'Vues par profil',
    desc: 'Pages visibles par profil, et pages réservées à certains ID' },
  { page: 'cfg-security', grp: 'acces', titre: 'Accès & Sécurité',
    desc: 'Mots de passe et identifiants' },
  { page: 'cfg-sessions', grp: 'acces', titre: 'Sessions actives',
    desc: 'Qui est connecté, depuis où, et déconnexion' },
  { page: 'cfg-data',     grp: 'acces', titre: 'Données',
    desc: 'Équipe Back Office' },
  { page: 'data-quality', grp: 'acces', titre: 'Data Quality',
    desc: 'Contrôle de cohérence des tickets SN et CI' },
  { page: 'audit',        grp: 'acces', titre: 'Audit Trail',
    desc: 'Historique complet des modifications' },
];

// Accents et casse ignorés : « securite » doit trouver « Accès & Sécurité »,
// personne ne tape les accents dans un champ de recherche.
function _cfgFold(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// État vivant d'une rubrique : ce qui, aujourd'hui, demande une
// décision. Un sommaire qui ne dit que des titres oblige à ouvrir les
// dix-huit écrans pour découvrir lequel attendait quelque chose.
//
// Chaque état se calcule sur des données déjà chargées — aucun appel
// réseau n'est ajouté pour peindre le sommaire. Quand la donnée manque,
// on ne renvoie rien plutôt qu'un zéro : une pastille « 0 » se lit comme
// un constat, alors qu'on n'a simplement pas regardé.
function _cfgEtat(page) {
  const cfg = state.config || {};

  if (page === 'equipe') return typeof eqHubEtat === 'function' ? eqHubEtat() : null;

  if (page === 'rapports') {
    // L'état de la carte est celui de la Diffusion, seule partie de
    // Rapports qui puisse être en panne. Elle se règle ailleurs (mlState)
    // et n'est pas dans la config : on ne prétend pas savoir si elle est
    // prête tant que la page n'a pas été ouverte dans la session.
    // Un envoi programmé en échec prime sur tout : c'est un rapport qui
    // n'est pas parti. La santé est chargée au démarrage pour un admin.
    // `go` : la carte mène alors droit à l'onglet Diffusion.
    const echecs = (typeof mlState !== 'undefined' && mlState.health && mlState.health.failed) || [];
    if (echecs.length) return { t: 'bad', go: 'mailing',
      txt: `${echecs.length} envoi${echecs.length > 1 ? 's' : ''} en échec` };
    const sante = typeof mlState !== 'undefined' && mlState.health;
    if (sante && typeof sante.smtp_ready === 'boolean')
      return sante.smtp_ready ? { t: 'ok', txt: 'diffusion prête' } : { t: 'bad', go: 'mailing', txt: 'diffusion à compléter' };
    const st = (typeof mlState !== 'undefined' && mlState.smtp) || null;
    if (!st || !Object.keys(st).length) return null;
    const pret = !!(st.host && st.port && st.user && st.has_pass);
    return pret ? { t: 'ok', txt: 'diffusion prête' } : { t: 'bad', go: 'mailing', txt: 'diffusion à compléter' };
  }

  if (page === 'cfg-vues') {
    const prof = Object.keys(cfg.nav_profiles || {}).length;
    const res  = Object.keys(cfg.nav_reserved || {}).length;
    if (!prof && !res) return null;
    const bits = [];
    if (prof) bits.push(`${prof} profil${prof > 1 ? 's' : ''}`);
    if (res)  bits.push(`${res} réservée${res > 1 ? 's' : ''}`);
    return { t: '', txt: bits.join(' · ') };
  }

  if (page === 'shift-approvals') {
    const n = (state.shiftRequests || []).filter(r => r.status === 'pending').length;
    return n ? { t: 'warn', txt: `${n} en attente` } : { t: 'ok', txt: 'à jour' };
  }
  if (page === 'ai' && typeof aiUI !== 'undefined' && aiUI.conf) {
    const d = (aiUI.kb?.docs || []).length;
    return aiUI.conf.has_key ? { t: 'ok', txt: d ? `connecté · ${d} doc${d > 1 ? 's' : ''}` : 'connecté' } : { t: 'warn', txt: 'non connecté' };
  }
  if (page === 'cfg-general') {
    const n = (cfg.fo_list || []).length;
    const d = (cfg.domains || []).length;
    return n || d ? { t: '', txt: `${n} FO · ${d} domaines` } : null;
  }

  return null;
}

function renderConfigHub() {
  const el = document.getElementById('cfg-hub');
  if (!el) return;

  const q = _cfgFold(document.getElementById('cfg-hub-q')?.value.trim());
  // Recherche mot à mot, chaque mot pouvant n'être qu'un début : « mot de
  // passe » doit trouver « Mots de passe et identifiants » malgré le pluriel.
  // La description est incluse, sinon « formation » ne mènerait nulle part.
  const mots = q ? q.split(/\s+/).filter(Boolean) : [];
  const list = !mots.length ? CFG_RUBRIQUES : CFG_RUBRIQUES.filter(r => {
    const cible = _cfgFold(r.titre + ' ' + r.desc + ' ' + (r.kw || ''));
    const tokens = cible.split(/[^a-z0-9]+/).filter(Boolean);
    return mots.every(m => tokens.some(t => t.startsWith(m)));
  });

  if (!list.length) {
    el.innerHTML = `<div class="cfg-hub-none">
      Aucune rubrique ne correspond à « ${esc(document.getElementById('cfg-hub-q').value.trim())} ».</div>`;
    return;
  }

  // Une rubrique = une ligne : icône, titre, à quoi elle sert, son état,
  // et la flèche. Plus lisible qu'une mosaïque de cartes de même poids.
  const etats = new Map(CFG_RUBRIQUES.map(r => [r.page, _cfgEtat(r.page)]));
  const ligne = r => {
    const e = etats.get(r.page);
    return `<button type="button" class="cfh-row" onclick="window.renderPage('${(e && e.go) || r.page}')">
      <span class="cfh-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${CFG_ICO[r.page] || CFG_ICO['cfg-general']}</svg></span>
      <span class="cfh-tx"><b>${esc(r.titre)}</b><small>${esc(r.desc)}</small></span>
      ${e ? `<span class="cfh-b${e.t ? ' is-' + e.t : ''}">${esc(e.txt)}</span>` : ''}
      <span class="cfh-go" aria-hidden="true">›</span>
    </button>`;
  };

  // En recherche, les groupes n'aident plus : résultats à plat.
  if (mots.length) {
    el.innerHTML = `<section class="cfh-panel"><div class="cfh-rows">${list.map(ligne).join('')}</div></section>`;
    return;
  }

  // En tête : ce qui attend une décision, toutes rubriques confondues.
  const alertes = CFG_RUBRIQUES.map(r => ({ r, e: etats.get(r.page) })).filter(x => x.e && (x.e.t === 'bad' || x.e.t === 'warn'));
  const tete = alertes.length
    ? `<section class="cfh-alert"><b>À regarder</b><div>${alertes.map(({ r, e }) =>
        `<button type="button" class="cfh-chip is-${e.t}" onclick="window.renderPage('${e.go || r.page}')">${esc(r.titre)} · ${esc(e.txt)} ›</button>`).join('')}</div></section>`
    : `<section class="cfh-alert is-ok"><b>Tout est en ordre</b><span>Aucune rubrique n'attend de décision.</span></section>`;

  el.innerHTML = tete + `<div class="cfh-grid">${CFG_GROUPES.map(g => {
    const items = list.filter(r => r.grp === g.id);
    if (!items.length) return '';
    return `<section class="cfh-panel">
      <header class="cfh-h"><h3>${esc(g.titre)}</h3><span>${esc(g.desc)}</span></header>
      <div class="cfh-rows">${items.map(ligne).join('')}</div>
    </section>`;
  }).join('')}</div>`;
}

// Chaque rubrique partage le verrou admin, mais n'a pas son propre
// écran de connexion : sans session on renvoie vers la page
// Configuration, qui porte le formulaire.
async function _renderCfgSubPage(page) {
  const ok = await AdminSession.check();
  if (!ok) { window.renderPage('config'); return; }

  // renderConfig() remplit domaines, équipe, SLA, BO et rota d'un coup :
  // ces rubriques partagent la même passe de rendu.
  if (page === 'cfg-general' || page === 'cfg-sla' || page === 'cfg-data' || page === 'cfg-rota') renderConfig();
  if (page === 'cfg-general' && typeof renderSitesAdmin === 'function') { _sitesDraft = null; renderSitesAdmin(); }
  if (page === 'cfg-general' && typeof renderOrgAdmin === 'function') renderOrgAdmin();
  if (page === 'cfg-goals')    renderGoalsConfig();
  if (page === 'cfg-vues')     renderNavProfiles();
  if (page === 'cfg-parties')  renderParties();
  if (page === 'cfg-glossary') renderGlossaryConfig();
  if (page === 'cfg-quiz')     renderQuizManage();
  if (page === 'cfg-security') { renderConfig(); renderAbsenceAllowList(); renderFoAccess(); renderTeamAccess(); }
  if (page === 'cfg-annonces') { renderAnnoncesAdmin(); renderReglesRappels(); }
  if (page === 'cfg-sessions') startSessionsAdmin();
  // cfg-perf, cfg-myteam, cfg-objectifs, cfg-o2o, cfg-assign et
  // cfg-training n'arrivent plus ici : page-dispatch.js les renvoie vers
  // les onglets de la page Équipe (voir eqLegacyRedirect).
}

