const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { readCfg } = require('../core/store');

// ══════════════════════════════════════════════════════════════
// ACADEMY — catalogue des formations et fermetures
//
// L'Academy réunit les formations construites sur le moteur DigitalView
// (public/formation/*.html). Leur structure (modules, sessions, couleurs)
// n'existe que dans le script de chaque page : on l'y lit, plutôt que de
// la recopier ici et de la voir diverger à la prochaine mise à jour du
// contenu.
//
// Lecture : on isole la partie « données » du script (de `var CFG` à
// `var GL={}` : config, icônes, glossaire, sessions, modules et leurs
// petits utilitaires) et on l'exécute dans un bac à sable sans DOM ni
// réseau. Le résultat est gardé tant que le fichier ne change pas.
//
// Fermetures : config.academy = { courses: { id: true }, modules:
// { 'id:M3': true } } — `true` = fermé. Posées par l'admin seulement.
// ══════════════════════════════════════════════════════════════

const DIR = path.resolve(__dirname, '../../public/formation');

// Les formations proposées, dans l'ordre d'affichage. `hue` donne la
// couleur de la carte dans l'Academy (une teinte unie, posée deux fois
// pour la compatibilité du gabarit), `page` l'ancienne entrée de menu.
const COURSES = [
  { id: 'digitalview', file: 'digitalview.html', title: 'DigitalView',
    tag: 'Supervision', desc: 'La plateforme de supervision : alarmes, ressources, analyse, maintenance, dépannage.',
    hue: ['#5B5FC7', '#5B5FC7'], page: 'digitalview' },
  { id: 'process', file: 'process.html', title: 'Process ITSM',
    tag: 'Process', desc: 'Incidents, problèmes, changements, escalade et SLA tels qu\'on les pratique chez EMOC, puis les fondations et les pratiques d\'ITIL 4.',
    hue: ['#C8553D', '#C8553D'], page: 'process-training' },
  { id: 'mobilemoney', file: 'mobilemoney.html', title: 'Mobile Money 2.0',
    tag: 'Plateforme', desc: 'L\'architecture cloud native de MM 2.0 : stripes, microservices, modèle de service, actif-actif, gray release, DigitalView, AIOps et données.',
    hue: ['#1F7D74', '#1F7D74'], page: null },
  { id: 'datacenter', file: 'datacenter.html', title: 'Data center',
    tag: 'Infrastructure', desc: 'Du bâtiment au port : énergie et froid, baie, serveurs et stockage, câbles et optiques, leaf-spine, VXLAN, pare-feux et ports logiques.',
    hue: ['#3A4A68', '#3A4A68'], page: null },
  { id: 'reseau', file: 'reseau.html', title: 'Réseaux',
    tag: 'Infrastructure', desc: 'Des bits à internet : couches, Ethernet, IP et sous-réseaux, routage et BGP, NAT, TCP et UDP, DNS, HTTPS, pare-feux et diagnostic.',
    hue: ['#2F6690', '#2F6690'], page: null },
];

const _cache = new Map();   // id → { mtime, modules }

function lireModules(course) {
  const file = path.join(DIR, course.file);
  let mtime;
  try { mtime = fs.statSync(file).mtimeMs; } catch { return null; }
  const hit = _cache.get(course.id);
  if (hit && hit.mtime === mtime) return hit.modules;

  const html = fs.readFileSync(file, 'utf8');
  const a = html.indexOf('var CFG=');
  const b = html.indexOf('\nvar GL={}');
  if (a < 0 || b < 0) return null;
  const code = html.slice(a, b);
  // Le moteur touche à document et localStorage au chargement (thème) :
  // de quoi l'exécuter sans navigateur.
  const sandbox = {
    document: { documentElement: { setAttribute() {}, getAttribute() { return null; } } },
    localStorage: { getItem() { return null; }, setItem() {} },
    matchMedia: () => ({ matches: false }),
  };
  vm.runInNewContext(code + '\n;this.__MODS = MODS;', sandbox, { timeout: 1000 });
  const modules = (sandbox.__MODS || []).map(m => ({
    id: m.id, t: m.t, d: m.d, ic: m.ic, soft: m.soft, deep: m.deep,
    sessions: (m.S || []).map(s => ({
      key: `${m.id}.${s.id}`, t: s.t,
      cards: (s.cards || []).length,
      quiz: (s.cards || []).filter(c => c.q).length,
    })),
  }));
  _cache.set(course.id, { mtime, modules });
  return modules;
}

function readLocks() {
  const a = readCfg().academy || {};
  return {
    courses: { ...(a.courses || {}) },
    modules: { ...(a.modules || {}) },
  };
}

function catalog() {
  const locks = readLocks();
  return COURSES.map(c => {
    let modules = [];
    try { modules = lireModules(c) || []; } catch (e) { console.error('[academy]', c.id, e.message); }
    return {
      id: c.id, title: c.title, tag: c.tag, desc: c.desc, hue: c.hue, page: c.page,
      url: `/formation/${c.file}`,
      locked: !!locks.courses[c.id],
      modules: modules.map(m => ({ ...m, locked: !!locks.modules[`${c.id}:${m.id}`] })),
    };
  });
}

module.exports = { COURSES, catalog, readLocks };
