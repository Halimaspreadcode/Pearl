const express     = require('express');
const { v4: uuidv4 } = require('uuid');
const { FILES } = require('../config/paths');
const { readCfg, readJSON, withFileLock, normScope } = require('../core/store');
const { reportTZ } = require('../core/time');
const { authLimiter } = require('../http/security');
const { requireAdmin } = require('../auth/guards');
const {
  RAPPORT_LABELS, readMailLog, readMailing, writeMailing,
} = require('../services/mail/store');
const { envoyerRapport, composerRapport, prochainEnvoi, RETRY_MAX } = require('../services/mail/scheduler');

const router = express.Router();

// ── API DIFFUSION (admin) ─────────────────────────────────────
// Le mot de passe SMTP n'est jamais renvoyé au client : on expose un
// booléen qui dit s'il est enregistré. Le renvoyer permettrait de le
// relire depuis n'importe quel poste ayant une session admin.
router.get('/api/mailing', requireAdmin, (_req, res) => {
  const m = readMailing();
  const { pass, ...smtp } = m.smtp || {};
  // `pass_from_env` : sans cette distinction, un secret hérité de .env
  // apparaît comme une saisie enregistrée, et on le cherche dans la page
  // alors qu'il est dans le fichier.
  const saisi = !!((readJSON(FILES.mailing, {}).smtp || {}).pass);
  const tz = reportTZ(readCfg());
  res.json({
    smtp: { ...smtp, has_pass: !!pass, pass_from_env: !!pass && !saisi },
    groups: m.groups,
    schedules: m.schedules.map(sc => ({ ...sc, next_run: prochainEnvoi(sc, tz) })),
    alert_email: m.alert_email || '',
    health: etatDiffusion(m, readMailLog()),
    tz,
    reports: Object.entries(RAPPORT_LABELS).map(([id, label]) => ({ id, label })),
  });
});

router.put('/api/mailing', requireAdmin, (req, res) => {
  withFileLock(FILES.mailing, () => {
    const m = readMailing();
    const b = req.body || {};

    if (b.smtp) {
      const { pass, ...reste } = b.smtp;
      // Seule la saisie est enregistrée (voir writeMailing) : les valeurs
      // héritées du .env ne doivent pas être recopiées dans le fichier.
      m.smtpSaisi = { ...m.smtpSaisi, ...reste };
      // Un champ vide ne doit pas effacer un mot de passe déjà en place :
      // l'écran le renvoie vide à chaque enregistrement puisqu'il ne l'a
      // jamais reçu. On n'écrase que sur saisie explicite.
      if (typeof pass === 'string' && pass !== '') m.smtpSaisi.pass = pass;
    }
    if (typeof b.alert_email === 'string') {
      const a = b.alert_email.trim();
      if (a && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a))
        return res.status(400).json({ error: 'Adresse d’alerte invalide' });
      m.alert_email = a;
    }
    if (Array.isArray(b.groups)) {
      m.groups = b.groups.map(g => ({
        id: g.id || uuidv4().slice(0, 8),
        name: String(g.name || '').trim() || 'Sans nom',
        // Filtre minimal : une adresse sans @ ne partira jamais, autant
        // la refuser à la saisie plutôt qu'au moment de l'envoi.
        emails: (Array.isArray(g.emails) ? g.emails : String(g.emails || '').split(/[,;\s]+/))
          .map(e => String(e).trim()).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)),
      }));
    }
    if (Array.isArray(b.schedules)) {
      m.schedules = b.schedules.map(sc => ({
        id: sc.id || uuidv4().slice(0, 8),
        report: String(sc.report || 'daily'),
        // Périmètre du rapport : un site ou tous.
        country: normScope(sc.country, 'first'),
        // Une planification sans groupe n'envoie à personne et échoue en
        // silence dans le journal. Le formulaire préremplit le premier
        // groupe, mais une ligne créée avant qu'un groupe n'existe garde
        // une valeur vide : on la rattache au premier groupe connu plutôt
        // que de laisser un envoi programmé qui ne partira jamais.
        group_id: String(sc.group_id || '') || String((m.groups[0] || {}).id || ''),
        freq: ['once', 'daily', 'weekly', 'monthly'].includes(sc.freq) ? sc.freq : 'daily',
        hour: Math.min(23, Math.max(0, Number(sc.hour) || 0)),
        minute: Math.min(59, Math.max(0, Number(sc.minute) || 0)),
        day: Number(sc.day) || 0,
        // Date d'un envoi unique. Format strict : une valeur libre y
        // passerait sans jamais correspondre, et l'envoi ne partirait
        // jamais sans que rien ne le signale.
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(sc.date || '')) ? String(sc.date) : '',
        enabled: sc.enabled !== false,
        // Objet du mail, modèle à jetons ({report}, {date}…) — vide = défaut.
        subject: String(sc.subject || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200),
        // Conserve la marque d'envoi : la réécrire à vide ferait repartir
        // un rapport déjà expédié aujourd'hui.
        last_run: (m.schedules.find(x => x.id === sc.id) || {}).last_run || null,
        // Relance en attente, conservée : enregistrer la page pendant une
        // relance ne doit pas l'annuler. Désactiver l'envoi l'abandonne.
        retry: sc.enabled !== false ? ((m.schedules.find(x => x.id === sc.id) || {}).retry || null) : null,
      }));
    }
    writeMailing(m);
    res.json({ ok: true });
  }).catch(err => res.status(500).json({ error: err.message }));
});

