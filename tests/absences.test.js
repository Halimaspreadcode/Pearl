// Absences : jours ouvrés, taux planifié / subi, soldes, taux de préavis,
// conflits avec le planning. computeAbsenceSummary lit ses fichiers via
// core/store : on lui fournit un DATA_DIR temporaire AVANT tout require.
const { useTempDataDir, readFixture } = require('./helpers/data-dir');

// Avril 2026 : commence un mercredi, 22 jours de semaine, lundi 6 férié (SN)
// → 21 jours ouvrés. Le 10 avril est férié en CI seulement.
const DIR = useTempDataDir({
  'config.json': { fo_list: ['Awa', 'Bineta'], leave_entitlement_days: 25 },
  'holidays.json': [
    { date: '2026-04-06', country: 'SN', name: 'Lundi de Pâques' },
    { date: '2026-04-10', country: 'CI', name: 'Férié CI' },
  ],
  'absences.json': [
    // Ven 3 → mar 7 : ven + mar ouvrés, sam/dim sautés, lun 6 férié → 2 j.
    { id: 'a1', fo_name: 'Awa', type: 'Congés payés', status: 'Validée',
      date_from: '2026-04-03', date_to: '2026-04-07', created_at: '2026-03-20T09:00:00Z' },
    // Demi-journée en attente : 0,5 j, compte en « pending », pas en « taken ».
    { id: 'a2', fo_name: 'Awa', type: 'RTT', status: 'Demandée', half_day: true,
      date_from: '2026-04-15', date_to: '2026-04-15', created_at: '2026-04-01T09:00:00Z' },
    // Maladie validée, non prévenue : subie, ne consomme pas le solde.
    { id: 'a3', fo_name: 'Bineta', type: 'Maladie', status: 'Validée', notice: 'Non prévenu',
      date_from: '2026-04-13', date_to: '2026-04-14' },
    // Refusée : ni solde, ni capacité, ni conflit.
    { id: 'a4', fo_name: 'Bineta', type: 'Congés payés', status: 'Refusée',
      date_from: '2026-04-20', date_to: '2026-04-24', created_at: '2026-04-01T09:00:00Z' },
    // Ni préavis ni date de saisie : « à qualifier », pas une faute.
    { id: 'a5', fo_name: 'Bineta', type: 'Formation', status: 'Validée',
      date_from: '2026-04-27', date_to: '2026-04-27' },
    // Préavis importé en slug anglais (« late ») : doit être traduit, et non conforme.
    { id: 'a6', fo_name: 'Awa', type: 'Absence injustifiée', status: 'Validée', notice: 'late',
      date_from: '2026-04-29', date_to: '2026-04-29' },
    // Hors période et sans statut : relu comme « Demandée » et réparé sur disque.
    { id: 'a7', fo_name: 'Awa', type: 'RTT',
      date_from: '2026-06-01', date_to: '2026-06-01' },
  ],
  'shifts_plan.json': [
    { id: 's1', date: '2026-04-14', fo_name: 'Bineta', shift_name: 'Matin' },   // maladie → conflit
    { id: 's2', date: '2026-04-22', fo_name: 'Bineta', shift_name: 'Soir' },    // absence refusée
    { id: 's3', date: '2026-04-07', fo_name: 'Awa', is_rest: true },            // repos → ignoré
    { id: 's4', date: '2026-04-15', fo_name: 'Awa', shift_id: 'N' },            // demande en attente
    { id: 's5', date: '2026-04-04', fo_name: 'Awa', shift_name: 'Week-end' },   // samedi dans un congé
    { id: 's6', date: '2026-05-04', fo_name: 'Bineta', shift_name: 'Matin' },   // hors période
  ],
});

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { computeAbsenceSummary, readAbsences, validateAbsence, defaultNotice } =
  require('../server/services/absences');

const S = computeAbsenceSummary({ country: 'SN', year: 2026, from: '2026-04-01', to: '2026-04-30' });
const bal = name => S.balances.find(b => b.fo_name === name);

describe('Jours ouvrés', () => {
  // Dénominateur du taux : week-ends et fériés du pays exclus.
  test('working_days exclut week-ends et fériés du pays', () => {
    assert.equal(S.working_days, 21);
    assert.equal(S.headcount, 2);
  });

  // Un férié d'un autre pays ne réduit pas les jours ouvrés du Sénégal ;
  // sans filtre pays, tous les fériés s'appliquent.
  test('fériés filtrés par pays', () => {
    const all = computeAbsenceSummary({ country: 'ALL', from: '2026-04-01', to: '2026-04-30' });
    assert.equal(all.working_days, 20);
    assert.equal(all.country, null);
  });

  // Un congé du vendredi au mardi coûte 2 jours, pas 5.
  test('congé à cheval sur un week-end et un férié', () => {
    assert.equal(S.by_type['Congés payés'], 2);
  });
});

