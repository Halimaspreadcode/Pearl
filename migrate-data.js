#!/usr/bin/env node
/**
 * Migre data/*.json d'une version précédente de FOps vers celle-ci.
 *
 * PROCÉDURE PRÉVUE (scénario « import ») :
 *   1. On vide data/ (ou on part d'une installation neuve).
 *   2. On dépose l'ancien dossier de données dans ./data-old.
 *   3. npm run migrate -- --dry-run     ← TOUJOURS commencer par là
 *   4. npm run migrate                  ← si le rapport est conforme
 *
 * Usage :
 *   npm run migrate -- --dry-run          simulation, n'écrit rien
 *   npm run migrate                       migration réelle
 *   npm run migrate -- <dossier>          source explicite (défaut : ./data-old)
 *   npm run migrate -- --force            passe outre les alertes bloquantes
 *   npm run migrate -- --allow-server-up  n'exige pas l'arrêt du serveur
 *
 * PRINCIPE DIRECTEUR : en cas de doute, ce script s'ARRÊTE au lieu de
 * deviner. Une migration incomplète qui le dit vaut mieux qu'une migration
 * silencieuse dont on découvre les trous trois semaines plus tard.
 *
 * Ce qu'il garantit :
 *   - Le serveur doit être arrêté (sinon il réécrirait par-dessus l'import).
 *   - L'ancien dossier est sauvegardé HORS du projet, avant toute écriture.
 *     C'est lui qui porte les vraies données dans ce scénario ; sauvegarder
 *     data/ (vidé juste avant) ne protégerait rien.
 *   - Tout est validé, typé et compté AVANT d'écrire le premier octet.
 *   - Un fichier inconnu, une forme inattendue, un doublon d'identifiant ou
 *     une perte nette d'enregistrements bloque la migration.
 *   - Chaque écriture est relue et recomptée sur le disque.
 *   - Un rapport final dit, fichier par fichier, ce qui est arrivé.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const DATA_DIR = path.join(__dirname, "data");
const BACKUPS_DIR = path.join(DATA_DIR, "backups");

// ── SCHÉMA ATTENDU PAR CETTE VERSION ──────────────────────────
// Relevé sur server/index.js (const FILES) et sur la forme réelle des
// fichiers. C'est la référence : un fichier source qui n'y figure pas est
// signalé, un fichier dont la forme diffère est refusé.
//
//   shape : "array" | "object"  — forme attendue au niveau racine
//   idKey : champ d'identité pour les tableaux (détection des doublons)
//
// Un renommage de fichier entre deux versions se déclare dans RENAMES.
// Un changement de structure interne se déclare dans CONVERTERS.
const SCHEMA = {
  "sn.json":              { shape: "array",  idKey: "id" },
  "ci.json":              { shape: "array",  idKey: "id" },
  "observations.json":    { shape: "array",  idKey: "id" },
  "audit.json":           { shape: "array",  idKey: "id" },
  "bo_list.json":         { shape: "array",  idKey: "id" },
  "shifts_plan.json":     { shape: "array",  idKey: "id" },
  "fo_tasks.json":        { shape: "array",  idKey: "id" },
  "holidays.json":        { shape: "array",  idKey: "id" },
  "shift_requests.json":  { shape: "array",  idKey: "id" },
  "quizzes.json":         { shape: "array",  idKey: "id" },
  "quiz_results.json":    { shape: "array",  idKey: "id" },
  "quiz_progress.json":   { shape: "array",  idKey: "user" }, // identité = la personne
  "weekly_progress.json": { shape: "array",  idKey: "id" },
  "absences.json":        { shape: "array",  idKey: "id" },
  "announcements.json":   { shape: "array",  idKey: "id" },
  "trainings.json":       { shape: "array",  idKey: "id" },
  "config.json":          { shape: "object" },
  "report_layout.json":   { shape: "object" },
  "user_prefs.json":      { shape: "object" },
  "quiz_published.json":  { shape: "object" },
  // Diffusion par mail (config SMTP, groupes, planifications) et son journal.
  "mailing.json":         { shape: "object" },
  "mail_log.json":        { shape: "array",  idKey: "id" },
  // Brouillons des rapports et index des derniers classeurs produits.
  "report_drafts.json":   { shape: "object" },
  "report_files.json":    { shape: "object" },
  "formation_progress.json": { shape: "object" },
};

// Fichier de la version 1.x, remplacé par les fichiers séparés. Le serveur
// sait encore le convertir au démarrage (migrateIfNeeded), donc on le laisse
// passer sans le compter comme inconnu.
const LEGACY_FILES = ["tickets.json"];

// ── RENOMMAGES ENTRE VERSIONS ─────────────────────────────────
// « ancien nom » → « nom actuel ». À compléter au fil des versions : sans
// entrée ici, un fichier renommé est vu comme INCONNU et bloque la
// migration — c'est voulu, faute de quoi sa donnée disparaîtrait en silence.
const RENAMES = {
  // "fo_list.json": "bo_list.json",
};

// ── CONVERTISSEURS DE STRUCTURE ───────────────────────────────
// Pour un fichier dont le CONTENU a changé de forme entre deux versions
// (champ renommé, sous-objet déplacé…). Reçoit la donnée ancienne, renvoie
// la donnée au format actuel. Déclarés par fichier.
//
// Exemple, si `fo_name` s'appelait `agent` dans l'ancienne version :
//   "absences.json": (items) =>
//     items.map(it => it.agent && !it.fo_name
//       ? { ...it, fo_name: it.agent } : it),
const CONVERTERS = {
};

// ── EMPREINTES DE CHAMPS ──────────────────────────────────────
// Champs observés dans chaque fichier de cette version. Sert uniquement à
// deviner la cible d'un fichier renommé : on compare les champs de l'inconnu
// à ces listes et on propose la ligne RENAMES correspondante.
//
// Codé en dur (et non relevé dans data/) parce que la procédure vide data/
// avant de migrer : il n'y aurait alors plus rien à comparer.
//
// `sn.json` et `ci.json` partagent exactement les mêmes champs : une
// correspondance sur ces deux-là est forcément ambiguë, et le script le dit
// au lieu de trancher.
const EMPREINTES = {
  "absences.json": ["id", "created_at", "fo_name", "type", "status", "date_from", "date_to", "half_day", "notice", "reason"],
  "announcements.json": ["id", "title", "body", "level", "author", "created_at", "expires_at"],
  "ci.json": ["id", "created_at", "modified_at", "sn_tt", "imoc_tt", "title", "type", "domain", "priority", "severity", "status", "fo_owner", "assigned_to", "occur_time", "detection_time", "open_date", "close_date", "bo_handling", "is_occurrence", "comments", "root_cause", "update_action"],
  "holidays.json": ["id", "date", "name", "country", "editable", "ref", "to_confirm"],
  "observations.json": ["id", "created_at", "date", "fo_name", "source", "domain", "text", "observation"],
  "quiz_progress.json": ["user", "xp_total", "level", "streak_current", "streak_best", "last_activity", "passed", "xp_log", "updated_at"],
  "quiz_results.json": ["id", "quiz_id", "user", "score", "total", "percentage", "created_at"],
  "quizzes.json": ["id", "name", "description", "created_at", "questions"],
  "shift_requests.json": ["id", "created_at", "fo_name", "date", "type", "current_shift", "current_shift_name", "swap_with", "note", "status"],
  "shifts_plan.json": ["id", "fo_name", "team_id", "team_name", "tracker", "site_id", "site_name", "shift_id", "shift_name", "shift_type", "date", "is_rest", "is_rota", "status", "created_at"],
  "sn.json": ["id", "created_at", "modified_at", "sn_tt", "imoc_tt", "title", "type", "domain", "priority", "severity", "status", "fo_owner", "assigned_to", "occur_time", "detection_time", "open_date", "close_date", "bo_handling", "is_occurrence", "comments", "root_cause", "update_action"],
  "trainings.json": ["id", "title", "trainer", "location", "audience", "date", "start_time", "end_time", "notes", "created_at"],
};

// Champs relevés sur les premiers enregistrements d'un tableau.
function champsDe(data) {
  if (!Array.isArray(data)) return null;
  const vus = new Set();
  for (const it of data.slice(0, 50)) {
    if (it && typeof it === "object" && !Array.isArray(it)) {
      Object.keys(it).forEach((k) => vus.add(k));
    }
  }
  return vus.size ? vus : null;
}

/**
 * Devine à quel fichier de cette version correspond un fichier inconnu, en
 * comparant les champs (indice de Jaccard : intersection / union).
 *
 * Ne propose que ce qui est déjà libre : si la cible est fournie par
 * l'import sous son nom actuel, ce n'est pas un renommage.
 *
 * Renvoie [] si l'on ne sait pas — mieux vaut ne rien proposer qu'orienter
 * vers un mauvais fichier, puisque la suggestion sert à écrire RENAMES.
 */
