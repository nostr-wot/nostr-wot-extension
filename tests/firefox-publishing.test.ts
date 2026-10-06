import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ADDON_ID, amoToken, digest, compareVersions, publishFirefox } from '../scripts/publish-firefox.mjs';
import { checksumFor, changelogFor, compareArchives, prepareFirefox, releaseNotesFor } from '../scripts/prepare-firefox-release.mjs';
import { prepareRelease } from '../scripts/prepare-store-release.mjs';
const env = { AMO_JWT_ISSUER: 'test-issuer', AMO_JWT_SECRET: 'synthetic-test-secret' };
// AMO serializes upload UUIDs as compact hexadecimal strings.
const uuid = '10000000000000000000000000000001';
function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'firefox-publishing-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ manifest_version: 3, version: '0.8.7', browser_specific_settings: { gecko: { id: ADDON_ID } }, background: { scripts: ['worker.js'] }, action: { default_popup: 'popup.html' } }));
  writeFileSync(join(dir, 'worker.js'), ''); writeFileSync(join(dir, 'popup.html'), '');
  const archive = join(dir, 'firefox.zip'), source = join(dir, 'source.zip');
  execFileSync('zip', ['-q', archive, 'manifest.json', 'worker.js', 'popup.html'], { cwd: dir });
  writeFileSync(source, readFileSync(archive));
  return { archive, source, version: '0.8.7', archiveHash: digest(readFileSync(archive)), sourceHash: digest(readFileSync(source)), approvalNotes: 'Build with npm ci. Synthetic review notes.', releaseNotes: 'Tested changes.' };
}
function detail(o: ReturnType<typeof fixture>) {
 return { id: 9, version: o.version, channel: 'listed', file: { status: 'unreviewed' }, source: 'https://addons.mozilla.org/source.zip', approval_notes: `${o.approvalNotes}\n\nFirefox SHA256: ${o.archiveHash}\nSource SHA256: ${o.sourceHash}`, release_notes: { 'en-US': o.releaseNotes } };
}
function api(responses: object[]) {
 const calls: { url: string; options: RequestInit }[] = [];
 const fetcher: typeof fetch = async (url, options = {}) => {
  calls.push({ url: String(url), options });
  assert.ok(responses.length, 'Unexpected API call');
  assert.equal(options.redirect, 'error');
  return new Response(JSON.stringify(responses.shift()), { status: 200 });
 };
 return { calls, fetcher };
}
const addon = { guid: ADDON_ID };
const empty = { results: [], next: null };
const validated = { uuid, processed: true, valid: true, submitted: false, version: '0.8.7', channel: 'listed' };
test('Mozilla JWT is short-lived HS256 with a unique nonce', () => {
 const token = amoToken(env, 1000), [header, payload, signature] = token.split('.');
 assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), { alg: 'HS256', typ: 'JWT' });
 const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
 assert.equal(claims.iss, env.AMO_JWT_ISSUER); assert.equal(claims.exp - claims.iat, 60);
 assert.equal(signature, createHmac('sha256', env.AMO_JWT_SECRET).update(`${header}.${payload}`).digest('base64url'));
 assert.notEqual(token, amoToken(env, 1000));
});
test('submits listed ZIP with source, then saves and verifies reviewer and release notes', async t => {
 const o = fixture(t), saved = detail(o);
 const mock = api([addon, empty, { uuid, processed: false }, validated, saved, saved, saved]);
 assert.equal(await publishFirefox(o, env, mock.fetcher, async () => {}), 'SUBMITTED');
 assert.deepEqual(mock.calls.map(c => c.options.method || 'GET'), ['GET', 'GET', 'POST', 'GET', 'POST', 'PATCH', 'GET']);
 const upload = mock.calls[2].options.body as FormData, submission = mock.calls[4].options.body as FormData;
 assert.equal(upload.get('channel'), 'listed'); assert.equal(submission.get('upload'), uuid);
 assert.equal(digest(Buffer.from(await (submission.get('source') as Blob).arrayBuffer())), o.sourceHash);
 assert.equal(submission.get('approval_notes'), saved.approval_notes);
 assert.deepEqual(JSON.parse(String(mock.calls[5].options.body)).release_notes, { 'en-US': o.releaseNotes });
});
test('reruns skip a complete exact submission without mutations', async t => {
 const o = fixture(t), saved = detail(o), mock = api([addon, { results: [saved], next: null }, saved]);
 assert.equal(await publishFirefox(o, env, mock.fetcher), 'ALREADY_SUBMITTED');
 assert.ok(mock.calls.every(c => !c.options.method));
});
test('resumes metadata after an interrupted submission without another upload', async t => {
 const o = fixture(t), saved = detail(o), partial = { ...saved, release_notes: null };
 const mock = api([addon, { results: [partial], next: null }, partial, saved, saved]);
 assert.equal(await publishFirefox(o, env, mock.fetcher), 'SUBMITTED');
 assert.deepEqual(mock.calls.map(c => c.options.method || 'GET'), ['GET', 'GET', 'GET', 'PATCH', 'GET']);
});
for (const changed of ['source', 'approval_notes', 'channel'] as const) test(`refuses to overwrite an existing version with mismatched ${changed}`, async t => {
 const o = fixture(t), wrong = { ...detail(o), [changed]: changed === 'source' ? null : 'different' };
 const mock = api([addon, { results: [wrong], next: null }, wrong]);
 await assert.rejects(publishFirefox(o, env, mock.fetcher));
 assert.ok(mock.calls.every(c => !c.options.method));
});
for (const existing of [{ version: '0.9.0', channel: 'listed', file: { status: 'public' } }]) test(`refuses conflicting version ${existing.version}`, async t => {
 const mock = api([addon, { results: [existing], next: null }]);
 await assert.rejects(publishFirefox(fixture(t), env, mock.fetcher));
 assert.equal(mock.calls.length, 2);
});
test('follows version pagination before deciding whether to upload', async t => {
 const o = fixture(t), saved = detail(o);
 const mock = api([addon, { results: [], next: '/api/v5/addons/addon/example/versions/?page=2' }, { results: [saved], next: null }, saved]);
 assert.equal(await publishFirefox(o, env, mock.fetcher), 'ALREADY_SUBMITTED');
});
test('credentials never follow a foreign pagination URL', async t => {
 const mock = api([addon, { results: [], next: 'https://attacker.test/api/v5/' }]);
 await assert.rejects(publishFirefox(fixture(t), env, mock.fetcher), /Unsafe/);
 assert.equal(mock.calls.length, 2);
});
for (const upload of [{ ...validated, valid: false }, { ...validated, version: '0.8.6' }, { ...validated, channel: 'unlisted' }, { ...validated, submitted: true }]) test(`rejects invalid upload ${JSON.stringify(upload)}`, async t => {
 const mock = api([addon, empty, upload]);
 await assert.rejects(publishFirefox(fixture(t), env, mock.fetcher));
 assert.equal(mock.calls.length, 3);
});
test('bounds validation polling and never creates a version after timeout', async t => {
 const mock = api([addon, empty, ...Array.from({ length: 31 }, () => ({ uuid, processed: false }))]);
 await assert.rejects(publishFirefox(fixture(t), env, mock.fetcher, async () => {}), /validation/);
 assert.equal(mock.calls.filter(c => c.options.method === 'POST').length, 1);
});
test('checks archive and source hashes before using credentials', async t => {
 const o = fixture(t); writeFileSync(o.source, 'changed'); const mock = api([]);
 await assert.rejects(publishFirefox(o, env, mock.fetcher), /Source archive changed/);
 assert.equal(mock.calls.length, 0);
});
test('does not retry an uncertain mutation or log raw server errors', async t => {
 const mock = api([addon, empty]); let writes = 0;
 const fetcher: typeof fetch = (url, options) => {
  if (options?.method === 'POST') { writes++; return Promise.resolve(new Response('SECRET ECHO', { status: 503 })); }
  return mock.fetcher(url, options);
 };
 await assert.rejects(publishFirefox(fixture(t), env, fetcher), error => error instanceof Error && error.message.includes('503') && !error.message.includes('SECRET ECHO'));
 assert.equal(writes, 1);
});
test('rejects wrong add-on identity before uploading', async t => {
 const mock = api([{ guid: 'someone-else' }]); await assert.rejects(publishFirefox(fixture(t), env, mock.fetcher), /identity/);
 assert.equal(mock.calls.length, 1);
});
test('checks exact checksums, changelog sections and full archive contents', t => {
 const o = fixture(t);
 assert.equal(checksumFor(`${o.archiveHash}  exact.zip\n`, 'exact.zip'), o.archiveHash);
 assert.throws(() => checksumFor(`${o.archiveHash}  wrong.zip`, 'exact.zip'));
 assert.throws(() => checksumFor(`${o.archiveHash}  exact.zip\n${o.archiveHash}  exact.zip`, 'exact.zip'));
 assert.equal(changelogFor('## 0.8.7\nChanges\n## 0.8.6\nOld', '0.8.7'), 'Changes');
 assert.throws(() => changelogFor('## 0.8.70\nWrong', '0.8.7'));
 compareArchives(o.archive, o.source);
 writeFileSync(o.source, 'not a zip'); assert.throws(() => compareArchives(o.archive, o.source));
});
test('shared release gate requires published release and exact passing main commit', () => {
 const commit = 'a'.repeat(40); const calls: string[][] = [];
 const run = (_: string, args: string[]) => {
  calls.push(args);
  if (args[0] === 'release') return JSON.stringify({ isDraft: false, isPrerelease: false, tagName: 'v0.8.7' });
  if (args[0] === 'rev-parse') return commit;
  if (args[0] === 'run') return JSON.stringify([{ headSha: commit, conclusion: 'success' }]);
  if (args[0] === '-p') return '0.8.7';
  return '';
 };
 assert.deepEqual(prepareRelease('v0.8.7', run), { commit, version: '0.8.7' });
 assert.ok(calls.some(args => args[0] === 'merge-base'));
 assert.throws(() => prepareRelease('v0.8.7', (command, args) => args[0] === 'run' ? '[]' : run(command, args)), /successful push CI/);
 assert.throws(() => prepareRelease('v0.8.7', (command, args) => args[0] === 'release' ? '{"isDraft":true}' : run(command, args)), /not stable/);
 assert.throws(() => prepareRelease('bad;tag', run));
});


