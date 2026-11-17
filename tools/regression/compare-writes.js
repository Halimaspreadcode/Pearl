// Joue la même séquence d'écritures sur les deux serveurs, compare chaque
// réponse puis les fichiers de données obtenus. Les identifiants générés
// diffèrent d'un serveur à l'autre : chacun garde les siens dans `ctx`.
const fs = require('fs'), path = require('path');
const H = process.env.WORK || path.join(__dirname, '.work');
const SERVERS = [{ base: `http://localhost:${process.env.PO || 4001}`, dir: process.env.DA || path.join(H, 'data-a'), ctx: {} },
                 { base: `http://localhost:${process.env.PN || 4002}`, dir: process.env.DB || path.join(H, 'data-b'), ctx: {} }];
const VOL = /^(id|_id|at|ts|created_at|updated_at|modified_at|saved_at|closed_at|decided_at|submitted_at|last_seen|token|expires|expires_at|issued_at|time_left_ms|deadline|generated_at|done_at|checked_at|approved_at|last_run|sid|qid|session_id|duration_ms)$/i;
const norm = (v, k) => Array.isArray(v) ? v.map(x => norm(x)) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(x => [x, VOL.test(x) ? '<v>' : x === 'ticket_id' && /^[a-z0-9-]{10,20}$/.test(v[x]) ? '<rid>' : norm(v[x], x)]))
  : typeof v === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$|^[0-9a-f]{8}$/.test(v) ? '<uuid>'
  : typeof v === 'string' && /^(?=.*\d)(?=.*[a-z])[a-z0-9]{12,16}$|^[a-z]{2,6}-[0-9a-f]{8}$/.test(v) ? '<rid>'
  : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? v.slice(0, 13) : v;

