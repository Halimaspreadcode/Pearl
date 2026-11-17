/**
 * BANQUE DE QUIZ — socle permanent de montée en compétence FO / NOC.
 *
 * Pourquoi ce fichier vit dans server/ et non dans data/ :
 * `npm run migrate` écrase data/*.json avec les fichiers d'une ancienne
 * installation. Une banque rangée dans data/quizzes.json disparaîtrait
 * donc à la première migration. Ici, elle fait partie du code : elle
 * survit aux migrations, aux restaurations de sauvegarde et aux imports.
 *
 * Les quiz créés par l'équipe depuis l'interface restent dans
 * data/quizzes.json. Les deux sources sont fusionnées à la lecture :
 * la banque est en lecture seule (`builtin: true`), les quiz maison
 * restent modifiables. Un quiz maison qui reprend l'id d'un quiz de la
 * banque le remplace — c'est ce qui permet d'adapter un contenu sans
 * perdre la possibilité de revenir au socle en le supprimant.
 *
 * Organisation en niveaux, façon Duolingo : on progresse de 1 à 6, du
 * vocabulaire de base jusqu'à l'architecture et le post-mortem.
 * `level` sert à l'ordre et au déblocage.
 *
 * Chaque niveau porte plusieurs modules : le socle (parcours principal,
 * historique) puis quatre modules d'approfondissement. 6 niveaux x 5
 * modules = 30 quiz. Le déblocage se fait entre niveaux, pas à
 * l'intérieur : ajouter des modules enrichit un palier sans allonger le
 * chemin critique de l'apprenant.
 *
 * Les modules d'approfondissement arrivent NON PUBLIÉS
 * (`default_published: false`). Un ajout de banque ne doit pas faire
 * apparaître 24 cours du jour au lendemain dans le parcours de tout le
 * monde : le manager publie ce qu'il veut ouvrir, quand il le veut. Le
 * socle, lui, était déjà en ligne — le dépublier rétroactivement
 * casserait les parcours en cours.
 */

// Barème de réussite : en dessous, le niveau est à refaire. Volontairement
// plus exigeant sur les niveaux bas — ce sont les réflexes du quotidien,
// on ne peut pas les savoir « à moitié ».
const PASS_MARK = { 1: 80, 2: 80, 3: 70, 4: 70, 5: 70, 6: 65 };

const LEVELS = [
  { level: 1, key: 'fondamentaux',  label: 'Niveau 1 — Fondamentaux',      blurb: 'Le vocabulaire et les réflexes de base du Front Office.' },
  { level: 2, key: 'incident',      label: 'Niveau 2 — Gestion d’incident', blurb: 'Qualifier, prioriser, escalader : le cœur du métier.' },
  { level: 3, key: 'sla',           label: 'Niveau 3 — SLA & engagement',   blurb: 'Compter le temps juste et tenir les engagements client.' },
  { level: 4, key: 'reseau',        label: 'Niveau 4 — Réseau & supervision', blurb: 'Lire une alarme, comprendre la chaîne technique.' },
  { level: 5, key: 'diagnostic',    label: 'Niveau 5 — Diagnostic avancé',  blurb: 'Corréler, isoler, prouver une cause racine.' },
  { level: 6, key: 'excellence',    label: 'Niveau 6 — Excellence opérationnelle', blurb: 'Post-mortem, qualité de service, amélioration continue.' },
];

// Modules transverses. Le socle garde les identifiants historiques
// (`bank-l1-fondamentaux`…) : changer l'id d'un quiz déjà passé
// orphelinerait les résultats et les progressions déjà enregistrés.
// `tag` est le préfixe court des identifiants de question. Il est figé :
// les quatre premiers modules gardent la lettre unique de leurs ids
// historiques (t/o/c/p), les suivants prennent deux lettres. On ne
// dérive plus le tag de la clé — avec `socle` et `securite`, ou `client`
// et `crise`, une simple initiale entrerait en collision.
const MODULES = [
  { key: 'socle',   tag: '',   label: 'Socle',        blurb: 'Le parcours principal du niveau.' },
  { key: 'terrain', tag: 't',  label: 'Cas terrain',  blurb: 'Des situations réelles à trancher.' },
  { key: 'outils',  tag: 'o',  label: 'Outils & données', blurb: 'Les outils du quotidien et les chiffres qu’ils produisent.' },
  { key: 'client',  tag: 'c',  label: 'Relation client',  blurb: 'Ce qu’on dit, à qui, et à quel moment.' },
  { key: 'pieges',  tag: 'p',  label: 'Pièges & réflexes', blurb: 'Les erreurs classiques et comment les éviter.' },
  // ── Extension : huit modules d'expertise ────────────────────
  { key: 'transmission',   tag: 'tr', label: 'Réseau & transmission',  blurb: 'La chaîne physique et logique qui porte le service.' },
  { key: 'securite',       tag: 'se', label: 'Sécurité & accès',       blurb: 'Protéger l’accès, les données et la preuve.' },
  { key: 'data',           tag: 'da', label: 'Données, KPI & reporting', blurb: 'Produire un chiffre juste et le faire dire ce qu’il dit.' },
  { key: 'itil',           tag: 'it', label: 'Processus ITIL avancé',  blurb: 'Changement, problème, capacité : au-delà de l’incident.' },
  { key: 'crise',          tag: 'cr', label: 'Gestion de crise',       blurb: 'Quand l’incident dépasse le cadre du traitement normal.' },
  { key: 'automatisation', tag: 'au', label: 'Outils & automatisation', blurb: 'Scripts, supervision, intégrations : outiller sans fragiliser.' },
  { key: 'energie',        tag: 'en', label: 'Énergie, site & environnement', blurb: 'Ce qui alimente et refroidit le réseau — et le fait tomber.' },
  { key: 'posture',        tag: 'po', label: 'Posture pro & équipe',   blurb: 'Travailler ensemble, sous pression, dans la durée.' },
];

