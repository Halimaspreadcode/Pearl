// ══════════════════════════════════════════════════════════════
// PONT « DIGITALVIEW · FORMATION » ↔ SERVEUR EMOC
//
// La formation a été construite comme artefact claude.ai : elle enregistre
// sa progression dans localStorage et, quand elle tourne dans claude.ai,
// la synchronise via window.claude.use('db') / use('user') (document
// data/users/<id>/progress, get() / set(), fusion multi-appareils déjà
// écrite dans l'artefact — mergeState).
//
// Ce fichier, chargé AVANT le code de la formation, lui fournit un
// window.claude de même interface, adossé au serveur EMOC :
//   · use('user').id()  → l'ID Huawei de l'agent identifié dans l'app
//     (localStorage 'fo-user', même origine que la page) ;
//   · use('db').doc(p).get()/set() → GET/PUT /api/formation/progress/:id.
// Le code de la formation n'est pas modifié : c'est lui qui fusionne ce
// que renvoie le serveur avec l'état local, et qui pousse les changements.
//
// Poste partagé : localStorage est commun à tous les agents du navigateur.
// On range donc l'état local de la formation par agent (clé suffixée par
// l'ID), sinon l'agent suivant hériterait de la progression du précédent.
// Le thème suit celui de l'app (noir pur en sombre).
// ══════════════════════════════════════════════════════════════
(function () {
  // Le même pont sert plusieurs formations construites sur ce moteur
  // (DigitalView, Process ITSM) : la balise <script> dit laquelle et quelles
  // clés locales elle utilise. Sans attribut : DigitalView, comme avant.
  var tag = document.currentScript;
  var cours = (tag && tag.getAttribute('data-course')) || 'digitalview';
  var cles = ((tag && tag.getAttribute('data-keys')) || 'dvf-state,dvs-state').split(',');
  // ── Fermetures décidées par l'admin dans l'Academy ──
  // Lues AVANT le script du cours (requête synchrone, réponse minuscule) :
  // la liste des modules doit être filtrée au moment où le cours la
  // déclare, sinon les compteurs, la révision et l'examen final
  // compteraient des modules fermés. L'admin, lui, voit tout : il doit
  // pouvoir relire un module avant de l'ouvrir à l'équipe.
  var verrous = { courses: {}, modules: {} };
  try {
    var xr = new XMLHttpRequest();
    xr.open('GET', '/api/academy/locks', false);
    xr.send();
    if (xr.status === 200) verrous = JSON.parse(xr.responseText) || verrous;
  } catch (e) { /* hors ligne : tout reste ouvert */ }
  var estAdmin = false;
  try { estAdmin = !!(window.parent && window.parent !== window && window.parent.AdminSession && window.parent.AdminSession.active); } catch (e) {}
  if (!estAdmin) {
    var _mods;
    try {
      // `var MODS = [...]` dans le cours passe par ce setter (même procédé
      // que CFG plus bas) : on garde la liste privée de ses modules fermés.
      Object.defineProperty(window, 'MODS', {
        configurable: false, enumerable: true,
        get: function () { return _mods; },
        set: function (v) {
          _mods = Array.isArray(v) ? v.filter(function (m) { return !(verrous.modules || {})[cours + ':' + m.id]; }) : v;
        },
      });
    } catch (e) { /* navigateur ancien : rien n'est filtré */ }
    if ((verrous.courses || {})[cours]) {
      document.addEventListener('DOMContentLoaded', function () {
        document.body.innerHTML = '<div style="min-height:100vh;display:grid;place-items:center;font:600 18px system-ui;'
          + 'text-align:center;padding:24px;color:var(--ink,#111)"><div><div style="font-size:54px">🔒</div>'
          + '<p>Cette formation est fermée pour le moment.</p>'
          + '<p style="font-weight:400;font-size:14px;opacity:.7">Elle rouvrira bientôt : retourne à l\'Academy.</p></div></div>';
      });
    }
  }

  var moi = null;
  try { moi = JSON.parse(localStorage.getItem('fo-user') || 'null'); } catch (e) { moi = null; }
  var uid = moi && moi.huaweiId ? String(moi.huaweiId).trim().toLowerCase() : '';

  // ── État local rangé par agent ──
  var PAR_AGENT = {};
  cles.forEach(function (k) { PAR_AGENT[k.trim()] = 1; });
  var get0 = Storage.prototype.getItem, set0 = Storage.prototype.setItem, del0 = Storage.prototype.removeItem;
  function cle(k) { return PAR_AGENT[k] ? k + ':' + (uid || 'anonyme') : k; }
  Storage.prototype.getItem = function (k) {
    if (this === window.localStorage && k === 'dvf-theme') return JSON.stringify(theme());
    return get0.call(this, this === window.localStorage ? cle(k) : k);
  };
  Storage.prototype.setItem = function (k, v) {
    if (this === window.localStorage && k === 'dvf-theme') return; // le thème est celui de l'app
    return set0.call(this, this === window.localStorage ? cle(k) : k, v);
  };
  Storage.prototype.removeItem = function (k) { return del0.call(this, this === window.localStorage ? cle(k) : k); };

  function theme() {
    try { return get0.call(localStorage, 'fo-theme') || 'dark'; } catch (e) { return 'dark'; }
  }
  document.documentElement.setAttribute('data-theme', theme());
  // Noir pur en sombre, comme le reste de la plateforme.
  var css = document.createElement('style');
  // En sombre, les cartes pastel du cours tournaient au gris : on leur
  // rend une teinte unie et discrète de la couleur du module (pas de
  // dégradé : l'équipe préfère un rendu sobre).
  css.textContent = 'html:root[data-theme="dark"]{--bg:#000;--surface:#000;--surface2:#000;--line:#26262B}'
    + 'html:root[data-theme="dark"] .pastel{background:#000;color:#F2F2F5}'
    + 'html:root[data-theme="dark"] .thumb.pastel,html:root[data-theme="dark"] .illus{color:color-mix(in srgb,var(--deep) 40%,#fff);background:#000}'
    // Noir pur : plus de surfaces gris foncé. Ce qui se détachait par sa
    // teinte se détache par un contour fin.
    + 'html[data-theme="dark"] :is(.item,.cal,.search,.opt,.wdet,.gitem,.card,.sheet,.widget,.lq,.lrecap,.chip,.pc2,.pastel,.thumb,.dg,.dg-tb>span,.t-n,.vz-msg,.vz-box,.vz-btn,.tviz,.wtabs button,.wfloor,.wai,.startbar,.rbtn,.navb,.lbtn,.morebtn,.deep,.lcur li.cur>button,.lsecs a.on,.hdr .who>span,.hdr .who>.xpbar,.fig img){border:1px solid var(--line)!important;box-shadow:none!important}'
    + 'html[data-theme="dark"] :is(.vz-box.sel,.vz-btn.on,.vz-btn:hover,.wtabs button[aria-selected="true"]){border-color:transparent!important}'
    // Sur un bloc coloré (carte « à suivre », pastels), le filet sombre
    // dessinait un cadre noir autour du bouton : pas de filet là.
    + 'html[data-theme="dark"] body :is(.feat .startbar,.feat.pastel,.pastel .startbar,.pastel .chip):not(#_){border-color:transparent!important}'
    // Schémas tirés des supports de cours (span.fig dans un paragraphe) :
    // fond blanc même en sombre (les diapositives sont claires), agrandis
    // au clic.
    + '.fig{display:block;margin:4px 0 2px}'
    + '.fig img{display:block;width:100%;height:auto;border-radius:14px;background:#fff;border:1px solid var(--line);cursor:zoom-in}'
    + '.fig small{display:block;margin-top:8px;font-size:13px;line-height:1.45;color:var(--muted)}'
    + '.figzoom{position:fixed;inset:0;z-index:9999;background:rgba(10,10,14,.86);display:flex;align-items:center;justify-content:center;padding:24px;cursor:zoom-out}'
    + '.figzoom img{max-width:100%;max-height:100%;border-radius:12px;background:#fff;box-shadow:0 20px 60px rgba(0,0,0,.4)}';
  document.head.appendChild(css);
  // Clic sur un schéma : plein écran ; clic ou Échap pour fermer. En phase
  // de capture, pour que le clic n'avance pas la carte en mode cartes.
  // « Voir la diapositive d'origine » : déplie l'image sous le schéma
  // simplifié, sans faire avancer la carte.
  document.addEventListener('click', function (e) {
    var bt = e.target && e.target.closest && e.target.closest('.fig-o>button');
    if (!bt) return;
    e.preventDefault(); e.stopPropagation();
    var o = bt.parentNode.classList.toggle('open');
    bt.textContent = o ? 'Masquer la diapositive' : 'Voir la diapositive d\'origine';
  }, true);
  document.addEventListener('click', function (e) {
    var img = e.target && e.target.closest && e.target.closest('.fig img');
    if (!img) return;
    e.preventDefault(); e.stopPropagation();
    var z = document.createElement('div');
    z.className = 'figzoom';
    z.setAttribute('role', 'dialog');
    z.setAttribute('aria-label', img.alt || 'Schéma');
    var big = document.createElement('img');
    big.src = img.src; big.alt = img.alt || '';
    z.appendChild(big);
    var fermer = function () { z.remove(); document.removeEventListener('keydown', echap, true); };
    var echap = function (k) { if (k.key === 'Escape') { k.stopPropagation(); fermer(); } };
    z.addEventListener('click', function (ev) { ev.stopPropagation(); fermer(); });
    document.addEventListener('keydown', echap, true);
    document.body.appendChild(z);
  }, true);

  // Fiche d'un mot clé : si la formation fournit une illustration propre
  // à ce terme (window.GI, voir reseau-widgets.js), on l'ajoute sous la
  // définition, avant le bouton « Compris ». On ne reprend plus les
  // scènes des leçons (window.GV) : la fiche répétait la leçon.
  document.addEventListener('DOMContentLoaded', function () {
    if (typeof window.showTerm !== 'function') return;
    var montrer = window.showTerm;
    window.showTerm = function (k) {
      montrer(k);
      var sheet = document.querySelector('.sheet');
      if (!sheet) return;
      var v = window.GI && window.GI[k];
      var html = '';
      try { html = v ? (typeof v === 'function' ? v() : String(v)) : ''; } catch (e) { html = ''; }
      sheet.classList.toggle('has-viz', !!html);
      if (!html) return;
      var box = document.createElement('div');
      box.className = 'tviz';
      box.innerHTML = '<span class="tviz-t">En image</span>' + html;
      var ok = sheet.querySelector('#tok');
      sheet.insertBefore(box, ok);
    };
  });
  var cssViz = document.createElement('style');
  cssViz.textContent = '.sheet.has-viz{max-width:640px!important;max-height:90vh;overflow:auto}'
    + '.tviz{margin:16px 0 4px;padding:14px;border-radius:18px;background:var(--surface2)}'
    + '.tviz-t{display:block;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}'
    + '.tviz .vz-msg{background:var(--surface)}';
  document.head.appendChild(cssViz);

  // Widgets classiques des leçons (onglets, étages ou étapes, accordéons) :
  // une finition commune à toutes les formations. Les étapes deviennent
  // une frise verticale (pastilles reliées), les onglets un sélecteur à
  // segments, les accordéons des cartes. Couleurs pleines, sans dégradé.
  var cssW = document.createElement('style');
  cssW.textContent = ''
    + '.wtabs{display:flex;flex-wrap:wrap;gap:4px;padding:4px;border-radius:14px;background:var(--surface2);overflow:visible}'
    + '.wtabs button{border:0!important;background:transparent!important;color:var(--muted)!important;border-radius:10px!important;padding:8px 12px!important;font-weight:600!important;font-size:13.5px!important;transition:background-color .2s,color .2s}'
    + '.wtabs button[aria-selected="true"]{background:var(--surface)!important;color:var(--ink)!important;box-shadow:0 1px 3px rgba(0,0,0,.12)}'
    + 'html[data-theme="dark"] .wtabs button[aria-selected="true"]{background:#1B1D22!important;box-shadow:0 0 0 1px var(--line)}'
    + '.wfl{position:relative;gap:4px!important;padding-left:30px}'
    + '.wfl::before{content:"";position:absolute;left:11px;top:22px;bottom:22px;width:2px;background:var(--line);border-radius:2px}'
    + '.wfloor{position:relative;border:0!important;background:transparent!important;box-shadow:none!important;padding:10px 12px!important;border-radius:12px!important;transition:background-color .2s}'
    + '.wfloor::before{content:"";position:absolute;left:-25px;top:50%;width:12px;height:12px;margin-top:-8px;border-radius:50%;background:var(--surface);border:2px solid var(--line);transition:all .2s}'
    + '.wfloor:hover{background:var(--surface2)!important}'
    + '.wfloor.on{background:var(--surface2)!important}.wfloor.on::before{background:var(--deep);border-color:var(--deep);box-shadow:0 0 0 4px color-mix(in srgb,var(--deep) 22%,transparent)}'
    + '.wfloor.on b{color:var(--deep)}html[data-theme="dark"] .wfloor.on b{color:var(--ink)}'
    + '.wfloor small{display:inline!important;font-size:12.5px}'
    + '.wfloor.ws{background:var(--surface2)!important}.wfloor.ws::before{display:none}'
    + '.wdet{background:var(--surface2);border-radius:16px}'
    + '.wai{border:0!important;background:var(--surface2);border-radius:16px!important}'
    + '.wai.open{box-shadow:inset 0 0 0 2px var(--deep)}'
    + '.wah .wbadge{width:34px!important;height:34px!important;border-radius:50%;display:grid;place-items:center;background:var(--surface)!important;color:var(--deep)}'
    + '.wsv{border:0!important;background:var(--surface2)!important}'
    + '.wnodes span{background:var(--surface)!important}';
  document.head.appendChild(cssW);
  // ── Poser une question à Big Brother, depuis la leçon ───────────────
  // Un bouton rond en bas à droite, visible dans une leçon (vue cours ou
  // mode cartes) quand Big Brother est configuré et que la personne y a
  // droit (voir server/routes/formation-ask.js). La question part avec le
  // passage affiché à l'écran (la section en cours et la précédente) et,
  // s'il y en a, le texte surligné. Une conversation par session.
  (function () {
    var etat = { on: false, admin: false, ouvert: false, attente: false, conv: {}, sel: '' };
    var css = document.createElement('style');
    css.textContent = ''
      + '.bb-fab{position:fixed;right:18px;bottom:18px;z-index:99990;display:none;align-items:center;gap:8px;border:0;border-radius:999px;padding:12px 16px 12px 14px;background:var(--ink);color:var(--bg);font:inherit;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.22)}'
      + '.bb-fab.vis{display:flex}.bb-fab svg{width:20px;height:20px}'
      + '.bb-chip{position:fixed;z-index:99991;display:none;border:0;border-radius:999px;padding:7px 12px;background:var(--ink);color:var(--bg);font:inherit;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.2)}'
      + '.bb-pan{position:fixed;z-index:99995;right:16px;bottom:16px;width:min(400px,calc(100vw - 32px));height:min(620px,calc(100vh - 32px));display:none;flex-direction:column;border-radius:22px;background:var(--surface);color:var(--ink);box-shadow:0 12px 40px rgba(0,0,0,.28);overflow:hidden}'
      + '.bb-pan.vis{display:flex}html[data-theme="dark"] .bb-pan{background:#0B0C0F;box-shadow:0 0 0 1px var(--line),0 12px 40px rgba(0,0,0,.6)}'
      + '.bb-hd{display:flex;align-items:flex-start;gap:10px;padding:14px 14px 10px;border-bottom:1px solid var(--line)}.bb-hd b{display:block;font-size:15px}.bb-hd small{display:block;color:var(--muted);font-size:12.5px;margin-top:2px;line-height:1.35}'
      + '.bb-x{margin-left:auto;border:0;background:var(--surface2);color:var(--ink);width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:16px;flex:none}'
      + '.bb-ms{flex:1;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px;scrollbar-width:thin}'
      + '.bb-m{max-width:92%;padding:10px 12px;border-radius:16px;font-size:14px;line-height:1.5}.bb-m p{margin:0 0 6px}.bb-m p:last-child{margin:0}.bb-m ul,.bb-m ol{margin:4px 0 6px;padding-left:18px}'
      + '.bb-m.u{align-self:flex-end;background:var(--ink);color:var(--bg);border-bottom-right-radius:6px}.bb-m.a{align-self:flex-start;background:var(--surface2);border-bottom-left-radius:6px}.bb-m.e{align-self:flex-start;background:#F6D5D3;color:#8E1F17}html[data-theme="dark"] .bb-m.e{background:#3A1A18;color:#F6B4AE}'
      + '.bb-m.w span{display:inline-block;width:7px;height:7px;margin-right:4px;border-radius:50%;background:var(--muted);animation:bbw 1s infinite}.bb-m.w span:nth-child(2){animation-delay:.15s}.bb-m.w span:nth-child(3){animation-delay:.3s}@keyframes bbw{50%{opacity:.25}}'
      + '.bb-sg{display:flex;flex-wrap:wrap;gap:6px}.bb-sg button{border:0;border-radius:999px;padding:7px 11px;background:var(--surface2);color:var(--ink);font:inherit;font-size:13px;cursor:pointer;text-align:left}.bb-sg button:hover{box-shadow:inset 0 0 0 1.5px var(--ink)}'
      + '.bb-intro{font-size:13.5px;color:var(--muted);line-height:1.45}'
      + '.bb-sel{margin:0 14px;padding:7px 10px;border-radius:10px;background:var(--surface2);font-size:12.5px;color:var(--muted);display:none;align-items:center;gap:8px}.bb-sel.vis{display:flex}.bb-sel span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bb-sel button{border:0;background:none;color:var(--muted);cursor:pointer;font-size:14px}'
      + '.bb-in{display:flex;gap:8px;align-items:flex-end;padding:10px 12px 12px}.bb-in textarea{flex:1;resize:none;max-height:120px;min-height:42px;border:1px solid var(--line);border-radius:14px;padding:10px 12px;font:inherit;font-size:14px;background:var(--bg);color:var(--ink)}'
      + '.bb-in button{flex:none;width:42px;height:42px;border:0;border-radius:50%;background:var(--ink);color:var(--bg);cursor:pointer;font-size:18px}.bb-in button:disabled{opacity:.4;cursor:default}'
      + '.bb-ft{padding:0 14px 10px;font-size:11.5px;color:var(--muted)}'
      + '@media (max-width:560px){.bb-pan{right:0;bottom:0;width:100vw;height:82vh;border-radius:22px 22px 0 0}.bb-fab span{display:none}.bb-fab{padding:14px}}';
    document.head.appendChild(css);

    function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    // Réponse du modèle : texte simple, gras **…**, listes « - » ou « 1. ».
    function rendu(t) {
      var lignes = esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split(/\n/), h = '', liste = null;
      function fin() { if (liste) { h += '</' + liste + '>'; liste = null; } }
      lignes.forEach(function (l) {
        var m = /^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/.exec(l);
        if (m) { var t2 = m[1] ? 'ol' : 'ul'; if (liste !== t2) { fin(); h += '<' + t2 + '>'; liste = t2; } h += '<li>' + m[2] + '</li>'; return; }
        fin(); if (l.trim()) h += '<p>' + l + '</p>';
      });
      fin(); return h;
    }
    function ico(n) { try { return window.ico ? window.ico(n, 20) : ''; } catch (e) { return ''; } }

    // Où en est l'apprenant : session, section affichée, passage lisible.
    function ici() {
      var story = document.getElementById('story'), S = window.S, r = window.route || {};
      var vis = function (e) { return e && e.offsetParent !== null; };
      if (story && !story.classList.contains('hidden') && S && S.sess && S.mode === 'lesson') {
        var c = document.getElementById('card'), carte = S.sess.cards[S.idx] || {};
        return { sess: S.sess, section: carte.h || carte.q || 'Carte ' + (S.idx + 1), passage: c ? c.innerText : '' };
      }
      if (r.v === 'course' && typeof window.findS === 'function') {
        var s = window.findS(r.s); if (!s) return null;
        var secs = [].slice.call(document.querySelectorAll('.lesson section[data-k]')).filter(vis), cur = 0, lim = innerHeight * 0.45;
        secs.forEach(function (x, i) { if (x.getBoundingClientRect().top < lim) cur = i; });
        var a = secs[cur], p = secs[cur - 1];
        var titre = a ? ((a.querySelector('h2,.qq,.whead b') || {}).textContent || '') : '';
        var passage = (p ? p.innerText.slice(-1500) + '\n\n' : '') + (a ? a.innerText : '');
        return { sess: s, section: titre.trim() || s.t, passage: passage };
      }
      return null;
    }

    var fab = document.createElement('button'), chip = document.createElement('button'), pan = document.createElement('div');
    fab.className = 'bb-fab'; fab.type = 'button'; fab.innerHTML = ico('Bot') + '<span>Poser une question</span>'; fab.setAttribute('aria-label', 'Poser une question à Big Brother');
    chip.className = 'bb-chip'; chip.type = 'button'; chip.textContent = 'Demander à Big Brother';
    pan.className = 'bb-pan'; pan.setAttribute('role', 'dialog'); pan.setAttribute('aria-label', 'Question à Big Brother');
    pan.innerHTML = '<div class="bb-hd"><div><b>Pose ta question</b><small class="bb-ou"></small></div><button class="bb-x" type="button" aria-label="Fermer">✕</button></div>'
      + '<div class="bb-ms" aria-live="polite"></div><div class="bb-sel"><span></span><button type="button" aria-label="Retirer">✕</button></div>'
      + '<form class="bb-in"><textarea rows="1" placeholder="Ta question sur ce passage…" maxlength="600"></textarea><button type="submit" aria-label="Envoyer">➤</button></form>'
      + '<div class="bb-ft">Big Brother s\'appuie sur le passage affiché. Il peut se tromper : vérifie l\'important.</div>';
    // Les clics et les touches ne doivent pas faire avancer la leçon.
    ['click', 'keydown', 'keyup', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'wheel'].forEach(function (ev) {
      pan.addEventListener(ev, function (e) { e.stopPropagation(); });
      chip.addEventListener(ev, function (e) { e.stopPropagation(); });
      fab.addEventListener(ev, function (e) { e.stopPropagation(); });
    });
    var ms = pan.querySelector('.bb-ms'), ta = pan.querySelector('textarea'), envoi = pan.querySelector('.bb-in button'), selBox = pan.querySelector('.bb-sel');

    function cle() { var c = ici(); return c ? c.sess.key : '_'; }
    function conv() { var k = cle(); return etat.conv[k] || (etat.conv[k] = []); }
    function bulle(cls, html) { var d = document.createElement('div'); d.className = 'bb-m ' + cls; d.innerHTML = html; ms.appendChild(d); ms.scrollTop = ms.scrollHeight; return d; }
    var SUGG = ['Explique-moi ça plus simplement', 'Donne-moi un exemple concret', 'À quoi ça me sert dans mon travail ?', 'Pose-moi une question pour vérifier que j\'ai compris'];
    function dessiner() {
      var c = ici(); pan.querySelector('.bb-ou').textContent = c ? 'Ici : ' + c.sess.t + ' · ' + c.section : 'Ouvre une leçon pour poser une question.';
      ms.innerHTML = ''; var h = conv();
      if (!h.length) {
        bulle('a', '<div class="bb-intro">Une question sur ce que tu lis ? Je pars du passage affiché à l\'écran. Tu peux aussi <b>surligner</b> une phrase dans la leçon avant de demander.</div>');
        var sg = document.createElement('div'); sg.className = 'bb-sg';
        SUGG.forEach(function (t) { var b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.onclick = function () { poser(t); }; sg.appendChild(b); });
        ms.appendChild(sg);
      }
      h.forEach(function (m) { bulle(m.role === 'user' ? 'u' : 'a', m.role === 'user' ? esc(m.content) : rendu(m.content)); });
      selBox.classList.toggle('vis', !!etat.sel); selBox.querySelector('span').textContent = etat.sel ? 'Passage surligné : « ' + etat.sel + ' »' : '';
    }
    function ouvrir() { etat.ouvert = true; pan.classList.add('vis'); fab.classList.remove('vis'); chip.style.display = 'none'; dessiner(); setTimeout(function () { ta.focus(); }, 50); }
    function fermer() { etat.ouvert = false; pan.classList.remove('vis'); maj(); }

    function poser(q) {
      q = String(q || '').trim(); if (!q || etat.attente) return;
      var c = ici(); if (!c) { bulle('e', 'Ouvre une leçon : la question part du passage affiché.'); return; }
      var h = conv(), hist = h.slice(-8);
      h.push({ role: 'user', content: q }); dessiner(); ta.value = '';
      etat.attente = true; envoi.disabled = true;
      var w = bulle('a w', '<span></span><span></span><span></span>');
      fetch('/api/formation/ask', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course: cours, module: c.sess.mod && c.sess.mod.t, session: c.sess.t, section: c.section, passage: String(c.passage || '').slice(0, 5000), selection: etat.sel, question: q, history: hist }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || ('Erreur ' + r.status)); return j; }); })
        .then(function (j) { h.push({ role: 'assistant', content: j.content || '' }); etat.sel = ''; dessiner(); })
        .catch(function (e) {
          h.pop(); w.remove();
          var m = String(e.message || 'Big Brother ne répond pas.');
          if (etat.admin && /tunnel|injoignable|ECONN|délai/i.test(m)) m += ' Sur ton PC : « ia on ».';
          bulle('e', esc(m)); ta.value = q;
        })
        .then(function () { etat.attente = false; envoi.disabled = false; });
    }
    pan.querySelector('.bb-x').onclick = fermer;
    selBox.querySelector('button').onclick = function () { etat.sel = ''; dessiner(); };
    pan.querySelector('form').onsubmit = function (e) { e.preventDefault(); poser(ta.value); };
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); poser(ta.value); } if (e.key === 'Escape') fermer(); });
    ta.addEventListener('input', function () { ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; });
    fab.onclick = ouvrir;
    chip.onclick = function () { ouvrir(); ta.value = 'Explique-moi ce passage : « ' + etat.sel.slice(0, 120) + (etat.sel.length > 120 ? '…' : '') + ' »'; };

    // Surligner une phrase dans la leçon propose de la demander.
    document.addEventListener('selectionchange', function () {
      if (!etat.on || etat.ouvert) return;
      var s = window.getSelection(), t = s ? String(s).trim() : '';
      if (t.length < 4 || !s.rangeCount || !ici()) { chip.style.display = 'none'; return; }
      var n = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentNode);
      if (!n || !n.closest || !n.closest('.lesson,#card')) { chip.style.display = 'none'; return; }
      etat.sel = t.slice(0, 600);
      var b = s.getRangeAt(0).getBoundingClientRect();
      chip.style.display = 'block'; chip.style.top = Math.max(8, b.top - 42) + 'px'; chip.style.left = Math.min(innerWidth - 200, Math.max(8, b.left)) + 'px';
    });

    // Le bouton suit l'écran : visible dans une leçon, caché ailleurs.
    function maj() { if (!etat.on || etat.ouvert) { fab.classList.remove('vis'); return; } fab.classList.toggle('vis', !!ici()); if (etat.ouvert) dessiner(); }
    var vu = '';
    setInterval(function () { maj(); if (etat.ouvert) { var c = ici(), k = c ? c.sess.key + '|' + c.section : ''; if (k !== vu) { vu = k; pan.querySelector('.bb-ou').textContent = c ? 'Ici : ' + c.sess.t + ' · ' + c.section : 'Ouvre une leçon pour poser une question.'; } } }, 700);

    document.addEventListener('DOMContentLoaded', function () {
      fab.innerHTML = ico('Bot') + '<span>Poser une question</span>'; pan.querySelector('.bb-hd').insertAdjacentHTML('afterbegin', ico('Bot'));
      document.body.appendChild(fab); document.body.appendChild(chip); document.body.appendChild(pan);
      fetch('/api/formation/ask/status', { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : { on: false }; })
        .then(function (j) { etat.on = !!j.on; etat.admin = !!j.admin; maj(); })
        .catch(function () {});
    });
  })();


  // ── Habillage dans l'Academy ──
  // Ouvert dans l'Academy (iframe), le cours n'a plus besoin de son propre
  // menu : Parcours, Lexique et Révision passent dans la barre de
  // l'Academy (academy.js), qui pilote le cours. On retire aussi ce qui
  // doublonnait ou alourdissait : boutons de thème (le thème est celui de
  // l'app), titres surdimensionnés, grands blocs de couleur pleine. La
  // couleur du module reste en accent (icône, barre, étiquette).
  var dansAcademy = false;
  try { dansAcademy = window.parent !== window && !!window.parent.academyOpenCourse; } catch (e) {}
  if (dansAcademy) {
    document.documentElement.classList.add('in-academy');
    var skin = document.createElement('style');
    skin.textContent = [
      '.in-academy .side,.in-academy .dock{display:none!important}',
      '.in-academy .view{padding:28px clamp(24px,3vw,56px) 60px!important;max-width:none;margin:0}',
      '@media(max-width:900px){.in-academy .view{padding:18px 16px 40px!important}}',
      // Mode leçon : le sommaire colle au bord gauche et la leçon prend la
      // place libre. Seuls les paragraphes gardent une longueur de ligne
      // lisible ; schémas, quiz et widgets s'étalent sur toute la largeur.
      'html.in-academy body.lms-on .view{max-width:none!important;padding:0!important;margin:0!important}',
      '.in-academy .lesson{max-width:1280px;margin:0 auto}',
      '.in-academy .ls p,.in-academy .ls>ul,.in-academy .ls>ol{max-width:82ch}',
      '@media(min-width:1600px){.in-academy .lside{width:320px}}',
      '.in-academy #thm,.in-academy #thm2,.in-academy .avatar{display:none!important}',
      // Graisses allégées : titres en 500, mises en avant en 600, le gras
      // n'est plus le réglage par défaut de chaque libellé.
      '.in-academy .ls h2,.in-academy .ls h3,.in-academy .cbody h2,.in-academy .qq,.in-academy .sec h2,.in-academy .sheet h3,.in-academy .cal .mo{font-weight:500!important;letter-spacing:-.01em}',
      '.in-academy .item .tt,.in-academy .lst,.in-academy .lcur .ltt,.in-academy .lcur li.cur .ltt,.in-academy .whead b,.in-academy .pc2 .nm,.in-academy .gitem .k,.in-academy .shead .st,.in-academy .wdet b,.in-academy .wah b,.in-academy .wfloor b{font-weight:500!important}',
      '.in-academy .opt,.in-academy .chip,.in-academy .wtabs button,.in-academy .lsecs a.on,.in-academy .cta,.in-academy .lbtn,.in-academy .pillbtn,.in-academy .morebtn,.in-academy .sec a,.in-academy .sec button,.in-academy .navb,.in-academy .item .pc{font-weight:500!important}',
      '.in-academy .ls p b,.in-academy .ls p strong,.in-academy .ls li b,.in-academy .ls li strong,.in-academy .term,.in-academy .recap li b{font-weight:600!important}',
      '.in-academy .lkick,.in-academy .lkick2,.in-academy .lqh,.in-academy .qtag,.in-academy .wtag,.in-academy .feat .tag{font-weight:600!important}',
      '.in-academy .lsh b,.in-academy .lsh h2,.in-academy .lsh strong,.in-academy .startbar,.in-academy .startbar b,.in-academy .pc2 .ft,.in-academy .pc2 .ft b,.in-academy .cal .days b{font-weight:500!important}',
      // Barres de défilement fines et discrètes ; celle du sommaire n'apparaît qu'au survol.
      'html.in-academy,html.in-academy *{scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--muted) 35%,transparent) transparent}',
      'html.in-academy .lside{scrollbar-color:transparent transparent}',
      'html.in-academy .lside:hover{scrollbar-color:color-mix(in srgb,var(--muted) 35%,transparent) transparent}',
      // En-tête du cours : plus de « Salut X » empilé sur quatre lignes, une
      // seule rangée de pastilles (sessions, série, synchro, niveau et XP).
      '.in-academy .hdr{margin-bottom:14px!important}',
      '.in-academy .hdr .who{display:flex;flex-wrap:wrap;align-items:center;gap:8px}',
      '.in-academy .hdr .who>b{display:none!important}',
      '.in-academy .hdr .who>span,.in-academy .hdr .who>.xpbar{display:inline-flex!important;align-items:center;gap:6px;margin:0!important;background:var(--surface);border-radius:999px;padding:7px 14px;font-size:13px!important;font-weight:500;color:var(--ink)!important;line-height:1}',
      '.in-academy .hdr .who>#syncTag{color:var(--muted)!important;font-weight:500}',
      '.in-academy .hdr .who .xpbar .lv{background:none!important;color:var(--ink)!important;padding:0!important;font-size:13px!important;font-weight:600!important}',
      '.in-academy .hdr .who .xpbar .tr{width:70px;flex:none!important}',
      '.in-academy .hdr .who .xpbar small{font-size:13px!important}',
      '.in-academy .h1{font-size:clamp(1.5rem,2.6vw,2rem)!important;letter-spacing:-.02em;margin-bottom:16px}',
      '.in-academy .mtitle{font-size:clamp(1.5rem,2.8vw,2.1rem)!important}',
      '.in-academy .cbody h2{font-size:clamp(1.3rem,2.4vw,1.6rem)!important}',
      // Couleurs pleines (couleur du module), formes douces, sans dégradé.
      '.in-academy .feat .blob,.in-academy .pc2 .star,.in-academy .banner .c1,.in-academy .banner .c2,.in-academy .cover::before,.in-academy .cover .dots,.in-academy .feat .stack,.in-academy .pc2 .dots3{display:none!important}',
      '.in-academy .h1{font-weight:400!important;font-size:clamp(2rem,3.4vw,3rem)!important;letter-spacing:-.03em!important;margin:6px 0 20px!important}',
      '.in-academy .search{border-radius:18px!important;box-shadow:none!important;border:1px solid var(--line)}',
      // Puces de modules : pastel plein
      '.in-academy .chip{background:var(--soft)!important;color:#15151C!important;border:0!important;border-radius:999px!important}',
      '.in-academy .chip .ci{background:rgba(255,255,255,.65)!important;color:var(--deep)!important}',
      '.in-academy .chip i{background:rgba(255,255,255,.75)!important;color:#15151C!important}',
      // Prochaine session : carte pleine à la couleur du module
      '.in-academy .feat{background:var(--deep)!important;color:#fff!important;border:0!important;border-radius:28px!important;box-shadow:none!important;min-height:230px}',
      '.in-academy .feat h3{color:#fff!important;font-weight:400!important;font-size:clamp(1.6rem,2.6vw,2.2rem)!important;letter-spacing:-.02em;max-width:none!important}',
      '.in-academy .feat .tag{color:#fff!important;opacity:.78!important}',
      '.in-academy .feat .illus{background:rgba(255,255,255,.14)!important;color:#fff!important}',
      '.in-academy .startbar{background:rgba(255,255,255,.14)!important;color:#fff!important;border-radius:18px!important}',
      '.in-academy .play{background:#fff!important;color:var(--deep)!important}',
      // Tuiles de progression : pastel plein
      '.in-academy .pc2{background:var(--soft)!important;color:#15151C!important;border:0!important;border-radius:22px!important;box-shadow:none!important}',
      '.in-academy .pc2 .ib{display:grid!important;place-items:center;width:40px!important;height:40px!important;background:rgba(255,255,255,.7)!important;color:var(--deep)!important;border-radius:50%!important;margin-bottom:22px!important}',
      '.in-academy .pc2 .pbar{background:rgba(255,255,255,.6)!important}',
      '.in-academy .pc2 .pbar i{background:var(--deep)!important}',
      '.in-academy .pc2 .ft{color:#15151C!important;opacity:.8}',
      // Sessions et calendrier
      '.in-academy .item{border-radius:20px!important;box-shadow:none!important;border:1px solid var(--line);transition:transform .2s ease,box-shadow .2s ease}',
      '.in-academy .item:hover{transform:translateY(-2px)}',
      '.in-academy .item .thumb{width:52px!important;height:52px!important;background:var(--soft)!important;color:var(--deep)!important;border-radius:50%!important}',
      // Sessions : le numéro seul, plus d'icône de module répétée sur chaque ligne.
      '.in-academy .item[data-s] .thumb svg{display:none}',
      '.in-academy .item[data-s] .thumb b{position:static!important;font-size:18px!important;font-weight:600!important;opacity:1!important;font-variant-numeric:tabular-nums}',
      '.in-academy .item .pc{color:var(--deep)!important}',
      '.in-academy .item.dark{background:#101A33!important;color:#fff!important;border:0}',
      '.in-academy .cal{border-radius:22px!important;box-shadow:none!important;border:1px solid var(--line)}',
      '.in-academy .cal .today{background:var(--ink)!important}',
      // Page module : en-tête plein à la couleur du module
      '.in-academy .mgrid>div:first-child{background:var(--deep);color:#fff;border-radius:28px;padding:30px 32px 32px;position:sticky;top:20px}',
      '.in-academy .mgrid>div:first-child>span{color:#fff!important;opacity:.75;font-weight:500!important}',
      '.in-academy .mtitle{color:#fff!important;font-weight:400!important;font-size:clamp(2rem,3.4vw,3rem)!important;letter-spacing:-.03em!important}',
      '.in-academy .mdesc{color:#fff!important;opacity:.85}',
      '.in-academy .mcta{background:#fff!important;color:var(--deep)!important;border-radius:16px!important;box-shadow:none!important}',
      '.in-academy .metas,.in-academy .meta{color:#fff!important;opacity:.9}',
      '.in-academy .meta .rbtn{background:rgba(255,255,255,.14)!important;color:#fff!important;box-shadow:none!important}',
      // Leçon : couleur du module, sans barre latérale
      '.in-academy .lesson .lkick2,.in-academy .lesson .lmeta,.in-academy .lesson>.lkick{color:var(--deep)!important}',
      '.in-academy .lq{border:0!important;border-radius:22px!important;background:color-mix(in srgb,var(--soft) 45%,var(--surface))!important;padding:22px 24px!important}',
      '.in-academy .lq .opt{border:0!important;border-radius:14px!important}',
      '.in-academy .lqh{color:var(--deep)!important}',
      '.in-academy .lrecap{border:0!important;border-radius:22px!important;background:var(--soft)!important;color:#15151C}',
      '.in-academy .lrecap h2{color:#15151C}',
      '.in-academy .lw .widget{border:0!important;border-radius:22px!important;background:color-mix(in srgb,var(--soft) 30%,var(--surface))!important}',
      '.in-academy .lcur li.cur>button{background:color-mix(in srgb,var(--soft) 55%,var(--surface))!important}',
      '.in-academy .lsecs a.on{background:color-mix(in srgb,var(--soft) 55%,var(--surface))!important;color:var(--ink)!important}',
      '.in-academy .lprog i{background:var(--deep)!important}',
      // Aucune barre de couleur sur le côté gauche des cartes : la couleur
      // passe par le fond (teinte de la carte) ou une pastille.
      '.in-academy .lq,.in-academy .toc a{border-left:0!important}',
      '.in-academy .wsv::before{display:none!important}',
      '.in-academy .wsv{background:color-mix(in srgb,var(--c) 12%,var(--surface))!important;border-color:transparent!important}',
      // Sombre : pastels assombris, texte clair
      'html.in-academy[data-theme="dark"] .chip,html.in-academy[data-theme="dark"] .pc2,html.in-academy[data-theme="dark"] .lrecap{background:#000!important;color:#F2F2F5!important}',
      'html.in-academy[data-theme="dark"] .chip i,html.in-academy[data-theme="dark"] .chip .ci,html.in-academy[data-theme="dark"] .pc2 .ib{background:rgba(255,255,255,.1)!important;color:#F2F2F5!important}',
      'html.in-academy[data-theme="dark"] .pc2 .ft,html.in-academy[data-theme="dark"] .lrecap h2{color:#F2F2F5!important}',
      'html.in-academy[data-theme="dark"] .item .thumb{background:#000!important;color:color-mix(in srgb,var(--deep) 40%,#fff)!important}',
      'html.in-academy[data-theme="dark"] .lq,html.in-academy[data-theme="dark"] .lw .widget,html.in-academy[data-theme="dark"] .lcur li.cur>button,html.in-academy[data-theme="dark"] .lsecs a.on{background:#000!important}',
      'html.in-academy[data-theme="dark"] .item .pc,html.in-academy[data-theme="dark"] .lqh,html.in-academy[data-theme="dark"] .lesson .lkick2{color:color-mix(in srgb,var(--deep) 40%,#fff)!important}',
      '.in-academy .story-in{max-width:680px}',
    ].join('');
    document.head.appendChild(skin);
    // Même police que l'accueil de l'Academy (Outfit), Inter en repli.
    var fonte = document.createElement('link');
    fonte.rel = 'stylesheet';
    fonte.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap';
    document.head.appendChild(fonte);
    var police = document.createElement('style');
    police.textContent = 'html.in-academy body,html.in-academy button,html.in-academy input,html.in-academy textarea{font-family:"Outfit","Inter",system-ui,sans-serif}'
      + 'html.in-academy .lesson h1,html.in-academy .mtitle,html.in-academy .h1{font-weight:500!important;letter-spacing:-.03em}';
    document.head.appendChild(police);
    // Plus de fenêtre « Cours interactif / Mode cartes » à chaque session :
    // on démarre dans le dernier mode choisi ; le bouton de mode de la
    // session permet toujours d'en changer.
    document.addEventListener('DOMContentLoaded', function () {
      if (typeof window.chooseMode !== 'function') return;
      window.chooseMode = function (s) {
        var pref = (window.st && window.st.pref) || 'course';
        try { if (typeof window.hideTerm === 'function') window.hideTerm(); } catch (e) {}
        if (pref === 'cards') window.openSession(s); else window.go2({ v: 'course', s: s.key });
      };
    });
  }

  // L'app change de thème ou d'agent : on suit (même origine → événement storage).
  window.addEventListener('storage', function (e) {
    if (e.key === 'fo-theme') document.documentElement.setAttribute('data-theme', theme());
    if (e.key === 'fo-user') location.reload();
  });

  // ── window.claude de remplacement ──
  function api(method, body) {
    // Chaque formation a sa propre progression côté serveur.
    var base = cours === 'digitalview' ? '/api/formation/progress/' : '/api/formation/' + cours + '/progress/';
    return fetch(base + encodeURIComponent(uid), {
      method: method, credentials: 'same-origin', cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      if (!r.ok) { var e = new Error('HTTP ' + r.status); e.code = r.status >= 500 || r.status === 0 ? 'unavailable' : 'failed'; throw e; }
      return r.json();
    }, function () { var e = new Error('network'); e.code = 'unavailable'; throw e; });
  }
  var doc = {
    get: function () {
      return api('GET').then(function (d) {
        var st = d && d.state;
        return { exists: !!st, data: function () { return st; } };
      });
    },
    set: function (state) {
      return api('PUT', {
        state: state,
        name: moi && moi.name || '',
        // Nombre de leçons du parcours (variable globale de la formation),
        // pour que la vue d'équipe affiche « X / N ».
        total: typeof window.TOTAL === 'number' ? window.TOTAL : null,
      });
    },
  };
  // La formation définit initSync() mais ne l'appelle jamais : sans ce
  // lancement, la progression restait sur l'appareil. Page chargée (le
  // script de la formation a tourné), on démarre la synchronisation.
  // Les versions récentes l'appellent elles-mêmes : on ne la relance que
  // si elle n'a pas démarré (statut resté « local » sans référence).
  document.addEventListener('DOMContentLoaded', function () {
    var s = window.sync;
    if (s && (s.ref || s.status !== 'local')) return;
    if (typeof window.initSync === 'function') { try { window.initSync(); } catch (e) { /* reste en local */ } }
  });

  // Réglage d'accueil de la formation (CFG : salutation, initiales, synchro).
  // Il est écrit en dur dans l'artefact pour son autrice ; dans le tracker,
  // chacun voit son prénom et ses initiales. La formation déclare
  // « var CFG = {…} » : la propriété ci-dessous en garde la valeur (le
  // setter ignore l'affectation), sans toucher au code de la formation.
  var prenom = moi && moi.name ? String(moi.name).trim().split(/\s+/)[0] : '';
  var initiales = moi && moi.initials ? String(moi.initials).slice(0, 3)
    : (moi && moi.name ? String(moi.name).trim().split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase() : '');
  var monCfg = { hello: prenom ? 'Salut ' + prenom : 'Bonjour', initials: initiales, sync: true };
  try {
    Object.defineProperty(window, 'CFG', {
      configurable: false, enumerable: true,
      get: function () { return monCfg; },
      set: function (v) { if (v && typeof v === 'object') { for (var k in v) if (!(k in monCfg)) monCfg[k] = v[k]; } },
    });
  } catch (e) { /* navigateur ancien : la formation garde son réglage */ }

  window.claude = {
    use: function (quoi) {
      if (!uid) return Promise.resolve(null);       // pas d'agent identifié : local seulement
      if (quoi === 'user') return Promise.resolve({ id: function () { return Promise.resolve(uid); } });
      if (quoi === 'db') return Promise.resolve({ doc: function () { return doc; } });
      return Promise.resolve(null);
    },
  };
})();
