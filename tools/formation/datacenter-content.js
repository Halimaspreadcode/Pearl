/* ══════════════════════════════════════════════════════════════
   CONTENU DE LA FORMATION « DATA CENTER »
   (du bâtiment au port : énergie, froid, baie, serveurs, câbles,
   leaf-spine, VXLAN, pare-feux, ports logiques)

   Ce fichier n'est pas chargé tel quel : tools/formation/build.js
   l'insère dans le moteur de la formation DigitalView pour produire
   public/formation/datacenter.html. Après modification :
       node tools/formation/build.js datacenter

   Format : voir mobilemoney-content.js (mêmes cartes, mêmes schémas
   simplifiés). Les scènes interactives sont dans datacenter-widgets.js.
   Les exemples (baies, adresses) sont génériques : ce ne sont pas les
   plans réels des sites.
   ══════════════════════════════════════════════════════════════ */

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

var G={
"Data center":{c:"Data center",d:"Un bâtiment conçu pour faire tourner des serveurs sans interruption : électricité, refroidissement, réseau et sécurité en continu.",a:"Une usine dont le produit est la disponibilité."},
"Tier":{c:"Data center",d:"Le niveau de fiabilité d'un data center, de I à IV. Tier III : chaque élément peut être arrêté pour maintenance sans couper les serveurs. Tier IV : une panne imprévue sur n'importe quel élément ne coupe rien."},
"PUE":{c:"Énergie et froid",d:"Power Usage Effectiveness : énergie totale du bâtiment ÷ énergie des équipements informatiques. 1,5 = 0,5 kW de froid et de pertes pour 1 kW de serveurs."},
"Baie":{c:"Matériel",d:"L'armoire (rack) où l'on fixe serveurs, switchs et stockage. Format standard 19 pouces, souvent 42U de haut (environ 2 m).",a:"Une étagère normalisée, au millimètre près."},
"U (unité)":{c:"Matériel",d:"L'unité de hauteur dans une baie : 1U = 44,45 mm. Un serveur fait 1U ou 2U ; une baie compte souvent 42U."},
"PDU":{c:"Matériel",d:"Power Distribution Unit : le bandeau de prises de la baie. Il y en a deux, A et B, alimentés par deux chaînes électriques différentes."},
"Onduleur":{c:"Énergie et froid",d:"UPS : il lisse le courant et garde de l'énergie dans des batteries pour tenir les quelques secondes ou minutes avant le démarrage du groupe électrogène."},
"Groupe électrogène":{c:"Énergie et froid",d:"Un moteur qui produit de l'électricité quand le réseau est coupé. Il démarre en une dizaine de secondes et tient tant qu'il a du carburant."},
"ATS":{c:"Énergie et froid",d:"Automatic Transfer Switch : l'inverseur qui bascule automatiquement l'alimentation du réseau vers le groupe électrogène, et inversement."},
"N+1":{c:"Énergie et froid",d:"Un équipement de plus que nécessaire : 4 climatiseurs pour un besoin de 3. Une panne est absorbée."},
"2N":{c:"Énergie et froid",d:"Tout est doublé en deux chaînes indépendantes (A et B). La perte d'une chaîne entière ne coupe rien."},
"Allée froide":{c:"Énergie et froid",d:"L'allée devant les baies, où arrive l'air froid que les équipements aspirent par l'avant."},
"Allée chaude":{c:"Énergie et froid",d:"L'allée derrière les baies, où ressort l'air réchauffé, renvoyé vers les climatiseurs."},
"CRAH":{c:"Énergie et froid",d:"Les climatiseurs de salle (ou CRAC) : ils reprennent l'air chaud et renvoient de l'air froid."},
"Panneau d'obturation":{c:"Matériel",d:"Une plaque qui ferme un emplacement vide de la baie, pour que l'air chaud de l'arrière ne revienne pas devant."},
"Panneau de brassage":{c:"Matériel",d:"Un panneau de prises où arrivent les câbles venus d'ailleurs. On y relie les équipements par de courtes jarretières."},
"Jarretière":{c:"Matériel",d:"Un câble court (cuivre ou fibre) entre un panneau de brassage et un port d'équipement."},
"Lame":{c:"Matériel",d:"Un serveur lame (blade) : un serveur sans alimentation ni ventilation propres, glissé dans un châssis qui les fournit à toutes les lames."},
"iBMC":{c:"Matériel",d:"La carte d'administration intégrée au serveur (iDRAC ou iLO chez d'autres constructeurs) : allumer, éteindre, voir l'écran et les alarmes matérielles à distance, même système planté."},
"Bonding":{c:"Matériel",d:"Le regroupement de deux ports réseau d'un serveur en une seule liaison logique, souvent vers deux switchs différents : un câble ou un switch peut tomber sans couper le serveur."},
"RAID":{c:"Matériel",d:"Le regroupement de disques pour survivre aux pannes : RAID 1 (miroir), RAID 5 (survit à un disque), RAID 6 (à deux), RAID 10 (miroir et répartition)."},
"SAN":{c:"Matériel",d:"Storage Area Network : un stockage partagé qui fournit des disques virtuels (LUN) en mode bloc aux serveurs."},
"NAS":{c:"Matériel",d:"Network Attached Storage : un stockage partagé qui fournit des dossiers (par exemple en NFS)."},
"LUN":{c:"Matériel",d:"Un disque virtuel découpé dans une baie de stockage SAN et présenté à un serveur."},
"Hyperviseur":{c:"Matériel",d:"Le logiciel qui découpe un serveur physique en plusieurs machines virtuelles."},
"Fibre optique":{c:"Matériel",d:"Un câble qui transporte la lumière : plus loin et plus vite que le cuivre."},
"Multimode":{c:"Matériel",d:"La fibre des courtes distances (100 à 400 m), gaine souvent turquoise (OM3) ou violette (OM4)."},
"Monomode":{c:"Matériel",d:"La fibre des longues distances (des kilomètres), gaine souvent jaune (OS2)."},
"Module optique":{c:"Matériel",d:"La cartouche (SFP, SFP+, SFP28, QSFP28…) qui fait le lien entre la fibre et le port. Sa taille dit la vitesse : 1G, 10G, 25G, 100G."},
"LACP":{c:"Réseau",d:"Le protocole qui regroupe plusieurs ports en un seul lien logique (Eth-Trunk chez Huawei) : plus de débit, et le lien survit à la perte d'un port."},
"ToR":{c:"Réseau",d:"Top of Rack : le switch en haut de la baie, qui relie les serveurs de la baie au réseau. C'est généralement un leaf."},
"Leaf":{c:"Réseau",d:"Le switch d'accès du réseau leaf-spine : les serveurs s'y branchent, et il est relié à tous les spines."},
"Spine":{c:"Réseau",d:"Le switch de cœur du réseau leaf-spine : aucun serveur, il relie tous les leafs entre eux."},
"Border leaf":{c:"Réseau",d:"Le leaf qui relie le réseau du data center à l'extérieur : pare-feux, routeurs, internet, l'autre data center."},
"ECMP":{c:"Réseau",d:"Equal-Cost Multi-Path : le trafic est réparti sur plusieurs chemins de même coût en même temps. Si un chemin tombe, les autres prennent le relais."},
"Sursouscription":{c:"Réseau",d:"Le rapport entre la capacité vers les serveurs et la capacité vers le cœur. 1,5:1 = si tout le monde émet à fond, il manque un tiers."},
"M-LAG":{c:"Réseau",d:"Deux switchs qui se présentent comme un seul à un serveur (ou à un autre switch) : le serveur se branche sur les deux, et survit à la perte de l'un."},
"Underlay":{c:"Réseau",d:"Le réseau physique qui relie les switchs (liens IP routés)."},
"Overlay":{c:"Réseau",d:"Les réseaux virtuels construits par-dessus le réseau physique, sans toucher aux câbles."},
"VLAN":{c:"Réseau",d:"Un réseau local virtuel, identifié par un numéro (jusqu'à 4 094). Port access = un VLAN ; port trunk = plusieurs."},
"VXLAN":{c:"Réseau",d:"Des réseaux virtuels transportés dans des tunnels entre leafs, jusqu'à 16 millions d'identifiants."},
"EVPN":{c:"Réseau",d:"L'extension de BGP qui dit à chaque leaf où se trouve chaque machine dans les réseaux VXLAN."},
"BGP":{c:"Réseau",d:"Le protocole de routage qui échange les chemins entre routeurs (et entre leafs et spines)."},
"VRF":{c:"Réseau",d:"Une table de routage séparée dans un même équipement : on isole production, gestion et partenaires."},
"Pare-feu":{c:"Réseau",d:"L'équipement qui filtre le trafic selon des règles : qui peut parler à qui, sur quel port. Toujours en paire (actif, veille)."},
"VIP":{c:"Réseau",d:"Une adresse IP virtuelle exposée par un répartiteur de charge ou un cluster, derrière laquelle plusieurs serveurs répondent."},
"IPSec":{c:"Réseau",d:"Des tunnels chiffrés entre deux sites ou avec un partenaire (banque), à travers un réseau non sûr."},
"DCI":{c:"Réseau",d:"Data Center Interconnect : les liens (souvent des fibres dédiées) entre deux data centers, qui portent la réplication."},
"Port logique":{c:"Réseau",d:"Un numéro de 0 à 65 535 qui dit à quel programme s'adresse un message arrivé sur une adresse IP : 22 SSH, 443 HTTPS, 2181 ZooKeeper…",a:"La porte de l'appartement, quand l'adresse IP est celle de l'immeuble."},
"Smart hands":{c:"Data center",d:"Le technicien sur place, au data center, qui intervient à la demande : changer une pièce, rebrancher une fibre, lire une étiquette."},
"RMA":{c:"Data center",d:"Le retour matériel : la procédure du constructeur pour remplacer une pièce en panne."},
"BFD":{c:"Réseau",d:"Bidirectional Forwarding Detection : détecte en quelques millisecondes qu'un voisin réseau ne répond plus. Alarme typique : hwBfdSessFaultDown."},
"HRP":{c:"Réseau",d:"Le mécanisme de secours entre deux pare-feux jumeaux (actif et veille), reliés par un battement de cœur. Alarmes typiques : hwHrpHeartChange, hwHrpEscape."},
"NSLB":{c:"Réseau",d:"Le répartiteur de charge de la plateforme : il expose une adresse virtuelle (VIP) et répartit les requêtes entre plusieurs serveurs."}
};

