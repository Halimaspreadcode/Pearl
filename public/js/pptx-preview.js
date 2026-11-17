/**
 * Aperçu du PPTX hebdomadaire, rendu depuis le fichier réel.
 *
 * Le module n'a aucune connaissance de la mise en page du deck : il ouvre
 * le .pptx généré par le serveur, lit l'OOXML de chaque slide et redessine
 * les formes en DOM. C'est le parti pris central — un aperçu qui
 * réimplémenterait la maquette dériverait du fichier dès la première
 * retouche de `weekly-pptx.js`, alors qu'ici toute modification du
 * générateur se voit dans l'aperçu sans rien changer de ce fichier.
 *
 * Ce que l'aperçu rend fidèlement : la géométrie (positions et tailles au
 * EMU près), les couleurs, les tableaux, le texte et ses graisses.
 * Ce qu'il ne rend pas à l'identique : le rendu typographique fin —
 * PowerPoint compose et coupe les lignes autrement que le navigateur, donc
 * un texte long peut se répartir sur les lignes différemment. La position
 * et le cadre du bloc, eux, sont exacts.
 *
 * Le deck n'utilise que des rectangles, du texte et des tableaux (cf. le
 * commentaire d'en-tête de weekly-pptx.js : pas d'addChart, les graphiques
 * sont dessinés en formes). Le parseur couvre donc exactement ce
 * vocabulaire — une forme d'un type non géré est ignorée plutôt que rendue
 * de travers.
 */

/* EMU : unité interne d'OOXML. 914400 par pouce. Toute la géométrie du
   fichier est exprimée ainsi ; on convertit en pouces puis en pixels au
   moment du rendu, via une échelle unique. */
const EMU_PER_IN = 914400;

// Corps de texte par défaut quand un run ne porte pas de `sz`, en
// centièmes de point comme dans le XML.
const DEFAULT_SZ = 1800;

const xmlEsc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ── Lecture du XML ───────────────────────────────────────────
   DOMParser en mode XML : les noms d'éléments OOXML sont qualifiés
   (`a:off`, `p:sp`), et getElementsByTagName les retrouve tels quels tant
   qu'on interroge avec le préfixe. On évite getElementsByTagNameNS, qui
   demanderait de résoudre les URI de namespace pour rien. */
function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error('XML de slide illisible');
  }
  return doc;
}

// Premier descendant portant ce nom qualifié, ou null. `el.children` étant
// vivant et récursif via getElementsByTagName, on borne volontairement à
// une recherche descendante simple : la structure OOXML est assez stricte
// pour que le premier trouvé soit le bon.
const first = (el, tag) => el ? el.getElementsByTagName(tag)[0] || null : null;

// Enfant direct uniquement. Nécessaire là où un même nom apparaît à
// plusieurs profondeurs : `a:solidFill` existe sous `p:spPr` (le
// remplissage de la forme) et sous `a:rPr` (la couleur du texte).
// Confondre les deux peint le texte avec la couleur du fond.
function directChild(el, tag) {
  if (!el) return null;
  for (const c of el.children) if (c.tagName === tag) return c;
  return null;
}

function directChildren(el, tag) {
  const out = [];
  if (!el) return out;
  for (const c of el.children) if (c.tagName === tag) out.push(c);
  return out;
}

/* Couleur d'un conteneur de remplissage. On ne gère que `a:srgbClr` :
   le générateur n'émet que des couleurs explicites, jamais de référence au
   thème. Un `a:schemeClr` renverrait null et la forme resterait sans
   remplissage plutôt que d'être peinte d'une couleur inventée. */
function solidColor(container) {
  const fill = directChild(container, 'a:solidFill');
  const clr  = fill && directChild(fill, 'a:srgbClr');
  const val  = clr && clr.getAttribute('val');
  return val ? `#${val}` : null;
}

/* Géométrie d'une forme, en pouces. Retourne null si la forme n'a pas de
   transformation propre : dans ce deck toutes les formes sont positionnées
   explicitement, donc une absence signale une forme héritée d'un layout,
   qu'on ne rend pas.

   Le nom de l'élément dépend du porteur : une forme le nomme `a:xfrm`,
   un `p:graphicFrame` (donc tout tableau) le nomme `p:xfrm`. Chercher
   uniquement le premier laissait tous les tableaux sans géométrie, et
   donc absents de l'aperçu. */
