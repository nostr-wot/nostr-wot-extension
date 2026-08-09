import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(here, '../../scripts/pqc-keygen.mjs');

const NIP06_MNEMONIC =
  'what bleak badge arrange retreat wolf trade produce cricket blur garlic valid proud rude strong choose busy staff weather area salt hollow arm fade';
const NIP06_PUBKEY = 'd41b22899549e1f3d335a31002cfd382174006e166d3e658e3a5eecdb6463573';
const TWELVE_WORDS =
  'leader monkey parrot ring guide accident before fence cannon height naive bean';

async function keygen(input: string, args: string[] = []) {
  const child = execFile('node', ['--import', 'tsx', SCRIPT, ...args]);
  child.stdin?.write(input + '\n');
  child.stdin?.end();
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (d) => (stdout += d));
  child.stderr?.on('data', (d) => (stderr += d));
  const code: number = await new Promise((res) => child.on('close', res));
  return { code, stdout, stderr };
}

describe('pqc-keygen CLI', () => {
  it('produces a signed kind:10203 attestation from a 24-word mnemonic', async () => {
    const { code, stdout } = await keygen(NIP06_MNEMONIC);
    assert.strictEqual(code, 0, stdout);

    const json = stdout.slice(stdout.lastIndexOf('{"kind"')).trim();
    const event = JSON.parse(json);

    assert.strictEqual(event.kind, 10203);
    assert.strictEqual(event.pubkey, NIP06_PUBKEY);
    assert.match(event.sig, /^[0-9a-f]{128}$/);
    assert.match(event.id, /^[0-9a-f]{64}$/);

    const tag = (n: string) => event.tags.find((t: string[]) => t[0] === n);
    const algs = event.tags.filter((t: string[]) => t[0] === 'alg');
    assert.strictEqual(algs.length, 2);
    assert.ok(algs.some((t: string[]) => t[1] === 'ml-kem-1024'));
    assert.ok(algs.some((t: string[]) => t[1] === 'ml-dsa-87'));

    assert.deepStrictEqual(tag('origin'), ['origin', 'derived']);
    assert.deepStrictEqual(tag('seed_strength'), ['seed_strength', '256']);
    assert.deepStrictEqual(tag('v'), ['v', 'nip-pqc/v1']);
    assert.strictEqual(tag('pop')?.[1], 'ml-dsa-87');
  });

  it('the attestation it emits actually verifies', async () => {
    const { stdout } = await keygen(NIP06_MNEMONIC);
    const event = JSON.parse(stdout.slice(stdout.lastIndexOf('{"kind"')).trim());

    const { verifyEvent } = await import('../../lib/crypto/nip01.ts');
    assert.ok(await verifyEvent(event), 'schnorr signature must verify');

    const { verifyPop, popMessage } = await import('../../lib/crypto/pq.ts');
    const alg = (n: string) =>
      event.tags.find((t: string[]) => t[0] === 'alg' && t[1] === n)![2];
    const pop = event.tags.find((t: string[]) => t[0] === 'pop')![2];
    const bin = (b64: string) => Uint8Array.from(Buffer.from(b64, 'base64'));

    assert.ok(
      verifyPop(
        bin(pop),
        popMessage(event.pubkey, alg('ml-kem-1024'), alg('ml-dsa-87')),
        bin(alg('ml-dsa-87')),
      ),
      'proof of possession must verify',
    );
  });

  it('is deterministic — the same mnemonic yields the same keys', async () => {
    const a = await keygen(NIP06_MNEMONIC);
    const b = await keygen(NIP06_MNEMONIC);
    const keysOf = (out: string) => {
      const e = JSON.parse(out.slice(out.lastIndexOf('{"kind"')).trim());
      return e.tags.filter((t: string[]) => t[0] === 'alg').map((t: string[]) => t[2]);
    };
    assert.deepStrictEqual(keysOf(a.stdout), keysOf(b.stdout));
  });

  it('refuses to derive from a 12-word mnemonic', async () => {
    const { code, stderr } = await keygen(TWELVE_WORDS);
    assert.notStrictEqual(code, 0, 'must exit non-zero');
    assert.match(stderr, /12-word phrase/);
    assert.match(stderr, /require 24 words/);
    assert.match(stderr, /--independent/);
  });

  it('rejects an invalid mnemonic', async () => {
    const { code, stderr } = await keygen('not actually a seed phrase at all');
    assert.notStrictEqual(code, 0);
    assert.match(stderr, /not a valid BIP-39 mnemonic/);
  });
});
