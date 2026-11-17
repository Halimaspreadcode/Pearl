// Revue hebdo : semaine sans activité (quietWeek) et sélection des
// observations qui expliquent le creux. Un deck à « 0 / 0 / 0 » se lit comme
// une panne de l'outil : il doit dire que les zéros sont mesurés, et signaler
// quand une supervision dégradée a pu masquer des incidents.
//
// fmtDate (weekly-pptx.js) formate dans le fuseau du process : on le fige.
process.env.TZ = 'UTC';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { quietWeek } = require('../server/documents/weekly-pptx');

const OBS = {
  vpn:      { observation: 'VPN inaccessible, pas d\'accès à U2020', date: '2026-06-16', author: 'Awa', priority: 'P2' },
  tabaski:  { observation: 'Semaine de Tabaski', date: '2026-06-17' },
  mop:      { observation: 'Maintenance planifiée MOP sur le cœur de réseau', date: '2026-06-15' },
  freeze:   { observation: 'Gel des changements de fin de trimestre', date: '2026-06-14' },
  doublon:  { observation: 'Deux alarmes en double', date: '2026-06-18' },
  reunion:  { observation: 'Réunion équipe', date: '2026-06-18' },
  coupure:  { observation: 'Coupure électrique sur le site, bascule automatique OK', date: '2026-06-18' },
};

function week({ kpis = {}, obs = [], ...rest } = {}) {
  return {
    week_start: '2026-06-15T00:00:00Z',
    kpis: { opened_this_week: 0, resolved_this_week: 0, overall_total: 12, overall_open: 2, ...kpis },
    // Trois semaines précédentes + la semaine courante (dernière, ignorée).
    trend_history: [{ opened: 2, closed: 1 }, { opened: 0, closed: 0 }, { opened: 4, closed: 3 }, { opened: 0, closed: 0 }],
    activity_context: {
      last_opened_before: '2026-06-08T10:00:00Z',
      holidays: ['2026-06-16'],
      shifts_covered: 10, agents_on_shift: 4,
      week_observations: obs,
    },
    weekly_progress: [{ status: 'Done' }, { status: 'open' }],
    observations_open: [{ id: 'o1' }],
    ...rest,
  };
}

describe('quietWeek — détection', () => {
  // Une seule ouverture ou clôture suffit : la semaine n'est pas « calme ».
  test('semaine active → null', () => {
    assert.equal(quietWeek(week({ kpis: { opened_this_week: 3 } })), null);
    assert.equal(quietWeek(week({ kpis: { resolved_this_week: 1 } })), null);
  });

  // Semaine calme : uniquement des faits tirés des données, dans l'ordre.
  test('semaine calme → constats mesurés', () => {
    const q = quietWeek(week());
    assert.equal(q.title, 'Quiet week: no ticket activity');
    assert.equal(q.visibility_risk, false);
    assert.match(q.lead, /not missing data/);
    assert.deepEqual(q.points, [
      'The figures are measured, not missing: the tracker holds 12 ticket(s) in total, none of them opened or closed during this week.',
      'The last ticket was opened on 08 Jun 2026, 7 day(s) before this week started.',
      'Usual pace: 2 new ticket(s) per week on average over the previous 3 weeks, with activity in 2 of them.',
      '2 ticket(s) opened in earlier weeks remain open and are still followed up; none of them was closed this week.',
      'The week included 1 public holiday(s) (16 Jun 2026).',
      'The Front Office was staffed as planned: 10 shift(s) covered by 4 agent(s). No incident reached the team during those shifts.',
      'Activity outside the ticket queue: 1 item(s) completed in Weekly Progress, 1 open observation(s) tracked.',
    ]);
  });

  // Tracker vide : les zéros sont « par construction », pas une panne.
  test('tracker vide et file vide', () => {
    const q = quietWeek(week({ kpis: { overall_total: 0, overall_open: 0 } }));
    assert.match(q.points[0], /no ticket yet/);
    assert.ok(q.points.includes('No ticket is waiting in the queue: the backlog is clear.'));
  });
});

describe('quietWeek — sélection des observations', () => {
  const texts = q => q.points.filter(p => p.startsWith('Observation logged')).map(p => p.match(/"(.*)"$/)[1]);

  // Garde supervision/outillage AVEC un vrai problème, et le calendrier ;
  // écarte le bruit (doublon d'alarmes, réunion, coupure sans impact).
  test('garde problème de supervision + calendrier, écarte le bruit', () => {
    const q = quietWeek(week({ obs: [OBS.doublon, OBS.reunion, OBS.coupure, OBS.tabaski, OBS.vpn, OBS.mop] }));
    assert.deepEqual(texts(q), [OBS.vpn.observation, OBS.tabaski.observation, OBS.mop.observation]);
    // Placées en tête des constats : ce sont les plus utiles au lecteur.
    assert.match(q.points[0], /^Observation logged on 16 Jun 2026 by Awa \(monitoring \/ alarm visibility\)/);
    assert.match(q.points[1], /\(maintenance or calendar\)/);
  });

  // Supervision dégradée : on ne peut pas affirmer que la semaine était calme.
  test('visibility_risk quand une observation touche la visibilité des incidents', () => {
    const q = quietWeek(week({ obs: [OBS.vpn] }));
    assert.equal(q.visibility_risk, true);
    assert.match(q.lead, /incidents may have gone undetected/);
  });

  // Le calendrier seul explique le creux sans mettre en doute la détection.
  test('calendrier seul → pas de risque de visibilité', () => {
    const q = quietWeek(week({ obs: [OBS.tabaski] }));
    assert.equal(q.visibility_risk, false);
    assert.match(q.lead, /Observations logged this week give context below\./);
  });

  // Trois au plus, les plus parlantes puis les plus récentes.
  test('au plus 3 observations, la plus ancienne à score égal écartée', () => {
    const q = quietWeek(week({ obs: [OBS.freeze, OBS.mop, OBS.tabaski, OBS.vpn] }));
    assert.deepEqual(texts(q), [OBS.vpn.observation, OBS.tabaski.observation, OBS.mop.observation]);
  });

  // Une observation P1 gagne un point : elle passe devant à thème égal.
  test('priorité P1 remonte une observation', () => {
    const q = quietWeek(week({ obs: [{ ...OBS.freeze, priority: 'P1' }, OBS.mop, OBS.tabaski, OBS.vpn] }));
    assert.deepEqual(texts(q), [OBS.vpn.observation, OBS.freeze.observation, OBS.tabaski.observation]);
  });

  // Outil en panne (hors supervision) : libellé « tooling », statut clos signalé.
  test('problème d\'outillage clos', () => {
    const q = quietWeek(week({ obs: [{ observation: 'Serveur de licences expiré', date: '2026-06-16', status: 'Closed' }] }));
    assert.match(q.points[0], /\(tooling or access issue, since closed\)/);
    assert.equal(q.visibility_risk, true);
  });

  // Aucune observation retenue : aucun point « Observation », pas de risque.
  test('seulement du bruit → aucune observation retenue', () => {
    const q = quietWeek(week({ obs: [OBS.doublon, OBS.reunion, OBS.coupure] }));
    assert.deepEqual(texts(q), []);
    assert.equal(q.visibility_risk, false);
    assert.doesNotMatch(q.lead, /Observations logged/);
  });
});