// Temps de réponse par question, en secondes, selon le niveau. Le défaut
// applicatif est de 30 s : correct pour une définition, trop court dès
// qu'il faut lire une mise en situation et peser quatre options. Le
// barème monte donc avec le niveau, où les questions sont des cas à
// analyser plutôt que du vocabulaire à reconnaître.
const TIME_PER_QUESTION = { 1: 45, 2: 45, 3: 60, 4: 60, 5: 75, 6: 90 };

// ── Helper : construit un quiz de niveau à partir de ses questions ──
// `mod` vaut MODULES[0] (socle) par défaut pour préserver les ids
// historiques du parcours principal.
function lvl(meta, questions, mod = MODULES[0]) {
  const socle = mod.key === 'socle';
  return {
    id: socle ? `bank-l${meta.level}-${meta.key}` : `bank-l${meta.level}-${mod.key}`,
    name: socle ? meta.label : `${meta.label} · ${mod.label}`,
    description: socle ? meta.blurb : mod.blurb,
    level: meta.level,
    module: mod.key,
    pass_mark: PASS_MARK[meta.level],
    timer_mode: 'per_question',
    timer_value: TIME_PER_QUESTION[meta.level],
    builtin: true,
    // Le socle était déjà publié avant l'extension de la banque : le
    // laisser tel quel. Les modules ajoutés arrivent en brouillon.
    default_published: socle,
    created_at: '2026-01-01T00:00:00.000Z',
    questions: questions.map((q, i) => ({
      id: `bk${meta.level}${mod.tag}${String(i + 1).padStart(3, '0')}`,
      ...q,
    })),
  };
}

// ══════════════════════════════════════════════════════════════
// NIVEAU 1 — FONDAMENTAUX
// ══════════════════════════════════════════════════════════════
const L1 = [
  {
    question: 'Que signifie l’acronyme SLA ?',
    option_a: 'Service Level Agreement', option_b: 'System Log Analysis',
    option_c: 'Service Line Activation',  option_d: 'Standard Level Alert',
    correct: 'A', category: 'Vocabulaire',
    explanation: 'Le SLA est l’engagement contractuel de niveau de service : il fixe des délais mesurables (prise en compte, résolution) et les pénalités associées.',
  },
  {
    question: 'Dans ITIL, quelle est la différence entre un incident et un problème ?',
    option_a: 'Aucune, ce sont deux mots pour la même chose',
    option_b: 'L’incident est une interruption de service ; le problème est la cause sous-jacente de un ou plusieurs incidents',
    option_c: 'Le problème est plus urgent que l’incident',
    option_d: 'L’incident concerne le matériel, le problème le logiciel',
    correct: 'B', category: 'ITIL',
    explanation: 'On restaure le service au plus vite (incident) ; on cherche ensuite la cause racine pour éviter la récidive (problème). Les deux processus sont distincts et complémentaires.',
  },
  {
    question: 'Que veut dire « MTTR » ?',
    option_a: 'Maximum Time To Repair',
    option_b: 'Minimum Threshold Time Ratio',
    option_c: 'Mean Time To Restore/Repair',
    option_d: 'Managed Ticket Tracking Rate',
    correct: 'C', category: 'Indicateurs',
    explanation: 'MTTR = temps moyen de restauration. C’est une moyenne sur une période, pas un maximum : un seul incident très long peut la dégrader fortement.',
  },
  {
    question: 'Un ticket est ouvert mais aucune action n’est possible avant la réponse d’un tiers. Que faire ?',
    option_a: 'Le fermer et le rouvrir plus tard',
    option_b: 'Le laisser tel quel sans rien noter',
    option_c: 'Le réassigner à un collègue au hasard',
    option_d: 'Le passer en attente avec le motif, le tiers attendu et l’horodatage',
    correct: 'D', category: 'Process',
    explanation: 'La mise en attente documentée protège le SLA et rend la reprise possible par n’importe qui. Fermer/rouvrir fausse les indicateurs et perd l’historique.',
  },
  {
    question: 'Pourquoi horodater précisément la détection d’un incident ?',
    option_a: 'C’est le point de départ du calcul SLA et de la chronologie du post-mortem',
    option_b: 'Uniquement pour la forme',
    option_c: 'Pour savoir qui était de garde',
    option_d: 'Ce n’est pas nécessaire si l’incident est court',
    correct: 'A', category: 'Process',
    explanation: 'Sans heure de détection fiable, ni le SLA ni la chronologie ne tiennent. C’est la première donnée à sécuriser, avant même le diagnostic.',
  },
  {
    question: 'Que doit contenir, au minimum, le titre d’un ticket ?',
    option_a: 'Le prénom de celui qui l’ouvre',
    option_b: 'Le service impacté, la nature du symptôme et le périmètre',
    option_c: 'Un numéro aléatoire',
    option_d: 'La solution envisagée',
    correct: 'B', category: 'Qualité',
    explanation: 'Un bon titre se lit sans ouvrir le ticket : quoi, où, quel symptôme. « Problème réseau » n’aide personne à trier.',
  },
  {
    question: 'Qu’est-ce qu’une escalade fonctionnelle ?',
    option_a: 'Prévenir la hiérarchie que le client est mécontent',
    option_b: 'Augmenter la priorité du ticket',
    option_c: 'Transférer le ticket vers une équipe disposant de l’expertise nécessaire',
    option_d: 'Fermer le ticket et en ouvrir un autre',
    correct: 'C', category: 'Escalade',
    explanation: 'Fonctionnelle = vers plus de compétence (N2, expert). Hiérarchique = vers plus d’autorité (manager). Les deux ne servent pas au même but.',
  },
  {
    question: 'Un utilisateur signale une panne déjà connue et déjà tracée. Quelle est la bonne pratique ?',
    option_a: 'Ouvrir un nouveau ticket indépendant',
    option_b: 'Refuser l’appel',
    option_c: 'Attendre que l’incident se résolve seul',
    option_d: 'Rattacher le signalement à l’incident existant et informer du délai estimé',
    correct: 'D', category: 'Process',
    explanation: 'Le rattachement donne la mesure réelle de l’impact (nombre d’utilisateurs touchés) sans dupliquer le travail de diagnostic.',
  },
  {
    question: 'Que signifie « handover » en fin de shift ?',
    option_a: 'La passation documentée des incidents en cours au shift suivant',
    option_b: 'La fermeture de tous les tickets en cours',
    option_c: 'Le rapport mensuel',
    option_d: 'Le redémarrage des serveurs',
    correct: 'A', category: 'Process',
    explanation: 'Un handover réussi permet au shift suivant de reprendre sans relancer le diagnostic depuis zéro : contexte, actions faites, prochaine étape.',
  },
  {
    question: 'Pourquoi ne faut-il jamais consigner un mot de passe dans un ticket ?',
    option_a: 'Cela prend trop de place',
    option_b: 'Les tickets sont archivés, exportés et lus par de nombreuses personnes : le secret devient incontrôlable',
    option_c: 'Ce n’est pas grave si le ticket est fermé',
    option_d: 'Seuls les mots de passe root posent problème',
    correct: 'B', category: 'Sécurité',
    explanation: 'Un ticket vit longtemps et circule largement (exports, rapports, sauvegardes). Un secret qui y entre doit être considéré comme compromis.',
  },
];

