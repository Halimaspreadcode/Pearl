// KPI de période (periodKpis, core/enrich.js — utilisé par services/reports.js
// pour le daily, le weekly et le mensuel). core/enrich charge core/store :
// DATA_DIR temporaire avant tout require.
const { useTempDataDir } = require('./helpers/data-dir');
useTempDataDir({ 'config.json': {} });

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { periodKpis } = require('../server/core/enrich');

const H = 3600000;
const LIVE = { work_mode: 'live' };
const t = (sla_status, extra = {}) => ({ sla_status, status: 'Open', ...extra });

describe('sla_compliance', () => {
  // Rien de mesuré : « N/A » plutôt qu'un 0 % trompeur ou un ancien pourcentage.
  test('null quand aucun ticket n\'a de SLA', () => {
    assert.equal(periodKpis([], [], LIVE).sla_compliance, null);
    assert.equal(periodKpis([t('N/A'), t('N/A')], [], LIVE).sla_compliance, null);
  });

  // Near Breach est encore dans les temps : conforme. Les N/A sont hors dénominateur.
  test('In SLA et Near Breach conformes, N/A exclus', () => {
    const k = periodKpis([t('In SLA'), t('Near Breach'), t('Breach'), t('N/A')], [], LIVE);
    assert.equal(k.sla_compliance, 67);   // 2 / 3
    assert.equal(k.breach, 1);
    assert.equal(k.total, 4);
  });

  test('100 % quand tout est dans les temps', () => {
    assert.equal(periodKpis([t('Near Breach'), t('In SLA')], [], LIVE).sla_compliance, 100);
  });
});

describe('open', () => {
  // Comportement actuel : « open » = Open + In Progress ; On Hold et clos
  // n'y figurent pas (même convention que dashboard.js et overall_open).
  test('compte Open et In Progress uniquement', () => {
    const k = periodKpis([
      t('In SLA', { status: 'Open' }), t('In SLA', { status: 'In Progress' }),
      t('In SLA', { status: 'On Hold' }), t('In SLA', { status: 'Closed' }),
    ], [], LIVE);
    assert.equal(k.open, 2);
  });
});

describe('MTTD / MTTR en temps ouvré', () => {
  const opened = [
    // Détecté 1 h après l'occurrence.
    { sla_status: 'N/A', occur_time: '2026-03-02T10:00:00Z', detection_time: '2026-03-02T11:00:00Z' },
    // Nuit en drill : 17:00 → 09:00 = 1 h ouvrée (16 h écoulées en live).
    { sla_status: 'N/A', occur_time: '2026-03-02T17:00:00Z', detection_time: '2026-03-03T09:00:00Z' },
    // Sans détection : exclu de la moyenne, pas compté comme 0.
    { sla_status: 'N/A', occur_time: '2026-03-02T10:00:00Z' },
    // Détection avant occurrence (saisie incohérente) : exclue.
    { sla_status: 'N/A', occur_time: '2026-03-02T10:00:00Z', detection_time: '2026-03-02T09:00:00Z' },
  ];
  const closed = [
    { open_date: '2026-03-02T09:00:00Z', close_date: '2026-03-02T12:00:00Z' },
    { open_date: '2026-03-02T09:00:00Z' },   // pas clos : exclu
  ];

  // En drill, seules les heures 08:30–17:30 comptent : la nuit ne gonfle plus la moyenne.
  test('drill : moyenne sur les heures ouvrées', () => {
    const k = periodKpis(opened, closed, { work_mode: 'drill', timezone: 'UTC' });
    assert.equal(k.mttd_ms, 1 * H);
    assert.equal(k.mttr_ms, 3 * H);
  });

  test('live : moyenne sur le temps écoulé', () => {
    const k = periodKpis(opened, closed, LIVE);
    assert.equal(k.mttd_ms, 8.5 * H);   // (1 + 16) / 2
  });

  // Aucune mesure possible : null, pas 0.
  test('rien à mesurer → null', () => {
    const k = periodKpis([], [], LIVE);
    assert.equal(k.mttd_ms, null);
    assert.equal(k.mttr_ms, null);
  });
});
