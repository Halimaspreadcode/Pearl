const express   = require('express');
const rateLimit = require('express-rate-limit');
const { addAudit } = require('../core/audit');
const { requireAdmin } = require('../auth/guards');
const { avecArret, confPublique, majConf, chat, listerModeles, diagnostiquer, scriptTunnel } = require('../services/ai');
const skills = require('../services/ai-skills');
const jobs = require('../services/ai-jobs');
const kb = require('../services/ai-kb');

const router = express.Router();

// ── ASSISTANT IA (admin seulement) ────────────────────────────
// Toutes les routes exigent la session admin, y compris la lecture des
// réglages : même sans clé, l'adresse et le modèle n'ont pas à circuler.
// Le contenu des échanges n'est ni stocké ni tracé ; l'audit ne garde que
// qui a appelé, quand, et la taille de l'échange.

// Chaque appel coûte au fournisseur et part hors de la maison : limite
// propre, bien plus serrée que celle de l'API.
const iaLimit = rateLimit({
  windowMs: 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Trop de requêtes vers Pear AI : attendez une minute.' },
});

router.use('/api/ai', requireAdmin, (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.get('/api/ai/config', (_req, res) => res.json(confPublique()));

router.put('/api/ai/config', (req, res) => {
  try {
    const changes = majConf(req.body);
    if (changes.length) addAudit('AI', 'config', 'admin', 'update', { changes });
    res.json(confPublique());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

async function appel(req, res, messages, action) {
  try {
    const r = await chat(messages);
    addAudit('AI', 'chat', 'admin', action, {
      messages: messages.length, chars: messages.reduce((n, m) => n + String(m.content || '').length, 0),
      tokens: r.usage?.total ?? null, ms: r.ms,
    });
    res.json(r);
  } catch (e) {
    addAudit('AI', 'chat', 'admin', action + '-failed', { error: String(e.message).slice(0, 200) });
    res.status(e.status || 400).json({ error: e.message });
  }
}

// Essai de connexion : une question fixe, rien venant de la page.
router.post('/api/ai/test', iaLimit, (req, res) =>
  appel(req, res, [{ role: 'user', content: 'Dis bonjour en une phrase.' }], 'test'));

// Taille : le corps est lu par le parseur global ; les bornes (nombre et
// longueur des messages) sont vérifiées par services/ai.js.
// La base de connaissances (services/ai-kb.js) joint les passages utiles à
// la question ; la réponse renvoie leurs sources pour que la page les cite.
router.post('/api/ai/chat', iaLimit, async (req, res) => {
  const messages = (req.body || {}).messages;
  let ctx = null;
  try {
    ctx = req.body?.kb === false ? null : await kb.contexte(messages);
    const r = await avecArret(arretSiAbandon(req, res), () => chat(messages, ctx && ctx.system ? { system: ctx.system } : {}));
    addAudit('AI', 'chat', 'admin', 'chat', {
      messages: Array.isArray(messages) ? messages.length : 0, tokens: r.usage?.total ?? null, ms: r.ms,
      kb: ctx ? ctx.sources.length : null,
    });
    res.json({ ...r, sources: ctx ? ctx.sources : [] });
  } catch (e) {
    addAudit('AI', 'chat', 'admin', 'chat-failed', { error: String(e.message).slice(0, 200) });
    res.status(e.status || 400).json({ error: e.message });
  }
});

// ── Base de connaissances ──
router.get('/api/ai/kb', (_req, res) => res.json(kb.lire()));
router.put('/api/ai/kb', async (req, res) => {
  try { res.json(await kb.activer(!!req.body?.enabled)); } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
// Un document par requête : { name, text } (PDF lu dans le navigateur,
// texte) ou { name, data } en base64 (Word, PowerPoint, Excel).
router.post('/api/ai/kb', async (req, res) => {
  try {
    const d = await kb.ajouter(req.body || {}, 'admin');
    addAudit('AI', 'kb', 'admin', d.replaced ? 'kb-replace' : 'kb-add', { name: d.name, chars: d.chars, chunks: d.chunks });
    res.status(201).json(d);
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
// Envoi d'un fichier en binaire brut (jusqu'à 50 Mo) : pas de base64 ni
// de JSON, qui gonflaient un fichier de 20 Mo au-delà de la limite.
// Le nom vient de l'en-tête X-Kb-Name ; X-Kb-Text: 1 signale un texte déjà
// extrait par la page (PDF lu avec pdf.js), envoyé en UTF-8.
router.post('/api/ai/kb/upload', express.raw({ type: () => true, limit: '52mb' }), async (req, res) => {
  try {
    const name = decodeURIComponent(String(req.get('X-Kb-Name') || ''));
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buf.length) return res.status(400).json({ error: 'Fichier vide.' });
    const d = await kb.ajouter(req.get('X-Kb-Text') === '1' ? { name, text: buf.toString('utf8') } : { name, buffer: buf }, 'admin');
    addAudit('AI', 'kb', 'admin', d.replaced ? 'kb-replace' : 'kb-add', { name: d.name, chars: d.chars, chunks: d.chunks });
    res.json(d);
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
router.delete('/api/ai/kb/:id', async (req, res) => {
  try {
    const d = await kb.retirer(req.params.id);
    addAudit('AI', 'kb', 'admin', 'kb-remove', { name: d.name });
    res.json({ ok: true });
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
// Mode « knowledge » (/knowledge dans la saisie) : réponse fondée sur les
// seuls documents, chaque affirmation sourcée.
router.post('/api/ai/kb/ask', iaLimit, async (req, res) => {
  try {
    const r = await avecArret(arretSiAbandon(req, res), () => kb.repondre((req.body || {}).messages, chat));
    addAudit('AI', 'chat', 'admin', 'knowledge', { sources: r.sources.length, tokens: r.usage?.total ?? null, ms: r.ms ?? null });
    res.json(r);
  } catch (e) {
    addAudit('AI', 'chat', 'admin', 'knowledge-failed', { error: String(e.message).slice(0, 200) });
    res.status(e.status || 400).json({ error: e.message });
  }
});
router.get('/api/ai/kb/search', async (req, res) => {
  const q = String(req.query.q || '').slice(0, 300);
  try { res.json({ results: await kb.chercherHybride(q, q, 8), sens: kb.etatSens() }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
// ── Recherche par le sens (embeddings) ──
// État de l'indexation, réglage du modèle, essai, réindexation.
router.get('/api/ai/kb/sens', (_req, res) => res.json(kb.etatSens()));
router.get('/api/ai/kb/sens/modeles', async (_req, res) => {
  try {
    const tous = await listerModeles();
    res.json({ modeles: tous.filter(m => /embed|bge|e5|gte|minilm|mpnet|nomic|jina|arctic|sentence|retriev/i.test(m)), tous });
  } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});
router.put('/api/ai/kb/sens', async (req, res) => {
  const m = String(req.body?.model ?? '').trim();
  try {
    if (m) {
      // Essai avant d'enregistrer : un modèle qui ne fait pas d'embeddings
      // est refusé tout de suite, pas à la première question.
      const t = await require('../services/ai').embed(['Procédure en cas de coupure du service data'], { model: m, delai: 30000 });
      if (!t.vecteurs[0]?.length) throw new Error('Le modèle n\'a pas rendu de vecteur.');
    }
    majConf({ embed_model: m });
    addAudit('AI', 'kb', 'admin', m ? 'kb-embeddings' : 'kb-embeddings-off', { model: m });
    kb.indexerSens().catch(() => {});
    res.json(kb.etatSens());
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
router.post('/api/ai/kb/sens/reindex', (_req, res) => { kb.indexerSens().catch(() => {}); res.json(kb.etatSens()); });
router.get('/api/ai/kb/:id', (req, res) => {
  const d = kb.apercu(req.params.id);
  if (!d) return res.status(404).json({ error: 'Document introuvable.' });
  res.json(d);
});

// Liste des modèles accessibles avec la clé.
router.get('/api/ai/models', iaLimit, async (_req, res) => {
  try { res.json({ models: await listerModeles() }); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

// Diagnostic pas à pas (réglages, proxy, DNS, connexion, clé, modèle).
router.post('/api/ai/diagnose', iaLimit, async (_req, res) => {
  try {
    const r = await diagnostiquer();
    addAudit('AI', 'diagnose', 'admin', 'diagnose', { ok: r.etapes.every(e => e.ok !== false), etapes: r.etapes.length });
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Script Windows qui ouvre le tunnel depuis le poste de l'admin. L'adresse
// de la VM est celle sous laquelle la page est consultée.
router.get('/api/ai/tunnel-script', (req, res) => {
  res.set('Content-Type', 'application/octet-stream');
  res.set('Content-Disposition', 'attachment; filename="ia.bat"');
  res.send(scriptTunnel(req.hostname));
});

// ── Skills ──
router.get('/api/ai/skills', (_req, res) => res.json({ skills: skills.catalogue() }));

async function lancerSkill(res, id, input, trace) {
  try {
    const r = await skills.lancer(id, input);
    addAudit('AI', 'skill', 'admin', id, { ...trace, tokens: r.usage?.total ?? null, ms: r.ms });
    res.json(r);
  } catch (e) {
    addAudit('AI', 'skill', 'admin', id + '-failed', { ...trace, error: String(e.message).slice(0, 200) });
    res.status(e.status || 400).json({ error: e.message });
  }
}

// Les skills internes (avis d'objectif, brief, impact) ne passent que par
// leurs routes dédiées, qui construisent elles-mêmes leurs données.
router.post('/api/ai/skills/:id', iaLimit, (req, res) => {
  const id = String(req.params.id);
  const sk = skills.SKILLS.find(s => s.id === id);
  if (!sk || sk.interne) return res.status(404).json({ error: 'Skill inconnu.' });
  if (!(req.body || {}).fond) return lancerSkill(res, id, (req.body || {}).input, {});
  // En arrière-plan : la réponse part tout de suite avec l'identifiant de
  // la tâche ; la page vient lire l'étape en cours puis le résultat.
  const input = (req.body || {}).input;
  try { skills.entrees(sk, input); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  const job = jobs.lancer({ skill: id, titre: sk.titre }, async progres => {
    try {
      const r = await skills.lancer(id, input, progres, { fond: true });
      addAudit('AI', 'skill', 'admin', id, { fond: true, tokens: r.usage?.total ?? null, ms: r.ms });
      return r;
    } catch (e) {
      addAudit('AI', 'skill', 'admin', id + '-failed', { fond: true, error: String(e.message).slice(0, 200) });
      throw e;
    }
  });
  res.status(202).json({ job });
});
// ── Résultats épinglés sur l'accueil ──
const pins = require('../services/ai-pins');
const erreur = (res, e) => res.status(e.status || 400).json({ error: e.message });
router.get('/api/ai/pins', (_req, res) => res.json({ pins: pins.lister(), max: pins.MAX_PINS }));
router.post('/api/ai/pins', async (req, res) => {
  const b = req.body || {};
  const sk = skills.SKILLS.find(s => s.id === b.skill && !s.interne);
  if (!sk) return res.status(400).json({ error: 'Seule une réponse de skill peut être épinglée.' });
  try { res.status(201).json({ pin: await pins.ajouter({ skill: sk.id, titre: sk.titre, input: b.input, resultat: b.resultat }) }); }
  catch (e) { erreur(res, e); }
});
router.delete('/api/ai/pins/:id', async (req, res) => {
  try { res.json({ ok: await pins.retirer(String(req.params.id)) }); } catch (e) { erreur(res, e); }
});
// Actualiser : relance le skill avec les mêmes réglages, en arrière-plan ;
// le widget se met à jour quand la tâche se termine.
router.post('/api/ai/pins/:id/refresh', iaLimit, (req, res) => {
  const p = pins.trouver(String(req.params.id));
  if (!p) return res.status(404).json({ error: 'Épingle introuvable.' });
  const sk = skills.SKILLS.find(s => s.id === p.skill);
  if (!sk) return res.status(400).json({ error: 'Ce skill n\'existe plus.' });
  const job = jobs.lancer({ skill: sk.id, titre: sk.titre }, async progres => {
    const r = await skills.lancer(sk.id, p.input, progres, { fond: true });
    addAudit('AI', 'skill', 'admin', sk.id, { fond: true, epingle: p.id, tokens: r.usage?.total ?? null, ms: r.ms });
    const meta = r.vide ? `${sk.titre} · sans appel au modèle` : r.data?._secours ? `${sk.titre} · version calculée sans IA` : `${sk.titre} · ${Math.round((r.ms || 0) / 1000)} s`;
    await pins.mettreAJour(p.id, { ...r, meta });
    return { pin: p.id };
  });
  res.status(202).json({ job });
});

router.get('/api/ai/jobs', (_req, res) => res.json({ jobs: jobs.enCours() }));
// Bouton Stop d'une tâche en arrière-plan.
router.post('/api/ai/jobs/:id/cancel', (req, res) => {
  const j = jobs.annuler(req.params.id);
  if (!j) return res.status(404).json({ error: 'Tâche introuvable ou déjà terminée.' });
  addAudit('AI', 'skill', 'admin', 'stop', { skill: j.skill });
  res.json({ job: j });
});

// Questions directes (conversation, mode knowledge) : si la page abandonne
// la requête (bouton Stop), l'appel au modèle est coupé aussi.
function arretSiAbandon(req, res) {
  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableFinished) ctrl.abort(); });
  return ctrl.signal;
}
router.get('/api/ai/jobs/:id', (req, res) => {
  const j = jobs.lire(req.params.id);
  if (!j) return res.status(404).json({ error: 'Tâche inconnue ou expirée.' });
  res.json(j);
});

// ── Export PDF d'une réponse ──
// La page envoie la réponse en blocs simples (voir documents/ai-pdf.js) ;
// rien n'est stocké. Le nom du fichier ne garde que des caractères sûrs.
router.post('/api/ai/pdf', (req, res) => {
  const b = req.body || {};
  try {
    const buf = require('../documents/ai-pdf').rapportPdf({ titre: b.titre, sousTitre: b.sousTitre, meta: b.meta, blocs: b.blocs });
    const nom = String(b.titre || 'rapport').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).toLowerCase() || 'rapport';
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="big-brother-${nom}-${new Date().toISOString().slice(0, 10)}.pdf"`);
    res.send(buf);
  } catch (e) {
    res.status(400).json({ error: 'PDF impossible : ' + e.message });
  }
});

// ── Tableau de bord IA ──
// Signaux opérationnels calculés par le serveur, sans appel au modèle.
const pays = v => require('../core/store').normScope(v, 'ALL');
router.get('/api/ai/cockpit', (req, res) => {
  try { res.json(require('../services/ai-team').signauxOps(pays(req.query.country))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

async function lancerPilotage(res, action, fn) {
  try {
    const r = await fn();
    addAudit('AI', 'cockpit', 'admin', action, { tokens: r.usage?.total ?? null, ms: r.ms });
    res.json(r);
  } catch (e) {
    addAudit('AI', 'cockpit', 'admin', action + '-failed', { error: String(e.message).slice(0, 200) });
    res.status(e.status || 400).json({ error: e.message });
  }
}
router.post('/api/ai/cockpit/brief', iaLimit, (req, res) =>
  lancerPilotage(res, 'brief', () => skills.briefTableau((req.body || {}).equipe, pays((req.body || {}).country))));
router.post('/api/ai/cockpit/impact', iaLimit, (req, res) =>
  lancerPilotage(res, 'impact', () => skills.impactElement((req.body || {}).item)));

// Avis sur un objectif, depuis la file de validation.
router.post('/api/ai/objective-check', iaLimit, (req, res) => {
  const b = req.body || {};
  const fo = String(b.fo || '').slice(0, 120), id = String(b.id || '').slice(0, 60);
  if (!fo || !id) return res.status(400).json({ error: 'Objectif manquant.' });
  lancerSkill(res, 'objectif-check', { fo, id }, { objective: id });
});

// ── Insights des agents : activation et consultation (admin) ──
router.get('/api/ai/insights', (_req, res) => res.json(require('../services/ai-insight').vueAdmin()));
router.put('/api/ai/insights', async (req, res) => {
  try {
    const ins = require('../services/ai-insight');
    const r = await ins.majReglages(req.body);
    addAudit('AI', 'insights', 'admin', 'update', { enabled: r.enabled, agents: Object.keys(r.agents).length });
    // Un agent activé reçoit son insight sans attendre la passe suivante.
    if (r.enabled) ins.lancerPasse();
    res.json(ins.vueAdmin());
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Lancer une passe : tous les agents à jour de rien, ou un agent précis
// (refait même s'il est à jour).
router.post('/api/ai/insights/run', (req, res) => {
  const ins = require('../services/ai-insight');
  const b = req.body || {};
  const fo = b.fo ? String(b.fo) : '';
  const lance = ins.lancerPasse({ fo: fo || undefined, force: !!b.force });
  addAudit('AI', 'insights', 'admin', 'run', { agent: fo || 'tous', lance });
  res.json({ lance, ...ins.vueAdmin() });
});
router.get('/api/ai/insights/:fo', (req, res) =>
  res.json(require('../services/ai-insight').insightAdmin(String(req.params.fo))));
router.get('/api/ai/insights/:fo/:id', (req, res) => {
  const i = require('../services/ai-insight').insightParId(String(req.params.fo), String(req.params.id));
  if (!i) return res.status(404).json({ error: 'Insight introuvable.' });
  res.json({ insight: i });
});

module.exports = router;
