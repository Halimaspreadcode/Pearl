// Connecteur IMOC : normalisation, accumulation des tickets, identifiants jamais gardés.
const { useTempDataDir } = require('./helpers/data-dir');
const dir = useTempDataDir({});
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const imoc = require('../server/services/imoc');
const { FILES } = require('../server/config/paths');

const brut = (n, extra = {}) => ({ orderNumber: n, orderName: 'OCEANE_' + n, modelName: 'OCEANE Product Ticket', orderStatus: 'processing',
  currentStepName: 'BO Analyse and Resolve', processGroups: [{ groupName: 'BO' }, { groupName: 'BO' }], beginTime: '2026-11-01 10:00:00',
  modifyTime: '2026-11-02 10:00:00', processDuration: '3600', orderUrl: '/eticket/framework?number=' + n, ...extra });

test('pays : OSN → SN, CI / OCI → CI', () => {
  assert.equal(imoc.pays('OSN-2610233qv9'), 'SN');
  assert.equal(imoc.pays('CI-26110003'), 'CI');
  assert.equal(imoc.pays('OCI-1'), 'CI');
  assert.equal(imoc.pays('XYZ-1'), '');
});

test('normalisation : champs utiles, groupes sans doublon, lien complet', () => {
  const t = imoc.normaliser(brut('OSN-1'), 'https://10.20.93.72');
  assert.equal(t.number, 'OSN-1');
  assert.deepEqual(t.groups, ['BO']);
  assert.equal(t.url, 'https://10.20.93.72/eticket/framework?number=OSN-1');
  assert.equal(t.duration_s, 3600);
});

test('les tickets s\'accumulent : nouveaux ajoutés, connus mis à jour, aucun doublon', async () => {
  const b = 'https://x';
  let r = await imoc.fusionner([brut('OSN-1'), brut('CI-2')].map(t => imoc.normaliser(t, b)), { from: '2026-11-01', to: '2026-11-02' });
  assert.equal(r.new, 2); assert.equal(r.stored, 2);
  r = await imoc.fusionner([brut('OSN-1', { currentStepName: 'FO Close' }), brut('CI-3')].map(t => imoc.normaliser(t, b)), { from: '2026-11-02', to: '2026-11-03' });
  assert.equal(r.new, 1); assert.equal(r.updated, 1); assert.equal(r.stored, 3);
  const base = imoc.base();
  assert.equal(base.tickets.length, 3);
  const t1 = base.tickets.find(t => t.number === 'OSN-1');
  assert.equal(t1.step, 'FO Close');
  assert.ok(t1.first_seen <= t1.last_seen);
  assert.equal(base.runs.length, 2);
});

test('réglages : jamais d\'identifiant ni de mot de passe sur disque', () => {
  imoc.majConf({ instances: [{ id: 'ci', base_url: 'https://100.96.1.9/' }], username: 'moi', password: 'secret' });
  const brutFichier = fs.readFileSync(FILES.imoc, 'utf8');
  assert.doesNotMatch(brutFichier, /moi|secret|password|username/);
  const c = imoc.lireConf();
  assert.equal(c.instances.find(i => i.id === 'sn').base_url, 'https://10.20.93.72');
  assert.equal(c.instances.find(i => i.id === 'ci').base_url, 'https://100.96.1.9');
  assert.throws(() => imoc.majConf({ instances: [{ id: 'sn', base_url: 'pas une adresse' }] }), /Adresse invalide/);
});

test('requête refusée sans identifiants ou période invalide', async () => {
  await assert.rejects(imoc.requete({ from: '2026-11-01', to: '2026-11-02' }), /Identifiant et mot de passe/);
  await assert.rejects(imoc.requete({ username: 'a', password: 'b', from: '2026-11-05', to: '2026-11-01' }), /Période invalide/);
});

test('Oceane TT# déduit du titre IMOC', () => {
  assert.equal(imoc.oceaneDe('OCEANE_Resource_2610M87721'), '2610M87721');
  assert.equal(imoc.oceaneDe('OCEANE Product 2611ABC12'), '2611ABC12');
  assert.equal(imoc.oceaneDe('Titre libre'), '');
});

