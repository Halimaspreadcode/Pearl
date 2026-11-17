// Temps : parties d'horloge dans un fuseau, bornes de jour / semaine
// (y compris au changement d'heure), semaine ISO, temps ouvré (MTTD/MTTR).
//
// time.js est censé ne PAS dépendre du fuseau de la machine : on force un
// fuseau exotique pour le process, afin qu'un calcul qui s'appuierait par
// erreur sur l'heure locale fasse échouer le test.
process.env.TZ = 'Pacific/Kiritimati';   // UTC+14

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  reportTZ, tzParts, tzStartOfDay, tzEndOfDay, tzStartOfWeek, isoWeekNumber, workedMs,
} = require('../server/core/time');

const H = 3600000;
const iso = d => d.toISOString();

describe('reportTZ', () => {
  // Le fuseau configuré prime sur la variable d'environnement, puis UTC.
  test('cfg.timezone > REPORT_TZ > UTC', () => {
    const saved = process.env.REPORT_TZ;
    delete process.env.REPORT_TZ;
    assert.equal(reportTZ({}), 'UTC');
    process.env.REPORT_TZ = 'Europe/Paris';
    assert.equal(reportTZ(null), 'Europe/Paris');
    assert.equal(reportTZ({ timezone: 'Africa/Abidjan' }), 'Africa/Abidjan');
    if (saved === undefined) delete process.env.REPORT_TZ; else process.env.REPORT_TZ = saved;
  });
});

describe('tzParts', () => {
  // Abidjan = UTC toute l'année : les parties sont celles de l'instant UTC.
  test('Africa/Abidjan = UTC', () => {
    assert.deepEqual(tzParts(new Date('2026-05-13T23:59:30Z'), 'Africa/Abidjan'),
      { year: 2026, month: 5, day: 13, hour: 23, minute: 59, second: 30, dow: 3 });
  });

  // Passage à l'heure d'été à Paris le 29/03/2026 à 01:00 UTC : 02:00 → 03:00.
  test('Europe/Paris autour du passage à l\'heure d\'été', () => {
    const before = tzParts(new Date('2026-03-29T00:30:00Z'), 'Europe/Paris');
    const after  = tzParts(new Date('2026-03-29T01:30:00Z'), 'Europe/Paris');
    assert.equal(before.hour, 1);
    assert.equal(after.hour, 3);
    assert.equal(after.dow, 0);
  });

  // Minuit s'écrit 0 et non 24 (certains moteurs Intl renvoient « 24 »).
  test('minuit → hour 0', () => {
    assert.equal(tzParts(new Date('2026-05-14T00:00:00Z'), 'UTC').hour, 0);
  });
});

describe('Début / fin de jour', () => {
  test('Abidjan : jour UTC', () => {
    const ref = new Date('2026-05-13T23:59:00Z');
    assert.equal(iso(tzStartOfDay(ref, 'Africa/Abidjan')), '2026-05-13T00:00:00.000Z');
    assert.equal(iso(tzEndOfDay(ref, 'Africa/Abidjan')),   '2026-05-13T23:59:59.999Z');
  });

  // 22:30 UTC le 30 juin = 00:30 le 1er juillet à Paris : c'est le 1er juillet
  // qui compte pour le rapport, pas la date UTC.
  test('Paris : un instant tardif en UTC appartient au lendemain', () => {
    const ref = new Date('2026-06-30T22:30:00Z');
    assert.equal(iso(tzStartOfDay(ref, 'Europe/Paris')), '2026-06-30T22:00:00.000Z');
  });

  // Le jour du changement d'heure ne dure que 23 h à Paris.
  test('Paris : journée de 23 h au passage à l\'heure d\'été', () => {
    const ref = new Date('2026-03-29T12:00:00Z');
    const s = tzStartOfDay(ref, 'Europe/Paris'), e = tzEndOfDay(ref, 'Europe/Paris');
    assert.equal(iso(s), '2026-03-28T23:00:00.000Z');
    assert.equal(iso(e), '2026-03-29T21:59:59.999Z');
    assert.equal(e - s + 1, 23 * H);
  });
});

