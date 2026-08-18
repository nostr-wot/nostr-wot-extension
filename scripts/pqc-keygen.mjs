#!/usr/bin/env node
/**
 * Generate a post-quantum key pair and a signed kind:10203 attestation, locally.
 *
 * Everything happens on this machine. Nothing is sent anywhere: the script prints an
 * event you can inspect and publish yourself. Your mnemonic is never written to disk.
 *
 *   npm run pqc:keygen                       # prompts for your seed phrase
 *   npm run pqc:keygen -- --new              # generates a fresh 24-word identity
 *   npm run pqc:keygen -- --account 1        # a different NIP-06 account index
 *   npm run pqc:keygen -- --out event.json   # also write the event to a file
 *
 * To generate keys for an account that cannot derive them (a 12-word seed, or one
 * imported from an nsec), write a key file and import it in the extension:
 *
 *   npm run pqc:keygen -- --independent --keyfile keys.json
 *
 * Seed-derived keys require a 24-word mnemonic. A 12-word mnemonic has 128 bits of
 * entropy, which would become the weakest link, so this script refuses to label such
 * keys as seed-derived. Use --independent to generate a standalone key pair instead
 * (backed up separately, not recoverable from your words).
 */

import { createInterface } from 'node:readline/promises';
import { stdin, stdout, argv, exit } from 'node:process';
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

import { generateMnemonic, mnemonicToSeed, validateMnemonic } from '../lib/crypto/bip39.js';
import { derivePath } from '../lib/crypto/bip32.js';
import { getPublicKey } from '../lib/crypto/secp256k1.js';
import { signEvent } from '../lib/crypto/nip01.js';
import { bytesToHex } from '../lib/crypto/utils.js';
import { npubEncode } from '../lib/crypto/bech32.js';
import {
  derivePqKeys, popMessage, signPop,
  ALG_KEM, ALG_DSA, PQ_PROFILE,
} from '../lib/crypto/pq.js';

const PQC_KIND = 10203;
const b64 = (u8) => Buffer.from(u8).toString('base64');

