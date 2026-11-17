const fs          = require('fs');
const bcrypt      = require('bcryptjs');
const { DATA_DIR, FILES } = require('../config/paths');

// ── WRITE QUEUE (per-file locks) ──────────────────────────────
// Each file gets its own promise-chain lock so a slow write to
// fo_tasks.json does not block an unrelated sn.json write.
const _locks = {};
let pendingWrites = 0;
function withLock(fn, lockKey) {
  const key = lockKey || '__global__';
  if (!_locks[key]) _locks[key] = Promise.resolve();
  pendingWrites++;
  const result = _locks[key].then(() => fn());
  // Le maillon suivant absorbe l'échec au lieu de le propager : sans cela
  // une écriture ratée ferait rejeter toutes les suivantes sur le même
  // fichier. Il porte aussi la décrémentation, sur les deux branches, pour
  // que le compteur retombe exactement une fois par écriture — succès ou
  // non. `fn` synchrone qui lance est couvert : `.then()` le convertit en
  // rejet, donc il passe bien par la branche d'erreur.
  _locks[key] = result.then(() => { pendingWrites--; }, () => { pendingWrites--; });
  return result;
}
// Convenience: lock by file path (stable identity)
function withFileLock(filePath, fn) { return withLock(fn, filePath); }

// ── SPLIT-FILE I/O ────────────────────────────────────────────
// Une instance de test peut pointer vers un DATA_DIR encore inexistant :
// on le crée au démarrage, sinon la première écriture échouerait.
fs.mkdirSync(DATA_DIR, { recursive: true });

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function writeJSON(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// Condensé du mot de passe d'approbation par défaut. Calculé une seule fois,
// à la première demande, puis réutilisé.
//
// Il était auparavant produit dans le corps de `defaultConfig()`, donc à
// CHAQUE appel de `readCfg()` — soit à chaque requête qui lit la config.
// bcrypt est lent par construction (c'est sa raison d'être) : ~90 ms par
// appel ici. Express étant mono-thread, ces 90 ms bloquaient aussi toutes
// les autres requêtes en attente. C'était la cause principale de la lenteur
// générale de l'application, sur des fichiers de données pourtant vides.
//
// `bcrypt.hashSync` ne peut pas sortir du démarrage : le condensé sert de
// valeur de repli quand config.json n'en porte pas. On le calcule donc au
// premier besoin (et non au chargement du module, pour ne pas retarder le
// démarrage quand une config existe déjà).
let _hashDefautApprobation = null;
function hashDefautApprobation() {
  if (_hashDefautApprobation === null) {
    _hashDefautApprobation = // Aucun mot de passe connu par défaut : un secret aléatoire, que personne
    // ne connaît, tant que l'admin n'en a pas défini un.
    bcrypt.hashSync(require('crypto').randomBytes(24).toString('hex'), 10);
  }
  return _hashDefautApprobation;
}

function defaultConfig() {
  return {
    fo_list: [], domains: ['MMC','HCS','INFRA','FOS','NMS'],
    shifts: [], sla_hours: {},
    work_mode: 'live',   // 'live' | 'drill'  (global - affects drill hours window)
    ticket_statuses:  ['Open','In Progress','On Hold','Resolved','Closed'],
    ticket_priorities: ['P1','P2','P3','P4'],
    approval_password_hash: hashDefautApprobation(),
    // Droit à congés annuel, en jours ouvrés. Base du calcul des soldes
    // de la page Absences ; surchargeable depuis la Configuration.
    leave_entitlement_days: 30,
  };
}

// One-time migration: tickets.json → split files
function migrateIfNeeded() {
  if (!fs.existsSync(FILES.legacy)) return;
  const allExist = ['sn','ci','observations','audit','config'].every(k => fs.existsSync(FILES[k]));
  if (allExist) return; // already migrated
  console.log('[Pearl] Migrating tickets.json → split data files…');
  let legacy;
  try { legacy = JSON.parse(fs.readFileSync(FILES.legacy, 'utf8')); }
  catch { return; }
  if (!fs.existsSync(FILES.sn))           writeJSON(FILES.sn,           legacy.sn           || []);
  if (!fs.existsSync(FILES.ci))           writeJSON(FILES.ci,           legacy.ci           || []);
  if (!fs.existsSync(FILES.observations)) writeJSON(FILES.observations, legacy.observations  || []);
  if (!fs.existsSync(FILES.audit))        writeJSON(FILES.audit,        legacy.audit        || []);
  if (!fs.existsSync(FILES.config)) {
    const cfg = { ...defaultConfig(), ...(legacy.config || {}) };
    writeJSON(FILES.config, cfg);
  }
  // Rename legacy file so it's not re-read
  fs.renameSync(FILES.legacy, FILES.legacy + '.bak');
  console.log('[Pearl] Migration done. tickets.json → tickets.json.bak');
}
migrateIfNeeded();

// One-time migration: plaintext approval_password → bcrypt hash
function migratePasswordsIfNeeded() {
  const cfg = readJSON(FILES.config, null);
  if (!cfg) return;
  if (cfg.approval_password && !cfg.approval_password_hash) {
    cfg.approval_password_hash = bcrypt.hashSync(cfg.approval_password, 10);
    delete cfg.approval_password;
    writeJSON(FILES.config, cfg);
    console.log('[Pearl] Migrated approval_password → approval_password_hash (hashed).');
  }
}
migratePasswordsIfNeeded();

function readSN()  { return readJSON(FILES.sn,           []); }
function readCI()  { return readJSON(FILES.ci,           []); }
function readObs() { return readJSON(FILES.observations, []); }
function readAudit(){ return readJSON(FILES.audit,       []); }
function readCfg() { return { ...defaultConfig(), ...readJSON(FILES.config, {}) }; }
function readBO()  { return readJSON(FILES.bo,           []); }
function readShiftsPlan() { return readJSON(FILES.shifts_plan, []); }
function readFOTasks()    { return readJSON(FILES.fo_tasks,    []); }
function readQuizzes()      { return readJSON(FILES.quizzes,      []); }
function readAnnouncements()  { return readJSON(FILES.announcements, []); }
function writeAnnouncements(d) { writeJSON(FILES.announcements, d); }
function readTrainings()  { return readJSON(FILES.trainings, []); }
function writeTrainings(d) { writeJSON(FILES.trainings, d); }
function readQuizResults()  { return readJSON(FILES.quiz_results, []); }
function readQuizProgress()  { return readJSON(FILES.quiz_progress, []); }
// État de publication, par id de quiz : { "<id>": true|false }. Absent
// du fichier = état par défaut du quiz. Stocké à part parce qu'un quiz
// de la banque vit dans le code (server/quiz/quiz-bank.js) et n'est pas
// modifiable ; son état de publication, lui, est une décision
// d'exploitation.
function readQuizPublished()  { return readJSON(FILES.quiz_published, {}); }

// L'état par défaut n'est pas le même pour tous. Un quiz créé depuis
// l'interface est publié d'emblée : on vient de l'écrire pour qu'il
// serve. Un quiz de la banque porte `default_published` — les modules
// ajoutés après coup arrivent en brouillon, pour qu'une mise à jour de
// la banque n'ouvre pas 24 cours dans le parcours de tout le monde sans
// que personne ne l'ait décidé.
function isQuizPublished(quiz, flags) {
  const explicit = (flags || readQuizPublished())[quiz.id];
  if (typeof explicit === 'boolean') return explicit;
  return quiz.default_published !== false;
}
function readWeeklyProgress() { return readJSON(FILES.weekly_progress, []); }
function readReportLayout() { return readJSON(FILES.report_layout, { order: {}, hidden: {}, customCols: {} }); }

function writeSN(d)    { writeJSON(FILES.sn,           d); }
function writeCI(d)    { writeJSON(FILES.ci,           d); }
function writeObs(d)   { writeJSON(FILES.observations, d); }
function writeAudit(d) { writeJSON(FILES.audit,        d); }
function writeCfg(d)   { writeJSON(FILES.config,       d); }
function writeBO(d)    { writeJSON(FILES.bo,            d); }
function writeShiftsPlan(d) { writeJSON(FILES.shifts_plan, d); }
function writeFOTasks(d)    { writeJSON(FILES.fo_tasks,    d); }
function writeQuizzes(d)     { writeJSON(FILES.quizzes,      d); }
function writeQuizResults(d) { writeJSON(FILES.quiz_results, d); }
function writeQuizProgress(d) { writeJSON(FILES.quiz_progress, d); }
function writeQuizPublished(d) { writeJSON(FILES.quiz_published, d); }
function writeWeeklyProgress(d) { writeJSON(FILES.weekly_progress, d); }
function writeReportLayout(d) { writeJSON(FILES.report_layout, d); }

function readTracker(t) { return t === 'sn' ? readSN()  : readCI(); }
function writeTracker(t, d) { t === 'sn' ? writeSN(d) : writeCI(d); }

function readHolidays() { return readJSON(FILES.holidays, []); }

// Compteur d'écritures en attente. `pendingWrites` est réassigné ici :
// un import par valeur resterait figé, d'où cet accesseur.
function getPendingWrites() { return pendingWrites; }

// Migration unique : périodes On Hold reconstituées depuis l'audit pour
// les tickets antérieurs à la règle du gel du SLA. Un ticket migré porte
// `hold_periods` (éventuellement vide) : la migration ne repasse pas.
function migrateHoldPeriodsIfNeeded() {
  const { reconstruireAttentes } = require('./holds');
  let audit = null;
  for (const t of ['sn', 'ci']) {
    const tickets = readTracker(t);
    if (!tickets.some(x => !Array.isArray(x.hold_periods))) continue;
    audit = audit || readAudit();
    const parTicket = new Map();
    for (const a of audit) {
      if (String(a.tracker || '').toLowerCase() !== t) continue;
      (parTicket.get(a.ticket_id) || parTicket.set(a.ticket_id, []).get(a.ticket_id)).push(a);
    }
    let n = 0;
    for (const x of tickets) {
      if (Array.isArray(x.hold_periods)) continue;
      x.hold_periods = reconstruireAttentes(x, parTicket.get(x.id) || []);
      if (x.hold_periods.length) n++;
    }
    writeTracker(t, tickets);
    console.log(`[Pearl] Périodes On Hold reconstituées (${t.toUpperCase()}) : ${n} ticket(s) concerné(s).`);
  }
}
try { migrateHoldPeriodsIfNeeded(); } catch (e) { console.error('[Pearl] Migration On Hold échouée :', e.message); }

module.exports = {
  _locks, withFileLock, readJSON, writeJSON, readSN, readCI, readObs,
  readAudit, readCfg, readBO, readShiftsPlan, readFOTasks, readQuizzes,
  readAnnouncements, writeAnnouncements, readTrainings, writeTrainings,
  readQuizResults, readQuizProgress, readQuizPublished, isQuizPublished,
  readWeeklyProgress, readReportLayout, writeObs, writeAudit, writeCfg,
  writeBO, writeShiftsPlan, writeFOTasks, writeQuizzes, writeQuizResults,
  writeQuizProgress, writeQuizPublished, writeWeeklyProgress,
  writeReportLayout, readTracker, writeTracker, readHolidays,
  getPendingWrites,
};
