import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { finalizeEvent, getPublicKey, nip04 } from 'nostr-tools';

// Disposable profile and synthetic keys; never touches an installed extension.
const directory = await mkdtemp(join(tmpdir(), 'archive-explorer-smoke-'));
const extension = resolve(process.argv[2] || 'dist');
let context;
try {
  context = await chromium.launchPersistentContext(directory, { channel: 'chromium', headless: true, viewport: { width: 380, height: 600 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  let page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/entrypoints/popup/index.html`);
  const rpc = (method, params = {}) => page.evaluate(async ({ method, params }) => {
    const response = await globalThis.chrome.runtime.sendMessage({ method, params });
    if (response.error) throw new Error(response.error);
    return response.result;
  }, { method, params });
  const key = new Uint8Array(32).fill(7);
  const pubkey = getPublicKey(key);
  const validation = await rpc('onboarding_validateNsec', { input: Buffer.from(key).toString('hex') });
  await rpc('onboarding_createVault', { account: validation.account, password: 'synthetic-smoke-password', name: 'Archive test', autoLockMinutes: 15 });
  const accountId = validation.account.id;
  await page.evaluate(async pubkey => {
    await globalThis.chrome.storage.local.set({ language: 'en', [`profile_${pubkey}`]: { metadata: { name: 'Archive test' }, fetchedAt: Date.now() } });
    await globalThis.chrome.storage.sync.set({ language: 'en' });
  }, pubkey);
  const session = await rpc('archive_importBegin', { accountId });
  for (let index = 0; index < 3; index++) {
    const event = finalizeEvent({ kind: index === 2 ? 9999 : 1, created_at: 1700000000 + index, content: index === 2 ? 'Custom event payload' : `A note from the archive ${index + 1}`, tags: [] }, key);
    await rpc('archive_importChunk', { accountId, sessionId: session.sessionId, line: JSON.stringify(event) });
  }
  for (let index = 0; index < 2; index++) {
    const content = await nip04.encrypt(key, pubkey, `Private archive message ${index}`);
    const event = finalizeEvent({ kind: 4, created_at: 1700000100 + index, content, tags: [['p', pubkey]] }, key);
    await rpc('archive_importChunk', { accountId, sessionId: session.sessionId, line: JSON.stringify(event) });
  }
  await rpc('archive_importFinish', { accountId, sessionId: session.sessionId });
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByText('Archive', { exact: true }).click();
  const opened = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Explore events', exact: true }).click();
  const popup = page;
  page = await opened;
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.waitForURL('**/src/entrypoints/archive/index.html?accountId=*');
  await popup.close();
  await page.getByText('5 matching events', { exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Messages', exact: true }).click();
  await page.getByText('2 matching events', { exact: true }).waitFor();
  assert.equal(await page.getByText('Private archive message 0', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Click to decrypt', exact: true }).first().click();
  await page.getByText(/^Private archive message /).waitFor();
  await page.getByRole('button', { name: 'Decrypt all', exact: true }).click();
  await page.getByText('Private archive message 0', { exact: true }).waitFor();
  await page.getByText('Private archive message 1', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Read message', exact: true }).count(), 0);
  if (process.env.ARCHIVE_SMOKE_SCREENSHOTS) await page.screenshot({ path: `${process.env.ARCHIVE_SMOKE_SCREENSHOTS}/messages.png` });
  await page.getByRole('tab', { name: 'Notes', exact: true }).click();
  await page.getByText('A note from the archive 1', { exact: true }).waitFor();
  assert.equal(await page.getByText('Archive test', { exact: true }).count() > 0, true);
  if (process.env.ARCHIVE_SMOKE_SCREENSHOTS) { await page.waitForTimeout(500); await page.screenshot({ animations: 'disabled', path: `${process.env.ARCHIVE_SMOKE_SCREENSHOTS}/explorer.png` }); }
  await page.evaluate(() => globalThis.chrome.storage.local.set({ appearanceTheme: 'dark' }));
  await page.waitForFunction(() => globalThis.document.documentElement.dataset.theme === 'dark');
  if (process.env.ARCHIVE_SMOKE_SCREENSHOTS) { await page.waitForTimeout(500); await page.screenshot({ animations: 'disabled', path: `${process.env.ARCHIVE_SMOKE_SCREENSHOTS}/explorer-dark.png` }); }
  const explorer = page.locator('main').last();
  await page.getByText('2 matching events', { exact: true }).waitFor();
  await explorer.getByRole('tab', { name: 'Others', exact: true }).click();
  await explorer.getByText('A note from the archive 1', { exact: true }).waitFor({ state: 'detached' });
  await page.getByText('1 matching events', { exact: true }).waitFor();
  await explorer.getByRole('button', { name: 'See details', exact: true }).click();
  await page.getByRole('tab', { name: 'Advanced', exact: true }).click();
  await page.getByText('Source unknown (for example, imported from a file).', { exact: true }).waitFor();
  if (process.env.ARCHIVE_SMOKE_SCREENSHOTS) { await page.waitForTimeout(500); await page.screenshot({ animations: 'disabled', path: `${process.env.ARCHIVE_SMOKE_SCREENSHOTS}/detail.png` }); }
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await explorer.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'Delete 1 selected events', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByText('No matching events.', { exact: true }).waitFor();
  assert.equal((await rpc('archive_getState', { accountId })).count, 4);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= 390), true);
  if (process.env.ARCHIVE_SMOKE_SCREENSHOTS) await page.screenshot({ path: `${process.env.ARCHIVE_SMOKE_SCREENSHOTS}/explorer-mobile.png` });
  await rpc('vault_lock');
  await page.getByRole('tab', { name: 'Others', exact: true }).waitFor({ state: 'detached' });
  await page.reload();
  await page.locator('input[type=password]').waitFor();
  assert.equal(await page.getByRole('tab', { name: 'Others', exact: true }).count(), 0);
  await rpc('vault_unlock', { password: 'synthetic-smoke-password' });
  await page.getByText('4 unique events in this archive', { exact: true }).waitFor();
  const specific = await rpc('archive_importBegin', { accountId });
  for (const template of [
    { kind: 0, content: JSON.stringify({ name: 'Saved profile', about: 'Saved biography', custom: 'Custom profile field' }), tags: [] },
    { kind: 3, content: '', tags: [['p', pubkey]] },
    { kind: 10002, content: '', tags: [['r', 'wss://read.example', 'read'], ['r', 'wss://both.example']] },
  ]) {
    const event = finalizeEvent({ ...template, created_at: 1700001000 }, key);
    await rpc('archive_importChunk', { accountId, sessionId: specific.sessionId, line: JSON.stringify(event) });
  }
  await rpc('archive_importFinish', { accountId, sessionId: specific.sessionId });
  await page.reload();
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole('tab', { name: 'Profile Metadata', exact: true }).click();
  await page.getByText('Custom profile field', { exact: true }).waitFor();
  if (process.env.ARCHIVE_SMOKE_SCREENSHOTS) await page.screenshot({ path: `${process.env.ARCHIVE_SMOKE_SCREENSHOTS}/profile.png` });
  await page.getByRole('tab', { name: 'Contact List', exact: true }).click();
  await page.locator('li').getByText('Archive test', { exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Relay List', exact: true }).click();
  await page.getByText('wss://read.example', { exact: true }).waitFor();
  await page.getByText('Read and write', { exact: true }).waitFor();
  if (process.env.ARCHIVE_SMOKE_SCREENSHOTS) await page.screenshot({ path: `${process.env.ARCHIVE_SMOKE_SCREENSHOTS}/relays.png` });
  assert.equal(await page.getByRole('tab', { name: 'Likes', exact: true }).count(), 0);
  console.log('Archive explorer: messages, profile, contacts, relay list, search, deletion and lock passed');
} finally { await context?.close(); await rm(directory, { recursive: true, force: true }); }