router.get('/api/mailing/log', requireAdmin, (_req, res) => res.json(readMailLog().slice(0, 100)));

// État de santé : envois programmés dont le dernier essai a échoué (et
// n'est plus relancé) et envois en cours de relance. Lu par l'application
// au chargement pour signaler un rapport non parti — même quand le mail
// d'alerte n'a pas pu partir, faute de serveur SMTP.
function etatDiffusion(m, log) {
  const failed = [], retrying = [];
  for (const sc of m.schedules) {
    if (sc.retry) {
      retrying.push({ schedule_id: sc.id, report: sc.report, attempt: sc.retry.attempt,
                      max: RETRY_MAX, next_at: sc.retry.next_at, error: sc.retry.last_error });
      continue;
    }
    const dernier = log.find(e => e.schedule_id === sc.id && ['auto', 'retry', 'manual'].includes(e.origin));
    if (dernier && !dernier.ok)
      failed.push({ schedule_id: sc.id, report: sc.report, at: dernier.at, error: dernier.error });
  }
  // Serveur d'envoi complet : même critère que la page (hôte, port, compte,
  // mot de passe), pour que la vue d'ensemble l'affiche sans ouvrir la page.
  const sm = m.smtp || {};
  const smtp_ready = !!(sm.host && sm.port && sm.user && sm.pass);
  return { failed, retrying, smtp_ready };
}
router.get('/api/mailing/health', requireAdmin, (_req, res) =>
  res.json(etatDiffusion(readMailing(), readMailLog())));

// Aperçu : le mail tel qu'il partirait (objet, corps, pièce jointe), sans
// l'envoyer. Accepte une planification enregistrée, ou un rapport et un
// modèle d'objet encore en cours de saisie dans la page.
router.post('/api/mailing/preview', requireAdmin, async (req, res) => {
  const m = readMailing();
  const sch = m.schedules.find(s => s.id === String(req.body?.schedule_id || ''));
  const report  = String(req.body?.report || (sch && sch.report) || 'daily');
  const subject = typeof req.body?.subject === 'string' ? req.body.subject : (sch && sch.subject) || '';
  const country = normScope(req.body?.country || (sch && sch.country), 'first');
  if (!RAPPORT_LABELS[report]) return res.status(400).json({ error: 'Rapport inconnu' });
  try {
    const mail = await composerRapport(report, subject, country);
    const groupe = sch && m.groups.find(g => g.id === sch.group_id);
    res.json({
      subject: mail.subject,
      html: mail.html,
      to: groupe ? groupe.emails : [],
      attachment: { filename: mail.piece.filename, size: mail.piece.content.length, type: mail.piece.type },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// « Envoyer maintenant » : déclenche une planification hors horaire, vers
// son groupe. N'écrit pas last_run — l'envoi programmé du jour part quand
// même, un envoi manuel ne doit pas le décaler.
router.post('/api/mailing/send', authLimiter, requireAdmin, async (req, res) => {
  const m = readMailing();
  const sch = m.schedules.find(s => s.id === String(req.body?.schedule_id || ''));
  if (!sch) return res.status(404).json({ error: 'Planification introuvable — enregistrez d’abord' });
  const groupe = m.groups.find(g => g.id === sch.group_id);
  if (!groupe || !(groupe.emails || []).length)
    return res.status(400).json({ error: 'Groupe introuvable ou vide' });
  const r = await envoyerRapport(sch.report, groupe, m.smtp, 'manual', sch.id, sch.subject, undefined, sch.country);
  r.ok ? res.json({ ok: true }) : res.status(502).json({ error: r.error });
});

// Envoi de test : même chemin que l'envoi programmé, pour que réussir ici
// signifie vraiment que la planification fonctionnera.
router.post('/api/mailing/test', authLimiter, requireAdmin, async (req, res) => {
  const m = readMailing();
  const dest = String(req.body?.to || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(dest))
    return res.status(400).json({ error: 'Adresse de test invalide' });

  const kind = String(req.body?.report || 'daily');
  const r = await envoyerRapport(kind, { name: 'Test manuel', emails: [dest] }, m.smtp, 'test', null, '', undefined, req.body?.country);
  r.ok ? res.json({ ok: true }) : res.status(502).json({ error: r.error });
});

module.exports = router;