// ══════════════════════════════════════════════════════════════
// NIVEAU 2 — GESTION D’INCIDENT
// ══════════════════════════════════════════════════════════════
const L2 = [
  {
    question: 'Comment se détermine la priorité d’un incident ?',
    option_a: 'Uniquement par l’urgence ressentie du demandeur',
    option_b: 'Par ordre d’arrivée',
    option_c: 'Par le croisement de l’impact et de l’urgence',
    option_d: 'Par l’ancienneté de l’agent qui le traite',
    correct: 'C', category: 'Priorisation',
    explanation: 'Impact = ampleur (combien d’utilisateurs, quel service). Urgence = vitesse de dégradation. La matrice des deux donne la priorité, pas le ton du demandeur.',
  },
  {
    question: 'Une coupure touche un site unique mais il s’agit du site hébergeant la facturation nationale. Quelle lecture ?',
    option_a: 'Impact faible car un seul site',
    option_b: 'Aucune action avant les heures ouvrées',
    option_c: 'Priorité P4 par défaut',
    option_d: 'Impact fort : c’est la criticité du service porté qui compte, pas le nombre de sites',
    correct: 'D', category: 'Priorisation',
    explanation: 'Compter les sites est trompeur. Un nœud unique peut porter un service critique national : c’est la fonction métier qui fixe l’impact.',
  },
  {
    question: 'Quel est le premier objectif face à un incident majeur en cours ?',
    option_a: 'Restaurer le service, même par contournement',
    option_b: 'Rédiger le post-mortem',
    option_c: 'Identifier le coupable',
    option_d: 'Attendre la validation du manager',
    correct: 'A', category: 'Incident',
    explanation: 'La restauration prime sur la compréhension. Le contournement (workaround) est légitime : l’analyse de cause racine vient après, en gestion de problème.',
  },
  {
    question: 'Qu’est-ce qu’un workaround ?',
    option_a: 'Une solution définitive',
    option_b: 'Une mesure temporaire rétablissant le service sans traiter la cause',
    option_c: 'Un redémarrage systématique',
    option_d: 'Un ticket annulé',
    correct: 'B', category: 'Incident',
    explanation: 'Le workaround rend le service, il ne règle pas la cause. Il doit toujours rester tracé : sinon le problème de fond disparaît des radars.',
  },
  {
    question: 'Pendant un incident majeur, à quelle fréquence communiquer ?',
    option_a: 'Seulement à la résolution',
    option_b: 'Uniquement si le client relance',
    option_c: 'À intervalle régulier convenu, même sans élément nouveau',
    option_d: 'Une fois par jour',
    correct: 'C', category: 'Communication',
    explanation: 'Le silence est interprété comme un abandon. Un point régulier — même « pas d’évolution, investigation en cours » — maintient la confiance.',
  },
  {
    question: 'Deux incidents P1 simultanés, une seule équipe disponible. Quel critère départage ?',
    option_a: 'Le premier arrivé',
    option_b: 'Celui du client qui appelle le plus',
    option_c: 'Le plus simple à résoudre',
    option_d: 'L’impact métier réel et la trajectoire de dégradation',
    correct: 'D', category: 'Priorisation',
    explanation: 'On arbitre sur l’impact et sur ce qui empire. Traiter d’abord le plus facile est tentant mais peut laisser filer le plus coûteux.',
  },
  {
    question: 'Un incident est résolu techniquement. Quand peut-on le clôturer ?',
    option_a: 'Après confirmation du rétablissement effectif et accord du demandeur',
    option_b: 'Immédiatement',
    option_c: 'À la fin du shift',
    option_d: 'Après 24 h automatiquement',
    correct: 'A', category: 'Process',
    explanation: '« Ça marche chez moi » ne suffit pas. La clôture demande une vérification côté service rendu, sinon on rouvre dans l’heure.',
  },
  {
    question: 'Qu’est-ce qu’un incident récurrent doit déclencher ?',
    option_a: 'Rien de particulier',
    option_b: 'L’ouverture d’un problème pour analyse de cause racine',
    option_c: 'La fermeture définitive du service',
    option_d: 'Une baisse de priorité',
    correct: 'B', category: 'ITIL',
    explanation: 'Traiter dix fois le même incident sans ouvrir de problème, c’est accepter de le traiter une onzième fois. La récurrence est le signal d’alerte.',
  },
  {
    question: 'Que note-t-on dans un ticket pendant l’investigation ?',
    option_a: 'Uniquement la conclusion finale',
    option_b: 'Seulement les actions réussies',
    option_c: 'Chaque action tentée, son heure et son résultat — y compris les échecs',
    option_d: 'Rien, pour aller plus vite',
    correct: 'C', category: 'Qualité',
    explanation: 'Les pistes écartées ont autant de valeur que la bonne : elles évitent au suivant de refaire le même chemin. C’est ce qui rend un handover utile.',
  },
  {
    question: 'Le client demande de fermer un ticket alors que la cause reste inconnue. Que faire ?',
    option_a: 'Refuser catégoriquement',
    option_b: 'Fermer sans rien dire',
    option_c: 'Laisser le ticket ouvert indéfiniment',
    option_d: 'Clôturer l’incident (service rendu) et ouvrir un problème pour la cause',
    correct: 'D', category: 'ITIL',
    explanation: 'Les deux besoins sont compatibles : le client veut le service, l’exploitation veut la cause. Deux objets distincts, chacun son cycle de vie.',
  },
];

