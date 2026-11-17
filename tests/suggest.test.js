// Suggestions à la création d'un ticket (server/services/suggest.js) :
// classement TF-IDF, seuils de confiance et de support, filtrage par les
// listes configurées, détection de doublons, cache de l'index.
const { useTempDataDir, writeFixture } = require('./helpers/data-dir');

// ── Jeu synthétique (≥ 30 tickets) ───────────────────────────
const BO_T = { id: 'b1', name: 'BO Transport', phone: '770000001' };
const BO_R = { id: 'b2', name: 'BO Radio', phone: '' };
const CFG = {
  domains: ['INFRA', 'MMC', 'NMS', 'HCS'],
  fo_list: ['Awa', 'Bamba', 'Coumba', 'Demba'],
  ticket_priorities: ['P1', 'P2', 'P3', 'P4'],
  sla_hours: { 'Incident P1': 4, 'Incident P2': 8, 'Problem Bug P3': 24, 'Problem non Bug P4': 72 },
};

let n = 0;
const T = (title, f = {}) => ({
  id: `sn-t${String(++n).padStart(3, '0')}`, sn_tt: `ALRS-${1000 + n}`, title,
  status: 'Closed', type: 'Incident', ...f,
});

const TICKETS = [
  // Grappe 1 — coupures fibre : valeurs cohérentes, texte RCA répété.
  ...['Coupure fibre entre Rufisque et Mbour', 'Coupure fibre Rufisque–Mbour (travaux)',
      'Coupure de la fibre sur le lien Rufisque Mbour', 'Coupure fibres Rufisque / Mbour',
      'Nouvelle coupure fibre Rufisque Mbour', 'Coupure fibre optique Rufisque-Mbour 2',
      'Coupure fibre Mbour Rufisque axe sud', 'Coupure fibre Rufisque Mbour — reprise']
    .map((title, i) => T(title, {
      domain: 'INFRA', priority: 'P2', severity: i < 6 ? 'Major' : 'Minor',
      bo_handling: i < 7 ? 'BO Transport 770000001' : 'BO Transport',   // nom seul = ancien format
      assigned_to: 'Awa', rc_category: 'Hardware',
      root_cause: i < 5 ? 'Coupure fibre suite à des travaux de voirie' : `Cause ${i}`,
      corrective_actions: 'Soudure réalisée par l\'équipe transport',
    })),
  // Grappe 2 — NMS / U2020 : priorité partagée moitié-moitié → pas de consensus.
  ...[1, 2, 3, 4, 5, 6].map(i => T(`Perte de supervision NMS U2020 zone ${i % 2 ? 'nord' : 'sud'}`, {
    domain: 'NMS', priority: i % 2 ? 'P1' : 'P3', bo_handling: 'BO Radio', assigned_to: 'Bamba',
  })),
  // Grappe 3 — domaine qui n'existe plus dans la config : jamais proposé.
  ...[1, 2, 3, 4, 5].map(i => T(`Saturation disque serveur collecte ${i}`, {
    domain: 'OLDDOM', priority: 'P3', assigned_to: 'Ancien agent', bo_handling: 'BO disparu',
  })),
  // Grappe 4 — seulement 2 tickets : support insuffisant.
  T('Certificat expiré portail supervision', { domain: 'HCS', priority: 'P4' }),
  T('Certificat expiré sur le portail de supervision web', { domain: 'HCS', priority: 'P4' }),
  // Bruit : titres variés.
  ...['Echec replication base facturation', 'Latence sondes LTS zone centre',
      'Basculement lien secours non declenche', 'Tentatives de connexion repetees',
      'Sauvegarde nocturne interrompue', 'Desynchronisation NTP equipements',
      'Alarme FH hors service site Thies', 'Degradation taux succes SMS MMC',
      'Probleme badge acces salle', 'Mise a jour firmware routeur']
    .map((title, i) => T(title, { domain: CFG.domains[i % 4], priority: `P${1 + (i % 4)}` })),
  // Tickets OUVERTS, pour les doublons.
  T('Perte de supervision NMS U2020 zone nord', { status: 'Open', sn_tt: 'ALRS-OPEN1',
    imoc_tt: 'IMOC-777', domain: 'NMS', priority: 'P1' }),
  T('Alarme FH hors service site Thies', { status: 'In Progress', domain: 'MMC' }),
];

const dir = useTempDataDir({ 'config.json': CFG, 'bo_list.json': [BO_T, BO_R], 'sn.json': TICKETS, 'ci.json': [] });

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const S = require('../server/services/suggest');

