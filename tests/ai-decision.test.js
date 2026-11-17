// Rapport de décision : faits calculés par le serveur, alias au modèle,
// vrais noms et chiffres vérifiables à l'affichage.
const { useTempDataDir } = require('./helpers/data-dir');
const J = 86400000;
const il = n => new Date(Date.now() - n * J).toISOString();
const jour = n => new Date(Date.now() + n * J).toISOString().slice(0, 10);
useTempDataDir({
  'config.json': {
    fo_list: ['Awa Ndiaye', 'Moussa Diop'], work_mode: 'live', timezone: 'UTC',
    sla_hours: { 'Incident P2': 4, 'Incident P3': 24 },
  },
  'sn.json': [
    // Cette semaine : 3 ouverts, 2 clos dont 1 en rupture.
    { id: 's1', type: 'Incident', priority: 'P2', domain: 'Transmission', occur_time: il(3), open_date: il(3), status: 'Closed', close_date: il(2.5), fo_owner: 'Awa Ndiaye' },
    { id: 's2', type: 'Incident', priority: 'P3', domain: 'IP', occur_time: il(2), open_date: il(2), status: 'Closed', close_date: il(1.9), fo_owner: 'Awa Ndiaye' },
    { id: 's3', type: 'Incident', priority: 'P3', domain: 'IP', occur_time: il(1), open_date: il(1), status: 'Open', fo_owner: 'Moussa Diop' },
    // Semaine précédente : 1 ouvert, clos dans les temps.
    { id: 's4', type: 'Incident', priority: 'P3', domain: 'IP', occur_time: il(10), open_date: il(10), status: 'Closed', close_date: il(9.9), fo_owner: 'Moussa Diop' },
  ],
  'ci.json': [], 'observations.json': [], 'audit.json': [], 'weekly_progress.json': [], 'fo_tasks.json': [],
  'shifts_plan.json': [
    { fo_name: 'Awa Ndiaye', date: jour(1), shift_id: 'morning', shift_name: 'Matin', site_name: 'Dakar', is_rest: false },
    { fo_name: 'Moussa Diop', date: jour(1), shift_id: 'morning', shift_name: 'Matin', site_name: 'Dakar', is_rest: false },
  ],
  'absences.json': [{ id: 'a1', fo_name: 'Moussa Diop', type: 'Maladie', status: 'Validée', date_from: jour(1), date_to: jour(1), reason: 'secret médical' }],
});
for (const k of ['AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL', 'AI_PROXY', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) delete process.env[k];

const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { donneesDecision } = require('../server/services/ai-decision');

test('faits : flux, rupture et tendance calculés sur la période et la précédente', () => {
  const { donnees, faits } = donneesDecision({ periode: 'semaine', perimetre: 'ALL' });
  const k = donnees.indicateurs;
  assert.equal(k.tickets_ouverts.valeur, 3);
  assert.equal(k.tickets_ouverts.avant, 1);
  assert.equal(k.tickets_clos.valeur, 2);
  assert.equal(k.ruptures_sla.valeur, 1);
  assert.equal(k.sla_pct.valeur, 50);
  assert.equal(k.maintenant.ouverts, 1);
  assert.equal(donnees.origine_des_ruptures.par_domaine[0].valeur, 'Transmission');
  // Planning : le créneau qui perd Moussa est signalé, sans motif d'absence.
  assert.equal(faits.creneaux_fragiles.length, 1);
  assert.deepEqual(faits.creneaux_fragiles[0].agents_absents, ['Moussa Diop']);
  assert.ok(!JSON.stringify(donnees).includes('secret médical'));
  assert.ok(!JSON.stringify(donnees).includes('Maladie'));
});

test('alias au modèle, vrais noms à l\'affichage', () => {
  const { donnees, faits } = donneesDecision({ periode: 'semaine' });
  const envoye = JSON.stringify(donnees);
  assert.ok(!/Awa|Ndiaye|Moussa|Diop/.test(envoye), envoye);
  assert.match(envoye, /Agent 0[12]/);
  assert.ok(faits.charge.some(l => l.fo === 'Awa Ndiaye'));
});

let mock, recu = [];
before(async () => {
  mock = http.createServer((req, res) => {
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      recu.push(JSON.parse(b));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: '{"situation":"Agent 02 est absent demain.","decisions":[{"titre":"Qui remplace Agent 02 ?","constat":"1 créneau à 1 présent","options":[{"option":"Rappeler Agent 01","pour":"x","contre":"y"}],"recommandation":"Rappeler Agent 01","si_rien":"z","urgence":"haute","echeance":"aujourd\'hui","indicateur_de_suivi":"couverture"}],"a_surveiller":[],"incertitudes":[],"message_hierarchie":"RAS"}' }, finish_reason: 'stop' }], usage: { total_tokens: 10 } }));
    });
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  require('../server/services/ai').majConf({ base_url: `http://127.0.0.1:${mock.address().port}/v1`, api_key: 'sk-test-0123456789', model: 'm', proxy_mode: 'none' });
});
after(() => mock.close());

test('skill decision : lecture structurée, noms remis, faits joints', async () => {
  const r = await require('../server/services/ai-skills').lancer('decision', { periode: 'Semaine', perimetre: 'Global', contexte: 'Moussa Diop revient lundi' });
  assert.equal(r.vue, 'decision');
  assert.equal(r.data.decisions[0].titre, 'Qui remplace Moussa Diop ?');
  assert.equal(r.data.decisions[0].recommandation, 'Rappeler Awa Ndiaye');
  assert.equal(r.faits.indicateurs.tickets_ouverts.valeur, 3);
  const envoye = JSON.stringify(recu[0].messages);
  assert.ok(!/Moussa|Diop|Awa|Ndiaye/.test(envoye), envoye);
  assert.match(recu[0].messages[0].content, /DÉCIDER/);
});

test('decisionSansIa : arbitrages évidents à partir des faits, sans IA', () => {
  const { decisionSansIa } = require('../server/services/ai-decision');
  const d = decisionSansIa({
    indicateurs: { tickets_ouverts: { valeur: 40 }, tickets_clos: { valeur: 30 }, ruptures_sla: { valeur: 5 }, sla_pct: { valeur: 85 }, backlog: { debut: 10, fin: 18, evolution: 8 } },
    ruptures_par_domaine: [{ valeur: 'Transmission', nombre: 3 }],
    charge: [{ fo: 'A', tickets: 20 }, { fo: 'B', tickets: 10 }, { fo: 'C', tickets: 5 }], part_deux_plus_charges: 86,
    creneaux_fragiles: [{ date: '2026-10-13', creneau: 'Dakar · Nuit', presents: 0, planifies: 1 }],
    qualite: { clos_sans_date_cloture: 2 },
  }, 'délai dépassé');
  assert.equal(d._secours, true);
  assert.equal(d.decisions.length, 3);
  assert.equal(d.decisions[0].urgence, 'haute');
  assert.match(d.decisions.find(x => /SLA/.test(x.titre)).constat, /Transmission/);
  assert.ok(d.a_surveiller.some(x => /Backlog/.test(x)));
  assert.equal(d.incertitudes.length, 1);
});
