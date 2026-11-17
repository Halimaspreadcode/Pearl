// ══════════════════════════════════════════════════════════════
// ANNONCES — publication vers toute l'équipe
// ══════════════════════════════════════════════════════════════
const ANN_NIVEAUX = {
  info: {
    mot: 'Info', c: 'var(--accent)', cc: '#E8F0FE',
    ico: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  },
  warning: {
    mot: 'Important', c: '#E65100', cc: '#FEF7E0',
    ico: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  },
  critical: {
    mot: 'Critique', c: 'var(--red)', cc: 'var(--red-l)',
    ico: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  },
};

let _annNiveau = 'info';
// « panel » : dans la cloche ; « banner » : bande en haut, pour tous.
let _annFormat = 'panel';

function choisirFormat(f) {
  _annFormat = f === 'banner' ? 'banner' : 'panel';
  document.querySelectorAll('.gann-chip[data-display]').forEach(b =>
    b.classList.toggle('is-on', b.dataset.display === _annFormat));
  majApercuAnnonce();
}

function ouvrirCompositeur() {
  const el = document.getElementById('gann-compose');
  if (!el) return;
  el.hidden = false;
  document.getElementById('ann-title')?.focus();
}

function fermerCompositeur() {
  const el = document.getElementById('gann-compose');
  if (!el) return;
  el.hidden = true;
  ['ann-title', 'ann-body'].forEach(id => {
    const f = document.getElementById(id);
    if (f) f.value = '';
  });
  choisirNiveau('info');
  choisirFormat('panel');
  majApercuAnnonce();
  annMsg('', true);
}

function choisirNiveau(niveau) {
  _annNiveau = ANN_NIVEAUX[niveau] ? niveau : 'info';
  document.querySelectorAll('.gann-chip[data-level]').forEach(b =>
    b.classList.toggle('is-on', b.dataset.level === _annNiveau));
  majApercuAnnonce();
}

// Aperçu du rendu final : publier sans voir ce que l'équipe recevra
// est la première cause d'annonce mal formulée.
function majApercuAnnonce() {
  const title = document.getElementById('ann-title')?.value.trim() || '';
  const body  = document.getElementById('ann-body')?.value || '';
  const cnt   = document.getElementById('ann-count');
  if (cnt) cnt.textContent = String(body.length);

  const wrap = document.getElementById('gann-preview');
  const card = document.getElementById('gann-preview-card');
  if (!wrap || !card) return;

  if (!title && !body.trim()) { wrap.hidden = true; return; }
  wrap.hidden = false;
  const n = ANN_NIVEAUX[_annNiveau];
  card.style.setProperty('--gann-c', n.c);
  // Aperçu de la bande telle qu'elle s'affichera en haut de l'écran.
  if (_annFormat === 'banner' && typeof annBannerHtml === 'function') {
    card.innerHTML = `<span class="gann-preview-tag">Bande · ${n.mot}</span>` + annBannerHtml({ id: 'preview', title, body, level: _annNiveau }, true);
    return;
  }
  card.innerHTML = `
    <span class="gann-preview-tag">${n.mot}</span>
    ${title ? `<div class="gann-preview-t">${esc(title)}</div>` : ''}
    ${body.trim() ? `<div class="gann-preview-b">${esc(body)}</div>` : ''}`;
}

async function renderAnnoncesAdmin() {
  const el = document.getElementById('ann-list');
  if (!el) return;
  choisirNiveau(_annNiveau);

  el.innerHTML = '<div class="gann-empty">Chargement…</div>';
  let list = [];
  try {
    const res = await fetch(`${API}/api/announcements`);
    list = res.ok ? await res.json() : [];
  } catch {
    el.innerHTML = '<div class="gann-empty">Serveur injoignable.</div>';
    return;
  }

  const total = document.getElementById('ann-total');
  if (total) total.textContent = list.length || '';

  if (!list.length) {
    el.innerHTML = `<div class="gann-empty">
      Aucune annonce en cours.<br>Expired announcements disappear on their own.
    </div>`;
    return;
  }

  el.innerHTML = list.map(a => {
    const n = ANN_NIVEAUX[a.level] || ANN_NIVEAUX.info;
    return `<div class="gann-card" style="--gann-c:${n.c};--gann-cc:${n.cc}">
      <div class="gann-dot">${n.ico}</div>
      <div class="gann-card-main">
        <div class="gann-card-t">${esc(a.title)}</div>
        ${a.body ? `<div class="gann-card-b">${esc(a.body)}</div>` : ''}
        <div class="gann-card-meta">
          ${a.display === 'banner' ? '<b>Bande</b> · ' : ''}${esc(n.mot)} · ${esc(a.author || 'Administration')} ·
          published ${esc(fmtDt(a.created_at))} · expires ${esc(fmtDt(a.expires_at))}
        </div>
      </div>
      <button class="gann-btn-text" type="button" onclick="supprimerAnnonce('${a.id}')">Retirer</button>
    </div>`;
  }).join('');
}

