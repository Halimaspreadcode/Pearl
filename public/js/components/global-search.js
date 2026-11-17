// ── BARRE DE COMMANDE (recherche globale) ─────────────────────
// Un seul champ, dans la barre du haut, pour tout trouver et tout faire :
//   · tickets SN et CI (numéro, titre, FO, BO, domaine, commentaires…) ;
//   · pages du menu, actions (nouveau ticket, thème, périmètre…) ;
//   · personnes (FO, Back Office) et observations.
//
// Pensé pour la vitesse au clavier :
//   Ctrl+K ou « / »  ouvrir      ↑ ↓  choisir      Entrée  ouvrir
//   Échap  fermer    Tab  groupe suivant
// Et pour la puissance :
//   > nouveau        seulement les actions
//   # 12345          seulement les tickets, par numéro
//   @ awa            seulement les personnes
//   p1, ouvert, breach, onhold, mes, sn, ci   filtres rapides (mots seuls)
//   statut:open prio:p2 fo:awa bo:diallo domaine:core sev:critical
// Les mots se combinent (ET), sans tenir compte des accents ni des majuscules,
// et l'ordre des résultats suit la pertinence : numéro exact d'abord.
//
// Le résultat choisi le plus souvent revient en tête quand le champ est vide
// (« Récents », gardés sur ce poste seulement).
(function () {
  'use strict';
  const MAX_TICKETS = 8, MAX_OTHER = 5, RECENT_KEY = 'fo-cmd-recent';
  const norm = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const escH = s => (typeof esc === 'function' ? esc(String(s == null ? '' : s)) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const CLOS = t => t.status === 'Resolved' || t.status === 'Closed';
  const breached = t => !CLOS(t) && t.sla_status !== 'On Hold' && typeof t.time_left_ms === 'number' && t.time_left_ms < 0;
  const me = () => (window.TeamIdentity && TeamIdentity.user && TeamIdentity.user.name) || (typeof currentUser !== 'undefined' && currentUser && currentUser.name) || '';

  // ── Icônes (traits fins, 16 px) ──
  const I = {
    ticket: '<path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/>',
    page: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 9h16"/>',
    action: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    bo: '<path d="M4 20V8l8-4 8 4v12"/><path d="M9 20v-6h6v6"/>',
    obs: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    filter: '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  };
  const ico = n => `<svg class="cmd-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${I[n] || I.page}</svg>`;

  // ── Mise en évidence des mots trouvés ──
  function surligner(txt, mots) {
    let h = escH(txt);
    if (!mots.length) return h;
    const n = norm(txt), marques = [];
    mots.forEach(m => { if (!m) return; let i = n.indexOf(m); while (i >= 0) { marques.push([i, i + m.length]); i = n.indexOf(m, i + m.length); } });
    if (!marques.length) return h;
    marques.sort((a, b) => a[0] - b[0]);
    let out = '', pos = 0;
    marques.forEach(([a, b]) => { if (a < pos) return; out += escH(txt.slice(pos, a)) + '<mark>' + escH(txt.slice(a, b)) + '</mark>'; pos = b; });
    return out + escH(txt.slice(pos));
  }

  // ── Lecture de la requête : mode, filtres, mots libres ──
  const CLES = { statut: 'status', status: 'status', s: 'status', prio: 'priority', priorite: 'priority', p: 'priority', sev: 'severity', severite: 'severity',
    fo: 'fo', bo: 'bo', domaine: 'domain', domain: 'domain', d: 'domain', pays: 'site', site: 'site', type: 'type' };
  const STATUTS = { open: 'Open', ouvert: 'Open', encours: 'In Progress', progress: 'In Progress', inprogress: 'In Progress', hold: 'On Hold', onhold: 'On Hold', attente: 'On Hold', resolved: 'Resolved', resolu: 'Resolved', closed: 'Closed', clos: 'Closed', ferme: 'Closed' };
  function lire(qRaw) {
    let q = String(qRaw || '').trim(), mode = '';
    if (/^[>#@]/.test(q)) { mode = q[0]; q = q.slice(1).trim(); }
    const f = {}, mots = [], chips = [];
    q.split(/\s+/).filter(Boolean).forEach(tok => {
      const kv = /^([a-zé]+):(.+)$/i.exec(tok);
      const t = norm(tok);
      if (kv && CLES[norm(kv[1])]) {
        const k = CLES[norm(kv[1])], v = norm(kv[2]);
        if (k === 'status') { f.status = STATUTS[v.replace(/\s/g, '')] || kv[2]; chips.push('statut : ' + f.status); }
        else if (k === 'priority') { f.priority = /^p?\d$/.test(v) ? 'P' + v.replace('p', '') : kv[2]; chips.push('priorité : ' + f.priority); }
        else if (k === 'site') { f.site = v.startsWith('c') ? 'ci' : 'sn'; chips.push(f.site.toUpperCase()); }
        else { f[k] = v; chips.push(kv[1] + ' : ' + kv[2]); }
        return;
      }
      if (/^p[1-4]$/.test(t)) { f.priority = t.toUpperCase(); chips.push('priorité ' + f.priority); return; }
      if (['breach', 'depasse', 'depassement', 'retard'].includes(t)) { f.breach = true; chips.push('SLA dépassé'); return; }
      if (['ouvert', 'ouverts', 'open', 'actif', 'actifs'].includes(t)) { f.open = true; chips.push('non clos'); return; }
      if (['onhold', 'hold', 'attente'].includes(t)) { f.status = 'On Hold'; chips.push('statut : On Hold'); return; }
      if (['mes', 'moi', 'mine'].includes(t) && me()) { f.fo = norm(me()); chips.push('mes tickets'); return; }
      if ((t === 'sn' || t === 'ci') && mode !== '>') { f.site = t; chips.push(t.toUpperCase()); return; }
      mots.push(t);
    });
    return { mode, f, mots, chips, brut: q };
  }

  // ── Tickets : filtres puis pertinence ──
  function tickets(r) {
    const f = r.f, out = [];
    ['sn', 'ci'].forEach(site => {
      if (f.site && f.site !== site) return;
      (state[site] || []).forEach(t => {
        if (f.status && t.status !== f.status) return;
        if (f.open && CLOS(t)) return;
        if (f.priority && String(t.priority || '').toUpperCase() !== f.priority) return;
        if (f.severity && !norm(t.severity).startsWith(f.severity)) return;
        if (f.fo && !norm(t.fo_owner).includes(f.fo)) return;
        if (f.bo && !norm(t.bo_handling).includes(f.bo)) return;
        if (f.domain && !norm(t.domain).includes(f.domain)) return;
        if (f.type && !norm(t.type).includes(f.type)) return;
        if (f.breach && !breached(t)) return;
        let score = 0;
        const num = norm([t.sn_tt, t.imoc_tt].filter(Boolean).join(' ')), titre = norm(t.title);
        const reste = norm([t.fo_owner, t.assigned_to, t.domain, t.bo_handling, t.root_cause, t.comments, t.update_action, t.status, t.severity].filter(Boolean).join(' '));
        for (const m of r.mots) {
          let s = 0;
          if (num.split(' ').includes(m)) s = 100;
          else if (num.includes(m)) s = 70;
          else if (new RegExp('(^|\\W)' + m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(titre)) s = 40;
          else if (titre.includes(m)) s = 25;
          else if (reste.includes(m)) s = 10;
          if (!s) return;             // chaque mot doit être trouvé quelque part
          score += s;
        }
        if (!r.mots.length && !Object.keys(f).length) return;
        if (breached(t)) score += 3;  // à pertinence égale, l'urgent d'abord
        if (!CLOS(t)) score += 2;
        out.push({ t, site, score });
      });
    });
    out.sort((a, b) => b.score - a.score || String(b.t.open_date || '').localeCompare(String(a.t.open_date || '')));
    return out;
  }

  // ── Pages du menu, lues dans la barre latérale (respecte les profils) ──
  function pages() {
    return [...document.querySelectorAll('.sidebar .nav-item')].filter(el => {
      if (el.hidden || el.closest('[hidden]')) return false;
      return getComputedStyle(el).display !== 'none';
    }).map(el => {
      const lab = (el.querySelector('.nav-item-label') || el).textContent.trim();
      const grp = el.closest('.sidebar-group');
      const sec = grp && grp.previousElementSibling && grp.previousElementSibling.classList.contains('sidebar-section') ? grp.previousElementSibling.textContent.trim() : '';
      return { label: lab, sub: sec, run: () => el.click() };
    }).filter(p => p.label);
  }

  // ── Actions ──
  function actions() {
    const A = [];
    const add = (label, sub, mots, run, ok = true) => { if (ok) A.push({ label, sub, mots, run }); };
    add('Nouveau ticket SN', 'Créer un ticket dans le tracker Dakar', 'creer ajouter new ticket incident sn dakar', () => openNewTicket('sn'), typeof openNewTicket === 'function');
    add('Nouveau ticket CI', 'Créer un ticket dans le tracker Abidjan', 'creer ajouter new ticket incident ci abidjan', () => openNewTicket('ci'), typeof openNewTicket === 'function');
    add('Périmètre : Global', 'Voir SN et CI ensemble', 'global tous pays perimetre', () => setActiveCountry('ALL'), typeof setActiveCountry === 'function');
    add('Périmètre : Sénégal (SN)', 'Ne voir que Dakar', 'senegal dakar sn pays perimetre', () => setActiveCountry('SN'), typeof setActiveCountry === 'function');
    add('Périmètre : Côte d\'Ivoire (CI)', 'Ne voir qu\'Abidjan', 'cote ivoire abidjan ci pays perimetre', () => setActiveCountry('CI'), typeof setActiveCountry === 'function');
    add('Changer de thème', 'Clair ou sombre', 'theme sombre clair dark light nuit', () => toggleTheme(), typeof toggleTheme === 'function');
    add(window.FoSky && FoSky.actif() ? 'Ciel en arrière-plan : désactiver' : 'Ciel en arrière-plan : activer', 'Fond animé selon l\'heure, ou fond uni', 'ciel fond nuages etoiles arriere plan decor sky', () => FoSky.basculer(), !!window.FoSky);
    add('Replier ou déplier le menu', 'Ctrl+B', 'menu barre laterale replier deplier sidebar', () => toggleSidebarRail(), typeof toggleSidebarRail === 'function');
    add('Exporter le daily en Excel', 'Rapport du jour', 'export excel daily rapport quotidien telecharger', () => exportDailyExcel(), typeof exportDailyExcel === 'function');
    add('Mon profil', 'Nom, rôle, préférences', 'profil compte moi identite', () => openUserModal(), typeof openUserModal === 'function');
    add('Se déconnecter', 'Fermer la session', 'deconnexion logout quitter', () => window.teamLogout(), typeof window.teamLogout === 'function' && !!(window.TeamIdentity && TeamIdentity.actif));
    return A;
  }

  // Correspondance souple pour les libellés courts (pages, actions) :
  // chaque mot doit être le début d'un mot du libellé, ou y figurer.
  function souple(label, extra, mots) {
    if (!mots.length) return 1;
    const hay = norm(label + ' ' + (extra || '')), debuts = hay.split(/[^a-z0-9]+/);
    let s = 0;
    for (const m of mots) {
      if (debuts.some(w => w.startsWith(m))) s += norm(label).startsWith(m) ? 30 : 20;
      else if (hay.includes(m)) s += 8;
      else return 0;
    }
    return s;
  }

  function personnes(r) {
    const fo = ((state.config && state.config.fo_list) || []).map(n => ({ label: n, sub: 'Front Office', kind: 'user', run: () => trackerFiltre({ fo: n }) }));
    const bo = (state.boList || []).map(b => ({ label: b.name, sub: ['Back Office', b.phone].filter(Boolean).join(' · '), kind: 'bo', run: () => navigateToBoTickets(b.name) }));
    return [...fo, ...bo].map(p => ({ ...p, score: souple(p.label, p.sub, r.mots) })).filter(p => p.score && r.mots.length).sort((a, b) => b.score - a.score);
  }

  // ── Construction des groupes ──
  function groupes(r) {
    const G = [];
    const vide = !r.mots.length && !Object.keys(r.f).length;
    if (vide && !r.mode) return accueil();
    if (r.mode === '>' || (!r.mode && r.mots.length)) {
      const a = actions().map(x => ({ ...x, score: souple(x.label, x.mots, r.mots) })).filter(x => x.score).sort((a, b) => b.score - a.score);
      if (a.length) G.push({ titre: 'Actions', items: a.slice(0, r.mode ? 12 : 3).map(x => ({ ic: 'action', titre: x.label, sous: x.sub, run: x.run, hint: 'Lancer' })) });
    }
    if (!r.mode && r.mots.length) {
      const p = pages().map(x => ({ ...x, score: souple(x.label, x.sub, r.mots) })).filter(x => x.score).sort((a, b) => b.score - a.score);
      if (p.length) G.push({ titre: 'Pages', items: p.slice(0, 4).map(x => ({ ic: 'page', titre: x.label, sous: x.sub, run: x.run, hint: 'Ouvrir' })) });
    }
    if (!r.mode || r.mode === '#') {
      const tk = tickets(r);
      if (tk.length) {
        const items = tk.slice(0, MAX_TICKETS).map(({ t, site }) => ({
          ic: 'ticket', ticket: t, site,
          titre: t.title || '(sans titre)', num: t.sn_tt || t.imoc_tt || '—',
          run: () => navigateToTicket(site, t.id), hint: 'Ouvrir',
        }));
        if (tk.length > MAX_TICKETS || Object.keys(r.f).length) items.push({ ic: 'filter', titre: `Voir les ${tk.length} tickets dans le tracker`, sous: r.chips.join(' · ') || 'Recherche : ' + r.mots.join(' '), run: () => trackerFiltre(r), hint: 'Filtrer', voirTout: true });
        G.push({ titre: `Tickets · ${tk.length}`, items });
      }
    }
    if (!r.mode || r.mode === '@') {
      const pp = personnes(r);
      if (pp.length) G.push({ titre: 'Personnes', items: pp.slice(0, MAX_OTHER).map(x => ({ ic: x.kind, titre: x.label, sous: x.sub, run: x.run, hint: 'Ses tickets' })) });
    }
    if (!r.mode && r.mots.length) {
      const ob = (state.observations || []).filter(o => r.mots.every(m => norm([o.observations, o.source, o.status, o.priority].join(' ')).includes(m))).slice(0, MAX_OTHER);
      if (ob.length) G.push({ titre: 'Observations', items: ob.map(o => ({ ic: 'obs', titre: (o.observations || '—').slice(0, 90), sous: [o.source, o.status, o.priority].filter(Boolean).join(' · '), run: () => { const n = document.querySelector('.nav-item[data-page="observations"]'); if (n) n.click(); }, hint: 'Ouvrir' })) });
    }
    return G;
  }

  // Champ vide : récents, filtres prêts à l'emploi, actions courantes.
  function accueil() {
    const G = [], rec = recents();
    if (rec.length) G.push({ titre: 'Récents', items: rec.map(x => ({ ic: 'clock', titre: x.titre, sous: x.sous, run: () => rejouer(x), hint: 'Ouvrir' })) });
    const nb = r => tickets(lire(r)).length;
    const raccourcis = [
      ['Mes tickets ouverts', 'mes ouvert', !!me()], ['Tickets P1 ouverts', 'p1 ouvert', true], ['En dépassement SLA', 'breach', true], ['En attente (On Hold)', 'onhold', true],
    ].filter(x => x[2]).map(([t, q]) => ({ ic: 'filter', titre: t, sous: q, compte: nb(q), run: () => { saisir(q); }, hint: 'Filtrer', garder: true }));
    G.push({ titre: 'Filtres rapides', items: raccourcis });
    G.push({ titre: 'Actions', items: actions().slice(0, 3).map(x => ({ ic: 'action', titre: x.label, sous: x.sub, run: x.run, hint: 'Lancer' })) });
    return G;
  }

  // ── Récents (sur ce poste) ──
  function recents() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, 4); } catch { return []; } }
  function memoriser(it) {
    if (it.garder || it.voirTout) return;
    const x = it.ticket ? { k: 't:' + it.site + ':' + it.ticket.id, titre: (it.num ? it.num + ' · ' : '') + it.titre, sous: 'Ticket ' + it.site.toUpperCase(), site: it.site, id: it.ticket.id }
      : { k: 'l:' + it.titre, titre: it.titre, sous: it.sous || '', label: it.titre };
    try { const l = recents().filter(r => r.k !== x.k); l.unshift(x); localStorage.setItem(RECENT_KEY, JSON.stringify(l.slice(0, 6))); } catch {}
  }
  function rejouer(x) {
    if (x.site) return navigateToTicket(x.site, x.id);
    const a = actions().find(y => y.label === x.label); if (a) return a.run();
    const p = pages().find(y => y.label === x.label); if (p) return p.run();
  }

  // ── Vers le tracker, filtré ──
  function trackerFiltre(r) {
    const f = r.f || r, site = f.site || ((state.sn || []).length >= (state.ci || []).length ? 'sn' : 'ci');
    const nav = document.querySelector(`.nav-item[data-page="${site}"]`);
    if (nav) nav.click(); else if (typeof renderPage === 'function') renderPage(site);
    setTimeout(() => {
      const set = (id, v) => { const el = document.getElementById(`${site}-${id}`); if (!el || v == null) return; if (el.tagName === 'SELECT') { const o = [...el.options].find(o => norm(o.value) === norm(v)); if (o) el.value = o.value; } else el.value = v; };
      set('filter-status', f.status); set('filter-priority', f.priority);
      const texte = [...(r.mots || []), f.fo || '', f.bo || '', f.domain || ''].filter(Boolean).join(' ');
      set('search', texte);
      if (typeof filterTable === 'function') filterTable(site);
      if (typeof updateTrackerFilterBadges === 'function') updateTrackerFilterBadges(site);
    }, 80);
  }

  // ── Rendu et clavier ──
  let input, panel, items = [], sel = 0, ouvert = false;
  function rendu() {
    const r = lire(input.value), G = groupes(r);
    items = [];
    let h = '';
    if (r.chips.length) h += `<div class="cmd-chips">${r.chips.map(c => `<span>${escH(c)}</span>`).join('')}</div>`;
    G.forEach(g => {
      h += `<div class="cmd-gt">${escH(g.titre)}</div>`;
      g.items.forEach(it => {
        const i = items.length; items.push(it);
        if (it.ticket) {
          const t = it.ticket, pr = String(t.priority || '').toUpperCase();
          h += `<div class="cmd-it" data-i="${i}" role="option">${ico('ticket')}<div class="cmd-tx"><div class="cmd-t"><span class="cmd-num">${surligner(it.num, r.mots)}</span>${surligner(it.titre, r.mots)}</div>
            <div class="cmd-s">${pr ? `<span class="cmd-p cmd-${pr.toLowerCase()}">${escH(pr)}</span>` : ''}<span>${escH(t.status || '')}</span><span>${it.site.toUpperCase()}</span>${t.fo_owner ? `<span>${surligner(t.fo_owner, r.mots)}</span>` : ''}${breached(t) ? '<span class="cmd-br">SLA dépassé</span>' : ''}</div></div><kbd>${it.hint}</kbd></div>`;
        } else {
          h += `<div class="cmd-it${it.voirTout ? ' cmd-all' : ''}" data-i="${i}" role="option">${ico(it.ic)}<div class="cmd-tx"><div class="cmd-t">${surligner(it.titre, r.mots)}${it.compte != null ? `<span class="cmd-n">${it.compte}</span>` : ''}</div>${it.sous ? `<div class="cmd-s"><span>${escH(it.sous)}</span></div>` : ''}</div><kbd>${it.hint || ''}</kbd></div>`;
        }
      });
    });
    if (!items.length) h += `<div class="cmd-vide">Rien trouvé pour « ${escH(input.value.trim())} ».<br><small>Essaie un numéro de ticket, un nom, ou un filtre comme <b>p1 ouvert</b> ou <b>statut:onhold</b>.</small></div>`;
    h += `<div class="cmd-ft"><span><kbd>↑</kbd><kbd>↓</kbd> choisir</span><span><kbd>↵</kbd> ouvrir</span><span><kbd>Échap</kbd> fermer</span><span class="cmd-tips"><b>&gt;</b> actions · <b>#</b> numéro · <b>@</b> personne · <b>p1</b> · <b>ouvert</b> · <b>breach</b> · <b>mes</b> · <b>fo:</b>nom</span></div>`;
    panel.innerHTML = h;
    sel = Math.min(sel, Math.max(0, items.length - 1));
    marquer();
  }
  function marquer() {
    panel.querySelectorAll('.cmd-it').forEach(el => el.classList.toggle('on', +el.dataset.i === sel));
    const el = panel.querySelector(`.cmd-it[data-i="${sel}"]`); if (el) el.scrollIntoView({ block: 'nearest' });
  }
  function lancer(i) {
    const it = items[i]; if (!it) return;
    memoriser(it);
    if (!it.garder) { input.value = ''; fermer(); }
    try { it.run(); } catch (e) { console.error('[recherche]', e); }
  }
  function saisir(q) { input.value = q; sel = 0; rendu(); input.focus(); }
  function ouvrir() { if (!input) return; if (!ouvert) { ouvert = true; document.body.classList.add('cmd-open'); sel = 0; rendu(); } input.focus(); }
  function fermer() { if (!input) return; ouvert = false; document.body.classList.remove('cmd-open'); input.blur(); }

  function monter() {
    input = document.getElementById('cmd-input'); panel = document.getElementById('cmd-panel');
    if (!input || !panel) return;
    input.addEventListener('focus', ouvrir);
    input.addEventListener('input', () => { sel = 0; if (!ouvert) ouvrir(); else rendu(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); marquer(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); marquer(); }
      else if (e.key === 'Enter') { e.preventDefault(); lancer(sel); }
      else if (e.key === 'Escape') { e.preventDefault(); if (input.value) { input.value = ''; rendu(); } else fermer(); }
      else if (e.key === 'Tab' && items.length) {
        // Tab : premier élément du groupe suivant.
        e.preventDefault();
        const els = [...panel.querySelectorAll('.cmd-gt, .cmd-it')];
        const pos = els.findIndex(el => el.classList.contains('cmd-it') && +el.dataset.i === sel);
        const next = els.slice(pos + 1).find((el, k, arr) => el.classList.contains('cmd-gt') && arr[k + 1] && arr[k + 1].classList.contains('cmd-it'));
        const cible = next ? els[els.indexOf(next) + 1] : panel.querySelector('.cmd-it');
        if (cible) { sel = +cible.dataset.i; marquer(); }
      }
    });
    panel.addEventListener('mousedown', e => e.preventDefault());   // garde le focus dans le champ
    panel.addEventListener('click', e => { const it = e.target.closest('.cmd-it'); if (it) lancer(+it.dataset.i); });
    panel.addEventListener('mousemove', e => { const it = e.target.closest('.cmd-it'); if (it && +it.dataset.i !== sel) { sel = +it.dataset.i; marquer(); } });
    document.addEventListener('mousedown', e => { if (ouvert && !e.target.closest('.tb-search')) fermer(); });
    const btn = document.getElementById('cmd-open-mobile'); if (btn) btn.addEventListener('click', ouvrir);
  }
  document.addEventListener('keydown', e => {
    const tag = (e.target && e.target.tagName) || '';
    const champ = /INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ouvert ? fermer() : ouvrir(); }
    else if (e.key === '/' && !champ) { e.preventDefault(); ouvrir(); }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', monter); else monter();

  // Compatibilité : d'autres écrans appellent encore ces noms.
  window.openGlobalSearch = ouvrir;
  window.closeGlobalSearch = fermer;
  window.globalSearch = q => { saisir(q); };
  window.cmdSearch = { lire, tickets };
})();

// Ouvre le tracker SN ou CI (celui qui a le plus de tickets de ce BO), filtré sur lui.
function navigateToBoTickets(boName) {
  const snCount = (state.sn || []).filter(t => (t.bo_handling || '').includes(boName)).length;
  const ciCount = (state.ci || []).filter(t => (t.bo_handling || '').includes(boName)).length;
  const tracker = (ciCount > snCount) ? 'ci' : 'sn';
  const navEl = document.querySelector(`.nav-item[data-page="${tracker}"]`);
  if (navEl) navEl.click(); else renderPage(tracker);
  setTimeout(() => {
    const search = document.getElementById(`${tracker}-search`);
    if (search) { search.value = boName; filterTable(tracker); }
  }, 80);
}

function navigateToTicket(tracker, id) {
  const navEl = document.querySelector(`.nav-item[data-page="${tracker}"]`);
  if (navEl) navEl.click(); else renderPage(tracker);
  // Fiche ouverte une fois les lignes affichées.
  setTimeout(() => openEditTicket(tracker, id), 80);
}
