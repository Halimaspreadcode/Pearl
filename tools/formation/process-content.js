/* ══════════════════════════════════════════════════════════════
   CONTENU DE LA FORMATION « PROCESS ITSM »
   (incidents, problèmes, changements, escalade, SLA)

   Ce fichier n'est pas chargé tel quel : tools/formation/build.js process
   l'insère dans le moteur de la formation DigitalView pour produire
   public/formation/process.html. Après modification :
       node tools/formation/build.js process

   Format (celui du moteur DigitalView) :
     G      glossaire   { terme: { c: catégorie, d: définition, a: image } }
     M1…Mn  sessions    [{ id, t, cards: [...] }]
     cartes  { i: icône, h: titre, p: [paragraphes], m: mémo }
             { q: question, o: [options], a: index bonne réponse, e: explication }
             { w: widget }            (voir W plus bas)
             { r: [points à retenir] }
     [[terme]] dans un texte ouvre la définition du glossaire.

   Le contenu suit les règles réelles d'EMOC, lues dans le tracker : types
   de tickets, matrice SLA (config.sla_hours), On Hold qui gèle le SLA,
   seuil Near Breach à 20 %, cible MTTD de 5 min, mode drill 08:30-17:30.
   Si une règle change dans le tracker, la changer ici aussi.
   ══════════════════════════════════════════════════════════════ */

var G={
/* Process */
"ITSM":{c:"Process",d:"IT Service Management : l'ensemble des process qui permettent de délivrer et de maintenir un service informatique. Incident, problème, changement et demande en sont les piliers.",a:"Le code de la route de l'exploitation."},
"ITIL":{c:"Process",d:"Le référentiel de bonnes pratiques le plus utilisé en ITSM. Nos process (incident, problème, changement) en reprennent le vocabulaire."},
"Incident":{c:"Process",d:"Une interruption ou une dégradation non prévue d'un service. Le but de la gestion des incidents : rétablir le service le plus vite possible, pas forcément trouver la cause.",a:"Le pompier : il éteint le feu d'abord."},
"Problème":{c:"Process",d:"La cause inconnue d'un ou plusieurs incidents. La gestion des problèmes cherche la cause racine pour que l'incident ne revienne pas.",a:"L'enquêteur : il cherche pourquoi le feu a pris."},
"Problem Bug":{c:"Process",d:"Dans EMOC, un problème dont la cause est un défaut logiciel. Il a deux échéances SLA : une pour le contournement, une pour la correction définitive."},
"Problem non Bug":{c:"Process",d:"Dans EMOC, un problème dont la cause n'est pas un défaut logiciel : configuration, capacité, matériel, process, erreur humaine. Une seule échéance SLA."},
"Changement":{c:"Process",d:"Tout ajout, modification ou suppression qui peut avoir un effet sur un service : mise à jour, nouvelle configuration, migration. Un changement se prépare, s'approuve et se planifie.",a:"La chirurgie programmée, par opposition aux urgences."},
"Demande de service":{c:"Process",d:"Une sollicitation standard, sans panne : un accès, une information, un export. Elle suit un circuit prévu d'avance et ne doit pas être traitée comme un incident."},
"Événement":{c:"Process",d:"Un changement d'état détecté par la supervision. Tous les événements ne sont pas des incidents : une bascule réussie est un événement, pas une panne."},
"Alarme":{c:"Process",d:"Un événement qui signale une anomalie et appelle une action. Dans EMOC, la plupart des incidents naissent d'une alarme vue en supervision (DigitalView)."},
"Incident majeur":{c:"Process",d:"Un incident à fort impact (souvent P1) qui demande une organisation dédiée : un coordinateur, un point de communication régulier, une revue après coup."},
"Erreur connue":{c:"Process",d:"Un problème dont la cause racine est identifiée et documentée, avec un contournement. Elle permet de traiter les incidents suivants beaucoup plus vite.",a:"La fiche « on connaît, voici quoi faire »."},
"Contournement":{c:"Process",d:"Une solution temporaire qui rétablit le service sans supprimer la cause. Dans EMOC, sa date se note dans Workaround Date."},
"Cause racine":{c:"Process",d:"La cause première d'un problème : celle qui, supprimée, empêche l'incident de revenir. À distinguer du symptôme et de la cause immédiate."},
"RCA":{c:"Méthode",d:"Root Cause Analysis : l'analyse qui remonte jusqu'à la cause racine. Dans EMOC, elle se résume dans RC Description et se lie dans RCA Link."},
"CAB":{c:"Process",d:"Change Advisory Board : l'instance qui examine et approuve les changements normaux, en pesant risque, impact et planning."},
"Gel des changements":{c:"Process",d:"Une période pendant laquelle on évite tout changement non urgent : fin d'année, événement client, campagne commerciale. Le risque d'un changement y coûte plus cher."},
"PIR":{c:"Méthode",d:"Post-Incident Review : la revue faite après un incident majeur. Chronologie, ce qui a marché, ce qui n'a pas marché, actions pour la suite. Sans recherche de coupable."},
/* SLA */
"SLA":{c:"SLA",d:"Service Level Agreement : l'engagement de délai pris envers le client. Dans EMOC, il dépend du type de ticket et de la priorité, et se calcule à partir de la détection.",a:"Le chrono que le client regarde."},
"Priorité":{c:"SLA",d:"P1 à P4. Elle fixe le délai SLA et l'ordre de traitement. Elle se déduit de l'impact et de l'urgence."},
"Sévérité":{c:"SLA",d:"Critical, Major, Minor, Warning. Elle décrit la gravité technique de l'alarme ou de la panne. Elle aide à fixer la priorité mais ne la remplace pas."},
"Impact":{c:"SLA",d:"Ce que la panne touche : combien d'utilisateurs, de services, de sites, et à quel point. Un des deux axes de la priorité."},
"Urgence":{c:"SLA",d:"La vitesse à laquelle l'impact devient grave si on ne fait rien. Le second axe de la priorité."},
"Near Breach":{c:"SLA",d:"Dans EMOC : le ticket est encore dans les délais, mais il reste moins de 20 % du temps SLA. C'est le signal pour escalader, pas pour attendre."},
"Breach":{c:"SLA",d:"Rupture de SLA : l'échéance est dépassée sans résolution. Une rupture se voit dans le tableau de bord, le rapport hebdo et la notation."},
"On Hold":{c:"SLA",d:"Statut qui gèle le SLA : le chrono s'arrête à la mise en attente et reprend à la sortie. À réserver aux attentes qui ne dépendent pas de nous, et à justifier."},
"Mode calendaire":{c:"SLA",d:"Tous les jours comptent, week-ends compris. C'est le cas des incidents P1 et P2 dans EMOC."},
"Mode ouvré":{c:"SLA",d:"Seuls les jours ouvrés comptent (lundi à vendredi). C'est le cas des incidents P3 et P4 et de la plupart des problèmes."},
"Mode drill":{c:"SLA",d:"Réglage global d'EMOC : seules les heures de 08:30 à 17:30 comptent, soit 9 h par jour. En mode live, toutes les heures comptent (24/7)."},
"Detection Time":{c:"SLA",d:"Le moment où l'équipe a vu l'anomalie. C'est le point de départ du SLA dans EMOC, et la fin du MTTD."},
"Occur Time":{c:"SLA",d:"Le moment où la panne s'est réellement produite (début de l'alarme). L'écart avec Detection Time, c'est le temps de détection."},
"Workaround Date":{c:"SLA",d:"La date à laquelle un contournement a rétabli le service. Pour un Problem Bug, c'est elle qui ferme la première échéance SLA."},
/* Indicateurs */
"MTTD":{c:"Indicateur",d:"Mean Time To Detect : temps moyen entre l'apparition de la panne et sa détection. La cible du Front Office EMOC : 5 minutes au plus.",a:"Le temps de réaction du guetteur."},
"MTTR":{c:"Indicateur",d:"Mean Time To Resolve : temps moyen entre l'ouverture et la résolution. Il mesure la vitesse de rétablissement."},
"Taux SLA":{c:"Indicateur",d:"La part des tickets traités dans les délais. L'objectif d'équipe se règle dans le tracker (page Objectifs)."},
"Backlog":{c:"Indicateur",d:"Les tickets encore ouverts. Un backlog qui grossit de semaine en semaine est un signal à expliquer en revue."},
"Data quality":{c:"Indicateur",d:"La complétude et la cohérence des tickets : champs obligatoires remplis, dates logiques, statut à jour. Un ticket mal rempli fausse tous les indicateurs."},
/* Rôles et outils */
"Front Office":{c:"Rôle",d:"Le niveau 1 d'EMOC, à Dakar et Abidjan : il surveille, détecte, ouvre le ticket, qualifie, fait le premier diagnostic, escalade et suit jusqu'à la clôture.",a:"La tour de contrôle."},
"Back Office":{c:"Rôle",d:"Le niveau d'expertise derrière le Front Office (BO Handling dans le ticket). Il reprend ce que le FO ne peut pas résoudre seul."},
"N2":{c:"Rôle",d:"Le deuxième niveau de support, plus expert. Dans le langage courant de l'équipe, souvent synonyme de Back Office."},
"Escalade fonctionnelle":{c:"Rôle",d:"Passer le ticket à un niveau plus expert (BO, expert produit, éditeur) parce qu'on n'a pas la compétence ou les accès."},
"Escalade hiérarchique":{c:"Rôle",d:"Prévenir le management parce que l'impact, le délai ou le client l'exigent. Elle ne remplace pas l'escalade fonctionnelle, elle s'y ajoute."},
"Coordinateur d'incident":{c:"Rôle",d:"Pendant un incident majeur, la personne qui pilote : elle ne répare pas, elle organise, décide et fait communiquer."},
"OCEANE":{c:"Outil",d:"L'outil de ticketing côté client. Son numéro (Oceane TT#) se reporte dans le ticket EMOC pour relier les deux mondes."},
"IMOC TT":{c:"Outil",d:"La référence du ticket dans l'outil IMOC, quand il existe. À reporter pour pouvoir retrouver l'échange de part et d'autre."},
"DigitalView":{c:"Outil",d:"La plateforme de supervision d'où viennent la plupart des alarmes. Sa formation dédiée est dans le menu DigitalView."},
"Handover":{c:"Outil",d:"La relève entre deux shifts : tickets ouverts, points en cours, consignes. Elle se prépare avant la fin du shift sur le Handover Board."},
"Observation":{c:"Outil",d:"Une remarque datée dans le tracker : anomalie, incident de plateforme, dérive de process. Les Observations alimentent les explications du rapport Dakar × Abidjan."},
"Daily Check-up":{c:"Outil",d:"La liste des vérifications et tâches du jour, avec leurs occurrences récurrentes. Son taux de réalisation entre dans la note de performance."},
"Tempête d'alarmes":{c:"Méthode",d:"Une avalanche d'alarmes en peu de temps, souvent issues d'une seule cause. Le piège : ouvrir un ticket par alarme au lieu de chercher la cause commune."},
"Corrélation":{c:"Méthode",d:"Relier plusieurs alarmes ou incidents à une même cause. C'est ce qui transforme cinquante alarmes en un seul incident bien qualifié."},
"5 pourquoi":{c:"Méthode",d:"Méthode d'analyse : demander « pourquoi ? » à chaque réponse, environ cinq fois, jusqu'à tomber sur une cause sur laquelle on peut agir."},
"Ishikawa":{c:"Méthode",d:"Le diagramme en arête de poisson : on range les causes possibles par famille (matériel, logiciel, réseau, méthode, humain, environnement) pour n'en oublier aucune."},
"Bridge":{c:"Méthode",d:"La conférence ouverte en continu pendant un incident majeur, où se retrouvent les personnes utiles à la résolution."},
/* ITIL 4 */
"Valeur":{c:"ITIL 4",d:"Ce que le client juge utile et important dans un service. Elle se mesure de son côté, pas du côté du fournisseur."},
"Co-création de valeur":{c:"ITIL 4",d:"La valeur se crée à deux : le fournisseur et le client y contribuent chacun. Le client décrit, donne accès, confirme.",a:"Une danse à deux."},
"Output":{c:"ITIL 4",d:"Un livrable produit par une activité : un ticket fermé, un rapport envoyé. À distinguer du résultat obtenu par le client."},
"Résultat":{c:"ITIL 4",d:"Ce que le client obtient grâce au service : un service stable, une décision possible. C'est lui qui compte, plus que le livrable."},
"Utilité":{c:"ITIL 4",d:"Le service fait ce dont le client a besoin : il est adapté à l'usage."},
"Garantie":{c:"ITIL 4",d:"Le service tient ses promesses dans la durée : disponibilité, capacité, sécurité, continuité."},
"Quatre dimensions":{c:"ITIL 4",d:"Organisations et personnes, information et technologie, partenaires et fournisseurs, flux de valeur et processus : quatre angles à vérifier pour tout service."},
"Système de valeur des services":{c:"ITIL 4",d:"La façon dont une organisation transforme une opportunité ou une demande en valeur : principes directeurs, gouvernance, chaîne de valeur, pratiques, amélioration continue."},
"Principes directeurs":{c:"ITIL 4",d:"Sept repères valables partout : privilégier la valeur, commencer là où l'on est, progresser par itérations, collaborer, penser global, rester simple, optimiser puis automatiser."},
"Chaîne de valeur":{c:"ITIL 4",d:"Six activités qui transforment une demande en valeur : planifier, améliorer, s'engager, concevoir et faire la transition, obtenir/construire, délivrer et assurer le support."},
"Flux de valeur":{c:"ITIL 4",d:"Un enchaînement précis d'activités pour un cas donné. Le traitement d'une alarme critique, de la détection au rétablissement, en est un."},
"Pratique":{c:"ITIL 4",d:"Un ensemble de ressources (personnes, outils, process) pour accomplir un type de travail. ITIL 4 en décrit 34."},
"Amélioration continue":{c:"ITIL 4",d:"Améliorer un peu et souvent, à tous les niveaux. Le modèle ITIL suit sept questions, de la vision à l'entretien de l'élan."}
};

