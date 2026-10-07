import { DEFAULT_ARCHIVE_SETTINGS } from '../src/constants/archive.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, act } from 'react';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import browser from './helpers/browser-mock.ts';
import { RelaysProvider } from '../src/context/RelaysContext.tsx';
import { archiveRelayUrls } from '../src/domain/archive/settings.ts';
import { AccountArchive } from '../src/screens/Archive/index.tsx';
import { downloadArchive, importArchiveFile, archiveFileNeedsPassword } from '../src/services/archive/fileTransfer.ts';
import { type ArchiveState } from '../src/domain/archive/types.ts';

function mount() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://extension.test' });
  dom.window.HTMLElement.prototype.showPopover = function () {};
  dom.window.HTMLElement.prototype.hidePopover = function () {};
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  return { dom, root: createRoot(document.getElementById('root')!) };
}
const button = (label: string) => [...document.querySelectorAll('button')].find(node => node.textContent === label || node.getAttribute('aria-label') === label)!;
const initial = (): ArchiveState => ({ accountId: 'a', pubkey: '11'.repeat(32), settings: { ...DEFAULT_ARCHIVE_SETTINGS, groups: [{ id: 'profile', name: 'Profile', relays: ['wss://configured.test/'] }], selectedGroupId: 'profile' }, progress: { phase: 'idle', fetched: 0 }, count: 4, bytes: 100, checkpoints: [] });

test('relay input rejects credentials, non-websocket schemes and multiple destination ambiguity', () => {
  assert.deepEqual(archiveRelayUrls('wss://a.test\nwss://a.test,ws://localhost'), ['wss://a.test/', 'ws://localhost/']);
  for (const value of ['', 'https://a.test', 'ws://remote.test', 'wss://user:pass@a.test', 'wss://a.test/#fragment', 'invalid']) assert.throws(() => archiveRelayUrls(value));
});

test('archive screen requires confirmation to clear, refreshes local changes, and surfaces failures', async context => {
  const { dom, root } = mount(); let state = initial(); let clears = 0; let fail = true;
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => {
    assert.equal(message.params.accountId, 'a');
    if (message.method === 'archive_getState') return { result: state };
    if (message.method === 'archive_clear') { clears++; return fail ? { error: 'disk unavailable' } : { result: { ok: true } }; }
    if (message.method === 'archive_configure') { state = { ...state, settings: message.params.settings }; return { result: state }; }
    throw new Error(message.method);
  });
  try {
    await act(async () => root.render(createElement(RelaysProvider, null, createElement(AccountArchive, { accountId: 'a' }))));
    assert.ok(document.body.textContent!.includes('archive.localWarning'));
    const sync = button('archive.sync');
    assert.equal(sync.nextElementSibling, button('archive.explorer.title'));
    assert.equal(button('archive.explorer.title').nextElementSibling, button('archive.settings'));
    await act(async () => button('archive.clear').click());
    assert.equal(clears, 0);
    await act(async () => button('common.cancel').click()); assert.equal(clears, 0);
    await act(async () => button('archive.clear').click());
    await act(async () => button('common.confirm').click()); assert.equal(clears, 1); assert.match(document.body.textContent!, /disk unavailable/);
    fail = false;
    await act(async () => button('common.confirm').click()); assert.equal(document.querySelector('[role="dialog"]'), null);
    state = { ...state, progress: { phase: 'locked', fetched: 3 } };
    await act(async () => browser.storage.local.set({ vaultLockStateAt: Date.now() }));
    assert.match(document.body.textContent!, /archive.phase.locked/);
    assert.equal((document.querySelector('[aria-label="archive.automaticArchive"]') as HTMLInputElement).disabled, true);
    state = { ...state, progress: { phase: 'idle', fetched: 0 } };
    await act(async () => browser.storage.local.set({ archiveChanged: Date.now() }));
    await act(async () => (document.querySelector('[aria-label="archive.automaticArchive"]') as HTMLInputElement).click());
    assert.equal(state.settings.automatic, true);
    assert.equal('authenticateRelays' in state.settings, false);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});


