# Pearl SaaS — architecture cible et plan de migration

État : **phases 0 à 3 en place** (voir « État d'avancement » à la fin). Ce
document décrit la cible et ce qui a été construit pour l'atteindre.

## 1. Ce qu'on vend

Pearl n'est pas un ERP généraliste. Copier Odoo (comptabilité, stock, CRM…)
voudrait dire affronter Odoo sur son terrain. Pearl a un créneau plus net :
**le pilotage d'une équipe opérationnelle**. Cela couvre :

- le travail entrant : tickets, demandes, tâches, avec leurs délais (SLA) ;
- les personnes : planning, rotations, absences, présence ;
- la progression : objectifs, performance, One-to-One, formation et quiz ;
- le reporting : rapports quotidiens, hebdomadaires et mensuels diffusés par
  mail, indicateurs, assistant IA.

On garde l'idée d'Odoo qui compte ici : **un socle commun et des modules
qu'on active par client**, regroupés en **packs métier** (support IT, centre
d'appels, maintenance terrain, réseau d'agences…).

## 2. Les trois règles d'architecture

1. **Aucun code propre à un client.** Ce qui change d'un client à l'autre
   (nom, logo, couleurs, sites, champs, SLA, statuts, modules actifs,
   contenus de formation) est de la **configuration ou des données**. Il n'y
   a jamais de `if (client === 'X')`. Un seul code, déployé pour tous.
2. **Le tenant est implicite partout.** Chaque requête est résolue vers un
   tenant dès l'entrée (sous-domaine ou domaine personnalisé). Ensuite, le
   code métier n'a plus à passer le tenant : le stockage le connaît déjà. Un
   oubli ne doit jamais pouvoir exposer les données d'un autre client.
3. **Modules à frontières nettes.** Un module déclare ce qu'il apporte
   (routes, pages, permissions, données, réglages) et ce dont il dépend. Il
   ne lit jamais directement les données d'un autre module. Il passe par son
   API interne ou par des événements.

Forme retenue : un **monolithe modulaire**, pas des microservices. Un seul
déploiement et une seule base, des modules séparés dans le code. C'est ce qui
reste maintenable pour une petite équipe, et un module pourra être extrait
plus tard s'il le faut vraiment.

## 3. Vue d'ensemble

```
                 acme.pearl.app   ops.client-b.com (domaine perso)
                          \            /
                    ┌──────────────────────┐
                    │  Résolution tenant   │  host → tenant_id, thème, modules actifs
                    ├──────────────────────┤
                    │  Auth / RBAC         │  utilisateurs, rôles, permissions par module
                    ├──────────────────────┤
   ┌────────────┐   │  Registre de modules │   ┌───────────────────────────┐
   │ Console    │──▶│  (manifests)         │◀──│ Packs métier (presets)    │
   │ super-admin│   ├──────────────────────┤   │ support-it, call-center,  │
   └────────────┘   │ Modules              │   │ maintenance, agences…     │
                    │  tickets · planning  │   └───────────────────────────┘
                    │  absences · objectifs│
                    │  academy · reporting │
                    │  mailing · ai · …    │
                    ├──────────────────────┤
                    │  Stockage            │  PostgreSQL, tenant_id + Row Level Security
                    │  Jobs planifiés      │  envois de rapports, sauvegardes, IA
                    │  Fichiers            │  S3 compatible, préfixe par tenant
                    └──────────────────────┘
```

## 4. Socle (core) et modules

### Socle : toujours présent

| Brique | Rôle | Existant à reprendre |
|---|---|---|
| Tenants | organisation, domaine, statut, plan, modules actifs | — (nouveau) |
| Marque blanche | nom, logo, couleurs (jetons CSS), expéditeur des mails, pied de page des documents | jetons CSS de `public/css/base.css`, en-têtes des générateurs PPTX/PDF |
| Utilisateurs et rôles | comptes, invitations, rôles, permissions par module | `server/auth/*` (identité, codes personnels, sessions) |
| Structure | sites, équipes, personnes | aujourd'hui `fo_list`, `bo_list`, `fo_trackers` dans `config.json` |
| Navigation par profil | pages visibles par rôle | `public/js/pages/admin/nav-profiles.js` |
| Audit, sauvegardes, notifications | transverses | `server/core/audit.js`, `services/backups.js` |

