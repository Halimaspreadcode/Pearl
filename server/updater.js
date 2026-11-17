// ── MISE À JOUR AUTOMATIQUE (utilisée par le watchdog) ────────
// Vérifie si origin/main a avancé, et passe le code à cette version en
// gardant les données de la machine.
//
// data/ et .env sont versionnés : un simple `git pull` échouerait dès que
// le serveur a écrit dans data/ (« vos modifications seraient écrasées »),
// ou pire, remplacerait les données de production par celles du dépôt.
// D'où la séquence, serveur ARRÊTÉ :
//   1. copie de data/ (hors backups/) et de .env à côté ;
//   2. `git reset --hard <version>` — le code passe à la nouvelle version ;
//   3. les copies sont remises par-dessus : les données restent celles de
//      la machine, quoi que contienne le commit ;
//   4. `npm install` si package.json ou package-lock.json ont changé.
// Les migrations de données, elles, se font au démarrage du serveur
// (core/store.js) : rien à lancer ici.
//
// Refus (on ne met pas à jour, on le dit) :
//   · du code modifié à la main sur la machine — reset --hard l'effacerait ;
//   · un historique local qui n'est pas un ancêtre de origin/main (commits
//     faits sur la machine) — ce ne serait plus une simple avance.
const { spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const PROTEGES = ['data', '.env'];

function git(root, args) {
  const r = spawnSync('git', args, {
    cwd: root, encoding: 'utf8',
    // Jamais de demande de mot de passe : sans identifiants enregistrés, le
    // fetch échoue et le watchdog le signale au lieu de rester bloqué.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return { ok: r.status === 0, out: (r.stdout || '').trimEnd(), err: (r.stderr || r.error?.message || '').trim() };
}

// Réécrit par `npm install` sur la machine sans que personne y touche : ce
// n'est pas une retouche du code, la mise à jour peut l'écraser.
const REGENERES = ['package-lock.json'];

// Modifications locales du code suivi, hors données.
function codeModifie(root) {
  const r = git(root, ['status', '--porcelain', '--untracked-files=no', '--', '.',
    ...[...PROTEGES, ...REGENERES].map(p => `:(exclude)${p}`)]);
  return r.ok ? r.out.split('\n').filter(Boolean).map(l => l.slice(3)) : [];
}

function verifier(root, { remote = 'origin', branch = 'main' } = {}) {
  if (!git(root, ['rev-parse', '--git-dir']).ok) return { dispo: false, raison: 'pas un dépôt git' };
  const f = git(root, ['fetch', '--quiet', remote, branch]);
  if (!f.ok) return { dispo: false, raison: `git fetch impossible : ${f.err.split('\n')[0]}` };
  const local = git(root, ['rev-parse', 'HEAD']).out;
  const distant = git(root, ['rev-parse', `${remote}/${branch}`]).out;
  if (!local || !distant) return { dispo: false, raison: 'version introuvable' };
  if (local === distant) return { dispo: false, local, distant };
  // La machine est en avance (ou identique) : rien à prendre.
  if (git(root, ['merge-base', '--is-ancestor', distant, local]).ok) return { dispo: false, local, distant };
  if (!git(root, ['merge-base', '--is-ancestor', local, distant]).ok) {
    return { dispo: false, bloque: true, local, distant,
      raison: `historique divergent : des commits ont été faits sur cette machine (git log ${remote}/${branch}..HEAD)` };
  }
  const modifs = codeModifie(root);
  if (modifs.length) {
    return { dispo: false, bloque: true, local, distant,
      raison: `code modifié sur cette machine, mise à jour suspendue : ${modifs.slice(0, 5).join(', ')}${modifs.length > 5 ? '…' : ''}` };
  }
  const fichiers = git(root, ['diff', '--name-only', local, distant]).out.split('\n').filter(Boolean);
  const titre = git(root, ['log', '-1', '--format=%s', distant]).out;
  return { dispo: true, local, distant, fichiers, titre };
}

function copier(src, dst) {
  fs.cpSync(src, dst, { recursive: true, filter: s => !s.split(path.sep).includes('backups') });
}

// Passe le code à `version` en gardant data/ et .env. Renvoie { ok, erreur }.
function appliquer(root, version, { avant } = {}) {
  const sauve = path.join(root, '.update-save');
  fs.rmSync(sauve, { recursive: true, force: true });
  fs.mkdirSync(sauve, { recursive: true });
  for (const p of PROTEGES) {
    const src = path.join(root, p);
    if (fs.existsSync(src)) copier(src, path.join(sauve, p));
  }
  const avantPkg = avant || git(root, ['rev-parse', 'HEAD']).out;
  const r = git(root, ['reset', '--hard', '--quiet', version]);
  // Les données reviennent même si le reset a échoué à mi-chemin.
  for (const p of PROTEGES) {
    const s = path.join(sauve, p);
    if (fs.existsSync(s)) copier(s, path.join(root, p));
  }
  if (!r.ok) return { ok: false, erreur: `git reset : ${r.err}` };

  const changes = git(root, ['diff', '--name-only', avantPkg, version]).out.split('\n').filter(Boolean);
  if (changes.some(f => f === 'package.json' || f === 'package-lock.json')) {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const i = spawnSync(npm, ['install', '--no-audit', '--no-fund'], { cwd: root, encoding: 'utf8' });
    if (i.status !== 0) return { ok: false, changes, erreur: `npm install : ${(i.stderr || i.error?.message || '').trim().split('\n').pop()}` };
  }
  fs.rmSync(sauve, { recursive: true, force: true });
  return { ok: true, changes, npm: changes.includes('package.json') || changes.includes('package-lock.json') };
}

module.exports = { verifier, appliquer, codeModifie, PROTEGES };
