const { FILES } = require('../config/paths');
const { readCfg, withFileLock, writeCfg } = require('../core/store');

// ══════════════════════════════════════════════════════════════
// OBJECTIFS PERSONNELS
//
// Deux publics, deux jeux de routes :
//   /api/my-objectives/*   — l'agent, authentifié par son jeton FO. Il
//                            n'y a jamais de paramètre désignant un
//                            agent : le serveur déduit de qui il s'agit.
//   /api/objectives/*      — l'admin, qui voit tout et arbitre.
//
// Toute écriture de l'agent aboutit à l'état `submitted`, jamais
// `approved` : il n'existe pas de chemin par lequel l'agent s'approuve
// lui-même. C'est la propriété qu'il faut préserver en modifiant ce
// bloc.
// ══════════════════════════════════════════════════════════════

function readObjectives() { return readCfg().fo_objectives || {}; }
function readSessions()   { return readCfg().objective_sessions || []; }

function sessionById(id) { return readSessions().find(s => s.id === id) || null; }
function openSession()   { return readSessions().find(s => s.state === 'open') || null; }

// Écriture verrouillée : objectifs et sessions vivent dans config.json,
// que d'autres routes écrivent aussi.
function commitObjectives(mutate) {
  return withFileLock(FILES.config, () => {
    const cfg = readCfg();
    cfg.fo_objectives      = cfg.fo_objectives      || {};
    cfg.objective_sessions = cfg.objective_sessions || [];
    const out = mutate(cfg);
    writeCfg(cfg);
    return out;
  });
}

function foObjectives(fo) {
  const all = readObjectives();
  return Array.isArray(all[fo]) ? all[fo] : [];
}

module.exports = {
  readObjectives, readSessions, sessionById, openSession, commitObjectives,
  foObjectives,
};
