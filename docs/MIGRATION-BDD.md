# Migration vers une base de données — plan

État : **proposition à valider**. Rien de ce plan n'est encore appliqué.

## Pourquoi

Aujourd'hui, Pearl range tout dans une vingtaine de fichiers JSON sous `data/` :

- **Chaque écriture réécrit le fichier entier.** `config.json` porte à la fois la configuration, les notes, les objectifs, les One-to-One et les codes d'accès. Une écriture sur un objectif réécrit donc aussi les codes d'accès.
- **Pas de transaction.** Le renommage d'un agent touche une dizaine de fichiers l'un après l'autre. Une coupure au milieu laisse des données à moitié renommées. C'est pour ça qu'on fait une copie avant.
- **Pas d'index.** Chaque lecture parse tout le fichier. Ça tient avec 180 Ko de planning, mais pas avec des années de tickets et d'audit.
- **Les données personnelles sont dans git**, puisque `data/` est versionné. Une base sort naturellement de ce circuit.

## Le choix : SQLite intégré à Node

| Option | Pour | Contre |
|---|---|---|
| **`node:sqlite` (intégré à Node 22)** | Aucune dépendance, fonctionne hors ligne, un seul fichier, sauvegarde à chaud | Demande Node 22 sur la VM (elle a Node 20) |
| better-sqlite3 | Rapide, très utilisé | Module natif à compiler ou à télécharger : fragile sur une VM sans internet |
| PostgreSQL | Multi-serveur, comptes, outils | Un serveur de plus à installer, sécuriser et sauvegarder. Surdimensionné pour une équipe |

**Recommandation :** passer la VM à Node 22 LTS, puis utiliser `node:sqlite`. Aucun paquet npm en plus.

## Le point d'appui : `core/store.js`

Tout l'accès aux données passe déjà par `readJSON(fichier)` et `writeJSON(fichier, données)` : 48 appels dans 18 modules. C'est la couture qui permet de migrer par étapes, sans réécrire les routes d'un coup.

## Étapes

### 0. Prérequis (½ journée)
- Node 22 LTS sur la VM (`node -v` ≥ 22.13).
- Vérifier que les tests passent sous Node 22 (c'est déjà la version de développement).

### 1. Même modèle, nouveau stockage (2–3 jours)
- Une table `documents(nom TEXT PRIMARY KEY, contenu TEXT, maj TEXT)`. `readJSON` et `writeJSON` y lisent et écrivent à la place des fichiers. Les routes ne changent pas.
- Mode WAL, une transaction par écriture, plus des transactions multi-documents pour le renommage et la clôture de session.
- `npm run db:migrate` importe les JSON existants une fois et laisse les fichiers d'origine dans `data/backups/avant-bdd/`.
- Sauvegarde quotidienne avec `VACUUM INTO` (copie cohérente à chaud).
- Interrupteur `STORE=json|sqlite` dans `.env` : on peut revenir en arrière en une ligne.
- `data/pearl.db` hors de git. Le dépôt ne porte plus de données personnelles.

### 2. Vraies tables pour les données qui grossissent (1 semaine, route par route)
- `tickets` (SN et CI), `audit`, `taches` (weekly_progress et fo_tasks), `observations`, `planning`, avec des index par agent, par date et par statut.
- Sortir de `config.json` : `notes_mensuelles`, `objectifs`, `one_to_one`, `comptes`. Chaque bloc a sa table, et `config.json` ne garde que la configuration.
- Le nom d'agent cesse d'être une clé : les données pointent vers `agents.id`. Renommer un agent devient la modification d'une seule ligne.

### 3. Comptes et droits (2–3 jours)
- Une table `comptes(id, nom, employee_id, role, code_hash, actif)` remplace `fo_access_codes` et les listes FO et BO pour l'identité.
- Une table `droits(role, action)` permet de verrouiller par rôle les écritures encore ouvertes à toute personne connectée : planning, jours fériés, quiz, liste BO, mise en page des rapports.

## Ce qui ne change pas pour l'équipe

Mêmes écrans, mêmes adresses, même mise à jour (`git pull` + redémarrage). L'updater devra seulement protéger `data/pearl.db` comme il protège déjà `data/`.

## Risques et parades

| Risque | Parade |
|---|---|
| Migration interrompue | Import en une transaction ; les JSON d'origine sont conservés |
| Régression d'une route | Étape 1 sans changement de modèle ; tests existants (227) plus des tests de non-régression par route à l'étape 2 |
| Retour arrière | `STORE=json` et export JSON complet depuis la base |
| Node 22 indisponible sur la VM | Repli possible sur better-sqlite3 (binaire fourni avec le dépôt) |

## Décisions attendues

1. Feu vert pour passer la VM à Node 22.
2. Feu vert pour sortir `data/` de git une fois la base en place.
