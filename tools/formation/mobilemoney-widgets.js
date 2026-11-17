/* ══════════════════════════════════════════════════════════════
   WIDGETS INTERACTIFS DE LA FORMATION « MOBILE MONEY 2.0 »
   Insérés par build.js à la place des widgets DigitalView.
   Contrat du moteur : W.<nom> = { t: titre, ic: icône, html(), bind(el) }.
   Les classes CSS (wtabs, wdet, wfl/wfloor, wacc, wsev/wsv, wsim/wtog)
   sont celles du moteur : aucun style à ajouter.
   ══════════════════════════════════════════════════════════════ */
var W={};

// Onglets génériques : D = [[titre, html du volet], …]
function wTabs(me,D){return '<div class="wtabs" role="tablist">'+D.map(function(d,i){return '<button role="tab" aria-selected="'+(i===0)+'" data-i="'+i+'">'+d[0]+'</button>'}).join('')+'</div><div class="wdet">'+D[0][1]+'</div>'}
function wTabsBind(el,D){var det=el.querySelector('.wdet');[].forEach.call(el.querySelectorAll('.wtabs button'),function(b){b.onclick=function(e){e.stopPropagation();[].forEach.call(el.querySelectorAll('.wtabs button'),function(x){x.setAttribute('aria-selected','false')});b.setAttribute('aria-selected','true');det.innerHTML=D[+b.dataset.i][1]}})}
// Étages cliquables : D = [[titre, sous-titre, détail], …]
function wFloors(D,on){return '<div class="wbld"><div class="wfl">'+D.map(function(d,i){return '<button class="wfloor'+(i===on?' on':'')+'" data-i="'+i+'"><b>'+d[0]+'</b><small>'+d[1]+'</small></button>'}).join('')+'</div></div><div class="wdet" aria-live="polite"><b>'+D[on][0]+'</b><p>'+D[on][2]+'</p></div>'}
function wFloorsBind(el,D){var det=el.querySelector('.wdet');[].forEach.call(el.querySelectorAll('.wfloor'),function(b){b.onclick=function(e){e.stopPropagation();[].forEach.call(el.querySelectorAll('.wfloor'),function(x){x.classList.remove('on')});b.classList.add('on');var d=D[+b.dataset.i];det.innerHTML='<b>'+d[0]+'</b><p>'+d[2]+'</p>'}})}
// Accordéon : D = [[icône, titre, sous-titre, texte], …]
function wAcc(D){return '<div class="wacc">'+D.map(function(f,i){return '<div class="wai"><button class="wah" aria-expanded="false"><span class="wbadge">'+ico(f[0],20)+'</span><span><b>'+f[1]+'</b><small>'+f[2]+'</small></span>'+ico('ChevronDown',18)+'</button><div class="wab"><p>'+f[3]+'</p></div></div>'}).join('')+'</div>'}
function wAccBind(el){[].forEach.call(el.querySelectorAll('.wah'),function(b){b.onclick=function(e){e.stopPropagation();var p=b.parentNode;p.classList.toggle('open');b.setAttribute('aria-expanded',p.classList.contains('open'))}})}


// Petits raccourcis pour écrire les volets d'onglets.
function vt(t,sous,txt){return '<b>'+t+'</b><p class="wmut">'+sous+'</p><p>'+txt+'</p>'}
var TABS={html:function(){return wTabs(this,this.D)},bind:function(el){wTabsBind(el,this.D)}};
var FLOORS={html:function(){return wFloors(this.D,0)},bind:function(el){wFloorsBind(el,this.D)}};
var ACC={html:function(){return wAcc(this.D)},bind:function(el){wAccBind(el)}};
function w(def,kind){def.html=kind.html;def.bind=kind.bind;return def}

// ── M1 · Architecture ──
W.couches=w({t:"Les quatre couches",ic:"Layers",D:[
 ["Accès","La porte d'entrée","Super Gateway (USSD, STK, API), portails web, API Fabric, échanges de fichiers SFTP, répartiteur NSLB."],
 ["Intégration métier","Les chefs d'orchestre","TransferBusiness pour les transactions, IdentityBusiness pour les opérations sur les entités."],
 ["Cœur","Les données et les règles","Clients, organisations, identifiants, commandes, consultation, comptes, comptabilité, banques, règlement."],
 ["Support","Les services communs","Tâches système, traitements en masse, workflow, synchronisation, journal d'audit, archivage, notifications, licences."]]},FLOORS);

// ── M2 · Stripes ──
W.stripes=w({t:"Les trois types de stripes",ic:"Rows3",D:[
 ["GSU",vt("Global Stripe Unit","Un seul, pour tout le monde","Portails, tâches planifiées, traitements en masse, règlement, compensation, comptabilité, facturation au niveau SP, enregistrement des entités, workflow.")],
 ["RSU",vt("Region Stripe Unit","Plusieurs, chacun pour une partie des utilisateurs","Les transactions en temps réel et les requêtes sur les entités. Environ 1 000 TPS chacun ; on en ajoute pour grandir.")],
 ["CSU",vt("City Stripe Unit","Le socle commun","Middleware et services partagés, comme l'IdentifierCenter que chaque stripe peut consulter.")]]},TABS);

W.identifiant={t:"Décode un identifiant",ic:"IdCard",D:[
 ["101","Locataire","3 chiffres. Désigne le locataire (l'opérateur du pays) sur la plateforme."],
 ["1001","CP ID","4 chiffres. La partition de l'utilisateur, donc le stripe où vivent ses données. 0000 pour une entité du GSU."],
 ["5000","Type d'entité","4 chiffres. Client, organisation, SP…"],
 ["0001023407","Séquence","10 chiffres. Le numéro d'ordre de l'entité."]],
 html:function(){return wFloors(this.D,1)},bind:function(el){wFloorsBind(el,this.D)}};

// ── M3 · Microservices ──
W.portails=w({t:"Quatre portails, quatre publics",ic:"Monitor",D:[
 ["Config Portal",vt("Configuration","Équipe de configuration du client","Hérité du SP Portal de 1.0, recentré sur la configuration : produits, frais, plafonds, notifications.")],
 ["SP Portal",vt("Le quotidien du SP","Centre d'appels, opérations, finance","L'entrée de tous les jours : consulter un client, une transaction, lancer une opération métier.")],
 ["Org Portal",vt("Les organisations","Marchands, agents, distributeurs","Leur entrée pour leurs propres opérations.")],
 ["OM Portal",vt("L'exploitation","Équipes O&M","Nouveau en 2.0 : opérations techniques et de fond, groupes gris pour la gray release.")]]},TABS);

W.domaines=w({t:"Les services du cœur",ic:"Boxes",D:[
 ["Users","Entités","CustomerCenter, OrganizationCenter, IdentifierCenter","Les clients et groupes (avec KYC et produits), les organisations avec leurs opérateurs et Tills, et les identifiants de tous, rangés dans le CSU."],
 ["ClipboardList","Commandes","TransactionCenter, OrderQueryCenter","Création des commandes, plafonds et frais d'un côté (écriture), consultation temps réel et historique de l'autre (lecture)."],
 ["Calculator","Comptes","Acctrans, AccCenter","Soldes et écritures avec un modèle distribué, puis comptabilité générale : comptes comptables, grand livre, balance."],
 ["Building","Banques et règlement","FinAssetCenter, ClearReconCenter, SettlementCenter","Comptes et cartes bancaires, rapprochement avec les relevés, commissions et résultats hors ligne."]]},ACC);

W.archivage=w({t:"Que devient chaque donnée ?",ic:"Archive",D:[
 ["Flux",vt("Données de flux","Transactions, écritures, journaux d'audit","Archivées puis nettoyées.")],
 ["Configuration",vt("Données de configuration","Produits, frais, paramètres","Ni archivées ni nettoyées.")],
 ["État",vt("Données d'état","Identités, comptes","Ni archivées ni nettoyées.")],
 ["Temporaire",vt("Données temporaires","Journaux de requêtes, renvois de messages","Seulement nettoyées, jamais archivées.")]]},TABS);

W.correspondances=w({t:"MM 1.0 → MM 2.0",ic:"Shuffle",D:[
 ["BCS","Tout le métier","→ la plupart des microservices","TransferBusiness, IdentityBusiness, Workflow, les centres clients, organisations, commandes, comptes, banques et règlement."],
 ["AG","La passerelle","→ Super Gateway","Plus le Notification Center, sorti pour être partagé."],
 ["BTS","Les tâches de fond","→ TaskJob + BulkCenter","Tâches système d'un côté, traitements en masse de l'autre."],
 ["SWA / OWA","Les portails","→ Config, SP, Org et OM Portal","Interface séparée du serveur, personnalisable, avec connexion unique CAS."],
 ["BICP · AAS","Rapports, archivage","→ ISA · HDA Center","ISA pour les rapports, HDA pour l'archivage selon le cycle de vie."]]},FLOORS);

// ── M4 · Modèle de service ──
W.config=w({t:"Les briques de configuration",ic:"SlidersHorizontal",D:[
 ["Produit","Qui y a droit","Un ensemble de services auquel une entité souscrit. Chaque type d'entité a ses produits."],
 ["Service","Par quel canal","Définit le canal d'initiation et les reason types possibles."],
 ["Reason type","Le scénario","Canal, validité, participants, modèle de transaction, frais, notifications. La plus petite brique."],
 ["Type de transaction","Le but","Les transactions qui ont le même objectif et les mêmes types de participants."],
 ["Frais et plafonds","Combien","Type et profil de frais ; rule profile et règles de plafond."],
 ["Compte et notification","Où et qui prévenir","Type de compte qui porte la monnaie électronique ; type de notification (contenu, canal)."]]},FLOORS);

W.commande=w({t:"Un achat en trois paiements",ic:"Ticket",D:[
 ["La commande",vt("TradeOrder","Achat en ligne, total 300","Une seule TradeOrder, notifiée au client, qui suit l'achat de bout en bout.")],
 ["Les paiements",vt("PaymentOrder × 3","50 + 150 + 100","Trois mouvements de fonds sous la même TradeOrder, chacun en succès ou en échec.")],
 ["Une annulation",vt("Nouvelle TradeOrder","Annulation du paiement de 150","Une TradeOrder d'annulation, liée à l'originale, rend 150 au client. On peut ensuite annuler les autres paiements, un par un.")]]},TABS);

// ── M5 · Disponibilité ──
W.clouddr=w({t:"Les trois pièces de CloudDR",ic:"ShieldCheck",D:[
 ["Monitor","DRPortal","L'interface web","Là où l'on suit l'état et lance les opérations de reprise."],
 ["Settings","DRService","Le pilotage","Ordonne la bascule : base, applications, partitions."],
 ["Server","DRAgent","Sur les nœuds avec état","Reçoit les ordres et les applique aux bases et applications avec état (réplication, arrêt, démarrage)."]]},ACC);