### Modules : activés par tenant

| Module | Contenu actuel |
|---|---|
| `tickets` | trackers, SLA, enrichissement, suggestions, qualité des données |
| `planning` | rota, plan de shifts, demandes d'échange, jours fériés, handover |
| `absences` | demandes, soldes, conflits, PDF |
| `objectives` | objectifs, sessions, One-to-One, performance, scorecards |
| `academy` | formations, quiz, progression |
| `reporting` | daily, weekly, monthly, PPTX, XLSX, indicateurs |
| `mailing` | groupes de destinataires, planification des envois |
| `ai` | assistant, skills, base de connaissances |
| `ideas`, `announcements`, `observations` | modules légers |

### Manifest d'un module

```js
// modules/absences/manifest.js
module.exports = {
  id: 'absences',
  version: '1.0.0',
  depends: ['core'],
  permissions: ['absences.read', 'absences.request', 'absences.approve', 'absences.admin'],
  settings: {                       // réglages par tenant, avec valeurs par défaut
    leave_entitlement_days: { type: 'number', default: 25 },
    notice_days:            { type: 'number', default: 7 },
  },
  migrations: './migrations',       // tables du module, toutes avec tenant_id
  routes: './routes',               // montées sous /api/absences, gardées par permission
  pages: [{ id: 'absences', nav: 'people', icon: 'calendar', permission: 'absences.read' }],
  jobs: [],                         // tâches planifiées éventuelles
  events: { emits: ['absence.approved'], listens: ['person.renamed'] },
};
```

Activer un module pour un tenant revient à exécuter ses migrations si besoin,
à poser ses réglages par défaut et à ajouter ses pages au menu. Le registre
refuse d'activer un module dont une dépendance est inactive.

### Pack métier

Un pack ne contient **pas de code**. C'est un fichier de configuration
appliqué à la création du tenant :

```yaml
# packs/support-it.yaml
modules: [tickets, planning, absences, objectives, reporting, mailing, academy, ai]
tickets:
  statuses:   [Open, In Progress, On Hold, Resolved, Closed]
  priorities: [P1, P2, P3, P4]
  sla_hours:  { P1: 4, P2: 8, P3: 24, P4: 72 }
  fields:     [external_ref, domain, root_cause]
roles: [Admin, Manager, Agent, Observer]
academy:
  quiz_bank: ./quiz/itil-basics.json
reports: [daily, weekly]
```

Le client peut tout modifier ensuite depuis sa Configuration. Le pack ne
sert qu'à démarrer avec quelque chose de juste.

## 5. Multi-tenant : le choix du stockage

| Option | Isolation | Exploitation | Verdict |
|---|---|---|---|
| Un dossier `data/` par tenant (fichiers JSON) | bonne | simple, mais pas de requêtes, pas de transactions, pas d'index | **transition seulement** (phase 1) |
| Une base par tenant | maximale | lourde : N bases à migrer, sauvegarder, surveiller | réservé à un très gros client qui l'exige |
| **Une base, `tenant_id` partout + Row Level Security PostgreSQL** | forte : la base elle-même filtre | une seule base à migrer et à sauvegarder | **cible** |

Avec la RLS, chaque connexion pose `SET app.tenant_id = …` au début de la
requête, et chaque table porte une politique `tenant_id =
current_setting('app.tenant_id')`. Même une requête mal écrite ne peut pas
lire un autre tenant.

Le point d'appui existe déjà : tout l'accès aux données passe par
`readJSON`/`writeJSON` dans `server/core/store.js` (voir
`docs/MIGRATION-BDD.md`). Cette couture permet de changer le stockage sans
réécrire les routes d'un coup.

## 6. Mise en service d'un client

Deux chemins, un seul mécanisme (`provisionTenant(input)`) :

