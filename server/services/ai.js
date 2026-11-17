const fs   = require('fs');
const { FILES } = require('../config/paths');

// ══════════════════════════════════════════════════════════════
// ASSISTANT IA (essai, admin seulement)
//
// Le serveur est le seul à parler au modèle : le navigateur n'a jamais
// la clé, il envoie ses messages à /api/ai/chat, réservé à l'admin.
//
// La clé :
//   · AI_API_KEY dans l'environnement, sinon data/ai.secret, écrit depuis
//     la page. Ce fichier est exclu de git (data/ est versionné, .env
//     aussi : ni l'un ni l'autre ne doit porter la clé) et des sauvegardes
//     quotidiennes, qui ne copient que les .json. Droits 0600.
//   · Jamais renvoyée au client : la page n'en voit que les 4 derniers
//     caractères, pour savoir laquelle est en place.
//   · Changer l'adresse du service efface la clé enregistrée, sauf si une
//     nouvelle est donnée dans la même requête : une session admin volée
//     ne peut pas rediriger la clé existante vers un serveur à elle.
//
// Le transport : HTTPS exigé, la clé partant dans l'en-tête Authorization.
// HTTP n'est accepté qu'avec AI_ALLOW_HTTP=1 posé sur le serveur, choix
// délibéré de l'exploitant (réseau interne), jamais depuis la page.
// ══════════════════════════════════════════════════════════════

const DEFAUT = {
  base_url: 'https://api.anthropic.com/v1',
  model:    'claude-sonnet-5-5',
};

// ── Tunnel SSH depuis le poste ──
// La VM qui héberge Pearl n'a pas accès au réseau de l'entreprise ; le
// poste de l'admin, si. Un tunnel lancé depuis le poste
// (ssh -R PORT:<hôte du modèle>:80 utilisateur@VM) ouvre sur la VM
// un port local qui mène au service. Réglages correspondants, posés d'un
// clic par le bouton « Connecter via le tunnel ».
const TUNNEL = {
  port:  18080,
  host:  'ai.example.internal',
  remote_port: 80,
  model: 'qwen-aw-35b',
};
const LOCAUX = ['127.0.0.1', 'localhost', '[::1]', '::1'];
const estLocal = url => { try { return LOCAUX.includes(new URL(url).hostname); } catch { return false; } };
// Vers le tunnel, la requête porte le vrai nom du service : un serveur qui
// répond selon le nom demandé renverrait 404 à « 127.0.0.1 ».
function enteteHote(base) {
  // Seulement en HTTP : en HTTPS, le nom sert aussi à vérifier le
  // certificat, qui est celui de la machine locale.
  if (!estLocal(base) || !String(base).startsWith('http:')) return {};
  return { host: lireFichier().service_host || TUNNEL.host };
}

// Bornes d'une conversation : assez pour un vrai échange, pas assez pour
// faire de la page un tuyau d'export de données vers l'extérieur.
const LIMITES = {
  messages:      40,
  chars_message: 8000,
  chars_total:   40000,
  max_tokens:    6000,
  // Second essai quand un modèle à raisonnement a tout dépensé à réfléchir,
  // ou qu'une réponse structurée a été coupée.
  max_tokens_retry: 8000,
  timeout_ms:    90000,
  // Un skill en arrière-plan n'a personne qui attend devant un sablier :
  // un gros modèle peut prendre son temps.
  timeout_fond_ms: 240000,
};

const SYSTEM = [
  "Tu es Pearl AI, l'assistant de l'équipe (suivi d'activité : tickets,",
  "délais, plannings, absences, objectifs, rapports). Réponds en français,",
  "de façon concise et concrète. Si une information te manque, dis-le plutôt",
  "que de l'inventer.",
].join(' ');

const httpAutorise = () => process.env.AI_ALLOW_HTTP === '1';

// ── Proxy sortant ──
// Le fetch de Node ignore le proxy du système : sur un poste d'entreprise
// qui ne sort que par un proxy, le serveur ne trouvait même pas le nom du
// service (ENOTFOUND), alors que le navigateur, lui, passait.
//
// Trois modes, choisis dans la page :
//   · auto   (défaut) : AI_PROXY, sinon HTTPS_PROXY / HTTP_PROXY, sinon le
//                       proxy de Windows (Paramètres › Réseau › Proxy) ;
//   · manual : l'adresse saisie dans la page ;
//   · none   : connexion directe.
// L'identifiant et le mot de passe du proxy se saisissent à part et sont
// encodés ici : un « @ » ou un « : » dans le mot de passe cassait l'adresse
// quand il fallait les écrire dedans.