W.scenarios=w({t:"Quelle panne, quelle portée ?",ic:"TriangleAlert",D:[
 ["DMZ",vt("Panne de la DMZ","Matériel en bordure","L'entrée du trafic est touchée : tous les canaux externes peuvent l'être.")],
 ["Réseau",vt("Coupure réseau du site principal","Le site ne joint plus l'extérieur","La reprise passe par l'autre centre.")],
 ["Stripe",vt("Un stripe en défaut","Par exemple RSU02","Seuls les utilisateurs de ses partitions sont touchés ; les CP sont redirigés.")],
 ["Site entier",vt("Perte d'un site","Coupure électrique, inondation, incendie","L'autre centre reprend tout ; si les deux tombent, le site distant prend le relais.")]]},TABS);

// ── M6 · Gray release ──
W.principes_gris=w({t:"Quatre idées",ic:"Sparkles",D:[
 ["Zéro arrêt",vt("Bleu et vert","Deux couloirs identiques","On met à jour le vert, on y bascule le trafic petit à petit, et on revient au bleu en cas de souci.")],
 ["Par étapes",vt("Pas tout d'un coup","Élargir par lots","Quelques utilisateurs, puis plus, puis tous.")],
 ["Risque maîtrisé",vt("Petite échelle d'abord","Limiter les dégâts","Un défaut ne touche que les utilisateurs gris.")],
 ["Par les chiffres",vt("Décider sur les données","Journaux, indicateurs, retours","On élargit seulement si le couloir gris se comporte bien.")]]},TABS);

W.routage=w({t:"Le routage par canal",ic:"Waypoints",D:[
 ["Super Gateway",vt("USSD, STK, API","Selon la partie principale","Client : MSISDN ou CP ID ; organisation : ID, code court ou CP ID. Une nouvelle API inconnue de l'ancienne version est envoyée au couloir gris d'après la table des versions dans Apollo.")],
 ["API",vt("Poids du NSLB","Égal à la part d'utilisateurs gris","Le répartiteur envoie la bonne proportion de trafic vers chaque couloir.")],
 ["SMPP",vt("Règles de routage","Pas de poids possible","Avant : production seule ; à 50 % : les deux couloirs ; après : couloir gris seul.")],
 ["Portails",vt("Selon l'opérateur","Repéré au login","Le serveur de portail marque la requête et la fait suivre au bon couloir.")],
 ["Masse",vt("Champ de couloir","EXECUTOR_SWIMLANE","La tâche s'exécute dans le couloir indiqué ; une tâche incompatible avec l'ancienne version part en gris.")]]},TABS);

W.regles=w({t:"Les règles de la gray release",ic:"ListChecks",D:[
 ["Moon","Heure creuse","Avant 4 h, sous 50 % de charge","Le redimensionnement des pods comporte un risque."],
 ["Layers","Toute la solution","Tous les stripes en même temps","Pas de stripe seul, et pas après une bascule."],
 ["Ban","Une à la fois","Pas de release imbriquée","Arrêter (terminer ou annuler) la release en cours avant d'en lancer une autre. Pas de bascule pendant."],
 ["Database","DDL sans retour","Les changements de structure restent","La nouvelle version reste compatible avec l'ancienne."],
 ["KeyRound","Licence","Mettre à jour la licence","Le couloir gris doit figurer dans la licence après installation."],
 ["RotateCcw","Pas de retour à 100 %","Une fois tout le trafic en vert","Ne plus revenir à l'ancienne version, qui lirait mal les nouvelles données."]]},ACC);

// ── M7 · DigitalView ──
W.regles_alarme=w({t:"Les règles d'alarme",ic:"Bell",D:[
 ["Sévérité",vt("Redéfinition de sévérité","Monter ou baisser un niveau","Selon l'importance de l'élément. Ne touche que les nouvelles alarmes.")],
 ["Nom",vt("Redéfinition de nom","Un libellé plus parlant","Renommer une alarme selon le vocabulaire de l'équipe.")],
 ["Masquage",vt("Règle de masquage","Cacher ou jeter","Les alarmes masquées sont soit jetées (non enregistrées), soit rangées à part.")],
 ["Agrégation",vt("Règle d'agrégation","Un seul exemplaire","Les doublons d'une période sont regroupés sous une alarme ; le détail reste consultable.")]]},TABS);

// ── M8 · AIOps ──
W.fault_agent=w({t:"Le Fault Agent, pas à pas",ic:"Bot",D:[
 ["Détecter","Le contexte de l'incident","Indicateurs et alarmes regroupés dans le temps et dans la topologie : taux de succès en baisse, connexions anormales."],
 ["Isoler","Les anomalies clés","Il trouve l'alarme racine parmi les événements liés, par exemple « écriture du journal de la base sur disque impossible »."],
 ["Vérifier","Il appelle des outils","Analyse des journaux, analyse de l'espace disque : le système de fichiers des journaux est plein à 100 %."],
 ["Chercher","Base de connaissances","Il retrouve les cas et procédures proches."],
 ["Rédiger","Rapport de diagnostic","Cause, preuves et conseils de reprise, prêts à être suivis."]]},FLOORS);

// ── M9 · Chaîne d'appels ──
W.vues_chaine=w({t:"Deux façons de lire une chaîne",ic:"Waypoints",D:[
 ["Topologie",vt("L'arbre","Qui appelle qui","Les composants et leurs liens d'appel, pour saisir la structure d'un coup d'œil.")],
 ["Gantt",vt("La liste ordonnée","Dans l'ordre du seqNo","Chaque appel avec son niveau, son début et sa durée : on voit lequel traîne.")],
 ["Latence",vt("Le filtre","Temps de réponse","Les chaînes au-delà du critère sont mises en évidence.")]]},TABS);

W.tracage=w({t:"Poser un log de traçage",ic:"Crosshair",D:[
 ["Où","Le chemin","DV → DF Deployment → Deployment → Configuration Center → global → default → MMCloud.LogConfig"],
 ["Quoi","La clé","log.trace.task.list = task1, puis traceKey = MSISDN"],
 ["Qui","La valeur","traceValue = le numéro à suivre"],
 ["Combien de temps","La durée","traceTime = 2 (heures). Penser à retirer la règle après l'analyse."]]},FLOORS);

// ── M10 · DataCube ──
W.datacube=w({t:"Les outils de DataCube",ic:"Database",D:[
 ["Data Factory","Orchestrer","Sources, modèles, lots et flux, planification, en low-code."],
 ["Data Compass","Gouverner","Standards, métadonnées, lignage, catalogue, qualité."],
 ["DAMS","Cataloguer","Les actifs de données visibles, évalués, accessibles sur demande."],
 ["SQL Editor","Explorer","Requêtes en syntaxe unifiée, exports, exécutions planifiées."],
 ["API Fabric","Ouvrir","Publier des données en API, avec contrôle d'accès."],
 ["Tableaux de bord","Visualiser","Rapports en libre-service, sans code, y compris sur mobile."]]},FLOORS);

// ── M11 · Ouverture ──
W.api=w({t:"Trois usages de l'API Fabric",ic:"Plug",D:[
 ["Orchestrer",vt("Une API pour plusieurs","Profil + solde","Le partenaire appelle une API ; l'API Fabric enchaîne client, compte et solde, et renvoie le tout.")],
 ["Alléger",vt("Moins de champs","Requête plus rapide","Une API allégée ne renvoie que les champs utiles au partenaire.")],
 ["Convertir",vt("REST ↔ SOAP","Compatibilité","Une application web en REST peut appeler un service SOAP ; une API de facture REST peut parler à un facturier SOAP.")]]},TABS);

W.sorties=w({t:"Trois voies pour les données",ic:"Share2",D:[
 ["ETL","Fichiers quotidiens ou horaires","Pour l'entrepôt de données et la BI. Déposés sur le serveur de fichiers."],
 ["EDR","Fichiers toutes les 5 à 10 minutes","Pour les applications qui réagissent aux événements, sans brancher Kafka."],
 ["Kafka","Temps réel","Pour l'analyse en temps réel, la gestion des risques, la lutte anti-blanchiment."]]},FLOORS);

// ── M12 · Alarmes de la prod ──
W.moname={t:"Décode un MOName",ic:"Search",D:[
 ["osn","Le pays","OSN : le site du Sénégal."],
 ["prd","L'environnement","prd = production ; pre = pré-production."],
 ["gsu","Le stripe","gsu = stripe global ; rsu01, rsu02… = stripes régionaux ; csu00, csu01 = stripes communs."],
 ["b","Le couloir","b = bleu, le couloir de production. Pendant une gray release, le couloir vert apparaît."],
 ["pr1","Le centre","pr1 ou pr2 : l'un des deux centres de production."],
 ["transaction-center","Le service","Le microservice touché, suivi de l'identifiant du pod et de l'hôte entre parenthèses."]],
 html:function(){return wFloors(this.D,2)},bind:function(el){wFloorsBind(el,this.D)}};

W.taux=w({t:"Quel taux, quelle porte ?",ic:"Gauge",D:[
 ["AG Channel",vt("AG_Channel_Success_Rate_Alarm","Super Gateway, par canal","Le taux de succès d'un canal d'entrée (Inbound_API, USSD…) passe sous le seuil.")],
 ["AG Outbound",vt("AG_Outbound_Success_Rate_Alarm","Super Gateway vers les tiers","Les appels sortants vers banques et facturiers échouent trop.")],
 ["Transactions",vt("Success_Rate indicator exception","TransactionCenter, par canal","Le taux de succès des transactions d'un canal (WEB…) baisse.")],
 ["API Fabric",vt("AccessSuccessRatio","Les API ouvertes","Les accès à l'API Fabric réussissent moins.")],
 ["NSLB",vt("Ratio of Successful Processed URL","Le répartiteur (nginx)","Trop d'URL traitées en échec au niveau du répartiteur.")],
 ["Trafic",vt("P1_All FTPS decreased by 10%","Indicateur EMOC","Le trafic baisse de plus de 10 % par rapport à la même heure la semaine passée.")]]},TABS);

