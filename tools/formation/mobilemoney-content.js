/* ══════════════════════════════════════════════════════════════
   CONTENU DE LA FORMATION « MOBILE MONEY 2.0 »
   (architecture, modèle de service, disponibilité, gray release,
   exploitation avec DigitalView, AIOps, chaîne d'appels, données)

   Ce fichier n'est pas chargé tel quel : tools/formation/build.js
   l'insère dans le moteur de la formation DigitalView pour produire
   public/formation/mobilemoney.html. Après modification :
       node tools/formation/build.js mobilemoney

   Format (celui du moteur DigitalView) :
     G      glossaire   { terme: { c: catégorie, d: définition, a: image } }
     M1…Mn  sessions    [{ id, t, cards: [...] }]
     cartes  { i: icône, h: titre, p: [paragraphes], m: mémo }
             { q: question, o: [options], a: index bonne réponse, e: explication }
             { w: widget }            (voir mobilemoney-widgets.js)
             { r: [points à retenir] }
     [[terme]] dans un texte ouvre la définition du glossaire.

   Sources : formation Starry Sky 2026 (Afrique du Nord), cours 1
   (architecture MM 2.0), 2 (modèle de service), 4 (DigitalView,
   l'essentiel), 5 (gray release et bascule DR), 6 (Smart DataCube) et
   7 (chaîne d'appels). Le texte est réécrit en français pour le FO :
   on garde les notions, les chiffres et les règles, pas les diapositives.
   ══════════════════════════════════════════════════════════════ */

var G={
/* Architecture */
"MM 2.0":{c:"Architecture",d:"Mobile Money 2.0 : la nouvelle génération de la plateforme de monnaie mobile, cloud native. Microservices en conteneurs, découpage en stripes, actif-actif et mises à jour sans coupure.",a:"Le même service, reconstruit en pièces détachées."},
"MM 1.0":{c:"Architecture",d:"La génération précédente : une application monolithique (BCS, AG, BTS…) et des bases Oracle centrales. Pour monter en charge, on ajoutait des nœuds et des machines plus puissantes."},
"Cloud native":{c:"Architecture",d:"Une application pensée pour le cloud : découpée en microservices, livrée en conteneurs, orchestrée par Kubernetes, capable de grossir ou maigrir seule."},
"Microservice":{c:"Architecture",d:"Un petit service autonome qui fait une seule chose (les clients, les commandes, la comptabilité…), avec son propre déploiement. MM 2.0 en compte plus de 40 sur quatre couches.",a:"Une équipe de spécialistes plutôt qu'un homme-orchestre."},
"Monolithe":{c:"Architecture",d:"Une application où toutes les fonctions tournent dans le même processus. Simple au départ, mais une erreur locale peut tout faire tomber et chaque modification touche l'ensemble."},
"Conteneur":{c:"Architecture",d:"Une boîte légère qui embarque un service et tout ce dont il a besoin. En MM 2.0, 2 à 4 vCPU par conteneur, contre 8 à 16 vCPU par élément de réseau en 1.0."},
"Pod":{c:"Architecture",d:"L'unité que Kubernetes lance et surveille : un ou plusieurs conteneurs qui vivent ensemble. Monter en charge, c'est ajouter des pods."},
"Kubernetes":{c:"Architecture",d:"L'orchestrateur de conteneurs (K8S) : il place les pods sur les nœuds, les relance s'ils tombent et en ajoute quand la charge monte."},
"AZ":{c:"Architecture",d:"Availability Zone : une zone de disponibilité, en pratique un centre de données. MM 2.0 se déploie sur au moins deux AZ."},
"Stripe":{c:"Architecture",d:"Une unité de déploiement complète (applications et bases) qui sert une partie des utilisateurs. On ajoute des stripes pour ajouter de la capacité, sans alourdir les autres.",a:"Une caisse de plus au supermarché, avec son propre tiroir."},
"GSU":{c:"Architecture",d:"Global Stripe Unit : le stripe global. Portails, tâches planifiées, traitements en masse, règlement, compensation, comptabilité, facturation au niveau SP, enregistrement des entités, workflow."},
"RSU":{c:"Architecture",d:"Region Stripe Unit : un stripe régional. Il traite les transactions en temps réel et les requêtes sur les entités pour sa partie des utilisateurs. Environ 1 000 TPS par RSU."},
"CSU":{c:"Architecture",d:"City Stripe Unit : le stripe des composants communs (middleware, services partagés comme l'IdentifierCenter)."},
"CP ID":{c:"Architecture",d:"Customer Partition : le numéro de partition d'un utilisateur (4 chiffres, de 1001 à 9999). Il est inscrit dans l'identifiant de l'utilisateur et dans ses numéros de commande : il dit dans quel RSU se trouvent ses données.",a:"Le numéro de casier qui dit où ranger le dossier."},
"TPS":{c:"Architecture",d:"Transactions par seconde : la mesure de capacité de la plateforme."},
"NSLB":{c:"Architecture",d:"Le répartiteur de charge réseau en entrée. Il distribue le trafic vers les Super Gateway et, pendant une gray release, entre le couloir de production et le couloir gris."},
"API Fabric":{c:"Architecture",d:"La plateforme d'API ouvertes : conversion de protocoles (SOAP, REST), orchestration de plusieurs API en une, contrôle d'accès OAuth 2.0, suivi en temps réel."},
"Apollo":{c:"Architecture",d:"Le centre de configuration des microservices. Les paramètres sont en base, modifiables depuis une interface, versionnés, et pris en compte à chaud, sans redémarrer. En cas de panne d'Apollo, chaque service garde une copie locale."},
"DCC":{c:"Architecture",d:"Le cache de configuration (sur Nacos) où le Config Portal pousse la configuration métier pour les services."},
/* Services */
"Super Gateway":{c:"Services",d:"La porte d'entrée de tout le trafic métier (USSD, STK, API). Héritière de l'AG de MM 1.0. Pendant une gray release, c'est elle qui envoie la requête dans le bon couloir."},
"Notification Center":{c:"Services",d:"Le centre de notifications (SMS…), sorti de la Super Gateway pour être partagé par le portefeuille et les futures solutions."},
"TransferBusiness":{c:"Services",d:"Le chef d'orchestre des transactions : il charge le modèle de transaction et enchaîne les étapes."},
"IdentityBusiness":{c:"Services",d:"Le chef d'orchestre des opérations sur les entités (création, cycle de vie, KYC…)."},
"CustomerCenter":{c:"Services",d:"Les clients et les groupes : informations de base, KYC, produits souscrits."},
"OrganizationCenter":{c:"Services",d:"Les organisations (marchands, agents, partenaires), leurs opérateurs et leurs Tills."},
"IdentifierCenter":{c:"Services",d:"Les identifiants de toutes les entités, ainsi que les personnes physiques et les opérateurs SP. Rangé dans le CSU, consultable depuis chaque stripe."},
"TransactionCenter":{c:"Services",d:"Les commandes : création, plafonds, calcul des frais. C'est la base d'écriture des transactions."},
"OrderQueryCenter":{c:"Services",d:"La consultation des commandes : base temps réel (environ 45 jours) et base historique HISDB (jusqu'à 10 ans). Séparer lecture et écriture permet de tenir plus de TPS."},
"Acctrans":{c:"Services",d:"Les soldes, les écritures et l'historique des comptes. Utilise un modèle comptable distribué (TCC) pour que chaque débit ait son crédit, même entre microservices."},
"AccCenter":{c:"Services",d:"La comptabilité générale : soldes par compte comptable, grand livre quotidien, balance."},
"ClearReconCenter":{c:"Services",d:"La compensation et le rapprochement avec les banques (relevés MT940/942, intégration temps réel)."},
"SettlementCenter":{c:"Services",d:"Le règlement hors ligne : commissions des marchands et agents, résultats (profits et pertes)."},
"TaskJob":{c:"Services",d:"Le planificateur des tâches système (nettoyages, rappels d'échéance, dormance…), réparti sur les stripes. Hérité du BTS de 1.0."},
"BulkCenter":{c:"Services",d:"Les traitements en masse (paiements groupés…). Découpe seul les gros fichiers : jusqu'à un million de lignes."},
"HDA Center":{c:"Services",d:"Le centre d'archivage : il archive et nettoie les données selon leur cycle de vie, en fichiers compressés et chiffrés déposés sur SFTP."},
"ISA":{c:"Services",d:"La plateforme de rapports (transactions du jour, activité, revenus), qui remplace BICP."},
"BDI":{c:"Services",d:"L'outil d'extraction de données vers fichiers, par stripe puis agrégé. Extraction quotidienne ; le temps réel passe par Kafka."},
/* Métier */
"SP":{c:"Métier",d:"Service Provider : le locataire de la plateforme, en général l'opérateur qui exploite le service Mobile Money."},
"Organisation":{c:"Métier",d:"Une entité qui participe aux échanges : distributeur, agent, détaillant, marchand. Organisées en hiérarchies (souvent 2 ou 3 niveaux)."},
"Opérateur":{c:"Métier",d:"Une personne qui agit pour le compte d'une organisation ou du SP. Un opérateur n'a pas de compte : il initie des opérations."},
"Till":{c:"Métier",d:"Un terminal ou une caisse partagée par plusieurs opérateurs d'une organisation."},
"Personne physique":{c:"Métier",d:"Le lien entre plusieurs comptes d'une même personne réelle (même pièce d'identité). Sert à limiter le nombre de comptes, appliquer des plafonds par personne et gérer le KYC."},
"KYC":{c:"Métier",d:"Know Your Customer : l'identification du client (pièce d'identité, informations réglementaires)."},
"Reason type":{c:"Métier",d:"Le scénario précis d'une transaction ou d'une action : canal, participants, modèle de transaction, frais, notifications. La plus petite brique de configuration du service."},
"Rule profile":{c:"Métier",d:"Un ensemble de règles de plafonds avec leurs valeurs. Une entité a un seul rule profile ; il s'applique à toutes ses transactions."},
"TradeOrder":{c:"Métier",d:"La commande vue de bout en bout : ce que l'utilisateur a demandé (un achat, un transfert). C'est elle qui est notifiée au client.",a:"Le ticket de caisse."},
"PaymentOrder":{c:"Métier",d:"Un mouvement de fonds unitaire sous une TradeOrder (transfert ou remboursement), succès ou échec. Une TradeOrder peut en porter plusieurs.",a:"Chaque ligne du ticket."},
"Compte d'attente":{c:"Métier",d:"Holding account : le compte qui garde les fonds pendant une transaction en deux temps, avant confirmation par le tiers. En cas d'échec, les fonds reviennent au compte débité."},
"ReceiptNo":{c:"Métier",d:"Le numéro de reçu court donné au client, en base 36 : année, mois, jour, segment de CP, séquence. Il permet de retrouver le stripe de la commande."},
/* Disponibilité */
"Actif-actif":{c:"Disponibilité",d:"Deux centres de données dans la même ville qui servent chacun une partie des utilisateurs, et se secourent l'un l'autre. Si l'un tombe, l'autre reprend tout."},
"RTO":{c:"Disponibilité",d:"Recovery Time Objective : le temps maximal pour rétablir le service après une panne. MM 2.0 vise moins de 2 minutes pour les applications."},
"RPO":{c:"Disponibilité",d:"Recovery Point Objective : la quantité de données qu'on accepte de perdre. MM 2.0 vise presque zéro."},
"CloudDR":{c:"Disponibilité",d:"L'outil de reprise après sinistre : il surveille les applications et les bases des deux sites, pilote la réplication et exécute la bascule (DRPortal, DRService, DRAgent).",a:"Le chef d'orchestre de la bascule."},
"Bascule":{c:"Disponibilité",d:"Switchover (planifiée) ou failover (sur panne) : faire passer le service d'un site à l'autre."},
"Gray release":{c:"Disponibilité",d:"Mise en production progressive : la nouvelle version tourne d'abord pour quelques utilisateurs choisis, on observe, puis on élargit jusqu'à tous.",a:"Goûter la sauce avant de servir toute la salle."},
"Couloir":{c:"Disponibilité",d:"Lane (ou swimlane) : un jeu complet de microservices dans un namespace. Le couloir bleu (production) garde l'ancienne version, le couloir vert (gris) reçoit la nouvelle."},
"Utilisateur gris":{c:"Disponibilité",d:"Un utilisateur dont les requêtes sont envoyées dans le couloir gris pendant une gray release. Choisi par liste blanche (MSISDN, CP ID, code court…)."},
"DDL":{c:"Disponibilité",d:"Les changements de structure de base de données (tables, colonnes). Ils ne se défont pas : la nouvelle version doit rester compatible avec l'ancienne."},
/* Exploitation */
"DigitalView":{c:"Exploitation",d:"La plateforme de supervision et d'exploitation (DV) : alarmes, performances, tableaux de bord, journaux, chaînes d'appels, AIOps."},
"Alarme personnalisée":{c:"Exploitation",d:"Une alarme créée sur site à partir d'un script shell ou SQL, quand les alarmes d'usine ne couvrent pas le besoin."},
"Redéfinition de sévérité":{c:"Exploitation",d:"Une règle qui change le niveau ou le type d'une alarme selon l'élément concerné. Elle ne touche que les nouvelles alarmes, pas celles déjà levées."},
"Règle d'agrégation":{c:"Exploitation",d:"Une règle qui regroupe sous une seule alarme les doublons levés pendant une période donnée."},
"Seuil":{c:"Exploitation",d:"La valeur d'un indicateur au-delà de laquelle DigitalView lève une alarme. Peut varier selon la plage horaire, avec des expressions pour ignorer certains cas."},
"BriefReport":{c:"Exploitation",d:"Un rapport d'exploitation configuré une fois, généré et envoyé automatiquement (indicateurs, capacité, carte des alarmes)."},
"DMS":{c:"Exploitation",d:"L'outil de maintenance des bases de données : supervision, diagnostic en un clic de 48 problèmes courants, rapports AWR. Oracle, GaussDB, MySQL, GMDB, Prometheus."},
"Élasticité":{c:"Exploitation",d:"L'ajout ou le retrait automatique de pods selon une règle : CPU ou mémoire au-dessus de 85 %, ou à une heure prévue."},
"AIOps":{c:"Exploitation",d:"L'exploitation assistée par l'IA : détection d'anomalies, compression d'alarmes, analyse de cause, prédiction, assistant en langage naturel."},
"Comparaison homogène":{c:"Exploitation",d:"La détection de l'instance qui se comporte autrement que ses sœurs dans un même cluster (algorithme DBSCAN sur plusieurs indicateurs)."},
"Compression d'alarmes":{c:"Exploitation",d:"Le regroupement automatique d'une tempête d'alarmes en un incident, avec une seule notification."},
"Fault Agent":{c:"Exploitation",d:"L'agent de panne de DigitalView : il rassemble alarmes, indicateurs et journaux, appelle des outils, cherche dans la base de connaissances et rédige un rapport de diagnostic."},
"Chaîne d'appels":{c:"Exploitation",d:"La suite des services appelés pour traiter une requête, dans l'ordre. DigitalView la montre en arbre (topologie) et en Gantt, avec les temps de réponse."},
"seqNo":{c:"Exploitation",d:"Le numéro d'ordre d'un appel dans une chaîne d'appels. Il donne la hiérarchie dans le diagramme de Gantt."},
"Log de traçage":{c:"Exploitation",d:"Un traçage ciblé, par exemple sur un MSISDN, pendant une durée donnée : les chaînes d'appels de ce numéro sont gardées à 100 %, même si l'échantillonnage normal est à 0 %."},
/* Données */
"Smart DataCube":{c:"Données",d:"La solution de données : collecte, transformation, gouvernance, catalogue, requêtes, API et tableaux de bord, autour d'un cluster Hadoop.",a:"La cuisine centrale des données."},
"Data Factory":{c:"Données",d:"L'atelier d'orchestration de DataCube : sources, modèles, traitements par lots et en flux, planification, en low-code."},
"Data Compass":{c:"Données",d:"Le centre de gouvernance : standards, métadonnées, lignage, catalogue et vue 360 des données."},
"DAMS":{c:"Données",d:"Le catalogue des actifs de données : rechercher un modèle, voir sa qualité, demander un accès."},
"Lignage":{c:"Données",d:"Le chemin d'une donnée : d'où elle vient, quelles transformations elle a subies, où elle est utilisée."},
"Kafka":{c:"Données",d:"Le bus de messages en temps réel. MM 2.0 y publie ses événements pour les systèmes qui veulent les données sans attendre l'extraction."},
"EDR":{c:"Données",d:"Event Detail Record : les fichiers d'événements produits toutes les 5 à 10 minutes, entre l'extraction quotidienne et le flux Kafka."},
"HISDB":{c:"Données",d:"La base historique des commandes : jusqu'à 10 ans, une table par année, consultable en ligne."},
/* Alarmes */
"Alarme principale":{c:"Alarmes",d:"Main Alarm : l'alarme qu'une règle de compression garde en tête d'un groupe. Les doublons du même événement passent en alarmes secondaires sous elle."},
"Alarme secondaire":{c:"Alarmes",d:"Secondary Alarm : une alarme rattachée à une alarme principale par la compression. Elle reste visible, mais ne génère pas de notification à elle seule."},
"MOName":{c:"Alarmes",d:"Le nom de l'objet surveillé dans la description d'une alarme. Pour MM 2.0, il dit le pays, l'environnement, le stripe, le couloir, le centre et le service : wallet_osn_prd_gsu_b_pr1_transaction-center…",a:"L'adresse complète de l'alarme."},
"DSF":{c:"Alarmes",d:"Distributed Service Framework : le cadre de microservices de MM 2.0. Il enregistre les instances, route les appels entre services et surveille leur santé."},
"Health checker":{c:"Alarmes",d:"Le contrôle de santé du DSF. Quand une instance échoue au contrôle, elle est isolée : elle ne reçoit plus d'appels, les autres instances du service prennent le relais."},
"Seuil de ratio":{c:"Alarmes",d:"Ratio Threshold : une alarme qui compare un indicateur à la même période d'avant (souvent la semaine précédente), au lieu d'une valeur fixe."},
"ZooKeeper":{c:"Alarmes",d:"Le service de coordination de la plateforme : configuration partagée, élections, présence des nœuds. Une perte de connexion à ZooKeeper prive un composant de ces informations."},
"HSM":{c:"Alarmes",d:"Hardware Security Module : l'équipement qui garde les clés et fait les opérations de chiffrement (codes PIN, signatures). Si un service ne le joint plus, les opérations qui en ont besoin échouent."},
"Liquibase":{c:"Alarmes",d:"L'outil qui met à jour la structure de la base d'un service à son démarrage. Un échec signifie que le service n'a pas pu préparer sa base."},
"IP flottante":{c:"Alarmes",d:"Floating IP : une adresse qui suit le nœud actif d'un cluster (par exemple la base GaussDB primaire). Les applications s'y connectent sans savoir quel nœud est actif."},
"BFD":{c:"Alarmes",d:"Bidirectional Forwarding Detection : un protocole qui détecte en quelques millisecondes la coupure d'un lien entre deux équipements réseau."},
"HRP":{c:"Alarmes",d:"Le mécanisme de secours entre deux pare-feux jumeaux (actif et veille). Ils échangent un battement de cœur ; si l'un tombe, l'autre prend la main."}
};

/* ── Schémas simplifiés ─────────────────────────────────────────
   Les diapositives d'origine sont denses et en anglais. Dans la leçon,
   chacune est remplacée par un schéma simple en français (DG), dessiné
   avec quelques briques : boîte, flèche, colonnes, tableau, segments.
   La diapositive reste accessible derrière « Voir la diapositive
   d'origine ». Tout est en <span> : le schéma vit dans un paragraphe.
   ─────────────────────────────────────────────────────────────── */
