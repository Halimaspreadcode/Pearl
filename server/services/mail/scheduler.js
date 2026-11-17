const { readCfg } = require('../../core/store');
const { reportTZ, tzParts } = require('../../core/time');
const { appendMailLog, readMailing, writeMailing } = require('./store');
const { smtpSend } = require('./smtp');
const { RAPPORT_LABELS_EN, corpsDaily, corpsWeeklyOverview, mailSubject, PAYS, normPays } = require('./bodies');
const { buildReportFile } = require('../report-build');
const { readDrafts } = require('../report-store');
const { buildDailyReport, buildWeeklyReport } = require('../reports');

// Prochain envoi d'une planification, en heure du fuseau des rapports
// ('YYYY-MM-DD HH:MM'), ou null. Même règle que planifDue, appliquée aux
// jours à venir : la page affichait l'heure mais jamais « quand ».
function prochainEnvoi(sch, tz, now = new Date()) {
  if (!sch.enabled) return null;
  const p = tzParts(now, tz);
  const pad = n => String(n).padStart(2, '0');
  const h = Number(sch.hour) || 0, mi = Number(sch.minute) || 0;
  for (let d = 0; d < 62; d++) {
    const dt = new Date(Date.UTC(p.year, p.month - 1, p.day + d));
    const date = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
    if (d === 0 && (sch.last_run === date || h * 60 + mi < p.hour * 60 + p.minute)) continue;
    const due = planifDue(sch, { hour: h, minute: mi, day: dt.getUTCDate(),
                                 weekday: dt.getUTCDay(), date });
    if (due) return `${date} ${pad(h)}:${pad(mi)}`;
  }
  return null;
}

// Construit le mail d'un rapport sans l'envoyer : objet, corps HTML et
// pièce jointe. L'envoi et l'aperçu de la page Diffusion passent tous deux
// par ici — l'aperçu montre donc exactement ce qui partirait.
async function composerRapport(kind, sujetModele, paysIn) {
  // Pays choisi dans la planification ; il fixe les tickets, les agents,
  // la ville affichée et le classeur joint.
  const pays  = normPays(paysIn);
  const label = RAPPORT_LABELS_EN[kind] || kind;
  const jour  = new Date().toISOString().slice(0, 10);
  const piece = await buildReportFile(kind, pays);
  // Résumé lisible directement dans le mail, pour qui lit sur téléphone
  // sans ouvrir la pièce jointe.
  let corps = '';
  try {
    if (kind === 'daily') {
      const rapport = buildDailyReport(null, pays);
      const dateStr = new Date(rapport.date).toLocaleDateString('en-GB',
        { timeZone: reportTZ(readCfg()) });
      corps = corpsDaily(rapport, readDrafts()[`daily:${jour}`] || {}, dateStr, pays);
    } else if (kind === 'weekly_pptx' || kind === 'weekly') {
      // Même périmètre que le deck joint.
      corps = corpsWeeklyOverview(buildWeeklyReport(null, pays), pays);
    }
  } catch { corps = ''; }   // un résumé raté ne doit pas bloquer l'envoi
  // Un classeur d'une autre date part quand même, mais le mail le dit :
  // taire l'écart ferait passer un rapport de la veille pour celui du
  // jour.
  const decale = piece.period && piece.period !== jour
    ? `<p style="color:#b00"><b>Note:</b> this report was produced on
       ${piece.period} — the report page has not been opened since.</p>` : '';
  return {
    subject: mailSubject(kind, sujetModele, new Date(), pays),
    html: `<div style="font-family:Arial,-apple-system,Segoe UI,Roboto,Helvetica,sans-serif;
                 font-size:13px;color:#1a1c1e;max-width:900px">`
        // Le corps détaillé porte déjà son propre bandeau titre : y
        // ajouter un <h2> ferait deux titres l'un sous l'autre.
        + (corps ? '' : `<h2 style="font-size:16px;margin:0 0 2px">${label} — ${PAYS[pays].en} — ${jour}</h2>`
                      + `<p>Hello,</p><p>Please find attached the ${label.toLowerCase()} (${PAYS[pays].en}) for ${jour}.</p>`)
        + decale
        + corps
        + `<p style="color:#888;font-size:11.5px;margin-top:18px;border-top:1px solid #e0e0e0;
             padding-top:8px">Full details in the attached file — automatic message from Pearl.</p></div>`,
    piece,
  };
}

