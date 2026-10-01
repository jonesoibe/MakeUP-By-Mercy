#!/usr/bin/env node
/*
 * Reset (or create) the admin password directly in the database.
 *
 *   npm run admin:reset
 *
 * Use it when you cannot sign in: for example the account still has the old
 * default password (which the site now refuses), or you have forgotten it.
 *
 * It reads MONGODB_URI from your .env (or the environment), asks for the new
 * password without echoing it, and updates the account. The password is never
 * printed or stored anywhere except as a bcrypt hash in the database.
 *
 * Non-interactive use (CI, a hosting shell): set NEW_ADMIN_PASSWORD. Set
 * ADMIN_USERNAME to reset a different account (default: admin).
 */

if (process.env.NODE_ENV !== 'test') {
  require('dotenv').config();
}

const readline = require('readline');
const mongoose = require('mongoose');
const bcryptjs = require('bcryptjs');

const MIN_LENGTH = 12;
const KNOWN_DEFAULT_PASSWORD = 'admin123';

function fail(message) {
  console.error(`\nNothing was changed: ${message}`);
  process.exit(1);
}

// Ask for a value without showing what is typed
function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => { if (!rl.muted) rl.output.write(text); };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    rl.muted = true;
  });
}

async function chooseNewPassword() {
  if (process.env.NEW_ADMIN_PASSWORD) return process.env.NEW_ADMIN_PASSWORD;

  if (!process.stdin.isTTY) {
    fail('no terminal to ask for a password. Run it in a terminal, or set NEW_ADMIN_PASSWORD.');
  }
  const first = await promptHidden(`New password (at least ${MIN_LENGTH} characters): `);
  const second = await promptHidden('Type it again to confirm: ');
  if (first !== second) fail('the two passwords did not match.');
  return first;
}

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) fail('MONGODB_URI is not set. Put it in your .env file, or set it in the environment.');

  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = await chooseNewPassword();

  if (password === KNOWN_DEFAULT_PASSWORD) fail('that is the old default password, which is refused. Choose a different one.');
  if (password.length < MIN_LENGTH) fail(`the password must be at least ${MIN_LENGTH} characters.`);

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  } catch (error) {
    fail(`could not connect to the database (${error.message}).`);
  }

  const hash = await bcryptjs.hash(password, 10);
  const admins = mongoose.connection.collection('admins');
  const result = await admins.updateOne(
    { username },
    {
      $set: { password: hash, active: true },
      $setOnInsert: { username, email: process.env.OWNER_EMAIL || 'admin@makeup-mercy.com', role: 'admin', createdAt: new Date() }
    },
    { upsert: true }
  );

  console.log(result.upsertedCount
    ? `\nCreated the '${username}' account. You can sign in now.`
    : `\nPassword updated for '${username}'. You can sign in now.`);

  await mongoose.disconnect();
})().catch((error) => fail(error.message));
