const fs   = require('fs');
const path = require('path');
const { DATA_DIR, FILES } = require('../config/paths');
const { readJSON, writeJSON, withFileLock, readCfg, writeCfg } = require('../core/store');
const { foSessions } = require('../auth/sessions');

// ── RENOMMER UN AGENT PARTOUT ─────────────────────────────────
// Le nom d'un agent est sa clé dans toute l'appli : fo_list, fiches de
// performance, objectifs, tâches (assigned_to, modified_by), planning,
// tickets, brouillons de rapport, insights… Corriger une faute de frappe
// dans la seule liste des agents détachait donc l'agent de tout son
// historique. On réécrit ici chaque fichier de données : clés d'objet et
// valeurs texte, le nom entier seulement (« Jean DUPONT » dans
// « Jean DUPONT - FO » oui, « Jean » seul non), sans tenir compte de la
// casse.
//
// L'ancien nom est noté dans config.fo_renames : les navigateurs qui ont
// gardé l'ancien profil en mémoire locale le corrigent d'eux-mêmes.

const echapper = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function remplacerDans(valeur, re, nouveau, compte) {
  if (typeof valeur === 'string') {
    const n = valeur.replace(re, () => { compte.n++; return nouveau; });
    return n;
  }
  if (Array.isArray(valeur)) return valeur.map(v => remplacerDans(v, re, nouveau, compte));
  if (valeur && typeof valeur === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(valeur)) {
      let cle = k;
      if (re.test(k)) { re.lastIndex = 0; cle = k.replace(re, nouveau); compte.n++; }
      re.lastIndex = 0;
      // Clé déjà présente sous le nouveau nom (fusion) : la valeur renommée
      // complète l'existante plutôt que de l'écraser.
      const val = remplacerDans(v, re, nouveau, compte);
      if (cle in out && out[cle] && typeof out[cle] === 'object' && val && typeof val === 'object' && !Array.isArray(val))
        out[cle] = { ...val, ...out[cle] };
      else out[cle] = val;
    }
    return out;
  }
  return valeur;
}

function fichiersDeDonnees() {
  return fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(DATA_DIR, f));
}

// `fusion` : si l'agent cible existe déjà (doublon créé à la main), ses
// données et celles de l'ancien nom sont réunies sous le nouveau nom.
async function renommerAgent(ancien, nouveau, { fusion = false } = {}) {
  ancien = String(ancien || '').trim();
  nouveau = String(nouveau || '').trim().replace(/\s+/g, ' ');
  if (!ancien || !nouveau) throw Object.assign(new Error('Nom manquant.'), { status: 400 });
  if (ancien === nouveau) throw Object.assign(new Error('Le nom est identique.'), { status: 400 });
  if (nouveau.length > 80 || /[<>"]/.test(nouveau)) throw Object.assign(new Error('Nom invalide.'), { status: 400 });
  const cfg0 = readCfg();
  if (!(cfg0.fo_list || []).includes(ancien)) throw Object.assign(new Error('Agent inconnu.'), { status: 404 });
  const cible = (cfg0.fo_list || []).find(f => f !== ancien && f.toLowerCase() === nouveau.toLowerCase());
  if (cible && !fusion)
    throw Object.assign(new Error('Un autre agent porte déjà ce nom.'), { status: 409, fusionPossible: true });
  if (cible) nouveau = cible;   // on garde l'écriture exacte de l'existant

  // Nom entier, non collé à une autre lettre : « Jean DUPONT » ne doit pas
  // toucher « Jean DUPONTUE ».
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${echapper(ancien)}(?![\\p{L}\\p{N}])`, 'giu');
  const detail = {};
  for (const fichier of fichiersDeDonnees()) {
    await withFileLock(fichier, () => {
      const data = readJSON(fichier, undefined);
      if (data === undefined) return;
      const compte = { n: 0 };
      const neuf = remplacerDans(data, re, nouveau, compte);
      if (!compte.n) return;
      if (fichier === FILES.config) {
        // Fusion : le nom apparaît maintenant deux fois dans les listes.
        for (const [k, v] of Object.entries(neuf))
          if (Array.isArray(v) && v.every(x => typeof x === 'string')) neuf[k] = [...new Set(v)];
        neuf.fo_renames = { ...(neuf.fo_renames || {}), [ancien]: nouveau };
        writeCfg(neuf);
      } else writeJSON(fichier, neuf);
      detail[path.basename(fichier)] = compte.n;
    });
  }
  // Les consultations ouvertes suivent l'agent sous son nouveau nom.
  for (const s of foSessions.values()) if (s.fo === ancien) s.fo = nouveau;
  return { ancien, nouveau, fusion: !!cible, detail, total: Object.values(detail).reduce((a, b) => a + b, 0) };
}

// ── CORRECTIONS DE NOM DEMANDÉES ──────────────────────────────
// Appliquées une fois au démarrage, sur la machine où vivent les vraies
// données (la VM), après la sauvegarde quotidienne. Rejouer est sans effet :
// une fois l'ancien nom sorti de fo_list, il n'y a plus rien à faire.
// Liste propre à chaque déploiement : vide par défaut.
const CORRECTIONS = [];

async function appliquerCorrections(liste = CORRECTIONS) {
  for (const [ancien, nouveau] of liste) {
    if (!(readCfg().fo_list || []).includes(ancien)) continue;
    try {
      // Copie complète juste avant : la sauvegarde du jour peut dater de
      // ce matin, celle-ci est l'état exact d'avant le renommage.
      const dest = path.join(DATA_DIR, 'backups', `avant-renommage-${new Date().toISOString().replace(/[:.]/g, '-')}`);
      fs.mkdirSync(dest, { recursive: true });
      for (const f of fichiersDeDonnees()) fs.copyFileSync(f, path.join(dest, path.basename(f)));
      const r = await renommerAgent(ancien, nouveau, { fusion: true });
      require('../core/audit').addAudit('config', r.nouveau, 'system', 'fo-rename', { from: ancien, to: r.nouveau, total: r.total, fusion: r.fusion });
      console.log(`[Pearl] Agent renommé : ${ancien} → ${r.nouveau} (${r.total} mention(s)${r.fusion ? ', fusion' : ''}).`);
    } catch (e) { console.error(`[Pearl] Renommage ${ancien} → ${nouveau} : ${e.message}`); }
  }
}

module.exports = { renommerAgent, appliquerCorrections, CORRECTIONS };
