// Skills de l'assistant IA : saisies bornées, données minimales (pas de
// nom d'agent), avis d'objectif structuré, routes réservées à l'admin.
// Le modèle est simulé par un serveur local au format /v1/chat/completions.
const { useTempDataDir } = require('./helpers/data-dir');
const dir = useTempDataDir({
  'config.json': {
    fo_list: ['Awa Ndiaye', 'Moussa'],
    objective_sessions: [{ id: 'q4', name: 'Q4 2026', start: '2026-10-01', end: '2026-12-31', state: 'open' }],
    fo_objectives: {
      'Awa Ndiaye': [{
        id: 'o1', session: 'q4', title: 'Awa réduit le MTTD de son shift', why: 'Awa veut progresser',
        state: 'submitted', progress: 'todo', due: '2026-12-15',
        kpis: [{ id: 'k1', name: 'MTTD', target: '5', unit: 'min' }],
        steps: [{ id: 's1', label: 'Former Awa aux alarmes', due: '2026-11-01', done: false }], history: [],
      }],
    },
    fo_o2o: {
      'Awa Ndiaye': { objectives: [], meetings: [{ id: 'm1', date: new Date().toISOString().slice(0, 10), topic: 'Point mensuel avec Awa',
        sections: [{ id: 'bilan', label: 'Bilan', text: 'Awa trouve les nuits difficiles. Moussa l\'aide sur Zabbix.' }],
        actions: [{ id: 'a1', text: 'Awa suit le module DV', status: 'todo', due: '2026-10-01' }], mood: 'flat' }] },
    },
    fo_scorecards: { '2026-09': { 'Awa Ndiaye': { sla: 90, attendance: 100 }, Moussa: { sla: 70 } } },
  },
  'audit.json': [],
});
for (const k of ['AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL', 'AI_PROXY', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) delete process.env[k];

const fs = require('fs');
const path = require('path');
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const ai = require('../server/services/ai');
const skills = require('../server/services/ai-skills');
const { issueSession } = require('../server/auth/sessions');

let mock, srv, base, tok, recu = [];
before(async () => {
  mock = http.createServer((req, res) => {
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      const corps = JSON.parse(b || '{}'); recu.push(corps);
      const sys = corps.messages[0].content;
      const json = /JSON/.test(sys);
      const content = /"accroche"/.test(sys)
        ? '{"accroche":"Merci pour ce trimestre.","points_forts":["MTTD suivi"],"points_attention":["Un seul jalon"],"questions":["Q1","Q2"],"objectif_propose":{"titre":"Réduire le MTTD","kpi":"MTTD","echeance":"2026-12-15"},"a_eviter":"Juger"}'
        : /"themes_communs"/.test(sys)
        ? '{"themes_communs":["Nuits"],"actions_manager":["Revoir le planning"],"agents":[{"agent":"Agent 01","resume":"Agent 01 fatigue.","themes":["nuits"],"engagements":[{"texte":"Suivre le module DV","statut":"en_retard"}],"humeur":"neutre","a_reprendre":["planning"]}]}'
        : /"valoriser"/.test(sys)
        ? '{"synthese":"Agent 01 tire l\'équipe.","forces":["SLA"],"vigilances":["Agent 02 sans note"],"agents":[{"agent":"Agent 01","statut":"valoriser","constat":"SLA 90","action":"Féliciter"}],"recommandations":[{"titre":"Saisir les notes","action":"x","priorite":"haute"}],"suivi_manquant":["One-to-One de Agent 02"]}'
        : /"priorites"/.test(sys)
        ? '{"synthese":"Agent 01 a une action en retard.","priorites":[{"titre":"Relancer","agent":"Agent 01","pourquoi":"x","action":"Appeler Agent 02","urgence":"haute","delai":"aujourd\'hui"}],"vigilance":[],"bonnes_nouvelles":[]}'
        : /"gravite"/.test(sys)
        ? '{"gravite":"moyenne","resume":"Agent 01 risque de décrocher.","impacts":[{"sur":"SLA","effet":"x"}],"si_rien":"x","action":"x","delai":"cette semaine"}'
        : /alias/.test(sys) ? '**Synthèse**\n- Agent 01 progresse, agent-02 aussi'
        : json
        ? 'Voici mon avis :\n```json\n{"verdict":"a_revoir","resume":"Cible floue.","forces":["KPI chiffré"],"risques":["Jalon unique"],"reformulation":"Réduire le MTTD à 5 min d\'ici le 15/12","kpis_suggeres":[],"jalons_suggeres":["Mi-parcours"],"message_agent":"Peux-tu ajouter un jalon ?"}\n```'
        : '**Synthèse**\n- point 1';
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ model: corps.model, choices: [{ message: { content }, finish_reason: 'stop' }], usage: { total_tokens: 42 } }));
    });
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  ai.majConf({ base_url: `http://127.0.0.1:${mock.address().port}/v1`, api_key: 'sk-test-0123456789', model: 'qwen-aw-35b', proxy_mode: 'none' });
  const app = express(); app.use(express.json()); app.use(require('../server/routes/ai'));
  await new Promise(r => { srv = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${srv.address().port}`;
  tok = issueSession().token;
});
after(() => { srv.close(); mock.close(); });

const api = (method, p, body, admin = true) => fetch(base + p, {
  method, headers: { 'Content-Type': 'application/json', ...(admin ? { 'X-Admin-Token': tok } : {}) },
  body: body && JSON.stringify(body),
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

test('catalogue : sans consignes ni skill interne, agents proposés', () => {
  const c = skills.catalogue();
  assert.ok(c.length >= 6);
  assert.ok(!c.some(s => ['passation', 'escalade'].includes(s.id)));
  assert.ok(!c.some(s => s.id === 'objectif-check'));
  assert.ok(!JSON.stringify(c).includes('Réponds'));
  assert.deepEqual(c.find(s => s.id === 'o2o').champs[0].options, ['Awa Ndiaye', 'Moussa']);
});

test('saisies : champs inconnus ignorés, bornes, listes fermées, requis', () => {
  const sk = skills.SKILLS.find(s => s.id === 'rca');
  const v = skills.entrees(sk, { probleme: 'x'.repeat(9000), pirate: 'oui' });
  assert.equal(v.probleme.length, 3000);
  const r = skills.entrees(skills.SKILLS.find(s => s.id === 'redaction'), { texte: 'a', ton: 'Insolent' });
  assert.equal(r.ton, 'Professionnel');
  assert.ok(!('pirate' in v));
  assert.throws(() => skills.entrees(sk, {}), /requis/);
});

test('lecture du JSON entouré de texte', () => {
  assert.deepEqual(skills.lireJson('bla ```json\n{"a":1}\n``` fin'), { a: 1 });
  assert.equal(skills.lireJson('pas de json'), null);
});

test('avis d\'objectif : le nom de l\'agent ne part pas, avis structuré', async () => {
  recu = [];
  const r = await api('POST', '/api/ai/objective-check', { fo: 'Awa Ndiaye', id: 'o1' });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.verdict, 'a_revoir');
  assert.equal(r.body.data.message_agent, 'Peux-tu ajouter un jalon ?');
  const envoye = JSON.stringify(recu[0].messages);
  assert.ok(!/Awa|Ndiaye/.test(envoye), envoye);
  assert.match(envoye, /l'agent/);
  assert.match(envoye, /MTTD/);
  // Audit : l'appel est tracé, sans contenu
  const audit = JSON.parse(fs.readFileSync(path.join(dir, 'audit.json'), 'utf8'));
  assert.ok(audit.some(a => a.tracker === 'AI' && a.action === 'objectif-check'));
  assert.ok(!JSON.stringify(audit).includes('MTTD de son shift'));
});

test('skill texte : consignes du skill ajoutées, réponse rendue', async () => {
  recu = [];
  const r = await api('POST', '/api/ai/skills/redaction', { input: { texte: 'bonjour equipe', ton: 'Formel' } });
  assert.equal(r.status, 200);
  assert.match(r.body.content, /Synthèse/);
  assert.match(recu[0].messages[0].content, /réécris le texte/);
  assert.ok(recu[0].max_tokens <= 4000);
});

test('weekly se construit sans données', async () => {
  for (const [id, input] of [['weekly', {}]]) {
    const r = await api('POST', `/api/ai/skills/${id}`, { input });
    assert.equal(r.status, 200, `${id} : ${JSON.stringify(r.body)}`);
  }
});

test('routes refusées sans session admin, skill inconnu en 404', async () => {
  assert.equal((await api('GET', '/api/ai/skills', undefined, false)).status, 401);
  assert.equal((await api('POST', '/api/ai/objective-check', { fo: 'Awa Ndiaye', id: 'o1' }, false)).status, 401);
  assert.equal((await api('POST', '/api/ai/skills/inexistant', { input: {} })).status, 404);
});

test('bilan d\'équipe : tableau avec vrais noms, lecture IA réidentifiée, alias au modèle', async () => {
  recu = [];
  const r = await api('POST', '/api/ai/skills/bilan-equipe', { input: { angle: 'Bilan complet', contexte: 'Moussa revient de congé' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const envoye = JSON.stringify(recu[0].messages);
  assert.ok(!/Awa|Ndiaye|Moussa/.test(envoye), envoye.slice(0, 400));
  assert.equal(r.body.vue, 'bilan');
  assert.deepEqual(r.body.faits.lignes.map(l => l.agent), ['Awa Ndiaye', 'Moussa']);
  assert.equal(r.body.faits.lignes[0].score, 94);   // (90 × 20 + 100 × 15) / 35
  assert.equal(r.body.data.agents[0].agent, 'Awa Ndiaye');
  assert.equal(r.body.data.synthese, "Awa Ndiaye tire l'équipe.");
  assert.equal(r.body.data.suivi_manquant[0], 'One-to-One de Moussa');
});

test('récap des One-to-One : contenu sous alias, cartes réidentifiées', async () => {
  recu = [];
  const r = await api('POST', '/api/ai/skills/o2o-recap', { input: { fo: 'Awa Ndiaye', periode: '30 jours' } });
  assert.equal(r.status, 200);
  const envoye = JSON.stringify(recu[0].messages);
  assert.match(envoye, /nuits difficiles/);
  assert.ok(!/Awa|Ndiaye|Moussa/.test(envoye));
  assert.equal(r.body.data.agents[0].agent, 'Awa Ndiaye');
  assert.equal(r.body.faits.agents[0].entretiens, 1);
});

test('récap sans entretien : réponse claire, sans appel au modèle', async () => {
  recu = [];
  const r = await api('POST', '/api/ai/skills/o2o-recap', { input: { fo: 'Moussa', periode: '90 jours' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.vide, true);
  assert.match(r.body.content, /Aucun One-to-One enregistré pour Moussa/);
  assert.equal(recu.length, 0);
});

test('préparer un One-to-One : fiche structurée, nom jamais envoyé', async () => {
  recu = [];
  const r = await api('POST', '/api/ai/skills/o2o', { input: { fo: 'Awa Ndiaye', focus: 'Awa veut passer L2' } });
  assert.equal(r.status, 200);
  assert.ok(!/Awa|Ndiaye/.test(JSON.stringify(recu[0].messages)));
  assert.equal(r.body.vue, 'prep');
  assert.equal(r.body.faits.agent, 'Awa Ndiaye');
  assert.equal(r.body.faits.objectifs.length, 1);
  assert.equal(r.body.data.questions.length, 2);
});

test('brief du tableau de bord : agents vérifiés, alias, réidentification', async () => {
  recu = [];
  const r = await api('POST', '/api/ai/cockpit/brief', { equipe: [
    { fo: 'Awa Ndiaye', items: [{ lvl: 'urgent', kind: 'o2o-actions', txt: '1 action de One-to-One en retard' }] },
    { fo: 'Inconnu', items: [{ lvl: 'urgent', kind: 'x', txt: 'ne doit pas partir' }] },
  ] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const envoye = JSON.stringify(recu[0].messages);
  assert.ok(!/Awa|Ndiaye|Inconnu|ne doit pas partir/.test(envoye));
  assert.equal(r.body.data.priorites[0].agent, 'Awa Ndiaye');
  assert.equal(r.body.data.priorites[0].action, 'Appeler Moussa');
});

test('impact d\'un élément : contexte de l\'agent sous alias', async () => {
  recu = [];
  const r = await api('POST', '/api/ai/cockpit/impact', { item: { lvl: 'urgent', kind: 'obj-late', txt: 'Awa a 1 objectif en retard', fo: 'Awa Ndiaye' } });
  assert.equal(r.status, 200);
  assert.ok(!/Awa|Ndiaye/.test(JSON.stringify(recu[0].messages)));
  assert.equal(r.body.data.gravite, 'moyenne');
  assert.match(r.body.data.resume, /Awa Ndiaye/);
});

test('skills internes fermés à la route générique', async () => {
  for (const id of ['objectif-check', 'cockpit-brief', 'impact']) {
    assert.equal((await api('POST', `/api/ai/skills/${id}`, { input: {} })).status, 404, id);
  }
  assert.equal((await api('GET', '/api/ai/cockpit', undefined, false)).status, 401);
  const c = await api('GET', '/api/ai/cockpit');
  assert.equal(c.status, 200);
  assert.ok(Array.isArray(c.body.items));
});

test('pseudonymes : prénom seul, nom seul, sans toucher aux mots qui les contiennent', () => {
  const { pseudonymes } = require('../server/services/ai-team');
  const ps = pseudonymes(['Awa Ndiaye', 'Ba']);
  assert.equal(ps.versAlias('Awa, Ndiaye, Bamba et Ba'), 'Agent 01, Agent 01, Bamba et Agent 02');
  assert.equal(ps.versNom('Agent 1 / agent-02 / Agent 09'), 'Awa Ndiaye / Ba / Agent 09');
});

test('JSON coupé par la limite : ce qui est complet est gardé, marqué tronqué', () => {
  const coupe = '```json\n{"situation":"x","decisions":[{"titre":"A","options":[{"option":"o1","pour":"p \\"q\\""}]},{"titre":"B","recommandation":"Lancer une campagne car';
  const d = skills.lireJson(coupe);
  assert.equal(d.situation, 'x');
  assert.equal(d.decisions.length, 2);
  assert.equal(d.decisions[0].options[0].pour, 'p "q"');
  assert.equal(d._tronque, true);
  assert.equal(skills.lireJson('{"a":1}')._tronque, undefined);
});
