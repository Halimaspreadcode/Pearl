// ══════════════════════════════════════════════════════════════
// INDICATEURS (Admin › Indicateurs)
//
// L'admin décrit un KPI ou un PI à Pearl AI (« le MTTD c'est… », une
// formule, « montre-moi le FO qui s'est dégradé et de combien »). Big
// Brother rend une définition que l'admin relit, ajuste et enregistre.
// Ensuite le suivi est calculé par le serveur à chaque ouverture, sur les
// trackers, sans repasser par l'IA.
// ══════════════════════════════════════════════════════════════
const IND = { items: null, cat: null, vue: 'liste', cur: null, fil: [], job: null, timer: null, err: '', json: false, saisie: '' };

async function _indFetch(url, opts = {}) {
  const r = await fetch(`${API}${url}`, { ...opts, credentials: 'same-origin', headers: AdminSession.headers({ 'Content-Type': 'application/json' }) });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error('Session admin expirée : reconnecte-toi.');
  if (!r.ok) throw new Error(d.error || `Erreur ${r.status}`);
  return d;
}
const _indPays = () => (typeof getActiveCountry === 'function' ? getActiveCountry() : 'ALL');
const _indQ = () => `country=${encodeURIComponent(_indPays())}`;

async function renderIndicateursPage() {
  const root = document.getElementById('indicateurs-root');
  if (!root) return;
  if (!IND.items) root.innerHTML = '<div class="ix"><p class="ix-empty">Chargement…</p></div>';
  try {
    const [l, c] = await Promise.all([_indFetch(`/api/indicateurs?${_indQ()}`), IND.cat ? IND.cat : _indFetch('/api/indicateurs/catalogue')]);
    IND.items = l.items; IND.cat = c; IND.err = '';
    if (IND.vue === 'atelier' && IND.cur && IND.cur.def) await _indApercu(true);
  } catch (e) { IND.err = e.message; IND.items = IND.items || []; }
  _indPaint();
}

// ── Mise en forme ──
const _indNb = (v, d = 1) => v === null || v === undefined ? '—' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: d });
function _indVal(v, def) {
  if (v === null || v === undefined) return '—';
  const u = def.unite;
  if (u === 'min' && Math.abs(v) >= 90) { const h = Math.floor(v / 60), m = Math.round(v % 60); return `${h} h ${String(m).padStart(2, '0')}`; }
  if (u === '%') return `${_indNb(v)} %`;
  if (u === 'tickets') return _indNb(v, 0);
  return `${_indNb(v)} ${u === 'j' ? 'j' : u}`;
}
function _indEcart(x, def, court) {
  if (!x || x.delta === null || x.delta === undefined) return '<span class="ix-d is-na">—</span>';
  const cls = x.tendance === 'pire' ? 'is-bad' : x.tendance === 'mieux' ? 'is-good' : 'is-flat';
  const fl = x.delta > 0 ? '▲' : x.delta < 0 ? '▼' : '=';
  const pct = x.delta_pct !== null && x.delta_pct !== undefined ? `${x.delta_pct > 0 ? '+' : ''}${_indNb(x.delta_pct)} %` : '';
  const abs = def.unite === '%' ? `${x.delta > 0 ? '+' : ''}${_indNb(x.delta)} pt` : `${x.delta > 0 ? '+' : ''}${_indVal(x.delta, def)}`;
  return `<span class="ix-d ${cls}">${fl} ${court ? (pct || abs) : pct ? `${pct} <small>(${abs})</small>` : abs}</span>`;
}
function _indSpark(serie, w = 120, h = 34) {
  const v = serie.map(s => s.valeur);
  const ok = v.filter(x => x !== null);
  if (ok.length < 2) return '';
  const mn = Math.min(...ok), mx = Math.max(...ok), r = mx - mn || 1;
  const pts = v.map((x, i) => x === null ? null : [i / (v.length - 1) * w, h - 3 - (x - mn) / r * (h - 6)]);
  const d = pts.filter(Boolean).map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const last = pts.filter(Boolean).pop();
  return `<svg class="ix-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><path d="${d}"/><circle cx="${last[0]}" cy="${last[1]}" r="2.6"/></svg>`;
}
// ── Rendu ──
function _indPaint() {
  const root = document.getElementById('indicateurs-root');
  if (!root) return;
  root.innerHTML = IND.vue === 'atelier' && IND.cur ? _indAtelierHtml() : _indListeHtml();
  const fil = root.querySelector('.ix-fil');
  if (fil) fil.scrollTop = fil.scrollHeight;
}

const _indPerim = () => ({ SN: 'Sénégal', CI: 'Côte d\'Ivoire' }[_indPays()] || 'SN + CI');

