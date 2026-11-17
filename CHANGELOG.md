# Changelog

Plateforme conçue et développée par **Halima GUEYE**.

## v2.8

Version de consolidation : aucune nouvelle page, mais un audit complet de la
robustesse, de la sécurité d'affichage et du déploiement.

- **Sauvegardes automatiques rétablies** : copie quotidienne de `data/` dans `data/backups/<AAAA-MM-JJ>/`, avec purge au-delà de 14 jours (`BACKUP_RETENTION_DAYS`). Les snapshots *horaires* retirés en v2.5 ne reviennent pas — c'est leur fréquence qui posait problème, pas le principe. Une seule copie par jour, donc un redémarrage ne duplique rien.
- **Exports Excel utilisables hors-ligne** : ExcelJS était chargé depuis un CDN, si bien que tous les boutons « Export Excel » échouaient sur une VM sans Internet — alors que le déploiement hors-ligne est le mode nominal. La bibliothèque est désormais installée et servie par le serveur, comme JSZip.
- **Échappement des données à l'affichage** : les champs libres des tickets (titre, TT#, commentaires, actions correctives, propriétaire…) étaient insérés tels quels dans la page. Un titre contenant du balisage HTML pouvait casser l'affichage de toute l'équipe. Les colonnes des trackers, les alertes Breach / Near Breach, les observations et les tableaux Data Quality sont désormais échappés. La fonction d'échappement couvre aussi `>` et `'`, qu'elle laissait passer.
- **Liens RCA / Alarme assainis** : ces deux champs partaient directement dans un lien cliquable. Seuls `http`, `https` et les chemins relatifs sont désormais acceptés.
- **Entrées bornées** : les routes d'écriture recopiaient le corps de la requête sans contrôle. Les champs texte sont maintenant plafonnés, les structures trop profondes refusées, et `id` / `created_at` ne peuvent plus être imposés par le client — ils restent décidés par le serveur.
- **CORS restreint** : l'API n'accepte plus que les origines du réseau privé (`CORS_ORIGINS` pour en ajouter). Auparavant, n'importe quel site web ouvert sur un poste de l'équipe pouvait appeler l'API.
- **En-têtes de sécurité** (helmet) et politique de contenu : plus aucun script externe n'est autorisé à s'exécuter.
- **Journal des requêtes** : chaque écriture et chaque erreur est tracée (horodatage UTC, méthode, code, durée, IP). Les mots de passe ne sont jamais journalisés.
- **Arrêt propre** : sur `pm2 restart` ou Ctrl-C, le serveur cesse d'accepter les connexions puis attend la fin des écritures en cours, au lieu d'être interrompu au milieu d'un enregistrement.
- **Limite de débit globale** : 600 requêtes/minute par poste, pour qu'un client en boucle ne sature pas le serveur. Les écrans de mot de passe restent limités à 20 tentatives par quart d'heure.
- **Erreurs en JSON** : une exception dans une route renvoyait une page HTML que l'interface ne savait pas afficher.
- **Documentation corrigée** : le README annonçait pm2 comme dépendance installée alors qu'il était absent — la procédure de déploiement recommandée ne fonctionnait pas. pm2 est désormais réellement installé. Version, liste des fonctionnalités et section Données remises à jour, et ajout d'une section Sécurité.

## v2.7

- **Suivi des absences** : nouvelle page protégée par un mot de passe dédié, distinct de l'accès administrateur. Saisie des absences (agent, type, dates, demi-journée, motif), calendrier mensuel, soldes de congés par agent et KPI de période (taux d'absence, part non planifiée). Le décompte exclut week-ends et jours fériés. Détection automatique des conflits avec le planning des shifts : un agent déclaré absent mais planifié sur un shift est signalé. Export CSV.
- **Absences — suivi du préavis** : chaque absence indique si l'agent a prévenu (à l'avance, le jour même, en retard, non prévenu). Déduit automatiquement à la saisie, avec contrôle de cohérence entre le niveau déclaré et la date d'annonce. KPI de préavis respecté, filtre dédié et repérage des agents concernés dans les soldes.
- **Weekly Report — export PowerPoint** : génération d'un deck de rapport d'activité reprenant les chiffres de la page, avec graphiques natifs éditables, highlights et risques saisis, tickets hors SLA et faits marquants déduits des données.
- **Dashboard — Activité récente** : refonte de la carte (timeline à rail dégradé, repère du jour courant, chiffres en puces colorées, tuiles et courbe lissée).
- **Correction** : le jeton de couleur d'erreur n'était déclaré que pour le dashboard ; toute autre page l'utilisant affichait du gris à la place du rouge.
- **Correction** : la page rouverte au démarrage n'était pas correctement initialisée pour les rapports, l'audit et les absences.
- Retrait de la page Nouveautés.