/* ── M1 · Les fondamentaux ─────────────────────────────────── */
var M1=[
{id:"f1",t:"Le Front Office EMOC",cards:[
 {i:"RadioTower",h:"La tour de contrôle",p:["Le [[Front Office]] EMOC surveille en continu, à Dakar et à Abidjan, en 3 shifts.","Il voit les alarmes, ouvre les tickets, qualifie, fait le premier diagnostic, escalade et suit jusqu'à la clôture."]},
 {i:"Users",h:"Pas seul",p:["Derrière lui, le [[Back Office]] reprend ce qui demande plus d'expertise.","Devant lui, le client suit ses tickets dans son propre outil, [[OCEANE]]."]},
 {q:"Qui est responsable du suivi d'un ticket jusqu'à sa clôture ?",o:["Le Back Office, dès qu'il est escaladé","Le Front Office, même après escalade","Le client"],a:1,e:"Escalader, c'est demander de l'aide, pas se débarrasser du ticket. Le FO Owner reste le propriétaire du suivi."},
 {i:"Workflow",h:"Pourquoi des process ?",p:["Sans process, chacun fait à sa façon : délais non tenus, informations perdues, client mal informé.","Les process [[ITSM]] donnent à tous le même chemin, le même vocabulaire et les mêmes délais."]},
 {i:"BookOpen",h:"Un vocabulaire commun",p:["Nos process reprennent le vocabulaire d'[[ITIL]] : incident, problème, changement, demande.","Parler la même langue que le client et le Back Office évite les malentendus coûteux."]},
 {q:"Les process ITSM servent d'abord à…",o:["Remplir des formulaires","Faire travailler tout le monde de la même façon, avec les mêmes délais","Contrôler les agents"],a:1,e:"Un process, c'est une façon commune de faire qui protège le service, le client et l'équipe."},
 {r:["Le FO surveille, détecte, ouvre, qualifie, escalade et suit jusqu'à la clôture.","Le BO apporte l'expertise, le FO garde le suivi.","Les process donnent un chemin, un vocabulaire et des délais communs."]}
]},
{id:"f2",t:"Événement, incident, problème, changement",cards:[
 {i:"CircleDot",h:"L'événement",p:["Un changement d'état vu par la supervision.","Pas forcément grave : une bascule réussie, un redémarrage planifié sont des [[Événement|événements]]."]},
 {i:"Siren",h:"L'incident",p:["Le service est interrompu ou dégradé, sans que ce soit prévu.","Objectif : <b>rétablir vite</b>. La cause peut attendre."]},
 {i:"Microscope",h:"Le problème",p:["La cause, encore inconnue, d'un ou plusieurs incidents.","Objectif : <b>que ça ne revienne pas</b>."]},
 {i:"RefreshCcw",h:"Le changement",p:["Une modification volontaire et préparée : mise à jour, configuration, migration.","Objectif : <b>modifier sans casser</b>."]},
 {i:"Inbox",h:"La demande",p:["Une sollicitation standard sans panne : un accès, un export, une information.","Elle ne se traite pas comme un incident et n'a pas son chrono."]},
 {w:"tickets"},
 {q:"Le même lien tombe pour la troisième fois ce mois-ci. On a…",o:["Trois incidents, et c'est tout","Trois incidents, et un problème à ouvrir","Un changement à faire"],a:1,e:"Chaque coupure est un incident à rétablir. La répétition révèle un problème : une cause à trouver."},
 {q:"Un agent demande l'accès à un tableau de bord. C'est…",o:["Un incident P4","Une demande de service","Un problème"],a:1,e:"Rien n'est cassé : c'est une demande standard."},
 {r:["Événement : un changement d'état, pas forcément grave.","Incident : rétablir vite.","Problème : trouver la cause pour que ça ne revienne pas.","Changement : modifier sans casser. Demande : sans panne."]}
]},
{id:"f3",t:"Les types de tickets EMOC",cards:[
 {i:"Ticket",h:"Trois types dans le tracker",p:["<b>Incident</b>, <b>Problem non Bug</b> et <b>Problem Bug</b>.","Le type choisit la grille SLA : se tromper de type, c'est se tromper de délai."]},
 {i:"Siren",h:"Incident",p:["Le cas le plus courant : une panne à rétablir.","Délais courts : 2 h pour un P1, 4 h pour un P2."]},
 {i:"Wrench",h:"Problem non Bug",p:["La cause n'est pas un défaut logiciel : configuration, capacité, matériel, process, erreur humaine.","Une seule échéance, en jours ouvrés."]},
 {i:"Bomb",h:"Problem Bug",p:["La cause est un défaut logiciel, à corriger par l'éditeur ou la R&D.","Deux échéances pour P1 et P2 : un <b>contournement</b> d'abord, la <b>correction définitive</b> ensuite."]},
 {q:"La cause d'un problème est une erreur dans un script de configuration écrit par l'équipe. Type ?",o:["Problem Bug","Problem non Bug","Incident"],a:1,e:"Ce n'est pas un défaut du produit : c'est une erreur de configuration, donc non Bug."},
 {i:"Link",h:"Deux numéros à relier",p:["Le ticket EMOC porte aussi le numéro [[OCEANE]] (Oceane TT#) et, s'il existe, la référence [[IMOC TT]].","Sans ces liens, impossible de retrouver l'échange avec le client."],m:"Un ticket sans numéro OCEANE alors que le client en a ouvert un, c'est une donnée manquante qui se voit en Data Quality."},
 {q:"Pourquoi le choix du type de ticket est-il si important ?",o:["Pour la couleur dans le tableau","Parce qu'il fixe la grille SLA","Parce qu'il désigne le Back Office"],a:1,e:"Incident, Problem non Bug et Problem Bug n'ont pas du tout les mêmes délais."},
 {r:["Trois types : Incident, Problem non Bug, Problem Bug.","Le type fixe la grille SLA.","Problem Bug P1/P2 : contournement puis correction.","Toujours reporter Oceane TT# et IMOC TT#."]}
]}
];