var DC=[
{id:"n1",t:"Le data center en un coup d'œil",cards:[
 {i:"Building2",h:"Une usine à faire tourner des serveurs",p:["Un [[Data center|data center]] est un bâtiment conçu pour une seule chose : faire fonctionner des milliers de serveurs sans interruption. Il leur apporte trois choses en continu : de l'électricité, du froid et du réseau, le tout derrière des contrôles d'accès stricts.","Mobile Money 2.0 tourne dans deux data centers de la même ville (les deux zones de l'actif-actif), plus un site de secours. Quand une alarme parle d'un pare-feu, d'une alimentation ou d'une fibre, elle parle de ce monde physique."]},
 {i:"Layers",h:"Du bâtiment au port",p:[D(F(B("Bâtiment","",'n'),B("Salle","",'b'),B("Rangée","",'v'),B("Baie","",'o'),B("Équipement","serveur, switch…",'g'),B("Port","",'a'))),"Chaque équipement a une adresse physique précise : salle, rangée, baie, position dans la baie (en U), et port. C'est ce que le technicien sur place demande pour intervenir : sans elle, il cherche dans des centaines de baies."]},
 {w:"sim_room"},
 {i:"ShieldCheck",h:"Les niveaux de fiabilité (Tier)",p:[D(TB(["Niveau","Ce qu'il garantit","Disponibilité visée"],[["Tier I","un seul chemin, pas de redondance","99,671 %"],["Tier II","des équipements en double","99,741 %"],["Tier III","maintenance sans coupure","99,982 %"],["Tier IV","résiste à une panne sur n'importe quel élément","99,995 %"]],2)),"Le classement [[Tier]] dit ce que le bâtiment encaisse. En Tier III, on peut arrêter n'importe quel équipement pour maintenance sans couper les serveurs. En Tier IV, une panne imprévue sur n'importe quel élément ne coupe rien."]},
 {q:"Quelle est la différence clé entre un Tier III et un Tier IV ?",o:["Le Tier IV est plus grand","Le Tier III permet la maintenance sans coupure ; le Tier IV résiste en plus à une panne imprévue","Le Tier IV n'a pas besoin de groupe électrogène"],a:1,e:"Tier III : maintenable sans coupure. Tier IV : tolérant aux pannes, chaque chemin est doublé et actif."},
 {i:"Gauge",h:"Le PUE",p:["Le [[PUE]] mesure l'efficacité énergétique : l'énergie totale du bâtiment divisée par l'énergie consommée par les équipements informatiques. Un PUE de 1,5 veut dire que pour 1 kW de serveurs, on dépense 0,5 kW en froid, éclairage et pertes électriques.","Les data centers modernes visent entre 1,2 et 1,6."]},
 {q:"Un équipement est noté « DC2 · salle 3 · B07 · U24 ». Que donne cette adresse ?",o:["Son adresse IP","Où le trouver physiquement : data center, salle, baie B07, à la hauteur U24","Son numéro de série"],a:1,e:"C'est l'adresse physique que l'on transmet au technicien du site."},
 {q:"Un data center a un PUE de 2. Qu'est-ce que ça veut dire ?",o:["Il a deux salles","Pour 1 kW consommé par les serveurs, il en consomme 1 de plus en froid et en pertes","Il est deux fois plus fiable"],a:1,e:"PUE = énergie totale ÷ énergie informatique : 2 kW au total pour 1 kW utile."},
 {r:["Un data center apporte électricité, froid, réseau et sécurité, sans interruption.","Adresse physique : salle, rangée, baie, U, port.","Tier III = maintenance sans coupure ; Tier IV = tolérant aux pannes."]}
]},
{id:"n2",t:"La baie (rack)",cards:[
 {i:"Server",h:"Une armoire standard",p:["La [[Baie|baie]] (rack en anglais) est l'armoire métallique où l'on fixe les équipements. Le format standard fait 19 pouces de large pour les équipements (environ 60 cm d'armoire), 1 m à 1,2 m de profondeur et le plus souvent 42 [[U (unité)|U]] de haut, soit environ 2 m.","Un [[U (unité)|U]] vaut 44,45 mm. Un serveur fait 1U ou 2U, un switch 1U, une baie de stockage 2U à 4U par tiroir."]},
 {w:"sim_rack"},
 {i:"Plug",h:"Deux alimentations par baie",p:["Sur les côtés, deux bandeaux de prises : les [[PDU]] A et B. Chacun est alimenté par une chaîne électrique différente. Chaque serveur a deux blocs d'alimentation, un branché sur A, l'autre sur B.","Si la chaîne A tombe, tout continue sur B. C'est la règle d'or : ne jamais brancher les deux alimentations d'un équipement sur le même PDU."]},
 {q:"Un technicien branche les deux alimentations d'un serveur sur le PDU A. Quel est le risque ?",o:["Aucun","Si la chaîne A tombe, le serveur s'arrête alors qu'il aurait dû survivre","Le serveur consomme deux fois plus"],a:1,e:"La redondance A/B ne protège que si chaque alimentation est sur une voie différente."},
 {i:"Rows3",h:"En haut de la baie",p:["Souvent, en haut : le [[Panneau de brassage|panneau de brassage]], où arrivent les câbles venus des autres baies, puis les deux switchs [[ToR]] (Top of Rack), qui relient tous les serveurs de la baie au réseau. Un petit switch de gestion relie les cartes d'administration ([[iBMC]]) des serveurs.","Les emplacements vides sont fermés par des [[Panneau d'obturation|panneaux d'obturation]] : sans eux, l'air chaud de l'arrière revient devant et réchauffe les équipements."]},
 {i:"Tag",h:"L'étiquetage",p:["Chaque baie, chaque équipement et chaque câble porte une étiquette : nom de la baie (par exemple B07 dans la rangée B), position en U, et pour un câble, ses deux extrémités.","Quand une alarme cite un port, le technicien retrouve le câble grâce à ces étiquettes. Une baie mal étiquetée, c'est une intervention qui prend une heure au lieu de cinq minutes, et le risque de débrancher le mauvais câble."]},
 {q:"Combien d'équipements de 2U peut-on mettre, au plus, dans 10U libres ?",o:["2","5","10"],a:1,e:"10 ÷ 2 = 5 équipements, s'il reste assez de puissance électrique et de froid."},
 {q:"Une baie compte plusieurs U vides. Que faut-il y mettre ?",o:["Rien","Des panneaux d'obturation","Des câbles de réserve"],a:1,e:"Ils empêchent l'air chaud de revenir vers l'avant."},
 {r:["Baie standard : 19 pouces, 42U (1U = 44,45 mm).","PDU A et PDU B sur deux chaînes différentes, une alimentation sur chacun.","En haut : brassage, switchs ToR, gestion ; panneaux d'obturation dans les vides."]}
]},
{id:"n3",t:"Électricité et refroidissement",cards:[
 {i:"Zap",h:"La chaîne électrique",p:[D(F(B("Réseau électrique","",'n'),B("Inverseur (ATS)","choisit la source",'v'),B("Onduleur (UPS)","batteries",'o'),B("PDU A / PDU B","dans la baie",'b'),B("Serveur","2 alimentations",'g')),N("Le groupe électrogène est branché sur l'inverseur : il prend le relais du réseau.")),"Le courant arrive du réseau, passe par un [[ATS|inverseur de source]], puis par un [[Onduleur|onduleur]] qui le lisse et le garde en réserve dans ses batteries, avant d'atteindre les PDU des baies."]},
 {w:"sim_power"},
 {i:"Timer",h:"La coupure secteur, seconde par seconde",p:["À 0 s, le réseau tombe : les onduleurs prennent le relais sur batteries, sans la moindre micro-coupure pour les serveurs.","Vers 10 à 15 s, le [[Groupe électrogène|groupe électrogène]] a démarré ; l'inverseur bascule dessus. Les batteries ne servent qu'à tenir ce court moment (en général quelques minutes d'autonomie). Le groupe tient ensuite tant qu'il a du carburant."]},
 {q:"Pendant une coupure du réseau électrique, qui alimente les serveurs dans les toutes premières secondes ?",o:["Le groupe électrogène","Les batteries des onduleurs","Personne : les serveurs redémarrent"],a:1,e:"Le groupe met quelques secondes à démarrer : ce sont les onduleurs qui font la jonction, sans coupure."},
 {i:"Layers",h:"N+1 et 2N",p:["[[N+1]] : on installe un équipement de plus que nécessaire (4 climatiseurs pour un besoin de 3). Une panne est absorbée.","[[2N]] : on double tout, deux chaînes complètes et indépendantes (A et B). C'est ce qu'on fait pour l'électricité des baies critiques."]},
 {i:"Thermometer",h:"Allées froides et allées chaudes",p:["Les baies sont alignées face à face. Devant, l'[[Allée froide|allée froide]] : l'air froid sort du faux plancher ou des climatiseurs de rangée, les équipements l'aspirent par l'avant. Derrière, l'[[Allée chaude|allée chaude]] : l'air réchauffé ressort et repart vers les climatiseurs ([[CRAH]]).","On vise un air d'entrée entre 18 et 27 °C. Mélanger le chaud et le froid, c'est gaspiller de l'énergie et risquer des surchauffes."]},
 {q:"Pourquoi fermer les U vides d'une baie avec des panneaux d'obturation ?",o:["Pour la décoration","Pour éviter que l'air chaud de l'arrière revienne vers l'avant et réchauffe les équipements","Pour empêcher le vol"],a:1,e:"Un trou dans la baie crée un court-circuit d'air : l'air chaud est réaspiré par l'avant."},
 {i:"Bell",h:"Ce que ça donne en alarmes",p:["hwPowerInvalid sur un pare-feu : une de ses alimentations est en panne. L'équipement tourne sur l'autre, mais la redondance est perdue. On le signale aux équipes du site, sans attendre la seconde panne.","Une température d'entrée qui monte sur plusieurs équipements d'une même rangée oriente vers le refroidissement, pas vers les serveurs."]},
 {q:"Une salle a besoin de 6 climatiseurs. Combien en faut-il pour être en N+1 ?",o:["6","7","12"],a:1,e:"N+1 = le besoin plus un. 12 serait du 2N."},
 {q:"Le groupe électrogène ne démarre pas lors d'une coupure. Que se passe-t-il ?",o:["Rien, les onduleurs tiennent indéfiniment","Les onduleurs tiennent tant que leurs batteries durent, souvent quelques minutes, puis tout s'arrête","Les serveurs passent sur la voie B"],a:1,e:"Les batteries ne font que la jonction : sans groupe, l'autonomie est courte. C'est une urgence absolue."},
 {r:["Réseau → inverseur → onduleur → PDU A/B → serveur ; groupe en secours.","Batteries pour les secondes, groupe pour les heures.","Allée froide devant, allée chaude derrière ; 18 à 27 °C en entrée."]}
]},
{id:"n4",t:"Serveurs, stockage et virtualisation",cards:[
 {i:"Server",h:"Le serveur",p:["Un serveur rack, c'est un ordinateur à plat de 1U ou 2U : processeurs, mémoire, disques, cartes réseau et deux alimentations. Les serveurs lames ([[Lame|blades]]) partagent un châssis commun qui fournit alimentation, ventilation et réseau.","À l'arrière, chaque serveur a une prise spéciale : l'[[iBMC]] (sur d'autres marques, iDRAC ou iLO), une petite carte d'administration indépendante. Elle permet d'allumer, d'éteindre, de voir l'écran du serveur ou ses alarmes matérielles à distance, même si le système est planté."]},
 {i:"Network",h:"Deux cartes, deux switchs",p:[D(F(B("Serveur","port 1 + port 2",'n')),C(P("Port 1","b",["vers le switch ToR A"]),P("Port 2","b",["vers le switch ToR B"])),N("Les deux ports forment une seule liaison logique (bonding). Un câble ou un switch peut tomber sans couper le serveur.")),"On relie chaque serveur aux deux switchs de la baie, et on regroupe ses deux ports en une seule liaison logique ([[Bonding|bonding]]). Côté switchs, la paire en [[M-LAG]] se présente au serveur comme un seul équipement."]},
 {i:"HardDrive",h:"Le stockage",p:["Les disques sont regroupés en [[RAID]] pour survivre à la panne d'un disque : RAID 1 (miroir, deux copies), RAID 5 (une parité, survit à un disque), RAID 6 (deux parités, survit à deux), RAID 10 (miroir et répartition).","Les baies de stockage partagées se présentent en deux familles : le [[SAN]], qui fournit des disques virtuels ([[LUN]]) en mode bloc, et le [[NAS]], qui fournit des dossiers partagés (NFS, par exemple le serveur NFS de MM 2.0)."]},
 {q:"Une grappe en RAID 5 perd un disque. Que se passe-t-il ?",o:["Les données sont perdues","Les données restent accessibles ; il faut remplacer le disque avant une deuxième panne","Le serveur s'arrête"],a:1,e:"RAID 5 survit à un disque. Pendant la reconstruction, une deuxième panne serait fatale : on remplace vite."},
 {i:"Boxes",h:"Du serveur physique au pod",p:[D(F(B("Serveur physique","osnpr1-gsu-app-host8",'n'),B("Système et Kubernetes","",'v'),B("Des dizaines de pods","licensecenter, cas…",'g'))),"Dans les alarmes de MM 2.0, le nom entre parenthèses (osnpr1-gsu-app-host8) est souvent le serveur physique, ou la machine virtuelle, qui héberge le pod. Quand plusieurs services tombent en même temps sur le même hôte, on regarde la machine avant les services.","Entre le matériel et les pods, il peut y avoir un [[Hyperviseur|hyperviseur]], qui découpe un serveur en machines virtuelles."]},
 {q:"Dix pods de services différents s'isolent en même temps, tous sur osnpr1-gsu-app-host8. Où regarder d'abord ?",o:["Le code de chaque service","L'hôte lui-même : matériel, réseau, ressources","La configuration Apollo"],a:1,e:"Le point commun est la machine : une panne matérielle, réseau ou de ressources sur l'hôte touche tous ses pods."},
 {q:"Un serveur est planté, plus rien ne répond par le réseau de production. Comment l'équipe peut-elle quand même le redémarrer à distance ?",o:["Par son iBMC, sur le réseau de gestion","En débranchant le PDU","Par Kafka"],a:0,e:"L'iBMC est indépendante du système : elle permet d'allumer, éteindre ou voir l'écran du serveur."},
 {q:"Quelle différence entre un SAN et un NAS ?",o:["Aucune","Le SAN fournit des disques virtuels (blocs), le NAS des dossiers partagés (fichiers)","Le NAS est plus rapide"],a:1,e:"SAN : des LUN que le serveur formate comme ses propres disques. NAS : des partages de fichiers, en NFS par exemple."},
 {q:"Une grappe RAID 6 perd deux disques en même temps. Les données sont-elles perdues ?",o:["Oui","Non, le RAID 6 survit à deux disques","Seulement la moitié"],a:1,e:"RAID 6 a deux parités : il tient deux pannes. Une troisième serait fatale."},
 {r:["Serveur 1U/2U, deux alimentations, une carte iBMC pour le gérer à distance.","Deux ports vers deux switchs, regroupés en bonding.","RAID contre la panne de disque ; SAN = blocs (LUN), NAS = fichiers."]}
]},
{id:"n5",t:"Câbles, optiques et ports physiques",cards:[
 {i:"Link",h:"Cuivre ou fibre",p:[D(TB(["Câble","Distance","Usage"],[["Cuivre RJ45","jusqu'à 100 m","gestion, 1G, 10G"],["DAC (cuivre direct)","quelques mètres","serveur ↔ switch dans la même baie"],["Fibre multimode","100 à 400 m","entre baies d'une salle"],["Fibre monomode","des kilomètres","entre salles, entre data centers"]],1)),"Le cuivre est bon marché et court. La [[Fibre optique|fibre]] porte plus loin et plus vite : la [[Multimode|multimode]] (gaine turquoise ou violette) pour les courtes distances, la [[Monomode|monomode]] (gaine jaune) pour les longues."]},
 {i:"CircleDot",h:"Le module optique",p:["Une fibre ne se branche pas directement dans un switch : elle entre dans un [[Module optique|module optique]] (SFP, SFP+, SFP28, QSFP28…), une petite cartouche qui transforme la lumière en signal électrique.","La taille dit la vitesse : SFP 1G, SFP+ 10G, SFP28 25G, QSFP28 100G, QSFP-DD 400G. Le module et la fibre doivent correspondre (multimode avec multimode, même longueur d'onde aux deux bouts)."]},
 {w:"sim_port"},
 {i:"Hash",h:"Lire un nom de port",p:[D(S(["10GE","vitesse et type","b"],["1","carte / emplacement","v"],["/0","sous-carte","o"],["/17","numéro du port","g"])),"Sur un équipement Huawei, GE0/0/15 se lit : port GigabitEthernet, emplacement 0, sous-carte 0, port 15. 10GE0/0/17 est un port 10 Gbit/s. Un Eth-Trunk est un regroupement de plusieurs ports en un seul lien logique ([[LACP]])."]},
 {q:"Une alarme cite « 10GE0/0/17 » sur pr2_internal_fw_02. Qu'est-ce que c'est ?",o:["Une adresse IP","Le port physique n° 17 (10 Gbit/s) du pare-feu interne n° 2 du centre pr2","Un numéro de ticket"],a:1,e:"Nom d'équipement + nom de port = l'endroit exact où le technicien doit regarder."},
 {i:"TriangleAlert",h:"Les alarmes d'optique",p:["hwOpticalInvalid : le module optique est en panne ou mal inséré.","hwOpticalUnAuthorized : le module n'est pas reconnu comme certifié par le constructeur ; il peut fonctionner, mais sans garantie.","hwLocalFaultAlarm : le port voit un défaut sur le lien (fibre coupée ou sale, module défaillant, mauvais type de fibre)."]},
 {i:"Rows3",h:"Le brassage",p:["Entre les baies, les câbles ne vont pas d'équipement à équipement : ils arrivent sur des [[Panneau de brassage|panneaux de brassage]], et de courtes [[Jarretière|jarretières]] relient le panneau au port. Changer une connexion, c'est déplacer une jarretière, sans retirer de câble dans le faux plancher."]},
 {q:"Il faut relier deux salles distantes de 2 km. Quel câble ?",o:["Cuivre RJ45","Fibre multimode","Fibre monomode"],a:2,e:"Au-delà de quelques centaines de mètres, seule la monomode porte le signal."},
 {q:"Un port 100G attend un module. Lequel ?",o:["SFP","SFP+","QSFP28"],a:2,e:"SFP 1G, SFP+ 10G, SFP28 25G, QSFP28 100G."},
 {q:"Un Eth-Trunk de deux ports perd l'un d'eux. Que devient le lien ?",o:["Il est coupé","Il reste en place, avec moitié moins de débit","Il double de vitesse"],a:1,e:"C'est l'intérêt de LACP : le lien logique survit à la perte d'un membre."},
 {r:["Cuivre pour le court, fibre multimode pour la salle, monomode pour la distance.","La fibre entre dans un module optique ; sa taille dit la vitesse.","GE0/0/15 = type, emplacement, sous-carte, port ; Eth-Trunk = plusieurs ports en un."]}
]},
{id:"n6",t:"Le réseau leaf-spine",cards:[
 {i:"Network",h:"Pourquoi pas une pyramide ?",p:[D(C(P("Ancien modèle à trois étages","o",["accès → agrégation → cœur","un chemin principal, des liens bloqués","congestion au sommet"]),P("Leaf-spine","g",["chaque leaf relié à chaque spine","tous les chemins actifs","toujours 2 sauts entre deux serveurs"]))),"Les anciens réseaux de data center étaient des pyramides à trois étages, avec des liens de secours inactifs. Le trafic entre serveurs (est-ouest) y passait par le sommet. Le modèle [[Leaf|leaf]]-[[Spine|spine]] est plat : chaque switch d'accès (leaf) est relié à chaque switch de cœur (spine)."]},
 {w:"sim_fabric"},
 {i:"Waypoints",h:"Leaf, spine, border leaf",p:["Le [[Leaf|leaf]] est le switch qui reçoit les serveurs : c'est souvent le [[ToR]] de la baie. Le [[Spine|spine]] ne reçoit aucun serveur, il relie les leafs entre eux. Le [[Border leaf|border leaf]] est un leaf spécial qui relie le réseau du data center à l'extérieur : pare-feux, routeurs, internet, l'autre data center.","Certains réseaux ont aussi des service leafs, où sont branchés les répartiteurs de charge et les pare-feux internes."]},
 {q:"Sur quel switch branche-t-on les pare-feux et les routeurs qui mènent vers l'extérieur ?",o:["Sur un spine","Sur un border leaf","Directement sur les serveurs"],a:1,e:"Le border leaf est la porte du réseau du data center vers l'extérieur."},
 {i:"Shuffle",h:"ECMP : tous les chemins en même temps",p:["Entre deux leafs, il y a autant de chemins que de spines. Avec l'[[ECMP]], le trafic est réparti sur tous ces chemins à la fois.","Si un spine tombe, les leafs retirent ce chemin en quelques millisecondes et continuent sur les autres, avec un peu moins de capacité. Pour grandir, on ajoute des spines (plus de bande passante) ou des leafs (plus de ports)."]},
 {i:"Gauge",h:"La sursouscription",p:["Un leaf de 48 ports à 25 Gbit/s vers les serveurs (1 200 Gbit/s) avec 8 liens à 100 Gbit/s vers les spines (800 Gbit/s) a une [[Sursouscription|sursouscription]] de 1,5:1. Si tous les serveurs émettaient à fond en même temps, il manquerait un tiers de la capacité.","C'est un choix de conception normal, à connaître pour comprendre une saturation."]},
 {q:"Un spine tombe dans un réseau qui en compte quatre. Que se passe-t-il ?",o:["Tous les serveurs sont coupés","Le trafic passe par les trois autres, avec environ 25 % de capacité en moins","Seuls les border leafs sont touchés"],a:1,e:"Grâce à l'ECMP, chaque leaf continue sur les spines restants."},
 {q:"Dans un leaf-spine, combien de sauts de switch entre deux serveurs sur deux leafs différents ?",o:["Un","Deux (leaf, spine, leaf)","Ça dépend de la distance"],a:1,e:"Leaf → spine → leaf, toujours. C'est ce qui rend les temps de réponse prévisibles."},
 {q:"On manque de ports pour brancher de nouveaux serveurs. Qu'ajoute-t-on ?",o:["Des spines","Des leafs","Des border leafs"],a:1,e:"Les leafs portent les serveurs. Les spines, eux, ajoutent de la bande passante entre leafs."},
 {r:["Leaf = accès des serveurs ; spine = relie les leafs ; border leaf = sortie vers l'extérieur.","Chaque leaf est relié à chaque spine : deux sauts entre deux serveurs.","ECMP : tous les chemins actifs ; un spine en panne = moins de capacité, pas de coupure."]}
]},
{id:"n7",t:"Sous le capot : VLAN, VXLAN et routage",cards:[
 {i:"Layers",h:"Deux réseaux superposés",p:[D(GR(170,P("L'underlay","n",["le réseau physique","des liens IP routés entre leafs et spines","il ne connaît que les switchs"]),P("L'overlay","v",["des réseaux virtuels par-dessus","tunnels VXLAN entre leafs","il connaît les machines et les applications"]))),"Le réseau physique ([[Underlay|underlay]]) se contente de relier les switchs entre eux. Par-dessus, on crée des réseaux virtuels ([[Overlay|overlay]]) pour les applications, sans toucher aux câbles."]},
 {i:"Tag",h:"VLAN et VXLAN",p:["Un [[VLAN]] découpe un réseau local en sous-réseaux isolés, chacun avec un numéro (jusqu'à 4 094). Un port peut être en mode access (un seul VLAN, pour un serveur) ou trunk (plusieurs VLAN, entre switchs).","Le [[VXLAN]] fait la même chose à l'échelle d'un data center entier : il emballe le trafic dans des tunnels entre leafs, avec jusqu'à 16 millions de réseaux virtuels. L'[[EVPN]] (une extension de [[BGP]]) dit à chaque leaf où se trouve chaque machine."]},
 {q:"Pourquoi utiliser VXLAN plutôt que de simples VLAN dans un grand data center ?",o:["Parce que les VLAN sont plus lents","Pour dépasser la limite de 4 094 réseaux et étendre un réseau virtuel sur tous les leafs","Parce que VXLAN n'a pas besoin de switch"],a:1,e:"VXLAN offre 16 millions d'identifiants et transporte les réseaux virtuels au-dessus d'un réseau routé."},
 {i:"LockKeyhole",h:"VRF : des tables séparées",p:["Une [[VRF]] est une table de routage séparée dans un même équipement. On isole ainsi la production, la gestion et les partenaires, même s'ils partagent les mêmes switchs."]},
 {i:"Waypoints",h:"Le routage",p:["Entre les sous-réseaux, ce sont des routeurs (ou les leafs eux-mêmes) qui décident du chemin, avec des protocoles comme [[BGP]] ou OSPF. [[BFD]] surveille les liens et prévient le routage en quelques millisecondes si un voisin ne répond plus : c'est l'alarme hwBfdSessFaultDown que l'on voit sur les pare-feux."]},
 {q:"Un port de switch doit transporter plusieurs VLAN vers un autre switch. Quel mode ?",o:["Access","Trunk","Console"],a:1,e:"Access : un VLAN, pour un serveur. Trunk : plusieurs VLAN, entre switchs."},
 {r:["Underlay = réseau physique ; overlay = réseaux virtuels par-dessus.","VLAN : 4 094 réseaux ; VXLAN : 16 millions, en tunnels entre leafs.","VRF isole ; BGP route ; BFD détecte vite une coupure."]}
]},
{id:"n8",t:"La sortie : pare-feux, répartiteurs, autre data center",cards:[
 {i:"Map",h:"Le chemin d'une requête client",p:[D(F(B("Client USSD","",'n'),B("Opérateur","",'n'),B("Routeur","",'o'),B("Pare-feu internet","",'r'),B("DMZ : répartiteur","NSLB, VIP",'v'),B("Pare-feu interne","",'r'),B("Leaf","",'b'),B("Serveur","pod Super Gateway",'g'))),"Une requête traverse plusieurs équipements avant d'atteindre un service. Chaque étape peut lever une alarme : savoir où elle se situe sur ce chemin aide à comprendre ce qui est coupé."]},
 {w:"sim_path"},
 {i:"BrickWall",h:"Les pare-feux par paires",p:["Les [[Pare-feu|pare-feux]] filtrent le trafic selon des règles (qui peut parler à qui, sur quel port). Il y a les pare-feux internet, côté extérieur, et les pare-feux internes, entre les zones.","Ils vont par deux, l'un actif, l'autre en veille, reliés par [[HRP]]. hwHrpHeartChange ou hwHrpEscape signalent un souci sur ce lien de secours : la paire tourne, mais une bascule pourrait mal se passer."]},
 {i:"Shuffle",h:"Répartiteur et adresse virtuelle",p:["Le répartiteur de charge ([[NSLB]]) expose une adresse virtuelle ([[VIP]]) et répartit les requêtes entre plusieurs serveurs. Le client ne connaît que la VIP ; si un serveur tombe, le répartiteur ne lui envoie plus rien."]},
 {i:"LockKeyhole",h:"Les tunnels vers les partenaires",p:["Avec les banques et certains partenaires, le trafic passe dans des tunnels chiffrés [[IPSec]] montés entre pare-feux. hwIPSecTunnelStop signale un tunnel coupé ; hwIPSecTunnelStart et hwIKESaPhase1Establish signalent son rétablissement."]},
 {i:"Building2",h:"Entre les deux data centers",p:["Les deux data centers de l'actif-actif sont reliés par des fibres dédiées ([[DCI]]). La lumière met environ 5 microsecondes par kilomètre de fibre : à 40 km, on reste à quelques millisecondes aller-retour avec les équipements, assez pour répliquer les bases en continu.","Une coupure de ce lien est critique : les deux centres ne peuvent plus se copier."]},
 {q:"hwIPSecTunnelStop puis, quelques minutes après, hwIPSecTunnelStart. Que s'est-il passé ?",o:["Rien de grave, un test","Un tunnel chiffré vers un partenaire est tombé puis s'est rétabli : à noter, et à surveiller s'il recommence","Le pare-feu a été remplacé"],a:1,e:"Stop puis Start : coupure et rétablissement. Si ça se répète, le lien avec le partenaire est instable."},
 {q:"Le lien entre les deux data centers (DCI) est coupé, mais chaque site fonctionne. Pourquoi est-ce grave ?",o:["Ce n'est pas grave","Les deux sites ne peuvent plus se copier : une panne d'un site entraînerait une perte de données","Les clients ne peuvent plus se connecter"],a:1,e:"Sans DCI, plus de réplication : le filet de sécurité de l'actif-actif a disparu."},
 {q:"Le client appelle l'adresse 10.30.197.20 et c'est un serveur différent qui répond à chaque fois. Qu'est-ce que cette adresse ?",o:["Une adresse virtuelle (VIP) d'un répartiteur de charge","Une erreur de configuration","L'adresse du pare-feu"],a:0,e:"La VIP est partagée : le répartiteur distribue les requêtes entre plusieurs serveurs."},
 {r:["Client → routeur → pare-feu → DMZ (VIP) → pare-feu → leaf → serveur.","Pare-feux en paire (HRP) ; tunnels IPSec vers les partenaires.","Le DCI relie les deux data centers ; sans lui, plus de réplication."]}
]},
{id:"n9",t:"Les ports logiques",cards:[
 {i:"DoorOpen",h:"Un port physique, des milliers de portes",p:["Attention, le mot « port » a deux sens. Le port physique est une prise sur un équipement. Le [[Port logique|port logique]] est un numéro (de 0 à 65 535) qui dit à quel programme s'adresse un message arrivé sur une adresse IP.","Une même adresse IP peut ainsi recevoir du HTTPS sur le port 443, du SSH sur le 22 et du SNMP sur le 161."]},
 {w:"sim_lport"},
 {i:"List",h:"Les numéros à connaître",p:[D(TB(["Port","Service","Ce que c'est"],[["22","SSH","connexion d'administration"],["53","DNS","traduction de noms"],["123","NTP","l'heure exacte"],["161 / 162","SNMP","supervision / alarmes envoyées"],["443","HTTPS","portails et API"],["2181","ZooKeeper","coordination"],["9092","Kafka","messages"],["31360","DMU","agents DigitalView"]],1)),"Les ports en dessous de 1024 sont réservés aux services connus. Beaucoup d'alarmes de connexion (ZooKeeper, Kafka, base de données) viennent d'un port fermé par un pare-feu ou d'un service qui n'écoute plus."]},
 {q:"Un service n'arrive plus à joindre ZooKeeper alors que le serveur répond au ping. Qu'est-ce qui peut bloquer ?",o:["Le port 2181 est fermé ou le service ZooKeeper n'écoute plus","La fibre est coupée","Le PDU A est en panne"],a:0,e:"Le ping prouve que la machine est joignable ; c'est la porte (le port) ou le service derrière qui ne répond pas."},
 {i:"Clock",h:"Pourquoi NTP compte",p:["Tous les équipements doivent avoir la même heure (NTP, port 123). Un écart de plus de quelques minutes casse des connexions sécurisées, rend les journaux impossibles à comparer, et la fiche DigitalView de l'alarme ALM-999999999 cite justement un écart de plus de 3 minutes comme cause."]},
 {q:"Un client reçoit « connexion refusée » immédiatement en appelant un service. Que suspecter ?",o:["Le pare-feu jette le message","Aucun programme n'écoute sur ce port du serveur","La fibre est coupée"],a:1,e:"Refus immédiat = le serveur répond qu'il n'y a personne derrière ce port. Un pare-feu qui bloque donne plutôt une attente sans réponse (timeout)."},
 {r:["Port physique = une prise ; port logique = un numéro de porte sur une IP.","22 SSH, 123 NTP, 161 SNMP, 443 HTTPS, 2181 ZooKeeper, 9092 Kafka.","Ping OK mais service injoignable : regarder le port et le pare-feu."]}
]},
{id:"n10",t:"Cas : de l'alarme à la baie",cards:[
 {i:"Bell",h:"L'alarme",p:["Dans les extractions d'alarmes du site : hwOpticalInvalid, Minor, sur pr2_internet_fw_02, interface GE0/0/15. Puis hwLocalFaultAlarm sur pr2_internal_fw_02, port 10GE0/0/17, et hwPowerInvalid sur le même équipement, POWER 2."]},
 {i:"Search",h:"Lire ce qu'on sait",p:[D(TB(["Morceau","Ce qu'il dit"],[["pr2","le centre de production n° 2"],["internet_fw / internal_fw","pare-feu côté internet / côté interne"],["_02","le second de la paire"],["GE0/0/15","le port 15 (1 Gbit/s)"],["POWER 2","son alimentation n° 2"]],1)),"Sans ouvrir d'outil, on sait déjà quel équipement, quel port et quelle pièce sont en cause."]},
 {q:"hwPowerInvalid sur POWER 2, et le pare-feu fonctionne toujours. Quelle est la bonne lecture ?",o:["Tout va bien, on classe","L'équipement tourne sur sa seule alimentation restante : il faut faire remplacer POWER 2 rapidement","Il faut redémarrer le pare-feu"],a:1,e:"Redondance perdue : une seconde panne couperait l'équipement. On ne redémarre jamais un équipement de production sans l'équipe compétente."},
 {i:"ClipboardList",h:"Ce qu'on donne à l'équipe du site",p:["Le technicien sur place ([[Smart hands|smart hands]]) a besoin d'une adresse précise : data center, salle, baie, position en U, équipement, port ou pièce (ici l'alimentation 2), et la référence du module ou de la pièce si on la connaît.","S'il faut changer une pièce, le constructeur ouvre un retour matériel ([[RMA]]). Le ticket doit garder l'heure de la panne, l'impact (redondance perdue, pas de coupure) et le numéro d'intervention."]},
 {i:"ListChecks",h:"La bonne séquence",p:["1. Lire l'alarme : équipement, port, pièce, sévérité.","2. Mesurer l'impact : redondance perdue ou service touché ? Regarder les taux de succès.","3. Situer physiquement : salle, baie, U.","4. Escalader vers l'équipe réseau ou data center, avec ces informations.","5. Suivre jusqu'au remplacement et à l'effacement de l'alarme."]},
 {q:"Plusieurs alarmes d'optique et de lien sur les deux pare-feux internes du même centre, au même moment. Que suspecter en premier ?",o:["Une coïncidence","Un événement commun : intervention en cours, coupure de fibre entre salles, ou travaux sur le brassage","Un bug du service CAS"],a:1,e:"Deux équipements jumeaux touchés en même temps : on cherche ce qu'ils partagent (salle, chemin de câbles, intervention planifiée)."},
 {q:"Que faut-il donner au technicien sur place pour remplacer un module optique ?",o:["Juste le nom de l'alarme","Data center, salle, baie, U, équipement, port, et le type de module","Le numéro de ticket du client"],a:1,e:"Plus l'adresse est précise, plus l'intervention est rapide et sûre."},
 {r:["Le nom de l'alarme donne déjà équipement, port et pièce.","Adresse physique complète pour le site : salle, baie, U, équipement, port.","Redondance perdue = à traiter vite, même sans coupure."]}
]}
];