// ══════════════════════════════════════════════════════════════
// NIVEAU 3 — SLA & ENGAGEMENT
// ══════════════════════════════════════════════════════════════
const L3 = [
  {
    question: 'Un SLA « 4 h en heures ouvrées (8h–17h) ». Ticket ouvert à 16 h. Échéance ?',
    option_a: 'Le lendemain à 11 h',
    option_b: 'Le jour même à 20 h',
    option_c: 'Le lendemain à 8 h',
    option_d: 'Dans 4 h calendaires',
    correct: 'A', category: 'Calcul SLA',
    explanation: '1 h consommée avant 17 h, 3 h restantes reportées au lendemain à partir de 8 h → 11 h. Le compteur se fige hors plage ouvrée.',
  },
  {
    question: 'Quelle différence entre SLA calendaire et SLA ouvré ?',
    option_a: 'Aucune en pratique',
    option_b: 'Le calendaire compte 24 h/24 ; l’ouvré ne compte que les plages de service',
    option_c: 'Le calendaire ne s’applique qu’aux P1',
    option_d: 'L’ouvré est toujours plus court',
    correct: 'B', category: 'Calcul SLA',
    explanation: 'Confondre les deux est la première cause d’erreur de reporting : un même délai nominal donne des échéances très différentes.',
  },
  {
    question: 'Le temps passé en attente d’une information client doit-il compter dans le SLA ?',
    option_a: 'Toujours',
    option_b: 'Jamais, en toutes circonstances',
    option_c: 'Selon le contrat : souvent suspendu, mais cela doit être écrit et tracé',
    option_d: 'Seulement pour les P1',
    correct: 'C', category: 'Calcul SLA',
    explanation: 'La suspension est une clause contractuelle, pas une décision d’exploitation. Sans trace horodatée de la demande, elle est indéfendable en revue.',
  },
  {
    question: 'Qu’est-ce qu’un SLA « à deux seuils » (workaround / résolution finale) ?',
    option_a: 'Deux tickets distincts',
    option_b: 'Un SLA réservé aux P4',
    option_c: 'Une erreur de configuration',
    option_d: 'Un délai court pour rétablir le service, un délai plus long pour la correction définitive',
    correct: 'D', category: 'Calcul SLA',
    explanation: 'Ce modèle reconnaît que rétablir vite et corriger durablement sont deux engagements différents, avec deux horloges distinctes.',
  },
  {
    question: 'Un ticket va dépasser son SLA malgré tous les efforts. Quelle est la bonne attitude ?',
    option_a: 'Alerter avant l’échéance, expliquer et proposer un plan',
    option_b: 'Attendre le dépassement et l’expliquer après',
    option_c: 'Modifier discrètement l’heure d’ouverture',
    option_d: 'Fermer et rouvrir le ticket',
    correct: 'A', category: 'Engagement',
    explanation: 'Un dépassement annoncé se gère ; un dépassement découvert se subit. Antidater est une falsification, avec des conséquences disciplinaires et contractuelles.',
  },
  {
    question: 'Le taux de conformité SLA est de 95 % mais la satisfaction client est mauvaise. Explication la plus probable ?',
    option_a: 'Les clients sont déraisonnables',
    option_b: 'Les 5 % non conformes concernent les incidents les plus critiques',
    option_c: 'L’indicateur est forcément faux',
    option_d: 'Il faut baisser les objectifs',
    correct: 'B', category: 'Indicateurs',
    explanation: 'Une moyenne masque la distribution. Respecter le SLA sur mille P4 ne compense jamais un P1 raté : il faut lire l’indicateur par criticité.',
  },
  {
    question: 'Pourquoi mesurer le MTTD (temps moyen de détection) en plus du MTTR ?',
    option_a: 'C’est redondant',
    option_b: 'Le MTTD ne concerne que la sécurité',
    option_c: 'Un incident détecté tard fait perdre du temps avant même le début du traitement',
    option_d: 'Pour remplir les rapports',
    correct: 'C', category: 'Indicateurs',
    explanation: 'Améliorer la supervision (MTTD) donne souvent plus de gain que d’accélérer la réparation : on ne peut pas traiter ce qu’on ne voit pas.',
  },
  {
    question: 'Un client conteste un dépassement SLA. Quel est l’élément décisif ?',
    option_a: 'La parole de l’agent',
    option_b: 'Le nombre de tickets traités ce mois-ci',
    option_c: 'L’ancienneté de la relation commerciale',
    option_d: 'La chronologie horodatée et tracée dans l’outil',
    correct: 'D', category: 'Engagement',
    explanation: 'En litige, seule la trace fait foi. C’est la raison opérationnelle — et non bureaucratique — d’une saisie rigoureuse au fil de l’eau.',
  },
  {
    question: 'Que signifie « SLA breach » sur un ticket encore ouvert ?',
    option_a: 'L’échéance contractuelle est dépassée et le traitement continue',
    option_b: 'Le ticket est annulé',
    option_c: 'Le ticket doit être fermé immédiatement',
    option_d: 'Le client a résilié',
    correct: 'A', category: 'Calcul SLA',
    explanation: 'Le dépassement ne suspend pas le travail : il déclenche généralement une escalade et une communication renforcée, jusqu’à résolution.',
  },
  {
    question: 'Sur quel horodatage démarre normalement le SLA de résolution ?',
    option_a: 'À la première action de l’agent',
    option_b: 'À la détection ou à la déclaration de l’incident, selon le contrat',
    option_c: 'À la fin du shift',
    option_d: 'À la validation du manager',
    correct: 'B', category: 'Calcul SLA',
    explanation: 'Faire partir le compteur à la première action récompenserait la lenteur de prise en charge. Le contrat fixe le point de départ, souvent la détection.',
  },
];