function devinerCible(data, dejaPris) {
  const champs = champsDe(data);
  if (!champs) return [];

  const scores = [];
  for (const [nom, refs] of Object.entries(EMPREINTES)) {
    if (dejaPris.has(nom)) continue;
    const ref = new Set(refs);
    let communs = 0;
    for (const c of champs) if (ref.has(c)) communs++;
    const union = new Set([...champs, ...ref]).size;
    const score = union ? communs / union : 0;
    if (score >= 0.6) scores.push({ nom, score });
  }
  scores.sort((a, b) => b.score - a.score);

  // Deux candidats à égalité (cas sn/ci) : on les rend tous les deux pour
  // que le message signale l'ambiguïté au lieu de trancher à l'aveugle.
  if (scores.length > 1 && scores[1].score === scores[0].score) {
    return scores.filter((s) => s.score === scores[0].score);
  }
  return scores.slice(0, 1);
}

// Champs d'identité minimaux : un enregistrement qui n'a pas ces champs
// n'est pas exploitable par l'application. On avertit plutôt que de bloquer,
// car un historique ancien peut légitimement être incomplet.
const REQUIRED_FIELDS = {
  "sn.json":            ["id"],
  "ci.json":            ["id"],
  "absences.json":      ["id", "fo_name"],
  "quiz_results.json":  ["id", "user"],
  "quiz_progress.json": ["user"],
  "observations.json":  ["id"],
};