/* ── M2 · Le cycle de vie d'un incident ────────────────────── */
var M2=[
{id:"i1",t:"De l'alarme au ticket",cards:[
 {i:"Eye",h:"Tout commence par voir",p:["La plupart des incidents naissent d'une [[Alarme|alarme]] remontée en supervision, souvent dans [[DigitalView]].","Plus on voit tôt, plus on a de temps pour réparer."]},
 {w:"lifecycle"},
 {i:"Timer",h:"Deux heures à ne pas confondre",p:["<b>[[Occur Time]]</b> : quand la panne commence vraiment.","<b>[[Detection Time]]</b> : quand l'équipe la voit. L'écart entre les deux, c'est le temps de détection."]},
 {i:"Gauge",h:"La cible : 5 minutes",p:["Le [[MTTD]] du Front Office doit rester sous <b>5 minutes</b>.","Au-delà, la panne a couru sans que personne ne s'en occupe."]},
 {q:"L'alarme démarre à 10:00, l'agent la voit à 10:12. Le MTTD de ce ticket est…",o:["0 min, le ticket est ouvert à 10:12","12 min, hors cible","5 min, la valeur par défaut"],a:1,e:"Detection Time moins Occur Time : 12 minutes, au-delà de la cible de 5 min."},
 {i:"Search",h:"Avant d'ouvrir : vérifier",p:["Un ticket existe-t-il déjà pour cette panne ? Est-ce une alarme passagère qui s'est effacée seule ?","Ouvrir un doublon disperse le suivi et gonfle les chiffres."]},
 {q:"Dix alarmes identiques arrivent du même site en deux minutes. Premier réflexe ?",o:["Ouvrir dix tickets","Chercher la cause commune et ouvrir un seul incident","Attendre qu'elles disparaissent"],a:1,e:"C'est souvent une [[Tempête d'alarmes|tempête]] : une cause, un incident, les alarmes rattachées."},
 {r:["Voir vite : la cible MTTD est de 5 min.","Occur Time = début de la panne, Detection Time = moment où on la voit.","Vérifier les doublons avant d'ouvrir.","Une tempête d'alarmes = souvent un seul incident."]}
]},
{id:"i2",t:"Bien enregistrer un ticket",cards:[
 {i:"NotebookPen",h:"Le ticket est un témoin",p:["Il sera lu par le BO, le client, le manager et le rapport hebdo.","Ce qui n'est pas écrit n'existe pas pour eux."]},
 {i:"Type",h:"Un titre qui se suffit",p:["Quoi, où, quel effet. Exemple : <i>« Perte de supervision MMC site Dakar, alarmes non remontées »</i>.","Évite « Problème » ou « Alarme » seul : personne ne sait de quoi il s'agit."]},
 {i:"Layers",h:"Les champs qui comptent",p:["Type, domaine, priorité, sévérité, FO Owner, BO Handling.","Occur Time, Detection Time, Oceane TT#, Alarm Link."]},
 {q:"Quel titre est le plus utile ?",o:["Incident urgent","Alarme DB","Base DB Abidjan saturée, requêtes en échec depuis 09:40"],a:2,e:"Quoi, où, quel effet, depuis quand : tout est lisible sans ouvrir le ticket."},
 {i:"Tag",h:"Le domaine",p:["MMC, HCS, INFRA, SECURITY, LTS, DM, DB.","Le bon domaine envoie le ticket au bon Back Office et alimente la répartition du rapport hebdo."]},
 {i:"Link",h:"Les liens",p:["<b>Alarm Link</b> : la preuve de ce qu'on a vu.","<b>RCA Link</b> : plus tard, l'analyse de cause."],m:"Un ticket bien rempli dès l'ouverture fait gagner un temps précieux à celui qui reprend à la relève."},
 {q:"Un ticket sans Detection Time, c'est…",o:["Sans conséquence","Un SLA impossible à calculer correctement","Normal pour un P4"],a:1,e:"Le SLA d'EMOC part de la détection : sans elle, le chrono est faux."},
 {r:["Le ticket est lu par tout le monde : il doit se suffire.","Titre : quoi, où, quel effet, depuis quand.","Champs clés : type, domaine, priorité, sévérité, dates, Oceane TT#.","Toujours le lien de l'alarme."]}
]},
{id:"i3",t:"Diagnostiquer et résoudre",cards:[
 {i:"Stethoscope",h:"Premier diagnostic",p:["Ce qui a changé récemment ? Un seul site ou plusieurs ? Un seul service ou tous ?","Ces trois questions orientent tout le reste."]},
 {i:"BookMarked",h:"Chercher l'existant",p:["Une [[Erreur connue|erreur connue]] décrit peut-être déjà le cas, avec son contournement.","Un ticket précédent identique donne souvent la solution."]},
 {i:"Hammer",h:"Rétablir d'abord",p:["Le but d'un incident est de rendre le service, pas de comprendre parfaitement.","Un [[Contournement|contournement]] qui rétablit vaut mieux qu'une analyse parfaite pendant que le client attend."]},
 {q:"Le service est rétabli par un redémarrage, mais on ne sait pas pourquoi il était tombé. On…",o:["Laisse le ticket ouvert jusqu'à comprendre","Résout l'incident et ouvre un problème si le risque de récidive existe","Ferme sans rien noter"],a:1,e:"L'incident est résolu quand le service est rendu. La cause, c'est le rôle du problème."},
 {i:"ClipboardList",h:"Noter au fil de l'eau",p:["Chaque action dans Comments : ce qui a été fait, à quelle heure, avec quel résultat.","À la relève ou en escalade, c'est ce journal qui évite de tout refaire."]},
 {i:"TrendingUp",h:"Statut à jour",p:["Open, In Progress, Resolved : le statut doit dire la vérité en temps réel.","Un ticket réparé resté « In Progress » fausse le backlog et le MTTR."]},
 {r:["Trois questions : quoi a changé, où, quoi est touché.","Chercher une erreur connue ou un ticket identique.","Rétablir d'abord, comprendre ensuite (problème).","Journal d'actions et statut toujours à jour."]}
]},
{id:"i4",t:"Clôturer proprement",cards:[
 {i:"CircleCheck",h:"Resolved n'est pas Closed",p:["<b>Resolved</b> : le service est rétabli.","<b>Closed</b> : le client ou le demandeur a confirmé, le ticket est complet."]},
 {i:"ListChecks",h:"Avant de fermer",p:["Close Date renseignée, résolution expliquée, cause notée si elle est connue (RC Category, RC Description).","Oceane TT# aligné avec le statut côté client."]},
 {q:"Le client n'a pas encore confirmé, mais le service semble revenu. Statut ?",o:["Closed","Resolved","On Hold"],a:1,e:"Rétabli mais pas confirmé : Resolved. On ferme après confirmation ou délai convenu."},
 {i:"FolderArchive",h:"La catégorie de cause",p:["Hardware, Software, Network, Configuration, Human Error, Process, Unknown.","Bien remplie, elle montre où se concentrent les causes et nourrit la gestion des problèmes."]},
 {q:"Pourquoi éviter « Unknown » comme catégorie de cause par défaut ?",o:["C'est interdit","Parce qu'elle ne dit rien sur où agir pour éviter la récidive","Elle bloque la clôture"],a:1,e:"Unknown est parfois vrai, mais en masse il empêche toute analyse de tendance."},
 {r:["Resolved = service rétabli. Closed = confirmé et complet.","Avant de fermer : dates, résolution, cause, Oceane aligné.","La catégorie de cause sert l'analyse : éviter Unknown par facilité."]}
]}
];

/* ── M3 · Priorité et SLA ──────────────────────────────────── */
var M3=[
{id:"s1",t:"Impact × urgence = priorité",cards:[
 {i:"Scale",h:"Deux questions",p:["<b>[[Impact]]</b> : qu'est-ce qui est touché, et combien ?","<b>[[Urgence]]</b> : à quelle vitesse ça devient grave si on ne fait rien ?"]},
 {w:"matrix"},
 {i:"Flag",h:"P1 à P4",p:["<b>P1</b> : service majeur coupé, beaucoup d'utilisateurs, pas de contournement.","<b>P4</b> : gêne mineure, contournement simple, aucune urgence."]},
 {q:"Un tableau de bord interne ne s'affiche plus, le service client fonctionne. Priorité probable ?",o:["P1","P2","P3 ou P4"],a:2,e:"Impact faible et pas d'urgence pour le client : P3, voire P4."},
 {q:"Toute la supervision d'un site tombe en heure de pointe. Priorité probable ?",o:["P1","P3","P4"],a:0,e:"Impact large et urgence forte : on ne voit plus rien, des pannes peuvent passer inaperçues."},
 {i:"RefreshCcw",h:"La priorité peut changer",p:["Si l'impact grandit ou diminue, on ajuste la priorité et on le note dans le ticket.","Ne pas changer une priorité pour « sauver » un SLA : c'est visible et ça se paie en confiance."]},
 {r:["Priorité = impact × urgence.","P1 : impact large, urgence forte, pas de contournement.","La priorité s'ajuste avec la situation, jamais pour masquer un retard."]}
]},
{id:"s2",t:"Sévérité ou priorité ?",cards:[
 {i:"Thermometer",h:"La sévérité",p:["Critical, Major, Minor, Warning : la gravité <b>technique</b> de l'alarme.","Elle vient souvent de la supervision."]},
 {i:"Flag",h:"La priorité",p:["P1 à P4 : l'importance <b>pour le service et le client</b>.","C'est elle qui fixe le délai SLA."]},
 {i:"Shuffle",h:"Elles ne se recopient pas",p:["Une alarme Critical sur un équipement de secours inactif peut n'être qu'un P3.","Une alarme Minor sur un service client unique peut justifier un P2."]},
 {q:"Une alarme Critical touche un serveur de test sans utilisateur. Priorité ?",o:["P1, puisque Critical","Plutôt P3 ou P4, l'impact est faible","On ne crée pas de ticket"],a:1,e:"La sévérité informe, mais c'est l'impact réel qui décide de la priorité."},
 {r:["Sévérité = gravité technique (Critical à Warning).","Priorité = importance pour le service (P1 à P4).","On ne recopie pas l'une dans l'autre : on raisonne sur l'impact."]}
]},
{id:"s3",t:"Les délais SLA d'EMOC",cards:[
 {i:"Timer",h:"Le chrono part de la détection",p:["Dans EMOC, le SLA se calcule à partir du <b>[[Detection Time]]</b>.","D'où l'importance d'une détection rapide et d'une heure bien saisie."]},
 {w:"sla"},
 {i:"Siren",h:"Incidents",p:["P1 : <b>2 h</b>, P2 : <b>4 h</b>, en mode calendaire.","P3 : <b>48 h</b>, P4 : <b>72 h</b>, en jours ouvrés."]},
 {i:"Bomb",h:"Problem Bug",p:["P1 : contournement en 72 h ouvrées, correction en 336 h calendaires (14 jours).","P2 : contournement en 120 h ouvrées, correction en 672 h calendaires (28 jours)."]},
 {q:"Quel est le délai d'un incident P2 ?",o:["2 h","4 h","48 h"],a:1,e:"P1 : 2 h, P2 : 4 h, en calendaire."},
 {q:"Un Problem Bug P1 a deux échéances. La première porte sur…",o:["La correction définitive","Le contournement","La clôture côté client"],a:1,e:"D'abord rétablir avec un contournement (72 h ouvrées), puis corriger pour de bon."},
 {r:["Le SLA part de la Detection Time.","Incidents : P1 2 h, P2 4 h (calendaire), P3 48 h, P4 72 h (ouvré).","Problem Bug P1/P2 : contournement puis correction."]}
]},
{id:"s4",t:"Calendaire, ouvré, drill",cards:[
 {i:"CalendarDays",h:"Calendaire",p:["Tous les jours comptent, week-ends compris.","C'est le cas des incidents P1 et P2 : une coupure le samedi reste urgente."]},
 {i:"Calendar",h:"Ouvré",p:["Seuls les jours du lundi au vendredi comptent.","C'est le cas des P3, P4 et de la plupart des problèmes."]},
 {i:"Clock",h:"Drill ou live",p:["En <b>[[Mode drill|drill]]</b>, seules les heures de 08:30 à 17:30 comptent : 9 h par jour.","En <b>live</b>, toutes les heures comptent, 24 h sur 24."]},
 {w:"clock"},
 {q:"En mode drill et jours ouvrés, un P3 de 48 h ouvert le lundi à 08:30 tombe à échéance…",o:["Le mercredi 08:30","Environ 5 jours ouvrés plus tard (48 h / 9 h par jour)","Le lundi suivant 08:30 exactement"],a:1,e:"48 h à raison de 9 h par jour, c'est un peu plus de 5 jours ouvrés."},
 {r:["Calendaire : tous les jours. Ouvré : lundi à vendredi.","Drill : 08:30-17:30 seulement (9 h/jour). Live : 24/7.","Le réglage change complètement l'échéance réelle."]}
]},
{id:"s5",t:"Near Breach, Breach et On Hold",cards:[
 {i:"Hourglass",h:"Near Breach",p:["Il reste moins de <b>20 %</b> du temps SLA.","C'est l'alerte orange : le moment d'escalader, pas d'attendre."]},
 {i:"OctagonX",h:"Breach",p:["L'échéance est dépassée.","La rupture se voit partout : tableau de bord, rapport hebdo, notation de l'équipe."]},
 {q:"Un P2 (4 h) est ouvert depuis 3 h 20. Son état SLA ?",o:["In SLA","Near Breach","Breach"],a:1,e:"Il reste 40 min sur 4 h, soit moins de 20 % : Near Breach."},
 {i:"Hand",h:"On Hold gèle le chrono",p:["Le SLA s'arrête à la mise [[On Hold]] et reprend à la sortie.","Un ticket gelé n'est jamais compté en rupture tant qu'il reste gelé."]},
 {i:"TriangleAlert",h:"On Hold n'est pas un parking",p:["À réserver aux attentes qui ne dépendent pas de nous : retour du client, accès refusé, intervention planifiée chez un tiers.","Toujours écrire pourquoi, et qui doit agir. Un On Hold injustifié se voit à la revue."],m:"Le tracker garde chaque période d'attente. Mettre un ticket On Hold pour sauver un SLA se retrouve dans l'historique."},
 {w:"status"},
 {q:"On attend la réponse d'un collègue du BO pour avancer. On Hold ?",o:["Oui, c'est une attente","Non, le BO fait partie de la chaîne de résolution","Oui, si le SLA est presque dépassé"],a:1,e:"Le BO, c'est nous : cette attente ne gèle pas le SLA. On Hold sert aux attentes extérieures."},
 {r:["Near Breach : moins de 20 % du temps restant, il faut escalader.","Breach : échéance dépassée, visible partout.","On Hold gèle le SLA, seulement pour une attente extérieure justifiée."]}
]}
];