async function envoyerRapport(kind, groupe, cfgSmtp, origine, schedId, sujetModele, tentative, pays) {
  try {
    const { subject, html, piece } = await composerRapport(kind, sujetModele, pays);
    await smtpSend(cfgSmtp, { to: groupe.emails, subject, html, attachments: [piece] });
    // `origine` distingue l'envoi programmé du test manuel : devant une
    // ligne en échec, savoir laquelle a échoué change le diagnostic.
    appendMailLog({ kind, country: normPays(pays), group: groupe.name, to: groupe.emails, ok: true,
                    origin: origine || 'auto', file: piece.filename,
                    ...(schedId ? { schedule_id: schedId } : {}),
                    ...(tentative ? { attempt: tentative } : {}) });
    return { ok: true };
  } catch (e) {
    appendMailLog({ kind, country: normPays(pays), group: groupe.name, to: groupe.emails, ok: false,
                    origin: origine || 'auto', error: e.message,
                    ...(schedId ? { schedule_id: schedId } : {}),
                    ...(tentative ? { attempt: tentative } : {}) });
    return { ok: false, error: e.message };
  }
}

// ── ORDONNANCEUR DE DIFFUSION ─────────────────────────────────
// Réveil chaque minute : assez fin pour respecter une heure à la minute
// près, assez rare pour ne rien coûter. Le fuseau est celui des rapports
// (config.timezone), sinon un envoi « à 8 h » partirait à l'heure UTC.
//
// `last_run` (une date 'YYYY-MM-DD' par planification) garantit qu'un
// redémarrage dans la même minute ne renvoie pas le rapport : sans cette
// marque, relancer le serveur à 8 h 00 enverrait deux fois.
function planifDue(p, maintenant) {
  if (!p.enabled) return false;
  const [h, m] = [Number(p.hour) || 0, Number(p.minute) || 0];
  if (maintenant.hour !== h || maintenant.minute !== m) return false;

  // Envoi unique à une date donnée. `date` est au format 'YYYY-MM-DD' :
  // on compare la date locale complète, pas seulement le jour du mois,
  // sinon un envoi prévu le 5 mars repartirait le 5 avril.
  if (p.freq === 'once')    return String(p.date || '') === maintenant.date;
  if (p.freq === 'daily')   return true;
  // getUTCDay sur une date construite dans le fuseau cible : 0 = dimanche.
  if (p.freq === 'weekly')  return Number(p.day) === maintenant.weekday;
  if (p.freq === 'monthly') return Number(p.day) === maintenant.day;
  return false;
}

// ── RELANCES ET ALERTE ────────────────────────────────────────
// Une coupure réseau à 8 h 00 faisait perdre le rapport du jour : l'échec
// était journalisé, puis plus rien jusqu'au lendemain. Un envoi programmé
// en échec est maintenant retenté RETRY_MAX fois, espacées de
// RETRY_DELAY_MIN minutes. L'état vit dans la planification (`retry`),
// donc dans mailing.json : un redémarrage du serveur ne le perd pas.
//
// Un groupe vide ou introuvable n'est pas retenté — c'est une erreur de
// configuration, relancer donnerait le même résultat.
const RETRY_MAX = 3;
const RETRY_DELAY_MIN = 10;

function planifierRelance(sch, erreur, now = new Date()) {
  const tentative = (sch.retry && sch.retry.attempt || 0) + 1;
  if (tentative > RETRY_MAX) { sch.retry = null; return false; }
  sch.retry = {
    attempt: tentative,
    next_at: new Date(now.getTime() + RETRY_DELAY_MIN * 60000).toISOString(),
    last_error: String(erreur || '').slice(0, 300),
  };
  return true;
}

