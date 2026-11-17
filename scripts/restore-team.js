#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════
   RESTAURER LES DONNÉES D'ÉQUIPE DEPUIS data-old

   npm run restore:team                 montre ce qui serait repris (rien n'est écrit)
   npm run restore:team -- --apply      reprend, après sauvegarde de data/config.json
   npm run restore:team -- <dossier>    source autre que ./data-old

   Pourquoi : jusqu'au 29/09, une migration faite sur un data/ non vidé
   gardait certaines clés de la config en place au lieu de celles de
   l'import (voir KEEP_CURRENT_KEYS dans migrate-data.js). Les objectifs
   (KPI, jalons), entretiens One-to-One, notes et codes de l'ancienne
   version restaient dans data-old et n'arrivaient pas dans data/.

   Ne touche qu'à ces clés de config.json et aux fichiers des quiz :
   tickets, observations, planning, absences… saisis depuis la migration
   ne bougent pas. Pour chaque clé, la valeur de data-old remplace celle
   de data/ quand elle a du contenu ; une clé vide dans data-old laisse
   data/ tel quel. Les quiz, eux, sont FUSIONNÉS : une tentative faite
   depuis la migration ne doit pas disparaître.
   ══════════════════════════════════════════════════════════════ */
const fs   = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const SRC = path.resolve(process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(ROOT, 'data-old'));
const DATA = path.join(ROOT, 'data');

// Les données de l'équipe, saisies dans l'app — pas le paramétrage.
const CLES = [
  'fo_objectives', 'objective_sessions', 'fo_o2o', 'fo_scorecards', 'fo_goals',
  'fo_performance', 'fo_engagement', 'fo_scores', 'engagement_scores',
  'fo_ids', 'fo_access_codes', 'o2o_template', 'absence_allowed_ids',
];

const plein = v => v != null && (Array.isArray(v) ? v.length > 0
  : typeof v === 'object' ? Object.keys(v).length > 0 : v !== '');
// Taille lisible : pour un objet par agent, le nombre d'éléments cumulés
// (objectifs, entretiens…) dit plus que le nombre d'agents.
function mesure(k, v) {
  if (v == null) return '—';
  if (Array.isArray(v)) return `${v.length}`;
  if (typeof v !== 'object') return '1';
  const agents = Object.keys(v).length;
  let n = 0;
  for (const x of Object.values(v)) {
    if (Array.isArray(x)) n += x.length;
    else if (x && typeof x === 'object') n += (x.objectives || x.meetings || []).length || 0;
  }
  if (k === 'fo_o2o') {
    let o = 0, m = 0;
    for (const x of Object.values(v)) { o += ((x || {}).objectives || []).length; m += ((x || {}).meetings || []).length; }
    return `${agents} agents · ${o} objectifs · ${m} entretiens`;
  }
  return n ? `${agents} agents · ${n} éléments` : `${agents} clés`;
}

// Quiz : fichiers à part, fusionnés. Résultats et quiz maison : union par
// id. Progression : une entrée par personne ; si les deux côtés en ont
// une, on garde celle qui a le plus d'XP et on réunit les cours validés.
const QUIZ = [
  { f: 'quiz_results.json',  cle: 'id' },
  { f: 'quizzes.json',       cle: 'id' },
  { f: 'quiz_progress.json', cle: 'user', fusion: (a, c) => {
      const g = (Number(a.xp_total) || 0) >= (Number(c.xp_total) || 0) ? a : c;
      return { ...g,
        passed: [...new Set([...(a.passed || []), ...(c.passed || [])])],
        streak_best: Math.max(Number(a.streak_best) || 0, Number(c.streak_best) || 0) };
    } },
];
function fusionner(ancienL, actuelL, cle, fusion) {
  const out = new Map();
  for (const x of actuelL || []) if (x && x[cle] != null) out.set(String(x[cle]), x);
  let ajout = 0, fus = 0;
  for (const x of ancienL || []) {
    if (!x || x[cle] == null) continue;
    const k = String(x[cle]);
    if (!out.has(k)) { out.set(k, x); ajout++; }
    else if (fusion) { const m = fusion(x, out.get(k)); if (JSON.stringify(m) !== JSON.stringify(out.get(k))) { out.set(k, m); fus++; } }
  }
  return { liste: [...out.values()], ajout, fus };
}
function lireOpt(f, defaut) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return defaut; }
}

function lire(f) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e) { console.error(`✗ Lecture impossible : ${f} (${e.message})`); process.exit(1); }
}

function serveurActif(port) {
  return new Promise(r => {
    const q = http.get({ host: '127.0.0.1', port, path: '/api/status', timeout: 1500 }, s => { s.resume(); r(true); });
    q.on('error', () => r(false)); q.on('timeout', () => { q.destroy(); r(false); });
  });
}

