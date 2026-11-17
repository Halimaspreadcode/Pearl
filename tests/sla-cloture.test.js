// Ticket clos sans date de clôture : le chrono SLA s'arrête à la clôture.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeSLA } = require('../server/core/sla');

const cfg = { work_mode: 'drill', timezone: 'UTC',
  sla_hours: { 'Incident P2': { hours: 4, mode: 'business' },
               'Incident P1': { workaround: { hours: 2, mode: 'business' }, final: { hours: 8, mode: 'business' } } } };

// Vendredi 9 oct. 2026, 14:00 UTC → échéance lundi 12 oct. 09:00 (3,5 h vendredi + 0,5 h lundi).
const base = { type: 'Incident', priority: 'P2', occur_time: '2026-10-09T14:00:00Z' };

test('fermé vendredi sans date de clôture : pas de rupture lundi', () => {
  const t = { ...base, status: 'Closed', closed_by_at: '2026-10-09T16:00:00Z', modified_at: '2026-10-09T16:00:00Z' };
  const r = computeSLA(t, cfg);
  assert.equal(r.sla_status, 'In SLA');
  assert.ok(r.time_left_ms > 0);
});

test('date de clôture présente : elle fait foi', () => {
  const r = computeSLA({ ...base, status: 'Closed', close_date: '2026-10-09T17:00:00Z' }, cfg);
  assert.equal(r.time_left_ms, new Date('2026-10-12T09:00:00Z') - new Date('2026-10-09T17:00:00Z'));
});

test('ouvert : le chrono court toujours', () => {
  const r = computeSLA({ ...base, status: 'Open' }, cfg);
  assert.equal(r.deadline, '2026-10-12T09:00:00.000Z');
});

test('SLA en deux temps : clos sans date de contournement, le contournement s\'arrête à la clôture', () => {
  const r = computeSLA({ ...base, priority: 'P1', status: 'Resolved', close_date: '2026-10-09T15:00:00Z' }, cfg);
  assert.ok(r.sla_workaround.time_left_ms > 0);
  assert.equal(r.sla_status, 'In SLA');
});
