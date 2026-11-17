/* ══════════════════════════════════════════════════════════════
   WIDGETS INTERACTIFS DE LA FORMATION « PROCESS ITSM »
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

W.tickets={t:'Compare les types de tickets',ic:'Ticket',D:[
 ['Incident','<b>Incident</b><p class="wmut">Le service est coupé ou dégradé.</p><p>Objectif : rétablir vite. SLA court : P1 2 h, P2 4 h (calendaire), P3 48 h, P4 72 h (ouvré).</p>'],
 ['Problem non Bug','<b>Problem non Bug</b><p class="wmut">Cause hors défaut logiciel : configuration, capacité, matériel, process, humain.</p><p>Une échéance, en jours ouvrés : P1 72 h, P2 120 h, P3 336 h, P4 1 080 h.</p>'],
 ['Problem Bug','<b>Problem Bug</b><p class="wmut">Cause : un défaut logiciel, corrigé par l\'éditeur ou la R&D.</p><p>P1 et P2 : contournement d\'abord (72 h / 120 h ouvrées), correction ensuite (14 / 28 jours calendaires).</p>'],
 ['Changement','<b>Changement</b><p class="wmut">Une modification volontaire et préparée.</p><p>Standard, normal (CAB) ou urgent. Pas un ticket d\'incident.</p>'],
 ['Demande','<b>Demande de service</b><p class="wmut">Pas de panne : un accès, un export, une information.</p><p>Circuit standard, pas de chrono d\'incident. À ne pas déguiser en incident.</p>']],
 html:function(){return wTabs(this,this.D)},bind:function(el){wTabsBind(el,this.D)}};

W.lifecycle={t:'Le parcours d\'un incident',ic:'Workflow',D:[
 ['1. Détection','Voir','L\'alarme apparaît en supervision. On la voit, on note Occur Time et Detection Time. Cible MTTD : 5 min.'],
 ['2. Enregistrement','Ouvrir','On vérifie qu\'il n\'existe pas déjà de ticket, puis on ouvre : titre clair, type, domaine, liens Alarm et Oceane.'],
 ['3. Qualification','Prioriser','Impact × urgence = priorité P1 à P4. La sévérité informe, la priorité décide du SLA.'],
 ['4. Diagnostic','Comprendre','Qu\'est-ce qui a changé ? Où ? Quoi est touché ? Erreur connue ? Ticket identique ?'],
 ['5. Escalade','Demander','Si besoin : vers le BO (fonctionnelle) et le management (hiérarchique). Le FO garde le suivi.'],
 ['6. Résolution','Rétablir','Le service revient, par correctif ou contournement. Statut Resolved, actions notées.'],
 ['7. Clôture','Fermer','Confirmation, dates, cause, Oceane aligné. Statut Closed.']],
 html:function(){return wFloors(this.D,0)},bind:function(el){wFloorsBind(el,this.D)}};

// Matrice impact × urgence : on choisit les deux, la priorité s'affiche.
W.matrix={t:'Calcule la priorité',ic:'Scale',
 I:['Faible','Moyen','Large'],U:['Faible','Moyenne','Forte'],
 P:[['P4','P4','P3'],['P3','P3','P2'],['P3','P2','P1']],
 EX:{P1:'Service majeur coupé, beaucoup d\'utilisateurs : escalade immédiate, SLA 2 h.',P2:'Impact important ou urgence forte : SLA 4 h, escalade rapide.',P3:'Impact limité : SLA 48 h ouvrées.',P4:'Gêne mineure : SLA 72 h ouvrées.'},
 html:function(){var me=this;function row(lbl,arr,k){return '<p class="wmut" style="margin:6px 0 4px">'+lbl+'</p><div class="wtabs" data-k="'+k+'">'+arr.map(function(a,i){return '<button aria-selected="'+(i===1)+'" data-i="'+i+'">'+a+'</button>'}).join('')+'</div>'}
  return row('Impact',me.I,'i')+row('Urgence',me.U,'u')+'<div class="wdet wres"></div>'},
 upd:function(el){var i=+el.querySelector('[data-k=i] [aria-selected=true]').dataset.i,u=+el.querySelector('[data-k=u] [aria-selected=true]').dataset.i,p=this.P[i][u];
  el.querySelector('.wres').innerHTML='<b>'+ico('Flag',18)+' Priorité '+p+'</b><p>'+this.EX[p]+'</p>'},
 bind:function(el){var me=this;[].forEach.call(el.querySelectorAll('.wtabs'),function(g){[].forEach.call(g.querySelectorAll('button'),function(b){b.onclick=function(e){e.stopPropagation();[].forEach.call(g.querySelectorAll('button'),function(x){x.setAttribute('aria-selected','false')});b.setAttribute('aria-selected','true');me.upd(el)}})});me.upd(el)}};

W.sla={t:'La grille SLA d\'EMOC',ic:'Timer',
 D:[
 ['Incident','<b>Incident</b><div class="wnodes"><span>P1 <small>2 h · calendaire</small></span><span>P2 <small>4 h · calendaire</small></span><span>P3 <small>48 h · ouvré</small></span><span>P4 <small>72 h · ouvré</small></span></div><p>Near Breach quand il reste moins de 20 % : 24 min pour un P1, 48 min pour un P2.</p>'],
 ['Problem non Bug','<b>Problem non Bug</b><div class="wnodes"><span>P1 <small>72 h · ouvré</small></span><span>P2 <small>120 h · ouvré</small></span><span>P3 <small>336 h · ouvré</small></span><span>P4 <small>1 080 h · ouvré</small></span></div><p>Une seule échéance.</p>'],
 ['Problem Bug','<b>Problem Bug</b><div class="wnodes"><span>P1 <small>contournement 72 h ouvré · correction 336 h calendaire</small></span><span>P2 <small>contournement 120 h ouvré · correction 672 h calendaire</small></span><span>P3 <small>672 h · calendaire</small></span><span>P4 <small>1 080 h · calendaire</small></span></div><p>La Workaround Date ferme la première échéance.</p>']],
 html:function(){return wTabs(this,this.D)+'<p class="wmut" style="margin-top:8px">Le chrono part de la Detection Time et s\'arrête pendant On Hold.</p>'},bind:function(el){wTabsBind(el,this.D)}};

// Simulateur : combien d'heures compte une journée selon le réglage.
W.clock={t:'Simulateur : ce que compte une journée',ic:'Clock',
 html:function(){return '<div class="wsim"><label class="wtog"><input type="checkbox" data-k="drill" checked><span></span>Mode drill (08:30-17:30)</label><label class="wtog"><input type="checkbox" data-k="bus"><span></span>Jours ouvrés seulement</label></div><div class="wdet wres"></div>'},
 upd:function(el){var d=el.querySelector('[data-k=drill]').checked,b=el.querySelector('[data-k=bus]').checked,h=d?9:24,sem=(b?5:7)*h;
  var p1=d?'2 h comptées entre 08:30 et 17:30 : un P1 ouvert à 17:00 tombe le lendemain à 10:00.':'2 h d\'horloge : un P1 ouvert à 17:00 tombe à 19:00.';
  el.querySelector('.wres').innerHTML='<b>'+ico('Clock',18)+' '+h+' h par jour, '+sem+' h par semaine</b><p>'+(b?'Samedi et dimanche ne comptent pas.':'Tous les jours comptent, week-end compris.')+'</p><p class="wmut">'+p1+'</p>'},
 bind:function(el){var me=this;[].forEach.call(el.querySelectorAll('input'),function(i){i.onchange=function(){me.upd(el)};i.onclick=function(e){e.stopPropagation()}});[].forEach.call(el.querySelectorAll('label'),function(l){l.onclick=function(e){e.stopPropagation()}});me.upd(el)}};

W.status={t:'Les statuts et le chrono',ic:'Hourglass',D:[
 ['Open','#2F72C4','Le chrono tourne','Ticket ouvert, pas encore pris en main. À ne pas laisser longtemps dans cet état.'],
 ['In Progress','#C9A20D','Le chrono tourne','Quelqu\'un travaille dessus. Le journal d\'actions doit avancer.'],
 ['On Hold','#6E45C9','Chrono gelé','Attente extérieure justifiée : raison, porteur, date de relance. Jamais pour une attente interne.'],
 ['Resolved','#16876F','Chrono arrêté','Service rétabli. On attend la confirmation pour fermer.'],
 ['Closed','#4A576F','Terminé','Confirmé et complet : dates, cause, Oceane aligné.']],
 html:function(){return '<div class="wsev">'+this.D.map(function(d,i){return '<button class="wsv" data-i="'+i+'" style="--c:'+d[1]+'"><span class="wsdot"></span><b>'+d[0]+'</b><small>'+d[2]+'</small><span class="wsr">'+d[3]+'</span></button>'}).join('')+'</div><p class="wmut" style="margin-top:8px">Touche un statut pour voir la règle.</p>'},
 bind:function(el){[].forEach.call(el.querySelectorAll('.wsv'),function(b){b.onclick=function(e){e.stopPropagation();b.classList.toggle('open')}})}};

W.escalation={t:'L\'échelle d\'escalade',ic:'TrendingUp',D:[
 ['Front Office (N1)','Toi','Détecte, ouvre, qualifie, fait le premier diagnostic. Garde le suivi du ticket jusqu\'à la clôture, même après escalade.'],
 ['Back Office (N2)','BO Handling','Reprend ce qui demande plus d\'expertise ou d\'accès. Renseigner BO Handling pour savoir qui relancer.'],
 ['Expert produit / éditeur','Le spécialiste','Quand le BO ne peut pas conclure, notamment pour un défaut logiciel (Problem Bug).'],
 ['Management','Escalade hiérarchique','Prévenu sur un P1, un délai menacé, un impact client fort ou un arbitrage nécessaire. S\'ajoute aux autres niveaux.']],
 html:function(){return wFloors(this.D,0)},bind:function(el){wFloorsBind(el,this.D)}};

W.major={t:'Les rôles d\'un incident majeur',ic:'Users',D:[
 ['UserCheck','Coordinateur','Il pilote','Organise le bridge, décide, fixe le rythme de communication. Il ne répare pas lui-même.'],
 ['Wrench','Experts techniques','Ils réparent','BO, experts produit : diagnostic et rétablissement. Ils rendent compte au coordinateur.'],
 ['Send','Communication','Il informe','Envoie les points réguliers (toutes les 30 min) au management et au client, chacun avec le bon niveau de détail.'],
 ['ScrollText','Scribe','Il note','Horodate chaque action et décision : la chronologie servira à la revue (PIR).']],
 html:function(){return wAcc(this.D)},bind:function(el){wAccBind(el)}};

W.whys={t:'Les 5 pourquoi, pas à pas',ic:'Microscope',D:[
 ['CircleHelp','Pourquoi 1','Le service est lent','Parce que la base de données ne répond plus assez vite.'],
 ['CircleHelp','Pourquoi 2','La base ne répond plus','Parce que le disque des journaux est plein.'],
 ['CircleHelp','Pourquoi 3','Le disque est plein','Parce que les anciens journaux ne sont plus supprimés.'],
 ['CircleHelp','Pourquoi 4','Plus de suppression','Parce que la purge planifiée a été désactivée.'],
 ['Target','Pourquoi 5','La purge désactivée','Parce qu\'une mise à jour l\'a coupée et que personne ne l\'a vérifiée après. Cause racine actionnable : ajouter ce contrôle à la check-list de fin de changement.']],
 html:function(){return wAcc(this.D)},bind:function(el){wAccBind(el)}};

W.handover={t:'Check-list de relève',ic:'ListChecks',K:[
 ['open','Tickets ouverts et prochaine étape'],['p1','P1 / P2 en cours'],['esc','Escalades en attente de retour'],['hold','Tickets On Hold et leur relance'],['obs','Consignes et points à surveiller']],
 html:function(){return '<div class="wsim" style="flex-direction:column;align-items:flex-start">'+this.K.map(function(k){return '<label class="wtog"><input type="checkbox" data-k="'+k[0]+'"><span></span>'+k[1]+'</label>'}).join('')+'</div><div class="wdet wres"></div>'},
 upd:function(el){var n=el.querySelectorAll('input:checked').length,t=this.K.length,ok=n===t,r=el.querySelector('.wres');
  r.className='wdet wres '+(ok?'ok':'');r.innerHTML='<b>'+ico(ok?'CircleCheck':'ClipboardList',18)+' '+(ok?'Handover complet':n+' / '+t+' points couverts')+'</b><p>'+(ok?'Le shift suivant peut reprendre sans rien redemander.':'Ce qui manque devra être redemandé, souvent trop tard.')+'</p>'},
 bind:function(el){var me=this;[].forEach.call(el.querySelectorAll('input'),function(i){i.onchange=function(){me.upd(el)};i.onclick=function(e){e.stopPropagation()}});[].forEach.call(el.querySelectorAll('label'),function(l){l.onclick=function(e){e.stopPropagation()}});me.upd(el)}};

// ── ITIL 4 ──
W.dims={t:"Les quatre dimensions",ic:"Compass",D:[
 ["Users","Organisations et personnes","Qui fait quoi, avec quelles compétences","Rôles, culture, compétences, façon de travailler ensemble. Chez EMOC : les shifts, le FO Owner, la relève, la formation des agents."],
 ["Server","Information et technologie","Les données et les outils","Les informations gérées et les outils qui les portent : DigitalView, OCEANE, l'outil de tickets, la base de connaissances."],
 ["Handshake","Partenaires et fournisseurs","Ceux dont on dépend","Les équipes et entreprises qui contribuent au service : le Back Office, les éditeurs, les constructeurs, les opérateurs."],
 ["Workflow","Flux de valeur et processus","Comment le travail avance","L'enchaînement des activités qui produit le résultat : de l'alarme au rétablissement, de la demande à sa livraison."]],
 html:function(){return wAcc(this.D)},bind:function(el){wAccBind(el)}};

W.principes={t:"Les sept principes, un par un",ic:"Flag",D:[
 ["Valeur","<b>Privilégier la valeur</b><p class=\"wmut\">Tout ce qu'on fait doit servir, directement ou non, le client.</p><p>Avant d'ajouter une étape ou un indicateur : qu'est-ce que le client y gagne ?</p>"],
 ["Existant","<b>Commencer là où l'on est</b><p class=\"wmut\">Observer l'existant avant de tout refaire.</p><p>Ce qui marche déjà se garde ; on mesure sur le terrain plutôt que de supposer.</p>"],
 ["Itérations","<b>Progresser par itérations, avec des retours</b><p class=\"wmut\">Avancer par petits pas, vérifier, ajuster.</p><p>Une amélioration de la relève testée sur une semaine vaut mieux qu'un grand plan jamais lancé.</p>"],
 ["Collaboration","<b>Collaborer et rendre visible</b><p class=\"wmut\">Associer les bonnes personnes et montrer le travail.</p><p>Dakar et Abidjan partagent les mêmes chiffres ; le client voit l'état de ses tickets.</p>"],
 ["Ensemble","<b>Penser et travailler de façon globale</b><p class=\"wmut\">Un service, c'est un tout.</p><p>Optimiser le FO sans regarder le BO ou le fournisseur peut dégrader le résultat final.</p>"],
 ["Simplicité","<b>Rester simple et pratique</b><p class=\"wmut\">Garder le minimum d'étapes qui produit le résultat.</p><p>Un champ que personne ne lit est un champ à supprimer.</p>"],
 ["Automatiser","<b>Optimiser, puis automatiser</b><p class=\"wmut\">D'abord rendre le travail efficace, ensuite le confier à la machine.</p><p>Automatiser une règle confuse produit juste des erreurs plus vite.</p>"]],
 html:function(){return wTabs(this,this.D)},bind:function(el){wTabsBind(el,this.D)}};

W.chaine={t:"La chaîne de valeur",ic:"Waypoints",D:[
 ["Planifier","Où va-t-on ?","Une vision partagée de l'état actuel et de la direction : objectifs, priorités, ressources. Exemple : les objectifs SLA de l'année."],
 ["Améliorer","Faire mieux","Améliorer en continu les services, les pratiques et les produits, à toutes les étapes. Exemple : une RCA et ses actions."],
 ["S'engager","La relation","Comprendre les besoins des parties prenantes, être transparent, entretenir la relation. Exemple : informer le client pendant un incident."],
 ["Concevoir et faire la transition","Préparer le service","Faire en sorte que les services répondent aux attentes de qualité, de coût et de délai. Exemple : préparer la supervision d'un nouveau site."],
 ["Obtenir / construire","Avoir les composants","Disposer des composants du service, au bon moment et conformes. Exemple : obtenir les accès et les sondes pour superviser."],
 ["Délivrer et assurer le support","Faire tourner","Fournir le service comme convenu et soutenir ses utilisateurs. Exemple : la supervision 24/7 et le traitement des incidents."]],
 html:function(){return wFloors(this.D,0)},bind:function(el){wFloorsBind(el,this.D)}};

W.chg={t:"Trois types de changements",ic:"RefreshCcw",D:[
 ["Standard","<b>Changement standard</b><p class=\"wmut\">Faible risque, bien connu, procédure écrite.</p><p>Pré-autorisé : on l'exécute sans nouvelle validation. Exemple : redémarrer un service selon la procédure.</p>"],
 ["Normal","<b>Changement normal</b><p class=\"wmut\">Il doit être planifié, évalué et autorisé.</p><p>L'autorité de changement dépend du risque : un responsable, ou un CAB pour les plus lourds.</p>"],
 ["Urgent","<b>Changement urgent</b><p class=\"wmut\">À faire au plus vite, souvent pour arrêter un incident.</p><p>Autorisation accélérée, mais toujours évaluée, tracée et revue après coup.</p>"]],
 html:function(){return wTabs(this,this.D)},bind:function(el){wTabsBind(el,this.D)}};

W.ci={t:"Le modèle d'amélioration en sept questions",ic:"TrendingUp",D:[
 ["1. Quelle est la vision ?","Le but","Relier l'amélioration aux objectifs de l'entreprise et du client."],
 ["2. Où en sommes-nous ?","Le point de départ","Mesurer la situation actuelle, chiffres à l'appui : MTTR, taux SLA, réouvertures."],
 ["3. Où voulons-nous être ?","La cible","Fixer un objectif mesurable et daté."],
 ["4. Comment y parvenir ?","Le plan","Choisir les actions, souvent par petites itérations."],
 ["5. Passer à l'action","Faire","Mettre en œuvre, en restant ouvert aux retours."],
 ["6. Avons-nous réussi ?","Vérifier","Comparer le résultat à la cible ; sinon, revenir au plan."],
 ["7. Comment garder l'élan ?","Ancrer","Partager les gains, ancrer les nouvelles habitudes, viser l'étape suivante."]],
 html:function(){return wFloors(this.D,0)},bind:function(el){wFloorsBind(el,this.D)}};

W.autres={t:"Les pratiques que le FO croise",ic:"Library",D:[
 ["Handshake","Gestion de la relation","Avec le client et les partenaires","Comprendre leurs priorités et garder une relation de confiance : points réguliers, reporting, écoute des plaintes."],
 ["Building2","Gestion des fournisseurs","Ceux dont on dépend","Choisir, suivre et piloter les fournisseurs pour qu'ils tiennent leur part du service."],
 ["LockKeyhole","Sécurité de l'information","Confidentialité, intégrité, disponibilité","Protéger les données et les accès : pas de mot de passe dans un ticket, comptes nominatifs."],
 ["HardDrive","Gestion des actifs IT","Ce qu'on possède","Suivre le cycle de vie des équipements et logiciels, de l'achat au retrait."],
 ["Network","Configuration des services","Les composants et leurs liens","Savoir de quoi un service est fait et ce qui dépend de quoi, pour mesurer l'impact d'une panne."],
 ["BookOpenText","Gestion des connaissances","Ce que l'équipe sait","Écrire et partager les solutions, les erreurs connues, les procédures, pour ne pas tout redécouvrir."],
 ["ChartColumn","Mesure et rapports","Décider avec des faits","Choisir des indicateurs utiles, les mesurer honnêtement, et s'en servir pour décider."]],
 html:function(){return wAcc(this.D)},bind:function(el){wAccBind(el)}};

/* ══════════════════════════════════════════════════════════════
   ILLUSTRATIONS DES MOTS CLÉS (GI) : une image propre à chaque mot,
   dessinée avec le kit commun (nk-kit.js).
   ══════════════════════════════════════════════════════════════ */
