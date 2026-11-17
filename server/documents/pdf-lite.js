/**
 * pdf-lite — générateur PDF minimal, sans dépendance.
 *
 * Le projet évite les nouvelles dépendances npm (node_modules est copié
 * tel quel sur la VM) : ce module couvre juste ce qu'il faut pour un
 * rapport vectoriel propre.
 *
 *   · PDF 1.4, pages A4 portrait par défaut ;
 *   · polices standard Type1 Helvetica / Helvetica-Bold, jamais
 *     embarquées (tout lecteur PDF les fournit), en WinAnsiEncoding pour
 *     que les accents français (é è à ç…) passent ;
 *   · métriques AFM d'Helvetica pour mesurer, couper, aligner à droite et
 *     tronquer le texte ;
 *   · rectangles (arrondis ou non), lignes, cercles, secteurs d'anneau.
 *
 * Coordonnées : origine en HAUT à gauche, en points (1/72 pouce), y vers
 * le bas — la conversion vers le repère PDF (origine en bas) est faite
 * ici. Pour le texte, `y` désigne la ligne de base.
 */

const zlib = require('zlib');

// ── MÉTRIQUES ─────────────────────────────────────────────────
// Largeurs AFM (unités /1000 em) pour les codes WinAnsi 32..255.
// Codes 127..159 non définis dans WinAnsi → largeur de l'espace ou 0.
/* eslint-disable max-len */
const W_REG = [
  278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278, // 32-47
  556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556, // 48-63
  1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778, // 64-79
  667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556, // 80-95
  333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556, // 96-111
  556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,350, // 112-127
  556,350,222,556,333,1000,556,556,333,1000,667,333,1000,350,611,350, // 128-143
  350,222,222,333,333,350,556,1000,333,1000,500,333,944,350,500,667, // 144-159
  278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333, // 160-175
  400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611, // 176-191
  667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278, // 192-207
  722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611, // 208-223
  556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278, // 224-239
  556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500, // 240-255
];
const W_BOLD = [
  278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278, // 32-47
  556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611, // 48-63
  975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778, // 64-79
  667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556, // 80-95
  333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611, // 96-111
  611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,350, // 112-127
  556,350,278,556,500,1000,556,556,333,1000,667,333,1000,350,611,350, // 128-143
  350,278,278,500,500,350,556,1000,333,1000,556,333,944,350,500,667, // 144-159
  278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333, // 160-175
  400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611, // 176-191
  722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278, // 192-207
  722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611, // 208-223
  556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278, // 224-239
  611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556, // 240-255
];
/* eslint-enable max-len */

// Unicode → WinAnsi pour la plage 128..159 (le reste de Latin-1 est
// identique), plus quelques repli pour les signes hors table.
const UNI_TO_WIN = {
  0x20AC: 128, 0x201A: 130, 0x0192: 131, 0x201E: 132, 0x2026: 133,
  0x2020: 134, 0x2021: 135, 0x02C6: 136, 0x2030: 137, 0x0160: 138,
  0x2039: 139, 0x0152: 140, 0x017D: 142, 0x2018: 145, 0x2019: 146,
  0x201C: 147, 0x201D: 148, 0x2022: 149, 0x2013: 150, 0x2014: 151,
  0x02DC: 152, 0x2122: 153, 0x0161: 154, 0x203A: 155, 0x0153: 156,
  0x017E: 158, 0x0178: 159,
};
const FALLBACK = {
  '→': '->', '←': '<-', '≥': '>=', '≤': '<=', '≠': '!=', '−': '-',
  ' ': ' ', ' ': ' ', '‑': '-', '✓': 'v', '⚠': '!',
};

/** Chaîne JS → tableau d'octets WinAnsi (caractères inconnus → '?'). */
function toWinAnsi(str) {
  const out = [];
  for (const ch of String(str ?? '')) {
    if (FALLBACK[ch]) { for (const c of FALLBACK[ch]) out.push(c.charCodeAt(0)); continue; }
    const cp = ch.codePointAt(0);
    if (cp === 9) { out.push(32); continue; }
    if (cp < 32) continue;
    if (cp < 128 || (cp >= 160 && cp <= 255)) out.push(cp);
    else if (UNI_TO_WIN[cp]) out.push(UNI_TO_WIN[cp]);
    else {
      // Lettre accentuée hors Latin-1 : on garde la lettre de base.
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      const bc = base.codePointAt(0);
      out.push(base.length === 1 && bc < 128 ? bc : 63);
    }
  }
  return out;
}