test('ajout aux trackers : proposé, validé, puis plus proposé ; doublons refusés', async () => {
  const { writeCfg, readCfg } = require('../server/core/store');
  writeCfg({ ...readCfg(), fo_list: ['Awa'], fo_ids: { Awa: 'o1' }, domains: ['MMC'], sla_hours: { 'Incident P3': 24 } });
  await imoc.fusionner([imoc.normaliser(brut('OSN-9', { orderName: 'OCEANE_Resource_2610M87721', currentUser: 'x,o1' }), 'https://x')], { from: '2026-11-01', to: '2026-11-02' });
  let c = imoc.candidats().candidates.find(x => x.ticket.number === 'OSN-9');
  assert.equal(c.fields.tracker, 'sn');
  assert.equal(c.fields.sn_tt, '2610M87721');
  assert.equal(c.fields.fo_owner, 'Awa');
  assert.ok(c.deduced.includes('fo_owner'));
  // Incomplet : refusé par le serveur, rien n'est créé.
  let r = await imoc.importer([{ fields: c.fields }]);
  assert.equal(r.created.length, 0);
  assert.match(r.refused[0].error, /à compléter : .*priority/);
  r = await imoc.importer([{ fields: { ...c.fields, priority: 'P3', severity: 'Minor', domain: 'MMC', bo_handling: 'BO' } }]);
  assert.equal(r.created.length, 1);
  const t = require('../server/core/store').readTracker('sn').find(x => x.imoc_tt === 'OSN-9');
  assert.equal(t.source, 'imoc'); assert.equal(t.sn_tt, '2610M87721');
  assert.ok(!imoc.candidats().candidates.some(x => x.ticket.number === 'OSN-9'));
  r = await imoc.importer([{ fields: { ...c.fields, priority: 'P3', severity: 'Minor', domain: 'MMC', bo_handling: 'BO' } }]);
  assert.match(r.refused[0].error, /déjà dans un tracker/);
});

test('ignorer un ticket : il sort de la liste proposée, puis revient', async () => {
  await imoc.fusionner([imoc.normaliser(brut('CI-77'), 'https://x')], { from: '2026-11-01', to: '2026-11-02' });
  await imoc.ignorer(['CI-77']);
  assert.ok(imoc.candidats().candidates.find(x => x.ticket.number === 'CI-77').ignored);
  await imoc.ignorer(['CI-77'], false);
  assert.ok(!imoc.candidats().candidates.find(x => x.ticket.number === 'CI-77').ignored);
});

test('ancien réglage à une adresse : devient l\'IMOC Sénégal', () => {
  fs.writeFileSync(FILES.imoc, JSON.stringify({ base_url: 'https://10.0.0.1' }));
  const c = imoc.lireConf();
  assert.equal(c.instances[0].id, 'sn'); assert.equal(c.instances[0].base_url, 'https://10.0.0.1');
  assert.equal(c.instances[1].base_url, 'https://100.96.1.8');
});

test('Oceane « - » : accepté, jamais pris pour un doublon', async () => {
  const b = 'https://x', inst = { id: 'ci', country: 'CI' };
  await imoc.fusionner([imoc.normaliser(brut('XX-1', { orderName: 'sans ref' }), b, inst), imoc.normaliser(brut('XX-2', { orderName: 'sans ref' }), b, inst)], { from: '2026-11-01', to: '2026-11-02' });
  const c1 = imoc.candidats().candidates.find(x => x.ticket.number === 'XX-1');
  assert.equal(c1.fields.tracker, 'ci', 'pays de l\'instance quand le préfixe ne dit rien');
  const plein = f => ({ ...f, sn_tt: '-', priority: 'P3', severity: 'Minor', domain: 'MMC', bo_handling: 'BO', fo_owner: 'Awa' });
  const r = await imoc.importer(['XX-1', 'XX-2'].map(n => ({ fields: plein(imoc.candidats().candidates.find(x => x.ticket.number === n).fields) })));
  assert.equal(r.created.length, 2, JSON.stringify(r.refused));
});