// Relances épuisées (ou échec non relançable) : on prévient l'adresse
// d'alerte. Ce mail passe par le même serveur SMTP — si c'est lui qui est
// en panne, l'alerte échoue aussi ; c'est pourquoi l'échec reste également
// visible dans l'application (pastille « échec » de la Diffusion).
async function envoyerAlerte(m, sch, erreur) {
  const dest = String(m.alert_email || '').trim();
  if (!dest) return;
  const label = RAPPORT_LABELS_EN[sch.report] || sch.report;
  const groupe = (m.groups.find(g => g.id === sch.group_id) || {}).name || sch.group_id;
  const esc = v => String(v ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  try {
    await smtpSend(m.smtp, {
      to: [dest],
      subject: `[Pearl] Scheduled report not sent: ${label}`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1a1c1e;max-width:640px">
        <h2 style="font-size:16px;margin:0 0 8px;color:#C5221F">Scheduled report not sent</h2>
        <p>The <b>${esc(label)}</b> scheduled for <b>${esc(groupe)}</b> could not be sent${
          sch.retry === null ? ` after ${RETRY_MAX} retries` : ''}.</p>
        <p style="background:#FCE8E6;color:#8C1D16;padding:10px 12px;border-radius:8px">${esc(erreur)}</p>
        <p>Open <b>Admin › Diffusion</b> to check the mail server settings, then use
           <i>Send now</i> to resend it.</p>
        <p style="color:#888;font-size:11.5px;border-top:1px solid #e0e0e0;padding-top:8px">
          Automatic alert from Pearl.</p></div>`,
    });
    appendMailLog({ kind: sch.report, group: dest, to: [dest], ok: true, origin: 'alert', schedule_id: sch.id });
  } catch (e) {
    appendMailLog({ kind: sch.report, group: dest, to: [dest], ok: false, origin: 'alert',
                    schedule_id: sch.id, error: e.message });
  }
}

async function tickDiffusion() {
  let m;
  try { m = readMailing(); } catch { return; }
  if (!m.schedules.length) return;

  const tz = reportTZ(readCfg());
  const p  = tzParts(new Date(), tz);
  const jour = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  // `dow` vient de tzParts, déjà exprimé dans le fuseau cible (0 =
  // dimanche) : le recalculer à partir d'une date UTC reconstruite
  // décalerait le jour pour les fuseaux à l'est de Greenwich.
  const maintenant = { hour: p.hour, minute: p.minute, day: p.day, weekday: p.dow, date: jour };

  let modifie = false;
  const nowMs = Date.now();

  // Relances dues, avant les envois de l'heure.
  for (const sch of m.schedules) {
    if (!sch.retry || !sch.enabled && sch.freq !== 'once') continue;
    if (new Date(sch.retry.next_at).getTime() > nowMs) continue;
    const groupe = m.groups.find(g => g.id === sch.group_id);
    modifie = true;
    const r = groupe && (groupe.emails || []).length
      ? await envoyerRapport(sch.report, groupe, m.smtp, 'retry', sch.id, sch.subject, sch.retry.attempt, sch.country)
      : { ok: false, error: 'Groupe introuvable ou vide' };
    if (r.ok) { sch.retry = null; continue; }
    if (!planifierRelance(sch, r.error)) await envoyerAlerte(m, sch, r.error);
  }

  for (const sch of m.schedules) {
    if (sch.last_run === jour) continue;          // déjà parti aujourd'hui
    if (!planifDue(sch, maintenant)) continue;

    const groupe = m.groups.find(g => g.id === sch.group_id);
    if (!groupe || !(groupe.emails || []).length) {
      appendMailLog({ kind: sch.report, group: (groupe && groupe.name) || sch.group_id, ok: false,
                      origin: 'auto', schedule_id: sch.id, error: 'Groupe introuvable ou vide' });
      sch.last_run = jour; modifie = true;
      await envoyerAlerte(m, sch, 'Recipient group missing or empty');
      continue;
    }
    // Marqué avant l'envoi : si le relais met dix minutes à répondre, le
    // tick suivant ne doit pas relancer le même rapport.
    sch.last_run = jour; modifie = true;
    // Un envoi unique se désarme une fois parti. On le désactive plutôt
    // que de le supprimer : la ligne reste visible dans la page, avec sa
    // date d'envoi, et peut être réactivée pour une autre date.
    if (sch.freq === 'once') sch.enabled = false;
    sch.retry = null;
    const r = await envoyerRapport(sch.report, groupe, m.smtp, 'auto', sch.id, sch.subject, undefined, sch.country);
    if (!r.ok && !planifierRelance(sch, r.error)) await envoyerAlerte(m, sch, r.error);
  }
  if (modifie) { try { writeMailing(m); } catch {} }
}

// Démarré une seule fois, par server/index.js.
function startScheduler() {
  // unref() : ce minuteur ne doit pas empêcher l'arrêt propre du process.
  // Chaque organisation a ses planifications : un passage par tenant.
  const { forEachTenant } = require('../../platform/tenants');
  setInterval(() => { forEachTenant(() => tickDiffusion().catch(() => {})).catch(() => {}); }, 60 * 1000).unref();
}

module.exports = {
  prochainEnvoi, envoyerRapport, composerRapport, startScheduler,
  RETRY_MAX, RETRY_DELAY_MIN,
  // Exportés pour les tests unitaires (tests/mail.test.js).
  planifDue, tickDiffusion,
};