const J = { 'content-type': 'application/json' };
const today = new Date().toISOString().slice(0, 10);
const cfg = JSON.parse(fs.readFileSync(path.join(H, 'seed', 'config.json')));
const FO = (cfg.fo_list || ['Agent A'])[0];
const S = [
  // Tickets
  { m: 'POST', u: '/api/sn', b: { title: 'Harness ticket', type: 'Incident', priority: 'P2', domain: 'INFRA', status: 'Open', fo_owner: FO, occur_time: today + 'T08:00:00Z', open_date: today + 'T08:05:00Z', tracker: 'SN' }, save: (r, c) => c.tk = r.id },
  { m: 'PUT', u: c => `/api/sn/${c.tk}`, b: { status: 'Resolved', close_date: today + 'T10:00:00Z', modified_by: FO } },
  { m: 'GET', u: c => `/api/sn/${c.tk}` },
  { m: 'DELETE', u: c => `/api/sn/${c.tk}` },
  { m: 'POST', u: '/api/ci', b: { title: 'CI harness', type: 'Incident', priority: 'P3', status: 'Open', tracker: 'CI', open_date: today + 'T09:00:00Z' } },
  // Observations
  { m: 'POST', u: '/api/observations', b: { observation: 'Supervision instable', priority: 'P2', source: 'SN', author: FO, status: 'Open' }, save: (r, c) => c.ob = r.id },
  { m: 'PUT', u: c => `/api/observations/${c.ob}`, b: { status: 'Closed' } },
  { m: 'DELETE', u: c => `/api/observations/${c.ob}` },
  // BO
  { m: 'POST', u: '/api/bo', b: { name: 'BO Harness', email: 'bo@x.test' }, save: (r, c) => c.bo = r.id },
  { m: 'PUT', u: c => `/api/bo/${c.bo}`, b: { name: 'BO Harness 2' } },
  { m: 'DELETE', u: c => `/api/bo/${c.bo}` },
  // Config & KPI & layout & drafts
  { m: 'PUT', u: '/api/config', b: c => ({ leave_entitlement_days: 28 }) },
  { m: 'PUT', u: '/api/report-layout', b: { daily: { hidden: ['risks'] } } },
  { m: 'PUT', u: `/api/report-draft/daily/${today}`, b: { author: 'Harness', highlights: [{ source: 'SN', observation: 'x', priority: 'P2', status: 'Open' }], risks: [], actions: [] } },
  { m: 'GET', u: `/api/report-draft/daily/${today}` },
  // Mailing
  { m: 'PUT', u: '/api/mailing', b: { groups: [{ id: 'g1', name: 'Test', emails: ['t@local.test', 'bad'] }], schedules: [{ id: 's1', report: 'weekly_pptx', group_id: 'g1', freq: 'weekly', day: 1, hour: 7, minute: 30, enabled: false, subject: 'W {week}' }] } },
  { m: 'GET', u: '/api/mailing' },
  { m: 'POST', u: '/api/mailing/send', b: { schedule_id: 'nope' } },
  // Shifts, tasks, weekly progress, announcements
  { m: 'POST', u: '/api/shifts-plan', b: { date: today, fo_name: FO, shift_name: 'Matin', tracker: 'SN' }, save: (r, c) => c.sh = r.id || (r[0] && r[0].id) },
  { m: 'DELETE', u: c => `/api/shifts-plan/${c.sh}` },
  { m: 'POST', u: '/api/fo-tasks', b: { title: 'Task H', fo: FO, due: today, assigned_to: FO }, save: (r, c) => c.ta = r.id },
  { m: 'PUT', u: c => `/api/fo-tasks/${c.ta}`, b: { status: 'Done' } },
  { m: 'DELETE', u: c => `/api/fo-tasks/${c.ta}` },
  { m: 'POST', u: '/api/weekly-progress', b: { task: 'WP H', status: 'Done', fo_name: FO, week_start: today, tracker: 'SN' }, save: (r, c) => c.wp = r.id },
  { m: 'DELETE', u: c => `/api/weekly-progress/${c.wp}` },
  { m: 'POST', u: '/api/announcements', b: { title: 'Annonce', body: 'Hello', message: 'Hello' }, save: (r, c) => c.an = r.id },
  { m: 'DELETE', u: c => `/api/announcements/${c.an}` },
  // Holidays & absences
  { m: 'POST', u: '/api/holidays', b: { date: '2026-12-25', name: 'Noël', country: 'SN' }, save: (r, c) => c.ho = r.id },
  { m: 'DELETE', u: c => `/api/holidays/${c.ho}` },
  { m: 'POST', u: '/api/absences', b: { fo_name: FO, type: 'Maladie', date_from: '2026-10-05', date_to: '2026-10-06', status: 'Validée', notice: 'Prévenu le jour même' }, save: (r, c) => c.ab = r.id },
  { m: 'PUT', u: c => `/api/absences/${c.ab}`, b: { status: 'Annulée' } },
  { m: 'DELETE', u: c => `/api/absences/${c.ab}` },
  // Trainings, quizzes
  { m: 'POST', u: '/api/trainings', b: { title: 'Training H', date: '2026-10-10', trainer: FO }, save: (r, c) => c.tr = r.id },
  { m: 'DELETE', u: c => `/api/trainings/${c.tr}` },
  { m: 'POST', u: '/api/quizzes', b: { title: 'Quiz H', questions: [] }, save: (r, c) => c.qz = r.id },
  { m: 'POST', u: c => `/api/quizzes/${c.qz}/questions`, b: { text: 'Q1?', options: ['a', 'b'], answer: 0 } },
  { m: 'DELETE', u: c => `/api/quizzes/${c.qz}` },
  // Objectives (admin side) & sessions
  { m: 'POST', u: '/api/objective-sessions', b: { name: 'Q4 H', start: '2026-10-01', end: '2026-12-31' }, save: (r, c) => c.os = r.id || (r.session && r.session.id) },
  { m: 'POST', u: `/api/objectives/${encodeURIComponent(FO)}`, b: { title: 'Reduce MTTD to 5 min', due: '2026-12-15', why: 'Faster detection', kpis: [{ label: 'MTTD', target: '5 min' }] }, save: (r, c) => c.ob2 = r.id || (r.objective && r.objective.id) },
  { m: 'PUT', u: c => `/api/objectives/${encodeURIComponent(FO)}/${c.ob2}/progress`, b: { progress: 'in_progress', progress_pct: 40 } },
  { m: 'POST', u: '/api/my-objectives/smart-check', b: { title: 'Improve things', due: '' } },
  // Rota, prefs, shift requests, presence
  { m: 'POST', u: '/api/rota/generate', b: { from: '2026-11-02', to: '2026-11-08' } },
  { m: 'PUT', u: '/api/user-prefs/hw123', b: { theme: 'dark' } },
  { m: 'POST', u: '/api/shift-requests', b: { fo_name: FO, date: '2026-10-12', reason: 'swap' }, save: (r, c) => c.sr = r.id },
  { m: 'DELETE', u: c => `/api/shift-requests/${c.sr}` },
  { m: 'POST', u: '/api/presence/ping', b: { name: FO, huawei_id: 'hw123', page: 'dashboard' } },
  { m: 'POST', u: '/api/reports/weekly.pptx', b: { form: {} }, bin: true },
  // Erreurs
  { m: 'PUT', u: '/api/sn/does-not-exist', b: { status: 'Open' } },
  { m: 'POST', u: '/api/config/auth', b: { password: 'wrong' }, anon: true },
];