test('compares Mozilla version components numerically and rejects ambiguous formats', () => {
 assert.equal(compareVersions('0.8.10', '0.8.9'), 1);
 assert.equal(compareVersions('0.8.7', '0.8.7'), 0);
 assert.equal(compareVersions('0.8.6', '0.8.7'), -1);
 assert.throws(() => compareVersions('0.8.7beta', '0.8.7'));
});
test('prepares source, rebuild and notes before submission', t => {
 const o = fixture(t), root = mkdtempSync(join(tmpdir(), 'firefox-prepare-'));
 const previous = process.cwd();
 t.after(() => { process.chdir(previous); rmSync(root, { recursive: true, force: true }); });
 process.chdir(root);
 mkdirSync('docs'); writeFileSync('docs/firefox-reviewer-notes.md', 'Reviewer instructions');
 writeFileSync('SOURCE_BUILD.md', 'Build instructions'); writeFileSync('CHANGELOG.md', '## 0.8.7\nRelease changes');
 const calls: string[] = [];
 const metadata = prepareFirefox(join(root, 'release'), '0.8.7', 'a'.repeat(40), (command, args) => {
  calls.push(command);
  if (command === 'gh') {
   const target = args.at(-1)!;
   copyFileSync(o.archive, join(target, 'nostr-wot-firefox-0.8.7.zip'));
   copyFileSync(o.source, join(target, 'nostr-wot-source-0.8.7.zip'));
   writeFileSync(join(target, 'SHA256SUMS'), `${o.archiveHash}  nostr-wot-firefox-0.8.7.zip\n${o.sourceHash}  nostr-wot-source-0.8.7.zip`);
  } else if (command === 'git') copyFileSync(o.source, args[2].slice('--output='.length));
  else if (command === 'npm') copyFileSync(o.archive, 'nostr-wot-firefox.zip');
 });
 assert.deepEqual(calls, ['gh', 'git', 'npm']);
 assert.equal(metadata.releaseNotes, 'Release changes');
 assert.match(metadata.approvalNotes, /Reviewer instructions/);
 assert.match(metadata.approvalNotes, /SOURCE_BUILD.md/);
 assert.deepEqual(JSON.parse(readFileSync('release/publish-metadata.json', 'utf8')), metadata);
});
test('Mozilla workflow only submits stable releases, serially, after verification', () => {
 const workflow = readFileSync(new URL('../.github/workflows/release-firefox.yml', import.meta.url), 'utf8');
 assert.match(workflow, /types: \[published\]/);
 assert.doesNotMatch(workflow, /workflow_dispatch:|pull_request:|push:/);
 assert.match(workflow, /group: mozilla-addons/);
 assert.match(workflow, /cancel-in-progress: false/);
 assert.match(workflow, /!github.event.release.prerelease/);
 assert.ok(workflow.indexOf('prepare-store-release.mjs') < workflow.indexOf('prepare-firefox-release.mjs'));
 assert.ok(workflow.indexOf('prepare-firefox-release.mjs') < workflow.indexOf('secrets.AMO_JWT_SECRET'));
});

