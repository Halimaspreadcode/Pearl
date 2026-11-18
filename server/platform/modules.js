// ══════════════════════════════════════════════════════════════
// REGISTRE DES MODULES
//
// Chaque module déclare ce qu'il apporte : pages de la barre, préfixes
// d'API, dépendances. Un tenant n'a accès qu'aux modules activés pour lui
// (tenant.modules ; vide = tous, pour les installations mono-tenant).
//
//   · serveur : moduleGuard refuse (404) les routes d'un module inactif ;
//   · client  : /api/platform/me renvoie les modules actifs et leurs pages,
//               la barre masque les autres (public/js/core/modules.js).
//
// Le socle (core) est toujours actif : tableau de bord, configuration,
// équipe, identité, audit, annonces.
// ══════════════════════════════════════════════════════════════

const MODULES = [
  { id: 'core', label: 'Socle', always: true,
    desc: 'Tableau de bord, paramètres, équipe, accès, annonces.',
    pages: ['dashboard', 'config', 'equipe', 'cfg-annonces', 'audit', 'mon-espace', 'mes-today'],
    api: ['home', 'status', 'version', 'config', 'team', 'fo-access', 'user-prefs', 'presence', 'audit', 'announcements',
      'bo', 'kpi-config', 'dashboard', 'export', 'platform', 'parties', 'fo', 'holidays', 'sites'] },
  { id: 'tickets', label: 'Tickets et délais', depends: ['core'],
    desc: 'Suivi des tickets par site, délais, suggestions, qualité des données, observations, passation.',
    pages: ['site', 'global', 'observations', 'fo-dashboard', 'fo-handover', 'data-quality', 'ops-review'],
    api: ['tickets', 'observations', 'fo-perf'] },
  { id: 'planning', label: 'Planning et rotations', depends: ['core'],
    desc: 'Rotations, planning des créneaux, demandes d’échange et validations.',
    pages: ['shift-planning', 'shift-approvals', 'my-requests'],
    api: ['rota', 'shifts-plan', 'shift-requests', 'fo-tasks'] },
  { id: 'absences', label: 'Absences & congés', depends: ['core'],
    desc: 'Demandes, soldes, conflits avec le planning, rapport PDF.',
    pages: ['absences'],
    api: ['absences'] },
  { id: 'objectives', label: 'Objectifs & performance', depends: ['core'],
    desc: 'Objectifs, entretiens individuels, évaluations, performance de chacun.',
    pages: ['my-perf', 'cfg-objectifs', 'objectifs', 'perf'],
    api: ['objectives', 'my-objectives', 'objective-sessions', 'objective-smart-check', 'my-perf', 'weekly-progress'] },
  { id: 'academy', label: 'Formation & quiz', depends: ['core'],
    desc: 'Parcours de quiz par niveau, formations, agenda de formation.',
    pages: ['academy', 'quiz', 'trainings'],
    api: ['academy', 'formation', 'quiz', 'quizzes', 'trainings'] },
  { id: 'reporting', label: 'Rapports', depends: ['core', 'tickets'],
    desc: 'Rapports quotidien, hebdomadaire, mensuel ; exports XLSX, PPTX, PDF ; indicateurs.',
    pages: ['rapports', 'daily-report', 'weekly-report', 'monthly-report', 'export', 'indicateurs'],
    api: ['reports', 'report-layout', 'report-draft', 'report-file', 'indicateurs'] },
  { id: 'mailing', label: 'Diffusion par mail', depends: ['reporting'],
    desc: 'Groupes de destinataires et envois programmés des rapports.',
    pages: ['mailing'],
    api: ['mailing'] },
  { id: 'ai', label: 'Assistant IA', depends: ['core'],
    desc: 'Assistant, analyses, base de connaissances, insights individuels.',
    pages: ['ai', 'ai-cockpit'],
    api: ['ai', 'my-insight'] },
  { id: 'ideas', label: 'Boîte à idées', depends: ['core'],
    desc: 'Tableau collaboratif d’idées de l’équipe.',
    pages: ['ideas'],
    api: ['ideas', 'ideas-share'] },
];

const BY_ID = new Map(MODULES.map(m => [m.id, m]));
const ALL_IDS = MODULES.map(m => m.id);

// Modules actifs d'un tenant, dépendances comprises. Liste vide ou absente
// = tous (installations mono-tenant, tenants créés avant les modules).
function activeModules(tenant) {
  const wanted = Array.isArray(tenant && tenant.modules) && tenant.modules.length ? tenant.modules : ALL_IDS;
  const out = new Set(['core']);
  const add = id => {
    const m = BY_ID.get(id);
    if (!m || out.has(id) && id !== 'core') return;
    out.add(id);
    for (const d of m.depends || []) add(d);
  };
  wanted.forEach(add);
  return ALL_IDS.filter(id => out.has(id));
}

// Valide une liste demandée : ids connus, dépendances satisfaites.
function validateModules(list) {
  const ids = [...new Set((list || []).map(String))];
  const unknown = ids.filter(id => !BY_ID.has(id));
  if (unknown.length) return { ok: false, error: `Module(s) inconnu(s) : ${unknown.join(', ')}` };
  const set = new Set(['core', ...ids]);
  for (const id of set) for (const d of BY_ID.get(id).depends || [])
    if (!set.has(d)) return { ok: false, error: `« ${BY_ID.get(id).label} » demande « ${BY_ID.get(d).label} »` };
  return { ok: true, modules: ALL_IDS.filter(id => set.has(id)) };
}

// Module propriétaire d'un chemin d'API (« /api/absences/… » → absences).
const API_OWNER = new Map();
for (const m of MODULES) for (const a of m.api || []) API_OWNER.set(a, m.id);
function moduleOfApiPath(p) {
  const seg = String(p || '').replace(/^\/api\//, '').split('/')[0];
  return API_OWNER.get(seg) || null;
}

const pagesOf = ids => ids.flatMap(id => (BY_ID.get(id) || {}).pages || []);
const allPages = () => pagesOf(ALL_IDS);

// Monté sur /api : refuse les routes d'un module inactif pour ce tenant.
function moduleGuard(req, res, next) {
  if (!req.tenant) return next();
  const owner = moduleOfApiPath('/api' + req.path);
  if (!owner) return next();
  if (activeModules(req.tenant).includes(owner)) return next();
  return res.status(404).json({ error: 'Module non activé pour cette organisation', module: owner });
}

module.exports = { MODULES, ALL_IDS, activeModules, validateModules, moduleOfApiPath, moduleGuard, pagesOf, allPages };