// ══════════════════════════════════════════════════════════════
// NIVEAU 4 — RÉSEAU & SUPERVISION
// ══════════════════════════════════════════════════════════════
const L4 = [
  {
    question: 'Dans un réseau mobile 4G, que désigne l’eNodeB ?',
    option_a: 'Le cœur de réseau paquet',
    option_b: 'La base d’abonnés',
    option_c: 'La station de base radio',
    option_d: 'Le serveur de facturation',
    correct: 'C', category: 'Radio',
    explanation: 'L’eNodeB est la station de base LTE : elle porte la radio et se raccorde au cœur (EPC). En 5G, l’équivalent est le gNodeB.',
  },
  {
    question: 'Une alarme « LinkDown » remonte sur un lien de transmission. Premier réflexe ?',
    option_a: 'Redémarrer l’équipement immédiatement',
    option_b: 'Attendre une confirmation client',
    option_c: 'Fermer l’alarme si le service semble fonctionner',
    option_d: 'Vérifier le périmètre : est-ce isolé ou corrélé à d’autres alarmes ?',
    correct: 'D', category: 'Supervision',
    explanation: 'Une alarme isolée et une alarme corrélée à dix autres ne racontent pas la même histoire. Le périmètre oriente tout le diagnostic.',
  },
  {
    question: 'Qu’est-ce qu’une « alarm storm » et quel risque présente-t-elle ?',
    option_a: 'Un afflux massif d’alarmes qui noie l’alarme causale',
    option_b: 'Une alarme unique très grave',
    option_c: 'Une panne du système de supervision',
    option_d: 'Une alarme répétée toutes les heures',
    correct: 'A', category: 'Supervision',
    explanation: 'La corrélation sert justement à retrouver la cause dans le bruit. Traiter les alarmes une par une pendant une tempête fait perdre un temps décisif.',
  },
  {
    question: 'À quoi sert le protocole SNMP en supervision ?',
    option_a: 'À chiffrer les communications',
    option_b: 'À collecter des compteurs et recevoir des traps depuis les équipements',
    option_c: 'À router les paquets',
    option_d: 'À authentifier les abonnés',
    correct: 'B', category: 'Protocoles',
    explanation: 'SNMP couvre la collecte (polling) et la notification (traps). Attention : SNMPv1/v2c circulent en clair, v3 apporte l’authentification et le chiffrement.',
  },
  {
    question: 'Le service est dégradé mais aucun équipement n’est en alarme. Hypothèse la plus probable ?',
    option_a: 'Le problème n’existe pas',
    option_b: 'Tous les équipements sont en panne',
    option_c: 'Un angle mort de supervision, ou une dégradation sous les seuils configurés',
    option_d: 'Le client se trompe',
    correct: 'C', category: 'Supervision',
    explanation: 'Les seuils ne détectent que ce qu’on leur a demandé. Une saturation progressive ou un chemin non supervisé passe sous les radars.',
  },
  {
    question: 'Que mesure la « latence » sur un lien ?',
    option_a: 'Le volume de données transporté',
    option_b: 'La puissance du signal',
    option_c: 'Le nombre de paquets perdus',
    option_d: 'Le temps de trajet d’un paquet entre deux points',
    correct: 'D', category: 'Réseau',
    explanation: 'Latence, gigue et perte de paquets sont trois grandeurs distinctes. La voix tolère mal la gigue ; le transfert de fichier tolère mal la perte.',
  },
  {
    question: 'Un lien affiche 0,5 % de perte de paquets. Impact attendu sur la voix sur IP ?',
    option_a: 'Une dégradation audible possible : la VoIP est très sensible aux pertes',
    option_b: 'Aucun, c’est négligeable',
    option_c: 'Seul le débit sera réduit',
    option_d: 'Cela n’affecte que les SMS',
    correct: 'A', category: 'Réseau',
    explanation: 'La VoIP n’a pas le temps de retransmettre : la perte se traduit directement en coupures de son. Un taux « faible » sur le papier s’entend à l’oreille.',
  },
  {
    question: 'Quel est l’intérêt d’un schéma de dépendance de services en exploitation ?',
    option_a: 'Décorer la salle de supervision',
    option_b: 'Déduire l’impact métier réel d’une panne d’équipement',
    option_c: 'Remplacer la documentation technique',
    option_d: 'Calculer les salaires',
    correct: 'B', category: 'Architecture',
    explanation: 'Sans carte des dépendances, on ne sait pas ce qu’une panne casse en aval : c’est ce qui permet de passer d’une alarme technique à une priorité métier.',
  },
  {
    question: 'Que faut-il vérifier avant de conclure qu’une panne vient du réseau opérateur ?',
    option_a: 'Rien, c’est toujours le réseau',
    option_b: 'L’heure qu’il est',
    option_c: 'Que le problème n’est pas local (équipement client, configuration, alimentation)',
    option_d: 'La météo uniquement',
    correct: 'C', category: 'Diagnostic',
    explanation: 'Attribuer une panne au réseau sans avoir écarté le périmètre local coûte cher en escalades inutiles et décrédibilise l’équipe.',
  },
  {
    question: 'À quoi sert la redondance N+1 ?',
    option_a: 'À doubler la performance',
    option_b: 'À simplifier la configuration',
    option_c: 'À réduire la consommation électrique',
    option_d: 'À maintenir le service malgré la défaillance d’un élément',
    correct: 'D', category: 'Architecture',
    explanation: 'N+1 assure la continuité, pas la performance. Point de vigilance : en mode dégradé, il n’y a plus de filet — la remise en état devient prioritaire.',
  },
];

