import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { accessToken, publishChrome, EXTENSION_ID } from '../scripts/publish-chrome.mjs';
import { verifyPackage } from '../scripts/verify-package.mjs';

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'chrome-publishing-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ manifest_version: 3, version: '0.8.6', background: { service_worker: 'worker.js' }, action: { default_popup: 'popup.html' } }));
  writeFileSync(join(dir, 'worker.js'), '');
  writeFileSync(join(dir, 'popup.html'), '');
  const archive = join(dir, 'chrome.zip');
  execFileSync('zip', ['-q', archive, 'manifest.json', 'worker.js', 'popup.html'], { cwd: dir });
  return { archive, version: '0.8.6', sha256: verifyPackage(archive, 'chrome', '0.8.6').sha256, publisher: 'publisher-id', token: 'test-token' };
}
function api(responses: object[], preflight = true) {
  if (preflight) responses.unshift({});
  const calls: { url: string; options?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    assert.ok(responses.length, 'Unexpected API call');
    return new Response(JSON.stringify({ itemId: EXTENSION_ID, ...responses.shift() }), { status: 200 });
  };
  return { calls, fetcher };
}
test('uploads the verified bytes and waits for processing before submission', async t => {
  const options = fixture(t);
  const mock = api([{ uploadState: 'IN_PROGRESS' }, { lastAsyncUploadState: 'IN_PROGRESS' }, { lastAsyncUploadState: 'SUCCEEDED' }, { state: 'PENDING_REVIEW' }]);
  assert.equal(await publishChrome(options, mock.fetcher, async () => {}), 'PENDING_REVIEW');
  assert.deepEqual(mock.calls.map(c => c.url.split(':').pop()), ['fetchStatus', 'upload', 'fetchStatus', 'fetchStatus', 'publish']);
  assert.deepEqual(JSON.parse(String(mock.calls[4].options?.body)), { publishType: 'DEFAULT_PUBLISH', skipReview: false, blockOnWarnings: true });
});
for (const state of ['FAILED', 'NOT_FOUND', 'UPLOAD_STATE_UNSPECIFIED', undefined]) {
  test(`does not submit after upload state ${state}`, async t => {
    const mock = api([{ uploadState: state }]);
    await assert.rejects(publishChrome(fixture(t), mock.fetcher, async () => {}), /did not finish/);
    assert.equal(mock.calls.length, 2);
  });
}
test('bounds processing polls and never submits on timeout', async t => {
  const mock = api([{ uploadState: 'IN_PROGRESS' }, ...Array.from({ length: 30 }, () => ({ lastAsyncUploadState: 'IN_PROGRESS' }))]);
  await assert.rejects(publishChrome(fixture(t), mock.fetcher, async () => {}), /did not finish/);
  assert.equal(mock.calls.length, 32);
});
test('rejects changed package before any network access', async t => {
  const mock = api([]);
  await assert.rejects(publishChrome({ ...fixture(t), sha256: '0'.repeat(64) }, mock.fetcher), /Archive changed/);
  assert.equal(mock.calls.length, 0);
});
test('rejects Google version mismatch without submitting', async t => {
  const mock = api([{ uploadState: 'SUCCEEDED', crxVersion: '0.8.4' }]);
  await assert.rejects(publishChrome(fixture(t), mock.fetcher), /different version/);
  assert.equal(mock.calls.length, 2);
});
test('rejects a mismatched store item', async t => {
  const mock = api([{ itemId: 'another-item', uploadState: 'SUCCEEDED' }]);
  await assert.rejects(publishChrome(fixture(t), mock.fetcher), /Unexpected extension/);
  assert.equal(mock.calls.length, 2);
});
test('does not retry failed HTTP mutations or include response secrets in errors', async t => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return new Response('sensitive response', { status: 403 }); };
  await assert.rejects(publishChrome(fixture(t), fetcher), error => error instanceof Error && /HTTP 403/.test(error.message) && !error.message.includes('sensitive'));
  assert.equal(calls, 1);
});
test('accepts synchronous successful upload', async t => {
  const mock = api([{ uploadState: 'SUCCEEDED', crxVersion: '0.8.6' }, { state: 'PENDING_REVIEW' }]);
  assert.equal(await publishChrome(fixture(t), mock.fetcher), 'PENDING_REVIEW');
  assert.equal(mock.calls.length, 3);
});

const oauth = { CHROME_WEBSTORE_CLIENT_ID: 'client', CHROME_WEBSTORE_CLIENT_SECRET: 'secret', CHROME_WEBSTORE_REFRESH_TOKEN: 'refresh' };
test('refreshes OAuth credentials only at the Google token endpoint', async () => {
  const fetcher: typeof fetch = async (url, options) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    assert.equal(options?.redirect, 'error');
    const body = options?.body as URLSearchParams;
    assert.equal(body.get('grant_type'), 'refresh_token');
    assert.equal(body.get('refresh_token'), 'refresh');
    return new Response(JSON.stringify({ access_token: 'short-lived' }));
  };
  assert.equal(await accessToken(oauth, fetcher), 'short-lived');
});
test('missing refresh token fails before any OAuth request', async () => {
  await assert.rejects(accessToken({ ...oauth, CHROME_WEBSTORE_REFRESH_TOKEN: undefined }, async () => { throw new Error('must not call'); }), /Missing CHROME_WEBSTORE_REFRESH_TOKEN/);
});
test('OAuth failure does not echo token response', async () => {
  await assert.rejects(accessToken(oauth, async () => new Response('sensitive', { status: 400 })), error => error instanceof Error && /OAuth HTTP 400/.test(error.message) && !error.message.includes('sensitive'));
});