test('le jeu synthétique compte au moins 30 tickets', () => assert.ok(TICKETS.length >= 30));

describe('tokenize', () => {
  test('minuscules, accents, mots vides, nombres seuls, pluriels simples', () => {
    assert.deepEqual(S.tokenize('Coupure des Fibres à Thiès — 2024 U2020 FH'),
      // « Thiès » → « thie » : la règle du pluriel s'applique aussi aux
      // noms propres, mais de la même façon à l'index et à la requête.
      ['coupure', 'fibre', 'thie', 'u2020', 'fh']);
  });
  test('texte vide ou uniquement de mots vides', () => {
    assert.deepEqual(S.tokenize(''), []);
    assert.deepEqual(S.tokenize('the de la 123 et'), []);
  });
});

describe('classement', () => {
  test('les tickets de la même grappe viennent en tête', () => {
    const idx = S.buildIndex(TICKETS);
    const r = S.rank(idx, 'Coupure fibre Rufisque Mbour');
    const top8 = r.slice(0, 8).map(x => x.ticket.domain);
    assert.deepEqual(top8, Array(8).fill('INFRA'));
    assert.ok(r[0].similarity > 0.8);
    // Ordre décroissant et stable.
    for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].similarity >= r[i].similarity);
    assert.deepEqual(S.rank(idx, 'Coupure fibre Rufisque Mbour').map(x => x.ticket.id), r.map(x => x.ticket.id));
  });
});

describe('suggestions', () => {
  const run = q => S.suggest('sn', q);

  test('grappe cohérente : champs proposés avec confiance et preuves', () => {
    const r = run({ title: 'Coupure fibre Rufisque Mbour ce matin' });
    const s = r.suggestions;
    assert.equal(s.domain.value, 'INFRA');
    assert.equal(s.priority.value, 'P2');
    assert.equal(s.type.value, 'Incident');
    assert.equal(s.assigned_to.value, 'Awa');
    assert.equal(s.rc_category.value, 'Hardware');
    assert.ok(s.domain.confidence >= S.MIN_CONFIDENCE);
    assert.ok(s.domain.support >= S.MIN_SUPPORT);
    assert.ok(s.domain.examples.length >= 2 && s.domain.examples.length <= 3);
    assert.ok(s.domain.examples[0].sn_tt.startsWith('ALRS-'));
    // Texte répété chez 5 voisins : voté ; actions correctives identiques partout.
    assert.equal(s.root_cause.value, 'Coupure fibre suite à des travaux de voirie');
    assert.equal(s.corrective_actions.value, 'Soudure réalisée par l\'équipe transport');
  });

  test('BO : l\'ancien format « nom seul » est ramené à la valeur actuelle de la liste', () => {
    const s = run({ title: 'Coupure fibre Rufisque Mbour' }).suggestions;
    assert.equal(s.bo_handling.value, 'BO Transport 770000001');
    assert.equal(s.bo_handling.support, 8);
  });

  test('sévérité majoritaire (6 Major / 2 Minor) proposée par vote', () => {
    const s = run({ title: 'Coupure fibre Rufisque Mbour' }).suggestions;
    assert.equal(s.severity.value, 'Major');
    assert.equal(s.severity.kind, 'vote');
  });

  test('pas de consensus (P1/P3 à parts égales) → priorité absente', () => {
    const s = run({ title: 'Perte de supervision NMS U2020' }).suggestions;
    assert.equal(s.domain.value, 'NMS');
    assert.equal(s.bo_handling.value, 'BO Radio');
    assert.equal(s.priority, undefined);
    assert.equal(s.severity, undefined, 'ni vote ni règle sans priorité établie');
  });

  test('valeurs hors listes configurées jamais proposées', () => {
    const s = run({ title: 'Saturation disque serveur collecte' }).suggestions;
    assert.equal(s.domain, undefined);        // OLDDOM supprimé de la config
    assert.equal(s.assigned_to, undefined);   // agent hors fo_list
    assert.equal(s.bo_handling, undefined);   // BO disparu de la liste
    assert.equal(s.priority.value, 'P3');     // P3 reste valide
    // Règle : sévérité déduite de la priorité, faute d'historique.
    assert.equal(s.severity.value, 'Minor');
    assert.equal(s.severity.kind, 'rule');
  });

  test('support insuffisant (2 tickets) → rien', () => {
    const r = run({ title: 'Certificat expiré portail supervision' });
    assert.equal(r.suggestions.domain, undefined);
    assert.equal(r.suggestions.priority, undefined);
  });

  test('titre sans rapport → aucune suggestion, aucun doublon', () => {
    const r = run({ title: 'Commande de cafetière pour la cuisine' });
    assert.deepEqual(r.suggestions, {});
    assert.deepEqual(r.possible_duplicates, []);
    assert.equal(r.similar_count, 0);
  });

  test('titre vide → réponse vide', () => {
    const r = run({ title: '' });
    assert.deepEqual(r.suggestions, {});
    assert.deepEqual(r.possible_duplicates, []);
  });

  test('domaine déjà choisi : il n\'est pas re-proposé', () => {
    const s = run({ title: 'Coupure fibre Rufisque Mbour', domain: 'MMC' }).suggestions;
    assert.equal(s.domain, undefined);
    assert.equal(s.priority.value, 'P2');
  });
});

