// Ouvre chaque page de l'application sur les deux serveurs (admin connecté),
// compare le texte affiché et les erreurs JavaScript. Usage : node compare-ui.js [filtre]
// playwright-core n'est pas une dépendance du projet (inutile en production) :
// on le cherche via PLAYWRIGHT_CORE, sinon dans les modules installés.
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PAGES_FILTER = process.argv[2];

async function open(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'UTC' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await p.goto(base + '/admin');
  await p.evaluate(async () => {
    const r = await fetch('/api/config/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'x' }) });
    sessionStorage.setItem('fo-admin-token', (await r.json()).token);
    localStorage.setItem('fo-identity', JSON.stringify({ name: 'Fatim NDOYE', huawei_id: 'hw123' }));
  });
  await p.goto(base + '/admin/app');
  await p.waitForTimeout(2500);
  return { p, errors, ctx };
}
const clean = t => String(t || '')
  .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, '<t>')
  .replace(/il y a \d+ ?\w+|à l’instant|\d+ ?(s|min|sec|seconds?|minutes?) ago/g, '<rel>')
  .replace(/[+-]?\d+h\s?\d{2}m/g, '<dur>').replace(/\b\d+(\.\d+)?\s?h\b/g, '<dur>')
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const A = await open(b, `http://localhost:${process.env.PO || 4001}`), B = await open(b, `http://localhost:${process.env.PN || 4002}`);
  const pages = await A.p.evaluate(() => [...document.querySelectorAll('.page[id^="page-"]')].map(e => e.id.slice(5)));
  let ko = 0, n = 0;
  const bootA = A.errors.splice(0), bootB = B.errors.splice(0);
  const newBoot = bootB.filter(e => !bootA.includes(e));
  if (newBoot.length) { ko++; console.log('✗ erreurs au chargement (nouvelles):\n   ' + newBoot.join('\n   ')); }
  for (const pg of pages) {
    if (PAGES_FILTER && !pg.includes(PAGES_FILTER)) continue;
    n++;
    const snap = async X => {
      await X.p.evaluate(pg => {
        document.querySelectorAll('.modal-overlay.open, .modal-overlay.show').forEach(m => m.classList.remove('open', 'show'));
        try { window.renderPage(pg); } catch (e) { console.error('renderPage threw: ' + e.message); }
      }, pg);
      await X.p.waitForTimeout(700);
      return X.p.evaluate(pg => { const el = document.getElementById('page-' + pg); return el ? el.innerText : '<absent>'; }, pg);
    };
    const [ta, tb] = [await snap(A), await snap(B)];
    const ea = A.errors.splice(0), eb = B.errors.splice(0).filter(e => !ea.includes(e));
    const ca = clean(ta), cb = clean(tb);
    if (ca !== cb || eb.length) {
      ko++;
      let i = 0; while (i < ca.length && ca[i] === cb[i]) i++;
      console.log(`✗ page ${pg}` + (eb.length ? `\n   nouvelles erreurs: ${eb.join(' | ').slice(0, 400)}` : '')
        + (ca !== cb ? `\n   texte @${i}: old «${ca.slice(Math.max(0, i - 60), i + 100).replace(/\n/g, '⏎')}»\n              new «${cb.slice(Math.max(0, i - 60), i + 100).replace(/\n/g, '⏎')}»` : ''));
    }
  }
  console.log(`\nUI : ${n} pages, ${ko} différence(s)`);
  await b.close();
  process.exitCode = ko ? 1 : 0;
})().catch(e => { console.error(e); process.exit(2); });