// Proxy configuré dans Windows (registre de l'utilisateur qui fait
// tourner le serveur). Relu toutes les 5 minutes au plus.
let _winCache = { at: 0, val: null };
function proxyWindows() {
  if (process.platform !== 'win32') return null;
  if (Date.now() - _winCache.at < 5 * 60 * 1000) return _winCache.val;
  let val = null;
  try {
    const out = require('child_process').execFileSync('reg', ['query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],
      { encoding: 'utf8', timeout: 3000, windowsHide: true });
    val = lireRegistreProxy(out);
  } catch { val = null; }
  _winCache = { at: Date.now(), val };
  return val;
}
// Séparé pour être testé hors Windows.
function lireRegistreProxy(out) {
  const champ = n => { const m = new RegExp(`^\\s*${n}\\s+REG_\\w+\\s+(.*)$`, 'mi').exec(out || ''); return m ? m[1].trim() : ''; };
  const actif = /^0x0*1$/i.test(champ('ProxyEnable'));
  const pac = champ('AutoConfigURL');
  let serveur = champ('ProxyServer');
  // « http=h:p;https=h:p » : on prend l'entrée https, sinon http.
  if (/=/.test(serveur)) {
    const parts = Object.fromEntries(serveur.split(';').map(x => x.split('=').map(y => y.trim())).filter(x => x.length === 2));
    serveur = parts.https || parts.http || '';
  }
  if (serveur && !/^\w+:\/\//.test(serveur)) serveur = 'http://' + serveur;
  return { actif: actif && !!serveur, url: serveur, exceptions: champ('ProxyOverride'), pac };
}
// Exceptions Windows : « *.domaine;adresse;<local> ».
function horsProxyWindows(hote, exceptions) {
  return String(exceptions || '').split(';').map(x => x.trim().toLowerCase()).filter(Boolean).some(e => {
    if (e === '<local>') return !hote.includes('.');
    const re = new RegExp('^' + e.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    return re.test(hote);
  });
}
function horsProxyEnv(hote) {
  const no = String(process.env.NO_PROXY || process.env.no_proxy || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  return no.some(n => n === '*' || hote === n.replace(/^\./, '') || hote.endsWith(n.startsWith('.') ? n : '.' + n));
}

// Proxy retenu pour une adresse : { url, source } ou null (direct).
function proxyChoisi(cible) {
  const f = lireFichier();
  const u = new URL(cible);
  const hote = u.hostname.toLowerCase();
  if (process.env.AI_PROXY) return { url: process.env.AI_PROXY, source: 'env' };
  const mode = f.proxy_mode || (f.proxy ? 'manual' : 'auto');
  if (mode === 'none') return null;
  if (mode === 'manual') return f.proxy ? { url: f.proxy, source: 'page' } : null;
  // Mode automatique : la machine elle-même (tunnel SSH) ne passe pas par
  // le proxy du système. Un proxy choisi à la main reste respecté.
  if (['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hote)) return null;
  const envP = (u.protocol === 'https:' ? (process.env.HTTPS_PROXY || process.env.https_proxy) : null)
    || process.env.HTTP_PROXY || process.env.http_proxy;
  if (envP) return horsProxyEnv(hote) ? null : { url: envP, source: 'système (variables)' };
  const w = proxyWindows();
  if (w && w.actif && !horsProxyWindows(hote, w.exceptions)) return { url: w.url, source: 'Windows' };
  return null;
}
// Adresse complète du proxy, identifiants de la page compris (encodés).
function proxyAvecIdentifiants(p) {
  if (!p) return '';
  const f = lireFichier();
  const x = new URL(p.url);
  if (!x.username && f.proxy_user) {
    x.username = encodeURIComponent(f.proxy_user);
    x.password = encodeURIComponent(f.proxy_pass || '');
  }
  return x.toString().replace(/\/$/, '');
}
function proxyPour(cible) { return proxyAvecIdentifiants(proxyChoisi(cible)); }

// Pour l'affichage : hôte et port, jamais d'identifiants.
function proxyAffiche(p) {
  try { const x = new URL(p); return `${x.hostname}${x.port ? ':' + x.port : ''}`; } catch { return 'proxy'; }
}

// Certificats : ceux de Node, plus ceux du système (magasin Windows).
// Un proxy d'entreprise qui inspecte le HTTPS présente son propre
// certificat, que le navigateur accepte parce qu'il est dans le magasin
// Windows, mais que Node refusait.
let _ca = null;
function certificats() {
  if (_ca !== null) return _ca;
  const tls = require('tls');
  let base = null;
  try {
    if (typeof tls.getCACertificates === 'function') {
      base = [...new Set([...tls.getCACertificates('default'), ...tls.getCACertificates('system')])];
    }
  } catch { base = null; }
  // Certificat de l'entreprise collé dans la page : ajouté à la liste,
  // sans redémarrage ni NODE_EXTRA_CA_CERTS (nécessaire avant Node 22.15).
  const pem = lireFichier().ca_pem;
  if (pem) base = [...(base || tls.rootCertificates), ...decouperPem(pem)];
  _ca = base || undefined;
  return _ca;
}
function decouperPem(pem) {
  return String(pem || '').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
}
// Réglages réseau modifiés : agents et certificats à reconstruire.
function reinitialiserReseau() { _ca = null; for (const a of _agents.values()) { try { a.close(); } catch {} } _agents.clear(); }

const _agents = new Map();
function agentPour(proxy) {
  const cle = proxy || 'direct';
  if (_agents.has(cle)) return _agents.get(cle);
  const undici = require('undici');
  const ca = certificats();
  const tlsOpts = ca ? { ca } : {};
  const a = proxy
    ? new undici.ProxyAgent({ uri: proxy, requestTls: tlsOpts, proxyTls: tlsOpts })
    : new undici.Agent({ connect: tlsOpts });
  _agents.set(cle, a);
  return a;
}
// Tous les appels au modèle passent par undici.request, proxy ou non :
// certificats du système, et des erreurs qui gardent leur cause. Le
// fetch d'undici masquait le refus du proxy (« Request was cancelled »
// au lieu de « Proxy response (407) »). Aucune redirection n'est suivie :
// elle emporterait la clé ailleurs, on la traite comme une erreur.
// Renvoie un objet au format de fetch (ok, status, text()).
async function appelHttp(url, init = {}, proxy) {
  const undici = require('undici');
  const r = await undici.request(url, {
    method: init.method || 'GET',
    headers: init.headers,
    body: init.body,
    signal: init.signal,
    dispatcher: agentPour(proxy),
  });
  const texte = await r.body.text();
  return { ok: r.statusCode >= 200 && r.statusCode < 300, status: r.statusCode, text: async () => texte };
}
// Garde la signature utilisée par chat().
function fetchVia(proxy) {
  return { fetch: (u, i) => appelHttp(u, i, proxy), opts: {} };
}

// « Service injoignable » ne dit pas pourquoi. Le code réseau, si : on le
// traduit en cause probable et en action.
function causeReseau(e, base, proxy) {
  const code = [e?.cause?.code, e?.code].find(x => typeof x === 'string' && x) || '';
  const c = code || (e?.name === 'AbortError' ? 'AbortError' : '');
  const hote = (() => { try { return new URL(base).host; } catch { return base; } })();
  const via = proxy ? ` via le proxy ${proxyAffiche(proxy)}` : '';
  const T = {
    ENOTFOUND:   `le serveur ne trouve pas ${hote} (DNS). Il n'a peut-être pas accès à Internet, ou doit passer par un proxy (champ Proxy des réglages).`,
    EAI_AGAIN:   `résolution DNS de ${hote} impossible pour l'instant (DNS du serveur).`,
    ECONNREFUSED:`${hote} refuse la connexion${via}. Mauvais port ou protocole : essayez l'autre (http/https, avec AI_ALLOW_HTTP=1 pour http).`,
    ECONNRESET:  `connexion coupée${via}, souvent un pare-feu ou un proxy qui filtre.`,
    ETIMEDOUT:   `aucune réponse de ${hote}${via} : pare-feu, ou proxy d'entreprise requis (champ Proxy des réglages).`,
    UND_ERR_CONNECT_TIMEOUT: `aucune réponse de ${hote}${via} : pare-feu, ou proxy d'entreprise requis (champ Proxy des réglages).`,
    UND_ERR_SOCKET: `connexion interrompue${via}, souvent un pare-feu ou un proxy.`,
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: `certificat de ${hote} non reconnu : un proxy d'inspection le remplace sans doute. Collez le certificat racine de l'entreprise dans les réglages (Certificat de l'entreprise).`,
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY: `émetteur du certificat de ${hote} inconnu : proxy d'inspection probable. Collez le certificat racine de l'entreprise dans les réglages (Certificat de l'entreprise).`,
    SELF_SIGNED_CERT_IN_CHAIN: `certificat auto-signé dans la chaîne (proxy d'inspection) : collez le certificat racine de l'entreprise dans les réglages (Certificat de l'entreprise).`,
    DEPTH_ZERO_SELF_SIGNED_CERT: `certificat auto-signé sur ${hote} : collez-le dans les réglages (Certificat de l'entreprise).`,
    CERT_HAS_EXPIRED: `certificat de ${hote} expiré.`,
    ERR_TLS_CERT_ALTNAME_INVALID: `le certificat ne correspond pas à ${hote}.`,
    EPROTO: `échec TLS : le port parle peut-être HTTP et non HTTPS.`,
    ERR_SSL_WRONG_VERSION_NUMBER: `échec TLS : le port parle HTTP et non HTTPS. Essayez http:// avec AI_ALLOW_HTTP=1.`,
    UND_ERR_ABORTED: '', AbortError: '',
  };
  const pr = /Proxy response \((\d{3})\)/.exec(String(e?.message || '') + ' ' + String(e?.cause?.message || ''));
  if (pr) {
    const st = Number(pr[1]);
    const nom = proxy ? proxyAffiche(proxy) : 'proxy';
    if (st === 407) return `Le proxy ${nom} demande une identification (407) : renseignez l'identifiant et le mot de passe du proxy dans les réglages. S'il n'accepte que l'authentification Windows intégrée (NTLM/Kerberos), demandez à l'informatique une exception pour ${hote}.`;
    if (st === 403) return `Le proxy ${nom} refuse l'accès à ${hote} (403) : il faut faire autoriser ce site par l'informatique.`;
    return `Le proxy ${nom} a répondu ${st} pour ${hote}.`;
  }
  // Seulement après le statut du proxy : undici range son refus parmi
  // les « AbortError », qu'on lisait à tort comme un délai dépassé.
  if (c === 'AbortError' || c === 'UND_ERR_ABORTED' || e?.name === 'AbortError' || e?.name === 'TimeoutError') return 'Le service ne répond pas (délai dépassé).';
  const t = T[c];
  if (t) return `Service injoignable (${c}) : ${t}`;
  const detail = String(e?.cause?.message || e?.message || 'erreur réseau').slice(0, 120);
  // Un proxy qui refuse la destination ne laisse pas de code exploitable
  // (undici : « Request was cancelled »).
  if (proxy) return `Service injoignable (${detail}) : le proxy ${proxyAffiche(proxy)} a refusé ou coupé la connexion vers ${hote}. Il faut sans doute faire autoriser ${hote} sur ce proxy.`;
  return `Service injoignable (${c || detail}).`;
}

function lireFichier() {
  return require('../core/store').readJSON(FILES.ai_secret, {}) || {};
}
function ecrireFichier(d) {
  require('../core/store').writeJSON(FILES.ai_secret, d, { mode: 0o600 });
}

// Réglages effectifs. L'environnement prime : c'est la place d'un secret
// posé par l'exploitant sur la machine.
function lireConf() {
  const f = lireFichier();
  const envKey = (process.env.AI_API_KEY || '').trim();
  return {
    base_url: (process.env.AI_BASE_URL || f.base_url || DEFAUT.base_url).replace(/\/+$/, '').replace(/\/chat\/completions$/, ''),
    model:    process.env.AI_MODEL || f.model || DEFAUT.model,
    api_key:  envKey || f.api_key || '',
    source:   envKey ? 'env' : (f.api_key ? 'page' : ''),
    updated_at: f.updated_at || null,
  };
}

// Ce que la page a le droit de voir.
function confPublique() {
  const c = lireConf();
  return {
    base_url: c.base_url, model: c.model,
    has_key: !!c.api_key,
    key_hint: c.api_key ? '…' + c.api_key.slice(-4) : '',
    key_source: c.source,
    env_locked: { base_url: !!process.env.AI_BASE_URL, model: !!process.env.AI_MODEL, api_key: !!process.env.AI_API_KEY },
    http_allowed: httpAutorise(),
    ...(() => {
      const f = lireFichier();
      let eff = null; try { eff = proxyChoisi(c.base_url + '/chat/completions'); } catch {}
      const w = proxyWindows();
      return {
        proxy_mode: process.env.AI_PROXY ? 'env' : (f.proxy_mode || (f.proxy ? 'manual' : 'auto')),
        proxy_manual: f.proxy ? proxyAffiche(f.proxy) : '',
        proxy: eff ? proxyAffiche(eff.url) : '',
        proxy_source: eff ? eff.source : '',
        proxy_user: f.proxy_user || '',
        proxy_has_pass: !!f.proxy_pass,
        windows_proxy: w ? { actif: w.actif, proxy: w.url ? proxyAffiche(w.url) : '', pac: !!w.pac } : null,
        system_ca: (() => { try { return typeof require('tls').getCACertificates === 'function'; } catch { return false; } })(),
        ca_custom: (() => { try { return decouperPem(f.ca_pem).map(p => { const x = new (require('crypto').X509Certificate)(p); return { sujet: x.subject.split('\n').find(l => l.startsWith('CN=')) || x.subject.split('\n')[0], fin: x.validTo }; }); } catch { return []; } })(),
      };
    })(),
    academy_open: !!lireFichier().academy_open,
    reflexion: !!lireFichier().reflexion,
    embed_model: lireFichier().embed_model || '',
    updated_at: c.updated_at,
    limits: LIMITES,
  };
}

function verifierUrl(u) {
  let x;
  try { x = new URL(String(u || '').trim()); } catch { throw new Error('Adresse du service invalide.'); }
  if (x.username || x.password) throw new Error("L'adresse ne doit pas contenir d'identifiants.");
  // HTTP accepté vers la machine elle-même (127.0.0.1, localhost) : c'est
  // le cas d'un tunnel SSH, où rien ne sort en clair, le tunnel chiffre.
  const local = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(x.hostname);
  if (x.protocol === 'http:' && !httpAutorise() && !local)
    throw new Error('HTTPS obligatoire : en HTTP la clé circule en clair. (AI_ALLOW_HTTP=1 sur le serveur pour forcer.)');
  if (!['https:', 'http:'].includes(x.protocol)) throw new Error('Adresse du service invalide.');
  // On attend la base (…/v1). L'adresse complète copiée d'un exemple curl
  // (…/v1/chat/completions) donnait …/chat/completions/chat/completions,
  // donc une 404 : on retire la fin.
  x.search = ''; x.hash = '';
  return x.toString().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
}

// Mise à jour depuis la page. Renvoie la liste des champs changés (pour
// l'audit, sans aucune valeur de clé).
function majConf(body) {
  let b = body || {};
  const f = lireFichier();
  const avant = lireConf();
  const changes = [];
  // Préréglage « tunnel » : adresse locale, modèle, sans proxy, nom du
  // service. La clé (qui doit accompagner le changement d'adresse) suit.
  if (b.preset === 'tunnel') {
    b = { ...b, base_url: `http://127.0.0.1:${TUNNEL.port}/v1`, proxy_mode: 'none',
          model: b.model || (avant.base_url.startsWith('http://127.0.0.1') ? avant.model : TUNNEL.model) };
    if (f.service_host !== TUNNEL.host) { f.service_host = TUNNEL.host; changes.push('service_host'); }
  }
  if (b.base_url !== undefined) {
    const u = verifierUrl(b.base_url);
    if (u !== avant.base_url) {
      f.base_url = u; changes.push('base_url');
      // Nouvelle adresse : l'ancienne clé ne la suit pas.
      if (f.api_key && !b.api_key) { delete f.api_key; changes.push('api_key effacée'); }
    }
  }
  if (b.model !== undefined) {
    const m = String(b.model).trim();
    if (!/^[\w.\-:/]{1,80}$/.test(m)) throw new Error('Nom de modèle invalide.');
    if (m !== avant.model) { f.model = m; changes.push('model'); }
  }
  if (b.api_key !== undefined && b.api_key !== '') {
    const k = String(b.api_key).trim();
    if (k.length < 8 || k.length > 400 || /\s/.test(k)) throw new Error('Clé invalide.');
    f.api_key = k; changes.push('api_key');
  }
  if (b.clear_key) { delete f.api_key; changes.push('api_key effacée'); }
  if (b.proxy_mode !== undefined) {
    if (!['auto', 'manual', 'none'].includes(b.proxy_mode)) throw new Error('Mode de proxy invalide.');
    if (b.proxy_mode !== (f.proxy_mode || (f.proxy ? 'manual' : 'auto'))) { f.proxy_mode = b.proxy_mode; changes.push('proxy_mode'); }
  }
  if (b.proxy_user !== undefined && b.proxy_user !== '') {
    f.proxy_user = String(b.proxy_user).trim().slice(0, 200); changes.push('proxy_user');
  }
  if (b.proxy_pass !== undefined && b.proxy_pass !== '') {
    f.proxy_pass = String(b.proxy_pass).slice(0, 400); changes.push('proxy_pass');
  }
  if (b.ca_pem !== undefined && b.ca_pem !== '') {
    const certs = decouperPem(b.ca_pem);
    if (!certs.length || String(b.ca_pem).length > 200000) throw new Error('Certificat invalide : collez le texte qui commence par -----BEGIN CERTIFICATE-----.');
    try { for (const c of certs) new (require('crypto').X509Certificate)(c); }
    catch { throw new Error('Certificat illisible.'); }
    f.ca_pem = certs.join('\n'); changes.push('certificat entreprise');
  }
  if (b.clear_ca) { delete f.ca_pem; changes.push('certificat retiré'); }
  if (b.clear_proxy_auth) { delete f.proxy_user; delete f.proxy_pass; changes.push('identifiants proxy effacés'); }
  if (b.proxy !== undefined && b.proxy !== '') {
    let x;
    try { x = new URL(String(b.proxy).trim()); } catch { throw new Error('Adresse du proxy invalide (ex. http://proxy:8080).'); }
    if (!['http:', 'https:'].includes(x.protocol)) throw new Error('Adresse du proxy invalide (ex. http://proxy:8080).');
    f.proxy = x.toString().replace(/\/+$/, ''); changes.push('proxy');
  }
  if (b.clear_proxy) { delete f.proxy; changes.push('proxy retiré'); }
  // Academy : les agents (et pas seulement l'admin) peuvent poser leurs
  // questions dans les cours. Fermé tant que l'admin ne l'a pas ouvert.
  // Mode « réflexion » des modèles qui raisonnent avant de répondre (Qwen3,
  // GLM…) : coupé par défaut, il multipliait le temps de réponse.
  if (b.reflexion !== undefined) {
    const v = b.reflexion === true;
    if (v !== !!f.reflexion) { f.reflexion = v; changes.push(v ? 'réflexion du modèle activée' : 'réflexion du modèle coupée'); }
  }
  // Modèle d'embeddings : la base de connaissances l'utilise pour chercher
  // par le sens et non plus seulement par les mots. Vide = désactivé.
  if (b.embed_model !== undefined) {
    const m = String(b.embed_model || '').trim();
    if (m && !/^[\w.\-:/]{1,80}$/.test(m)) throw new Error('Nom de modèle d\'embeddings invalide.');
    if (m !== (f.embed_model || '')) { if (m) f.embed_model = m; else delete f.embed_model; changes.push(m ? `embeddings : ${m}` : 'embeddings coupés'); }
  }
  if (b.academy_open !== undefined) {
    const v = b.academy_open === true;
    if (v !== !!f.academy_open) { f.academy_open = v; changes.push(v ? 'academy ouverte aux agents' : 'academy réservée à l\'admin'); }
  }
  if (changes.length) { f.updated_at = new Date().toISOString(); ecrireFichier(f); reinitialiserReseau(); }
  return changes;
}

// `max` : les skills construisent leur message côté serveur (données
// de Pearl) et peuvent dépasser la limite d'une saisie libre.
function nettoyerMessages(list, max = LIMITES.chars_message) {
  if (!Array.isArray(list) || !list.length) throw new Error('Aucun message.');
  const msgs = list.slice(-LIMITES.messages).map(m => {
    const role = m && m.role === 'assistant' ? 'assistant' : 'user';
    const content = String((m && m.content) || '');
    if (content.length > max)
      throw new Error(`Message trop long (${max} caractères au plus).`);
    return { role, content };
  }).filter(m => m.content.trim());
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') throw new Error('Le dernier message doit venir de vous.');
  const total = msgs.reduce((n, m) => n + m.content.length, 0);
  if (total > LIMITES.chars_total) throw new Error('Conversation trop longue : commencez-en une nouvelle.');
  return msgs;
}

// Message d'erreur montrable : statut et motif court du fournisseur, sans
// recopier la réponse brute (qui pourrait faire écho à l'en-tête).
function motifAmont(status, texte, cle) {
  let msg = '';
  try { const j = JSON.parse(texte); msg = j.error?.message || j.message || j.error || ''; } catch {}
  msg = String(msg || '').slice(0, 200);
  if (cle) msg = msg.split(cle).join('***');
  const base = status === 401 || status === 403 ? 'Clé refusée par le service'
    : status === 404 ? 'Adresse ou modèle introuvable (404)'
    : status === 429 ? 'Quota du service atteint'
    : `Le service a répondu ${status}`;
  return msg ? `${base} : ${msg}` : base;
}

// Texte d'une réponse. Les modèles « à raisonnement » (Qwen3, GLM…)
// ajoutent leur réflexion : à part (reasoning_content) ou dans le texte
// entre <think>…</think>. On ne garde que la réponse.
function texteReponse(msg) {
  let t = msg?.content;
  if (Array.isArray(t)) t = t.map(p => (typeof p === 'string' ? p : p?.text || '')).join('');
  if (typeof t !== 'string') t = '';
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // Réflexion coupée par la limite : le <think> n'est jamais refermé.
  if (/<think>/i.test(t)) t = t.slice(0, t.search(/<think>/i));
  return t.trim();
}

// Arrêt demandé par l'utilisateur (bouton Stop) : le signal suit le
// travail en cours sans être passé de fonction en fonction.
const { AsyncLocalStorage } = require('async_hooks');
const _arret = new AsyncLocalStorage();
const avecArret = (signal, fn) => _arret.run({ signal }, fn);
const erreurArret = () => Object.assign(new Error('Arrêté.'), { status: 499, arret: true });

async function appelModele(c, corps, delai) {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), delai || LIMITES.timeout_ms);
  const stop = _arret.getStore()?.signal;
  if (stop?.aborted) { clearTimeout(minuteur); throw erreurArret(); }
  const surStop = () => ctrl.abort();
  stop?.addEventListener('abort', surStop, { once: true });
  let res, texte;
  const cible = `${c.base_url}/chat/completions`;
  const proxy = proxyPour(cible);
  try {
    res = await fetchVia(proxy).fetch(cible, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.api_key}`, ...enteteHote(c.base_url) },
      body: JSON.stringify(corps),
      signal: ctrl.signal,
    });
    texte = await res.text();
  } catch (e) {
    if (stop?.aborted) throw erreurArret();
    const err = new Error(causeReseau(e, c.base_url, proxy));
    console.error('[ai] appel impossible :', e?.cause?.code || e?.code || '', e?.cause?.message || e?.message || '');
    err.status = 502; throw err;
  } finally { clearTimeout(minuteur); stop?.removeEventListener('abort', surStop); }
  if (!res.ok) {
    // L'adresse appelée (sans la clé) aide à voir une base mal saisie.
    const err = new Error(`${motifAmont(res.status, texte, c.api_key)} · ${c.base_url}/chat/completions · modèle ${c.model}`);
    err.status = 502; throw err;
  }
  try { return JSON.parse(texte); } catch { const err = new Error('Réponse illisible du service.'); err.status = 502; throw err; }
}

// Serveurs qui refusent chat_template_kwargs : on ne le leur renvoie plus.
const _sansKwargs = new Set();

async function chat(messages, opts = {}) {
  const c = lireConf();
  if (!c.api_key) { const e = new Error("Aucune clé configurée."); e.status = 400; throw e; }
  verifierUrl(c.base_url);
  const msgs = nettoyerMessages(messages, opts.max_chars ? Math.min(opts.max_chars, 30000) : undefined);
  const corps = {
    model: c.model,
    // Un skill apporte ses propres consignes, ajoutées à celles de base.
    messages: [{ role: 'system', content: opts.system ? `${SYSTEM}\n\n${opts.system}` : SYSTEM }, ...msgs],
    max_tokens: Math.min(opts.retry ? LIMITES.max_tokens_retry : LIMITES.max_tokens, opts.max_tokens || LIMITES.max_tokens),
    temperature: typeof opts.temperature === 'number' ? Math.min(1, Math.max(0, opts.temperature)) : 0.4,
    stream: false,
  };
  // Réponse directe dès le premier appel. Un modèle « à raisonnement »
  // écrivait d'abord une longue réflexion cachée (souvent plus de deux
  // minutes), puis il fallait parfois un second essai. Deux leviers :
  // « /no_think » dans la consigne (Qwen3) et le paramètre du serveur
  // (vLLM, SGLang, Ollama) ; s'il est refusé, on le retire et on retient.
  const direct = !lireFichier().reflexion;
  if (direct) {
    const dernier = corps.messages.length - 1;
    corps.messages = corps.messages.map((m, i) => i === dernier && m.role === 'user' ? { ...m, content: `${m.content}\n\n/no_think` } : m);
    if (!_sansKwargs.has(c.base_url)) corps.chat_template_kwargs = { enable_thinking: false };
  }
  const t0 = Date.now();
  const delai = opts.fond ? LIMITES.timeout_fond_ms : LIMITES.timeout_ms;
  let j;
  try { j = await appelModele(c, corps, delai); }
  catch (e) {
    if (!corps.chat_template_kwargs || !/chat_template_kwargs|unrecognized|unknown|extra|not permitted|additional/i.test(String(e.message))) throw e;
    _sansKwargs.add(c.base_url);
    delete corps.chat_template_kwargs;
    j = await appelModele(c, corps, delai);
  }
  const rt = j.usage?.completion_tokens_details?.reasoning_tokens;
  console.log(`[ai] ${c.model} · ${Date.now() - t0} ms · ${j.usage?.prompt_tokens ?? '?'} → ${j.usage?.completion_tokens ?? '?'} jetons${rt ? ` (dont ${rt} de réflexion)` : ''}${direct ? '' : ' · réflexion activée'}`);
  let choix = j.choices && j.choices[0];
  let contenu = texteReponse(choix?.message);
  const reflexion = m => !!(m?.reasoning_content || m?.reasoning || /<think>/i.test(String(m?.content || '')));

  // Réponse vide alors que le modèle a réfléchi ou a buté sur la limite :
  // il a dépensé ses jetons à réfléchir. Un second essai, avec plus de
  // marge et la consigne de répondre directement (« /no_think » est
  // compris par les modèles Qwen3 et ignoré par les autres).
  if (!contenu && (choix?.finish_reason === 'length' || reflexion(choix?.message))) {
    console.warn('[ai] réponse vide (fin :', choix?.finish_reason, ', jetons :', j.usage?.completion_tokens, ') : second essai');
    const dernier = corps.messages.length - 1;
    const corps2 = {
      ...corps,
      max_tokens: LIMITES.max_tokens_retry,
      messages: corps.messages.map((m, i) => i === dernier ? { ...m, content: `${m.content}\n\nRéponds directement, sans exposer ton raisonnement. /no_think` } : m),
    };
    j = await appelModele(c, corps2, delai);
    choix = j.choices && j.choices[0];
    contenu = texteReponse(choix?.message);
  }
  if (!contenu) {
    const fin = choix?.finish_reason || 'inconnue';
    const jetons = j.usage?.completion_tokens;
    console.error('[ai] réponse vide :', JSON.stringify({ fin, jetons, cles: Object.keys(choix?.message || {}) }));
    const err = new Error(fin === 'length' || reflexion(choix?.message)
      ? `Le modèle n'a rendu aucun texte : il a utilisé toute sa marge${jetons ? ` (${jetons} jetons)` : ''} à réfléchir. Réessaie ; si ça se répète, choisis un modèle sans mode « réflexion » (bouton Liste des réglages).`
      : `Réponse vide du service (fin : ${fin}).`);
    err.status = 502; throw err;
  }
  return {
    content: contenu,
    model: j.model || c.model,
    finish_reason: choix.finish_reason || null,
    usage: j.usage ? { prompt: j.usage.prompt_tokens, completion: j.usage.completion_tokens, total: j.usage.total_tokens } : null,
    ms: Date.now() - t0,
  };
}

// ── Modèles disponibles ──
// GET /models : valide la clé et donne les noms exacts. Un nom de modèle
// mal orthographié revenait en 404 sur /chat/completions, sans plus.
// ── Embeddings (recherche par le sens dans la base de connaissances) ──
// Même service, même clé, même proxy que le chat ; route /embeddings de
// l'API compatible OpenAI. Renvoie un vecteur par texte, dans l'ordre.
async function embed(textes, opts = {}) {
  const c = lireConf();
  const model = opts.model || lireFichier().embed_model;
  if (!model) { const e = new Error('Aucun modèle d\'embeddings réglé.'); e.status = 400; throw e; }
  if (!c.api_key) { const e = new Error('Aucune clé configurée.'); e.status = 400; throw e; }
  verifierUrl(c.base_url);
  const cible = `${c.base_url}/embeddings`;
  const proxy = proxyPour(cible);
  const stop = _arret.getStore()?.signal;
  let res, texte;
  try {
    res = await fetchVia(proxy).fetch(cible, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.api_key}`, ...enteteHote(c.base_url) },
      body: JSON.stringify({ model, input: textes.map(t => String(t || ' ').slice(0, 6000)) }),
      signal: stop ? AbortSignal.any([stop, AbortSignal.timeout(opts.delai || 90000)]) : AbortSignal.timeout(opts.delai || 90000),
    });
    texte = await res.text();
  } catch (e) {
    if (stop?.aborted) throw erreurArret();
    const err = new Error(causeReseau(e, c.base_url, proxy)); err.status = 502; throw err;
  }
  if (!res.ok) { const err = new Error(`${motifAmont(res.status, texte, c.api_key)} · ${cible} · modèle ${model}`); err.status = 502; err.upstream = res.status; throw err; }
  let j; try { j = JSON.parse(texte); } catch { const err = new Error('Réponse illisible du service d\'embeddings.'); err.status = 502; throw err; }
  const data = (Array.isArray(j.data) ? j.data : []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(d => d.embedding);
  if (data.length !== textes.length || !data.every(v => Array.isArray(v) && v.length)) { const err = new Error('Le service n\'a pas rendu un vecteur par texte.'); err.status = 502; throw err; }
  return { vecteurs: data, model };
}

async function listerModeles() {
  const c = lireConf();
  if (!c.api_key) { const e = new Error('Aucune clé configurée.'); e.status = 400; throw e; }
  verifierUrl(c.base_url);
  const cible = `${c.base_url}/models`;
  const proxy = proxyPour(cible);
  let res, texte;
  try {
    res = await appelHttp(cible, { headers: { Authorization: `Bearer ${c.api_key}`, ...enteteHote(c.base_url) }, signal: AbortSignal.timeout(20000) }, proxy);
    texte = await res.text();
  } catch (e) {
    const err = new Error(causeReseau(e, c.base_url, proxy)); err.status = 502;
    err.proxyRefus = /Proxy response/.test(`${e?.message} ${e?.cause?.message}`);
    throw err;
  }
  if (!res.ok) { const err = new Error(motifAmont(res.status, texte, c.api_key)); err.status = 502; err.upstream = res.status; throw err; }
  let j; try { j = JSON.parse(texte); } catch { j = {}; }
  const ids = (Array.isArray(j.data) ? j.data : Array.isArray(j) ? j : []).map(m => m && (m.id || m.name)).filter(Boolean);
  return [...new Set(ids)].sort();
}

// ── Diagnostic pas à pas ──
// Chaque étape dit ce qu'elle a trouvé, pour qu'un échec désigne sa
// cause : réglages, proxy, DNS, connexion, certificat, clé, modèle.
async function diagnostiquer() {
  const etapes = [];
  const ok = (t, d) => etapes.push({ t, ok: true, d });
  const ko = (t, d) => etapes.push({ t, ok: false, d });
  const info = (t, d) => etapes.push({ t, ok: null, d });
  const c = lireConf();
  let modeles = null;

  // 1. Réglages
  if (!c.api_key) { ko('Réglages', 'Aucune clé enregistrée.'); return { etapes, modeles }; }
  try { verifierUrl(c.base_url); ok('Réglages', `${c.base_url} · modèle ${c.model} · clé ${'…' + c.api_key.slice(-4)}`); }
  catch (e) { ko('Réglages', e.message); return { etapes, modeles }; }
  const hote = new URL(c.base_url).hostname;

  // 2. Proxy
  const choix = proxyChoisi(`${c.base_url}/models`);
  const proxy = proxyAvecIdentifiants(choix);
  const w = proxyWindows();
  if (choix) {
    const auth = new URL(proxy).username ? ', avec identifiant' : ', sans identifiant';
    ok('Proxy', `${proxyAffiche(choix.url)} (${choix.source}${auth})`);
  } else {
    info('Proxy', 'Aucun : connexion directe.'
      + (w && w.actif ? ` Windows en déclare un (${proxyAffiche(w.url)}) mais le mode choisi l'écarte ou ${hote} est dans ses exceptions.` : ''));
  }
  if (w && w.pac) info('Script de proxy', "Windows utilise un script de configuration automatique (PAC) que le serveur ne sait pas lire. Si l'appel échoue, choisissez le mode Manuel avec l'adresse du proxy.");
  {
    const f = lireFichier();
    const sys = typeof require('tls').getCACertificates === 'function';
    const perso = decouperPem(f.ca_pem).length;
    info('Certificats', (sys ? 'Magasin du système utilisé en plus de celui de Node.' : `Node ${process.version} ne lit pas le magasin du système.`)
      + (perso ? ` Certificat de l'entreprise ajouté (${perso}).` : (sys ? '' : " Si une erreur de certificat apparaît, collez le certificat racine de l'entreprise dans les réglages.")));
  }

  // 3. Machine qui fait les appels. Ce n'est pas forcément le poste
  // depuis lequel on regarde la page : si le serveur Pearl tourne ailleurs
  // (VM, serveur Linux), il n'a ni le proxy ni le DNS du poste.
  const os = require('os');
  const dnsCb = require('dns');
  const plateforme = { win32: 'Windows', linux: 'Linux', darwin: 'macOS' }[process.platform] || process.platform;
  info('Serveur Pearl', `${plateforme} · machine « ${os.hostname()} » · Node ${process.version} · DNS ${dnsCb.getServers().join(', ') || 'inconnu'}. C'est cette machine qui appelle le modèle, pas le navigateur.`);

  // 4. DNS (avec un proxy, seul son nom à lui doit se résoudre ici)
  const dns = dnsCb.promises;
  const net = require('net');
  let cibleTcp = null;
  try {
    if (choix) {
      const px = new URL(choix.url);
      const ph = px.hostname;
      const port = Number(px.port) || (px.protocol === 'https:' ? 443 : 80);
      if (net.isIP(ph)) { ok('Adresse du proxy', `${ph} (adresse IP, pas de DNS nécessaire)`); }
      else { const r = await dns.lookup(ph); ok('DNS du proxy', `${ph} → ${r.address}`); }
      cibleTcp = { h: ph, port, nom: 'le proxy' };
    } else {
      const r = await dns.lookup(hote);
      ok('DNS', `${hote} → ${r.address}`);
      const bu = new URL(c.base_url);
      cibleTcp = { h: hote, port: Number(bu.port) || (bu.protocol === 'https:' ? 443 : 80), nom: hote };
    }
  } catch (e) {
    if (choix) {
      const ph = new URL(choix.url).hostname;
      ko('DNS du proxy', `${e.code || e.message} : la machine « ${os.hostname()} » ne connaît pas ${ph}. Son DNS n'est pas celui des postes de travail.`
        + ` À faire : sur ton PC, tape « nslookup ${ph} » dans PowerShell, puis remplace le nom par l'adresse IP obtenue dans le champ du proxy (mode Manuel, ex. http://10.x.x.x:${new URL(choix.url).port || 8080}).`
        + ` Ou demande à l'informatique d'ajouter le DNS de l'entreprise sur ce serveur.`);
    } else {
      ko('DNS', `${e.code || e.message} : ${hote} est introuvable depuis « ${os.hostname()} ». Il faut passer par le proxy de l'entreprise (mode Manuel).`);
    }
    return { etapes, modeles };
  }

  // 5. Le serveur peut-il ouvrir une connexion vers le proxy (ou le
  // service) ? Distingue « nom inconnu » de « route ou port fermés ».
  if (cibleTcp) {
    const r = await new Promise(resolve => {
      const sock = net.connect({ host: cibleTcp.h, port: cibleTcp.port });
      const fin = v => { sock.destroy(); resolve(v); };
      sock.setTimeout(6000, () => fin('ETIMEDOUT'));
      sock.once('connect', () => fin(null));
      sock.once('error', e => fin(e.code || e.message));
    });
    if (r) {
      if (estLocal(c.base_url) && !choix) {
        ko('Tunnel', `${r} sur le port ${cibleTcp.port} : le tunnel n'est pas ouvert. Sur ton PC, tape « ia on » dans PowerShell (la commande s'installe avec le bouton « Commande ia » des réglages), puis relance le diagnostic.`);
        return { etapes, modeles };
      }
      ko('Connexion réseau', `${r} vers ${cibleTcp.h}:${cibleTcp.port} : la machine « ${os.hostname()} » n'a pas de route vers ${cibleTcp.nom} (pare-feu ou réseau isolé). Il faut une ouverture réseau par l'informatique, ou faire tourner EMOC sur une machine qui y a accès.`);
      return { etapes, modeles };
    }
    ok(estLocal(c.base_url) && !choix ? 'Tunnel' : 'Connexion réseau', estLocal(c.base_url) && !choix
      ? `ouvert sur le port ${cibleTcp.port}, vers ${lireFichier().service_host || TUNNEL.host}.`
      : `${cibleTcp.h}:${cibleTcp.port} joignable.`);
  }

  // 6. Connexion + clé : GET /models
  try {
    modeles = await listerModeles();
    ok('Connexion et clé', `Le service répond et accepte la clé. ${modeles.length} modèle(s) disponible(s).`);
    if (modeles.length && !modeles.includes(c.model)) {
      ko('Modèle', `« ${c.model} » n'est pas dans la liste. Choisissez-en un : ${modeles.slice(0, 12).join(', ')}${modeles.length > 12 ? '…' : ''}`);
      return { etapes, modeles };
    }
  } catch (e) {
    if (e.upstream === 404 || e.upstream === 405) {
      info('Connexion et clé', "Le service ne publie pas la liste des modèles (normal chez certains fournisseurs) : on passe directement à l'essai.");
    } else if (e.upstream === 407) {
      ko('Proxy', "Le proxy demande une identification (407). Renseignez l'identifiant et le mot de passe du proxy. S'il exige l'authentification Windows intégrée (NTLM/Kerberos), le serveur ne peut pas la fournir : demandez à l'informatique une exception pour ce service.");
      return { etapes, modeles };
    } else {
      ko('Connexion et clé', e.message);
      // HTTPS injoignable : le service répond-il en HTTP ? Sonde sans la
      // clé, pour ne jamais l'envoyer en clair.
      if (c.base_url.startsWith('https:') && e.status === 502 && !e.upstream && !e.proxyRefus) {
        try {
          const essai = c.base_url.replace(/^https:/, 'http:') + '/models';
          const r = await appelHttp(essai, { signal: AbortSignal.timeout(10000) }, proxyPour(essai));
          info('Essai en HTTP', `${hote} répond en HTTP (statut ${r.status}), pas en HTTPS. Pour l'utiliser : AI_ALLOW_HTTP=1 dans le .env du serveur, puis adresse en http:// (la clé circulera en clair sur le réseau interne).`);
        } catch { info('Essai en HTTP', 'Pas de réponse en HTTP non plus.'); }
      }
      return { etapes, modeles };
    }
  }

  // 7. Essai réel
  try {
    const r = await chat([{ role: 'user', content: 'Réponds seulement : OK' }]);
    ok('Réponse du modèle', `« ${String(r.content).trim().slice(0, 80)} » en ${(r.ms / 1000).toFixed(1)} s. Tout fonctionne.`);
  } catch (e) { ko('Réponse du modèle', e.message); }
  return { etapes, modeles };
}

// ── Script du tunnel pour le poste Windows ──
// Compte SSH à utiliser sur la VM : celui qui possède le dossier de Pearl
// (le service peut tourner en root, mais on se connecte avec le compte
// de l'utilisateur).
function compteVm() {
  const os = require('os');
  try {
    const moi = os.userInfo().username;
    if (moi && moi !== 'root') return moi;
    const uid = fs.statSync(require('path').resolve(__dirname, '../..')).uid;
    const ligne = fs.readFileSync('/etc/passwd', 'utf8').split('\n').find(l => l.split(':')[2] === String(uid));
    if (ligne) return ligne.split(':')[0];
  } catch {}
  return 'utilisateur';
}

// ── Commande « ia » pour le poste Windows ──
// Un seul fichier, ia.bat :
//   · double-clic (une fois) : s'installe dans un dossier du PATH de
//     l'utilisateur (WindowsApps), crée une clé SSH dédiée et l'inscrit sur
//     la VM après un seul mot de passe ;
//   · ensuite, dans PowerShell ou cmd : ia on / ia off / ia status.
// Le tunnel tourne en arrière-plan, sans fenêtre.
//
// Sécurité : sur la VM, la clé est inscrite avec
// restrict,port-forwarding,permitlisten,permitopen,command : elle ne peut
// ni ouvrir de session, ni lancer de commande, ni ouvrir un autre port que
// celui du tunnel, ni joindre les services de la VM. Perdue, elle ne donne
// accès à rien d'autre.
function scriptTunnel(hoteVm) {
  const h = String(hoteVm || '').replace(/[^\w.\-:\[\]]/g, '');
  const u = compteVm().replace(/[^\w.\-]/g, '');
  const vm = `${u}@${h}`;
  const fwd = `${TUNNEL.port}:${TUNNEL.host}:${TUNNEL.remote_port}`;
  const ps = code => Buffer.from(code, 'utf16le').toString('base64');
  const b64 = code => Buffer.from(code, 'utf8').toString('base64');

  // Inscription de la clé sur la VM (lit la clé publique sur l'entrée).
  const installVm = [
    'set -e',
    'umask 077',
    'mkdir -p ~/.ssh',
    'IFS= read -r k || true',
    `k=$(printf '%s' "$k" | tr -d '\\r')`,
    'case "$k" in ssh-ed25519\\ *) ;; *) echo "Cle invalide"; exit 1;; esac',
    // restrict coupe tout ; port-forwarding ne rend que les tunnels ;
    // permitlisten limite -R au port du tunnel ; permitopen vers un port
    // fermé neutralise -L (« none » n'existe pas ici) ; command remplace
    // toute commande demandée. Vérifié sur un vrai sshd (tests manuels).
    `l="restrict,port-forwarding,permitlisten=\\"${TUNNEL.port}\\",permitopen=\\"127.0.0.1:1\\",command=\\"echo Cle reservee au tunnel Pearl AI\\" $k"`,
    'touch ~/.ssh/authorized_keys',
    // Une réinstallation remplace la ligne de cette clé au lieu d'en ajouter une.
    'grep -vF "$k" ~/.ssh/authorized_keys > ~/.ssh/.ak.tmp || true',
    'echo "$l" >> ~/.ssh/.ak.tmp',
    'mv ~/.ssh/.ak.tmp ~/.ssh/authorized_keys',
    'chmod 600 ~/.ssh/authorized_keys',
    'echo OK',
    '',
  ].join('\n');

  const trouve = `Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" | Where-Object { $_.CommandLine -like '*-R ${fwd}*' }`;
  const psOn = [
    "$key = Join-Path $env:USERPROFILE '.ssh\\pearl_ia'",
    "if (-not (Test-Path $key)) { Write-Host ' La commande n''est pas encore installee : double-clique sur ia.bat.'; exit 1 }",
    `if (${trouve}) { Write-Host ' Pearl AI deja allume.'; exit 0 }`,
    `$a = @('-N','-i',('"' + $key + '"'),'-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=3','-o','StrictHostKeyChecking=accept-new','-R','${fwd}','${vm}')`,
    '$p = Start-Process ssh -ArgumentList $a -WindowStyle Hidden -PassThru',
    'Start-Sleep -Seconds 6',
    `if ($p.HasExited) { Write-Host (' Echec (code ' + $p.ExitCode + '). Souvent un ancien tunnel garde le port sur la VM. Sur la VM : sudo ss -ltnp | grep ${TUNNEL.port} puis sudo kill <pid>, et refais : ia on'); exit 1 }`,
    "Write-Host ' Pearl AI allume. Pour eteindre : ia off'",
  ].join('\n');
  const psOff = [
    `$p = ${trouve}`,
    "if (-not $p) { Write-Host ' Pearl AI deja eteint.'; exit 0 }",
    '$p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }',
    "Write-Host ' Pearl AI eteint.'",
  ].join('\n');
  const psStatus = [
    `if (${trouve}) { Write-Host ' Pearl AI allume (tunnel actif).' } else { Write-Host ' Pearl AI eteint. Pour allumer : ia on' }`,
  ].join('\n');
  const lancer = code => `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${ps(code)}`;

  const L = [
    '@echo off',
    'setlocal',
    `set "KEY=%USERPROFILE%\\.ssh\\pearl_ia"`,
    'if /i "%~1"=="on" goto :on',
    'if /i "%~1"=="off" goto :off',
    'if /i "%~1"=="status" goto :status',
    'goto :install',
    '',
    ':on',
    lancer(psOn),
    'exit /b %errorlevel%',
    '',
    ':off',
    lancer(psOff),
    'exit /b %errorlevel%',
    '',
    ':status',
    lancer(psStatus),
    'exit /b %errorlevel%',
    '',
    ':install',
    'echo.',
    `echo  Installation de la commande "ia" pour Pearl (VM ${h})`,
    'echo.',
    'set "DEST=%LOCALAPPDATA%\\Microsoft\\WindowsApps\\ia.bat"',
    'if /i not "%~f0"=="%DEST%" copy /y "%~f0" "%DEST%" >nul',
    'if not exist "%USERPROFILE%\\.ssh" mkdir "%USERPROFILE%\\.ssh"',
    'if not exist "%KEY%" ssh-keygen -q -t ed25519 -N "" -C pearl-ia -f "%KEY%"',
    'echo  Tape le mot de passe de la VM (une seule fois) :',
    `ssh -o StrictHostKeyChecking=accept-new ${vm} "f=$(mktemp); echo ${b64(installVm)} | base64 -d > $f; bash $f; r=$?; rm -f $f; exit $r" < "%KEY%.pub"`,
    'if errorlevel 1 (',
    '  echo.',
    '  echo  Echec de l installation. Verifie le mot de passe et recommence.',
    '  pause',
    '  exit /b 1',
    ')',
    'echo.',
    'echo  C est installe. Dans PowerShell ou l invite de commandes :',
    // Si une stratégie d'entreprise a retiré WindowsApps du PATH, la
    // commande courte n'existe pas : on donne le chemin complet.
    'where ia >nul 2>nul || echo  (si "ia" n est pas reconnu, tape plutot : "%DEST%" on)',
    'echo     ia on      allume Pearl AI (tunnel en arriere-plan, sans mot de passe)',
    'echo     ia off     eteint Pearl AI',
    'echo     ia status  dit si elle est allumee',
    'echo.',
    'pause',
    'exit /b 0',
    '',
  ];
  return L.join('\r\n');
}

module.exports = { lireFichier, confPublique, majConf, chat, embed, avecArret, lireConf, verifierUrl, LIMITES, causeReseau, proxyPour, proxyChoisi, lireRegistreProxy, horsProxyWindows, listerModeles, diagnostiquer, scriptTunnel, TUNNEL };
