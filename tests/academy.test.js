// Le catalogue de l'Academy est lu dans les pages des formations
// elles-mêmes (services/academy.js). Si une mise à jour de digitalview.html
// change la forme de son script, l'Academy afficherait des formations
// vides : ce test le dit avant la mise en production.
const test = require('node:test');
const assert = require('node:assert/strict');
const { catalog } = require('../server/services/academy');

test('le catalogue est vide par défaut et reste un tableau', () => {
  const c = catalog();
  assert.ok(Array.isArray(c));
  assert.equal(c.length, 0);
});
