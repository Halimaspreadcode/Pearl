// Le catalogue de l'Academy est lu dans les pages des formations
// elles-mêmes (services/academy.js). Si une mise à jour de digitalview.html
// change la forme de son script, l'Academy afficherait des formations
// vides : ce test le dit avant la mise en production.
const test = require('node:test');
const assert = require('node:assert/strict');
const { catalog } = require('../server/services/academy');

test('le catalogue lit les modules de chaque formation', () => {
  const c = catalog();
  const ids = c.map(x => x.id);
  assert.deepEqual(ids, ['digitalview', 'process', 'mobilemoney', 'datacenter', 'reseau']);
  for (const course of c) {
    assert.ok(course.modules.length > 0, `${course.id} sans module`);
    for (const m of course.modules) {
      assert.match(m.id, /^M\d+$/);
      assert.ok(m.sessions.length > 0, `${course.id}:${m.id} sans session`);
      assert.ok(m.sessions.every(s => s.key.startsWith(`${m.id}.`)));
    }
  }
});
