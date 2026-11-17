// scripts/service.js : fichiers de service générés par « npm run service:install ».
// Seule la génération est testée — installer un vrai service demanderait
// sudo et modifierait la machine.
const test = require('node:test');
const assert = require('node:assert/strict');
const { unitSystemd, plistLaunchd } = require('../scripts/service.js');

const ctx = { root: '/home/zabbix/Documents/fo_ops', node: '/home/zabbix/.nvm/versions/node/v20.19.3/bin/node', user: 'zabbix' };

test('unité systemd : chemins absolus, utilisateur, relance et arrêt propre', () => {
  const u = unitSystemd(ctx);
  assert.match(u, /^User=zabbix$/m);
  assert.match(u, /^WorkingDirectory=\/home\/zabbix\/Documents\/fo_ops$/m);
  assert.match(u, /^ExecStart=\/home\/zabbix\/\.nvm\/versions\/node\/v20\.19\.3\/bin\/node \/home\/zabbix\/Documents\/fo_ops\/server\/watchdog\.js$/m);
  assert.match(u, /^Restart=always$/m);
  assert.match(u, /^Environment=WATCHDOG_SUPERVISED=1$/m);
  assert.match(u, /^KillMode=mixed$/m);
  assert.match(u, /^WantedBy=multi-user\.target$/m);
});

test('plist launchd : démarre à l\'ouverture, relancé, caractères XML échappés', () => {
  const p = plistLaunchd({ root: '/Users/a&b/fops', node: '/usr/local/bin/node' });
  assert.match(p, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(p, /<key>KeepAlive<\/key><true\/>/);
  assert.match(p, /<key>WATCHDOG_SUPERVISED<\/key><string>1<\/string>/);
  assert.match(p, /<string>\/Users\/a&amp;b\/fops\/server\/watchdog\.js<\/string>/);
  assert.doesNotMatch(p, /a&b/);
});