- **Par toi** : console super-admin, ou `npm run tenant:create -- --slug acme
  --pack support-it --admin chef@acme.com`.
- **En libre-service** : page d'inscription → choix du métier (pack) → nom,
  logo, couleurs → sites et équipes → invitation des collègues → essai de
  14 jours → paiement (Stripe Billing). Le compte est actif dès la fin de
  l'assistant, sans intervention.

`provisionTenant` crée le tenant, applique le pack, crée le compte admin et
envoie l'invitation. Il est idempotent : relancé, il ne crée pas de doublon.

## 7. Plan de migration

On ne réécrit pas 120 000 lignes d'un coup. On fait évoluer le code par
étapes, chacune livrable et testée.

### Phase 0 — Nettoyage et renommage ✅

Données et contenus de l'organisation d'origine retirés, application
renommée Pearl. Les 302 tests passent.

### Phase 1 — Multi-tenant « silo » sur le code actuel (≈ 3 à 4 semaines)

But : pouvoir installer les **premiers clients pilotes** sur une seule
instance.

1. Middleware de résolution du tenant (sous-domaine), contexte porté par
   `AsyncLocalStorage`.
2. `config/paths.js` : `FILES` devient une fonction du tenant courant
   (`data/tenants/<slug>/…`). Les verrous et les caches de `store.js` sont
   indexés par tenant. Les états partagés en mémoire (sessions, présence,
   caches de suggestions) sont aussi isolés par tenant.
3. **Sites configurables** : remplacer `sn.json`/`ci.json` et les « SN/CI,
   Dakar/Abidjan » écrits en dur par une liste de sites par tenant. C'est le
   plus gros chantier de la phase : environ 34 fichiers sont concernés.
4. Marque blanche minimale : nom, logo, couleur principale et expéditeur des
   mails par tenant, injectés dans la coquille HTML et les documents générés.
5. Modules actifs par tenant (le masquage des menus existe déjà via les
   profils de navigation, à appliquer aussi côté serveur).
6. `npm run tenant:create` et tests d'isolation : un tenant ne voit jamais
   les données d'un autre.

### Phase 2 — Base de données et console (≈ 6 à 8 semaines)

1. PostgreSQL avec RLS, derrière `store.js` (d'abord en documents JSONB par
   tenant, puis des tables par module là où les requêtes le demandent).
2. Comptes utilisateurs réels (email + mot de passe ou SSO), qui remplacent
   les mots de passe partagés `CONFIG_PW_HASH` et `ABSENCE_PW_HASH`.
3. Console super-admin : tenants, plans, modules, usage, support.
4. Assistant d'inscription en libre-service et facturation.
5. Hébergement : conteneur unique et base managée. Le watchdog et l'updater
   git, pensés pour une VM hors ligne, sont remplacés par un déploiement
   continu.

### Phase 3 — Modules et packs (en continu)

1. Ranger le code par module (`modules/<id>/{manifest,routes,services,
   migrations,public}`) avec le registre de la section 4.
2. Client : passer progressivement des scripts globaux à des modules ES
   chargés par page. On peut le faire écran par écran, sans casser le reste.
3. Écrire les premiers packs métier et leurs contenus (banques de quiz,
   gabarits de rapports).

## 8. Décisions à prendre

- **Évoluer ou repartir de zéro.** Ce document recommande d'évoluer
  (phases 1 à 3). La logique métier existante (SLA, rapports, planning,
  absences) est riche et testée, et la réécrire coûterait des mois sans rien
  apporter au client. La partie qui vieillit le plus mal est le client
  (scripts globaux, `index.html` de 2 900 lignes). On la migre écran par
  écran en phase 3.
- **Langue du produit.** L'interface mélange aujourd'hui le français et
  l'anglais. Un SaaS vendu à plusieurs entreprises a besoin d'un vrai
  système de traduction (i18n). C'est à prévoir dès la phase 1 pour les
  textes nouveaux.
- **Hébergement.** Cloud managé (recommandé pour un SaaS) ou installation
  chez le client (option « on-premise » payante, possible avec la même
  image).