## v2.6

- **Handover Board** : nouvelle page dédiée au passage de relais entre shifts. Affiche les FOs du shift précédent (avec détection automatique des shifts sautés et bannière d'alerte), liste tous les tickets actifs triés du plus ancien au plus récent, et permet à chaque FO entrant de déclarer "J'ai reçu le handover de [FO]" — mémorisé par shift/date. Vue personnelle par FO avec shift du jour, tickets actifs et SLA à risque.
- **Data Quality** : nouvelle page admin (protégée par mot de passe) listant toutes les incohérences détectées sur les tickets SN et CI. 20 règles organisées en catégories (Lifecycle, Dates, Champs obligatoires, Doublons, Qualité, SLA) avec pour chaque règle : titre, description détaillée, action corrective, et liste des tickets affectés cliquables. Score qualité global en pourcentage. Filtres par site, sévérité et catégorie.
- **Page Configuration** : même écran de connexion inline que Data Quality — formulaire mot de passe intégré à la page, sans modal flottant.
- **Dashboard — sélecteur de période** : choix entre Tout le temps / Ce mois / Cette semaine / Semaine personnalisée / Mois personnalisé pour filtrer les KPIs et graphiques.
- **Shift Planning — génération annuelle** : bouton "Générer l'année" qui produit 52 semaines de rota en continuité avec l'historique de l'année précédente (calcul automatique de l'offset de cycle par FO).
- **Daily Report — Risks & Issues** : correction de la troncature du champ texte (textarea s'ajuste automatiquement à son contenu).
- **Quiz History** : correction du fuseau horaire pour l'affichage des dates de passage (était affiché en UTC+8 au lieu du timezone configuré).

## v2.5

- **Fuseau horaire forcé en UTC+0** : suppression du sélecteur de décalage horaire dans la topbar. Toutes les heures sont désormais toujours affichées en UTC.
- **Suppression des backups automatiques** : le serveur ne crée plus de snapshot horaire de `data/`.
- **SLA "Near Breach"** : nouveau statut pour les tickets ouverts dont il reste moins de 20% du délai SLA. Panneau dédié sur le dashboard, badge orange dans les trackers, et auto-remplissage de la section Risks des rapports.
- **Dashboard - Breach/Near Breach** : les deux panneaux n'affichent plus que les tickets encore ouverts.

## v2.4

- **Dashboard - répartition par camembert** : 3 graphiques en secteurs (Statut, Domaine, Priorité) avec export Excel dédié.
- **Workload by Front Office** : heatmap en pleine largeur du dashboard.
- **FO Dashboard - Trust Matrix** : matrice 2×2 Performance × Engagement calculée à partir d'un score combiné (50% automatique / 50% manuel).
- **FO Dashboard - classement simplifié** : Rang, FO, Résolus, Hors SLA, Score — le détail s'affiche en dépliant la ligne.

## v2.3

- **Switch de pays global** : sélecteur Dakar (SN) / Abidjan (CI) / Global dans la topbar.
- **Trackers SN/CI** : filtre par date d'ouverture, filtres par colonne façon Excel, export Excel.
- **Rapports** : navigation par date sur Daily, panneau latéral de sections, Risks & Issues auto-rempli.
- **Weekly Progress** : journal d'avancement hebdomadaire avec vues Liste, Kanban et Done vs Delayed.

## v2.2

- Script de migration `migrate-data.js` pour réimporter les données d'une version antérieure sans perte.
- Commande `npm run migrate` et guide `MIGRATION.md`.
