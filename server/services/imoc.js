// ── CONNECTEUR IMOC (tickets) ─────────────────────────────────
// IMOC (ESF / eTicket) est sur le même réseau que la VM. Son API de
// recherche de tickets attend une session ouverte par sa page de
// connexion et un jeton CSRF que son application pose elle-même.
//
// Plutôt que de reproduire ce mécanisme, FOps ouvre un navigateur
// invisible (le Chrome ou l'Edge déjà installé, piloté par
// playwright-core), se connecte comme une personne, ouvre la recherche de
// tickets, relève l'en-tête et le corps de la requête que l'application
// envoie, puis interroge la même adresse page par page.
//
// Identifiants : saisis par l'admin à chaque requête, gardés en mémoire
// le temps de celle-ci, jamais écrits (ni fichier, ni journal, ni audit).
// La session IMOC est fermée à la fin, quoi qu'il arrive.
const fs = require('fs');
const path = require('path');
const { FILES } = require('../config/paths');
const { readJSON, writeJSON } = require('../core/store');

// Deux IMOC sur le réseau, même logiciel : Sénégal et Côte d'Ivoire.
const INSTANCES_DEFAUT = [
  { id: 'sn', name: 'IMOC Sénégal', base_url: 'https://10.20.93.72', country: 'SN' },
  { id: 'ci', name: 'IMOC Côte d\'Ivoire', base_url: 'https://100.96.1.8', country: 'CI' },
];
const DEFAUTS = { browser_path: '', proxy: false };
const LIM = { pages: 60, taille: 50, attente_ms: 45000,
  // Fiches lues par requête (chacune pèse ~600 Ko) et en parallèle. Les
  // fiches non lues cette fois le seront à la requête suivante.
  fiches: 400, fiches_paralleles: 4 };
const CHEMIN_RECHERCHE = '/esf-web/index.html#/esfIframe?iframe_src=eticket.menu.ticketquery';
const LISTE_RE = /\/eticket\/order\/get\/list\/curstep\/\d+\/\d+/;

const adresse = v => {
  const u = String(v || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+$/i.test(u)) throw Object.assign(new Error(`Adresse invalide « ${u} » : ex. https://10.20.93.72`), { status: 400 });
  return u;
};
function lireConf() {
  const brut = readJSON(FILES.imoc, {}) || {};
  const c = { ...DEFAUTS, ...brut };
  // Ancien réglage à une seule adresse : c'est celle du Sénégal.
  const inst = Array.isArray(brut.instances) && brut.instances.length ? brut.instances
    : INSTANCES_DEFAUT.map(i => i.id === 'sn' && brut.base_url ? { ...i, base_url: brut.base_url } : i);
  c.instances = INSTANCES_DEFAUT.map(d => ({ ...d, ...(inst.find(i => i.id === d.id) || {}) }));
  delete c.base_url;
  return c;
}
const instance = (c, id) => c.instances.find(i => i.id === id) || c.instances[0];

function majConf(b = {}) {
  const c = lireConf();
  if (Array.isArray(b.instances)) {
    c.instances = c.instances.map(i => {
      const n = b.instances.find(x => x && x.id === i.id);
      if (!n) return i;
      return { ...i, base_url: n.base_url !== undefined ? adresse(n.base_url) : i.base_url,
        name: n.name !== undefined ? (String(n.name).trim().slice(0, 60) || i.name) : i.name };
    });
  }
  if (b.base_url !== undefined) c.instances[0].base_url = adresse(b.base_url);
  if (b.browser_path !== undefined) c.browser_path = String(b.browser_path).trim().slice(0, 400);
  if (b.proxy !== undefined) c.proxy = !!b.proxy;
  writeJSON(FILES.imoc, c);
  return vueConf();
}

