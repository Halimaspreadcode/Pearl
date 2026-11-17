// Renommer un agent partout (server/services/rename-agent.js).
const { useTempDataDir, readFixture } = require('./helpers/data-dir');
const dir = useTempDataDir({
  'config.json': { fo_list: ['Jean DUPONT', 'Awa'], fo_trackers: { 'Jean DUPONT': 'SN' },
    fo_scorecards: { '2026-10': { 'Jean DUPONT': { sla: 90 }, Awa: { sla: 80 } } } },
  'fo_tasks.json': [{ id: 't1', assigned_to: 'Jean DUPONT', title: 'Suivi Jean DUPONTUE' }],
  'weekly_progress.json': [{ id: 'w1', admin_task: true, modified_by: 'jean dupont' }],
  'shifts_plan.json': [{ fo: 'Jean DUPONT - FO' }],
});
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renommerAgent } = require('../server/services/rename-agent');

test('le nom est corrigé dans tous les fichiers, clés comprises', async () => {
  const r = await renommerAgent('Jean DUPONT', 'Jeanne DUPONT');
  assert.ok(r.total >= 5);
  const cfg = readFixture(dir, 'config.json');
  assert.deepEqual(cfg.fo_list, ['Jeanne DUPONT', 'Awa']);
  assert.equal(cfg.fo_trackers['Jeanne DUPONT'], 'SN');
  assert.equal(cfg.fo_scorecards['2026-10']['Jeanne DUPONT'].sla, 90);
  assert.equal(cfg.fo_renames['Jean DUPONT'], 'Jeanne DUPONT');
  const t = readFixture(dir, 'fo_tasks.json')[0];
  assert.equal(t.assigned_to, 'Jeanne DUPONT');
  assert.equal(t.title, 'Suivi Jean DUPONTUE');          // autre nom : intact
  assert.equal(readFixture(dir, 'weekly_progress.json')[0].modified_by, 'Jeanne DUPONT');
  assert.equal(readFixture(dir, 'shifts_plan.json')[0].fo, 'Jeanne DUPONT - FO');
});

test('refus : agent inconnu, doublon, nom identique', async () => {
  await assert.rejects(renommerAgent('Personne', 'X'), /inconnu/);
  await assert.rejects(renommerAgent('Jeanne DUPONT', 'awa'), /déjà/);
  await assert.rejects(renommerAgent('Awa', 'Awa'), /identique/);
});

test('fusion avec un agent déjà existant, sans perte', async () => {
  const { writeFixture } = require('./helpers/data-dir');
  writeFixture(dir, 'config.json', { fo_list: ['Jean DUPONT', 'Jeanne DUPONT'],
    fo_scorecards: { '2026-09': { 'Jean DUPONT': { sla: 70 } }, '2026-10': { 'Jeanne DUPONT': { sla: 90 } } } });
  writeFixture(dir, 'weekly_progress.json', [{ modified_by: 'Jean DUPONT', status: 'Done' }, { modified_by: 'Jeanne DUPONT' }]);
  await assert.rejects(renommerAgent('Jean DUPONT', 'Jeanne DUPONT'), /déjà/);
  const { appliquerCorrections } = require('../server/services/rename-agent');
  await appliquerCorrections([['Jean DUPONT', 'Jeanne DUPONT']]);
  const cfg = readFixture(dir, 'config.json');
  assert.deepEqual(cfg.fo_list, ['Jeanne DUPONT']);
  assert.equal(cfg.fo_scorecards['2026-09']['Jeanne DUPONT'].sla, 70);
  assert.equal(cfg.fo_scorecards['2026-10']['Jeanne DUPONT'].sla, 90);
  assert.ok(readFixture(dir, 'weekly_progress.json').every(p => p.modified_by === 'Jeanne DUPONT'));
  const fs = require('fs');
  assert.ok(fs.readdirSync(require('path').join(dir, 'backups')).some(d => d.startsWith('avant-renommage-')));
  await appliquerCorrections([['Jean DUPONT', 'Jeanne DUPONT']]);   // rejouer : rien à faire
  assert.deepEqual(readFixture(dir, 'config.json').fo_list, ['Jeanne DUPONT']);
});