function _indListeHtml() {
  const items = IND.items || [];
  const modeles = (IND.cat?.modeles || []).map((m, i) => `<button type="button" class="ix-model" onclick="indModele(${i})"><b>${esc(m.sigle)}</b><span>${esc(m.nom)}</span></button>`).join('');
  const cartes = items.map(it => {
    const d = it.def, r = it.resume || {};
    const cible = d.cible !== null && d.cible !== undefined;
    return `<button type="button" class="ix-card" onclick="indOuvrir(${escAttrArg(d.id)})">
      <div class="ix-card-h"><span class="ix-genre">${esc(d.genre)}</span>${d.sigle ? `<b>${esc(d.sigle)}</b>` : ''}<span class="ix-card-n">${esc(d.nom)}</span></div>
      ${it.erreur ? `<p class="ix-err">${esc(it.erreur)}</p>` : `
      <div class="ix-card-v"><strong class="${r.sur_cible === false ? 'is-bad' : r.sur_cible ? 'is-good' : ''}">${esc(_indVal(r.valeur, d))}</strong>${_indSpark(it.serie || [])}</div>
      <div class="ix-card-f">${_indEcart(r, d, true)}<span>${esc(r.periode || '')}${cible ? ` · cible ${esc(_indVal(d.cible, d))}` : ''}</span></div>`}
    </button>`;
  }).join('');
  return `<div class="ix">
    <header class="ix-head">
      <div><h1 class="page-title">Indicateurs</h1>
        <p class="page-sub">KPI et PI calculés automatiquement sur les trackers · ${esc(_indPerim())}</p></div>
      <button type="button" class="ix-btn is-pri" onclick="indNouveau()">Nouvel indicateur</button>
    </header>
    ${IND.err ? `<div class="ix-alert">${esc(IND.err)}</div>` : ''}
    ${items.length ? `<section class="ix-grid">${cartes}</section>` : `
    <section class="ix-hero">
      <h2>Décris ton indicateur, Pearl AI le configure.</h2>
      <p>Donne sa formule ou explique-le avec tes mots. Une fois validé, il se met à jour tout seul à partir des trackers : plus besoin de repasser par l'IA.</p>
      <form class="ix-hero-f" onsubmit="event.preventDefault();indNouveau(this.q.value)">
        <input name="q" placeholder="Ex. Le MTTD : temps entre l'occurrence et la détection, par semaine" autocomplete="off">
        <button type="submit" class="ix-btn is-pri">Configurer</button>
      </form>
    </section>`}
    <section class="ix-models"><h3>Partir d'un modèle</h3><div>${modeles}</div></section>
  </div>`;
}

const IND_IDEES = [
  'Montre-moi le FO qui s\'est le plus dégradé, et de combien de %',
  'Classe les domaines du pire au meilleur',
  'Ajoute une cible',
  'Passe en suivi mensuel sur 6 mois',
  'Ne compte que les P1 et P2',
];

