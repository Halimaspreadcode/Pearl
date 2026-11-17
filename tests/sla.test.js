// SLA : calcul simple et double (contournement / résolution), statuts,
// modes calendaire / ouvré, mode drill 08:30–17:30.
//
// addSLAMs (sla.js) raisonne en heure locale du process : on fige TZ=UTC
// avant tout calcul de date pour que le test ne dépende pas de la machine.
process.env.TZ = 'UTC';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const { enrichTicket } = require('../server/core/sla');

const H = 3600000;
const CFG = {
  work_mode: 'live',
  sla_hours: {
    'Incident P1': 4,                                      // ancien format : nombre = calendaire
    'Incident P2': { hours: 8, mode: 'business' },
    'Incident P3': { hours: 8, mode: 'calendar' },
    'Incident P4': { workaround: { hours: 4 }, final: { hours: 72 } },
    'Request P4':  { final: { hours: 24 } },
    'Request P3':  0,                                      // 0 h = pas de SLA
  },
};

// Lundi 2 mars 2026, 08:00 UTC.
const MON_8H = '2026-03-02T08:00:00.000Z';

describe('SLA — N/A', () => {
  // Sans type, la clé « undefined P1 » n'existe pas : pas de SLA, pas de faux Breach.
  test('type absent → N/A', () => {
    const r = enrichTicket({ priority: 'P1', occur_time: MON_8H, open_date: MON_8H }, CFG);
    assert.equal(r.sla_status, 'N/A');
    assert.equal(r.time_left_ms, null);
  });

  // Sans heure d'occurrence, on ne peut pas poser d'échéance.
  test('occur_time absent → N/A', () => {
    const r = enrichTicket({ type: 'Incident', priority: 'P1', open_date: MON_8H }, CFG);
    assert.equal(r.sla_status, 'N/A');
  });

  // Un couple type+priorité non configuré n'est pas mesuré.
  test('clé type+priorité inconnue → N/A', () => {
    const r = enrichTicket({ type: 'Change', priority: 'P1', occur_time: MON_8H }, CFG);
    assert.equal(r.sla_status, 'N/A');
    assert.equal(r.sla_hours, null);
  });

  // Une entrée à 0 h signifie « pas d'engagement », pas « déjà rompu ».
  test('entrée à 0 h → N/A', () => {
    const r = enrichTicket({ type: 'Request', priority: 'P3', occur_time: MON_8H }, CFG);
    assert.equal(r.sla_status, 'N/A');
  });
});

describe('SLA simple — statuts sur ticket clos', () => {
  const t = close => ({ type: 'Incident', priority: 'P1', occur_time: MON_8H,
                        open_date: MON_8H, close_date: close, status: 'Closed' });

  // Ticket clos : mesuré à close_date, pas à « maintenant » — sinon tout ticket
  // ancien finirait en Breach.
  test('clos avec 50 % de marge → In SLA, mesuré à close_date', () => {
    const r = enrichTicket(t('2026-03-02T10:00:00.000Z'), CFG);
    assert.equal(r.sla_status, 'In SLA');
    assert.equal(r.sla_hours, 4);
    assert.equal(r.sla_mode, 'calendar');
    assert.equal(r.deadline, '2026-03-02T12:00:00.000Z');
    assert.equal(r.time_left_ms, 2 * H);
  });

  // Near Breach = moins de 20 % de la fenêtre restante (ici 30 min sur 4 h).
  test('clos avec 12,5 % de marge → Near Breach', () => {
    assert.equal(enrichTicket(t('2026-03-02T11:30:00.000Z'), CFG).sla_status, 'Near Breach');
  });

  // Clos pile à l'échéance : encore dans les temps (0 ms restant n'est pas négatif).
  test('clos à l\'échéance exacte → Near Breach, pas Breach', () => {
    assert.equal(enrichTicket(t('2026-03-02T12:00:00.000Z'), CFG).sla_status, 'Near Breach');
  });

  // Une minute de retard suffit à rompre le SLA.
  test('clos après l\'échéance → Breach', () => {
    const r = enrichTicket(t('2026-03-02T12:01:00.000Z'), CFG);
    assert.equal(r.sla_status, 'Breach');
    assert.equal(r.time_left_ms, -60000);
  });

  // L'horloge SLA part de la détection quand elle est saisie : le FO est
  // engagé à partir du moment où il a pu voir l'incident.
  test('detection_time préféré à occur_time', () => {
    const r = enrichTicket({ type: 'Incident', priority: 'P1',
      occur_time: '2026-03-02T06:00:00.000Z', detection_time: MON_8H,
      open_date: MON_8H, close_date: '2026-03-02T11:00:00.000Z' }, CFG);
    assert.equal(r.deadline, '2026-03-02T12:00:00.000Z');
    assert.equal(r.time_left_ms, 1 * H);
  });
});

