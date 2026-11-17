const test = require('node:test');
const assert = require('node:assert');
const { rapportPdf, nettoyer } = require('../server/documents/ai-pdf');

test('ai-pdf : produit un PDF valide avec tous les types de blocs', () => {
  const buf = rapportPdf({
    titre: 'Rapport de décision', sousTitre: 'Semaine du 5 au 12 octobre', meta: ['Dakar (SN)', 'Semaine'],
    blocs: [
      { t: 'h', text: 'Synthèse', niveau: 1 },
      { t: 'p', text: 'Charge concentrée sur un agent.' },
      { t: 'kpis', items: [{ v: '21', l: 'ouverts' }, { v: '12', l: 'ruptures', ton: 'bad' }] },
      { t: 'ul', items: ['Réaffecter les P3', 'RCA Transmission'] },
      { t: 'card', titre: 'Faut-il rééquilibrer ?', badge: 'Haute', ton: 'bad', blocs: [{ t: 'p', text: '27 tickets sur 60.' }] },
      { t: 'table', head: ['Agent', 'Tickets'], rows: [['Fatime NDOYE', '27'], ['Moussa SALL', '9']] },
    ],
  });
  assert.equal(buf.slice(0, 5).toString(), '%PDF-');
  assert.match(buf.toString('latin1'), /\/Count 1 /);
});

test('ai-pdf : un long tableau passe sur plusieurs pages', () => {
  const rows = Array.from({ length: 120 }, (_, i) => [`Ticket ${i}`, 'P3', 'Ouvert']);
  const buf = rapportPdf({ titre: 'Liste', blocs: [{ t: 'table', head: ['Ticket', 'Prio', 'Statut'], rows }] });
  const n = Number(/\/Count (\d+) /.exec(buf.toString('latin1'))[1]);
  assert.ok(n >= 3, `pages : ${n}`);
});

test('ai-pdf : nettoie emoji, types inconnus et encadrés imbriqués', () => {
  const b = nettoyer([
    { t: 'p', text: 'Bonjour 👋 ✦ équipe' }, { t: 'script', text: 'x' },
    { t: 'card', titre: 'A', blocs: [{ t: 'card', titre: 'B', blocs: [] }, { t: 'p', text: 'ok' }] },
  ]);
  assert.equal(b.length, 2);
  assert.equal(b[0].text, 'Bonjour équipe');
  assert.deepEqual(b[1].blocs.map(x => x.t), ['p']);
});
