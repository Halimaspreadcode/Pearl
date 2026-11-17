# Architecture

Carte du code, pour savoir où lire et où écrire. La cible SaaS multi-tenant
est décrite dans `SAAS-ARCHITECTURE.md`. Le « pourquoi » détaillé
reste dans les commentaires, à côté du code qu'il explique.

Principes :

- **Pas de build.** Le serveur est du Node sans transpilation ; le client est
  fait de scripts classiques chargés dans l'ordre par `public/index.html`.
  Le déploiement consiste à copier les fichiers (voir le README).
- **Pas de dépendance superflue.** Le projet tourne sur des VM sans accès
  Internet : SMTP, compression, PDF sont écrits sur les modules de Node.
- **Données en fichiers JSON** dans `data/` (jamais versionné), écrites de
  façon atomique et sous verrou par fichier (`server/core/store.js`).

---

## Serveur (`server/`)

Point d'entrée : `node server/index.js`. Ce fichier ne fait que démarrer :
middlewares, montage des routeurs, planificateur de mails, sauvegardes,
arrêt propre.

```
server/
  index.js            démarrage ; ORDRE de montage des routeurs = ordre de priorité Express
  watchdog.js         `npm run watchdog` : lance index.js, le relance s'il plante ou ne répond plus,
                      installe les nouvelles versions git (essai 3 min, retour arrière sinon)
  updater.js          git fetch / passage à une version en gardant data/ et .env
  config/             paths.js (DATA_DIR, FILES…), secrets.js (condensés depuis .env)
  core/               socle sans logique métier
    store.js            lecture/écriture JSON, verrous par fichier, migrations au chargement
    time.js             fuseau des rapports, début/fin de jour/semaine, temps ouvré
    sla.js              calcul SLA (simple et double : contournement / résolution)
    enrich.js           tickets enrichis (SLA, durées) — base de tous les rapports
    sanitize.js, audit.js
  http/               security.js (helmet, CORS, rate-limit), request-log.js,
                      shell.js (coquille HTML + fragment admin), bundle.js (paquets JS/CSS
                      de la coquille), static.js (gzip, 304, /bundle/*),
                      error-handler.js
  auth/               sessions.js (admin, absences, FO — état en mémoire), guards.js
                      (requireAdmin, requireAbsence…)
  services/           logique métier, appelée par les routes
    reports.js          buildDailyReport, buildWeeklyReport, mensuel, KPI de période
    report-build.js     fichiers joints (XLSX, PPTX, PDF) pour la diffusion
    mail/               smtp.js (client SMTP), mime.js, bodies.js (corps HTML des mails),
                        scheduler.js (planificateur, prochain envoi), store.js (config + journal)
    absences.js         computeAbsenceSummary, soldes, conflits planning
    suggest.js          suggestions à la création d'un ticket (TF-IDF sur l'historique, doublons)
    objectives*.js, perf.js, rota.js, presence.js, backups.js, report-store.js
  routes/             un express.Router par domaine (tickets, absences, mailing,
                      objectives-*, reports, quiz, rota…) — minces : valident, appellent un service
  documents/          weekly-pptx.js, objectives-pptx.js, absence-pdf.js, pdf-lite.js
  quiz/               banques de questions, progression
  partials/           config-page.html : écrans admin, injectés seulement pour une session admin
```

Sens des dépendances : `routes → services → core/config`. Chaque état
partagé (sessions, présence, verrous, caches) vit dans **un seul** module et
s'importe — ne jamais le recréer ailleurs.

**Ajouter une route** : dans le routeur du domaine (`routes/<domaine>.js`),
logique dans `services/`. Nouveau domaine : créer le routeur puis le monter
dans `index.js` — à la bonne place si ses chemins peuvent entrer en conflit
avec une route paramétrée (`/x/:id` capture `/x/login` s'il est monté avant).

**Suggestions à la création d'un ticket** (`services/suggest.js`,
`routes/suggest.js`, client `js/components/ticket-suggest.js`).
`GET /api/{sn|ci}/suggest?title=&sn_tt=&imoc_tt=&domain=` — routeur monté
**avant** celui des tickets, sinon `/api/sn/:id` capture « suggest ».
Déterministe et explicable, sans ML :