(async () => {
  const ancien = lire(path.join(SRC, 'config.json'));
  const actuel = lire(path.join(DATA, 'config.json'));

  console.log(`\nSource : ${SRC}\nCible  : ${DATA}\n`);
  console.log('Clé'.padEnd(22) + 'data-old'.padEnd(42) + 'data/ actuel'.padEnd(42) + 'Action');
  const repris = [];
  for (const k of CLES) {
    const a = ancien[k], c = actuel[k];
    const action = plein(a) ? (JSON.stringify(a) === JSON.stringify(c) ? 'identique' : 'REPRIS de data-old') : 'gardé (vide dans data-old)';
    if (action.startsWith('REPRIS')) repris.push(k);
    console.log(k.padEnd(22) + mesure(k, a).padEnd(42) + mesure(k, c).padEnd(42) + action);
  }
  // Objectifs agent par agent, et par état : c'est la question qu'on se
  // pose (« où sont les objectifs des gars ? »). L'onglet Suivi ne montre
  // que les approuvés ; soumis = file « à approuver » ; brouillon = saisi
  // par l'agent mais jamais soumis.
  const parEtat = v => {
    const out = {};
    for (const [fo, list] of Object.entries(v || {})) {
      const c = {};
      for (const o of Array.isArray(list) ? list : []) { const st = (o && o.state) || 'sans état'; c[st] = (c[st] || 0) + 1; }
      out[fo] = c;
    }
    return out;
  };
  const fmt = c => c ? Object.entries(c).map(([st, n]) => `${n} ${st}`).join(', ') || '0' : '0';
  const oA = parEtat(ancien.fo_objectives), oC = parEtat(actuel.fo_objectives);
  const agents = [...new Set([...Object.keys(oA), ...Object.keys(oC)])].sort();
  console.log('\nObjectifs par agent (approved = visibles dans Suivi · submitted = à approuver · draft = jamais soumis)');
  if (!agents.length) console.log('  aucun objectif ni dans data-old ni dans data/');
  for (const fo of agents) console.log('  ' + fo.padEnd(26) + ('data-old : ' + fmt(oA[fo])).padEnd(46) + 'data/ : ' + fmt(oC[fo]));

  // Clés de l'ancienne config que la version actuelle n'a pas : si les
  // objectifs portaient un autre nom, c'est ici qu'ils apparaissent.
  const inconnues = Object.keys(ancien).filter(k => !(k in actuel) && plein(ancien[k]));
  if (inconnues.length) console.log(`\nClés de data-old absentes de data/ (à signaler si elles portent des objectifs) :\n  ${inconnues.join(', ')}`);

  // Quiz, personne par personne.
  const quizPlan = QUIZ.map(q => {
    const a = lireOpt(path.join(SRC, q.f), []), c = lireOpt(path.join(DATA, q.f), []);
    return { ...q, a, c, ...fusionner(a, c, q.cle, q.fusion) };
  });
  const prog = quizPlan.find(q => q.f === 'quiz_progress.json');
  console.log('\nProgression des quiz (XP · cours validés)');
  const users = [...new Set([...prog.a.map(x => x.user), ...prog.c.map(x => x.user)])].filter(Boolean).sort();
  if (!users.length) console.log('  aucune progression ni dans data-old ni dans data/');
  const pq = (l, u) => { const e = l.find(x => x.user === u); return e ? `${e.xp_total || 0} XP · ${(e.passed || []).length} validés` : '—'; };
  for (const u of users) console.log('  ' + String(u).padEnd(26) + ('data-old : ' + pq(prog.a, u)).padEnd(46) + 'data/ : ' + pq(prog.c, u));
  for (const q of quizPlan) console.log(`  ${q.f.padEnd(20)} data-old ${String(q.a.length).padStart(4)} · data/ ${String(q.c.length).padStart(4)} → ${q.ajout} ajouté(s)${q.fus ? `, ${q.fus} fusionné(s)` : ''}`);
  const quizAEcrire = quizPlan.filter(q => q.ajout || q.fus);

  if (!repris.length && !quizAEcrire.length) { console.log('\nRien à reprendre.\n'); return; }
  if (!APPLY) {
    console.log(`\n${repris.length} clé(s) de config et ${quizAEcrire.length} fichier(s) de quiz seraient repris. Rien n'a été écrit.`);
    console.log('Pour appliquer : arrêtez le serveur (npm run service:stop), puis npm run restore:team -- --apply\n');
    return;
  }
  const port = Number((fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/^\s*PORT\s*=\s*(\d+)/m) || [])[1]) || 3000;
  if (await serveurActif(port)) {
    console.error(`\n✗ Le serveur tourne sur le port ${port} : il réécrirait config.json par-dessus. Arrêtez-le d'abord (npm run service:stop).\n`);
    process.exit(1);
  }
  const dir = path.join(DATA, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const horo = new Date().toISOString().replace(/[:.]/g, '-');
  const sauvegarde = path.join(dir, `config-avant-restauration-${horo}.json`);
  fs.copyFileSync(path.join(DATA, 'config.json'), sauvegarde);
  for (const q of quizAEcrire) {
    const src = path.join(DATA, q.f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, `${q.f.replace('.json', '')}-avant-restauration-${horo}.json`));
    const tmpq = path.join(DATA, `.${q.f}.restore.tmp`);
    fs.writeFileSync(tmpq, JSON.stringify(q.liste, null, 2));
    fs.renameSync(tmpq, src);
  }
  const out = { ...actuel };
  for (const k of repris) out[k] = ancien[k];
  const tmp = path.join(DATA, '.config.json.restore.tmp');
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
  fs.renameSync(tmp, path.join(DATA, 'config.json'));
  // Relecture : on vérifie ce qui est réellement sur le disque.
  const relu = lire(path.join(DATA, 'config.json'));
  const okQ = quizAEcrire.every(q => lireOpt(path.join(DATA, q.f), []).length === q.liste.length);
  const ok = okQ && repris.every(k => JSON.stringify(relu[k]) === JSON.stringify(ancien[k]));
  console.log(`\n${ok ? '✓' : '✗'} ${repris.length} clé(s) reprises${repris.length ? ' : ' + repris.join(', ') : ''}`);
  if (quizAEcrire.length) console.log(`  Quiz : ${quizAEcrire.map(q => `${q.f} (+${q.ajout}${q.fus ? `, ${q.fus} fusionnés` : ''})`).join(', ')}`);
  console.log(`  Sauvegardes de l'état précédent : ${dir} (…-avant-restauration-${horo}.json)`);
  console.log('  Relancez le serveur : npm run service:start\n');
  if (!ok) process.exit(1);
})();
