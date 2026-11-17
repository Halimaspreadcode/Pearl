// ══════════════════════════════════════════════════════════════
// RÉSULTATS ÉPINGLÉS SUR L'ACCUEIL DE PEARL AI
//
// Une réponse de skill épinglée devient un widget de l'accueil : elle
// survit au rechargement de la page (data/ai_pins.json), se relance avec
// les mêmes réglages (« Actualiser ») et se retire d'un clic. Seule la
// réponse déjà affichée à l'admin est gardée : rien de plus n'est lu.
// ══════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { FILES } = require('../config/paths');
const { readJSON, writeJSON, withFileLock } = require('../core/store');

const MAX_PINS = 12;
const MAX_OCTETS = 300 * 1024;   // une réponse épinglée, au plus

const lire = () => { const l = readJSON(FILES.ai_pins, []); return Array.isArray(l) ? l : []; };

// Seuls les champs d'une réponse de skill passent.
function resultatPropre(r) {
  const x = r || {};
  const out = { content: String(x.content || ''), vue: x.vue || null, data: x.data ?? null, faits: x.faits ?? null, vide: !!x.vide, meta: String(x.meta || '').slice(0, 200) };
  if (Buffer.byteLength(JSON.stringify(out)) > MAX_OCTETS) { const e = new Error('Réponse trop volumineuse pour être épinglée.'); e.status = 413; throw e; }
  return out;
}

function lister() { return lire(); }

async function ajouter({ skill, titre, input, resultat }) {
  if (!skill) { const e = new Error('Skill manquant.'); e.status = 400; throw e; }
  const pin = {
    id: crypto.randomBytes(6).toString('hex'), skill: String(skill).slice(0, 60), titre: String(titre || skill).slice(0, 120),
    input: input && typeof input === 'object' ? input : {}, resultat: resultatPropre(resultat),
    cree: new Date().toISOString(), maj: new Date().toISOString(),
  };
  return withFileLock(FILES.ai_pins, () => {
    const l = lire();
    if (l.length >= MAX_PINS) { const e = new Error(`${MAX_PINS} épingles au plus : retire-en une d'abord.`); e.status = 409; throw e; }
    l.unshift(pin);
    writeJSON(FILES.ai_pins, l);
    return pin;
  });
}

function retirer(id) {
  return withFileLock(FILES.ai_pins, () => {
    const l = lire();
    const reste = l.filter(p => p.id !== id);
    if (reste.length === l.length) return false;
    writeJSON(FILES.ai_pins, reste);
    return true;
  });
}

async function mettreAJour(id, resultat) {
  return withFileLock(FILES.ai_pins, () => {
    const l = lire();
    const p = l.find(x => x.id === id);
    if (!p) return null;
    p.resultat = resultatPropre(resultat);
    p.maj = new Date().toISOString();
    writeJSON(FILES.ai_pins, l);
    return p;
  });
}

const trouver = id => lire().find(p => p.id === id) || null;

module.exports = { lister, ajouter, retirer, mettreAJour, trouver, MAX_PINS };
