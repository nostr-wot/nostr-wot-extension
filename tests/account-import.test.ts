import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectImportType } from '../src/domain/accounts/importInput.ts';
import { countWords } from '../src/utils/text.ts';

describe('account import format detection', () => {
  it('recognizes encrypted keys before private keys and trims surrounding whitespace', () => {
    assert.equal(detectImportType('  ncryptsec1candidate\n'), 'ncryptsec');
    assert.equal(detectImportType('nsec1candidate'), 'nsec');
  });
  it('recognizes exactly 64 hexadecimal characters, including uppercase', () => {
    assert.equal(detectImportType('aB'.repeat(32)), 'nsec');
    for (const value of ['a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64)]) {
      assert.equal(detectImportType(value), null);
    }
  });
  it('recognizes supported mnemonic lengths across spaces, tabs and newlines', () => {
    for (const length of [12, 24]) {
      assert.equal(detectImportType(Array(length).fill('word').join(' \t\n')), 'mnemonic');
    }
    for (const length of [1, 11, 13, 15, 18, 21, 23, 25]) {
      assert.equal(detectImportType(Array(length).fill('word').join(' ')), null);
    }
  });
  it('returns no hint for empty input or a public key', () => {
    for (const value of ['', ' \n\t ', 'npub1candidate']) assert.equal(detectImportType(value), null);
  });
  it('only classifies the format: cryptographic validation remains required', () => {
    assert.equal(detectImportType('nsec1invalid-checksum'), 'nsec');
    assert.equal(detectImportType(Array(12).fill('not-a-bip39-word').join(' ')), 'mnemonic');
  });
});

describe('countWords', () => {
  it('counts whitespace-separated words without counting empty segments', () => {
    assert.equal(countWords(''), 0);
    assert.equal(countWords(' \t\n '), 0);
    assert.equal(countWords('  one\ttwo\nthree  '), 3);
    assert.equal(countWords('one'), 1);
  });
});