/* ── M4 · Escalade et communication ─────────────────────────── */
var M4=[
{id:"e1",t:"Quand escalader",cards:[
 {i:"TrendingUp",h:"Escalader n'est pas un échec",p:["C'est reconnaître qu'un autre niveau peut aller plus vite.","Le vrai échec, c'est la rupture de SLA alors qu'on aurait pu demander de l'aide."]},
 {i:"AlarmClock",h:"Les déclencheurs",p:["Un <b>P1</b> : on escalade tout de suite, en parallèle du diagnostic.","Un ticket en <b>[[Near Breach]]</b> : on escalade sans attendre la rupture."]},
 {i:"LockKeyhole",h:"Hors de portée",p:["Pas les accès, pas la compétence, pas l'autorisation de toucher.","Plus vite on le reconnaît, plus vite le bon niveau prend la main."]},
 {q:"Un P1 arrive. Quand prévenir le Back Office ?",o:["Après 1 h de diagnostic","Tout de suite, en parallèle du diagnostic","Seulement si on n'a pas trouvé"],a:1,e:"Sur un P1 de 2 h, attendre une heure, c'est déjà consommer la moitié du délai."},
 {q:"Un P3 est en Near Breach et rien ne bouge. On…",o:["Attend la rupture pour justifier l'escalade","Escalade maintenant et le note dans le ticket","Le met On Hold"],a:1,e:"Near Breach est précisément le signal d'escalade."},
 {r:["Escalader tôt protège le service et le SLA.","P1 : escalade immédiate. Near Breach : escalade sans attendre.","Pas d'accès ou de compétence : on escalade, on ne bricole pas."]}
]},
{id:"e2",t:"Vers qui escalader",cards:[
 {w:"escalation"},
 {i:"Network",h:"Escalade fonctionnelle",p:["On passe la main à plus expert : [[Back Office]], expert produit, éditeur.","Le ticket change de mains techniques, le FO Owner garde le suivi."]},
 {i:"Briefcase",h:"Escalade hiérarchique",p:["On prévient le management : impact client fort, délai menacé, besoin d'arbitrage.","Elle s'ajoute à l'escalade fonctionnelle, elle ne la remplace pas."]},
 {q:"Un P1 menace de dépasser son SLA malgré le BO mobilisé. On ajoute…",o:["Une escalade hiérarchique","Un deuxième ticket","Rien, le BO s'en occupe"],a:0,e:"Le délai est menacé et l'impact est fort : le management doit être au courant pour arbitrer."},
 {i:"Handshake",h:"Le BO Handling",p:["Le champ BO Handling dit qui, au Back Office, porte l'action.","Sans lui, personne ne sait à qui relancer."]},
 {r:["Fonctionnelle : vers plus expert. Hiérarchique : vers le management.","Les deux se combinent sur un P1 menacé.","Toujours renseigner BO Handling : on doit savoir qui relancer."]}
]},
{id:"e3",t:"Écrire une bonne mise à jour",cards:[
 {i:"Send",h:"Une mise à jour utile",p:["<b>Constat</b> : ce qu'on voit.","<b>Impact</b> : ce qui est touché. <b>Actions</b> : ce qui a été fait. <b>Prochaine étape</b> : quoi et quand."]},
 {i:"Mail",h:"Un exemple",p:["<i>« 10:40 · Perte de supervision MMC Dakar depuis 10:22. Alarmes non remontées sur 3 sites. Redémarrage du collecteur sans effet. Escaladé au BO (M. X). Prochain point 11:10. »</i>"]},
 {q:"Quel élément manque le plus souvent dans une mise à jour ?",o:["Le nom de l'agent","La prochaine étape et son heure","La couleur de la priorité"],a:1,e:"Sans prochaine échéance, le client et le manager ne savent pas quand revenir."},
 {i:"Clock",h:"Le rythme",p:["Sur un P1 : un point toutes les 30 minutes, même pour dire « rien de nouveau ».","Le silence inquiète plus qu'une mauvaise nouvelle."]},
 {i:"Smartphone",h:"Pour le client",p:["Des mots simples, l'impact pour lui, l'heure du prochain point.","Le détail technique reste dans le ticket."]},
 {r:["Constat, impact, actions, prochaine étape avec heure.","P1 : un point toutes les 30 min, même sans nouvelle.","Au client : simple, centré sur l'impact, avec le prochain rendez-vous."]}
]}
];

/* ── M5 · Incident majeur ───────────────────────────────────── */
var M5=[
{id:"x1",t:"Reconnaître un incident majeur",cards:[
 {i:"Siren",h:"Plus qu'un P1",p:["Un [[Incident majeur|incident majeur]] touche un service clé, beaucoup d'utilisateurs ou plusieurs sites.","Il demande une organisation à part : on ne le traite pas comme un ticket ordinaire."]},
 {i:"TriangleAlert",h:"Les signes",p:["Plusieurs domaines touchés en même temps, un site entier sans supervision, un service client coupé.","Le client appelle déjà, ou va appeler."]},
 {q:"Lequel est le plus probablement un incident majeur ?",o:["Un disque à 85 % sur un serveur de logs","Perte de supervision de tous les sites d'Abidjan","Une alarme Warning répétée"],a:1,e:"Tout un site aveugle, c'est un risque massif : des pannes peuvent passer inaperçues."},
 {i:"Flag",h:"Le déclarer",p:["Mieux vaut déclarer trop tôt que trop tard.","Une fois déclaré, l'organisation se met en place : coordinateur, bridge, rythme de communication."]},
 {r:["Incident majeur : service clé, impact large, plusieurs sites ou domaines.","Le déclarer tôt.","Il déclenche une organisation dédiée."]}
]},
{id:"x2",t:"Les rôles et le bridge",cards:[
 {i:"Phone",h:"Le bridge",p:["Une conférence ouverte en continu où se retrouvent les personnes utiles.","Pas tout le monde : trop de monde ralentit les décisions."]},
 {w:"major"},
 {i:"UserCheck",h:"Un seul coordinateur",p:["Le [[Coordinateur d'incident|coordinateur]] ne répare pas : il organise, décide et fait communiquer.","Deux pilotes, c'est zéro pilote."]},
 {q:"Pendant un incident majeur, le coordinateur doit surtout…",o:["Réparer lui-même","Organiser, décider et faire communiquer","Rédiger le rapport final"],a:1,e:"Il garde la vue d'ensemble pendant que les experts réparent."},
 {i:"ScrollText",h:"Le scribe",p:["Quelqu'un note tout avec l'heure : actions, décisions, résultats.","Cette chronologie sera la base de la revue après coup."]},
 {r:["Un bridge avec les bonnes personnes, pas toutes.","Un seul coordinateur, qui pilote sans réparer.","Un scribe qui horodate tout."]}
]},
{id:"x3",t:"Communiquer pendant la crise",cards:[
 {i:"Clock",h:"Un rythme fixe",p:["Toutes les 30 minutes, même sans nouvelle.","Chaque message annonce l'heure du suivant."]},
 {i:"Users",h:"Des messages par public",p:["L'équipe technique : le détail.","Le management : impact, risque, décisions attendues.","Le client : impact pour lui, avancement, prochain point."]},
 {q:"Il n'y a rien de nouveau depuis 30 minutes. On…",o:["Ne dit rien pour ne pas inquiéter","Envoie quand même un point : en cours, prochaine étape, prochain point","Attend d'avoir une bonne nouvelle"],a:1,e:"Le silence est la pire communication : il laisse imaginer le pire."},
 {i:"CircleCheck",h:"La fin de crise",p:["Annoncer le rétablissement, ce qui reste à surveiller, et que la revue suivra.","Garder une surveillance renforcée quelques heures."]},
 {r:["Un point toutes les 30 min, avec l'heure du suivant.","Un message adapté à chaque public.","Annoncer clairement la fin et la surveillance qui suit."]}
]},
{id:"x4",t:"Après la crise",cards:[
 {i:"History",h:"La revue (PIR)",p:["Dans les jours qui suivent : chronologie, ce qui a marché, ce qui n'a pas marché, actions.","C'est la [[PIR]]."]},
 {i:"Handshake",h:"Sans coupable",p:["On cherche ce qui, dans le process ou l'outil, a permis l'erreur, pas qui l'a faite.","Une revue qui cherche un coupable apprend aux gens à cacher."]},
 {q:"Le but premier d'une revue post-incident est…",o:["Trouver le responsable","Comprendre et éviter que ça se reproduise","Remplir le rapport mensuel"],a:1,e:"Apprendre, sans chercher de coupable : c'est ce qui rend les revues utiles."},
 {i:"Microscope",h:"Et souvent un problème",p:["Si la cause n'est pas encore comprise, on ouvre un problème.","Les actions de la revue se suivent comme des actions convenues, avec porteur et date."]},
 {r:["Une PIR dans les jours qui suivent.","Sans coupable : on corrige le process, pas la personne.","Cause inconnue : un problème. Actions : porteur et date."]}
]}
];

