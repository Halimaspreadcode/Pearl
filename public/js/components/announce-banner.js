// ══════════════════════════════════════════════════════════════
// ANNONCES EN BANDE
//
// Une annonce publiée au format « Bande » (display: 'banner') s'affiche
// en pleine largeur en haut de la zone de contenu, pour tout le monde —
// FO, BO, observateurs, admin. Réservé aux grandes annonces : la cloche
// reste le canal ordinaire.
//
// Chacun peut fermer une bande ; le choix est mémorisé par annonce dans ce
// navigateur (confort, pas accusé de lecture). Elle disparaît d'elle-même
// à son expiration, puisque le serveur ne renvoie plus que les annonces
// en cours. Relue toutes les 2 minutes : une annonce publiée arrive sans
// rechargement.
// ══════════════════════════════════════════════════════════════
const ANN_BANNER_KEY = 'fo-banner-closed';

const ANN_BANNER_TONS = {
  info:     { bg: '#1A73E8', fg: '#FFFFFF', mot: 'Info' },
  warning:  { bg: '#E37400', fg: '#FFFFFF', mot: 'Important' },
  critical: { bg: '#C7000B', fg: '#FFFFFF', mot: 'Critical' },
};

// Rendu d'une bande. `apercu` : dans le compositeur admin, sans bouton de
// fermeture actif.
function annBannerHtml(a, apercu) {
  const t = ANN_BANNER_TONS[a.level] || ANN_BANNER_TONS.info;
  return `<div class="ann-band" role="${apercu ? 'presentation' : 'alert'}" style="--ab-bg:${t.bg};--ab-fg:${t.fg}">
    <svg class="ann-band-i" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>
    <div class="ann-band-txt">
      <span class="ann-band-tag">${esc(t.mot)}</span>
      <b class="ann-band-t">${esc(a.title || '')}</b>
      ${a.body ? `<span class="ann-band-b">${esc(a.body)}</span>` : ''}
    </div>
    <button type="button" class="ann-band-x" aria-label="Hide this announcement"
      ${apercu ? 'disabled' : `onclick="AnnBanner.close('${esc(a.id)}')"`}>×</button>
  </div>`;
}

// Pages en plein écran (formation, Analyseur) : elles remontent sous la
// barre du haut par des marges négatives. Quand une bande est affichée, on
// les fait démarrer sous la bande, et on retire sa hauteur de la leur pour
// qu'elles tiennent toujours dans l'écran (--ann-h, lu par components.css).
function annBandsLayout() {
  const main = document.querySelector('.main');
  const host = document.getElementById('ann-bands');
  if (!main) return;
  const on = !!(host && !host.hidden && host.offsetHeight);
  main.classList.toggle('has-bands', on);
  let h = 0;
  if (on) {
    const pad = parseFloat(getComputedStyle(main).paddingTop) || 0;
    const mb = parseFloat(getComputedStyle(host).marginBottom) || 0;
    h = host.offsetHeight + mb + pad;
  }
  main.style.setProperty('--ann-h', `${Math.round(h)}px`);
}
window.addEventListener('resize', () => annBandsLayout());

const AnnBanner = {
  _list: [],
  _closed() {
    try { return JSON.parse(localStorage.getItem(ANN_BANNER_KEY) || '{}') || {}; } catch (_) { return {}; }
  },
  async load() {
    try {
      const r = await fetch(`${API}/api/announcements`, { cache: 'no-store' });
      if (r.ok) this._list = (await r.json()).filter(a => a.display === 'banner');
    } catch (_) { /* réseau indisponible : on garde ce qu'on a */ }
    this.render();
  },
  close(id) {
    const c = this._closed();
    c[id] = new Date().toISOString();
    // On ne garde que les annonces encore en cours : la liste ne grossit pas.
    const vivantes = new Set(this._list.map(a => a.id));
    Object.keys(c).forEach(k => { if (!vivantes.has(k)) delete c[k]; });
    try { localStorage.setItem(ANN_BANNER_KEY, JSON.stringify(c)); } catch (_) {}
    this.render();
  },
  render() {
    const main = document.querySelector('.main');
    if (!main) return;
    let host = document.getElementById('ann-bands');
    if (!host) {
      host = document.createElement('div');
      host.id = 'ann-bands';
      main.prepend(host);
    }
    const closed = this._closed();
    // La plus grave d'abord, puis la plus récente.
    const rang = { critical: 0, warning: 1, info: 2 };
    const vis = this._list.filter(a => !closed[a.id])
      .sort((a, b) => (rang[a.level] ?? 3) - (rang[b.level] ?? 3) || String(b.created_at).localeCompare(String(a.created_at)));
    // L'avis de nouvelle version (auto-reload.js) vit dans le même espace :
    // il reste en tête quand les annonces sont redessinées.
    const maj = document.getElementById('auto-reload-bar');
    host.innerHTML = vis.map(a => annBannerHtml(a)).join('');
    if (maj) host.prepend(maj);
    host.hidden = !vis.length && !maj;
    annBandsLayout();
  },
};

document.addEventListener('DOMContentLoaded', () => {
  AnnBanner.load();
  setInterval(() => { if (!document.hidden) AnnBanner.load(); }, 120000);
});
