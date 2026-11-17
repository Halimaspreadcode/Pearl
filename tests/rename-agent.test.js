// Renommer un agent partout (server/services/rename-agent.js).
const { useTempDataDir, readFixture } = require('./helpers/data-dir');
const dir = useTempDataDir({
  'config.json': { fo_list: ['Fatim NDOYE', 'Awa'], fo_trackers: { 'Fatim NDOYE': 'SN' },
    fo_scorecards: { '2026-10': { 'Fatim NDOYE': { sla: 90 }, Awa: { sla: 80 } } } },
  'fo_tasks.json': [{ id: 't1', assigned_to: 'Fatim NDOYE', title: 'Suivi Fatim NDOYEUE' }],
  'weekly_progress.json': [{ id: 'w1', admin_task: true, modified_by: 'fatim ndoye' }],
  'shifts_plan.json': [{ fo: 'Fatim NDOYE - FO' }],
});
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renommerAgent } = require('../server/services/rename-agent');

test('le nom est corrigé dans tous les fichiers, clés comprises', async () => {
  const r = await renommerAgent('Fatim NDOYE', 'Fatime NDOYE');
  assert.ok(r.total >= 5);
  const cfg = readFixture(dir, 'config.json');
  assert.deepEqual(cfg.fo_list, ['Fatime NDOYE', 'Awa']);
  assert.equal(cfg.fo_trackers['Fatime NDOYE'], 'SN');
  assert.equal(cfg.fo_scorecards['2026-10']['Fatime NDOYE'].sla, 90);
  assert.equal(cfg.fo_renames['Fatim NDOYE'], 'Fatime NDOYE');
  const t = readFixture(dir, 'fo_tasks.json')[0];
  assert.equal(t.assigned_to, 'Fatime NDOYE');
  assert.equal(t.title, 'Suivi Fatim NDOYEUE');          // autre nom : intact
  assert.equal(readFixture(dir, 'weekly_progress.json')[0].modified_by, 'Fatime NDOYE');
  assert.equal(readFixture(dir, 'shifts_plan.json')[0].fo, 'Fatime NDOYE - FO');
});

test('refus : agent inconnu, doublon, nom identique', async () => {
  await assert.rejects(renommerAgent('Personne', 'X'), /inconnu/);
  await assert.rejects(renommerAgent('Fatime NDOYE', 'awa'), /déjà/);
  await assert.rejects(renommerAgent('Awa', 'Awa'), /identique/);
});

test('fusion avec un agent déjà existant, sans perte', async () => {
  const { writeFixture } = require('./helpers/data-dir');
  writeFixture(dir, 'config.json', { fo_list: ['Fatim NDOYE', 'Fatime NDOYE'],
    fo_scorecards: { '2026-09': { 'Fatim NDOYE': { sla: 70 } }, '2026-10': { 'Fatime NDOYE': { sla: 90 } } } });
  writeFixture(dir, 'weekly_progress.json', [{ modified_by: 'Fatim NDOYE', status: 'Done' }, { modified_by: 'Fatime NDOYE' }]);
  await assert.rejects(renommerAgent('Fatim NDOYE', 'Fatime NDOYE'), /déjà/);
  const { appliquerCorrections } = require('../server/services/rename-agent');
  await appliquerCorrections();
  const cfg = readFixture(dir, 'config.json');
  assert.deepEqual(cfg.fo_list, ['Fatime NDOYE']);
  assert.equal(cfg.fo_scorecards['2026-09']['Fatime NDOYE'].sla, 70);
  assert.equal(cfg.fo_scorecards['2026-10']['Fatime NDOYE'].sla, 90);
  assert.ok(readFixture(dir, 'weekly_progress.json').every(p => p.modified_by === 'Fatime NDOYE'));
  const fs = require('fs');
  assert.ok(fs.readdirSync(require('path').join(dir, 'backups')).some(d => d.startsWith('avant-renommage-')));
  await appliquerCorrections();   // rejouer : rien à faire
  assert.deepEqual(readFixture(dir, 'config.json').fo_list, ['Fatime NDOYE']);
});
