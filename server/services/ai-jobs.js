// ══════════════════════════════════════════════════════════════
// TÂCHES DE BIG BROTHER EN ARRIÈRE-PLAN
//
// Un skill peut prendre une à deux minutes (gros modèle, second essai).
// La page lance la tâche, récupère son identifiant et vient lire où elle
// en est : une phrase à la fois (« Lecture des données… », « Big Brother
// cherche l'origine des 12 ruptures… »). L'admin peut changer de page ou
// continuer à écrire pendant ce temps.
//
// En mémoire seulement : rien n'est écrit sur disque, une tâche finie
// est gardée une heure puis oubliée, comme les conversations.
// ══════════════════════════════════════════════════════════════

const crypto = require('crypto');

const GARDE_MS = 60 * 60 * 1000;   // résultat gardé une heure
const MAX = 30;                    // tâches gardées au plus
const ROTATION_MS = 4500;          // une phrase d'attente toutes les 4,5 s

const JOBS = new Map();

function purger() {
  const limite = Date.now() - GARDE_MS;
  for (const [id, j] of JOBS) if (j.fin && j.fin < limite) JOBS.delete(id);
  while (JOBS.size > MAX) {
    const plusVieux = [...JOBS.values()].filter(j => j.fin).sort((a, b) => a.fin - b.fin)[0];
    if (!plusVieux) break;
    JOBS.delete(plusVieux.id);
  }
}

// Ce que la page reçoit : jamais la fonction de rotation.
const vue = j => ({
  id: j.id, skill: j.skill, titre: j.titre, etat: j.etat, etape: j.etape, n: j.n,
  debut: j.debut, fin: j.fin || null, ms: (j.fin || Date.now()) - j.debut,
  resultat: j.etat === 'fini' ? j.resultat : undefined, erreur: j.erreur || undefined,
});

/**
 * Lance `travail(progres)` en arrière-plan et renvoie la tâche.
 * `progres(texte, attente)` pose l'étape courante ; `attente` (facultatif)
 * est une liste de phrases qui défilent tant que l'étape suivante n'arrive
 * pas — ce que Big Brother est en train de lire pendant l'appel au modèle.
 */
function lancer({ skill, titre }, travail) {
  purger();
  const j = { id: crypto.randomBytes(8).toString('hex'), skill, titre, etat: 'en_cours', etape: 'Préparation…', n: 1, debut: Date.now() };
  // Arrêt à la demande : le signal coupe l'appel au modèle en cours.
  Object.defineProperty(j, 'ctrl', { value: new AbortController(), enumerable: false });
  JOBS.set(j.id, j);
  let minuteur = null;
  const stop = () => { if (minuteur) clearInterval(minuteur); minuteur = null; };
  const progres = (texte, attente) => {
    if (j.etat !== 'en_cours') return;
    stop();
    j.etape = String(texte || '').slice(0, 200); j.n++;
    const file = (attente || []).filter(Boolean);
    if (file.length) {
      let k = 0;
      minuteur = setInterval(() => {
        if (j.etat !== 'en_cours') return stop();
        j.etape = file[k % file.length]; j.n++; k++;
      }, ROTATION_MS);
      minuteur.unref?.();
    }
  };
  Promise.resolve()
    .then(() => require('./ai').avecArret(j.ctrl.signal, () => travail(progres)))
    .then(r => { stop(); if (j.etat !== 'en_cours') return; j.resultat = r; j.etat = 'fini'; j.etape = 'Terminé'; j.n++; j.fin = Date.now(); })
    .catch(e => { stop(); if (j.etat !== 'en_cours') return; j.erreur = e.message || String(e); j.etat = 'erreur'; j.etape = 'Échec'; j.n++; j.fin = Date.now(); });
  return vue(j);
}

function annuler(id) {
  const j = JOBS.get(String(id));
  if (!j || j.etat !== 'en_cours') return null;
  j.etat = 'annule'; j.etape = 'Arrêté'; j.erreur = 'Arrêté.'; j.n++; j.fin = Date.now();
  j.ctrl.abort();
  return vue(j);
}

function lire(id) { const j = JOBS.get(String(id)); return j ? vue(j) : null; }
function enCours() { return [...JOBS.values()].filter(j => j.etat === 'en_cours').map(vue); }

module.exports = { lancer, lire, annuler, enCours, _JOBS: JOBS };