/* ── Modules ───────────────────────────────────────────────── */
var POSE={wave:'Sparkles',happy:'Trophy',think:'CircleHelp',oops:'CircleX',point:'Pin'};
function mascot(pose,icn){return '<span class="mascot illus illus-'+(pose||'wave')+'" aria-hidden="true">'+ico(icn||POSE[pose]||'Sparkles',48,1.6)+'</span>'}
// Les sessions (DC) regroupées en modules, de l'extérieur vers l'intérieur.
var M1=[DC[0],DC[2]],M2=[DC[1],DC[3]],M3=[DC[4],DC[8]],M4=[DC[5],DC[6],DC[7]],M5=[DC[9]];
var MODS=[
 {id:"M1",ic:"Building2",soft:"#D0E5F2",deep:"#17709F",t:"Le bâtiment",d:"Ce qu'apporte un data center, les niveaux Tier, le PUE, l'électricité de secours et le refroidissement.",S:M1},
 {id:"M2",ic:"Server",soft:"#E0D6F5",deep:"#6E45C9",t:"La baie et ses équipements",d:"La baie 42U, les PDU A et B, le brassage, les serveurs, le RAID, le SAN et le NAS.",S:M2},
 {id:"M3",ic:"Plug",soft:"#F3DDCA",deep:"#B85415",t:"Câbles et ports",d:"Cuivre et fibre, modules optiques, noms de ports, Eth-Trunk, et les ports logiques derrière un pare-feu.",S:M3},
 {id:"M4",ic:"Network",soft:"#CDE7DF",deep:"#16876F",t:"Le réseau",d:"Leaf-spine, border leaf, ECMP, M-LAG, VLAN et VXLAN, pare-feux, VIP, IPSec et lien entre data centers.",S:M4},
 {id:"M5",ic:"Siren",soft:"#F5D3D7",deep:"#C93A52",t:"Sur le terrain",d:"De l'alarme à la baie : lire, situer, escalader, suivre.",S:M5}
];