describe('Début de semaine (lundi, ISO)', () => {
  test('Abidjan : dimanche → lundi précédent', () => {
    assert.equal(iso(tzStartOfWeek(new Date('2026-05-17T18:00:00Z'), 'Africa/Abidjan')),
      '2026-05-11T00:00:00.000Z');
  });

  // La semaine qui contient le passage à l'heure d'été commence en CET (UTC+1).
  test('Paris : dimanche du changement d\'heure → lundi en heure d\'hiver', () => {
    assert.equal(iso(tzStartOfWeek(new Date('2026-03-29T20:00:00Z'), 'Europe/Paris')),
      '2026-03-22T23:00:00.000Z');
  });

  // La semaine suivante commence en CEST (UTC+2).
  test('Paris : semaine suivante → lundi en heure d\'été', () => {
    assert.equal(iso(tzStartOfWeek(new Date('2026-04-01T10:00:00Z'), 'Europe/Paris')),
      '2026-03-29T22:00:00.000Z');
  });

  // Dimanche 23:30 UTC = lundi 01:30 à Paris : c'est déjà la nouvelle semaine.
  test('Paris : dimanche soir UTC = lundi local → nouvelle semaine', () => {
    assert.equal(iso(tzStartOfWeek(new Date('2026-05-17T23:30:00Z'), 'Europe/Paris')),
      '2026-05-17T22:00:00.000Z');
  });
});

describe('isoWeekNumber', () => {
  // Les numéros de semaine du mensuel doivent être ceux du weekly (ISO-8601).
  test('frontières d\'année', () => {
    assert.equal(isoWeekNumber(new Date('2026-01-01T12:00:00Z'), 'UTC'), 1);    // jeudi
    assert.equal(isoWeekNumber(new Date('2026-12-31T12:00:00Z'), 'UTC'), 53);
    assert.equal(isoWeekNumber(new Date('2027-01-01T12:00:00Z'), 'UTC'), 53);   // appartient à 2026-W53
    assert.equal(isoWeekNumber(new Date('2024-12-30T12:00:00Z'), 'UTC'), 1);    // 2025-W01
    assert.equal(isoWeekNumber(new Date('2026-03-02T12:00:00Z'), 'UTC'), 10);
  });
});

describe('workedMs (MTTD / MTTR)', () => {
  const LIVE  = { work_mode: 'live' };
  const DRILL = { work_mode: 'drill', timezone: 'UTC' };

  // Live = 24/7 : le temps écoulé est le temps travaillé.
  test('live : temps écoulé brut', () => {
    assert.equal(workedMs('2026-03-02T17:00:00Z', '2026-03-03T09:00:00Z', LIVE), 16 * H);
  });

  // Drill : 17:00 → 09:00 le lendemain = 30 min le soir + 30 min le matin.
  test('drill : la nuit ne compte pas', () => {
    assert.equal(workedMs('2026-03-02T17:00:00Z', '2026-03-03T09:00:00Z', DRILL), 1 * H);
  });

  // Même jour : seule la tranche comprise dans 08:30–17:30 compte.
  test('drill : même jour, avant et pendant la fenêtre', () => {
    assert.equal(workedMs('2026-03-02T07:00:00Z', '2026-03-02T08:00:00Z', DRILL), 0);
    assert.equal(workedMs('2026-03-02T07:00:00Z', '2026-03-02T10:00:00Z', DRILL), 1.5 * H);
    assert.equal(workedMs('2026-03-02T16:00:00Z', '2026-03-02T20:00:00Z', DRILL), 1.5 * H);
  });

  // Le drill compte aussi le week-end : ven 16:30 → lun 09:30 = 1 + 9 + 9 + 1 h.
  test('drill : plusieurs jours, week-end inclus', () => {
    assert.equal(workedMs('2026-03-06T16:30:00Z', '2026-03-09T09:30:00Z', DRILL), 20 * H);
  });

  // La fenêtre 08:30–17:30 est celle du fuseau des opérations, pas UTC.
  test('drill : fenêtre lue dans cfg.timezone', () => {
    const start = '2026-03-02T07:30:00Z', end = '2026-03-02T16:30:00Z';   // 08:30–17:30 à Paris
    assert.equal(workedMs(start, end, { work_mode: 'drill', timezone: 'Europe/Paris' }), 9 * H);
    assert.equal(workedMs(start, end, DRILL), 8 * H);
  });

  // Traversée du changement d'heure : les journées pleines valent toujours 9 h.
  test('drill : traversée du passage à l\'heure d\'été à Paris', () => {
    const cfg = { work_mode: 'drill', timezone: 'Europe/Paris' };
    // Sam 28/03 17:00 CET → lun 30/03 09:00 CEST = 0,5 + 9 + 0,5 h.
    assert.equal(workedMs('2026-03-28T16:00:00Z', '2026-03-30T07:00:00Z', cfg), 10 * H);
  });

  // Données incohérentes : fin avant début ou date illisible → null (exclues des moyennes).
  test('dates invalides ou inversées → null ; durée nulle → 0', () => {
    assert.equal(workedMs('2026-03-02T10:00:00Z', '2026-03-02T09:00:00Z', LIVE), null);
    assert.equal(workedMs('pas une date', '2026-03-02T09:00:00Z', LIVE), null);
    assert.equal(workedMs('2026-03-02T10:00:00Z', '2026-03-02T10:00:00Z', DRILL), 0);
  });
});