describe('doublons', () => {
  const run = q => S.suggest('sn', q);

  test('ticket ouvert au titre quasi identique', () => {
    const d = run({ title: 'Perte de supervision NMS U2020 zone nord' }).possible_duplicates;
    assert.ok(d.length >= 1);
    assert.equal(d[0].sn_tt, 'ALRS-OPEN1');
    assert.equal(d[0].status, 'Open');
    assert.ok(d[0].similarity >= S.DUP_SIMILARITY);
    // Les tickets clos de même titre ne sont pas des doublons.
    assert.ok(d.every(x => !['Resolved', 'Closed'].includes(x.status)));
  });

  test('ticket In Progress détecté aussi', () => {
    const d = run({ title: 'Alarme FH hors service site Thies' }).possible_duplicates;
    assert.equal(d.length, 1);
    assert.equal(d[0].status, 'In Progress');
  });

  test('même sn_tt ou imoc_tt, quel que soit le titre et le statut', () => {
    let d = run({ title: 'autre chose', sn_tt: 'alrs-1001' }).possible_duplicates;
    assert.equal(d.length, 1);
    assert.equal(d[0].reason, 'same_ref');
    assert.equal(d[0].status, 'Closed');
    d = run({ title: '', imoc_tt: 'IMOC-777' }).possible_duplicates;
    assert.equal(d[0].sn_tt, 'ALRS-OPEN1');
  });

  test('titre seulement voisin (sous le seuil) → pas de doublon', () => {
    const d = run({ title: 'Supervision NMS' }).possible_duplicates;
    assert.deepEqual(d, []);
  });
});

describe('cache de l\'index', () => {
  test('réutilisé tant que le fichier ne change pas, reconstruit sinon', () => {
    S.suggest('sn', { title: 'x fibre' });
    const first = S._cache.sn.index;
    S.suggest('sn', { title: 'y fibre' });
    assert.equal(S._cache.sn.index, first);

    const extra = [...TICKETS, { id: 'sn-new', title: 'Incendie local technique Kaolack', status: 'Open' }];
    writeFixture(dir, 'sn.json', extra);
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(dir, 'sn.json'), future, future);
    const r = S.suggest('sn', { title: 'Incendie local technique Kaolack' });
    assert.notEqual(S._cache.sn.index, first);
    assert.equal(r.indexed, extra.length);
    assert.equal(r.possible_duplicates[0].id, 'sn-new');
    writeFixture(dir, 'sn.json', TICKETS);
  });
});

describe('performance', () => {
  test('500 tickets : requête < 50 ms une fois l\'index construit', () => {
    const words = ['coupure', 'fibre', 'alarme', 'fh', 'nms', 'u2020', 'thies', 'dakar', 'mbour',
      'supervision', 'latence', 'serveur', 'disque', 'lien', 'secours', 'sms', 'mmc', 'bsc', 'ntp', 'backup'];
    let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const big = Array.from({ length: 500 }, (_, i) => ({
      id: `ci-${i}`, title: Array.from({ length: 6 }, () => words[Math.floor(rnd() * words.length)]).join(' '),
      description: 'texte de description ' + words[i % words.length],
      domain: CFG.domains[i % 4], priority: `P${1 + (i % 4)}`, status: i % 3 ? 'Closed' : 'Open',
    }));
    writeFixture(dir, 'ci.json', big);
    S.suggest('ci', { title: 'warm-up' });
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 20; i++) S.suggest('ci', { title: 'coupure fibre dakar mbour lien secours' });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 20;
    assert.ok(ms < 50, `${ms.toFixed(2)} ms par requête`);
  });
});