// Valeurs par défaut pour les fichiers dont la version actuelle attend
// certaines clés de premier niveau.
const DEFAULTS = {
  "config.json": { fo_list: [], domains: [] },
};

// Clés que la config en place COMPLÈTE quand l'import ne les a pas (ou
// les a vides) : un ancien export peut ne pas les connaître, et migrer ne
// doit pas effacer ce qui a été saisi dans cette version. Si l'import les
// contient, l'import fait foi (voir appliquerKeepCurrent) — jusqu'au
// 29/09, c'était l'inverse, et une migration sur un data/ non vidé
// perdait les objectifs de l'ancienne version.
//
// Sans effet dans le scénario « data/ vidé avant migration » (il n'y a
// alors pas de config courante).
const KEEP_CURRENT_KEYS = {
  "config.json": [
    "sla_hours", "rota_config",
    "fo_goals", "fo_performance", "fo_engagement", "fo_o2o", "fo_scorecards",
    "fo_scores", "engagement_scores",
    //   fo_ids             — ID Huawei par agent (Configuration › Général)
    //   fo_access_codes    — codes « Ma performance », hachés, non regénérables
    //   o2o_template       — trame d'entretien personnalisée
    //   absence_allowed_ids — liste blanche d'accès à la page Absences
    "fo_ids", "fo_access_codes", "o2o_template", "absence_allowed_ids",
    // Objectifs et sessions d'entretien : même raison.
    "fo_objectives", "objective_sessions",
    // Vues par profil et pages réservées (Admin › Vues par profil).
    "nav_profiles", "nav_reserved",
  ],
};

// ── SORTIE ────────────────────────────────────────────────────
const C = process.stdout.isTTY
  ? { r: "\x1b[0m", b: "\x1b[1m", red: "\x1b[31m", grn: "\x1b[32m", yel: "\x1b[33m", dim: "\x1b[2m" }
  : { r: "", b: "", red: "", grn: "", yel: "", dim: "" };

const blocages = [];   // empêchent la migration (sauf --force)
const alertes = [];    // méritent un coup d'œil, ne bloquent pas

const bloquer = (m) => { blocages.push(m); };
const alerter = (m) => { alertes.push(m); };

function compter(data) {
  return Array.isArray(data) ? data.length : Object.keys(data || {}).length;
}
function unite(data) {
  return Array.isArray(data) ? "enreg." : "clés";
}

// ── VÉRIFICATIONS PRÉALABLES ──────────────────────────────────

// Le serveur doit être arrêté : s'il tourne, il garde ses données en
// mémoire et la première écriture qui suit l'import écrase le fichier
// fraîchement migré. C'est le piège le plus coûteux de la procédure.
function verifierServeurArrete(opts) {
  // On interroge le PORT, pas la liste des processus. Chercher un morceau de
  // ligne de commande donnait des faux positifs : le shell qui lance ce
  // script porte lui-même « server/index.js » dans sa propre ligne de
  // commande, et se faisait détecter comme le serveur. Un port occupé, lui,
  // ne s'invente pas.
  const port = Number(process.env.PORT) || 3000;
  let actif = false;
  let verifie = false;

  try {
    // -sTCP:LISTEN : uniquement qui ÉCOUTE, pas les connexions clientes.
    const sortie = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    actif = sortie.trim().length > 0;
    verifie = true;
  } catch (err) {
    // lsof sort en code 1 quand il ne trouve rien : c'est une réponse, pas
    // une panne. Un code différent (ou l'absence de l'outil) laisse la
    // question ouverte, et on le dit plutôt que de conclure à tort.
    if (err && err.status === 1) { actif = false; verifie = true; }
  }

  if (!verifie) {
    // Repli : correspondance stricte en fin de ligne de commande, pour ne
    // pas confondre le serveur avec un shell qui cite son chemin.
    try {
      const ps = execFileSync("ps", ["-A", "-o", "command"], { encoding: "utf8" });
      const motif = /(^|\s)(?:\S*node|nodemon)(?:\s+\S+)*\s+\S*server\/index\.js\s*$/;
      actif = ps.split("\n").some((l) => motif.test(l.trim()));
      verifie = true;
    } catch {
      alerter(`Impossible de vérifier si le serveur tourne (ni lsof ni ps disponibles).\n` +
              `      Assurez-vous vous-même qu'il est arrêté avant de continuer.`);
      return;
    }
  }

  if (!actif) return;

  if (opts.allowServerUp) {
    alerter("Le serveur semble ACTIF, et --allow-server-up a été passé. Il peut écraser l'import.");
  } else {
    bloquer(
      `Le serveur FOps est ACTIF (port ${port} occupé).\n` +
      "      Arrêtez-le avant de migrer, sinon il réécrira ses données en\n" +
      "      mémoire par-dessus l'import :\n" +
      `        Ctrl-C, ou  lsof -ti:${port} | xargs kill\n` +
      "      Pour passer outre malgré tout : --allow-server-up");
  }
}

