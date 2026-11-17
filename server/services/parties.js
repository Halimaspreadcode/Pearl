// ══════════════════════════════════════════════════════════════
// RÔLES ET PARTIES PRENANTES
//
// FO et BO ne sont pas les seuls à intervenir sur un ticket : le SMC, la
// DRPS, l'exploitation réseau… ouvrent ou suivent des incidents. L'admin
// crée ici d'autres rôles (« SMC — Service Management Center ») et y
// range des personnes, avec le pays et les graphies sous lesquelles
// elles apparaissent ailleurs (IMOC : « DRPS/DEX/SMC-N/QSM FAYE PAPA
// TAHIROU »).
//
// Un rôle créé ici est un rôle à part entière : session nominative (le
// code personnel), vue par profil de la barre latérale, présence,
// reconnaissance dans IMOC.
//
// Stockage : config.parties = { roles: [...], people: [...] }, écrit par
// ses propres routes (jamais par PUT /api/config, qui l'écraserait).
// ══════════════════════════════════════════════════════════════
const crypto = require('crypto');
const { FILES } = require('../config/paths');
const { readCfg, writeCfg, withFileLock, readBO } = require('../core/store');

// FO et BO restent définis par leurs listes historiques (Configuration ›
// Général) : ils figurent ici en lecture, pour l'affichage.
const RESERVES = ['FO', 'BO', 'OBSERVER', 'GUEST', 'ADMIN', 'INVALID'];
const COULEURS = ['#3D7FD9', '#8E5BD9', '#2E9E5B', '#E8833A', '#D64545', '#14B8A6', '#B8860B', '#EC4899'];
const PAYS = { SN: 'Sénégal', CI: 'Côte d\'Ivoire', '': '—' };

const str = (v, n) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, n);
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const mots = s => norm(s).split(/[^a-z0-9]+/).filter(m => m.length > 1);

function lire(cfg = readCfg()) {
  const p = cfg.parties && typeof cfg.parties === 'object' ? cfg.parties : {};
  return { roles: Array.isArray(p.roles) ? p.roles : [], people: Array.isArray(p.people) ? p.people : [] };
}
function ecrire(mut) {
  return withFileLock(FILES.config, () => {
    const cfg = readCfg();
    const p = lire(cfg);
    const r = mut(p, cfg);
    cfg.parties = p;
    writeCfg(cfg);
    return r;
  });
}

// ── Rôles ──
async function majRole(b) {
  const label = str(b.label, 60);
  let key = str(b.key || label.split(/[\s—–-]/)[0], 16).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (!label) throw Object.assign(new Error('Donne un nom au rôle (ex. SMC — Service Management Center).'), { status: 400 });
  if (!key) throw Object.assign(new Error('Sigle du rôle invalide (lettres et chiffres).'), { status: 400 });
  if (RESERVES.includes(key)) throw Object.assign(new Error(`« ${key} » est déjà un rôle de FOps : choisis un autre sigle.`), { status: 400 });
  return ecrire(p => {
    const i = p.roles.findIndex(r => r.key === (b.ancien || key));
    if (i < 0 && p.roles.some(r => r.key === key)) throw Object.assign(new Error(`Le rôle ${key} existe déjà.`), { status: 409 });
    const role = { key, label, desc: str(b.desc, 200), color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : COULEURS[p.roles.length % COULEURS.length] };
    if (i >= 0) {
      const avant = p.roles[i].key;
      p.roles[i] = role;
      if (avant !== key) p.people.forEach(x => { if (x.role === avant) x.role = key; });
    } else p.roles.push(role);
    return role;
  });
}
async function retirerRole(key) {
  return ecrire(p => {
    const n = p.people.filter(x => x.role === key).length;
    if (n) throw Object.assign(new Error(`${n} personne${n > 1 ? 's ont' : ' a'} ce rôle : change leur rôle ou retire-les d'abord.`), { status: 409 });
    const avant = p.roles.length;
    p.roles = p.roles.filter(r => r.key !== key);
    if (p.roles.length === avant) throw Object.assign(new Error('Rôle introuvable.'), { status: 404 });
    return { ok: true };
  });
}

