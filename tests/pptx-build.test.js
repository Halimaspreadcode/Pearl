// Les decks PPTX ne sont construits qu'au clic : une erreur dans un
// gabarit (variable renommée, helper partagé modifié) ne se voyait qu'en
// production, sous forme d'un bouton qui ne fait rien. On les construit
// ici sur des données minimales pour qu'elle casse le test à la place.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWeeklyPptx } = require('../server/documents/weekly-pptx');
const { buildCombinedPptx } = require('../server/documents/weekly-combined-pptx');

const week = { week_start: '2026-09-28T00:00:00Z', week_end: '2026-10-04T23:59:59Z' };

test('le Weekly Report se construit', async () => {
  const buf = await buildWeeklyPptx({ ...week, kpis: {} }, {});
  assert.ok(Buffer.isBuffer(buf) && buf.length > 1000);
});

test('le deck Dakar × Abidjan se construit', async () => {
  const site = (code, ville) => ({
    code, ville, kpis: {}, prev: {}, days: [], labels: [], opened: [], closed: [],
    avg_day: 0, avg_week: 0, peak_threshold: 3, peaks: [], week_peak: null,
    by_domain: [], by_priority: [], history: [],
  });
  const analysis = {
    ...week, sites: [site('SN', 'Dakar'), site('CI', 'Abidjan')],
    attendance: { per_day: [], labels: [], trend: [], key: 'attendance-SN', required: false,
                  absence_days: 0, unplanned_days: 0, headcount: 0, working_days: 5 },
    observations: [], to_explain: [],
  };
  const buf = await buildCombinedPptx(analysis, { explanations: {} });
  assert.ok(Buffer.isBuffer(buf) && buf.length > 1000);
});
