#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════
   JEU DE DONNÉES DE DÉMONSTRATION

   Remplit une semaine complète pour pouvoir regarder les écrans et le
   deck avec de la matière : tickets SN/CI, observations, weekly
   progress, notations et résultats de quiz.

   Écrit dans ./data-test — jamais dans ./data, qui porte les vraies
   données. Le dossier est créé à partir d'une copie de ./data s'il
   n'existe pas, pour hériter de la configuration (équipe, domaines, SLA).

   Les dates sont relatives à aujourd'hui : le jeu reste « cette
   semaine » quel que soit le jour où on le lance, sans quoi les écrans
   hebdomadaires s'ouvriraient sur une semaine vide.
   ══════════════════════════════════════════════════════════════ */
const fs   = require('fs');
const path = require('path');

const argDir = (() => {
  const i = process.argv.indexOf('--dir');
  return i > -1 ? process.argv[i + 1] : './data-test';
})();
const DIR = path.resolve(process.cwd(), argDir);
const SRC = path.resolve(process.cwd(), './data');

// Garde-fou : écrire dans ./data effacerait les vraies données. Liens
// symboliques résolus : un data/ lié au vrai dossier compte comme le vrai.
// Le data/ du dépôt principal (hors copies de travail git) est refusé même
// avec --force, sauf SEED_INTO_REAL_DATA=1 posé à la main.
const reel = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const principal = (() => {
  try {
    const out = require('child_process').execFileSync('git', ['worktree', 'list', '--porcelain'], { encoding: 'utf8' });
    return reel(path.join(out.split('\n')[0].replace(/^worktree /, ''), 'data'));
  } catch { return null; }
})();
const cible = reel(DIR);
if (principal && (cible === principal || cible.startsWith(principal + path.sep)) && process.env.SEED_INTO_REAL_DATA !== '1') {
  console.error(`Refus : ${argDir} est (ou pointe vers) les vraies données (${principal}).`);
  process.exit(1);
}
if ((DIR === SRC || cible === reel(SRC)) && !process.argv.includes('--force')) {
  console.error('Refus : ./data contient les vraies données.');
  console.error('Relancez avec --dir ./data-test, ou --force si c\'est voulu.');
  process.exit(1);
}

if (!fs.existsSync(DIR)) {
  fs.cpSync(SRC, DIR, { recursive: true });
  fs.rmSync(path.join(DIR, 'backups'), { recursive: true, force: true });
  console.log(`Dossier créé depuis ./data : ${argDir}`);
}

const read  = f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const write = (f, d) => fs.writeFileSync(path.join(DIR, f), JSON.stringify(d, null, 1));

const cfg  = read('config.json');
const FO   = cfg.fo_list || [];
const DOM  = cfg.domains || ['MMC', 'HCS', 'INFRA'];
const PRIO = cfg.ticket_priorities || ['P1', 'P2', 'P3', 'P4'];

