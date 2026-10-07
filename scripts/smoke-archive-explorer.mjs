import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { finalizeEvent, getPublicKey } from 'nostr-tools';

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
  await page.getByText('3 matching events', { exact: true }).waitFor();
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
  assert.equal((await rpc('archive_getState', { accountId })).count, 2);
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
  await page.getByText('2 unique events in this archive', { exact: true }).waitFor();
  console.log('Archive explorer: import, search, details, local deletion and lock passed');
} finally { await context?.close(); await rm(directory, { recursive: true, force: true }); }
