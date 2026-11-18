// ══════════════════════════════════════════════════════════════
// LANGUE DE L'INTERFACE (FR / EN)
//
// Les écrans ont été écrits dans deux langues mêlées : l'application
// d'origine en anglais (avec le vocabulaire d'un centre de supervision),
// les écrans récents en français. Plutôt que de réécrire chaque écran,
// une couche unique ramène tout ce qui s'affiche dans la langue choisie :
//   · textes visibles, attributs placeholder / title / aria-label ;
//   · au chargement, puis à chaque ajout dans la page (MutationObserver) ;
//   · alert(), confirm() et window.pearTr() pour les messages construits.
// Vocabulaire : i18n-fr.js (anglais → français) ; i18n-en.js (français →
// anglais), complété automatiquement par l'inverse du dictionnaire
// français : un terme corrigé d'un côté l'est des deux.
//
// Jamais traduit : champs de saisie, zones éditables, code, éléments
// marqués translate="no" ou .notranslate. La valeur d'une <option> sans
// attribut value est d'abord figée, pour que la traduction de son libellé
// ne change pas ce que le formulaire envoie.
//
// Choix de la langue : localStorage « pear-lang » (et cookie pear_lang),
// sinon la langue du navigateur. Bascule : tout élément [data-lang-switch].
// ══════════════════════════════════════════════════════════════
(function () {
  const LANGS = ['fr', 'en'];
  let lang = null;
  try { lang = localStorage.getItem('pear-lang'); } catch (e) {}
  if (!LANGS.includes(lang)) {
    const m = /(?:^|;\s*)pear_lang=(fr|en)/.exec(document.cookie || '');
    lang = m ? m[1] : (/^fr\b/i.test(navigator.language || 'fr') ? 'fr' : 'en');
  }
  window.PEAR_LANG = lang;
  window.PEAR_LOCALE = lang === 'en' ? 'en-GB' : 'fr-FR';
  document.documentElement.lang = lang;

  window.pearSetLang = function (l) {
    if (!LANGS.includes(l)) return;
    try { localStorage.setItem('pear-lang', l); } catch (e) {}
    document.cookie = `pear_lang=${l}; path=/; max-age=31536000; samesite=lax`;
    location.reload();
  };

  // Bascule FR | EN dans tout emplacement [data-lang-switch].
  function paintSwitches() {
    document.querySelectorAll('[data-lang-switch]:not([data-lang-ready])').forEach(el => {
      el.setAttribute('data-lang-ready', '');
      el.setAttribute('translate', 'no');
      el.classList.add('pear-lang');
      el.innerHTML = LANGS.map(l => `<button type="button" data-l="${l}" aria-pressed="${l === lang}" class="${l === lang ? 'on' : ''}">${l.toUpperCase()}</button>`).join('');
      el.addEventListener('click', e => { const b = e.target.closest('button[data-l]'); if (b && b.dataset.l !== lang) window.pearSetLang(b.dataset.l); });
    });
  }
  if (!document.getElementById('pear-lang-style')) {
    const st = document.createElement('style'); st.id = 'pear-lang-style';
    st.textContent = '.pear-lang{display:inline-flex;gap:2px;padding:2px;border-radius:999px;border:1px solid rgba(127,127,127,.25);vertical-align:middle}'
      + '.pear-lang button{border:0;background:none;color:inherit;opacity:.6;font:inherit;font-size:11.5px;font-weight:650;letter-spacing:.03em;padding:3px 8px;border-radius:999px;cursor:pointer}'
      + '.pear-lang button.on{opacity:1;background:rgba(127,127,127,.18)}';
    (document.head || document.documentElement).appendChild(st);
  }

  // Dictionnaire de la langue courante.
  let D = null;
  function dict() {
    if (D) return D;
    const all = window.PEAR_I18N || {};
    if (lang === 'fr') { D = all.fr || { exact: {}, patterns: [] }; return D; }
    const en = all.en || { exact: {}, patterns: [] };
    const exact = {};
    const fr = (all.fr && all.fr.exact) || {};
    // Inverse du français : « Ouvert » → « Open ». La première forme
    // anglaise rencontrée l'emporte ; i18n-en.js tranche les cas ambigus.
    // Les entrées français → français (jargon ramené au générique) ne
    // s'inversent pas : leur clé n'est pas de l'anglais.
    const FRK = /[À-ÿ’«»]|\b(le|la|les|des|du|de|et|pour|dans|avec|votre|une|un|sur|par|tous|onglet)\b/i;
    for (const k of Object.keys(fr)) { const v = fr[k]; if (typeof v === 'string' && !(v in exact) && v !== k && !FRK.test(k)) exact[v] = (en.exact && typeof en.exact[k] === 'string') ? en.exact[k] : k; }
    Object.assign(exact, en.exact || {});
    D = { exact, patterns: en.patterns || [] };
    return D;
  }
  const cache = new Map();

  // Traduction d'une chaîne (sans ses espaces de bord), ou null.
  function tr(s) {
    if (cache.has(s)) return cache.get(s);
    const d = dict();
    let out = null;
    if (Object.prototype.hasOwnProperty.call(d.exact, s)) out = d.exact[s];
    else {
      // Ponctuation finale tolérée : « Search… », « Name: », « Close. ».
      const m = /^(.*?)(\s*(?:…|\.\.\.|:|\.|\?|!))$/.exec(s);
      if (m && m[1] && Object.prototype.hasOwnProperty.call(d.exact, m[1])) {
        const p = m[2].trim();
        out = d.exact[m[1]] + (p === ':' || p === '?' || p === '!' ? (lang === 'fr' ? ` ${p}` : p) : m[2]);
      } else for (const [re, rep] of d.patterns) {
        if (re.test(s)) { out = s.replace(re, typeof rep === 'function' ? (...a) => rep(tr, ...a) : rep); break; }
      }
    }
    if (cache.size < 20000) cache.set(s, out);
    return out;
  }
  window.pearTr = s => { const v = String(s == null ? '' : s); const t = tr(v.trim()); return t == null ? v : v.replace(v.trim(), t); };

  const ATTRS = ['placeholder', 'title', 'aria-label', 'data-tip'];
  const SKIP = /^(SCRIPT|STYLE|CODE|PRE|NOSCRIPT|SVG|PATH)$/;

  function skipped(el) {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (SKIP.test(e.tagName) || e.isContentEditable || e.getAttribute('translate') === 'no' || e.classList.contains('notranslate')) return true;
    }
    return false;
  }

  const LETTRE = /[A-Za-zÀ-ÿ]/;
  function textNode(n) {
    const raw = n.nodeValue;
    if (!raw || !LETTRE.test(raw)) return;
    const core = raw.trim();
    if (!core || core.length > 600) return;
    const t = tr(core.replace(/\s+/g, ' '));
    if (t == null || t === core) return;
    const p = n.parentElement;
    if (!p || p.tagName === 'TEXTAREA' || skipped(p)) return;
    // <option> sans value : on fige la valeur d'origine avant de traduire.
    if (p.tagName === 'OPTION' && !p.hasAttribute('value')) p.setAttribute('value', p.value);
    n.nodeValue = raw.replace(core, t);
  }

  function element(el) {
    if (skipped(el)) return;
    for (const a of ATTRS) {
      const v = el.getAttribute && el.getAttribute(a);
      if (!v || !LETTRE.test(v)) continue;
      const t = tr(v.trim());
      if (t != null && t !== v) el.setAttribute(a, t);
    }
    if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type || '') && el.value) {
      const t = tr(el.value.trim()); if (t) el.value = t;
    }
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { textNode(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (skipped(root)) return; element(root); }
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.nodeType === 1 && (SKIP.test(n.tagName) || n.getAttribute('translate') === 'no') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) textNode(n); else element(n); }
  }
  window.pearTranslate = walk;

  // Lots de mutations traités au prochain rafraîchissement d'écran.
  let queue = new Set(), planned = false;
  function flush() {
    planned = false;
    const q = queue; queue = new Set();
    q.forEach(walk);
    paintSwitches();
  }
  const mo = new MutationObserver(ms => {
    for (const m of ms) {
      if (m.type === 'childList') m.addedNodes.forEach(n => queue.add(n));
      else queue.add(m.target);
    }
    if (!planned) { planned = true; requestAnimationFrame(flush); }
  });

  function start() {
    paintSwitches();
    walk(document.body);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    const t = tr(document.title); if (t) document.title = t;
    new MutationObserver(() => { const x = tr(document.title); if (x && x !== document.title) document.title = x; })
      .observe(document.querySelector('title') || document.head, { childList: true, characterData: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  // Les confirm() et alert() passent aussi par la traduction.
  const wrapDialog = name => { const f = window[name]; if (typeof f === 'function') window[name] = m => f.call(window, window.pearTr(m)); };
  wrapDialog('alert'); wrapDialog('confirm');
  const p = window.prompt; if (typeof p === 'function') window.prompt = (m, d) => p.call(window, window.pearTr(m), d);
})();