- titres (+ description, poids ½) découpés en mots : minuscules, sans
  accents, sans mots vides FR/EN ni nombres seuls, pluriel simple retiré ;
  pondération TF-IDF, similarité cosinus. Index en cache par tracker,
  reconstruit quand `sn.json`/`ci.json` change (mtime + taille) ;
- les 15 tickets les plus proches (similarité ≥ 0,25) votent, pondérés par
  leur similarité, pour type, domaine, priorité, sévérité, BO, assigné,
  catégorie RC. Une valeur n'est proposée qu'avec ≥ 60 % des votes **et**
  ≥ 3 tickets, et seulement si elle existe dans les listes configurées
  (domaines, `bo_list`, `fo_list`, types des SLA) ; chaque suggestion
  porte confiance, support et 2–3 tickets exemples. Root cause / actions
  correctives : même vote sur le texte, sinon reprise du ticket le plus
  proche s'il l'est à ≥ 0,6 ;
- règles : sévérité ← priorité (P1 Critical … P4 Warning) faute de vote ;
  côté client, FO owner = agent connecté, shift = créneau du rota
  contenant l'heure d'occurrence. L'heure d'occurrence n'est jamais devinée ;
- `possible_duplicates` : même `sn_tt`/`imoc_tt` (tout statut) ou ticket
  non clos de similarité ≥ 0,75.

Le client (création seulement) interroge l'API 400 ms après la frappe et
n'affiche une puce que pour un champ **vide** : rien de ce que l'agent a
saisi n'est remplacé. Les listes figées du formulaire (sévérités,
catégories RC) sont recopiées dans le service : les garder alignées.

**Diffusion par pays.** Chaque planification porte `country` (`SN`, `CI`
ou `ALL`, défaut `SN`) : il fixe les tickets du rapport, les agents du PDF
d'absences (`fo_trackers`), le périmètre du deck (`buildWeeklyPptx`,
`form.country`), la ville affichée et le jeton `{country}` de l'objet. Le
classeur déposé par la page est rangé par pays (`report_files.json`,
clé `daily:SN`) : un envoi CI ne part jamais avec le classeur SN. Le corps
du daily (`corpsDaily`) reprend la mise en page du classeur
(`daily-workbook.js`) ; les highlights clôturés sortent des deux.

**Ajouter un rapport diffusable** : `buildReportFile` dans
`services/report-build.js` (fichier joint), corps du mail dans
`services/mail/bodies.js`, envoi dans `envoyerRapport`
(`services/mail/scheduler.js`), libellés dans `RAPPORT_LABELS`
(`services/mail/store.js`, affichés dans l'onglet Rapports › Diffusion) et
`RAPPORT_LABELS_EN` (`services/mail/bodies.js`, utilisés dans les mails).
Si le rapport a aussi un écran ou un fichier téléchargeable côté client :
onglet dans `RP_TABS` (`js/pages/reports/reports-hub.js`) et ligne dans
l'onglet Exports (`#page-export`, `config-page.html`, cas dans
`_runExportKind` de `js/pages/export.js`).

---

## Client (`public/`)

`index.html` contient le balisage et la liste ordonnée des `<link>` et
`<script>`. Tous les scripts sont **classiques** (pas de modules ES) : les
attributs `onclick="…"` et les fichiers partagent les mêmes globales.

```
public/
  index.html
  js/
    core/         state, init, utils (esc, toast…), admin-session, identity, locale,
                  navigation (page-dispatch = chaîne renderPage), presence, boot.js (chargé en DERNIER)
    components/   modale ticket, recherche globale, panneau latéral, rappels…
    pages/        un dossier ou fichier par écran : dashboard/, reports/ (dont la page Rapports), mailing/ (Diffusion),
                  absences/, objectives/, quiz/, shift-planning/, config/, perf/, o2o/…
    daily-workbook.js, pptx-preview.js   partagés avec le serveur / l'aperçu PPTX
  css/            base, layout, components, puis pages/*.css — chargés dans l'ordre de cascade
```

