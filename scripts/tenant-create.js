#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════
// CRÉER UNE ORGANISATION (ou un administrateur de plateforme)
//
//   npm run tenant:create -- --name "Acme Services" --pack support-it \
//       --owner boss@acme.com [--owner-name "Alice"] [--slug acme] \
//       [--sites "LYO:Lyon,PAR:Paris"] [--modules core,tickets,planning]
//
//   npm run tenant:create -- --platform-admin root@exemple.com [--password …]
//
//   npm run tenant:create -- --list-packs
//
// Utilise le stockage et les comptes configurés dans .env (STORE,
// SUPABASE_*, DATABASE_URL). Sans --password, un mot de passe provisoire
// est généré et affiché une seule fois.
// ══════════════════════════════════════════════════════════════
require('dotenv').config({ quiet: true });

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const has = name => args.includes(`--${name}`);

(async () => {
  const { listPacks, provisionTenant } = require('../server/platform/provision');
  const accounts = require('../server/platform/accounts');
  const { registry, backend } = require('../server/core/backend');

  if (has('list-packs')) {
    for (const p of listPacks()) console.log(`${p.id.padEnd(20)} ${p.label} — ${p.modules.join(', ')}`);
    return;
  }

  if (opt('platform-admin')) {
    const email = opt('platform-admin');
    if (!accounts.validEmail(email)) throw new Error('Email invalide.');
    const p = accounts.provider();
    let user = await p.findByEmail(email), temp = null;
    if (!user) user = await p.createUser(email, opt('password') || (temp = accounts.tempPassword()));
    else if (opt('password')) await p.setPassword(user.id, opt('password'));
    await registry().addPlatformAdmin(user.id);
    console.log(`Administrateur de la plateforme : ${user.email}`);
    if (temp) console.log(`Mot de passe provisoire (à changer) : ${temp}`);
    return;
  }

  const name = opt('name');
  if (!name) {
    console.log('Usage : npm run tenant:create -- --name "Acme" --pack support-it --owner boss@acme.com');
    console.log('        npm run tenant:create -- --platform-admin root@exemple.com');
    console.log('        npm run tenant:create -- --list-packs');
    process.exitCode = 1;
    return;
  }
  const sites = opt('sites') ? opt('sites').split(',').map(x => { const [code, ...n] = x.split(':'); return { code, name: n.join(':') || code }; }) : undefined;
  const r = await provisionTenant({
    name, slug: opt('slug'), pack: opt('pack'), sites,
    modules: opt('modules') ? opt('modules').split(',') : undefined,
    status: opt('status') || 'active', plan: opt('plan') || 'standard',
    owner: opt('owner') ? { email: opt('owner'), name: opt('owner-name'), password: opt('password') } : null,
  });
  await backend().flush();
  const base = process.env.PEARL_BASE_DOMAIN || 'localhost';
  console.log(`Organisation créée : ${r.tenant.name} (${r.tenant.slug}) → https://${r.tenant.slug}.${base}`);
  if (r.owner) console.log(`Propriétaire : ${r.owner.email}`);
  if (r.tempPassword) console.log(`Mot de passe provisoire (à transmettre une seule fois) : ${r.tempPassword}`);
})().catch(e => { console.error('Échec :', e.message); process.exit(1); });