var DG_CSS='.dg{display:block;margin:6px 0 4px;padding:16px;border-radius:18px;background:var(--surface2);font-size:14px;line-height:1.35}'
 +'.dg-flow{display:flex;flex-wrap:wrap;align-items:stretch;gap:8px}'
 +'.dg-flow+.dg-flow,.dg-flow+.dg-cols,.dg-cols+.dg-flow{margin-top:10px}'
 +'.dg-ar{align-self:center;font-size:20px;color:var(--muted);flex:none}'
 +'.dg-b{display:flex;flex-direction:column;justify-content:center;gap:2px;flex:1 1 120px;min-width:110px;padding:10px 12px;border-radius:14px}'
 +'.dg-b b{font-weight:600;font-size:14.5px}.dg-b small{font-size:12.5px;opacity:.85}'
 +'.dg-cols{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(170px,1fr))}'
 +'.dg-col{display:flex;flex-direction:column;gap:6px;padding:12px;border-radius:14px}'
 +'.dg-col>b{font-weight:600;font-size:15px;margin-bottom:2px}.dg-col>span{display:block;font-size:13.5px;padding-left:12px;position:relative}'
 +'.dg-col>span::before{content:"";position:absolute;left:0;top:.55em;width:5px;height:5px;border-radius:50%;background:currentColor;opacity:.6}'
 +'.dg-grid{display:grid;gap:8px}'
 +'.dg-tb{display:grid;gap:4px;font-size:13.5px}.dg-tb>span{padding:8px 10px;border-radius:10px;background:var(--surface)}.dg-tb>span.h{background:transparent;font-weight:600;color:var(--muted);font-size:12.5px}.dg-tb>span.k{font-weight:600}.dg-tb>span.hi{background:var(--dgs,#D3EDEA);color:var(--dgd,#16534E);font-weight:600}'
 +'.dg-seg{display:flex;flex-wrap:wrap;gap:4px}.dg-seg>span{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border-radius:12px;flex:1 1 auto}'
 +'.dg-seg>span b{font-family:ui-monospace,Menlo,monospace;font-size:16px;font-weight:600;letter-spacing:.02em}.dg-seg>span small{font-size:12.5px}'
 +'.dg-k{display:flex;flex-wrap:wrap;gap:6px}.dg-k>span{padding:7px 12px;border-radius:999px;font-size:13.5px}'
 +'.dg-n{display:block;margin-top:10px;font-size:13px;color:var(--muted)}'
 +'.dg-t{display:block;font-size:12px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin:0 0 8px}'
 +'.t-a{background:var(--soft,#D3EDEA);color:var(--deep,#16534E)}.t-b{background:#DCE6FB;color:#1E4FB8}.t-g{background:#D4EEDD;color:#14532D}.t-r{background:#F6D5D3;color:#8E1F17}.t-o{background:#FBE3CC;color:#8A4B0B}.t-v{background:#E6DDF7;color:#5B34B0}.t-n{background:var(--surface);color:var(--ink)}'
 +'html[data-theme="dark"] .t-a{background:#1F2A29;color:#9EDBD2}html[data-theme="dark"] .t-b{background:#18233A;color:#9DB8F2}html[data-theme="dark"] .t-g{background:#12301F;color:#A7E3BF}html[data-theme="dark"] .t-r{background:#3A1A18;color:#F6B4AE}html[data-theme="dark"] .t-o{background:#3A2614;color:#F5C08E}html[data-theme="dark"] .t-v{background:#271E3D;color:#C9B5F5}'
 +'.fig-o{display:block;margin-top:8px}.fig-o>button{border:0;background:none;padding:4px 0;font:inherit;font-size:13px;color:var(--muted);text-decoration:underline;text-underline-offset:3px;cursor:pointer}.fig-o>span{display:none;margin-top:6px}.fig-o.open>span{display:block}';
if(typeof document!=='undefined'&&document.createElement){var dgs=document.createElement('style');dgs.textContent=DG_CSS;document.head.appendChild(dgs)}

function B(l,s,t){return '<span class="dg-b t-'+(t||'n')+'"><b>'+l+'</b>'+(s?'<small>'+s+'</small>':'')+'</span>'}
var AR='<span class="dg-ar">→</span>';
function F(){return '<span class="dg-flow">'+[].slice.call(arguments).join(AR)+'</span>'}
function P(title,t,lines){return '<span class="dg-col t-'+(t||'n')+'"><b>'+title+'</b>'+(lines||[]).map(function(x){return '<span>'+x+'</span>'}).join('')+'</span>'}
function C(){return '<span class="dg-cols">'+[].slice.call(arguments).join('')+'</span>'}
function GR(n){return '<span class="dg-grid" style="grid-template-columns:repeat(auto-fit,minmax('+(n||150)+'px,1fr))">'+[].slice.call(arguments,1).join('')+'</span>'}
function TB(head,rows,hi){var n=head.length;return '<span class="dg-tb" style="grid-template-columns:minmax(110px,1.1fr) repeat('+(n-1)+',minmax(0,1fr))">'+head.map(function(h){return '<span class="h">'+h+'</span>'}).join('')+rows.map(function(r){return r.map(function(c,i){return '<span class="'+(i===0?'k':i===hi?'hi':'')+'">'+c+'</span>'}).join('')}).join('')+'</span>'}
function S(){return '<span class="dg-seg">'+[].slice.call(arguments).map(function(x){return '<span class="t-'+x[2]+'"><b>'+x[0]+'</b><small>'+x[1]+'</small></span>'}).join('')+'</span>'}
function K(t){return '<span class="dg-k">'+[].slice.call(arguments,1).map(function(x){return '<span class="t-'+t+'">'+x+'</span>'}).join('')+'</span>'}
function N(x){return '<span class="dg-n">'+x+'</span>'}
function T(x){return '<span class="dg-t">'+x+'</span>'}
function D(){return '<span class="dg">'+[].slice.call(arguments).join('')+'</span>'}

var DG={
// ── M1 ──
"c1-03":D(TB(["","MM 1.0 (avant 2020)","MM 1.0 cloud (2020-2022)","MM 2.0"],[["Capacité","1 200 TPS","quelques milliers","sans plafond"],["Reprise d'un site","10 à 15 min","10 min","2 min"],["Secours","un site attend","deux sites (test)","deux sites actifs, 50/50"],["Mise à jour","2 h d'arrêt","10 min","sans arrêt"]],3)),
"c1-53":D(C(P("MM 1.0 : tout relié à tout","r",["chaque serveur parle à chaque base","19 passerelles × 23 cœurs","ajouter un serveur alourdit tous les autres"]),P("MM 2.0 : des blocs indépendants","g",["chaque stripe a ses serveurs et ses bases","les liens restent dans le bloc","ajouter un bloc ne change rien aux autres"]))),
"c2-06":D(C(P("MM 1.0 : un seul programme","r",["Clients","Commandes","Comptes","Banques","… tout ensemble"]),P("MM 2.0 : un service par métier","g",["Clients → son service","Commandes → son service","Comptes → son service","chacun vit sa vie"]))),
"c2-07":D(TB(["","MM 1.0","MM 2.0"],[["Une erreur…","fait tout tomber","ne touche qu'un service"],["Pour grossir","acheter un serveur plus gros","ajouter des copies du service"],["Les échanges","instantanés, en mémoire","par le réseau : des délais possibles"]],2)),
"c1-13":D(C(P("Avant","o",["8 à 16 processeurs par élément","200 000 lignes de code","nouvelle version tous les trimestres"]),P("Aujourd'hui","g",["2 à 4 processeurs par conteneur","10 000 lignes de code","nouvelle version chaque mois, parfois en 7 jours"])),N("Plus petit = plus simple à comprendre, à corriger et à relivrer.")),
"c1-05":D(T("Un peu plus de charge"),F(B("La charge monte","",'o'),B("Kubernetes ajoute des copies","en quelques minutes",'a'),B("Le service tient","",'g')),T("Beaucoup plus de clients"),F(B("Croissance durable","",'o'),B("On ajoute un stripe","+ 1 000 TPS",'a'),B("Capacité augmentée","",'g'))),
"c1-08":D(GR(160,P("Comment on entre","b",["USSD","Application","Agents","Portails web"]),P("Les métiers","v",["Transfert","Clients","Crédit","Épargne"]),P("Le soutien","o",["Rapprochement bancaire","Commissions","Comptabilité"]),P("Autour","n",["Données et IA","Partenaires (API)","Exploitation"]))),
"c1-12":D(F(B("Internet","clients, partenaires",'n'),B("Bordure","premier filtre",'o'),B("DMZ","répartiteur, fichiers",'v'),B("Zone de confiance","services et bases",'g')),N("L'exploitation (DigitalView, reprise, déploiement) a sa propre zone, à part.")),
"c1-10":D(T("Avec qui MM 2.0 échange"),GR(150,B("Banques","dépôts, retraits",'b'),B("Opérateur","USSD, SMS",'v'),B("Facturiers","paiement de factures",'o'),B("Anti-blanchiment","contrôles",'r'),B("Applications, sites","via les API",'g'),B("Fichiers","échanges SFTP",'n'))),
"c1-14":D(C(P("Zone 1","b",["Entrée (DMZ)","Applications : GSU, RSU01, RSU02…","Outils : DigitalView, CloudDR"]),P("Zone 2","b",["Entrée (DMZ)","Applications : GSU, RSU01, RSU02…","Outils : DigitalView, CloudDR"])),N("Chaque stripe existe dans les deux zones, avec ses données copiées de l'une à l'autre.")),
"c1-15":D(F(B("DigitalView du pays","voit tout : alarmes, indicateurs, journaux",'b'),B("DigitalView central","reçoit les alarmes critiques et les indicateurs résumés",'a')),N("Les journaux restent sur le site du pays : on les lit là-bas.")),
// ── M2 ──
"c1-18":D(C(P("Un seul grand ensemble","r",["60 % de succès en pic","longues attentes","base saturée"]),P("Des stripes","g",["100 % de succès","moins d'une seconde","un stripe de plus en moins d'un jour"]))),
"c1-17":D(F(B("Jour normal","300 TPS",'n'),B("Opération promotionnelle","26 000 TPS",'r'),B("L'élasticité absorbe","on ajoute des copies",'g'))),
"c2-20":D(GR(170,P("GSU · pour tout le monde","v",["Portails","Paiements groupés","Commissions","Comptabilité"]),P("RSU · pour une partie des clients","b",["Transferts des clients","Soldes","Historique récent"]),P("CSU · commun","n",["Identifiants","Briques techniques"]))),
"c1-19":D(F(B("Un client","",'n'),B("Son numéro de partition","CP ID, ex. 1150",'v'),B("Sa plage","1101 à 1200",'o'),B("Son stripe","RSU02",'b'))),
"c1-54":D(C(P("MM 1.0","r",["Transfert entre deux sites :","plus de 20 allers-retours"]),P("MM 2.0","g",["Même transfert :","5 échanges au plus"]))),
"c2-39":D(S(["101","pays (locataire)","b"],["1001","partition (CP)","g"],["5000","type d'entité","v"],["0001023407","numéro","o"])),
"c2-40":D(S(["101","pays","b"],["1001","partition","g"],["221106","date","o"],["…","type","n"],["0001598001","numéro","v"],["1","couloir : 0 bleu, 1 vert","r"]),N("Le numéro de commande dit même dans quel couloir la commande a été traitée.")),
"c2-41":D(S(["S","année","b"],["I","mois","g"],["2","jour","o"],["01","partition","v"],["00000","numéro","n"]),N("Le reçu du SMS mélange lettres et chiffres (base 36). La partie « partition » dit dans quel stripe chercher.")),
// ── M3 ──
"c2-05":D(TB(["MM 1.0","devient en MM 2.0"],[["AG (passerelle)","Super Gateway + Notifications"],["BCS (tout le métier)","les services du cœur"],["BTS (tâches)","TaskJob + BulkCenter"],["SWA / OWA (portails)","4 portails"],["BICP (rapports)","ISA"],["AAS (archives)","HDA Center"]],1)),
"c1-35":D(F(B("Je me connecte une fois","",'n'),B("CAS vérifie","",'v'),B("J'ouvre les portails","sans redonner mon mot de passe",'g'))),
"c1-50":D(F(B("Chaque mouvement","une écriture",'n'),B("Les soldes","par compte",'b'),B("La balance","tout s'équilibre",'v'),B("Le grand livre","chaque jour",'g'))),
"c1-39":D(TB(["Données","Ce qu'on en fait"],[["Transactions, écritures, audit","archivées, puis effacées"],["Configuration","gardées"],["Identités, comptes","gardées"],["Traces temporaires","effacées"]],1)),
"c2-17":D(K("o","Configuration (SYSDB)","Clients et droits (MGTDB)","Transactions et soldes (TXNDB)","Audit (ADTDB)"),F(B("Base vivante","45 jours",'n'),B("Base moyen terme","6 mois",'n'),B("Base long terme","des années",'n'))),
"c2-21":D(F(B("Une grande base des transactions","MM 1.0",'r'),B("Découpée par métier","MM 2.0",'g')),K("g","Commandes","Consultation","Soldes","Comptabilité","Commissions")),
// ── M4 ──
"c2-33":D(T("Autour de chaque client ou organisation"),K("v","Ses identifiants","Ses comptes","Ses produits","Ses plafonds","Ses commandes")),
"c2-26":D(C(P("Transaction","b",["l'argent bouge","transfert, paiement, retrait"]),P("Opération métier","v",["on gère un compte","créer, suspendre, changer de produit"]))),
"c2-27":D(K("o","Paiements groupés","Tâches automatiques","Commissions","Rapprochement bancaire","Rapports")),
"c2-28":D(GR(140,B("USSD","menu envoyé au téléphone",'b'),B("STK","menu dans la carte SIM",'v'),B("Application","via les API",'g'),B("Portails web","pour les équipes",'o'),B("Système","tâches automatiques",'n'))),
"c2-30":D(GR(150,B("Qui ?","le client et son produit",'b'),B("Quoi ?","le type de transaction",'v'),B("Comment ?","le canal, les comptes, le SMS",'g'),B("Combien ?","les frais et les plafonds",'o'))),
"c2-29":D(F(B("Agent","",'n'),B("Produit","ce qu'il a souscrit",'b'),B("Service","Dépôt",'v'),B("Scénario","dépôt par STK",'g'),B("Frais et SMS","",'o'))),
"c2-31":D(F(B("Montant","",'b'),B("+ Frais","et commissions",'o'),B("+ Taxes","",'v'),B("= Total payé","",'g'))),
"c2-32":D(F(B("Profil de règles","un par client",'v'),B("Règles","montant max, nombre par jour…",'o'),B("Dépassée ?","",'n'),B("Refus","avec un code d'échec",'r'))),
"c2-37":D(B("TradeOrder","ce que le client a demandé · lui est notifiée",'a'),'<span class="dg-ar" style="display:block;text-align:center">↓</span>',GR(120,B("PaymentOrder 1","50",'n'),B("PaymentOrder 2","150",'n'),B("PaymentOrder 3","100",'n')),N("Les PaymentOrder sont les mouvements d'argent internes.")),
"c1-48":D(F(B("Achat de 300","3 paiements",'b'),B("Annuler 150","",'o'),B("Nouvelle commande d'annulation","liée à l'achat",'g'))),
"c2-38":D(F(B("Le client paie sa facture","",'n'),B("Compte d'attente","l'argent patiente",'v'),B("Le facturier confirme ?","",'n')),C(P("Oui","g",["la facture est payée"]),P("Non","r",["l'argent revient au client"])))
};
Object.assign(DG,{
// ── M5 ──
"c5-18":D(C(P("Centre 1","g",["sert 50 % des clients","garde une copie du centre 2"]),P("Centre 2","g",["sert 50 % des clients","garde une copie du centre 1"]),P("Site distant","n",["copie complète","prend le relais si les deux tombent"]))),
"c1-23":D(C(P("Région 1","b",["deux centres proches (40 km)"]),P("Région 2","b",["deux centres proches (40 km)"]),P("Secours","n",["un centre de plus"])),N("Plus de 300 km entre les deux régions : une catastrophe locale ne coupe pas tout.")),
"c1-24":D(F(B("CloudDR surveille","applications et bases",'v'),B("Copie les données","d'un site à l'autre",'b'),B("Bascule","si un site tombe",'g'))),
"c5-21":D(F(B("1. La base change de site","",'b'),B("2. Les services redémarrent","de l'autre côté",'v'),B("3. Les clients sont redirigés","vers le bon centre",'g'))),
"c5-20":D(C(P("En temps normal","g",["Centre 1 : 50 %","Centre 2 : 50 %"]),P("Après une bascule","o",["Centre 1 : 0 %","Centre 2 : 100 %"]))),
"c5-22":D(GR(150,B("Entrée (DMZ) en panne","matériel",'o'),B("Réseau du site coupé","",'o'),B("Un stripe en panne","seuls ses clients",'r'),B("Site entier perdu","feu, inondation, électricité",'r'))),
// ── M6 ──
"c5-09":D(F(B("Version 2 pour quelques clients","",'g'),B("On observe","",'n'),B("On élargit","",'b'),B("Tout le monde","",'g'))),
"c5-04":D(F(B("Un client arrive","",'n'),B("Super Gateway","ce client est-il « gris » ?",'v')),C(P("Oui","g",["couloir vert","nouvelle version (V2)"]),P("Non","b",["couloir bleu","version actuelle (V1)"]))),
"c5-05":D(GR(140,B("Zéro arrêt","",'g'),B("Par étapes","",'b'),B("Risque limité","",'o'),B("Décision sur les chiffres","",'v'))),
"c5-15":D(C(P("Liste blanche","g",["ces clients testent la V2"]),P("Liste noire","r",["jamais en V2","l'emporte sur la blanche"]))),
"c5-11":D(F(B("Répartiteur","envoie au hasard",'n'),B("Super Gateway","regarde le client",'v'),B("Bon couloir","bleu ou vert",'g'))),
"c5-10":D(TB(["Canal","Qui décide du couloir"],[["USSD, STK, API","le client (gris ou non)"],["API, volume","le % de trafic envoyé"],["SMS (SMPP)","des règles de routage"],["Portails","l'opérateur connecté"],["Traitements en masse","la tâche elle-même"]],1)),
"c5-12":D(F(B("L'opérateur se connecte","",'n'),B("Gris ?","",'v')),C(P("Oui","g",["portail V2"]),P("Non","b",["portail V1"]))),
"c5-13":D(C(P("Opérateurs gris","g",["peuvent changer la configuration"]),P("Opérateurs de production","r",["ne la changent pas pendant la release"]))),
"c5-14":D(F(B("Une tâche","paiement groupé, nettoyage…",'n'),B("Son champ « couloir »","",'v'),B("Elle s'exécute","en bleu ou en vert",'g'))),
"c5-07":D(GR(170,P("Couloir bleu","b",["version actuelle","tous les clients non gris"]),P("Couloir vert","g",["nouvelle version","2 copies minimum"]),P("Bases partagées","n",["compatibles avec les deux versions"]))),
"c5-06":D(C(P("Passe en gris","g",["les services métier","les briques de la zone applicative"]),P("Ne passe pas","n",["API Fabric, NFS, BDI","Kafka, serveur d'exploitation"]))),
"c5-16":D(C(P("Couloir vert","g",["taux de succès","transactions par seconde"]),P("Comparé au bleu","b",["même chose ?","vert qui chute, bleu stable : alerter"]))),
// ── M7 ──
"c4-03":D(F(B("Voir","filtres, top 10",'b'),B("Prendre en charge","confirmer",'v'),B("Comprendre","conseils de réparation",'o'),B("Partager","note d'expérience",'g'))),
"c4-04":D(F(B("1. Un compte","pour se connecter",'n'),B("2. Un script","shell ou SQL",'v'),B("3. Une règle","quand alerter",'o'),B("4. Démarrer","",'g'))),
"c4-05":D(F(B("Alarme « majeure »","",'o'),B("Règle","« ce serveur est critique »",'v'),B("Alarme « critique »","",'r')),N("Seulement pour les alarmes qui arrivent après la règle.")),
"c4-07":D(F(B("Collecter","CPU, disque, succès…",'b'),B("Observer","en temps réel",'v'),B("Seuil dépassé ?","",'o'),B("Alarme","",'r'))),
"c4-08":D(K("b","Démarrer / arrêter","Régler le seuil","Changer la période","Combiner des indicateurs","Comparer deux moments")),
"c4-09":D(C(P("Le jour","b",["beaucoup de trafic","seuil haut"]),P("La nuit","v",["peu de trafic","seuil bas"]))),
"c4-14":D(F(B("On le règle une fois","",'n'),B("Il se génère","chaque jour",'v'),B("Il part par e-mail","tout seul",'g'))),
"c4-15":D(K("v","Diagnostic en un clic (48 problèmes)","Rapports de performance","Une requête sur plusieurs bases")),
"c1-37":D(C(P("Avant","o",["réglages dans des fichiers","redémarrer après chaque changement"]),P("Avec Apollo","g",["réglages dans une interface","pris en compte tout de suite","copie locale si Apollo tombe"]))),
"c1-41":D(F(B("CPU au-dessus de 85 %","",'o'),B("+ 2 copies","ajoutées automatiquement",'a'),B("La charge se répartit","",'g'))),
// ── M8 ──
"c4-18":D(GR(150,B("Détecter plus vite","et réparer plus vite",'b'),B("Moins d'incidents","en prévoyant",'g'),B("Travailler plus vite","avec un assistant",'v'))),
"c4-19":D(T("Quatre copies d'un même service"),F(B("Copie 1","normale",'g'),B("Copie 2","normale",'g'),B("Copie 3","s'écarte des autres",'r'),B("Copie 4","normale",'g')),N("Elle reste peut-être dans les seuils, mais elle ne ressemble pas à ses sœurs : alarme.")),
"c4-21":D(F(B("7 h 41","l'IA repère l'anomalie",'g'),B("10 h 00","le client se plaint",'r')),N("Plus de deux heures pour agir avant la plainte.")),
"c4-22":D(C(P("Seuil fixe","o",["même ligne le jour et la nuit","trop de fausses alarmes, ou des oublis"]),P("Seuil appris","g",["suit la forme habituelle de la courbe","voit l'anomalie même la nuit"]))),
"c4-23":D(F(B("280 alarmes","en quelques secondes",'r'),B("Compression","",'v'),B("1 incident","1 seul message",'g'))),
"c4-25":D(F(B("280 alarmes","pendant un changement réseau",'r'),B("1 message","le détail reste consultable",'g'))),
"c4-28":D(C(P("Avant","o",["une équipe regarde tout à la main","étape par étape"]),P("Avec le Fault Agent","g",["tri automatique","vérification par des outils","rapport prêt à suivre"]))),
"c4-29":D(F(B("Détecter","le succès baisse",'o'),B("Trouver l'alarme racine","",'v'),B("Vérifier","disque plein à 100 %",'r'),B("Rapport","quoi faire",'g'))),
"c4-32":D(GR(150,B("Des chiffres","« le CPU de ce serveur ? »",'b'),B("De la documentation","« que faire pour cette erreur ? »",'v'),B("Des actions","« exporte ces alarmes »",'g'))),
"c4-35":D(C(P("Capacité","b",["le trafic grandit","on agrandit avant qu'il manque"]),P("Dégradation","o",["une courbe change de forme","on agit avant la panne"]))),
"c4-26":D(T("Du plus large au plus précis"),K("v","Solution","Site","Application","Copie (pod)","Machine")),
// ── M9 ──
"c1-44":D(F(B("Super Gateway","reçoit",'b'),B("Orchestrateur","enchaîne",'v'),B("Commandes","",'n'),B("Comptes","",'n'),B("SMS","confirme",'g'))),
"c7-04":D(T("Qui appelle qui"),B("Super Gateway","",'b'),'<span class="dg-ar" style="display:block;text-align:center">↓</span>',B("Orchestrateur","",'v'),'<span class="dg-ar" style="display:block;text-align:center">↓</span>',GR(120,B("Commandes","",'n'),B("Comptes","",'n'),B("SMS","",'n'))),
"c2-42":D(F(B("Client","",'n'),B("Répartiteur","",'n'),B("Super Gateway","trouve le stripe",'b'),B("Orchestrateur","",'v'),B("Commandes, comptes","",'g')),N("Si l'autre client est dans un autre stripe, un appel de plus part vers ce stripe.")),
"c7-09":D(F(B("Le LinkID d'une transaction","",'v'),B("Toute sa chaîne","appel par appel",'g'))),
"c7-10":D(F(B("Filtre","plus de 2 secondes",'o'),B("Chaînes lentes","mises en évidence",'r'),B("Le Gantt","montre l'appel lent",'g'))),
"c7-11":D(F(B("Une règle sur un numéro","",'v'),B("Pendant 2 heures","",'o'),B("100 % de ses traces gardées","",'g'))),
// ── M10 ──
"c6-02":D(C(P("Avant","o",["données en vrac","difficiles à comprendre","longs développements"]),P("Avec DataCube","g",["200 modèles prêts","outils simples","sur place, sans attendre l'usine"]))),
"c6-03":D(F(B("Construire","Data Factory",'b'),B("Contrôler","Data Compass, DAMS",'v'),B("Utiliser","SQL, tableaux de bord, API",'g'))),
"c6-04":D(F(B("Intégrer","",'n'),B("Modéliser","",'b'),B("Développer","",'v'),B("Publier","",'o'),B("Explorer","",'g'))),
"c6-05":D(F(B("Sources","Kafka, fichiers, bases…",'n'),B("Lire","5 formats",'b'),B("Transformer","18 opérations",'v'),B("Données prêtes","",'g'))),
"c6-06":D(F(B("Sources","",'n'),B("Data Factory","lots et flux, planification",'v'),B("Données prêtes","",'g'))),
"c6-07":D(K("v","Standards","Métadonnées","Lignage (d'où vient la donnée)","Catalogue")),
"c6-08":D(GR(120,B("Cohérence","",'b'),B("Validité","",'b'),B("Complétude","",'b'),B("Continuité","",'b'),B("Exactitude","",'b'),B("Fraîcheur","",'b'))),
"c6-09":D(F(B("MetaOne","une seule description des données",'v'),B("Utilisée partout","lignage, SQL, API",'g'))),
"c6-13":D(K("g","Tableaux de bord sans code","18 types de graphiques","Sur mobile aussi")),
"c6-14":D(F(B("Cœurs MM pays","Sénégal, Côte d'Ivoire…",'b'),B("DataCube","",'v')),K("g","Rapports par pays","Rapprochement","Rapport groupe")),
"c6-15":D(C(P("Pays A","b",["ses données","ses utilisateurs"]),P("Pays B","v",["ses données","ses utilisateurs"])),N("Un pays ne voit pas les données d'un autre.")),
"c6-16":D(C(P("Côte d'Ivoire","g",["site actif"]),P("Sénégal","g",["site actif"]),P("Secours","n",["prend le relais"]))),
// ── M11 ──
"c1-29":D(F(B("Partenaire","",'n'),B("API Fabric","contrôle l'accès, convertit",'v'),B("700+ API","métier et support",'g'))),
"c1-30":D(F(B("Ancienne API (SOAP)","",'o'),B("API Fabric","traduit",'v'),B("Nouvelle API (REST)","",'g'))),
"c1-31":D(GR(140,B("Combiner","profil + solde en un appel",'b'),B("Alléger","moins de champs, plus rapide",'v'),B("Convertir","REST ↔ SOAP",'g'))),
"c1-33":D(TB(["Voie","Délai","Pour qui"],[["Fichiers ETL","chaque jour ou heure","rapports, BI"],["Fichiers EDR","5 à 10 minutes","applications"],["Kafka","temps réel","anti-blanchiment, risques"]],1)),
"c1-46":D(C(P("Avant","o",["7 derniers jours visibles"]),P("Maintenant","g",["180 jours par recherche","10 ans d'historique"])))
});