Règles à respecter avec des scripts classiques :

1. **Ordre de chargement.** Un fichier peut appeler, *au moment où il se
   charge*, uniquement ce qui est défini dans les fichiers précédents. Le code
   de démarrage vit dans `core/boot.js`, chargé en dernier ; les fonctions
   appelées plus tard (clic, navigation) peuvent être n'importe où.
2. **Pas de doublon de nom global** : deux `function x()` ou `const x` de même
   nom dans deux fichiers s'écrasent ou lèvent une erreur.
3. **Chaîne `renderPage`** : plusieurs fichiers enveloppent `window.renderPage`
   (dispatch des pages, épingles, rapports). L'ordre des `<script>` fixe
   l'ordre des enveloppes ; `page-dispatch.js` est le point d'entrée des pages.
4. **CSS** : l'ordre des `<link>` fait partie du style. Ajouter une feuille de
   page à la suite, pas au milieu.

**Regroupement au service (`server/http/bundle.js`).** Les sources restent
découpées, mais la coquille servie remplace chaque suite contiguë de
`<script src="/js/…">` par un `<script src="/bundle/app.<hash>.js">` et les
`<link href="/css/…">` par un `/bundle/app.<hash>.css` : concaténation dans
l'ordre, repère `/* ── /js/xxx.js ── */` avant chaque fichier, empreinte du
contenu dans le nom, cache navigateur d'un an (`immutable`), reconstruction
automatique quand un fichier change (un `stat` par fichier à chaque rendu).
Les balises `/vendor/*` et externes restent en place et coupent la suite.
Un paquet est aussi coupé quand la concaténation pourrait changer le
comportement (fonction déclarée plus loin mais sondée plus tôt par
`typeof`/`window.x`, redéclaration, `"use strict"` en tête, erreur de
syntaxe) — `BUNDLE_DEBUG=1` affiche ces coupures. Contrepartie : une
exception levée au chargement d'un fichier arrête le reste de son paquet,
là où des scripts séparés continuaient. **`BUNDLE=0`** sert les balises
d'origine (numéros de ligne exacts pour déboguer). Rien à faire en
ajoutant un fichier : il suffit de l'ajouter à `index.html`, comme avant.

**Page Équipe** (`js/pages/team/`) : les écrans My Team, Performance FO,
Suivi des objectifs, One-to-One, Assigner des tâches et Agenda Training
(`#page-cfg-myteam`, `#page-cfg-perf`, …) n'ont plus de titre ni d'onglets
propres ; `team-hub.js` déplace leur conteneur dans l'onglet ouvert. Leurs
anciens noms de page (`EQ_LEGACY_PAGES`) restent valides et redirigent
vers l'onglet correspondant : liens, épingles et favoris continuent de
marcher. Daily Check-up (`fo-tasks`) n'a plus d'entrée de menu mais reste
le seul écran des tâches `/api/fo-tasks`, que les rappels ouvrent encore.

**Page Rapports** (`js/pages/reports/reports-hub.js`, `css/pages/rapports.css`).
Une seule entrée de menu, en onglets : Daily · Weekly · Monthly (tout le
monde) · Ops Review · Diffusion · Exports (session admin). Comme la page
Équipe, rien n'est réécrit : l'onglet déplace le conteneur existant
(`#page-daily-report`, `#page-mailing`, `#page-export`…) dans `#rp-mount`
et appelle son rendu. Les anciens noms (`daily-report`, `mailing`,
`export`…) redirigent vers l'onglet (`RP_LEGACY_PAGES`, lue par
`page-dispatch.js`, `init.js` et `pinned.js`) ; adresse `#rapports/<onglet>`,
dernier onglet mémorisé. Vues par profil et pages réservées gardent les
anciennes clés : un onglet suit la règle de son ancienne entrée, et
l'entrée Rapports s'affiche dès qu'un onglet est permis (`rpNavVisible`,
appelée par `applyNavMode`). Onglet Exports = le seul endroit des fichiers
complets ; les boutons laissés sur Data Quality, Ops Review ou un rapport
exportent la vue affichée. Audit Trail reste à part (traçabilité admin).