## 9. État d'avancement

### Fait

| Phase | Élément | Où |
|---|---|---|
| 1 | Contexte de tenant (AsyncLocalStorage), résolution par sous-domaine ou domaine personnalisé | `server/core/tenant.js`, `server/platform/tenants.js` |
| 1 | Données isolées par tenant ; états en mémoire (sessions, présence, tâches IA) isolés | `server/config/paths.js`, `server/core/scoped.js` |
| 1 | **Sites configurables** : plus aucun site écrit en dur ; tickets par site (`/api/tickets/:site`) ; éditeur dans Configuration › General | `server/routes/sites.js`, `public/js/core/sites.js` |
| 1 | Tâches de fond (diffusion, insights, corrections) exécutées tenant par tenant | `forEachTenant` |
| 2 | Stockage interchangeable : fichiers, **Supabase en HTTPS**, PostgreSQL direct avec **RLS** | `server/core/backend/` |
| 2 | Schéma SQL et migrations (connexion directe ou API Supabase) | `server/db/migrations/`, `npm run db:migrate` |
| 2 | Comptes (Supabase Auth ou locaux), rôles owner/admin/manager/agent/observer, invitations | `server/platform/accounts.js`, `bridge.js` |
| 2 | Inscription en libre-service (`/signup`), console super-admin (`/console`), CLI | `public/platform/`, `npm run tenant:create` |
| 2 | Mots de passe partagés de `.env` désactivés en multi-tenant | `server/auth/guards.js`, `team-gate.js` |
| 3 | Registre de modules (manifests), garde serveur, menu filtré, activation par organisation | `server/platform/modules.js`, `public/js/core/branding.js` |
| 3 | Packs métier (support IT, centre de contact, maintenance terrain, réseau d'agences, générique) | `server/platform/packs/*.json` |
| 3 | Marque blanche : nom, logo, couleur, slogan par organisation | Configuration › General › Organisation |

Tests : isolation entre organisations, sessions croisées refusées, modules
désactivés, inscription, console (`tests/multi-tenant.test.js`) ; RLS sur
une vraie base PostgreSQL (`tests/pg-store.test.js`, avec
`PEARL_TEST_PG_URL`) ; pilote Supabase (`tests/supabase-rest.test.js`).

### Reste à faire

- **Appliquer le schéma sur Supabase** : `npm run db:migrate -- --via=api`
  avec un jeton d'accès personnel (`SUPABASE_ACCESS_TOKEN=sbp_…`), ou
  `npm run db:migrate` depuis une machine qui joint le port Postgres.
- **Facturation** : les champs `plan`, `status`, `trial_ends_at` et
  `billing` existent ; il manque le branchement Stripe (checkout, webhooks
  qui passent le tenant en `active` ou `suspended`) et la fin d'essai
  automatique.
- **Emails d'invitation** : le mot de passe provisoire est affiché à
  l'administrateur, pas envoyé. À brancher sur l'envoi de mails (SMTP de
  la plateforme ou invitations Supabase).
- **Plusieurs instances du serveur** : le cache par tenant suppose un seul
  processus. Au-delà, invalider le cache (PostgreSQL LISTEN/NOTIFY).
- **Client** : le code reste en scripts globaux. La migration écran par
  écran vers des modules ES, et le rangement physique du code serveur en
  `modules/<id>/`, peuvent se faire progressivement : les frontières
  existent déjà dans le registre de modules.
- **Traduction** : l'interface mélange français et anglais.

## 10. Mise en production (résumé)

```bash
cp .env.example .env              # puis remplir la section SAAS et STOCKAGE
npm install
npm run db:migrate -- --via=api   # ou npm run db:migrate (connexion directe)
npm run tenant:create -- --platform-admin moi@exemple.com
npm start
```

DNS : un enregistrement générique `*.pearl.app` (et `pearl.app`) vers le
serveur, certificat TLS générique. Domaine personnalisé d'un client :
un CNAME vers la plateforme, puis le domaine ajouté dans la console.

