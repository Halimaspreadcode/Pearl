# Pearl

Plateforme de pilotage d'équipe opérationnelle : tickets et délais (SLA),
plannings et rotations, absences, objectifs et performance, formation et
quiz, rapports diffusés par mail, assistant IA.

Pearl fonctionne de deux façons :

- **SaaS multi-tenant marque blanche** (`MULTI_TENANT=1`) : une
  organisation par sous-domaine, inscription en libre-service, console
  d'administration, comptes par email, modules et packs métier, stockage
  Supabase ou PostgreSQL. Architecture, état d'avancement et mise en
  production : [`docs/SAAS-ARCHITECTURE.md`](docs/SAAS-ARCHITECTURE.md).
- **Mono-organisation** (par défaut) : une instance, données dans `data/`,
  comme décrit dans la suite de ce README.

### Déployer sur Vercel (avec l'intégration Supabase)

Rien à configurer à la main : `vercel.json` fait passer toutes les
requêtes par le serveur (`api/index.js`), et Pearl se règle seul à partir
des variables créées par l'intégration Supabase (`SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`) : stockage Supabase,
multi-tenant, espaces à l'adresse `/o/<organisation>`.

- `/` : page d'accueil ; `/signup` : création d'un espace ;
  `/o/<organisation>` : un espace ; `/console` : administration.
- Première visite de `/console` : saisir le code d'installation à usage
  unique (ou définir `PEARL_SETUP_CODE`) pour créer le compte administrateur.
- Facultatif : `CRON_SECRET` (envois programmés via Vercel Cron),
  `SUPABASE_ACCESS_TOKEN` (migrations appliquées au build).
- Avec un domaine personnel et un DNS générique (`*.mondomaine.com`) :
  `PEARL_BASE_DOMAIN=mondomaine.com` et `PEARL_TENANT_URLS=subdomain`.

### Démarrer en SaaS, en local

```bash
cp .env.example .env
npm install
MULTI_TENANT=1 AUTH_PROVIDER=local npm start
```

Puis http://localhost:3000/signup pour créer une organisation : elle est
servie sur `http://<adresse>.localhost:3000`. La console est sur
http://localhost:3000/console (compte créé par
`npm run tenant:create -- --platform-admin moi@exemple.com`).

## Prérequis

- Node.js 18+ (20 conseillé) — vérifier avec `node -v`
- Accès réseau local entre les postes FO et le serveur

Sur un Node plus ancien, le serveur s'arrête au démarrage avec
« Pearl demande Node.js 18 ou plus récent ». Les paquets `nodejs` d'Ubuntu
sont souvent trop vieux (Node 10 ou 12). Mise à jour sur Ubuntu :

```bash
node -v                                   # version actuelle
# Avec accès internet :
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v                                   # doit afficher v20.x
```

Sans accès internet : télécharger sur un autre poste l'archive
`node-v20.x.x-linux-x64.tar.xz` (nodejs.org › Downloads › Linux Binaries),
la copier sur la VM, puis :

```bash
sudo tar -xJf node-v20.*-linux-x64.tar.xz -C /usr/local --strip-components=1
hash -r && node -v
```

Après la mise à jour de Node, refaire `npm install` (ou recopier un
`node_modules/` généré avec la même version de Node) : `bcryptjs` et les
autres dépendances n'ont pas besoin d'être recompilées, mais un
`node_modules/` installé par un Node très ancien peut contenir des versions
de paquets adaptées à celui-ci.

## Installation (poste avec accès internet)

```bash
cd pearl
npm install        # installe les dépendances, pas besoin d'internet ensuite
```

## Déploiement sur une VM sans accès internet

`npm install` ne fonctionnera pas sur une VM hors-ligne. À la place, copier le
dossier `pearl` **avec son `node_modules/`** (déjà généré sur un poste
avec internet) directement sur la VM - clé USB, partage réseau, etc. Aucune
installation supplémentaire n'est nécessaire, `node_modules/` contient déjà
tout.