function widthOf(str, size, bold) {
  const tbl = bold ? W_BOLD : W_REG;
  let w = 0;
  for (const c of toWinAnsi(str)) w += tbl[c - 32] || 278;
  return (w * size) / 1000;
}

/** Tronque avec une ellipse pour tenir dans `maxW`. */
function truncate(str, maxW, size, bold) {
  str = String(str ?? '');
  if (widthOf(str, size, bold) <= maxW) return str;
  const ell = '…';
  const ellW = widthOf(ell, size, bold);
  let lo = 0, hi = str.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (widthOf(str.slice(0, mid), size, bold) + ellW <= maxW) lo = mid; else hi = mid - 1;
  }
  return str.slice(0, lo).trimEnd() + ell;
}

/** Coupe un paragraphe en lignes d'au plus `maxW` points. */
function wrap(str, maxW, size, bold) {
  const lines = [];
  for (const para of String(str ?? '').split('\n')) {
    let cur = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = cur ? cur + ' ' + word : word;
      if (widthOf(next, size, bold) <= maxW) { cur = next; continue; }
      if (cur) lines.push(cur);
      // Mot plus long que la ligne : on le tronque plutôt que déborder.
      cur = widthOf(word, size, bold) > maxW ? truncate(word, maxW, size, bold) : word;
    }
    lines.push(cur);
  }
  return lines;
}

// ── DOCUMENT ──────────────────────────────────────────────────
const n2 = v => (Math.round(v * 100) / 100).toString();

function rgb(hex) {
  const h = String(hex || '#000').replace('#', '');
  const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h.padEnd(6, '0');
  return [0, 2, 4].map(i => n2(parseInt(f.slice(i, i + 2), 16) / 255)).join(' ');
}

function pdfString(bytes) {
  let s = '(';
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5C) s += '\\' + String.fromCharCode(b);
    else s += String.fromCharCode(b);
  }
  return s + ')';
}

const K = 0.5522847498; // approximation d'un quart de cercle par Bézier

class PdfDoc {
  constructor({ width = 595.28, height = 841.89, title = '', author = '' } = {}) {
    this.width = width;
    this.height = height;
    this.title = title;
    this.author = author;
    this.pages = [];
    this.page = null;
  }

  addPage() {
    this.page = { ops: [] };
    this.pages.push(this.page);
    return this.page;
  }

  /** Bascule le dessin sur une page existante (ex. pieds de page). */
  usePage(i) { this.page = this.pages[i]; }

  _op(s) { this.page.ops.push(s); }
  _y(y) { return this.height - y; }

  _paint({ fill, stroke, lineWidth = 0.75, dash } = {}) {
    let pre = 'q ';
    if (fill) pre += rgb(fill) + ' rg ';
    if (stroke) pre += rgb(stroke) + ' RG ' + n2(lineWidth) + ' w ';
    if (dash) pre += `[${dash.join(' ')}] 0 d `;
    const op = fill && stroke ? 'B' : fill ? 'f' : stroke ? 'S' : 'n';
    return { pre, op };
  }

  rect(x, y, w, h, opts = {}) {
    if (w <= 0 || h <= 0) return this;
    if (opts.radius) return this.roundRect(x, y, w, h, opts.radius, opts);
    const { pre, op } = this._paint(opts);
    this._op(`${pre}${n2(x)} ${n2(this._y(y + h))} ${n2(w)} ${n2(h)} re ${op} Q`);
    return this;
  }