function arg(name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

function die(message) {
  console.error(`\n  ${message}\n`);
  exit(1);
}

async function readMnemonic() {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  console.log('\n  Your seed phrase stays on this machine and is never written to disk.');
  const answer = await rl.question('  Seed phrase: ');
  rl.close();
  return answer.trim().replace(/\s+/g, ' ');
}

async function main() {
  const account = Number(arg('account', '0'));
  if (!Number.isInteger(account) || account < 0) die('--account must be a non-negative integer.');

  const independent = arg('independent') === true;
  let mnemonic = null;

  if (arg('new') === true) {
    mnemonic = await generateMnemonic(256);
    console.log('\n  A new 24-word identity. Write these down — they are the only way to restore it.\n');
    console.log('  ' + mnemonic.split(' ').map((w, i) => `${i + 1}.${w}`).join('  ') + '\n');
  } else if (!independent) {
    mnemonic = await readMnemonic();
    if (!mnemonic) die('No seed phrase given.');
    if (!(await validateMnemonic(mnemonic))) die('That is not a valid BIP-39 mnemonic.');
  }

  let seed = null;
  let origin;
  let seedStrength = null;

  if (independent) {
    // No seed: a standalone key pair, backed up separately.
    seed = randomBytes(64);
    origin = 'independent';
  } else {
    const words = mnemonic.split(' ').length;
    if (words !== 24) {
      die(
        `That is a ${words}-word phrase. Seed-derived post-quantum keys require 24 words (256 bits);\n` +
        `  a ${words}-word phrase carries only ${words === 12 ? 128 : '<256'} bits, which would be the weakest link.\n\n` +
        `  Either create a new 24-word identity (--new), or generate a standalone key that is\n` +
        `  backed up separately rather than recovered from your words (--independent).`
      );
    }
    seed = await mnemonicToSeed(mnemonic);
    origin = 'derived';
    seedStrength = '256';
  }

  const { kem, dsa } = derivePqKeys(seed, account);

  // --keyfile writes the pair in the shape the extension imports. That flow needs no
  // identity key at all: the extension signs the attestation with the account's own
  // key once the keys are in its vault. So a keyfile-only run must not demand --nsec.
  const keyfilePath = arg('keyfile');
  const b64kem = b64(kem.secretKey);
  const b64dsa = b64(dsa.secretKey);

  if (typeof keyfilePath === 'string') {
    writeFileSync(keyfilePath, JSON.stringify({
      v: PQ_PROFILE,
      origin,
      alg: { kem: ALG_KEM, dsa: ALG_DSA },
      kem: { public: b64(kem.publicKey), secret: b64(kem.secretKey) },
      dsa: { public: b64(dsa.publicKey), secret: b64(dsa.secretKey) },
    }, null, 2) + '\n', { mode: 0o600 });
    console.log(`\n  Key file written to ${keyfilePath} (mode 0600).`);
    console.log('  It contains SECRET keys. Import it in the extension under');
    console.log('  Menu -> Security -> Post-quantum key, then store it somewhere safe or delete it.\n');
  }

  // The signing key. For --independent we need one to sign the attestation — unless the
  // run was only asked for a key file, in which case there is nothing left to sign.
  let privkey;
  if (independent) {
    const nsec = arg('nsec');
    if (typeof nsec !== 'string') {
      // No identity to sign with, and none needed: the extension signs the attestation
      // once these keys are in its vault. Print the secrets so they can be pasted
      // straight into the import box — the extension recomputes the public halves.
      console.log('\n  Post-quantum secret keys. The extension derives the public keys from these.');
      console.log('  Paste both lines into Menu -> Security -> Post-quantum key.\n');
      console.log(`  ${ALG_KEM} secret: ${b64kem}`);
      console.log(`  ${ALG_DSA} secret: ${b64dsa}\n`);
      console.log('  These are NOT recoverable from any seed phrase. Back them up before you');
      console.log('  close this terminal, or the messages sent to them become unreadable.\n');
      if (seed) seed.fill(0);
      kem.secretKey.fill(0);
      dsa.secretKey.fill(0);
      return;
    }
    if (!/^[0-9a-f]{64}$/i.test(nsec)) die('--nsec must be a 64-character hex private key.');
    privkey = Uint8Array.from(Buffer.from(nsec, 'hex'));
  } else {
    privkey = await derivePath(seed, `m/44'/1237'/${account}'/0/0`);
  }

  const pubkeyHex = bytesToHex(getPublicKey(privkey));

  const kemB64 = b64(kem.publicKey);
  const dsaB64 = b64(dsa.publicKey);
  const pop = signPop(popMessage(pubkeyHex, kemB64, dsaB64), dsa.secretKey);

  const tags = [
    ['alg', ALG_KEM, kemB64],
    ['alg', ALG_DSA, dsaB64],
    ['origin', origin],
    ...(seedStrength ? [['seed_strength', seedStrength]] : []),
    ['v', PQ_PROFILE],
    ['pop', ALG_DSA, b64(pop)],
  ];

  const event = await signEvent(
    {
      kind: PQC_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: '',
    },
    privkey,
  );

  const json = JSON.stringify(event);

  console.log(`\n  identity      ${npubEncode(pubkeyHex)}`);
  console.log(`  ${ALG_KEM.padEnd(13)} ${kem.publicKey.length} bytes`);
  console.log(`  ${ALG_DSA.padEnd(13)} ${dsa.publicKey.length} bytes`);
  console.log(`  origin        ${origin}${seedStrength ? ` (${seedStrength}-bit seed)` : ''}`);
  console.log(`  event         ${json.length} bytes\n`);

  if (origin === 'independent') {
    console.log('  This key is NOT recoverable from a seed phrase. Back up the secret keys below');
    console.log('  separately, or you will lose the ability to read messages sent to it.\n');
    console.log(`  ${ALG_KEM} secret: ${b64kem}`);
    console.log(`  ${ALG_DSA} secret: ${b64dsa}\n`);
  } else {
    console.log('  These keys are recoverable from your seed phrase alone. Nothing extra to back up.\n');
  }

  const out = arg('out');
  if (typeof out === 'string') {
    writeFileSync(out, json + '\n');
    console.log(`  Written to ${out}\n`);
  } else {
    console.log('  Attestation event (publish this to your relays):\n');
    console.log(json + '\n');
  }

  privkey.fill(0);
  if (seed) seed.fill(0);
}

main().catch((e) => die(e?.message || String(e)));
