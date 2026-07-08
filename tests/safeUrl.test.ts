import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { safeImageUrl } from '../src/shared/safeUrl.ts';

describe('safeImageUrl', () => {
  it('passes through https URLs', () => {
    assert.strictEqual(
      safeImageUrl('https://example.com/avatar.png'),
      'https://example.com/avatar.png',
    );
    assert.strictEqual(
      safeImageUrl('https://cdn.example.com/a/b.jpg?size=64#x'),
      'https://cdn.example.com/a/b.jpg?size=64#x',
    );
  });

  it('passes through http URLs', () => {
    assert.strictEqual(safeImageUrl('http://example.com/pic.gif'), 'http://example.com/pic.gif');
  });

  it('rejects javascript: URLs, including obfuscated schemes', () => {
    assert.strictEqual(safeImageUrl('javascript:alert(1)'), undefined);
    assert.strictEqual(safeImageUrl('JaVaScRiPt:alert(1)'), undefined);
    assert.strictEqual(safeImageUrl(' javascript:alert(1)'), undefined);
    assert.strictEqual(safeImageUrl('java\tscript:alert(1)'), undefined);
    assert.strictEqual(safeImageUrl('java\nscript:alert(1)'), undefined);
  });

  it('rejects data:, blob:, and vbscript: URLs', () => {
    assert.strictEqual(safeImageUrl('data:image/svg+xml,<svg onload=alert(1)>'), undefined);
    assert.strictEqual(safeImageUrl('blob:https://example.com/uuid'), undefined);
    assert.strictEqual(safeImageUrl('vbscript:msgbox(1)'), undefined);
    assert.strictEqual(safeImageUrl('chrome-extension://abc/img.png'), undefined);
  });

  it('rejects relative and malformed URLs', () => {
    assert.strictEqual(safeImageUrl('/images/avatar.png'), undefined);
    assert.strictEqual(safeImageUrl('avatar.png'), undefined);
    assert.strictEqual(safeImageUrl('//example.com/pic.png'), undefined);
    assert.strictEqual(safeImageUrl('not a url'), undefined);
  });

  it('returns undefined for empty/nullish input', () => {
    assert.strictEqual(safeImageUrl(undefined), undefined);
    assert.strictEqual(safeImageUrl(null), undefined);
    assert.strictEqual(safeImageUrl(''), undefined);
  });
});