for (const uploadId of ['10000000-0000-0000-0000-000000000001', '------------------------------------', '../not-an-upload']) test(`validates upload ID format: ${uploadId}`, async t => {
 const o = fixture(t), saved = detail(o);
 const mock = api([addon, empty, { ...validated, uuid: uploadId }, saved, saved, saved]);
 if (uploadId.startsWith('1000')) assert.equal(await publishFirefox(o, env, mock.fetcher), 'SUBMITTED');
 else { await assert.rejects(publishFirefox(o, env, mock.fetcher), /Invalid Mozilla upload ID/); assert.equal(mock.calls.length, 3); }
});

test('refuses oversized reviewer notes before using Mozilla credentials', async t => {
 const o = fixture(t); o.approvalNotes = 'x'.repeat(3000);
 const mock = api([]);
 await assert.rejects(publishFirefox(o, env, mock.fetcher), /exceed 3000/);
 assert.equal(mock.calls.length, 0);
});

test('fits Mozilla release-note limits while linking the complete changelog', () => {
 const commit='a'.repeat(40);
 assert.equal(releaseNotesFor('Short changes',commit),'Short changes');
 const notes=releaseNotesFor('x'.repeat(3100)+'\n### Store release notes\nUser-facing summary',commit);
 assert.ok(notes.length <= 3000); assert.match(notes,/User-facing summary/);
 assert.ok(notes.includes(`/blob/${commit}/CHANGELOG.md`));
 assert.throws(()=>releaseNotesFor('x'.repeat(3100),commit),/require a Store/);
 assert.throws(()=>releaseNotesFor('### Store release notes\n'+'x'.repeat(3100),commit),/exceed 3000/);
});
test('refuses oversized release notes before any Mozilla mutation', async t => {
 const o=fixture(t);o.releaseNotes='x'.repeat(3001);const mock=api([]);
 await assert.rejects(publishFirefox(o,env,mock.fetcher),/release notes exceed/);
 assert.equal(mock.calls.length,0);
});

