// Jeu de données isolé pour les tests qui passent par core/store.
//
// config/paths.js lit DATA_DIR une seule fois, au chargement : il faut donc
// appeler useTempDataDir() AVANT le premier require d'un module serveur.
// `node --test` lance chaque fichier dans son propre process, ce qui donne à
// chaque fichier un DATA_DIR neuf sans fuite d'un fichier à l'autre.
const fs   = require('fs');
const os   = require('os');
const path = require('path');

function writeFixture(dir, name, content) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(content, null, 2));
}

function readFixture(dir, name) {
  return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
}

function useTempDataDir(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emoc-test-'));
  for (const [name, content] of Object.entries(files)) writeFixture(dir, name, content);
  process.env.DATA_DIR = dir;
  // Nettoyage en fin de process : les fixtures ne doivent pas s'accumuler.
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
  return dir;
}

module.exports = { useTempDataDir, writeFixture, readFixture };