// ══════════════════════════════════════════════════════════════
// NIVEAU 5 — DIAGNOSTIC AVANCÉ
// ══════════════════════════════════════════════════════════════
const L5 = [
  {
    question: 'Une panne survient chaque nuit à 2 h précises. Piste la plus probable ?',
    option_a: 'Une tâche planifiée : sauvegarde, batch, rotation de logs, renouvellement de session',
    option_b: 'Une coïncidence',
    option_c: 'Un problème de radio',
    option_d: 'Une erreur des utilisateurs',
    correct: 'A', category: 'Corrélation',
    explanation: 'Une régularité horaire parfaite désigne presque toujours un déclencheur programmé. Le premier réflexe est de comparer avec le calendrier des batchs.',
  },
  {
    question: 'Comment distinguer une saturation d’une panne franche ?',
    option_a: 'Impossible à distinguer',
    option_b: 'La saturation dégrade progressivement et corrèle avec la charge ; la panne est brutale et indépendante du trafic',
    option_c: 'La panne est toujours plus longue',
    option_d: 'La saturation ne génère jamais d’alarme',
    correct: 'B', category: 'Diagnostic',
    explanation: 'Superposer la courbe d’incidents à la courbe de trafic tranche vite : une corrélation nette oriente vers le dimensionnement, pas vers la défaillance.',
  },
  {
    question: 'Quelle est la limite d’une analyse fondée sur la seule corrélation temporelle ?',
    option_a: 'Elle est toujours fausse',
    option_b: 'Elle demande trop de calcul',
    option_c: 'Corrélation n’est pas causalité : deux effets peuvent partager une cause commune',
    option_d: 'Elle ne fonctionne que sur les P1',
    correct: 'C', category: 'Méthode',
    explanation: 'Deux services qui tombent ensemble peuvent dépendre d’un même socle (alimentation, DNS, temps). Il faut tester l’hypothèse, pas s’arrêter à la coïncidence.',
  },
  {
    question: 'Un redémarrage résout l’incident. Peut-on clore le problème ?',
    option_a: 'Oui, le service est rétabli',
    option_b: 'Oui, après 24 h sans récidive',
    option_c: 'Oui, si le client est satisfait',
    option_d: 'Non : le redémarrage masque la cause, qui reste à identifier',
    correct: 'D', category: 'Méthode',
    explanation: 'Le redémarrage est un workaround. Sans analyse (fuite mémoire, blocage, corruption d’état), la panne reviendra — souvent au pire moment.',
  },
  {
    question: 'Quelle donnée collecter en priorité avant un redémarrage salvateur ?',
    option_a: 'L’état courant : logs, dumps, compteurs, connexions — ils disparaîtront au reboot',
    option_b: 'Aucune, il faut aller vite',
    option_c: 'Le nom du technicien',
    option_d: 'La température de la salle uniquement',
    correct: 'A', category: 'Méthode',
    explanation: 'Le redémarrage détruit les preuves. Quelques secondes de collecte évitent de rester sans explication à la prochaine occurrence.',
  },
  {
    question: 'Un incident n’est reproductible que chez un seul utilisateur. Quel axe explorer ?',
    option_a: 'Conclure à une erreur humaine',
    option_b: 'Chercher ce qui est spécifique : profil, droits, poste, chemin réseau, version',
    option_c: 'Ignorer le signalement',
    option_d: 'Redémarrer le cœur de réseau',
    correct: 'B', category: 'Diagnostic',
    explanation: 'La singularité est une information : elle réduit le champ de recherche. Ce qui diffère chez cet utilisateur est très probablement la cause.',
  },
  {
    question: 'Que signifie « isoler » une panne ?',
    option_a: 'Débrancher l’équipement',
    option_b: 'Mettre le ticket en attente',
    option_c: 'Réduire méthodiquement le périmètre jusqu’à localiser le maillon défaillant',
    option_d: 'Escalader immédiatement',
    correct: 'C', category: 'Méthode',
    explanation: 'On coupe l’espace de recherche en deux à chaque test (bissection). C’est plus rapide et plus sûr que de tester des hypothèses au hasard.',
  },
  {
    question: 'Deux équipes se renvoient la responsabilité d’une panne. Quelle approche débloque ?',
    option_a: 'Trancher à l’ancienneté',
    option_b: 'Attendre que ça passe',
    option_c: 'Escalader systématiquement au directeur',
    option_d: 'Réunir les faits horodatés des deux côtés et objectiver le point de rupture',
    correct: 'D', category: 'Méthode',
    explanation: 'Le débat d’opinions s’éternise ; la chronologie commune le clôt. C’est aussi ce qui rend le post-mortem non accusatoire.',
  },
  {
    question: 'Après changement, une panne apparaît. Quelle hypothèse tester en premier ?',
    option_a: 'Le changement lui-même — jusqu’à preuve du contraire',
    option_b: 'Une panne matérielle aléatoire',
    option_c: 'Une attaque externe',
    option_d: 'Une erreur de supervision',
    correct: 'A', category: 'Corrélation',
    explanation: 'La proximité temporelle avec un changement est le signal le plus fort en exploitation. D’où l’intérêt d’un journal des changements consultable.',
  },
  {
    question: 'Qu’est-ce qu’un incident « intermittent » exige de plus qu’un incident permanent ?',
    option_a: 'Moins d’attention',
    option_b: 'Une capture continue et des critères de déclenchement pour attraper l’événement',
    option_c: 'Un redémarrage quotidien',
    option_d: 'Une fermeture rapide',
    correct: 'B', category: 'Méthode',
    explanation: 'On ne diagnostique pas ce qu’on ne voit pas se produire. Il faut instrumenter et attendre l’occurrence, plutôt que conclure entre deux épisodes.',
  },
];