Object.assign(DG,{
"c2-34":D(T("Chaque acteur est une identité"),K("b","Client","Organisation","Opérateur","Personne physique"),N("Chacune a ses identifiants (numéro, code court…) et ses comptes : c'est ce que le portail affiche quand on cherche quelqu'un.")),
"c4-10":D(GR(130,B("Courbes","l'évolution",'b'),B("Tableaux","le détail",'v'),B("Camemberts","la répartition",'o'),B("Nids d'abeille","l'état de chaque copie",'g')),N("On part du service et on descend jusqu'à une copie précise.")),
"c1-43":D(F(B("Tout le système","sur un écran",'b'),B("Un élément en rouge","",'r'),B("Un clic","pour descendre jusqu'à lui",'g'))),
"c4-30":D(K("o","Réseau","Conteneurs","Système","Stockage","Bases de données","Services communs")),
"c7-03":D(C(P("Vue d'ensemble","b",["toutes les solutions connectées"]),P("Chaîne d'appels","v",["le détail d'une requête","topologie, Gantt, temps"]))),
"c7-05":D(T("Une ligne par appel, dans l'ordre"),GR(120,B("1. Super Gateway","40 ms",'n'),B("2. Orchestrateur","35 ms",'n'),B("3. Comptes","210 ms : le plus lent",'r'))),
"c7-13":D(F(B("Une opération bloquée","",'o'),B("On retrouve sa chaîne","",'v'),B("On voit l'appel en échec","",'r'))),
"c6-10":D(F(B("Chercher un modèle","par mot clé",'b'),B("Voir sa qualité","",'v'),B("Demander l'accès","en ligne",'g'))),
"c6-11":D(F(B("Écrire une requête","syntaxe unique",'b'),B("Droits vérifiés","",'v'),B("Résultat","export possible",'g'))),
"c6-18":D(C(P("Côte d'Ivoire","g",["production","pré-production et tests"]),P("Sénégal","g",["production"]),P("Secours","n",["copie prête"])))
});