describe('SLA simple — ticket ouvert mesuré à maintenant', () => {
  // Ticket ouvert : l'écart est mesuré à Date.now(), qu'on fige ici.
  test('ouvert, horloge figée → time_left depuis now', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-03-02T11:00:00.000Z') });
    const r = enrichTicket({ type: 'Incident', priority: 'P1', occur_time: MON_8H,
                             open_date: MON_8H, status: 'Open' }, CFG);
    assert.equal(r.time_left_ms, 1 * H);
    assert.equal(r.sla_status, 'In SLA');
    assert.equal(r.duration_ms, 3 * H);
  });
});

describe('SLA — modes calendaire / ouvré, live / drill', () => {
  const FRI_20H = '2026-03-06T20:00:00.000Z';   // vendredi soir

  // Calendaire : le week-end compte, 8 h après vendredi 20 h = samedi 04 h.
  test('live + calendar : le week-end compte', () => {
    const r = enrichTicket({ type: 'Incident', priority: 'P3', occur_time: FRI_20H,
                             close_date: FRI_20H }, CFG);
    assert.equal(r.deadline, '2026-03-07T04:00:00.000Z');
  });

  // Ouvré : samedi et dimanche sont sautés — 4 h vendredi + 4 h lundi.
  test('live + business : le week-end est sauté', () => {
    const r = enrichTicket({ type: 'Incident', priority: 'P2', occur_time: FRI_20H,
                             close_date: FRI_20H }, CFG);
    assert.equal(r.sla_mode, 'business');
    assert.equal(r.deadline, '2026-03-09T04:00:00.000Z');
  });

  // Drill + calendaire : seules les heures 08:30–17:30 comptent, tous les jours.
  test('drill + calendar : fenêtre 08:30–17:30, week-end inclus', () => {
    const cfg = { ...CFG, work_mode: 'drill' };
    // Samedi 16:00 → 1 h 30 samedi, reprise dimanche 08:30 + 2 h 30 = 11:00.
    const occ = '2026-03-07T16:00:00.000Z';
    const r = enrichTicket({ type: 'Incident', priority: 'P1', occur_time: occ, close_date: occ }, cfg);
    assert.equal(r.deadline, '2026-03-08T11:00:00.000Z');
  });

  // Drill + ouvré (« 5×9 ») : ni les nuits ni le week-end ne consomment le SLA.
  test('drill + business : 5×9, reprise le lundi', () => {
    const cfg = { work_mode: 'drill', sla_hours: { 'Incident P1': { hours: 4, mode: 'business' } } };
    const occ = '2026-03-06T16:00:00.000Z';   // vendredi 16:00
    const r = enrichTicket({ type: 'Incident', priority: 'P1', occur_time: occ, close_date: occ }, cfg);
    assert.equal(r.deadline, '2026-03-09T11:00:00.000Z');
  });

  // Un ticket créé avant 08:30 en drill ne commence à consommer qu'à 08:30.
  test('drill : occurrence avant l\'ouverture → départ à 08:30', () => {
    const cfg = { ...CFG, work_mode: 'drill' };
    const occ = '2026-03-02T06:00:00.000Z';
    const r = enrichTicket({ type: 'Incident', priority: 'P1', occur_time: occ, close_date: occ }, cfg);
    assert.equal(r.deadline, '2026-03-02T12:30:00.000Z');
  });
});