W.dependances=w({t:"Les briques partagées",ic:"Network",D:[
 ["Network","ZooKeeper","Failure to Create Connections to the Zookeeper","Un composant de la plateforme perd la coordination : présence des nœuds, configuration partagée."],
 ["Settings","DCC","Disconnected with DCC server · Region unhealthy","Un service ne joint plus le cache de configuration, ou une région du DCC est en mauvaise santé."],
 ["Waypoints","Registre","No Msg Received · Remote NSLB disconnected","Le registre des services ne reçoit plus de nouvelles d'un stripe, ou ne joint plus le répartiteur distant."],
 ["Send","NATS","Connection of NATS server is broken","Une brique de messagerie interne de la plateforme est coupée."],
 ["Repeat","Canal","CanalEtcdConnectAlarm","Le composant de synchronisation de données ne joint plus son stockage de coordination (etcd)."],
 ["Database","Dépôt","Connection of DataBase server is broken","Un service de la plateforme (le dépôt de logiciels) perd sa base."]]},ACC);

W.pare_feux=w({t:"Les alarmes des pare-feux",ic:"BrickWall",D:[
 ["BFD",vt("hwBfdSessFaultDown","Un lien est tombé","La détection rapide (BFD) voit un voisin injoignable : un chemin réseau est coupé.")],
 ["HRP",vt("hwHrpHeartChange · hwHrpEscape","Le duo actif / veille","Le battement de cœur entre les deux pare-feux change d'interface ou est en défaut : la bascule de secours est fragilisée.")],
 ["Optique",vt("hwOpticalInvalid · hwOpticalUnAuthorized","Les modules optiques","Un module est en panne, ou n'est pas reconnu comme certifié.")],
 ["Port",vt("hwLocalFaultAlarm","Une interface","Un défaut local est détecté sur un port.")],
 ["Alim",vt("hwPowerInvalid","Une alimentation","Une des deux alimentations est en panne : l'équipement tourne sur l'autre.")],
 ["VPN",vt("hwIPSecTunnelStop · Start · hwIKESaPhase1Establish","Les tunnels chiffrés","Un tunnel s'arrête ou se rétablit. Start et Establish sont des retours à la normale (Warning).")]]},TABS);


/* ══════════════════════════════════════════════════════════════
   SCÈNES DES LEÇONS (kit commun nk-kit.js : appareils, paquets).
   Une idée par scène, une légende simple, de vrais équipements.
   ══════════════════════════════════════════════════════════════ */
var MM_CSS='.mmx .pp{transition:opacity .4s}.mmx .pp.off{opacity:.15}'
 +'.mmx .lane{fill:var(--nk-zone);stroke:var(--nk-zedge);stroke-width:1.5}.mmx .lane.b{fill:#E8EFFC;stroke:#9DB8F2}.mmx .lane.g{fill:#E3F4E8;stroke:#8FD3A8}.mmx .lane.ko{fill:#F6D5D3;stroke:#E8A39C}'
 +'html[data-theme="dark"] .mmx .lane.b{fill:#0E1626;stroke:#2D4A7A}html[data-theme="dark"] .mmx .lane.g{fill:#0C2014;stroke:#1F5A36}html[data-theme="dark"] .mmx .lane.ko{fill:#2A1210;stroke:#6B2A24}'
 +'.mm-al{display:grid;gap:4px;font-size:12.5px;max-height:236px;overflow:hidden;align-content:start}.mm-al span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mm-al>div{display:grid;grid-template-columns:12px 1fr auto;gap:8px;align-items:center;padding:6px 10px;border-radius:8px;background:var(--surface);transition:all .4s}.mm-al i{width:10px;height:10px;border-radius:50%;background:#D93025}.mm-al small{color:var(--muted);font-family:ui-monospace,Menlo,monospace}.mm-al>div.gone{opacity:0;height:0;padding:0 10px;margin:-2px 0;overflow:hidden}.mm-al>div.main{box-shadow:inset 0 0 0 2px #D93025;font-weight:600}'
 +'.mm-ph{width:150px;flex:none;border-radius:22px;background:#15171C;padding:10px 8px 14px;color:#E9E9EF;font-size:12px}.mm-ph .sc{background:#0B0C10;border-radius:14px;padding:10px;min-height:150px}.mm-ph .nt{display:flex;justify-content:space-between;align-items:center;background:#24262C;border-radius:10px;padding:8px;margin-top:6px}.mm-ph .nt b{font-size:18px;color:#F28B82}'
 +'.mm-tr{border-radius:14px;overflow:hidden;box-shadow:0 0 0 1px var(--line)}.mm-tr .hd{display:flex;gap:12px;align-items:center;padding:8px 12px;background:#24262C;color:#C9C9D6;font-size:12px;font-family:ui-monospace,Menlo,monospace}'
 +'.mm-tr .rw{display:grid;grid-template-columns:150px 1fr;gap:10px;align-items:center;padding:7px 12px;border-top:1px solid var(--line);font-size:12.5px;cursor:pointer}.mm-tr .rw:hover{background:var(--surface2)}.mm-tr .rw.sel{background:var(--surface2)}.mm-tr .rw span{font-family:ui-monospace,Menlo,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mm-tr .bar{position:relative;height:14px}.mm-tr .bar i{position:absolute;top:0;height:14px;border-radius:4px;background:#3D6FD9}.mm-tr .rw.slow .bar i{background:#D93025}.mm-tr .ax{display:flex;justify-content:space-between;padding:4px 12px 6px 172px;font-size:11px;color:var(--muted);font-family:ui-monospace,Menlo,monospace}'
 +'@media (max-width:520px){.mm-tr .rw{grid-template-columns:110px 1fr}.mm-tr .ax{padding-left:132px}}'
 +'.mm-app{max-width:340px;margin:0 auto;border-radius:26px;background:#15171C;padding:12px 10px 16px}.mm-app .sc{background:#F6F7F9;border-radius:18px;padding:12px;color:#1B1D22;font-size:13px}html[data-theme="dark"] .mm-app .sc{background:#0B0C10;color:#E9E9EF}'
 +'.mm-app .tt{font-weight:700;font-size:14px;margin-bottom:8px}.mm-rc{border-radius:12px;background:#fff;padding:10px;margin-top:8px;box-shadow:0 1px 3px rgba(0,0,0,.08)}html[data-theme="dark"] .mm-rc{background:#1B1D22;box-shadow:0 0 0 1px #2A2D35}.mm-rc .l{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-top:1px dashed #D5D8DE}.mm-rc .l:first-of-type{border:0}'
 +'.mm-rc .l.off{opacity:.45;text-decoration:line-through}.mm-rc .l button{border:0;border-radius:999px;padding:4px 10px;font:inherit;font-size:12px;background:#F6D5D3;color:#8E1F17;cursor:pointer}.mm-rc.cx{background:#E3F4E8;color:#14532D;animation:rsIn .35s}html[data-theme="dark"] .mm-rc.cx{background:#0C2014;color:#A7E3BF}';
if(typeof document!=='undefined'&&document.createElement){var mms=document.createElement('style');mms.textContent=MM_CSS;document.head.appendChild(mms)}
function mmIc(t,x,y,sc,cls){return '<g class="'+(cls||'')+'" transform="translate('+x+','+y+')'+(sc?' scale('+sc+')':'')+'">'+nkIcon(t)+'</g>'}

// ── 1. Les stripes : une tranche de clients, une baie de serveurs ──
var VZ_STRIPES={html:function(){return '<div class="vz mmx"><div class="vz-ctl">Clients<input type="range" min="5" max="60" step="5" value="25"><b class="u">25 M</b></div><div class="stg"></div>'
 +'<div class="vz-row" style="margin-top:8px"><button class="vz-btn on tx">Un client fait un transfert</button><button class="vz-btn k2">Faire tomber RSU02</button><button class="vz-btn rz">Rétablir</button></div><div class="vz-msg"></div></div>'},
 bind:function(el){vzStop(el);var r=vzQ(el,'input'),down=false;
  function n(){return Math.ceil(r.value/10)}
  function draw(){var k=n(),W2=520,sp=Math.min(100,(W2-60)/Math.max(k-1,1)),x0=(W2-sp*(k-1))/2,nodes=[{id:'ph',t:'phone',x:50,y:56,l:'Client'},{id:'gw',t:'lb',x:200,y:56,l:'Super Gateway',s:'trouve le stripe'},{id:'gsu',t:'rack',x:380,y:62,sc:.62,l:'GSU',s:'commun'},{id:'csu',t:'rack',x:470,y:62,sc:.62,l:'CSU',s:'commun'}],links=[['ph','gw']];
   for(var i=1;i<=k;i++){nodes.push({id:'r'+i,t:'rack',sc:.62,x:x0+(i-1)*sp,y:232,l:'RSU0'+i,s:(1000+(i-1)*100+1)+'-'+(1000+i*100),cls:down&&i===2?'bad':''});links.push(['gw','r'+i])}
   var st=nkStage({w:520,h:330,nodes:nodes,links:links});
   vzQ(el,'.stg').innerHTML=st;vzQ(el,'.u').textContent=r.value+' M';
   nkMsg(el,'<b>'+k+' stripe'+(k>1?'s':'')+'</b> (RSU) pour '+r.value+' millions de clients : chaque RSU est un ensemble complet de serveurs et de bases pour une <b>tranche de clients</b> (environ 10 millions), repérée par son CP ID. Plus de clients ? On <b>ajoute un stripe</b>, sans alourdir les autres. Le GSU et le CSU portent ce qui est commun (portails, comptabilité, services partagés).')}
  r.oninput=function(){nkReset(el);draw()};
  vzQ(el,'.tx').onclick=function(){nkReset(el);var k=n(),i=1+Math.floor(Math.random()*k),cp=1000+(i-1)*100+1+Math.floor(Math.random()*99);
   nkMsg(el,'Un client dont le CP ID est <b>'+cp+'</b> envoie un transfert. La Super Gateway sait que ce CP ID est dans le stripe <b>RSU0'+i+'</b>…');
   nkFly(el,['ph','gw'],{tag:'CP '+cp}).then(function(o){if(!o)return;return nkFly(el,['gw','r'+i],{tag:'CP '+cp,keep:down&&i===2})}).then(function(pk){if(!pk)return;
    if(down&&i===2){nkTag(pk,'échec','ko');setTimeout(function(){pk.remove()},800);nkMsg(el,'RSU02 est en panne : <b>les clients de cette tranche</b> (CP 1101 à 1200) ne peuvent plus faire de transferts. Tous les autres continuent normalement. C\'est l\'intérêt des stripes : <b>une panne ne touche qu\'une tranche</b>.');return}
    nkSet(el,'r'+i,'good');nkMsg(el,'Le transfert est traité <b>entièrement dans RSU0'+i+'</b> : ses applications et ses bases ne contiennent que les clients de sa tranche.')})};
  vzQ(el,'.k2').onclick=function(){if(n()<2){r.value=25}down=true;nkReset(el);draw();nkMsg(el,'RSU02 est tombé. Fais faire des transferts à plusieurs clients : seuls ceux de sa tranche échouent.')};
  vzQ(el,'.rz').onclick=function(){down=false;nkReset(el);draw()};draw()}};