  /** Rectangle arrondi ; `r` peut être un nombre ou [tl, tr, br, bl]. */
  roundRect(x, y, w, h, r, opts = {}) {
    if (w <= 0 || h <= 0) return this;
    const lim = Math.min(w, h) / 2;
    const [tl, tr, br, bl] = (Array.isArray(r) ? r : [r, r, r, r]).map(v => Math.max(0, Math.min(v, lim)));
    const { pre, op } = this._paint(opts);
    const X = v => n2(v), Y = v => n2(this._y(v));
    const c = (x1, y1, x2, y2, x3, y3) => `${X(x1)} ${Y(y1)} ${X(x2)} ${Y(y2)} ${X(x3)} ${Y(y3)} c `;
    let p = `${X(x + tl)} ${Y(y)} m `;
    p += `${X(x + w - tr)} ${Y(y)} l `;
    if (tr) p += c(x + w - tr + tr * K, y, x + w, y + tr - tr * K, x + w, y + tr);
    p += `${X(x + w)} ${Y(y + h - br)} l `;
    if (br) p += c(x + w, y + h - br + br * K, x + w - br + br * K, y + h, x + w - br, y + h);
    p += `${X(x + bl)} ${Y(y + h)} l `;
    if (bl) p += c(x + bl - bl * K, y + h, x, y + h - bl + bl * K, x, y + h - bl);
    p += `${X(x)} ${Y(y + tl)} l `;
    if (tl) p += c(x, y + tl - tl * K, x + tl - tl * K, y, x + tl, y);
    this._op(`${pre}${p}h ${op} Q`);
    return this;
  }

  line(x1, y1, x2, y2, { color = '#000', width = 0.75, dash, cap } = {}) {
    const { pre } = this._paint({ stroke: color, lineWidth: width, dash });
    const lc = cap === 'round' ? '1 J ' : '';
    this._op(`${pre}${lc}${n2(x1)} ${n2(this._y(y1))} m ${n2(x2)} ${n2(this._y(y2))} l S Q`);
    return this;
  }

  _circlePath(cx, cy, r) {
    const X = v => n2(v), Y = v => n2(this._y(v));
    const k = r * K;
    let p = `${X(cx + r)} ${Y(cy)} m `;
    p += `${X(cx + r)} ${Y(cy + k)} ${X(cx + k)} ${Y(cy + r)} ${X(cx)} ${Y(cy + r)} c `;
    p += `${X(cx - k)} ${Y(cy + r)} ${X(cx - r)} ${Y(cy + k)} ${X(cx - r)} ${Y(cy)} c `;
    p += `${X(cx - r)} ${Y(cy - k)} ${X(cx - k)} ${Y(cy - r)} ${X(cx)} ${Y(cy - r)} c `;
    p += `${X(cx + k)} ${Y(cy - r)} ${X(cx + r)} ${Y(cy - k)} ${X(cx + r)} ${Y(cy)} c h `;
    return p;
  }

  circle(cx, cy, r, opts = {}) {
    const { pre, op } = this._paint(opts);
    this._op(`${pre}${this._circlePath(cx, cy, r)}${op} Q`);
    return this;
  }

