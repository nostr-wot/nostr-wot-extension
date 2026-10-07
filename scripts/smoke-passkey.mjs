import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

// Synthetic keys only, in a disposable browser. No user profile or system passkeys.
const directory = await mkdtemp(join(tmpdir(), 'nostr-passkey-smoke-'));
const extension = resolve(process.argv[2] || 'dist');
const blobRecovery = process.env.PASSKEY_SMOKE_BLOB === '1';
let context;
try {
  context = await chromium.launchPersistentContext(directory, {
    channel: 'chromium', headless: true, acceptDownloads: true, viewport: { width: 380, height: 600 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  const url = `chrome-extension://${new URL(worker.url()).host}/src/entrypoints/popup/index.html`;
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
  await page.getByRole('button', { name: 'More options', exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Restore passkey vault', exact: false }).count(), 0);
  if (process.env.PASSKEY_SMOKE_SCREENSHOTS) await page.screenshot({ path: `${process.env.PASSKEY_SMOKE_SCREENSHOTS}/onboarding.png` });
  await page.getByRole('button', { name: 'More options', exact: false }).click();
  await page.getByRole('button', { name: 'Restore passkey vault', exact: false }).waitFor();
  if (process.env.PASSKEY_SMOKE_SCREENSHOTS) await page.screenshot({ path: `${process.env.PASSKEY_SMOKE_SCREENSHOTS}/more-options.png` });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Create with passkey', exact: false }).click();
  await page.locator('#passkey-name').fill('Synthetic passkey account');
  await page.getByRole('button', { name: 'Create with passkey', exact: true }).click();
  if (blobRecovery) {
    await page.getByRole('button', { name: 'Skip for now', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Download recovery file', exact: true }).count(), 0);
  } else {
    await page.getByRole('button', { name: 'Download recovery file', exact: true }).waitFor();
  }
  const accounts = await rpc('vault_listAccounts');
  assert.equal(accounts[0].name, 'Synthetic passkey account');
  assert.equal(accounts[0].mnemonic, undefined);
  const publicKey = accounts[0].pubkey;
  let backup;
  if (!blobRecovery) {
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download recovery file', exact: true }).click();
    const downloaded = await downloading;
    const file = await downloaded.path();
    backup = await readFile(file, 'utf8');
    assert.equal(JSON.parse(backup).vault.protection, 'passkey');
  }
  await rpc('vault_lock');
  await page.getByRole('button', { name: 'Unlock with passkey', exact: true }).click();
  await page.waitForFunction(async () => (await globalThis.chrome.runtime.sendMessage({ method: 'vault_isLocked', params: {} })).result === false);
  assert.equal(await rpc('vault_getActivePubkey'), publicKey);
  if (blobRecovery) {
    // Simulate a fresh install: retain the authenticator, remove all extension vault data.
    await rpc('vault_destroy');
  } else {
    await rpc('vault_removeAccount', { accountId: accounts[0].id });
    await rpc('vault_lock');
  }
  await page.reload();
  // An existing encrypted vault still requires authentication after restart.
  if (!blobRecovery) {
    await page.getByRole('button', { name: 'Unlock with passkey', exact: true }).click();
    await page.waitForFunction(async () => (await globalThis.chrome.runtime.sendMessage({ method: 'vault_isLocked', params: {} })).result === false);
  }
  // Language preference can survive vault removal; handle both onboarding entries.
  await page.waitForFunction(() => globalThis.document.body.innerText.includes('More options') || globalThis.document.body.innerText.includes('English'));
  if (!await page.getByRole('button', { name: 'More options', exact: false }).count()) await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'More options', exact: false }).click();
  const restore = page.getByRole('button', { name: 'Restore passkey vault', exact: false });
  await restore.click();
  if (!blobRecovery) {
    await page.getByRole('button', { name: 'Use a recovery file', exact: true }).click();
    await page.locator('#passkey-file').setInputFiles({ name: 'vault.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
  }
  await page.getByRole('button', { name: 'Restore passkey vault', exact: true }).click();
  await page.waitForFunction(async expected => (await globalThis.chrome.runtime.sendMessage({ method: 'vault_getActivePubkey', params: {} })).result === expected, publicKey);
  await page.getByText("You're all set!", { exact: true }).waitFor();
  const restoredKey = await rpc('vault_getActivePubkey');
  assert.equal(restoredKey, publicKey);
  console.log(`Passkey browser smoke passed: PRF enrollment, seed-free creation, ${blobRecovery ? 'verified blob storage and fresh-install discovery' : 'file fallback and empty-vault restore'}, lock/unlock preserve identity.`);
} finally {
  await context?.close();
  await rm(directory, { recursive: true, force: true });
}
