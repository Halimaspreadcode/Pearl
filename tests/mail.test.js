// Diffusion par mail : objet du mail (jetons {report} {date} {week} {month})
// et calendrier des envois (prochainEnvoi, planifDue).
// mailSubject lit le fuseau dans config.json : DATA_DIR temporaire d'abord.
const { useTempDataDir, writeFixture } = require('./helpers/data-dir');
const DIR = useTempDataDir({ 'config.json': { timezone: 'Africa/Abidjan' } });

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { mailSubject } = require('../server/services/mail/bodies');
const { prochainEnvoi, planifDue } = require('../server/services/mail/scheduler');

const MON = new Date('2026-03-02T10:00:00Z');   // lundi 2 mars 2026, 10:00 UTC

describe('mailSubject', () => {
  afterEach(() => writeFixture(DIR, 'config.json', { timezone: 'Africa/Abidjan' }));

  // Modèle vide : « <rapport> — <date> », libellé anglais des destinataires.
  test('modèle vide → objet par défaut', () => {
    assert.equal(mailSubject('daily', '', MON), 'Daily Report — 2026-03-02');
    assert.equal(mailSubject('weekly_pptx', '   ', MON), 'Weekly Review — 2026-03-02');
    assert.equal(mailSubject('inconnu', null, MON), 'inconnu — 2026-03-02');
  });

  // Tous les jetons, insensibles à la casse.
  test('jetons {report} {date} {week} {month}', () => {
    assert.equal(mailSubject('weekly', '[EMOC] {Report} {DATE} {week} ({month})', MON),
      '[EMOC] Weekly Report 2026-03-02 W10 (March 2026)');
  });

  // Semaine ISO : le 1er janvier 2027 (vendredi) appartient à 2026-W53.
  test('{week} ISO aux frontières d\'année', () => {
    const w = d => mailSubject('daily', '{week}', new Date(d));
    assert.equal(w('2027-01-01T12:00:00Z'), 'W53');
    assert.equal(w('2026-01-01T12:00:00Z'), 'W01');
    assert.equal(w('2024-12-30T12:00:00Z'), 'W01');   // 2025-W01
    assert.equal(w('2021-01-03T12:00:00Z'), 'W53');   // dimanche de 2020-W53
  });

  // La date et la semaine suivent le fuseau des rapports, pas UTC : à Paris,
  // 31/12 23:30 UTC est déjà le 1er janvier.
  test('date et semaine lues dans le fuseau configuré', () => {
    writeFixture(DIR, 'config.json', { timezone: 'Europe/Paris' });
    assert.equal(mailSubject('daily', '{date} {week} {month}', new Date('2026-12-31T23:30:00Z')),
      '2027-01-01 W53 January 2027');
  });

  // Un retour à la ligne dans un en-tête SMTP permettrait d'injecter des en-têtes.
  test('retours à la ligne supprimés, longueur bornée à 200', () => {
    assert.equal(mailSubject('daily', 'Ligne 1\r\nBcc: x@y.z\nFin', MON), 'Ligne 1 Bcc: x@y.z Fin');
    assert.equal(mailSubject('daily', 'x'.repeat(300), MON).length, 200);
  });
});