// Sauvegarde de l'ancien dossier, HORS du projet. Dans la procédure
// « vider data/ puis migrer », data-old est l'unique exemplaire des vraies
// données : c'est lui qu'il faut protéger, et ailleurs que sous data/ (que
// l'on vient de vider et qu'un déploiement peut écraser).
function sauvegarderSource(oldDir, horodatage, dryRun) {
  const dest = path.join(os.homedir(), "fops-migrations", `source-${horodatage}`);
  if (dryRun) {
    console.log(`  ${C.dim}(simulation)${C.r} l'ancien dossier serait copié vers :`);
    console.log(`      ${dest}`);
    return dest;
  }
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const f of fs.readdirSync(oldDir)) {
    const src = path.join(oldDir, f);
    if (!fs.statSync(src).isFile()) continue;
    fs.copyFileSync(src, path.join(dest, f));
    n++;
  }
  // Relecture : une sauvegarde annoncée mais absente est pire que pas de
  // sauvegarde du tout, puisqu'on s'y fierait.
  const relus = fs.readdirSync(dest).length;
  if (relus !== n) {
    bloquer(`Sauvegarde de l'ancien dossier incomplète (${relus}/${n} fichiers). Migration annulée.`);
  }
  console.log(`  ${C.grn}✓${C.r} ancien dossier sauvegardé (${n} fichiers) hors du projet :`);
  console.log(`      ${dest}`);
  return dest;
}

// Sauvegarde de data/ tel quel. Utile seulement si data/ n'est pas vide
// (migration par-dessus une installation en service).
function sauvegarderCible(horodatage, dryRun) {
  const fichiers = fs.existsSync(DATA_DIR)
    ? fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"))
    : [];
  // « Non vide » se juge sur le contenu, pas sur la taille : "[]" ou "{}"
  // suivis d'un saut de ligne pèsent 3 octets sans rien contenir.
  const nonVides = fichiers.filter((f) => {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
      return compter(d) > 0;
    } catch {
      return true;   // illisible : on le sauvegarde par précaution
    }
  });

  if (!nonVides.length) {
    console.log(`  ${C.dim}·${C.r} data/ est vide ou ne contient que des fichiers vides : rien à sauvegarder.`);
    return null;
  }
  const dest = path.join(BACKUPS_DIR, `pre-migration-${horodatage}`);
  if (dryRun) {
    console.log(`  ${C.dim}(simulation)${C.r} data/ (${nonVides.length} fichier(s) non vide(s)) serait sauvegardé vers ${dest}`);
    return dest;
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fichiers) {
    fs.copyFileSync(path.join(DATA_DIR, f), path.join(dest, f));
  }
  console.log(`  ${C.grn}✓${C.r} data/ actuel sauvegardé (${fichiers.length} fichier(s)) : ${dest}`);
  return dest;
}

