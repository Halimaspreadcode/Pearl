// ── BOÎTE À IDÉES : le tableau blanc ─────────────────────────
// Page autonome (/idees), ouverte dans l'application (iframe, ?embed=1) ou
// par lien de partage (?k=<clé>). Parcours :
//   1. « New idea » : un grand post-it s'ouvre, on y écrit en manuscrit ;
//   2. « Stick it » : le post-it rapetisse et suit le curseur ;
//   3. un clic sur le tableau le colle, avec un tampon « Up for vote ! » ;
//   4. chacun peut aimer les post-its des autres et parcourir le classement.
// Les mouvements suivent prefers-reduced-motion.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const KEY = (new URLSearchParams(location.search)).get('k') || '';
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NOTE = 200;                 // taille d'un post-it sur le tableau
  let BOARD = { w: 1800, h: 1200 };
  let ideas = [], scale = 1, fit = true, placing = null, me = '';

  // Identifiant de navigateur : un like par personne, ses post-its à soi.
  function voter() {
    let v = '';
    try { v = localStorage.getItem('fo-voter') || ''; } catch (e) {}
    if (!/^[a-zA-Z0-9-]{8,64}$/.test(v)) {
      v = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
      try { localStorage.setItem('fo-voter', v); } catch (e) {}
    }
    return v;
  }
  try { me = (JSON.parse(localStorage.getItem('fo-user') || 'null') || {}).name || ''; } catch (e) {}

  function api(path, opts = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json', 'X-Voter': voter() }, opts.headers || {});
    if (KEY) headers['X-Ideas-Key'] = KEY;
    try { const t = sessionStorage.getItem('fo-admin-token') || localStorage.getItem('fo-admin-token'); if (t) headers['X-Admin-Token'] = t; } catch (e) {}
    return fetch(path, Object.assign({}, opts, { headers, credentials: 'same-origin' }));
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function toast(msg) {
    const t = $('ib-toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 2600);
  }

  // ── Échelle : le tableau entier tient dans la page, ou taille réelle ──
  function layout() {
    const stage = $('ib-stage'), board = $('ib-board');
    const w = stage.clientWidth - 2, h = stage.clientHeight - 2;
    // Ajusté : le tableau entier tient dans le cadre, sans barre de
    // défilement. « Actual size » sert à lire de près, et là il défile.
    scale = fit ? Math.max(.35, Math.min(1, w / BOARD.w, h / BOARD.h)) : 1;
    stage.classList.toggle('is-fit', fit);
    board.style.width = BOARD.w + 'px';
    board.style.height = BOARD.h + 'px';
    board.style.transform = `scale(${scale})`;
    stage.style.setProperty('--bh', (BOARD.h * scale) + 'px');
    $('ib-fit-l').textContent = fit ? 'Actual size' : 'Fit to screen';
  }

  // ── Rendu ──
  function noteHtml(i) {
    const who = i.author ? '— ' + esc(i.author) : 'Anonymous';
    return `<article class="ib-note c-${esc(i.color)}${i.mine ? ' is-mine' : ''}" data-id="${esc(i.id)}"
        style="left:${i.x}px;top:${i.y}px;--r:${i.rot || 0}deg" tabindex="0">
      <span class="ib-tape" aria-hidden="true"></span>
      <p class="ib-note-t">${esc(i.text)}</p>
      <footer>
        <span class="ib-who${i.author ? '' : ' is-anon'}">${who}</span>
        <button class="ib-like${i.liked ? ' on' : ''}" type="button" aria-pressed="${i.liked}" aria-label="Like (${i.likes})">
          <svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 21l-7.8-7.5-1-1.1a5.5 5.5 0 0 1 7.8-7.8l1 1.1 1-1.1a5.5 5.5 0 0 1 7.8 7.8l-1 1.1z"/></svg>
          <b>${i.likes}</b></button>
      </footer>
      ${i.can_edit ? `<button class="ib-del" type="button" aria-label="Remove this note" title="Remove">×</button>` : ''}
    </article>`;
  }
  function render() {
    const board = $('ib-board');
    board.querySelectorAll('.ib-note').forEach(n => n.remove());
    board.insertAdjacentHTML('beforeend', ideas.map(noteHtml).join(''));
    $('ib-empty').hidden = ideas.length > 0;
    const likes = ideas.reduce((s, i) => s + i.likes, 0);
    $('ib-count').textContent = `${ideas.length} idea${ideas.length === 1 ? '' : 's'} · ${likes} like${likes === 1 ? '' : 's'}`;
    renderTop();
  }
  function renderTop() {
    const top = ideas.slice().sort((a, b) => b.likes - a.likes || b.created_at.localeCompare(a.created_at)).slice(0, 10);
    $('ib-top-list').innerHTML = top.length ? top.map(i => `<li><button type="button" data-id="${esc(i.id)}">
        <span class="ib-top-n">${i.likes} ♥</span><span class="ib-top-t">${esc(i.text)}</span>
        <span class="ib-top-w">${i.author ? esc(i.author) : 'Anonymous'}</span></button></li>`).join('')
      : '<li class="ib-top-empty">No idea yet.</li>';
  }

  async function load(quiet) {
    try {
      const r = await api('/api/ideas');
      if (r.status === 401) { if (!quiet) showLocked(); return; }
      const d = await r.json();
      BOARD = d.board || BOARD;
      // Pendant un glisser, on ne redessine pas sous le doigt.
      if (dragging) return;
      ideas = d.ideas || [];
      layout(); render();
    } catch (e) { if (!quiet) toast('Could not load the board.'); }
  }
  function showLocked() {
    $('ib-empty').hidden = false;
    $('ib-empty').innerHTML = '<div class="ib-empty-note">This board is private.<br><small>Open it from Pearl, or ask for a share link.</small></div>';
    $('ib-new-btn').hidden = true;
  }

  // ── Écrire ──
  let color = 'yellow', signed = false;
  function openPad() {
    $('ib-pad-ov').hidden = false;
    $('ib-pad').dataset.color = color;
    $('ib-name').value = me;
    requestAnimationFrame(() => { $('ib-pad-ov').classList.add('on'); $('ib-text').focus(); });
  }
  function closePad() {
    $('ib-pad-ov').classList.remove('on');
    setTimeout(() => { $('ib-pad-ov').hidden = true; }, REDUCED ? 0 : 220);
  }
  $('ib-new-btn').onclick = openPad;
  $('ib-cancel').onclick = closePad;
  $('ib-pad-ov').addEventListener('mousedown', e => { if (e.target === $('ib-pad-ov')) closePad(); });
  $('ib-text').addEventListener('input', () => { $('ib-left').textContent = 280 - $('ib-text').value.length; });
  document.querySelectorAll('.ib-colors button').forEach(b => b.onclick = () => {
    color = b.dataset.c; $('ib-pad').dataset.color = color;
    document.querySelectorAll('.ib-colors button').forEach(x => x.classList.toggle('on', x === b));
  });
  document.querySelectorAll('.ib-sign button').forEach(b => b.onclick = () => {
    signed = b.dataset.s === 'me';
    document.querySelectorAll('.ib-sign button').forEach(x => x.classList.toggle('on', x === b));
    $('ib-name').hidden = !signed || !!me;
    if (signed && !me) $('ib-name').focus();
  });
  if (me) $('ib-sign-me').textContent = 'Sign as ' + me.split(' ')[0];

  // « Stick it » : le bloc rétrécit, puis le post-it suit le curseur.
  $('ib-pad').addEventListener('submit', e => {
    e.preventDefault();
    const text = $('ib-text').value.trim();
    if (!text) { $('ib-text').focus(); return; }
    const author = signed ? (me || $('ib-name').value.trim()) : '';
    if (signed && !author) { $('ib-name').hidden = false; $('ib-name').focus(); toast('Add your name, or post anonymously.'); return; }
    placing = { text, color, signed, author, rot: Math.round((Math.random() * 8 - 4) * 10) / 10 };
    $('ib-pad').classList.add('fly');
    setTimeout(() => {
      closePad(); $('ib-pad').classList.remove('fly');
      startPlacing();
    }, REDUCED ? 0 : 380);
  });

  let ghost = null;
  function startPlacing() {
    ghost = document.createElement('div');
    ghost.className = `ib-note ib-ghost c-${placing.color}`;
    ghost.style.setProperty('--r', placing.rot + 'deg');
    ghost.innerHTML = `<span class="ib-tape"></span><p class="ib-note-t">${esc(placing.text)}</p>`;
    $('ib-board').appendChild(ghost);
    $('ib-place-hint').hidden = false;
    document.body.classList.add('is-placing');
    // Position de départ : centre de la zone visible.
    const st = $('ib-stage');
    moveGhost((st.scrollLeft + st.clientWidth / 2) / scale - NOTE / 2, (st.scrollTop + 200) / scale);
  }
  function moveGhost(x, y) {
    if (!ghost) return;
    ghost.style.left = Math.max(0, Math.min(BOARD.w - NOTE, x)) + 'px';
    ghost.style.top = Math.max(0, Math.min(BOARD.h - NOTE, y)) + 'px';
  }
  function stopPlacing() {
    if (ghost) ghost.remove();
    ghost = null; placing = null;
    $('ib-place-hint').hidden = true;
    document.body.classList.remove('is-placing');
  }
  function boardPoint(e) {
    const r = $('ib-board').getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  }
  $('ib-board').addEventListener('pointermove', e => {
    if (!placing) return;
    const p = boardPoint(e); moveGhost(p.x - NOTE / 2, p.y - 30);
  });
  $('ib-board').addEventListener('click', async e => {
    if (!placing) return;
    const p = boardPoint(e);
    const x = Math.round(Math.max(0, Math.min(BOARD.w - NOTE, p.x - NOTE / 2)));
    const y = Math.round(Math.max(0, Math.min(BOARD.h - NOTE, p.y - 30)));
    const body = { text: placing.text, color: placing.color, signed: placing.signed, author: placing.author, x, y, rot: placing.rot };
    stopPlacing();
    try {
      const r = await api('/api/ideas', { method: 'POST', body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Error');
      ideas.push(d); render();
      $('ib-text').value = ''; $('ib-left').textContent = 280;
      stamp(d.id);
    } catch (err) { toast(err.message || 'Could not stick the note.'); }
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (placing) stopPlacing();
    else if (!$('ib-pad-ov').hidden) closePad();
    else if (!$('ib-share-ov').hidden) closeShare();
  });

  // Tampon « Up for vote ! » sur le post-it qui vient d'être collé.
  function stamp(id) {
    const n = document.querySelector(`.ib-note[data-id="${id}"]`);
    if (!n) return;
    n.classList.add('just-stuck');
    const s = document.createElement('span');
    s.className = 'ib-stamp'; s.textContent = 'Up for vote!';
    n.appendChild(s);
    setTimeout(() => { s.remove(); n.classList.remove('just-stuck'); }, REDUCED ? 1500 : 2600);
  }

  // ── Aimer, retirer, déplacer ──
  let dragging = null;
  $('ib-board').addEventListener('click', async e => {
    const like = e.target.closest('.ib-like');
    const del = e.target.closest('.ib-del');
    const note = e.target.closest('.ib-note');
    if (!note || placing) return;
    const id = note.dataset.id;
    if (like) {
      const r = await api(`/api/ideas/${id}/like`, { method: 'POST' });
      if (!r.ok) return toast('Could not like.');
      const d = await r.json();
      ideas = ideas.map(i => i.id === id ? d : i); render();
      if (d.liked) burst(id);
    } else if (del) {
      if (!(await askRemove(ideas.find(i => i.id === id)))) return;
      const r = await api(`/api/ideas/${id}`, { method: 'DELETE' });
      if (!r.ok) return toast('Could not remove.');
      // Le post-it se décolle avant de disparaître.
      const n = document.querySelector(`.ib-note[data-id="${id}"]`);
      if (n && !REDUCED) { n.classList.add('peel'); await new Promise(ok => setTimeout(ok, 520)); }
      ideas = ideas.filter(i => i.id !== id); render();
      toast('Idea removed.');
    }
  });
  // Confirmation intégrée : le post-it concerné, un mot bienveillant, et
  // « Garder » comme choix par défaut (Entrée, Échap ou clic à côté).
  function askRemove(idee) {
    return new Promise(done => {
      const ov = $('ib-del-ov');
      const note = $('ib-del-note');
      note.dataset.color = (idee && idee.color) || 'yellow';
      note.innerHTML = `<span>${esc((idee && idee.text) || '')}</span><small>${idee && idee.author ? '— ' + esc(idee.author) : 'Anonymous'}</small>`;
      const fin = v => {
        ov.classList.remove('on'); ov.hidden = true;
        document.removeEventListener('keydown', clavier, true);
        $('ib-del-yes').onclick = $('ib-del-no').onclick = ov.onclick = null;
        done(v);
      };
      const clavier = e => { if (e.key === 'Escape') { e.stopPropagation(); fin(false); } };
      $('ib-del-yes').onclick = () => fin(true);
      $('ib-del-no').onclick = () => fin(false);
      ov.onclick = e => { if (e.target === ov) fin(false); };
      document.addEventListener('keydown', clavier, true);
      ov.hidden = false;
      requestAnimationFrame(() => ov.classList.add('on'));
      setTimeout(() => $('ib-del-no').focus(), 40);
    });
  }
  function burst(id) {
    const n = document.querySelector(`.ib-note[data-id="${id}"] .ib-like`);
    if (!n || REDUCED) return;
    const b = document.createElement('span'); b.className = 'ib-burst'; b.textContent = '+1';
    n.appendChild(b); setTimeout(() => b.remove(), 900);
  }
  // Ses propres post-its se déplacent au glisser.
  $('ib-board').addEventListener('pointerdown', e => {
    const note = e.target.closest('.ib-note');
    if (!note || placing || e.target.closest('button')) return;
    const i = ideas.find(x => x.id === note.dataset.id);
    if (!i || !i.can_edit) return;
    const p = boardPoint(e);
    dragging = { note, i, dx: p.x - i.x, dy: p.y - i.y, moved: false };
    note.setPointerCapture(e.pointerId);
    note.classList.add('is-drag');
  });
  $('ib-board').addEventListener('pointermove', e => {
    if (!dragging) return;
    const p = boardPoint(e);
    dragging.moved = true;
    dragging.i.x = Math.round(Math.max(0, Math.min(BOARD.w - NOTE, p.x - dragging.dx)));
    dragging.i.y = Math.round(Math.max(0, Math.min(BOARD.h - NOTE, p.y - dragging.dy)));
    dragging.note.style.left = dragging.i.x + 'px';
    dragging.note.style.top = dragging.i.y + 'px';
  });
  $('ib-board').addEventListener('pointerup', async () => {
    if (!dragging) return;
    const { note, i, moved } = dragging; dragging = null;
    note.classList.remove('is-drag');
    if (moved) await api(`/api/ideas/${i.id}`, { method: 'PUT', body: JSON.stringify({ x: i.x, y: i.y }) });
  });

  // ── Classement ──
  $('ib-top-btn').onclick = () => {
    const open = $('ib-top').hidden;
    $('ib-top').hidden = !open; $('ib-top-btn').setAttribute('aria-expanded', String(open));
  };
  $('ib-top-x').onclick = () => { $('ib-top').hidden = true; $('ib-top-btn').setAttribute('aria-expanded', 'false'); };
  $('ib-top-list').addEventListener('click', e => {
    const b = e.target.closest('button[data-id]'); if (!b) return;
    const n = document.querySelector(`.ib-note[data-id="${b.dataset.id}"]`);
    if (!n) return;
    n.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center', inline: 'center' });
    n.classList.remove('pulse'); void n.offsetWidth; n.classList.add('pulse');
  });

  // ── Taille ──
  $('ib-fit-btn').onclick = () => { fit = !fit; layout(); };
  addEventListener('resize', layout);

  // ── Partage (admin) ──
  async function shareInfo() {
    try {
      const r = await api('/api/ideas-share');
      if (!r.ok) return;
      $('ib-share-btn').hidden = false;
      return (await r.json()).key;
    } catch (e) {}
  }
  const shareUrl = k => k ? `${location.origin}/idees?k=${encodeURIComponent(k)}` : '';
  async function setShare(body) {
    const r = await api('/api/ideas-share', { method: 'POST', body: JSON.stringify(body || {}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `error ${r.status}`);
    $('ib-share-url').value = shareUrl(d.key) || 'Link disabled';
    return d.key;
  }
  // La fenêtre de partage partage le style du bloc-notes (.ib-pad-ov) :
  // elle n'apparaît qu'avec la classe « on ». Sans elle, elle restait
  // invisible mais couvrait le tableau, qui ne répondait plus à rien.
  function openShare() {
    const ov = $('ib-share-ov');
    ov.hidden = false;
    requestAnimationFrame(() => ov.classList.add('on'));
    setTimeout(() => $('ib-share-url').select(), 60);
  }
  function closeShare() {
    const ov = $('ib-share-ov');
    ov.classList.remove('on');
    ov.hidden = true;
  }
  $('ib-share-ov').addEventListener('click', e => { if (e.target === e.currentTarget) closeShare(); });
  $('ib-share-btn').onclick = async () => {
    const btn = $('ib-share-btn');
    btn.disabled = true;
    try {
      let k = await shareInfo();
      if (!k) k = await setShare({});
      $('ib-share-url').value = shareUrl(k) || 'Link disabled';
      openShare();
    } catch (e) { toast('Sharing is unavailable: ' + (e.message || 'error')); }
    btn.disabled = false;
  };
  // Copier : le presse-papiers peut être refusé dans un cadre (iframe) ;
  // on retombe alors sur la sélection du champ et la copie classique.
  $('ib-share-copy').onclick = async () => {
    const inp = $('ib-share-url');
    try { await navigator.clipboard.writeText(inp.value); toast('Link copied'); return; } catch (e) {}
    inp.focus(); inp.select();
    try { if (document.execCommand('copy')) { toast('Link copied'); return; } } catch (e) {}
    toast('Press Ctrl+C to copy the selected link');
  };
  $('ib-share-new').onclick = async () => {
    try { await setShare({}); toast('New link created — the old one no longer works.'); } catch (e) { toast(e.message); }
  };
  $('ib-share-off').onclick = async () => {
    try { await setShare({ disable: true }); toast('Link disabled.'); } catch (e) { toast(e.message); }
  };
  $('ib-share-x').onclick = closeShare;

  layout();
  load();
  shareInfo();
  // Le tableau vit : les post-its des collègues apparaissent sans recharger.
  setInterval(() => { if (!document.hidden && !placing) load(true); }, 15000);
})();
