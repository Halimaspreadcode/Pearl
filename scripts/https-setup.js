#!/usr/bin/env node
// Prépare le HTTPS de FOps en une commande :  npm run https:setup
//
// 1. Crée une petite autorité de certification locale (« EMOC CA ») et un
//    certificat serveur signé par elle, valable pour les adresses IP et le
//    nom de cette machine. Le tout dans data/tls/ (jamais dans git).
// 2. Écrit TLS_CERT, TLS_KEY et HTTPS_PORT dans .env.
// 3. Prépare aussi une demande de certificat (server.csr) : si l'équipe
//    informatique peut la signer avec l'autorité de l'entreprise, il suffit
//    de remplacer server.crt par le certificat rendu — plus rien à installer
//    sur les postes.
//
// Sur chaque poste Windows, une fois : ouvrir https://<adresse>:3443/emoc-ca.crt,
// puis l'installer dans « Autorités de certification racines de confiance »
// (ou : certutil -user -addstore Root emoc-ca.crt).
//
// Relancer le script régénère le certificat serveur (nouvelle IP, expiration)
// sans toucher à l'autorité : les postes n'ont rien à refaire.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'tls');
const ENV = path.join(ROOT, '.env');
const PORT = process.argv[2] || process.env.HTTPS_PORT || '3443';

function ssl(args) { execFileSync('openssl', args, { stdio: ['ignore', 'ignore', 'inherit'] }); }

try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); }
catch { console.error('✗ openssl est introuvable (sudo apt install openssl).'); process.exit(1); }

fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
const f = n => path.join(DIR, n);

const ips = ['127.0.0.1'];
for (const l of Object.values(os.networkInterfaces()))
  for (const a of l || []) if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
const noms = [...new Set(['localhost', os.hostname()])];
for (const extra of (process.env.TLS_EXTRA_NAMES || '').split(',').map(s => s.trim()).filter(Boolean))
  (/^\d+\.\d+\.\d+\.\d+$/.test(extra) ? ips : noms).push(extra);

if (!fs.existsSync(f('ca.key'))) {
  console.log('• Autorité locale « EMOC CA »…');
  ssl(['genrsa', '-out', f('ca.key'), '3072']);
  ssl(['req', '-x509', '-new', '-key', f('ca.key'), '-sha256', '-days', '3650',
    '-subj', '/CN=EMOC CA/O=EMOC', '-addext', 'basicConstraints=critical,CA:TRUE',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-out', f('ca.crt')]);
}

console.log(`• Certificat serveur pour : ${[...ips, ...noms].join(', ')}`);
const san = [...ips.map(i => `IP:${i}`), ...noms.map(n => `DNS:${n}`)].join(',');
fs.writeFileSync(f('server.ext'), [
  'basicConstraints=CA:FALSE',
  'keyUsage=critical,digitalSignature,keyEncipherment',
  'extendedKeyUsage=serverAuth',
  `subjectAltName=${san}`,
].join('\n') + '\n');
ssl(['genrsa', '-out', f('server.key'), '2048']);
ssl(['req', '-new', '-key', f('server.key'), '-subj', `/CN=${ips[1] || os.hostname()}/O=EMOC`,
  '-addext', `subjectAltName=${san}`, '-out', f('server.csr')]);
ssl(['x509', '-req', '-in', f('server.csr'), '-CA', f('ca.crt'), '-CAkey', f('ca.key'),
  '-CAcreateserial', '-days', '825', '-sha256', '-extfile', f('server.ext'), '-out', f('server.crt')]);
for (const n of ['ca.key', 'server.key']) fs.chmodSync(f(n), 0o600);

let env = fs.existsSync(ENV) ? fs.readFileSync(ENV, 'utf8') : '';
const poser = (k, v) => {
  const re = new RegExp(`^${k}=.*$`, 'm');
  env = re.test(env) ? env.replace(re, `${k}=${v}`) : `${env.replace(/\n?$/, '\n')}${k}=${v}\n`;
};
poser('TLS_CERT', 'data/tls/server.crt');
poser('TLS_KEY', 'data/tls/server.key');
poser('HTTPS_PORT', PORT);
fs.writeFileSync(ENV, env);

const ip = ips[1] || 'localhost';
console.log(`
✓ HTTPS prêt. Redémarre FOps (npm run service:restart), puis :

  Adresse de l'équipe :  https://${ip}:${PORT}
  (l'ancienne adresse http://${ip}:${process.env.PORT || 3000} y renvoie toute seule)

  Sur chaque poste Windows, une seule fois, pour éviter l'avertissement :
    1. ouvrir https://${ip}:${PORT}/emoc-ca.crt (accepter l'avertissement cette fois-ci)
    2. double-cliquer le fichier → Installer → « Autorités de certification racines de confiance »
       ou en PowerShell :  certutil -user -addstore Root $env:USERPROFILE\\Downloads\\emoc-ca.crt
    3. fermer et rouvrir le navigateur

  Mieux encore : faire signer data/tls/server.csr par l'informatique et remplacer
  data/tls/server.crt par le certificat rendu.
`);
