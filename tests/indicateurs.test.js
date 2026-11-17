// Indicateurs : définition nettoyée, calcul déterministe, vues « qui se dégrade ».
const { useTempDataDir } = require('./helpers/data-dir');
useTempDataDir({});
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ind = require('../server/services/indicateurs');

const NOW = Date.UTC(2026, 10, 18, 12);           // mercredi 18 nov. 2026
const sem = (j, h = 10) => new Date(Date.UTC(2026, 10, j, h)).toISOString();
const tk = (fo, occ, detMin, extra = {}) => ({ fo_owner: fo, occur_time: occ, detection_time: new Date(Date.parse(occ) + detMin * 60000).toISOString(), ...extra });
const cfg = { work_mode: 'live' };
const MTTD = { nom: 'MTTD', mesure: { fn: 'moyenne', valeur: { de: 'occur_time', a: 'detection_time' } }, date: 'occur_time', unite: 'min', sens: 'bas',
  vues: [{ type: 'carte' }, { type: 'evolution', par: 'fo_owner', filtre: 'degrade' }, { type: 'classement', par: 'fo_owner' }] };
// Semaine du 2 nov. (précédente) puis du 9 nov. (dernière terminée).
const tickets = [
  tk('Awa', sem(3), 10), tk('Awa', sem(4), 20),   // 15 → 30 : +100 %
  tk('Moussa', sem(3), 40),                         // 40 → 20 : mieux
  tk('Awa', sem(10), 30), tk('Moussa', sem(11), 20),
  tk('Awa', sem(17), 999),                          // semaine en cours : hors calcul
];

test('nettoyage : champs inconnus écartés et signalés', () => {
  const { def, avertissements } = ind.nettoyer({ ...MTTD, filtres: [{ champ: 'mot_de_passe', op: '=', valeur: 'x' }], vues: [{ type: 'hack' }] });
  assert.equal(def.filtres.length, 0);
  assert.ok(avertissements.length >= 2);
  assert.ok(def.vues.length >= 1);
});

test('MTTD : dernière semaine terminée, écart avec la précédente', () => {
  const r = ind.calculer(MTTD, { tickets, cfg, maintenant: NOW });
  assert.equal(r.resume.valeur, 25);         // (30 + 20) / 2
  assert.equal(r.resume.precedente, 23.3);   // (10 + 20 + 40) / 3
  assert.equal(r.resume.tendance, 'pire');
});

test('vue évolution : le FO qui se dégrade, et de combien de %', () => {
  const r = ind.calculer(MTTD, { tickets, cfg, maintenant: NOW });
  const v = r.vues.find(x => x.type === 'evolution');
  assert.deepEqual(v.lignes.map(l => l.nom), ['Awa']);
  assert.equal(v.lignes[0].delta_pct, 100);
  const c = r.vues.find(x => x.type === 'classement');
  assert.equal(c.lignes[0].nom, 'Awa');      // le plus lent en premier
});

test('taux et filtres', () => {
  const t = [{ open_date: sem(10), sla_status: 'Breach', priority: 'P1' }, { open_date: sem(11), sla_status: 'In SLA', priority: 'P1' }, { open_date: sem(11), sla_status: 'In SLA', priority: 'P3' }];
  const r = ind.calculer({ filtres: [{ champ: 'priority', op: '=', valeur: 'p1' }], mesure: { fn: 'taux', condition: [{ champ: 'sla_status', op: '=', valeur: 'Breach' }] }, date: 'open_date' },
    { tickets: t, cfg, maintenant: NOW });
  assert.equal(r.resume.valeur, 50);
  assert.equal(r.def.unite, '%');
});

test('enregistrement puis relecture', async () => {
  const { item } = await ind.enregistrer(MTTD, 'admin');
  assert.ok(item.id);
  await ind.enregistrer({ ...item, cible: 15 }, 'admin');
  assert.equal(ind.lire().length, 1);
  assert.equal(ind.lire()[0].cible, 15);
  assert.ok(await ind.supprimer(item.id));
  assert.equal(ind.lire().length, 0);
});

test('extraction du JSON rendu par le modèle', () => {
  assert.deepEqual(ind.extraireJson('Voici :\n```json\n{"a":1}\n```'), { a: 1 });
  assert.equal(ind.extraireJson('rien'), null);
});
