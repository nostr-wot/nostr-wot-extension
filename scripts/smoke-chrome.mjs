import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { verifyPackage } from './verify-package.mjs';

/** Boot the bytes from the upload ZIP in a disposable browser with no user data. */
export async function smokeChrome(archive, version) {
  const { manifest, sha256 } = verifyPackage(archive, 'chrome', version);
  const dir = mkdtempSync(join(tmpdir(), 'nostr-package-smoke-'));
  const unpacked = join(dir, 'extension');
  mkdirSync(unpacked);
  let context;
  try {
    execFileSync('unzip', ['-qq', resolve(archive), '-d', unpacked]);
    context = await chromium.launchPersistentContext(join(dir, 'profile'), {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${unpacked}`, `--load-extension=${unpacked}`],
    });
    context.setDefaultTimeout(15000);
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15000 });
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/${manifest.action.default_popup}`);
    await page.waitForFunction(() => globalThis.document.querySelector('#root')?.childElementCount > 0);
    // Exercise the exact privileged RPC used by the failed site-status card.
    // This runs in the popup, so the real sender checks and message transport apply.
    const response = await page.evaluate(async () => {
      return Promise.race([
        globalThis.chrome.runtime.sendMessage({ method: 'getAllowedDomains', params: {} }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('getAllowedDomains timed out')), 10000)),
      ]);
    });
    assert.ok(response && !response.error && Array.isArray(response.result), 'Popup getAllowedDomains RPC failed');
    console.log(`Chrome ZIP smoke passed: worker started, popup rendered, connection-status RPC answered. SHA256 ${sha256}`);
    return sha256;
  } finally {
    if (context) await context.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  await smokeChrome(process.argv[2], version);
}