// ── 2. Gray release : quelques clients sur la nouvelle version ──
var VZ_GRIS={html:function(){var s='<svg class="nk" viewBox="0 0 520 250" role="img" aria-label="Gray release"><rect class="lane b" x="300" y="20" width="210" height="96" rx="14"/><rect class="lane g" x="300" y="134" width="210" height="96" rx="14"/>'
  +'<text class="zl" x="314" y="40">COULOIR BLEU · V1</text><text class="zl" x="314" y="154">COULOIR VERT · V2</text>';
  for(var p=0;p<3;p++){s+=mmIc('pod',345+p*62,80,.8)+mmIc('pod',345+p*62,194,.8,'gp')}
  for(var i=0;i<20;i++){var x=24+(i%5)*34,y=40+Math.floor(i/5)*48;s+='<g class="usr" data-u="'+i+'" transform="translate('+x+','+y+') scale(.62)">'+nkIcon('user')+'</g>'}
  s+=mmIc('lb',240,125,.7)+'<text class="nl" x="240" y="152" style="font-size:13px">NSLB</text><g class="pks"></g></svg>';
  return '<div class="vz mmx">'+s+'<div class="vz-ctl" style="margin-top:6px">Clients « gris » (sur V2)<input type="range" min="0" max="100" step="5" value="10"><b class="p">10 %</b></div><div class="vz-row"><button class="vz-btn on go">Faire passer le trafic</button><button class="vz-btn bug">La V2 a un bug</button><button class="vz-btn rb">Revenir en arrière</button></div><div class="vz-msg"></div></div>'},
 bind:function(el){vzStop(el);var r=vzQ(el,'input'),bug=false;
  function users(){var k=Math.round(+r.value/5);vzA(el,'.usr').forEach(function(u,i){u.querySelectorAll('circle,path').forEach(function(x){x.setAttribute('fill',i<k?'#1F9D6B':'#3D6FD9')})});return k}
  function lanes(){vzQ(el,'.lane.g').classList.toggle('ko',bug)}
  function msg(){var p=+r.value;nkMsg(el,bug?'La V2 a un bug : le couloir vert échoue. Mais <b>seuls les clients gris</b> ('+p+' %) sont touchés. On le voit en comparant le taux de succès des deux couloirs dans DigitalView, puis on <b>revient en arrière</b> sans coupure.':p===0?'Tout le monde est sur la V1. On a choisi quelques clients « gris » sur l\'OM Portal.':p<50?'<b>Phase d\'essai</b> : '+p+' % des clients passent par la nouvelle version (V2). Les autres ne voient rien. Si le vert se comporte bien, on élargit.':p<100?'On élargit : '+p+' % sur la V2. Le répartiteur (NSLB) envoie le trafic dans cette proportion.':'Tout le monde est sur la V2. À ce stade <b>on ne revient plus en arrière</b> : l\'ancienne version lirait mal les données créées par la nouvelle.')}
  function wave(){nkReset(el);var k=users();for(var i=0;i<20;i++)(function(i){var x=24+(i%5)*34,y=40+Math.floor(i/5)*48,g=i<k;setTimeout(function(){nkFly(el,[[x,y],[240,125],[g?345+(i%3)*62:345+(i%3)*62,g?194:80]],{dot:g?(bug?'#D93025':'#1F9D6B'):'#3D6FD9',dur:450})},i*70)})(i)}
  r.oninput=function(){users();msg()};
  vzQ(el,'.go').onclick=function(){wave();msg()};
  vzQ(el,'.bug').onclick=function(){bug=true;lanes();if(+r.value===0){r.value=10}wave();msg()};
  vzQ(el,'.rb').onclick=function(){bug=false;lanes();r.value=0;wave();nkMsg(el,'Retour en arrière : tout le trafic revient sur la V1, <b>sans coupure</b>. Les clients gris n\'ont subi que quelques échecs.')};users();msg()}};

// ── 3. Actif-actif : deux data centers travaillent ensemble ──
var VZ_AA={html:function(){return '<div class="vz mmx">'+nkStage({w:520,h:250,zones:[[150,8,250,150,'MÊME VILLE']],nodes:[{id:'u1',t:'phone',x:40,y:60,l:'Clients A'},{id:'u2',t:'phone',x:40,y:180,l:'Clients B'},{id:'d1',t:'building',x:210,y:80,l:'DC-1'},{id:'d2',t:'building',x:340,y:80,l:'DC-2'},{id:'d3',t:'building',x:450,y:200,l:'Site distant',s:'en veille'}],links:[['u1','d1'],['u2','d2'],['d1','d2','wifi'],['d2','d3','wifi']]})
 +'<div class="vz-row" style="margin-top:8px"><button class="vz-btn on" data-s="0">Tout va bien</button><button class="vz-btn" data-s="1">DC-1 tombe</button><button class="vz-btn" data-s="2">DC-2 tombe</button><button class="vz-btn" data-s="3">Les deux tombent</button></div><div class="vz-msg"></div></div>'},
 bind:function(el){vzStop(el);
  function flow(s){el._f=(el._f||0)+1;var f=el._f;(function loop(){if(el._f!==f||!el.isConnected)return;
    var a=s===1||s===3?(s===3?'d3':'d2'):'d1',b=s===2||s===3?(s===3?'d3':'d1'):'d2';
    nkFly(el,['u1',a],{dot:'#3D6FD9',r:4,dur:600});nkFly(el,['u2',b],{dot:'#1F9D6B',r:4,dur:600});if(s===0)nkFly(el,['d1','d2'],{dot:'#E8840C',r:3,dur:500});setTimeout(loop,520)})()}
  function set(s){nkReset(el);vzA(el,'[data-s]').forEach(function(b){b.classList.toggle('on',+b.dataset.s===s)});
   if(s===1||s===3)nkSet(el,'d1','bad');if(s===2||s===3)nkSet(el,'d2','bad');if(s===3)nkSet(el,'d3','good');
   var lk=function(a,b,c){var l=vzQ(el,'[data-l="'+a+'-'+b+'"]');if(l)l.setAttribute('d',c)};
   nkMsg(el,['Chaque data center sert <b>sa moitié des clients</b> (les A en bleu sur DC-1, les B en vert sur DC-2) et garde en permanence une <b>copie</b> des données de l\'autre (en orange).','DC-1 tombe. CloudDR <b>bascule</b> : DC-2 a déjà toutes les données, il reprend les clients A en <b>moins de 2 minutes</b>, sans perdre de transaction.','DC-2 tombe : même chose dans l\'autre sens, DC-1 reprend les clients B.','Les deux centres de la ville sont perdus (catastrophe locale). Le <b>site distant</b>, qui garde un environnement complet, prend le relais.'][s]);flow(s)}
  vzA(el,'[data-s]').forEach(function(b){b.onclick=function(){set(+b.dataset.s)}});set(0)}};

// ── 4. RTO et RPO sur une frise ──
var VZ_RTO={html:function(){return '<div class="vz mmx"><svg class="nk" viewBox="0 0 520 170" role="img" aria-label="Frise RTO RPO"><path d="M20 90H500" stroke="var(--nk-link)" stroke-width="4" stroke-linecap="round"/>'
 +'<rect class="po" x="200" y="74" width="0" height="32" rx="4" fill="#D93025" opacity=".85"/><rect class="to" x="240" y="74" width="0" height="32" rx="4" fill="#E8840C" opacity=".85"/>'
 +'<path d="M240 40V140" stroke="#D93025" stroke-width="2.5" stroke-dasharray="5 4"/>'+mmIc('bell',240,26,.8)+'<text class="nl" x="240" y="160">la panne</text>'
 +'<text class="ns tpo" x="200" y="66" style="text-anchor:end"></text><text class="ns tto" x="250" y="128" style="text-anchor:start"></text><text class="nl" x="40" y="120" style="text-anchor:start;font-size:12.5px;font-weight:400;fill:var(--muted)">avant</text><text class="nl" x="480" y="120" style="text-anchor:end;font-size:12.5px;font-weight:400;fill:var(--muted)">après</text></svg>'
 +'<div class="vz-row"><button class="vz-btn" data-g="1">MM 1.0</button><button class="vz-btn" data-g="2">MM 2.0</button></div><div class="vz-msg"></div></div>'},
 bind:function(el){vzStop(el);
  function set(g){vzA(el,'[data-g]').forEach(function(b){b.classList.toggle('on',+b.dataset.g===g)});var po=g===1?40:3,to=g===1?230:26;
   var p=vzQ(el,'.po'),t=vzQ(el,'.to');p.setAttribute('x',240-po);p.setAttribute('width',po);t.setAttribute('width',to);vzQ(el,'.tpo').setAttribute('x',236-po);
   vzQ(el,'.tpo').textContent=g===1?'données perdues (RPO) : secondes à minutes':'RPO ≈ 0';vzQ(el,'.tto').textContent=g===1?'service coupé (RTO) : 10 à 15 min':'RTO < 2 min';
   nkMsg(el,g===1?'En <b>MM 1.0</b>, le secours attendait sans travailler (actif-passif) : il fallait <b>10 à 15 minutes</b> pour relancer le service (le RTO, en orange), et les dernières transactions pouvaient être perdues (le RPO, en rouge).':'En <b>MM 2.0</b>, les deux centres travaillent déjà ensemble : le service revient en <b>moins de 2 minutes</b>, et on ne perd presque rien. <b>RPO</b> = combien de données on peut perdre ; <b>RTO</b> = combien de temps le service peut être coupé.')}
  vzA(el,'[data-g]').forEach(function(b){b.onclick=function(){set(+b.dataset.g)}});set(1)}};