function frame(sp) {
  const xfrm = first(sp, 'a:xfrm') || first(sp, 'p:xfrm');
  const off  = xfrm && directChild(xfrm, 'a:off');
  const ext  = xfrm && directChild(xfrm, 'a:ext');
  if (!off || !ext) return null;
  return {
    x: +off.getAttribute('x')  / EMU_PER_IN,
    y: +off.getAttribute('y')  / EMU_PER_IN,
    w: +ext.getAttribute('cx') / EMU_PER_IN,
    h: +ext.getAttribute('cy') / EMU_PER_IN,
  };
}

/* Runs d'un `p:txBody`, groupés par paragraphe.
   Les sauts de ligne du générateur (`\n` dans un addText) sont émis comme
   des paragraphes distincts, pas comme `a:br` — mais on gère `a:br` aussi,
   pptxgenjs pouvant en produire selon les options. */
function readParagraphs(txBody) {
  if (!txBody) return [];
  return directChildren(txBody, 'a:p').map(p => {
    const pPr  = directChild(p, 'a:pPr');
    const algn = pPr && pPr.getAttribute('algn');
    const runs = [];
    for (const node of p.children) {
      if (node.tagName === 'a:br') {
        runs.push({ br: true });
        continue;
      }
      if (node.tagName !== 'a:r') continue;
      const rPr = directChild(node, 'a:rPr');
      const t   = directChild(node, 'a:t');
      runs.push({
        text:   t ? t.textContent : '',
        // sz est en centièmes de point : 900 => 9pt.
        sz:     rPr && rPr.getAttribute('sz') ? +rPr.getAttribute('sz') : null,
        bold:   !!(rPr && rPr.getAttribute('b') === '1'),
        italic: !!(rPr && rPr.getAttribute('i') === '1'),
        color:  rPr ? solidColor(rPr) : null,
        // Interlettrage, en centièmes de point également.
        spc:    rPr && rPr.getAttribute('spc') ? +rPr.getAttribute('spc') : null,
      });
    }
    return { algn, runs };
  }).filter(p => p.runs.length);
}

/* Interligne : `a:lnSpc` porte soit un pourcentage (lineSpacingMultiple),
   soit une valeur en points. On ne lit que le pourcentage, seul cas émis
   par le générateur. */
function lineSpacing(txBody) {
  const p    = txBody && directChild(txBody, 'a:p');
  const pPr  = p && directChild(p, 'a:pPr');
  const lnSpc = pPr && directChild(pPr, 'a:lnSpc');
  const pct  = lnSpc && directChild(lnSpc, 'a:spcPct');
  const val  = pct && pct.getAttribute('val');
  // val est en millièmes de pour-cent : 106000 => 1.06.
  return val ? +val / 100000 : null;
}

/* ── Extraction d'une slide ─────────────────────────────────── */

function readShape(sp) {
  const box = frame(sp);
  if (!box) return null;

  const spPr   = directChild(sp, 'p:spPr');
  const txBody = directChild(sp, 'p:txBody');
  const paras  = readParagraphs(txBody);
  const fill   = spPr ? solidColor(spPr) : null;

  // Une forme sans remplissage ni texte ne laisse aucune trace : on la
  // jette pour ne pas empiler des div vides.
  if (!fill && !paras.length) return null;

  const bodyPr = txBody && directChild(txBody, 'a:bodyPr');
  return {
    kind: 'shape',
    box,
    fill,
    paras,
    anchor:  bodyPr ? (bodyPr.getAttribute('anchor') || 't') : 't',
    lineSpc: lineSpacing(txBody),
  };
}

/* Tableau. Il vit dans un `p:graphicFrame` : la géométrie est sur le
   frame, la grille dans `a:tbl`. Les largeurs de colonne viennent de
   `a:gridCol`, les hauteurs de ligne de l'attribut `h` de `a:tr` — mais
   ces hauteurs sont des minimums en OOXML, PowerPoint agrandit une ligne
   dont le contenu déborde. On les utilise comme hauteurs minimales aussi,
   en laissant le contenu pousser. */