function _indAtelierHtml() {
  const c = IND.cur, d = c.def, k = c.calcul;
  const r = k?.resume || {};
  const neuf = !d.id;
  const vues = (k?.vues || d.vues || []).map(v => _indVueHtml(v, k, d)).join('');
  return `<div class="ix ix-at">
    <header class="ix-head">
      <div>
        <button type="button" class="ix-back" onclick="indRetour()">‹ Indicateurs</button>
        <h1 class="page-title">${d.sigle ? `${esc(d.sigle)} · ` : ''}${esc(d.nom || 'Nouvel indicateur')}</h1>
        <p class="page-sub">${esc(d.description || 'Décris l\'indicateur à Pearl AI, à droite.')}</p>
      </div>
      <div class="ix-head-a">
        ${!neuf ? `<button type="button" class="ix-btn is-ghost" onclick="indSupprimer()">Supprimer</button>` : ''}
        <button type="button" class="ix-btn is-pri" onclick="indEnregistrer()" ${c.sale || neuf ? '' : 'disabled'}>${neuf ? 'Valider et suivre' : c.sale ? 'Enregistrer les changements' : 'Enregistré'}</button>
      </div>
    </header>
    ${IND.err ? `<div class="ix-alert">${esc(IND.err)}</div>` : ''}
    <div class="ix-cols">
      <main class="ix-main">
        ${k ? `<section class="ix-sum">
          <div><small>${esc(r.periode || '')}${k.serie?.at(-1)?.en_cours ? ' · en cours' : ''}</small>
            <strong class="${r.sur_cible === false ? 'is-bad' : r.sur_cible ? 'is-good' : ''}">${esc(_indVal(r.valeur, d))}</strong>
            <span>${r.n ?? 0} ticket${r.n > 1 ? 's' : ''} pris en compte</span></div>
          <div><small>Période précédente</small><b>${esc(_indVal(r.precedente, d))}</b>${_indEcart(r, d)}</div>
          <div><small>Cible</small><b>${d.cible !== null && d.cible !== undefined ? esc(_indVal(d.cible, d)) : '—'}</b>
            <span>${r.sur_cible === null || r.sur_cible === undefined ? 'aucune cible' : r.sur_cible ? 'atteinte' : 'non atteinte'}</span></div>
        </section>` : '<p class="ix-empty">Aperçu en cours…</p>'}
        ${c.avert?.length ? `<div class="ix-warn">${c.avert.map(a => `<p>${esc(a)}</p>`).join('')}</div>` : ''}
        <div class="ix-vues">${vues}${k ? _indAjoutVueHtml() : ''}</div>
      </main>
      <aside class="ix-side">
        <section class="ix-bb">
          <h3>Pearl AI</h3>
          <div class="ix-fil">${IND.fil.length ? IND.fil.map(m => `<div class="ix-m is-${m.role}">${esc(m.content)}${m.avert?.length ? `<ul>${m.avert.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}</div>`).join('')
            : `<p class="ix-m is-assistant">${neuf ? 'Explique l\'indicateur ou donne sa formule. Je choisis les champs des trackers, la période et les vues ; tu valides.' : 'Demande-moi une vue en plus ou un changement : je modifie la définition, tu valides.'}</p>`}
            ${IND.job ? `<div class="ix-m is-job"><i></i><span>${esc(IND.job.etape || 'Pearl AI réfléchit…')}</span><button type="button" onclick="indStop()">Stop</button></div>` : ''}
          </div>
          <div class="ix-idees">${(neuf && !IND.fil.length ? ['Le MTTD : temps entre l\'occurrence et la détection', 'Taux de tickets en breach SLA par semaine', 'Nombre de P1 par domaine'] : IND_IDEES)
            .map(s => `<button type="button" onclick="indDemander(${escAttrArg(s)})">${esc(s)}</button>`).join('')}</div>
          <form class="ix-comp" onsubmit="event.preventDefault();indDemander(this.q.value)">
            <textarea name="q" rows="2" placeholder="${neuf ? 'Décris l\'indicateur ou sa formule…' : 'Ex. je veux voir le FO qui a dégradé, et de combien de %'}" oninput="IND.saisie=this.value"
              onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();this.form.requestSubmit()}" ${IND.job ? 'disabled' : ''}>${esc(IND.saisie)}</textarea>
            <button type="submit" class="ix-send" ${IND.job ? 'disabled' : ''} aria-label="Envoyer">↑</button>
          </form>
        </section>
        ${_indFicheHtml(d)}
      </aside>
    </div>
  </div>`;
}

function _indOpts(obj, v) { return Object.entries(obj).map(([k, l]) => `<option value="${esc(k)}"${k === v ? ' selected' : ''}>${esc(l)}</option>`).join(''); }
function _indFiltreTxt(f) {
  const C = { ...IND.cat.categories, ...IND.cat.dates };
  const val = Array.isArray(f.valeur) ? f.valeur.join(', ') : f.valeur;
  return `${C[f.champ] || f.champ} ${{ '=': '=', '!=': '≠', dans: '∈', hors: '∉', vide: 'vide', renseigne: 'renseigné' }[f.op] || f.op}${val ? ` ${val}` : ''}`;
}
function _indFicheHtml(d) {
  const cat = IND.cat; if (!cat) return '';
  const m = d.mesure || {};
  const duree = m.valeur ? `${(cat.dates[m.valeur.a] || m.valeur.a).toLowerCase()} − ${(cat.dates[m.valeur.de] || m.valeur.de).toLowerCase()}${m.valeur.ouvre ? ' (heures ouvrées)' : ''}` : '';
  const quoi = m.fn === 'nombre' ? 'Nombre de tickets' : m.fn === 'taux' ? `% des tickets où ${(m.condition || []).map(_indFiltreTxt).join(' et ') || '…'}` : `${cat.fonctions[m.fn] || m.fn} de ${duree}`.replace(/ de ([aeiouéèo])/i, ' d\'$1');
  const f = (k, lab, html) => `<label class="ix-f"><span>${lab}</span>${html}</label>`;
  return `<section class="ix-fiche">
    <div class="ix-fiche-h"><h3>Définition</h3><button type="button" class="ix-link" onclick="IND.json=!IND.json;_indPaint()">${IND.json ? 'Vue simple' : 'JSON'}</button></div>
    ${IND.json ? `<textarea class="ix-json" spellcheck="false" onchange="indJson(this.value)">${esc(JSON.stringify({ ...d, id: undefined, cree_le: undefined, cree_par: undefined, maj_le: undefined, maj_par: undefined }, null, 2))}</textarea>` : `
    <div class="ix-calc"><small>Calcul</small><p>${esc(quoi)}</p>
      ${d.filtres?.length ? `<small>Tickets retenus</small><p>${d.filtres.map(_indFiltreTxt).map(esc).join(' · ')}</p>` : ''}
      ${d.formule ? `<small>Formule</small><p class="ix-mono">${esc(d.formule)}</p>` : ''}</div>
    <div class="ix-f2">
      ${f('nom', 'Nom', `<input value="${esc(d.nom)}" onchange="indChamp('nom',this.value)">`)}
      ${f('sigle', 'Sigle', `<input value="${esc(d.sigle || '')}" onchange="indChamp('sigle',this.value)">`)}
    </div>
    <div class="ix-f2">
      ${f('genre', 'Genre', `<div class="ix-seg">${['KPI', 'PI'].map(g => `<button type="button" class="${d.genre === g ? 'is-on' : ''}" onclick="indChamp('genre','${g}')">${g}</button>`).join('')}</div>`)}
      ${f('sens', 'Le mieux', `<div class="ix-seg">${[['bas', 'Plus bas'], ['haut', 'Plus haut']].map(([k, l]) => `<button type="button" class="${d.sens === k ? 'is-on' : ''}" onclick="indChamp('sens','${k}')">${l}</button>`).join('')}</div>`)}
    </div>
    <div class="ix-f2">
      ${f('periode', 'Période', `<select onchange="indChamp('periode',this.value)">${_indOpts(cat.periodes, d.periode)}</select>`)}
      ${f('nb', 'Sur', `<select onchange="indChamp('nb_periodes',+this.value)">${[4, 6, 8, 12, 26].map(n => `<option value="${n}"${n === d.nb_periodes ? ' selected' : ''}>${n} périodes</option>`).join('')}</select>`)}
    </div>
    <div class="ix-f2">
      ${f('ref', 'Référence', `<select onchange="indChamp('reference',this.value)">${_indOpts({ terminee: 'Dernière période terminée', en_cours: 'Période en cours' }, d.reference)}</select>`)}
      ${f('date', 'Daté par', `<select onchange="indChamp('date',this.value)">${_indOpts(cat.dates, d.date)}</select>`)}
    </div>
    <div class="ix-f2">
      ${['nombre', 'taux'].includes(m.fn) ? '' : f('unite', 'Unité', `<select onchange="indChamp('unite',this.value)">${_indOpts({ min: 'Minutes', h: 'Heures', j: 'Jours' }, d.unite)}</select>`)}
      ${f('cible', `Cible${d.unite ? ` (${d.unite})` : ''}`, `<input type="number" step="any" value="${d.cible ?? ''}" placeholder="Aucune" onchange="indChamp('cible',this.value===''?null:+this.value)">`)}
    </div>`}
  </section>`;
}

// ── Graphiques ──
// Chaque vue choisit son graphique (sélecteur dans son en-tête). Tout est
// dessiné ici, en SVG ou en HTML, sans bibliothèque.
const IND_GRAPHES = { colonnes: 'Colonnes', ligne: 'Ligne', aire: 'Aire', lignes: 'Lignes', chaleur: 'Chaleur', barres: 'Barres', anneau: 'Anneau', tableau: 'Tableau' };
// Une couleur par groupe (FO, domaine…) ; la première suit l'encre du thème.
const IND_PAL = ['var(--ix-ink)', '#3D7FD9', '#E8833A', '#2E9E5B', '#9B5DE5', '#E5B931', '#D64545', '#14B8A6', '#8D6E63', '#EC4899'];
const _indX = s => esc(String(s).replace('sem. du ', ''));
const _indHors = (def, v) => def.cible !== null && def.cible !== undefined && v !== null && (def.sens === 'haut' ? v < def.cible : v > def.cible);

// Colonnes verticales : valeur écrite au-dessus, dernière en noir, cible en pointillé.
function _indColonnes(points, def, opts = {}) {
  const ok = points.map(p => p.valeur).filter(x => x !== null);
  if (!ok.length) return '<p class="ix-empty">Pas encore de données.</p>';
  const aCible = def.cible !== null && def.cible !== undefined;
  const mx = Math.max(...ok.map(Math.abs), aCible ? def.cible : 0) || 1;
  const h = x => Math.max(1.5, Math.abs(x) / mx * 85);
  const cible = aCible ? `<div class="ix-cols-t" style="bottom:${def.cible / mx * 85}%"><span>cible ${esc(_indVal(def.cible, def))}</span></div>` : '';
  return `<div class="ix-colsg"><div class="ix-cols-plot">${cible}${points.map(p => `<div class="ix-col${p.fort ? ' is-last' : ''}${_indHors(def, p.valeur) ? ' is-off' : ''}" title="${esc(p.lib)} : ${esc(_indVal(p.valeur, def))}${p.n !== undefined ? ` · ${p.n} ticket${p.n > 1 ? 's' : ''}` : ''}">
      ${p.valeur === null ? '<em>—</em>' : `<b style="bottom:calc(${h(p.valeur)}% + 6px)">${esc(_indVal(p.valeur, def))}</b><i style="height:${h(p.valeur)}%"></i>`}</div>`).join('')}</div>
    <div class="ix-cols-x">${points.map(p => `<span class="${p.fort ? 'is-last' : ''}" title="${esc(p.lib)}">${_indX(p.lib)}</span>`).join('')}</div></div>`;
}

// Courbe lissée (une ou plusieurs séries), avec aire facultative.
function _indLignes(colonnes, series, def, opts = {}) {
  const W = 640, H = 210, P = { l: 14, r: 14, t: 26, b: 10 };
  const toutes = series.flatMap(s => s.valeurs).filter(x => x !== null);
  if (!toutes.length) return '<p class="ix-empty">Pas encore de données.</p>';
  const aCible = def.cible !== null && def.cible !== undefined;
  const lo = Math.min(...toutes, aCible ? def.cible : Infinity), hi = Math.max(...toutes, aCible ? def.cible : -Infinity);
  const pad = (hi - lo) * 0.18 || Math.abs(hi) * 0.2 || 1;
  const mn = Math.max(0, lo - pad), mx = hi + pad;
  const n = colonnes.length;
  const x = i => P.l + (n === 1 ? (W - P.l - P.r) / 2 : i / (n - 1) * (W - P.l - P.r));
  const y = v => P.t + (1 - (v - mn) / (mx - mn || 1)) * (H - P.t - P.b);
  const trace = pts => {          // Catmull-Rom → Bézier, par segments continus
    let d = '', seg = [];
    const flush = () => {
      if (!seg.length) return;
      d += `M${seg[0][0].toFixed(1)},${seg[0][1].toFixed(1)}`;
      for (let i = 0; i < seg.length - 1; i++) {
        const p0 = seg[i - 1] || seg[i], p1 = seg[i], p2 = seg[i + 1], p3 = seg[i + 2] || p2;
        d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
      }
      seg = [];
    };
    pts.forEach(p => { if (p) seg.push(p); else flush(); }); flush();
    return d;
  };
  const grille = [0.25, 0.5, 0.75].map(f => `<line class="ix-g" x1="${P.l}" x2="${W - P.r}" y1="${P.t + f * (H - P.t - P.b)}" y2="${P.t + f * (H - P.t - P.b)}"/>`).join('');
  const cible = aCible ? `<line class="ix-c-target" x1="${P.l}" x2="${W - P.r}" y1="${y(def.cible)}" y2="${y(def.cible)}"/><text class="ix-c-tl" x="${W - P.r}" y="${y(def.cible) - 6}" text-anchor="end">cible ${esc(_indVal(def.cible, def))}</text>` : '';
  const seule = series.length === 1;
  const corps = series.map((s, k) => {
    const pts = s.valeurs.map((v, i) => v === null ? null : [x(i), y(v)]);
    const d = trace(pts);
    const c = seule ? 'var(--ix-ink)' : s.couleur;
    const vus = pts.filter(Boolean);
    const aire = opts.aire && vus.length > 1 ? `<path class="ix-area" d="${d}L${vus.at(-1)[0]},${H - P.b}L${vus[0][0]},${H - P.b}Z" style="fill:${c}"/>` : '';
    const etiq = seule && n <= 14 ? s.valeurs.map((v, i) => v === null ? '' : `<text class="ix-c-v${i === n - 1 ? ' is-last' : ''}" x="${x(i)}" y="${y(v) - 12}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${esc(_indVal(v, def))}</text>`).join('') : '';
    return `${aire}<path class="ix-c-line" d="${d}" style="stroke:${c}"/>
      ${pts.map((p, i) => p ? `<circle class="ix-c-pt${i === n - 1 ? ' is-last' : ''}" cx="${p[0]}" cy="${p[1]}" r="${i === n - 1 ? 4.5 : 3}" style="stroke:${c}${i === n - 1 ? `;fill:${c}` : ''}"><title>${esc(s.nom ? `${s.nom} · ` : '')}${esc(colonnes[i])} : ${esc(_indVal(s.valeurs[i], def))}</title></circle>` : '').join('')}${etiq}`;
  }).join('');
  return `<div class="ix-lg"><svg class="ix-ligne" viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution">${grille}${cible}${corps}</svg>
    <div class="ix-cols-x">${colonnes.map((c, i) => `<span class="${i === n - 1 ? 'is-last' : ''}" title="${esc(c)}">${_indX(c)}</span>`).join('')}</div>
    ${seule ? '' : `<div class="ix-leg">${series.map(s => `<span><i style="background:${s.couleur}"></i>${esc(s.nom)}</span>`).join('')}</div>`}</div>`;
}