/* ── M6 · Problem management ────────────────────────────────── */
var M6=[
{id:"p1",t:"De l'incident au problème",cards:[
 {i:"Repeat",h:"Quand ouvrir un problème",p:["Un incident qui revient, ou un incident majeur dont on ne connaît pas la cause.","Ou une tendance vue dans les chiffres : un domaine qui revient sans cesse."]},
 {i:"Telescope",h:"Réactif ou proactif",p:["<b>Réactif</b> : après des incidents.","<b>Proactif</b> : avant, à partir des tendances, des Observations, des alarmes répétées."]},
 {q:"Le même incident est revenu 4 fois en deux semaines. On…",o:["Continue de le résoudre à chaque fois","Ouvre un problème pour en trouver la cause","Baisse sa priorité"],a:1,e:"La répétition est le signal classique d'un problème à traiter."},
 {i:"Link",h:"Relier les incidents",p:["Le problème regroupe les incidents qui partagent la même cause.","On voit alors le vrai coût de la panne répétée."]},
 {r:["Problème : incident répété, majeur sans cause, ou tendance.","Réactif après, proactif avant.","Relier tous les incidents liés au problème."]}
]},
{id:"p2",t:"Problem Bug ou non Bug",cards:[
 {i:"Bomb",h:"Bug",p:["La cause est un défaut du logiciel. Seul l'éditeur ou la R&D peut corriger.","On vise d'abord un contournement, puis la correction."]},
 {i:"Wrench",h:"Non Bug",p:["Configuration, capacité, matériel, réseau, process, erreur humaine.","Souvent corrigeable par nos équipes ou le client."]},
 {q:"Un disque se remplit chaque mois faute de purge planifiée. Type ?",o:["Problem Bug","Problem non Bug","Incident"],a:1,e:"Pas de défaut logiciel : une purge manquante, donc configuration ou process."},
 {i:"Timer",h:"Des délais différents",p:["Non Bug : P1 72 h, P2 120 h, P3 336 h, P4 1 080 h, en ouvré.","Bug P1 et P2 : contournement puis correction en calendaire."]},
 {q:"Un Problem Bug P2 : combien d'échéances ?",o:["Une","Deux : contournement puis correction","Aucune, il dépend de l'éditeur"],a:1,e:"Pour P1 et P2, contournement d'abord (ouvré), correction ensuite (calendaire)."},
 {r:["Bug : défaut logiciel, éditeur ou R&D.","Non Bug : configuration, capacité, matériel, process, humain.","Bug P1/P2 : deux échéances."]}
]},
{id:"p3",t:"Trouver la cause racine",cards:[
 {i:"Microscope",h:"Symptôme, cause, cause racine",p:["Symptôme : le service est lent. Cause : la base est saturée.","Cause racine : aucune purge n'est planifiée. C'est elle qu'il faut corriger."]},
 {w:"whys"},
 {i:"Puzzle",h:"Ishikawa",p:["Ranger les causes possibles par famille : matériel, logiciel, réseau, méthode, humain, environnement.","On n'oublie aucune piste avant de conclure."]},
 {q:"Quand s'arrêter dans les 5 pourquoi ?",o:["Exactement au cinquième","Quand on tombe sur une cause sur laquelle on peut agir","Quand on trouve un coupable"],a:1,e:"Cinq est un repère. On s'arrête sur une cause actionnable, jamais sur une personne."},
 {i:"FolderOpen",h:"Dans le ticket",p:["RC Category, RC Description, RCA Link.","Bien remplies, elles permettent de voir les tendances de causes dans le temps."]},
 {r:["Corriger la cause racine, pas le symptôme.","5 pourquoi : jusqu'à une cause actionnable.","Ishikawa : n'oublier aucune famille de cause.","Tout se note : RC Category, RC Description, RCA Link."]}
]},
{id:"p4",t:"Erreur connue et contournement",cards:[
 {i:"BookMarked",h:"L'erreur connue",p:["Cause identifiée et documentée, avec son contournement.","Elle fait gagner un temps énorme sur les incidents suivants."]},
 {i:"Hammer",h:"Le contournement",p:["Il rétablit sans supprimer la cause.","Sa date se note dans [[Workaround Date]] : pour un Problem Bug, c'est elle qui ferme la première échéance."]},
 {q:"Un contournement est en place. Le problème est-il terminé ?",o:["Oui","Non, la cause est toujours là","Oui, si le client est satisfait"],a:1,e:"Le contournement soulage, il ne guérit pas. Le problème vit jusqu'à la correction."},
 {i:"Library",h:"Les partager",p:["Une erreur connue que personne ne trouve ne sert à rien.","La partager à la relève, en session de partage, dans la base de connaissance de l'équipe."]},
 {r:["Erreur connue : cause documentée + contournement.","Contournement : rétablit, ne guérit pas.","Workaround Date ferme la première échéance d'un Problem Bug.","Partager les erreurs connues à toute l'équipe."]}
]}
];

/* ── M7 · Changements et demandes ───────────────────────────── */
var M7=[
{id:"c1",t:"Les types de changement",cards:[
 {i:"RefreshCcw",h:"Pourquoi encadrer",p:["Une grande partie des incidents suit un changement.","Préparer, approuver et planifier réduit fortement ce risque."]},
 {i:"ListChecks",h:"Standard",p:["Fréquent, faible risque, procédure connue et pré-approuvée.","Exemple : une purge planifiée selon la procédure habituelle."]},
 {i:"ClipboardList",h:"Normal",p:["Évalué au cas par cas, approuvé par le [[CAB]], planifié.","Exemple : une montée de version."]},
 {i:"Zap",h:"Urgent",p:["Nécessaire pour rétablir ou protéger le service, tout de suite.","Approbation accélérée, mais tracée."]},
 {q:"Une correction à appliquer immédiatement pour arrêter un incident P1 est un changement…",o:["Standard","Normal","Urgent"],a:2,e:"Il faut agir maintenant pour rétablir : c'est un changement urgent, approuvé en accéléré."},
 {i:"Ban",h:"Le gel",p:["En [[Gel des changements|période de gel]], seuls les changements urgents passent.","La fin d'année en est une classique."]},
 {r:["Standard : pré-approuvé. Normal : CAB. Urgent : accéléré mais tracé.","Beaucoup d'incidents suivent un changement.","Période de gel : seulement l'urgent."]}
]},
{id:"c2",t:"Changement et incident",cards:[
 {i:"Search",h:"Le premier réflexe",p:["Face à un incident : « qu'est-ce qui a changé récemment ? »","Un changement de la veille est souvent la piste la plus rapide."]},
 {i:"RotateCcw",h:"Le retour arrière",p:["Un changement bien préparé a son plan de retour arrière.","S'il casse le service, revenir en arrière est souvent le rétablissement le plus rapide."]},
 {q:"Un service se dégrade juste après une mise à jour de configuration. Piste prioritaire ?",o:["Une panne matérielle","La mise à jour, avec retour arrière si besoin","Une attaque"],a:1,e:"La coïncidence dans le temps est le premier indice."},
 {i:"Eye",h:"Surveiller après",p:["Après un changement, le FO surveille de près le périmètre touché.","Une alarme dans l'heure qui suit est à relier au changement."]},
 {r:["Incident : chercher ce qui a changé.","Retour arrière : souvent le plus rapide pour rétablir.","Surveillance renforcée après chaque changement."]}
]},
{id:"c3",t:"Les demandes de service",cards:[
 {i:"Inbox",h:"Pas une panne",p:["Un accès, un export, une information, une modification standard.","Elle suit un circuit prévu et n'a pas le chrono d'un incident."]},
 {q:"Pourquoi ne pas ouvrir les demandes comme des incidents ?",o:["Parce que c'est plus long","Parce qu'elles faussent les indicateurs d'incident et le SLA","Parce qu'elles ne sont pas importantes"],a:1,e:"Une demande enregistrée en incident gonfle les volumes et fausse le taux SLA."},
 {i:"ListOrdered",h:"Les traiter bien",p:["Comprendre ce qui est attendu, vérifier l'autorisation, exécuter, confirmer.","Une demande traitée vite et bien construit la confiance."]},
 {r:["Demande : pas de panne, circuit standard.","Ne pas la déguiser en incident.","Comprendre, vérifier, exécuter, confirmer."]}
]}
];