// ── 5. Monolithe ou microservices : une erreur, quelle portée ──
var MM_SV=['Clients','Commandes','Comptes','Consultation','Notifs','Règlement'];
var VZ_MONO={html:function(){var s='<svg class="nk" viewBox="0 0 520 220" role="img" aria-label="Monolithe et microservices"><text class="nl" x="125" y="20">Monolithe (MM 1.0)</text><text class="nl" x="390" y="20">Microservices (MM 2.0)</text>'
  +'<rect class="mono" x="20" y="34" width="210" height="170" rx="14" fill="var(--nk-body)" stroke="var(--nk-edge)" stroke-width="2"/><text class="ns" x="125" y="196">un seul programme</text>';
  MM_SV.forEach(function(n,i){var x=34+(i%2)*100,y=46+Math.floor(i/2)*46;s+='<g class="m1" data-i="'+i+'"><rect x="'+x+'" y="'+y+'" width="90" height="36" rx="8" fill="#3D6FD9"/><text x="'+(x+45)+'" y="'+(y+23)+'" font-size="12" fill="#fff" text-anchor="middle">'+n+'</text></g>'});
  MM_SV.forEach(function(n,i){var x=300+(i%2)*100,y=56+Math.floor(i/2)*52;s+='<g class="m2" data-i="'+i+'" transform="translate('+(x+40)+','+y+') scale(.8)">'+nkIcon('pod')+'</g><text class="ns" x="'+(x+40)+'" y="'+(y+30)+'" style="font-family:inherit">'+n+'</text>'});
  return '<div class="vz mmx">'+s+'</svg><div class="vz-row" style="margin-top:8px"><button class="vz-btn on er">Une erreur dans « Commandes »</button><button class="vz-btn rz">Réparer</button></div><div class="vz-msg">À gauche, tout le métier dans <b>un seul programme</b>. À droite, chaque fonction tourne <b>seule</b>, dans ses propres conteneurs (pods). Provoque une erreur.</div></div>'},
 bind:function(el){vzStop(el);
  function paint(err){vzA(el,'.m1 rect').forEach(function(r){r.setAttribute('fill',err?'#D93025':'#3D6FD9')});vzQ(el,'.mono').setAttribute('stroke',err?'#D93025':'var(--nk-edge)');
   vzA(el,'.m2').forEach(function(g){var i=+g.dataset.i;g.querySelector('rect').setAttribute('fill',err&&i===1?'#D93025':err?'#1F9D6B':'#326CE5')})}
  vzQ(el,'.er').onclick=function(){paint(true);nkMsg(el,'<b>Monolithe : tout tombe.</b> L\'erreur dans « Commandes » fait planter le programme qui porte tout le reste.<br><b>Microservices : seul « Commandes » tombe.</b> Les autres continuent ; ceux qui l\'appellent voient des échecs, et c\'est ce que montrent les taux de succès.')};
  vzQ(el,'.rz').onclick=function(){paint(false);nkMsg(el,'Tout est réparé.')}}};

// ── 6. Health checker : écarter une instance malade ──
var VZ_HEALTH={html:function(){var n=[{id:'c',t:'phone',x:40,y:130,l:'Appels'},{id:'d',t:'lb',x:170,y:130,l:'DSF',s:'répartit'}];for(var i=1;i<=4;i++)n.push({id:'p'+i,t:'pod',x:420,y:20+i*52,l:'',s:''});
 return '<div class="vz mmx">'+nkStage({w:520,h:270,nodes:n,links:[['c','d'],['d','p1'],['d','p2'],['d','p3'],['d','p4']],extra:'<text class="zl" x="372" y="28">4 INSTANCES</text>'})
 +'<div class="vz-ctl" style="margin-top:4px">Capacité<div class="vz-bar" style="flex:1"><i style="width:100%"></i></div><b class="cp">100 %</b></div><div class="vz-row"><span style="font-size:13px;color:var(--muted)">Clique sur une instance pour la rendre malade.</span><button class="vz-btn rz" style="margin-left:auto">Tout rétablir</button></div><div class="vz-msg">Le DSF envoie les appels aux 4 instances du service, à tour de rôle.</div></div>'},
 bind:function(el){vzStop(el);var sick={};
  function cap(){var b=Object.keys(sick).length,c=(4-b)*25;vzQ(el,'.vz-bar i').style.width=c+'%';vzQ(el,'.cp').textContent=c+' %';return b}
  function flow(){el._f=(el._f||0)+1;var f=el._f,k=0;(function loop(){if(el._f!==f||!el.isConnected)return;var ok=[1,2,3,4].filter(function(i){return !sick[i]});if(ok.length){var i=ok[k++%ok.length];nkFly(el,['c','d','p'+i],{dot:'#3D6FD9',r:4,dur:380})}setTimeout(loop,330)})()}
  vzA(el,'g.n').forEach(function(g){var id=g.dataset.n;if(id[0]!=='p')return;g.style.cursor='pointer';g.onclick=function(){var i=+id[1];if(sick[i])return;sick[i]=1;nkSet(el,id,'bad');
   nkMsg(el,'L\'instance '+i+' ne répond plus bien. Le <b>health checker</b> s\'en aperçoit…');setTimeout(function(){nkLk(el,'d',id,'ko');var b=cap();
    nkMsg(el,b<4?'<b>DSF business health checker failed and isolated</b> : l\'instance '+i+' est <b>écartée</b>, elle ne reçoit plus d\'appels. Les autres prennent le trafic : le service tourne, à '+(4-b)*25+' % de sa capacité.':'<b>Toutes les instances sont écartées : le service est coupé.</b> C\'est le nombre d\'instances touchées, pas l\'alarme elle-même, qui fait la gravité.')},900)}});
  vzQ(el,'.rz').onclick=function(){sick={};vzA(el,'g.n').forEach(function(g){g.classList.remove('bad')});vzA(el,'.lk').forEach(function(l){l.classList.remove('ko')});cap();nkMsg(el,'Les 4 instances reçoivent à nouveau des appels.')};flow()}};

// ── 7. Compression : une tempête d'alarmes devient un seul incident ──
var VZ_COMP={html:function(){return '<div class="vz mmx"><div class="vz-row" style="align-items:flex-start;flex-wrap:nowrap;gap:14px"><div class="mm-al" style="flex:1;min-width:0"></div><div class="mm-ph"><div class="sc"><div style="font-size:11px;color:#9A9DA8">Astreinte · 03:12</div><div class="nt"><span>Notifications</span><b class="cnt">0</b></div><div class="mm-lst" style="margin-top:6px;font-size:11px;color:#C9C9D6;white-space:nowrap"></div></div></div></div>'
 +'<div class="vz-row" style="margin-top:10px"><button class="vz-btn on t">Un élément réseau devient injoignable</button><button class="vz-btn c">Compresser</button></div><div class="vz-msg">Lance la tempête, puis compresse.</div></div>'},
 bind:function(el){vzStop(el);var al=vzQ(el,'.mm-al');
  vzQ(el,'.t').onclick=function(){al.innerHTML='';var n=0,svc=['transaction-center','acctrans','notification','super-gateway','customer-center','identifier-center','order-query'];el._tok=(el._tok||0)+1;var tk=el._tok;
   (function add(){if(el._tok!==tk||n>=28)return;n++;var main=n===1;al.insertAdjacentHTML('beforeend','<div class="'+(main?'main':'')+'"><i></i><span>'+(main?'NE injoignable : sw-leaf-07':'Connexion échouée · '+svc[n%7])+'</span><small>03:12:'+(10+n)+'</small></div>');vzQ(el,'.cnt').textContent=n;vzQ(el,'.mm-lst').innerHTML=n+' alarmes non lues';setTimeout(add,70)})();
   nkMsg(el,'<b>28 alarmes en quelques secondes</b>, et une notification pour chacune : impossible de voir l\'essentiel.')};
  vzQ(el,'.c').onclick=function(){var rows=vzA(el,'.mm-al>div');if(!rows.length)return;el._tok++;rows.forEach(function(r,i){if(i)r.classList.add('gone')});rows[0].querySelector('span').textContent='NE injoignable : sw-leaf-07 · '+(rows.length-1)+' alarmes secondaires';vzQ(el,'.cnt').textContent='1';vzQ(el,'.mm-lst').innerHTML='1 incident';
   nkMsg(el,'<b>Une alarme principale</b> (la cause) et '+(rows.length-1)+' <b>secondaires</b> rangées dessous : <b>une seule notification</b>. Les secondaires restent consultables pour mesurer l\'étendue.')}}};

// ── 8. Élasticité : ajouter des pods quand la charge monte ──
var VZ_ELAST={html:function(){return '<div class="vz mmx"><svg class="nk" viewBox="0 0 520 200" role="img" aria-label="Élasticité"><rect x="10" y="10" width="500" height="150" rx="16" class="zone"/><text class="zl" x="24" y="32">CLUSTER KUBERNETES · SERVICE TRANSFER-BUSINESS</text>'+mmIc('k8s',470,46,.5)+'<g class="pods"></g></svg>'
 +'<div class="vz-ctl">Charge<input type="range" min="10" max="100" step="5" value="50"><b class="l">50 %</b></div><div class="vz-msg"></div></div>'},
 bind:function(el){vzStop(el);var r=vzQ(el,'input'),last=2;
  function draw(){var c=+r.value,n=c>85?4:2,per=Math.round(c*2/n),h='';vzQ(el,'.l').textContent=c+' %';
   for(var i=0;i<4;i++){var x=80+i*120;h+='<g class="pp'+(i<n?'':' off')+'" transform="translate('+x+',96)">'+nkIcon('pod').replace('#326CE5',per>80?'#D93025':per>60?'#E8840C':'#326CE5')+'<text y="46" text-anchor="middle" font-size="13" fill="var(--ink)" font-family="ui-monospace,Menlo,monospace">'+(i<n?'CPU '+per+' %':'')+'</text></g>'}
   vzQ(el,'.pods').innerHTML=h;
   nkMsg(el,c>85?'Le processeur a dépassé <b>85 %</b> : la règle d\'élasticité ajoute <b>2 pods</b>. La charge se répartit sur 4, et chacun redescend autour de '+per+' %. Quand la charge baisse, les pods en trop sont retirés.':'Sous 85 % de processeur, <b>deux pods</b> suffisent. Pour un pic connu (promotion, fin de mois), une règle <b>à heure fixe</b> ajoute les pods avant la charge. Monte la charge.')}
  r.oninput=draw;draw()}};

