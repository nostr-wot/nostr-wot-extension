import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerUninstallFeedback } from '../src/services/background/uninstall-feedback.ts';

test('registers the official feedback page without user identifiers', async () => {
  let registered = '';
  await registerUninstallFeedback({ async setUninstallURL(url) { registered = url; } });
  assert.equal(registered, 'https://nostr-wot.com/uninstall');
});
test('unsupported browsers are a safe no-op', async () => {
  await assert.doesNotReject(registerUninstallFeedback({}));
});
test('API errors do not stop the background worker', async () => {
  await assert.doesNotReject(registerUninstallFeedback({ async setUninstallURL() { throw new Error('Unavailable'); } }));
});