/* ── M8 · Le quotidien du FO ────────────────────────────────── */
var M8=[
{id:"q1",t:"La relève (handover)",cards:[
 {i:"Repeat",h:"Le moment fragile",p:["Trois shifts par jour à Dakar et à Abidjan : autant de passages de relais.","C'est là que les informations se perdent le plus."]},
 {w:"handover"},
 {i:"ClipboardList",h:"Ce qu'on transmet",p:["Les tickets ouverts et leur prochaine étape, les P1/P2 en cours, les escalades en attente.","Les consignes particulières et ce qui est à surveiller."]},
 {q:"Quand préparer le handover ?",o:["Après la fin du shift","Avant la fin du shift, pour le présenter à l'heure","Seulement s'il y a eu un P1"],a:1,e:"Préparé avant, il est complet. Fait à la hâte après, il oublie toujours quelque chose."},
 {i:"Gauge",h:"Il compte",p:["Un handover complet à chaque rotation fait partie du critère Process & handover de la notation.","Le Handover Board du tracker sert à le tenir."]},
 {r:["La relève est le moment où l'information se perd.","Transmettre : tickets ouverts, P1/P2, escalades, consignes.","Préparer avant la fin du shift, sur le Handover Board."]}
]},
{id:"q2",t:"Observations et check-up",cards:[
 {i:"NotebookPen",h:"L'Observation",p:["Une remarque datée : anomalie, incident de plateforme, procédure qui coince.","Source (SN ou CI), impact, solution proposée, priorité."]},
 {i:"Link",h:"Elle sert au rapport",p:["Le rapport Dakar × Abidjan reprend les Observations pour expliquer les pics et les incidents de plateforme.","Une Observation bien écrite, c'est une explication déjà prête pour la revue."]},
 {q:"Une panne de courant brève sur le site secondaire, bascule réussie. On…",o:["Ne note rien, tout va bien","Ajoute une Observation avec l'impact et ce qui a été fait","Ouvre un P1"],a:1,e:"Pas d'incident client, mais un fait à garder : il expliquera peut-être un pic d'alarmes."},
 {i:"ListChecks",h:"Le Daily Check-up",p:["Les vérifications et tâches du jour, dont les récurrentes.","Son taux de réalisation compte dans la note de performance (critère Tasks)."]},
 {r:["Observation : date, source, impact, solution, priorité.","Elle alimente les explications du rapport hebdo.","Le Daily Check-up se tient : il compte dans la note."]}
]},
{id:"q3",t:"Qualité des données et indicateurs",cards:[
 {i:"Database",h:"Des chiffres qui disent vrai",p:["Le taux SLA, le MTTD, le MTTR, le backlog : tout part des tickets.","Un ticket mal rempli fausse les chiffres de toute l'équipe."]},
 {i:"ChartColumn",h:"Les indicateurs suivis",p:["[[Taux SLA]], ruptures, [[MTTD]] (cible 5 min), [[MTTR]], [[Backlog|backlog]].","Ils sont comparés Dakar et Abidjan chaque semaine."]},
 {q:"Un ticket résolu mais resté « In Progress » fausse surtout…",o:["Le nombre d'agents","Le backlog et le MTTR","La priorité"],a:1,e:"Il compte encore comme ouvert et allonge artificiellement le temps de résolution."},
 {i:"ShieldCheck",h:"Les réflexes",p:["Dates cohérentes (détection après l'occurrence, clôture après l'ouverture), statut à jour, champs clés remplis.","La page Data Quality du tracker liste ce qui manque."]},
 {r:["Tous les indicateurs partent des tickets.","MTTD cible 5 min, MTTR, taux SLA, ruptures, backlog.","Dates cohérentes, statut à jour, champs clés remplis."]}
]},
{id:"q4",t:"Le weekly Dakar × Abidjan",cards:[
 {i:"Users",h:"Deux équipes, une revue",p:["Chaque semaine, les chiffres des deux sites sont présentés côte à côte.","Le but n'est pas d'opposer, c'est d'apprendre de l'autre."]},
 {i:"TrendingUp",h:"Tout pic s'explique",p:["Un pic d'activité, des absences ou un incident de plateforme doivent être expliqués avant l'export du deck.","Une explication vient souvent d'une Observation bien écrite."]},
 {q:"Un jour à 4 tickets alors que l'habitude est de 1 par jour. Dans le deck…",o:["On ne dit rien","Il faut l'expliquer, ou indiquer que ce n'est pas nécessaire","On supprime les tickets"],a:1,e:"Le deck exige une explication pour chaque pic, ou la décision explicite de passer."},
 {r:["Les deux sites côte à côte, pour apprendre l'un de l'autre.","Pics, absences, incidents de plateforme : à expliquer.","Les Observations préparent les explications."]}
]}
];

/* ── M9 · Cas pratiques ─────────────────────────────────────── */
var M9=[
{id:"k1",t:"3 h du matin, un P1",cards:[
 {i:"Moon",h:"La situation",p:["Shift de nuit à Dakar. À 03:05, toutes les alarmes d'un site client disparaissent d'un coup.","Le tableau de bord est étrangement calme."]},
 {q:"Premier réflexe ?",o:["Se réjouir du calme","Suspecter une perte de supervision et vérifier la remontée des alarmes","Attendre le shift du matin"],a:1,e:"Un silence soudain est souvent une perte de visibilité, pas une bonne nouvelle."},
 {i:"Siren",h:"C'est confirmé",p:["La collecte du site est arrêtée : plus aucune alarme ne remonte.","Le site entier est aveugle."]},
 {q:"Quelle priorité ?",o:["P3, rien n'est cassé côté client","P1, un site entier sans supervision","P4"],a:1,e:"Tout incident pourrait passer inaperçu : impact large, urgence forte."},
 {q:"Et maintenant ?",o:["Diagnostiquer seul pendant 1 h","Ouvrir le P1, escalader tout de suite au BO, prévenir l'astreinte management","Envoyer un mail au client et attendre"],a:1,e:"P1 : ticket, escalade immédiate, et l'information au management. Le diagnostic continue en parallèle."},
 {i:"Clock",h:"La suite",p:["Un point toutes les 30 minutes, une Observation à la fin du shift, un handover complet.","Le matin, la revue saura exactement ce qui s'est passé."]},
 {r:["Un calme soudain : suspecter une perte de visibilité.","Site aveugle : P1.","P1 : ticket, escalade immédiate, management prévenu, points réguliers."]}
]},
{id:"k2",t:"La tempête d'alarmes",cards:[
 {i:"Waves",h:"La situation",p:["En 3 minutes, 60 alarmes arrivent de 12 équipements du même site.","Plusieurs agents commencent à ouvrir des tickets."]},
 {q:"Que faire en premier ?",o:["Ouvrir un ticket par alarme","Arrêter, chercher le point commun (site, lien, alimentation)","Effacer les alarmes"],a:1,e:"60 alarmes en 3 minutes sur un même site : très probablement une cause commune."},
 {i:"Network",h:"Le point commun",p:["Tous les équipements passent par le même lien de transmission, en panne.","C'est la [[Corrélation|corrélation]] qui le révèle."]},
 {q:"Combien de tickets ?",o:["60","12","Un incident sur le lien, les alarmes rattachées"],a:2,e:"Un incident bien qualifié vaut mieux que soixante tickets qui se marchent dessus."},
 {r:["Tempête : s'arrêter et chercher la cause commune.","Corréler : site, lien, alimentation, changement récent.","Un incident, les alarmes rattachées."]}
]},
{id:"k3",t:"L'incident qui revient",cards:[
 {i:"Repeat",h:"La situation",p:["Chaque lundi matin, la base DB d'Abidjan sature et les requêtes échouent.","Chaque fois, un redémarrage règle tout."]},
 {q:"Qu'est-ce qui manque ?",o:["Un redémarrage plus rapide","Un problème pour trouver la cause","Une priorité plus haute"],a:1,e:"Le redémarrage soigne le symptôme. La répétition appelle un problème."},
 {i:"Microscope",h:"Les 5 pourquoi",p:["La base sature. Pourquoi ? Les journaux remplissent le disque. Pourquoi ? La purge du week-end ne tourne pas.","Pourquoi ? Elle a été désactivée lors d'une mise à jour et jamais réactivée."]},
 {q:"Type de problème ?",o:["Problem Bug","Problem non Bug","Ce n'est pas un problème"],a:1,e:"Cause : une configuration oubliée après un changement. Pas de défaut logiciel."},
 {r:["Incident répété : ouvrir un problème.","5 pourquoi jusqu'à une cause actionnable.","Ici : non Bug, et une leçon pour les changements (vérifier après)."]}
]},
{id:"k4",t:"Le ticket oublié en On Hold",cards:[
 {i:"Hourglass",h:"La situation",p:["Un P3 est On Hold depuis 9 jours, sans commentaire.","Personne ne sait ce qu'on attend, ni de qui."]},
 {q:"Qu'est-ce qui ne va pas ?",o:["Rien, le SLA est gelé","On Hold sans raison ni porteur : le ticket est abandonné","Il fallait le passer P4"],a:1,e:"Le SLA est gelé, mais le client, lui, attend toujours. On Hold doit dire pourquoi et qui doit agir."},
 {i:"ListChecks",h:"Les bons réflexes",p:["Écrire la raison et le porteur de l'attente, avec une date de relance.","Relancer à la date prévue, et sortir de On Hold dès que l'attente est levée."]},
 {q:"L'attente était un retour du BO. Le On Hold était-il justifié ?",o:["Oui","Non, le BO fait partie de la chaîne de résolution","Oui, si le BO est d'accord"],a:1,e:"Une attente interne ne gèle pas le SLA. On Hold est pour les attentes extérieures."},
 {r:["On Hold : raison, porteur, date de relance.","Jamais pour une attente interne (BO).","Sortir de On Hold dès que l'attente est levée."]}
]}
];