// ── ANALYSE DE LA SOURCE ──────────────────────────────────────
// Tout est lu, validé et compté ici. Aucune écriture n'a lieu avant que
// cette phase soit passée sans blocage.
function analyser(oldDir) {
  const trouves = fs.readdirSync(oldDir).filter((f) => f.endsWith(".json"));
  const plan = [];

  for (const nomSource of trouves) {
    const chemin = path.join(oldDir, nomSource);
    if (!fs.statSync(chemin).isFile()) continue;

    // Renommage éventuel.
    const nomCible = RENAMES[nomSource] || nomSource;
    const attendu = SCHEMA[nomCible];

    if (!attendu) {
      if (LEGACY_FILES.includes(nomSource)) {
        alerter(`"${nomSource}" est un fichier de version ancienne : il sera copié, ` +
                `le serveur le convertira au démarrage.`);
        plan.push({ nomSource, nomCible, legacy: true });
        continue;
      }
      // Cœur du garde-fou : un fichier que cette version ne connaît pas est
      // soit un renommage non déclaré, soit une donnée qui serait perdue.
      //
      // On tente d'identifier la cible par ses champs et on livre la ligne
      // RENAMES à coller : c'est le cas le plus fréquent (un JSON renommé
      // entre deux versions) et celui qu'on ne se rappelle jamais.
      let data = null;
      try { data = JSON.parse(fs.readFileSync(chemin, "utf8")); } catch { /* signalé plus bas */ }

      const n = data === null ? "?" : compter(data);
      let message =
        `"${nomSource}" est INCONNU de cette version (${n} enreg.).\n`;

      if (data === null) {
        message +=
          `      Il n'est pas non plus lisible en JSON, donc son contenu ne dit rien\n` +
          `      de ce qu'il devrait devenir. Réparez-le ou écartez-le.`;
        bloquer(message);
        continue;
      }

      // Les noms déjà fournis par l'import ne sont pas des cibles possibles.
      const dejaPris = new Set(
        trouves.map((f) => RENAMES[f] || f).filter((f) => f !== nomSource));
      const pistes = devinerCible(data, dejaPris);

      if (pistes.length === 1) {
        const pct = Math.round(pistes[0].score * 100);
        message +=
          `      Ses champs correspondent à ${C.b}${pistes[0].nom}${C.r} (${pct} % de similitude).\n` +
          `      Si c'est bien lui, ajoutez cette ligne dans RENAMES (en tête de ce script) :\n` +
          `        ${C.grn}"${nomSource}": "${pistes[0].nom}",${C.r}\n` +
          `      Sinon, écartez le fichier de data-old pour confirmer son abandon.`;
      } else if (pistes.length > 1) {
        message +=
          `      Ses champs correspondent à plusieurs fichiers, impossible de trancher :\n` +
          `        ${pistes.map((p) => p.nom).join("  ou  ")}\n` +
          `      Ouvrez-le pour décider, puis déclarez-le dans RENAMES :\n` +
          `        ${C.grn}"${nomSource}": "<le bon fichier>",${C.r}`;
      } else {
        message +=
          `      Ses champs ne ressemblent à aucun fichier de cette version.\n` +
          `      Soit il a été renommé ET restructuré (RENAMES + CONVERTERS),\n` +
          `      soit il n'est plus utilisé (écartez-le de data-old pour confirmer).`;
      }
      message += `\n      Sans décision, sa donnée serait perdue en silence.`;
      bloquer(message);
      continue;
    }

    // Lecture + validation JSON.
    let data;
    const brut = fs.readFileSync(chemin, "utf8");
    try {
      data = JSON.parse(brut);
    } catch (err) {
      bloquer(`"${nomSource}" n'est pas un JSON valide (${err.message}).`);
      continue;
    }

    // Forme racine : un tableau attendu qui arrive en objet (ou l'inverse)
    // signale un changement de structure non converti.
    const formeReelle = Array.isArray(data) ? "array" : (data && typeof data === "object" ? "object" : "scalaire");
    if (formeReelle !== attendu.shape) {
      bloquer(
        `"${nomSource}" a une forme inattendue : ${formeReelle} au lieu de ${attendu.shape}.\n` +
        `      La structure a changé entre les deux versions : ajoutez un\n` +
        `      convertisseur dans CONVERTERS, en tête de ce script.`);
      continue;
    }

    // Conversion de structure déclarée.
    let converti = data;
    if (CONVERTERS[nomCible]) {
      try {
        converti = CONVERTERS[nomCible](data);
        alerter(`"${nomCible}" est passé par un convertisseur de structure.`);
      } catch (err) {
        bloquer(`Le convertisseur de "${nomCible}" a échoué : ${err.message}`);
        continue;
      }
    }

    plan.push({
      nomSource, nomCible,
      data: converti,
      nSource: compter(converti),
      renomme: nomSource !== nomCible,
    });
  }

  // Contrôles par fichier du plan.
  for (const e of plan) {
    if (e.legacy) continue;
    const attendu = SCHEMA[e.nomCible];

    if (attendu.shape === "array") {
      // Doublons d'identifiant : l'application indexe par id ; deux
      // enregistrements de même id en masquent un.
      const idKey = attendu.idKey;
      const vus = new Map();
      const doublons = new Set();
      let sansId = 0;
      for (const item of e.data) {
        if (!item || typeof item !== "object") continue;
        const id = item[idKey];
        if (id === undefined || id === null || id === "") { sansId++; continue; }
        if (vus.has(id)) doublons.add(id); else vus.set(id, true);
      }
      if (doublons.size) {
        bloquer(`"${e.nomCible}" contient ${doublons.size} identifiant(s) "${idKey}" en double ` +
                `(ex. ${[...doublons].slice(0, 3).join(", ")}). L'application en masquerait.`);
      }
      if (sansId) {
        alerter(`"${e.nomCible}" : ${sansId} enregistrement(s) sans "${idKey}".`);
      }

      // Champs d'identité manquants.
      const requis = REQUIRED_FIELDS[e.nomCible];
      if (requis) {
        const incomplets = e.data.filter(
          (it) => it && typeof it === "object" &&
                  requis.some((k) => it[k] === undefined || it[k] === null || it[k] === ""));
        if (incomplets.length) {
          alerter(`"${e.nomCible}" : ${incomplets.length}/${e.data.length} enregistrement(s) ` +
                  `sans ${requis.join(" ou ")}. Ils risquent de ne pas s'afficher.`);
        }
      }
    }

    // Perte nette : la cible contient plus que la source. Dans la procédure
    // « data/ vidé », cela ne doit jamais arriver — si ça arrive, data/
    // n'était pas vide et on est en train d'écraser des données vivantes.
    const cheminCible = path.join(DATA_DIR, e.nomCible);
    if (fs.existsSync(cheminCible)) {
      let actuel;
      try { actuel = JSON.parse(fs.readFileSync(cheminCible, "utf8")); }
      catch { actuel = null; }
      if (actuel !== null && !Array.isArray(actuel) && typeof actuel === "object"
          && e.data && !Array.isArray(e.data)) {
        // Fichier objet (config.json…) : compter les clés ne dit rien —
        // une clé gardée depuis la config courante (KEEP_CURRENT_KEYS) ne
        // se perd pas. On nomme ce qui disparaîtrait vraiment.
        e.nCible = compter(actuel);
        const gardees = KEEP_CURRENT_KEYS[e.nomCible] || [];
        const perdues = Object.keys(actuel)
          .filter((k) => !(k in e.data) && !gardees.includes(k));
        if (perdues.length) {
          bloquer(
            `"${e.nomCible}" PERDRAIT ${perdues.length} clé(s) présente(s) dans data/ ` +
            `et absente(s) de l'import : ${perdues.join(", ")}.\n` +
            `      Si data/ a été vidé comme prévu, ce message n'apparaît pas.\n` +
            `      Sinon : vérifiez ces clés, puis --force pour les abandonner.`);
        }
      } else if (actuel !== null) {
        e.nCible = compter(actuel);
        if (e.nCible > e.nSource) {
          bloquer(
            `"${e.nomCible}" PERDRAIT des données : data/ en contient ${e.nCible}, ` +
            `l'import n'en a que ${e.nSource}.\n` +
            `      L'import écraserait sans fusionner. Vérifiez que data-old est\n` +
            `      bien la bonne source, ou passez --force en connaissance de cause.`);
        }
      }
    }
  }

  // Fichiers connus de cette version mais absents de l'import : ils
  // resteront vides. Ce n'est pas forcément une erreur (fonctionnalité
  // récente), mais c'est exactement ce qui a rendu la dernière perte
  // invisible — donc on le dit toujours.
  const importes = new Set(plan.map((e) => e.nomCible));
  const absents = Object.keys(SCHEMA).filter((f) => !importes.has(f));

  return { plan, absents, trouves };
}

