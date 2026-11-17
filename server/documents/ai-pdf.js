/**
 * Rapport PDF d'une réponse de Pearl AI.
 *
 * La page envoie la réponse déjà mise en forme sous forme de blocs
 * simples (titres, paragraphes, listes, chiffres clés, tableaux,
 * encadrés) ; ce module les met en page sur A4 avec pdf-lite, sans
 * dépendance. Le module est pur : il ne lit rien sur disque.
 *
 * Blocs acceptés :
 *   { t: 'h', text, niveau: 1|2 }        titre de section
 *   { t: 'p', text, ton: 'mute'|'bad'|'warn'|'ok' }
 *   { t: 'ul', items: [text], ordonne }  liste à puces ou numérotée
 *   { t: 'kpis', items: [{ v, l, ton }] } rangée de chiffres clés
 *   { t: 'table', head: [..], rows: [[..]] }
 *   { t: 'card', titre, badge, ton, blocs: [...] } encadré (un niveau)
 */

const { PdfDoc } = require('./pdf-lite');

const C = {
  accent: '#4338CA', accentSoft: '#EEF0FF',
  ink: '#111827', text: '#1F2937', mute: '#6B7280', faint: '#9CA3AF',
  line: '#E5E7EB', soft: '#F8FAFC', head: '#F1F5F9',
  bad: '#B91C1C', badSoft: '#FEE2E2', warn: '#B45309', warnSoft: '#FEF3C7', ok: '#047857', okSoft: '#D1FAE5',
};
const TON = { bad: C.bad, warn: C.warn, ok: C.ok, mute: C.mute };
const TON_FOND = { bad: C.badSoft, warn: C.warnSoft, ok: C.okSoft };

const W = 595.28, H = 841.89;
const M = 48;                 // marges latérales
const HAUT = 56, BAS = 64;    // zone utile verticale
const LARG = W - 2 * M;

// Pictogrammes et emoji : hors des polices standard du PDF.
const propre = s => String(s ?? '')
  .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '')
  .replace(/[ \t]+/g, ' ').trim();

const LIMITE = { blocs: 400, texte: 4000, items: 60, lignes: 200, colonnes: 8 };
function nettoyer(blocs, profondeur = 0) {
  return (Array.isArray(blocs) ? blocs : []).slice(0, LIMITE.blocs).map(b => {
    if (!b || typeof b !== 'object') return null;
    const txt = v => propre(v).slice(0, LIMITE.texte);
    switch (b.t) {
      case 'h': return { t: 'h', text: txt(b.text), niveau: b.niveau === 1 ? 1 : 2 };
      case 'p': return { t: 'p', text: txt(b.text), ton: TON[b.ton] ? b.ton : '' };
      case 'ul': return { t: 'ul', ordonne: !!b.ordonne, items: (b.items || []).slice(0, LIMITE.items).map(txt).filter(Boolean) };
      case 'kpis': return { t: 'kpis', items: (b.items || []).slice(0, 6).map(k => ({ v: txt(k.v), l: txt(k.l), ton: TON[k.ton] ? k.ton : '' })) };
      case 'table': {
        const head = (b.head || []).slice(0, LIMITE.colonnes).map(txt);
        const n = Math.max(head.length, ...(b.rows || []).map(r => (r || []).length), 0);
        if (!n) return null;
        return { t: 'table', head, rows: (b.rows || []).slice(0, LIMITE.lignes).map(r => Array.from({ length: Math.min(n, LIMITE.colonnes) }, (_, i) => txt((r || [])[i]))) };
      }
      case 'card': return profondeur ? null
        : { t: 'card', titre: txt(b.titre), badge: txt(b.badge), ton: TON[b.ton] ? b.ton : '', blocs: nettoyer(b.blocs, 1) };
      default: return null;
    }
  }).filter(b => b && (b.text || b.items?.length || b.rows || b.blocs?.length || b.titre));
}

// ── Mesure et dessin de chaque bloc ──────────────────────────
// Chaque fonction reçoit (doc, x, y, w, dessiner) et renvoie la hauteur ;
// avec dessiner = false elle ne fait que mesurer.
const T = { h1: 14, h2: 11.5, p: 10, small: 8.5 };
const LEAD = 1.4;

function hauteurTexte(doc, s, w, size, bold) { return doc.wrap(s, w, size, bold).length * size * LEAD; }