/* ── Modules ───────────────────────────────────────────────── */
var POSE={wave:'Sparkles',happy:'Trophy',think:'CircleHelp',oops:'CircleX',point:'Pin'};
function mascot(pose,icn){return '<span class="mascot illus illus-'+(pose||'wave')+'" aria-hidden="true">'+ico(icn||POSE[pose]||'Sparkles',48,1.6)+'</span>'}
var M10=[
{id:"i1",t:"ITIL 4 en deux minutes",cards:[
 {i:"BookOpen",h:"Un guide, pas un règlement",p:["[[ITIL]] 4 rassemble les bonnes pratiques de gestion des services numériques.","On ne l'applique pas à la lettre : on prend ce qui sert, et on l'adapte à son contexte."]},
 {i:"Layers",h:"Deux idées pour tout tenir",p:["Le [[Système de valeur des services|système de valeur des services]] montre comment une demande devient de la valeur.","Les [[Quatre dimensions|quatre dimensions]] rappellent tout ce qu'il faut regarder pour qu'un service marche vraiment."]},
 {q:"Chez EMOC, comment utiliser ITIL 4 ?",o:["En appliquant chaque pratique telle qu'écrite","En reprenant ce qui aide l'équipe et en l'adaptant à nos outils","Uniquement pour la certification"],a:1,e:"ITIL 4 se veut souple : on part de ce qui existe et on adopte ce qui améliore le service."},
 {i:"Handshake",h:"Ce qui change avec la version 4",p:["Le centre de gravité passe des process à la [[Valeur|valeur]] créée avec le client.","Agilité, DevOps, automatisation et travail en équipe y ont toute leur place."]},
 {r:["ITIL 4 : un guide de bonnes pratiques, à adapter.","Deux piliers : le système de valeur des services et les quatre dimensions.","Le but n'est pas le process, c'est la valeur pour le client."]}
]},
{id:"i2",t:"La valeur se crée à deux",cards:[
 {i:"Sparkles",h:"La valeur",p:["C'est ce que le client juge utile et important dans le service, pas ce que le fournisseur pense avoir livré.","Elle se mesure du côté de celui qui consomme le service."]},
 {i:"Users",h:"Co-créée",p:["Le fournisseur ne crée pas la valeur seul : le client y contribue.","Chez EMOC, le client décrit l'impact, donne les accès, confirme le rétablissement. Sans lui, pas de résolution rapide."]},
 {q:"Qui crée la valeur d'un service ?",o:["Le fournisseur seul","Le fournisseur et le client, ensemble","Le client seul"],a:1,e:"C'est la [[Co-création de valeur|co-création de valeur]] : chacun apporte sa part."},
 {i:"Target",h:"Livrable ou résultat ?",p:["Un [[Output|livrable]] est ce que l'on produit : un ticket fermé, un rapport envoyé.","Un [[Résultat|résultat]] est ce que le client obtient : son service qui tourne, une décision qu'il peut prendre."]},
 {q:"Un P2 est fermé dans les temps, mais le client subit encore des coupures. Qu'a-t-on livré ?",o:["Un résultat","Un livrable, sans le résultat attendu","Les deux"],a:1,e:"Le ticket fermé est un livrable. Le résultat, c'est un service stable : il n'est pas atteint."},
 {i:"Scale",h:"Coûts et risques",p:["Un service retire au client des coûts et des risques (il n'a pas à superviser lui-même).","Il lui en impose aussi : le prix, la dépendance à un prestataire. La valeur, c'est le bilan des deux."]},
 {r:["La valeur se juge côté client.","Elle se co-crée : le client a sa part dans la résolution.","Un ticket fermé est un livrable ; un service stable est un résultat."]}
]},
{id:"i3",t:"Utilité, garantie et offre",cards:[
 {i:"Puzzle",h:"L'utilité",p:["Le service répond-il au besoin ? C'est l'[[Utilité|utilité]], « adapté à l'usage ».","Exemple : la supervision voit bien les alarmes des équipements du client."]},
 {i:"ShieldCheck",h:"La garantie",p:["Le service tient-il ses promesses dans la durée ? C'est la [[Garantie|garantie]].","Disponibilité, capacité, sécurité, continuité : la supervision tourne de jour comme de nuit, même en cas de panne d'un site."]},
 {q:"La supervision détecte bien les pannes, mais l'outil tombe deux heures par semaine. Qu'est-ce qui manque ?",o:["L'utilité","La garantie","Les deux"],a:1,e:"Le service fait ce qu'il faut (utilité), mais pas de façon fiable (garantie). Il faut les deux pour créer de la valeur."},
 {i:"Package",h:"L'offre de service",p:["Ce que le fournisseur propose, sous forme de biens, d'accès à des ressources et d'actions.","Pour EMOC : l'accès au suivi des tickets, la supervision 24/7, les escalades et les rapports."]},
 {i:"Handshake",h:"La relation de service",p:["Fournir, consommer, et gérer la relation entre les deux.","Les points réguliers avec le client et le reporting font partie de la relation, pas du décor."]},
 {r:["Utilité : le service sert. Garantie : il sert de façon fiable.","Sans l'une ou l'autre, pas de valeur.","L'offre réunit biens, accès et actions ; la relation se gère aussi."]}
]},
{id:"i4",t:"Les quatre dimensions",cards:[
 {i:"Compass",h:"Regarder partout",p:["Un service ne tient pas seulement à l'outil.","ITIL 4 propose quatre angles à vérifier pour tout service ou tout changement."]},
 {w:"dims"},
 {q:"On installe un nouvel outil de supervision, sans former l'équipe. Quelle dimension est oubliée ?",o:["Information et technologie","Organisations et personnes","Partenaires et fournisseurs"],a:1,e:"L'outil est là, mais les personnes ne savent pas l'utiliser. La dimension humaine est négligée."},
 {i:"Globe",h:"Les facteurs extérieurs",p:["Politique, économie, société, technologie, droit, environnement : le contexte pèse sur les quatre dimensions.","Exemple : une règle sur les données personnelles change ce qu'on peut écrire dans un ticket."]},
 {q:"Un fournisseur d'équipements ne répond plus aux escalades. Quelle dimension est touchée ?",o:["Partenaires et fournisseurs","Flux de valeur et processus","Information et technologie"],a:0,e:"Nos résultats dépendent aussi de nos partenaires : il faut gérer cette dépendance."},
 {r:["Organisations et personnes ; information et technologie ; partenaires et fournisseurs ; flux de valeur et processus.","Oublier une dimension fragilise le service.","Le contexte extérieur pèse sur les quatre."]}
]},
{id:"i5",t:"Le système de valeur des services",cards:[
 {i:"Workflow",h:"De la demande à la valeur",p:["En entrée : une opportunité ou une demande. En sortie : de la valeur pour le client et pour l'entreprise.","Le [[Système de valeur des services|système de valeur]] décrit ce qui relie les deux."]},
 {i:"Boxes",h:"Ses cinq éléments",p:["Les [[Principes directeurs|principes directeurs]], la gouvernance, la [[Chaîne de valeur|chaîne de valeur]], les [[Pratique|pratiques]] et l'[[Amélioration continue|amélioration continue]].","Ils travaillent ensemble : aucun ne suffit seul."]},
 {q:"Quel est le principal ennemi que le système de valeur combat ?",o:["Le manque d'outils","Le travail en silos","Le nombre de tickets"],a:1,e:"Chaque équipe qui optimise dans son coin peut casser le résultat d'ensemble. Le système de valeur pousse à voir de bout en bout."},
 {i:"Building2",h:"La gouvernance",p:["Elle oriente et contrôle : priorités, règles, suivi des résultats.","Chez EMOC, ce sont les objectifs SLA fixés avec le client et la revue Dakar × Abidjan."]},
 {r:["Entrée : opportunité ou demande. Sortie : valeur.","Cinq éléments : principes, gouvernance, chaîne de valeur, pratiques, amélioration continue.","But : casser les silos, voir de bout en bout."]}
]},
{id:"i6",t:"Les sept principes directeurs",cards:[
 {i:"Flag",h:"Des repères pour décider",p:["Sept [[Principes directeurs|principes]] valables pour toute situation, quelle que soit la méthode.","Ils aident surtout quand aucune procédure ne dit quoi faire."]},
 {w:"principes"},
 {q:"On veut refaire le tableau de bord SLA. Par quoi commencer ?",o:["Tout jeter et repartir de zéro","Regarder ce qui marche déjà dans l'actuel et le garder","Acheter un nouvel outil"],a:1,e:"Commencer là où l'on est : l'existant contient souvent l'essentiel."},
 {q:"On veut automatiser l'ouverture des tickets à partir des alarmes. Que faire d'abord ?",o:["Automatiser tout de suite","Simplifier et fiabiliser la règle d'ouverture, puis automatiser","Ne jamais automatiser"],a:1,e:"Optimiser, puis automatiser : automatiser un mauvais processus ne fait que produire des erreurs plus vite."},
 {q:"Dakar améliore son taux SLA en reclassant des tickets en P4. Quel principe est oublié ?",o:["Privilégier la valeur","Rester simple","Avancer par itérations"],a:0,e:"Le chiffre s'améliore, le client n'y gagne rien. La valeur pour le client passe avant l'indicateur."},
 {r:["Valeur, existant, itérations, collaboration, vision d'ensemble, simplicité, optimiser puis automatiser.","Ils guident les décisions sans procédure.","On les combine : rarement un seul à la fois."]}
]},
{id:"i7",t:"La chaîne de valeur",cards:[
 {i:"Waypoints",h:"Six activités",p:["La [[Chaîne de valeur|chaîne de valeur]] décrit six activités qui transforment une demande en valeur.","Elles se combinent dans un ordre différent selon le besoin."]},
 {w:"chaine"},
 {i:"Siren",h:"Un flux de valeur chez nous",p:["Une alarme critique : s'engager (prévenir le client), délivrer et assurer le support (diagnostic, rétablissement), améliorer (RCA, erreur connue).","Ce parcours précis est un [[Flux de valeur|flux de valeur]]."]},
 {q:"Pendant un incident, prévenir le client et le tenir informé relève de quelle activité ?",o:["Planifier","S'engager","Obtenir/construire"],a:1,e:"S'engager, c'est la relation avec les parties prenantes : comprendre, informer, rassurer."},
 {q:"Après trois P2 identiques, on ouvre un problème et on met à jour la base de connaissances. Quelle activité ?",o:["Améliorer","Concevoir et faire la transition","Délivrer et assurer le support"],a:0,e:"On tire la leçon pour que ça ne se reproduise pas : c'est améliorer."},
 {r:["Planifier, améliorer, s'engager, concevoir et faire la transition, obtenir/construire, délivrer et assurer le support.","Un flux de valeur enchaîne certaines de ces activités pour un cas précis.","Le traitement d'une alarme est un flux de valeur."]}
]}
];

