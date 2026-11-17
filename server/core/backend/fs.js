// Pilote « fichiers » : le fonctionnement historique. Un fichier JSON par
// document, écrit de façon atomique ; les blobs sont des fichiers bruts.
const fs   = require('fs');
const path = require('path');

const fsBackend = {
  kind: 'fs',
  async ensureTenant() {},
  isLoaded() { return true; },
  readText(file) { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } },
  writeText(file, text, { mode } = {}) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, text, mode ? { mode } : undefined);
    fs.renameSync(tmp, file);
  },
  exists(file) { return fs.existsSync(file); },
  remove(file) { try { fs.unlinkSync(file); } catch {} },
  version(file) { try { const s = fs.statSync(file); return `${s.mtimeMs}:${s.size}`; } catch { return null; } },
  // Documents JSON d'un dossier de tenant (premier niveau).
  listDocs(dir) {
    try { return fs.readdirSync(dir).filter(f => f.endsWith('.json') && fs.statSync(path.join(dir, f)).isFile()); }
    catch { return []; }
  },
  async getBlob(file) { try { return fs.readFileSync(file); } catch { return null; } },
  async putBlob(file, buf) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, buf); fs.renameSync(tmp, file);
  },
  async removeBlobs(dir, prefix) {
    try { for (const f of fs.readdirSync(dir)) if (f.startsWith(prefix)) fs.unlinkSync(path.join(dir, f)); } catch {}
  },
  async flush() {},
};

module.exports = fsBackend;
