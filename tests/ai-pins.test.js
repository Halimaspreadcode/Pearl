// Résultats épinglés : ajout, mise à jour (actualiser), retrait, bornes.
const { useTempDataDir } = require('./helpers/data-dir');
useTempDataDir();
const test = require('node:test');
const assert = require('node:assert');
const pins = require('../server/services/ai-pins');

test('ai-pins : ajouter, mettre à jour, retirer', async () => {
  const p = await pins.ajouter({ skill: 'decision', titre: 'Rapport de décision', input: { perimetre: 'Dakar (SN)' },
    resultat: { content: '', vue: 'decision', data: { situation: 'v1' }, faits: {}, meta: 'x', secret: 'non' } });
  assert.equal(pins.lister().length, 1);
  assert.equal(pins.lister()[0].resultat.secret, undefined);
  const maj = await pins.mettreAJour(p.id, { vue: 'decision', data: { situation: 'v2' } });
  assert.equal(maj.resultat.data.situation, 'v2');
  assert.equal(await pins.retirer(p.id), true);
  assert.equal(pins.lister().length, 0);
});

test('ai-pins : nombre d\'épingles borné', async () => {
  for (let i = 0; i < pins.MAX_PINS; i++) await pins.ajouter({ skill: 'rca', resultat: { content: String(i) } });
  await assert.rejects(pins.ajouter({ skill: 'rca', resultat: { content: 'trop' } }), /au plus/);
});

test('ai-pins : réponse trop volumineuse refusée', async () => {
  await assert.rejects(pins.ajouter({ skill: 'rca', resultat: { content: 'x'.repeat(400 * 1024) } }), /volumineuse/);
});
