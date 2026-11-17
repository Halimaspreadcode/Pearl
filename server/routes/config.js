const express     = require('express');
const bcrypt      = require('bcryptjs');
const { FILES } = require('../config/paths');
const { readCfg, withFileLock, writeCfg } = require('../core/store');
const { DEPTH_MAX_CONFIG, cleanBody } = require('../core/sanitize');
const { ADMIN_COOKIE, readCookie, sessionValid } = require('../auth/sessions');
const { requireAdmin } = require('../auth/guards');

const router = express.Router();

// ── CONFIG ───────────────────────────────────────────────────
router.get('/api/config', (req, res) => {
  // Aucun condensé de mot de passe ne sort d'ici : la route est publique.
  // `absence_allowed_ids` ne sort que pour un admin — la liste nomme des
  // personnes, et la publier dirait à qui s'en prendre pour entrer.
  //
  // Les champs d'évaluation (notes, engagement, entretiens individuels,
  // notations mensuelles) sont nominatifs : les servir ici revenait à
  // publier la note de chaque agent à toute l'équipe. Ils ne sortent que
  // pour un admin ; un FO passe par /api/my-perf, qui ne rend que sa
  // propre note. Le verrou de la Trust Matrix ne suffisait pas : il
  // masquait l'affichage alors que les données étaient déjà chargées.
  const {
    approval_password_hash, absence_password_hash, absence_allowed_ids,
    fo_performance, fo_engagement, fo_o2o, fo_scorecards, fo_access_codes,
    // Les objectifs personnels sont nominatifs au même titre que les
    // notes : un agent lit les siens par /api/my-objectives, jamais ici.
    // Les sessions partent avec eux : leur calendrier n'a de sens que
    // pour qui a le droit de voir les objectifs qu'elles portent.
    fo_objectives, objective_sessions,
    // Qui a droit à l'insight Pearl AI : réglage d'admin, route dédiée.
    ai_insights,
    ...cfg
  } = readCfg();

  // Parties prenantes : la config publique ne donne ni e-mail ni téléphone.
  if (cfg.parties && Array.isArray(cfg.parties.people) && !(sessionValid(req.get('X-Admin-Token')) || sessionValid(readCookie(req, ADMIN_COOKIE))))
    cfg.parties = { ...cfg.parties, people: cfg.parties.people.map(({ id, name, role, country }) => ({ id, name, role, country })) };
  if (sessionValid(req.get('X-Admin-Token')) || sessionValid(readCookie(req, ADMIN_COOKIE))) {
    cfg.absence_allowed_ids = absence_allowed_ids || [];
    cfg.fo_performance = fo_performance || {};
    cfg.fo_engagement  = fo_engagement  || {};
    cfg.fo_o2o         = fo_o2o         || {};
    cfg.fo_scorecards  = fo_scorecards  || {};
    cfg.fo_objectives  = fo_objectives  || {};
    cfg.objective_sessions = objective_sessions || [];
  }
  res.json(cfg);
});