test('mises à jour : clôture IMOC proposée, appliquée sur validation, puis plus rien', async () => {
  const b = 'https://x';
  const { readTracker, writeTracker } = require('../server/core/store');
  writeTracker('sn', [...readTracker('sn'), { id: 'sn-up1', imoc_tt: 'OSN-UP1', sn_tt: '2611M1', title: 'Coupure', status: 'On Hold', open_date: '2026-11-01T10:00:00.000Z', priority: 'P2', type: 'Incident' }]);
  await imoc.fusionner([imoc.normaliser(brut('OSN-UP1'), b)], { from: '2026-11-01', to: '2026-11-02' });
  assert.ok(!imoc.synchros().updates.some(u => u.number === 'OSN-UP1'), 'toujours ouvert dans IMOC : rien à proposer');

  await imoc.fusionner([imoc.normaliser(brut('OSN-UP1', { orderStatus: 'closed', endTime: '2026-11-03 08:30:00' }), b)], { from: '2026-11-01', to: '2026-11-03' });
  const u = imoc.synchros().updates.find(x => x.number === 'OSN-UP1');
  assert.equal(u.changes.status.to, 'Resolved');
  assert.equal(u.changes.close_date.to, '2026-11-03T08:30:00.000Z');
  assert.equal(readTracker('sn').find(t => t.id === 'sn-up1').status, 'On Hold', 'rien n\'est écrit sans validation');

  await imoc.ignorerSynchro(['OSN-UP1']);
  assert.ok(imoc.synchros().updates.find(x => x.number === 'OSN-UP1').ignored);
  await imoc.ignorerSynchro(['OSN-UP1'], false);

  const r = await imoc.appliquerSynchro(['OSN-UP1'], 'admin');
  assert.equal(r.applied.length, 1);
  const t = readTracker('sn').find(x => x.id === 'sn-up1');
  assert.equal(t.status, 'Resolved'); assert.equal(t.close_date, '2026-11-03T08:30:00.000Z');
  assert.equal(t.priority, 'P2', 'le reste du ticket est intact');
  assert.ok(t.hold_periods.every(p => p.to), 'la période On Hold est refermée');
  assert.ok(!imoc.synchros().updates.some(x => x.number === 'OSN-UP1'));
});

test('mises à jour : réouverture dans IMOC proposée', async () => {
  const { readTracker, writeTracker } = require('../server/core/store');
  writeTracker('ci', [...readTracker('ci'), { id: 'ci-up2', imoc_tt: 'CI-UP2', status: 'Resolved', close_date: '2026-11-02T10:00:00.000Z' }]);
  await imoc.fusionner([imoc.normaliser(brut('CI-UP2'), 'https://x')], { from: '2026-11-01', to: '2026-11-02' });
  const u = imoc.synchros().updates.find(x => x.number === 'CI-UP2');
  assert.equal(u.changes.status.to, 'In Progress'); assert.equal(u.changes.close_date.to, '');
});

