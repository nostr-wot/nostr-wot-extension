import assert from 'node:assert/strict';
import { createHmac, createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyPackage } from './verify-package.mjs';

export const ADDON_ID = 'nostr-wot-extension@nostr-wot.com';
const ORIGIN = 'https://addons.mozilla.org';
const API = '/api/v5/';
// AMO renders Markdown lists/paragraphs and linkifies URLs. Compare their text
// while preserving list item boundaries and refusing missing/changed content.
const releaseText = value => typeof value === 'string' ? value
  .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1')
  .replace(/<\/?ul>/gi, '\n').replace(/<li>/gi, '- ').replace(/<\/li>/gi, '\n')
  .replace(/<\/?p>/gi, '\n')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean).join('\n') : '';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function amoToken(env, now = Math.floor(Date.now() / 1000)) {
  assert.ok(env.AMO_JWT_ISSUER && env.AMO_JWT_SECRET, 'Missing Mozilla credentials');
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: env.AMO_JWT_ISSUER, jti: randomUUID(), iat: now, exp: now + 60 })}`;
  return `${unsigned}.${createHmac('sha256', env.AMO_JWT_SECRET).update(unsigned).digest('base64url')}`;
}
export { compareVersions } from './store-version.mjs';
import { compareVersions } from './store-version.mjs';

/** No mutation retries; reruns resume only an exact, marked submission. */
export async function publishFirefox(options, env, fetcher = fetch, sleep = delay) {
  const { archive, source, version, archiveHash, sourceHash, approvalNotes, releaseNotes } = options;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const checked = verifyPackage(archive, 'firefox', version);
  assert.equal(checked.manifest.browser_specific_settings.gecko.id, ADDON_ID, 'Wrong Firefox add-on');
  assert.equal(checked.sha256, archiveHash, 'Firefox archive changed after verification');
  const sourceBytes = readFileSync(source);
  assert.equal(digest(sourceBytes), sourceHash, 'Source archive changed after verification');
  assert.ok(approvalNotes?.trim() && releaseNotes?.trim(), 'Missing reviewer or release notes');
  const marker = `Firefox SHA256: ${archiveHash}\nSource SHA256: ${sourceHash}`;
  const notes = `${approvalNotes.trim()}\n\n${marker}`;
  assert.ok(releaseNotes.length <= 3000, 'Mozilla release notes exceed 3000 characters');
  assert.ok(notes.replace(/\r?\n/g, '\r\n').length <= 3000, 'Mozilla reviewer notes exceed 3000 characters');
  async function request(path, init = {}) {
    const url = new URL(path, ORIGIN);
    assert.ok(url.origin === ORIGIN && url.pathname.startsWith(API) && !url.username && !url.password, 'Unsafe Mozilla API URL');
    const response = await fetcher(url.href, { ...init, headers: { ...init.headers, Authorization: `JWT ${amoToken(env)}` }, redirect: 'error', signal: AbortSignal.timeout(120000) });
    assert.ok(response.ok, `Mozilla HTTP ${response.status}; inspect the developer dashboard before retrying`);
    return response.json();
  }
  const base = `${API}addons/addon/${encodeURIComponent(ADDON_ID)}/`;
  const addon = await request(base);
  assert.equal(addon.guid, ADDON_ID, 'Unexpected Mozilla add-on identity');
  let next = `${base}versions/?filter=all_with_unlisted&page_size=50`;
  const versions = [];
  for (let page = 0; next && page < 40; page++) {
    const data = await request(next);
    assert.ok(Array.isArray(data.results), 'Invalid Mozilla version list');
    versions.push(...data.results); next = data.next;
  }
  assert.ok(!next, 'Mozilla version list exceeded limit');
  if (env.STORE_INSPECT_ONLY === 'true') return JSON.stringify(versions.map(v => ({ version: v.version, channel: v.channel, status: v.file?.status, disabled: v.is_disabled })));
  const existing = versions.find(v => v.version === version);
  if (existing) {
    assert.ok(Number.isSafeInteger(existing.id) && existing.id > 0, 'Invalid existing Mozilla version ID');
    const detail = await request(`${base}versions/${existing.id}/`);
    assert.equal(detail.version, version);
    assert.ok(detail.channel === 'listed' && ['public', 'unreviewed'].includes(detail.file?.status) && detail.is_disabled !== true, 'Existing version is not an active listed submission');
    assert.ok(detail.source && detail.approval_notes?.replace(/\r\n?/g, '\n').includes(marker), 'Existing version has unverified package/source; no changes attempted');
    if (detail.approval_notes?.replace(/\r\n?/g, '\n') === notes && releaseText(detail.release_notes?.['en-US']) === releaseText(releaseNotes)) return 'ALREADY_SUBMITTED';
    return await metadata(detail);
  }
  for (const v of versions) {
    assert.ok(compareVersions(v.version, version) < 0, 'A newer or conflicting Mozilla version exists');
  }
  const form = new FormData();
  form.set('channel', 'listed');
  form.set('upload', new Blob([readFileSync(archive)], { type: 'application/zip' }), `nostr-wot-firefox-${version}.zip`);
  let upload = await request(`${API}addons/upload/`, { method: 'POST', body: form });
  assert.match(upload.uuid ?? '', /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i, 'Invalid Mozilla upload ID');
  const uuid = upload.uuid;
  for (let attempt = 0; upload.processed !== true && attempt < 30; attempt++) {
    await sleep(10000);
    upload = await request(`${API}addons/upload/${uuid}/`);
    assert.equal(upload.uuid, uuid, 'Unexpected Mozilla upload identity');
  }
  assert.ok(upload.processed === true && upload.valid === true && upload.submitted === false, 'Mozilla validation did not succeed');
  assert.equal(upload.version, version, 'Mozilla parsed a different version');
  assert.equal(upload.channel, 'listed', 'Wrong Mozilla upload channel');
  const submission = new FormData();
  submission.set('upload', uuid);
  submission.set('source', new Blob([sourceBytes], { type: 'application/zip' }), `nostr-wot-source-${version}.zip`);
  submission.set('license', 'MIT');
  submission.set('approval_notes', notes);
  const created = await request(`${base}versions/`, { method: 'POST', body: submission });
  return await metadata(created);

  async function metadata(detail) {
    assert.equal(detail.version, version, 'Unexpected created version');
    assert.equal(detail.channel, 'listed');
    assert.ok(Number.isSafeInteger(detail.id) && detail.id > 0 && detail.source, 'Mozilla did not attach the source archive');
    const path = `${base}versions/${detail.id}/`;
    await request(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approval_notes: notes, release_notes: { 'en-US': releaseNotes } }) });
    const saved = await request(path);
    assert.equal(saved.version, version);
    assert.equal(saved.channel, 'listed');
    assert.ok(saved.source, 'Mozilla source attachment missing');
    assert.equal(saved.approval_notes?.replace(/\r\n?/g, '\n'), notes, 'Reviewer notes were not saved');
    assert.equal(releaseText(saved.release_notes?.['en-US']), releaseText(releaseNotes), 'Release notes were not saved');
    return 'SUBMITTED';
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await publishFirefox(JSON.parse(readFileSync(process.argv[2], 'utf8')), process.env);
    console.log(`Mozilla submission: ${result}. Mozilla review controls public availability.`);
  } catch (error) {
    console.error(error instanceof assert.AssertionError ? error.message : 'Mozilla publishing failed; inspect the developer dashboard before retrying.');
    process.exitCode = 1;
  }
}
