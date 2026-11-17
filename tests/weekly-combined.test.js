const test = require('node:test');
const assert = require('node:assert');
const { isOutage } = require('../server/services/weekly-combined');

// Les Observations sont du texte libre : un incident de plateforme se
// reconnaît à son vocabulaire, en français comme en anglais.
test('reconnaît un incident de plateforme', () => {
  assert.ok(isOutage({ observation: 'Panne du portail U2020 entre 10 h et 11 h' }));
  assert.ok(isOutage({ observation: 'Supervision MMC instable en fin de nuit' }));
  assert.ok(isOutage({ observation: 'NCE unavailable for 20 minutes' }));
  assert.ok(isOutage({ observation: 'Plateforme indisponible', impact: '' }));
  assert.ok(isOutage({ observation: 'Lien OK', impact: 'Coupure électrique sur le site' }));
});

test("n'en voit pas dans une observation ordinaire", () => {
  assert.ok(!isOutage({ observation: "Nouvelle procédure d'escalade appliquée sans incident" }));
  assert.ok(!isOutage({ observation: 'Script de collecte relancé manuellement' }));
});