test('fiche IMOC : valeurs de l\'étape en cours, listes traduites, réutilisées pour l\'ajout', async () => {
  const opt = l => [{ optionValue: JSON.stringify(l.map(([k, v]) => ({ optionKey: k, optionValue: v }))) }];
  const champ = (fieldCode, fieldName, fieldType, fieldDefault, optionList, fieldSeq) => ({ fieldCode, fieldName, fieldType, fieldDefault, optionList, fieldSeq });
  const ordre = { orderSource: 'OCEANE', currentStepId: 's2', stepList: [
    { stepId: 's1', fieldList: [champ('Country', 'Country', 'select', '100A', []), champ('Last_Status', 'Last Status', 'text', 'InProgress', null, 7)] },
    { stepId: 's2', fieldList: [
      champ('Basic_Informations', 'Basic Informations', 'group', 'group', null, 0),
      champ('Oceane_Ticket', 'Oceane Ticket Number', 'text', '2611M55555', null, 2),
      champ('Created_on', 'Created on', 'datetime', '2026-10-23 09:24:11', null, 3),
      champ('Start_date', 'Start date', 'datetime', '2026-10-23 09:24:00', null, 4),
      champ('Last_Status', 'Last Status', 'text', 'Restored', null, 7),
      champ('Processing_priority', 'Processing priority', 'select', '4', opt([['P1', '1'], ['P4', '4']]), 10),
      champ('Country', 'Country', 'select', 'OCI', opt([['Botswana', 'OBW'], ['Ivory Coast', 'OCI']]), 15),
      champ('Restoration_dates', 'Restoration date', 'datetime', '2026-10-23 09:36:00', null, 36),
      champ('Resolution_dates', 'Resolution date', 'datetime', '', null, 37),
      champ('Final_natures', 'Final natures', 'select', '604', opt([['IMOC-MMCORE', '604']]), 41),
      champ('Resource_Problem_family', 'Problems details', 'select', '10025043', opt([['False alarm', '10025043']]), 43),
      champ('Unavailability_duration_time', 'unavailability duration', 'datetime', 'none', null, 50),
    ] }] };
  const d = imoc.ficheDe(ordre, [{ stepName: 'FO Creation', handleUser: 'hcadmin001', handleResult: 'submit', handleOpinion: 'submit success', handleTime: '2026-10-23 10:15:16' }], []);
  assert.equal(d.oceane, '2611M55555'); assert.equal(d.priority, 'P4'); assert.equal(d.country, 'Ivory Coast');
  assert.equal(d.last_status, 'Restored', 'valeur de l\'étape en cours');
  assert.equal(d.restoration, '2026-10-23 09:36:00'); assert.equal(d.final_nature, 'IMOC-MMCORE'); assert.equal(d.problem_detail, 'False alarm');
  assert.ok(!d.fields.some(f => f.code === 'Basic_Informations' || f.code === 'Unavailability_duration_time' || f.code === 'Resolution_dates'), 'groupes et champs vides écartés');
  assert.equal(d.logs[0].step, 'FO Creation');

  // La proposition d'ajout reprend la fiche : vrai n° Oceane, priorité, pays, dates.
  const t = imoc.normaliser(brut('OSN-FICHE1', { orderName: 'sans numéro' }), 'https://x');
  t.detail = d; t.detail_updated = t.updated;
  await imoc.fusionner([t], { from: '2026-10-01', to: '2026-10-31' });
  const c = imoc.candidats().candidates.find(x => x.ticket.number === 'OSN-FICHE1');
  assert.equal(c.fields.sn_tt, '2611M55555'); assert.equal(c.fields.priority, 'P4'); assert.equal(c.fields.tracker, 'ci');
  assert.equal(c.fields.occur_time, '2026-10-23T09:24:00.000Z'); assert.equal(c.fields.workaround_date, '2026-10-23T09:36:00.000Z');
  assert.match(c.fields.root_cause, /IMOC-MMCORE · False alarm/);
  assert.ok(c.deduced.includes('priority'));
});

test('FO pris dans « Managing Owner technician » : reconnu, sinon nom IMOC et propositions', () => {
  const fos = ['Wilfried Teti', 'Awa Diop', 'Fatou Sall', 'Koffi Yao'];
  const r = imoc.foDeTechnicien('EMOC FO Huawei CI TETI TETY  WILFRIED Franck', fos);
  assert.equal(r.nom, 'TETI TETY WILFRIED Franck');
  assert.equal(r.fo, 'Wilfried Teti', 'tous les mots du FO présents, dans le désordre');
  assert.equal(imoc.foDeTechnicien('EMOC FO Huawei SN AWA  DIOP', fos).fo, 'Awa Diop');
  const p = imoc.foDeTechnicien('EMOC FO Huawei SN Fatou', fos);
  assert.equal(p.fo, ''); assert.deepEqual(p.suggestions, ['Fatou Sall']);
  assert.deepEqual(imoc.foDeTechnicien('EMOC FO Huawei CI Wang Chunji', fos), { nom: 'Wang Chunji', fo: '', suggestions: [] });
});