// ── ÉCRITURE ──────────────────────────────────────────────────
// Écriture atomique (fichier temporaire puis renommage) : une coupure au
// mauvais moment ne laisse jamais un JSON à moitié écrit.
function ecrireAtomique(chemin, data) {
  const tmp = chemin + ".migrate.tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, chemin);
}

function appliquerDefauts(nom, data) {
  const d = DEFAULTS[nom];
  if (!d || Array.isArray(data)) return data;
  return { ...d, ...data };
}

function appliquerKeepCurrent(nom, data, dossierRef) {
  const cles = KEEP_CURRENT_KEYS[nom];
  if (!cles || Array.isArray(data) || !dossierRef) return { data, gardees: [] };
  const ref = path.join(dossierRef, nom);
  if (!fs.existsSync(ref)) return { data, gardees: [] };
  let courant;
  try { courant = JSON.parse(fs.readFileSync(ref, "utf8")); }
  catch { return { data, gardees: [] }; }
  const out = { ...data };
  // L'import fait foi dès qu'il contient la clé avec du contenu : ce sont
  // les données de l'équipe (objectifs, entretiens, notes). La config en
  // place ne comble que les clés absentes ou vides de l'import — sinon une
  // migration faite sur un data/ non vidé remplaçait les vrais objectifs
  // de l'ancienne version par ceux, vides ou de test, de la copie en place.
  const plein = v => v != null && (Array.isArray(v) ? v.length > 0
    : typeof v === 'object' ? Object.keys(v).length > 0 : v !== '');
  const gardees = [];
  for (const k of cles) {
    if (courant[k] !== undefined && !plein(data[k])) { out[k] = courant[k]; gardees.push(k); }
  }
  return { data: out, gardees };
}