Toutes les bibliothèques nécessaires au fonctionnement (dont **ExcelJS** pour
les exports Excel et **JSZip** pour l'aperçu PowerPoint) sont servies depuis
`node_modules/` : aucun CDN n'est appelé, les exports fonctionnent hors-ligne.

> **Seule différence visible sans accès internet** : les polices Inter et
> JetBrains Mono sont chargées depuis Google Fonts. Hors-ligne, l'interface
> s'affiche avec les polices système de repli. C'est purement cosmétique,
> aucune fonctionnalité n'en dépend.

## Démarrer le serveur

Le serveur écoute sur le port **3000** (configurable, voir plus bas).

```bash
npm start          # démarre au premier plan, Ctrl+C pour arrêter
```

Pour le laisser tourner après fermeture du terminal :

```bash
nohup npm start > pearl.log 2>&1 &
```

## Reprendre les objectifs d'une ancienne version

Si une migration a été faite sans vider `data/` avant le 29/09/2026, les
objectifs (KPI, jalons), les One-to-One, les notes, les codes et la
progression des quiz de l'ancienne version sont restés dans `data-old`.
Pour les reprendre, sans toucher aux tickets ni au reste (les quiz sont
fusionnés : une tentative faite depuis la migration est gardée) :

```bash
npm run restore:team                 # montre ce qui serait repris, n'écrit rien
npm run service:stop                 # (ou Ctrl-C) : le serveur doit être arrêté
npm run restore:team -- --apply      # reprend ; l'état précédent est sauvegardé dans data/backups/
npm run service:start
```

## Relance automatique (watchdog)

```bash
npm run watchdog   # au lieu de npm start
```

Le watchdog lance le serveur et le surveille :

- **plantage** : relance automatique (après 1 s, puis 2 s, 4 s… jusqu'à 1 min
  si les plantages s'enchaînent ; retour à 1 s dès que le serveur a tenu 5 min) ;
- **serveur bloqué** (vivant mais muet) : `/api/status` est interrogé toutes les
  30 s ; après 3 absences de réponse, arrêt propre puis relance ;
- **Ctrl-C** ou `kill` sur le watchdog : arrêt propre du serveur, sans relance.

- **nouvelle version sur GitHub** : toutes les 10 min, `git fetch`. Si `main` a
  avancé : arrêt propre, passage du code à la nouvelle version, `npm install`
  si les dépendances ont changé, relance. **`data/` et `.env` de la machine
  sont toujours conservés**, même si le commit en contient d'autres. Les
  migrations de données se font au démarrage du serveur ;
- **version cassée** : une nouvelle version est à l'essai 3 min. Si elle
  plante ou ne répond pas, retour automatique à la version précédente ; la
  version fautive est écartée et ne sera pas retentée (seule une plus récente
  le sera).

La mise à jour est suspendue — et le journal dit pourquoi — si du code a été
modifié à la main sur la machine, ou si des commits y ont été faits : elle ne
les écrase jamais. Dépôt privé : la machine doit pouvoir faire `git fetch`
sans mot de passe (`git config credential.helper store`, puis un `git fetch`
en saisissant le jeton GitHub une fois). `WATCHDOG_UPDATE_MIN=0` dans `.env`
désactive les mises à jour.

Après un redémarrage ou une mise à jour, les navigateurs ouverts se
rechargent d'eux-mêmes dans les 20 secondes — sauf pendant une saisie : un
bandeau « Refresh now » attend alors que l'utilisateur ait fini.

Il refuse de démarrer si un serveur répond déjà sur le port. Journal :
`watchdog.log` à la racine du projet ; `npm run service:status` résume l'état
du service, du serveur et des mises à jour.

**Au démarrage de la machine**, c'est le service système qui lance le watchdog.
Une commande l'installe, chemins remplis d'office (Linux/systemd et macOS/launchd) :

```bash
npm run service:install     # installe et démarre (Linux : demande le mot de passe sudo)
npm run service:status      # état du service + le serveur répond-il ?
npm run service:restart     # redémarre (et vérifie GitHub dans la minute)
npm run service:stop        # arrête le serveur ; le service reste installé
npm run service:start       # relance après un stop
npm run service:uninstall   # retire le service
npm run service:install -- --dry-run   # montre ce qui serait fait, sans rien faire (--show : le fichier)
```

Lancer la commande **sans** `sudo`, depuis le dossier du projet, avec le Node
qui doit faire tourner le serveur (celui de `node -v`) : c'est ce Node et cet
utilisateur que le service reprend. Arrêter d'abord un serveur lancé à la main
(`npm start`), sinon le port est pris. Après une mise à jour de Node ou un
déplacement du projet, relancer `npm run service:install`.

Avec un service installé, on arrête par le service (`systemctl stop pearl`,
`launchctl unload …`) : tuer le serveur seul le ferait relancer aussitôt.

## Arrêter le serveur

Ctrl+C s'il tourne au premier plan. Sinon :

```bash
lsof -ti:3000 | xargs kill
```

## Mode développement

```bash
npm run dev         # relance auto à chaque modification (surveillance intégrée à Node)
```

## Journal des requêtes

Le serveur affiche une ligne par écriture (POST/PUT/PATCH/DELETE) et par
erreur. Les 404 provoquées par le navigateur lui-même (sondes de Chrome
DevTools, fichiers `.map`) ne sont pas tracées : elles n'indiquent rien.

Pour couper le journal — les erreurs serveur restent affichées :

```bash
LOG_HTTP=0 npm start
```

## Accès

- **Sur le poste serveur** : http://localhost:3000
- **Depuis les autres postes du réseau local** : http://[IP-DU-SERVEUR]:3000

Pour trouver l'IP du serveur :
- macOS/Linux : `hostname -I` (Linux) ou `ipconfig getifaddr en0` (macOS)
- Windows : `ipconfig` → IPv4 Address

## Changer le port

```bash
PORT=8080 npm start
```

## Données

Toutes les données sont stockées en fichiers JSON dans `data/` (un fichier par
type : `sn.json`, `ci.json`, `observations.json`, `audit.json`, `config.json`,
etc.), avec écriture atomique et verrou par fichier pour éviter les
corruptions en cas d'écritures concurrentes.

### Sauvegardes automatiques

Le serveur copie `data/` dans `data/backups/<AAAA-MM-JJ>/` **une fois par
jour**, au démarrage puis toutes les 24 h. Une seule copie par jour : relancer
le serveur dix fois ne crée pas dix dossiers.

Les copies de plus de **14 jours** sont supprimées automatiquement, pour que
la sauvegarde ne finisse pas par saturer le disque.

```bash
BACKUP_RETENTION_DAYS=30 npm start   # garder 30 jours
BACKUP_RETENTION_DAYS=0  npm start   # désactiver complètement
```

> Ces copies vivent sur le même disque que les données : elles protègent d'une
> fausse manœuvre, **pas** d'une panne matérielle. Pour ça, copier
> périodiquement `data/backups/` sur un autre support.

### Restaurer une sauvegarde

Le serveur doit être **arrêté** : s'il tourne, il réécrira ses données en
mémoire par-dessus les fichiers restaurés.

```bash
lsof -ti:3000 | xargs kill        # arrêter le serveur
cp data/backups/2026-08-16/*.json data/
npm start
```

## Fuseau horaire

L'application affiche systématiquement les heures en **UTC+0**, sans réglage
possible. C'est la référence unique pour toute l'équipe, quel que soit le
fuseau du poste de travail.

## Fonctionnalités principales

- Dashboard temps réel : KPIs (Total, Open, Breach, Near Breach, SLA
  Compliance), alertes Breach / Near Breach, countdown SLA en direct,
  sélecteur de période et Activité récente
- Trackers par site (aujourd'hui deux sites, `SN` et `CI`, à rendre
  configurables : voir docs/SAAS-ARCHITECTURE.md) - saisie, filtres, export Excel
- Observations - log opérationnel
- Tableau d'équipe - statistiques, classement par agent et Trust Matrix
- Rapports Daily / Weekly / Monthly avec sections auto-remplies
  (tickets en risque, breaches actifs) et export PowerPoint du Weekly
- Handover Board - passage de relais entre shifts, avec détection des
  shifts sautés
- Data Quality - 20 règles de cohérence sur les tickets et score global
  (accès administrateur)
- Suivi des absences - saisie, calendrier, soldes de congés, préavis et
  détection des conflits avec le planning (mot de passe dédié)
- Agenda de training - séances de formation de l'équipe
- Shift Planning (génération annuelle de rota), FO Tasks, Quiz,
  Weekly Progress
- Ma performance - chaque agent consulte sa propre note via un code
  d'accès personnel
- Configuration - domaines, SLA, équipe FO, KPIs affichés

## Sécurité

L'application est prévue pour un **réseau local interne**. Les points d'accès
sensibles sont malgré tout protégés :

- **Configuration, Audit, Data Quality, Approbations** : mot de passe
  administrateur (`CONFIG_PW_HASH`).
- **Absences** (données RH) : mot de passe distinct (`ABSENCE_PW_HASH`) +
  liste blanche d'identifiants déclarée dans la Configuration.
- **Ma performance** : code d'accès personnel par agent ; un agent ne peut
  jamais consulter la note d'un collègue.
- Les mots de passe ne sont stockés que sous forme de condensé bcrypt.
- Les tentatives de connexion sont limitées à 20 par quart d'heure.
- CORS restreint au serveur lui-même (même hôte) ; en-têtes de sécurité posés
  par helmet.
- **Accès équipe** : dès qu'un mot de passe d'équipe est défini
  (Configuration → Sécurité → *Accès équipe*), toute l'API exige une
  connexion : mot de passe d'équipe, code personnel d'un agent ou mot de passe
  admin. Sans lui, tickets, observations, planning… restent lisibles par tout
  poste du réseau. Le condensé vit dans `data/team-access.secret`, hors de git.
- **Identité vérifiée** : avec l'accès équipe actif, on se connecte avec son ID
  employé et son **code personnel** (Configuration → Sécurité → Codes
  personnels, pour FO, BO ou toute autre personne). C'est la session, et non
  un nom choisi dans le navigateur, qui dit qui agit : le serveur signe
  chaque écriture (tickets, tâches, demandes, quiz) avec cette identité, et un
  agent ne modifie que ses propres tâches. Le mot de passe d'équipe ne donne
  plus que la consultation.
- **Onglets de My Space réservés** (Vues par profil → Pages réservées) :
  appliqués aussi par le serveur.

### HTTPS

Sans HTTPS, mots de passe et jetons passent en clair sur le réseau. Une
commande suffit sur la VM :

```bash
npm run https:setup          # crée data/tls/ (autorité locale + certificat) et complète .env
npm run service:restart
```

L'équipe ouvre ensuite `https://[IP-DU-SERVEUR]:3443` ; l'ancienne adresse
`http://…:3000` y renvoie d'elle-même (le HTTP ne sert plus que la machine
locale, pour le watchdog). Sur chaque poste, une fois, installer
`https://[IP-DU-SERVEUR]:3443/pearl-ca.crt` dans les « Autorités de
certification racines de confiance » pour ne plus voir d'avertissement. Mieux :
faire signer `data/tls/server.csr` par l'autorité de l'entreprise et remplacer
`data/tls/server.crt`.

Pour autoriser une origine supplémentaire (autre nom de machine, port
différent) :

```bash
CORS_ORIGINS=http://serveur-pearl:8080,http://autre-poste:3000 npm start
```

---

## Architecture du code

Organisation des modules serveur et client, règles de chargement des scripts,
où ajouter une route ou une page, et test de non-régression : voir
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
