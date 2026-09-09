/**
 * What the post-quantum surfaces say.
 *
 * The property worth pinning: an unreachable relay read is NOT "nothing is
 * published". Coercing it to that tells a user who has already published to go
 * and set it up again — and the code that got this right did so in a comment
 * that nothing enforced, while a sibling file got it wrong.
 *
 * Run with:
 *   node --import tsx --test tests/pqc-state.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  derivePqcCardState,
  isAlreadyPublished,
  type PqcStatus,
  type PqcPublished,
} from '../src/domain/pqc/pqcState.ts';

const status = (over: Partial<PqcStatus> = {}): PqcStatus => ({
  canDerive: true, canImport: false, source: 'derived', reason: null, ...over,
});
const pub = (over: Partial<PqcPublished> = {}): PqcPublished => ({
  published: true, current: true, ...over,
});

describe('derivePqcCardState — a failed read is unknown, not negative', () => {
  it('says nothing when the relays were unreachable', () => {
    assert.equal(derivePqcCardState(status(), pub({ unreachable: true })), null);
  });

  it('says nothing when the publish check did not come back at all', () => {
    assert.equal(derivePqcCardState(status(), null), null);
  });

  it('never reports "setup" on an unreachable read', () => {
    // The specific regression: unreachable coerced to published:false rendered
    // "Set up post-quantum keys" to someone whose attestation was live.
    const s = derivePqcCardState(status(), pub({ published: false, unreachable: true }));
    assert.notEqual(s, 'setup');
    assert.equal(s, null);
  });
});

describe('derivePqcCardState — the ordinary cases', () => {
  it('published and current is enabled', () => {
    assert.equal(derivePqcCardState(status(), pub()), 'enabled');
  });

  it('published but not current is stale', () => {
    assert.equal(derivePqcCardState(status(), pub({ current: false })), 'stale');
  });

  it('derivable but nothing published is setup', () => {
    assert.equal(derivePqcCardState(status(), pub({ published: false })), 'setup');
  });

  it('offers import only where imported keys could be used', () => {
    assert.equal(derivePqcCardState(status({ canDerive: false, canImport: true }), null), 'import');
    // Not derivable and not importable is a dead end — advertise nothing.
    assert.equal(derivePqcCardState(status({ canDerive: false, canImport: false }), null), null);
  });

  it('says nothing when the status read itself failed', () => {
    assert.equal(derivePqcCardState(null, pub()), null);
  });
});

describe('isAlreadyPublished', () => {
  it('is true right after a successful publish, before any re-check', () => {
    assert.equal(isAlreadyPublished(null, true), true);
  });

  it('is true when the relays confirm a current attestation', () => {
    assert.equal(isAlreadyPublished(pub()), true);
  });

  it('is false when published but out of date', () => {
    assert.equal(isAlreadyPublished(pub({ current: false })), false);
  });

  it('is false on an unreachable read — we do not know, so do not claim', () => {
    assert.equal(isAlreadyPublished(pub({ unreachable: true })), false);
  });

  it('is false when nothing was read', () => {
    assert.equal(isAlreadyPublished(null), false);
  });
});

import { mergePqcStatus, mergePqcPublished, type PqcPanelStatus } from '../src/domain/pqc/pqcState.ts';
it('PQ refresh failure retains evidence, but account and key changes clear it', () => {
  const account = {...status(),pubkey:'a',keys:{kem:'k',dsa:'d'},wordCount:24,attestation:null} as PqcPanelStatus;
  const previous = {status:account,published:pub()};
  assert.deepEqual(mergePqcStatus(previous,account).published,pub());
  assert.equal(mergePqcStatus(previous,{...account,pubkey:'b'}).published,null);
  assert.equal(mergePqcStatus(previous,{...account,keys:{kem:'new',dsa:'d'}}).published,null);
  assert.deepEqual(mergePqcPublished(pub(),{published:false,current:false,unreachable:true}),pub());
  assert.deepEqual(mergePqcPublished(pub(),null),pub());
  assert.deepEqual(mergePqcPublished(pub(),{published:true,current:false}),{published:true,current:false});
});
