import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { compareVersions } from './store-version.mjs';
import { verifyPackage } from './verify-package.mjs';

export const EXTENSION_ID = 'gfmefgdkmjpjinecjchlangpamhclhdo';

export async function accessToken(env, fetcher = fetch) {
  for (const name of ['CHROME_WEBSTORE_CLIENT_ID', 'CHROME_WEBSTORE_CLIENT_SECRET', 'CHROME_WEBSTORE_REFRESH_TOKEN']) {
    assert.ok(env[name], `Missing ${name}`);
  }
  const response = await fetcher('https://oauth2.googleapis.com/token', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
    body: new URLSearchParams({
      grant_type: 'refresh_token', client_id: env.CHROME_WEBSTORE_CLIENT_ID,
      client_secret: env.CHROME_WEBSTORE_CLIENT_SECRET, refresh_token: env.CHROME_WEBSTORE_REFRESH_TOKEN,
    }),
  });
  assert.ok(response.ok, `Google OAuth HTTP ${response.status}; check or renew the configured credentials`);
  const data = await response.json();
  assert.ok(typeof data.access_token === 'string' && data.access_token, 'Google did not return an access token');
  return data.access_token;
}

// No automatic retries of mutations: an uncertain response needs dashboard inspection.
export async function publishChrome({ archive, version, sha256, publisher, token, inspectOnly }, fetcher = fetch, sleep = delay) {
  assert.match(publisher ?? '', /^[a-zA-Z0-9_-]+$/, 'Missing/invalid CHROME_WEBSTORE_PUBLISHER_ID');
  assert.ok(token, 'Missing Chrome Web Store access token');
  assert.match(sha256 ?? '', /^[a-f0-9]{64}$/, 'Missing verified SHA256');
  const verified = verifyPackage(archive, 'chrome', version);
  assert.equal(verified.sha256, sha256, 'Archive changed after browser smoke verification');
  const base = 'https://chromewebstore.googleapis.com';
  const name = `publishers/${publisher}/items/${EXTENSION_ID}`;
  async function request(path, options = {}, requireIdentity = true) {
    const response = await fetcher(`${base}${path}`, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(120000),
      redirect: 'error',
    });
    // Never print raw errors/requests, which may contain credentials.
    assert.ok(response.ok, `Chrome Web Store HTTP ${response.status}; inspect the developer dashboard before retrying`);
    const data = await response.json();
    if (requireIdentity) assert.equal(data.itemId, EXTENSION_ID, 'Unexpected extension in Google response');
    return data;
  }
  const current = await request(`/v2/${name}:fetchStatus`);
  if (inspectOnly) return JSON.stringify({ published: current.publishedItemRevisionStatus, submitted: current.submittedItemRevisionStatus });
  const channels = revision => revision?.distributionChannels ?? [];
  const hasVersion = revision => channels(revision).some(channel => channel.crxVersion === version);
  for (const revision of [current.publishedItemRevisionStatus, current.submittedItemRevisionStatus]) {
    for (const channel of channels(revision)) assert.ok(compareVersions(channel.crxVersion, version) <= 0, 'A newer Chrome version exists; no changes attempted');
  }
  if (hasVersion(current.publishedItemRevisionStatus)) return 'ALREADY_PUBLISHED';
  const submitted = current.submittedItemRevisionStatus;
  if (['PENDING_REVIEW', 'STAGED'].includes(submitted?.state)) {
    if (hasVersion(submitted)) return 'ALREADY_SUBMITTED';
    assert.ok(channels(submitted).length > 0 &&
      channels(submitted).every(channel => compareVersions(channel.crxVersion, version) < 0),
    'A different submission is pending; no upload or cancellation attempted');
    await request(`/v2/${name}:cancelSubmission`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, false);
    let afterCancel = await request(`/v2/${name}:fetchStatus`);
    for (let attempt = 0; ['PENDING_REVIEW', 'STAGED'].includes(afterCancel.submittedItemRevisionStatus?.state) && attempt < 30; attempt++) {
      await sleep(2000);
      afterCancel = await request(`/v2/${name}:fetchStatus`);
    }
    assert.ok(!['PENDING_REVIEW', 'STAGED'].includes(afterCancel.submittedItemRevisionStatus?.state),
      'Cancellation not confirmed; no upload attempted');
  }
  const upload = await request(`/upload/v2/${name}:upload`, {
    method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: readFileSync(archive),
  });
  if (upload.crxVersion !== undefined) assert.equal(upload.crxVersion, version, 'Google received a different version');
  let state = upload.uploadState;
  for (let attempt = 0; state === 'IN_PROGRESS' && attempt < 30; attempt++) {
    await sleep(10000);
    state = (await request(`/v2/${name}:fetchStatus`)).lastAsyncUploadState;
  }
  assert.equal(state, 'SUCCEEDED', 'Upload did not finish successfully; nothing submitted');
  const result = await request(`/v2/${name}:publish`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH', skipReview: false, blockOnWarnings: true }),
  });
  assert.ok(['PENDING_REVIEW', 'PUBLISHED', 'STAGED'].includes(result.state), 'Unexpected submission state; inspect developer dashboard');
  return result.state;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const state = await publishChrome({
      archive: process.argv[2], version: process.env.RELEASE_VERSION,
      sha256: process.env.VERIFIED_SHA256, publisher: process.env.CHROME_WEBSTORE_PUBLISHER_ID,
      token: await accessToken(process.env), inspectOnly: process.env.STORE_INSPECT_ONLY === 'true',
    });
    console.log(`Chrome Web Store submission: ${state}. Google review controls public availability.`);
  } catch (error) {
    console.error(error instanceof assert.AssertionError ? error.message : 'Publishing failed; inspect the developer dashboard before retrying.');
    process.exitCode = 1;
  }
}
