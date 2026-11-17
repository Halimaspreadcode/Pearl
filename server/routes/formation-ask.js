const express   = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const { addAudit } = require('../core/audit');
const ai = require('../services/ai');

const router = express.Router();

// ── QUESTIONS DANS LES COURS (Academy) ───────────────────────
// Depuis une leçon, l'apprenant pose une question à Pearl AI. Le pont
// des formations (public/formation/digitalview-bridge.js) envoie la
// question et le passage de la leçon où il se trouve ; on en fait une
// consigne de tuteur, puis le même appel que l'assistant (services/ai.js).
//
// Accès : l'admin, toujours ; les agents identifiés seulement si l'admin
// l'a ouvert dans les réglages de Pearl AI (chaque appel coûte au
// fournisseur et part hors de la maison). Comme pour l'assistant, le
// contenu n'est ni stocké ni tracé : l'audit garde qui, quand, quelle
// formation et la taille de l'échange.

const LIM = { question: 600, passage: 5000, historique: 8, message: 2500 };
const COURS = { digitalview: 'DigitalView', process: 'Process ITSM', mobilemoney: 'Mobile Money 2.0', datacenter: 'Data center', reseau: 'Réseaux' };

function acces(req) {
  const q = req.qui;
  if (q && q.admin) return { ok: true, admin: true, qui: q.name || 'Admin' };
  const ouvert = !!ai.lireFichier().academy_open;
  if (ouvert && q && !q.lecture && q.name) return { ok: true, admin: false, qui: q.name };
  return { ok: false, admin: false, raison: ouvert ? 'Identifie-toi (ID employé et code) pour poser une question.' : 'Les questions dans les cours ne sont pas ouvertes aux agents. L\'admin peut les ouvrir dans les réglages de Pearl AI.' };
}

// Une limite par personne : la page peut être ouverte par plusieurs agents
// derrière la même adresse (jumpserver).
const limite = rateLimit({
  windowMs: 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false,
  keyGenerator: req => (req.qui && req.qui.name) ? 'ask:' + req.qui.name : ipKeyGenerator(req.ip),
  message: { error: 'Beaucoup de questions d\'un coup : attends une minute.' },
});

router.use('/api/formation/ask', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// Le bouton ne s'affiche que si une question a une chance d'aboutir.
router.get('/api/formation/ask/status', (req, res) => {
  const a = acces(req), c = ai.confPublique();
  res.json({ on: a.ok && c.has_key, admin: a.admin, raison: !c.has_key ? 'Pearl AI n\'est pas configuré.' : a.raison || '' });
});

const texte = (v, max) => String(v == null ? '' : v).replace(/\s+\n/g, '\n').trim().slice(0, max);

function consigne(b) {
  return [
    `Tu es le tuteur de la formation « ${COURS[b.course] || 'Pearl'} » de l'Academy Pearl.`,
    "L'apprenant est en train de lire la leçon ci-dessous et te pose une question à partir de cet endroit.",
    'Réponds en français simple, comme à un collègue débutant : 3 à 8 phrases, une idée à la fois,',
    'avec un exemple concret ou une comparaison de la vie courante quand ça aide.',
    "Appuie-toi d'abord sur la leçon ; si la question va au-delà, réponds quand même, brièvement, en le disant.",
    "N'invente pas de valeurs propres à la plateforme (adresses, noms de serveurs) : si tu ne sais pas, dis-le.",
    'Pas de titres, pas de tableaux : quelques paragraphes courts, une liste si vraiment utile, du gras avec **…** pour 1 ou 2 mots clés.',
    '',
    `Module : ${texte(b.module, 200)}`,
    `Session : ${texte(b.session, 200)}`,
    `Section affichée : ${texte(b.section, 200)}`,
    '--- Passage de la leçon ---',
    texte(b.passage, LIM.passage) || '(aucun passage transmis)',
    '--- Fin du passage ---',
    b.selection ? `L'apprenant a surligné : « ${texte(b.selection, 600)} »` : '',
  ].filter(x => x !== '').join('\n');
}

router.post('/api/formation/ask', limite, async (req, res) => {
  const a = acces(req);
  if (!a.ok) return res.status(403).json({ error: a.raison });
  const b = req.body || {};
  const question = texte(b.question, LIM.question);
  if (!question) return res.status(400).json({ error: 'Écris ta question.' });
  const hist = (Array.isArray(b.history) ? b.history : []).slice(-LIM.historique)
    .map(m => ({ role: m && m.role === 'assistant' ? 'assistant' : 'user', content: texte(m && m.content, LIM.message) }))
    .filter(m => m.content);
  const messages = [...hist, { role: 'user', content: question }];
  try {
    const r = await ai.chat(messages, { system: consigne(b), max_tokens: 1500, temperature: 0.3 });
    addAudit('AI', 'academy', a.qui, 'ask', { course: COURS[b.course] ? b.course : '?', chars: question.length, tokens: r.usage?.total ?? null, ms: r.ms });
    res.json({ content: r.content, ms: r.ms });
  } catch (e) {
    addAudit('AI', 'academy', a.qui, 'ask-failed', { error: String(e.message).slice(0, 200) });
    // Un agent n'a que faire du détail réseau : un message clair suffit.
    const m = String(e.message || '');
    const eteint = /tunnel|injoignable|ECONN|délai|timeout|502/i.test(m) || e.status === 502;
    res.status(e.status || 400).json({ error: a.admin ? m : (eteint ? 'Pearl AI ne répond pas pour le moment. Réessaie plus tard.' : m), eteint });
  }
});

module.exports = router;