describe('SLA double (contournement / résolution)', () => {
  const dual = extra => ({ type: 'Incident', priority: 'P4', occur_time: MON_8H,
                           open_date: MON_8H, ...extra });

  // Chaque jambe a sa propre échéance ; contournement mesuré à workaround_date,
  // résolution à close_date. Le temps restant global est le plus serré des deux.
  test('deux jambes dans les temps → In SLA, time_left = min des jambes', () => {
    const r = enrichTicket(dual({ workaround_date: '2026-03-02T10:00:00.000Z',
                                  close_date: '2026-03-04T08:00:00.000Z' }), CFG);
    assert.equal(r.sla_mode, 'dual');
    assert.equal(r.sla_hours, null);
    assert.equal(r.sla_workaround.deadline, '2026-03-02T12:00:00.000Z');
    assert.equal(r.sla_workaround.time_left_ms, 2 * H);
    assert.equal(r.sla_final.deadline, '2026-03-05T08:00:00.000Z');
    assert.equal(r.sla_final.time_left_ms, 24 * H);
    assert.equal(r.time_left_ms, 2 * H);
    assert.equal(r.sla_status, 'In SLA');
  });

  // Un contournement en retard rompt le SLA même si la résolution est dans les temps.
  test('contournement en retard → Breach malgré une résolution à l\'heure', () => {
    const r = enrichTicket(dual({ workaround_date: '2026-03-02T13:00:00.000Z',
                                  close_date: '2026-03-03T08:00:00.000Z' }), CFG);
    assert.equal(r.sla_workaround.time_left_ms, -1 * H);
    assert.equal(r.sla_status, 'Breach');
  });

  // Une entrée double peut n'avoir qu'une jambe : seule la résolution est suivie.
  test('résolution seule → une seule jambe mesurée', () => {
    const r = enrichTicket({ type: 'Request', priority: 'P4', occur_time: MON_8H,
                             close_date: '2026-03-02T20:00:00.000Z' }, CFG);
    assert.equal(r.sla_mode, 'dual');
    assert.equal(r.sla_workaround, undefined);
    assert.equal(r.sla_final.time_left_ms, 12 * H);
    assert.equal(r.sla_status, 'In SLA');
  });

  // Le statut compare le temps restant au total de LA jambe concernée.
  // Ici la résolution n'a plus que 3 h sur 72 (4 %) : Near Breach attendu.
  test('Near Breach de la jambe résolution quand le contournement est tenu', () => {
    const r = enrichTicket(dual({ workaround_date: '2026-03-02T08:01:00.000Z',
                                  close_date: '2026-03-05T05:00:00.000Z' }), CFG);
    assert.equal(r.sla_final.time_left_ms, 3 * H);
    assert.equal(r.time_left_ms, 3 * H);
    assert.equal(r.sla_status, 'Near Breach');
  });
});

describe('SLA — fuseau de la machine', () => {
  // Les bornes métier (week-end, 08:30–17:30) doivent suivre le fuseau des
  // opérations (cfg.timezone), pas celui de la VM — même règle que time.js.
  test('mode ouvré indépendant du fuseau de la VM', () => {
    const code = `
      const { enrichTicket } = require(${JSON.stringify(path.join(__dirname, '../server/core/sla'))});
      const cfg = { timezone: 'UTC', work_mode: 'live',
                    sla_hours: { 'Incident P2': { hours: 8, mode: 'business' } } };
      const occ = '2026-03-06T20:00:00.000Z';
      process.stdout.write(enrichTicket({ type: 'Incident', priority: 'P2',
                                          occur_time: occ, close_date: occ }, cfg).deadline);`;
    const out = spawnSync(process.execPath, ['-e', code],
      { env: { ...process.env, TZ: 'Asia/Tokyo' }, encoding: 'utf8' });
    assert.equal(out.stdout, '2026-03-09T04:00:00.000Z');
  });
});