async function call(s, srv, tok) {
  const c = srv.ctx;
  const u = typeof s.u === 'function' ? s.u(c) : s.u;
  const b = typeof s.b === 'function' ? s.b(c) : s.b;
  const h = { ...(s.anon ? {} : { 'X-Admin-Token': tok, 'X-Absence-Token': tok }), ...(b ? J : {}) };
  const r = await fetch(srv.base + u, { method: s.m, headers: h, body: b ? JSON.stringify(b) : undefined });
  const txt = s.bin ? `<${(await r.arrayBuffer()).byteLength > 1000 ? 'binary' : 'small'}>` : await r.text();
  let body; try { body = JSON.parse(txt); } catch { body = txt; }
  if (s.save && r.ok && body && typeof body === 'object') s.save(body, c);
  return { status: r.status, body: norm(body) };
}

(async () => {
  const toks = [];
  for (const srv of SERVERS) {
    const r = await fetch(srv.base + '/api/config/auth', { method: 'POST', headers: J, body: JSON.stringify({ password: 'x' }) });
    toks.push((await r.json()).token);
  }
  let ko = 0;
  for (const s of S) {
    const [a, b] = [await call(s, SERVERS[0], toks[0]), await call(s, SERVERS[1], toks[1])];
    const sa = JSON.stringify(a), sb = JSON.stringify(b);
    const label = `${s.m} ${typeof s.u === 'function' ? s.u({}) : s.u}`;
    if (sa !== sb) { ko++; console.log(`✗ ${label}\n   old ${sa.slice(0, 300)}\n   new ${sb.slice(0, 300)}`); }
    else if (process.argv.includes('-v')) console.log(`✓ ${label} → ${a.status}`);
  }
  // Fichiers de données après la séquence.
  for (const f of fs.readdirSync(SERVERS[0].dir).filter(f => f.endsWith('.json'))) {
    const rd = d => { try { return JSON.stringify(norm(JSON.parse(fs.readFileSync(path.join(d, f))))); } catch { return 'missing'; } };
    const [a, b] = [rd(SERVERS[0].dir), rd(SERVERS[1].dir)];
    if (a !== b) { ko++; let i = 0; while (a[i] === b[i]) i++; console.log(`✗ data/${f} @${i}\n   old ${a.slice(Math.max(0, i - 100), i + 150)}\n   new ${b.slice(Math.max(0, i - 100), i + 150)}`); }
  }
  console.log(`\nÉcritures : ${S.length} étapes, ${ko} différence(s)`);
  process.exitCode = ko ? 1 : 0;
})().catch(e => { console.error(e); process.exit(2); });