test('never uploads over an existing submission', async t => {
  const mock = api([{ submittedItemRevisionStatus: { state: 'PENDING_REVIEW' } }], false);
  await assert.rejects(publishChrome(fixture(t), mock.fetcher), /different submission/);
  assert.equal(mock.calls.length, 1);
});
test('skips a version that is already published', async t => {
  const mock = api([{ publishedItemRevisionStatus: { distributionChannels: [{ crxVersion: '0.8.6' }] } }], false);
  assert.equal(await publishChrome(fixture(t), mock.fetcher), 'ALREADY_PUBLISHED');
  assert.equal(mock.calls.length, 1);
});

test('duplicate release run skips the version already in review', async t => {
  const mock = api([{ submittedItemRevisionStatus: { state: 'PENDING_REVIEW', distributionChannels: [{ crxVersion: '0.8.6' }] } }], false);
  assert.equal(await publishChrome(fixture(t), mock.fetcher), 'ALREADY_SUBMITTED');
  assert.equal(mock.calls.length, 1);
});
test('automatically cancels an older review before uploading a newer release', async t => {
  const mock = api([
    { submittedItemRevisionStatus: { state: 'PENDING_REVIEW', distributionChannels: [{ crxVersion: '0.8.5' }] } },
    {}, {}, { uploadState: 'SUCCEEDED', crxVersion: '0.8.6' }, { state: 'PENDING_REVIEW' },
  ], false);
  assert.equal(await publishChrome(fixture(t), mock.fetcher), 'PENDING_REVIEW');
  assert.deepEqual(mock.calls.map(c => c.url.split(':').pop()), ['fetchStatus', 'cancelSubmission', 'fetchStatus', 'upload', 'publish']);
});
test('refuses to cancel a newer version', async t => {
  const mock = api([{ submittedItemRevisionStatus: { state: 'PENDING_REVIEW', distributionChannels: [{ crxVersion: '0.8.7' }] } }], false);
  await assert.rejects(publishChrome(fixture(t), mock.fetcher), /newer Chrome/);
  assert.equal(mock.calls.length, 1);
});
test('does not upload until cancellation is confirmed', async t => {
  const pending = { submittedItemRevisionStatus: { state: 'PENDING_REVIEW', distributionChannels: [{ crxVersion: '0.8.5' }] } };
  const mock = api([pending, {}, ...Array.from({ length: 31 }, () => pending)], false);
  await assert.rejects(publishChrome(fixture(t), mock.fetcher, async () => {}), /Cancellation not confirmed/);
  assert.equal(mock.calls.length, 33);
});

test('inspection reports review status without uploading or cancelling', async t => {
  const submitted = { state: 'PENDING_REVIEW', distributionChannels: [{ crxVersion: '0.8.5' }] };
  const mock = api([{ submittedItemRevisionStatus: submitted }], false);
  const result = await publishChrome({ ...fixture(t), inspectOnly: true }, mock.fetcher);
  assert.deepEqual(JSON.parse(result), { submitted });
  assert.equal(mock.calls.length, 1);
});

test('waits for asynchronous cancellation without repeating the mutation', async t => {
 const pending={submittedItemRevisionStatus:{state:'PENDING_REVIEW',distributionChannels:[{crxVersion:'0.8.5'}]}};
 const mock=api([pending,{},pending,{}, {uploadState:'SUCCEEDED'}, {state:'PENDING_REVIEW'}],false);
 assert.equal(await publishChrome(fixture(t),mock.fetcher,async()=>{}),'PENDING_REVIEW');
 assert.equal(mock.calls.filter(c=>c.url.endsWith(':cancelSubmission')).length,1);
});


for (const code of ['invalid_client', 'invalid_grant', 'invalid_request', 'unauthorized_client', 'unsupported_grant_type', 'invalid_scope', 'secret-value', null]) test(`OAuth diagnostics only expose recognized error codes: ${code}`, async () => {
 await assert.rejects(accessToken(oauth, async () => new Response(JSON.stringify({ error: code, error_description: 'sensitive-details', access_token: 'secret-value' }), { status: 400 })), error => {
  assert.ok(error instanceof Error);
  assert.ok(error.message.includes(`(${code === null || code === 'secret-value' ? 'unknown_error' : code})`));
  assert.doesNotMatch(error.message, /sensitive-details|secret-value/);
  return true;
 });
});