test('recognizes AMO multipart CRLF notes and resumes metadata without reuploading', async t => {
 const o=fixture(t), saved=detail(o);
 const partial={...saved,approval_notes:saved.approval_notes.replace(/\n/g,'\r\n'),release_notes:null};
 const mock=api([addon,{results:[partial],next:null},partial,saved,saved]);
 assert.equal(await publishFirefox(o,env,mock.fetcher),'SUBMITTED');
 assert.deepEqual(mock.calls.map(c=>c.options.method||'GET'),['GET','GET','GET','PATCH','GET']);
 const complete={...saved,approval_notes:partial.approval_notes};
 const rerun=api([addon,{results:[complete],next:null},complete]);
 assert.equal(await publishFirefox(o,env,rerun.fetcher),'ALREADY_SUBMITTED');
});

test('recognizes Mozilla linkified release notes on save and rerun', async t => {
 const o=fixture(t);o.releaseNotes='Changes: https://example.test/changelog';
 const saved=detail(o), linked={...saved,release_notes:{'en-US':'Changes: <a href="https://outgoing.example/redirect" rel="nofollow">https://example.test/changelog</a>'}};
 const submission=api([addon,empty,validated,saved,saved,linked]);
 assert.equal(await publishFirefox(o,env,submission.fetcher),'SUBMITTED');
 const rerun=api([addon,{results:[linked],next:null},linked]);
 assert.equal(await publishFirefox(o,env,rerun.fetcher),'ALREADY_SUBMITTED');
 assert.ok(rerun.calls.every(c=>!c.options.method));
});