function readTable(gf) {
  const box = frame(gf);
  const tbl = first(gf, 'a:tbl');
  if (!box || !tbl) return null;

  const grid = first(tbl, 'a:tblGrid');
  const cols = grid
    ? directChildren(grid, 'a:gridCol')
        .map(c => +c.getAttribute('w') / EMU_PER_IN)
    : [];

  const rows = directChildren(tbl, 'a:tr').map(tr => ({
    h: +(tr.getAttribute('h') || 0) / EMU_PER_IN,
    cells: directChildren(tr, 'a:tc').map(tc => {
      const tcPr = directChild(tc, 'a:tcPr');
      return {
        paras: readParagraphs(directChild(tc, 'a:txBody')),
        fill:  tcPr ? solidColor(tcPr) : null,
        anchor: tcPr ? (tcPr.getAttribute('anchor') || 't') : 't',
      };
    }),
  }));

  return { kind: 'table', box, cols, rows };
}

function readSlide(xml) {
  const doc  = parseXml(xml);
  const tree = first(doc, 'p:spTree');
  if (!tree) return { bg: null, items: [] };

  // Fond de slide : `p:bg` porte l'aplat pleine page des couvertures.
  const bgPr = first(doc, 'p:bgPr');
  const bg   = bgPr ? solidColor(bgPr) : null;

  // L'ordre du document est l'ordre de superposition : on le conserve en
  // parcourant les enfants directs plutôt qu'en concaténant deux
  // getElementsByTagName, ce qui remonterait tous les tableaux après
  // toutes les formes et les ferait passer au-dessus.
  const items = [];
  for (const node of tree.children) {
    if (node.tagName === 'p:sp')                items.push(readShape(node));
    else if (node.tagName === 'p:graphicFrame') items.push(readTable(node));
  }
  return { bg, items: items.filter(Boolean) };
}

/* ── Rendu DOM ────────────────────────────────────────────────
   Tout est positionné en absolu dans un conteneur à l'échelle. Une seule
   variable d'échelle (px par pouce) : en la changeant, l'aperçu entier se
   redimensionne sans que rien ne se désaligne. */

const ANCHOR_FLEX = { t: 'flex-start', ctr: 'center', b: 'flex-end' };
const ALGN_CSS    = { l: 'left', ctr: 'center', r: 'right', just: 'justify' };

function renderParas(paras, lineSpc, scale) {
  return paras.map(p => {
    const align = p.algn ? (ALGN_CSS[p.algn] || 'left') : 'left';
    const html  = p.runs.map(r => {
      if (r.br) return '<br>';
      const sz = (r.sz || DEFAULT_SZ) / 100;   // centièmes de pt -> pt
      const css = [
        // Le corps est converti en pixels via la même échelle que la
        // géométrie : sinon le texte ne suivrait pas le zoom du cadre.
        `font-size:${(sz / 72 * scale).toFixed(2)}px`,
        r.bold   ? 'font-weight:700' : 'font-weight:400',
        r.italic ? 'font-style:italic' : '',
        r.color  ? `color:${r.color}` : '',
        r.spc    ? `letter-spacing:${(r.spc / 100 / 72 * scale).toFixed(2)}px` : '',
      ].filter(Boolean).join(';');
      return `<span style="${css}">${xmlEsc(r.text)}</span>`;
    }).join('');
    const ls = lineSpc ? `line-height:${lineSpc}` : 'line-height:1.2';
    return `<div style="text-align:${align};${ls}">${html}</div>`;
  }).join('');
}

function renderShape(it, scale) {
  const { box } = it;
  const style = [
    'position:absolute',
    `left:${(box.x * scale).toFixed(2)}px`,
    `top:${(box.y * scale).toFixed(2)}px`,
    `width:${(box.w * scale).toFixed(2)}px`,
    `height:${(box.h * scale).toFixed(2)}px`,
    it.fill ? `background:${it.fill}` : '',
    'display:flex',
    'flex-direction:column',
    `justify-content:${ANCHOR_FLEX[it.anchor] || 'flex-start'}`,
    // PowerPoint laisse déborder un texte trop grand pour son cadre sans
    // le rogner. On fait pareil : masquer ici cacherait justement les
    // débordements que l'aperçu doit permettre de repérer.
    'overflow:visible',
  ].filter(Boolean).join(';');

  const inner = it.paras.length
    ? `<div style="width:100%">${renderParas(it.paras, it.lineSpc, scale)}</div>`
    : '';
  return `<div style="${style}">${inner}</div>`;
}

