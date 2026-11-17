# Migrer les données entre versions (V3 → V4, etc.)

Contexte : la version qui tourne au bureau (sur la VM Huawei FusionSphere) n'a
pas d'export/API pour récupérer les données. La seule façon de garder
l'historique en passant à une nouvelle version est de copier directement les
fichiers `data/*.json`.

## Règle d'or

**La structure des fichiers dans `data/` ne doit jamais casser la
compatibilité avec une version antérieure.**

- On peut **ajouter** un champ optionnel à un objet.
- On ne **renomme** ni ne **supprime** jamais un champ existant.
- Le code qui lit les données doit toujours gérer l'absence d'un champ récent
  avec une valeur par défaut (`item.priority ?? "normal"`), jamais supposer
  qu'il est présent.

Tant que cette règle est respectée, un vieux fichier JSON exporté d'une
version antérieure reste valide pour une version plus récente.

## Procédure de migration

### 1. Sur la VM bureau (version actuelle, ex. V3)

1. Ouvre la console/RDP de la VM.
2. Va dans le dossier du projet, sous-dossier `data/`.
3. Copie tous les fichiers `.json` (pas besoin de `data/backups/`) vers une
   clé USB, un partage réseau, ou envoie-les par mail/Teams.
4. Arrête le serveur (`Ctrl+C` dans la console où tourne `npm start`).

### 2. Installer la nouvelle version (ex. V4) sur la même VM

1. Dézippe le nouveau zip dans un **nouveau dossier**, à côté de l'ancien
   (ne mélange pas les deux).
2. Dans ce nouveau dossier, mets les fichiers récupérés à l'étape 1 dans un
   sous-dossier nommé exactement `data-old/` (à la racine du projet, au
   même niveau que `data/`).
3. Ouvre une console dans le nouveau dossier et lance :

   ```
   npm install
   npm run migrate
   ```

   (si tu utilises un autre nom de dossier, lance plutôt
   `node migrate-data.js <ton-dossier>`)

   Ce script :
   - valide que chaque fichier copié est bien du JSON correct (sinon il
     s'arrête sans rien modifier),
   - sauvegarde automatiquement le `data/` actuel de la nouvelle version
     dans `data/backups/<horodatage>/`,
   - copie chaque fichier de `data-old/` dans `data/`, en complétant les
     champs manquants avec des valeurs par défaut si le schéma a évolué.

4. Lance l'application : `npm start`.
5. Vérifie que les anciennes données (plannings, audit, quiz, etc.)
   apparaissent correctement.

### 3. Nettoyage

- Ne supprime l'ancien dossier de version qu'une fois la nouvelle version
  validée avec les données réimportées.
- Garde une copie de `data-old/` (ou de la sauvegarde automatique créée par
  le script) en dehors des deux dossiers, au cas où.

## Si le schéma doit évoluer dans le futur

- Ajoute le nouveau champ comme optionnel partout dans le code (lecture
  avec valeur par défaut).
- Si besoin, déclare une valeur par défaut pour ce champ dans
  `migrate-data.js` (objet `DEFAULTS`, ou fonction `applyItemDefaults`) pour
  que les anciens fichiers migrés l'obtiennent automatiquement.
- Ne jamais retirer un champ existant tant que d'anciennes données peuvent
  encore être réimportées.
