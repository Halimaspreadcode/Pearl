// Compare les réponses GET (et une séquence d'écritures) entre l'ancien
// serveur (4001) et le nouveau (4002). Usage : node compare-api.js
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const JSZip = require('jszip');
const OLD = `http://localhost:${process.env.PO || 4001}`, NEW = `http://localhost:${process.env.PN || 4002}`;
const H = process.env.WORK || path.join(__dirname, '.work');

// Champs qui dépendent de l'instant de la requête ou d'un identifiant aléatoire.
const VOLATILE = /^(time_left_ms|now|generated_at|generatedAt|server_time|uptime|at|ts|id|created_at|updated_at|modified_at|saved_at|last_seen|expires|expires_at|token|issued_at|deadline|closed_at|etag|duration_ms)$/i;
function norm(v, key) {
  if (Array.isArray(v)) return v.map(x => norm(x));
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = VOLATILE.test(k) ? '<v>' : norm(v[k], k);
    return o;
  }
  // Durées en ms calculées depuis maintenant : dérivent de quelques ms entre deux appels.
  if (typeof v === 'number' && key && /_ms$|remaining|elapsed|age/i.test(key)) return Math.round(v / 60000);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v) && key && /time|date/i.test(key) === false) return v.slice(0, 16);
  return v;
}

async function login(base) {
  const r = await fetch(base + '/api/config/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'x' }) });
  const d = await r.json();
  return d.token;
}

async function zipText(buf) {
  const z = await JSZip.loadAsync(buf);
  const names = Object.keys(z.files).filter(n => /\.(xml|rels)$/.test(n) && !/docProps\/core/.test(n)).sort();
  const out = [];
  for (const n of names) out.push(n + '\n' + (await z.file(n).async('string'))
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<date>'));
  return out.join('\n');
}
function pdfText(buf) {
  // Décompresse les flux et retire la date de création.
  const s = buf.toString('latin1');
  const parts = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g; let m;
  while ((m = re.exec(s))) { try { parts.push(zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1')); } catch { parts.push(m[1]); } }
  return parts.join('\n').replace(/\(D:\d+[^)]*\)/g, '');
}

async function get(base, url, tok) {
  const r = await fetch(base + url, { headers: tok ? { 'X-Admin-Token': tok, 'X-Absence-Token': tok } : {} });
  const ct = r.headers.get('content-type') || '';
  const buf = Buffer.from(await r.arrayBuffer());
  let body;
  if (/json/.test(ct)) { try { body = norm(JSON.parse(buf.toString())); } catch { body = buf.toString(); } }
  else if (/presentation|spreadsheet|zip/.test(ct)) body = await zipText(buf);
  else if (/pdf/.test(ct)) body = pdfText(buf);
  else body = buf.toString().replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<date>');
  return { status: r.status, ct: ct.split(';')[0], body };
}

function firstDiff(a, b) {
  const sa = typeof a === 'string' ? a : JSON.stringify(a, null, 1);
  const sb = typeof b === 'string' ? b : JSON.stringify(b, null, 1);
  if (sa === sb) return null;
  let i = 0; while (i < sa.length && sa[i] === sb[i]) i++;
  return `@${i}: old «${sa.slice(Math.max(0, i - 80), i + 120)}»\n        new «${sb.slice(Math.max(0, i - 80), i + 120)}»`;
}

(async () => {
  const [tokA, tokB] = [await login(OLD), await login(NEW)];
  const seed = p => JSON.parse(fs.readFileSync(path.join(H, 'seed', p)));
  const cfg = seed('config.json');
  const sess = (cfg.objective_sessions || [])[0];
  const sn = seed('sn.json');
  const fo = (cfg.fo_list || [])[0] || 'X';
  const GETS = [
    '/api/status', '/api/bo', '/api/config', '/api/config/session', '/api/absences/session', '/api/kpi-config',
    '/api/observations', '/api/report-layout', '/api/report-draft/daily/2026-09-26', '/api/mailing', '/api/mailing/log',
    '/api/audit', `/api/audit/sn/${sn[0] && sn[0].id}`, '/api/dashboard', '/api/export',
    '/api/reports/daily', '/api/reports/weekly', '/api/reports/monthly', '/api/reports/daily?date=2026-09-22',
    '/api/reports/weekly?date=2026-09-14', '/api/shifts-plan', '/api/fo-tasks', '/api/weekly-progress', '/api/announcements',
    '/api/my-perf', `/api/fo-perf/${encodeURIComponent(fo)}`, '/api/my-objectives', '/api/objectives', '/api/objective-sessions',
    '/api/objective-sessions/import-o2o/preview', '/api/fo-access', '/api/trainings', '/api/quizzes', '/api/quiz/results',
    '/api/quiz/progress', '/api/rota/config', '/api/user-prefs/hw123', '/api/holidays', '/api/absences', '/api/absences/stats',
    '/api/absences/scores', '/api/absences/summary', '/api/absences/summary?year=2026&country=SN', '/api/absences/report.pdf?year=2026',
    '/api/shift-requests', '/api/presence', '/api/presence/admin', '/api/sn', '/api/ci', `/api/sn/${sn[0] && sn[0].id}`,
    '/api/sn/nope', '/api/nope', '/', '/admin', '/admin-login.html', '/css/app.css', '/js/app.js',
    ...(sess ? [`/api/objective-sessions/${sess.id}/report.xlsx`, `/api/objective-sessions/${sess.id}/report.pptx`] : []),
  ];
  let ok = 0, ko = 0;
  const only = process.argv[2];
  for (const u of GETS) {
    if (only && !u.includes(only)) continue;
    // Les assets statiques changent par construction pendant la refonte côté client.
    if (/\.(css|js)$/.test(u) || u === '/' ) continue;
    for (const auth of [true, false]) {
      const [a, b] = await Promise.all([get(OLD, u, auth && tokA), get(NEW, u, auth && tokB)]);
      const d = a.status !== b.status ? `status ${a.status} vs ${b.status}` : a.ct !== b.ct ? `ct ${a.ct} vs ${b.ct}` : firstDiff(a.body, b.body);
      if (d) { ko++; console.log(`✗ GET ${u} [${auth ? 'admin' : 'anon'}]\n   ${d}`); } else ok++;
    }
  }
  console.log(`\nGET: ${ok} identiques, ${ko} différences`);
  process.exitCode = ko ? 1 : 0;
})().catch(e => { console.error(e); process.exit(2); });
