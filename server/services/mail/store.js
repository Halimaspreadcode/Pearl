const { v4: uuidv4 } = require('uuid');
const { FILES } = require('../../config/paths');
const { readJSON, writeJSON } = require('../../core/store');
const { addAudit } = require('../../core/audit');

// Valeurs de départ : Gmail, puisque c'est le compte d'envoi retenu.
// Tout reste modifiable depuis la page — basculer sur un relais interne
// ne demande que de changer l'hôte et le port.
// Gmail : sans domaine vérifié, Resend n'accepte d'envoyer qu'à
// l'adresse de son propre compte, ce qui interdit la diffusion à une
// équipe. Gmail écrit à n'importe quel destinataire, au prix d'un mot de
// passe d'application. Le client SMTP reste générique : basculer plus
// tard sur un relais d'entreprise ne demande que de changer ces champs.
const SMTP_DEFAUT = {
  host: 'smtp.gmail.com', port: 587,
  // Compte et expéditeur : .env (SMTP_USER / SMTP_FROM) ou la page
  // Diffusion — pas d'adresse personnelle dans un dépôt public.
  user: '', from: '',
};

function readMailing() {
  const d = readJSON(FILES.mailing, {});
  // Raccourci : SMTP_PASS dans .env évite de ressaisir le mot de passe
  // dans la page après chaque réinstallation. Le .env est déjà le fichier
  // à secrets du projet et il est exclu de git — contrairement au code,
  // qui part dans toute copie et où un mot de passe survivrait à sa
  // révocation. Ce qui est saisi dans la page reste prioritaire.
  const smtp = { ...SMTP_DEFAUT, ...(d.smtp || {}) };
  // Le .env ne comble que ce qui n'a jamais été renseigné. On teste la
  // présence de la clé, pas sa valeur : vider un champ dans la page est
  // un choix — un relais interne ouvert n'a ni compte ni mot de passe —
  // et `||` le réécrasait aussitôt avec la valeur du fichier.
  const saisi = d.smtp || {};
  if (!('pass' in saisi) && process.env.SMTP_PASS) smtp.pass = process.env.SMTP_PASS;
  if (!('user' in saisi) && process.env.SMTP_USER) smtp.user = process.env.SMTP_USER;
  if (!('from' in saisi) && process.env.SMTP_FROM) smtp.from = process.env.SMTP_FROM;
  const m = {
    // { host, port, secure, user, pass, from, reject_unauthorized }
    smtp,
    groups:    d.groups    || [],   // [{ id, name, emails: [] }]
    schedules: d.schedules || [],   // [{ id, report, group_id, freq, hour, minute, day, enabled, subject, retry }]
    // Adresse prévenue quand un envoi programmé a épuisé ses relances.
    alert_email: d.alert_email || '',
  };
  // Ce qui a réellement été saisi dans la page, sans les valeurs venues du
  // .env. Non énumérable : il ne part ni dans les réponses JSON ni, par
  // accident, dans le fichier.
  Object.defineProperty(m, 'smtpSaisi', { value: { ...saisi }, writable: true, enumerable: false });
  return m;
}
// On n'écrit que la saisie de la page (`smtpSaisi`), jamais `smtp` fusionné :
// l'ancien code réécrivait la configuration fusionnée, et le mot de passe
// du .env se retrouvait recopié en clair dans data/mailing.json à chaque
// envoi programmé.
function writeMailing(m) {
  const { smtp, ...reste } = m;
  const saisi = m.smtpSaisi || (readJSON(FILES.mailing, {}).smtp || {});
  writeJSON(FILES.mailing, { ...reste, smtp: saisi });
}

function readMailLog()  { return readJSON(FILES.mail_log, []); }
// Journal borné : un envoi quotidien pendant deux ans ferait grossir le
// fichier sans que personne ne relise les entrées anciennes.
function appendMailLog(entry) {
  const log = readMailLog();
  log.unshift({ id: uuidv4().slice(0, 8), at: new Date().toISOString(), ...entry });
  writeJSON(FILES.mail_log, log.slice(0, 500));
  // Trace aussi dans l'audit : c'est là qu'on cherche « ce qui s'est
  // passé », et un envoi qui n'y figurait pas passait pour inexistant.
  try {
    addAudit('MAIL', RAPPORT_LABELS[entry.kind] || entry.kind || 'rapport',
      ['auto', 'retry', 'alert'].includes(entry.origin) ? 'system' : 'admin',
      entry.ok ? 'mail-sent' : 'mail-failed',
      { group: entry.group || '', to: entry.to || [], file: entry.file || '',
        origin: entry.origin || 'auto', ...(entry.error ? { error: entry.error } : {}) });
  } catch {}
}

const RAPPORT_LABELS = {
  daily: 'Rapport quotidien', weekly: 'Rapport hebdomadaire',
  monthly: 'Rapport mensuel', absences: 'Rapport d\'absences',
  // Déjà produit par la page pour la revue hebdo : c'est le format
  // attendu par le management, qui lit un deck plutôt qu'un classeur.
  weekly_pptx: 'Revue hebdomadaire (PowerPoint)',
};

module.exports = {
  readMailing, writeMailing, readMailLog, appendMailLog, RAPPORT_LABELS,
};