// Écriture de la configuration globale : réservée à l'admin. L'écran
// vit derrière /admin, mais c'est la route qui doit refuser — sans quoi
// un simple curl suffirait à réécrire les objectifs et les seuils.
router.put('/api/config', requireAdmin, (req, res) => {
  withFileLock(FILES.config, () => {
    const prev = readCfg();
    const body = { ...cleanBody(req.body, [], DEPTH_MAX_CONFIG) };
    // Les condensés ne se posent que par leurs routes dédiées, qui
    // hachent et valident. Les accepter ici laisserait écrire un hash
    // arbitraire — ou effacer celui en place — via une simple mise à jour.
    delete body.absence_password_hash;
    delete body.approval_password_hash;
    // Même raison pour les codes d'accès FO : ils se posent par
    // /api/fo-access/:fo, qui hache. Les laisser passer ici permettrait
    // d'écrire un condensé choisi — donc de se donner un code connu.
    delete body.fo_access_codes;
    // Les objectifs et les sessions ont leurs propres routes, qui tiennent
    // la machine à états et l'historique des approbations. Les écrire en
    // bloc ici contournerait ce contrôle et effacerait la traçabilité.
    delete body.fo_objectives;
    delete body.objective_sessions;
    // Ouverture / fermeture des cours de l'Academy : route dédiée
    // (/api/academy/locks). Un client qui renverrait une config lue avant
    // le dernier réglage rouvrirait sinon un module que l'admin vient de fermer.
    delete body.academy;
    // Insights Pearl AI des agents : route dédiée (/api/ai/insights).
    delete body.ai_insights;
    // Rôles et parties prenantes : routes dédiées (/api/parties).
    delete body.parties;

    // Blocs nominatifs (notes, entretiens, engagement) : ils ne sont rendus
    // par GET /api/config qu'à un admin. Un client qui a lu la config sans
    // s'authentifier les a donc à `undefined` et les renvoie vides — ce qui
    // les effaçait ici, par le simple jeu du merge.
    //
    // Règle : un bloc vide dans le corps n'écrase JAMAIS un bloc rempli en
    // place. C'est toujours une lecture incomplète, jamais une suppression
    // voulue — celles-ci passent par les écrans dédiés, qui envoient le bloc
    // complet moins l'élément retiré. Le vidage volontaire du dernier
    // élément reste possible : il arrive comme objet vide alors que `prev`
    // l'est déjà, donc les deux branches donnent le même résultat.
    const BLOCS_NOMINATIFS = [
      'fo_o2o', 'fo_scorecards', 'fo_performance', 'fo_engagement',
    ];
    const ecrases = [];
    for (const cle of BLOCS_NOMINATIFS) {
      if (!(cle in body)) continue;                     // absent : rien à arbitrer
      const entrant = body[cle];
      const vide = !entrant || typeof entrant !== 'object'
        || Object.keys(entrant).length === 0;
      const enPlaceRempli = prev[cle] && typeof prev[cle] === 'object'
        && Object.keys(prev[cle]).length > 0;
      if (vide && enPlaceRempli) {
        delete body[cle];                               // on garde `prev`
        ecrases.push(cle);
      }
    }
    if (ecrases.length) {
      // Trace volontaire : si ce message apparaît, un client lit la config
      // sans en-tête d'administration. Le refus a protégé la donnée, mais la
      // cause est côté appelant et mérite d'être corrigée.
      console.warn(`[Pearl] PUT /api/config : bloc(s) vide(s) ignoré(s) pour ` +
                   `ne pas écraser des données en place : ${ecrases.join(', ')}.`);
    }

    const cfg = { ...prev, ...body };
    cfg.absence_password_hash = prev.absence_password_hash;
    cfg.fo_access_codes = prev.fo_access_codes;
    cfg.fo_objectives      = prev.fo_objectives      || {};
    cfg.objective_sessions = prev.objective_sessions || [];
    cfg.academy            = prev.academy            || {};
    cfg.ai_insights        = prev.ai_insights        || {};
    if (prev.parties) cfg.parties = prev.parties;

    // Never store passwords in plaintext - hash on write, drop the raw field
    if (req.body.approval_password) {
      cfg.approval_password_hash = bcrypt.hashSync(req.body.approval_password, 10);
      delete cfg.approval_password;
    } else {
      cfg.approval_password_hash = prev.approval_password_hash;
    }

    // Normalisation de la liste blanche : on enlève les doublons et les
    // espaces, sinon un « hw1 » et un « hw1  » se comporteraient
    // différemment à la comparaison.
    if ('absence_allowed_ids' in body) {
      const list = Array.isArray(body.absence_allowed_ids) ? body.absence_allowed_ids : [];
      cfg.absence_allowed_ids = [...new Set(
        list.map(v => String(v || '').trim()).filter(Boolean)
      )];
    }

    writeCfg(cfg);
    const { approval_password_hash, absence_password_hash, ...safeCfg } = cfg;
    res.json(safeCfg);
  }).catch(err => res.status(500).json({ error: err.message }));
});

// Renommer un agent dans toutes les données (services/rename-agent.js).
router.post('/api/fo/rename', requireAdmin, async (req, res) => {
  try {
    const r = await require('../services/rename-agent').renommerAgent(req.body?.from, req.body?.to, { fusion: !!req.body?.fusion });
    require('../core/audit').addAudit('config', r.nouveau, 'admin', 'fo-rename', { from: r.ancien, to: r.nouveau, total: r.total });
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Renommage impossible.', fusion_possible: !!e.fusionPossible });
  }
});

module.exports = router;