test('encrypted file transfer preserves line boundaries and only commits complete uploads', async context => {
  const calls: any[] = []; let page = 0;
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => {
    calls.push(message);
    if (message.method.endsWith('Begin')) return { result: { sessionId: 'session' } };
    if (message.method === 'archive_exportPage') return { result: { line: ['header', 'chunk', 'footer'][page++], done: page === 3 } };
    return { result: { count: 2 } };
  });
  const blob = await downloadArchive('password', 'a'); assert.equal(await blob.text(), 'header\nchunk\nfooter\n');
  calls.length = 0;
  const count = await importArchiveFile(new File(['header\nchunk\nfooter\n'], 'archive.ndjson'), 'password', 'a');
  assert.equal(count, 2); assert.deepEqual(calls.filter(call => call.method === 'archive_importChunk').map(call => call.params.line), ['header', 'chunk', 'footer']);
  assert.equal(calls.at(-1).method, 'archive_importFinish'); assert.ok(calls.every(call => call.params.accountId === 'a'));
});

test('failed import chunk prevents finalization and oversized files never start a session', async context => {
  const calls: string[] = [];
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => {
    calls.push(message.method);
    return message.method.endsWith('Begin') ? { result: { sessionId: 'session' } } : { error: 'tampered' };
  });
  await assert.rejects(importArchiveFile(new File(['invalid\n'], 'archive.ndjson'), 'password', 'a'), /tampered/);
  assert.ok(!calls.includes('archive_importFinish')); assert.ok(calls.includes('archive_fileCancel'));
  calls.length = 0;
  await assert.rejects(importArchiveFile({ size: 513 * 1024 * 1024 } as File, 'password', 'a'));
  assert.equal(calls.length, 0);
});