describe('prochainEnvoi', () => {
  const sch = o => ({ enabled: true, hour: 8, minute: 0, ...o });

  // Désactivée : pas de prochain envoi.
  test('planification désactivée → null', () => {
    assert.equal(prochainEnvoi(sch({ freq: 'daily', enabled: false }), 'UTC', MON), null);
  });

  // Quotidien : aujourd'hui si l'heure n'est pas passée, sinon demain.
  test('quotidien : aujourd\'hui ou demain selon l\'heure', () => {
    assert.equal(prochainEnvoi(sch({ freq: 'daily', hour: 12 }), 'UTC', MON), '2026-03-02 12:00');
    assert.equal(prochainEnvoi(sch({ freq: 'daily', hour: 8 }), 'UTC', MON), '2026-03-03 08:00');
  });

  // Déjà parti aujourd'hui (last_run) : le suivant est demain, même si l'heure n'est pas passée.
  test('quotidien déjà parti aujourd\'hui → demain', () => {
    assert.equal(prochainEnvoi(sch({ freq: 'daily', hour: 12, last_run: '2026-03-02' }), 'UTC', MON),
      '2026-03-03 12:00');
  });

  // Hebdo : `day` = jour de semaine (0 = dimanche).
  test('hebdomadaire : prochain jour de semaine voulu', () => {
    assert.equal(prochainEnvoi(sch({ freq: 'weekly', day: 5, hour: 9 }), 'UTC', MON), '2026-03-06 09:00');
    // Lundi 9 h déjà passé ce lundi (10 h) → lundi suivant.
    assert.equal(prochainEnvoi(sch({ freq: 'weekly', day: 1, hour: 9 }), 'UTC', MON), '2026-03-09 09:00');
  });

  // Mensuel : `day` = jour du mois ; un 31 saute les mois qui n'en ont pas.
  test('mensuel : jour du mois, mois courts sautés', () => {
    assert.equal(prochainEnvoi(sch({ freq: 'monthly', day: 15 }), 'UTC', MON), '2026-03-15 08:00');
    assert.equal(prochainEnvoi(sch({ freq: 'monthly', day: 31, minute: 30 }), 'UTC',
      new Date('2026-04-01T00:00:00Z')), '2026-05-31 08:30');
  });

  // Envoi unique : à sa date ; date passée ou absente → plus rien à venir.
  test('envoi unique', () => {
    assert.equal(prochainEnvoi(sch({ freq: 'once', date: '2026-03-20', hour: 7, minute: 30 }), 'UTC', MON),
      '2026-03-20 07:30');
    assert.equal(prochainEnvoi(sch({ freq: 'once', date: '2026-03-01' }), 'UTC', MON), null);
    assert.equal(prochainEnvoi(sch({ freq: 'once' }), 'UTC', MON), null);
  });

  // L'heure affichée est celle du fuseau des rapports : 23:10 UTC = 00:10 le
  // lendemain à Paris, donc l'envoi de 23:45 du jour est déjà passé.
  test('fuseau des rapports', () => {
    const s = sch({ freq: 'daily', hour: 23, minute: 45 });
    assert.equal(prochainEnvoi(s, 'Europe/Paris', new Date('2026-03-02T22:30:00Z')), '2026-03-02 23:45');
    assert.equal(prochainEnvoi(s, 'Europe/Paris', new Date('2026-03-02T23:10:00Z')), '2026-03-03 23:45');
  });
});

describe('planifDue', () => {
  const now = { hour: 8, minute: 0, day: 2, weekday: 1, date: '2026-03-02' };

  // Désactivée ou mauvaise minute : jamais due.
  test('désactivée ou hors minute → false', () => {
    assert.equal(planifDue({ enabled: false, freq: 'daily', hour: 8, minute: 0 }, now), false);
    assert.equal(planifDue({ enabled: true, freq: 'daily', hour: 8, minute: 1 }, now), false);
  });

  // Heures saisies en texte dans le formulaire : comparées en nombre.
  test('quotidien, heures en chaîne acceptées', () => {
    assert.equal(planifDue({ enabled: true, freq: 'daily', hour: '8', minute: '0' }, now), true);
  });

  test('hebdomadaire / mensuel', () => {
    assert.equal(planifDue({ enabled: true, freq: 'weekly', day: 1, hour: 8 }, now), true);
    assert.equal(planifDue({ enabled: true, freq: 'weekly', day: 2, hour: 8 }, now), false);
    assert.equal(planifDue({ enabled: true, freq: 'monthly', day: 2, hour: 8 }, now), true);
    assert.equal(planifDue({ enabled: true, freq: 'monthly', day: 3, hour: 8 }, now), false);
  });

  // Envoi unique : la date complète, sinon « le 2 mars » repartirait le 2 avril.
  test('envoi unique : date complète comparée', () => {
    assert.equal(planifDue({ enabled: true, freq: 'once', date: '2026-03-02', hour: 8 }, now), true);
    assert.equal(planifDue({ enabled: true, freq: 'once', date: '2026-04-02', hour: 8 },
      { ...now, date: '2026-03-02' }), false);
    assert.equal(planifDue({ enabled: true, freq: 'once', hour: 8 }, now), false);
  });

  // Fréquence inconnue : on n'envoie pas plutôt que d'envoyer à tort.
  test('fréquence inconnue → false', () => {
    assert.equal(planifDue({ enabled: true, freq: 'hourly', hour: 8 }, now), false);
  });
});