**My Space** (`js/pages/espace/`, `css/pages/mon-espace.css`, page
`mon-espace`) : l'espace personnel de l'agent FO, entrée de menu juste
après Dashboard, en anglais comme le reste de l'interface agent. Onglets
Today · Tasks · Requests · Performance · Quiz ; les quatre derniers
montent, comme Rapports, les écrans existants (`#page-weekly-progress`,
`#page-my-requests`, `#page-my-perf`, `#page-quiz`) dans `#mes-mount`.
Anciens noms de page (`weekly-progress`, `my-requests`, `my-perf`, `quiz`)
→ onglet (`MES_LEGACY_PAGES`, lue par `page-dispatch.js`, `init.js`,
`pinned.js` ; `mesCanonPage` pour la cloche) ; adresse
`#mon-espace/<onglet>`, dernier onglet mémorisé. Vues par profil et pages
réservées gardent ces anciennes clés (groupe « My Space » de
`nav-profiles.js`) : l'entrée s'affiche dès qu'un onglet est permis
(`mesNavVisible`, appelée par `applyNavMode`), Today suit l'entrée.
« Today » (`espace-signals.js`, calcul pur) liste ce qui attend l'agent,
un bouton par ligne, puis quatre repères (mois, prochain shift, objectifs,
semaine). Il ne recalcule pas les décisions de la cloche : il part de
`NF.build()` (règles de l'admin, reports, fenêtre de shift) et y ajoute
les tâches données par le manager (Équipe › Tâches, `admin_task` dans
weekly_progress, avec échéance). Une seule identité, celle du profil ;
la note et les objectifs restent derrière le code personnel de My
Performance (formulaire prérempli avec l'ID, seul le code reste à taper).
La pastille de l'entrée compte les lignes en retard ou dues ; menu replié,
l'infobulle (`data-tip`) le dit en toutes lettres.

**Rechargement automatique** (`js/core/auto-reload.js`, `GET /api/version`).
Le serveur expose un identifiant qui change à chaque démarrage ; chaque
onglet le relit toutes les 20 s (60 s en arrière-plan) et se recharge quand
il change (redémarrage, mise à jour par le watchdog). Jamais pendant une
saisie : champ actif, fenêtre réellement à l'écran, ou moins de 8 s depuis
le dernier geste — un bandeau « Refresh now » attend alors. `/api/version`
échappe à la limite de débit.

**Formation DigitalView** (`public/formation/`, `routes/formation.js`).
Artefact claude.ai intégré tel quel (`digitalview.html`, runtime claude.ai
retiré). Il synchronise sa progression via `window.claude.use('db'|'user')` ;
`digitalview-bridge.js`, chargé avant lui, fournit cette interface adossée
au serveur (`GET/PUT /api/formation/progress/:id`, `data/formation_progress.json`,
clé = ID employé de l'agent identifié), range l'état local par agent (poste
partagé), suit le thème de l'app et lance `initSync()` que l'artefact
n'appelait pas. Vue d'équipe admin : `GET /api/formation/progress`.
Mettre la formation à jour : remplacer `digitalview.html` par le nouvel
export (artefact source : claude.ai/artifact/FVmfHAWGwJpcs1yQaBKh5P), en
gardant la ligne du pont en tête de `<head>`, et vérifier que les clés de
session (M1.o1…) n'ont pas changé — la progression y est rangée. Le pont
remplace aussi le réglage d'accueil `CFG` de l'artefact (prénom et
initiales de l'agent identifié).

**Ajouter une page** : balisage `<div class="page" id="page-xxx">` dans
`index.html` (ou dans `server/partials/config-page.html` si elle est réservée
à l'admin), script dans `js/pages/`, ajouté à `index.html` avant
`core/boot.js`, et branchement dans `js/core/page-dispatch.js` si la page
demande un rendu spécifique.

---

## Tests unitaires (`tests/`)

Règles métier sensibles, testées avec le lanceur intégré de Node
(`node:test` + `node:assert/strict`) — aucune dépendance ajoutée.

```
npm test                          # = node --test tests/
node --test tests/sla.test.js     # un seul fichier
```

| Fichier | Protège |
|---|---|
| `sla.test.js` | SLA simple et double, statuts In SLA / Near Breach / Breach / N/A, calendaire vs ouvré, drill 08:30–17:30, mesure à `close_date`, `detection_time` prioritaire |
| `time.test.js` | `tzParts`, début/fin de jour et de semaine (Abidjan, Paris au changement d'heure), semaine ISO, `workedMs` drill vs live |
| `absences.test.js` | `computeAbsenceSummary` : jours ouvrés (week-ends, fériés du pays), taux planifié/subi, soldes, taux de préavis, conflits avec le planning |
| `mail.test.js` | `mailSubject` (jetons, semaine ISO, fuseau, retours à la ligne), `prochainEnvoi`, `planifDue` |
| `weekly-quiet.test.js` | `quietWeek` : semaine calme, sélection des observations (max 3), `visibility_risk` |
| `suggest.test.js` | suggestions : classement TF-IDF, seuils de confiance/support, filtrage par les listes configurées, règle sévérité ← priorité, doublons, cache de l'index, < 50 ms sur 500 tickets |
| `service.test.js` | `scripts/service.js` : unité systemd et plist launchd générées (chemins, utilisateur, relance, échappement XML) |
| `auto-update.test.js` | mise à jour sur de vrais dépôts git temporaires : données de la VM gardées, retour arrière sur une version qui plante, version écartée non retentée, refus si code modifié ou historique divergent |
| `watchdog.test.js` | `server/watchdog.js` : relance après plantage, relance d'un serveur qui ne répond plus, arrêt propre sur SIGTERM, refus si le port répond déjà |
| `diffusion-pays.test.js` | pays d'un envoi : objet et `{country}`, ville dans le mail et le classeur, highlights clôturés retirés, classeur déposé rangé par pays, cible SLA côté serveur |
| `period-kpis.test.js` | `periodKpis` : conformité SLA (null sans mesure), MTTD/MTTR en temps ouvré |

Un test marqué `{ todo: '…' }` documente un défaut connu du code : il
s'exécute et échoue sans casser la suite. Le corriger, c'est retirer le
`todo` une fois le code réparé.

**Ajouter un test** : un fichier `tests/<sujet>.test.js`. Dates toujours
fixes (passer `now` en argument, ou `t.mock.timers` si le code lit
`Date.now()`). Un module qui charge `core/store` lit `DATA_DIR` au
chargement : appeler `useTempDataDir({ 'config.json': {...} })`
(`tests/helpers/data-dir.js`) **avant** le premier `require` serveur.
Chaque fichier tourne dans son propre process, donc son propre `DATA_DIR`.
Si le code dépend du fuseau de la machine, fixer `process.env.TZ` en tête
de fichier.

---

## Test de non-régression (`tools/regression/`)

Avant de fusionner un changement qui ne doit rien modifier (refonte,
déplacement de code), comparer au comportement de référence :

```
tools/regression/run.sh                      # contre origin/main : api, writes, ui
BASELINE=<commit> tools/regression/run.sh api writes
```

L'outil lance la référence (copie git au commit donné) et le code courant
côte à côte, sur deux copies identiques de données de démo (`scripts/seed-demo.js`,
envoi de mails neutralisé), puis compare 112 réponses GET, une séquence d'environ
50 écritures (réponses et fichiers de données) et le texte + les erreurs JS
des 42 pages. La partie `ui` demande `playwright-core` (variable
`PLAYWRIGHT_CORE` si non installé) et Chrome (`CHROME`).

Un écart n'est pas toujours une régression — une correction voulue en
produit aussi ; le rapport montre l'endroit exact pour trancher.