// ══════════════════════════════════════════════════════════════
// NIVEAU 6 — EXCELLENCE OPÉRATIONNELLE
// ══════════════════════════════════════════════════════════════
const L6 = [
  {
    question: 'Quel est l’objectif premier d’un post-mortem ?',
    option_a: 'Identifier le responsable',
    option_b: 'Justifier un dépassement SLA',
    option_c: 'Comprendre les causes et décider d’actions pour éviter la récidive',
    option_d: 'Archiver le ticket',
    correct: 'C', category: 'Post-mortem',
    explanation: 'Un post-mortem qui cherche un coupable produit du silence : les incidents suivants seront cachés. On analyse le système, pas les personnes.',
  },
  {
    question: 'Que signifie « blameless post-mortem » ?',
    option_a: 'Personne n’est responsable de rien',
    option_b: 'On ne convoque que les managers',
    option_c: 'On ne rédige pas de rapport',
    option_d: 'On analyse les défaillances de processus et de système plutôt que les fautes individuelles',
    correct: 'D', category: 'Post-mortem',
    explanation: 'Sans peur de la sanction, les faits remontent complets. Si une personne seule a pu provoquer la panne, c’est le garde-fou manquant qui est en cause.',
  },
  {
    question: 'Une action corrective sans porteur ni échéance, qu’est-ce que c’est ?',
    option_a: 'Une intention sans effet : elle ne sera pas réalisée',
    option_b: 'Une bonne pratique',
    option_c: 'Une action prioritaire',
    option_d: 'Une exigence contractuelle',
    correct: 'A', category: 'Amélioration',
    explanation: 'Un plan d’action se mesure à ce qui est clos, pas à ce qui est écrit. Sans nom ni date, l’action reste un vœu.',
  },
  {
    question: 'Pourquoi suivre le taux de réouverture des tickets ?',
    option_a: 'Pour classer les agents',
    option_b: 'Il révèle les clôtures prématurées et les résolutions superficielles',
    option_c: 'Il n’a aucun intérêt',
    option_d: 'Pour facturer davantage',
    correct: 'B', category: 'Qualité',
    explanation: 'Un MTTR flatteur obtenu par clôtures hâtives se paie en réouvertures. Les deux indicateurs doivent se lire ensemble.',
  },
  {
    question: 'Comment une base de connaissances améliore-t-elle concrètement le MTTR ?',
    option_a: 'Elle ne change rien',
    option_b: 'Elle remplace la formation',
    option_c: 'Elle évite de rediagnostiquer un cas déjà résolu et accélère la prise en charge',
    option_d: 'Elle sert uniquement aux nouveaux',
    correct: 'C', category: 'Amélioration',
    explanation: 'Sa valeur dépend de sa fraîcheur : une base non mise à jour après chaque résolution notable devient vite trompeuse plutôt qu’utile.',
  },
  {
    question: 'Qu’est-ce qu’un indicateur « vanity metric » en exploitation ?',
    option_a: 'Un indicateur difficile à calculer',
    option_b: 'Un indicateur réglementaire',
    option_c: 'Un indicateur réservé à la direction',
    option_d: 'Un indicateur flatteur qui ne guide aucune décision',
    correct: 'D', category: 'Indicateurs',
    explanation: '« Nombre de tickets traités » monte quand tout va mal comme quand tout va bien. Un bon indicateur change une décision.',
  },
  {
    question: 'Le nombre d’incidents baisse mais leur durée moyenne augmente. Lecture ?',
    option_a: 'Les cas simples ont été éliminés ; restent les cas complexes — il faut adapter compétences et outillage',
    option_b: 'La situation s’améliore nettement',
    option_c: 'Les indicateurs sont faux',
    option_d: 'Il faut réduire les effectifs',
    correct: 'A', category: 'Indicateurs',
    explanation: 'C’est une évolution saine mais exigeante : le profil de la charge a changé, l’organisation doit suivre (expertise, documentation, outillage).',
  },
  {
    question: 'Quel est le rôle d’une revue opérationnelle hebdomadaire ?',
    option_a: 'Distribuer des sanctions',
    option_b: 'Examiner tendances, incidents marquants et avancement des actions correctives',
    option_c: 'Remplacer le handover quotidien',
    option_d: 'Valider les congés',
    correct: 'B', category: 'Pilotage',
    explanation: 'La revue regarde les tendances, pas les cas isolés. Elle sert à décider : ce qui n’avance pas doit y être arbitré, pas simplement constaté.',
  },
  {
    question: 'Comment évaluer la criticité d’un risque identifié ?',
    option_a: 'Par son coût de correction uniquement',
    option_b: 'Par son ancienneté',
    option_c: 'Par le croisement de sa probabilité et de sa gravité',
    option_d: 'Par le nombre de personnes qui en parlent',
    correct: 'C', category: 'Pilotage',
    explanation: 'Un risque rare mais catastrophique et un risque fréquent mais bénin ne se traitent pas pareil. Le croisement évite d’arbitrer à l’intuition.',
  },
  {
    question: 'Qu’est-ce qui distingue une équipe réactive d’une équipe proactive ?',
    option_a: 'La taille de l’équipe',
    option_b: 'Il n’y a pas de différence réelle',
    option_c: 'La proactive travaille la nuit',
    option_d: 'La proactive agit sur les signaux faibles et les causes avant l’incident client',
    correct: 'D', category: 'Excellence',
    explanation: 'La bascule se mesure : part d’incidents détectés en interne avant signalement client, et part du temps consacrée aux causes plutôt qu’aux symptômes.',
  },
];