function bloc(doc, b, x, y, w, dessiner) {
  if (b.t === 'h') {
    const size = b.niveau === 1 ? T.h1 : T.h2;
    const h = hauteurTexte(doc, b.text, w, size, true);
    if (dessiner) doc.paragraph(b.text, x, y + size, w, { size, bold: true, color: b.niveau === 1 ? C.ink : C.accent, leading: LEAD });
    return h + (b.niveau === 1 ? 6 : 4);
  }
  if (b.t === 'p') {
    const h = hauteurTexte(doc, b.text, w, T.p, false);
    if (dessiner) doc.paragraph(b.text, x, y + T.p, w, { size: T.p, color: TON[b.ton] || C.text, leading: LEAD });
    return h + 4;
  }
  if (b.t === 'ul') {
    let yy = 0;
    b.items.forEach((it, i) => {
      const puce = b.ordonne ? `${i + 1}.` : '•';
      const ind = b.ordonne ? 16 : 11;
      const h = hauteurTexte(doc, it, w - ind, T.p, false);
      if (dessiner) {
        doc.text(puce, x + (b.ordonne ? 0 : 2), y + yy + T.p, { size: T.p, color: C.accent, bold: !!b.ordonne });
        doc.paragraph(it, x + ind, y + yy + T.p, w - ind, { size: T.p, color: C.text, leading: LEAD });
      }
      yy += h + 2;
    });
    return yy + 4;
  }
  if (b.t === 'kpis') {
    const n = b.items.length || 1, gap = 8, cw = (w - gap * (n - 1)) / n, h = 50;
    if (dessiner) b.items.forEach((k, i) => {
      const cx = x + i * (cw + gap);
      doc.roundRect(cx, y, cw, h, 6, { fill: TON_FOND[k.ton] || C.soft });
      doc.text(k.v, cx + 10, y + 24, { size: 16, bold: true, color: TON[k.ton] || C.ink, maxWidth: cw - 20 });
      doc.text(k.l, cx + 10, y + 39, { size: T.small, color: C.mute, maxWidth: cw - 20 });
    });
    return h + 10;
  }
  if (b.t === 'table') return table(doc, b, x, y, w, dessiner);
  return 0;
}

// Largeur des colonnes : proportionnelle au contenu, bornée.
function colonnes(doc, b, w) {
  const n = Math.max(b.head.length, ...b.rows.map(r => r.length));
  const besoin = Array.from({ length: n }, (_, i) => Math.min(220, Math.max(
    doc.widthOf(b.head[i] || '', T.small, true),
    ...b.rows.map(r => doc.widthOf(r[i] || '', T.small, false)),
  ) + 12));
  const total = besoin.reduce((a, v) => a + v, 0) || 1;
  return besoin.map(v => (v / total) * w);
}
function ligneTable(doc, cells, cols, x, y, bold, dessiner, fond) {
  const pad = 5;
  const h = Math.max(...cells.map((c, i) => hauteurTexte(doc, c || '', cols[i] - 2 * pad, T.small, bold))) + 2 * pad;
  if (dessiner) {
    if (fond) doc.rect(x, y, cols.reduce((a, v) => a + v, 0), h, { fill: fond });
    let cx = x;
    cells.forEach((c, i) => {
      doc.paragraph(c || '', cx + pad, y + pad + T.small, cols[i] - 2 * pad, { size: T.small, bold, color: bold ? C.ink : C.text, leading: LEAD });
      cx += cols[i];
    });
    doc.line(x, y + h, x + cols.reduce((a, v) => a + v, 0), y + h, { color: C.line, width: 0.5 });
  }
  return h;
}
function table(doc, b, x, y, w, dessiner) {
  const cols = colonnes(doc, b, w);
  let h = b.head.length ? ligneTable(doc, b.head, cols, x, y, true, dessiner, C.head) : 0;
  for (const r of b.rows) h += ligneTable(doc, r, cols, x, y + h, false, dessiner);
  return h + 10;
}