var M11=[
{id:"p1",t:"Incidents et centre de services",cards:[
 {i:"Siren",h:"Le but de la pratique",p:["Réduire au minimum l'effet d'un [[Incident|incident]] en rétablissant le service au plus vite.","Trouver la cause viendra après, avec la gestion des problèmes."]},
 {i:"Users",h:"Travailler en essaim",p:["Sur un incident difficile, plusieurs experts se réunissent tout de suite au lieu de se passer le ticket.","C'est le principe du [[Bridge|bridge]] d'un incident majeur."]},
 {q:"Pourquoi prioriser les incidents ?",o:["Pour remplir un champ obligatoire","Pour traiter d'abord ceux qui pèsent le plus sur le client","Pour répartir la charge à égalité"],a:1,e:"La [[Priorité|priorité]] (impact × urgence) dit où mettre l'effort en premier."},
 {i:"Inbox",h:"Le centre de services",p:["Le point d'entrée unique pour les incidents et les demandes : téléphone, e-mail, outil.","Ce qui compte : comprendre la situation du client, avec empathie, pas seulement la technique."]},
 {i:"Eye",h:"Surveillance et événements",p:["La pratique « monitoring et gestion des événements » observe les composants et réagit aux changements d'état.","Un [[Événement|événement]] peut être une info, un avertissement ou une exception qui demande une action."]},
 {q:"Une bascule réussie apparaît en supervision. C'est…",o:["Un incident P3","Un événement informatif","Un problème"],a:1,e:"Rien n'est dégradé : c'est un événement à noter, pas un incident."},
 {r:["Incident : rétablir vite, la cause après.","Travail en essaim pour les cas difficiles.","Le centre de services écoute, oriente, informe.","Tous les événements ne sont pas des incidents."]}
]},
{id:"p2",t:"Problèmes, erreurs connues, contournements",cards:[
 {i:"Microscope",h:"Trois temps",p:["Identifier les problèmes (incidents qui reviennent, tendances).","Les contrôler (analyse, cause, contournement), puis maîtriser l'erreur (suivi jusqu'à la correction)."]},
 {i:"BookMarked",h:"L'erreur connue",p:["Un problème analysé, dont on connaît la cause ou au moins un moyen de s'en sortir.","L'[[Erreur connue|erreur connue]] évite de refaire tout le diagnostic à chaque occurrence."]},
 {q:"Le même incident revient chaque lundi matin. Que faire ?",o:["Le résoudre à nouveau chaque lundi","Ouvrir un problème pour en trouver la cause","Augmenter sa priorité"],a:1,e:"La répétition est le signal d'un [[Problème|problème]] : on cherche la cause pour arrêter la série."},
 {i:"Shuffle",h:"Le contournement",p:["Une solution qui réduit ou supprime l'impact, sans traiter la cause.","Il se documente avec l'erreur connue, pour que tout le monde l'applique pareil."]},
 {q:"Un contournement existe, la correction viendra dans un mois. Le problème est-il clos ?",o:["Oui, le client ne souffre plus","Non, il reste suivi jusqu'à la correction","Oui, si le client est d'accord"],a:1,e:"Le [[Contournement|contournement]] soulage ; seule la correction de la cause referme le problème."},
 {r:["Identifier, contrôler, maîtriser l'erreur.","Erreur connue : cause ou contournement documentés.","Un contournement soulage, il ne clôt pas le problème."]}
]},
{id:"p3",t:"Contrôler les changements",cards:[
 {i:"RefreshCcw",h:"Le but",p:["Faire réussir le plus de [[Changement|changements]] possible, en évaluant les risques et en autorisant au bon niveau.","Aller vite et rester sûr : les deux ensemble."]},
 {w:"chg"},
 {i:"UserCheck",h:"L'autorité de changement",p:["La personne ou le groupe qui autorise un changement. Elle dépend du type et du risque.","Un [[CAB]] n'est plus la seule voie : un changement standard est déjà pré-autorisé."]},
 {q:"Redémarrer un service selon une procédure validée et sans risque connu, c'est…",o:["Un changement standard","Un changement normal","Un changement urgent"],a:0,e:"Faible risque, procédure connue, pré-autorisé : changement standard."},
 {q:"Un correctif doit passer cette nuit pour arrêter un P1. C'est…",o:["Un changement standard","Un changement urgent","Une demande de service"],a:1,e:"Changement urgent : autorisation accélérée, mais toujours évaluée et tracée."},
 {i:"CalendarDays",h:"Le calendrier des changements",p:["Il montre ce qui est prévu et quand.","Côté FO : consulter le calendrier avant de diagnostiquer, beaucoup d'incidents suivent un changement."]},
 {r:["Standard : pré-autorisé. Normal : évalué. Urgent : accéléré.","L'autorité de changement dépend du risque.","Un incident inattendu ? Vérifier d'abord les changements récents."]}
]},
{id:"p4",t:"Demandes et niveaux de service",cards:[
 {i:"Inbox",h:"La demande de service",p:["Une [[Demande de service|demande]] prévue et normale : un accès, une information, un export.","Elle suit un circuit standard, souvent automatisable. Ce n'est pas une panne."]},
 {q:"Un client demande un export mensuel de ses alarmes. On ouvre…",o:["Un incident P4","Une demande de service","Un problème"],a:1,e:"Rien n'est cassé : c'est une demande, avec son propre circuit."},
 {i:"Gauge",h:"Les niveaux de service",p:["La gestion des niveaux de service fixe des objectifs clairs avec le client et vérifie qu'ils sont tenus.","Un [[SLA]] sert à créer de la valeur, pas seulement à se protéger."]},
 {i:"TrendingDown",h:"Vert sur le tableau, rouge chez le client",p:["Un SLA peut être tenu alors que le client est mécontent : le chiffre ne mesure pas tout ce qui compte pour lui.","On combine les indicateurs, les retours du client et son ressenti."]},
 {q:"Le taux SLA est de 98 %, mais le client se plaint. Que faire ?",o:["Rien, le contrat est respecté","Écouter le client et regarder ce que le SLA ne mesure pas","Changer l'objectif SLA"],a:1,e:"Le SLA est un moyen. Le but reste le résultat pour le client."},
 {r:["Demande : prévue, standard, pas une panne.","Les niveaux de service se fixent et se vérifient avec le client.","Un bon chiffre ne garantit pas un client satisfait."]}
]},
{id:"p5",t:"L'amélioration continue",cards:[
 {i:"TrendingUp",h:"L'affaire de tous",p:["L'[[Amélioration continue|amélioration continue]] concerne chaque personne et chaque activité, pas une équipe dédiée.","Petites améliorations régulières plutôt que grands projets rares."]},
 {w:"ci"},
 {q:"Première question du modèle d'amélioration ?",o:["Où en sommes-nous ?","Quelle est la vision ?","Comment mesurer ?"],a:1,e:"On part de la vision et des objectifs, puis on regarde où l'on est."},
 {i:"ClipboardList",h:"Le registre d'amélioration",p:["Une liste partagée des idées d'amélioration, priorisées et suivies.","Chez EMOC, les Observations et les actions de RCA en tiennent lieu."]},
 {q:"Après une action d'amélioration, que faut-il faire ?",o:["Passer à autre chose","Vérifier qu'on a atteint le résultat, puis entretenir l'élan","Attendre l'audit annuel"],a:1,e:"Mesurer le résultat, puis garder le rythme : sans suivi, l'amélioration retombe."},
 {r:["Tout le monde améliore, un peu et souvent.","Sept étapes, de la vision à l'entretien de l'élan.","Un registre partagé pour ne rien perdre."]}
]},
{id:"p6",t:"Les autres pratiques en bref",cards:[
 {i:"Library",h:"34 pratiques au total",p:["ITIL 4 décrit des pratiques générales, de gestion des services et techniques.","Voici celles qu'un Front Office croise le plus souvent."]},
 {w:"autres"},
 {q:"Où chercher les composants d'un service et leurs liens pour mesurer l'impact d'une panne ?",o:["Dans la gestion de la configuration des services","Dans la gestion des fournisseurs","Dans la gestion financière"],a:0,e:"La configuration décrit les éléments d'un service et leurs relations : utile pour mesurer un impact."},
 {q:"Un agent documente comment résoudre une alarme rare. Quelle pratique ?",o:["Gestion des connaissances","Gestion des actifs","Gestion de la relation"],a:0,e:"Partager ce qu'on sait évite que chacun redécouvre la solution."},
 {r:["Relation, fournisseurs, sécurité, actifs, configuration, connaissances, mesure : elles soutiennent le travail du FO.","Chaque pratique sert la chaîne de valeur, aucune ne vit seule."]}
]}
];

var MODS=[
 {id:"M1",ic:"Layers",soft:"#CFD2F7",deep:"#4F54D6",t:"Les fondamentaux",d:"Le rôle du Front Office, les grands process et les trois types de tickets EMOC.",S:M1},
 {id:"M2",ic:"Workflow",soft:"#F5D3D7",deep:"#C93A52",t:"Cycle de vie d'un incident",d:"De l'alarme au ticket, bien enregistrer, diagnostiquer, résoudre et clôturer.",S:M2},
 {id:"M3",ic:"Timer",soft:"#CDE7DF",deep:"#16876F",t:"Priorité et SLA",d:"Impact et urgence, sévérité, délais EMOC, calendaire, ouvré, drill, Near Breach, On Hold.",S:M3},
 {id:"M4",ic:"Send",soft:"#E0D6F5",deep:"#6E45C9",t:"Escalade et communication",d:"Quand et vers qui escalader, et comment écrire une mise à jour utile.",S:M4},
 {id:"M5",ic:"Siren",soft:"#F3DDCA",deep:"#B85415",t:"Incident majeur",d:"Le reconnaître, s'organiser, communiquer pendant la crise et apprendre après.",S:M5},
 {id:"M6",ic:"Microscope",soft:"#D0E5F2",deep:"#17709F",t:"Gestion des problèmes",d:"De l'incident au problème, Bug ou non Bug, cause racine et erreur connue.",S:M6},
 {id:"M7",ic:"RefreshCcw",soft:"#EEE3B8",deep:"#8F6F05",t:"Changements et demandes",d:"Types de changement, lien avec les incidents, demandes de service.",S:M7},
 {id:"M8",ic:"Clock",soft:"#D8EDCA",deep:"#357A1C",t:"Le quotidien du FO",d:"Relève, Observations, Daily Check-up, qualité des données et revue Dakar × Abidjan.",S:M8},
 {id:"M9",ic:"Target",soft:"#F3D6E5",deep:"#AE3474",t:"Cas pratiques",d:"Quatre situations réelles à résoudre : P1 de nuit, tempête d'alarmes, incident qui revient, On Hold oublié.",S:M9},
 {id:"M10",ic:"GraduationCap",soft:"#D6DDF5",deep:"#3D5BB8",t:"ITIL 4 : les fondations",d:"Valeur et co-création, utilité et garantie, quatre dimensions, système de valeur, sept principes, chaîne de valeur.",S:M10},
 {id:"M11",ic:"Library",soft:"#D3EDEA",deep:"#1F7D74",t:"ITIL 4 : les pratiques",d:"Incidents, problèmes, changements, demandes, niveaux de service, amélioration continue et les pratiques voisines du FO.",S:M11}
];

