// Une demande d'absence approuvée (My Space › Requests) crée l'absence
// validée correspondante : le solde de congés doit bouger.
const { useTempDataDir, readFixture } = require('./helpers/data-dir');
const dir = useTempDataDir({
  'config.json': { fo_list: ['Awa'], leave_entitlement_days: 30 },
  'absences.json': [], 'shift_requests.json': [], 'shifts_plan.json': [],
});
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { absenceDepuisDemande } = require('../server/routes/shift-requests');
const { computeAbsenceSummary } = require('../server/services/absences');
const attendre = () => new Promise(r => setTimeout(r, 50));

test('demande d\'absence approuvée → congé validé, solde décompté', async () => {
  absenceDepuisDemande({ id: 'r1', type: 'absence', fo_name: 'Awa', date: '2026-11-02', date_to: '2026-11-04', note: 'Annual leave' });
  await attendre();
  const abs = readFixture(dir, 'absences.json');
  assert.equal(abs.length, 1);
  assert.equal(abs[0].type, 'Congés payés');
  assert.equal(abs[0].status, 'Validée');
  const awa = computeAbsenceSummary({ year: 2026 }).balances.find(b => b.fo_name === 'Awa');
  assert.equal(awa.taken, 3);
  assert.equal(awa.remaining, 27);
});

test('pas de doublon si la demande est approuvée deux fois', async () => {
  absenceDepuisDemande({ id: 'r1', type: 'absence', fo_name: 'Awa', date: '2026-11-02', date_to: '2026-11-04' });
  await attendre();
  assert.equal(readFixture(dir, 'absences.json').length, 1);
});

test('maladie et déplacement : enregistrés sans entamer le solde', async () => {
  absenceDepuisDemande({ id: 'r2', type: 'absence', fo_name: 'Awa', date: '2026-11-09', note: 'Sick leave' });
  absenceDepuisDemande({ id: 'r3', type: 'onsite', fo_name: 'Awa', date: '2026-11-10' });
  absenceDepuisDemande({ id: 'r4', type: 'swap', fo_name: 'Awa', date: '2026-11-11' });
  await attendre();
  const types = readFixture(dir, 'absences.json').map(a => a.type).sort();
  assert.deepEqual(types, ['Congés payés', 'Maladie', 'On-Site (Delivery)']);
  assert.equal(computeAbsenceSummary({ year: 2026 }).balances[0].remaining, 27);
});