// ── Personnes ──
async function majPersonne(b) {
  const name = str(b.name, 80);
  if (!name || /[<>"]/.test(name)) throw Object.assign(new Error('Nom invalide.'), { status: 400 });
  return ecrire((p, cfg) => {
    if (!p.roles.some(r => r.key === b.role)) throw Object.assign(new Error('Choisis un rôle existant.'), { status: 400 });
    const aliases = [...new Set((Array.isArray(b.aliases) ? b.aliases : String(b.aliases || '').split('\n')).map(a => str(a, 120)).filter(Boolean))].slice(0, 20);
    const i = b.id ? p.people.findIndex(x => x.id === b.id) : -1;
    const doublon = p.people.find((x, k) => k !== i && norm(x.name) === norm(name));
    if (doublon) throw Object.assign(new Error(`${doublon.name} existe déjà.`), { status: 409 });
    if ((cfg.fo_list || []).some(f => norm(f) === norm(name))) throw Object.assign(new Error(`${name} est déjà dans la liste des FO.`), { status: 409 });
    const x = { id: i >= 0 ? p.people[i].id : crypto.randomBytes(5).toString('hex'), name, role: b.role,
      country: ['SN', 'CI'].includes(b.country) ? b.country : '', aliases,
      email: str(b.email, 120), phone: str(b.phone, 40), note: str(b.note, 200) };
    if (i >= 0) p.people[i] = x; else p.people.push(x);
    return x;
  });
}
async function retirerPersonne(id) {
  return ecrire(p => {
    const avant = p.people.length;
    p.people = p.people.filter(x => x.id !== id);
    if (p.people.length === avant) throw Object.assign(new Error('Personne introuvable.'), { status: 404 });
    return { ok: true };
  });
}
// Graphie vue ailleurs (IMOC…) rattachée à une personne : elle sera
// reconnue d'office la prochaine fois.
async function ajouterAlias(id, alias) {
  const a = str(alias, 120);
  if (!a) throw Object.assign(new Error('Graphie vide.'), { status: 400 });
  return ecrire(p => {
    const x = p.people.find(y => y.id === id);
    if (!x) throw Object.assign(new Error('Personne introuvable.'), { status: 404 });
    if (!x.aliases.some(y => norm(y) === norm(a))) x.aliases = [...x.aliases, a].slice(-20);
    return x;
  });
}

// ── Rôle d'une personne (sessions, présence, vues par profil) ──
function roleDe(nom, cfg = readCfg()) {
  if ((cfg.fo_list || []).includes(nom)) return 'FO';
  if (readBO().some(b => b && b.name === nom)) return 'BO';
  const x = lire(cfg).people.find(y => norm(y.name) === norm(nom));
  return x ? x.role : 'Observer';
}

// ── Reconnaissance d'un nom écrit ailleurs ──
// « DRPS/DEX/SMC-N/QSM FAYE PAPA TAHIROU », « EMOC FO Huawei CI TETI
// TETY WILFRIED Franck » : un chemin d'organisation (avec des « / ») ou un
// préfixe EMOC, puis le nom. On sépare les deux, on cherche le nom parmi
// tout le monde (FO, BO, parties prenantes, et leurs graphies connues).
function decouper(texte) {
  let t = str(texte, 200);
  let org = '';
  const m = /^(\S*\/\S*)\s+(.+)$/.exec(t);                    // DRPS/DEX/SMC-N/QSM NOM…
  if (m) { org = m[1]; t = m[2]; }
  const e = /^(EMOC\s+)?(FO|BO)\s+(Huawei\s+)?(CI|SN|OCI|OSN)?\s*(.+)$/i.exec(t);
  if (e && (e[1] || e[3])) { org = [org, `${e[1] || ''}${e[2]} ${e[3] || ''}${e[4] || ''}`.trim()].filter(Boolean).join(' '); t = e[5]; }
  return { org, nom: t.trim() };
}
const titre = s => String(s).toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

function annuaire(cfg = readCfg()) {
  const out = [];
  const fo = new Set((cfg.fo_list || []).filter(Boolean));
  for (const site of (cfg.rota_config && cfg.rota_config.sites) || []) for (const t of site.teams || []) for (const n of t.members || []) if (n) fo.add(String(n).trim());
  fo.forEach(n => out.push({ name: n, role: 'FO', aliases: [] }));
  try { readBO().forEach(b => b && b.name && out.push({ name: b.name, role: 'BO', aliases: [] })); } catch {}
  lire(cfg).people.forEach(x => out.push({ name: x.name, role: x.role, country: x.country, aliases: x.aliases || [], id: x.id }));
  return out;
}

// Contexte préparé une fois pour reconnaître beaucoup de noms d'affilée
// (une liste de tickets).
function preparer(cfg = readCfg()) {
  const p = lire(cfg);
  return { p, roles: new Map(p.roles.map(r => [r.key, r])), gens: annuaire(cfg) };
}
function reconnaitre(texte, cfg, ctx) {
  const brut = str(texte, 200);
  if (!brut) return null;
  const { org, nom } = decouper(brut);
  const { p, roles, gens } = ctx || preparer(cfg || readCfg());
  const lib = k => k === 'FO' ? 'Front Office' : k === 'BO' ? 'Back Office' : (roles.get(k) || {}).label || k;
  // Rôle que le chemin d'organisation laisse deviner (SMC-N → SMC).
  const orgMots = new Set(norm(org).split(/[^a-z0-9]+/).filter(Boolean).flatMap(x => [x, x.replace(/-?[a-z]$/, '')]));
  const roleOrg = p.roles.find(r => orgMots.has(norm(r.key))) || null;
  const habiller = (x, sur) => ({ brut, org, nom: titre(nom), sur, name: x.name, role: x.role, role_label: lib(x.role),
    color: x.role === 'FO' ? '#141518' : x.role === 'BO' ? '#6B6E76' : (roles.get(x.role) || {}).color, country: x.country || '', id: x.id || null });
  // 1. Graphie déjà rattachée.
  const parAlias = gens.find(x => (x.aliases || []).some(a => norm(a) === norm(brut)));
  if (parAlias) return { ...habiller(parAlias, true), via: 'graphie connue' };
  // 2. Mots du nom.
  const cible = new Set(mots(nom));
  const scores = gens.map(x => {
    const m = mots(x.name);
    const communs = m.filter(w => cible.has(w)).length;
    return { x, s: m.length ? communs / m.length + communs / (cible.size * 10 || 1) : 0 };
  }).filter(y => y.s > 0).sort((a, b) => b.s - a.s);
  const top = scores[0];
  if (top && top.s >= 1 && (!scores[1] || scores[1].s < top.s)) return { ...habiller(top.x, true), via: 'nom' };
  return { brut, org, nom: titre(nom), sur: false, name: '', role: '', role_label: '', suggestions: scores.slice(0, 4).map(y => habiller(y.x, false)),
    role_devine: roleOrg ? roleOrg.key : '' };
}

const vue = (cfg = readCfg()) => ({ ...lire(cfg), pays: PAYS, fo: (cfg.fo_list || []).length, bo: (() => { try { return readBO().length; } catch { return 0; } })() });

module.exports = { preparer, lire, vue, majRole, retirerRole, majPersonne, retirerPersonne, ajouterAlias, roleDe, reconnaitre, decouper, annuaire };