test('inspection lists versions without submitting', async t => {
 const old = {version:'0.8.6',channel:'listed',file:{status:'unreviewed'}};
 const mock=api([addon,{results:[old],next:null}]);
 assert.deepEqual(JSON.parse(await publishFirefox(fixture(t),{...env,STORE_INSPECT_ONLY:'true'},mock.fetcher)),[{version:'0.8.6',channel:'listed',status:'unreviewed'}]);
 assert.equal(mock.calls.length,2);
});
test('automatically supersedes an older Mozilla review without deleting history', async t => {
 const o=fixture(t),saved=detail(o),old={version:'0.8.6',channel:'listed',file:{status:'unreviewed'}};
 const mock=api([addon,{results:[old],next:null},validated,saved,saved,saved]);
 assert.equal(await publishFirefox(o,env,mock.fetcher),'SUBMITTED');
 assert.ok(mock.calls.every(c=>c.options.method!=='DELETE'));
});
test('never supersedes a newer Mozilla version', async t => {
 for(const version of ['0.8.8','0.9.0']) {
  const mock=api([addon,{results:[{version,channel:'listed',file:{status:'unreviewed'}}],next:null}]);
  await assert.rejects(publishFirefox(fixture(t),env,mock.fetcher));
  assert.equal(mock.calls.length,2);
 }
});
test('recovery only targets published tested releases and shares store concurrency', () => {
 const workflow=readFileSync(new URL('../.github/workflows/recover-store-release.yml',import.meta.url),'utf8');
 assert.match(workflow,/workflow_dispatch:/);
 assert.match(workflow,/default: inspect/);
 assert.match(workflow,/github.ref == 'refs\/heads\/main'/);
 assert.match(workflow,/chrome-web-store/);assert.match(workflow,/mozilla-addons/);
 assert.match(workflow,/cancel-in-progress: false/);
 assert.ok(workflow.indexOf('prepare-store-release.mjs')<workflow.indexOf('secrets.AMO_JWT_SECRET'));
 assert.match(workflow,/cp -R scripts/);
 assert.match(workflow,/--commit "\$GITHUB_SHA"/);
});

