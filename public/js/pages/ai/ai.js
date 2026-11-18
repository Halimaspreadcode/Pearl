// ══════════════════════════════════════════════════════════════
// ASSISTANT IA (Admin › Assistant IA) — page d'essai
//
// Réservée à l'admin : le balisage n'existe que dans le fragment admin
// (server/partials/config-page.html) et toutes les routes /api/ai exigent
// la session. La clé ne transite qu'à l'enregistrement, du navigateur
// vers le serveur ; elle n'est jamais relue (la page n'en voit que la
// fin). Le modèle est appelé par le serveur, jamais d'ici.
//
// La conversation reste en mémoire : ni localStorage ni sessionStorage.
// Recharger la page l'efface, ce qui est voulu pour un outil d'essai où
// l'on peut avoir collé un extrait de ticket.
// ══════════════════════════════════════════════════════════════
// Conversations de la session : en mémoire seulement (voir plus haut).
const aiUI = { conf: null, msgs: [], busy: false, showConf: false, err: '', diag: null, models: [], diagBusy: false,
  convs: [], cur: null, plus: false, sideOpen: false,
  skills: null, skill: '', forms: {}, results: {}, skillBusy: '',
  kb: null, showKb: false, kbUp: [], kbQ: '', kbRes: null, kbOn: true };