// Générateur déterministe : deux exécutions donnent le même jeu, donc un
// écran se compare d'un lancement à l'autre. Un Math.random() rendrait
// tout bug « qui n'apparaît qu'avec certaines données » irreproductible.
let _s = 42;
const rnd  = () => (_s = (_s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = a => a[Math.floor(rnd() * a.length)];
const int  = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const now = new Date();
// Lundi de la semaine courante, à minuit.
const monday = new Date(now);
monday.setHours(0, 0, 0, 0);
monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
const wkKey = monday.toISOString().slice(0, 10);
const iso = (dayOffset, h = 9, m = 0) => {
  const d = new Date(monday);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const TITRES = [
  'Alarme BSC hors service sur le site de Thiès',
  'Perte de supervision sur la liaison MPLS Dakar–Saint-Louis',
  'Saturation disque sur le serveur de collecte HCS',
  'Dégradation du taux de succès SMS sur la plateforme MMC',
  'Coupure fibre entre Rufisque et Mbour',
  'Échec de réplication de la base de données de facturation',
  'Certificat expiré sur le portail de supervision',
  'Latence anormale sur les sondes LTS de la zone centre',
  'Basculement non déclenché sur le lien de secours INFRA',
  'Alerte sécurité — tentatives de connexion répétées',
  'Sauvegarde nocturne DM interrompue avant la fin',
  'Désynchronisation NTP sur plusieurs équipements',
];

const TYPES = ['Incident', 'Problem non Bug', 'Problem Bug'];

// ── Tickets ───────────────────────────────────────────────────
// Un mélange voulu : des résolus dans les temps, des ouverts encore
// dans leur délai, et quelques hors SLA — sans quoi les écrans qui
// existent précisément pour montrer les dépassements resteraient vides
// et ne prouveraient rien.
function ticket(tracker, i, jour) {
  const type  = pick(TYPES);
  const prio  = pick(PRIO);
  const occur = iso(jour, int(7, 19), int(0, 59));
  const resolu  = rnd() < 0.62;
  const horsSLA = rnd() < 0.17;           // un sur six en dépassement
  const dureeH  = horsSLA ? int(60, 200) : int(1, 20);
  const close = resolu
    ? new Date(new Date(occur).getTime() + dureeH * 3600000).toISOString()
    : null;
  return {
    id: `${tracker}-seed${String(i).padStart(3, '0')}`,
    created_at: occur,
    tt_number: `TT${tracker === 'sn' ? '1' : '2'}${String(40000 + i)}`,
    title: pick(TITRES),
    type, priority: prio,
    domain: pick(DOM),
    status: resolu ? pick(['Resolved', 'Closed']) : pick(['Open', 'In Progress', 'On Hold']),
    fo_owner: pick(FO),
    assigned_to: pick(FO),
    occur_time: occur,
    detection_time: occur,
    open_date: occur,
    close_date: close,
    tracker: tracker.toUpperCase(),
    description: 'Entrée de démonstration générée par scripts/seed-demo.js.',
    modified_at: null,
  };
}

const sn = [], ci = [];
// Semaine courante plus les deux précédentes : les comparaisons « vs
// semaine dernière » et l'historique ont ainsi de quoi s'appuyer.
for (let semaine = 0; semaine < 3; semaine++) {
  for (let j = 0; j < 7; j++) {
    const jour = j - semaine * 7;
    for (let k = 0, n = int(1, 4); k < n; k++) sn.push(ticket('sn', sn.length + 1, jour));
    if (rnd() < 0.5) ci.push(ticket('ci', ci.length + 1, jour));
  }
}
write('sn.json', sn);
write('ci.json', ci);

// ── Observations ──────────────────────────────────────────────
const OBS = [
  'Relève de shift : supervision MMC instable en fin de nuit, à surveiller.',
  'Le script de collecte HCS a dû être relancé manuellement mardi matin.',
  'Astreinte INFRA injoignable pendant 20 minutes, escalade faite au N2.',
  'Nouvelle procédure d\'escalade appliquée pour la première fois, sans incident.',
  'Deux alarmes en double sur la même liaison — à remonter à l\'équipe outillage.',
  'Coupure électrique brève sur le site secondaire, bascule automatique OK.',
];
write('observations.json', OBS.map((texte, i) => ({
  id: `obs-seed${i + 1}`,
  created_at: iso(i % 5, 8 + i, 15),
  date: iso(i % 5, 8 + i, 15),
  observation: texte,
  author: FO[i % FO.length],
  source: i % 4 === 0 ? 'CI' : 'SN',
  priority: pick(['P1', 'P2', 'P3']),
  // Deux déjà fermées : le registre doit montrer les deux états.
  status: i < 2 ? 'Closed' : 'Open',
  closed_at: i < 2 ? iso(i % 5, 17, 0) : null,
})));

// ── Weekly progress ───────────────────────────────────────────
// La matière de My Tasks et de la slide « Achievements » du deck.
const TACHES = [
  'Mise à jour du runbook de supervision',
  'Revue des seuils d\'alarme MMC',
  'Session de partage sur les alarmes HCS',
  'Nettoyage des tickets en doublon',
  'Rédaction du RCA de l\'incident fibre',
  'Contrôle des sauvegardes hebdomadaires',
  'Point de coordination avec l\'équipe BO',
  'Test de bascule du lien de secours',
  'Mise à jour de la matrice d\'escalade',
  'Préparation du deck hebdomadaire',
];
const wp = [];
let nwp = 0;
// Semaine courante et précédente : la précédente permet de voir les
// reports d'une semaine sur l'autre.
[0, -7].forEach(decalage => {
  const semaine = new Date(monday);
  semaine.setDate(semaine.getDate() + decalage);
  const cle = semaine.toISOString().slice(0, 10);
  // Deux agents ne saisissent rien : c'est un cas réel, et les écrans
  // doivent le signaler plutôt que de laisser croire à une équipe
  // complète.
  FO.slice(0, Math.max(1, FO.length - 2)).forEach(fo => {
    for (let k = 0, n = int(1, 3); k < n; k++) {
      wp.push({
        id: `wp-seed${++nwp}`,
        created_at: iso(decalage, 9, 0),
        task: pick(TACHES),
        status: pick(['Done', 'Done', 'In Progress', 'Planned']),
        week_start: cle,
        modified_by: fo,
        tracker: 'SN',
      });
    }
  });
});
write('weekly_progress.json', wp);

// ── Quiz ──────────────────────────────────────────────────────
write('quiz_results.json', FO.slice(0, 7).map((fo, i) => ({
  id: `qz-seed${i + 1}`,
  user: fo,
  quiz: 'Fondamentaux supervision',
  score: int(3, 5), total: 5,
  date: iso(-int(0, 10), 14, 0),
})));

// ── Notations ─────────────────────────────────────────────────
// Toute l'équipe notée sur le mois courant : sans ça, My Team et
// Performance FO n'affichent que des « non noté ».
const mois = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
cfg.fo_scorecards = cfg.fo_scorecards || {};
cfg.fo_scorecards[mois] = {};
FO.forEach((fo, i) => {
  // Un écart volontaire entre le haut et le bas de l'équipe, pour que le
  // classement et les vues « forts / faibles » aient quelque chose à dire.
  const base = 92 - i * 5;
  const borne = v => Math.max(20, Math.min(100, v));
  const carte = {
    sla:        borne(base + int(-6, 6)),
    process:    borne(base + int(-8, 8)),
    attendance: borne(base + int(-4, 8)),
    skills:     borne(base + int(-10, 5)),
    individual: borne(base + int(-7, 7)),
    tasks:      borne(base + int(-10, 6)),
  };
  // Deux agents partiellement notés : les écrans doivent distinguer
  // « mal noté » de « pas encore noté ».
  if (i >= FO.length - 2) { delete carte.skills; delete carte.individual; }
  if (i === 0) {
    carte._notes = [{
      id: 'n-seed1',
      text: 'Très bon mois sur la tenue des escalades. À confirmer sur le handover.',
      at: iso(-3, 10, 30),
    }];
  }
  cfg.fo_scorecards[mois][fo] = carte;
});
write('config.json', cfg);

console.log(`Jeu de démonstration écrit dans ${argDir} :`);
console.log(`  ${sn.length} tickets SN, ${ci.length} tickets CI`);
console.log(`  ${OBS.length} observations, ${wp.length} lignes weekly progress`);
console.log(`  ${FO.length} agents notés sur ${mois}`);
console.log(`  semaine courante : ${wkKey}`);
console.log('');
console.log(`Lancer :  PORT=3001 DATA_DIR=${argDir} node server/index.js`);