// ── PROGRAMME PRINCIPAL ───────────────────────────────────────
function main() {
  const argv = process.argv.slice(2);
  const opts = {
    dryRun: argv.includes("--dry-run"),
    force: argv.includes("--force"),
    allowServerUp: argv.includes("--allow-server-up"),
  };
  const positionnels = argv.filter((a) => !a.startsWith("--"));
  const oldDir = positionnels[0] || path.join(__dirname, "data-old");

  console.log(`\n${C.b}FOps — migration de données${C.r}`);
  console.log(opts.dryRun
    ? `${C.yel}MODE SIMULATION — aucun fichier ne sera écrit.${C.r}\n`
    : `${C.dim}Migration réelle. Utilisez --dry-run pour simuler d'abord.${C.r}\n`);

  // 0. Source utilisable ?
  if (!fs.existsSync(oldDir) || !fs.statSync(oldDir).isDirectory()) {
    console.error(`${C.red}Erreur${C.r} : "${oldDir}" n'est pas un dossier.`);
    console.error(`Déposez l'ancien dossier de données dans ./data-old, ou passez son chemin.`);
    process.exit(1);
  }
  if (!fs.existsSync(DATA_DIR)) {
    console.error(`${C.red}Erreur${C.r} : le dossier data/ est introuvable. Lancez ce script depuis la racine du projet.`);
    process.exit(1);
  }

  console.log(`Source : ${oldDir}`);
  console.log(`Cible  : ${DATA_DIR}\n`);

  // 1. Le serveur doit être arrêté.
  verifierServeurArrete(opts);

  // 2. Analyse complète, sans rien écrire.
  const { plan, absents, trouves } = analyser(oldDir);

  // Verdict en tête : le détail fait une vingtaine de lignes, et on ne doit
  // pas avoir à le parcourir pour savoir si la migration passe ou non.
  if (blocages.length) {
    console.log(`${C.red}${C.b}⛔ ${blocages.length} BLOCAGE(S) — migration annulée.${C.r}` +
                (alertes.length ? ` ${C.yel}${alertes.length} point(s) d'attention.${C.r}` : "") +
                `\n   ${C.dim}Détail et corrections proposées en fin de rapport.${C.r}\n`);
  } else if (alertes.length) {
    console.log(`${C.yel}${C.b}⚠ Aucun blocage. ${alertes.length} point(s) d'attention.${C.r}\n`);
  } else {
    console.log(`${C.grn}${C.b}✓ Aucun blocage détecté.${C.r}\n`);
  }

  console.log(`${C.b}1. Vérifications${C.r}`);

  if (!trouves.length) {
    console.error(`\n${C.red}Erreur${C.r} : aucun fichier .json dans "${oldDir}".`);
    process.exit(1);
  }
  if (!plan.length && blocages.length === 0) {
    console.error(`\n${C.red}Erreur${C.r} : aucun fichier exploitable dans "${oldDir}".`);
    process.exit(1);
  }
  console.log(`  ${C.grn}✓${C.r} ${trouves.length} fichier(s) .json analysé(s), ${plan.length} exploitable(s)`);

  // 3. Rapport avant écriture.
  console.log(`\n${C.b}2. Ce qui serait migré${C.r}`);
  const largeur = Math.max(...plan.map((e) => e.nomCible.length), 20);
  for (const e of plan.sort((a, b) => a.nomCible.localeCompare(b.nomCible))) {
    if (e.legacy) {
      console.log(`  ${e.nomSource.padEnd(largeur)}  ${C.dim}fichier de version ancienne${C.r}`);
      continue;
    }
    const fleche = e.nCible !== undefined && e.nCible !== e.nSource
      ? `${e.nCible} → ${e.nSource}`
      : `${e.nSource}`;
    const marque = e.renomme ? ` ${C.yel}(renommé depuis ${e.nomSource})${C.r}` : "";
    const vide = e.nSource === 0 ? ` ${C.dim}(vide)${C.r}` : "";
    console.log(`  ${e.nomCible.padEnd(largeur)}  ${String(fleche).padStart(9)} ${unite(e.data)}${vide}${marque}`);
  }

  if (absents.length) {
    console.log(`\n${C.b}3. Fichiers de cette version absents de l'import${C.r}`);
    console.log(`  ${C.dim}Ils resteront vides ; le serveur les créera au démarrage.${C.r}`);
    console.log(`  ${C.dim}Si l'un d'eux devait contenir des données, c'est un renommage${C.r}`);
    console.log(`  ${C.dim}non déclaré : arrêtez-vous et complétez RENAMES.${C.r}`);
    for (const f of absents) console.log(`  ${C.dim}·${C.r} ${f}`);
  }

  // 4. Blocages et alertes.
  if (alertes.length) {
    console.log(`\n${C.b}${C.yel}Points d'attention${C.r}`);
    alertes.forEach((a) => console.log(`  ${C.yel}!${C.r} ${a}`));
  }
  if (blocages.length) {
    console.log(`\n${C.b}${C.red}Blocages${C.r}`);
    blocages.forEach((b) => console.log(`  ${C.red}✗${C.r} ${b}`));
    if (!opts.force) {
      console.log(`\n${C.red}Migration ANNULÉE. Aucun fichier n'a été modifié.${C.r}`);
      console.log(`Corrigez les points ci-dessus, ou relancez avec --force si vous`);
      console.log(`avez la certitude que ces avertissements ne s'appliquent pas.\n`);
      process.exit(1);
    }
    console.log(`\n${C.yel}--force : passage outre les blocages ci-dessus.${C.r}`);
  }

  if (opts.dryRun) {
    // En simulation on affiche quand même ce que les sauvegardes feraient,
    // pour que le rapport reflète l'exécution réelle de bout en bout.
    console.log(`\n${C.b}4. Sauvegardes (simulation)${C.r}`);
    const h = new Date().toISOString().replace(/[:.]/g, "-");
    sauvegarderSource(oldDir, h, true);
    sauvegarderCible(h, true);
    console.log(`\n${C.grn}Simulation terminée. Aucun fichier n'a été modifié.${C.r}`);
    console.log(`Si le rapport ci-dessus est conforme : ${C.b}npm run migrate${C.r}\n`);
    process.exit(0);
  }

  // 5. Sauvegardes, avant la première écriture.
  console.log(`\n${C.b}4. Sauvegardes${C.r}`);
  const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
  sauvegarderSource(oldDir, horodatage, false);
  const sauvegardeCible = sauvegarderCible(horodatage, false);

  // Une sauvegarde ratée est un blocage : c'est le seul filet.
  if (blocages.length && !opts.force) {
    console.log(`\n${C.red}✗ ${blocages[blocages.length - 1]}${C.r}`);
    console.log(`${C.red}Migration interrompue avant toute écriture.${C.r}\n`);
    process.exit(1);
  }

  // 6. Écriture, puis relecture de contrôle.
  console.log(`\n${C.b}5. Écriture${C.r}`);
  const resultats = [];
  for (const e of plan) {
    if (e.legacy) {
      ecrireAtomique(path.join(DATA_DIR, e.nomSource), JSON.parse(
        fs.readFileSync(path.join(oldDir, e.nomSource), "utf8")));
      resultats.push({ nom: e.nomSource, etat: "copié", detail: "version ancienne" });
      continue;
    }
    let data = appliquerDefauts(e.nomCible, e.data);
    const { data: avecGardes, gardees } =
      appliquerKeepCurrent(e.nomCible, data, sauvegardeCible);
    data = avecGardes;

    const cible = path.join(DATA_DIR, e.nomCible);
    ecrireAtomique(cible, data);

    // Relecture : on ne se contente pas de croire que l'écriture a réussi.
    let relu, nRelu;
    try {
      relu = JSON.parse(fs.readFileSync(cible, "utf8"));
      nRelu = compter(relu);
    } catch (err) {
      resultats.push({ nom: e.nomCible, etat: "ÉCHEC", detail: `illisible après écriture : ${err.message}` });
      continue;
    }
    const attendu = compter(data);
    resultats.push({
      nom: e.nomCible,
      etat: nRelu === attendu ? "ok" : "ÉCART",
      detail: nRelu === attendu
        ? `${nRelu} ${unite(relu)}${gardees.length ? ` · conservé de data/ : ${gardees.join(", ")}` : ""}`
        : `attendu ${attendu}, relu ${nRelu}`,
    });
  }

  for (const r of resultats) {
    const marque = r.etat === "ok" ? `${C.grn}✓${C.r}`
      : r.etat === "copié" ? `${C.dim}·${C.r}`
      : `${C.red}✗${C.r}`;
    console.log(`  ${marque} ${r.nom.padEnd(largeur)}  ${r.detail}`);
  }

  // 7. Bilan.
  const echecs = resultats.filter((r) => r.etat === "ÉCHEC" || r.etat === "ÉCART");
  console.log(`\n${C.b}6. Bilan${C.r}`);
  if (echecs.length) {
    console.log(`  ${C.red}${echecs.length} fichier(s) en échec.${C.r} Restaurez depuis :`);
    console.log(`      ${path.join(os.homedir(), "fops-migrations", `source-${horodatage}`)}`);
    process.exitCode = 1;
  } else {
    console.log(`  ${C.grn}✓ ${resultats.length} fichier(s) migré(s) et vérifié(s) sur disque.${C.r}`);
  }
  console.log(`\n  Ancien dossier conservé hors du projet :`);
  console.log(`      ${path.join(os.homedir(), "fops-migrations", `source-${horodatage}`)}`);
  if (sauvegardeCible) {
    console.log(`  État précédent de data/ :`);
    console.log(`      ${sauvegardeCible}`);
  }
  console.log(`\n  Prochaine étape : démarrer le serveur et vérifier dans l'interface`);
  console.log(`  que les listes (tickets, absences, quiz) sont bien peuplées.\n`);
}

main();
