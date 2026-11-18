// Page d'accueil : mouvement façon Framer, sans librairie.
//   · titre qui apparaît mot par mot ;
//   · révélations au défilement (.reveal) ;
//   · parallaxe au défilement (data-speed) et à la souris (data-mouse, data-depth) ;
//   · aperçu du produit incliné qui se redresse en descendant ;
//   · récit collant qui change d'écran, phrase qui s'éclaire mot à mot ;
//   · lueur qui suit le curseur sur les tuiles, compteurs animés.
// Tout est coupé si l'utilisateur a demandé moins de mouvement.
(function () {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  // ── Titre, mot par mot ──
  const title = $('#title');
  // Traduits d'un bloc avant d'être découpés en mots (core/i18n.js).
  if (window.pearTranslate) ['#title', '#scrub'].forEach(sel => { const el = $(sel); if (el) window.pearTranslate(el); });
  if (title) {
    let i = 0;
    const wrap = node => {
      [...node.childNodes].forEach(n => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(part => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
            const s = document.createElement('span');
            s.className = 'w'; s.textContent = part; s.style.transitionDelay = `${0.08 + i++ * 0.07}s`;
            frag.appendChild(s);
          });
          node.replaceChild(frag, n);
        } else if (n.nodeType === 1) wrap(n);
      });
    };
    wrap(title);
    requestAnimationFrame(() => requestAnimationFrame(() => title.classList.add('in')));
  }

  // ── Bandeau des métiers (dupliqué pour une boucle sans couture) ──
  // Pastille de couleur devant chaque métier (palette de l'application).
  const COLORS = ['#93AFCB', '#9EE6D5', '#F2A65A', '#6DD58C', '#E58A7D', '#C4A7E7'];
  fetch('/api/platform/packs').then(r => r.json()).then(list => {
    const extra = ['Logistique', 'Accueil et services', 'Hôtellerie', 'Transport', 'Facility management'];
    const items = list.map(p => [p.label, p.id]).concat(extra.map(l => [l, 'generic']));
    const html = items.map(([l, id], i) => `<a class="chip" href="/signup?pack=${encodeURIComponent(id)}" style="color:inherit;text-decoration:none"><b style="width:9px;height:9px;border-radius:50%;background:${COLORS[i % COLORS.length]};display:inline-block"></b>${esc(l)}</a>`).join('');
    const track = $('#track');
    if (track) track.innerHTML = html + html;
    const foot = $('#foot-packs');
    if (foot) foot.innerHTML = list.map(p => `<li><a href="/signup?pack=${encodeURIComponent(p.id)}">${esc(p.label)}</a></li>`).join('');
  }).catch(() => {});

  // ── Révélations ──
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
  $$('.reveal').forEach(el => (reduce ? el.classList.add('in') : io.observe(el)));

  // ── Compteurs ──
  const fmt = n => n.toLocaleString('fr-FR');
  const count = el => {
    const target = Number(el.dataset.count); if (!isFinite(target)) return;
    if (reduce || target === 0) { el.textContent = fmt(target); return; }
    const t0 = performance.now(), dur = 1400;
    const tick = t => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(Math.round(target * e));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  const ioCount = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { count(e.target); ioCount.unobserve(e.target); }
  }), { threshold: 0.6 });
  $$('[data-count]').forEach(el => ioCount.observe(el));

  // ── Récit collant : l'étape visible choisit l'écran ──
  const screens = $$('#story-mock .screen');
  const steps = $$('.story-step');
  const ioStory = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    const n = Number(e.target.dataset.screen);
    steps.forEach(s => s.classList.toggle('on', s === e.target));
    screens.forEach((s, i) => s.classList.toggle('on', i === n));
  }), { rootMargin: '-45% 0px -45% 0px' });
  steps.forEach(s => ioStory.observe(s));

  // ── Phrase qui s'éclaire mot à mot ──
  const scrub = $('#scrub');
  let scrubWords = [];
  if (scrub) {
    const out = [];
    scrub.childNodes.forEach(n => {
      const mint = n.nodeType === 1 && n.tagName === 'M';
      String(n.textContent).split(/(\s+)/).forEach(p => {
        if (!p) return;
        out.push(/^\s+$/.test(p) ? p : `<span${mint ? ' class="m"' : ''}>${esc(p)}</span>`);
      });
    });
    scrub.innerHTML = out.join('');
    scrubWords = [...scrub.querySelectorAll('span')];
  }

  // ── Lueur des tuiles ──
  $$('.tile').forEach(t => t.addEventListener('pointermove', e => {
    const r = t.getBoundingClientRect();
    t.style.setProperty('--mx', `${e.clientX - r.left}px`);
    t.style.setProperty('--my', `${e.clientY - r.top}px`);
  }));

  // ── Ouvrir un espace ──
  const go = $('#go');
  if (go) go.addEventListener('submit', e => {
    e.preventDefault();
    const v = $('#go-slug').value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^.*\/o\//, '').split(/[./?#\s]/)[0];
    if (v) location.href = '/o/' + encodeURIComponent(v);
    else $('#go-slug').focus();
  });
  const fo = $('#foot-open');
  if (fo) fo.addEventListener('click', e => { e.preventDefault(); window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); setTimeout(() => $('#go-slug').focus(), 500); });
  const y = $('#year'); if (y) y.textContent = new Date().getFullYear();

  // ── Boucle de défilement : barre, parallaxe, inclinaison, phrase ──
  const nav = $('#nav');
  const device = $('#device');
  const speedEls = $$('[data-speed]');
  let mouseX = 0, mouseY = 0, curX = 0, curY = 0;
  const mouseEls = $$('[data-mouse]'), depthEls = $$('[data-depth]');
  if (!reduce) window.addEventListener('pointermove', e => {
    mouseX = e.clientX / window.innerWidth - 0.5;
    mouseY = e.clientY / window.innerHeight - 0.5;
  }, { passive: true });

  let ticking = false;
  function frame() {
    ticking = false;
    const sy = window.scrollY, vh = window.innerHeight;
    if (nav) nav.classList.toggle('scrolled', sy > 12);
    if (reduce) return;

    // Parallaxe : décalage proportionnel à la distance au centre de l'écran.
    speedEls.forEach(el => {
      const r = el.parentElement.getBoundingClientRect();
      const off = (r.top + r.height / 2 - vh / 2) * Number(el.dataset.speed);
      el.style.transform = `translate3d(0, ${off.toFixed(1)}px, 0)` + (el.dataset.mouse ? ` translate3d(${(curX * el.dataset.mouse).toFixed(1)}px, ${(curY * el.dataset.mouse).toFixed(1)}px, 0)` : '');
    });

    // Aperçu : 22° d'inclinaison au départ, à plat après ~60 % d'écran.
    if (device) {
      const k = Math.min(1, Math.max(0, sy / (vh * 0.6)));
      device.style.setProperty('--tilt', `${(22 * (1 - k)).toFixed(2)}deg`);
      device.style.setProperty('--scale', (0.92 + 0.08 * k).toFixed(3));
    }

    // Phrase : les mots s'allument à mesure qu'elle remonte.
    if (scrub && scrubWords.length) {
      const r = scrub.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (r.height + vh * 0.35)));
      const on = Math.round(p * scrubWords.length);
      scrubWords.forEach((w, i) => w.classList.toggle('on', i < on));
    }
  }
  const request = () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } };
  window.addEventListener('scroll', request, { passive: true });
  window.addEventListener('resize', request);
  frame();

  // Souris : mouvement amorti (lerp) pour les halos et les pastilles.
  if (!reduce) {
    const loop = () => {
      curX += (mouseX - curX) * 0.06; curY += (mouseY - curY) * 0.06;
      mouseEls.forEach(el => {
        if (el.dataset.speed) return;  // déjà géré par la boucle de défilement
        el.style.transform = `translate3d(${(curX * el.dataset.mouse).toFixed(1)}px, ${(curY * el.dataset.mouse).toFixed(1)}px, 0)`;
      });
      depthEls.forEach(el => { el.style.transform = `translate3d(${(curX * el.dataset.depth).toFixed(1)}px, ${(curY * el.dataset.depth).toFixed(1)}px, 0)`; });
      if (Math.abs(mouseX - curX) > 0.001 || Math.abs(mouseY - curY) > 0.001) request();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
})();