// Colonnes groupées : pour chaque période, une colonne par groupe.
function _indGroupees(colonnes, series, def) {
  const toutes = series.flatMap(s => s.valeurs).filter(x => x !== null);
  if (!toutes.length) return '<p class="ix-empty">Pas encore de données.</p>';
  const mx = Math.max(...toutes.map(Math.abs)) || 1;
  return `<div class="ix-colsg"><div class="ix-cols-plot is-grp">${colonnes.map((c, i) => `<div class="ix-grp">${series.map(s => {
      const v = s.valeurs[i];
      return `<i style="height:${v === null ? 0 : Math.max(1.5, Math.abs(v) / mx * 92)}%;background:${s.couleur}" title="${esc(s.nom)} · ${esc(c)} : ${esc(_indVal(v, def))}"></i>`;
    }).join('')}</div>`).join('')}</div>
    <div class="ix-cols-x">${colonnes.map((c, i) => `<span class="${i === colonnes.length - 1 ? 'is-last' : ''}">${_indX(c)}</span>`).join('')}</div>
    <div class="ix-leg">${series.map(s => `<span><i style="background:${s.couleur}"></i>${esc(s.nom)}</span>`).join('')}</div></div>`;
}

// Tableau, coloré ou non : en carte de chaleur, plus c'est mauvais, plus c'est rouge.
function _indMatrice(colonnes, lignes, def, chaleur) {
  const vals = lignes.flatMap(l => l.cellules.map(c => c.valeur)).filter(x => x !== null);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const force = v => { if (v === null || hi === lo) return 0; const t = (v - lo) / (hi - lo); return def.sens === 'haut' ? 1 - t : t; };
  return `<div class="ix-tab-w"><table class="ix-tab${chaleur ? ' is-heat' : ''}"><thead><tr><th></th>${colonnes.map(c => `<th title="${esc(c)}">${_indX(c)}</th>`).join('')}</tr></thead><tbody>
    ${lignes.map(l => `<tr><td>${esc(l.nom)}</td>${l.cellules.map(c => `<td class="${c.valeur === null ? 'is-na' : ''}"${chaleur && c.valeur !== null ? ` style="--h:${Math.round(force(c.valeur) * 100)}%"` : ''} title="${c.n} ticket${c.n > 1 ? 's' : ''}">${c.valeur === null ? '·' : esc(_indVal(c.valeur, def))}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div>${chaleur ? `<div class="ix-heat-k"><span>mieux</span><i></i><span>moins bien</span></div>` : ''}`;
}

// Anneau : la part de chaque groupe (pertinent pour un nombre ou une somme).
function _indAnneau(lignes, def) {
  const tot = lignes.reduce((s, l) => s + Math.max(0, l.valeur || 0), 0);
  if (!tot) return '<p class="ix-empty">Rien sur cette période.</p>';
  const R = 52, C = 2 * Math.PI * R;
  let acc = 0;
  const arcs = lignes.map((l, i) => {
    const part = Math.max(0, l.valeur || 0) / tot, len = part * C;
    const s = `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${IND_PAL[i % IND_PAL.length]}" stroke-width="22" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}"><title>${esc(l.nom)} : ${esc(_indVal(l.valeur, def))} (${Math.round(part * 100)} %)</title></circle>`;
    acc += len; return s;
  }).join('');
  return `<div class="ix-donut"><svg viewBox="0 0 140 140" width="150" height="150" aria-hidden="true"><g transform="rotate(-90 70 70)">${arcs}</g>
      <text x="70" y="68" text-anchor="middle" class="ix-donut-v">${esc(_indVal(tot, def))}</text><text x="70" y="86" text-anchor="middle" class="ix-donut-l">au total</text></svg>
    <ul>${lignes.map((l, i) => `<li><i style="background:${IND_PAL[i % IND_PAL.length]}"></i><span>${esc(l.nom)}</span><b>${esc(_indVal(l.valeur, def))}</b><small>${Math.round(Math.max(0, l.valeur || 0) / tot * 100)} %</small></li>`).join('')}</ul></div>`;
}

// Barres horizontales ; en mode écart, elles partent du centre (gauche = mieux).
function _indBarres(lignes, def, ecart) {
  if (ecart) {
    const mx = Math.max(...lignes.map(l => Math.abs(l.delta_pct ?? 0)), 1);
    return `<ol class="ix-rank is-div">${lignes.map(l => {
      const w = Math.abs(l.delta_pct ?? 0) / mx * 50, pire = l.tendance === 'pire';
      return `<li><span class="ix-rank-n">${esc(l.nom)}</span><span class="ix-div"><i class="${pire ? 'is-bad' : 'is-good'}" style="${pire ? 'left:50%' : `left:${50 - w}%`};width:${Math.max(1, w)}%"></i></span>${_indEcart(l, def, true)}</li>`;
    }).join('')}</ol>`;
  }
  const max = Math.max(...lignes.map(l => Math.abs(l.valeur || 0)), 1);
  return `<ol class="ix-rank">${lignes.map(l => `<li><span class="ix-rank-n">${esc(l.nom)}</span>
    <span class="ix-bar"><i style="width:${Math.max(2, Math.abs(l.valeur) / max * 100)}%" class="${l.sur_cible === false ? 'is-bad' : ''}"></i></span>
    <b>${esc(_indVal(l.valeur, def))}</b><small>${l.n} t.</small></li>`).join('')}</ol>`;
}

function _indVueHtml(v, k, d) {
  if (!k) return '';
  const C = IND.cat?.categories || {};
  const choix = (IND.cat?.graphes || {})[v.type] || [];
  const q = escAttrArg(v.id);
  const outils = `<div class="ix-v-tools">
    ${v.par ? `<select class="ix-v-par" onchange="indVueSet(${q},'par',this.value)" aria-label="Regrouper par">${_indOpts(C, v.par)}</select>` : ''}
    ${choix.length > 1 ? `<div class="ix-gseg" role="group" aria-label="Type de graphique">${choix.map(g => `<button type="button" class="${v.graphe === g ? 'is-on' : ''}" onclick="indVueSet(${q},'graphe','${g}')">${IND_GRAPHES[g] || g}</button>`).join('')}</div>` : ''}
    <button type="button" class="ix-vx" onclick="indRetirerVue(${q})" title="Retirer cette vue" aria-label="Retirer">×</button></div>`;
  const head = sous => `<header><div><h4>${esc(v.titre)}</h4>${sous ? `<small>${sous}</small>` : ''}</div>${outils}</header>`;
  const serie = k.serie || [];
  const cur = serie.at(-1), prev = serie.at(-2);
  const nbPer = `${serie.length} ${esc((IND.cat?.periodes?.[d.periode] || '').toLowerCase())}s`;
  const vide = t => `<p class="ix-empty">${t}</p>`;
  const larges = ['courbe', 'series', 'tableau'].includes(v.type) || (v.type === 'evolution' && v.graphe === 'tableau');
  const art = (sous, corps) => `<article class="ix-v${larges ? ' is-wide' : ''}">${head(sous)}${corps}</article>`;

  if (v.type === 'courbe') {
    const colonnes = serie.map(s => s.libelle);
    if (v.graphe === 'colonnes') return art(nbPer, _indColonnes(serie.map((s, i) => ({ lib: s.libelle, valeur: s.valeur, n: s.n, fort: i === serie.length - 1 })), d));
    return art(nbPer, _indLignes(colonnes, [{ valeurs: serie.map(s => s.valeur) }], d, { aire: v.graphe === 'aire' }));
  }
  const par = esc((C[v.par] || v.par || '').toLowerCase());
  if (v.type === 'series' || v.type === 'tableau') {
    const lignes = v.lignes || [];
    if (!lignes.length) return art(`par ${par}`, vide('Rien sur ces périodes.'));
    const series = lignes.map((l, i) => ({ nom: l.nom, couleur: IND_PAL[i % IND_PAL.length], valeurs: l.cellules.map(c => c.valeur) }));
    const sous = `par ${par} · ${nbPer}${v.total > lignes.length ? ` · ${lignes.length} sur ${v.total}` : ''}`;
    if (v.graphe === 'lignes') return art(sous, _indLignes(v.colonnes, series, d));
    if (v.graphe === 'colonnes') return art(sous, _indGroupees(v.colonnes, series, d));
    return art(sous, _indMatrice(v.colonnes, lignes, d, v.graphe === 'chaleur'));
  }
  if (v.type === 'classement') {
    const lignes = v.lignes || [];
    const sous = `par ${par} · ${esc(cur?.libelle || '')} · ${v.ordre === 'meilleur' ? 'meilleurs' : 'moins bons'} en premier`;
    if (!lignes.length) return art(sous, vide('Rien sur cette période.'));
    const plus = v.total > lignes.length ? `<p class="ix-more">${v.total - lignes.length} autre(s) non affiché(s)</p>` : '';
    if (v.graphe === 'anneau') return art(sous, _indAnneau(lignes, d) + plus);
    if (v.graphe === 'colonnes') return art(sous, _indColonnes(lignes.map((l, i) => ({ lib: l.nom, valeur: l.valeur, n: l.n, fort: i === 0 })), d) + plus);
    return art(sous, _indBarres(lignes, d) + plus);
  }
  if (v.type === 'evolution') {
    const lib = { degrade: 'qui se dégradent', ameliore: 'qui progressent', tous: 'tous' }[v.filtre];
    const sous = `par ${par}, ${lib} · ${esc(cur?.libelle || '')} contre ${esc(prev?.libelle || '')}${v.seuil_pct ? ` · écart ≥ ${v.seuil_pct} %` : ''}`;
    const lignes = v.lignes || [];
    if (!lignes.length) return art(sous, vide(v.filtre === 'degrade' ? 'Personne ne s\'est dégradé sur cette période.' : 'Rien à comparer sur ces deux périodes.'));
    if (v.graphe === 'barres') return art(sous, _indBarres(lignes, d, true));
    return art(sous, `<table class="ix-evo"><thead><tr><th>${esc(C[v.par] || v.par)}</th><th>Avant</th><th>Maintenant</th><th>Écart</th></tr></thead><tbody>
      ${lignes.map(l => `<tr><td>${esc(l.nom)}</td><td>${esc(_indVal(l.precedente, d))}<small>${l.n_prec} t.</small></td><td><b>${esc(_indVal(l.valeur, d))}</b><small>${l.n} t.</small></td><td>${_indEcart(l, d)}</td></tr>`).join('')}
      </tbody></table>`);
  }
  return '';
}

// Ajout d'une vue sans passer par l'IA.
const IND_NOUVELLES = [
  ['courbe', 'Évolution globale', {}],
  ['series', 'Une courbe par FO', { par: 'fo_owner', graphe: 'lignes' }],
  ['classement', 'Classement', { par: 'fo_owner' }],
  ['evolution', 'Qui se dégrade', { par: 'fo_owner', filtre: 'degrade' }],
  ['tableau', 'Carte de chaleur', { par: 'fo_owner', graphe: 'chaleur' }],
];
function _indAjoutVueHtml() {
  return `<article class="ix-v ix-v-add"><h4>Ajouter une vue</h4><p>Ou demande-la à Pearl AI, à droite.</p>
    <div>${IND_NOUVELLES.map(([t, l], i) => `<button type="button" onclick="indAjouterVue(${i})">${esc(l)}</button>`).join('')}</div></article>`;
}

// ── Actions ──
function indNouveau(q) {
  IND.vue = 'atelier'; IND.fil = []; IND.err = ''; IND.json = false; IND.saisie = '';
  IND.cur = { def: { id: null, nom: 'Nouvel indicateur', genre: 'KPI', mesure: { fn: 'nombre' }, date: 'open_date', periode: 'semaine', reference: 'terminee', nb_periodes: 8, sens: 'bas', unite: 'tickets', cible: null, filtres: [], vues: [] }, calcul: null, sale: true, avert: [], vierge: true };
  _indPaint();
  if (q && String(q).trim()) indDemander(q); else _indApercu();
}
async function indModele(i) {
  const m = IND.cat.modeles[i];
  IND.vue = 'atelier'; IND.fil = []; IND.err = ''; IND.json = false; IND.saisie = '';
  IND.cur = { def: JSON.parse(JSON.stringify(m)), calcul: null, sale: true, avert: [] };
  await _indApercu();
}
async function indOuvrir(id) {
  IND.err = ''; IND.json = false; IND.fil = []; IND.saisie = '';
  try {
    const r = await _indFetch(`/api/indicateurs/${encodeURIComponent(id)}?${_indQ()}`);
    IND.cur = { def: r.def, calcul: r, sale: false, avert: [] }; IND.vue = 'atelier';
  } catch (e) { IND.err = e.message; }
  _indPaint();
}
function indRetour() {
  if (IND.cur?.sale && !IND.cur.vierge && !confirm('Quitter sans enregistrer les changements ?')) return;
  indStop(true); IND.vue = 'liste'; IND.cur = null; renderIndicateursPage();
}
async function _indApercu(silencieux) {
  if (!IND.cur) return;
  try {
    const r = await _indFetch(`/api/indicateurs/apercu?${_indQ()}`, { method: 'POST', body: JSON.stringify({ def: IND.cur.def }) });
    IND.cur.calcul = r; IND.cur.def = { ...r.def, id: IND.cur.def.id || r.def.id }; IND.cur.avert = r.avertissements || [];
  } catch (e) { IND.err = e.message; }
  if (!silencieux) _indPaint();
}
function indChamp(k, v) {
  if (!IND.cur) return;
  IND.cur.def = { ...IND.cur.def, [k]: v }; IND.cur.sale = true; IND.cur.vierge = false;
  _indApercu();
}
function indJson(txt) {
  try { const d = JSON.parse(txt); IND.cur.def = { ...d, id: IND.cur.def.id }; IND.cur.sale = true; IND.err = ''; _indApercu(); }
  catch (e) { IND.err = 'JSON invalide : ' + e.message; _indPaint(); }
}
function indVueSet(id, k, val) {
  indChamp('vues', (IND.cur.def.vues || []).map(v => v.id === id ? { ...v, [k]: val } : v));
}
function indAjouterVue(i) {
  const [type, titre, extra] = IND_NOUVELLES[i];
  const par = extra.par ? ` par ${(IND.cat.categories[extra.par] || extra.par)}` : '';
  indChamp('vues', [...(IND.cur.def.vues || []), { type, titre: type === 'series' ? `Par période${par}` : type === 'tableau' ? `Carte de chaleur${par}` : type === 'courbe' ? 'Par période' : `${titre}${type === 'classement' || type === 'evolution' ? par : ''}`, ...extra }]);
}
function indRetirerVue(id) {
  const vues = (IND.cur.def.vues || []).filter(v => v.id !== id);
  if (!vues.length) { IND.err = 'Garde au moins une vue.'; return _indPaint(); }
  indChamp('vues', vues);
}

async function indDemander(q) {
  q = String(q || '').trim();
  if (!q || IND.job) return;
  IND.err = ''; IND.saisie = '';
  const historique = IND.fil.filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({ role: m.role, content: m.content }));
  IND.fil.push({ role: 'user', content: q });
  const vierge = IND.cur?.vierge;
  try {
    const { job } = await _indFetch(`/api/indicateurs/ia?${_indQ()}`, { method: 'POST', body: JSON.stringify({ demande: q, def: vierge ? null : IND.cur.def, historique }) });
    IND.job = job; _indPaint(); _indSuivre();
  } catch (e) { IND.fil.push({ role: 'erreur', content: e.message }); _indPaint(); }
}
function _indSuivre() {
  clearTimeout(IND.timer);
  IND.timer = setTimeout(async () => {
    if (!IND.job) return;
    let j;
    try { j = await _indFetch(`/api/ai/jobs/${IND.job.id}`); } catch (e) { IND.job = null; IND.fil.push({ role: 'erreur', content: e.message }); return _indPaint(); }
    if (j.etat === 'en_cours') {
      const change = j.etape !== IND.job.etape; IND.job = j;
      if (change) { const el = document.querySelector('.ix-m.is-job span'); if (el) el.textContent = j.etape; }
      return _indSuivre();
    }
    IND.job = null;
    if (j.etat === 'fini' && j.resultat) {
      const r = j.resultat;
      IND.cur = { def: { ...r.definition, id: IND.cur?.def?.id || null }, calcul: r.calcul, sale: true, avert: r.avertissements || [] };
      IND.fil.push({ role: 'assistant', content: r.reponse || 'Voilà la définition : vérifie l\'aperçu, puis valide.', avert: r.avertissements });
    } else if (j.etat !== 'annule') IND.fil.push({ role: 'erreur', content: j.erreur || 'Échec.' });
    _indPaint();
  }, 1200);
}
async function indStop(muet) {
  if (!IND.job) return;
  const id = IND.job.id; IND.job = null; clearTimeout(IND.timer);
  try { await _indFetch(`/api/ai/jobs/${id}/cancel`, { method: 'POST' }); } catch (_) {}
  if (!muet) { IND.fil.push({ role: 'erreur', content: 'Arrêté.' }); _indPaint(); }
}
async function indEnregistrer() {
  if (!IND.cur) return;
  try {
    const r = await _indFetch('/api/indicateurs', { method: 'POST', body: JSON.stringify({ def: IND.cur.def }) });
    IND.cur.def = r.item; IND.cur.sale = false; IND.cur.vierge = false; IND.err = '';
    if (typeof toast === 'function') toast('Indicateur enregistré : il se met à jour tout seul.');
    IND.items = null;
    const l = await _indFetch(`/api/indicateurs?${_indQ()}`); IND.items = l.items;
  } catch (e) { IND.err = e.message; }
  _indPaint();
}
async function indSupprimer() {
  if (!IND.cur?.def?.id || !confirm(`Supprimer l'indicateur « ${IND.cur.def.nom} » ? Son suivi s'arrête.`)) return;
  try { await _indFetch(`/api/indicateurs/${encodeURIComponent(IND.cur.def.id)}`, { method: 'DELETE' }); IND.cur.sale = false; IND.cur.vierge = true; indRetour(); }
  catch (e) { IND.err = e.message; _indPaint(); }
}
