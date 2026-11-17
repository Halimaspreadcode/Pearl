// Tâches du mois dans la vue performance (services/perf.js : tachesDuMois).
const { useTempDataDir } = require('./helpers/data-dir');
useTempDataDir({
  'config.json': { fo_list: ['Fatime NDOYE'] },
  'fo_tasks.json': [
    { assigned_to: 'Fatime NDOYE', title: 'Check-up', due_date: '2026-10-02', status: 'Done' },
    { assigned_to: 'Fatime NDOYE', title: 'Gabarit', status: 'Recurring', due_date: '2026-10-03' },
    { assigned_to: 'Autre', title: 'Pas à elle', due_date: '2026-10-02', status: 'Open' },
  ],
  'weekly_progress.json': [
    { admin_task: true, modified_by: 'Fatime NDOYE', task: 'Rapport', due_date: '2026-10-05', status: 'Planned' },
    { admin_task: true, modified_by: 'Fatime NDOYE', task: 'Formation', due_date: '2026-10-20', status: 'Planned' },
    { admin_task: true, modified_by: 'Fatime NDOYE', task: 'Septembre', due_date: '2026-09-20', status: 'Planned' },
  ],
});
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tachesDuMois, buildPerfView } = require('../server/services/perf');
const { readCfg, writeCfg } = require('../server/core/store');

test('tâches échues notées, tâches à venir listées sans être notées', () => {
  const t = tachesDuMois('Fatime NDOYE', '2026-10', '2026-10-08');
  assert.equal(t.total, 3);
  assert.equal(t.exigibles, 2);
  assert.equal(t.faites, 1);
  assert.equal(t.score, 50);
  assert.equal(t.a_venir, 1);
  assert.deepEqual(t.items.map(i => i.etat), ['faite', 'en_retard', 'a_venir']);
});

test('début de mois : seule la tâche faite en avance compte', () => {
  const t = tachesDuMois('Fatime NDOYE', '2026-10', '2026-10-01');
  assert.equal(t.score, 100);
  assert.equal(t.a_venir, 2);
  assert.equal(tachesDuMois('Autre', '2026-11', '2026-10-01').score, null);
});

test('fiche enregistrée avant la fin des tâches : Tasks suit les tâches, sauf note manuelle', () => {
  const mois = new Date().toISOString().slice(0, 7);
  const cfg = readCfg();
  cfg.fo_scorecards = { [mois]: { 'Fatime NDOYE': { sla: 80, tasks: 0 } } };
  writeCfg(cfg);
  const fs = require('fs'); const { FILES } = require('../server/config/paths');
  const jour = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(FILES.weekly_progress, JSON.stringify([
    { admin_task: true, modified_by: 'Fatime NDOYE', task: 'Fait', due_date: jour, status: 'Done' }]));
  fs.writeFileSync(FILES.fo_tasks, '[]');
  const v = buildPerfView('Fatime NDOYE');
  assert.equal(v.criteres.find(c => c.id === 'tasks').valeur, 100);
  assert.equal(v.score, 87);   // (80×20 + 100×10) / 30

  cfg.fo_scorecards[mois]['Fatime NDOYE'] = { sla: 80, tasks: 40, _ovr: { tasks: true } };
  writeCfg(cfg);
  assert.equal(buildPerfView('Fatime NDOYE').criteres.find(c => c.id === 'tasks').valeur, 40);
});

test('tâches One-to-One et ajoutées par l\'agent comptent aussi', () => {
  const fs = require('fs'); const { FILES } = require('../server/config/paths');
  fs.writeFileSync(FILES.fo_tasks, '[]');
  fs.writeFileSync(FILES.weekly_progress, JSON.stringify([
    { modified_by: 'Fatime NDOYE', task: 'Action O2O', week_start: '2026-10-05', status: 'Done', o2o_action: 'x' },
    { modified_by: 'Fatime NDOYE', task: 'Perso', week_start: '2026-10-05', status: 'Done' },
  ]));
  const t = tachesDuMois('Fatime NDOYE', '2026-10', '2026-10-08');
  assert.equal(t.faites, 2);
  assert.equal(t.score, 100);
});

test('mois neutre : pas de note, ni 0 ni mesure automatique', () => {
  const { perfScoreOf } = require('../server/services/perf');
  assert.equal(perfScoreOf({ _neutre: true, sla: 80, tasks: 100 }), null);
  assert.equal(perfScoreOf({ sla: 80 }), 80);
});
