// Recherche en langage naturel : la requête lue par Big Brother est
// exécutée par FOps sur les vraies données.
const { useTempDataDir } = require('./helpers/data-dir');
useTempDataDir({
  'config.json': { fo_list: ['Awa NDIAYE', 'Moussa DIOP', 'Koffi YAO'], fo_trackers: { 'Koffi YAO': 'CI' } },
  'sn.json': [
    { id: 's1', sn_tt: 'TT1', title: 'Lien coupé', type: 'Incident', priority: 'P2', status: 'Open', open_date: '2026-10-09T08:00:00Z', assigned_to: 'Awa NDIAYE' },
    { id: 's2', sn_tt: 'TT2', title: 'Alarme', type: 'Incident', priority: 'P3', status: 'Closed', open_date: '2026-10-09T09:00:00Z', close_date: '2026-10-09T11:00:00Z', assigned_to: 'Moussa DIOP' },
    { id: 's3', sn_tt: 'TT3', title: 'Demande', type: 'Request', priority: 'P4', status: 'Closed', open_date: '2026-10-08T09:00:00Z', assigned_to: 'Awa NDIAYE' },
  ],
  'ci.json': [{ id: 'c1', sn_tt: 'TC1', title: 'Coupure', type: 'Incident', priority: 'P1', status: 'Open', open_date: '2026-10-09T10:00:00Z', assigned_to: 'Koffi YAO' }],
  'absences.json': [{ id: 'a1', fo_name: 'Moussa DIOP', type: 'Maladie', status: 'Validée', date_from: '2026-09-10', date_to: '2026-09-12' }],
});
const test = require('node:test');
const assert = require('node:assert');
const { executer, compare } = require('../server/services/ai-recherche');
const auj = '2026-10-12';

test('recherche : tickets ouverts vendredi et pas fermés', () => {
  const r = executer({ source: 'tickets', filtres: [{ champ: 'ouvert_le', op: '=', valeur: '2026-10-09' }, { champ: 'ferme', op: '=', valeur: 'non' }], colonnes: ['ticket', 'agent', 'pays'] }, { auj });
  assert.equal(r.total, 2);
  assert.deepEqual(r.lignes.map(l => l.ticket).sort(), ['TC1', 'TT1']);
});

test('recherche : le pays filtre les tickets', () => {
  const r = executer({ source: 'tickets', filtres: [{ champ: 'ferme', op: '=', valeur: 'non' }] }, { auj, pays: 'SN' });
  assert.deepEqual(r.lignes.map(l => l.ticket), ['TT1']);
});

test('recherche : clos sans date de clôture', () => {
  const r = executer({ source: 'tickets', filtres: [{ champ: 'ferme', op: '=', valeur: 'oui' }, { champ: 'clos_le', op: 'vide' }], colonnes: ['ticket'] }, { auj });
  assert.deepEqual(r.lignes.map(l => l.ticket), ['TT3']);
});

test('recherche : regroupement par agent', () => {
  const r = executer({ source: 'tickets', filtres: [], regrouper_par: 'agent' }, { auj });
  assert.equal(r.groupe, 'agent');
  assert.deepEqual(r.lignes[0], { agent: 'Awa NDIAYE', nombre: 2 });
});

test('recherche : absences entre deux dates, champ inconnu ignoré', () => {
  const r = executer({ source: 'absences', filtres: [{ champ: 'du', op: 'entre', valeur: ['2026-09-01', '2026-09-30'] }, { champ: 'motif_secret', op: '=', valeur: 'x' }], colonnes: ['agent', 'jours'] }, { auj });
  assert.equal(r.total, 1);
  assert.equal(r.lignes[0].jours, 3);
  assert.deepEqual(r.ignores, ['motif_secret =']);
});

test('recherche : source inconnue', () => assert.match(executer({ source: 'salaires' }, { auj }).erreur, /inconnue/));
test('recherche : comparaisons', () => {
  assert.equal(compare('2026-10-09T08:00:00Z', '=', '2026-10-09', true), true);
  assert.equal(compare(5, '>=', '3'), true);
  assert.equal(compare('Open', 'dans', ['Open', 'On Hold']), true);
});
