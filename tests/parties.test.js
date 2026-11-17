// Rôles et parties prenantes : création, reconnaissance des noms IMOC, rôle suivi partout.
const { useTempDataDir } = require('./helpers/data-dir');
useTempDataDir({ 'config.json': { fo_list: ['Lucas Garnier', 'Awa Diop'], sites: [{ code: 'SN', name: 'Sénégal' }, { code: 'CI', name: 'Côte d\'Ivoire' }] }, 'bo_list.json': [{ name: 'Moussa Ba' }] });
const { test } = require('node:test');
const assert = require('node:assert/strict');
const parties = require('../server/services/parties');

test('rôle créé, personne rangée, rôle reconnu par l\'identité', async () => {
  const r = await parties.majRole({ label: 'SMC — Service Management Center', key: 'smc' });
  assert.equal(r.key, 'SMC');
  await assert.rejects(parties.majRole({ key: 'FO', label: 'x' }), /déjà un rôle de Pearl/);
  await assert.rejects(parties.majPersonne({ name: 'Awa Diop', role: 'SMC' }), /liste des FO/);
  const p = await parties.majPersonne({ name: 'Pierre Antoine Moreau', role: 'SMC', country: 'SN' });
  assert.equal(p.country, 'SN');
  assert.equal(parties.roleDe('Pierre Antoine Moreau'), 'SMC');
  assert.equal(parties.roleDe('Awa Diop'), 'FO');
  assert.equal(parties.roleDe('Moussa Ba'), 'BO');
  assert.equal(parties.roleDe('Inconnu Total'), 'Observer');
  assert.equal(require('../server/auth/identity').roleDe('Pierre Antoine Moreau'), 'SMC');
});

test('nom IMOC « DIR/OPS/SMC-N/QSM MOREAU PIERRE ANTOINE » : Pierre Antoine du SMC', () => {
  const r = parties.reconnaitre('DIR/OPS/SMC-N/QSM MOREAU PIERRE ANTOINE');
  assert.equal(r.sur, true); assert.equal(r.name, 'Pierre Antoine Moreau'); assert.equal(r.role, 'SMC'); assert.equal(r.country, 'SN');
  assert.equal(r.org, 'DIR/OPS/SMC-N/QSM');
  const fo = parties.reconnaitre('FO CI GARNIER GARNIER  LUCAS Franck');
  assert.equal(fo.name, 'Lucas Garnier'); assert.equal(fo.role, 'FO');
});

test('inconnu : nom lisible et rôle deviné d\'après l\'organisation, puis graphie retenue', async () => {
  const r = parties.reconnaitre('DIR/OPS/SMC-N/QSM ROUX CAMILLE SOPHIE');
  assert.equal(r.sur, false); assert.equal(r.nom, 'Roux Camille Sophie'); assert.equal(r.role_devine, 'SMC');
  const p = await parties.majPersonne({ name: 'Camille Sophie Roux', role: 'SMC', aliases: [r.brut] });
  assert.ok(parties.reconnaitre('DIR/OPS/SMC-N/QSM ROUX CAMILLE SOPHIE').sur);
  await parties.ajouterAlias(p.id, 'C. S. ROUX');
  assert.equal(parties.reconnaitre('C. S. ROUX').via, 'graphie connue');
});

test('rôle avec des membres : suppression refusée', async () => {
  await assert.rejects(parties.retirerRole('SMC'), /ont ce rôle/);
});