// ── 9. La chaîne d'appels, comme dans l'outil de traçage ──
var MM_GT=[['super-gateway',0,92,'Reçoit la requête USSD et trouve le stripe.'],['transfer-business',6,84,'Orchestre les étapes du transfert : il attend les autres.'],['transaction-center',12,20,'Crée la commande, contrôle les plafonds, calcule les frais.'],['acctrans',34,52,'Débite et crédite les comptes. C\'est lui qui fait attendre tout le monde.'],['notification',88,6,'Envoie le SMS de confirmation.']];
var VZ_GANTT={html:function(){return '<div class="vz mmx"><div class="mm-tr"><div class="hd"><span>Chaîne d\'appels</span><span style="opacity:.7">traceId 8f3a2c…e91</span><span style="margin-left:auto">transfert · 400 ms</span></div><div class="ax"><span>0</span><span>100</span><span>200</span><span>300</span><span>400 ms</span></div>'
 +MM_GT.map(function(d,i){return '<div class="rw" data-i="'+i+'"><span>'+(i?'&nbsp;'.repeat(Math.min(i,2)*2)+'└ ':'')+d[0]+'</span><div class="bar"><i style="left:'+d[1]+'%;width:'+d[2]+'%"></i></div></div>'}).join('')+'</div>'
 +'<div class="vz-row" style="margin-top:10px"><button class="vz-btn on f">Trouver le plus lent</button></div><div class="vz-msg">Chaque ligne est un appel d\'un service à un autre, dans l\'ordre (le seqNo). La longueur de la barre, c\'est sa durée. Clique sur une ligne.</div></div>'},
 bind:function(el){vzStop(el);
  vzA(el,'.rw').forEach(function(rw){rw.onclick=function(){vzA(el,'.rw').forEach(function(x){x.classList.remove('sel')});rw.classList.add('sel');var d=MM_GT[+rw.dataset.i];nkMsg(el,'<b>'+d[0]+'</b> · seqNo '+(+rw.dataset.i+1)+' · '+d[2]*4+' ms<br>'+d[3])}});
  vzQ(el,'.f').onclick=function(){vzQ(el,'.rw[data-i="3"]').classList.add('slow');nkMsg(el,'Les deux premières barres sont longues parce qu\'elles <b>attendent</b> les autres. Le vrai coupable est la barre la plus longue <b>tout en bas de la cascade</b> : <b>acctrans</b> (208 ms). C\'est là qu\'il faut chercher.')}}};

// ── 10. TradeOrder et PaymentOrder : annuler une partie d'un achat ──
var VZ_ORDER={html:function(){return '<div class="vz mmx"><div class="mm-app"><div class="sc"><div class="tt">Historique</div><div class="mm-rc"><div style="display:flex;justify-content:space-between"><b>Achat en ligne · Boutique</b><b>300 F</b></div><div style="font-size:11.5px;color:#8C96A6;margin-bottom:4px">TradeOrder n° 7781 · ce que voit le client</div>'
 +[['Article 1',50],['Article 2',150],['Livraison',100]].map(function(p,i){return '<div class="l" data-i="'+i+'"><span>'+p[0]+' · <small style="color:#8C96A6">PaymentOrder '+(i+1)+'</small></span><span>'+p[1]+' F <button>Annuler</button></span></div>'}).join('')+'</div><div class="cxs"></div></div></div>'
 +'<div class="vz-msg">Un achat (la <b>TradeOrder</b>, celle que voit le client) est fait de plusieurs paiements internes (les <b>PaymentOrder</b>). Annule une partie.</div></div>'},
 bind:function(el){vzStop(el);var n=0;
  vzA(el,'.l').forEach(function(l){var b=l.querySelector('button');b.onclick=function(){n++;l.classList.add('off');b.remove();var v=[50,150,100][+l.dataset.i];
   vzQ(el,'.cxs').insertAdjacentHTML('beforeend','<div class="mm-rc cx"><div style="display:flex;justify-content:space-between"><b>Remboursement</b><b>+'+v+' F</b></div><div style="font-size:11.5px;opacity:.8">TradeOrder d\'annulation n° '+(7781+n)+' · liée à l\'achat n° 7781</div></div>');
   nkMsg(el,'L\'annulation crée une <b>nouvelle TradeOrder</b>, liée à l\'achat d\'origine. Rien n\'est effacé : le centre d\'appels voit tout l\'historique d\'un coup.')}})}};

W.sim_stripes={t:"Une tranche de clients, un stripe",ic:"Rows3",html:VZ_STRIPES.html,bind:VZ_STRIPES.bind};
W.sim_gris={t:"Fais avancer une gray release",ic:"Shuffle",html:VZ_GRIS.html,bind:VZ_GRIS.bind};
W.sim_aa={t:"Fais tomber un data center",ic:"Building2",html:VZ_AA.html,bind:VZ_AA.bind};
W.sim_rto={t:"RTO et RPO, avant et après",ic:"Timer",html:VZ_RTO.html,bind:VZ_RTO.bind};
W.sim_mono={t:"Une erreur, quelle portée ?",ic:"Boxes",html:VZ_MONO.html,bind:VZ_MONO.bind};
W.sim_health={t:"Écarte une instance malade",ic:"Stethoscope",html:VZ_HEALTH.html,bind:VZ_HEALTH.bind};
W.sim_comp={t:"Compresse une tempête",ic:"Shrink",html:VZ_COMP.html,bind:VZ_COMP.bind};
W.sim_elast={t:"Fais monter la charge",ic:"TrendingUp",html:VZ_ELAST.html,bind:VZ_ELAST.bind};
W.sim_gantt={t:"Lis une chaîne d'appels",ic:"ListOrdered",html:VZ_GANTT.html,bind:VZ_GANTT.bind};
W.sim_order={t:"Annule une partie d'un achat",ic:"Ticket",html:VZ_ORDER.html,bind:VZ_ORDER.bind};

/* ══════════════════════════════════════════════════════════════
   ILLUSTRATIONS DES MOTS CLÉS (GI) : une image propre à chaque mot,
   différente des scènes des leçons.
   ══════════════════════════════════════════════════════════════ */