// ── Mise en page ──────────────────────────────────────────────
function rapportPdf({ titre, sousTitre, meta, blocs } = {}) {
  const doc = new PdfDoc({ title: propre(titre) || 'Rapport Pearl AI', author: 'Pearl AI · Pearl' });
  const items = nettoyer(blocs);
  let y = 0;
  const page = () => { doc.addPage(); y = HAUT; };
  const reste = () => H - BAS - y;

  // En-tête de la première page.
  page();
  doc.text('PEARL AI · PEARL', M, y, { size: 8, bold: true, color: C.accent, charSpace: 1.2 });
  y += 26;
  y += doc.paragraph(propre(titre) || 'Rapport', M, y, LARG, { size: 20, bold: true, color: C.ink, leading: 1.25 });
  if (sousTitre) y += 2 + doc.paragraph(propre(sousTitre), M, y + 2, LARG, { size: 10.5, color: C.mute, leading: LEAD });
  const lignesMeta = (Array.isArray(meta) ? meta : []).map(propre).filter(Boolean).slice(0, 6);
  if (lignesMeta.length) {
    y += 6;
    let mx = M;
    for (const m of lignesMeta) {
      const tw = doc.widthOf(m, 8.5, false) + 14;
      if (mx + tw > M + LARG) { mx = M; y += 20; }
      doc.roundRect(mx, y, tw, 16, 8, { fill: C.accentSoft });
      doc.text(m, mx + 7, y + 11, { size: 8.5, color: C.accent });
      mx += tw + 6;
    }
    y += 16;
  }
  y += 14;
  doc.line(M, y, M + LARG, y, { color: C.line, width: 0.75 });
  y += 18;

  // Corps : un bloc qui ne tient pas passe à la page suivante ; un
  // tableau trop long est coupé par lignes, en-tête répété.
  const poser = (b, x, w) => {
    const h = bloc(doc, b, x, 0, w, false);
    if (b.t === 'table' && h > reste()) return poserTable(b, x, w);
    if (h > reste() && y > HAUT + 1) page();
    bloc(doc, b, x, y, w, true);
    y += h;
  };
  const poserTable = (b, x, w) => {
    const cols = colonnes(doc, b, w);
    const entete = () => { if (b.head.length) y += ligneTable(doc, b.head, cols, x, y, true, true, C.head); };
    if (reste() < 60) page();
    entete();
    for (const r of b.rows) {
      const h = ligneTable(doc, r, cols, x, 0, false, false);
      if (h > reste()) { page(); entete(); }
      y += ligneTable(doc, r, cols, x, y, false, true);
    }
    y += 10;
  };
  const poserCarte = (b) => {
    const pad = 14, iw = LARG - 2 * pad;
    const hTitre = b.titre ? hauteurTexte(doc, b.titre, iw - (b.badge ? 90 : 0), 11, true) + 6 : 0;
    const hCorps = b.blocs.reduce((n, x) => n + bloc(doc, x, 0, 0, iw, false), 0);
    const h = hTitre + hCorps + 2 * pad - 4;
    if (h <= H - HAUT - BAS) {
      if (h > reste()) page();
      doc.roundRect(M, y, LARG, h, 8, { fill: '#FFFFFF', stroke: C.line, lineWidth: 0.75 });
      let cy = y + pad;
      if (b.titre) {
        doc.paragraph(b.titre, M + pad, cy + 11, iw - (b.badge ? 90 : 0), { size: 11, bold: true, color: C.ink, leading: LEAD });
        if (b.badge) {
          const bw = doc.widthOf(b.badge, 8, true) + 14;
          doc.roundRect(M + LARG - pad - bw, cy, bw, 15, 7.5, { fill: TON_FOND[b.ton] || C.accentSoft });
          doc.text(b.badge, M + LARG - pad - bw / 2, cy + 10.5, { size: 8, bold: true, color: TON[b.ton] || C.accent, align: 'center' });
        }
        cy += hTitre;
      }
      for (const x of b.blocs) cy += bloc(doc, x, M + pad, cy, iw, true);
      y += h + 10;
      return;
    }
    // Encadré plus haut qu'une page : on déroule son contenu sans cadre.
    if (b.titre) poser({ t: 'h', text: b.titre, niveau: 2 }, M, LARG);
    for (const x of b.blocs) poser(x, M, LARG);
  };

  for (const b of items) {
    if (b.t === 'card') poserCarte(b);
    else {
      if (b.t === 'h' && reste() < 70) page();  // pas de titre orphelin en bas de page
      poser(b, M, LARG);
    }
  }

  // Pied de page sur chaque page.
  const n = doc.pages.length;
  const quand = new Date().toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
  for (let i = 0; i < n; i++) {
    doc.usePage(i);
    doc.line(M, H - 40, M + LARG, H - 40, { color: C.line, width: 0.5 });
    doc.text(`Généré par Pearl AI le ${quand} · chiffres calculés par Pearl · à relire avant diffusion`, M, H - 26, { size: 7.5, color: C.faint, maxWidth: LARG - 60 });
    doc.text(`${i + 1} / ${n}`, M + LARG, H - 26, { size: 7.5, color: C.faint, align: 'right' });
  }
  return doc.toBuffer();
}

module.exports = { rapportPdf, nettoyer };
