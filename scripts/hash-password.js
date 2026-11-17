#!/usr/bin/env node
// Génère le condensé bcrypt d'un mot de passe, à coller dans .env.
// Usage :  node scripts/hash-password.js "mon mot de passe"
//
// Le mot de passe est passé en argument : pensez à purger l'historique du
// shell si le poste est partagé (`history -d`), ou utilisez l'entrée
// interactive ci-dessous en lançant la commande sans argument.

const bcrypt   = require('bcryptjs');
const readline = require('readline');

const ROUNDS = 12;

function emit(pw) {
  if (!pw) {
    console.error('Mot de passe vide — abandon.');
    process.exit(1);
  }
  console.log('\n' + bcrypt.hashSync(pw, ROUNDS) + '\n');
  console.log('Collez cette valeur dans .env, p. ex. :');
  console.log('  CONFIG_PW_HASH=<valeur ci-dessus>\n');
}

const fromArgs = process.argv.slice(2).join(' ').trim();
if (fromArgs) { emit(fromArgs); return; }

// Sans argument : saisie interactive, pour ne rien laisser dans l'historique.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Mot de passe : ', answer => { rl.close(); emit(answer.trim()); });
