import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

// Synthetic keys only, in a disposable browser. No user profile or system passkeys.
const directory = await mkdtemp(join(tmpdir(), 'nostr-passkey-smoke-'));
const extension = resolve(process.argv[2] || 'dist');
let blobRecovery = process.env.PASSKEY_SMOKE_BLOB === '1';
const relayRecovery = process.env.PASSKEY_SMOKE_RELAY === '1';
let context;
try {
  context = await chromium.launchPersistentContext(directory, {
    channel: 'chromium', headless: true, acceptDownloads: true, viewport: { width: 380, height: 600 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => {
    const events = new Map();
    class RecoveryRelay {
      readyState = 0;
      constructor() { queueMicrotask(() => { this.readyState = 1; this.onopen?.({}); }); }
      send(raw) {
        const message = JSON.parse(raw);
        const emit = frame => this.onmessage?.({ data: JSON.stringify(frame) });
        if (message[0] === 'EVENT') { events.set(message[1].id, message[1]); queueMicrotask(() => emit(['OK', message[1].id, true, 'saved'])); }
        if (message[0] === 'REQ') queueMicrotask(() => {
          const filter = message[2];
          for (const event of events.values()) if ((!filter.authors || filter.authors.includes(event.pubkey)) && (!filter.kinds || filter.kinds.includes(event.kind)) && (!filter['#d'] || event.tags.some(tag => tag[0] === 'd' && filter['#d'].includes(tag[1])))) emit(['EVENT', message[1], event]);
          emit(['EOSE', message[1]]);
        });
      }
      close() { this.readyState = 3; }
    }
    globalThis.WebSocket = RecoveryRelay;
  });
  const page = await context.newPage();
  const url = `chrome-extension://${new URL(worker.url()).host}/src/entrypoints/popup/index.html`;
  page.on('console', message => { if (message.text().startsWith('Synthetic blob')) console.log(message.text()); });
  page.on('pageerror', error => console.error('Synthetic page error:', error.message));
  await page.goto(url);
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal',
    hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
    automaticPresenceSimulation: true, hasPrf: true, hasLargeBlob: blobRecovery,
  } });
  const rpc = (method, params = {}) => page.evaluate(async ({ method, params }) => {
    const response = await globalThis.chrome.runtime.sendMessage({ method, params });
    if (response?.error) throw new Error(response.error);
    return response.result;
  }, { method, params });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Try other methods', exact: false }).waitFor();
  if (process.env.PASSKEY_SMOKE_SCREENSHOTS) await page.screenshot({ path: `${process.env.PASSKEY_SMOKE_SCREENSHOTS}/onboarding.png` });
  await page.getByRole('button', { name: 'Try other methods', exact: false }).click();
  await page.getByRole('button', { name: 'Restore passkey vault', exact: false }).waitFor();
  if (process.env.PASSKEY_SMOKE_SCREENSHOTS) await page.screenshot({ path: `${process.env.PASSKEY_SMOKE_SCREENSHOTS}/existing.png` });
  assert.equal(await page.locator('button strong').count(), 5);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.evaluate(() => {
    globalThis.passkeyRequestCount = 0; globalThis.passkeyRequestsPending = 0; globalThis.blobWritten = false;
    for (const method of ['create', 'get']) {
      const original = navigator.credentials[method].bind(navigator.credentials);
      navigator.credentials[method] = async (...args) => { globalThis.passkeyRequestCount++; globalThis.passkeyRequestsPending++; const writing = args[0]?.publicKey?.extensions?.largeBlob?.write; if (writing) console.log('Synthetic blob length:', writing.byteLength); const result = await original(...args).finally(() => globalThis.passkeyRequestsPending--); if (writing) globalThis.blobWritten = result.getClientExtensionResults().largeBlob?.written === true; if (writing) console.log('Synthetic blob result:', JSON.stringify(result.getClientExtensionResults().largeBlob)); return result; };
    }
  });
  await page.getByRole('button', { name: 'Create with passkey', exact: false }).click();
  await page.getByRole('button', { name: 'Download recovery file', exact: true }).or(page.getByRole('button', { name: 'Confirm', exact: true })).waitFor();
  await page.waitForFunction(() => globalThis.passkeyRequestsPending === 0);
  if (blobRecovery) blobRecovery = await page.evaluate(() => globalThis.blobWritten);
  if (relayRecovery) {
    await page.getByRole('button', { name: 'Save recovery to relays', exact: true }).click();
    await page.getByText(/Recovery saved to/).waitFor({ timeout: 12000 });
  }
  const setupRequests = await page.evaluate(() => globalThis.passkeyRequestCount);
  assert.ok(setupRequests <= (blobRecovery ? 3 : 2), `Too many setup requests: ${setupRequests}`);
  console.log(`Passkey setup requested ${setupRequests} browser credential operations.`);
  const accounts = await rpc('vault_listAccounts');
  assert.ok(accounts[0].name);
  assert.equal(accounts[0].mnemonic, undefined);
  const publicKey = accounts[0].pubkey;
  let backup;
  if (blobRecovery) {
    assert.equal(await page.getByRole('button', { name: 'Download recovery file', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Save recovery to relays', exact: true }).count(), 0);
    backup = await rpc('vault_exportPasskeyBackup');
  } else {
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download recovery file', exact: true }).click();
    const downloaded = await downloading;
    const file = await downloaded.path();
    backup = await readFile(file, 'utf8');
    assert.equal(JSON.parse(backup).vault.protection, 'passkey');
  }
  if (!blobRecovery) {
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Confirm', exact: true }).waitFor();
  assert.equal(await page.getByRole('checkbox', { name: 'Use passkey', exact: true }).isChecked(), true);
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await rpc('vault_lock');
  await page.getByRole('button', { name: 'Unlock with passkey', exact: true }).click();
  await page.waitForFunction(async () => (await globalThis.chrome.runtime.sendMessage({ method: 'vault_isLocked', params: {} })).result === false);
  assert.equal(await rpc('vault_getActivePubkey'), publicKey);
  if (blobRecovery || relayRecovery) {
    // Simulate a fresh install: retain the authenticator, remove all extension vault data.
    await rpc('vault_destroy');
  } else {
    await rpc('vault_removeAccount', { accountId: accounts[0].id });
    await rpc('vault_lock');
  }
  await page.reload();
  assert.equal(await rpc('vault_exists'), false);
  assert.equal(await page.getByRole('button', { name: 'Unlock with passkey', exact: true }).count(), 0);
  // Language preference can survive vault removal; handle both onboarding entries.
  await page.waitForFunction(() => globalThis.document.body.innerText.includes('Create with passkey') || globalThis.document.body.innerText.includes('English'));
  if (!await page.getByRole('button', { name: 'Try other methods', exact: false }).count()) await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Try other methods', exact: false }).click();
  await page.getByRole('button', { name: 'Restore passkey vault', exact: false }).click();
  if (!blobRecovery && !relayRecovery) {
    await page.locator('#passkey-file').waitFor();
    await page.locator('#passkey-file').setInputFiles({ name: 'vault.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
  }
  if (!blobRecovery && !relayRecovery) await page.getByRole('button', { name: /Restore passkey vault|Retry/, exact: true }).click();
  await page.waitForFunction(async expected => (await globalThis.chrome.runtime.sendMessage({ method: 'vault_getActivePubkey', params: {} })).result === expected, publicKey);
  await page.getByRole('button', { name: 'Confirm', exact: true }).waitFor();
  assert.equal(await page.getByRole('checkbox', { name: 'Use passkey', exact: true }).isChecked(), true);
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByText("You're all set!", { exact: true }).waitFor();
  const restoredKey = await rpc('vault_getActivePubkey');
  assert.equal(restoredKey, publicKey);
  // Completion is a self-closing dialog over Home; close it rather than wait three seconds.
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByText("You're all set!", { exact: true }).waitFor({ state: 'hidden' });
  const siteNotice = page.getByText('Navigate to a website to connect', { exact: true });
  if (await siteNotice.isVisible()) {
    await siteNotice.locator('..').locator('..').getByRole('button', { name: 'Close', exact: true }).click();
    await siteNotice.waitFor({ state: 'hidden' });
    await page.getByText('Edit profile', { exact: true }).waitFor();
    assert.equal(await page.getByText('Recent activity', { exact: true }).count(), 0);
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByText('Security', { exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Save recovery to passkey', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Passkey settings', exact: false }).click();
  await page.getByRole('button', { name: 'Download recovery file', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Add another passkey', exact: false }).waitFor();
  if (process.env.PASSKEY_SMOKE_SCREENSHOTS) { await page.waitForTimeout(700); await page.screenshot({ path: `${process.env.PASSKEY_SMOKE_SCREENSHOTS}/passkey-settings.png` });
    await page.getByRole('button', { name: 'Relay recovery', exact: true }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${process.env.PASSKEY_SMOKE_SCREENSHOTS}/passkey-relays.png` });
    await page.getByRole('dialog', { name: 'Relay recovery', exact: true }).getByRole('button', { name: 'Close', exact: true }).click(); }
  assert.equal(await page.locator('details').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Migrate to Nostr WoT passkey', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  const usePasskey = page.getByRole('checkbox', { name: 'Use passkey', exact: true });
  await usePasskey.waitFor({ state: 'attached' });
  await page.waitForFunction(() => globalThis.document.querySelector('input[aria-label="Use passkey"]')?.checked === true);
  if (process.env.PASSKEY_SMOKE_SCREENSHOTS) { await page.waitForTimeout(700); await page.screenshot({ path: `${process.env.PASSKEY_SMOKE_SCREENSHOTS}/security.png` }); }
  await usePasskey.locator('..').click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type="password"]').nth(0).fill('synthetic-switch-password');
  await dialog.locator('input[type="password"]').nth(1).fill('synthetic-switch-password');
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.waitForFunction(() => globalThis.document.querySelector('input[aria-label="Use passkey"]')?.checked === false);
  assert.equal((await rpc('vault_listPasskeys')).length, 1);
  assert.deepEqual(await rpc('vault_listPasskeys', { forUnlock: true }), []);
  await usePasskey.locator('..').click();
  await dialog.getByPlaceholder('Current password', { exact: true }).fill('synthetic-switch-password');
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.waitForFunction(() => globalThis.document.querySelector('input[aria-label="Use passkey"]')?.checked === true);
  assert.equal(await rpc('vault_getActivePubkey'), publicKey);
  console.log('Security switch passed: password and passkey round trip preserves identity and enrollment.');
  await page.getByRole('button', { name: 'None', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.waitForFunction(async () => (await globalThis.chrome.runtime.sendMessage({ method: 'vault_getAutoLock' })).result === 0);
  await page.getByRole('button', { name: '15 min', exact: true }).click();
  await page.locator('input[type="password"]').nth(0).fill('synthetic-restored-password');
  await page.locator('input[type="password"]').nth(1).fill('synthetic-restored-password');
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.waitForFunction(async () => (await globalThis.chrome.runtime.sendMessage({ method: 'vault_getAutoLock' })).result === 900000);
  await page.locator('input[type="password"]').first().waitFor({ state: 'hidden' });
  assert.equal(await rpc('vault_isLocked'), false);
  const profileEvent = { kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify({ name: 'Synthetic profile' }) };
  assert.equal((await rpc('signEvent', { event: profileEvent })).pubkey, publicKey);
  await rpc('vault_lock');
  await page.getByPlaceholder('Enter password', { exact: true }).fill('synthetic-restored-password');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.getByPlaceholder('Enter password', { exact: true }).waitFor({ state: 'hidden' });
  assert.equal((await rpc('signEvent', { event: profileEvent })).pubkey, publicKey);
  console.log('None → password browser regression passed: signing, lock prompt and password unlock preserve identity.');
  // Older installations may retain an encrypted empty vault. Opening setup must
  // not prompt for unlocking, nor silently delete a vault based on public metadata.
  await rpc('vault_destroy');
  await rpc('vault_create', { password: 'synthetic-empty-vault', payload: { accounts: [], activeAccountId: null } });
  await rpc('vault_lock');
  await page.reload();
  await page.getByRole('button', { name: 'Try other methods', exact: false }).waitFor();
  await page.getByRole('button', { name: 'Try other methods', exact: false }).click();
  assert.equal(await page.getByRole('button', { name: 'Unlock with passkey', exact: true }).count(), 0);
  assert.equal(await rpc('vault_exists'), true);
  assert.equal(await rpc('vault_isLocked'), true);
  console.log(`Passkey browser smoke passed: PRF enrollment, seed-free creation, ${blobRecovery ? 'confirmed blob storage and fresh-install discovery' : relayRecovery ? 'relay fallback and fresh-install discovery' : 'file fallback and empty-vault restore'}, lock/unlock preserve identity.`);
} catch (error) {
  const openPage = context?.pages().at(-1);
  if (openPage) console.error('Synthetic smoke page:', (await openPage.locator('body').innerText()).slice(-1800));
  throw error;
} finally {
  await context?.close();
  await rm(directory, { recursive: true, force: true });
}