function renderTable(it, scale) {
  const { box, cols, rows } = it;
  const total = cols.reduce((a, b) => a + b, 0) || box.w;
  const style = [
    'position:absolute',
    `left:${(box.x * scale).toFixed(2)}px`,
    `top:${(box.y * scale).toFixed(2)}px`,
    `width:${(total * scale).toFixed(2)}px`,
    'border-collapse:collapse',
    'table-layout:fixed',
  ].join(';');

  const colgroup = cols.map(w =>
    `<col style="width:${(w * scale).toFixed(2)}px">`).join('');

  const body = rows.map(r => {
    const cells = r.cells.map(c => {
      const cs = [
        c.fill ? `background:${c.fill}` : '',
        `vertical-align:${c.anchor === 'ctr' ? 'middle' : c.anchor === 'b' ? 'bottom' : 'top'}`,
        `padding:${(0.04 * scale).toFixed(1)}px ${(0.06 * scale).toFixed(1)}px`,
      ].filter(Boolean).join(';');
      return `<td style="${cs}">${renderParas(c.paras, null, scale)}</td>`;
    }).join('');
    const rs = r.h ? `height:${(r.h * scale).toFixed(2)}px` : '';
    return `<tr style="${rs}">${cells}</tr>`;
  }).join('');

  return `<table style="${style}"><colgroup>${colgroup}</colgroup><tbody>${body}</tbody></table>`;
}

function renderSlide(slide, dims, scale) {
  const style = [
    'position:relative',
    `width:${(dims.w * scale).toFixed(2)}px`,
    `height:${(dims.h * scale).toFixed(2)}px`,
    `background:${slide.bg || '#FFFFFF'}`,
    'overflow:hidden',
    'flex:none',
  ].join(';');
  const inner = slide.items.map(it =>
    it.kind === 'table' ? renderTable(it, scale) : renderShape(it, scale)
  ).join('');
  return `<div class="pptx-slide" style="${style}">${inner}</div>`;
}

/* ── Dimensions de la présentation ───────────────────────────
   Lues dans presentation.xml plutôt que codées en dur : si le générateur
   passe un jour d'un format 16:9 à un autre, l'aperçu suit. */
function readDims(xml) {
  const sz = first(parseXml(xml), 'p:sldSz');
  if (!sz) return { w: 13.333, h: 7.5 };
  return {
    w: +sz.getAttribute('cx') / EMU_PER_IN,
    h: +sz.getAttribute('cy') / EMU_PER_IN,
  };
}

/* Ordre des slides. Les noms de fichiers (`slide10.xml`) se trient mal en
   ASCII — slide10 arriverait avant slide2 — donc on trie sur l'entier
   extrait du nom. L'ordre réel est défini par presentation.xml et ses
   relations, mais pptxgenjs numérote toujours les fichiers dans l'ordre
   d'ajout, ce qui rend le tri numérique équivalent et bien plus simple. */
function slideEntries(zip) {
  return Object.keys(zip.files)
    .map(p => {
      const m = /^ppt\/slides\/slide(\d+)\.xml$/.exec(p);
      return m ? { path: p, n: +m[1] } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.n - b.n);
}

/**
 * Rend un .pptx (Blob ou ArrayBuffer) dans un conteneur DOM.
 * Retourne le nombre de slides rendues.
 */
async function renderPptxPreview(source, container, opts = {}) {
  if (typeof JSZip === 'undefined') {
    throw new Error('JSZip absent : impossible de lire le PPTX');
  }
  const buf  = source instanceof Blob ? await source.arrayBuffer() : source;
  const zip  = await JSZip.loadAsync(buf);

  const presFile = zip.file('ppt/presentation.xml');
  const dims = presFile ? readDims(await presFile.async('string'))
                        : { w: 13.333, h: 7.5 };

  const entries = slideEntries(zip);
  const scale   = opts.scale || 96;

  const html = [];
  for (const e of entries) {
    const xml = await zip.file(e.path).async('string');
    html.push(renderSlide(readSlide(xml), dims, scale));
  }
  container.innerHTML = html.join('');
  return entries.length;
}

window.renderPptxPreview = renderPptxPreview;
