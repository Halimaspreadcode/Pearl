// ── INTERFACE TERMINAL ────────────────────────────────────────
// Logo, étapes animées, encadré de résumé — pour `npm run service:*` et le
// démarrage du watchdog. Sans dépendance : codes ANSI.
//
// Animé seulement dans un vrai terminal. Dans un journal (systemd, launchd,
// redirection vers un fichier) ou avec NO_COLOR, tout se dégrade en texte
// simple : un journal truffé de codes d'échappement est illisible.
const TTY = (!!process.stdout.isTTY || process.env.FORCE_COLOR === '1') && !process.env.NO_COLOR && process.env.TERM !== 'dumb';

const esc = c => (TTY ? `\x1b[${c}m` : '');
const c256 = n => esc(`38;5;${n}`);
const R = esc(0), B = esc(1), DIM = esc(2);
const VERT = c256(114), ROUGE = c256(203), JAUNE = c256(221), GRIS = c256(245), BLEU = c256(75);

// Dégradé rouge → orange → ambre, la couleur de la marque dans l'app.
const DEGRADE = [197, 203, 209, 215, 221, 227];

const LOGO = [
  '███████╗  ██████╗  ██████╗  ███████╗',
  '██╔════╝ ██╔═══██╗ ██╔══██╗ ██╔════╝',
  '█████╗   ██║   ██║ ██████╔╝ ███████╗',
  '██╔══╝   ██║   ██║ ██╔═══╝  ╚════██║',
  '██║      ╚██████╔╝ ██║      ███████║',
  '╚═╝       ╚═════╝  ╚═╝      ╚══════╝',
];

const pause = ms => new Promise(r => setTimeout(r, ms));
const visible = s => s.replace(/\x1b\[[0-9;]*m/g, '');

// Colore une ligne en dégradé horizontal, caractère par caractère.
function degrade(ligne, decalage = 0) {
  if (!TTY) return ligne;
  const n = ligne.length;
  return [...ligne].map((ch, i) => {
    // Diagonale : la teinte avance avec la colonne et un peu avec la ligne,
    // bornée à la dernière couleur (un modulo ferait revenir le rouge).
    const k = Math.min(DEGRADE.length - 1, Math.floor((i / Math.max(1, n - 1)) * (DEGRADE.length - 1.2) + decalage));
    return c256(DEGRADE[k]) + ch;
  }).join('') + R;
}

async function banniere(sousTitre) {
  console.log('');
  if (!TTY) { console.log(`Pearl — ${sousTitre}`); return; }
  for (let i = 0; i < LOGO.length; i++) {
    process.stdout.write('  ' + degrade(LOGO[i], i * 0.12) + '\n');
    await pause(45);
  }
  // Soulignement qui se trace de gauche à droite.
  const larg = LOGO[0].length;
  for (let k = 1; k <= larg; k += 2) {
    process.stdout.write('\r  ' + degrade('─'.repeat(k)));
    await pause(6);
  }
  process.stdout.write('\r  ' + degrade('─'.repeat(larg)) + '\n');
  console.log(`  ${B}${sousTitre}${R}\n`);
}

const TRAME = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// Une étape : animation pendant `fn`, puis ✓ / ⚠ / ✗. `fn` peut renvoyer
// une chaîne (détail affiché à droite) ou lever une erreur (✗ + message).
// Renvoie la valeur de `fn`.
async function etape(libelle, fn) {
  const t0 = Date.now();
  let i = 0, timer = null;
  if (TTY) {
    process.stdout.write('\x1b[?25l');   // curseur masqué pendant l'animation
    timer = setInterval(() => {
      const s = ((Date.now() - t0) / 1000).toFixed(1);
      process.stdout.write(`\r  ${c256(DEGRADE[i % DEGRADE.length])}${TRAME[i++ % TRAME.length]}${R} ${libelle} ${DIM}${s}s${R}\x1b[K`);
    }, 80);
  }
  const fin = (icone, detail) => {
    if (timer) clearInterval(timer);
    const d = detail ? ` ${GRIS}${detail}${R}` : '';
    process.stdout.write((TTY ? `\r\x1b[K\x1b[?25h` : '') + `  ${icone} ${libelle}${d}\n`);
  };
  try {
    const r = await fn();
    const avert = r && typeof r === 'object' && r.avertissement;
    fin(avert ? `${JAUNE}⚠${R}` : `${VERT}✓${R}`, avert ? r.avertissement : (typeof r === 'string' ? r : ''));
    return r;
  } catch (e) {
    fin(`${ROUGE}✗${R}`, e.message.split('\n')[0]);
    throw e;
  }
}

// Ligne d'information alignée sous les étapes.
const info  = (cle, val) => console.log(`  ${GRIS}${cle.padEnd(8)}${R} ${val}`);
const ok    = m => console.log(`  ${VERT}✓${R} ${m}`);
const avert = m => console.log(`  ${JAUNE}⚠${R} ${m}`);
const echec = m => console.log(`  ${ROUGE}✗${R} ${m}`);

// Encadré de fin. `lignes` peut contenir des couleurs : la largeur est
// calculée sur le texte visible.
function cadre(titre, lignes, couleur = VERT) {
  const larg = Math.max(visible(titre).length, ...lignes.map(l => visible(l).length)) + 2;
  const b = TTY ? couleur : '';
  const pad = s => s + ' '.repeat(larg - visible(s).length - 1);
  console.log('');
  console.log(`  ${b}╭${'─'.repeat(larg)}╮${R}`);
  console.log(`  ${b}│${R} ${B}${pad(titre)}${R}${b}│${R}`);
  console.log(`  ${b}├${'─'.repeat(larg)}┤${R}`);
  for (const l of lignes) console.log(`  ${b}│${R} ${pad(l)}${b}│${R}`);
  console.log(`  ${b}╰${'─'.repeat(larg)}╯${R}\n`);
}

// Le curseur doit réapparaître même sur Ctrl-C en pleine animation.
if (TTY) process.on('exit', () => process.stdout.write('\x1b[?25h'));

module.exports = { TTY, banniere, etape, info, ok, avert, echec, cadre, degrade, B, R, DIM, VERT, ROUGE, JAUNE, GRIS, BLEU };