describe('Taux planifié / subi', () => {
  // Refusées exclues ; demandes en attente incluses dans la capacité consommée.
  test('total et répartition par type', () => {
    assert.deepEqual(S.by_type, {
      'Congés payés': 2, 'RTT': 0.5, 'Maladie': 2, 'Formation': 1, 'Absence injustifiée': 1,
    });
    assert.equal(S.total_days, 6.5);
  });

  // Le taux non planifié (maladie, injustifiée) est le vrai signal opérationnel.
  test('absence_rate et unplanned_rate sur la capacité (jours ouvrés × effectif)', () => {
    assert.equal(S.unplanned_days, 3);
    assert.equal(S.absence_rate, 15.5);     // 6,5 / 42
    assert.equal(S.unplanned_rate, 7.1);    // 3 / 42
  });

  test('pending_count = demandes en attente dans la période', () => {
    assert.equal(S.pending_count, 1);
  });
});

describe('Soldes', () => {
  // Seuls les types qui décomptent ET validés entament le droit ; les demandes
  // en attente sont réservées à part.
  test('Awa : congé validé pris, RTT en attente réservée', () => {
    const b = bal('Awa');
    assert.equal(b.entitlement, 25);
    assert.equal(b.taken, 2);
    assert.equal(b.pending, 0.5);
    assert.equal(b.remaining, 22.5);
    assert.equal(b.total_days, 3.5);
    assert.equal(b.episodes, 3);
  });

  // Maladie et formation ne consomment pas le solde ; un congé refusé non plus.
  test('Bineta : maladie et formation hors solde, refus ignoré', () => {
    const b = bal('Bineta');
    assert.equal(b.taken, 0);
    assert.equal(b.pending, 0);
    assert.equal(b.remaining, 25);
    assert.equal(b.sick_days, 2);
    assert.equal(b.episodes, 2);
  });
});

describe('Préavis', () => {
  // Le taux ne porte que sur les épisodes qualifiés : un backlog non renseigné
  // ne doit pas faire chuter l'indicateur.
  test('notice_rate calculé sur les seuls épisodes qualifiés', () => {
    assert.equal(S.notice_ok, 2);
    assert.equal(S.notice_ko, 2);
    assert.equal(S.notice_unknown, 1);
    assert.equal(S.notice_rate, 50);
    assert.equal(S.by_notice['Prévenu en retard'], 1);    // slug « late » traduit
  });

  test('manquements par agent, épisodes non qualifiés comptés à part', () => {
    assert.equal(bal('Awa').no_notice_episodes, 1);
    assert.equal(bal('Awa').unqualified, 0);
    assert.equal(bal('Bineta').no_notice_episodes, 1);
    assert.equal(bal('Bineta').no_notice_days, 2);
    assert.equal(bal('Bineta').unqualified, 1);
  });

  // Saisie après le début : personne n'a prévenu → « Non prévenu », pas vide.
  test('defaultNotice déduit le préavis de la date de saisie', () => {
    const a = { date_from: '2026-04-10' };
    assert.equal(defaultNotice({ ...a, created_at: '2026-04-09T10:00:00Z' }), 'Prévenu à l\'avance');
    assert.equal(defaultNotice({ ...a, created_at: '2026-04-10T06:00:00Z' }), 'Prévenu le jour même');
    assert.equal(defaultNotice({ ...a, created_at: '2026-04-11T08:00:00Z' }), 'Non prévenu');
    assert.equal(defaultNotice(a), '');
  });

  // Aucun épisode qualifié : pas de taux plutôt qu'un faux 0 %.
  test('notice_rate null sans épisode qualifié', () => {
    const r = computeAbsenceSummary({ country: 'SN', from: '2026-04-27', to: '2026-04-27' });
    assert.equal(r.notice_rate, null);
  });
});

describe('Conflits avec le planning', () => {
  // Un agent planifié sur un shift alors qu'il est absent (validé ou demandé) ;
  // repos, absences refusées et shifts hors période ne comptent pas.
  test('conflits détectés et triés par date', () => {
    assert.deepEqual(S.conflicts.map(c => [c.date, c.fo_name, c.shift_name, c.absence_id]), [
      ['2026-04-04', 'Awa',    'Week-end', 'a1'],
      ['2026-04-14', 'Bineta', 'Matin',    'a3'],
      ['2026-04-15', 'Awa',    'N',        'a2'],
    ]);
    assert.equal(S.conflicts[2].absence_status, 'Demandée');
  });
});

describe('Lecture et validation', () => {
  // Un enregistrement sans statut était invisible des soldes : relu comme
  // « Demandée » et réparé une fois pour toutes sur disque.
  test('statut manquant → « Demandée », fichier réécrit', () => {
    assert.equal(readAbsences().find(a => a.id === 'a7').status, 'Demandée');
    assert.equal(readFixture(DIR, 'absences.json').find(a => a.id === 'a7').status, 'Demandée');
  });

  // Les dates pilotent soldes et conflits : une saisie incohérente est refusée.
  test('validateAbsence refuse les saisies incohérentes', () => {
    const ok = { fo_name: 'Awa', type: 'RTT', date_from: '2026-04-10', date_to: '2026-04-10' };
    assert.equal(validateAbsence(ok), null);
    assert.equal(validateAbsence({ ...ok, notice: 'same_day' }), null);
    assert.ok(validateAbsence({ ...ok, date_to: '2026-04-09' }));
    assert.ok(validateAbsence({ ...ok, type: 'Vacances' }));
    assert.ok(validateAbsence({ ...ok, date_to: '2026-04-11', half_day: true }));
    assert.ok(validateAbsence({ ...ok, notice: 'peut-être' }));
    assert.ok(validateAbsence({ ...ok, fo_name: '  ' }));
  });
});
