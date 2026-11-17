// Requêtes HTTPS sortantes (Supabase…) : passent par HTTPS_PROXY quand il
// est défini et que l'hôte n'est pas dans NO_PROXY. Le fetch intégré à
// Node ignore le proxy, d'où undici.
const undici = require('undici');

let _agent = null, _agentKey = '';
function proxyFor(host) {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || '';
  if (!proxy) return null;
  const no = String(process.env.NO_PROXY || process.env.no_proxy || '').split(',').map(s => s.trim()).filter(Boolean);
  const h = host.toLowerCase();
  if (no.some(n => n === h || (n.startsWith('*.') && h.endsWith(n.slice(1))) || (n.startsWith('.') && h.endsWith(n)))) return null;
  return proxy;
}
function dispatcher(host) {
  const proxy = proxyFor(host);
  if (!proxy) return undefined;
  if (_agentKey !== proxy) { _agent = new undici.ProxyAgent({ uri: proxy }); _agentKey = proxy; }
  return _agent;
}

// { status, headers, text, json } — ne lève que sur une erreur réseau.
async function request(url, { method = 'GET', headers = {}, body, timeoutMs = 20000 } = {}) {
  const u = new URL(url);
  const r = await undici.request(url, {
    method, headers, body,
    dispatcher: dispatcher(u.hostname),
    headersTimeout: timeoutMs, bodyTimeout: timeoutMs,
  });
  const text = await r.body.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = undefined; }
  return { status: r.statusCode, headers: r.headers, text, json };
}

module.exports = { request };