for (const modified of [false,true]) test(`Mozilla-rendered bullet notes retain exact content (modified=${modified})`, async t => {
 const o=fixture(t);o.releaseNotes='- First fix.\n\n- Second fix.\n\nFull changelog: https://example.test/changes';
 const saved=detail(o),rendered={...saved,release_notes:{'en-US':'<ul><li>First fix.</li><li>'+ (modified?'Changed text.':'Second fix.') +'</li></ul>\nFull changelog: <a href="https://outgoing.mozilla.org/redirect">https://example.test/changes</a>'}};
 const mock=api([addon,{results:[rendered],next:null},rendered,saved,rendered]);
 if(modified) {
  await assert.rejects(publishFirefox(o,env,mock.fetcher),/Release notes were not saved/);
  assert.equal(mock.calls.filter(c=>c.options.method==='PATCH').length,1);
 } else {
  assert.equal(await publishFirefox(o,env,mock.fetcher),'ALREADY_SUBMITTED');
  assert.ok(mock.calls.every(c=>!c.options.method));
 }
});

for (const changed of [false, true]) test(`store-note section label is omitted without losing release content (changed=${changed})`, async t => {
 const o=fixture(t);o.releaseNotes='### Store release notes\n\n- First fix.\n\n- Second fix.';
 const saved=detail(o),rendered={...saved,release_notes:{'en-US':'<ul><li>First fix.</li><li>'+(changed?'Changed fix.':'Second fix.')+'</li></ul>'}};
 const mock=api([addon,{results:[rendered],next:null},rendered,saved,rendered]);
 if(changed) {
  await assert.rejects(publishFirefox(o,env,mock.fetcher),/Release notes were not saved/);
  const patch=mock.calls.find(c=>c.options.method==='PATCH');
  assert.equal(JSON.parse(String(patch?.options.body)).release_notes['en-US'],'- First fix.\n\n- Second fix.');
 } else {
  assert.equal(await publishFirefox(o,env,mock.fetcher),'ALREADY_SUBMITTED');
  assert.ok(mock.calls.every(c=>!c.options.method));
 }
});

for (const changed of [false, true]) test(`publishes section titles and inline code as lossless plain text (changed=${changed})`, async t => {
 const o=fixture(t);o.releaseNotes='### Store release notes\n\n### Archive\n\n- Handle `ERROR:` responses.\n\n### Startup\n\n- Render defaults.';
 const saved=detail(o), rendered={...saved,release_notes:{'en-US':`<p>Archive</p><ul><li>Handle ${changed?'OTHER:':'ERROR:'} responses.</li></ul><p>Startup</p><ul><li>Render defaults.</li></ul>`}};
 const mock=api([addon,{results:[{...saved,release_notes:null}],next:null},{...saved,release_notes:null},saved,rendered]);
 if(changed) await assert.rejects(publishFirefox(o,env,mock.fetcher),/Release notes were not saved/);
 else assert.equal(await publishFirefox(o,env,mock.fetcher),'SUBMITTED');
 const patch=mock.calls.find(c=>c.options.method==='PATCH');
 assert.equal(JSON.parse(String(patch?.options.body)).release_notes['en-US'],'Archive\n\n- Handle ERROR: responses.\n\nStartup\n\n- Render defaults.');
});


test('current reviewer instructions fit with commit, CRLF and both archive hashes, including recovery', async t => {
 const o = fixture(t);
 const body = readFileSync('docs/firefox-reviewer-notes.md', 'utf8').trim();
 const header = `Nostr WoT ${o.version}\nSource commit: ${'a'.repeat(40)}`;
 const concise = [header, body, 'Build: SOURCE_BUILD.md.'].join('\n\n');
 const saved = detail({ ...o, approvalNotes: concise });
 assert.ok(saved.approval_notes.replace(/\r?\n/g, '\r\n').length <= 3000);
 for (const footer of ['Build: SOURCE_BUILD.md.', 'Full build instructions: SOURCE_BUILD.md in the attached source archive. The complete changelog is supplied as release notes.']) {
  o.approvalNotes = [header, body, footer].join('\n\n');
  const mock = api([addon, empty, validated, saved, saved, saved]);
  assert.equal(await publishFirefox(o, env, mock.fetcher), 'SUBMITTED');
  const sent = (mock.calls[3].options.body as FormData).get('approval_notes');
  assert.equal(sent, saved.approval_notes);
  assert.ok(String(sent).includes(body));
 }
});
