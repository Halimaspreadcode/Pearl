const test = require('node:test');
const assert = require('node:assert');
const jobs = require('../server/services/ai-jobs');

const attendre = ms => new Promise(r => setTimeout(r, ms));

test('ai-jobs : étapes successives puis résultat', async () => {
  let suite;
  const j = jobs.lancer({ skill: 'x', titre: 'X' }, async progres => {
    progres('Lecture des données…');
    await new Promise(r => { suite = r; });
    progres('Mise en forme…');
    return { content: 'ok' };
  });
  await attendre(5);
  let v = jobs.lire(j.id);
  assert.equal(v.etat, 'en_cours');
  assert.equal(v.etape, 'Lecture des données…');
  assert.equal(v.resultat, undefined);
  suite(); await attendre(5);
  v = jobs.lire(j.id);
  assert.equal(v.etat, 'fini');
  assert.deepEqual(v.resultat, { content: 'ok' });
  assert.ok(!jobs.enCours().some(x => x.id === j.id));
});

test('ai-jobs : une erreur est rendue lisible', async () => {
  const j = jobs.lancer({ skill: 'x', titre: 'X' }, async () => { throw new Error('Clé refusée'); });
  await attendre(5);
  const v = jobs.lire(j.id);
  assert.equal(v.etat, 'erreur');
  assert.equal(v.erreur, 'Clé refusée');
});

test('ai-jobs : tâche inconnue', () => assert.equal(jobs.lire('nope'), null));
