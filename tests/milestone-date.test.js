// Date de réalisation d'un jalon : saisie par l'agent ou corrigée par le
// manager, elle décide « tenu » ou « en retard ».
const { useTempDataDir } = require('./helpers/data-dir');
useTempDataDir({ 'config.json': { timezone: 'Africa/Dakar' } });

const { test } = require('node:test');
const assert = require('node:assert/strict');
const OBJ = require('../server/services/objectives');

const TODAY = '2026-09-29';

test('doneDate : accepte une date passée récente, refuse le futur, le trop ancien, le mal formé', () => {
  assert.equal(OBJ.doneDate('2026-09-03', TODAY), '2026-09-03T12:00:00.000Z');
  assert.equal(OBJ.doneDate('2026-09-29', TODAY), '2026-09-29T12:00:00.000Z');
  assert.equal(OBJ.doneDate('2026-09-30', TODAY), null);
  assert.equal(OBJ.doneDate('2025-01-01', TODAY), null);
  assert.equal(OBJ.doneDate('29/09/2026', TODAY), null);
  assert.equal(OBJ.doneDate('', TODAY), null);
});

test('un jalon fait avant son échéance mais coché après n\'est plus en retard une fois la date donnée', () => {
  const coche = { due: '2026-09-10', done: true, state: 'approved', done_at: '2026-09-15T08:00:00.000Z' };
  const o = { steps: [coche] };
  assert.equal(OBJ.objProgressPct(o, TODAY), 50);          // compté en retard : moitié
  coche.done_at = OBJ.doneDate('2026-09-08', TODAY);
  assert.equal(OBJ.objProgressPct(o, TODAY), 100);         // tenu : plein
});

test('stepsSansDate : tout jalon doit avoir une date limite', () => {
  assert.equal(OBJ.stepsSansDate([]), null);
  assert.equal(OBJ.stepsSansDate([{ label: 'Analyse', due: '2026-10-15' }]), null);
  // Une ligne vide (sans libellé) n'est pas un jalon : ignorée.
  assert.equal(OBJ.stepsSansDate([{ label: '', due: '' }]), null);
  const msg = OBJ.stepsSansDate([{ label: 'Analyse', due: '2026-10-15' }, { label: 'Revue', due: '' }, { title: 'Bilan' }]);
  assert.match(msg, /needs a deadline/);
  assert.match(msg, /Revue/);
  assert.match(msg, /Bilan/);
  assert.doesNotMatch(msg, /Analyse/);
  assert.match(OBJ.stepsSansDate([{ label: 'X', due: '15/10/2026' }]), /needs a deadline/);
});