test('relay copy previews safe defaults and publishes only after destination confirmation', async context => {
  const { dom, root } = mount(); const calls: any[] = [];
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => {
    calls.push(message);
    if (message.method === 'archive_getState') return { result: initial() };
    if (message.method === 'archive_copyPreview') return { result: { eligible: 2, skipped: 1 } };
    return { result: { started: true } };
  });
  try {
    await act(async () => root.render(createElement(RelaysProvider, null, createElement(AccountArchive, { accountId: 'a' }))));
    const label = [...document.querySelectorAll('label')].find(node => node.textContent === 'archive.destination')!;
    const input = document.getElementById(label.htmlFor) as HTMLInputElement;
    // React's registered change handler exercises the controlled field in jsdom,
    // whose input-event feature detection depends on test import ordering.
    const propsKey = Object.keys(input).find(key => key.startsWith('__reactProps$'))!;
    await act(async () => (input as any)[propsKey].onChange({ target: { value: 'wss://destination.test' } }));
    await act(async () => button('archive.preview').click());
    const preview = calls.find(call => call.method === 'archive_copyPreview');
    assert.deepEqual(preview.params, { accountId: 'a', relay: 'wss://destination.test', includeMessages: false, includeUnknown: false });
    assert.ok(input.list?.options.length);
    assert.ok(!calls.some(call => call.method === 'archive_copy'));
    assert.match(document.querySelector('[role="dialog"]')!.textContent!, /wss:\/\/destination.test/);
    await act(async () => button('common.confirm').click());
    assert.deepEqual(calls.find(call => call.method === 'archive_copy').params, { accountId: 'a', relay: 'wss://destination.test', includeMessages: false, includeUnknown: false });
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('copying can pause, then automatic settings can be switched off', async context => {
  const { dom, root } = mount(); let state = { ...initial(), settings: { ...initial().settings, automatic: true }, progress: { phase: 'copying' as const, fetched: 2 } } as ArchiveState;
  const calls: any[] = [];
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => {
    calls.push(message);
    if (message.method === 'archive_pause') state = { ...state, progress: { phase: 'paused', fetched: 2 } };
    if (message.method === 'archive_configure') state = { ...state, settings: message.params.settings };
    return { result: state };
  });
  try {
    await act(async () => root.render(createElement(RelaysProvider, null, createElement(AccountArchive, { accountId: 'a' }))));
    assert.equal(button('archive.pause').disabled, false);
    assert.equal((document.querySelector('[aria-label="archive.automaticArchive"]') as HTMLInputElement).disabled, true);
    await act(async () => button('archive.pause').click());
    assert.ok(calls.some(call => call.method === 'archive_pause'));
    await act(async () => (document.querySelector('[aria-label="archive.automaticArchive"]') as HTMLInputElement).click());
    assert.equal(state.settings.automatic, false);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('file read and export failures cancel the backend lease and preserve the original error', async context => {
  const calls: string[] = [];
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => {
    calls.push(message.method);
    if (message.method.endsWith('Begin')) return { result: { sessionId: 'session' } };
    return { error: 'RPC failed' };
  });
  await assert.rejects(downloadArchive('password', 'a'), /RPC failed/);
  assert.equal(calls.at(-1), 'archive_fileCancel'); calls.length = 0;
  await assert.rejects(importArchiveFile({ size: 1, stream() { throw new Error('file unreadable'); } } as unknown as File, 'password', 'a'), /file unreadable/);
  assert.equal(calls.at(-1), 'archive_fileCancel');
});

test('shared Blob downloads attach the link and release their object URL after acquisition', async context => {
  const { downloadFile } = await import('../src/utils/downloadFile.ts');
  const { dom, root } = mount();
  const cleanup: (() => void)[] = [];
  const blobs: Blob[] = [];
  const revoked: string[] = [];
  const downloads: { href: string; filename: string; attached: boolean }[] = [];
  context.mock.method(URL, 'createObjectURL', (blob: Blob) => { blobs.push(blob); return 'blob:archive-test'; });
  context.mock.method(URL, 'revokeObjectURL', (url: string) => revoked.push(url));
  context.mock.method(globalThis, 'setTimeout', ((callback: () => void) => { cleanup.push(callback); return 1; }) as typeof setTimeout);
  context.mock.method(dom.window.HTMLAnchorElement.prototype, 'click', function(this: HTMLAnchorElement) {
    downloads.push({ href: this.href, filename: this.download, attached: this.isConnected });
  });
  try {
    downloadFile(new Blob(['encrypted archive']), 'archive.ndjson');
    assert.deepEqual(downloads[0], { href: 'blob:archive-test', filename: 'archive.ndjson', attached: true });
    assert.equal(blobs[0].type, 'application/octet-stream');
    assert.equal(await blobs[0].text(), 'encrypted archive');
    assert.deepEqual(revoked, []);
    cleanup.shift()!();
    assert.deepEqual(revoked, ['blob:archive-test']);
    assert.equal(document.querySelector('a'), null);
    downloadFile('small backup', 'backup.txt');
    assert.ok(downloads[1].href.startsWith('data:application/octet-stream;base64,'));
    cleanup.shift()!();
    assert.equal(blobs.length, 1);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('manual sync is available without activation, settings are a separate screen, and migration needs events', async context => {
  const { dom, root } = mount();
  let state = { ...initial(), count: 0 };
  const calls: any[] = [];
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => {
    calls.push(message);
    if (message.method === 'archive_sources') return { result: { relays: ['wss://profile.test/'], messageRelays: ['wss://inbox.test/'] } };
    if (message.method === 'archive_configure') state = { ...state, settings: message.params.settings };
    return { result: state };
  });
  try {
    await act(async () => root.render(createElement(AccountArchive, { accountId: 'a' })));
    assert.equal(document.querySelector('[aria-label="archive.enabled"]'), null);
    assert.equal(document.querySelector('details'), null);
    assert.equal(button('archive.sync').disabled, false);
    assert.equal(button('archive.preview'), undefined);
    for (const action of ['archive.sync', 'archive.download', 'archive.import', 'archive.clear']) {
      assert.equal(button(action).textContent, '');
      assert.equal(button(action).title, action);
      assert.ok(button(action).querySelector('svg'));
    }
    await act(async () => button('archive.download').click());
    assert.ok(document.querySelector('[role="dialog"]'));
    await act(async () => button('common.close').click());
    await act(async () => button('archive.import').click());
    assert.ok(button('archive.chooseFile'));
    await act(async () => button('common.close').click());

    assert.equal(document.querySelector('input[placeholder="wss://relay.example.com"]'), null);
    await act(async () => button('archive.sync').click());
    assert.ok(calls.some(call => call.method === 'archive_sync'));
    assert.ok(!calls.some(call => call.method === 'archive_configure'));
    await act(async () => button('archive.settings').click());
    assert.ok(document.querySelector('[aria-label="archive.includeMessages"]'));
    await act(async () => (document.querySelector('[aria-label="common.back"]') as HTMLButtonElement).click());
    assert.equal(document.querySelector('[aria-label="archive.includeMessages"]'), null);
    await act(async () => button('archive.settings').click());
    assert.match(document.body.textContent!, /wss:\/\/configured.test\//);
    await act(async () => button('common.add').click());
    const input = document.querySelector('input[placeholder="wss://relay.example.com"]') as HTMLInputElement;
    const props = Object.keys(input).find(key => key.startsWith('__reactProps$'))!;
    assert.ok(document.querySelector('datalist option[value="wss://nos.lol/"]'));
    await act(async () => (input as any)[props].onChange({ target: { value: 'https://invalid.test' } }));
    assert.equal(button('common.add').disabled, true);
    assert.ok(document.body.textContent!.includes('archive.invalidRelay'));
    await act(async () => (input as any)[props].onChange({ target: { value: 'wss://added.test' } }));
    await act(async () => (document.querySelector('[aria-label="common.add"]') as HTMLButtonElement).click());
    assert.deepEqual(state.settings.groups[0].relays, ['wss://configured.test/', 'wss://added.test/']);
    const remove = document.querySelector('li button') as HTMLButtonElement;
    await act(async () => remove.click());
    assert.deepEqual(state.settings.groups[0].relays, ['wss://added.test/']);
    await act(async () => button('archive.group').click());
    await act(async () => button('archive.newGroup').click());
    const groupLabel = [...document.querySelectorAll('label')].find(label => label.textContent === 'archive.groupName')!;
    const groupInput = document.getElementById(groupLabel.htmlFor) as HTMLInputElement;
    const groupProps = Object.keys(groupInput).find(key => key.startsWith('__reactProps$'))!;
    await act(async () => (groupInput as any)[groupProps].onChange({ target: { value: 'Travel' } }));
    await act(async () => button('archive.createGroup').click());
    assert.equal(state.settings.groups.length, 2);
    assert.equal(state.settings.groups[1].name, 'Travel');
    assert.equal(state.settings.selectedGroupId, state.settings.groups[1].id);
    await act(async () => button('archive.fromProfile').click());
    assert.deepEqual(state.settings.groups[1].relays, ['wss://profile.test/', 'wss://inbox.test/']);
    assert.equal(button('archive.rescan'), undefined);
    await act(async () => (document.querySelector('[aria-label="common.back"]') as HTMLButtonElement).click());
    state = { ...state, count: 1 };
    await act(async () => browser.storage.local.set({ archiveChanged: crypto.randomUUID() }));
    assert.ok(button('archive.preview'));
    assert.equal(button('archive.preview').closest('details'), null);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('relay details deduplicate stream errors and link directly to settings', async context => {
  const { dom, root } = mount();
  const state = { ...initial(), progress: { phase: 'partial' as const, fetched: 0, relay: 'wss://last-relay.test/', error: 'old repeated wall of errors' }, checkpoints: ['authored', 'messages', 'legacyMessages'].map(stream => ({ key: `wss://configured.test/|${stream}`, relay: 'wss://configured.test/', stream, complete: false, since: 0, until: 1, checkedAt: 0, error: 'Relay query timed out' })) };
  const calls: any[] = [];
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => { calls.push(message); return { result: state }; });
  try {
    await act(async () => root.render(createElement(AccountArchive, { accountId: 'a' })));
    assert.ok(!document.body.textContent!.includes('Relay query timed out'));
    assert.ok(!document.body.textContent!.includes('old repeated wall'));
    assert.ok(!document.body.textContent!.includes('wss://last-relay.test/'));
    assert.ok(!document.body.textContent!.includes('archive.fetched'));
    await act(async () => button('archive.details').click());
    const info = document.querySelector<HTMLElement>('[role="button"][aria-label="Relay query timed out"]')!;
    assert.ok(info);
    assert.equal(info.getAttribute('aria-expanded'), 'false');
    await act(async () => info.click());
    assert.equal(info.getAttribute('aria-expanded'), 'true');
    assert.ok(document.querySelector('[role="dialog"] table'));
    assert.equal(document.querySelectorAll('[role="dialog"] th').length, 4);
    await act(async () => button('archive.retryRelay').click());
    assert.ok(calls.some(call => call.method === 'archive_sync' && call.params.relay === 'wss://configured.test/'));
    assert.ok(!calls.some(call => call.method === 'archive_clear'));
    await act(async () => button('archive.changeRelays').click());
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.ok(button('archive.group'));
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('failed relay rows are red, show fetched counts and size, and keep sibling retries enabled', async context => {
  const { dom, root } = mount();
  const relays = ['wss://configured.test/', 'wss://another.test/'];
  const state: ArchiveState = { ...initial(), pendingRelays: [], settings: { ...initial().settings, groups: [{ id: 'profile', name: 'Profile', relays }] }, progress: { phase: 'partial', fetched: 3, relayResults: relays.map((relay, i) => ({ relay, success: false, attempted: true, errors: ['timeout'], fetched: i === 0 ? 3 : 0 })) } };
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const retries: string[] = [];
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => {
    if (message.method === 'archive_sync') {
      retries.push(message.params.relay);
      if (retries.length === 1) await pending;
      state.pendingRelays!.push(message.params.relay);
      state.progress.phase = 'syncing';
    }
    return { result: state };
  });
  try {
    await act(async () => root.render(createElement(AccountArchive, { accountId: 'a' })));
    assert.ok(document.querySelector('[role="status"]')?.classList.contains('text-error'));
    assert.equal(document.querySelector('[role="status"]')?.textContent, 'archive.status.incomplete');
    assert.ok(!document.body.textContent!.includes('archive.relaySummary'));
    await act(async () => button('archive.details').click());
    assert.ok(document.querySelector('[role="dialog"]')?.textContent?.includes('archive.databaseSize'));
    const rows = document.querySelectorAll('tbody tr');
    assert.ok(rows[0].querySelector('.text-error'));
    assert.equal(rows[0].children[1].textContent, '3');
    assert.equal(rows[1].children[1].textContent, '0');
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[aria-label="archive.retryRelay"]')];
    await act(async () => buttons[0].click());
    assert.equal(buttons[0].disabled, true);
    assert.equal(buttons[1].disabled, false);
    await act(async () => buttons[1].click());
    assert.deepEqual(retries, relays);
    await act(async () => { release(); await pending; });
  } finally { release(); await act(async () => root.unmount()); dom.window.close(); }
});

test('active archive work shows loading with event counts only in relay details', async context => {
  const { dom, root } = mount();
  const relay = 'wss://configured.test/';
  const state: ArchiveState = { ...initial(), pendingRelays: [relay], progress: { phase: 'syncing', fetched: 100, relay, relayResults: [{ relay, success: false, errors: [], fetched: 100 }] } };
  context.mock.method(browser.runtime, 'sendMessage', async () => ({ result: state }));
  try {
    await act(async () => root.render(createElement(AccountArchive, { accountId: 'a' })));
    assert.ok(document.querySelector('.animate-spin'));
    assert.ok(!document.body.textContent!.includes('archive.fetched'));
    await act(async () => button('archive.details').click());
    assert.ok(document.querySelector('[role="dialog"] .animate-spin'));
    assert.equal(document.querySelector('tbody tr')!.children[1].textContent, '100');
    state.progress = { phase: 'complete', fetched: 100, relayResults: [{ relay, success: true, errors: [], fetched: 100 }] };
    state.pendingRelays = [];
    await act(async () => { await browser.storage.local.set({ archiveChanged: Date.now() }); });
    assert.equal(document.querySelector('.animate-spin'), null);
    assert.ok(!document.body.textContent!.includes('archive.fetched'));
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('relay retry replaces failure colors and removes error information when it succeeds', async context => {
  const { dom, root } = mount();
  const relay = 'wss://configured.test/';
  const state: ArchiveState = { ...initial(), pendingRelays: [], progress: { phase: 'error', fetched: 0, relayResults: [{ relay, success: false, errors: ['timeout'], fetched: 0 }] } };
  context.mock.method(browser.runtime, 'sendMessage', async () => ({ result: state }));
  const update = async () => { await act(async () => { await browser.storage.local.set({ archiveChanged: Math.random() }); }); };
  try {
    await act(async () => root.render(createElement(AccountArchive, { accountId: 'a' })));
    await act(async () => button('archive.details').click());
    assert.ok(document.querySelector('tbody .text-error'));
    state.progress.phase = 'syncing'; state.progress.relay = relay; state.pendingRelays = [relay];
    await update();
    assert.ok(document.querySelector('tbody .text-brand'));
    assert.equal(document.querySelector('tbody .text-error'), null);
    state.progress = { phase: 'complete', fetched: 12, relayResults: [{ relay, success: true, errors: [], fetched: 12 }] }; state.pendingRelays = []; state.count = 12;
    await update();
    assert.ok(document.querySelector('tbody .text-success'));
    assert.equal(document.querySelector('tbody [role="button"]'), null);
    assert.equal(document.querySelector('tbody .animate-spin'), null);
    assert.equal(document.querySelector('tbody tr')!.children[1].textContent, '12');
    assert.ok(document.querySelector('[role="status"].text-success'));
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

 test('migration progress, results and pause action stay inside the migration card', async context => {
  const { dom, root } = mount();
  let state: ArchiveState = { ...initial(), progress: { phase: 'copying', fetched: 3 }, copyResult: { accepted: 2, existing: 1, failed: 0, skipped: 0 } };
  context.mock.method(browser.runtime, 'sendMessage', async () => ({ result: state }));
  try {
    const render = () => createElement(RelaysProvider, null, createElement(AccountArchive, { accountId: 'a' }));
    await act(async () => root.render(render()));
    const card = [...document.querySelectorAll('h2')].find(node => node.textContent === 'archive.copy')!.parentElement!;
    assert.ok(card.textContent!.includes('archive.phase.copying'));
    assert.ok(card.textContent!.includes('archive.copyResult'));
    assert.ok(card.contains(button('archive.pause')));
    assert.equal(button('archive.sync').disabled, true);
    state = { ...state, progress: { phase: 'complete', fetched: 3 } };
    await act(async () => browser.storage.local.set({ archiveChanged: Date.now() }));
    assert.ok(card.textContent!.includes('archive.phase.complete'));
    assert.ok(card.textContent!.includes('archive.copyResult'));
    assert.equal(card.querySelector('[aria-label="archive.pause"]'), null);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('migration failures open a details popup with event IDs and relay reasons', async context => {
  const { dom, root } = mount();
  const state = initial();
  state.progress = { phase: 'partial', fetched: 1 };
  state.copyResult = { accepted: 1, existing: 0, failed: 1, skipped: 0, failures: [{ id: 'ab'.repeat(32), kind: 1, createdAt: 10, message: 'blocked: relay policy', attempts: 2 }] };
  context.mock.method(browser.runtime, 'sendMessage', async () => ({ result: state }));
  try {
    await act(async () => root.render(createElement(RelaysProvider, null, createElement(AccountArchive, { accountId: 'a' }))));
    assert.ok(button('archive.failedEvents'));
    await act(async () => button('archive.failedEvents').click());
    const dialog = document.querySelector('[role="dialog"]')!;
    assert.ok(dialog);
    assert.match(dialog.textContent!, /blocked: relay policy/);
    assert.ok(dialog.textContent!.includes('ab'.repeat(32)));
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});


test('archive file dialogs cover the popup and require no password for ordinary files', async context => {
  const { dom, root } = mount();
  context.mock.method(browser.runtime, 'sendMessage', async () => ({ result: initial() }));
  try {
    await act(async () => root.render(createElement(RelaysProvider, null, createElement(AccountArchive, { accountId: 'a' }))));
    for (const label of ['archive.download', 'archive.import']) {
      await act(async () => button(label).click());
      const dialog = document.querySelector('[role="dialog"]')!;
      assert.equal(dialog.parentElement?.parentElement, document.body);
      assert.equal(dialog.querySelector('input[type="password"]'), null);
      await act(async () => button('common.close').click());
    }
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
test('only legacy encrypted archive headers request a password', async () => {
  assert.equal(await archiveFileNeedsPassword(new File(['{"kind":1}\n'], 'events.ndjson')), false);
  assert.equal(await archiveFileNeedsPassword(new File(['{"v":1,"type":"header","ct":"encrypted"}\n'], 'old.ndjson')), true);
  assert.equal(await archiveFileNeedsPassword(new File(['not json'], 'invalid.ndjson')), false);
});

test('explorer searches, shows full detail and confirms local deletion without leaving the screen', async context => {
  const { ArchiveExplorerContent } = await import('../src/screens/Archive/ArchiveExplorerScreen.tsx');
  const { dom, root } = mount();
  const event = { id: 'a'.repeat(64), pubkey: 'b'.repeat(64), kind: 1, content: 'A readable archived note', created_at: 1, tags: [], sig: 'c'.repeat(128) };
  const record = { event, sources: ['wss://source.example'], savedAt: 1 };
  let deleted = false, changed = 0;
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => {
    if (message.method === 'archive_explore') return { result: { records: deleted ? [] : [{ event, excerpt: event.content }], scanned: 1 } };
    if (message.method === 'archive_event') return { result: record };
    if (message.method === 'archive_deleteEvents') { assert.deepEqual(message.params.ids, [event.id]); deleted = true; return { result: { deleted: 1 } }; }
    throw new Error(message.method);
  });
  try {
    await act(async () => root.render(createElement(ArchiveExplorerContent, { accountId: 'a', total: 1, onChanged: async () => { changed++; } })));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
    assert.match(document.body.textContent!, /A readable archived note/);
    await act(async () => button('archive.details').click());
    await act(async () => button('archive.explorer.advanced').click());
    assert.match(document.body.textContent!, /wss:\/\/source.example/);
    assert.match(document.body.textContent!, /cccccccc/);
    await act(async () => button('common.close').click());
    await act(async () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async () => button('archive.explorer.delete').click());
    assert.equal(deleted, false);
    await act(async () => button('common.confirm').click());
    assert.equal(deleted, true); assert.equal(changed, 1);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
    assert.match(document.body.textContent!, /archive.explorer.empty/);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('closed or changed explorer searches ignore late responses', async context => {
  const { default: useArchiveExplorer } = await import('../src/hooks/useArchiveExplorer.ts');
  const { dom, root } = mount();
  let release!: (response: unknown) => void;
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => {
    if (message.params.filter.query === 'old') return new Promise(resolve => { release = resolve; });
    return { result: { records: [], scanned: 7 } };
  });
  function Harness({ query }: { query: string }) {
    const result = useArchiveExplorer('a', { tab: 'all', query }, 0);
    return createElement('span', null, result.scanned);
  }
  try {
    await act(async () => root.render(createElement(Harness, { query: 'old' })));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 230)); });
    await act(async () => root.render(createElement(Harness, { query: 'new' })));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 230)); });
    assert.equal(document.getElementById('root')!.textContent, '7');
    await act(async () => release({ result: { records: [], scanned: 99 } }));
    assert.equal(document.getElementById('root')!.textContent, '7');
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('explorer counts all matching events independently of scanned records and page size', async context => {
  const { default: useArchiveExplorer } = await import('../src/hooks/useArchiveExplorer.ts');
  const { dom, root } = mount();
  const records = Array.from({ length: 159 }, (_, index) => ({ event: { id: index.toString(16).padStart(64, '0'), pubkey: 'a'.repeat(64), kind: index < 39 ? 1 : index < 139 ? 4 : 9999, created_at: index }, excerpt: 'sample' }));
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => {
    const start = message.params.after ? records.findIndex(record => record.event.id === message.params.after) + 1 : 0;
    const page = records.slice(start, start + 40);
    const tab = message.params.filter.tab;
    return { result: { records: page.filter(record => tab === 'all' || (tab === 'notes' ? record.event.kind === 1 : record.event.kind === 4)), scanned: page.length, next: start + 40 < records.length ? page.at(-1)!.event.id : undefined } };
  });
  let next!: () => void;
  function Harness({ tab }: { tab: 'all' | 'notes' | 'messages' }) {
    const result = useArchiveExplorer('a', { tab, query: '' }, 0);
    next = result.nextPage;
    return createElement('span', null, JSON.stringify({ scanned: result.scanned, matched: result.matching, shown: result.records.length, page: result.page }));
  }
  const read = () => JSON.parse(document.getElementById('root')!.textContent!);
  try {
    await act(async () => root.render(createElement(Harness, { tab: 'all' })));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
    assert.deepEqual(read(), { scanned: 159, matched: 159, shown: 40, page: 0 });
    await act(async () => next());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
    assert.deepEqual(read(), { scanned: 159, matched: 159, shown: 40, page: 1 });
    await act(async () => root.render(createElement(Harness, { tab: 'notes' })));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
    assert.deepEqual(read(), { scanned: 159, matched: 39, shown: 39, page: 0 });
    await act(async () => root.render(createElement(Harness, { tab: 'messages' })));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
    assert.deepEqual(read(), { scanned: 159, matched: 100, shown: 40, page: 0 });
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