// ── Rappels automatiques : catalogue et interrupteurs ──────────
// L'admin ne rédige pas ces messages, il choisit lesquels existent.
// Les regrouper par catégorie évite une liste de dix lignes plates
// où l'on ne retrouve pas la règle qu'on cherche.
function renderReglesRappels() {
  const el = document.getElementById('nfr-list');
  if (!el || typeof NF_RULES === 'undefined') return;

  const actives = NF_RULES.filter(r => nfRuleOn(r.id)).length;
  const total = document.getElementById('nfr-total');
  if (total) total.textContent = `${actives}/${NF_RULES.length}`;

  const tons = {
    info: { c: 'var(--accent)', cc: '#E8F0FE' },
    due:  { c: '#E65100',       cc: '#FEF7E0' },
    late: { c: 'var(--red)',    cc: 'var(--red-l)' },
  };

  // Ordre du catalogue conservé : il suit le déroulé d'une journée
  // (progression, tickets, formation, tâches, passation).
  const groupes = [];
  NF_RULES.forEach(r => {
    const g = groupes.find(x => x.cat === r.cat);
    (g ? g.rules : (groupes.push({ cat: r.cat, rules: [] }), groupes.at(-1).rules)).push(r);
  });

  el.innerHTML = groupes.map(g => `
    <div class="gann-rule-grp">${esc(g.cat)}</div>
    ${g.rules.map(r => {
      const on = nfRuleOn(r.id);
      const t = tons[r.tone] || tons.info;
      return `<div class="gann-card gann-rule ${on ? 'is-on' : 'is-off'}"
                   style="--gann-c:${t.c};--gann-cc:${t.cc}">
        <div class="gann-dot">${NF_ICO.shift}</div>
        <div class="gann-card-main">
          <div class="gann-card-t">${esc(r.label)}</div>
          <div class="gann-rule-freq">${esc(r.freq)}</div>
          <span class="gann-rule-state">${on ? 'Actif' : 'Disabled'}</span>
        </div>
        <button class="gann-sw" type="button" role="switch" aria-checked="${on}"
                aria-label="${esc(r.label)}"
                onclick="basculerRegleRappel('${r.id}')"></button>
      </div>`;
    }).join('')}`).join('');
}

async function basculerRegleRappel(id) {
  const rules = { ...(state.config?.nf_rules || {}) };
  rules[id] = !nfRuleOn(id);

  // On n'envoie que la clé modifiée : PUT /api/config fusionne avec
  // l'existant, réémettre toute la config exposerait à écraser un
  // réglage changé entre-temps par un autre admin.
  const res = await fetch(`${API}/api/config`, {
    method: 'PUT',
    headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
    credentials: 'same-origin',
    body: JSON.stringify({ nf_rules: rules }),
  });
  if (!res.ok) { toast('Failed to save the reminder', 'error'); return; }

  state.config = { ...state.config, nf_rules: rules };
  renderReglesRappels();
  // La cloche doit refléter le changement sans rechargement.
  if (window.NF) NF.render();
  const r = NF_RULE_BY_ID[id];
  toast(rules[id]
    ? `Reminder re-enabled — “${r?.label || id}”`
    : `Reminder disabled — “${r?.label || id}”`, 'success');
}

function annMsg(text, ok) {
  const el = document.getElementById('ann-msg');
  if (!el) return;
  el.textContent = text;
  el.style.color = ok ? 'var(--ok-fg)' : 'var(--red)';
}

async function publierAnnonce() {
  const title = document.getElementById('ann-title')?.value.trim() || '';
  const body  = document.getElementById('ann-body')?.value.trim() || '';
  // Le niveau vient des chips, plus d'un <select> : lire l'ancien id
  // publierait tout en « info » sans que rien ne le signale.
  const level = _annNiveau;
  const ttl   = Number(document.getElementById('ann-ttl')?.value || 7);

  if (!title) { annMsg('The title is required.', false); return; }

  const res = await fetch(`${API}/api/announcements`, {
    method: 'POST',
    headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
    credentials: 'same-origin',
    body: JSON.stringify({
      title, body, level, display: _annFormat, expires_days: ttl,
      author: (typeof currentUser !== 'undefined' && currentUser?.name) || 'Administration',
    }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) { annMsg(d.error || 'Publishing failed.', false); return; }

  fermerCompositeur();
  toast(_annFormat === 'banner' ? 'Banner published — shown at the top for everyone' : 'Announcement published — visible to the whole team', 'success');
  renderAnnoncesAdmin();
  if (typeof AnnBanner !== 'undefined') AnnBanner.load();
  // L'auteur voit sa propre annonce sans attendre le prochain sondage.
  if (window.NF) NF.loadAnnonces();
}

async function supprimerAnnonce(id) {
  const res = await fetch(`${API}/api/announcements/${id}`, {
    method: 'DELETE',
    headers: AdminSession.headers(),
    credentials: 'same-origin',
  });
  if (!res.ok) { annMsg('Removal failed.', false); return; }
  annMsg('Announcement removed.', true);
  renderAnnoncesAdmin();
  if (window.NF) NF.loadAnnonces();
  if (typeof AnnBanner !== 'undefined') AnnBanner.load();
}