function mmPods(n,x,y,gap,col){var s='';for(var i=0;i<n;i++)s+='<g transform="translate('+(x+i*gap)+','+y+') scale(.7)">'+nkIcon('pod').replace('#326CE5',col||'#326CE5')+'</g>';return s}
GI["MM 2.0"]=function(){return giWrap(giSvg(420,150,mmIc('building',90,70)+mmIc('building',220,70)+mmIc('phone',350,70)+'<path class="lk" d="M138 70H172M268 70H330"/>'+giT(155,130,'deux data centers actifs',{s:12.5,c:'var(--muted)'})+giT(350,130,'tes clients',{s:12.5,c:'var(--muted)'})),'La plateforme Mobile Money en version cloud native : microservices, stripes, deux data centers qui travaillent ensemble.')};
GI["MM 1.0"]=function(){return giWrap(giSvg(420,140,mmIc('building',110,66)+mmIc('building',300,66,1,'dim')+'<path class="lk" d="M160 66H250" style="stroke-dasharray:6 6"/>'+giLbl(110,124,'actif')+giLbl(300,124,'en attente','ko')),'L\'ancienne plateforme : un gros programme et un secours qui attendait sans travailler.').replace('class="dim"','opacity=".4"')};
GI["Cloud native"]=function(){return giWrap(giSvg(420,150,'<rect x="20" y="20" width="380" height="110" rx="16" class="zone" fill="var(--nk-zone)" stroke="var(--nk-zedge)" stroke-dasharray="6 5"/>'+mmIc('k8s',60,75,.6)+mmPods(5,130,75,58)),'Une application faite de petits services dans des conteneurs, que la plateforme démarre, répare et multiplie seule.')};
GI["Microservice"]=function(){return giWrap(giSvg(420,130,['comptes','commandes','notifs'].map(function(t,i){return mmIc('pod',90+i*120,50,.95)+giT(90+i*120,98,t,{s:12.5})}).join('')+'<path class="lk" d="M120 50H180M240 50H300"/>'),'Une petite application qui ne fait qu\'une chose et parle aux autres par le réseau. Si elle tombe, seule sa fonction est touchée.')};
GI["Monolithe"]=function(){return giWrap(giSvg(420,140,'<rect x="100" y="16" width="220" height="104" rx="14" fill="#3D6FD9"/>'+['clients','commandes','comptes','notifs'].map(function(t,i){return '<rect x="'+(112+(i%2)*104)+'" y="'+(28+Math.floor(i/2)*44)+'" width="92" height="36" rx="8" fill="#2D5A8E"/>'+giT(158+(i%2)*104,50+Math.floor(i/2)*44,t,{s:12,c:'#fff'})}).join('')),'Tout le métier dans un seul gros programme : une erreur peut tout faire tomber.')};
GI["Conteneur"]=function(){return giWrap(giSvg(420,130,'<rect x="120" y="20" width="180" height="90" rx="10" fill="#2D5A8E"/><path d="M150 20v90M180 20v90M210 20v90M240 20v90M270 20v90" stroke="#1E3A5F" stroke-width="4"/>'+giT(210,128,'programme + tout ce qu\'il lui faut',{s:12.5,c:'var(--muted)'})),'Une boîte qui contient un programme et tout ce dont il a besoin : il tourne pareil partout.')};
GI["Pod"]=function(){return giWrap(giSvg(420,130,mmIc('pod',210,60,1.8)+giT(210,122,'un ou plusieurs conteneurs, lancés ensemble',{s:12.5,c:'var(--muted)'})),'La plus petite unité que Kubernetes démarre : un ou quelques conteneurs qui vivent ensemble.')};
GI["Kubernetes"]=function(){return giWrap(giSvg(420,140,mmIc('k8s',70,70,1)+'<path class="lk" d="M110 70H160"/>'+mmPods(4,190,70,60)+giT(280,124,'il les démarre, les surveille, les remplace',{s:12,c:'var(--muted)'})),'Le chef d\'orchestre des conteneurs : il décide où ils tournent et les relance s\'ils meurent.')};
GI["AZ"]=function(){return giWrap(giSvg(420,130,'<rect x="20" y="14" width="180" height="100" rx="14" fill="var(--nk-zone)" stroke="var(--nk-zedge)" stroke-dasharray="6 5"/><rect x="220" y="14" width="180" height="100" rx="14" fill="var(--nk-zone)" stroke="var(--nk-zedge)" stroke-dasharray="6 5"/>'+giT(34,34,'AZ 1',{a:'start',b:1,s:12})+giT(234,34,'AZ 2',{a:'start',b:1,s:12})+mmIc('rack',110,72,.5)+mmIc('rack',310,72,.5)),'Une zone de disponibilité : un ensemble de salles avec son électricité et son réseau à lui. Une panne reste dans sa zone.')};
GI["Stripe"]=function(){var s='';for(var i=0;i<4;i++)s+=mmIc('rack',80+i*90,60,.55)+giT(80+i*90,120,'CP '+(1001+i*100)+'…',{s:11,m:1,c:'var(--muted)'});return giWrap(giSvg(420,130,s),'Une tranche de clients (par CP ID) avec ses propres serveurs et bases. Une panne ne touche que sa tranche.')};
GI["RSU"]=function(){return giWrap(giSvg(420,140,mmIc('rack',120,70,.7)+giT(190,46,'Un stripe régional',{a:'start',b:1,s:13})+giT(190,70,'applications + bases',{a:'start',s:12.5})+giT(190,92,'≈ 10 millions de clients',{a:'start',s:12.5})),'Regional Service Unit : un stripe, qui porte les transferts d\'une tranche de clients.')};
GI["GSU"]=function(){return giWrap(giSvg(420,130,mmIc('rack',90,64,.6)+['portails','batch','comptabilité','règlement'].map(function(t,i){return giLbl(250+(i%2)*110,40+Math.floor(i/2)*46,t)}).join('')),'Global Service Unit : unique, il porte ce qui concerne tout le monde (portails, traitements de fond, comptabilité).')};
GI["CSU"]=function(){return giWrap(giSvg(420,130,mmIc('rack',90,64,.6)+giLbl(260,44,'middleware')+giLbl(260,88,'IdentifierCenter')),'Common Service Unit : les services partagés que tous les stripes consultent.')};
GI["CP ID"]=function(){return giWrap(giSvg(420,100,giPlate([['CP','g',''],['1157','n','le numéro du client']],14)+'<path class="lk" d="M200 38H260"/>'+giLbl(330,38,'→ stripe RSU02')),'Le numéro qui dit à quel stripe appartient un client.')};
GI["TPS"]=function(){var s='';for(var i=0;i<12;i++)s+='<rect x="'+(40+i*29)+'" y="'+(90-((i*37)%60))+'" width="20" height="'+(20+((i*37)%60))+'" rx="3" fill="var(--vd)"/>';return giWrap(giSvg(420,130,s+giT(210,124,'transactions traitées chaque seconde',{s:12.5,c:'var(--muted)'})),'Transactions par seconde : la cadence de la plateforme. Une chute brutale signale souvent une panne.')};
GI["NSLB"]=function(){return giSt({w:430,h:160,nodes:[{id:'l',t:'lb',x:110,y:80,l:'NSLB'},{id:'a',t:'server',x:330,y:30},{id:'b',t:'server',x:330,y:80},{id:'c',t:'server',x:330,y:130}],links:[['l','a'],['l','b'],['l','c']]},'Le répartiteur de charge : il expose une adresse (VIP) et partage les requêtes entre serveurs.')};
GI["Super Gateway"]=function(){return giSt({w:430,h:150,nodes:[{id:'p',t:'phone',x:40,y:70},{id:'g',t:'lb',x:180,y:70,l:'Super Gateway'},{id:'r',t:'rack',x:370,y:72,sc:.5,l:'RSU02'}],links:[['p','g'],['g','r']],pk:[[110,40,'*144#'],[280,40,'CP 1157 → RSU02']]},'La porte d\'entrée : elle reçoit chaque requête (USSD, application, API) et l\'envoie au bon stripe.')};
GI["Notification Center"]=function(){return giWrap(giSvg(420,130,mmIc('pod',90,60,1.2)+'<path class="lk" d="M130 60H250"/>'+mmIc('phone',300,62)+'<rect x="320" y="30" width="90" height="30" rx="8" fill="#24262C"/>'+giT(365,50,'SMS reçu',{s:11,c:'#E9E9EF'})),'Le service qui envoie les SMS et notifications de confirmation.')};
GI["Acctrans"]=function(){return giWrap(giSvg(420,130,'<rect x="40" y="30" width="130" height="60" rx="10" fill="var(--surface2)"/>'+giT(105,56,'Compte A',{b:1,s:13})+giT(105,76,'− 5 000',{m:1,c:'#D93025'})+'<rect x="250" y="30" width="130" height="60" rx="10" fill="var(--surface2)"/>'+giT(315,56,'Compte B',{b:1,s:13})+giT(315,76,'+ 5 000',{m:1,c:'#1F9D6B'})+'<path d="M176 60H244M244 60l-8 -6M244 60l-8 6" stroke="var(--vd)" stroke-width="3" fill="none"/>'),'Le service qui débite et crédite réellement les comptes.')};
GI["KYC"]=function(){return giWrap(giSvg(420,140,'<rect x="110" y="16" width="200" height="110" rx="12" fill="#1E3A5F"/><circle cx="160" cy="62" r="20" fill="#9DB8F2"/><path d="M130 110c4-22 56-22 60 0" fill="#9DB8F2"/>'+giT(210,56,'Nom, prénom',{a:'start',s:12,c:'#fff'})+giT(210,76,'Pièce d\'identité',{a:'start',s:12,c:'#C9D6EE'})+giT(210,96,'vérifiée ✓',{a:'start',s:12,c:'#7FD1A8',b:1})),'Know Your Customer : la vérification de l\'identité du client, qui fixe ses plafonds.')};
GI["Till"]=function(){return giWrap(giSvg(420,110,'<rect x="140" y="20" width="140" height="70" rx="10" fill="#F2C14E"/>'+giT(210,52,'Till 88 21 34',{b:1,m:1,s:14})+giT(210,74,'numéro du marchand',{s:11.5})),'Le numéro court d\'un point de vente, que le client saisit pour payer.')};
GI["TradeOrder"]=function(){return giWrap(giSvg(400,150,'<rect x="110" y="10" width="180" height="130" rx="10" fill="var(--nk-paper)" stroke="var(--nk-pedge)" stroke-width="2"/>'+giT(200,36,'Achat n° 7781',{b:1,s:14})+giT(200,60,'300 F',{s:20,b:1,m:1})+giT(200,90,'c\'est ce que voit',{s:12,c:'var(--muted)'})+giT(200,108,'le client',{s:12,c:'var(--muted)'})),'La commande vue par le client : un achat, un transfert, avec un numéro et une notification.')};
GI["PaymentOrder"]=function(){return giWrap(giSvg(420,150,'<rect x="20" y="40" width="120" height="60" rx="10" fill="var(--nk-paper)" stroke="var(--nk-pedge)" stroke-width="2"/>'+giT(80,75,'TradeOrder',{b:1,s:12.5})+[50,150,100].map(function(v,i){return '<path class="lk" d="M140 70L230 '+(26+i*48)+'"/><rect x="230" y="'+(10+i*48)+'" width="160" height="34" rx="8" fill="var(--surface2)"/>'+giT(310,32+i*48,'PaymentOrder · '+v+' F',{s:12})}).join('')),'Les paiements internes qui composent une commande. Le client ne les voit pas.')};
GI["Compte d'attente"]=function(){return giWrap(giSvg(420,110,'<rect x="30" y="34" width="100" height="44" rx="8" fill="var(--surface2)"/>'+giT(80,61,'payeur',{s:12.5})+'<rect x="160" y="26" width="100" height="60" rx="8" fill="#F2C14E"/>'+giT(210,52,'en attente',{s:12,b:1})+giT(210,72,'1 000 F',{s:12,m:1})+'<rect x="290" y="34" width="100" height="44" rx="8" fill="var(--surface2)"/>'+giT(340,61,'bénéficiaire',{s:12.5})+'<path class="lk" d="M130 56H160M260 56H290"/>'),'Un compte de transit où l\'argent attend le temps qu\'une opération se termine.')};
GI["ReceiptNo"]=function(){return giWrap(giSvg(420,110,'<rect x="120" y="12" width="180" height="86" rx="8" fill="#24262C"/>'+giT(210,38,'Transfert réussi',{s:12,c:'#E9E9EF'})+giT(210,62,'Réf : MP261104.1532.A07',{s:11,m:1,c:'#7FD1A8'})+giT(210,84,'5 000 F',{s:12,c:'#E9E9EF',b:1})),'La référence de la transaction donnée au client : c\'est elle qu\'on demande pour retrouver une opération.')};
GI["Actif-actif"]=function(){return giSt({w:430,h:140,nodes:[{id:'a',t:'building',x:90,y:60,l:'DC-1 · 50 %'},{id:'b',t:'building',x:340,y:60,l:'DC-2 · 50 %'}],links:[['a','b','wifi']],extra:giLbl(215,40,'copie continue')},'Deux data centers qui servent tous les deux des clients, et qui se copient. Si l\'un tombe, l\'autre prend tout.')};
GI["RTO"]=function(){return giWrap(giSvg(420,100,'<path d="M20 50H400" stroke="var(--nk-link)" stroke-width="4"/><path d="M120 30V70" stroke="#D93025" stroke-width="3"/><rect x="120" y="38" width="160" height="24" rx="4" fill="#E8840C"/>'+giT(200,55,'service coupé',{s:12,c:'#fff',b:1})+giT(120,90,'panne',{s:12})+giT(280,90,'service revenu',{s:12})),'Recovery Time Objective : combien de temps le service peut rester coupé. En MM 2.0, moins de 2 minutes.')};
GI["RPO"]=function(){return giWrap(giSvg(420,100,'<path d="M20 50H400" stroke="var(--nk-link)" stroke-width="4"/><rect x="200" y="38" width="80" height="24" rx="4" fill="#D93025"/><path d="M280 30V70" stroke="#D93025" stroke-width="3"/>'+giT(240,55,'perdues',{s:12,c:'#fff',b:1})+giT(280,90,'panne',{s:12})+giT(150,90,'dernière copie',{s:12})),'Recovery Point Objective : combien de données on accepte de perdre. En MM 2.0, presque rien.')};
GI["CloudDR"]=function(){return giSt({w:430,h:140,nodes:[{id:'a',t:'building',x:80,y:60,l:'DC-1',cls:'bad'},{id:'c',t:'server',x:215,y:60,l:'CloudDR'},{id:'b',t:'building',x:350,y:60,l:'DC-2',cls:'good'}],links:[['a','c','ko'],['c','b','on']]},'L\'outil qui orchestre la bascule : base, services et trafic passent sur l\'autre data center.')};
GI["Bascule"]=function(){return giWrap(giSvg(420,110,mmIc('ats',210,50,1.3)+giT(110,60,'DC-1',{b:1})+giT(310,60,'DC-2',{b:1})+giT(210,104,'tout le trafic passe de l\'un à l\'autre',{s:12,c:'var(--muted)'})),'Le passage du service d\'un data center à l\'autre.')};
GI["Gray release"]=function(){var s='';for(var i=0;i<10;i++)s+='<g transform="translate('+(30+i*36)+',40) scale(.62)">'+nkIcon('user').replace(/var\(--nk-edge\)/g,i<2?'#1F9D6B':'#3D6FD9')+'</g>';return giWrap(giSvg(400,110,s+giLbl(70,90,'V2 : 2 clients')+giLbl(250,90,'V1 : tous les autres')),'Une nouvelle version d\'abord ouverte à quelques clients, puis à tous si tout va bien.')};
GI["Couloir"]=function(){return giWrap(giSvg(420,110,'<rect x="20" y="14" width="380" height="36" rx="10" fill="#E8EFFC"/>'+giT(40,37,'couloir bleu · V1',{a:'start',b:1,s:12.5,c:'#1E4FB8'})+'<rect x="20" y="60" width="380" height="36" rx="10" fill="#E3F4E8"/>'+giT(40,83,'couloir vert · V2',{a:'start',b:1,s:12.5,c:'#14532D'})+mmPods(3,300,32,34)+mmPods(3,300,78,34,'#1F9D6B')),'Chaque version tourne dans son propre couloir de serveurs, côte à côte.')};
GI["Utilisateur gris"]=function(){return giWrap(giSvg(420,110,'<g transform="translate(210,48) scale(1.3)">'+nkIcon('user').replace(/var\(--nk-edge\)/g,'#1F9D6B')+'</g>'+giLbl(210,96,'choisi pour tester la V2')),'Un client sélectionné pour essayer en premier la nouvelle version.')};
GI["DigitalView"]=function(){return giWrap('<div class="nk-term" style="background:var(--surface)"><div class="nk-tb"><i></i><i></i><i></i><span>DigitalView · Alarmes courantes</span></div><div style="padding:10px 12px;font-size:12.5px;color:var(--ink);display:grid;gap:6px"><div><b style="color:#D63B4B">●</b> Critical · TPS en chute · RSU02</div><div><b style="color:#E0781F">●</b> Major · hwPowerInvalid · fw_02</div><div><b style="color:#2F72C4">●</b> Warning · disque à 82 %</div></div></div>','L\'outil de supervision de la plateforme : alarmes, performances, chaînes d\'appels.')};
GI["Seuil"]=function(){var s='<path d="M20 30H400" stroke="#D93025" stroke-width="2" stroke-dasharray="6 4"/>'+giT(400,22,'seuil 85 %',{a:'end',s:12,c:'#D93025'});var pts=[90,80,76,70,60,40,26,50,72,80];s+='<path d="M20 '+pts[0]+pts.map(function(y,i){return 'L'+(20+i*42)+' '+y}).join('')+'" stroke="var(--vd)" stroke-width="3" fill="none"/>'+mmIc('bell',272,14,.5);return giWrap(giSvg(420,110,s),'La valeur au-delà de laquelle une alarme se déclenche.')};
GI["Élasticité"]=function(){return giWrap(giSvg(420,120,mmPods(2,60,50,60)+'<path d="M190 50H230M230 50l-8 -6M230 50l-8 6" stroke="var(--vd)" stroke-width="3" fill="none"/>'+mmPods(4,270,50,46)+giT(90,104,'calme',{s:12,c:'var(--muted)'})+giT(340,104,'pic de charge',{s:12,c:'var(--muted)'})),'La plateforme ajoute des pods quand la charge monte, et les retire quand elle baisse.')};
GI["AIOps"]=function(){return giWrap(giSvg(420,120,[90,80,85,70,88,30,82,78].map(function(y,i){return '<circle cx="'+(40+i*46)+'" cy="'+y+'" r="6" fill="'+(i===5?'#D93025':'var(--vd)')+'"/>'}).join('')+giLbl(270,14,'anomalie repérée','ko')),'L\'intelligence artificielle appliquée à l\'exploitation : repérer les anomalies et regrouper les alarmes.')};
GI["Compression d'alarmes"]=function(){var s='';for(var i=0;i<8;i++)s+=mmIc('bell',40+(i%4)*36,30+Math.floor(i/4)*40,.6);return giWrap(giSvg(420,110,s+'<path d="M190 50H240M240 50l-8 -6M240 50l-8 6" stroke="var(--vd)" stroke-width="3" fill="none"/>'+mmIc('bell',300,46,1.2)+giLbl(370,46,'1 incident')),'Des dizaines d\'alarmes liées regroupées en une seule, la cause.')};
GI["Alarme principale"]=function(){return giWrap(giSvg(420,110,'<rect x="40" y="16" width="340" height="34" rx="8" fill="none" stroke="#D93025" stroke-width="2"/>'+giT(56,38,'● NE injoignable : sw-leaf-07',{a:'start',s:12.5,b:1})+'<rect x="70" y="58" width="310" height="26" rx="6" fill="var(--surface2)"/>'+giT(86,75,'27 alarmes secondaires',{a:'start',s:12,c:'var(--muted)'})),'L\'alarme de la cause : celle sur laquelle on agit.')};
GI["Alarme secondaire"]=function(){return giWrap(giSvg(420,110,'<rect x="40" y="10" width="340" height="26" rx="6" fill="var(--surface2)"/>'+giT(56,28,'● NE injoignable (principale)',{a:'start',s:12,c:'var(--muted)'})+[0,1].map(function(i){return '<rect x="70" y="'+(44+i*30)+'" width="310" height="24" rx="6" fill="none" stroke="#E8840C" stroke-width="2"/>'+giT(86,60+i*30,'● connexion échouée · conséquence',{a:'start',s:12})}).join('')),'Une conséquence de la panne principale : utile pour mesurer l\'étendue, pas pour agir.')};
GI["Fault Agent"]=function(){return giWrap(giSvg(420,110,mmIc('server',90,50)+mmIc('pod',90,50,.4)+'<path class="lk" d="M140 50H260"/>'+mmIc('server',310,50)+giT(310,96,'DigitalView',{s:12,c:'var(--muted)'})+giLbl(200,30,'alarmes')),'Le petit agent posé sur les machines, qui remonte les pannes vers la supervision.')};
GI["Chaîne d'appels"]=function(){return giWrap(giSvg(420,120,[['gateway',0,320],['transfer',20,280],['transaction',50,80],['acctrans',140,150]].map(function(r,i){return giT(20,26+i*26,r[0],{a:'start',s:12,m:1})+'<rect x="'+(120+r[1]*.85)+'" y="'+(14+i*26)+'" width="'+r[2]*.85+'" height="14" rx="4" fill="'+(i===3?'#D93025':'#3D6FD9')+'"/>'}).join('')),'L\'enchaînement des appels entre services pour une transaction, avec la durée de chacun.')};
GI["seqNo"]=function(){return giWrap(giSvg(420,100,[1,2,3,4].map(function(n,i){return '<rect x="'+(30+i*96)+'" y="30" width="80" height="36" rx="8" fill="var(--surface2)"/>'+giT(70+i*96,53,'seqNo '+n,{s:12.5,m:1})+(i<3?'<path class="lk" d="M'+(110+i*96)+' 48H'+(126+i*96)+'"/>':'')}).join('')),'Le numéro d\'ordre d\'un appel dans la chaîne.')};
GI["Kafka"]=function(){var s='<rect x="140" y="30" width="140" height="50" rx="10" fill="#2B303B"/>';for(var i=0;i<6;i++)s+='<rect x="'+(152+i*20)+'" y="42" width="14" height="26" rx="2" fill="#F2C14E"/>';return giWrap(giSvg(420,110,mmIc('pod',60,55,.8)+'<path class="lk" d="M90 55H140M280 55H330"/>'+s+mmIc('pod',360,55,.8)+giT(210,100,'une file de messages',{s:12,c:'var(--muted)'})),'Une file de messages : un service dépose, un autre lit quand il peut.')};
GI["ZooKeeper"]=function(){return giSt({w:420,h:150,nodes:[{id:'z',t:'server',x:210,y:40,l:'ZooKeeper'},{id:'a',t:'pod',x:80,y:120},{id:'b',t:'pod',x:210,y:120},{id:'c',t:'pod',x:340,y:120}],links:[['z','a'],['z','b'],['z','c']]},'Le coordinateur que les services consultent : qui est le chef, quelle est la bonne configuration.')};
GI["IP flottante"]=function(){return giSt({w:430,h:140,nodes:[{id:'a',t:'server',x:90,y:80,l:'Serveur 1',cls:'bad'},{id:'b',t:'server',x:340,y:80,l:'Serveur 2',cls:'good'}],links:[],extra:giLbl(215,30,'10.30.0.100 → passe au serveur 2')},'Une adresse qui passe d\'une machine à l\'autre quand la première tombe.')};
GI["Health checker"]=function(){return giSt({w:430,h:150,nodes:[{id:'d',t:'lb',x:100,y:76,l:'Health checker'},{id:'a',t:'pod',x:330,y:30},{id:'b',t:'pod',x:330,y:80,cls:'bad'},{id:'c',t:'pod',x:330,y:130}],links:[['d','a','on'],['d','b','ko'],['d','c','on']]},'Il teste chaque instance régulièrement et écarte celles qui ne répondent plus bien.')};
GI["DSF"]=function(){return giSt({w:430,h:120,nodes:[{id:'a',t:'pod',x:80,y:60,l:'service A'},{id:'b',t:'pod',x:340,y:60,l:'service B'}],links:[['a','b']],pk:[[210,30,'appel DSF']]},'Le cadre qui relie les microservices entre eux : il trouve l\'instance à appeler et répartit les appels.')};
GI["MOName"]=function(){return giWrap(giSvg(420,100,giPlate([['pr2','n','site'],['internal_fw','o','rôle'],['02','h','n°']],10)),'Le nom de l\'objet en alarme : il dit souvent où et quoi.')};
GI["HSM"]=function(){return giWrap(giSvg(420,120,'<rect x="130" y="20" width="160" height="70" rx="8" fill="#2B303B"/><rect x="190" y="40" width="40" height="34" rx="5" fill="#F2C14E"/><path d="M200 40v-8a10 10 0 0 1 20 0v8" stroke="#F2C14E" stroke-width="4" fill="none"/>'+giT(210,110,'les clés secrètes ne sortent jamais',{s:12,c:'var(--muted)'})),'Le coffre-fort matériel qui garde les clés de chiffrement (codes PIN, signatures).')};
GI["Liquibase"]=function(){return giWrap(giSvg(420,110,mmIc('db',80,52,1.1)+['v1','v2','v3'].map(function(v,i){return '<rect x="'+(150+i*84)+'" y="34" width="72" height="34" rx="8" fill="'+(i===2?'var(--vd)':'var(--surface2)')+'"/>'+giT(186+i*84,56,'schéma '+v,{s:12,c:i===2?'#fff':'var(--ink)'})}).join('')),'L\'outil qui applique, dans l\'ordre, les changements de structure des bases.')};
GI["BFD"]=function(){return giSt({w:430,h:110,nodes:[{id:'a',t:'router',x:80,y:60},{id:'b',t:'router',x:350,y:60}],links:[['a','b','ko']],pk:[[215,30,'plus de réponse','ko']]},'hwBfdSessFaultDown : deux équipements réseau ne s\'entendent plus, un chemin est coupé.')};
GI["HRP"]=function(){return giSt({w:430,h:110,nodes:[{id:'a',t:'fw',x:130,y:56,l:'actif'},{id:'b',t:'fw',x:300,y:56,l:'veille'}],links:[['a','b','wifi']]},'Le battement de cœur entre deux pare-feux jumeaux. hwHrpHeartChange : il a changé de chemin.')};