// Une fiche de ticket comme dans le tracker : [titre, numéro, statut, couleur].
function prTk(x,y,w,t,n,st,c){return '<g transform="translate('+x+','+y+')"><rect width="'+w+'" height="64" rx="10" fill="var(--surface)" stroke="var(--line)" stroke-width="1.5"/><rect width="6" height="64" rx="3" fill="'+c+'"/>'+giT(16,24,t,{a:'start',b:1,s:13})+giT(16,46,n,{a:'start',m:1,s:11.5,c:'var(--muted)'})+'<rect x="'+(w-84)+'" y="34" width="74" height="20" rx="10" fill="'+c+'"/>'+giT(w-47,48,st,{s:11,c:'#fff',b:1})+'</g>'}
function prIc(t,x,y,sc){return '<g transform="translate('+x+','+y+')'+(sc?' scale('+sc+')':'')+'">'+nkIcon(t)+'</g>'}
function prClock(x,y,r,frac,c){var a=frac*2*Math.PI,ex=x+r*Math.sin(a),ey=y-r*Math.cos(a);return '<circle cx="'+x+'" cy="'+y+'" r="'+r+'" fill="var(--surface2)"/><path d="M'+x+' '+y+'L'+x+' '+(y-r)+'A'+r+' '+r+' 0 '+(frac>.5?1:0)+' 1 '+ex+' '+ey+'Z" fill="'+c+'"/><circle cx="'+x+'" cy="'+y+'" r="'+(r*.55)+'" fill="var(--surface)"/>'}
GI["ITSM"]=function(){return giWrap(giSvg(420,120,['Incident','Problème','Changement','Demande'].map(function(t,i){return '<rect x="'+(16+i*100)+'" y="30" width="90" height="56" rx="12" fill="'+['#D93025','#E8840C','#3D6FD9','#1F9D6B'][i]+'"/>'+giT(61+i*100,63,t,{c:'#fff',b:1,s:12.5})}).join('')),'La gestion des services informatiques : des process clairs pour les incidents, problèmes, changements et demandes.')};
GI["Incident"]=function(){return giWrap(giSvg(420,100,prTk(40,18,340,'Transferts en échec · RSU02','TT-2026-118734','En cours','#D93025')),'Une interruption ou une dégradation du service : on le rétablit d\'abord, on cherche la cause ensuite.')};
GI["Problème"]=function(){return giWrap(giSvg(420,150,prTk(40,10,340,'Problème : coupures répétées RSU02','PB-2026-0412','Analyse','#E8840C')+[0,1,2].map(function(i){return '<rect x="'+(60+i*110)+'" y="96" width="94" height="36" rx="8" fill="var(--surface2)"/>'+giT(107+i*110,119,'incident '+(i+1),{s:12})+'<path class="lk" d="M'+(107+i*110)+' 96V76"/>'}).join('')),'La cause inconnue derrière un ou plusieurs incidents. On la cherche pour qu\'ils ne reviennent plus.')};
GI["Changement"]=function(){return giWrap(giSvg(420,110,prTk(40,10,340,'Mise à jour acctrans v3.2','CHG-2026-0981','Approuvé','#3D6FD9')+giT(210,100,'planifié, approuvé, avec retour arrière prévu',{s:12,c:'var(--muted)'})),'Toute modification de la production, préparée, approuvée et planifiée.')};
GI["Demande de service"]=function(){return giWrap(giSvg(420,100,prTk(40,18,340,'Créer un accès portail pour un agent','SR-2026-2211','Nouveau','#1F9D6B')),'Une demande standard, sans panne : un accès, une information, une installation.')};
GI["Événement"]=function(){return giWrap(giSvg(420,100,prIc('server',80,48)+'<path class="lk" d="M130 48H190"/>'+giLbl(270,48,'« disque à 70 % »')+giT(270,88,'un changement d\'état, pas forcément grave',{s:12,c:'var(--muted)'})),'Tout changement d\'état remarquable d\'un équipement ou d\'un service. Certains deviennent des alarmes.')};
GI["Alarme"]=function(){return giWrap(giSvg(420,100,prIc('bell',70,48,1.2)+'<rect x="120" y="26" width="270" height="44" rx="10" fill="var(--surface)" stroke="#D93025" stroke-width="2"/>'+giT(136,53,'Critical · TPS en chute sur RSU02',{a:'start',s:13,b:1})),'Un événement qui demande une action : la supervision le signale avec une sévérité.')};
GI["Incident majeur"]=function(){return giWrap(giSvg(420,130,'<rect x="20" y="14" width="380" height="102" rx="14" fill="#D93025"/>'+giT(210,52,'INCIDENT MAJEUR',{c:'#fff',b:1,s:18})+giT(210,80,'service coupé pour beaucoup de clients',{c:'#fff',s:13})+giT(210,100,'bridge ouvert · direction prévenue',{c:'#FFD9D5',s:12})),'Un incident à fort impact : coordination dédiée, communication régulière, process accéléré.')};
GI["Erreur connue"]=function(){return giWrap(giSvg(420,110,'<rect x="40" y="16" width="340" height="80" rx="10" fill="var(--surface2)"/>'+giT(56,42,'Erreur connue KE-0042',{a:'start',b:1,s:13})+giT(56,62,'Cause : fuite mémoire de acctrans',{a:'start',s:12.5})+giT(56,82,'Contournement : redémarrer le pod',{a:'start',s:12.5,c:'#1F9D6B'})),'Un problème dont on connaît la cause et un contournement, en attendant la correction définitive.')};
GI["Contournement"]=function(){return giWrap(giSvg(420,120,'<path d="M30 60H390" stroke="var(--nk-link)" stroke-width="6"/><rect x="180" y="44" width="60" height="32" rx="4" fill="#D93025"/><path d="M140 60C150 10 270 10 280 60" stroke="#1F9D6B" stroke-width="5" fill="none"/>'+giT(210,100,'on passe à côté, en attendant de réparer',{s:12,c:'var(--muted)'})),'Une solution temporaire qui rétablit le service sans régler la cause.')};
GI["Cause racine"]=function(){return giWrap(giSvg(420,130,'<path d="M210 20V70" stroke="#1F9D6B" stroke-width="5"/><circle cx="210" cy="20" r="14" fill="#1F9D6B"/><path d="M210 70C190 90 160 100 140 120M210 70V120M210 70C230 90 260 100 280 120" stroke="#8A5A2B" stroke-width="4" fill="none"/><circle cx="210" cy="120" r="7" fill="#D93025"/>'+giT(250,124,'la vraie cause',{a:'start',s:12.5,b:1,c:'#D93025'})),'La cause première : si on la corrige, l\'incident ne revient pas.')};
GI["RCA"]=function(){return giWrap(giSvg(420,130,'<rect x="80" y="10" width="260" height="110" rx="8" fill="var(--nk-paper)" stroke="var(--nk-pedge)" stroke-width="2"/>'+giT(210,36,'Analyse de cause racine',{b:1,s:13})+['Chronologie','Cause racine','Actions correctives'].map(function(t,i){return giT(100,62+i*20,'■ '+t,{a:'start',s:12})}).join('')),'Root Cause Analysis : le document qui explique pourquoi l\'incident est arrivé et ce qu\'on change.')};
GI["CAB"]=function(){var s='<rect x="110" y="64" width="200" height="30" rx="15" fill="var(--nk-edge)"/>';for(var i=0;i<5;i++)s+=prIc('user',130+i*40,46,.8);return giWrap(giSvg(420,120,s+giLbl(210,112,'approuvé ✓')),'Change Advisory Board : le comité qui valide les changements risqués.')};
GI["Gel des changements"]=function(){return giWrap(giSvg(420,110,[1,2,3,4,5,6,7].map(function(d,i){return '<rect x="'+(24+i*54)+'" y="20" width="46" height="46" rx="8" fill="'+(i>=4?'#9DB8F2':'var(--surface2)')+'"/>'+giT(47+i*54,48,String(25+i),{b:1,s:14})}).join('')+giLbl(310,90,'❄ aucun changement en prod')),'Une période (fêtes, fin de mois) pendant laquelle on ne touche pas à la production.')};
GI["SLA"]=function(){return giWrap(giSvg(420,130,prClock(90,64,46,.65,'var(--vd)')+giT(90,70,'4 h',{b:1,s:16})+giT(170,50,'Engagement de délai :',{a:'start',s:13})+giT(170,72,'P1 résolu en 4 heures',{a:'start',s:13,b:1})+giT(170,94,'temps écoulé : 65 %',{a:'start',s:12,c:'var(--muted)'})),'Service Level Agreement : le délai qu\'on s\'engage à tenir, selon la priorité.')};
GI["Priorité"]=function(){return giWrap(giSvg(420,100,[['P1','#D93025'],['P2','#E8840C'],['P3','#C9A20D'],['P4','#3D6FD9']].map(function(p,i){return '<rect x="'+(24+i*96)+'" y="20" width="84" height="56" rx="12" fill="'+p[1]+'"/>'+giT(66+i*96,56,p[0],{c:'#fff',b:1,s:20})}).join('')),'L\'ordre de traitement, déduit de l\'impact et de l\'urgence. P1 d\'abord.')};
GI["Impact"]=function(){return giWrap(giSvg(420,110,[1,3,8].map(function(n,i){var s='';for(var k=0;k<n;k++)s+='<g transform="translate('+(30+i*140+(k%4)*24)+','+(40+Math.floor(k/4)*30)+') scale(.45)">'+nkIcon('user')+'</g>';return s+giT(70+i*140,100,['faible','moyen','fort'][i],{s:12.5,b:1})}).join('')),'Combien de clients ou de services sont touchés.')};
GI["Urgence"]=function(){return giWrap(giSvg(420,110,prClock(80,50,34,.25,'#3D6FD9')+prClock(210,50,34,.6,'#E8840C')+prClock(340,50,34,.92,'#D93025')+giT(80,100,'peut attendre',{s:12})+giT(210,100,'bientôt',{s:12})+giT(340,100,'tout de suite',{s:12,b:1})),'À quelle vitesse la situation empire si on ne fait rien.')};
GI["Near Breach"]=function(){return giWrap(giSvg(420,110,prClock(90,54,42,.85,'#E8840C')+giT(90,60,'85 %',{b:1,s:14})+giT(160,46,'Le délai est presque écoulé :',{a:'start',s:13})+giT(160,68,'il faut agir maintenant',{a:'start',s:13,b:1,c:'#E8840C'})),'Le ticket approche de sa limite de délai. Dernière chance d\'éviter le dépassement.')};
GI["Breach"]=function(){return giWrap(giSvg(420,110,prClock(90,54,42,1,'#D93025')+giT(90,60,'110 %',{b:1,s:14})+giT(160,46,'Délai dépassé :',{a:'start',s:13})+giT(160,68,'l\'engagement n\'est pas tenu',{a:'start',s:13,b:1,c:'#D93025'})),'Le délai du SLA est dépassé.')};
GI["On Hold"]=function(){return giWrap(giSvg(420,110,'<circle cx="80" cy="54" r="34" fill="#E8840C"/><rect x="66" y="38" width="9" height="32" rx="2" fill="#fff"/><rect x="85" y="38" width="9" height="32" rx="2" fill="#fff"/>'+giT(140,46,'Le chrono du SLA est en pause :',{a:'start',s:13})+giT(140,68,'on attend le client ou un tiers',{a:'start',s:13,b:1})),'Le ticket attend une réponse extérieure : son délai ne court plus pendant ce temps.')};
GI["Mode calendaire"]=function(){return giWrap(giSvg(420,100,['L','M','M','J','V','S','D'].map(function(d,i){return '<rect x="'+(24+i*54)+'" y="20" width="46" height="46" rx="8" fill="var(--vd)"/>'+giT(47+i*54,48,d,{b:1,c:'#fff'})}).join('')+giT(210,90,'le délai court tous les jours, 24 h sur 24',{s:12,c:'var(--muted)'})),'Le délai compte toutes les heures, week-ends et nuits compris.')};
GI["Mode ouvré"]=function(){return giWrap(giSvg(420,100,['L','M','M','J','V','S','D'].map(function(d,i){return '<rect x="'+(24+i*54)+'" y="20" width="46" height="46" rx="8" fill="'+(i<5?'var(--vd)':'var(--surface2)')+'"/>'+giT(47+i*54,48,d,{b:1,c:i<5?'#fff':'var(--muted)'})}).join('')+giT(210,90,'le délai ne court que les jours et heures ouvrés',{s:12,c:'var(--muted)'})),'Le délai ne compte que pendant les heures ouvrées.')};
GI["MTTD"]=function(){return giWrap(giSvg(420,100,'<path d="M30 50H390" stroke="var(--nk-link)" stroke-width="4"/><rect x="80" y="38" width="140" height="24" rx="4" fill="#E8840C"/>'+giT(150,55,'MTTD',{c:'#fff',b:1,s:12})+giT(80,86,'panne',{s:12})+giT(220,86,'on la voit',{s:12})),'Mean Time To Detect : le temps moyen entre le début d\'une panne et sa détection.')};
GI["MTTR"]=function(){return giWrap(giSvg(420,100,'<path d="M30 50H390" stroke="var(--nk-link)" stroke-width="4"/><rect x="80" y="38" width="260" height="24" rx="4" fill="#3D6FD9"/>'+giT(210,55,'MTTR',{c:'#fff',b:1,s:12})+giT(80,86,'panne',{s:12})+giT(340,86,'service rétabli',{s:12})),'Mean Time To Restore : le temps moyen pour rétablir le service.')};
GI["Backlog"]=function(){var s='';for(var i=0;i<6;i++)s+='<rect x="'+(130+i*4)+'" y="'+(90-i*14)+'" width="160" height="22" rx="4" fill="var(--surface)" stroke="var(--line)"/>';return giWrap(giSvg(420,120,s+giT(210,116,'les tickets encore ouverts',{s:12,c:'var(--muted)'})),'La pile des tickets ouverts à traiter.')};
GI["Front Office"]=function(){return giSt({w:420,h:130,nodes:[{id:'c',t:'phone',x:50,y:60,l:'Alarme ou client'},{id:'f',t:'tech',x:210,y:60,l:'Front Office',cls:'hl'},{id:'b',t:'user',x:360,y:60,l:'Back Office'}],links:[['c','f'],['f','b']]},'La première ligne : elle reçoit, qualifie, rétablit si elle peut, et escalade sinon.')};
GI["Back Office"]=function(){return giSt({w:420,h:130,nodes:[{id:'f',t:'tech',x:60,y:60,l:'Front Office'},{id:'b',t:'user',x:210,y:60,l:'Back Office',cls:'hl'},{id:'s',t:'server',x:360,y:60}],links:[['f','b'],['b','s']]},'Les équipes expertes qui prennent la suite quand la première ligne ne peut pas résoudre.')};
GI["Escalade fonctionnelle"]=function(){return giWrap(giSvg(420,100,[['FO','#3D6FD9'],['N2','#6E45C9'],['N3 / éditeur','#1F9D6B']].map(function(t,i){return '<rect x="'+(20+i*136)+'" y="30" width="110" height="40" rx="10" fill="'+t[1]+'"/>'+giT(75+i*136,55,t[0],{c:'#fff',b:1,s:13})+(i<2?'<path d="M'+(132+i*136)+' 50H'+(154+i*136)+'" stroke="var(--ink)" stroke-width="2.5"/>':'')}).join('')),'Passer le ticket à une équipe plus experte du sujet.')};
GI["Escalade hiérarchique"]=function(){return giWrap(giSvg(420,130,[['Responsable d\'équipe',0],['Manager',1],['Direction',2]].map(function(t,i){return '<rect x="'+(110+i*20)+'" y="'+(90-i*36)+'" width="'+(200-i*40)+'" height="30" rx="8" fill="var(--vd)" opacity="'+(.55+i*.2)+'"/>'+giT(210,110-i*36,t[0],{c:'#fff',b:1,s:12.5})}).join('')),'Prévenir les niveaux de responsabilité au-dessus, quand l\'impact ou le délai le demandent.')};
GI["Coordinateur d'incident"]=function(){return giSt({w:420,h:150,nodes:[{id:'c',t:'tech',x:210,y:40,l:'Coordinateur',cls:'hl'},{id:'a',t:'user',x:70,y:116},{id:'b',t:'user',x:210,y:116},{id:'d',t:'user',x:350,y:116}],links:[['c','a'],['c','b'],['c','d']]},'La personne qui pilote un incident majeur : elle répartit, suit et communique.')};
GI["IMOC TT"]=function(){return giWrap(giSvg(420,100,prTk(40,18,340,'Ticket de l\'outil IMOC','OSN-2026-04471','Ouvert','#3D6FD9')),'Le numéro de ticket dans l\'outil IMOC. OSN… pour le Sénégal, OCI… pour la Côte d\'Ivoire.')};
GI["Handover"]=function(){return giWrap(giSvg(420,120,prIc('tech',90,56,1.1)+prIc('tech',330,56,1.1)+'<path d="M140 56H280M280 56l-8 -6M280 56l-8 6" stroke="var(--vd)" stroke-width="3" fill="none"/>'+giLbl(210,36,'tickets en cours, points d\'attention')+giT(90,108,'équipe de jour',{s:12})+giT(330,108,'équipe de nuit',{s:12})),'La passation entre deux équipes : ce qui est en cours, ce qui presse.')};
GI["Tempête d'alarmes"]=function(){var s='';for(var i=0;i<18;i++)s+=prIc('bell',30+(i%9)*44,30+Math.floor(i/9)*46,.55);return giWrap(giSvg(420,110,s),'Des dizaines d\'alarmes en quelques minutes, souvent pour une seule cause.')};
GI["Corrélation"]=function(){return giWrap(giSvg(420,120,[0,1,2].map(function(i){return prIc('bell',60,26+i*36,.5)+'<path class="lk" d="M80 '+(26+i*36)+'L200 62"/>'}).join('')+'<rect x="200" y="42" width="190" height="40" rx="10" fill="var(--vd)"/>'+giT(295,67,'même cause : le leaf-07',{c:'#fff',b:1,s:12.5})),'Relier des alarmes qui ont la même origine.')};
GI["5 pourquoi"]=function(){return giWrap(giSvg(420,170,['Les transferts échouent','acctrans ne répond plus','sa mémoire est pleine','une fuite dans la v3.1','pas de test de charge'].map(function(t,i){return '<rect x="'+(20+i*16)+'" y="'+(8+i*32)+'" width="'+(300-i*10)+'" height="26" rx="6" fill="'+(i===4?'#D93025':'var(--surface2)')+'"/>'+giT(32+i*16,26+i*32,(i?'Pourquoi ? ':'')+t,{a:'start',s:12,c:i===4?'#fff':'var(--ink)'})}).join('')),'Demander « pourquoi ? » cinq fois de suite pour descendre jusqu\'à la vraie cause.')};
GI["Ishikawa"]=function(){var s='<path d="M30 80H360" stroke="var(--ink)" stroke-width="3"/><path d="M360 80l-10 -8v16z" fill="var(--ink)"/><rect x="360" y="62" width="50" height="36" rx="6" fill="#D93025"/>'+giT(385,85,'effet',{c:'#fff',s:11,b:1});['Matériel','Méthode','Humain','Logiciel'].forEach(function(t,i){var x=90+(i%2)*130,up=i<2;s+='<path d="M'+(x+30)+' 80L'+x+' '+(up?22:138)+'" stroke="var(--muted)" stroke-width="2"/>'+giT(x,up?16:154,t,{s:12,b:1})});return giWrap(giSvg(420,160,s),'Le diagramme en arête de poisson : on classe les causes possibles par famille.')};
GI["Bridge"]=function(){return giWrap(giSvg(420,120,'<rect x="110" y="20" width="200" height="80" rx="12" fill="#24262C"/>'+[0,1,2,3].map(function(i){return '<g transform="translate('+(140+i*46)+',58) scale(.6)">'+nkIcon('user')+'</g>'}).join('')+giT(210,40,'● appel en cours',{s:11,c:'#7FD1A8'})),'Un appel ouvert en continu où toutes les équipes se retrouvent pendant un incident majeur.')};
GI["Daily Check-up"]=function(){return giWrap(giSvg(420,120,'<rect x="120" y="10" width="180" height="100" rx="10" fill="var(--surface)" stroke="var(--line)"/>'+['TPS normaux','Alarmes critiques : 0','Sauvegardes OK','Disques &lt; 80 %'].map(function(t,i){return giT(136,34+i*20,'✓ '+t,{a:'start',s:12,c:i===3?'var(--muted)':'#1F9D6B'})}).join('')),'La vérification de santé faite chaque matin, avant que les clients ne voient un problème.')};
GI["Detection Time"]=function(){return giWrap(giSvg(420,90,'<path d="M30 40H390" stroke="var(--nk-link)" stroke-width="4"/><circle cx="110" cy="40" r="8" fill="#D93025"/><circle cx="240" cy="40" r="8" fill="#E8840C"/>'+giT(110,74,'Occur Time',{s:12})+giT(240,74,'Detection Time',{s:12,b:1})),'L\'heure à laquelle la panne a été vue (alarme ou appel).')};
GI["Occur Time"]=function(){return giWrap(giSvg(420,90,'<path d="M30 40H390" stroke="var(--nk-link)" stroke-width="4"/><circle cx="110" cy="40" r="8" fill="#D93025"/><circle cx="240" cy="40" r="8" fill="#E8840C"/>'+giT(110,74,'Occur Time',{s:12,b:1})+giT(240,74,'Detection Time',{s:12})),'L\'heure réelle du début de la panne, souvent avant sa détection.')};
GI["Taux SLA"]=function(){return giWrap(giSvg(420,110,prClock(80,54,40,.94,'#1F9D6B')+giT(80,60,'94 %',{b:1,s:14})+giT(150,46,'des tickets du mois',{a:'start',s:13})+giT(150,68,'résolus dans les délais',{a:'start',s:13,b:1})),'La part des tickets traités dans leur délai.')};
