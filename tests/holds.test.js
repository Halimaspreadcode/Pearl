// Règle On Hold : un ticket gelé arrête son SLA à la mise en attente, n'est
// jamais compté en rupture, et reprend à la sortie sans que l'attente soit
// décomptée. Ces tests protègent le calcul des échéances avec attentes.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { enrichTicket } = require('../server/core/sla');
const { majAttentes, reconstruireAttentes, periodesAttente } = require('../server/core/holds');

const H = 3600000;
const CFG = { timezone: 'UTC', work_mode: 'live', sla_hours: { 'Incident P1': 4 } };
const base = { type: 'Incident', priority: 'P1', occur_time: '2026-03-02T08:00:00.000Z',
               open_date: '2026-03-02T08:00:00.000Z' };

describe('SLA et On Hold', () => {
  // Gelé après 1 h sur 4 : il reste 3 h figées, statut « On Hold », jamais « Breach »,
  // même si l'échéance d'origine est dépassée depuis longtemps.
  test('ticket gelé : statut On Hold et temps restant figé', () => {
    const r = enrichTicket({ ...base, status: 'On Hold',
      hold_periods: [{ from: '2026-03-02T09:00:00.000Z', to: null }] }, CFG);
    assert.equal(r.sla_status, 'On Hold');
    assert.equal(r.time_left_ms, 3 * H);
    assert.equal(r.sla_frozen_status, 'In SLA');
    assert.equal(r.deadline, null);
  });

  // Déjà en rupture avant le gel : toujours « On Hold » (non compté), mais
  // le statut figé garde la trace de la rupture.
  test('rupture antérieure au gel : non comptée, mais tracée', () => {
    const r = enrichTicket({ ...base, status: 'On Hold',
      hold_periods: [{ from: '2026-03-02T13:00:00.000Z', to: null }] }, CFG);
    assert.equal(r.sla_status, 'On Hold');
    assert.equal(r.sla_frozen_status, 'Breach');
  });

  // Gel de 10 h entre 09:00 et 19:00 puis reprise : l'échéance recule de 10 h.
  test('reprise : la durée d’attente repousse l’échéance', () => {
    const r = enrichTicket({ ...base, status: 'Resolved', close_date: '2026-03-02T20:30:00.000Z',
      hold_periods: [{ from: '2026-03-02T09:00:00.000Z', to: '2026-03-02T19:00:00.000Z' }] }, CFG);
    assert.equal(r.deadline, '2026-03-02T22:00:00.000Z');
    assert.equal(r.sla_status, 'In SLA');
    assert.equal(r.time_left_ms, 1.5 * H);
  });

  // Attente commencée après la clôture ou après l'échéance : sans effet.
  test('attente postérieure à l’échéance : sans effet', () => {
    const r = enrichTicket({ ...base, status: 'Resolved', close_date: '2026-03-02T15:00:00.000Z',
      hold_periods: [{ from: '2026-03-02T13:00:00.000Z', to: '2026-03-02T14:00:00.000Z' }] }, CFG);
    assert.equal(r.deadline, '2026-03-02T12:00:00.000Z');
    assert.equal(r.sla_status, 'Breach');
  });

  // Mode ouvré : un gel du vendredi 16:00 au lundi 09:00 ne consomme rien, et
  // les 2 h restantes du vendredi reprennent le lundi à 09:00.
  test('mode ouvré : reprise après un week-end de gel', () => {
    const cfg = { timezone: 'UTC', work_mode: 'live', sla_hours: { 'Incident P1': { hours: 4, mode: 'business' } } };
    const r = enrichTicket({ ...base, occur_time: '2026-03-06T14:00:00.000Z', status: 'In Progress',
      hold_periods: [{ from: '2026-03-06T16:00:00.000Z', to: '2026-03-09T09:00:00.000Z' }] }, cfg);
    assert.equal(r.deadline, '2026-03-09T11:00:00.000Z');
  });
});

describe('Tenue des périodes', () => {
  test('mise en attente puis reprise', () => {
    const t0 = new Date('2026-03-02T09:00:00.000Z'), t1 = new Date('2026-03-02T12:00:00.000Z');
    const p1 = majAttentes({ status: 'Open' }, { status: 'On Hold' }, t0);
    assert.deepEqual(p1, [{ from: t0.toISOString(), to: null }]);
    const p2 = majAttentes({ status: 'On Hold', hold_periods: p1 }, { status: 'In Progress' }, t1);
    assert.deepEqual(p2, [{ from: t0.toISOString(), to: t1.toISOString() }]);
  });
  test('modification sans changement de statut : périodes inchangées', () => {
    const p = [{ from: '2026-03-02T09:00:00.000Z', to: null }];
    assert.deepEqual(majAttentes({ status: 'On Hold', hold_periods: p }, { status: 'On Hold' }), p);
  });
  test('ticket On Hold sans période (donnée ancienne) : gel depuis la dernière modification', () => {
    const p = periodesAttente({ status: 'On Hold', modified_at: '2026-03-02T10:00:00.000Z' });
    assert.equal(p.length, 1);
    assert.equal(p[0].to, null);
  });
});

describe('Reconstitution depuis l’audit', () => {
  test('rejoue les changements de statut', () => {
    const audit = [
      { ts: '2026-03-02T08:00:00.000Z', action: 'create', changes: { status: 'Open' } },
      { ts: '2026-03-02T09:00:00.000Z', action: 'update', changes: { status: { from: 'Open', to: 'On Hold' } } },
      { ts: '2026-03-02T11:00:00.000Z', action: 'update', changes: { comments: { from: '', to: 'x' } } },
      { ts: '2026-03-02T12:00:00.000Z', action: 'update', changes: { status: { from: 'On Hold', to: 'In Progress' } } },
      { ts: '2026-03-03T08:00:00.000Z', action: 'update', changes: { status: { from: 'In Progress', to: 'On Hold' } } },
    ];
    const p = reconstruireAttentes({ status: 'On Hold' }, audit);
    assert.deepEqual(p, [
      { from: '2026-03-02T09:00:00.000Z', to: '2026-03-02T12:00:00.000Z' },
      { from: '2026-03-03T08:00:00.000Z', to: null },
    ]);
  });
  test('audit tronqué : le statut actuel fait foi', () => {
    const p = reconstruireAttentes({ status: 'On Hold', modified_at: '2026-03-04T08:00:00.000Z' }, []);
    assert.deepEqual(p, [{ from: '2026-03-04T08:00:00.000Z', to: null }]);
  });
});