// ── Navigateur ────────────────────────────────────────────────
function cheminsNavigateur() {
  const env = process.env;
  const l = [];
  if (env.IMOC_BROWSER) l.push(env.IMOC_BROWSER);
  if (process.platform === 'win32') {
    const pf = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
    pf.forEach(b => l.push(path.join(b, 'Google/Chrome/Application/chrome.exe'), path.join(b, 'Microsoft/Edge/Application/msedge.exe')));
  } else if (process.platform === 'darwin') {
    l.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else {
    l.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome', '/usr/bin/chromium',
      '/usr/bin/chromium-browser', '/usr/lib/chromium/chromium', '/usr/lib/chromium-browser/chromium-browser', '/usr/lib64/chromium-browser/chromium-browser',
      '/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/snap/bin/chromium', '/var/lib/snapd/snap/bin/chromium');
  }
  // Chromium installé par « npx playwright-core install chromium » (dans le
  // cache de l'utilisateur, sans droits administrateur).
  try { l.push(require('playwright-core').chromium.executablePath()); } catch {}
  l.push(...navigateursPlaywright());
  return l;
}
function navigateursPlaywright() {
  const racines = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(require('os').homedir(), '.cache', 'ms-playwright'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright')].filter(Boolean);
  const out = [];
  for (const r of racines) {
    let dossiers = [];
    try { dossiers = fs.readdirSync(r).filter(d => /^chromium/.test(d)).sort().reverse(); } catch { continue; }
    for (const d of dossiers) for (const sous of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-headless-shell-linux64/chrome-headless-shell',
      'chrome-linux/headless_shell', 'chrome-win/chrome.exe', 'chrome-win64/chrome.exe']) out.push(path.join(r, d, sous));
  }
  return out;
}
function navigateur(conf = lireConf()) {
  if (conf.browser_path) return fs.existsSync(conf.browser_path) ? conf.browser_path : null;
  return cheminsNavigateur().find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

const vueConf = () => {
  const c = lireConf();
  return { ...c, browser_found: navigateur(c), browser_candidates: c.browser_path ? [] : cheminsNavigateur() };
};

// ── Normalisation ─────────────────────────────────────────────
// OSN… → Sénégal, CI… / OCI… → Côte d'Ivoire.
function pays(num) {
  const n = String(num || '').toUpperCase();
  if (/^O?SN/.test(n)) return 'SN';
  if (/^O?CI/.test(n)) return 'CI';
  return '';
}
function normaliser(t, base, inst) {
  const groupes = (t.processGroups || []).map(g => g && g.groupName).filter(Boolean);
  const duree = Number(t.processDuration);
  return {
    number: t.orderNumber || '', id: t.orderId || '', title: t.orderName || '',
    type: t.modelNameEn || t.modelName || '', category: t.modelType || '',
    status: t.orderStatus || '', step: t.currentStepNameEn || t.currentStepName || '',
    groups: [...new Set(groupes)], handlers: String(t.currentUser || t.newCurrentUser || '').slice(0, 300),
    creator: t.applyUser || '', opened: t.beginTime || t.createTime || '', updated: t.modifyTime || '',
    closed: t.endTime || '', duration_s: Number.isFinite(duree) ? duree : null,
    sla_status: t.slaStatus || '', sla_level: t.slaLevel || '', vip: !!t.isVip,
    country: pays(t.orderNumber) || (inst && inst.country) || '', instance: inst ? inst.id : '', url: t.orderUrl ? `${base}${t.orderUrl.startsWith('/') ? '' : '/'}${t.orderUrl}` : '',
  };
}

// ── Fiche détaillée d'un ticket ───────────────────────────────
// /eticket/order/get/order renvoie le formulaire du ticket : une liste de
// champs par étape (FO Creation, BO Analyse and Resolve, FO Close), avec
// la valeur saisie dans fieldDefault. Les listes déroulantes donnent un
// code (« 4 », « OCI », « 604 ») que l'on traduit avec leurs options.
const VIDES_IMOC = new Set(['', ' ', 'none', 'group', '[]', 'null']);
// Champs repris sous un nom stable (le reste est gardé tel quel, avec son libellé).
const CLES_FICHE = {
  Oceane_Ticket: 'oceane', Created_on: 'created', Start_date: 'start', Initiator: 'initiator', Last_user: 'last_user',
  Last_Status: 'last_status', Resource_impact: 'impact', Resource_Ticket_type: 'ticket_type', Processing_priority: 'priority',
  Origin1: 'origin', Equipment_resource: 'equipment', Resource_Detailed_Nature: 'nature', Resource_type: 'resource_type',
  Country: 'country', Country_Internal: 'country_internal', External_Ticket_type: 'ext_ticket_type',
  External_Technical_impact: 'ext_impact', Managing_Owner_technician: 'technician', Freeze_dates: 'freeze',
  Unfreeze_date: 'unfreeze', Freeze_details: 'freeze_details', Restoration_dates: 'restoration', Resolution_dates: 'resolution',
  Closure_date: 'closure', Short_label: 'short_label', Final_natures: 'final_nature', Problems_family: 'problem_family',
  Resource_Problem_family: 'problem_detail', ETR_mins: 'etr_min', CTR_mins: 'ctr_min', DRI: 'initial_plan',
  Contractual_duration_of_support_unavail: 'support_unavail_min', Contractual_duration_of_service_unavail: 'service_unavail_min',
  Description: 'description',
};
const cleFiche = code => CLES_FICHE[code] || Object.entries(CLES_FICHE).find(([k]) => String(code).startsWith(k))?.[1] || null;
function libelleOption(f, v) {
  for (const o of f.optionList || []) {
    let liste; try { liste = JSON.parse(o.optionValue); } catch { liste = null; }
    for (const x of Array.isArray(liste) ? liste : [o]) {
      if (x && (String(x.optionValue) === String(v) || String(x.optionKey) === String(v))) return String(x.optionKey || v);
    }
  }
  return String(v);
}
const sansHtml = v => String(v).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').trim();
function ficheDe(o, logs, commentaires) {
  const etapes = Array.isArray(o.stepList) ? o.stepList : [];
  const courante = etapes.find(e => e.stepId === o.currentStepId) || etapes[etapes.length - 1] || { fieldList: [] };
  // Valeur d'un champ : celle de l'étape en cours, sinon la plus récente.
  const ordre = [courante, ...etapes.filter(e => e !== courante).reverse()];
  const vus = new Map();
  for (const e of ordre) for (const f of e.fieldList || []) {
    if (!f || !f.fieldCode || ['group', 'attachment', 'excel'].includes(f.fieldType)) continue;
    let v = f.fieldDefault;
    if (v === null || v === undefined || VIDES_IMOC.has(String(v).trim())) continue;
    if (vus.has(f.fieldCode)) continue;
    if (['select', 'checkbox', 'radio', 'multiselect'].includes(f.fieldType)) v = String(v).split(',').map(x => libelleOption(f, x.trim())).join(', ');
    else if (f.fieldType === 'editor') v = sansHtml(v);
    v = String(v).slice(0, 2000);
    if (!v.trim()) continue;
    vus.set(f.fieldCode, { code: f.fieldCode, label: f.fieldName || f.fieldCode, value: v, seq: f.fieldSeq || 0 });
  }
  const champs = [...vus.values()].sort((a, b) => a.seq - b.seq).map(({ seq, ...x }) => x);
  const d = { at: new Date().toISOString(), fields: champs };
  for (const c of champs) { const k = cleFiche(c.code); if (k && !d[k]) d[k] = c.value; }
  d.source = o.orderSource || '';
  d.logs = (Array.isArray(logs) ? logs : []).slice(0, 100).map(l => ({ step: l.stepName || '', user: l.userAccZh || l.handleUser || '', result: l.handleResult || '',
    opinion: String(l.handleOpinion || l.opinion || '').slice(0, 1000), at: l.handleTime || '' }));
  d.comments = (Array.isArray(commentaires) ? commentaires : []).slice(0, 100).map(c => ({ user: c.createBy || c.userName || c.author || '',
    at: c.createTime || c.commentTime || '', text: sansHtml(c.commentValue || c.content || c.comment || '').slice(0, 2000) })).filter(c => c.text);
  return d;
}

// ── Requête ───────────────────────────────────────────────────
const erreur = (msg, status = 400) => Object.assign(new Error(msg), { status });
const isoJour = (d, fin) => `${d}T${fin ? '23:59:59' : '00:00:00'}Z`;

// Champ du code de vérification : repéré par son nom, son identifiant, son
// texte d'aide ou sa classe. Seul un champ VISIBLE compte : beaucoup de
// pages de connexion portent un bloc captcha caché, affiché après échecs.
const CODE_RE = /captcha|verif|vcode|checkcode|authcode|validat|验证码|code/i;
const SAISIE = 'input:visible:not([type="password"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"])';

async function trouverChamps(page) {
  // Le formulaire peut être dans la page ou dans un cadre.
  for (const f of page.frames()) {
    const pw = f.locator('input[type="password"]:visible').first();
    if (!(await pw.count())) continue;
    const saisies = await f.locator(SAISIE).all();
    let user = null, code = null;
    for (const el of saisies) {
      const attrs = await el.evaluate(n => [n.name, n.id, n.placeholder, n.className, n.getAttribute('aria-label'), n.getAttribute('autocomplete')].join(' ')).catch(() => '');
      if (!code && CODE_RE.test(attrs) && !/user|account|login|name/i.test(attrs)) code = el;
      else if (!user) user = el;
    }
    return { f, pw, user, code };
  }
  return null;
}

// Image du code : une image ou un canevas visible près du champ ; à défaut,
// la ligne du formulaire qui porte le champ.
async function imageDuCode(champs) {
  const f = champs.f;
  const cands = [
    f.locator('img:visible[src*="captcha" i], img:visible[src*="verif" i], img:visible[src*="code" i], img:visible[class*="captcha" i], img:visible[id*="captcha" i]').first(),
    f.locator('canvas:visible').first(),
  ];
  for (const c of cands) if (await c.count()) return { cible: c, png: await c.screenshot() };
  const ligne = champs.code.locator('xpath=ancestor::*[self::div or self::li or self::tr][1]');
  const cible = (await ligne.count()) ? ligne : champs.code;
  return { cible, png: await cible.screenshot() };
}

/**
 * Se connecte, relève les tickets de la période, ferme la session.
 * `progres(texte)` reçoit les étapes. Les identifiants ne sortent pas d'ici.
 */
async function requete({ username, password, from, to, status, instance: instId }, progres = () => {}, { demanderCode } = {}) {
  const conf = lireConf();
  const inst = instance(conf, instId);
  if (!username || !password) throw erreur('Identifiant et mot de passe IMOC requis.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '') || from > to) throw erreur('Période invalide.');
  const exe = navigateur(conf);
  if (!exe && !(() => { try { require.resolve('playwright-core'); return true; } catch { return false; } })())
    throw erreur('Il manque la bibliothèque playwright-core sur le serveur : dans le dossier de FOps, lance « npm install » puis « npm run service:restart ».', 500);
  if (!exe) throw erreur(conf.browser_path
    ? `Navigateur introuvable à l'emplacement indiqué : ${conf.browser_path}`
    : 'Aucun navigateur trouvé sur le serveur. Sur la VM, dans le dossier de FOps : « npx playwright-core install chromium » (sans droits admin), '
      + 'ou « sudo apt install chromium ». Puis relance la requête.');
  let chromium;
  try { ({ chromium } = require('playwright-core')); }
  catch { throw erreur('Il manque la bibliothèque playwright-core sur le serveur : dans le dossier de FOps, lance « npm install » puis « npm run service:restart ».', 500); }
  const base = inst.base_url;
  let browser;
  const etapes = [];
  const pas = t => { etapes.push({ t, at: Date.now() }); progres(t); };
  try {
    pas(`Ouverture du navigateur (${inst.name})…`);
    browser = await chromium.launch({ executablePath: exe, headless: true, args: conf.proxy ? [] : ['--no-proxy-server'] });
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1366, height: 860 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(LIM.attente_ms);

    pas('Connexion à IMOC…');
    try { await page.goto(`${base}/esf-web/index.html`, { waitUntil: 'domcontentloaded', timeout: LIM.attente_ms }); }
    catch (e) { throw erreur(`${inst.name} injoignable depuis le serveur (${base}) : ${String(e.message).split('\n')[0].slice(0, 160)}`, 502); }

    // La page de connexion arrive après redirection : on attend le champ.
    let champs = null;
    for (let i = 0; i < 40 && !champs; i++) { champs = await trouverChamps(page); if (!champs) await page.waitForTimeout(500); }
    if (!champs) throw erreur('Page de connexion IMOC introuvable (aucun champ mot de passe).', 502);
    // Glisser un curseur (« slider ») ne se fait pas à distance.
    if (await champs.f.locator('[class*="slider" i]:visible:has([class*="verif" i]), [class*="slide-verify" i]:visible, [class*="nc_wrapper" i]:visible').count())
      throw erreur('IMOC demande de glisser un curseur pour se connecter : ce type de vérification ne peut pas se faire depuis FOps.', 502);

    // Jusqu'à 3 essais quand IMOC demande un code : l'admin le lit dans
    // FOps et le tape ; un code refusé donne une nouvelle image.
    let ok = false;
    for (let essai = 1; essai <= 3 && !ok; essai++) {
      if (champs.user) await champs.user.fill(username);
      await champs.pw.fill(password);
      if (champs.code) {
        if (!demanderCode) throw erreur('IMOC demande un code de vérification.', 502);
        let image = await imageDuCode(champs);
        let rep = null;
        for (let k = 0; k < 6; k++) {
          pas(essai > 1 ? 'Code refusé : saisis le nouveau code affiché…' : 'IMOC demande un code de vérification : saisis-le ci-dessous…');
          rep = await demanderCode({ image: image.png.toString('base64'), essai });
          if (!rep || !rep.refresh) break;
          // Une autre image : un clic sur l'image la renouvelle d'ordinaire.
          await image.cible.click().catch(() => {});
          await page.waitForTimeout(800);
          champs = (await trouverChamps(page)) || champs;
          image = await imageDuCode(champs);
        }
        if (!rep || !rep.code) throw erreur('Code de vérification non saisi.', 400);
        await champs.code.fill(String(rep.code).trim());
        pas('Connexion à IMOC…');
      }
      const bouton = champs.f.locator('button[type="submit"]:visible, input[type="submit"]:visible, button:visible:has-text("Log"), button:visible:has-text("Connexion"), button:visible:has-text("Se connecter"), button:visible:has-text("登录")').first();
      if (await bouton.count()) await bouton.click(); else await champs.pw.press('Enter');
      // Connexion réussie : le champ mot de passe disparaît.
      for (let i = 0; i < 40; i++) {
        await page.waitForTimeout(500);
        if (!(await trouverChamps(page))) { ok = true; break; }
      }
      if (ok) break;
      champs = await trouverChamps(page);
      if (!champs || !champs.code) break; // pas de code à refaire : identifiants refusés
    }
    if (!ok) throw erreur('IMOC a refusé la connexion : vérifie l\'identifiant, le mot de passe et le code.', 401);

    pas('Ouverture de la recherche de tickets…');
    const capture = page.waitForRequest(r => LISTE_RE.test(r.url()) && r.method() === 'POST', { timeout: LIM.attente_ms }).catch(() => null);
    await page.goto(`${base}${CHEMIN_RECHERCHE}`, { waitUntil: 'domcontentloaded' });
    const req = await capture;
    if (!req) throw erreur('La recherche de tickets n\'a pas répondu (droits sur le module eTicket ?).', 502);
    const h = req.headers();
    const entetes = { 'content-type': 'application/json;charset=UTF-8', accept: 'application/json, text/plain, */*' };
    ['x-csrf-token', 'x-imoc-req-src', 'x-requested-with'].forEach(k => { if (h[k]) entetes[k] = h[k]; });
    let modele = {};
    try { modele = JSON.parse(req.postData() || '{}'); } catch {}

    // Même requête que l'écran, avec notre période et notre statut.
    // Portée « tous les tickets » de l'écran de recherche (relevée dans IMOC) :
    // la même adresse sert aussi « mes tickets à traiter », bien plus courte.
    const corps = { ...modele, queryScope: 'all', pageType: 'allOrder', queryFlag: 'all', vipFilter: 'all',
      startDate: isoJour(from), endDate: isoJour(to, true), Date: [isoJour(from), isoJour(to, true)], orderStatus: status || '' };
    const tickets = [];
    let total = null;
    for (let n = 1; n <= LIM.pages; n++) {
      pas(total == null ? 'Lecture des tickets…' : `Lecture des tickets… ${tickets.length} / ${total}`);
      const r = await ctx.request.post(`${base}/eticket/order/get/list/curstep/${LIM.taille}/${n}`, { headers: entetes, data: corps, timeout: LIM.attente_ms });
      let d;
      try { d = await r.json(); } catch { d = null; }
      if (!r.ok() || !d || !Array.isArray(d.list)) throw erreur(`Réponse inattendue d'IMOC (HTTP ${r.status()}).`, 502);
      total = Number(d.total) || 0;
      d.list.forEach(t => tickets.push(normaliser(t, base, inst)));
      if (d.isLastPage || !d.hasNextPage || !d.list.length || tickets.length >= total) break;
    }

    // Fiches détaillées : seulement les tickets nouveaux ou modifiés depuis
    // la dernière lecture de leur fiche.
    const connus = lireBase().tickets;
    const aLire = tickets.filter(t => { const a = connus[t.number]; return t.id && (!a || !a.detail || a.detail_updated !== t.updated); }).slice(0, LIM.fiches);
    let lus = 0, echecs = 0;
    const post = async (chemin, data) => {
      const r = await ctx.request.post(`${base}${chemin}`, { headers: entetes, data, timeout: LIM.attente_ms });
      if (!r.ok()) throw new Error(`HTTP ${r.status()}`);
      const j = await r.json();
      return j && j.data !== undefined && j.flag !== undefined ? j.data : j;
    };
    const file = [...aLire];
    const ouvrier = async () => {
      for (let t = file.shift(); t; t = file.shift()) {
        try {
          const o = await post('/eticket/order/get/order', { orderNumber: t.number, source: 'page', orderId: t.id });
          if (!o || !Array.isArray(o.stepList)) throw new Error('fiche illisible');
          const [logs, com] = await Promise.all([
            post('/eticket/order/get/order/logs-detail', { orderId: t.id, queryFlag: '' }).catch(() => []),
            post('/eticket/order/comment/queryByOrderId', { orderId: t.id, queryFlag: '' }).catch(() => ({})),
          ]);
          t.detail = ficheDe(o, logs, com && com.list);
          t.detail_updated = t.updated;
        } catch { echecs++; }
        lus++;
        if (lus % 5 === 0 || lus === aLire.length) pas(`Lecture des fiches… ${lus} / ${aLire.length}`);
      }
    };
    if (aLire.length) {
      pas(`Lecture des fiches… 0 / ${aLire.length}`);
      await Promise.all(Array.from({ length: Math.min(LIM.fiches_paralleles, aLire.length) }, ouvrier));
    }

    pas('Déconnexion d\'IMOC…');
    // Au mieux : la déconnexion de la plateforme ; la fermeture du
    // navigateur efface de toute façon la session côté FOps.
    await ctx.request.post(`${base}/esf/iamservice/v1/auth/logout`, { headers: entetes, timeout: 8000 }).catch(() => null);

    const bilan = await fusionner(tickets, { instance: inst.id, instance_name: inst.name, from, to, status: status || '', total: total ?? tickets.length,
      details: aLire.length - echecs, details_failed: echecs });
    return { ...bilan, etapes };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ── Base locale des tickets ───────────────────────────────────
// Les tickets relevés sont gardés et s'accumulent d'une requête à l'autre :
// un ticket déjà connu est mis à jour (statut, étape…), un nouveau est
// ajouté. On garde aussi l'historique des requêtes (sans identifiants).
const lireBase = () => {
  const b = readJSON(FILES.imoc_tickets, null) || {};
  // Ancien format (un seul relevé) : repris tel quel.
  if (Array.isArray(b.tickets)) return { tickets: Object.fromEntries(b.tickets.map(t => [t.number, { ...t, first_seen: b.at, last_seen: b.at }])), runs: [] };
  return { tickets: b.tickets || {}, runs: b.runs || [] };
};
const { withFileLock } = require('../core/store');
const CHAMPS_SUIVIS = ['status', 'step', 'updated', 'closed', 'groups', 'handlers', 'sla_status'];
function fusionner(liste, meta) {
  return withFileLock(FILES.imoc_tickets, () => {
    const b = lireBase();
    const at = new Date().toISOString();
    let nouveaux = 0, modifies = 0;
    for (const t of liste) {
      if (!t.number) continue;
      const avant = b.tickets[t.number];
      if (!avant) { nouveaux++; b.tickets[t.number] = { ...t, first_seen: at, last_seen: at }; continue; }
      if (CHAMPS_SUIVIS.some(k => JSON.stringify(avant[k]) !== JSON.stringify(t[k]))) modifies++;
      b.tickets[t.number] = { ...avant, ...t, first_seen: avant.first_seen, last_seen: at };
    }
    const run = { at, ...meta, count: liste.length, new: nouveaux, updated: modifies };
    b.runs = [run, ...b.runs].slice(0, 100);
    writeJSON(FILES.imoc_tickets, b);
    return { ...run, stored: Object.keys(b.tickets).length };
  });
}
// Chaque ticket lu porte aussi qui l'a ouvert et qui le suit, reconnus
// parmi les FO, BO et parties prenantes (services/parties.js).
const base = () => {
  const b = lireBase();
  const parties = require('./parties');
  const ctx = parties.preparer();
  const tickets = Object.values(b.tickets).map(t => t.detail ? { ...t, qui: {
    initiator: t.detail.initiator ? parties.reconnaitre(t.detail.initiator, null, ctx) : null,
    technician: t.detail.technician ? parties.reconnaitre(t.detail.technician, null, ctx) : null,
  } } : t);
  return { tickets: tickets.sort((x, y) => String(y.opened).localeCompare(String(x.opened))), runs: b.runs };
};

module.exports = { lireConf, majConf, vueConf, navigateur, requete, base, fusionner, normaliser, pays, ficheDe };

// ══ Ajout aux trackers, sur validation de l'admin ══════════════
// Pour chaque ticket IMOC absent de FOps, une proposition de ticket FOps :
// ce qui se déduit est prérempli (et signalé comme déduit), le reste est à
// compléter. Rien n'est créé sans la validation de l'admin.
const { readCfg, readTracker, writeTracker } = require('../core/store');

// Oceane TT# : « OCEANE_Resource_2610M87721 » → « 2610M87721 ».
const oceaneDe = titre => ((/OCEANE[\s_-]*(?:Resource|Product|Service)?[\s_-]*([A-Z0-9][A-Z0-9-]{4,14})\b/i.exec(String(titre || '')) || [])[1] || '').toUpperCase();
// Dakar et Abidjan sont à l'heure UTC : l'heure IMOC est prise telle quelle.
const isoImoc = s => { const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/.exec(String(s || '')); return m ? `${m[1]}T${m[2].length === 5 ? m[2] + ':00' : m[2]}.000Z` : null; };
const statutFops = t => /^(closed|finished|completed|archiv)/i.test(t.status || '') || t.closed ? 'Resolved'
  : t.detail && (t.detail.resolution || t.detail.closure) ? 'Resolved'
  : /close|clôtur/i.test(t.step || '') ? 'Resolved' : 'In Progress';
// Date de clôture côté FOps : résolution, sinon clôture IMOC, sinon fin du ticket.
const finImoc = t => isoImoc((t.detail && (t.detail.resolution || t.detail.closure)) || t.closed || t.updated);
const paysFiche = d => /ivo|ivoire|\bci\b|oci/i.test(String(d && d.country || '')) ? 'ci' : /s[ée]n[ée]gal|\bsn\b|osn/i.test(String(d && d.country || '')) ? 'sn' : '';
const causeFiche = d => d ? [d.final_nature, d.problem_family, d.problem_detail].filter(Boolean).join(' · ') : '';

// Tous les FO connus : liste de la Configuration, membres des équipes de la
// rota (Dakar et Abidjan), FO rattachés à un tracker.
function tousLesFo(cfg) {
  const out = new Set((cfg.fo_list || []).filter(Boolean));
  for (const site of (cfg.rota_config && cfg.rota_config.sites) || []) for (const t of site.teams || []) for (const m of t.members || []) if (m) out.add(String(m).trim());
  for (const n of Object.keys(cfg.fo_trackers || {})) out.add(n);
  return [...out].sort((a, b) => a.localeCompare(b));
}

// ── FO responsable d'après la fiche IMOC ──
// « Managing Owner technician » = « EMOC FO Huawei CI TETI TETY  WILFRIED
// Franck » : on retire le préfixe d'organisation, puis on compare les mots
// du nom à ceux des FO connus (sans accents ni casse, dans n'importe quel
// ordre). Tous les mots d'un FO présents → c'est lui. Sinon, les plus
// proches sont proposés à l'admin.
const motsNom = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(m => m.length > 1);
const nomTechnicien = s => String(s || '').replace(/^\s*(EMOC\s+)?(FO|BO)\s+(Huawei\s+)?(CI|SN|OCI|OSN|Senegal|S[ée]n[ée]gal|Ivory\s+Coast|C[oô]te\s+d.Ivoire)?\s*/i, '').replace(/\s+/g, ' ').trim();
function foDeTechnicien(technicien, fos) {
  const nom = nomTechnicien(technicien);
  const cible = new Set(motsNom(nom));
  if (!cible.size) return { nom, fo: '', suggestions: [] };
  const scores = (fos || []).map(fo => {
    const m = motsNom(fo);
    if (!m.length) return { fo, score: 0 };
    const communs = m.filter(x => cible.has(x) || [...cible].some(c => c.length >= 4 && x.length >= 4 && (c.startsWith(x) || x.startsWith(c)))).length;
    return { fo, score: communs / m.length + (communs ? communs / (cible.size * 10) : 0) };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  const sur = scores[0] && scores[0].score >= 1 && (!scores[1] || scores[1].score < scores[0].score) ? scores[0].fo : '';
  return { nom, fo: sur, suggestions: scores.slice(0, 4).map(x => x.fo) };
}

function referentiel() {
  const cfg = readCfg();
  const types = [...new Set(Object.keys(cfg.sla_hours || {}).map(k => k.replace(/\s+P\d$/i, '')))];
  let bo = [];
  try { bo = (readJSON(FILES.bo, []) || []).map(b => b.phone ? `${b.name} ${b.phone}` : b.name).filter(Boolean); } catch {}
  return {
    types: types.length ? types : ['Incident', 'Problem Bug', 'Problem non Bug'],
    priorites: cfg.ticket_priorities || ['P1', 'P2', 'P3', 'P4'],
    severites: ['Critical', 'Major', 'Minor', 'Warning'],
    statuts: (cfg.ticket_statuses || ['Open', 'In Progress', 'On Hold', 'Resolved', 'Closed']).filter(s => s !== 'Closed'),
    domaines: cfg.domains || [], fos: tousLesFo(cfg), bos: bo, fo_ids: cfg.fo_ids || {},
  };
}

function existants() {
  const vus = new Map();
  for (const tr of ['sn', 'ci']) for (const t of readTracker(tr)) {
    if (t.imoc_tt) vus.set('i:' + String(t.imoc_tt).trim().toUpperCase(), { tracker: tr, id: t.id });
    if (t.sn_tt && !SANS_OCEANE(t.sn_tt)) vus.set('s:' + String(t.sn_tt).trim().toUpperCase(), { tracker: tr, id: t.id });
  }
  return vus;
}

function proposer(t, ref) {
  const deduit = [];
  const fiche = t.detail || null;
  const oc = (fiche && fiche.oceane ? String(fiche.oceane).trim().toUpperCase() : '') || oceaneDe(t.title);
  const ids = String(t.handlers || '').split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
  // FO : d'abord le « Managing Owner technician » de la fiche IMOC.
  const tech = fiche && fiche.technician ? foDeTechnicien(fiche.technician, ref.fos) : null;
  // Sans FO reconnu, le nom IMOC est repris tel quel : l'admin peut le
  // remplacer par l'une des propositions.
  const fo = (tech && (tech.fo || tech.nom))
    || (tech ? '' : Object.entries(ref.fo_ids).find(([, id]) => id && ids.includes(String(id).trim().toLowerCase()))?.[0]
      || Object.entries(ref.fo_ids).find(([, id]) => id && String(t.creator || '').toLowerCase() === String(id).toLowerCase())?.[0] || '');
  const texte = `${t.title} ${t.type} ${fiche ? `${fiche.final_nature || ''} ${fiche.equipment || ''} ${fiche.problem_family || ''}` : ''}`.toUpperCase();
  const domaine = ref.domaines.find(d => new RegExp(`(^|[^A-Z])${d.toUpperCase()}([^A-Z]|$)`).test(texte)) || '';
  const type = ref.types.find(x => /^incident$/i.test(x)) || ref.types[0];
  // Fiche IMOC : priorité, pays, dates et cause réelles plutôt que déduites.
  const prio = fiche && ref.priorites.includes(String(fiche.priority || '').toUpperCase()) ? String(fiche.priority).toUpperCase() : '';
  const tracker = paysFiche(fiche) || (t.country === 'CI' ? 'ci' : 'sn');
  const statut = statutFops(t);
  const f = {
    tracker, imoc_tt: t.number, sn_tt: oc, title: t.title, type,
    priority: prio, severity: '', status: statut, domain: domaine, fo_owner: fo,
    bo_handling: ref.bos.length === 1 ? ref.bos[0] : '',
    occur_time: isoImoc((fiche && fiche.start) || t.opened), open_date: isoImoc((fiche && fiche.created) || t.opened),
    workaround_date: fiche && fiche.restoration ? isoImoc(fiche.restoration) : null,
    close_date: statut === 'Resolved' ? finImoc(t) : null,
    root_cause: causeFiche(fiche),
  };
  if (oc) deduit.push('sn_tt'); if (t.country || paysFiche(fiche)) deduit.push('tracker'); deduit.push('type', 'status');
  if (domaine) deduit.push('domain'); if (fo) deduit.push('fo_owner'); if (prio) deduit.push('priority');
  if (fiche) deduit.push('occur_time', 'open_date');
  return { fields: f, deduced: deduit, fo_imoc: tech ? { nom: tech.nom, connu: !!tech.fo, suggestions: tech.suggestions } : null };
}

// « - » : pas de ticket Oceane pour ce ticket (accepté, jamais un doublon).
const SANS_OCEANE = v => /^\s*-\s*$/.test(String(v || ''));
const REQUIS = ['sn_tt', 'title', 'type', 'priority', 'severity', 'status', 'domain', 'fo_owner', 'bo_handling', 'occur_time', 'open_date'];

function candidats() {
  const b = lireBase();
  const ref = referentiel();
  const parties = require('./parties');
  const ctxP = parties.preparer();
  const vus = existants();
  const out = [];
  for (const t of Object.values(b.tickets)) {
    const oc = (t.detail && t.detail.oceane ? String(t.detail.oceane).toUpperCase() : '') || oceaneDe(t.title);
    const deja = vus.get('i:' + String(t.number).toUpperCase()) || (oc && !SANS_OCEANE(oc) && vus.get('s:' + oc));
    if (deja) continue;
    const p = proposer(t, ref);
    // Qui a ouvert le ticket dans IMOC (SMC, DRPS, FO…), reconnu ou non.
    const ini = t.detail && t.detail.initiator ? parties.reconnaitre(t.detail.initiator, null, ctxP) : null;
    if (ini) { p.fields.initiator = ini.sur ? ini.name : ini.nom; p.fields.initiator_role = ini.sur ? ini.role : ''; }
    out.push({ ticket: t, ignored: !!t.ignored, ...p, initiateur: ini });
  }
  out.sort((x, y) => String(y.ticket.opened).localeCompare(String(x.ticket.opened)));
  return { candidates: out, ref: { ...ref, fo_ids: undefined }, required: REQUIS };
}

function ignorer(numeros, ignore = true) {
  return withFileLock(FILES.imoc_tickets, () => {
    const b = lireBase();
    for (const n of numeros || []) if (b.tickets[n]) { if (ignore) b.tickets[n].ignored = true; else delete b.tickets[n].ignored; }
    writeJSON(FILES.imoc_tickets, b);
    return { ok: true };
  });
}

// Création des tickets validés. Mêmes règles que la saisie à la main
// (champs requis, type connu, pas de doublon), et le serveur revérifie
// tout : la page ne fait que proposer.
async function importer(items, auteur) {
  const ref = referentiel();
  const { majAttentes } = require('../core/holds');
  const { v4: uuidv4 } = require('uuid');
  const res = { created: [], refused: [] };
  const parTracker = { sn: [], ci: [] };
  const vus = existants();
  for (const it of items || []) {
    const f = { ...(it.fields || {}) };
    const tr = f.tracker === 'ci' ? 'ci' : f.tracker === 'sn' ? 'sn' : null;
    const manque = REQUIS.filter(k => !String(f[k] ?? '').trim());
    const err = !tr ? 'tracker inconnu' : manque.length ? `à compléter : ${manque.join(', ')}`
      : !ref.types.includes(f.type) ? `type inconnu « ${f.type} »`
      : vus.get('i:' + String(f.imoc_tt || '').toUpperCase()) || (!SANS_OCEANE(f.sn_tt) && vus.get('s:' + String(f.sn_tt).toUpperCase())) ? 'déjà dans un tracker'
      : String(f.sn_tt).length > 15 ? 'Oceane TT# trop long (15 caractères au plus)' : null;
    if (err) { res.refused.push({ number: f.imoc_tt || f.sn_tt, error: err }); continue; }
    vus.set('i:' + String(f.imoc_tt || '').toUpperCase(), true); if (!SANS_OCEANE(f.sn_tt)) vus.set('s:' + String(f.sn_tt).toUpperCase(), true);
    const champs = {};
    ['sn_tt', 'imoc_tt', 'title', 'type', 'priority', 'severity', 'status', 'domain', 'fo_owner', 'bo_handling', 'comments', 'root_cause', 'initiator', 'initiator_role']
      .forEach(k => { if (f[k] != null && f[k] !== '') champs[k] = String(f[k]).trim().slice(0, ['title', 'comments', 'root_cause'].includes(k) ? 500 : 120); });
    ['occur_time', 'open_date', 'close_date', 'workaround_date'].forEach(k => { const d = f[k] && new Date(f[k]); if (d && !isNaN(d)) champs[k] = d.toISOString(); });
    if (champs.status !== 'Resolved') delete champs.close_date;
    const ticket = { id: `${tr}-${uuidv4().slice(0, 8)}`, created_at: new Date().toISOString(), ...champs,
      source: 'imoc', modified_by: auteur || 'admin', modified_at: null };
    ticket.hold_periods = majAttentes(null, ticket);
    parTracker[tr].push(ticket);
    res.created.push({ number: f.imoc_tt, tracker: tr, id: ticket.id, sn_tt: ticket.sn_tt });
  }
  const trFile = tr => tr === 'sn' ? FILES.sn : FILES.ci;
  for (const tr of ['sn', 'ci']) if (parTracker[tr].length) {
    await withFileLock(trFile(tr), () => { const l = readTracker(tr); l.push(...parTracker[tr]); writeTracker(tr, l); });
  }
  return res;
}

module.exports.candidats = candidats;
module.exports.importer = importer;
module.exports.ignorer = ignorer;
module.exports.oceaneDe = oceaneDe;
module.exports.foDeTechnicien = foDeTechnicien;

// ══ Mises à jour des tickets déjà dans un tracker ══════════════
// Un ticket ajouté depuis IMOC (ou saisi avec le même n° IMOC) continue
// de vivre dans IMOC. À chaque requête, ce qui a changé là-bas est
// proposé ici ; rien n'est écrit sans la validation de l'admin.
//
// On ne propose que ce qu'IMOC sait mieux que FOps : la clôture (statut
// et date) et la réouverture. Le reste (On Hold, priorité, RCA…) est
// le travail de l'équipe et n'est jamais touché.
const FERMES = ['Resolved', 'Closed'];
function changementsDe(t, tr) {
  const fermeImoc = statutFops(t) === 'Resolved';
  const fermeFops = FERMES.includes(tr.status);
  const ch = {};
  let motif = '';
  if (fermeImoc && !fermeFops) {
    ch.status = { from: tr.status || '', to: 'Resolved' };
    const d = finImoc(t);
    if (d && d !== tr.close_date) ch.close_date = { from: tr.close_date || '', to: d };
    motif = 'Clôturé dans IMOC';
  } else if (fermeImoc && fermeFops && !tr.close_date) {
    const d = finImoc(t);
    if (d) { ch.close_date = { from: '', to: d }; motif = 'Date de clôture connue dans IMOC'; }
  } else if (!fermeImoc && fermeFops) {
    ch.status = { from: tr.status, to: 'In Progress' };
    if (tr.close_date) ch.close_date = { from: tr.close_date, to: '' };
    motif = 'Rouvert dans IMOC';
  }
  // Rétablissement connu dans IMOC, absent du tracker.
  const retab = t.detail && t.detail.restoration ? isoImoc(t.detail.restoration) : null;
  if (retab && !tr.workaround_date && FERMES.concat(['In Progress', 'Open', 'On Hold']).includes(ch.status ? ch.status.to : tr.status)) {
    ch.workaround_date = { from: '', to: retab };
    if (!motif) motif = 'Rétablissement connu dans IMOC';
  }
  return Object.keys(ch).length ? { changes: ch, motif } : null;
}
const cleSynchro = (n, ch) => `${n}|${JSON.stringify(ch)}`;

function synchros() {
  const b = lireBase();
  const out = [];
  for (const tr of ['sn', 'ci']) for (const x of readTracker(tr)) {
    const n = String(x.imoc_tt || '').trim().toUpperCase();
    if (!n) continue;
    const t = b.tickets[n] || Object.values(b.tickets).find(y => String(y.number).toUpperCase() === n);
    if (!t) continue;
    const c = changementsDe(t, x);
    if (!c) continue;
    out.push({ number: t.number, tracker: tr, id: x.id, sn_tt: x.sn_tt || '', title: x.title || t.title, fo_owner: x.fo_owner || '',
      imoc: { status: t.status, step: t.step, updated: t.updated, closed: t.closed, url: t.url },
      ...c, ignored: t.sync_ignore === cleSynchro(t.number, c.changes) });
  }
  out.sort((a, b) => String(b.imoc.updated).localeCompare(String(a.imoc.updated)));
  return { updates: out };
}

function ignorerSynchro(numeros, ignore = true) {
  const props = new Map(synchros().updates.map(u => [u.number, u]));
  return withFileLock(FILES.imoc_tickets, () => {
    const b = lireBase();
    for (const n of numeros || []) {
      const t = b.tickets[n]; const p = props.get(n);
      if (!t) continue;
      if (ignore && p) t.sync_ignore = cleSynchro(n, p.changes); else delete t.sync_ignore;
    }
    writeJSON(FILES.imoc_tickets, b);
    return { ok: true };
  });
}

// Applique les mises à jour validées. Tout est recalculé ici : la page ne
// fait que désigner les tickets.
async function appliquerSynchro(numeros, auteur) {
  const { majAttentes } = require('../core/holds');
  const voulus = new Set((numeros || []).map(n => String(n).toUpperCase()));
  const b = lireBase();
  const parNum = new Map(Object.values(b.tickets).map(t => [String(t.number).toUpperCase(), t]));
  const res = { applied: [], skipped: [] };
  const trFile = tr => tr === 'sn' ? FILES.sn : FILES.ci;
  for (const tr of ['sn', 'ci']) {
    await withFileLock(trFile(tr), () => {
      const l = readTracker(tr);
      let modifie = false;
      const now = new Date().toISOString();
      l.forEach((x, i) => {
        const n = String(x.imoc_tt || '').trim().toUpperCase();
        if (!voulus.has(n)) return;
        const t = parNum.get(n);
        const c = t && changementsDe(t, x);
        if (!c) { res.skipped.push({ number: n, error: 'plus rien à mettre à jour' }); return; }
        const apres = { ...x, modified_by: auteur || 'admin', modified_at: now, imoc_synced_at: now };
        for (const [k, v] of Object.entries(c.changes)) { if (v.to === '') delete apres[k]; else apres[k] = v.to; }
        if (FERMES.includes(apres.status) && !FERMES.includes(x.status)) { apres.closed_by = auteur || 'admin'; apres.closed_by_at = now; }
        if (!FERMES.includes(apres.status) && FERMES.includes(x.status)) { delete apres.closed_by; delete apres.closed_by_at; }
        apres.hold_periods = majAttentes(x, apres);
        l[i] = apres; modifie = true;
        res.applied.push({ number: n, tracker: tr, id: x.id, changes: c.changes });
      });
      if (modifie) writeTracker(tr, l);
    });
  }
  return res;
}

module.exports.synchros = synchros;
module.exports.ignorerSynchro = ignorerSynchro;
module.exports.appliquerSynchro = appliquerSynchro;
