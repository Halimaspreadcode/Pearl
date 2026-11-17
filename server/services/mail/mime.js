const crypto      = require('crypto');

// Message MIME. `attachments` : [{ filename, content: Buffer, type }].
function buildMime({ from, to, subject, text, html, attachments }) {
  const bnd = 'emoc_' + crypto.randomBytes(12).toString('hex');
  // En-tête encodé : un sujet accentué envoyé brut arrive illisible chez
  // les clients qui supposent de l'ASCII.
  const encHdr = v => /^[\x20-\x7E]*$/.test(String(v))
    ? String(v)
    : '=?UTF-8?B?' + Buffer.from(String(v), 'utf8').toString('base64') + '?=';

  const L = [];
  L.push(`From: ${from}`);
  L.push(`To: ${to.join(', ')}`);
  L.push(`Subject: ${encHdr(subject || '')}`);
  L.push(`Date: ${new Date().toUTCString()}`);
  L.push(`Message-ID: <${crypto.randomBytes(16).toString('hex')}@emoc>`);
  L.push('MIME-Version: 1.0');
  L.push(`Content-Type: multipart/mixed; boundary="${bnd}"`);
  L.push('');

  L.push(`--${bnd}`);
  L.push(`Content-Type: ${html ? 'text/html' : 'text/plain'}; charset=UTF-8`);
  L.push('Content-Transfer-Encoding: base64');
  L.push('');
  L.push(Buffer.from(html || text || '', 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'));

  for (const a of (attachments || [])) {
    L.push(`--${bnd}`);
    L.push(`Content-Type: ${a.type || 'application/octet-stream'}; name="${a.filename}"`);
    L.push('Content-Transfer-Encoding: base64');
    L.push(`Content-Disposition: attachment; filename="${a.filename}"`);
    L.push('');
    L.push(Buffer.from(a.content).toString('base64').replace(/(.{76})/g, '$1\r\n'));
  }
  L.push(`--${bnd}--`);

  // Point-stuffing : une ligne réduite à « . » terminerait le DATA avant
  // la fin du message.
  return L.join('\r\n').split('\r\n').map(l => (l === '.' ? '..' : l)).join('\r\n');
}

module.exports = {
  buildMime,
};