  // Segments de Bézier d'un arc (angles en radians, 0 = midi, sens
  // horaire), chacun ≤ 90° pour rester précis.
  _arcPath(cx, cy, r, a0, a1, moveTo) {
    const pt = a => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
    const X = v => n2(v), Y = v => n2(this._y(v));
    const segs = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2)));
    const step = (a1 - a0) / segs;
    const [sx, sy] = pt(a0);
    let p = moveTo ? `${X(sx)} ${Y(sy)} m ` : `${X(sx)} ${Y(sy)} l `;
    for (let i = 0; i < segs; i++) {
      const s = a0 + i * step, e = s + step;
      const t = (4 / 3) * Math.tan((e - s) / 4);
      const [x0, y0] = pt(s), [x3, y3] = pt(e);
      // Tangente en a (sens horaire) : (cos a, sin a) en repère y-bas.
      const x1 = x0 + t * r * Math.cos(s), y1 = y0 + t * r * Math.sin(s);
      const x2 = x3 - t * r * Math.cos(e), y2 = y3 - t * r * Math.sin(e);
      p += `${X(x1)} ${Y(y1)} ${X(x2)} ${Y(y2)} ${X(x3)} ${Y(y3)} c `;
    }
    return p;
  }

  /** Secteur d'anneau (donut) ; rInner = 0 donne une part de camembert. */
  arcBand(cx, cy, rOuter, rInner, a0, a1, opts = {}) {
    if (a1 - a0 <= 0) return this;
    if (a1 - a0 >= Math.PI * 2 - 1e-6) {
      // Anneau complet : deux cercles, règle pair-impair pour le trou.
      const { pre } = this._paint(opts);
      const hole = rInner > 0 ? this._circlePath(cx, cy, rInner) : '';
      this._op(`${pre}${this._circlePath(cx, cy, rOuter)}${hole}f* Q`);
      return this;
    }
    const { pre, op } = this._paint(opts);
    let p = this._arcPath(cx, cy, rOuter, a0, a1, true);
    if (rInner > 0) {
      // Retour par l'arc intérieur, en sens inverse.
      const inner = this._arcPath(cx, cy, rInner, a1, a0, false);
      p += inner;
    } else {
      p += `${n2(cx)} ${n2(this._y(cy))} l `;
    }
    this._op(`${pre}${p}h ${op} Q`);
    return this;
  }

  /**
   * Texte sur une ligne. `y` = ligne de base.
   * opts: size, bold, color, align ('left'|'right'|'center'), maxWidth
   * (tronque avec ellipse), charSpace.
   */
  text(str, x, y, { size = 10, bold = false, color = '#111', align = 'left', maxWidth, charSpace } = {}) {
    let s = String(str ?? '');
    if (!s) return 0;
    if (maxWidth) s = truncate(s, maxWidth, size, bold);
    let w = widthOf(s, size, bold);
    if (charSpace) w += charSpace * Math.max(0, [...s].length - 1);
    const tx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    // Tc fait partie de l'état graphique et survit à ET : toujours le poser.
    const cs = `${n2(charSpace || 0)} Tc `;
    this._op(`BT ${rgb(color)} rg /${bold ? 'F2' : 'F1'} ${n2(size)} Tf ${cs}${n2(tx)} ${n2(this._y(y))} Td ${pdfString(toWinAnsi(s))} Tj ET`);
    return w;
  }

  /** Paragraphe coupé ; renvoie la hauteur occupée. */
  paragraph(str, x, y, maxW, { size = 10, bold = false, color = '#111', leading = 1.35, maxLines } = {}) {
    let lines = wrap(str, maxW, size, bold);
    if (maxLines && lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] = truncate(lines[maxLines - 1] + ' …', maxW, size, bold);
    }
    lines.forEach((ln, i) => this.text(ln, x, y + i * size * leading, { size, bold, color }));
    return lines.length * size * leading;
  }

  widthOf(s, size, bold) { return widthOf(s, size, bold); }
  truncate(s, w, size, bold) { return truncate(s, w, size, bold); }
  wrap(s, w, size, bold) { return wrap(s, w, size, bold); }

  toBuffer() {
    const chunks = [];
    const offsets = [];
    let len = 0;
    const push = b => { const buf = Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1'); chunks.push(buf); len += buf.length; };
    const obj = (id, body) => { offsets[id] = len; push(`${id} 0 obj\n`); push(body); push('\nendobj\n'); };

    if (!this.pages.length) this.addPage();
    const nPages = this.pages.length;
    // 1 catalogue, 2 arbre de pages, 3-4 polices, 5 info, puis page/contenu.
    const pageId = i => 6 + i * 2;
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Count ${nPages} /Kids [${this.pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] >>`);
    obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const d = new Date();
    const pad = v => String(v).padStart(2, '0');
    const date = `D:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
    obj(5, `<< /Title ${pdfString(toWinAnsi(this.title))} /Author ${pdfString(toWinAnsi(this.author))} /Producer (Pearl pdf-lite) /CreationDate (${date}) >>`);

    this.pages.forEach((pg, i) => {
      const id = pageId(i);
      obj(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n2(this.width)} ${n2(this.height)}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${id + 1} 0 R >>`);
      const raw = Buffer.from(pg.ops.join('\n'), 'latin1');
      const data = zlib.deflateSync(raw);
      offsets[id + 1] = len;
      push(`${id + 1} 0 obj\n<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`);
      push(data);
      push('\nendstream\nendobj\n');
    });

    const total = 6 + nPages * 2;
    const xref = len;
    let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
    for (let i = 1; i < total; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    push(x);
    push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return Buffer.concat(chunks);
  }
}

module.exports = { PdfDoc, widthOf, truncate, wrap, toWinAnsi };
