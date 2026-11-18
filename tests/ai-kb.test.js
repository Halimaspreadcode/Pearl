// Base de connaissances de Pear AI : extraction, découpage, recherche.
const { useTempDataDir } = require('./helpers/data-dir');
useTempDataDir({});
const { test } = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const kb = require('../server/services/ai-kb');

const docx = async paras => {
  const z = new JSZip();
  z.file('word/document.xml', `<w:document xmlns:w="x"><w:body>${paras.map(p => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
  return (await z.generateAsync({ type: 'nodebuffer' })).toString('base64');
};

test('Word : texte extrait, puis retrouvé par la recherche', async () => {
  const d = await kb.ajouter({ name: 'passation.docx', data: await docx(['Guide de passation', 'Renseigner le Handover Board avant de partir &amp; signaler les tickets ouverts.']) });
  assert.equal(d.type, 'docx');
  assert.ok(d.chunks >= 1);
  const r = kb.chercher('comment remplir le handover board');
  assert.equal(r[0].name, 'passation.docx');
  assert.match(r[0].text, /Handover Board avant de partir & signaler/);
});

test('PowerPoint : une ligne par diapositive', async () => {
  const z = new JSZip();
  z.file('ppt/slides/slide2.xml', '<p:sld><a:p><a:r><a:t>Deuxième</a:t></a:r></a:p></p:sld>');
  z.file('ppt/slides/slide1.xml', '<p:sld><a:p><a:r><a:t>Escalade vers le NOC</a:t></a:r></a:p></p:sld>');
  const d = await kb.ajouter({ name: 'deck.pptx', data: (await z.generateAsync({ type: 'nodebuffer' })).toString('base64') });
  const t = kb.apercu(d.id).passages.join('\n');
  assert.ok(t.indexOf('Diapositive 1') < t.indexOf('Diapositive 2'));
  assert.match(t, /Escalade vers le NOC/);
});

test('Excel : lignes lues cellule par cellule', async () => {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Contacts').addRow(['Back Office Dakar', '+221 33 000 00 00']);
  const d = await kb.ajouter({ name: 'contacts.xlsx', data: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64') });
  assert.match(kb.apercu(d.id).passages[0], /Back Office Dakar \| \+221/);
});

test('texte long : découpé en passages qui se recouvrent', () => {
  const t = Array.from({ length: 40 }, (_, i) => `Paragraphe ${i} : ${'mot '.repeat(40)}`).join('\n\n');
  const parts = kb.decouper(t);
  assert.ok(parts.length > 3);
  assert.ok(parts.every(p => p.length <= kb.LIM.chunk + kb.LIM.overlap + 50));
});

test('même nom : la nouvelle version remplace l\'ancienne', async () => {
  await kb.ajouter({ name: 'sla.txt', text: 'Les P1 se résolvent en 4 heures.' });
  const d = await kb.ajouter({ name: 'sla.txt', text: 'Les P1 se résolvent désormais en 2 heures.' });
  assert.equal(d.replaced, true);
  assert.equal(kb.lire().docs.filter(x => x.name === 'sla.txt').length, 1);
  assert.match(kb.chercher('résolution P1')[0].text, /2 heures/);
});

test('contexte joint au modèle : consignes, passages numérotés et sources', async () => {
  const ctx = await kb.contexte([{ role: 'user', content: 'Combien de temps pour résoudre un P1 ?' }]);
  assert.match(ctx.system, /cite la source entre crochets/);
  assert.match(ctx.system, /\[1\] sla\.txt/);
  assert.equal(ctx.sources[0].name, 'sla.txt');
  assert.equal((await kb.contexte([{ role: 'user', content: 'zzz qqq' }])).sources.length, 0);
});

test('format refusé, document vide, retrait', async () => {
  await assert.rejects(kb.ajouter({ name: 'virus.exe', data: 'AAAA' }), /non pris en charge/);
  await assert.rejects(kb.ajouter({ name: 'vide.pdf', text: '   ' }), /Aucun texte lisible/);
  const d = kb.lire().docs.find(x => x.name === 'deck.pptx');
  await kb.retirer(d.id);
  assert.ok(!kb.lire().docs.some(x => x.name === 'deck.pptx'));
  assert.equal(kb.chercher('Escalade NOC').length, 0);
});

test('base désactivée : rien n\'est joint', async () => {
  await kb.activer(false);
  assert.equal(await kb.contexte([{ role: 'user', content: 'P1' }]), null);
  await kb.activer(true);
});

test('racines : formes d\'un même mot rapprochées', () => {
  assert.equal(kb.racine('procedures'), kb.racine('procedure'));
  assert.equal(kb.racine('escalader'), kb.racine('escalade'));
  assert.equal(kb.racine('p1'), 'p1');
});

test('mode knowledge : mots-clés du modèle, réponse stricte et sourcée', async () => {
  await kb.ajouter({ name: 'escalade.txt', text: 'Procédure escalade P1 : prévenir le Back Office en 15 minutes.\n\nOuvrir un bridge Teams.' });
  const appels = [];
  // 1. compréhension (reformulation, mots, réponse type) ; 2. relecture des
  // passages trouvés ; 3. réponse.
  const faux = async (messages, opts = {}) => {
    appels.push({ messages, opts });
    const q = messages[messages.length - 1].content;
    if (/QUESTION:/.test(q)) return { content: 'QUESTION: Que faire lors d\'un incident P1 ?\nMOTS: escalade, back office, P1, incident critique\nREPONSE: Escalader au Back Office.' };
    if (/Quels extraits aident/.test(q)) return { content: (q.match(/#(\d+) \(escalade\.txt\)/) || [])[1] || '1' };
    return { content: 'Prévenir le BO en 15 min [1].', ms: 5 };
  };
  const r = await kb.repondre([{ role: 'user', content: 'Que faire pour un incident critique ?' }], faux);
  const fin = appels[appels.length - 1];
  assert.match(fin.opts.system, /MODE KNOWLEDGE/);
  assert.match(fin.opts.system, /15 minutes/);
  assert.ok(appels.length >= 2 && appels.length <= 3);
  assert.equal(r.sources[0].name, 'escalade.txt');
  assert.match(r.content, /\[1\]/);
});

test('mode knowledge : rien trouvé, le modèle n\'invente pas', async () => {
  let n = 0;
  const r = await kb.repondre([{ role: 'user', content: 'recette du thieboudienne' }], async () => { n++; return { content: 'riz, poisson' }; });
  assert.equal(r.sources.length, 0);
  assert.match(r.content, /rien trouvé/);
  assert.equal(n, 1); // seulement la reformulation, pas de réponse inventée
});

test('relecture : les passages que le modèle juge hors sujet sont écartés', async () => {
  const passages = [{ name: 'a', text: 'A' }, { name: 'b', text: 'B' }, { name: 'c', text: 'C' }, { name: 'd', text: 'D' }];
  const r = await kb.relire('q', passages, async () => ({ content: '3, 1' }));
  assert.deepEqual(r.map(p => p.name), ['c', 'a']);
  assert.deepEqual(await kb.relire('q', passages, async () => ({ content: '0' })), []);
  // En cas d'échec du modèle : l'ordre de la recherche.
  assert.equal((await kb.relire('q', passages, async () => { throw new Error('x'); })).length, 4);
});

test('gros fichier texte envoyé en binaire : décodé, découpé, retrouvé', async () => {
  const lignes = []; for (let i = 0; i < 40000; i++) lignes.push(`Ligne ${i} : la fiche réflexe du lien Dakar-Abidjan donne le contact de garde ${i % 50}.`);
  const buffer = Buffer.from(lignes.join('\n'), 'utf8');
  assert.ok(buffer.length > 3 * 1024 * 1024);
  const d = await kb.ajouter({ name: 'gros.txt', buffer }, 'admin');
  assert.ok(d.chunks > 1000);
  assert.ok(kb.chercher('contact de garde lien Dakar Abidjan').some(r => r.name === 'gros.txt'));
});

test('recherche par le sens : retrouve un passage sans mot en commun avec la question', async () => {
  // Faux modèle d'embeddings : chaque « concept » est une dimension.
  const ai = require('../server/services/ai');
  const concepts = [/internet|data|connexion|réseau/i, /coupure|panne|plus d'|n'a plus|indisponib/i, /facture|paiement/i, /client|abonné|usager/i];
  const vecteur = t => concepts.map(re => (re.test(t) ? 1 : 0)).concat([0.05]);
  const avant = { lireFichier: ai.lireFichier, embed: ai.embed };
  ai.lireFichier = () => ({ ...avant.lireFichier(), embed_model: 'faux-embed' });
  ai.embed = async textes => ({ vecteurs: textes.map(vecteur), model: 'faux-embed' });
  try {
    await kb.ajouter({ name: 'data.txt', text: 'Procédure en cas de coupure du service data : vérifier la cellule, puis ouvrir un ticket réseau.' });
    await kb.ajouter({ name: 'facture.txt', text: 'Contestation de facture : transmettre au service commercial avec la référence de paiement.' });
    await kb.indexerSens();
    const e = kb.etatSens();
    assert.equal(e.modele, 'faux-embed'); assert.equal(e.indexes, e.total);
    const q = 'Que faire quand un abonné n\'a plus internet ?';
    assert.ok(!kb.chercher(q).some(r => r.name === 'data.txt'), 'par les mots seuls, introuvable');
    const r = await kb.chercherHybride(q, q, 3);
    assert.equal(r[0].name, 'data.txt');
    assert.equal(r[0].via, 'sens');
  } finally { Object.assign(ai, avant); }
});
