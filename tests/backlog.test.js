// Encours (backlog) : une seule définition de « ouvert à une date », pour
// que l'encours de la semaine précédente et celui de la semaine affichée
// se raccordent par les ouvertures et les clôtures de la semaine.
const { useTempDataDir } = require('./helpers/data-dir');
useTempDataDir({ 'config.json': {} });

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { ouvertA, closDans, dateCloture } = require('../server/services/reports');

const D = s => new Date(s);
const finS1 = D('2026-09-27T23:59:59Z');   // fin de la semaine précédente
const debS2 = D('2026-09-28T00:00:00Z');
const finS2 = D('2026-10-04T23:59:59Z');

describe('ouvertA', () => {
  test('ticket encore ouvert', () => {
    assert.equal(ouvertA({ status: 'Open', open_date: '2026-09-01' }, finS1), true);
  });
  test('pas encore créé', () => {
    assert.equal(ouvertA({ status: 'Open', open_date: '2026-10-01' }, finS1), false);
  });
  test('fermé avec Close Date après la date : ouvert à la date', () => {
    const t = { status: 'Closed', open_date: '2026-09-01', close_date: '2026-09-30' };
    assert.equal(ouvertA(t, finS1), true);
    assert.equal(ouvertA(t, finS2), false);
  });
  // Le cas signalé : fermé sans Close Date. Il restait ouvert pour toujours
  // dans l'historique, alors que l'encours actuel (par statut) l'excluait.
  test('fermé sans Close Date : daté par la dernière modification', () => {
    const t = { status: 'Closed', open_date: '2026-09-01', modified_at: '2026-09-30T10:00:00Z' };
    assert.equal(dateCloture(t), '2026-09-30T10:00:00Z');
    assert.equal(ouvertA(t, finS1), true);
    assert.equal(ouvertA(t, finS2), false);
    assert.equal(closDans(t, debS2, finS2), true);
  });
  test('fermé sans aucune date : jamais compté ouvert', () => {
    const t = { status: 'Resolved', open_date: '2026-09-01' };
    assert.equal(ouvertA(t, finS1), false);
    assert.equal(closDans(t, debS2, finS2), false);
  });
});

test('encours précédent + ouverts − clos = encours de la semaine', () => {
  const tickets = [
    { status: 'Open',     open_date: '2026-09-10' },
    { status: 'Closed',   open_date: '2026-09-10', modified_at: '2026-09-29' },
    { status: 'Resolved', open_date: '2026-09-12', close_date: '2026-10-01' },
    { status: 'Closed',   open_date: '2026-09-29', close_date: '2026-10-02' },
    { status: 'On Hold',  open_date: '2026-09-30' },
    { status: 'Closed',   open_date: '2026-09-01', close_date: '2026-09-15' },
  ];
  const avant = tickets.filter(t => ouvertA(t, finS1)).length;
  const apres = tickets.filter(t => ouvertA(t, finS2)).length;
  const ouverts = tickets.filter(t => new Date(t.open_date) >= debS2 && new Date(t.open_date) <= finS2).length;
  const clos = tickets.filter(t => closDans(t, debS2, finS2)).length;
  assert.equal(avant, 3);
  assert.equal(apres, avant + ouverts - clos);
});