// Les modules d'approfondissement vivent dans des fichiers séparés :
// ici, on n'assemble que la structure. Voir server/quiz/quiz-bank-modules.js
// (les quatre modules d'origine) et server/quiz/quiz-bank-expert.js (les huit
// modules d'expertise et les deux examens transverses).
const MOD = { ...require('./quiz-bank-modules'), ...require('./quiz-bank-expert').modules };
const { EXAMS } = require('./quiz-bank-expert');

const SOCLE = [L1, L2, L3, L4, L5, L6];

// ── Examens transverses ─────────────────────────────────────────
// Ils ne suivent pas la grille niveau x module : ce sont des épreuves
// de synthèse qui piochent dans tout le référentiel. `level: 6` les
// place en fin de parcours ; `module: 'examen'` les sort des colonnes
// de modules dans l'affichage. Barème plus élevé et temps plus long :
// une certification ne se joue pas au réflexe.
function exam(meta) {
  return {
    id: meta.id,
    name: meta.name,
    description: meta.description,
    level: 6,
    module: 'examen',
    pass_mark: meta.pass_mark,
    timer_mode: 'per_question',
    timer_value: 90,
    builtin: true,
    default_published: false,
    created_at: '2026-01-01T00:00:00.000Z',
    questions: meta.questions.map((q, i) => ({
      id: `${meta.idPrefix}${String(i + 1).padStart(3, '0')}`,
      ...q,
    })),
  };
}

// 6 niveaux x 13 modules = 78 quiz, plus 2 examens transverses.
// L'ordre importe : le socle en premier, pour que le parcours principal
// reste en tête de liste ; les examens en dernier.
//
// Un module déclaré dans MODULES mais dont les questions ne sont pas
// encore écrites est ignoré, niveau par niveau. Sans ce filtre, une
// banque en cours de rédaction faisait tomber le serveur entier au
// chargement — un module manquant ne doit coûter que ce module.
const BANK = [
  ...LEVELS.map((meta, i) => lvl(meta, SOCLE[i])),
  ...MODULES.slice(1).flatMap(mod =>
    LEVELS
      .filter(meta => MOD[mod.key] && MOD[mod.key][meta.level])
      .map(meta => lvl(meta, MOD[mod.key][meta.level], mod))),
  ...EXAMS.map(exam),
];

// Signale au démarrage ce qui manque, sinon l'absence est silencieuse
// et un module vide passe inaperçu jusqu'à ce qu'un apprenant le cherche.
{
  const missing = MODULES.slice(1)
    .filter(m => !MOD[m.key] || LEVELS.some(l => !MOD[m.key][l.level]))
    .map(m => m.key);
  if (missing.length)
    console.warn(`[EMOC] Quiz: modules incomplets, ignorés — ${missing.join(', ')}`);
}

/**
 * Fusionne la banque intégrée avec les quiz créés depuis l'interface.
 * Un quiz maison portant l'id d'un quiz de la banque le remplace :
 * cela permet d'adapter un contenu localement, et de revenir au socle
 * en supprimant simplement la version maison.
 */
function mergeWithBank(custom) {
  const list = Array.isArray(custom) ? custom : [];
  const overridden = new Set(list.map(q => q && q.id));
  const base = BANK.filter(q => !overridden.has(q.id));
  return [...base, ...list];
}

module.exports = { BANK, LEVELS, MODULES, PASS_MARK, TIME_PER_QUESTION, mergeWithBank };
