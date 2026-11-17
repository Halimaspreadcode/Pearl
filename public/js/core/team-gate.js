/* Connexion d'équipe et identité (voir server/auth/team-gate.js et
   server/auth/identity.js).

   · Quand un mot de passe d'équipe est défini, l'API répond 401 avec
     l'en-tête X-Team-Auth à toute requête sans session : on affiche
     l'écran de connexion.
   · L'identité vient de la session (ID employé + code personnel), plus d'un
     choix fait dans le navigateur. Le mot de passe d'équipe ne donne que la
     consultation : une écriture répond 403 + X-Identity, et on propose la
     connexion par code. */
(function () {
  'use strict';
  var montre = false;
  var fetchOrig = window.fetch.bind(window);

  window.fetch = function () {
    return fetchOrig.apply(null, arguments).then(function (r) {
      if (r.status === 401 && r.headers.get('X-Team-Auth') === 'required') afficher(false);
      else if (r.status === 403 && r.headers.get('X-Identity') === 'required')
        afficher(true, 'To make changes, sign in with your Employee ID and personal code.');
      return r;
    });
  };

  function style() {
    if (document.getElementById('tg-style')) return;
    var s = document.createElement('style');
    s.id = 'tg-style';
    // Vraie page de connexion : plein écran, en deux parties — la marque à
    // gauche, le formulaire à droite. Même composant qu'avant (pas de
    // redirection, rien à charger) : la page s'affiche instantanément.
    s.textContent =
      '.tg-ov{position:fixed;inset:0;z-index:100000;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(380px,1fr);' +
      'font-family:Quicksand,"Segoe UI",system-ui,sans-serif;font-weight:500;background:#FFFFFF;color:#141518;animation:tg-in .25s ease}' +
      '@keyframes tg-in{from{opacity:0}to{opacity:1}}' +
      'html[data-theme="dark"] .tg-ov{background:#000;color:#F2F2F4}' +
      '.tg-side{position:relative;overflow:hidden;margin:14px;border-radius:28px;padding:44px 48px;display:flex;flex-direction:column;justify-content:space-between;' +
      'color:#fff;background:radial-gradient(120% 80% at 100% 0%,rgba(63,183,160,.55),transparent 55%),radial-gradient(90% 70% at 0% 100%,rgba(242,166,90,.45),transparent 60%),#111214}' +
      '.tg-brand{display:flex;align-items:center;gap:12px;font-weight:700;font-size:20px}' +
      '.tg-brand svg{width:34px;height:34px}' +
      '.tg-brand small{display:block;font-size:12px;font-weight:600;opacity:.6;letter-spacing:.04em}' +
      '.tg-hero{font-size:44px;line-height:1.05;font-weight:600;letter-spacing:-.03em;margin:0;max-width:520px}' +
      '.tg-hero em{font-style:normal;color:#9EE6D5}' +
      '.tg-feat{list-style:none;margin:28px 0 0;padding:0;display:flex;flex-direction:column;gap:14px;max-width:440px}' +
      '.tg-feat li{display:flex;gap:12px;align-items:flex-start;font-size:14.5px;line-height:1.4;opacity:.92}' +
      '.tg-feat i{flex:none;width:30px;height:30px;border-radius:10px;background:rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;font-style:normal;font-size:15px}' +
      '.tg-side-foot{font-size:12px;opacity:.55}' +
      '.tg-main{display:flex;align-items:center;justify-content:center;padding:32px;position:relative}' +
      '.tg-card{width:100%;max-width:380px}' +
      '.tg-card h1{font-size:32px;font-weight:600;letter-spacing:-.025em;margin:0 0 8px}' +
      '.tg-card p{font-size:14px;opacity:.65;margin:0 0 26px;line-height:1.5}' +
      '.tg-card label{display:block;font-size:12.5px;font-weight:700;margin:16px 0 7px;opacity:.75}' +
      '.tg-card input{width:100%;box-sizing:border-box;height:50px;padding:0 16px;border-radius:14px;font:500 15px Quicksand,system-ui,sans-serif;' +
      'border:1px solid rgba(20,24,32,.14);background:#fff;color:inherit;outline:none;transition:border-color .15s,box-shadow .15s}' +
      'html[data-theme="dark"] .tg-card input{background:#0B0B0D;border-color:rgba(255,255,255,.14)}' +
      '.tg-card input:focus{border-color:#4F6A85 !important;box-shadow:0 0 0 4px rgba(79,106,133,.16) !important;outline:none !important}' +
      '.tg-btn{width:100%;margin-top:24px;height:52px;border:0;border-radius:14px;background:#111214;color:#fff;' +
      'font:700 15px Quicksand,system-ui,sans-serif;cursor:pointer;transition:transform .1s,opacity .15s}' +
      'html[data-theme="dark"] .tg-btn{background:#F4F4F5;color:#111}' +
      '.tg-btn:hover{opacity:.9}.tg-btn:active{transform:scale(.99)}.tg-btn:disabled{opacity:.55;cursor:default}' +
      '.tg-lien{display:block;width:100%;background:none;border:0;color:inherit;opacity:.7;font:600 13px Quicksand,system-ui,sans-serif;margin-top:16px;cursor:pointer;' +
      'text-decoration:underline;text-underline-offset:3px;padding:0}' +
      '.tg-lien:hover{opacity:1}' +
      '.tg-err{color:#C2412D;font-size:13px;min-height:0;margin-top:10px;font-weight:600}.tg-err:empty{margin:0}' +
      '.tg-x{position:absolute;top:22px;right:24px;display:inline-flex;align-items:center;gap:6px;height:38px;padding:0 14px;border-radius:999px;' +
      'border:1px solid rgba(20,24,32,.12);background:transparent;font:600 13px Quicksand,system-ui,sans-serif;cursor:pointer;color:inherit}' +
      'html[data-theme="dark"] .tg-x{border-color:rgba(255,255,255,.16)}' +
      '.tg-logo{display:none}' +
      '@media(max-width:860px){.tg-ov{grid-template-columns:1fr;overflow:auto}.tg-side{min-height:auto;padding:26px;margin:10px 10px 0}' +
      '.tg-hero{font-size:28px}.tg-feat,.tg-side-foot{display:none}.tg-main{padding:24px 20px 40px;align-items:flex-start}}' +
      '@media(prefers-reduced-motion:reduce){.tg-ov{animation:none}}' +
      '.tg-ro{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:9999;display:flex;gap:10px;align-items:center;' +
      'background:var(--white,#fff);color:var(--dark,#1F2328);border:1px solid var(--line,#D0D7DE);border-radius:999px;' +
      'padding:7px 8px 7px 14px;font:600 12.5px Quicksand,system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.12)}' +
      '.tg-ro button{border:0;border-radius:999px;background:#111214;color:#fff;font-weight:600;padding:5px 12px;cursor:pointer;font-family:inherit}' +
      'html[data-theme="dark"] .tg-ro button{background:#F4F4F5;color:#111}';
    document.head.appendChild(s);
  }

  // personnel : formulaire ID + code. fermable : la page reste derrière
  // (session de consultation déjà ouverte), on peut annuler.
  function afficher(fermable, message) {
    if (montre) return;
    montre = true;
    var go = function () {
      style();
      var ov = document.createElement('div');
      ov.className = 'tg-ov' + (fermable ? ' soft' : '');
      ov.innerHTML =
        '<aside class="tg-side">' +
          '<div class="tg-brand"><svg viewBox="0 0 40 40" aria-hidden="true"><path d="M6 34A28 28 0 0 1 34 6" fill="none" stroke="#9EE6D5" stroke-width="4.5" stroke-linecap="round"/>' +
          '<path d="M13 34A21 21 0 0 1 34 13" fill="none" stroke="#9EE6D5" stroke-width="4.5" stroke-linecap="round" opacity=".7"/>' +
          '<path d="M20 34A14 14 0 0 1 34 20" fill="none" stroke="#9EE6D5" stroke-width="4.5" stroke-linecap="round" opacity=".45"/>' +
          '<circle cx="31" cy="31" r="4.5" fill="#F2A65A"/></svg><span>Pearl<small>FRONT OFFICE</small></span></div>' +
          '<div><h2 class="tg-hero">Every ticket, every shift, <em>one place.</em></h2>' +
          '<ul class="tg-feat"><li><i>⚡</i>Trackers SN, CI and global, with live SLA countdowns</li>' +
          '<li><i>✦</i>Your space: tasks, requests, score and quizzes</li>' +
          '<li><i>💡</i>Reports, academy and the team idea box</li></ul></div>' +
          '<div class="tg-side-foot">Pearl</div>' +
        '</aside>' +
        '<main class="tg-main">' +
        (fermable ? '<button type="button" class="tg-x" aria-label="Back">← Back</button>' : '') +
        '<form class="tg-card" autocomplete="on">' +
        '<div class="tg-logo">FO</div>' +
        '<h1>Sign in</h1>' +
        '<p class="tg-intro"></p>' +
        '<div class="tg-id"><label for="tg-id">Employee ID</label>' +
        '<input id="tg-id" name="username" autocomplete="username" placeholder="e.g. a00123456" spellcheck="false"></div>' +
        '<label for="tg-pw" class="tg-lbl"></label>' +
        '<input id="tg-pw" type="password" name="password" autocomplete="current-password" required>' +
        '<div class="tg-err" role="alert"></div>' +
        '<button class="tg-btn" type="submit">Sign in</button>' +
        '<button class="tg-lien" type="button"></button>' +
        '</form></main>';
      document.body.appendChild(ov);
      var form = ov.querySelector('form'), pw = ov.querySelector('#tg-pw'), id = ov.querySelector('#tg-id');
      var bloc = ov.querySelector('.tg-id'), lbl = ov.querySelector('.tg-lbl'), err = ov.querySelector('.tg-err');
      var lien = ov.querySelector('.tg-lien'), btn = ov.querySelector('.tg-btn'), intro = ov.querySelector('.tg-intro');
      var perso = true;
      var mode = function () {
        bloc.hidden = !perso;
        lbl.textContent = perso ? 'Personal code' : 'Team password';
        intro.textContent = message || (perso
          ? 'Use your Employee ID and the personal code your manager gave you. They sign your changes.'
          : 'The team password opens Pearl in view-only mode. To make changes, sign in with your personal code.');
        lien.textContent = perso ? 'View only, with the team password' : 'I have a personal code';
        // Sans mot de passe d'équipe, le lien « consulter seulement » ne mène à rien.
        lien.hidden = (fermable && !perso) || !(window.TeamIdentity && window.TeamIdentity.actif);
        err.textContent = '';
      };
      mode();
      lien.addEventListener('click', function () { perso = !perso; mode(); (perso ? id : pw).focus(); });
      var x = ov.querySelector('.tg-x');
      // « Plus tard » : on ne redemande pas à chaque chargement de cette
      // session ; la pastille « Sign in » reste là pour qui veut se connecter.
      if (x) x.addEventListener('click', function () { ov.remove(); montre = false; try { sessionStorage.setItem('tg-plus-tard', '1'); } catch (e) {} });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        btn.disabled = true; err.textContent = '';
        var corps = { password: pw.value };
        if (perso) corps.employeeId = id.value.trim();
        fetchOrig('/api/team/auth', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
        }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { r: r, j: j }; }); })
          .then(function (x) {
            if (x.r.ok && x.j.ok) { location.reload(); return; }
            err.textContent = x.j.error || 'Could not sign in.';
            btn.disabled = false; pw.select();
          })
          .catch(function () { err.textContent = 'Server unreachable.'; btn.disabled = false; });
      });
      (perso ? id : pw).focus();
    };
    if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
  }

  // Bandeau discret en consultation seule : on sait pourquoi rien ne
  // s'enregistre, et on peut se connecter d'un clic.
  function bandeauLecture() {
    var go = function () {
      if (document.querySelector('.tg-ro')) return;
      style();
      var b = document.createElement('div');
      b.className = 'tg-ro';
      b.innerHTML = '<span>View only</span><button type="button">Sign in</button>';
      b.querySelector('button').addEventListener('click', function () { afficher(true); });
      document.body.appendChild(b);
    };
    if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
  }

  // Identité de la session, lue au chargement. identity.js l'applique
  // (applyServerIdentity) dès qu'il est chargé, ou tout de suite s'il l'est.
  // `codes` : au moins un code personnel existe — la connexion par code
  // remplace alors le choix du nom. `exige` : écrire demande ce code.
  window.TeamIdentity = { actif: false, exige: false, codes: false, user: null, lecture: false, admin: false, pret: false };
  fetchOrig('/api/team/session', { credentials: 'same-origin', cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      window.TeamIdentity = { actif: !!j.actif, exige: !!j.exige, codes: !!j.codes, user: j.user || null,
        lecture: !!j.lecture, admin: !!j.admin, pret: true };
      if (j && j.actif && !j.ok) { afficher(false); return; }
      if (!j.user && !j.admin && (j.exige || (j.actif && j.lecture))) bandeauLecture();
      if (typeof window.applyServerIdentity === 'function') window.applyServerIdentity(window.TeamIdentity);
      // La barre dépend de qui l'on est (vue « Non connecté » comprise) :
      // on la redessine dès que la session est connue, quel que soit le mode.
      if (typeof window.applyNavMode === 'function') { try { window.applyNavMode(); } catch (e) {} }
    })
    .catch(function () { window.TeamIdentity.pret = true; if (typeof window.applyNavMode === 'function') { try { window.applyNavMode(); } catch (e) {} } });

  window.teamLogin = function () { afficher(true); };
  window.teamLogout = function () {
    try { localStorage.removeItem('fo-user'); } catch (e) {}
    return fetchOrig('/api/team/logout', { method: 'POST', credentials: 'same-origin' })
      .then(function () { location.reload(); });
  };
})();
