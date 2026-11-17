const os          = require('os');
const net         = require('net');
const tls         = require('tls');
const { buildMime } = require('./mime');

// ══════════════════════════════════════════════════════════════
// DIFFUSION PAR MAIL
//
// Client SMTP écrit sur `net`/`tls` plutôt que sur nodemailer : le
// projet se déploie en copiant node_modules/ sur la VM, et chaque
// dépendance ajoutée est une pièce de plus à transporter. C'est le même
// raisonnement que pour la compression (zlib plutôt que `compression`).
//
// Le protocole utilisé ici est volontairement minimal — EHLO, STARTTLS,
// AUTH LOGIN, MAIL FROM/RCPT TO/DATA — ce que tout relais accepte.
// ══════════════════════════════════════════════════════════════

// Dialogue SMTP. Chaque commande attend son code de réponse : sans cela
// on enverrait la suivante avant que le serveur soit prêt, et l'échec
// serait attribué à la mauvaise étape.
function smtpSend(cfg, { to, subject, text, html, attachments }) {
  return new Promise((resolve, reject) => {
    const host = String(cfg.host || '').trim();
    const port = Number(cfg.port) || 587;
    if (!host) return reject(new Error('Serveur SMTP non configuré'));

    const from = String(cfg.from || cfg.user || '').trim();
    if (!from) return reject(new Error('Adresse expéditeur non configurée'));

    const rcpts = (Array.isArray(to) ? to : [to]).map(String).filter(Boolean);
    if (!rcpts.length) return reject(new Error('Aucun destinataire'));

    // `secure` = TLS d'emblée (port 465). Sinon on ouvre en clair et on
    // bascule par STARTTLS si le serveur l'annonce (ports 25 et 587).
    const secure = !!cfg.secure || port === 465;
    // Par défaut on vérifie le certificat. Un relais interne à certificat
    // auto-signé peut exiger de le désactiver : c'est un choix explicite
    // de l'exploitant, jamais la valeur par défaut.
    const rejectUnauthorized = cfg.reject_unauthorized !== false;
    const b64 = v => Buffer.from(String(v), 'utf8').toString('base64');
    const salut = () => `EHLO ${os.hostname() || 'pearl'}`;

    let sock = secure
      ? tls.connect({ host, port, servername: host, rejectUnauthorized })
      : net.createConnection({ host, port });

    let buf = '', done = false;
    // `attendu` décrit ce qu'on attend maintenant : le code de réponse
    // acceptable et ce qu'il faut faire en le recevant. Un seul état, au
    // lieu d'une liste d'étapes et d'un index — c'est cette double
    // indexation qui rendait la bascule STARTTLS impossible à suivre.
    let attendu = null;
    let tlsFait = secure;

    const fin = (err, info) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sock.end(); } catch {}
      err ? reject(err) : resolve(info);
    };
    // Un relais injoignable laisserait la promesse pendante et bloquerait
    // l'ordonnanceur : on borne l'échange.
    const timer = setTimeout(() => fin(new Error('Délai dépassé (SMTP)')), 30000);
    const write = cmd => { try { sock.write(cmd + '\r\n'); } catch (e) { fin(e); } };

    // Enchaîne : envoie `cmd` et note le code attendu et la suite.
    const puis = (cmd, code, suite) => { attendu = { code, suite }; if (cmd !== null) write(cmd); };

    // ── Déroulé, écrit dans l'ordre du dialogue ──────────────────
    const apresAuth = () => {
      const files = [
        ...rcpts.map(r => [`RCPT TO:<${r}>`, 250]),
        ['DATA', 354],
        [buildMime({ from, to: rcpts, subject, text, html, attachments }) + '\r\n.', 250],
        ['QUIT', 221],
      ];
      let k = 0;
      const suivant = () => {
        if (k >= files.length) return fin(null, { accepted: rcpts.length });
        const [cmd, code] = files[k++];
        puis(cmd, code, k === files.length ? () => fin(null, { accepted: rcpts.length }) : suivant);
      };
      puis(`MAIL FROM:<${from}>`, 250, suivant);
    };

    const auth = () => {
      if (!cfg.user) return apresAuth();
      puis('AUTH LOGIN', 334, () =>
        puis(b64(cfg.user), 334, () =>
          puis(b64(cfg.pass || ''), 235, apresAuth)));
    };

    // Réponse au EHLO : c'est elle qui porte les capacités du serveur.
    const surEhlo = banniere => {
      // STARTTLS n'est demandé que s'il est annoncé. L'exiger d'office
      // fait échouer tout relais qui n'écoute qu'en clair.
      if (!tlsFait && /STARTTLS/i.test(banniere)) {
        return puis('STARTTLS', 220, () => {
          // La socket en clair devient chiffrée, puis la RFC 3207 impose
          // de rejouer EHLO sur le canal sécurisé.
          const brut = sock;
          brut.removeAllListeners('data');
          brut.removeAllListeners('error');
          brut.removeAllListeners('close');
          sock = tls.connect({ socket: brut, servername: host, rejectUnauthorized }, () => {
            tlsFait = true;
            puis(salut(), 250, surEhlo);
          });
          brancher();
        });
      }
      auth();
    };

    const onData = chunk => {
      buf += chunk.toString('utf8');
      // Une réponse peut tenir sur plusieurs lignes : « 250-… » puis
      // « 250 … » pour la dernière. On n'agit que sur la dernière.
      const derniere = buf.split(/\r?\n/).filter(l => /^\d{3}[ ]/.test(l)).pop();
      if (!derniere) return;
      const banniere = buf;
      buf = '';
      if (!attendu) return;

      const code = Number(derniere.slice(0, 3));
      const { code: attendu_, suite } = attendu;
      if (code !== attendu_) {
        return fin(new Error(`SMTP ${code} : ${derniere.slice(4).trim() || 'réponse inattendue'}`));
      }
      attendu = null;
      if (suite) suite(banniere);
    };

    const brancher = () => {
      sock.on('data', onData);
      sock.on('error', e => fin(e));
      sock.on('close', () => { if (!done) fin(new Error('Connexion SMTP fermée')); });
    };
    brancher();

    // Premier échange : la bannière de connexion, puis EHLO.
    attendu = { code: 220, suite: () => puis(salut(), 250, surEhlo) };
  });
}

module.exports = {
  smtpSend,
};