// Un schéma tiré des supports. Dans la leçon : le schéma simplifié s'il
// existe, et la diapositive d'origine repliée derrière un bouton.
function fig(n,t){var o='<span class="fig-o"><button type="button">Voir la diapositive d\'origine</button><span><span class="fig"><img src="img/mm/'+n+'.webp" alt="'+t.replace(/"/g,'')+'" loading="lazy"><small>'+t+'</small></span></span></span>';return (DG[n]||'')+o}

var M1=[
{id:"a1",t:"De MM 1.0 à MM 2.0",cards:[
 {i:"History",h:"Un service devenu infrastructure",p:["Il y a dix ans, la monnaie mobile était un service à valeur ajoutée de l'opérateur. Aujourd'hui, des millions de personnes y touchent leur salaire, paient leurs factures et envoient de l'argent à leur famille : quand elle s'arrête, le régulateur le sait dans l'heure.","Cette nouvelle place impose trois exigences : absorber des pics de trafic énormes (une promotion peut multiplier la charge par cent), ne presque jamais s'arrêter, et changer de version sans couper le service."]},
 {i:"TrendingUp",h:"Trois générations en un schéma",p:[fig("c1-03","L'évolution de MM : capacité, temps de reprise (RTO), mode de secours (GDR) et arrêt pour mise à jour, de MM 1.0 R20 à MM 2.0."),"En trois générations, la capacité passe de 1 200 TPS à « illimitée » ; le temps de reprise d'un site, de 10 à 15 minutes à 2 minutes ; le secours passe d'actif-passif (un site attend) à actif-actif à 50/50 ; et la mise à jour, de deux heures d'arrêt à zéro grâce à la gray release."]},
 {i:"BrickWall",h:"Pourquoi MM 1.0 a atteint son plafond",p:["En [[MM 1.0]], le métier tourne dans de gros éléments (BCS pour la logique, AG pour l'accès) qui parlent tous à toutes les bases. Pour tenir plus de trafic, on a ajouté des nœuds et acheté des serveurs plus puissants : 1 000 TPS en 2019, 1 800 en 2020, 2 600 en 2021, 3 500 ensuite.","Chaque palier coûtait plus cher que le précédent, parce que chaque nœud ajouté devait entretenir une connexion avec tous les autres."],m:"Sur le plus grand site Mobile Money au monde, 19 AG et 23 BCS étaient reliés en maillage : chaque BCS entretenait des connexions, de la mémoire et des battements de cœur vers chaque AG et chaque base. Et chaque nouvelle version demandait 72 heures de tests de charge sur un environnement identique à la production."},
 {i:"Network",h:"Le maillage, vu de près",p:[fig("c1-53","MM 1.0 : un grand cluster maillé. Applications et bases sont toutes reliées entre elles (N × M connexions)."),"En 1.0, chaque lien est une connexion à entretenir, et il y en a de plus en plus. En 2.0, des blocs de taille fixe gardent leurs liens à l'intérieur : en ajouter un ne rajoute rien aux autres."]},
 {q:"Pourquoi ajouter des nœuds en MM 1.0 finissait-il par coûter cher ?",o:["Parce que les licences sont plus chères","Parce que chaque nœud ajouté multiplie les connexions entre applications et bases","Parce que les bases Oracle ne peuvent pas grossir"],a:1,e:"Le maillage fait croître les connexions en N × M : plus le cluster grossit, plus chaque nœud passe de temps à entretenir ses liens, et moins il traite de transactions."},
 {i:"Cloud",h:"La réponse : cloud native",p:["[[MM 2.0]] reprend la plateforme à la base. Le métier est découpé en une quarantaine de [[Microservice|microservices]], livrés en [[Conteneur|conteneurs]] et orchestrés par [[Kubernetes]]. Les utilisateurs sont répartis en [[Stripe|stripes]] indépendants.","Pour le FO, ça change la façon de lire une panne : on ne cherche plus « le BCS qui tombe », mais quel service, dans quel stripe, sur quel centre."]},
 {r:["MM est devenu une infrastructure financière : arrêt rare, montée en charge, mise à jour sans coupure.","MM 1.0 grossissait en maillage, chaque palier coûtant plus cher.","MM 2.0 découpe le métier en microservices et les utilisateurs en stripes."]}
]},
{id:"a2",t:"Microservices et conteneurs",cards:[
 {i:"Boxes",h:"Une mission par service",p:["Un [[Microservice|microservice]] fait une seule chose et la fait bien : les clients, les commandes, les soldes, la consultation de l'historique…","Il se déploie, se met à jour et se dimensionne seul. Si le service des commandes a besoin de plus de puissance un soir de paie, on lui ajoute des instances sans toucher aux autres."]},
 {w:"sim_mono"},
 {i:"Layers",h:"Avant, un seul Tomcat ; après, des services",p:[fig("c2-06","En MM 1.0, un seul serveur d'application (Tomcat) portait tout le métier ; en MM 2.0, chaque domaine tourne dans ses propres conteneurs."),"En 1.0, tous les métiers vivent dans un même programme. En 2.0, les mêmes fonctions, mais séparées. C'est cette séparation qui permet de mettre à jour, d'agrandir ou d'isoler un service sans arrêter les autres."]},
 {i:"Scale",h:"Ce qu'on gagne, ce qu'on paie",p:[fig("c2-07","MM 1.0 contre MM 2.0 : couplage, montée en charge, stabilité, communication."),"Les gains : une exception ne fait plus tomber toute l'application, et on grossit service par service sur du matériel ordinaire.","Le prix : les services se parlent désormais par le réseau. Un appel qui prenait une microseconde en mémoire passe par le réseau, avec un risque de délai dépassé (timeout). Beaucoup d'alarmes de MM 2.0 parlent de ces échanges."]},
 {q:"Côté supervision, quel nouveau risque apporte le découpage en microservices ?",o:["Plus de dépendance au réseau entre services (timeouts)","Plus de mémoire partagée entre services","Moins de journaux à lire"],a:0,e:"Les services communiquent par le réseau : une latence ou une coupure entre eux devient une cause de panne. C'est pour ça que DigitalView suit les taux de succès des appels entre services."},
 {i:"Package",h:"Des conteneurs plus petits",p:[fig("c1-13","Microservices et conteneurs : des unités plus petites (2 à 4 vCPU), orchestrées par Kubernetes, avec la liste des 22 microservices métier."),"Un élément de réseau 1.0 réclamait 8 à 16 vCPU ; un conteneur 2.0 en prend 2 à 4. Le code suit : environ 10 000 lignes par microservice, contre plus de 200 000 par élément 1.0. Plus petit, c'est plus simple à comprendre, à corriger et à relivrer : on passe de mises en production trimestrielles à mensuelles, parfois en sept jours."]},
 {i:"TrendingUp",h:"Grossir en quelques minutes",p:[fig("c1-05","Montée en charge à la demande : plus d'instances pour la redondance, plus de stripes pour la capacité, bascule en moins de 2 minutes."),"Deux leviers. Verticalement, on ajoute des instances d'un service pour la redondance. Horizontalement, on ajoute un stripe (environ 1 000 TPS de plus). Kubernetes ajoute des pods en quelques minutes quand un indicateur dépasse sa règle."]},
 {q:"Un microservice rencontre une exception. Quel est l'impact attendu en MM 2.0 ?",o:["Toute la plateforme redémarre","Seul ce service est touché","Toutes les bases passent en lecture seule"],a:1,e:"C'est le principal gain du découpage : l'incident reste dans le périmètre du service, même si les services qui l'appellent peuvent voir des échecs."},
 {r:["Un microservice, une mission : déployé, mis à jour et dimensionné seul.","Le prix du découpage : des appels réseau entre services, donc des timeouts à surveiller.","On grossit par instances (redondance) et par stripes (capacité)."]}
]},
{id:"a3",t:"Les zones et les couches",cards:[
 {i:"LayoutDashboard",h:"La carte fonctionnelle",p:[fig("c1-08","L'architecture applicative de MM 2.0 : accès des clients, expérience client, support métier, produits et services, support des opérations, intelligence et données, ouverture, exploitation."),"En résumé : comment les clients entrent (USSD, application, agents, portails), les métiers (transfert, identité, crédit, dépôt), les produits (portefeuille, paiement), puis les fonctions de soutien (rapprochement, règlement, comptabilité), les données, l'ouverture aux partenaires et l'exploitation."]},
 {i:"ShieldCheck",h:"Quatre zones réseau",p:[fig("c1-12","L'architecture technique : zone d'exploitation, zone de bordure, DMZ et zone de confiance, avec les quatre couches de services et les briques de plateforme."),"Le trafic entre par la zone de bordure, traverse la DMZ (répartiteur, SFTP), puis arrive dans la zone de confiance où tournent les microservices et les bases. L'exploitation (DigitalView, déploiement, reprise) a sa propre zone. Chaque passage est filtré : c'est la défense en profondeur."]},
 {w:"couches"},
 {q:"Dans quelle couche se trouve la Super Gateway ?",o:["Le cœur métier","L'accès","Le support"],a:1,e:"La [[Super Gateway]] est la porte d'entrée du trafic USSD, STK et API : couche d'accès."},
 {i:"Plug",h:"Avec qui MM 2.0 parle",p:[fig("c1-10","L'architecture d'intégration : banques, SMSC et passerelle USSD, systèmes de facturation, anti-blanchiment, agrégateurs de factures, et les protocoles utilisés."),"Garde cette carte en tête en incident : derrière chaque échange, il y a un partenaire précis (une banque, l'opérateur pour les SMS, un facturier…). Quand un taux de succès sortant baisse, c'est souvent l'un d'eux."]},
 {i:"Settings",h:"Les briques de plateforme",p:["Sous les microservices : GaussDB pour les bases, Redis pour le cache, JetMQ et Kafka pour les messages, [[ZooKeeper]] pour la coordination, [[Apollo]] et [[DCC]] pour la configuration, [[NSLB]] pour la répartition.","Autour : [[DigitalView]] pour la supervision, [[CloudDR]] pour la reprise, DigitalFoundry (DF) pour le déploiement des conteneurs. Les retrouver dans un nom d'alarme te dit tout de suite si le problème est métier ou plateforme."]},
 {r:["Trafic : bordure, DMZ, zone de confiance ; l'exploitation à part.","Quatre couches : accès, intégration, cœur, support.","Derrière chaque échange sortant, un partenaire précis."]}
]},
{id:"a4",t:"Un déploiement sur plusieurs sites",cards:[
 {i:"Building2",h:"Deux zones, plusieurs clusters",p:[fig("c1-14","Le déploiement de MM 2.0 sur deux zones (AZ1, AZ2) : DMZ, clusters Kubernetes des applications (GSU, RSU) et de la plateforme (Venus, DepCloud, CloudDR, DF, DV)."),"Les deux zones sont des jumelles : chacune a son entrée, ses applications et ses outils. Chaque stripe existe des deux côtés, avec ses données copiées : si une zone tombe, l'autre a déjà tout."]},
 {i:"Map",h:"Superviser plusieurs pays",p:[fig("c1-15","Le modèle d'exploitation unifié : un DigitalView central, un DigitalView par site, et ce qui remonte (ou non) au centre."),"Avec un site par pays, un portail DigitalView central regroupe l'exploitation. Pour ménager la bande passante, chaque site n'envoie au centre que les indicateurs agrégés et les alarmes critiques. Les journaux restent sur place."]},
 {q:"Sur une architecture multi-sites, où lire les journaux détaillés d'un site ?",o:["Sur le DigitalView central, qui reçoit tous les journaux","Sur le DigitalView du site concerné, en basculant depuis le portail central","Dans Kafka"],a:1,e:"Les journaux restent sur leur site pour ne pas saturer le réseau : le portail central bascule vers le DigitalView local."},
 {i:"Bell",h:"Ce que le central ne voit pas",p:["Une alarme majeure ou mineure se voit sur le DigitalView du site, pas forcément au central. Pendant un shift, si tu suis plusieurs pays depuis le central, une dégradation lente peut t'échapper.","Le bon réflexe : sur un doute, ouvrir le DigitalView du site plutôt que conclure « rien au central »."]},
 {r:["Chaque stripe existe en double, un exemplaire par zone.","Au central : indicateurs agrégés et alarmes critiques seulement.","Sur un doute, aller voir le DigitalView du site."]}
]}
];

var M2=[
{id:"b1",t:"Pourquoi découper en stripes",cards:[
 {i:"Rows3",h:"Le principe",p:["Plutôt qu'un grand cluster partagé, MM 2.0 découpe les utilisateurs en groupes de 5 à 15 millions et donne à chaque groupe son [[Stripe|stripe]] : ses applications et ses bases.","Les connexions entre applications et bases restent à l'intérieur du stripe. Entre stripes, on passe par des interfaces de service, comme entre deux entreprises."]},
 {i:"Scale",h:"Un stripe contre plusieurs",p:[fig("c1-18","À gauche, l'architecture classique : un seul ensemble à pleine charge, qui sature. À droite, MM 2.0 : des stripes à pleine charge chacun, et on en ajoute pour grandir."),"Sous forte charge, un seul grand ensemble finit par saturer : une transaction sur deux ou presque échoue. Avec des stripes, chacun reste à sa taille et tout passe."]},
 {w:"sim_stripes"},
 {q:"Une plateforme doit passer de 3 000 à 4 000 TPS. Que fait-on en MM 2.0 ?",o:["On double la taille de la base centrale","On ajoute un stripe régional","On ajoute de la mémoire à chaque nœud"],a:1,e:"La capacité s'ajoute stripe par stripe, environ 1 000 TPS chacun. Les stripes existants ne changent pas."},
 {i:"Gauge",h:"Des tests de charge plus simples",p:["Avant, chaque palier demandait des tests de 72 heures sur un environnement identique à la production.","Avec des stripes, il suffit de valider qu'un stripe tient 1 000 TPS. Le bon rapport entre nœuds d'application et de base reste valable des années : on ne refait pas l'architecture à chaque croissance."]},
 {i:"Zap",h:"Les pics de trafic",p:[fig("c1-17","Capacité et fiabilité : interruption, croissance du trafic et élasticité, avec des exemples réels."),"Un cas réel : un portefeuille qui tient 300 TPS au quotidien a dû absorber 26 000 TPS pendant une opération d'enveloppes rouges. Sans élasticité, ce genre d'événement fait tomber la plateforme."]},
 {r:["Un stripe = un groupe d'utilisateurs avec ses applications et ses bases.","On grandit en ajoutant des stripes, sans alourdir les autres.","Le découpage rend les pics et les tests de charge gérables."]}
]},
{id:"b2",t:"GSU, RSU et CSU",cards:[
 {w:"stripes"},
 {i:"Globe",h:"Le stripe global (GSU)",p:["Il porte ce qui concerne tout le monde : les portails, les tâches planifiées, les traitements en masse, le règlement, la compensation, la comptabilité, l'enregistrement des entités et le workflow.","S'il va mal, ce sont les opérations de fond qui souffrent : un paiement groupé qui ne part pas, un portail inaccessible, une comptabilité en retard."]},
 {i:"Pin",h:"Les stripes régionaux (RSU)",p:["Ils portent le temps réel : les transactions et les requêtes sur les entités de leur part d'utilisateurs. RSU01, RSU02… chacun pour ses partitions.","S'il va mal, ce sont des clients qui ne peuvent plus envoyer d'argent, et seulement ceux de ses partitions."]},
 {i:"Database",h:"Les bases selon le stripe",p:[fig("c2-20","Où vivent les données : GSU pour le global, RSU pour le temps réel des utilisateurs, CSU pour le middleware et les services communs."),"Cette répartition explique pourquoi une alarme de base sur un RSU touche des clients, alors qu'une alarme sur le GSU touche plutôt les portails et les traitements de fond."]},
 {q:"Un client fait un transfert depuis son téléphone. Quel type de stripe traite la transaction ?",o:["Le GSU","Un RSU","Le CSU"],a:1,e:"Les transactions en temps réel des clients sont traitées dans le [[RSU]] qui porte leur partition."},
 {i:"Puzzle",h:"Le stripe commun (CSU)",p:["Le [[CSU]] porte le middleware et les services partagés, comme l'[[IdentifierCenter]] : chaque stripe peut y retrouver un identifiant. Dans les noms d'alarmes, on le reconnaît à csu00, csu01."]},
 {q:"Où tourne le calcul des commissions hors ligne des agents ?",o:["Dans un RSU","Dans le GSU","Dans le CSU"],a:1,e:"Le règlement ([[SettlementCenter]]) fait partie des traitements globaux du [[GSU]]."},
 {r:["GSU en panne : portails et traitements de fond touchés.","RSU en panne : les clients de ses partitions ne transigent plus.","CSU : middleware et services communs, comme les identifiants."]}
]},
{id:"b3",t:"La partition client (CP)",cards:[
 {i:"Hash",h:"Un numéro de casier",p:["Chaque utilisateur appartient à une partition, le [[CP ID]] : un nombre de 4 chiffres, de 1001 à 9999.","Une règle fixée dans le système dit à quel nœud de base, et donc à quel [[RSU]], appartient chaque plage de CP. Pas besoin de chercher : le numéro suffit."]},
 {i:"Rows3",h:"Des partitions aux stripes",p:[fig("c1-19","Des utilisateurs aux partitions (CP), des partitions aux nœuds de base, des nœuds aux stripes : chaque RSU porte des plages de CP."),"Le chemin est direct : le numéro de partition du client donne sa plage, et la plage donne son stripe. Pour ajouter 1 000 TPS, on ajoute un RSU et on lui confie de nouvelles plages."]},
 {q:"Comment le système sait-il dans quel RSU sont les données d'un client ?",o:["Il interroge tous les RSU","Il lit le CP ID inscrit dans l'identifiant du client","Il regarde le numéro de téléphone"],a:1,e:"Le [[CP ID]] fait partie de l'identifiant : la route vers le bon stripe est directe."},
 {i:"Calculator",h:"Combien de partitions ?",p:["Il existe 9 999 partitions logiques ; environ 1 000 suffisent pour 100 millions d'utilisateurs. Les commandes suivent l'utilisateur ou le marchand : le CP ID figure aussi dans le numéro de commande."]},
 {i:"ArrowRight",h:"Quand A et B ne sont pas au même endroit",p:[fig("c1-54","MM 1.0 : un transfert entre deux sites demandait plus de 20 allers-retours vers la base distante. MM 2.0 : au plus cinq."),"Pour un transfert entre deux clients de stripes différents, le stripe de la partie principale mène la transaction et appelle l'autre par interface. Moins d'allers-retours entre sites, c'est moins de risques quand le réseau entre centres ralentit."]},
 {r:["CP ID : 4 chiffres, inscrit dans les identifiants et les numéros de commande.","Plages de CP → nœuds de base → RSU.","Transfert entre stripes : la partie principale mène, au plus cinq échanges."]}
]},
{id:"b4",t:"Lire un identifiant",cards:[
 {i:"IdCard",h:"L'identifiant d'une entité",p:[fig("c2-39","Les règles d'identifiants : IdentityID (21 chiffres) et numéro de compte (32 chiffres), découpés en segments."),"Un identifiant d'entité fait 21 chiffres : le locataire (3), le [[CP ID]] (4), le type d'entité (4), une séquence (10). Un numéro de compte y ajoute le segment, le type de compte et la devise."]},
 {w:"identifiant"},
 {q:"Dans l'identifiant 101 1001 5000 0001023407, que vaut le CP ID ?",o:["101","1001","5000"],a:1,e:"Les 3 premiers chiffres sont le locataire, les 4 suivants le [[CP ID]]."},
 {i:"Ticket",h:"Le numéro de commande interne",p:[fig("c2-40","Le numéro de série interne (36 caractères) : locataire, CP ID, table, date, version, système, type, séquence, extension, et le repère gris."),"Il contient même un repère de couloir pour la [[Gray release|gray release]] : 0 pour bleu, 1 pour vert. En lisant un numéro de commande, on sait dans quel couloir elle a été traitée."]},
 {i:"Ticket",h:"Le reçu court",p:[fig("c2-41","Le reçu court (ReceiptNo) en base 36 : année, mois, jour, segment de CP, séquence."),"C'est le numéro que le client lit dans son SMS. Une lettre pour l'année, une pour le mois, une pour le jour (1 à 9 puis A à V), deux caractères pour le segment de CP et cinq pour la séquence. Quand un client donne son reçu au centre d'appels, le système en déduit le stripe où chercher."]},
 {q:"Pourquoi le reçu court contient-il un segment de CP ?",o:["Pour afficher la ville du client","Pour router la recherche vers le stripe qui détient la commande","Pour calculer les frais"],a:1,e:"À partir du reçu, le système retrouve le CP et donc l'[[OrderQueryCenter]] du bon stripe."},
 {r:["Identifiant : locataire, CP, type, séquence.","Le numéro de commande interne dit aussi le couloir (bleu ou vert).","Le reçu court du client suffit pour retrouver le stripe."]}
]}
];

var M3=[
{id:"c1",t:"L'accès et les portails",cards:[
 {i:"DoorOpen",h:"Une seule porte d'entrée",p:["La [[Super Gateway]] reçoit tout le trafic métier (USSD, STK, API) et parle aux systèmes tiers. Elle remplace l'AG de MM 1.0.","Les SMS et notifications ont été sortis dans un [[Notification Center]] à part, pour être partagés par le portefeuille et les futures solutions. Résultat : une panne de notification ne bloque plus les transactions, elle bloque les SMS de confirmation."]},
 {i:"Shuffle",h:"Qui est devenu quoi",p:[fig("c2-05","La correspondance des services : à gauche les éléments de MM 1.0 (BCS, BTS, AAS, SWA, OWA…), à droite les microservices de MM 2.0."),"Utile quand un ancien collègue parle « du BCS » ou « de l'AG » : on sait où la fonction est passée."]},
 {w:"portails"},
 {q:"L'équipe du centre d'appels doit consulter la transaction d'un client. Quel portail utilise-t-elle ?",o:["Le Config Portal","Le SP Portal","L'OM Portal"],a:1,e:"Le SP Portal est le portail du quotidien pour le centre d'appels, les opérations et la finance."},
 {i:"KeyRound",h:"Une connexion pour tous",p:[fig("c1-35","Connexion unique (SSO) : se connecter sur le portail de l'opérateur et arriver dans le SP Portal, ou l'inverse vers un CRM."),"Les portails reposent sur CAS pour la connexion unique : par défaut entre SP Portal, Config Portal et ISA, et demain avec les portails de l'opérateur. Quand CAS tombe, ce sont les connexions aux portails qui échouent, pas les transactions USSD."]},
 {r:["Super Gateway : toute l'entrée du trafic ; Notification Center : les SMS à part.","Quatre portails, chacun pour une équipe.","CAS en panne = portails touchés, transactions non."]}
]},
{id:"c2",t:"Le cœur métier",cards:[
 {i:"Workflow",h:"Les chefs d'orchestre",p:["[[TransferBusiness]] enchaîne les étapes d'une transaction ; [[IdentityBusiness]] celles des opérations sur les entités (création, KYC, dormance).","Ils n'ont presque pas de données à eux : ils appellent les services du cœur, qui exposent des opérations simples. C'est pourquoi un défaut d'orchestrateur se voit sur beaucoup de types de transactions à la fois."]},
 {w:"domaines"},
 {i:"ClipboardList",h:"Écrire d'un côté, lire de l'autre",p:["[[TransactionCenter]] crée les commandes, contrôle les plafonds et calcule les frais : c'est la base d'écriture.","[[OrderQueryCenter]] sert la consultation, dans une base temps réel (environ 45 jours) et une base historique. Séparer l'écriture de la lecture, c'est ce qui évite qu'un afflux de consultations ralentisse les paiements."]},
 {q:"Un client se plaint de ne pas voir une transaction d'il y a deux ans dans l'historique. Quel service la sert ?",o:["TransactionCenter","OrderQueryCenter, via la base historique","Acctrans"],a:1,e:"L'[[OrderQueryCenter]] lit la base temps réel pour le récent et la [[HISDB]] pour l'historique long."},
 {i:"Building",h:"L'argent",p:[fig("c1-50","Le centre comptable : écritures, soldes par compte comptable, balance, événements anormaux, grand livre."),"[[Acctrans]] tient les soldes et les écritures, avec un modèle distribué pour que chaque débit ait son crédit. [[AccCenter]] en tire la comptabilité générale : grand livre quotidien, balance, correction d'erreurs. Côté banques, [[ClearReconCenter]] rapproche les relevés et [[SettlementCenter]] calcule les commissions."]},
 {r:["Les orchestrateurs touchent beaucoup de transactions à la fois.","Écriture (TransactionCenter) et lecture (OrderQueryCenter) sont séparées.","L'argent : Acctrans pour les soldes, AccCenter pour la comptabilité."]}
]},
{id:"c3",t:"Les services communs",cards:[
 {i:"Clock",h:"Les tâches de fond",p:["[[TaskJob]] lance les tâches système : nettoyages, rappels d'échéance, passage en dormance des comptes inactifs.","[[BulkCenter]] traite les fichiers en masse, comme les salaires versés par une entreprise. Il découpe seul les gros fichiers, jusqu'à un million de lignes."]},
 {i:"ChartColumn",h:"Rapports et extractions",p:["[[ISA]] remplace BICP pour les rapports d'exploitation et de finance. [[BDI]] extrait les données en fichiers une fois par jour.","Pour le temps réel, les données sortent par [[Kafka]] : BDI ne fait plus d'extraction à la minute."]},
 {q:"Un partenaire veut les transactions avec quelques secondes de délai. Quelle voie lui proposer ?",o:["L'extraction BDI quotidienne","Le flux Kafka","Un rapport ISA"],a:1,e:"BDI est quotidien ; le temps réel passe par [[Kafka]]."},
 {i:"Archive",h:"Le cycle de vie des données",p:[fig("c1-39","L'archivage : chaque service définit le cycle de vie de ses données ; HDA Center archive, compresse, chiffre et dépose sur SFTP."),"Le [[HDA Center]] ne décide pas seul : chaque service écrit dans ses données la date où elles atteignent leur état final. Les données de flux sont archivées puis effacées ; la configuration et les données d'état ne sont jamais touchées ; les données temporaires sont seulement effacées."]},
 {w:"archivage"},
 {q:"Les journaux de requêtes temporaires sont-ils archivés ?",o:["Oui, archivés puis effacés","Non, seulement effacés","Ni archivés ni effacés"],a:1,e:"Les données temporaires sont seulement nettoyées ; les données de flux (transactions, écritures, audit) sont archivées puis nettoyées."},
 {r:["TaskJob pour les tâches système, BulkCenter pour les fichiers en masse.","ISA pour les rapports, BDI pour l'extraction quotidienne, Kafka pour le temps réel.","Chaque service décide du cycle de vie de ses données ; HDA l'applique."]}
]},
{id:"c4",t:"Les bases d'hier et d'aujourd'hui",cards:[
 {i:"Database",h:"Les bases de MM 1.0",p:[fig("c2-17","Les bases de MM 1.0 : configuration (SYSDB), entités et droits (MGTDB), audit (ADTDB), transactions et soldes (TXNDB)."),"Quatre grandes bases Oracle centrales. La base vivante gardait 30 à 45 jours ; Oracle GoldenGate copiait en quasi temps réel vers une base moyen terme (6 mois), puis une base long terme."]},
 {i:"Shuffle",h:"Le découpage en 2.0",p:[fig("c2-21","Comment chaque base de MM 1.0 a été découpée : la configuration en GSU, les entités par domaine, les transactions par domaine, l'audit à part."),"La TXNDB unique devient plusieurs bases : les commandes de TransactionCenter, la consultation d'OrderQueryCenter, les soldes d'Acctrans, la comptabilité d'AccCenter… chacune dans le bon stripe."]},
 {w:"correspondances"},
 {q:"Le BTS de MM 1.0 lançait les tâches système et les traitements en masse. Que devient-il ?",o:["Il disparaît","TaskJob et BulkCenter","Le Notification Center"],a:1,e:"Le BTS est découpé en deux : [[TaskJob]] pour les tâches système et [[BulkCenter]] pour les traitements en masse."},
 {q:"L'AAS de MM 1.0 archivait les données par SQL. Quel service 2.0 le remplace ?",o:["HDA Center","ISA","DataSync"],a:0,e:"Le [[HDA Center]] archive selon le cycle de vie défini par chaque service."},
 {r:["MM 1.0 : quatre bases Oracle centrales, copiées par GoldenGate.","MM 2.0 : une base par domaine, dans le bon stripe.","BCS, AG, BTS, AAS, BICP ont chacun leurs héritiers."]}
]}
];

var M4=[
{id:"d1",t:"Qui sont les acteurs",cards:[
 {i:"User",h:"Le client et la personne physique",p:["Le client est l'utilisateur final : de quelques millions à des dizaines de millions selon le marché, répartis dans les [[Stripe|stripes]] selon leur partition.","Une même personne réelle peut avoir plusieurs comptes. La [[Personne physique|personne physique]] les relie par la pièce d'identité : elle sert à limiter le nombre de comptes, à appliquer des plafonds par personne et à gérer le [[KYC]]."]},
 {i:"Building",h:"Les organisations",p:["Distributeurs, agents, détaillants, marchands : de quelques milliers à des millions. Elles s'organisent en hiérarchie, souvent sur 2 ou 3 niveaux.","Trois modes : intégré (les comptes de travail sont partagés), franchisé (chaque organisation a ses comptes) ou mixte."]},
 {q:"Un opérateur d'organisation a-t-il un compte de monnaie électronique ?",o:["Oui, toujours","Non, il agit pour l'organisation sans compte propre","Seulement s'il a un Till"],a:1,e:"L'[[Opérateur|opérateur]] initie les opérations au nom de l'organisation ; c'est l'organisation qui a les comptes."},
 {i:"Users",h:"Les autres acteurs",p:["L'[[Opérateur|opérateur]] agit pour une organisation ; plusieurs peuvent partager un [[Till]] (une caisse). Le [[SP]] est le locataire de la plateforme. La banque garde les fonds et règle en fin de chaîne, sans être partie aux transactions.","Le groupe, plus rare, permet à quelques personnes de collecter ensemble : ses membres votent les décisions selon leur rôle."]},
 {i:"Network",h:"Le modèle des identités",p:[fig("c2-34","Le modèle logique du domaine des identités : comment clients, organisations, opérateurs, personnes physiques et identifiants se relient."),"Pas besoin de retenir chaque boîte. Retiens que chaque acteur est une identité, avec des identifiants (MSISDN, code court…) et des comptes : c'est ce que les portails affichent quand on cherche un client."],m:fig("c2-33","Le modèle conceptuel : les grandes entités de Mobile Money et leurs liens.")},
 {r:["Client relié à une personne physique ; organisation en hiérarchie.","L'opérateur agit sans compte ; le Till est une caisse partagée.","Le SP est le locataire ; la banque garde les fonds."]}
]},
{id:"d2",t:"Temps réel et différé",cards:[
 {i:"Zap",h:"En temps réel",p:[fig("c2-26","Les services en temps réel : la transaction, l'action facturée héritée de 1.0, et l'opération métier."),"La transaction déplace des fonds d'un compte à un autre : transfert, paiement, recharge, retrait. Elle exige une cohérence stricte. L'opération métier, elle, gère les entités : créer un client, le suspendre, changer son produit."]},
 {i:"Hourglass",h:"En différé",p:[fig("c2-27","Les services hors ligne : traitements en masse, tâches système, règlement, rapprochement bancaire, rapports, extraction."),"Ces traitements tournent en arrière-plan : un paiement groupé à heure fixe, la dormance des comptes, le calcul des commissions, le rapprochement avec les relevés bancaires (MT940/942), les rapports ISA."]},
 {q:"Le rapprochement avec les relevés bancaires est-il un service temps réel ?",o:["Oui","Non, c'est un traitement différé","Seulement le week-end"],a:1,e:"La plupart des banques échangent des relevés en fichiers : le rapprochement est un traitement hors ligne."},
 {i:"ListOrdered",h:"Une ou deux phases",p:["Une phase : le transfert entre deux clients se fait d'un coup.","Deux phases : il faut une confirmation, par exemple une approbation ou un paiement de facture vers un tiers. Les fonds attendent sur un [[Compte d'attente|compte d'attente]] entre les deux."]},
 {q:"Pendant un paiement de facture en deux temps, le tiers répond « échec ». Que deviennent les fonds ?",o:["Ils restent sur le compte d'attente","Ils reviennent au compte débité","Ils vont au compte du SP"],a:1,e:"Le [[Compte d'attente|compte d'attente]] rend les fonds au compte d'origine si le tiers échoue."},
 {r:["Temps réel : transaction (fonds) et opération métier (entités).","Différé : masse, tâches, règlement, rapprochement, rapports.","Deux phases : les fonds attendent sur un compte d'attente."]}
]},
{id:"d3",t:"Les canaux",cards:[
 {i:"Smartphone",h:"Les canaux en un coup d'œil",p:[fig("c2-28","Les canaux : STK, portails web, USSD, API ouvertes et canal système."),"USSD : le menu envoyé au téléphone par la passerelle USSD, qui renvoie les choix du client. STK : le menu intégré à la carte SIM des téléphones simples, relié par la passerelle SMS, moins interactif. Le canal système enregistre ce que déclenchent les tâches automatiques."]},
 {i:"Plug",h:"Trois générations d'API",p:["L'API générique (SOAP, messages enveloppés en texte) n'est gardée que pour les anciens sites. La Schema API (SOAP) est l'interface principale de la 2.0. L'Open API 3.0 (REST) est l'avenir.","Les applications mobiles, les sites tiers et les distributeurs de billets passent par là."]},
 {q:"Quelle interface est aujourd'hui la principale pour les intégrations MM 2.0 ?",o:["L'API générique","La Schema API (SOAP)","L'Open API 3.0 (REST)"],a:1,e:"L'Open API 3.0 est l'avenir, mais la 2.0 s'appuie encore surtout sur la Schema API."},
 {i:"Search",h:"Pourquoi le canal compte en incident",p:["Les taux de succès sont suivis par canal. Si seul l'USSD baisse, on regarde la passerelle USSD ; si seules les API baissent, plutôt l'API Fabric ou un partenaire. Le canal est la première question à poser quand un client dit « ça ne marche pas »."]},
 {r:["USSD, STK, portails, API, canal système.","API : générique (ancienne), Schema (principale), Open API 3.0 (avenir).","En incident, le canal touché oriente la recherche."]}
]},
{id:"d4",t:"Comment un service est configuré",cards:[
 {i:"SlidersHorizontal",h:"Qui, quoi, comment, combien",p:[fig("c2-30","Le modèle de configuration 2W2H : l'identité et son produit (qui), le type de transaction (quoi), le canal et les comptes (comment), les frais et plafonds (combien)."),"Toute la configuration répond à ces quatre questions. Quand une transaction échoue pour un seul type de client ou un seul canal, la réponse est presque toujours dans l'une de ces cases."]},
 {i:"Package",h:"Un exemple concret",p:[fig("c2-29","Exemple : un agent fait un dépôt par STK. Produit, service, reason type, type de transaction, canal, type de compte, notification, type de frais."),"Un service définit un canal et les scénarios qu'il permet. Les services sont regroupés en produits, auxquels les entités souscrivent. Le [[Reason type|reason type]] décrit le scénario précis : canal, participants, modèle de transaction, frais, notifications."]},
 {w:"config"},
 {q:"Un dépôt fonctionne par USSD mais pas par STK pour un même agent. Où regarder d'abord ?",o:["Le reason type et le service du canal STK","Le CP ID de l'agent","Le BriefReport"],a:0,e:"Le canal fait partie du service et du [[Reason type|reason type]] : un écart de canal se cherche là."},
 {r:["Qui, quoi, comment, combien : les quatre cases de la configuration.","Le reason type est la plus petite brique.","Un échec limité à un canal ou un type de client pointe la configuration."]}
]},
{id:"d5",t:"Frais et plafonds",cards:[
 {i:"Calculator",h:"Les frais",p:[fig("c2-31","Frais et plafonds : type et profil de frais, types et règles de plafond, profil de règles, code d'échec."),"Une transaction se facture en trois parts : le montant principal, les frais et commissions, et les taxes. Le type de frais dit qui paie et qui reçoit ; le profil de frais donne les taux."]},
 {i:"Ruler",h:"Les plafonds",p:[fig("c2-32","Le modèle des plafonds : un profil de règles regroupe des règles, chaque règle a un type, un objet, une valeur et une action en cas de dépassement."),"Cinq familles de plafonds : solde minimum, solde maximum, montant maximum par transaction, montant cumulé sur une période, nombre de transactions sur une période. Ils viennent de la réglementation du pays et des choix de l'opérateur."]},
 {q:"Un client ne peut plus envoyer d'argent après dix envois dans la journée. Quel type de plafond est en jeu ?",o:["Montant maximum par transaction","Nombre maximum de transactions sur une période","Solde minimum"],a:1,e:"C'est une limite de fréquence : nombre de transactions par période."},
 {i:"ListChecks",h:"Le rule profile et le code d'échec",p:["Les règles sont regroupées dans un [[Rule profile|rule profile]] qui leur donne des valeurs ; une entité a un seul rule profile.","Quand une règle est violée, la transaction échoue avec un code d'échec de plafond. Ce code est la meilleure piste quand un client se plaint d'un refus : ce n'est pas une panne, c'est une règle."]},
 {r:["Montant, frais et commissions, taxes.","Cinq familles de plafonds, du solde à la fréquence.","Un refus de plafond n'est pas une panne : regarder le code d'échec."]}
]},
{id:"d6",t:"TradeOrder et PaymentOrder",cards:[
 {i:"Ticket",h:"Deux niveaux de commande",p:[fig("c2-37","Le modèle de transaction : une TradeOrder suit l'opération de bout en bout, des PaymentOrder suivent chaque mouvement de fonds."),"La [[TradeOrder]] suit ce que le client a demandé. La [[PaymentOrder]] suit chaque mouvement de fonds, transfert ou remboursement, avec un état simple : succès ou échec. Une TradeOrder porte une ou plusieurs PaymentOrder."]},
 {w:"commande"},
 {q:"Un achat en ligne de 300 se paie en trois paiements de 50, 150 et 100. Combien de TradeOrder ?",o:["Une","Trois","Quatre"],a:0,e:"Une seule [[TradeOrder]] avec trois [[PaymentOrder]]."},
 {i:"RotateCcw",h:"Annuler une partie",p:[fig("c1-48","La TradeOrder unifiée : annulation simple et annulations multiples dans un achat en plusieurs paiements."),"Le client peut annuler un des paiements, puis un autre : chaque annulation est une nouvelle TradeOrder qui pointe vers la commande d'origine. Le service client voit tout l'historique, et l'opérateur retrouve en un clic la transaction de départ d'une annulation."]},
 {w:"sim_order"},
 {i:"ListOrdered",h:"En deux phases",p:[fig("c2-38","Une transaction en deux phases : le compte d'attente est crédité au premier paiement, débité au second ; en cas d'échec du tiers, les fonds reviennent."),"Chaque mouvement a un compte débité et un compte crédité, pour que les fonds restent équilibrés même entre microservices. Le client ne voit que la TradeOrder ; les PaymentOrder ne s'affichent au portail que pour les annulations."]},
 {q:"Qu'est-ce qui est notifié au client final ?",o:["Chaque PaymentOrder","La TradeOrder","Les écritures comptables"],a:1,e:"La [[PaymentOrder]] est une trace interne ; le client est notifié sur la [[TradeOrder]]."},
 {r:["TradeOrder : la demande du client ; PaymentOrder : chaque mouvement.","Une annulation est une nouvelle TradeOrder liée à l'originale.","En deux phases, le compte d'attente garde l'équilibre."]}
]}
];

var M5=[
{id:"e1",t:"Actif-actif et site de secours",cards:[
 {i:"Building2",h:"Deux centres qui travaillent ensemble",p:[fig("c5-18","L'actif-actif : deux centres de la même ville (DC-1, DC-2) servent chacun une partie des clients ; un site distant garde une copie complète."),"En [[Actif-actif|actif-actif]], les deux centres ne sont pas « un principal et un secours » : chacun sert sa moitié des utilisateurs (par partition). Leurs bases sont répliquées en croisé : chaque centre garde une copie des données de l'autre.","Si un centre tombe, l'autre reprend tous les utilisateurs. Si les deux tombent, le site distant prend le relais avec son environnement complet."]},
 {w:"sim_aa"},
 {q:"En actif-actif, que fait le second centre quand tout va bien ?",o:["Il attend, éteint","Il sert sa propre partie des utilisateurs","Il ne fait que des sauvegardes"],a:1,e:"Les deux centres travaillent en même temps, chacun pour ses partitions : c'est le sens d'« actif-actif »."},
 {i:"Timer",h:"Les objectifs chiffrés",p:["Pour les applications : [[RPO]] presque nul (on ne perd pas de transaction) et [[RTO]] de moins de 2 minutes. Pour la gestion (MGT) : environ 15 minutes.","Ordres de grandeur annoncés pour une bascule : GSU environ 5 minutes, RSU environ 2 minutes. En 1.0, il fallait 10 à 15 minutes, et le secours était passif."]},
 {w:"sim_rto"},
 {q:"Que mesure le RTO ?",o:["La quantité de données perdues","Le temps pour rétablir le service","Le nombre de transactions par seconde"],a:1,e:"[[RTO]] : le temps de rétablissement. La perte de données, c'est le [[RPO]]."},
 {i:"Map",h:"Trois lieux, cinq centres",p:[fig("c1-23","Reprise multi-sites : deux régions à plus de 300 km, chacune avec deux zones à 40 km, et un cinquième centre de secours."),"Sur les grands déploiements, on va plus loin : deux régions éloignées de plus de 300 km, chacune avec deux zones proches (40 km, 2 ms de latence), plus un centre de secours local. Les stripes y sont répartis pour qu'aucune catastrophe locale ne coupe tout."]},
 {r:["Actif-actif : chaque centre sert sa moitié et garde la copie de l'autre.","Applications : RPO ≈ 0, RTO < 2 min ; gestion : ~15 min.","Les grands sites répartissent les stripes sur plusieurs régions."]}
]},
{id:"e2",t:"CloudDR",cards:[
 {i:"Settings",h:"Le chef d'orchestre de la bascule",p:[fig("c1-24","Le mécanisme CloudDR : un maître et un esclave sur les deux sites, qui surveillent les conteneurs par l'API Kubernetes et les bases par des agents."),"[[CloudDR]] surveille les applications en conteneurs à travers l'API de la plateforme, et l'état des bases à travers ses agents. Il pilote la réplication : son sens, l'état des liens, les données de référence."]},
 {w:"clouddr"},
 {i:"Repeat",h:"Ce que fait une bascule",p:[fig("c5-21","La bascule automatique : base GaussDB, arrêt et démarrage des microservices, ajustement des partitions dans la configuration Kubernetes."),"Trois temps : la base GaussDB bascule, les microservices sont arrêtés d'un côté et démarrés de l'autre, puis la répartition des CP est réécrite (configmap biz-gdr-cm) pour que le trafic aille au bon centre."]},
 {q:"Pendant une bascule, que fait CloudDR côté microservices ?",o:["Il les met à jour","Il les arrête et les démarre sur le bon site","Il les supprime"],a:1,e:"Une bascule enchaîne : bascule GaussDB, arrêt et démarrage des microservices, ajustement des partitions."},
 {i:"ListChecks",h:"Ce qu'il faut configurer",p:["Les liens de synchronisation des bases, les groupes de reprise, et la liste blanche des applications à redémarrer. Un lien de synchronisation coupé ne se voit pas tant qu'on ne bascule pas : c'est pourquoi l'alarme FileSync ou une réplication en retard se traite tout de suite."]},
 {r:["CloudDR : DRPortal (interface), DRService (pilotage), DRAgent (sur les nœuds avec état).","Bascule : base, puis services, puis partitions.","Un lien de réplication coupé fragilise la prochaine bascule."]}
]},
{id:"e3",t:"Quand bascule-t-on",cards:[
 {i:"Waypoints",h:"Le chemin du trafic",p:[fig("c5-20","Le trafic des clients : d'internet à la DMZ, puis vers les répartiteurs applicatifs des deux centres, avant et après une bascule."),"En temps normal, chaque centre reçoit la moitié du trafic. Après une bascule, le centre restant reçoit tout."]},
 {w:"scenarios"},
 {i:"TriangleAlert",h:"Une panne, une portée",p:[fig("c5-22","Les scénarios de reprise : panne de la DMZ, coupure réseau du site principal, panne d'un stripe, perte d'un site entier."),"Chaque cas a sa portée et sa réponse. Le FO doit savoir nommer la portée dans le ticket : un stripe, une zone, un site. C'est ce qui permet à l'équipe de décider s'il faut basculer."]},
 {q:"Seul le RSU02 est en défaut. Quelle est la portée à indiquer dans le ticket ?",o:["Site entier","Un stripe","La DMZ"],a:1,e:"Un défaut de stripe touche les utilisateurs des partitions de ce stripe, pas tout le site."},
 {i:"Ban",h:"Bascule et gray release ne se mélangent pas",p:["Pendant une [[Gray release|gray release]], la bascule n'est pas possible : il faut d'abord terminer ou annuler la release. Et après une bascule, on ne lance pas de mise à jour : la solution, en actif-actif, se met à jour entière."]},
 {q:"Une gray release est en cours et un site doit basculer. Que faut-il faire d'abord ?",o:["Basculer, la release suivra","Arrêter la gray release (la terminer ou l'annuler)","Ajouter des utilisateurs gris"],a:1,e:"Aucune bascule n'est permise pendant une gray release : on l'arrête d'abord."},
 {r:["Après bascule, un centre porte tout le trafic.","Quatre portées : DMZ, réseau du site, stripe, site entier.","Pas de bascule pendant une gray release, pas de mise à jour après."]}
]}
];

var M6=[
{id:"f1",t:"Le principe",cards:[
 {i:"Sparkles",h:"Goûter avant de servir",p:["La [[Gray release|gray release]] publie une nouvelle version d'abord pour un petit groupe d'[[Utilisateur gris|utilisateurs gris]], observe son comportement, puis élargit jusqu'à tout le monde.","C'est ce qui permet de mettre à jour MM 2.0 sans arrêter le service, alors qu'en 1.0 une mise à jour coupait tout pendant deux heures."],m:fig("c5-09","Installation, mise à jour et reprise en mode gris, pour le SaaS, le PaaS et l'IaaS.")},
 {i:"GalleryVerticalEnd",h:"Deux couloirs par stripe",p:[fig("c5-04","La gray release de bout en bout : le portail d'exploitation crée la tâche, le contrôleur déploie la version 2 dans le couloir gris de chaque stripe, le NSLB et la Super Gateway envoient les utilisateurs gris vers ce couloir."),"La Super Gateway trie : les utilisateurs gris passent dans le couloir de la nouvelle version, les autres restent dans l'actuel. Chaque couloir a un jeu complet de microservices ; les bases sont partagées et compatibles avec les deux versions."]},
 {w:"sim_gris"},
 {q:"Pendant une gray release, où passe la requête d'un client qui n'est pas gris ?",o:["Dans le couloir vert","Dans le couloir bleu (production)","Dans les deux"],a:1,e:"Seuls les [[Utilisateur gris|utilisateurs gris]] vont dans le couloir vert ; les autres restent en production."},
 {w:"principes_gris"},
 {i:"Lightbulb",h:"Les idées clés",p:[fig("c5-05","Les idées clés : zéro arrêt grâce au bleu et vert, déploiement par étapes, risque maîtrisé, décision sur les données.")]},
 {i:"RotateCcw",h:"Revenir en arrière",p:["Si la nouvelle version pose problème, on renvoie le trafic vers le bleu, sans arrêt.","Mais une fois 100 % du trafic passé sur la nouvelle version, revenir n'est plus conseillé : l'ancienne version risquerait de mal lire les données créées par la nouvelle."]},
 {r:["Nouvelle version d'abord pour quelques utilisateurs, puis pour tous.","Couloir bleu = production, couloir vert = nouvelle version, bases partagées.","Retour possible tant qu'on n'a pas atteint 100 %."]}
]},
{id:"f2",t:"Qui passe dans le couloir gris",cards:[
 {i:"UserCheck",h:"Choisir les utilisateurs gris",p:[fig("c5-15","Le paramétrage des groupes gris sur l'OM Portal : liste blanche et liste noire pour les clients, liste blanche pour les organisations et opérateurs."),"Avant la release, on configure les groupes sur l'OM Portal. Pour les clients : une liste blanche (souvent des MSISDN de test ou de collaborateurs) et une liste noire, qui l'emporte toujours. Pour les organisations et opérateurs : liste blanche seulement."]},
 {q:"Un MSISDN est à la fois dans la liste blanche et dans la liste noire. Où vont ses requêtes ?",o:["Dans le couloir vert","Dans le couloir bleu","La requête est rejetée"],a:1,e:"La liste noire a la priorité la plus haute : l'utilisateur n'est jamais routé vers le couloir gris."},
 {i:"DoorOpen",h:"La Super Gateway décide",p:[fig("c5-11","Le routage par la Super Gateway : le NSLB de la DMZ répartit au hasard, la Super Gateway regarde si la partie principale est grise."),"Le [[NSLB]] de la DMZ envoie les requêtes vers les deux couloirs. La [[Super Gateway]] regarde si la partie principale de la transaction est grise, et envoie la suite dans le bon couloir. Tout le reste du traitement se fait dans ce couloir."]},
 {w:"routage"},
 {i:"Waypoints",h:"Canal par canal",p:[fig("c5-10","La politique de gray release par canal : Super Gateway, portails, Config Portal, masse et tâches.")]},
 {q:"Pour les API, comment régler la part de trafic envoyée au couloir gris ?",o:["Par le poids du NSLB, égal à la part d'utilisateurs gris","Par une règle SMPP","On ne peut pas"],a:0,e:"Pour les API, le poids du NSLB doit suivre la proportion d'utilisateurs gris. Le SMPP, lui, ne gère pas les poids."},
 {r:["Listes blanche et noire (prioritaire), sur l'OM Portal.","Le NSLB répartit, la Super Gateway tranche selon la partie principale.","API par poids, SMPP par règles de routage."]}
]},
{id:"f3",t:"Portails, masse et configuration",cards:[
 {i:"Monitor",h:"Les portails",p:[fig("c5-12","Le routage des portails : le serveur de portail repère l'opérateur gris au login et fait suivre ses requêtes au couloir gris."),"Au login, le serveur de portail vérifie si l'opérateur est gris, pose un repère sur la requête et la fait suivre au bon couloir par le module de transfert du NSLB."]},
 {i:"LockKeyhole",h:"La configuration isolée",p:[fig("c5-13","L'isolement de la configuration : pas de connexion au Config Portal de production, pas de poussée de cache vers le DCC pendant la release."),"Les Config Portal des deux couloirs partagent la même base. Pour qu'une configuration mise à jour ne casse pas l'ancienne version, la production garde sa copie du cache : pendant la release, seuls les opérateurs gris modifient la configuration, et la production ne pousse rien vers le [[DCC]]."]},
 {q:"Pendant une gray release, un opérateur de production veut modifier un frais dans le Config Portal. Que se passe-t-il ?",o:["Il peut le faire","Ce n'est pas permis : seuls les opérateurs gris modifient la configuration","Il doit le faire dans les deux couloirs"],a:1,e:"La configuration est isolée pendant la release : seuls les opérateurs gris y touchent."},
 {i:"Layers",h:"Masse et tâches",p:[fig("c5-14","Les traitements en masse et les tâches pendant une release : le champ EXECUTOR_SWIMLANE dit dans quel couloir chacun s'exécute."),"Une tâche nouvelle ou modifiée par la version, incompatible avec l'ancienne, s'exécute par défaut dans le couloir gris. Un paiement groupé lancé par un opérateur de production reste en production, même s'il contient des utilisateurs gris."]},
 {r:["Portails : l'opérateur est repéré au login.","Configuration : seuls les gris la modifient, pas de poussée de cache en production.","Masse et tâches : un champ de couloir décide."]}
]},
{id:"f4",t:"Les règles du jeu",cards:[
 {i:"Shuffle",h:"Le réseau d'une release",p:[fig("c5-07","Le réseau d'une gray release : couloirs bleu (B) et vert (G) dans chaque zone, avec leurs règles de compatibilité."),"Cinq règles techniques : les changements GaussDB doivent rester compatibles (pas de retour sur la structure) ; le couloir G n'a que deux pods de middleware ; le DCC des deux couloirs utilise des schémas séparés ; la configuration Apollo est créée par couloir ; le NSLB de la DMZ est piloté par un module gris."]},
 {w:"regles"},
 {i:"Moon",h:"La nuit, en heure creuse",p:["Une release réduit les pods de production et augmente ceux du couloir gris : c'est un moment à risque. On la fait en heure creuse, de préférence avant 4 h du matin, quand la charge est sous 50 % de la capacité."]},
 {q:"Quel est le meilleur moment pour lancer une gray release ?",o:["En début d'après-midi, pour avoir du monde","En heure creuse, avant 4 h, sous 50 % de charge","Pendant une bascule de site"],a:1,e:"Le redimensionnement des pods comporte un risque : on le fait quand la charge est faible."},
 {i:"Server",h:"Des ressources en réserve",p:[fig("c5-06","Le périmètre : seuls le middleware et les services de la zone applicative passent en gris ; API Fabric, NFS, BDI, Kafka et le serveur OM n'en ont pas besoin."),"Il faut au moins 2 pods par service dans le couloir gris : environ 35 % des ressources de la production sur un grand réseau, plus de 80 % sur un petit. En urgence, après une bascule par exemple, ces ressources peuvent être rendues à la production."]},
 {q:"Peut-on mettre à jour un seul stripe en gray release ?",o:["Oui","Non, toute la solution passe en gray en même temps","Seulement le GSU"],a:1,e:"La gray release porte sur la solution entière : tous les stripes en même temps."},
 {r:["Heure creuse, avant 4 h, sous 50 %.","Toute la solution, une release à la fois, pas de bascule pendant.","Le couloir gris coûte 35 à 80 % de ressources en plus."]}
]},
{id:"f5",t:"Observer et décider",cards:[
 {i:"LayoutDashboard",h:"Regarder le couloir gris",p:[fig("c5-16","Pendant la release, DigitalView montre les TPS et le taux de succès du couloir gris."),"On suit dans [[DigitalView]] le taux de succès et les TPS du couloir gris, et on les compare au couloir bleu. C'est sur ces chiffres, et sur les retours des utilisateurs gris, qu'on décide d'élargir ou de revenir en arrière."]},
 {i:"Siren",h:"Le rôle du FO",p:["Un incident chez un utilisateur gris n'a pas la même portée qu'un incident général : il faut le dire dans le ticket, avec l'heure de début de la release.","Un taux de succès qui baisse dans le couloir gris pendant que le bleu reste stable est un signal fort contre la nouvelle version : à remonter tout de suite à l'équipe de release."]},
 {q:"Pendant une gray release, le taux de succès chute dans le couloir vert mais pas dans le bleu. Que suggère ce signal ?",o:["Un problème réseau général","Un problème probable dans la nouvelle version","Rien de particulier"],a:1,e:"Si seul le couloir de la nouvelle version se dégrade, la nouvelle version est la première suspecte."},
 {r:["Comparer couloir gris et couloir bleu, pas seulement regarder le gris.","Préciser dans le ticket qu'il s'agit d'utilisateurs gris.","Vert qui chute, bleu stable : alerter l'équipe de release."]}
]}
];

var M7=[
{id:"g1",t:"Les alarmes sur mesure",cards:[
 {i:"Bell",h:"Le panorama des alarmes",p:[fig("c4-03","Les fonctions d'alarme de DigitalView : surveillance du quotidien, traitement des alarmes, règles personnalisées, alarmes sur mesure."),"Au quotidien : filtres et modèles d'alarmes, tableaux du top 10, notifications par SMS ou e-mail. Pour traiter : les détails avec conseils de réparation, la confirmation (« quelqu'un s'en occupe »), et la note d'expérience qui aidera le suivant."]},
 {i:"Terminal",h:"Créer une alarme",p:[fig("c4-04","Les quatre étapes d'une alarme personnalisée : compte, script de surveillance, configuration de l'alarme, démarrage."),"Quand les alarmes d'usine ne couvrent pas un cas, on crée une [[Alarme personnalisée|alarme personnalisée]] en shell ou en SQL : déclarer le compte d'accès, écrire ou importer le script, configurer l'alarme (cible, période), démarrer la surveillance. Les équipes sur site peuvent ainsi surveiller une règle métier propre au pays."]},
 {w:"regles_alarme"},
 {i:"SlidersHorizontal",h:"Redéfinir un niveau",p:[fig("c4-05","Redéfinir le niveau d'une alarme : depuis la page des alarmes courantes, par règle, pour les nouvelles alarmes seulement."),"On monte d'un cran les alarmes d'un élément qui porte un service critique, pour qu'elles soient traitées en priorité. La règle ne change pas les alarmes déjà levées."]},
 {q:"On passe une alarme de « majeure » à « critique » par une règle de redéfinition. Que deviennent les alarmes déjà levées ?",o:["Elles passent toutes en critique","Elles gardent leur niveau ; seules les nouvelles changent","Elles sont effacées"],a:1,e:"La [[Redéfinition de sévérité|redéfinition]] ne touche que les alarmes levées après la règle."},
 {q:"Une même alarme se répète cinquante fois en dix minutes. Quelle règle réduit le bruit sans perdre l'information ?",o:["Une règle de masquage qui supprime les alarmes","Une règle d'agrégation","Une redéfinition de nom"],a:1,e:"L'[[Règle d'agrégation|agrégation]] regroupe les doublons sous une seule alarme ; les détails restent consultables."},
 {r:["Confirmer une alarme, c'est dire aux autres qu'on la suit.","Une alarme personnalisée se crée en shell ou SQL, en quatre étapes.","Redéfinir, masquer, agréger, renommer : quatre règles contre le bruit."]}
]},
{id:"g2",t:"Performances et seuils",cards:[
 {i:"ChartColumn",h:"Ce que mesure DigitalView",p:[fig("c4-07","La gestion des performances : tâches de collecte, observation en temps réel, alarmes de seuil, sur les ressources et les indicateurs métier."),"Les tâches de performance collectent les indicateurs : CPU, mémoire, disque, bande passante, mais aussi taux de succès, nombre d'utilisateurs, durée de traitement. Ce sont elles qui alimentent les alarmes de seuil."]},
 {i:"SlidersHorizontal",h:"Les boutons de la gestion des tâches",p:[fig("c4-08","Les actions sur les tâches de collecte : démarrer, arrêter, seuil, import, tâche d'agrégation, indicateurs personnalisés, période, durée de conservation, comparaison d'instantanés."),"Deux boutons méritent d'être connus : la tâche d'agrégation (combiner des indicateurs, par exemple en faire la somme) et la comparaison d'instantanés, qui compare deux moments côte à côte, typiquement avant et après une mise à jour."]},
 {i:"Gauge",h:"Des seuils par plage horaire",p:[fig("c4-09","Les seuils multi-périodes : une règle par plage horaire, et des expressions pour ignorer certains cas."),"Le trafic de nuit n'a rien à voir avec celui de midi. Un seuil unique crie toute la nuit, ou laisse passer une baisse à midi. On définit donc une règle par plage horaire, et des expressions d'exclusion pour les cas connus."]},
 {q:"Le trafic de nuit est dix fois plus faible : un seuil unique crée de fausses alarmes. Que faire ?",o:["Supprimer le seuil","Configurer des seuils par plage horaire","Augmenter la période de collecte"],a:1,e:"Les seuils multi-périodes donnent à chaque plage horaire sa propre limite."},
 {q:"Comment vérifier rapidement si une mise à jour a changé les indicateurs ?",o:["Une comparaison d'instantanés avant et après","Un BriefReport mensuel","Une alarme personnalisée"],a:0,e:"La comparaison d'instantanés est faite pour ça : deux moments, côte à côte."},
 {r:["Les tâches de collecte alimentent les seuils.","Une règle par plage horaire évite les fausses alarmes de nuit.","Avant/après une mise à jour : la comparaison d'instantanés."]}
]},
{id:"g3",t:"Tableaux de bord, rapports et bases",cards:[
 {i:"LayoutDashboard",h:"Le tableau de bord",p:[fig("c4-10","Le tableau de bord de supervision : vues prêtes, graphiques variés, descente du service jusqu'à l'instance."),"Il montre les indicateurs métier et les ressources en courbes, tableaux, camemberts ou nids d'abeille. Les vues sont prêtes à l'emploi, se montent par glisser-déposer, et permettent de descendre d'un service jusqu'à une instance précise."]},
 {i:"Monitor",h:"La santé de tout le système",p:[fig("c1-43","Le tableau de bord de santé de MM 2.0 : services, éléments et instances sur un seul écran."),"Avec des dizaines de services et des centaines d'instances, ce tableau sert à repérer en un coup d'œil l'élément défaillant. C'est souvent le premier écran à ouvrir quand plusieurs alarmes arrivent en même temps."]},
 {i:"Mail",h:"Le BriefReport",p:[fig("c4-14","Le BriefReport : un rapport d'exploitation configuré une fois, généré et envoyé automatiquement."),"Le [[BriefReport]] part seul, à heure fixe, vers ses destinataires : indicateurs de fonctionnement, capacité, carte de chaleur des alarmes. Une fois réglé, il remplace un rapport manuel quotidien."]},
 {q:"Quel est l'intérêt principal du BriefReport ?",o:["Corriger les alarmes","Envoyer automatiquement un rapport d'exploitation, configuré une seule fois","Remplacer les tableaux de bord"],a:1,e:"Une configuration, et le rapport part ensuite tout seul : moins de travail manuel."},
 {i:"Database",h:"DMS pour les bases",p:[fig("c4-15","DMS : supervision, inspection, diagnostic et collecte pour Oracle, GaussDB, MySQL, GMDB et Prometheus."),"[[DMS]] réunit la maintenance des bases : diagnostic en un clic de 48 problèmes courants, rapports AWR en un clic, requêtes lancées sur plusieurs bases à la fois. Il abaisse le niveau d'expertise nécessaire pour un premier diagnostic."]},
 {r:["Le tableau de bord de santé : le premier écran quand tout clignote.","Le BriefReport remplace un rapport manuel.","DMS diagnostique 48 problèmes de base en un clic."]}
]},
{id:"g4",t:"Configuration et élasticité",cards:[
 {i:"Settings",h:"La configuration à chaud",p:[fig("c1-37","La gestion de configuration par Apollo : centralisée en base, modifiable depuis une interface, versionnée, appliquée sans redémarrage."),"Avant, la configuration était éparpillée dans des fichiers et il fallait redémarrer après chaque changement. Avec [[Apollo]], elle est en base, modifiable depuis une interface, versionnée, et appliquée à chaud. Si Apollo tombe, chaque service lit sa copie locale."]},
 {q:"Le serveur Apollo est indisponible. Les services perdent-ils leur configuration ?",o:["Oui, ils s'arrêtent","Non, ils lisent leur copie locale","Seulement les services du GSU"],a:1,e:"Chaque client garde un fichier de cache local : les services continuent de tourner."},
 {i:"TrendingUp",h:"L'élasticité",p:[fig("c1-41","L'élasticité : Kubernetes ajoute des pods selon le CPU, la mémoire ou une heure prévue."),"Trois scénarios : CPU au-dessus de 85 %, mémoire au-dessus de 85 %, ou une heure fixée à l'avance (par exemple deux pods de plus au TransactionCenter à minuit le 24 décembre). Pour un pic connu, la règle horaire est la plus sûre : elle agit avant la charge."]},
 {w:"sim_elast"},
 {q:"Une promotion est prévue samedi à 20 h. Quelle règle d'élasticité anticipe le pic ?",o:["Une règle sur le CPU","Une règle à heure fixe","Aucune, il faut attendre le pic"],a:1,e:"Une règle à heure fixe ajoute des pods avant que la charge n'arrive."},
 {r:["Apollo : configuration en base, appliquée à chaud, avec copie locale.","Élasticité sur CPU, mémoire ou horaire.","Un pic connu s'anticipe avec une règle horaire."]}
]}
];

var M8=[
{id:"h1",t:"Repérer l'intrus",cards:[
 {i:"Sparkles",h:"Ce que l'IA apporte à l'exploitation",p:[fig("c4-18","Le panorama AIOps : réduire les délais de détection et de réparation, réduire le nombre d'incidents, améliorer l'efficacité des équipes."),"Trois objectifs. Détecter et réparer plus vite (anomalies, compression, analyse de cause, rapport, réparation). Avoir moins d'incidents (prédiction, contrôles de santé). Travailler plus vite (copilote en langage naturel)."]},
 {i:"Eye",h:"Le problème des seuils fixes",p:["Un seuil fixe est difficile à régler : trop bas, il crie sans raison ; trop haut, il laisse passer. Et dans un cluster de 20 instances, une seule qui dérive passe souvent inaperçue, parce que la moyenne reste bonne."]},
 {i:"ScanSearch",h:"La comparaison homogène",p:[fig("c4-19","La comparaison homogène : comparer les instances d'un même cluster sur plusieurs indicateurs pour trouver celle qui s'écarte."),"La [[Comparaison homogène|comparaison homogène]] regroupe les instances d'un même service et les compare entre elles sur le taux de succès, le délai et les TPS. Celle qui s'écarte du groupe déclenche une alarme, même si elle reste dans les seuils."]},
 {q:"Dans un cluster de 23 instances, l'une traite nettement moins de TPS que les autres. Quelle fonction la détecte ?",o:["Un seuil fixe global","La comparaison homogène","Un BriefReport"],a:1,e:"C'est son rôle : trouver l'instance qui ne ressemble pas à ses sœurs."},
 {i:"Clock",h:"Deux heures d'avance",p:[fig("c4-21","Deux cas réels : une instance fautive repérée à 7 h 41, avant la plainte client de 10 h ; une instance sur 23 signalée, cause trouvée dans le routage du NSLB."),"Des transferts internationaux échouaient de temps en temps, le client s'est plaint à 10 h. La comparaison homogène avait repéré l'instance fautive dès 7 h 41. Deux heures où l'équipe aurait pu agir avant la plainte."]},
 {r:["Une moyenne correcte peut cacher une instance malade.","La comparaison homogène compare les instances entre elles.","Bien réglée, elle alerte avant la plainte client."]}
]},
{id:"h2",t:"Seuils dynamiques et compression",cards:[
 {i:"Waves",h:"Des seuils qui apprennent",p:[fig("c4-22","La détection d'anomalies sur indicateurs : le modèle apprend la forme habituelle de chaque courbe et en déduit des seuils dynamiques."),"Au lieu d'une ligne fixe, le seuil suit la forme habituelle de la courbe : plus haut le midi, plus bas la nuit. Une baisse anormale à 3 h du matin est vue, même si la valeur reste au-dessus d'un seuil fixe classique."]},
 {i:"Shrink",h:"La compression d'alarmes",p:[fig("c4-23","La compression d'alarmes : des dizaines d'alarmes liées deviennent un incident, et une seule notification part."),"Quand un élément devient injoignable, ses voisins lèvent des dizaines ou des centaines d'alarmes en quelques secondes. La [[Compression d'alarmes|compression]] les regroupe en un incident, par règles fixes ou par algorithme, et n'envoie qu'une notification."]},
 {w:"sim_comp"},
 {q:"Cas réel : 280 alarmes en quelques secondes pendant un changement réseau. Combien de notifications après compression ?",o:["280","Une","Une par élément touché"],a:1,e:"Les alarmes sont rassemblées en un incident : une seule notification."},
 {i:"BellOff",h:"Ne plus masquer à l'aveugle",p:[fig("c4-25","Le cas des 280 alarmes : pendant un changement réseau, un élément injoignable ; après compression, un seul message."),"Pendant un changement, on masquait souvent des alarmes clés pour éviter la tempête, au risque de rater un vrai problème. Avec la compression, plus besoin de masquer : on reçoit l'incident, et le détail reste consultable."]},
 {r:["Les seuils dynamiques suivent la forme habituelle de la courbe.","Une tempête d'alarmes devient un incident et un message.","Moins de masquage, donc moins d'informations perdues."]}
]},
{id:"h3",t:"L'agent de panne et le copilote",cards:[
 {i:"Bot",h:"Le Fault Agent",p:[fig("c4-28","Avant et après le Fault Agent : d'une analyse manuelle, au fil de l'arbre de pannes, à une analyse guidée par un modèle de langage, des outils et une base de connaissances."),"Avant : une équipe regarde les tableaux, collecte les journaux et suit l'arbre de pannes pas à pas. Avec le [[Fault Agent]] : il rassemble alarmes, indicateurs et journaux, identifie les anomalies clés, appelle des outils, cherche dans la base de connaissances et rédige un rapport."]},
 {i:"Workflow",h:"Un exemple pas à pas",p:[fig("c4-29","Le Fault Agent sur un cas de connexion anormale à une base GMDB : détection, isolement de l'alarme racine, appels d'outils, rapport."),"Le taux de succès baisse et une connexion à la base est signalée anormale. L'agent identifie l'alarme racine (« écriture du journal sur disque impossible »), appelle l'outil d'analyse disque, confirme que le système de fichiers est plein à 100 % et rédige le rapport avec la marche à suivre."]},
 {w:"fault_agent"},
 {q:"Dans cet exemple, quelle cause le Fault Agent confirme-t-il ?",o:["Une coupure réseau","Un système de fichiers de journaux plein à 100 %","Une erreur de configuration Apollo"],a:1,e:"Il a appelé l'outil d'analyse disque et confirmé que le système de fichiers des journaux de la base était plein."},
 {i:"Lightbulb",h:"Le copilote d'exploitation",p:[fig("c4-32","Le copilote : chercher des données vivantes, interroger la documentation et se faire aider pour des opérations, en langage naturel."),"On lui parle normalement : « donne-moi le CPU de tel élément », « que faire pour ce code d'erreur ? », « vérifie l'état de tel élément ». Il remplace des allers-retours entre plusieurs écrans et documents."]},
 {q:"Un agent veut savoir comment traiter un code d'erreur sans fouiller la documentation. Que propose DigitalView ?",o:["Le copilote d'exploitation en langage naturel","La comparaison d'instantanés","La règle d'agrégation"],a:0,e:"Le copilote répond aux questions de connaissance à partir de la documentation produit."},
 {i:"Library",h:"Cinquante pannes connues",p:["Le Fault Agent sait diagnostiquer une cinquantaine de pannes système : réseau du centre, conteneurs saturés, disque plein, base indisponible, nœud qui redémarre…"],m:fig("c4-30","Les 50 scénarios de panne couverts, par catégorie : réseau, conteneur, système d'exploitation, stockage, base de données, services publics.")},
 {r:["Le Fault Agent fait le tri, vérifie avec des outils et écrit le rapport.","Il couvre une cinquantaine de scénarios de panne.","Le copilote répond en langage naturel : données, documentation, opérations."]}
]},
{id:"h4",t:"Prévoir avant la panne",cards:[
 {i:"Telescope",h:"Du curatif au préventif",p:[fig("c4-35","La prédiction : risque de capacité (croissance des TPS et du CPU) et dégradation de service (changements de motif dans les indicateurs et les journaux)."),"Deux familles de risques. La capacité : en projetant la croissance des TPS et du CPU, on voit qu'elle manquera en juillet et on agrandit avant. La dégradation : des indicateurs qui changent de forme sans franchir de seuil, signe qu'un problème se prépare."]},
 {q:"Un indicateur reste sous son seuil mais change de forme et devient instable. Quelle fonction s'en occupe ?",o:["La prédiction de dégradation de service","La compression d'alarmes","Le BriefReport"],a:0,e:"La prédiction repère les changements de motif avant qu'un seuil ne soit franchi."},
 {i:"Network",h:"Voir la solution en couches",p:[fig("c4-26","La vue en cinq couches : solution, site, application, pod, hôte, avec la santé de chacune."),"Pour relier un indicateur à son impact, DigitalView présente la solution en cinq couches. Une alarme sur un hôte se lit en remontant : quels pods tournent dessus, quelle application, quel service, quel client."]},
 {r:["Prédire la capacité pour agrandir à temps.","Repérer les changements de motif avant la panne.","Lire une alarme en remontant les couches, de l'hôte au service."]}
]}
];

var M9=[
{id:"i1",t:"Lire une chaîne d'appels",cards:[
 {i:"Waypoints",h:"Une requête, plusieurs services",p:[fig("c1-44","Les journaux et les chaînes d'appels dans DigitalView : collecte quasi temps réel, stockage centralisé, recherche unifiée."),"Pour traiter un paiement, la Super Gateway appelle l'orchestrateur, qui appelle les commandes, puis les comptes… Cette suite d'appels, c'est la [[Chaîne d'appels|chaîne d'appels]]. DigitalView les collecte, les stocke, les analyse et permet de les rechercher."]},
 {i:"LayoutDashboard",h:"Deux écrans",p:[fig("c7-03","La vue d'ensemble des chaînes d'appels (toutes les instances connectées) et l'écran de détail d'une chaîne."),"La vue d'ensemble montre toutes les instances de solution connectées. L'écran de chaîne d'appels de service donne le détail : topologie, Gantt et temps de réponse."]},
 {i:"Network",h:"La topologie",p:[fig("c7-04","La topologie : les composants d'une chaîne et leurs appels, en arbre."),"L'arbre montre qui appelle qui. C'est la vue pour comprendre la structure d'un traitement que l'on ne connaît pas, ou pour voir qu'une chaîne passe par un stripe inattendu."]},
 {i:"ListOrdered",h:"Le Gantt",p:[fig("c7-05","Le Gantt : les appels dans l'ordre du seqNo, avec leur niveau, leur début et leur durée."),"Chaque ligne est un appel, rangé dans l'ordre du [[seqNo]], avec sa durée en barre. Une barre beaucoup plus longue que les autres, c'est le service qui fait attendre tout le monde. Un code de retour anormal se clique pour voir son détail."]},
 {w:"sim_gantt"},
 {w:"vues_chaine"},
 {q:"Dans quelle vue lit-on l'ordre et la durée de chaque appel ?",o:["La topologie","Le Gantt","La vue d'ensemble"],a:1,e:"Le Gantt liste les appels dans l'ordre du [[seqNo]], avec leur durée."},
 {r:["Chaîne d'appels : la suite des services appelés pour une requête.","Topologie pour la structure, Gantt pour l'ordre et la durée.","La barre la plus longue du Gantt montre qui fait attendre."]}
]},
{id:"i2",t:"Pister une transaction",cards:[
 {i:"Map",h:"Le chemin d'un transfert",p:[fig("c2-42","Le chemin complet d'un transfert entre clients : NSLB, Super Gateway, orchestrateur, commandes, comptes, avec le saut entre stripes."),"Le [[NSLB]] envoie la requête au hasard vers une Super Gateway, qui trouve le stripe de la partie principale. Si l'autre client est dans un autre stripe, la chaîne fait un saut entre stripes. C'est la carte à avoir en tête quand on lit une chaîne de transfert."]},
 {i:"Search",h:"Retrouver une transaction",p:[fig("c7-09","Le LinkID : un identifiant de lien (par exemple InitTrans suivi du nom de l'opération) pour retrouver la chaîne d'une transaction."),"Chaque transaction porte un LinkID qui permet de retrouver sa chaîne. Le cas d'usage type : une opération métier est restée dans un état anormal, on cherche où elle s'est arrêtée."]},
 {i:"ScanSearch",h:"Le cas type",p:[fig("c7-13","Chercher une opération métier restée dans un état anormal : on filtre, on ouvre la chaîne, on voit l'appel en échec.")]},
 {i:"SlidersHorizontal",h:"Filtrer par latence",p:[fig("c7-10","Le filtre de latence : les chaînes qui dépassent le critère sont mises en évidence."),"Quand un client dit « ça tourne longtemps », on filtre les chaînes sur leur temps de réponse. Celles qui dépassent le critère sont mises en évidence, puis le Gantt montre quel appel prend du temps."]},
 {q:"Un client se plaint que ses paiements mettent longtemps. Quel filtre aide à trouver le service lent ?",o:["Le filtre de latence de la chaîne d'appels","Le filtre de sévérité des alarmes","La liste noire gray release"],a:0,e:"Le filtre de latence met en évidence les chaînes lentes ; le Gantt montre ensuite quel appel prend du temps."},
 {i:"Crosshair",h:"Le log de traçage",p:[fig("c7-11","Le log de traçage : une règle dans la configuration qui garde 100 % des chaînes d'un MSISDN pendant une durée donnée."),"Normalement, les chaînes sont échantillonnées : on n'en garde qu'une partie, parfois 0 %. Pour reproduire un problème, on pose un [[Log de traçage|log de traçage]] sur un MSISDN pendant quelques heures : toutes ses chaînes sont alors gardées, sans charger le reste du système."]},
 {w:"tracage"},
 {q:"L'échantillonnage est à 0 % et on veut suivre un client précis pendant une heure. Que faire ?",o:["Passer l'échantillonnage à 100 % pour tous","Poser un log de traçage sur son MSISDN pour une heure","Attendre la prochaine panne"],a:1,e:"Le [[Log de traçage|log de traçage]] garde 100 % des chaînes qui correspondent au critère, sans charger tout le système."},
 {r:["Garder en tête le chemin d'un transfert, saut entre stripes compris.","LinkID pour retrouver, filtre de latence pour trouver le lent.","Log de traçage ciblé quand l'échantillonnage ne suffit pas."]}
]}
];

var M10=[
{id:"j1",t:"La cuisine centrale des données",cards:[
 {i:"Factory",h:"Du marché à la cuisine",p:[fig("c6-02","Des données en vrac (l'étal de marché) à une cuisine centrale qui prépare des plats semi-finis : modèles de données et API prêts à l'emploi."),"Avant : des données en vrac, difficiles à comprendre, chères à stocker, qui demandent des experts et de longs développements en usine. Avec [[Smart DataCube]] : une cuisine centrale qui orchestre, gouverne et ouvre les données, avec plus de 200 modèles prêts à l'emploi et un développement sur site en low-code."]},
 {i:"Layers",h:"L'architecture fonctionnelle",p:[fig("c6-03","L'architecture de DataCube : studio de développement, studio de gouvernance, studio d'exploration, au-dessus d'un moteur de calcul unifié."),"Trois studios pour trois publics. Le développement (Data Factory) pour construire les flux. La gouvernance (Data Compass, DAMS) pour la qualité, les métadonnées et la sécurité. L'exploration (SQL Editor, tableaux de bord, API Fabric) pour ceux qui consomment les données."]},
 {w:"datacube"},
 {q:"Quel outil de DataCube sert à rechercher un modèle de données et demander un accès ?",o:["Data Factory","DAMS","SQL Editor"],a:1,e:"[[DAMS]] est le catalogue des actifs de données : recherche, qualité, demande d'accès."},
 {i:"Workflow",h:"Le cycle DataOps",p:[fig("c6-04","Le cycle DataOps : intégrer, modéliser, développer, publier, explorer, avec la qualité, le catalogue et la sécurité tout autour."),"Le cycle relie la demande du métier à la consommation des données : intégration, modélisation, développement, mise à disposition, exploration. La qualité, le catalogue et la sécurité accompagnent chaque étape."]},
 {r:["DataCube : orchestrer, gouverner, ouvrir les données.","Trois studios : développement, gouvernance, exploration.","200+ modèles prêts, développement en low-code sur site."]}
]},
{id:"j2",t:"Collecter et transformer",cards:[
 {i:"ArrowDownToLine",h:"Faire entrer les données",p:[fig("c6-05","La collecte : plus de 10 modes d'accès, 5 formats de fichiers, 18 transformations, et le contrôle des flux."),"Plus de 10 modes d'accès (Kafka, SFTP, HDFS, MQTT, stockage objet, HTTP, SNMP, REST, et les bases MySQL, PostgreSQL, Oracle, GaussDB). Cinq formats de fichiers (CSV, XML, JSON, TLV, binaire, compressés ou non). Dix-huit transformations : filtres, découpage, conversion, contrôle de validité, chiffrement…"]},
 {i:"Workflow",h:"Data Factory",p:[fig("c6-06","La Data Factory : les opérateurs d'orchestration (sources, modèles, lots, flux, règles, planification)."),"La [[Data Factory]] assemble tout : sources, modèles, traitements par lots et en flux, règles, planification unifiée. L'objectif affiché : que le développement de données devienne simple pour les équipes métier."]},
 {q:"Combien de modes d'accès aux données DataCube annonce-t-il ?",o:["Plus de 10","3","Plus de 200"],a:0,e:"Plus de 10 modes d'accès ; les 200 et plus, ce sont les modèles de données prêts."},
 {r:["10+ modes d'accès, 5 formats, 18 transformations.","La Data Factory orchestre lots et flux.","Le low-code rapproche les données des métiers."]}
]},
{id:"j3",t:"Gouverner et partager",cards:[
 {i:"Compass",h:"Data Compass",p:[fig("c6-07","Data Compass : standards de données, gestion des métadonnées, visualisation, recherche et catalogue."),"Le centre de gouvernance : standards de données, métadonnées, [[Lignage|lignage]], recherche et catalogue, vue 360. Ses utilisateurs sont les architectes et ingénieurs de gouvernance ; ses bénéficiaires, tous ceux qui consomment les données."]},
 {i:"CircleCheck",h:"La qualité des données",p:[fig("c6-08","La qualité des données : auditable, évaluable, délimitable, visible ; règles, tableau de bord, rapports."),"La qualité s'évalue sur six dimensions (cohérence, validité, complétude, continuité, exactitude, fraîcheur). Règles préparées, tableau de bord unifié, rapports exportables en un clic, et une topologie qui localise vite le composant défaillant."]},
 {q:"Laquelle de ces dimensions fait partie de la qualité des données selon DataCube ?",o:["La fraîcheur","La couleur","Le nombre de colonnes"],a:0,e:"Les six dimensions : cohérence, validité, complétude, continuité, exactitude, fraîcheur."},
 {i:"Library",h:"Catalogue et métadonnées",p:[fig("c6-10","DAMS : les actifs de données visibles, évalués et accessibles sur demande."),"[[DAMS]] rend les modèles de données visibles et cherchables, affiche leur qualité, et gère les demandes d'accès en ligne. MetaOne, à côté, unifie les modèles logiques et physiques et les synchronise vers tous les outils."],m:fig("c6-09","MetaOne : un service de métadonnées unique, synchronisé vers le lignage, l'orchestration, le SQL et les API.")},
 {i:"Share2",h:"Partager",p:[fig("c6-11","Le SQL Editor : requêtes en syntaxe unifiée sur les modèles du catalogue, avec contrôle des droits."),"SQL Editor pour interroger avec une syntaxe unifiée, [[API Fabric]] pour publier des données en API, tableaux de bord en libre-service, y compris sur mobile. L'anonymisation et les contrôles d'accès protègent les données sensibles."],m:fig("c6-13","L'exploration visuelle : tableaux de bord sans code, 18 types de widgets, version mobile.")},
 {r:["Data Compass : standards, métadonnées, lignage, catalogue.","Six dimensions de qualité, mesurées et rapportées.","Partage par SQL, API, fichiers et tableaux de bord, avec anonymisation."]}
]},
{id:"j4",t:"Le DataCube du projet MM",cards:[
 {i:"Globe",h:"Plusieurs pays, un socle",p:[fig("c6-14","DataCube sur le projet MM du groupe : données de chaque cœur MM pays, rapports pays et rapprochement, rapport groupe, connexion unique depuis le portail MM."),"DataCube reçoit les données de chaque cœur MM pays, par Kafka et par SFTP. Il produit des rapports par pays, des rapports de rapprochement, et un rapport groupe. Les utilisateurs s'y connectent depuis le portail MM, sans second mot de passe."]},
 {i:"Users",h:"Multi-locataires",p:[fig("c6-15","La gestion multi-locataires : ressources, projets, utilisateurs et rôles isolés par locataire."),"Chaque locataire a ses ressources, ses projets et ses utilisateurs, avec des rôles et des droits isolés. Un pays ne voit pas les données d'un autre."]},
 {i:"Building2",h:"La reprise des données",p:[fig("c6-16","La reprise de DataCube : deux sites actifs (Côte d'Ivoire et Sénégal) et un site de secours, avec ce qui est synchronisé entre eux."),"Deux sites actifs, celui de Côte d'Ivoire (OCI) et celui du Sénégal (OSN), plus un site de secours. Comptes, rôles, configuration et données des rapports sont synchronisés ; les deux sites actifs reçoivent la même application par la chaîne de déploiement."]},
 {q:"Sur le projet MM du groupe, quels sont les deux sites DataCube actifs ?",o:["Dakar et Abidjan (OSN et OCI)","Nairobi et Dar es Salaam","Un seul site, sans secours"],a:0,e:"Les sites actifs sont ceux du Sénégal (OSN) et de Côte d'Ivoire (OCI), avec un site de secours."},
 {i:"Server",h:"Le déploiement physique",p:[fig("c6-18","Le déploiement physique : nœuds de gestion et de données de chaque site, environnements de production, de pré-production et de test.")]},
 {r:["Un DataCube pour plusieurs pays : rapports pays, rapprochement, rapport groupe.","Locataires isolés.","Deux sites actifs (OCI, OSN) et un secours."]}
]}
];

var M11=[
{id:"k1",t:"API Fabric",cards:[
 {i:"Plug",h:"Une plateforme d'API ouverte",p:[fig("c1-29","Le panorama des API : plus de 400 API métier, plus de 300 API de support, l'accès, l'orchestration et les développeurs locaux."),"L'[[API Fabric]] rassemble plus de 400 API métier et plus de 300 API de support, en SOAP, REST, HTTPS, SMPP, ISO 8583… Elle gère l'accès (OAuth 2.0, routage, contrôle de débit) et surveille les API en temps réel."]},
 {i:"Repeat",h:"Compatibilité et orchestration",p:[fig("c1-30","L'API Fabric : compatibilité avec les anciennes API SOAP, ouverture en REST, orchestration graphique ou par script."),"MM 2.0 propose des API REST (Open API 3.0). Les anciennes API SOAP de MM 1.0 restent acceptées : l'API Fabric convertit. Dans l'autre sens, une API REST de paiement de facture peut être traduite vers l'API SOAP d'un facturier."]},
 {w:"api"},
 {i:"Workflow",h:"Trois cas concrets",p:[fig("c1-31","Trois besoins de partenaires : orchestrer plusieurs API en une, alléger une réponse, convertir REST et SOAP.")]},
 {q:"Un partenaire veut le profil et le solde d'un client en un seul appel. Que fait l'API Fabric ?",o:["Elle refuse, il faut deux appels","Elle orchestre plusieurs API en une et renvoie le résultat combiné","Elle donne accès direct à la base"],a:1,e:"L'orchestration combine plusieurs API atomiques en une seule pour le partenaire."},
 {r:["400+ API métier, 300+ API de support.","Conversion de protocoles, orchestration, réponses allégées.","OAuth 2.0, routage, contrôle de débit, surveillance."]}
]},
{id:"k2",t:"Les données en sortie",cards:[
 {i:"Share2",h:"Trois voies",p:[fig("c1-33","L'ouverture des données : fichiers ETL quotidiens ou horaires, fichiers EDR toutes les 5 à 10 minutes, flux Kafka en temps réel."),"Le choix dépend du besoin du partenaire. L'entrepôt de données et la BI se contentent de fichiers ETL quotidiens. Une application qui réagit aux événements prend les [[EDR]]. L'anti-blanchiment ou la gestion des risques en temps réel se branchent sur [[Kafka]]."]},
 {w:"sorties"},
 {q:"Un système de lutte anti-blanchiment veut les événements avec moins de dix minutes de retard, sans brancher Kafka. Quelle voie ?",o:["Les fichiers EDR","L'extraction ETL quotidienne","Un BriefReport"],a:0,e:"Les fichiers [[EDR]] arrivent toutes les 5 à 10 minutes."},
 {i:"History",h:"L'historique en ligne",p:[fig("c1-46","L'historique des transactions : 180 jours dans la base en ligne, jusqu'à 10 ans dans la base historique, une table par année."),"Avant, un client ne voyait que 7 jours de transactions, sur 6 mois au plus, à cause des limites d'affichage des anciens canaux. En 2.0 : jusqu'à 180 jours par requête, sur un historique de 10 ans, grâce à la [[HISDB]]."]},
 {q:"Sur quelle profondeur d'historique un client peut-il consulter ses transactions en MM 2.0 ?",o:["7 jours","6 mois","Jusqu'à 10 ans"],a:2,e:"L'historique va jusqu'à 10 ans, consulté par tranches de 180 jours au plus."},
 {r:["ETL pour la BI, EDR pour les événements, Kafka pour le temps réel.","Historique client : 180 jours par requête, jusqu'à 10 ans.","La voie se choisit selon le délai dont le partenaire a besoin."]}
]}
];

var M12=[
{id:"l1",t:"Lire une alarme MM 2.0",cards:[
 {i:"BookOpen",h:"Des alarmes réelles",p:["Ce module part de trois extractions du site OSN : la matinée du 20 octobre (310 alarmes), les alarmes courantes du 19 octobre, et une liste du 21 octobre.","Une cinquantaine de titres différents reviennent. Le but : savoir ce que chacun veut dire, ce qu'il touche, et par quoi commencer."]},
 {i:"Rows3",h:"Les colonnes à lire",p:["La sévérité (Critical, Major, Minor, Warning), le statut (To-be-assigned : personne ne l'a prise ; Cleared : effacée), les dates de dernière occurrence et d'effacement.","La colonne de compression : [[Alarme principale|Main Alarm]] ou [[Alarme secondaire|Secondary Alarm]]. Le 20 octobre, 46 alarmes principales portaient 264 secondaires."]},
 {w:"moname"},
 {q:"Que dit le morceau « rsu01 » dans wallet_osn_prd_rsu01_b_pr1_transaction-center ?",o:["Le numéro de serveur","Le stripe régional concerné","La version du service"],a:1,e:"Le [[MOName]] suit l'architecture : rsu01 est le stripe régional n° 1 ; gsu, le stripe global ; csu00, un stripe commun."},
 {i:"Map",h:"Pourquoi c'est utile",p:["En lisant le MOName, on sait tout de suite si l'alarme touche la production ou la pré-production, quel stripe et quel centre.","Une alarme en pré-production (pre) n'a pas la même urgence qu'en production (prd) : on le dit dans le ticket."]},
 {q:"Une alarme porte « wallet_osn_pre_… ». Quel est le premier réflexe ?",o:["Ouvrir un P1 tout de suite","Noter qu'il s'agit de la pré-production avant de juger l'urgence","L'ignorer"],a:1,e:"pre désigne la pré-production : l'impact client n'est pas le même qu'en prd. On la traite, mais avec la bonne portée."},
 {r:["Sévérité, statut, dates, compression : les colonnes de base.","Le MOName donne pays, environnement, stripe, couloir, centre et service.","prd = production ; pre = pré-production."]}
]},
{id:"l2",t:"Quand un service est isolé",cards:[
 {i:"Boxes",h:"DSF business health checker failed and isolated",p:["Critical. L'alarme la plus fréquente du 20 octobre (132 fois).","Le [[Health checker|contrôle de santé]] du [[DSF]] a jugé une instance de service malade et l'a isolée : elle ne reçoit plus d'appels. Les autres instances du même service prennent le trafic."]},
 {w:"sim_health"},
 {i:"Scale",h:"Grave ou pas ?",p:["Une instance isolée sur plusieurs : le service tourne encore, avec moins de capacité.","Toutes les instances d'un service isolées, ou des dizaines de services en même temps : le service est en danger. C'est la portée qui fait la gravité."]},
 {q:"Une seule instance de transaction-center est isolée, les autres sont saines. Quel est l'impact probable ?",o:["Le service est coupé","Le service tourne avec moins de capacité","Aucun service ne fonctionne dans le stripe"],a:1,e:"L'isolement retire l'instance malade du trafic ; les autres continuent. Il faut quand même comprendre pourquoi elle est tombée."},
 {i:"Stethoscope",h:"Les alarmes voisines",p:["App Service unhealthy : l'indicateur de santé d'un service passe sous son seuil.","Thread pool usage exceeds threshold : le service utilise presque tous ses fils d'exécution ; il risque de ne plus accepter de requêtes.","Ces trois alarmes arrivent souvent ensemble : la saturation précède l'isolement."]},
 {i:"KeyRound",h:"Services d'appui",p:["CAS process is abnormal : le composant de connexion unique des portails est en défaut ; les connexions aux portails peuvent échouer.","The notification service status is abnormal : le [[Notification Center]] va mal ; des SMS de confirmation peuvent ne pas partir.","Init Liquibase failed : un service n'a pas pu préparer sa base au démarrage (le 20/10 : le journal d'audit)."]},
 {q:"CAS process is abnormal en production. Qui risque de s'en apercevoir en premier ?",o:["Les clients USSD","Les utilisateurs des portails (SP Portal, Org Portal)","Personne"],a:1,e:"CAS gère la connexion unique des portails : ce sont leurs utilisateurs qui sont touchés."},
 {r:["Health checker : l'instance malade est retirée du trafic.","La gravité dépend du nombre d'instances et de services touchés.","Saturation (thread pool, CPU) puis isolement : un enchaînement classique."]}
]},
{id:"l3",t:"Les taux de succès",cards:[
 {i:"Gauge",h:"Les alarmes qui parlent du client",p:["Une partie des alarmes ne parle pas d'un composant, mais d'un résultat : le taux de succès des transactions ou des appels.","Ce sont souvent elles qui disent si le client est touché."]},
 {w:"taux"},
 {q:"AG_Outbound_Success_Rate_Alarm se déclenche. Que regarder ?",o:["Les appels de la Super Gateway vers les systèmes tiers (banques, facturiers)","Les connexions aux portails","Les sauvegardes"],a:0,e:"Outbound : ce qui sort de la [[Super Gateway]] vers l'extérieur. Un tiers qui répond mal fait baisser ce taux."},
 {i:"History",h:"Seuil fixe ou comparaison",p:["Fixed Threshold : l'indicateur passe sous une valeur fixe.","Ratio Threshold : l'indicateur baisse par rapport à la même heure la semaine précédente. Exemple : « P1_All FTPS decreased by 10% compare with last week ».","Une baisse de trafic n'est pas forcément une panne (jour férié, promotion finie), mais elle se vérifie toujours."]},
 {q:"« AG_Channel_Success_Rate_Decreased_Compared_To_Lastweek » : à quoi compare-t-on ?",o:["À une valeur fixe","À la même période de la semaine précédente","Au taux de l'autre centre"],a:1,e:"C'est un [[Seuil de ratio|seuil de ratio]] : comparaison avec la semaine passée."},
 {i:"Layers",h:"DSF côté client",p:["DSF_Client_Operation_Success_Rate_Too_Low et dsf services failed too much : un service appelle un autre service et une trop grande part des appels échoue.","Le nom de l'opération est dans la description (par exemple acct_accumulateWaterMark côté transaction-center) : il dit quel échange pose problème."]},
 {r:["Taux de succès : l'alarme la plus proche de l'impact client.","Inbound = ce qui entre, Outbound = ce qui sort vers les tiers.","Ratio threshold : comparaison avec la semaine précédente."]}
]},
{id:"l4",t:"Les dépendances",cards:[
 {i:"Network",h:"Un service ne vit pas seul",p:["Les microservices dépendent de briques communes : coordination, configuration, registre, messages, chiffrement.","Quand une de ces briques manque, plusieurs services alarment en même temps."]},
 {w:"dependances"},
 {q:"Plusieurs services lèvent « Disconnected with DCC server ». Que perdent-ils ?",o:["L'accès à leur configuration métier","Leurs journaux","Leur licence"],a:0,e:"Le [[DCC]] porte la configuration métier poussée par le Config Portal."},
 {i:"KeyRound",h:"HSM exception alarm",p:["Un service (le 19/10 : organization-center) n'arrive plus à joindre le [[HSM]].","Les opérations qui demandent du chiffrement (vérification de code PIN, par exemple) peuvent échouer : à relier aux plaintes clients et aux taux de succès."]},
 {i:"Hash",h:"ID Near Max",p:["L'[[IdentifierCenter]] approche la fin d'une plage de numéros.","Rappel : les identifiants ont une partie séquence de taille fixe. Une plage presque pleine doit être traitée avant d'être épuisée, sinon la création d'entités ou de commandes peut échouer. À escalader, même si le service tourne."]},
 {q:"ID Near Max est en Major et rien ne semble cassé. Pourquoi l'escalader quand même ?",o:["Parce que la plage de numéros s'épuise et que la création peut échouer ensuite","Parce que c'est une alarme de sécurité","Ce n'est pas nécessaire"],a:0,e:"C'est une alarme d'anticipation : elle prévient avant la panne."},
 {r:["ZooKeeper, DCC, registre, NATS, Canal : des briques partagées.","Plusieurs services en alarme sur la même brique = une cause commune.","HSM et ID Near Max : à relier à l'impact et à anticiper."]}
]},
{id:"l5",t:"Plateforme, bases et reprise",cards:[
 {i:"Container",h:"Pod status abnormal",p:["Un [[Pod]] n'est pas dans l'état attendu. Le namespace et le nom du pod sont dans la description (le 20/10 : venus, om-portal).","Un pod qui redémarre en boucle ou ne démarre pas prive son service d'une instance."]},
 {i:"Database",h:"GaussDB",p:["The cluster status is abnormal : le cluster de base n'est pas dans son état normal.","Floating IP Address Setting Failure : l'[[IP flottante]] n'a pas pu être posée sur le nœud actif. Les applications risquent de ne plus trouver leur base. Critical.","OMM user trust relationship lost : la confiance entre les comptes système des nœuds est rompue ; la gestion du cluster en souffre."]},
 {q:"Floating IP Address Setting Failure sur une base GaussDB. Pourquoi est-ce critique ?",o:["Les applications se connectent par cette adresse : sans elle, elles peuvent perdre leur base","C'est une alarme de sécurité","Elle bloque seulement les rapports"],a:0,e:"L'[[IP flottante]] est le point d'entrée de la base active."},
 {i:"ShieldCheck",h:"FileSync Link Is Abnormal",p:["Levée par [[CloudDR]] : un lien de synchronisation de fichiers entre sites est coupé (le 20/10 : le lien bulk2).","Le service tourne, mais le site de secours n'a plus les fichiers à jour : une bascule serait moins propre. À traiter avant d'en avoir besoin."]},
 {i:"OctagonAlert",h:"Data tampering alarm",p:["Levée sur acctrans : le contrôle d'intégrité des données de comptes trouve trop d'écarts.","Elle touche l'argent : on ne la classe jamais sans avis de l'équipe compétente, même en pré-production."]},
 {i:"HardDrive",h:"Ressources et supervision",p:["CPU Usage, High file system usage (souvent /var/log), Abnormal Disk Usage of the Resource Cache Service : des ressources qui saturent.","User-defined Performance Script Collection Exception et Database Monitoring Script Execution Exception : ce n'est pas le service qui tombe, c'est un script de surveillance qui échoue. Le risque : un angle mort dans la supervision."]},
 {q:"Database Monitoring Script Execution Exception : qu'est-ce qui est en panne ?",o:["La base de données","Le script qui surveille la base","Le réseau"],a:1,e:"C'est le script de collecte qui échoue : la base peut aller bien, mais on ne la voit plus correctement."},
 {r:["Pod, cluster GaussDB, IP flottante : la plateforme sous les services.","FileSync (CloudDR) : la reprise est fragilisée même si tout tourne.","Data tampering : toucher à l'argent, toujours escalader.","Script en échec = angle mort de supervision."]}
]},
{id:"l6",t:"Réseau et sécurité",cards:[
 {i:"BrickWall",h:"Les pare-feux",p:["Les alarmes qui commencent par hw viennent des pare-feux (internal_fw, internet_fw), sur chaque centre.","Ils vont par paires : un actif, un en veille, reliés par [[HRP]]."]},
 {w:"pare_feux"},
 {q:"hwPowerInvalid sur un pare-feu, le trafic passe toujours. Que faut-il retenir ?",o:["Rien, tout va bien","Une alimentation est en panne : la redondance est perdue, une deuxième panne couperait l'équipement","Le pare-feu doit être redémarré tout de suite"],a:1,e:"L'équipement tourne sur l'alimentation restante : c'est la marge de sécurité qui a disparu."},
 {i:"Server",h:"VIP Group Heartbeat Part Abnormal",p:["Le [[NSLB]] travaille en groupe autour d'adresses virtuelles. Une partie du battement de cœur du groupe est anormale : la bascule entre ses nœuds pourrait mal se passer."]},
 {i:"LockKeyhole",h:"Login Attempts Reach the Maximum Value",p:["Un compte a échoué plusieurs fois à se connecter (le 20/10 : 5 échecs en 10 minutes sur le compte thirdparty).","Erreur de mot de passe d'une application, ou tentative d'intrusion : on prévient l'équipe sécurité et le propriétaire du compte."]},
 {q:"Un compte technique cumule les échecs de connexion. Que fait le FO ?",o:["Il ignore l'alarme","Il prévient l'équipe sécurité et le propriétaire du compte","Il change lui-même le mot de passe"],a:1,e:"Ce peut être un mot de passe changé côté application, ou une attaque : ce n'est pas au FO de trancher seul."},
 {i:"ArrowUpFromLine",h:"Les remontées",p:["The northbound interface communication is abnormal : la remontée vers le système du dessus (OSS) ne passe plus.","Failed to Send the Remote Notification : DigitalView n'a pas pu envoyer un SMS d'alerte. Quelqu'un attendait peut-être cette alerte."]},
 {r:["hw… = pare-feux, par paires actif/veille (HRP).","Panne d'alimentation ou d'optique : la redondance baisse.","Échecs de connexion : sécurité + propriétaire du compte.","Nord ou notification en échec : des alertes peuvent manquer."]}
]},
{id:"l7",t:"Cas : la matinée du 20 octobre",cards:[
 {i:"Clock",h:"Ce que montre l'extraction",p:["Entre 9 h et 13 h, 310 alarmes. Deux vagues : environ 100 vers 12 h 50, puis plus de 170 entre 13 h 20 et 13 h 45.","132 fois « DSF business health checker failed and isolated », sur 18 services différents : transaction-center, acctrans, identity-business, workflow, portails, settlement-center…"]},
 {i:"Map",h:"Le point commun",p:["Toutes ces alarmes d'isolement viennent du même endroit : le stripe global ([[GSU]]) et le stripe commun csu00, au centre pr1.","En même temps : CAS anormal, thread pools et CPU au-dessus du seuil. Beaucoup d'alarmes s'effacent au bout de 4 à 5 minutes, puis reviennent."]},
 {q:"18 services s'isolent en même temps, tous sur GSU au centre pr1. Quelle lecture privilégier ?",o:["18 pannes indépendantes, 18 tickets","Une cause commune à ce stripe et ce centre, un seul incident","Un problème du client final"],a:1,e:"Quand tout tombe au même endroit au même moment, on cherche ce qui est partagé : hôtes, base, coordination, réseau du centre."},
 {i:"ListChecks",h:"Les bons gestes",p:["Un incident, avec la portée exacte : production, GSU et csu00, centre pr1, heures des vagues.","Regarder les taux de succès pour mesurer l'impact client, et les briques partagées (ZooKeeper, DCC, base, hôtes) pour orienter l'enquête.","Noter que les alarmes s'effacent puis reviennent : un service qui oscille n'est pas un service guéri."]},
 {i:"Shrink",h:"La compression a aidé",p:["Sur les 310 alarmes, 264 étaient secondaires : la [[Compression d'alarmes|compression]] les a rangées sous 46 alarmes principales.","On lit les principales, on ouvre les secondaires pour mesurer l'étendue."]},
 {q:"Les alarmes s'effacent au bout de 5 minutes puis reviennent. Peut-on clore l'incident ?",o:["Oui, elles sont effacées","Non, le service oscille : la cause n'est pas réglée","Oui, si la sévérité baisse"],a:1,e:"Un effacement suivi d'une nouvelle levée montre que le problème est toujours là."},
 {r:["Beaucoup de services au même endroit = une cause commune, un incident.","Donner la portée : environnement, stripe, centre, heures.","Effacé puis relevé = pas résolu.","Lire les principales, ouvrir les secondaires pour l'étendue."]}
]}
];

/* ── Modules ───────────────────────────────────────────────── */
var POSE={wave:'Sparkles',happy:'Trophy',think:'CircleHelp',oops:'CircleX',point:'Pin'};
function mascot(pose,icn){return '<span class="mascot illus illus-'+(pose||'wave')+'" aria-hidden="true">'+ico(icn||POSE[pose]||'Sparkles',48,1.6)+'</span>'}
var MODS=[
 {id:"M1",ic:"Layers",soft:"#CFD2F7",deep:"#4F54D6",t:"Pourquoi MM 2.0",d:"Les limites de MM 1.0, les microservices, les zones et les couches, le déploiement sur plusieurs sites.",S:M1},
 {id:"M2",ic:"Rows3",soft:"#CDE7DF",deep:"#16876F",t:"Stripes et partitions",d:"GSU, RSU, CSU, la partition client (CP ID) et comment lire un identifiant.",S:M2},
 {id:"M3",ic:"Boxes",soft:"#E0D6F5",deep:"#6E45C9",t:"La carte des microservices",d:"Portails, cœur métier, services communs et correspondance avec MM 1.0.",S:M3},
 {id:"M4",ic:"Workflow",soft:"#F5D3D7",deep:"#C93A52",t:"Le modèle de service",d:"Les acteurs, temps réel et différé, canaux, configuration, frais et plafonds, TradeOrder et PaymentOrder.",S:M4},
 {id:"M5",ic:"ShieldCheck",soft:"#D0E5F2",deep:"#17709F",t:"Actif-actif et reprise",d:"Deux centres actifs, un site de secours, CloudDR et les scénarios de bascule.",S:M5},
 {id:"M6",ic:"Shuffle",soft:"#EEE3B8",deep:"#8F6F05",t:"La gray release",d:"Couloirs bleu et vert, utilisateurs gris, routage par canal, règles et observation.",S:M6},
 {id:"M7",ic:"Monitor",soft:"#F3DDCA",deep:"#B85415",t:"Exploiter avec DigitalView",d:"Alarmes sur mesure, seuils, tableaux de bord, BriefReport, DMS, Apollo et élasticité.",S:M7},
 {id:"M8",ic:"Sparkles",soft:"#F3D6E5",deep:"#AE3474",t:"AIOps",d:"Comparaison homogène, seuils dynamiques, compression d'alarmes, Fault Agent, copilote et prédiction.",S:M8},
 {id:"M9",ic:"Waypoints",soft:"#D8EDCA",deep:"#357A1C",t:"La chaîne d'appels",d:"Topologie, Gantt, latence, LinkID et log de traçage pour pister une transaction.",S:M9},
 {id:"M10",ic:"Database",soft:"#D3EDEA",deep:"#1F7D74",t:"Smart DataCube",d:"Collecter, transformer, gouverner et partager les données, et le DataCube du projet MM.",S:M10},
 {id:"M11",ic:"Plug",soft:"#D6DDF5",deep:"#3D5BB8",t:"Ouvert aux partenaires",d:"API Fabric, données en sortie (ETL, EDR, Kafka) et historique en ligne sur 10 ans.",S:M11},
 {id:"M12",ic:"Siren",soft:"#EBDFD4",deep:"#9C3529",t:"Les alarmes de la prod",d:"Les alarmes réelles du site OSN : les lire, ce qu'elles touchent, et le cas du 20 octobre.",S:M12}
];
