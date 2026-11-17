// Diffusion par pays : objet, ville, highlights clôturés retirés, classeur
// déposé rangé par pays, cible SLA calculée côté serveur.
const { useTempDataDir, writeFixture } = require('./helpers/data-dir');
const DIR = useTempDataDir({
  'config.json': { timezone: 'Africa/Dakar', sla_hours: { 'Incident P1': 4, 'Incident P2': { hours: 48, mode: 'business' } } },
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { mailSubject, corpsDaily, highlightsOuverts, normPays } = require('../server/services/mail/bodies');
const { readReportFile, REPORTS_DIR } = require('../server/services/report-store');
const { slaTargetLabel } = require('../server/core/sla');
const { buildDailyWorkbook } = require('../public/js/daily-workbook.js');

const MON = new Date('2026-03-02T10:00:00Z');
const DAILY = {
  date: '2026-03-02T00:00:00Z',
  kpis: { total: 2, open: 1, breach: 0, overall_open: 5, resolved_today: 1, sla_compliance: 90, mttd_ms: 0, mttr_ms: 3600000 },
  today_tickets: [{ sn_tt: 'TT1', tracker: 'SN', type: 'Incident', priority: 'P1', severity: 'P1', status: 'Open', sla_status: 'In SLA' }],
  breach_tickets: [],
};
const BR = {
  author: 'Jean DUPONT',
  highlights: [
    { source: 'NOC', observation: 'Toujours en cours', priority: 'P1', status: 'Open' },
    { source: 'NOC', observation: 'Réglé hier', priority: 'P3', status: 'Closed' },
    { source: 'NOC', observation: 'Clôturé aussi', priority: 'P3', status: ' clôturé ' },
  ],
};

test('objet : pays dans l\'objet par défaut et jeton {country} ; inchangé sans pays', () => {
  assert.equal(mailSubject('daily', '', MON, 'CI'), 'Daily Report CI — 2026-03-02');
  assert.equal(mailSubject('daily', '', MON, 'ALL'), 'Daily Report SN + CI — 2026-03-02');
  assert.equal(mailSubject('daily', '[{country}] {report}', MON, 'SN'), '[SN] Daily Report');
  assert.equal(mailSubject('daily', '', MON), 'Daily Report — 2026-03-02');
  assert.equal(normPays('xx'), 'SN');
});

test('highlights clôturés retirés, quelle que soit l\'écriture', () => {
  assert.deepEqual(highlightsOuverts(BR.highlights).map(h => h.observation), ['Toujours en cours']);
});

test('corps du daily : ville du pays, highlights clôturés absents, cible SLA remplie', () => {
  const html = corpsDaily(DAILY, BR, '', 'CI');
  assert.match(html, /DAILY REPORT/);
  assert.match(html, />Abidjan</);
  assert.doesNotMatch(html, />Dakar</);
  assert.match(html, /Toujours en cours/);
  assert.doesNotMatch(html, /Réglé hier|Clôturé aussi/);
  assert.match(html, />4h</);
});

test('cible SLA : même écriture que la page', () => {
  assert.equal(slaTargetLabel({ type: 'Incident', priority: 'P1' }, { sla_hours: { 'Incident P1': 4 } }), '4h');
  assert.equal(slaTargetLabel({ type: 'Incident', priority: 'P2' }, { sla_hours: { 'Incident P2': { hours: 48, mode: 'business' } } }), '2d BIZ');
  assert.equal(slaTargetLabel({ type: 'X', priority: 'P9' }, { sla_hours: {} }), '-');
});

test('classeur : ville en en-tête et highlights clôturés absents', async () => {
  const form = { ...BR, risks: [], actions: [], customCols: { highlights: [], risks: [], actions: [] } };
  const buf = await buildDailyWorkbook(ExcelJS, DAILY, form, { tz: 'Africa/Dakar', lieu: 'Abidjan' });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const texte = [];
  wb.worksheets[0].eachRow(r => r.eachCell(c => texte.push(String(c.value ?? ''))));
  assert.ok(texte.includes('Abidjan'));
  assert.ok(texte.includes('Toujours en cours'));
  assert.ok(!texte.includes('Réglé hier'));
});

test('classeur déposé : un par pays, l\'ancien dépôt sans pays est ignoré', () => {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORTS_DIR, 'daily-SN.xlsx'), 'sn');
  fs.writeFileSync(path.join(REPORTS_DIR, 'daily.xlsx'), 'ancien');
  writeFixture(DIR, 'report_files.json', {
    daily: { filename: 'ancien.xlsx', period: '2026-03-02' },
    'daily:SN': { filename: 'sn.xlsx', period: '2026-03-02', country: 'SN' },
  });
  assert.equal(String(readReportFile('daily', '2026-03-02', 'SN').content), 'sn');
  assert.equal(readReportFile('daily', '2026-03-02', 'CI'), null);
  assert.equal(readReportFile('daily', '2026-03-03', 'SN'), null);
});