async function _aiFetch(path, opts = {}) {
  let res;
  try { res = await fetch(`${API}${path}`, {
    ...opts,
    headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
    credentials: 'same-origin',
  }); } catch (e) {
    if (e.name === 'AbortError') throw Object.assign(new Error('Arrêté.'), { arret: true });
    throw e;
  }
  let data = {};
  try { data = await res.json(); } catch { /* corps vide */ }
  if (res.status === 401) throw new Error('Session admin expirée : reconnectez-vous.');
  // 404 de l'appli elle-même (pas du modèle, qui revient en 502) : le
  // serveur tourne encore sur une version sans les routes /api/ai.
  if (res.status === 404) throw new Error("Le serveur Pear ne connaît pas encore Pear AI : mettez-le à jour puis redémarrez-le.");
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

async function renderAiPage() {
  const root = document.getElementById('ai-root');
  if (!root) return;
  if (!aiUI.conf) {
    root.innerHTML = '<div class="ai-wrap"><div class="ai-empty">Chargement…</div></div>';
    try {
      aiUI.conf = await _aiFetch('/api/ai/config'); aiUI.showConf = false;
      aiUI.skills = (await _aiFetch('/api/ai/skills')).skills || [];
      aiUI.kb = await _aiFetch('/api/ai/kb').catch(() => null);
      aiUI.skills.push(_aiSkillInsights()); aiUI.skills.unshift(_AI_KNOWLEDGE);
    }
    catch (e) { root.innerHTML = `<div class="ai-wrap"><div class="ai-alert is-bad">${esc(e.message)}</div></div>`; return; }
  }
  _aiPaint();
}

// Rendu sobre du texte du modèle : on échappe tout, puis on ne rend que
// les blocs de code, le gras et le code en ligne. Pas d'innerHTML d'une
// sortie de modèle non échappée.
function _aiFormat(txt) {
  const inline = t => t
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>');
  const parts = String(txt || '').split(/```[\w-]*\n?/);
  return parts.map((p, i) => {
    if (i % 2) return `<pre class="ai-code">${esc(p.replace(/\n$/, ''))}</pre>`;
    // Bloc texte : titres (#), listes (-, *, 1.) et paragraphes.
    let html = '', liste = null;
    const fermer = () => { if (liste) { html += `</${liste}>`; liste = null; } };
    for (const brut of esc(p).split('\n')) {
      const l = brut.trimEnd();
      let m;
      if ((m = /^#{1,4}\s+(.*)$/.exec(l))) { fermer(); html += `<div class="ai-h">${inline(m[1])}</div>`; }
      else if ((m = /^\s*[-*•]\s+(.*)$/.exec(l))) { if (liste !== 'ul') { fermer(); html += '<ul>'; liste = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
      else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(l))) { if (liste !== 'ol') { fermer(); html += '<ol>'; liste = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
      else if (!l.trim()) { fermer(); }
      else { fermer(); html += `<p>${inline(l)}</p>`; }
    }
    fermer();
    return html;
  }).join('');
}

function _aiPaint() {
  const root = document.getElementById('ai-root');
  if (!root) return;
  // Une tâche qui se termine repeint la page : la saisie en cours survit.
  const avant = document.getElementById('ai-input');
  const saisie = avant ? { v: avant.value, f: document.activeElement === avant, a: avant.selectionStart, b: avant.selectionEnd } : null;
  const c = aiUI.conf || {};
  const lock = c.env_locked || {};

  const conf = `
    <section class="ai-card ai-conf"${aiUI.showConf ? '' : ' hidden'}>
      <div class="b3-conn ${c.has_key ? 'is-on' : 'is-off'}"><i></i><div><b>${c.has_key ? 'Connecté' : 'Non connecté'}</b>
        <span>${c.has_key ? `Modèle ${esc(c.model || '?')} · clé ${esc(c.key_hint || '')}` : 'Colle ta clé ci-dessous pour activer Pear AI.'}</span></div></div>
      <details class="ai-quick b3-det"${c.has_key ? '' : ' open'}>
        <summary class="ai-card-h">Connexion rapide (via ton PC)</summary>
        <ol class="ai-steps">
          <li><b>Une fois :</b> télécharge la commande <code>ia</code>, double-clique dessus sur ton PC et tape
            le mot de passe de la VM. Ensuite, dans PowerShell : <code>ia on</code> pour allumer,
            <code>ia off</code> pour éteindre, <code>ia status</code> pour savoir où on en est.
            <button type="button" class="ai-btn" onclick="aiTunnelScript()">Commande ia</button></li>
          <li><b>Ici :</b> colle ta clé et connecte. Adresse, modèle et proxy sont réglés tout seuls.
            <span class="ai-inline">
              <input id="ai-quick-key" type="password" placeholder="${c.has_key ? 'Clé actuelle ' + esc(c.key_hint) + ' (vide = garder)' : 'Ta clé API (sk-…)'}" autocomplete="new-password" spellcheck="false">
              <button type="button" class="ai-btn is-pri" onclick="aiQuickConnect()" ${aiUI.diagBusy ? 'disabled' : ''}>${aiUI.diagBusy ? 'Connexion…' : 'Connecter'}</button>
            </span></li>
        </ol>
      </details>
      <div class="ai-field ai-field-wide">
        <label class="bb-switch"><input type="checkbox" ${c.academy_open ? 'checked' : ''} onchange="aiAcademyOpen(this.checked)"><span></span>Academy : les agents peuvent poser leurs questions dans les cours</label>
        <div class="ai-note">${c.academy_open
          ? 'Ouvert : tout agent identifié (ID employé et code) peut interroger Pear AI depuis une leçon, 8 questions par minute au plus.'
          : 'Fermé : seul l\'admin voit le bouton « Poser une question » dans les cours.'} Les questions ne sont pas enregistrées ; l\'audit garde seulement qui, quand et quelle formation.</div>
      </div>
      <div class="ai-field ai-field-wide">
        <label class="bb-switch"><input type="checkbox" ${c.reflexion ? 'checked' : ''} onchange="aiReflexion(this.checked)"><span></span>Réflexion du modèle avant de répondre</label>
        <div class="ai-note">${c.reflexion
          ? 'Activée : le modèle raisonne avant chaque réponse. Un peu plus fin sur les questions difficiles, mais souvent plusieurs minutes d\'attente.'
          : 'Coupée (conseillé) : réponse directe, en général 5 à 10 fois plus rapide avec les modèles Qwen3.'}</div>
      </div>
      <details class="ai-field ai-field-wide ai-adv"${aiUI.showAdv ? ' open' : ''} ontoggle="aiUI.showAdv=this.open">
      <summary>Réglages détaillés</summary>
      <div class="ai-adv-grid">
      <div class="ai-card-h">Connexion au modèle</div>
      <label class="ai-field"><span>Adresse du service</span>
        <input id="ai-url" type="url" value="${esc(c.base_url || '')}" ${lock.base_url ? 'disabled' : ''} spellcheck="false" autocomplete="off"></label>
      <label class="ai-field"><span>Modèle</span>
        <span class="ai-inline"><input id="ai-model" type="text" list="ai-models" value="${esc(c.model || '')}" ${lock.model ? 'disabled' : ''} spellcheck="false" autocomplete="off">
          <button type="button" class="ai-btn is-ghost" onclick="aiLoadModels()" ${aiUI.busy ? 'disabled' : ''} title="Lister les modèles accessibles avec la clé">Liste</button></span>
        <datalist id="ai-models">${(aiUI.models || []).map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
      <label class="ai-field"><span>Clé API ${c.has_key ? `<em>actuelle ${esc(c.key_hint)}, laisser vide pour la garder</em>` : ''}</span>
        <input id="ai-key" type="password" placeholder="${c.has_key ? '••••••••' : 'sk-…'}" ${lock.api_key ? 'disabled' : ''} autocomplete="new-password" spellcheck="false"></label>
      <div class="ai-field ai-field-wide ai-proxy">
        <span>Proxy de l'entreprise</span>
        ${c.proxy_mode === 'env' ? `<div class="ai-note">Fixé sur le serveur (AI_PROXY) : ${esc(c.proxy)}</div>` : `
        <div class="ai-inline">
          <select id="ai-proxy-mode" onchange="aiProxyMode(this.value)">
            ${Object.entries({ auto: 'Automatique (Windows / système)', manual: 'Manuel', none: 'Aucun (connexion directe)' }).map(([v, l]) =>
              `<option value="${v}"${(c.proxy_mode || 'auto') === v ? ' selected' : ''}>${l}</option>`).join('')}
          </select>
          <input id="ai-proxy" type="text" placeholder="${c.proxy_manual ? esc(c.proxy_manual) + ' (laisser vide pour garder)' : 'http://proxy.entreprise.com:8080'}"
            ${(c.proxy_mode || 'auto') === 'manual' ? '' : 'hidden'} spellcheck="false" autocomplete="off">
        </div>`}
        <div class="ai-note">${c.proxy
          ? `En service : <b>${esc(c.proxy)}</b> (${esc(c.proxy_source)}).`
          : 'En service : aucun, connexion directe.'}${
          c.windows_proxy?.actif ? ` Windows déclare ${esc(c.windows_proxy.proxy)}.` : ''}${
          c.windows_proxy?.pac ? ' Windows utilise aussi un script automatique (PAC) : si ça échoue, passez en Manuel.' : ''}</div>
        <div class="ai-inline">
          <input id="ai-proxy-user" type="text" placeholder="Identifiant du proxy (si demandé)" value="${esc(c.proxy_user || '')}" autocomplete="off" spellcheck="false">
          <input id="ai-proxy-pass" type="password" placeholder="${c.proxy_has_pass ? 'Mot de passe enregistré (vide = garder)' : 'Mot de passe du proxy'}" autocomplete="new-password">
          ${c.proxy_user || c.proxy_has_pass ? '<button type="button" class="ai-btn is-ghost" onclick="aiClearProxyAuth()">Effacer</button>' : ''}
        </div>
      </div>
      <details class="ai-field ai-field-wide ai-ca"${(c.ca_custom || []).length ? '' : ''}>
        <summary>Certificat de l'entreprise ${(c.ca_custom || []).length
          ? `<em>· ${(c.ca_custom).map(x => esc(x.sujet)).join(', ')}</em>` : '<em>· facultatif, en cas d\'erreur de certificat</em>'}</summary>
        <div class="ai-note">Sur ton PC : touche Windows › « certmgr.msc » › Autorités de certification racines de confiance › Certificats ›
          clic droit sur le certificat de l'entreprise (ex. « Corporate Web Gateway CA ») › Toutes les tâches › Exporter › format
          « Base 64 X.509 (.cer) ». Ouvre le fichier avec le Bloc-notes et colle tout son contenu ici.</div>
        <textarea id="ai-ca" rows="4" spellcheck="false" placeholder="-----BEGIN CERTIFICATE-----&#10;…&#10;-----END CERTIFICATE-----"></textarea>
        ${(c.ca_custom || []).length ? '<button type="button" class="ai-btn is-ghost" onclick="aiClearCa()">Retirer le certificat</button>' : ''}
      </details>
      <p class="ai-note">La clé est gardée sur le serveur, hors de git et des sauvegardes. Elle n'est jamais renvoyée au navigateur.
        Changer l'adresse efface la clé enregistrée : il faut la ressaisir.${c.http_allowed ? '' : ' HTTPS obligatoire.'}
        Identifiants du proxy gardés comme la clé, mot de passe jamais réaffiché.${c.system_ca ? '' : ' Certificats du système non lus par cette version de Node : en cas d\'erreur de certificat, utilisez le champ Certificat de l\'entreprise.'}</p>
      </div></details>
      <div class="ai-actions">
        <button class="ai-btn is-pri" onclick="aiSaveConf()">Enregistrer</button>
        <button class="ai-btn" onclick="aiDiagnose()" ${aiUI.diagBusy ? 'disabled' : ''}>${aiUI.diagBusy ? 'Diagnostic…' : 'Diagnostiquer'}</button>
        <button class="ai-btn" onclick="aiTest()" ${c.has_key && !aiUI.busy ? '' : 'disabled'}>Tester la connexion</button>
        ${c.has_key && c.key_source === 'page' ? '<button class="ai-btn is-ghost" onclick="aiClearKey()">Effacer la clé</button>' : ''}
      </div>
      ${aiUI.diag ? `<ol class="ai-diag">${aiUI.diag.map(e => `<li class="${e.ok === true ? 'is-ok' : e.ok === false ? 'is-bad' : 'is-info'}">
        <span class="ai-diag-i">${e.ok === true ? '✓' : e.ok === false ? '✕' : 'i'}</span>
        <span><b>${esc(e.t)}</b> ${esc(e.d)}</span></li>`).join('')}</ol>` : ''}
    </section>`;

  _aiEnsureConv();
  const accueil = !aiUI.msgs.length;
  const convs = aiUI.convs.filter(x => x.msgs.length);
  const enCours = _aiJobsEnCours().length;
  const pays = typeof _aicPays === 'function' ? _aicPays() : 'ALL';
  const prenom = String((typeof currentUser !== 'undefined' && currentUser && currentUser.name) || '').split(/\s+/)[0];
  // Une page, trois états : l'accueil (grande saisie + ce qui attend), le
  // fil d'une conversation, et des panneaux latéraux qui s'ouvrent par-dessus
  // (historique à gauche ; outil ou réglages à droite) sans quitter l'écran.
  const drawerR = aiUI.skill ? 'skill' : aiUI.showKb ? 'kb' : aiUI.showConf ? 'conf' : '';
  const nDocs = (aiUI.kb?.docs || []).length;
  // Repeindre remplace tout : on garde la position de défilement des
  // panneaux (réglages, documents, historique) et de l'accueil, sinon
  // chaque clic ou rafraîchissement ramenait en haut.
  const _defil = {};
  ['.b3-right', '.b3-hist', '.b3-body'].forEach(sel => { const n = root.querySelector(sel); if (n) _defil[sel] = n.scrollTop; });
  const _memeVue = root.dataset.vue === `${accueil}|${drawerR}|${aiUI.cur}`;
  root.dataset.vue = `${accueil}|${drawerR}|${aiUI.cur}`;
  root.innerHTML = `<div class="b3${accueil ? ' is-home' : ' is-chat'}${aiUI.sideOpen ? ' has-hist' : ''}${drawerR ? ' has-right' : ''}">
    <header class="b3-bar">
      <button class="b3-brand" onclick="aiAccueil()" title="Accueil de Pear AI">
        <span class="b3-mark">BB</span><b>Pear AI</b></button>
      <span class="b3-status ${c.has_key ? 'is-on' : 'is-off'}" title="${c.has_key ? esc(c.model || '') : ''}"><i></i>${c.has_key ? 'Connecté' : 'Non connecté'}</span>
      <span class="b3-sp"></span>
      <div class="b3-seg" role="tablist" aria-label="Périmètre">${[['ALL', 'Global'], ...siteList().map(s => [s.code, siteName(s.code)])].map(([v, l]) =>
        `<button class="${pays === v ? 'is-on' : ''}" role="tab" aria-selected="${pays === v}" onclick="aicPays('${v}')">${l}</button>`).join('')}</div>
      <button class="b3-btn${aiUI.sideOpen ? ' is-on' : ''}" onclick="aiSide(!aiUI.sideOpen)" aria-label="Historique">${_aiIco('chat')}<span>Historique</span>${convs.length ? `<em>${convs.length}</em>` : ''}${enCours ? '<i class="b3-run" title="Tâche en cours"></i>' : ''}</button>
      <button class="b3-btn${aiUI.showKb ? ' is-on' : ''}" onclick="aiKbToggle()" aria-label="Documents">${_aiIco('book')}<span>Documents</span>${nDocs ? `<em>${nDocs}</em>` : ''}</button>
      <button class="b3-btn is-pri" onclick="aiNew()">${_aiIco('plus')}<span>Nouveau</span></button>
      <button class="b3-icon${aiUI.showConf ? ' is-on' : ''}" onclick="aiToggleConf()" title="Réglages" aria-label="Réglages">${_aiIco('gear')}</button>
    </header>

    <div class="b3-body" id="ai-thread">
      ${accueil ? `<div class="b3-home">
        <section class="b3-hero">
          <h1>Bonjour${prenom ? ` ${esc(prenom)}` : ''}</h1>
          <p id="aic-hero" class="b3-hero-sub">${esc(new Date().toLocaleDateString((globalThis.PEAR_LOCALE || 'fr-FR'), { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
          ${!c.has_key && !aiUI.showConf ? _aiConnectCard(c) : _aiComposer(c, true)}
        </section>
        <div id="aic-root"></div>
      </div>` : `<div class="b3-thread">
        ${aiUI.msgs.map((m, i) => _aiMsgHtml(m, i)).join('')}
        ${aiUI.busy ? `<div class="bb-msg is-bot"><span class="bb-av">BB</span><div class="bb-body b3-busy"><div class="bb-typing"><i></i><i></i><i></i></div>
          <button type="button" class="b3-stop" onclick="aiStopAsk()" title="Arrêter la réponse"><i></i>Stop</button></div></div>` : ''}
        ${aiUI.err && !aiUI.skill ? `<div class="bb-err">${esc(aiUI.err)}</div>` : ''}
      </div>`}
    </div>
    ${accueil ? '' : `<footer class="b3-foot"><div class="b3-foot-in">${_aiComposer(c)}
      <p class="b3-note">Pear AI peut se tromper : vérifie les chiffres importants. Pas de mots de passe ni de données clients.</p></div></footer>`}

    <aside class="b3-hist" aria-hidden="${!aiUI.sideOpen}">
      <div class="b3-dr-h"><b>Historique</b><button class="b3-icon is-sm" onclick="aiSide(false)" aria-label="Fermer">×</button></div>
      <p class="b3-dr-note">Les conversations restent le temps de la session : recharger la page les efface.</p>
      ${convs.length ? `<div class="b3-convs">${convs.map(x => `<div class="b3-conv${x.id === aiUI.cur ? ' is-on' : ''}">
          <button onclick="aiOpenConv('${x.id}')">${x.msgs.some(m => m.enCours) ? '<i class="b3-run"></i>' : ''}<span>${esc(x.titre || 'Conversation')}</span><small>${x.msgs.length} message${x.msgs.length > 1 ? 's' : ''}</small></button>
          <button class="b3-conv-x" onclick="aiDelConv('${x.id}')" title="Supprimer" aria-label="Supprimer">×</button></div>`).join('')}</div>`
        : '<p class="b3-empty">Aucune conversation pour l\'instant.</p>'}
    </aside>
    <aside class="b3-right" aria-hidden="${!drawerR}">
      ${drawerR === 'skill' ? _aiSkillPanel(c)
        : drawerR === 'kb' ? _aiKbHtml()
        : drawerR === 'conf' ? `<div class="b3-dr-h"><b>Réglages de Pear AI</b><button class="b3-icon is-sm" onclick="aiToggleConf()" aria-label="Fermer">×</button></div>
          <div class="b3-conf">${conf}${_aiInsHtml()}</div>` : ''}
    </aside>
    <div class="b3-scrim" onclick="aiCloseDrawers()"></div>
  </div>`;
  if (_memeVue) Object.entries(_defil).forEach(([sel, y]) => { const n = root.querySelector(sel); if (n && y) n.scrollTop = y; });
  else if (_defil['.b3-hist'] && aiUI.sideOpen) { const n = root.querySelector('.b3-hist'); if (n) n.scrollTop = _defil['.b3-hist']; }
  // L'accueil se dessine dans son emplacement (ai-cockpit.js) ; les données
  // se rechargent au plus une fois par minute ou au changement de pays.
  if (accueil && typeof renderAiCockpit === 'function') renderAiCockpit();
  const th = document.getElementById('ai-thread');
  // Fil : en bas seulement à l'arrivée d'un message (ou en changeant de
  // conversation), pas à chaque rafraîchissement d'un panneau.
  const nMsg = `${aiUI.cur}|${aiUI.msgs.length}|${aiUI.busy}`;
  if (th && !accueil && (!_memeVue || root.dataset.nmsg !== nMsg)) th.scrollTop = th.scrollHeight;
  root.dataset.nmsg = nMsg;
  const inp = document.getElementById('ai-input');
  if (inp && saisie && saisie.v) inp.value = saisie.v;
  if (inp && saisie && saisie.f) { inp.focus(); try { inp.setSelectionRange(saisie.a, saisie.b); } catch {} }
  if (inp) aiGrow(inp);
}

// ── Icônes (traits, comme le reste de l'appli) ──
const _AI_ICO = {
  pin:       '<path d="M12 17v5"/><path d="M9 10.76V6h6v4.76l2 3.24H7z"/><path d="M8 3h8"/>',
  chat:      '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  target:    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  chart:     '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 8a5 5 0 0 1 0 8"/>',
  handover:  '<path d="M7 7h11l-3-3"/><path d="M17 17H6l3 3"/>',
  search:    '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  pen:       '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  gear:      '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  copy:      '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  send:      '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
  plus:      '<path d="M12 5v14M5 12h14"/>',
  user:      '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  list:      '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  team:      '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  up:        '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>',
  regen:     '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 4v5h-5"/>',
  spark:     '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
  home:      '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  book:      '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  doc:       '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
  decision:  '<path d="M12 3v6"/><path d="M12 9l-6 6M12 9l6 6"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/>',
};
function _aiIco(n) {
  return `<svg class="ai-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${_AI_ICO[n] || _AI_ICO.spark}</svg>`;
}

// ── Conversations (mémoire de la session) ──
function _aiEnsureConv() {
  let cv = aiUI.convs.find(x => x.id === aiUI.cur);
  if (!cv) { cv = { id: 'c' + Date.now().toString(36), titre: '', msgs: [] }; aiUI.convs.unshift(cv); aiUI.cur = cv.id; }
  aiUI.msgs = cv.msgs;
  return cv;
}
function _aiTitre(t) {
  const cv = _aiEnsureConv();
  if (!cv.titre) cv.titre = String(t || '').replace(/\s+/g, ' ').slice(0, 42) + (String(t || '').length > 42 ? '…' : '');
}
function aiNew() {
  const cv = aiUI.convs.find(x => x.id === aiUI.cur);
  if (cv && !cv.msgs.length) { aiUI.skill = ''; aiUI.err = ''; aiUI.sideOpen = false; _aiPaint(); document.getElementById('ai-input')?.focus(); return; }
  aiUI.cur = null; aiUI.kbStrict = false; aiUI.skill = ''; aiUI.err = ''; aiUI.sideOpen = false;
  _aiPaint();
  document.getElementById('ai-input')?.focus();
}
function aiAccueil() { aiUI.kbStrict = false; aiUI.cur = null; aiUI.skill = ''; aiUI.err = ''; aiUI.sideOpen = false; aiUI.plus = false; _aiPaint(); }
function aiOpenConv(id) { aiUI.cur = id; aiUI.kbStrict = !!(aiUI.convs.find(x => x.id === id)?.msgs || []).some(m => m.knowledge); aiUI.skill = ''; aiUI.err = ''; aiUI.sideOpen = false; _aiPaint(); }
function aiDelConv(id) {
  aiUI.convs = aiUI.convs.filter(x => x.id !== id);
  if (aiUI.cur === id) aiUI.cur = (aiUI.convs[0] || {}).id || null;
  _aiPaint();
}
function aiSide(v) { aiUI.sideOpen = !!v; _aiPaint(); }
function aiCloseDrawers() { _aiReadForm(); aiUI.sideOpen = false; aiUI.skill = ''; aiUI.showConf = false; aiUI.showKb = false; aiUI.err = ''; _aiPaint(); }
function aiToggleConf() { _aiReadForm(); aiUI.skill = ''; aiUI.showKb = false; aiUI.showConf = !aiUI.showConf; aiUI.sideOpen = false; _aiPaint(); if (aiUI.showConf) aiInsLoad(); }
function aiGrow(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 220) + 'px'; }
function aiKey(e) {
  // Menu « / » ouvert : flèches pour choisir, Entrée pour ouvrir l'outil.
  const pop = document.getElementById('ai-slash');
  if (pop && !pop.hidden) {
    const items = [...pop.querySelectorAll('button')];
    let k = items.findIndex(b => b.classList.contains('is-hl'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      k = (k + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((b, j) => b.classList.toggle('is-hl', j === k));
      items[k]?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Enter' && items.length) { e.preventDefault(); (items[k] || items[0]).click(); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); pop.hidden = true; return; }
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); aiSend(); }
}
// Liste des outils, groupée par usage, filtrée par ce qu'on tape.
function _aiToolsPop(q) {
  const n = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const t = n(q);
  const items = (aiUI.skills || []).filter(sk => !t || n(sk.titre + ' ' + sk.desc + ' ' + sk.categorie).includes(t));
  if (!items.length) return `<div class="bb-pop"><p class="bb-pop-e">Aucun outil ne correspond.</p></div>`;
  const cats = [...new Set(items.map(sk => sk.categorie || 'Autres'))];
  return `<div class="bb-pop">${cats.map(cat => `<div class="bb-pop-h">${esc(cat)}</div>${items.filter(sk => (sk.categorie || 'Autres') === cat).map(sk =>
    `<button type="button" onclick="aiUI.plus=false;aiSlashClose();aiPick('${sk.id}')">${_aiIco(sk.icone)}<span><b>${esc(sk.titre)}</b><small>${esc(sk.desc)}</small></span></button>`).join('')}`).join('')}</div>`;
}
// « / » au début de la saisie : le menu des outils, filtré au fil de la frappe.
function aiSlash(el) {
  const pop = document.getElementById('ai-slash');
  if (!pop) return;
  const m = /^\/(\S*)$/.exec(el.value);
  if (!m) { pop.hidden = true; return; }
  const html = _aiToolsPop(m[1]);
  pop.innerHTML = html.replace(/^<div class="bb-pop">|<\/div>$/g, '');
  pop.hidden = false;
  pop.querySelector('button')?.classList.add('is-hl');
}
function aiSlashClose() {
  const i = document.getElementById('ai-input');
  if (i && /^\/\S*$/.test(i.value)) i.value = '';
  const pop = document.getElementById('ai-slash'); if (pop) pop.hidden = true;
}
// Pas encore connecté : une seule chose à faire, au centre de l'accueil.
function _aiConnectCard(c) {
  return `<section class="bb-connect">
      <span class="bb-connect-i">${_aiIco('spark')}</span>
      <div class="bb-connect-t"><b>Connecte Pear AI</b>
        <span>Colle ta clé API : l'adresse, le modèle et le proxy se règlent tout seuls. L'accueil ci-dessous marche déjà sans.</span></div>
      <form class="bb-connect-f" onsubmit="event.preventDefault();aiQuickConnect()">
        <input id="ai-quick-key" type="password" placeholder="${c.has_key ? 'Clé actuelle ' + esc(c.key_hint) : 'Clé API (sk-…)'}" autocomplete="new-password" spellcheck="false">
        <button class="bb-run" type="submit" ${aiUI.diagBusy ? 'disabled' : ''}>${aiUI.diagBusy ? 'Connexion…' : 'Connecter'}</button>
      </form>
      <button type="button" class="bb-connect-adv" onclick="aiToggleConf()">Réglages détaillés (proxy, certificat, commande ia)</button>
      ${aiUI.err ? `<div class="bb-err is-in">${esc(aiUI.err)}</div>` : ''}
    </section>`;
}
function aiPlus() { aiUI.plus = !aiUI.plus; _aiPaint(); }
function aiSuggest(t) {
  const i = document.getElementById('ai-input');
  if (i && !i.disabled) { i.value = t; aiGrow(i); i.focus(); }
}

// ── Accueil, messages, saisie ──
// Accueil : tous les skills, rangés par usage. Chaque carte ouvre son
// formulaire dans une fenêtre ; la saisie libre reste en bas.
const AI_CATS = [
  ['Pilotage', 'Décider et prioriser'], ['Équipe', 'Suivre et accompagner'],
  ['Rapports', 'Préparer les rapports'], ['Opérations', 'Analyser un incident'], ['Outils', 'Écrire mieux'],
];
function _aiWelcomeHtml(c) {
  const skills = aiUI.skills || [];
  const cats = AI_CATS.map(([cat, sous]) => ({ cat, sous, items: skills.filter(x => x.categorie === cat) }))
    .concat([{ cat: 'Autres', sous: '', items: skills.filter(x => !AI_CATS.some(([k]) => k === x.categorie)) }])
    .filter(g => g.items.length);
  const idees = [
    'Explique la différence entre un incident et un problème, avec un exemple de supervision.',
    'Rédige un message pour rappeler à l\'équipe de renseigner la date de clôture des tickets.',
    'Quelles questions poser en revue mensuelle de performance ?',
  ];
  return `<div class="bb-welcome">
      <div class="bb-logo">BB</div>
      <h2>${c.has_key ? 'Comment puis-je t\'aider ?' : 'Pear AI n\'est pas encore connecté'}</h2>
      ${c.has_key ? '<p class="bb-sub">Choisis un outil, ou pose ta question en bas.</p>' : '<button class="bb-cta" onclick="aiToggleConf()">Connecter Pear AI</button>'}
      <div class="bb-gal">${cats.map(g => `<section class="bb-gal-g">
        <div class="bb-gal-h"><b>${esc(g.cat)}</b>${g.sous ? `<span>${esc(g.sous)}</span>` : ''}</div>
        <div class="bb-gal-l">${g.items.map(x => `<button class="bb-tool" onclick="aiPick('${x.id}')" ${c.has_key ? '' : 'disabled'}>
          <span class="bb-tool-i">${_aiIco(x.icone)}</span>
          <span class="bb-tool-t"><b>${esc(x.titre)}</b><small>${esc(x.desc)}</small></span>
          <span class="bb-tool-go" aria-hidden="true">›</span></button>`).join('')}</div>
      </section>`).join('')}</div>
      ${c.has_key ? `<div class="bb-ideas">${idees.map(t => `<button class="bb-idea" onclick="aiSuggest(${JSON.stringify(t).replace(/"/g, '&quot;')})">${esc(t)}</button>`).join('')}</div>` : ''}
    </div>`;
}

function _aiMsgHtml(m, i) {
  if (m.enCours || m.echec || m.arrete) return _aiJobHtml(m);
  if (m.role === 'user') return `<div class="bb-msg is-user"><div class="bb-bubble">${m.knowledge ? `<span class="bb-tag">${_aiIco('book')}Knowledge</span>` : ''}${m.skill ? `<span class="bb-tag">${_aiIco('spark')}${esc(m.skillTitre || '')}</span>` : ''}${esc(m.content).replace(/\n/g, '<br>')}</div></div>`;
  const dernier = i === aiUI.msgs.length - 1;
  return `<div class="bb-msg is-bot"><span class="bb-av">BB</span><div class="bb-body">
      ${_aiFiltrePays(m, i)}
      ${m.vue ? _aiVue(m) : `<div class="ai-md">${_aiFormat(m.content)}</div>`}
      ${(m.sources || []).length ? `<div class="b3-src"><span>${_aiIco('book')}Sources</span>${m.sources.map(x =>
        `<button type="button" title="${esc(x.extrait)}…" onclick="aiKbOuvrir('${esc(x.doc)}')"><b>[${x.n}]</b> ${esc(x.name)}<small>passage${x.part_fin && x.part_fin > x.part ? `s ${x.part}–${x.part_fin}` : ` ${x.part}`}</small></button>`).join('')}</div>` : ''}
      <div class="bb-acts">
        <button class="bb-ibtn is-sm" onclick="aiCopyMsg(${i})" title="Copier" aria-label="Copier">${_aiIco('copy')}</button>
        ${m.vide || m.test ? '' : `<button class="bb-ibtn is-sm bb-pdf" onclick="aiPdfMsg(${i})" title="Télécharger en PDF" aria-label="Télécharger en PDF">${_aiIco('doc')}<span>PDF</span></button>`}
        ${m.skill && !m.test && !m.vide ? `<button class="bb-ibtn is-sm bb-pdf${m.epingle ? ' is-on' : ''}" onclick="aiEpingler(${i})" ${m.epingle ? 'disabled' : ''}
            title="${m.epingle ? 'Épinglé sur l\'accueil' : 'Épingler sur l\'accueil de Pear AI'}" aria-label="Épingler">${_aiIco('pin')}<span>${m.epingle ? 'Épinglé' : 'Épingler'}</span></button>` : ''}
        ${dernier && !aiUI.busy && !m.test ? `<button class="bb-ibtn is-sm" onclick="aiRegen()" title="Régénérer" aria-label="Régénérer">${_aiIco('regen')}</button>` : ''}
        ${m.meta ? `<span class="bb-meta">${esc(m.meta)}</span>` : ''}
      </div></div></div>`;
}

function _aiComposer(c, hero) {
  const on = c.has_key && !aiUI.busy;
  return `<div class="bb-composer${hero ? ' is-hero' : ''}${c.has_key ? '' : ' is-off'}">
      ${aiUI.plus ? _aiToolsPop('') : ''}
      <div class="bb-pop bb-slash" id="ai-slash" hidden></div>
      <button class="bb-plus${aiUI.plus ? ' is-on' : ''}" onclick="aiPlus()" title="Outils" aria-label="Outils">${_aiIco('spark')}<span>Outils</span></button>
      ${!aiUI.kbStrict && (aiUI.kb?.docs || []).length && aiUI.kb.enabled ? `<button type="button" class="b3-kbchip${aiUI.kbOn ? ' is-on' : ''}" onclick="aiUI.kbOn=!aiUI.kbOn;_aiPaint()" title="${aiUI.kbOn ? 'Pear AI s\'appuie sur tes documents' : 'Documents ignorés pour cette conversation'}">${_aiIco('book')}<span>${aiUI.kbOn ? 'Docs' : 'Sans docs'}</span></button>` : ''}
      ${aiUI.kbStrict ? `<button type="button" class="b3-mode" onclick="aiKnowledge(false)" title="Quitter le mode Knowledge">${_aiIco('book')}<span>Knowledge</span><i>×</i></button>` : ''}
      <textarea id="ai-input" rows="1" maxlength="${c.limits?.chars_message || 8000}" oninput="aiGrow(this);aiSlash(this)" onkeydown="aiKey(event)"
        placeholder="${!c.has_key ? 'Connecte Pear AI pour commencer' : aiUI.kbStrict ? 'Pose ta question aux documents…' : 'Écris à Pear AI, ou tape / pour choisir un outil'}" ${c.has_key ? '' : 'disabled'}></textarea>
      ${aiUI.busy ? `<button class="bb-send is-stop" onclick="aiStopAsk()" title="Arrêter la réponse" aria-label="Arrêter"><i></i></button>`
        : `<button class="bb-send" onclick="aiSend()" ${on ? '' : 'disabled'} title="Envoyer" aria-label="Envoyer">${_aiIco('up')}</button>`}
    </div>`;
}

// ── Un skill : formulaire au-dessus de la saisie ──
function _aiSkillPanel(c) {
  const sk = (aiUI.skills || []).find(x => x.id === aiUI.skill);
  if (!sk) return '';
  const f = aiUI.forms[sk.id] || {};
  const champ = ch => {
    const v = f[ch.id] ?? (ch.pays ? _aiPaysActif() : ch.type === 'date' ? new Date().toISOString().slice(0, 10) : undefined);
    const id = `ai-f-${ch.id}`;
    const opts = ch.type === 'agent' ? ['', ...(ch.options || [])] : (ch.options || []);
    const vide = ch.type === 'agent' ? (ch.tous ? 'Toute l\'équipe' : 'Choisir un agent…') : '';
    let input;
    if (ch.type === 'textarea') input = `<textarea id="${id}" rows="2" maxlength="${ch.max || 2000}" placeholder="${esc(ch.placeholder || '')}">${esc(v || '')}</textarea>`;
    else if (ch.type === 'select' || ch.type === 'agent') input = `<select id="${id}">${opts.map(o => `<option value="${esc(o)}"${(v || '') === o ? ' selected' : ''}>${esc(o || vide)}</option>`).join('')}</select>`;
    else if (ch.type === 'checkbox') return `<label class="ai-check"><input id="${id}" type="checkbox"${v ? ' checked' : ''}> ${esc(ch.label)}</label>`;
    else input = `<input id="${id}" type="${ch.type === 'date' ? 'date' : 'text'}" value="${esc(v || '')}">`;
    return `<label class="ai-f${ch.type === 'textarea' ? ' is-wide' : ''}"><span>${esc(ch.label)}${ch.required ? ' *' : ''}</span>${input}</label>`;
  };
  const busy = aiUI.skillBusy === sk.id;
  return `<section class="bb-sheet" aria-label="${esc(sk.titre)}">
      <header class="bb-sheet-h"><span class="bb-tool-i is-lg">${_aiIco(sk.icone)}</span>
        <div><small>${esc(sk.categorie || '')}</small><b>${esc(sk.titre)}</b></div>
        <button class="bb-ibtn" onclick="aiPick('')" aria-label="Fermer">×</button></header>
      <p class="bb-sheet-d">${esc(sk.desc)}</p>
      ${sk.champs.length ? `<div class="ai-form bb-sheet-f">${sk.champs.map(champ).join('')}</div>` : ''}
      <details class="bb-sheet-data"><summary>${_aiIco('search')}Ce qui est envoyé à Pear AI</summary><p>${esc(sk.donnees)}</p></details>
      ${aiUI.err ? `<div class="bb-err is-in">${esc(aiUI.err)}</div>` : ''}
      <footer class="bb-sheet-b">
        <span class="bb-sheet-k"><kbd>Ctrl</kbd>+<kbd>Entrée</kbd> pour lancer · <kbd>Échap</kbd> pour fermer</span>
        <button class="bb-btn2" onclick="aiPick('')">Annuler</button>
        <button class="bb-run" onclick="aiRunSkill()" ${(c.has_key || sk.local) && !busy ? '' : 'disabled'}>${busy ? 'En cours…' : (sk.lancer || 'Lancer')}</button>
      </footer>
    </section>`;
}

// Valeurs du formulaire du skill affiché, gardées en mémoire.
function _aiReadForm() {
  const sk = (aiUI.skills || []).find(x => x.id === aiUI.skill);
  if (!sk) return null;
  const f = {};
  sk.champs.forEach(ch => {
    const el = document.getElementById(`ai-f-${ch.id}`);
    if (el) f[ch.id] = ch.type === 'checkbox' ? el.checked : el.value;
  });
  aiUI.forms[sk.id] = f;
  return { sk, f };
}

// « Knowledge » n'est pas un formulaire : c'est un mode de la saisie. Les
// questions partent vers /api/ai/kb/ask, qui ne répond qu'à partir des
// documents importés, sources à l'appui.
const _AI_KNOWLEDGE = { id: 'knowledge', titre: 'Knowledge', categorie: 'Outils', icone: 'book', champs: [], local: 'knowledge',
  desc: 'Répond uniquement à partir des documents importés, chaque point sourcé.' };
function aiKnowledge(on) {
  aiUI.kbStrict = !!on; aiUI.plus = false; aiUI.skill = ''; aiUI.showKb = false; aiUI.showConf = false;
  if (on && aiUI.msgs.length && !aiUI.msgs.some(m => m.knowledge)) aiUI.cur = null; // nouvelle conversation dédiée
  _aiPaint();
  const i = document.getElementById('ai-input');
  if (i) { if (/^\/\S*$/.test(i.value)) i.value = ''; i.focus(); }
}
function aiPick(id) {
  if (id === 'knowledge') return aiKnowledge(true);
  _aiReadForm();
  aiUI.skill = aiUI.skill === id ? '' : (id || '');
  aiUI.err = ''; aiUI.plus = false; aiUI.sideOpen = false;
  _aiPaint();
  if (aiUI.skill) setTimeout(() => document.querySelector('#page-ai .bb-sheet input, #page-ai .bb-sheet select, #page-ai .bb-sheet textarea, #page-ai .bb-run')?.focus(), 30);
}
document.addEventListener('keydown', e => {
  if (!document.getElementById('page-ai')?.classList.contains('active')) return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && aiUI.skill) { e.preventDefault(); aiRunSkill(); return; }
  if (e.key !== 'Escape') return;
  if (aiUI.skill) aiPick('');
  else if (aiUI.plus) { aiUI.plus = false; _aiPaint(); }
  else if (aiUI.sideOpen) aiSide(false);
  else if (aiUI.showKb) aiKbToggle();
  else if (aiUI.showConf) aiToggleConf();
});
// Un clic hors du menu des outils le ferme.
document.addEventListener('click', e => {
  if (!aiUI.plus || e.target.closest('#page-ai .bb-pop, #page-ai .bb-plus, #page-ai .bb-rail-b')) return;
  aiUI.plus = false; _aiPaint();
});

// Résumé lisible des choix faits dans le formulaire, pour la bulle.
function _aiResumeForm(sk, f) {
  return sk.champs.map(ch => {
    const v = f[ch.id];
    if (ch.type === 'checkbox') return v ? ch.label : '';
    if (ch.type === 'agent' && !v) return ch.tous ? 'Toute l\'équipe' : '';
    if (!v) return '';
    return ch.type === 'textarea' ? String(v).slice(0, 160) + (String(v).length > 160 ? '…' : '') : v;
  }).filter(Boolean).join(' · ');
}

async function aiRunSkill(relance) {
  const lu = relance || _aiReadForm();
  if (!lu) return;
  const { sk, f } = lu;
  if (sk.local === 'insights') return aiRunInsights(sk, f, !!relance);
  const manque = sk.champs.find(ch => ch.required && !f[ch.id]);
  if (manque) { aiUI.err = `Champ requis : ${manque.label}.`; _aiPaint(); return; }
  _aiEnsureConv();
  if (!relance) {
    aiUI.msgs.push({ role: 'user', content: _aiResumeForm(sk, f) || 'Lancer', skill: sk.id, skillTitre: sk.titre, input: f });
    _aiTitre(sk.titre);
  }
  // En arrière-plan : le serveur rend tout de suite un identifiant de
  // tâche ; la réponse s'affiche avec l'étape en cours, puis le résultat.
  // On peut écrire, lancer autre chose ou changer de page en attendant.
  const cv = _aiEnsureConv();
  aiUI.skill = ''; aiUI.skillBusy = sk.id; aiUI.err = ''; _aiPaint();
  try {
    const r = await _aiFetch(`/api/ai/skills/${encodeURIComponent(sk.id)}`, { method: 'POST', body: JSON.stringify({ input: f, fond: true }) });
    cv.msgs.push({ role: 'assistant', enCours: true, job: r.job.id, etape: r.job.etape, debut: Date.now(), skill: sk.id, input: f, titre: sk.titre, conv: cv.id });
  } catch (e) { aiUI.err = e.message; }
  aiUI.skillBusy = '';
  _aiPaint();
  _aiSuivreJobs();
}

// ── Tâches en cours ───────────────────────────────────────────
// Une seule boucle pour toutes les conversations : une lecture par
// seconde de chaque tâche, l'étape mise à jour sur place (sans repeindre
// la page), le résultat posé à la place du message d'attente.
let _aiJobsTimer = null;
function _aiJobsEnCours() { return aiUI.convs.flatMap(cv => cv.msgs.filter(m => m.enCours)); }
function _aiJobHtml(m) {
  if (m.arrete) return `<div class="bb-msg is-bot"><span class="bb-av">BB</span><div class="bb-body">
      <div class="bb-job is-stop"><b>${esc(m.titre || 'Skill')} : arrêté</b><span>Tu as arrêté la tâche.</span>
      <button class="bb-link" onclick="aiRelancerJob('${m.job}')">Relancer</button></div></div></div>`;
  if (m.echec) return `<div class="bb-msg is-bot"><span class="bb-av">BB</span><div class="bb-body">
      <div class="bb-job is-err"><b>${esc(m.titre || 'Skill')} : échec</b><span>${esc(m.echec)}</span>
      <button class="bb-link" onclick="aiRelancerJob('${m.job}')">Relancer</button></div></div></div>`;
  const s = Math.round((Date.now() - (m.debut || Date.now())) / 1000);
  return `<div class="bb-msg is-bot"><span class="bb-av is-run">BB</span><div class="bb-body">
      <div class="bb-job" id="ai-job-${m.job}"><span class="bb-job-dot"></span>
        <div><small>${esc(m.titre || 'Skill')} · en arrière-plan, tu peux changer de page · <span class="bb-job-t">${s} s</span></small>
        <p class="bb-job-e" aria-live="polite">${esc(m.etape || 'Préparation…')}</p></div>
        <button type="button" class="b3-stop" onclick="aiStopJob('${m.job}')" title="Arrêter cette tâche"><i></i>Stop</button></div></div></div>`;
}
function _aiSuivreJobs() {
  if (_aiJobsTimer || !_aiJobsEnCours().length) return;
  _aiJobsTimer = setInterval(_aiTickJobs, 1000);
}
async function _aiTickJobs() {
  const liste = _aiJobsEnCours();
  if (!liste.length) { clearInterval(_aiJobsTimer); _aiJobsTimer = null; return; }
  let repeindre = false;
  await Promise.all(liste.map(async m => {
    // Le temps écoulé avance chaque seconde, même entre deux lectures.
    const el = document.getElementById(`ai-job-${m.job}`);
    if (el) el.querySelector('.bb-job-t').textContent = `${Math.round((Date.now() - m.debut) / 1000)} s`;
    let j;
    try { j = await _aiFetch(`/api/ai/jobs/${m.job}`); }
    catch (e) { j = { etat: 'erreur', erreur: e.message }; }
    if (j.etat === 'en_cours') {
      if (j.etape !== m.etape) {
        m.etape = j.etape;
        const p = el && el.querySelector('.bb-job-e');
        if (p) { p.classList.remove('is-new'); void p.offsetWidth; p.textContent = j.etape; p.classList.add('is-new'); }
      }
      return;
    }
    delete m.enCours;
    repeindre = true;
    if (j.etat === 'fini') {
      const r = j.resultat || {};
      const tok = r.usage?.total ? ` · ${r.usage.total} tokens` : '';
      Object.assign(m, { content: r.content, vue: r.vue, data: r.data, faits: r.faits, vide: r.vide,
        meta: r.vide ? `${m.titre} · sans appel au modèle` : r.data?._secours ? `${m.titre} · version calculée sans IA` : `${m.titre} · ${Math.round(j.ms / 1000)} s${tok}${r.finish_reason === 'length' ? ' · tronqué' : ''}` });
      _aiPrevenir(m, `${m.titre} est prêt`);
    } else if (j.etat === 'annule') {
      m.arrete = true;
    } else {
      m.echec = j.erreur || 'La tâche a échoué.';
      _aiPrevenir(m, `${m.titre} : échec`, true);
    }
  }));
  if (repeindre && document.getElementById('page-ai')?.classList.contains('active')) _aiPaint();
}
// Prévenir quand le résultat arrive ailleurs que sous les yeux.
function _aiPrevenir(m, texte, erreur) {
  const visible = document.getElementById('page-ai')?.classList.contains('active') && aiUI.cur === m.conv;
  if (!visible && typeof toast === 'function') toast(`Pear AI : ${texte}`, erreur ? 'error' : 'success');
}
async function aiStopJob(id) {
  const m = _aiJobsEnCours().find(x => x.job === id);
  try { await _aiFetch(`/api/ai/jobs/${id}/cancel`, { method: 'POST', body: '{}' }); } catch (e) { /* déjà terminée */ }
  if (m) { delete m.enCours; m.arrete = true; }
  _aiPaint();
}
// Question directe en cours : on abandonne la requête, le serveur coupe
// l'appel au modèle (voir arretSiAbandon côté serveur).
let _aiAskCtrl = null;
function aiStopAsk() { if (_aiAskCtrl) _aiAskCtrl.abort(); }
function aiRelancerJob(id) {
  for (const cv of aiUI.convs) {
    const i = cv.msgs.findIndex(m => m.job === id);
    if (i < 0) continue;
    const m = cv.msgs[i];
    const sk = (aiUI.skills || []).find(x => x.id === m.skill);
    if (!sk) return;
    cv.msgs.splice(i, 1);
    aiUI.cur = cv.id;
    return aiRunSkill({ sk, f: m.input || {} });
  }
}

// Lance un outil depuis une autre page (ex. le Tableau de bord Big
// Brother) : ouvre Pear AI sur une nouvelle conversation et l'exécute.
async function aiLaunchSkill(id, f) {
  if (typeof renderPage === 'function') renderPage('ai');
  for (let n = 0; n < 40 && !(aiUI.skills || []).length; n++) await new Promise(r => setTimeout(r, 150));
  const sk = (aiUI.skills || []).find(x => x.id === id);
  if (!sk) { if (typeof toast === 'function') toast('Pear AI n\'est pas disponible', 'error'); return; }
  aiUI.cur = null;
  return aiRunSkill({ sk, f: f || {} });
}
window.aiLaunchSkill = aiLaunchSkill;

// ── Skill « Insights des agents » ─────────────────────────────
// Pas d'appel direct au modèle depuis la page : le serveur génère les
// insights un agent après l'autre (services/ai-insight.js). Le skill lance
// la passe et suit son avancement dans la conversation.
function _aiSkillInsights() {
  return {
    id: 'insights', local: 'insights', titre: 'Insights des agents', icone: 'spark', categorie: 'Équipe',
    lancer: 'Générer',
    desc: 'Génère l\'insight de performance des agents (ce qui va, à travailler, prochain pas) et suit la génération agent par agent.',
    donnees: 'Pour chaque agent activé : sa note, ses objectifs et ses chiffres du mois, sous alias. Les insights restent visibles par l\'agent seul, dans sa page Performance.',
    champs: [{ id: 'fo', label: 'Pour qui ?', type: 'agent', tous: true, options: ((state.config && state.config.fo_list) || []).slice() }],
  };
}

async function aiRunInsights(sk, f, relance) {
  _aiEnsureConv();
  if (!relance) {
    aiUI.msgs.push({ role: 'user', content: f.fo ? `Insight de ${f.fo}` : 'Insights de toute l\'équipe', skill: sk.id, skillTitre: sk.titre, input: f });
    _aiTitre(sk.titre);
  }
  aiUI.skill = ''; aiUI.err = ''; aiUI.busy = true; _aiPaint();
  const msg = { role: 'assistant', vue: 'insights', skill: sk.id, data: null, cible: f.fo || '', meta: 'Insights des agents' };
  try {
    const r = await _aiFetch('/api/ai/insights/run', { method: 'POST', body: JSON.stringify({ fo: f.fo || '', force: !!f.fo }) });
    msg.data = r; msg.lance = !!r.lance;
    aiUI.msgs.push(msg);
  } catch (e) { aiUI.err = e.message; }
  aiUI.busy = false; _aiPaint();
  // Suivi : rafraîchi toutes les 2 s tant que la passe tourne.
  const suivre = async () => {
    try { msg.data = await _aiFetch('/api/ai/insights'); } catch { return; }
    if (document.getElementById('page-ai')?.classList.contains('active')) _aiPaint();
    if (msg.data?.passe?.encours) setTimeout(suivre, 2000);
  };
  if (msg.data?.passe?.encours) setTimeout(suivre, 2000);
}

function _aiVueInsights(r) {
  const d = r.data || {};
  const p = d.passe || {};
  const agents = (d.agents || []).filter(a => !r.cible || a.fo === r.cible);
  if (!d.enabled) return `<div class="ai-vue"><div class="ai-trunc">${_aiIco('spark')}<span>Les insights des agents sont désactivés.
      <button class="bb-link" onclick="aiToggleConf()">Les activer dans les réglages</button></span></div></div>`;
  const actifs = agents.filter(a => a.actif);
  if (!actifs.length) return `<div class="ai-vue"><div class="ai-trunc">${_aiIco('spark')}<span>${r.cible ? `${esc(r.cible)} n'est pas activé pour les insights.` : 'Aucun agent n\'est activé pour les insights.'}
      <button class="bb-link" onclick="aiToggleConf()">Choisir les agents</button></span></div></div>`;
  const total = p.total || 0, fait = p.fait || 0;
  const pct = total ? Math.round(fait / total * 100) : 100;
  const enCours = !!p.encours;
  const faits = actifs.filter(a => a.etat === 'fait').length;
  return `<div class="ai-vue">
    <div class="ai-ins-run">
      <b>${enCours ? `Génération en cours : ${fait} / ${total}` : r.lance === false && !enCours ? 'Tout est déjà à jour' : 'Génération terminée'}</b>
      <span>${enCours && p.courant ? `en ce moment : ${esc(p.courant)}` : `${faits} / ${actifs.length} insight(s) à jour`}</span>
      <i class="ai-ins-bar"><em style="width:${enCours ? pct : 100}%"></em></i>
    </div>
    <div class="ai-ins-list">${actifs.map(a => {
      const [t, c] = _AI_INS_ETAT[a.etat] || [a.etat, 'is-info'];
      return `<div class="ai-ins-row"><b>${esc(a.fo)}</b><span class="bb-st ${c}">${esc(t)}</span>
        <small>${a.erreur ? esc(a.erreur) : a.dernier ? `dernier : ${esc(_aiDate(String(a.dernier.at || '').slice(0, 10)))}` : ''}</small></div>`;
    }).join('')}</div>
    <p class="ai-na" style="margin:0;font-size:12.5px">Chaque agent voit son insight dans sa page Performance, sans rien faire.</p>
  </div>`;
}

async function aiCopyMsg(i) {
  const m = aiUI.msgs[i];
  if (!m) return;
  try { await navigator.clipboard.writeText(m.vue ? _aiTexte(m) : m.content); if (typeof toast === 'function') toast('Copié'); }
  catch { if (typeof toast === 'function') toast('Copie impossible : sélectionne le texte', 'error'); }
}


// Régénérer : retire la dernière réponse et relance la même demande.
function aiRegen() {
  const last = aiUI.msgs[aiUI.msgs.length - 1];
  if (!last || last.role !== 'assistant' || aiUI.busy) return;
  aiUI.msgs.pop();
  const q = aiUI.msgs[aiUI.msgs.length - 1];
  if (q && q.skill) {
    const sk = (aiUI.skills || []).find(x => x.id === q.skill);
    if (sk) return aiRunSkill({ sk, f: q.input || {} });
  }
  _aiAsk(undefined, !!(q && q.knowledge));
}


// Ce qui a été saisi dans le formulaire. Les champs secrets ne partent
// que s'ils sont remplis : vides, ils gardent la valeur enregistrée.
function _aiCollect() {
  const body = {};
  const v = id => document.getElementById(id);
  const u = v('ai-url'), m = v('ai-model'), k = v('ai-key');
  if (u && !u.disabled && u.value.trim() && u.value.trim() !== aiUI.conf?.base_url) body.base_url = u.value.trim();
  if (m && !m.disabled && m.value.trim() && m.value.trim() !== aiUI.conf?.model) body.model = m.value.trim();
  if (k && !k.disabled && k.value.trim()) body.api_key = k.value.trim();
  const mode = v('ai-proxy-mode');
  if (mode && mode.value !== aiUI.conf?.proxy_mode) body.proxy_mode = mode.value;
  const px = v('ai-proxy');
  if (px && !px.hidden && px.value.trim()) body.proxy = px.value.trim();
  const pu = v('ai-proxy-user'), pp = v('ai-proxy-pass');
  if (pu && pu.value.trim() && pu.value.trim() !== (aiUI.conf?.proxy_user || '')) body.proxy_user = pu.value.trim();
  if (pp && pp.value) body.proxy_pass = pp.value;
  const ca = v('ai-ca');
  if (ca && ca.value.trim()) body.ca_pem = ca.value.trim();
  return body;
}

// Academy : ouvrir ou non les questions dans les cours aux agents.
async function aiReflexion(on) {
  try { aiUI.conf = await _aiFetch('/api/ai/config', { method: 'PUT', body: JSON.stringify({ reflexion: !!on }) }); aiUI.err = ''; }
  catch (e) { aiUI.err = e.message; }
  _aiPaint();
}
async function aiAcademyOpen(on) {
  try { aiUI.conf = await _aiFetch('/api/ai/config', { method: 'PUT', body: JSON.stringify({ academy_open: !!on }) }); aiUI.err = ''; }
  catch (e) { aiUI.err = e.message; }
  _aiPaint();
}
window.aiAcademyOpen = aiAcademyOpen;

async function aiSaveConf(silent) {
  const body = _aiCollect();
  ['ai-key', 'ai-proxy-pass', 'ai-ca'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  if (!Object.keys(body).length) { if (!silent && typeof toast === 'function') toast('Rien à enregistrer'); return true; }
  try {
    aiUI.conf = await _aiFetch('/api/ai/config', { method: 'PUT', body: JSON.stringify(body) });
    aiUI.err = '';
    if (!silent && typeof toast === 'function') toast('Réglages enregistrés');
    _aiPaint();
    return true;
  } catch (e) { aiUI.err = e.message; _aiPaint(); return false; }
}

function aiProxyMode(v) {
  const px = document.getElementById('ai-proxy');
  if (px) px.hidden = v !== 'manual';
}

// Script .bat du tunnel : téléchargé par fetch (la route exige l'en-tête
// de session admin, qu'un simple lien ne porterait pas).
async function aiTunnelScript() {
  try {
    const res = await fetch(`${API}/api/ai/tunnel-script`, { headers: AdminSession.headers(), credentials: 'same-origin' });
    if (!res.ok) throw new Error(res.status === 401 ? 'Session admin expirée : reconnectez-vous.' : `Erreur ${res.status}`);
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: 'ia.bat' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    if (typeof toast === 'function') toast('ia.bat téléchargé : double-clique dessus sur ton PC pour l\'installer');
  } catch (e) { aiUI.err = e.message; _aiPaint(); }
}

// Un clic : préréglage tunnel + clé, choix du modèle dans la liste du
// service, puis diagnostic complet.
async function aiQuickConnect() {
  const kEl = document.getElementById('ai-quick-key');
  const key = (kEl?.value || '').trim();
  if (kEl) kEl.value = '';
  if (!key && !aiUI.conf?.has_key) { aiUI.err = 'Colle ta clé API pour te connecter.'; _aiPaint(); return; }
  aiUI.diagBusy = true; aiUI.diag = null; aiUI.err = ''; _aiPaint();
  try {
    const body = { preset: 'tunnel' };
    // Sans nouvelle clé, on ne change pas l'adresse si elle est déjà
    // celle du tunnel (changer d'adresse efface la clé enregistrée).
    if (key) body.api_key = key;
    else if (!String(aiUI.conf?.base_url || '').startsWith('http://127.0.0.1')) {
      throw new Error('Colle ta clé : passer sur le tunnel demande de la ressaisir.');
    }
    aiUI.conf = await _aiFetch('/api/ai/config', { method: 'PUT', body: JSON.stringify(body) });
    // Modèle : celui réglé s'il existe chez le service, sinon le premier proposé.
    try {
      const r = await _aiFetch('/api/ai/models');
      aiUI.models = r.models || [];
      if (aiUI.models.length && !aiUI.models.includes(aiUI.conf.model)) {
        const pref = aiUI.models.find(m => /qwen/i.test(m)) || aiUI.models[0];
        aiUI.conf = await _aiFetch('/api/ai/config', { method: 'PUT', body: JSON.stringify({ model: pref }) });
      }
    } catch { /* le diagnostic dira pourquoi */ }
    const d = await _aiFetch('/api/ai/diagnose', { method: 'POST', body: '{}' });
    aiUI.diag = d.etapes || [];
    if (Array.isArray(d.modeles) && d.modeles.length) aiUI.models = d.modeles;
    if (aiUI.diag.length && aiUI.diag.every(e => e.ok !== false)) {
      aiUI.showConf = false;
      if (typeof toast === 'function') toast('Connecté : tu peux poser ta question');
    }
  } catch (e) { aiUI.err = e.message; }
  aiUI.diagBusy = false; _aiPaint();
  if (!aiUI.showConf) document.getElementById('ai-input')?.focus();
}

async function aiClearCa() {
  try { aiUI.conf = await _aiFetch('/api/ai/config', { method: 'PUT', body: JSON.stringify({ clear_ca: true }) }); aiUI.err = ''; }
  catch (e) { aiUI.err = e.message; }
  _aiPaint();
}

async function aiClearProxyAuth() {
  try { aiUI.conf = await _aiFetch('/api/ai/config', { method: 'PUT', body: JSON.stringify({ clear_proxy_auth: true }) }); aiUI.err = ''; }
  catch (e) { aiUI.err = e.message; }
  _aiPaint();
}

// Diagnostic : enregistre d'abord ce qui a été saisi, pour tester les
// réglages affichés et non les précédents.
async function aiDiagnose() {
  if (!(await aiSaveConf(true))) return;
  aiUI.diagBusy = true; aiUI.diag = null; aiUI.err = ''; _aiPaint();
  try {
    const r = await _aiFetch('/api/ai/diagnose', { method: 'POST', body: '{}' });
    aiUI.diag = r.etapes || [];
    if (Array.isArray(r.modeles) && r.modeles.length) aiUI.models = r.modeles;
  } catch (e) { aiUI.err = e.message; }
  aiUI.diagBusy = false; _aiPaint();
}

async function aiLoadModels() {
  if (!(await aiSaveConf(true))) return;
  try {
    const r = await _aiFetch('/api/ai/models');
    aiUI.models = r.models || [];
    aiUI.err = aiUI.models.length ? '' : 'Le service ne renvoie aucun modèle.';
    if (aiUI.models.length && typeof toast === 'function') toast(`${aiUI.models.length} modèle(s) : choisissez dans la liste du champ Modèle`);
  } catch (e) { aiUI.err = e.message; }
  _aiPaint();
  document.getElementById('ai-model')?.focus();
}

async function aiClearKey() {
  if (!confirm('Effacer la clé enregistrée ?')) return;
  try { aiUI.conf = await _aiFetch('/api/ai/config', { method: 'PUT', body: JSON.stringify({ clear_key: true }) }); aiUI.showConf = false; aiUI.err = ''; }
  catch (e) { aiUI.err = e.message; }
  _aiPaint();
}

async function aiTest() {
  _aiEnsureConv();
  aiUI.busy = true; aiUI.err = ''; aiUI.showConf = false; _aiPaint();
  try {
    const r = await _aiFetch('/api/ai/test', { method: 'POST', body: '{}' });
    aiUI.msgs.push({ role: 'assistant', content: r.content, test: true, meta: `Test de connexion · ${r.model} · ${(r.ms / 1000).toFixed(1)} s` });
  } catch (e) { aiUI.err = e.message; }
  aiUI.busy = false; _aiPaint();
}

// Une question qui cherche dans les données (« trouve… », « qui… »,
// « combien… ») part au skill « Rechercher dans Pear » : le chat seul ne
// voit pas les données, il répondrait à côté.
const AI_RECHERCHE_RE = /^\s*(trouve|cherche|recherche|liste|montre|affiche|donne[- ]moi la liste|qui\b|quel(le)?s?\b|combien|y a[- ]t[- ]il|est[- ]ce que quelqu'un)/i;
async function aiSend() {
  const input = document.getElementById('ai-input');
  let txt = (input?.value || '').trim();
  if (!txt || aiUI.busy) return;
  // « /knowledge ma question » (ou /k, /kb) : passe en mode Knowledge.
  const mk = /^\/(knowledge|kb|k)\b\s*/i.exec(txt);
  if (mk) {
    txt = txt.slice(mk[0].length).trim();
    if (!aiUI.kbStrict) { const v = txt; aiKnowledge(true); const i2 = document.getElementById('ai-input'); if (i2) i2.value = v; }
    if (!txt) return;
  }
  if (aiUI.kbStrict) {
    const i3 = document.getElementById('ai-input'); if (i3) i3.value = '';
    aiSlashClose();
    _aiEnsureConv();
    aiUI.msgs.push({ role: 'user', content: txt, knowledge: true });
    _aiTitre(txt);
    return _aiAsk(txt, true);
  }
  const rech = (aiUI.skills || []).find(x => x.id === 'recherche');
  if (rech && AI_RECHERCHE_RE.test(txt)) {
    input.value = '';
    _aiEnsureConv();
    const f = { question: txt.slice(0, 600), pays: _aiPaysActif() };
    aiUI.msgs.push({ role: 'user', content: txt, skill: rech.id, skillTitre: rech.titre, input: f });
    _aiTitre(txt);
    aiUI.plus = false;
    return aiRunSkill({ sk: rech, f });
  }
  input.value = ''; aiSlashClose();
  _aiEnsureConv();
  aiUI.msgs.push({ role: 'user', content: txt });
  _aiTitre(txt);
  aiUI.plus = false;
  await _aiAsk(txt);
}

// Envoie la conversation (sans les tests de connexion ; les résultats de
// skills partent en version texte).
async function _aiAsk(brouillon, knowledge) {
  aiUI.busy = true; aiUI.err = ''; _aiPaint();
  try {
    const hist = aiUI.msgs.filter(m => !m.test)
      .map(m => ({ role: m.role, content: m.vue ? _aiTexte(m) : (m.skill && m.role === 'user' ? `[${m.skillTitre}] ${m.content}` : m.content) }));
    _aiAskCtrl = new AbortController();
    const signal = _aiAskCtrl.signal;
    const r = knowledge
      ? await _aiFetch('/api/ai/kb/ask', { method: 'POST', body: JSON.stringify({ messages: hist }), signal })
      : await _aiFetch('/api/ai/chat', { method: 'POST', body: JSON.stringify({ messages: hist, kb: aiUI.kbOn }), signal });
    _aiAskCtrl = null;
    const tok = r.usage?.total ? ` · ${r.usage.total} tokens` : '';
    const coupe = r.finish_reason === 'length' ? ' · réponse tronquée' : '';
    aiUI.msgs.push({ role: 'assistant', content: r.content, sources: r.sources || [], knowledge: !!knowledge,
      meta: r.ms != null ? `${knowledge ? 'Knowledge · ' : ''}${(r.ms / 1000).toFixed(1)} s${tok}${coupe}` : (knowledge ? 'Knowledge · aucun appel au modèle' : '') });
  } catch (e) {
    _aiAskCtrl = null;
    aiUI.err = e.arret ? 'Réponse arrêtée. Ta question est dans le champ, tu peux la modifier et la renvoyer.' : e.message;
    // Le message reste dans le champ pour être renvoyé tel quel.
    if (brouillon) aiUI.msgs.pop();
    aiUI.busy = false; _aiPaint();
    const i = document.getElementById('ai-input'); if (i && brouillon) { i.value = brouillon; aiGrow(i); }
    return;
  }
  aiUI.busy = false; _aiPaint();
  document.getElementById('ai-input')?.focus();
}


// ══ Vues des skills d'équipe ════════════════════════════════════
// Les chiffres viennent de l'appli (r.faits, vrais noms) ; l'IA n'apporte
// que sa lecture (r.data). Si sa réponse n'est pas lisible, on montre le
// texte brut sous les chiffres.
const _AI_STATUT = {
  valoriser: ['À valoriser', 'is-ok'], accompagner: ['À accompagner', 'is-warn'], suivre: ['À suivre', 'is-info'],
  tenu: ['Tenu', 'is-ok'], en_cours: ['En cours', 'is-info'], en_retard: ['En retard', 'is-bad'],
  haute: ['Haute', 'is-bad'], moyenne: ['Moyenne', 'is-warn'], basse: ['Basse', 'is-info'],
  bon: ['Bon', 'is-ok'], mauvais: ['À surveiller', 'is-bad'], neutre: ['Neutre', 'is-info'],
};
const _aiChip = k => { const [t, c] = _AI_STATUT[k] || [k || '', 'is-info']; return t ? `<span class="ai-chip2 ${c}">${esc(t)}</span>` : ''; };
const _aiList = (titre, l, cls) => (l && l.length) ? `<div class="ai-box ${cls || ''}"><div class="ai-box-t">${titre}</div><ul>${l.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
const _aiNum = (v, suffixe) => v == null ? '<span class="ai-na">—</span>' : `${esc(String(v))}${suffixe || ''}`;
function _aiNote(v) {
  if (v == null) return '<span class="ai-na">non saisie</span>';
  const c = v >= 70 ? 'is-ok' : v >= 50 ? 'is-warn' : 'is-bad';
  return `<span class="ai-score ${c}">${v}</span>`;
}
function _aiJours(j) {
  if (j == null) return '<span class="ai-bad-t">jamais</span>';
  return j > 45 ? `<span class="ai-warn-t">il y a ${j} j</span>` : `il y a ${j} j`;
}
const _aiDate = iso => /^\d{4}-\d{2}-\d{2}/.test(String(iso || '')) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : (iso || '');
const _aiRetard = n => n ? `<span class="ai-bad-t">${n}</span>` : '<span class="ai-na">0</span>';

function _aiVue(r) {
  if (r.vue === 'bilan') return _aiVueBilan(r);
  if (r.vue === 'recap') return _aiVueRecap(r);
  if (r.vue === 'prep') return _aiVuePrep(r);
  if (r.vue === 'decision') return _aiVueDecision(r);
  if (r.vue === 'insights') return _aiVueInsights(r);
  if (r.vue === 'recherche') return _aiVueRecherche(r);
  return `<div class="ai-md">${_aiFormat(r.content)}</div>`;
}

// ── Recherche dans Pear ──
// Pear AI a lu la question ; Pear a exécuté la recherche. On montre la
// lecture (pour la vérifier) puis les lignes trouvées, telles quelles.
const _AI_COLS = {
  ticket: 'Ticket', titre: 'Titre', pays: 'Pays', type: 'Type', priorite: 'Priorité', statut: 'Statut', ferme: 'Fermé',
  domaine: 'Domaine', agent: 'Agent', ouvert_le: 'Ouvert le', clos_le: 'Clos le', clos_par: 'Clos par', modifie_par: 'Modifié par',
  modifie_le: 'Modifié le', sla: 'SLA', duree_jours: 'Durée (j)', shift: 'Shift', du: 'Du', au: 'Au', demandee_le: 'Demandée le',
  jours: 'Jours', date: 'Date', site: 'Site', repos: 'Repos', tache: 'Tâche', priorite_t: 'Priorité', echeance: 'Échéance',
  assignee_par: 'Assignée par', semaine: 'Semaine', en_retard: 'En retard', humeur: 'Humeur', sujet: 'Sujet',
  actions_ouvertes: 'Actions ouvertes', actions_en_retard: 'Actions en retard', observation: 'Observation', impact: 'Impact',
  auteur: 'Auteur', nombre: 'Nombre',
};
const _AI_SOURCES = { tickets: 'Tickets', absences: 'Absences', planning: 'Planning', taches: 'Tâches', one_to_one: 'One-to-One', observations: 'Observations' };
function _aiVueRecherche(r) {
  const d = r.data || {}, x = d.resultat || {};
  const tete = `<p class="ai-rech-q"><b>Lecture de ta question :</b> ${esc(d.interpretation || '—')}</p>`;
  if (!r.data) return `<div class="ai-vue">${_aiBrut(r)}</div>`;
  if (d.impossible) return `<div class="ai-vue">${tete}<div class="ai-empty2"><b>Les données de Pear ne permettent pas d'y répondre.</b><span>${esc(d.impossible)}</span></div></div>`;
  if (x.erreur) return `<div class="ai-vue">${tete}<div class="ai-empty2"><b>Recherche impossible.</b><span>${esc(x.erreur)}</span></div></div>`;
  const cols = x.colonnes || [];
  const n = (x.lignes || []).length;
  return `<div class="ai-vue ai-rech">${tete}
    <div class="ai-rech-n"><b>${x.total}</b> ${x.groupe ? `ligne(s) regroupée(s) par ${esc(_AI_COLS[x.groupe] || x.groupe)}` : 'résultat(s)'} · ${esc(_AI_SOURCES[x.source] || x.source || '')}${r.faits?.perimetre ? ` · ${esc(r.faits.perimetre)}` : ''}${!x.groupe && x.total > n ? ` · ${n} premiers affichés` : ''}</div>
    ${n ? `<div class="ai-tbl-w"><table class="ai-tbl"><thead><tr>${cols.map(c => `<th>${esc(_AI_COLS[c] || c)}</th>`).join('')}</tr></thead>
      <tbody>${x.lignes.map(l => `<tr>${cols.map(c => `<td>${l[c] === '' || l[c] == null ? '<span class="ai-na">—</span>' : esc(String(l[c]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
      : '<div class="ai-empty2"><b>Aucun résultat.</b><span>Vérifie la lecture de ta question ci-dessus, ou reformule-la.</span></div>'}
    ${(x.ignores || []).length ? `<p class="ai-na">Critère(s) non compris, ignoré(s) : ${esc(x.ignores.join(', '))}</p>` : ''}
  </div>`;
}
// Lecture non structurée. Une réponse qui devait être structurée mais n'a
// pas pu être lue (coupée, abîmée) n'est jamais affichée en JSON brut :
// on le dit, et on propose de relancer.
const _aiResteJson = t => /^\s*(```|\{|\[|")/.test(String(t || '')) || /"\s*:\s*[\[{"]/.test(String(t || '').slice(0, 400));
const _aiBrut = r => {
  if (r.data) return r.data._tronque ? `<div class="ai-trunc">${_aiIco('regen')}<span>Réponse coupée par le modèle : les derniers éléments manquent.
      <button class="bb-link" onclick="aiRegen()">Régénérer</button></span></div>` : '';
  if (!r.content || r.vide) return '';
  if (_aiResteJson(r.content)) return `<div class="ai-trunc is-bad">${_aiIco('regen')}<span>La réponse de Pear AI est incomplète et n'a pas pu être mise en forme.
      <button class="bb-link" onclick="aiRegen()">Régénérer</button></span></div>`;
  return `<div class="ai-box"><div class="ai-box-t">Lecture de Pear AI</div><div class="ai-md">${_aiFormat(r.content)}</div></div>`;
};

function _aiVueBilan(r) {
  const f = r.faits || { lignes: [], equipe: {} };
  const d = r.data || {};
  const e = f.equipe || {};
  const lecture = new Map((d.agents || []).map(a => [a.agent, a]));
  const tuile = (v, t, bad) => `<div class="ai-tile${bad && v ? ' is-bad' : ''}"><b>${v == null ? '—' : v}</b><span>${t}</span></div>`;
  return `<div class="ai-vue">
    <div class="ai-tiles">
      ${tuile(e.agents, 'agents')}${tuile(e.score_moyen, 'note moyenne')}${tuile(e.objectifs_en_retard, 'objectifs en retard', 1)}
      ${tuile(e.one_to_one_a_planifier, 'One-to-One à planifier', 1)}${tuile(e.taches_en_retard, 'tâches en retard', 1)}
    </div>
    ${d.synthese ? `<p class="ai-syn">${esc(d.synthese)}</p>` : ''}
    <div class="ai-box-t">L'équipe agent par agent${f.session ? ` · ${esc(f.session)}` : ''}</div>
    <div class="ai-tbl-w"><table class="ai-tbl">
      <thead><tr><th>Agent</th><th>Note</th><th>Objectifs</th><th>Dernier One-to-One</th><th>Tâches en retard</th><th>Tickets du mois</th><th>Pear AI</th></tr></thead>
      <tbody>${(f.lignes || []).map(l => {
        const a = lecture.get(l.agent);
        const delta = l.score != null && l.precedent != null ? l.score - l.precedent : null;
        return `<tr>
          <td><b>${esc(l.agent)}</b></td>
          <td>${_aiNote(l.score)}${delta ? ` <small class="${delta > 0 ? 'ai-ok-t' : 'ai-bad-t'}">${delta > 0 ? '+' : ''}${delta}</small>` : ''}</td>
          <td>${l.obj_actifs || l.obj_retard || l.obj_attente ? `${l.obj_actifs} en cours${l.obj_retard ? ` · <span class="ai-bad-t">${l.obj_retard} en retard</span>` : ''}${l.obj_attente ? ` · ${l.obj_attente} à valider` : ''}` : '<span class="ai-na">aucun</span>'}</td>
          <td>${_aiJours(l.o2o_jours)}${l.o2o_actions_retard ? ` · <span class="ai-bad-t">${l.o2o_actions_retard} action(s) en retard</span>` : ''}</td>
          <td>${_aiRetard(l.taches_retard)}</td>
          <td>${l.tickets ? `${l.tickets}${l.ruptures ? ` · <span class="ai-bad-t">${l.ruptures} rupture(s)</span>` : ''}` : '<span class="ai-na">0</span>'}</td>
          <td>${a ? _aiChip(a.statut) : ''}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
    <div class="ai-cols2">${_aiList('Forces', d.forces, 'is-ok')}${_aiList('Vigilances', d.vigilances, 'is-warn')}</div>
    ${(d.agents || []).length ? `<div class="ai-box-t">Qui mentionner</div>
      <div class="ai-cards">${d.agents.map(a => `<div class="ai-card2">
        <div class="ai-card2-h"><b>${esc(a.agent)}</b>${_aiChip(a.statut)}</div>
        <p>${esc(a.constat || '')}</p>${a.action ? `<p class="ai-act">→ ${esc(a.action)}</p>` : ''}</div>`).join('')}</div>` : ''}
    ${(d.recommandations || []).length ? `<div class="ai-box-t">Recommandations</div>
      <ol class="ai-reco">${d.recommandations.map(x => `<li>${_aiChip(x.priorite)}<div><b>${esc(x.titre || '')}</b><p>${esc(x.action || '')}</p></div></li>`).join('')}</ol>` : ''}
    ${_aiList('Suivi à compléter', d.suivi_manquant, 'is-muted')}
    ${_aiBrut(r)}
  </div>`;
}

function _aiVueRecap(r) {
  const f = r.faits || { agents: [] };
  const d = r.data || {};
  const lignes = (f.agents || []);
  const HUM = { up: 'en forme', flat: 'neutre', down: 'en baisse' };
  const table = `<div class="ai-tbl-w"><table class="ai-tbl">
      <thead><tr><th>Agent</th><th>Entretiens</th><th>Dernier</th><th>Humeur</th><th>Actions ouvertes</th></tr></thead>
      <tbody>${lignes.map(l => `<tr>
        <td><b>${esc(l.agent)}</b></td>
        <td>${l.entretiens ? l.entretiens : '<span class="ai-bad-t">0</span>'}</td>
        <td>${l.dernier ? esc(_aiDate(l.dernier)) : '<span class="ai-na">—</span>'}</td>
        <td>${l.humeurs.length ? esc(HUM[l.humeurs[l.humeurs.length - 1]] || l.humeurs[l.humeurs.length - 1]) : '<span class="ai-na">—</span>'}</td>
        <td>${l.actions_ouvertes ? `${l.actions_ouvertes}${l.actions_retard ? ` · <span class="ai-bad-t">${l.actions_retard} en retard</span>` : ''}` : '<span class="ai-na">0</span>'}</td>
      </tr>`).join('')}</tbody></table></div>`;
  if (r.vide) return `<div class="ai-vue">
      <div class="ai-empty2"><b>${esc(r.content)}</b>
        <span>Le récap se base sur les comptes rendus enregistrés dans Équipe › One-to-One. Sans entretien, il n'y a rien à résumer : Pear AI n'a pas été appelé.</span></div>
      ${lignes.length ? table : ''}</div>`;
  return `<div class="ai-vue">
    <div class="ai-box-t">Depuis le ${esc(_aiDate(f.depuis))}</div>${table}
    <div class="ai-cols2">${_aiList('Thèmes communs', d.themes_communs)}${_aiList('Actions pour toi', d.actions_manager, 'is-warn')}</div>
    ${(d.agents || []).length ? `<div class="ai-cards">${d.agents.map(a => `<div class="ai-card2">
      <div class="ai-card2-h"><b>${esc(a.agent)}</b></div>
      ${a.resume ? `<p>${esc(a.resume)}</p>` : ''}
      ${(a.themes || []).length ? `<div class="ai-tags">${a.themes.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
      ${(a.engagements || []).length ? `<div class="ai-sub">Engagements</div><ul class="ai-eng">${a.engagements.map(x => `<li>${_aiChip(x.statut)} ${esc(x.texte || '')}</li>`).join('')}</ul>` : ''}
      ${a.humeur ? `<div class="ai-sub">Humeur</div><p>${esc(a.humeur)}</p>` : ''}
      ${(a.a_reprendre || []).length ? `<div class="ai-sub">À reprendre au prochain entretien</div><ul>${a.a_reprendre.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    </div>`).join('')}</div>` : ''}
    ${_aiBrut(r)}
  </div>`;
}

function _aiVuePrep(r) {
  const f = r.faits || {};
  const d = r.data || {};
  const o2o = f.one_to_one || {};
  return `<div class="ai-vue">
    <div class="ai-tiles">
      <div class="ai-tile"><b>${f.note ? (f.note.score ?? '—') : '—'}</b><span>note ${f.note?.mois ? `de ${esc(f.note.mois)}` : 'non saisie'}${f.note?.precedent != null ? ` (avant : ${f.note.precedent})` : ''}</span></div>
      <div class="ai-tile${o2o.jours_depuis == null || o2o.jours_depuis > 45 ? ' is-bad' : ''}"><b>${o2o.jours_depuis == null ? 'jamais' : o2o.jours_depuis + ' j'}</b><span>depuis le dernier One-to-One</span></div>
      <div class="ai-tile"><b>${(f.objectifs || []).length}</b><span>objectif(s) ${f.session ? `· ${esc(f.session)}` : ''}</span></div>
      <div class="ai-tile${(f.taches?.en_retard || o2o.actions_en_retard) ? ' is-bad' : ''}"><b>${(f.taches?.en_retard || 0) + (o2o.actions_en_retard || 0)}</b><span>tâches / actions en retard</span></div>
    </div>
    ${(f.objectifs || []).length ? `<div class="ai-box-t">Ses objectifs</div><ul class="ai-objs">${f.objectifs.map(o => `<li>
      <span class="ai-objs-t">${esc(o.titre)}</span>
      <span class="ai-bar"><i style="width:${Math.max(0, Math.min(100, Number(o.avancement) || 0))}%"></i></span>
      <span class="ai-objs-m">${o.avancement != null ? o.avancement + ' %' : '—'} · jalons ${esc(o.jalons)}${o.retard ? ` · <span class="ai-bad-t">${o.retard} en retard</span>` : ''}</span></li>`).join('')}</ul>` : ''}
    ${d.accroche ? `<blockquote class="ai-quote">${esc(d.accroche)}</blockquote>` : ''}
    <div class="ai-cols2">${_aiList('Points forts', d.points_forts, 'is-ok')}${_aiList('Points d\'attention', d.points_attention, 'is-warn')}</div>
    ${(d.questions || []).length ? `<div class="ai-box-t">Questions à poser</div><ol class="ai-q">${d.questions.map(q => `<li>${esc(q)}</li>`).join('')}</ol>` : ''}
    ${d.objectif_propose && d.objectif_propose.titre ? `<div class="ai-box is-info"><div class="ai-box-t">Objectif à proposer</div>
      <p><b>${esc(d.objectif_propose.titre)}</b></p>
      <p class="ai-act">${d.objectif_propose.kpi ? `Mesure : ${esc(d.objectif_propose.kpi)}` : ''}${d.objectif_propose.echeance ? ` · échéance ${esc(_aiDate(d.objectif_propose.echeance))}` : ''}</p></div>` : ''}
    ${d.a_eviter ? `<div class="ai-avoid"><b>À éviter :</b> ${esc(d.a_eviter)}</div>` : ''}
    ${_aiBrut(r)}
  </div>`;
}

// ── Rapport de décision ──────────────────────────────────────
// À gauche de la lecture, les chiffres calculés par Pear : chaque
// recommandation se vérifie sans quitter l'écran.
function _aiTendance(v, avant, inverse) {
  if (v == null || avant == null || v === avant) return '';
  const monte = v > avant, bon = inverse ? !monte : monte;
  return ` <small class="${bon ? 'ai-ok-t' : 'ai-bad-t'}">${monte ? '▲' : '▼'} ${esc(String(avant))}</small>`;
}
function _aiVueDecision(r) {
  const f = r.faits || {}, d = r.data || {}, k = f.indicateurs || {}, mt = k.maintenant || {};
  const tuile = (v, t, extra, bad) => `<div class="ai-tile${bad ? ' is-bad' : ''}"><b>${v == null ? '—' : esc(String(v))}${extra || ''}</b><span>${t}</span></div>`;
  const q = f.qualite || {};
  const doutes = [
    q.clos_sans_date_cloture ? `${q.clos_sans_date_cloture} ticket(s) clos sans date de clôture` : '',
    q.sans_type_ou_sans_sla ? `${q.sans_type_ou_sans_sla} ticket(s) sans SLA calculable` : '',
    q.notes_non_saisies_mois ? `${q.notes_non_saisies_mois} agent(s) sans note récente` : '',
    q.planning_non_saisi ? 'planning des 7 prochains jours non saisi' : '',
  ].filter(Boolean);
  const top = (l) => (l || []).length ? `<ul>${l.map(x => `<li>${esc(x.valeur)} : <b>${x.nombre}</b>${x.part_pct != null ? ` (${x.part_pct} %)` : ''}</li>`).join('')}</ul>` : '<p class="ai-na">aucune rupture sur la période</p>';
  return `<div class="ai-vue ai-dec">
    ${d._secours ? `<div class="ai-trunc">${_aiIco('regen')}<span>Pear AI n'a pas pu répondre${d._raison ? ` (${esc(d._raison)})` : ''}. Voici la version calculée par Pear avec les mêmes chiffres, sans recommandation rédigée.
      <button class="bb-link" onclick="aiRegen()">Réessayer avec Pear AI</button></span></div>` : ''}
    <div class="ai-box-t">${esc(f.perimetre || '')} · ${esc(f.periode || '')}</div>
    <div class="ai-tiles">
      ${tuile(k.tickets_ouverts?.valeur, 'tickets ouverts', _aiTendance(k.tickets_ouverts?.valeur, k.tickets_ouverts?.avant, true))}
      ${tuile(k.tickets_clos?.valeur, 'tickets clos', _aiTendance(k.tickets_clos?.valeur, k.tickets_clos?.avant))}
      ${tuile(k.backlog?.fin, 'backlog fin de période', _aiTendance(k.backlog?.fin, k.backlog?.debut, true))}
      ${tuile(k.sla_pct?.valeur == null ? null : k.sla_pct.valeur + ' %', 'SLA tenu', _aiTendance(k.sla_pct?.valeur, k.sla_pct?.avant), k.sla_pct?.valeur != null && k.sla_pct.valeur < 90)}
      ${tuile(k.ruptures_sla?.valeur, 'ruptures SLA', _aiTendance(k.ruptures_sla?.valeur, k.ruptures_sla?.avant, true), !!k.ruptures_sla?.valeur)}
      ${tuile(k.resolution_mediane_h?.valeur == null ? null : k.resolution_mediane_h.valeur + ' h', 'résolution médiane', _aiTendance(k.resolution_mediane_h?.valeur, k.resolution_mediane_h?.avant, true))}
    </div>
    <p class="ai-dec-now">En ce moment : <b>${mt.ouverts ?? '—'}</b> ouverts · <b class="${mt.en_rupture ? 'ai-bad-t' : ''}">${mt.en_rupture ?? 0}</b> en rupture · <b>${mt.proches_rupture ?? 0}</b> proches de la rupture${mt.pannes_en_cours ? ` · <b class="ai-bad-t">${mt.pannes_en_cours} panne(s)</b>` : ''}</p>
    ${d.situation ? `<p class="ai-syn">${esc(d.situation)}</p>` : ''}
    ${(d.decisions || []).length ? `<div class="ai-box-t">Décisions à prendre</div>
      <div class="ai-decs">${d.decisions.map((x, i) => `<div class="ai-dec-c">
        <div class="ai-card2-h"><b>${i + 1}. ${esc(x.titre || '')}</b><span>${_aiChip(x.urgence)}${x.echeance ? ` <small class="ai-na">${esc(x.echeance)}</small>` : ''}</span></div>
        ${x.constat ? `<p>${esc(x.constat)}</p>` : ''}
        ${(x.options || []).length ? `<div class="ai-opts">${x.options.map(o => `<div class="ai-opt${x.recommandation && o.option && String(x.recommandation).toLowerCase().includes(String(o.option).toLowerCase().slice(0, 25)) ? ' is-reco' : ''}">
          <b>${esc(o.option || '')}</b>${o.pour ? `<span class="ai-ok-t">+ ${esc(o.pour)}</span>` : ''}${o.contre ? `<span class="ai-warn-t">− ${esc(o.contre)}</span>` : ''}</div>`).join('')}</div>` : ''}
        ${x.recommandation ? `<p class="ai-act">→ ${esc(x.recommandation)}</p>` : ''}
        <div class="ai-dec-f">${x.si_rien ? `<span><b>Si rien n'est fait :</b> ${esc(x.si_rien)}</span>` : ''}${x.indicateur_de_suivi ? `<span><b>À suivre :</b> ${esc(x.indicateur_de_suivi)}</span>` : ''}</div>
      </div>`).join('')}</div>`
      : (r.data ? '<div class="ai-empty2"><b>Aucune décision à prendre sur cette période.</b><span>Les chiffres ne montrent rien qui demande un arbitrage.</span></div>' : '')}
    <div class="ai-cols2">${_aiList('À surveiller', d.a_surveiller, 'is-warn')}${_aiList('Ce qui n\'est pas sûr', [...(d.incertitudes || []), ...doutes.filter(x => !(d.incertitudes || []).some(i => i.includes(x.split(' ')[0])))], 'is-muted')}</div>
    ${d.message_hierarchie ? `<div class="ai-box is-info"><div class="ai-box-t">Message pour la hiérarchie</div><p>${esc(d.message_hierarchie)}</p></div>` : ''}
    <details class="ai-dec-src"><summary>Les chiffres utilisés</summary>
      <div class="ai-cols2">
        <div class="ai-box"><div class="ai-box-t">Origine des ruptures (type)</div>${top(f.ruptures_par_type)}</div>
        <div class="ai-box"><div class="ai-box-t">Origine des ruptures (domaine)</div>${top(f.ruptures_par_domaine)}</div>
      </div>
      ${(f.charge || []).length ? `<div class="ai-box-t" style="margin-top:12px">Charge par agent${f.part_deux_plus_charges != null ? ` · les deux plus chargés portent ${f.part_deux_plus_charges} %` : ''}</div>
        <div class="ai-tbl-w"><table class="ai-tbl"><thead><tr><th>Agent</th><th>Tickets</th><th>Ruptures</th></tr></thead>
        <tbody>${f.charge.map(l => `<tr><td>${esc(l.fo)}</td><td>${l.tickets}</td><td>${_aiRetard(l.ruptures)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${(f.creneaux_fragiles || []).length ? `<div class="ai-box-t" style="margin-top:12px">Créneaux fragiles (7 jours)</div>
        <div class="ai-tbl-w"><table class="ai-tbl"><thead><tr><th>Jour</th><th>Créneau</th><th>Présents / planifiés</th><th>Absents</th></tr></thead>
        <tbody>${f.creneaux_fragiles.map(c => `<tr><td>${esc(_aiDate(c.date))}</td><td>${esc(c.creneau)}</td><td>${c.presents === 0 ? `<span class="ai-bad-t">0</span>` : c.presents} / ${c.planifies}</td><td>${esc((c.agents_absents || []).join(', ')) || '<span class="ai-na">—</span>'}</td></tr>`).join('')}</tbody></table></div>` : ''}
    </details>
    ${_aiBrut(r)}
  </div>`;
}

// Version texte, pour copier ou continuer en conversation.
function _aiTexte(r) {
  if (!r.vue || !r.data) return r.content || '';
  const d = r.data, L = [];
  const liste = (t, l) => { if (l && l.length) { L.push(`**${t}**`); l.forEach(x => L.push(`- ${x}`)); L.push(''); } };
  if (r.vue === 'bilan') {
    if (d.synthese) L.push(d.synthese, '');
    liste('Forces', d.forces); liste('Vigilances', d.vigilances);
    if ((d.agents || []).length) { L.push('**Agents**'); d.agents.forEach(a => L.push(`- ${a.agent} (${(_AI_STATUT[a.statut] || [a.statut])[0]}) : ${a.constat}${a.action ? ` → ${a.action}` : ''}`)); L.push(''); }
    if ((d.recommandations || []).length) { L.push('**Recommandations**'); d.recommandations.forEach((x, i) => L.push(`${i + 1}. [${x.priorite}] ${x.titre} : ${x.action}`)); }
  } else if (r.vue === 'recap') {
    liste('Thèmes communs', d.themes_communs); liste('Actions pour le manager', d.actions_manager);
    (d.agents || []).forEach(a => { L.push(`**${a.agent}**`, a.resume || ''); (a.engagements || []).forEach(x => L.push(`- [${(_AI_STATUT[x.statut] || [x.statut])[0]}] ${x.texte}`)); (a.a_reprendre || []).forEach(x => L.push(`- À reprendre : ${x}`)); L.push(''); });
  } else if (r.vue === 'decision') {
    if (d.situation) L.push(d.situation, '');
    (d.decisions || []).forEach((x, i) => {
      L.push(`**${i + 1}. ${x.titre}** (${x.urgence || ''}, ${x.echeance || ''})`, x.constat || '');
      (x.options || []).forEach(o => L.push(`- ${o.option} : + ${o.pour || ''} / − ${o.contre || ''}`));
      if (x.recommandation) L.push(`Recommandation : ${x.recommandation}`);
      if (x.si_rien) L.push(`Si rien n'est fait : ${x.si_rien}`);
      if (x.indicateur_de_suivi) L.push(`À suivre : ${x.indicateur_de_suivi}`);
      L.push('');
    });
    liste('À surveiller', d.a_surveiller); liste('Incertitudes', d.incertitudes);
    if (d.message_hierarchie) L.push(`**Message pour la hiérarchie** : ${d.message_hierarchie}`);
  } else if (r.vue === 'recherche') {
    const x = d.resultat || {};
    if (d.interpretation) L.push(`**Recherche** : ${d.interpretation}`, '');
    if (d.impossible) L.push(d.impossible);
    else if (x.lignes) {
      L.push(`${x.total} résultat(s)`);
      x.lignes.slice(0, 20).forEach(l => L.push(`- ${(x.colonnes || []).map(c => l[c]).filter(v => v !== '' && v != null).join(' · ')}`));
    }
  } else if (r.vue === 'prep') {
    if (d.accroche) L.push(`> ${d.accroche}`, '');
    liste('Points forts', d.points_forts); liste('Points d\'attention', d.points_attention); liste('Questions', d.questions);
    if (d.objectif_propose?.titre) L.push(`**Objectif proposé** : ${d.objectif_propose.titre} (${d.objectif_propose.kpi || ''}, ${d.objectif_propose.echeance || ''})`);
    if (d.a_eviter) L.push(`**À éviter** : ${d.a_eviter}`);
  }
  return L.join('\n').trim();
}


// ══ Insights des agents (réglages) ══════════════════════════════
// L'admin active l'insight de performance agent par agent. Rien n'est
// visible côté agent tant que l'interrupteur général est éteint.
async function aiInsLoad() {
  try { aiUI.ins = await _aiFetch('/api/ai/insights'); aiUI.insErr = ''; } catch (e) { aiUI.insErr = e.message; }
  if (aiUI.showConf) _aiPaint();
  _aiInsPoll();
}

// Tant qu'une passe tourne, l'état se rafraîchit toutes les 2 s.
function _aiInsPoll() {
  clearTimeout(aiUI.insTimer);
  if (aiUI.showConf && aiUI.ins?.passe?.encours) aiUI.insTimer = setTimeout(aiInsLoad, 2000);
}

async function aiInsSet(body) {
  try { aiUI.ins = await _aiFetch('/api/ai/insights', { method: 'PUT', body: JSON.stringify(body) }); aiUI.insErr = ''; }
  catch (e) { aiUI.insErr = e.message; }
  _aiPaint(); _aiInsPoll();
}

async function aiInsRun(fo) {
  try {
    aiUI.ins = await _aiFetch('/api/ai/insights/run', { method: 'POST', body: JSON.stringify(fo ? { fo } : {}) });
    aiUI.insErr = aiUI.ins.lance ? '' : (aiUI.ins.passe?.encours ? 'Une passe est déjà en cours.' : 'Tout est déjà à jour.');
  } catch (e) { aiUI.insErr = e.message; }
  _aiPaint(); _aiInsPoll();
}

function aiInsTous(v) {
  const agents = {};
  (aiUI.ins?.agents || []).forEach(a => { agents[a.fo] = v; });
  aiInsSet({ agents });
}

const _AI_INS_ETAT = {
  fait: ['Fait', 'is-ok'], a_faire: ['À faire', 'is-info'], a_refaire: ['Fiche modifiée', 'is-info'],
  en_cours: ['En cours…', 'is-run'], attente: ['En attente', 'is-wait'], echec: ['Échec', 'is-bad'], inactif: ['Non activé', 'is-off'],
};

function _aiInsHtml() {
  const d = aiUI.ins;
  if (!d) return `<section class="bb-ins"><b>Insights des agents</b><p class="bb-ins-d">${aiUI.insErr ? esc(aiUI.insErr) : 'Chargement…'}</p></section>`;
  const p = d.passe || {};
  const coches = d.agents.filter(a => a.coche).length;
  const faits = d.agents.filter(a => a.actif && a.etat === 'fait').length;
  const actifs = d.agents.filter(a => a.actif).length;
  return `<section class="bb-ins">
      <div class="bb-ins-h"><b>Insights des agents</b>
        <label class="bb-switch"><input type="checkbox" ${d.enabled ? 'checked' : ''} onchange="aiInsSet({ enabled: this.checked })"><span></span>${d.enabled ? 'Activé' : 'Désactivé'}</label></div>
      <p class="bb-ins-d">Pear AI prépare tout seul l'insight de chaque agent coché, un par un : dès que tu l'actives, puis toutes les 20 minutes
        pour ceux dont l'insight du mois manque ou dont la fiche a changé (au plus un par jour). L'agent le lit sur sa page My Performance, sans rien demander.
        Il faut que Pear AI soit allumé (<code>ia on</code>) : sinon les agents restent « en attente » jusqu'à la passe suivante.</p>
      <div class="bb-ins-run">
        ${p.encours
          ? `<div class="bb-prog"><span>Passe en cours : ${p.fait} / ${p.total}${p.courant ? ` · ${esc(p.courant)}` : ''}</span><i><b style="width:${p.total ? Math.round(p.fait / p.total * 100) : 0}%"></b></i></div>`
          : `<span>${d.enabled ? `${faits} / ${actifs} à jour` : 'Désactivé : rien n\'est généré ni visible.'}${p.fin ? ` · dernière passe à ${esc(new Date(p.fin).toLocaleTimeString((globalThis.PEAR_LOCALE || 'fr-FR'), { hour: '2-digit', minute: '2-digit' }))}` : ''}</span>`}
        <button class="bb-run" onclick="aiInsRun()" ${d.enabled && actifs && !p.encours ? '' : 'disabled'}>Générer pour tous</button>
      </div>
      ${p.motif && !p.encours ? `<div class="bb-ins-warn">${esc(p.motif)}</div>` : ''}
      <div class="bb-ins-bar"><span>${coches} agent${coches > 1 ? 's' : ''} coché${coches > 1 ? 's' : ''} sur ${d.agents.length}</span>
        <button class="bb-link" onclick="aiInsTous(true)">Tout cocher</button><button class="bb-link" onclick="aiInsTous(false)">Tout décocher</button></div>
      <div class="bb-ins-rows">${d.agents.map(a => {
        const [t, c] = _AI_INS_ETAT[a.etat] || [a.etat, 'is-off'];
        const quand = a.dernier ? `le ${esc(_aiDate(String(a.dernier.at).slice(0, 10)))}` : '';
        return `<div class="bb-ins-row${a.coche ? '' : ' is-unchecked'}">
          <input type="checkbox" ${a.coche ? 'checked' : ''} aria-label="Activer ${esc(a.fo)}" onchange="aiInsSet({ agents: { ${JSON.stringify(a.fo).replace(/"/g, '&quot;')}: this.checked } })">
          <span class="bb-ins-n">${esc(a.fo)}</span>
          <span class="bb-st ${c}" title="${esc(a.erreur || '')}">${t}${a.etat === 'fait' && quand ? ` ${quand}` : ''}</span>
          <span class="bb-ins-m">${a.erreur && ['echec', 'attente'].includes(a.etat) ? esc(a.erreur) : (a.total ? `${a.total} gardé${a.total > 1 ? 's' : ''}` : '')}</span>
          <button class="bb-link" onclick="aiInsRun(${JSON.stringify(a.fo).replace(/"/g, '&quot;')})" ${a.actif && !p.encours ? '' : 'disabled'}>${a.dernier ? 'Regénérer' : 'Générer'}</button>
        </div>`;
      }).join('')}</div>
      ${aiUI.insErr ? `<div class="bb-ins-warn">${esc(aiUI.insErr)}</div>` : ''}
    </section>`;
}


// ── Pays : demandé par les skills, modifiable depuis la réponse ──
// Les skills qui lisent les données de l'équipe ou des tickets ont un
// champ « Pays » (marqué `pays` côté serveur), pré-rempli avec le pays
// actif de l'appli. La réponse garde un sélecteur : changer de pays
// relance le skill avec les mêmes réglages et remplace la réponse.
// Mêmes libellés que le serveur (ai-skills.js) : « Global », « Ville (CODE) ».
function _aiPaysActif() {
  const c = typeof getActiveCountry === 'function' ? getActiveCountry() : 'ALL';
  return c !== 'ALL' && isSiteCode(c) ? siteLabel(c) : 'Global';
}
function _aiChampPays(sk) { return sk && (sk.champs || []).find(ch => ch.pays); }
// Réglages d'une réponse de skill : gardés sur la réponse (un skill lancé
// depuis l'accueil n'a pas de bulle de question), sinon sur la question.
function _aiInputDe(m, i) {
  const q = typeof i === 'number' ? aiUI.msgs[i - 1] : null;
  return m.input || (q && q.role === 'user' && q.skill === m.skill ? q.input : null);
}
function _aiFiltrePays(m, i) {
  const inp = _aiInputDe(m, i);
  if (!m.skill || !inp) return '';
  const sk = (aiUI.skills || []).find(x => x.id === m.skill);
  const ch = _aiChampPays(sk);
  // Un agent précis choisi : le pays ne change rien, pas de filtre.
  if (!ch || (inp.fo && sk.champs.some(c => c.id === 'fo'))) return '';
  const cur = inp[ch.id] || 'Global';
  const AI_PAYS = ['Global', ...siteList().map(s => siteLabel(s.code))];
  return `<div class="bb-pays" role="group" aria-label="Site">${AI_PAYS.map(p => `<button class="${p === cur ? 'is-on' : ''}"
      ${p === cur || aiUI.busy ? 'disabled' : ''} onclick="aiRefiltre(${i}, '${p.replace(/'/g, "\\'")}')">${esc(p.replace(/ \(.+\)/, ''))}</button>`).join('')}</div>`;
}
async function aiRefiltre(i, pays) {
  const m = aiUI.msgs[i], q = aiUI.msgs[i - 1];
  const sk = (aiUI.skills || []).find(x => x.id === m?.skill);
  const ch = _aiChampPays(sk);
  const inp = m && _aiInputDe(m, i);
  if (!inp || !ch || aiUI.busy) return;
  const f = { ...inp, [ch.id]: pays };
  if (i === aiUI.msgs.length - 1) {
    // Dernière réponse : on la remplace sur place.
    aiUI.msgs.splice(i, 1);
    if (q && q.role === 'user' && q.skill === sk.id) { q.input = f; q.content = _aiResumeForm(sk, f) || q.content; }
    return aiRunSkill({ sk, f });
  }
  // Réponse plus ancienne : la nouvelle version arrive en bas du fil.
  aiUI.msgs.push({ role: 'user', content: _aiResumeForm(sk, f) || sk.titre, skill: sk.id, skillTitre: sk.titre, input: f });
  return aiRunSkill({ sk, f });
}

// ── Export PDF d'une réponse ──────────────────────────────────
// La réponse affichée est convertie en blocs simples (titres, textes,
// listes, chiffres, tableaux, encadrés) ; le serveur les met en page
// (server/documents/ai-pdf.js) et renvoie le fichier.
const _AI_BLOCS_HTML = new Set(['DIV', 'P', 'UL', 'OL', 'TABLE', 'DETAILS', 'SECTION', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE']);
const _aiTxt = el => (el ? el.textContent || '' : '').replace(/[▲▼]/g, '').replace(/\s+/g, ' ').trim();
const _aiTonEl = el => {
  const c = typeof el?.className === 'string' ? el.className : '';
  return /\bis-bad\b|ai-bad-t/.test(c) ? 'bad' : /\bis-warn\b|ai-warn-t/.test(c) ? 'warn' : /\bis-ok\b|ai-ok-t/.test(c) ? 'ok' : '';
};
function _aiBlocs(el, prof = 0, out = []) {
  for (const n of el.children) {
    const c = typeof n.className === 'string' ? n.className : '';
    const tag = n.tagName.toUpperCase();
    if (['BUTTON', 'SVG', 'SUMMARY', 'SCRIPT', 'STYLE'].includes(tag) || /\b(ai-trunc|bb-acts|bb-pays)\b/.test(c)) continue;
    if (/^H[1-6]$/.test(tag)) { out.push({ t: 'h', text: _aiTxt(n), niveau: tag <= 'H2' ? 1 : 2 }); continue; }
    if (/\bai-box-t\b/.test(c)) { out.push({ t: 'h', text: _aiTxt(n), niveau: 2 }); continue; }
    if (/\bai-tiles\b/.test(c)) {
      const t = [...n.querySelectorAll('.ai-tile')].map(x => {
        const b = x.querySelector('b'), avant = b?.querySelector('small');
        return { v: _aiTxt(b?.firstChild) || _aiTxt(b), l: _aiTxt(x.querySelector('span')) + (avant ? ` (avant : ${_aiTxt(avant)})` : ''), ton: _aiTonEl(x) };
      });
      const par = t.length <= 4 ? t.length : t.length <= 6 ? 3 : 4;
      for (let k = 0; k < t.length; k += par) out.push({ t: 'kpis', items: t.slice(k, k + par) });
      continue;
    }
    if (/\bai-opts\b/.test(c)) {
      out.push({ t: 'ul', items: [...n.children].map(o => {
        const pour = _aiTxt(o.querySelector('.ai-ok-t')).replace(/^\+\s*/, ''), contre = _aiTxt(o.querySelector('.ai-warn-t')).replace(/^[−-]\s*/, '');
        return `${o.classList.contains('is-reco') ? 'Recommandée : ' : ''}${_aiTxt(o.querySelector('b'))}${pour ? ` · Pour : ${pour}` : ''}${contre ? ` · Contre : ${contre}` : ''}`;
      }) });
      continue;
    }
    if (/\b(ai-dec-c|ai-card2|ai-box)\b/.test(c)) {
      const hd = n.querySelector(':scope > .ai-card2-h, :scope > .ai-box-t');
      const chip = hd?.querySelector('.ai-chip2');
      const titre = hd ? _aiTxt(hd.querySelector('b') || hd) : '';
      const corps = n.cloneNode(true);
      corps.querySelector(':scope > .ai-card2-h, :scope > .ai-box-t')?.remove();
      if (prof) { if (titre) out.push({ t: 'h', text: titre, niveau: 2 }); _aiBlocs(corps, prof, out); continue; }
      out.push({ t: 'card', titre, badge: chip ? _aiTxt(chip) : '', ton: chip ? _aiTonEl(chip) : _aiTonEl(n), blocs: _aiBlocs(corps, 1) });
      continue;
    }
    if (tag === 'TABLE') {
      out.push({ t: 'table', head: [...n.querySelectorAll('thead th')].map(_aiTxt),
        rows: [...n.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(_aiTxt)) });
      continue;
    }
    if (tag === 'UL' || tag === 'OL') { out.push({ t: 'ul', ordonne: tag === 'OL', items: [...n.children].map(_aiTxt).filter(Boolean) }); continue; }
    if (tag === 'DETAILS') {
      const s = n.querySelector(':scope > summary');
      if (s) out.push({ t: 'h', text: _aiTxt(s), niveau: 2 });
      _aiBlocs(n, prof, out);
      continue;
    }
    if ([...n.children].some(x => _AI_BLOCS_HTML.has(x.tagName.toUpperCase()))) { _aiBlocs(n, prof, out); continue; }
    // Suite de mentions « <b>Libellé :</b> texte » : une ligne chacune.
    const mentions = [...n.children];
    if (mentions.length > 1 && mentions.every(x => x.tagName.toUpperCase() === 'SPAN' && x.querySelector('b'))) {
      mentions.forEach(x => out.push({ t: 'p', text: _aiTxt(x) }));
      continue;
    }
    const t = _aiTxt(n);
    if (!t) continue;
    // Ligne en gras seule (« **Titre** » en Markdown) : un titre.
    if (n.children.length === 1 && /^(B|STRONG)$/.test(n.children[0].tagName.toUpperCase()) && _aiTxt(n.children[0]) === t && t.length < 90) {
      out.push({ t: 'h', text: t.replace(/:$/, ''), niveau: 2 });
      continue;
    }
    out.push({ t: 'p', text: t, ton: _aiTonEl(n) });
  }
  return out;
}
// `i` : l'index d'un message de la conversation, ou le message lui-même
// (widget épinglé de l'accueil).
async function aiPdfMsg(i) {
  const m = typeof i === 'object' ? i : aiUI.msgs[i];
  if (!m) return;
  const q = typeof i === 'object' ? null : aiUI.msgs[i - 1];
  const sk = (aiUI.skills || []).find(x => x.id === m.skill);
  const box = document.createElement('div');
  box.innerHTML = m.vue ? _aiVue(m) : `<div class="ai-md">${_aiFormat(m.content)}</div>`;
  const inp = _aiInputDe(m, i) || {};
  const pays = inp[_aiChampPays(sk)?.id] || '';
  const meta = [pays, inp.periode || '',
    new Date().toLocaleDateString((globalThis.PEAR_LOCALE || 'fr-FR'), { day: 'numeric', month: 'long', year: 'numeric' })].filter(Boolean);
  const corps = {
    titre: sk ? sk.titre : 'Réponse de Pear AI',
    sousTitre: q && q.role === 'user' ? String(q.content || '').slice(0, 300) : '',
    meta, blocs: _aiBlocs(box),
  };
  try {
    const res = await fetch(`${API}/api/ai/pdf`, {
      method: 'POST', credentials: 'same-origin',
      headers: AdminSession.headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(corps),
    });
    if (!res.ok) { let e = {}; try { e = await res.json(); } catch {} throw new Error(e.error || `Erreur ${res.status}`); }
    const blob = await res.blob();
    const nom = (/filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '') || [])[1] || 'big-brother.pdf';
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: nom });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (e) {
    if (typeof toast === 'function') toast(`PDF impossible : ${e.message}`, 'error');
  }
}


// ── Épingler une réponse sur l'accueil ────────────────────────
// Le serveur garde la réponse (data/ai_pins.json) : elle devient un widget
// de l'accueil, qui survit au rechargement, s'actualise et se retire.
async function aiEpingler(i) {
  const m = aiUI.msgs[i];
  if (!m || m.epingle) return;
  const sk = (aiUI.skills || []).find(x => x.id === m.skill);
  try {
    const r = await _aiFetch('/api/ai/pins', { method: 'POST', body: JSON.stringify({
      skill: m.skill, input: _aiInputDe(m, i) || {},
      resultat: { content: m.content, vue: m.vue, data: m.data, faits: m.faits, vide: m.vide, meta: m.meta } }) });
    m.epingle = r.pin.id;
    if (typeof AIC !== 'undefined') AIC.pins = [r.pin, ...(AIC.pins || [])];
    if (typeof toast === 'function') toast(`${sk ? sk.titre : 'Réponse'} épinglé sur l'accueil`, 'success');
  } catch (e) { if (typeof toast === 'function') toast(e.message, 'error'); }
  _aiPaint();
}
// Ouvrir un widget épinglé : sa réponse complète dans une conversation.
function aiOuvrirEpingle(pin) {
  if (!pin) return;
  const r = pin.resultat || {};
  const cv = { id: 'c' + Date.now().toString(36), titre: pin.titre, msgs: [{ role: 'assistant', ...r, skill: pin.skill, input: pin.input, titre: pin.titre, epingle: pin.id }] };
  aiUI.convs.unshift(cv);
  aiUI.cur = cv.id; aiUI.skill = ''; aiUI.sideOpen = false;
  if (typeof renderPage === 'function' && !document.getElementById('page-ai')?.classList.contains('active')) renderPage('ai');
  _aiPaint();
}
// Aperçu d'une réponse dans un widget : l'essentiel de chaque type de
// réponse, mis en forme (chiffres, décisions, statuts), pas du texte brut.
const _pwChip = k => { const [t, c] = _AI_STATUT[k] || [k || '', 'is-info']; return t ? `<span class="pw-chip ${c}">${esc(t)}</span>` : ''; };
function _aiApercu(r) {
  const d = r.data || {}, f = r.faits || {};
  if (r.vue === 'decision' && r.data) {
    const k = f.indicateurs || {};
    const kpi = (v, l, bad) => `<div class="pw-kpi${bad ? ' is-bad' : ''}"><b>${v == null ? '—' : esc(String(v))}</b><span>${l}</span></div>`;
    return `<div class="pw">
      <div class="pw-kpis">${kpi(k.tickets_ouverts?.valeur, 'ouverts')}${kpi(k.sla_pct?.valeur == null ? null : k.sla_pct.valeur + ' %', 'SLA tenu', k.sla_pct?.valeur != null && k.sla_pct.valeur < 90)}${kpi(k.ruptures_sla?.valeur, 'ruptures', !!k.ruptures_sla?.valeur)}${kpi(k.backlog?.fin, 'backlog')}</div>
      ${d.situation ? `<p class="pw-lead">${esc(d.situation)}</p>` : ''}
      ${(d.decisions || []).length ? `<ol class="pw-decs">${d.decisions.slice(0, 3).map(x => `<li>
        <div class="pw-dec-h"><b>${esc(x.titre || '')}</b>${_pwChip(x.urgence)}</div>
        ${x.recommandation ? `<p>→ ${esc(x.recommandation)}</p>` : x.constat ? `<p>${esc(x.constat)}</p>` : ''}</li>`).join('')}</ol>`
        : '<p class="pw-mute">Aucune décision à prendre sur la période.</p>'}
      ${d._secours ? '<p class="pw-mute">Version calculée sans IA.</p>' : ''}</div>`;
  }
  if (r.vue === 'bilan' && r.data) {
    const n = s => (d.agents || []).filter(a => a.statut === s).length;
    return `<div class="pw">
      <div class="pw-kpis">${[['valoriser', 'à valoriser'], ['accompagner', 'à accompagner'], ['suivre', 'à suivre']].map(([s, l]) => `<div class="pw-kpi is-${s}"><b>${n(s)}</b><span>${l}</span></div>`).join('')}</div>
      ${d.synthese ? `<p class="pw-lead">${esc(d.synthese)}</p>` : ''}
      ${(d.recommandations || []).length ? `<ol class="pw-decs">${d.recommandations.slice(0, 3).map(x => `<li><div class="pw-dec-h"><b>${esc(x.titre || '')}</b>${_pwChip(x.priorite)}</div>${x.action ? `<p>${esc(x.action)}</p>` : ''}</li>`).join('')}</ol>` : ''}</div>`;
  }
  if (r.vue === 'recap' && r.data) {
    return `<div class="pw">
      ${(d.themes_communs || []).length ? `<div class="pw-tags">${d.themes_communs.slice(0, 6).map(t => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
      ${(d.agents || []).length ? `<ul class="pw-list">${d.agents.slice(0, 4).map(a => `<li><b>${esc(a.agent || '')}</b> ${esc(a.resume || '')}</li>`).join('')}</ul>` : ''}
      ${(d.actions_manager || []).length ? `<p class="pw-mute">À faire : ${esc(d.actions_manager.slice(0, 2).join(' · '))}</p>` : ''}</div>`;
  }
  if (r.vue === 'prep' && r.data) {
    return `<div class="pw">${d.accroche ? `<p class="pw-lead">« ${esc(d.accroche)} »</p>` : ''}
      ${(d.questions || []).length ? `<ul class="pw-list">${d.questions.slice(0, 3).map(q => `<li>${esc(q)}</li>`).join('')}</ul>` : ''}</div>`;
  }
  if (r.vue === 'recherche' && r.data) {
    const x = d.resultat || {};
    const cols = (x.colonnes || []).slice(0, 4);
    return `<div class="pw">
      <div class="pw-rech"><b>${x.total ?? 0}</b><span>${esc(d.interpretation || '')}</span></div>
      ${(x.lignes || []).length ? `<table class="pw-tbl"><thead><tr>${cols.map(c => `<th>${esc(_AI_COLS[c] || c)}</th>`).join('')}</tr></thead>
        <tbody>${x.lignes.slice(0, 5).map(l => `<tr>${cols.map(c => `<td>${esc(String(l[c] ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody></table>` : ''}</div>`;
  }
  const t = _aiTexte({ ...r }) || '';
  return t ? `<div class="pw"><div class="ai-md">${_aiFormat(t.split('\n').slice(0, 18).join('\n'))}</div></div>` : '<p class="hm-e">Réponse vide.</p>';
}


// ══ Base de connaissances ══════════════════════════════════════
// Les documents sont lus ici (PDF, texte) ou sur le serveur (Word,
// PowerPoint, Excel), découpés en passages et cherchés à chaque question
// (server/services/ai-kb.js). Pear AI cite ensuite ses sources.
const AI_KB_EXT = ['pdf', 'docx', 'pptx', 'xlsx', 'txt', 'md', 'csv', 'json'];
function aiKbToggle() { _aiReadForm(); aiUI.skill = ''; aiUI.showConf = false; aiUI.showKb = !aiUI.showKb; aiUI.sideOpen = false; if (aiUI.showKb) { aiUI.kbUp = []; aiUI.kbRes = null; aiUI.kbDoc = null; } _aiPaint(); if (aiUI.showKb) aiKbLoad(); }
async function aiKbLoad() {
  try { [aiUI.kb, aiUI.kbSens] = await Promise.all([_aiFetch('/api/ai/kb'), _aiFetch('/api/ai/kb/sens').catch(() => null)]); } catch (e) { aiUI.err = e.message; }
  _aiPaint();
  _aiKbSensSuivre();
}

// ── Recherche par le sens (embeddings) ──
// Suivi de l'indexation tant qu'elle tourne et que le panneau est ouvert.
let _aiKbSensMin = null;
function _aiKbSensSuivre() {
  clearTimeout(_aiKbSensMin);
  if (!aiUI.kbSens?.actif || !aiUI.showKb) return;
  _aiKbSensMin = setTimeout(async () => {
    try { aiUI.kbSens = await _aiFetch('/api/ai/kb/sens'); } catch (_) {}
    const el = document.querySelector('#page-ai .b3-sens');
    if (el) el.outerHTML = _aiKbSensHtml(); else _aiPaint();
    _aiKbSensSuivre();
  }, 2500);
}
async function aiKbSensModeles() {
  aiUI.kbSensBusy = true; aiUI.kbSensErr = ''; _aiPaint();
  try { aiUI.kbSensModeles = await _aiFetch('/api/ai/kb/sens/modeles'); }
  catch (e) { aiUI.kbSensErr = e.message; aiUI.kbSensModeles = { modeles: [], tous: [] }; }
  aiUI.kbSensBusy = false; _aiPaint();
}
async function aiKbSensActiver(model) {
  model = String(model || '').trim();
  aiUI.kbSensBusy = true; aiUI.kbSensErr = ''; _aiPaint();
  try { aiUI.kbSens = await _aiFetch('/api/ai/kb/sens', { method: 'PUT', body: JSON.stringify({ model }) }); aiUI.kbSensModeles = null; }
  catch (e) { aiUI.kbSensErr = model ? `${model} ne fait pas d'embeddings ou ne répond pas : ${e.message}` : e.message; }
  aiUI.kbSensBusy = false; _aiPaint(); _aiKbSensSuivre();
}
async function aiKbSensReindexer() {
  try { aiUI.kbSens = await _aiFetch('/api/ai/kb/sens/reindex', { method: 'POST', body: '{}' }); } catch (e) { aiUI.kbSensErr = e.message; }
  _aiPaint(); _aiKbSensSuivre();
}
function _aiKbSensHtml() {
  const e = aiUI.kbSens || {};
  const M = aiUI.kbSensModeles;
  const busy = aiUI.kbSensBusy;
  const choix = M ? `<div class="b3-sens-pick">
      ${M.modeles.length ? `<p>Modèles d'embeddings trouvés chez ton service IA :</p><div class="b3-sens-chips">${M.modeles.map(m => `<button type="button" class="b3-ghost" ${busy ? 'disabled' : ''} onclick="aiKbSensActiver(${escAttrArg(m)})">${esc(m)}</button>`).join('')}</div>`
        : `<p>Aucun modèle d'embeddings reconnu dans la liste du service${M.tous.length ? ` (${M.tous.length} modèle${M.tous.length > 1 ? 's' : ''} au total)` : ''}. Si tu connais son nom, saisis-le :</p>`}
      <form onsubmit="event.preventDefault();aiKbSensActiver(this.m.value)"><input name="m" list="b3-sens-l" placeholder="ex. bge-m3, text-embedding-3-small" autocomplete="off">
        <datalist id="b3-sens-l">${(M.tous || []).map(m => `<option value="${esc(m)}">`).join('')}</datalist>
        <button type="submit" class="b3-ghost" ${busy ? 'disabled' : ''}>${busy ? 'Essai…' : 'Essayer et activer'}</button></form>
    </div>` : '';
  if (!e.modele) return `<section class="b3-sens">
      <div class="b3-sens-h"><b>Recherche par le sens</b><span class="b3-sens-st">non activée</span></div>
      <p>Pear AI comprend ta question, cherche dans les documents puis relit les passages trouvés avant de répondre. Pour qu'il retrouve aussi un passage écrit avec d'autres mots (« plus d'internet » ↔ « coupure du service data »), active un modèle d'embeddings de ton service IA.</p>
      ${M ? choix : `<button type="button" class="b3-ghost" ${busy ? 'disabled' : ''} onclick="aiKbSensModeles()">${busy ? 'Recherche…' : 'Chercher un modèle d\'embeddings'}</button>`}
      ${aiUI.kbSensErr ? `<p class="b3-sens-err">${esc(aiUI.kbSensErr)}</p>` : ''}
    </section>`;
  const pct = e.total ? Math.round(e.indexes / e.total * 100) : 100;
  const cours = e.en_cours;
  return `<section class="b3-sens is-on">
      <div class="b3-sens-h"><b>Recherche par le sens</b><span class="b3-sens-st ${e.actif ? 'is-run' : pct === 100 ? 'is-ok' : ''}">${e.actif ? 'indexation…' : pct === 100 ? 'active' : 'incomplète'}</span></div>
      <p>Modèle <b>${esc(e.modele)}</b> · ${(e.indexes || 0).toLocaleString((globalThis.PEAR_LOCALE || 'fr-FR'))} / ${(e.total || 0).toLocaleString((globalThis.PEAR_LOCALE || 'fr-FR'))} passages compris</p>
      <div class="b3-sens-bar"><i style="width:${cours && cours.total ? Math.round(cours.fait / cours.total * 100) : pct}%"></i></div>
      ${cours ? `<small>${esc(cours.doc || '')} · ${cours.fait.toLocaleString((globalThis.PEAR_LOCALE || 'fr-FR'))} / ${cours.total.toLocaleString((globalThis.PEAR_LOCALE || 'fr-FR'))}</small>` : ''}
      ${e.erreur ? `<p class="b3-sens-err">Interrompue : ${esc(e.erreur)}</p>` : ''}
      ${aiUI.kbSensErr ? `<p class="b3-sens-err">${esc(aiUI.kbSensErr)}</p>` : ''}
      <div class="b3-sens-a">
        ${!e.actif && pct < 100 ? `<button type="button" class="b3-ghost" onclick="aiKbSensReindexer()">Reprendre</button>` : ''}
        <button type="button" class="b3-link" onclick="aiKbSensModeles()">Changer de modèle</button>
        <button type="button" class="b3-link" onclick="if(confirm('Couper la recherche par le sens ? Pear AI cherchera de nouveau par mots-clés.'))aiKbSensActiver('')">Couper</button>
      </div>
      ${M ? choix : ''}
    </section>`;
}
const _aiTaille = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n);

function _aiKbHtml() {
  const kb = aiUI.kb || { docs: [], enabled: true, chars: 0, limits: {} };
  const up = aiUI.kbUp || [];
  const res = aiUI.kbRes;
  return `<div class="b3-dr-h"><b>Documents de Pear AI</b><button class="b3-icon is-sm" onclick="aiKbToggle()" aria-label="Fermer">×</button></div>
    <div class="b3-kb">
      <p class="b3-kb-intro">Importe tes procédures, guides et comptes rendus : Pear AI s'appuie dessus pour répondre et cite le document utilisé.</p>
      <label class="bb-switch b3-kb-on"><input type="checkbox" ${kb.enabled ? 'checked' : ''} onchange="aiKbActiver(this.checked)"><span></span>
        ${kb.enabled ? 'Pear AI utilise ces documents' : 'Documents ignorés par Pear AI'}</label>
      ${_aiKbSensHtml()}
      <label class="b3-drop" id="ai-kb-drop" ondragover="event.preventDefault();this.classList.add('is-over')" ondragleave="this.classList.remove('is-over')"
          ondrop="event.preventDefault();this.classList.remove('is-over');aiKbFichiers(event.dataTransfer.files)">
        <input type="file" multiple accept=".${AI_KB_EXT.join(',.')}" onchange="aiKbFichiers(this.files);this.value=''">
        <span class="b3-drop-i">${_aiIco('up')}</span>
        <b>Dépose tes fichiers ici</b><small>ou clique pour choisir · PDF, Word, PowerPoint, Excel, texte · 50 Mo max</small>
      </label>
      ${up.length ? `<ul class="b3-up">${up.map(u => `<li class="is-${u.etat}"><span>${esc(u.name)}</span><small>${esc(u.msg || '')}</small></li>`).join('')}</ul>` : ''}
      <div class="b3-kb-h"><b>${kb.docs.length} document${kb.docs.length > 1 ? 's' : ''}</b><small>${_aiTaille(kb.chars || 0)} caractères${kb.limits?.chars_total ? ` sur ${_aiTaille(kb.limits.chars_total)}` : ''}</small></div>
      ${kb.docs.length ? `<ul class="b3-docs">${kb.docs.map(d => `<li>
          <span class="b3-doc-t">${esc((d.type || '?').toUpperCase())}</span>
          <button class="b3-doc-n" onclick="aiKbOuvrir('${d.id}')"><b>${esc(d.name)}</b><small>${d.chunks} passage${d.chunks > 1 ? 's' : ''} · ${_aiTaille(d.chars)} car. · ${esc(new Date(d.added_at).toLocaleDateString((globalThis.PEAR_LOCALE || 'fr-FR')))}</small></button>
          <button class="b3-icon is-sm" onclick="aiKbRetirer('${d.id}')" title="Retirer" aria-label="Retirer">×</button></li>`).join('')}</ul>`
        : '<p class="b3-empty">Aucun document pour l\'instant.</p>'}
      ${kb.docs.length ? `<form class="b3-kb-q" onsubmit="event.preventDefault();aiKbChercher(this.q.value)">
          <input name="q" value="${esc(aiUI.kbQ || '')}" placeholder="Tester : que trouve Pear AI pour… ?">
          <button class="b3-ghost" type="submit">Chercher</button></form>
        ${res ? (res.length ? `<ol class="b3-kb-res">${res.map(r => `<li><b>${esc(r.name)}</b> <small>passage ${r.part}${r.via ? ` · trouvé par ${esc(r.via)}` : ''}</small><p>${esc(r.text.slice(0, 260))}…</p></li>`).join('')}</ol>`
          : '<p class="b3-empty">Aucun passage ne correspond.</p>') : ''}` : ''}
      ${aiUI.kbDoc ? `<div class="b3-kb-view"><div class="b3-kb-h"><b>${esc(aiUI.kbDoc.name)}</b><button class="b3-link" onclick="aiUI.kbDoc=null;_aiPaint()">Fermer l'aperçu</button></div>
        ${aiUI.kbDoc.passages.map((t, i) => `<p><small>Passage ${i + 1}</small>${esc(t)}</p>`).join('')}</div>` : ''}
    </div>`;
}

async function aiKbActiver(on) {
  try { aiUI.kb = await _aiFetch('/api/ai/kb', { method: 'PUT', body: JSON.stringify({ enabled: on }) }); } catch (e) { aiUI.err = e.message; }
  _aiPaint();
}
async function aiKbRetirer(id) {
  const d = (aiUI.kb?.docs || []).find(x => x.id === id);
  if (!d || !confirm(`Retirer « ${d.name} » de la base ?`)) return;
  try { await _aiFetch(`/api/ai/kb/${id}`, { method: 'DELETE' }); } catch (e) { if (typeof toast === 'function') toast(e.message, 'error'); }
  if (aiUI.kbDoc && aiUI.kbDoc.id === id) aiUI.kbDoc = null;
  aiKbLoad();
}
async function aiKbChercher(q) {
  aiUI.kbQ = q;
  try { aiUI.kbRes = (await _aiFetch(`/api/ai/kb/search?q=${encodeURIComponent(q)}`)).results || []; } catch (e) { aiUI.kbRes = []; aiUI.err = e.message; }
  _aiPaint();
}
async function aiKbOuvrir(id) {
  try { aiUI.kbDoc = await _aiFetch(`/api/ai/kb/${encodeURIComponent(id)}`); } catch (e) { if (typeof toast === 'function') toast(e.message, 'error'); return; }
  aiUI.skill = ''; aiUI.showConf = false; aiUI.showKb = true; _aiPaint();
  document.querySelector('#page-ai .b3-kb-view')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

// Lecture d'un PDF dans le navigateur : pdf.js est servi par l'appli
// (public/vendor/pdfjs), chargé seulement au premier PDF.
let _aiPdfjs = null;
async function _aiTextePdf(file, progres) {
  if (!_aiPdfjs) {
    _aiPdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
    _aiPdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  }
  const pdf = await _aiPdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    if (progres && (i === 1 || i % 10 === 0)) progres(i, pdf.numPages);
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    page.cleanup();
    // Les morceaux d'une même ligne se suivent ; un saut (hasEOL) termine la ligne.
    let ligne = '', lignes = [];
    tc.items.forEach(it => { ligne += it.str; if (it.hasEOL) { lignes.push(ligne); ligne = ''; } else if (it.str && !/\s$/.test(it.str)) ligne += ' '; });
    if (ligne.trim()) lignes.push(ligne);
    const t = lignes.map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
    if (t) pages.push(`Page ${i}\n${t}`);
  }
  return pages.join('\n\n');
}

async function _aiUpload(name, blob, estTexte) {
  const r = await fetch(`${API}/api/ai/kb/upload`, { method: 'POST', body: blob, credentials: 'same-origin',
    headers: AdminSession.headers({ 'Content-Type': 'application/octet-stream', 'X-Kb-Name': encodeURIComponent(name), ...(estTexte ? { 'X-Kb-Text': '1' } : {}) }) });
  const d = await r.json().catch(() => ({}));
  if (r.status === 413) throw new Error('trop lourd pour le serveur (50 Mo max)');
  if (!r.ok) throw new Error(d.error || `Erreur ${r.status}`);
  return d;
}

async function aiKbFichiers(liste) {
  const files = [...(liste || [])];
  if (!files.length) return;
  aiUI.kbUp = files.map(f => ({ name: f.name, etat: 'wait', msg: 'En attente' }));
  _aiPaint();
  for (const [i, f] of files.entries()) {
    const u = aiUI.kbUp[i];
    const ext = (/\.([a-z0-9]+)$/i.exec(f.name) || [])[1]?.toLowerCase() || '';
    try {
      if (!AI_KB_EXT.includes(ext)) throw new Error('format non pris en charge');
      if (f.size > 50 * 1024 * 1024) throw new Error(`trop lourd (${Math.round(f.size / 1048576)} Mo, 50 Mo max)`);
      u.etat = 'run'; u.msg = ext === 'pdf' ? 'Lecture du PDF…' : `Envoi (${Math.max(1, Math.round(f.size / 1048576))} Mo)…`; _aiPaint();
      // Envoi en binaire brut : un fichier de 20 Mo passait mal en base64 dans du JSON.
      const texte = ext === 'pdf' ? await _aiTextePdf(f, (p, n) => { u.msg = `Lecture du PDF… page ${p} / ${n}`; _aiPaint(); }) : null;
      u.msg = 'Envoi et découpage…'; _aiPaint();
      const d = await _aiUpload(f.name, texte !== null ? new Blob([texte], { type: 'text/plain;charset=utf-8' }) : f, texte !== null);
      u.etat = 'ok'; u.msg = `${d.replaced ? 'Remplacé' : 'Ajouté'} · ${d.chunks} passage${d.chunks > 1 ? 's' : ''}`;
    } catch (e) { u.etat = 'ko'; u.msg = e.message; }
    _aiPaint();
  }
  aiKbLoad();
}
