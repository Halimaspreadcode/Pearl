// Rôles et parties prenantes : création, reconnaissance des noms IMOC, rôle suivi partout.
const { useTempDataDir } = require('./helpers/data-dir');
useTempDataDir({ 'config.json': { fo_list: ['Wilfried Teti', 'Awa Diop'] }, 'bo_list.json': [{ name: 'Moussa Ba' }] });
const { test } = require('node:test');
const assert = require('node:assert/strict');
const parties = require('../server/services/parties');

test('rôle créé, personne rangée, rôle reconnu par l\'identité', async () => {
  const r = await parties.majRole({ label: 'SMC — Service Management Center', key: 'smc' });
  assert.equal(r.key, 'SMC');
  await assert.rejects(parties.majRole({ key: 'FO', label: 'x' }), /déjà un rôle de FOps/);
  await assert.rejects(parties.majPersonne({ name: 'Awa Diop', role: 'SMC' }), /liste des FO/);
  const p = await parties.majPersonne({ name: 'Papa Tahirou Faye', role: 'SMC', country: 'SN' });
  assert.equal(p.country, 'SN');
  assert.equal(parties.roleDe('Papa Tahirou Faye'), 'SMC');
  assert.equal(parties.roleDe('Awa Diop'), 'FO');
  assert.equal(parties.roleDe('Moussa Ba'), 'BO');
  assert.equal(parties.roleDe('Inconnu Total'), 'Observer');
  assert.equal(require('../server/auth/identity').roleDe('Papa Tahirou Faye'), 'SMC');
});

test('nom IMOC « DRPS/DEX/SMC-N/QSM FAYE PAPA TAHIROU » : Papa Tahirou du SMC', () => {
  const r = parties.reconnaitre('DRPS/DEX/SMC-N/QSM FAYE PAPA TAHIROU');
  assert.equal(r.sur, true); assert.equal(r.name, 'Papa Tahirou Faye'); assert.equal(r.role, 'SMC'); assert.equal(r.country, 'SN');
  assert.equal(r.org, 'DRPS/DEX/SMC-N/QSM');
  const fo = parties.reconnaitre('EMOC FO Huawei CI TETI TETY  WILFRIED Franck');
  assert.equal(fo.name, 'Wilfried Teti'); assert.equal(fo.role, 'FO');
});

test('inconnu : nom lisible et rôle deviné d\'après l\'organisation, puis graphie retenue', async () => {
  const r = parties.reconnaitre('DRPS/DEX/SMC-N/QSM NDIAYE FATOU BINETOU');
  assert.equal(r.sur, false); assert.equal(r.nom, 'Ndiaye Fatou Binetou'); assert.equal(r.role_devine, 'SMC');
  const p = await parties.majPersonne({ name: 'Fatou Binetou Ndiaye', role: 'SMC', aliases: [r.brut] });
  assert.ok(parties.reconnaitre('DRPS/DEX/SMC-N/QSM NDIAYE FATOU BINETOU').sur);
  await parties.ajouterAlias(p.id, 'F. B. NDIAYE');
  assert.equal(parties.reconnaitre('F. B. NDIAYE').via, 'graphie connue');
});

test('rôle avec des membres : suppression refusée', async () => {
  await assert.rejects(parties.retirerRole('SMC'), /ont ce rôle/);
});
