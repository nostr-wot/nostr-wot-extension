import { resetWotDatabase } from './helpers/wot-storage.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graphDetails, graphPath, graphStats, trustScore } from '../src/domain/wot/graph.ts';
import { validateWotSettings, wotPubkey, wotTargets } from '../src/domain/wot/validation.ts';
const a = '11'.repeat(32), b = '22'.repeat(32), c = '33'.repeat(32), d = '44'.repeat(32);
const graph = { root: a, follows: { [a]: [b, c], [b]: [a, d], [c]: [d] }, relays: {}, updatedAt: 1, truncated: false };
test('WoT graph counts shortest paths, handles cycles, limits hops and preserves legacy scores', () => {
    assert.deepEqual(graphDetails(graph, d, 2), { hops: 2, paths: 2, score: 0.65 });
    assert.equal(graphDetails(graph, d, 1), null);
    assert.deepEqual(graphPath(graph, d, 2), [a, b, d]);
    assert.equal(graphPath(graph, '55'.repeat(32), 3), null);
    assert.deepEqual(graphDetails(graph, a, 2), { hops: 0, paths: 1, score: 1 });
    assert.equal(trustScore(3, 100), 0.75);
});
test('experimental settings default off and reject unsafe modes, URLs and resource limits', () => {
    assert.equal(validateWotSettings({}).enabled, false);
    assert.throws(() => validateWotSettings({ enabled: true, mode: 'remote', oracleUrl: '' }), /oracle/i);
    assert.throws(() => validateWotSettings({ mode: 'surprise' as never }), /mode/i);
    assert.throws(() => validateWotSettings({ maxHops: 50 }), /hops/i);
    for (const oracleUrl of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/?x=1'])
        assert.throws(() => validateWotSettings({ oracleUrl }), /URL/i);
    assert.equal(validateWotSettings({ enabled: true, mode: 'hybrid', oracleUrl: 'https://oracle.example/' }).oracleUrl, 'https://oracle.example');
    assert.equal(wotPubkey(a.toUpperCase()), a);
    assert.throws(() => wotPubkey('bad'), /pubkey/i);
    assert.throws(() => wotTargets(Array(101).fill(a)), /100/);
    assert.deepEqual(wotTargets([a, a, b]), [a, b]);
});
import { afterEach } from 'node:test';
import browser from '../src/lib/browser.ts';
import { resetMockStorage } from './helpers/browser-mock.ts';
import { getWotSettings, saveWotSettings, wotContext, invalidateWot, clearWotGraph } from '../src/services/wot/state.ts';
import { queryWot } from '../src/services/wot/queries.ts';
import { WotOracle } from '../src/services/wot/oracle.ts';
import { getWotState, handleWotRequest, handlers } from '../src/services/background/wot-handlers.ts';
import { syncWotGraph, isWotSyncing } from '../src/services/wot/sync.ts';
import { WOT_GRAPH_PREFIX, WOT_SYNC_STATUS_KEY } from '../src/constants/wot.ts';
const originalFetch = globalThis.fetch, originalSocket = globalThis.WebSocket;
afterEach(async () => { invalidateWot(); resetMockStorage(); await resetWotDatabase(); globalThis.fetch = originalFetch; globalThis.WebSocket = originalSocket; });
async function setup(mode: 'local' | 'remote' | 'hybrid' = 'local') {
    await browser.storage.local.set({ accounts: [{ id: 'a', pubkey: a, type: 'npub' }], activeAccountId: 'a', allowedDomains: ['https://site.test'], [WOT_GRAPH_PREFIX + 'a']: graph });
    await browser.storage.sync.set({ myPubkey: a });
    await saveWotSettings({ enabled: true, mode, oracleUrl: 'https://oracle.test', maxHops: 2 });
}
test('disabled by default, explicitly enabled, persisted and account-scoped', async () => {
    assert.equal((await getWotSettings()).enabled, false);
    await assert.rejects(queryWot('getStatus', {}), /disabled/);
    assert.equal(await handleWotRequest('wot_isEnabled', { origin: 'https://site.test' }), false);
    await setup();
    assert.equal((await getWotState()).hasLocalGraph, true);
    assert.equal((await wotContext()).account.id, 'a');
    await browser.storage.local.set({ accounts: [{ id: 'b', pubkey: b }], activeAccountId: 'b' });
    assert.equal((await wotContext()).graph, null);
    await clearWotGraph();
    assert.equal((await getWotState()).hasLocalGraph, false);
    await saveWotSettings({ enabled: false });
    await assert.rejects(queryWot('getStatus', {}), /disabled/);
});
test('all historical local query methods operate on the shared snapshot', async () => {
    await setup();
    assert.equal(await queryWot('getDistance', { target: d }), 2);
    assert.equal(await queryWot('getTrustScore', { target: d }), 0.65);
    assert.equal(await queryWot('isInMyWoT', { target: d, maxHops: 1 }), false);
    assert.deepEqual(await queryWot('getDetails', { target: d }), { hops: 2, paths: 2, score: 0.65 });
    assert.deepEqual(await queryWot('getPath', { target: d }), [a, b, d]);
    assert.deepEqual(await queryWot('getFollows', {}), [b, c]);
    assert.deepEqual(await queryWot('getCommonFollows', { pubkey: b }), []);
    assert.deepEqual(await queryWot('filterByWoT', { pubkeys: [d, '55'.repeat(32)] }), [d]);
    assert.deepEqual(await queryWot('getDistanceBatch', { targets: [d], includePaths: true, includeScores: true }), { [d]: { hops: 2, paths: 2, score: 0.65 } });
    assert.deepEqual(await queryWot('getTrustScoreBatch', { targets: [d] }), { [d]: 0.65 });
    assert.deepEqual(await queryWot('getRelayList', { pubkey: a }), null);
    assert.deepEqual(await queryWot('getRelayPool', {}), []);
    assert.equal((await queryWot('getConfig', {}) as any).maxHops, 2);
    assert.equal((await queryWot('getStats', {}) as any).nodes, 4);
    assert.equal((await queryWot('getStatus', {}) as any).mode, 'local');
    await assert.rejects(queryWot('syncGraph', {}), /Unknown/);
    await assert.rejects(queryWot('getDistance', { target: d, maxHops: 99 }), /maxHops/);
    await assert.rejects(queryWot('getDistanceBatch', { targets: Array(101).fill(a) }), /100/);
});
test('website queries require opt-in, secure origin, site connection and identity access', async () => {
    await setup();
    assert.equal(await handleWotRequest('wot_getDistance', { origin: 'https://site.test', target: d }), 2);
    await assert.rejects(handleWotRequest('wot_getDistance', { origin: 'https://other.test', target: d }), /connected/);
    await assert.rejects(handleWotRequest('wot_getStatus', { origin: 'http://site.test' }), /HTTPS/);
    await browser.storage.local.set({ identityDisabledSites: ['https://site.test'] });
    await assert.rejects(handleWotRequest('wot_getStatus', { origin: 'https://site.test' }), /identity/);
    assert.equal(handlers.has('experimentalWot_save'), true);
    assert.equal(handlers.has('wot_getDistance'), false);
});
test('oracle validates responses and uses bounded credential-free HTTPS requests', async () => {
    const calls: {
        url: string;
        init?: RequestInit;
    }[] = [];
    let response: unknown = { hops: 2, paths: 2 };
    let status = 200;
    const oracle = new WotOracle('https://oracle.test', new AbortController().signal, async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(response), { status });
    });
    assert.deepEqual(await oracle.details(a, d), { hops: 2, paths: 2, score: 0.65 });
    assert.equal(new URL(calls[0].url).searchParams.get('from'), a);
    assert.equal(calls[0].init?.credentials, 'omit');
    assert.equal(calls[0].init?.redirect, 'error');
    response = { hops: -1 };
    await assert.rejects(oracle.details(a, d), /distance/);
    response = { hops: 2, paths: 'bad' };
    await assert.rejects(oracle.details(a, d), /paths/);
    response = { follows: [b, c] };
    assert.deepEqual(await oracle.follows(a), [b, c]);
    response = { common: [c] };
    assert.deepEqual(await oracle.common(a, b), [c]);
    response = { follows: ['bad'] };
    await assert.rejects(oracle.follows(a), /pubkey/);
    response = { path: [a, b, d] };
    assert.deepEqual(await oracle.path(a, d), [a, b, d]);
    response = { path: [a, b, a, d] };
    await assert.rejects(oracle.path(a, d), /path/);
    response = { path: [b, d] };
    await assert.rejects(oracle.path(a, d), /path/);
    response = { nodes: 50 };
    assert.deepEqual(await oracle.stats(), { nodes: 50 });
    response = null;
    status = 404;
    assert.equal(await oracle.details(a, d), null);
    status = 302;
    await assert.rejects(oracle.stats(), /redirect/);
    status = 500;
    await assert.rejects(oracle.stats(), /500/);
    status = 200;
    response = { payload: 'x'.repeat(1024 * 1024) };
    await assert.rejects(oracle.stats(), /large/);
});
test('remote and hybrid query modes share oracle cache and keep local answers local', async () => {
    await setup('hybrid');
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ hops: 2, paths: 1 })); };
    assert.equal(await queryWot('getDistance', { target: d }), 2);
    assert.equal(calls, 0);
    const target = '66'.repeat(32);
    assert.deepEqual(await Promise.all([queryWot('getDistance', { target }), queryWot('getDistance', { target })]), [2, 2]);
    assert.equal(calls, 1);
    await queryWot('getDistance', { target });
    assert.equal(calls, 1);
    await saveWotSettings({ enabled: true, mode: 'remote', oracleUrl: 'https://second.test', maxHops: 2 });
    assert.equal(await queryWot('getDistance', { target: d }), 2);
    assert.equal(calls, 2);
    await assert.rejects(queryWot('getDistanceBatch', { targets: Array.from({ length: 101 }, (_, i) => i.toString(16).padStart(64, '0')) }), /100/);
});
test('disabling or switching accounts rejects an in-flight oracle result', async () => {
    await setup('remote');
    let resolve!: (value: Response) => void;
    globalThis.fetch = async () => new Promise<Response>(r => { resolve = r; });
    const pending = queryWot('getDistance', { target: '77'.repeat(32) });
    const rejection = assert.rejects(pending, /changed|aborted/);
    while (!resolve)
        await new Promise(r => setTimeout(r, 0));
    await saveWotSettings({ enabled: false });
    resolve(new Response(JSON.stringify({ hops: 1 })));
    await rejection;
});
import { signEvent } from '../src/lib/crypto/nip01.ts';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { relaySocket } from './helpers/wot-relay.ts';
test('manual sync verifies events, uses both layers, retains cache on failure and does no automatic work', async () => {
    const key = new Uint8Array(32).fill(7), otherKey = new Uint8Array(32).fill(8);
    const root = bytesToHex(schnorr.getPublicKey(key)), other = bytesToHex(schnorr.getPublicKey(otherKey));
    await browser.storage.local.set({ accounts: [{ id: 'sync', pubkey: root, type: 'npub' }], activeAccountId: 'sync' });
    await browser.storage.sync.set({ relays: 'wss://relay.test' });
    const events = [
        await signEvent({ pubkey: root, kind: 3, created_at: 10, tags: [['p', other]], content: '' }, key),
        await signEvent({ pubkey: other, kind: 3, created_at: 10, tags: [['p', d]], content: '' }, otherKey),
        await signEvent({ pubkey: root, kind: 10000, created_at: 10, tags: [['p', b], ['word', 'example']], content: '' }, key),
        await signEvent({ pubkey: root, kind: 10002, created_at: 10, tags: [['r', 'wss://relay.test', 'read']], content: '' }, key),
    ];
    const sockets = relaySocket([...events, { ...events[0], created_at: 11, tags: [['p', a]] }]);
    await saveWotSettings({ enabled: true });
    assert.equal(sockets().calls, 0);
    const pending = syncWotGraph();
    assert.equal(isWotSyncing(), true);
    await assert.rejects(syncWotGraph(), /already/);
    const synced = await pending;
    assert.equal(isWotSyncing(), false);
    const progress = (await browser.storage.local.get(WOT_SYNC_STATUS_KEY))[WOT_SYNC_STATUS_KEY] as import('../src/domain/wot/types.ts').WotSyncProgress;
    assert.equal(progress.running, false);
    assert.equal(progress.phase, 'complete');
    assert.equal(progress.authors, 2);
    assert.deepEqual(synced.follows[root], [other]);
    assert.deepEqual([...(await readWotMutes('sync', root)).people], [b]);
    assert.equal((await readWotMutes('sync', root)).status, 'ready');
    assert.deepEqual(synced.follows[other], [d]);
    assert.equal(await queryWot('getDistance', { target: d }), 2);
    assert.deepEqual(await queryWot('getRelayList', { pubkey: root }), [{ url: 'wss://relay.test', read: true, write: false }]);
    assert.deepEqual(await queryWot('getRelayPool', {}), [{ url: 'wss://relay.test', endorsements: 1 }]);
    assert.equal(sockets().calls, 1);
    await seedRelayCache(MUTE_LIST_CACHE, root, { ...muteList([c]), createdAt: 20 });
    await syncWotGraph();
    assert.deepEqual([...(await readWotMutes('sync', root)).people], [c]);
    assert.ok(sockets().closed >= 1);
    relaySocket([], true);
    await assert.rejects(syncWotGraph(), /previous graph retained/);
    assert.equal(await queryWot('getDistance', { target: d }), 2);
    await handlers.get('experimentalWot_clear')!({});
    assert.equal((await getWotState()).hasLocalGraph, false);
    await saveWotSettings({ enabled: false });
    await assert.rejects(syncWotGraph(), /disabled/);
});
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
test('real injected WoT API appears only after opt-in, preserves methods and disappears on disable', async () => {
    const listeners: ((event: unknown) => void)[] = [];
    const messages: any[] = [];
    const events: string[] = [];
    const window: any = { location: { origin: 'https://site.test' }, addEventListener: (_: string, listener: (event: unknown) => void) => listeners.push(listener), postMessage: (message: unknown) => messages.push(message), dispatchEvent: (event: {
            type: string;
        }) => events.push(event.type) };
    const source = readFileSync(new URL('../inject.ts', import.meta.url), 'utf8');
    runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { window, exports: {}, crypto, setTimeout, clearTimeout, __NIP07_CALL_TIMEOUT_MS__: 1000, __WEBLN_CALL_TIMEOUT_MS__: 1000, CustomEvent: class {
            constructor(public type: string, public options: unknown) { }
        } });
    const deliver = (data: unknown) => listeners.forEach(listener => listener({ source: window, data }));
    assert.equal(window.nostr.wot, undefined);
    assert.ok(messages.some(m => m.type === 'WOT_DISCOVER'));
    deliver({ type: 'WOT_AVAILABILITY', enabled: true });
    assert.equal(typeof window.nostr.wot.getDistance, 'function');
    assert.equal(Object.keys(window.nostr.wot).length, 15);
    const pending = window.nostr.wot.getDistanceBatch([a], true), request = messages.at(-1);
    assert.equal(request.type, 'WOT_REQUEST');
    assert.equal(request.params.includePaths, true);
    deliver({ type: 'WOT_RESPONSE', id: request.id, result: { [a]: 0 } });
    assert.deepEqual(await pending, { [a]: 0 });
    deliver({ type: 'WOT_AVAILABILITY', enabled: false });
    assert.equal(window.nostr.wot, undefined);
    assert.equal(typeof window.nostr.signEvent, 'function');
    assert.ok(events.includes('nostr:wotChanged'));
});
test('experimental menu reuses shared controls and never introduces a wizard step', () => {
    const menu = readFileSync(new URL('../src/screens/Menu/MenuOverlay.tsx', import.meta.url), 'utf8');
    const wizard = readFileSync(new URL('../src/screens/Wizard/WizardSteps.tsx', import.meta.url), 'utf8');
    assert.match(menu, /case 'experimental-wot'/);
    assert.doesNotMatch(wizard, /WotSection|wotSync/);
});
import * as permissions from '../src/services/permissions/permissions.ts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WotSettingsForm } from '../src/screens/Settings/WotSection';
test('explicit identity denial also denies WoT even for an already-connected site', async () => {
    await setup();
    await permissions.save('https://site.test', 'getPublicKey', null, 'deny', 'a');
    await assert.rejects(handleWotRequest('wot_getDistance', { origin: 'https://site.test', target: d }), /Permission denied/);
});
test('experimental settings render an unchecked opt-in and shared controls with disclosures', () => {
    const html = renderToStaticMarkup(createElement(WotSettingsForm, { accountId: 'a' }));
    assert.match(html, /type="checkbox"/);
    assert.doesNotMatch(html, /checked=""/);
    assert.match(html, /wot.consent/);
    assert.doesNotMatch(html, /wot.syncNotice/);
    assert.doesNotMatch(html, /role="tablist"/);
    assert.match(html, /wot.syncSettings/);
    assert.match(html, /wot.calculateScore/);
});

import { seedRelayCache } from '../src/services/relays/relayCache.ts';
import { MUTE_LIST_CACHE } from '../src/constants/relays.ts';
import { readWotMutes } from '../src/services/wot/mutes.ts';
import * as vault from '../src/services/vault/vault.ts';
import { nip44Encrypt } from '../src/lib/crypto/nip44.ts';
import { nip04Encrypt } from '../src/lib/crypto/nip04.ts';
import { getPublicKey } from '../src/lib/crypto/secp256k1.ts';
const muteList = (people: string[], rawContent = '') => ({ people, rawContent, words: [], hashtags: [], events: [], createdAt: 1, reachable: true });
test('account mutes zero scores, exclude membership and remove only affected local paths', async () => {
    await setup();
    await seedRelayCache(MUTE_LIST_CACHE, a, muteList([b]));
    assert.equal(await queryWot('getTrustScore', { target: b }), 0);
    assert.equal(await queryWot('isInMyWoT', { target: b }), false);
    assert.equal(await queryWot('getDistance', { target: b }), null);
    assert.equal(await queryWot('getPath', { target: b }), null);
    assert.deepEqual(await queryWot('getDetails', { target: d }), { hops: 2, paths: 1, score: 0.5 });
    assert.deepEqual(await queryWot('getPath', { target: d }), [a, c, d]);
    assert.deepEqual(await queryWot('getTrustScoreBatch', { targets: [b, d] }), { [b]: 0, [d]: 0.5 });
    assert.deepEqual(await queryWot('filterByWoT', { pubkeys: [b, d] }), [d]);
    assert.equal((await readWotMutes('other', c)).people.size, 0);
    await seedRelayCache(MUTE_LIST_CACHE, a, muteList([]));
    assert.equal(await queryWot('getTrustScore', { target: d }), 0.65);
});
test('oracle cannot restore muted targets or paths, including cached answers', async () => {
    await setup('remote');
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ path: [a, b, d] })); };
    await seedRelayCache(MUTE_LIST_CACHE, a, muteList([b]));
    assert.equal(await queryWot('getTrustScore', { target: b }), 0);
    assert.equal(calls, 0);
    assert.equal(await queryWot('getTrustScore', { target: d }), null);
    assert.equal(await queryWot('getPath', { target: d }), null);
    await seedRelayCache(MUTE_LIST_CACHE, a, muteList([c]));
    assert.equal(await queryWot('getTrustScore', { target: d }), 0.5);
});
test('private NIP-44 and legacy NIP-04 mutes use local decryption without plaintext persistence', async () => {
    const key = new Uint8Array(32).fill(7), pubkey = bytesToHex(getPublicKey(key));
    await vault.create('', { accounts: [{ id: 'private', name: '', type: 'nsec', pubkey, privkey: bytesToHex(key), mnemonic: null, nip46Config: null, readOnly: false, createdAt: 1 }], activeAccountId: 'private' });
    try {
        for (const encrypt of [nip44Encrypt, nip04Encrypt]) {
            const raw = await encrypt(JSON.stringify([['p', d], ['word', b]]), key, getPublicKey(key));
            await seedRelayCache(MUTE_LIST_CACHE, pubkey, muteList([c], raw));
            const mutes = await readWotMutes('private', pubkey);
            assert.equal(mutes.status, 'ready');
            assert.deepEqual([...mutes.people], [c, d]);
            assert.ok(!JSON.stringify(await browser.storage.local.get(null)).includes(d));
        }
        vault.lock();
        const locked = await readWotMutes('private', pubkey);
        assert.equal(locked.status, 'private-unavailable');
        assert.deepEqual([...locked.people], [c]);
    } finally { vault.lock(); key.fill(0); }
});

test('WoT settings interact through RPC, show the notice, and persist its dismissal', async t => {
    const { JSDOM } = await import('jsdom');
    const { act } = await import('react');
    const { WOT_NOTICE_DISMISSED_KEY } = await import('../src/constants/wot.ts');
    const dom = new JSDOM('<div id="root"></div>');
    const globals = new Map(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
    Object.defineProperties(globalThis, { window: { value: dom.window, configurable: true }, document: { value: dom.window.document, configurable: true }, IS_REACT_ACT_ENVIRONMENT: { value: true, configurable: true } });
    const { createRoot } = await import('react-dom/client');
    await setup();
    await saveWotSettings({ enabled: false });
    const pendingRpc = new Set<Promise<unknown>>();
    t.mock.method(browser.runtime, 'sendMessage', (message: any) => {
        const request = (async()=>{
            try { return { result: await handlers.get(message.method)!(message.params) }; }
            catch (e) { return { error: (e as Error).message }; }
        })();
        pendingRpc.add(request);
        void request.finally(()=>pendingRpc.delete(request));
        return request;
    });
    let root = createRoot(dom.window.document.getElementById('root')!);
    const mount = () => act(async () => { root.render(createElement(WotSettingsForm, { accountId: 'a', pubkey: a })); });
    const click = (selector: string) => act(async () => { dom.window.document.querySelector<HTMLElement>(selector)!.click(); });
    const button = (text: string) => Array.from(dom.window.document.querySelectorAll('button')).find(b => b.textContent === text)!;
    try {
        await mount();
        assert.ok(dom.window.document.querySelector('[role="dialog"]'));
        await act(async () => { button('common.gotIt').click(); });
        assert.equal((await browser.storage.local.get(WOT_NOTICE_DISMISSED_KEY))[WOT_NOTICE_DISMISSED_KEY], undefined);
        await act(async () => root.unmount());
        root = createRoot(dom.window.document.getElementById('root')!);
        await mount();
        assert.ok(dom.window.document.querySelector('[role="dialog"]'));
        await click('input[aria-label="wot.dontShowAgain"]');
        await act(async () => { button('common.gotIt').click(); });
        assert.equal(dom.window.document.querySelector('[role="dialog"]'), null);
        assert.equal(button('common.save'), undefined);
        assert.equal(button('wot.resync'), undefined);
        assert.doesNotMatch(dom.window.document.body.textContent!, /wot.depthHint/);
        assert.equal(dom.window.document.querySelector('input[aria-label="wot.autoSync"]'), null);
        await act(async () => { button('wot.syncSettings').click(); });
        await click('input[aria-label="wot.autoSync"]');
        assert.equal((await getWotSettings()).autoSync, false);
        await act(async () => button('common.save').click());
        assert.equal((await getWotSettings()).autoSync, true);
        await click('input[aria-label="wot.autoSync"]');
        await act(async () => button('common.save').click());
        assert.equal((await getWotSettings()).autoSync, false);
        assert.ok(dom.window.document.querySelector('[role="button"][aria-label="wot.depthHint"]'));
        assert.ok(dom.window.document.querySelector('[role="button"][aria-label="wot.edgeLimitHint"]'));
        assert.ok(dom.window.document.querySelector('[role="button"][aria-label="wot.authorLimitHint"]'));
        assert.ok(dom.window.document.querySelector('[role="button"][aria-label="wot.followsLimitHint"]'));
        assert.match(dom.window.document.body.textContent!, /wot.databases/);
        await act(async () => { button('3').click(); });
        assert.ok(button('common.save'));
        await act(async () => { button('common.save').click(); });
        assert.equal((await getWotSettings()).maxHops, 3);
        const editEdges = (value: string) => act(async () => {
            const input = dom.window.document.querySelector<HTMLInputElement>('input[aria-label="wot.edgeLimit"]')!;
            Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
            input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        });
        await editEdges('0');
        assert.equal(button('common.save').disabled, true);
        await editEdges('50000');
        await act(async () => { button('common.save').click(); });
        assert.equal((await getWotSettings()).maxEdges, 50000);
        await editEdges('');
        await act(async () => { button('common.save').click(); });
        assert.equal((await getWotSettings()).maxEdges, null);
        const editAuthors = (value: string) => act(async () => {
            const input = dom.window.document.querySelector<HTMLInputElement>('input[aria-label="wot.authorLimit"]')!;
            Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
            input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        });
        await editAuthors('0');
        assert.equal(button('common.save').disabled, true);
        await editAuthors('500');
        await act(async () => { button('common.save').click(); });
        assert.equal((await getWotSettings()).maxAuthors, 500);
        await editAuthors('');
        await act(async () => { button('common.save').click(); });
        assert.equal((await getWotSettings()).maxAuthors, null);
        const editFollows = (value: string) => act(async () => {
            const input = dom.window.document.querySelector<HTMLInputElement>('input[aria-label="wot.followsLimit"]')!;
            Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
            input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        });
        await editFollows('0');
        assert.equal(button('common.save').disabled, true);
        await editFollows('1200');
        await act(async () => { button('common.save').click(); });
        assert.equal((await getWotSettings()).maxFollows, 1200);
        await editFollows('');
        await act(async () => { button('common.save').click(); });
        assert.equal((await getWotSettings()).maxFollows, null);
        await click('button[aria-label="common.close"]');
        await click('button[aria-label="wot.scoringSettings"]');
        assert.match(dom.window.document.body.textContent!, /wot.scoringHint/);
        const scoringDialog = dom.window.document.querySelector('[role="dialog"]')!;
        assert.equal(scoringDialog.textContent!.split('wot.scoringHint')[0], 'wot.scoring');
        assert.equal(scoringDialog.querySelector('button')?.getAttribute('aria-label'), 'common.close');
        const editWeight = (value: string) => act(async () => {
            const input = dom.window.document.querySelector<HTMLInputElement>('input[type=number][max="1"]')!;
            Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
            input.dispatchEvent(new dom.window.Event('input', {bubbles:true}));
        });
        await editWeight('1.2');
        assert.equal(button('common.save'), undefined);
        assert.equal((await getWotSettings()).scoring.distanceWeights[1], 1);
        await editWeight('0.9');
        assert.equal((await getWotSettings()).scoring.distanceWeights[1], 0.9);
        await act(async () => { button('wot.resetScoring').click(); });
        assert.equal((await getWotSettings()).scoring.distanceWeights[1], 1);
        assert.equal(button('common.save'), undefined);
        await click('button[aria-label="common.close"]');
        await act(async () => button('wot.syncSettings').click());
        assert.equal(dom.window.document.querySelector('[role="dialog"]'), null, 'sync settings use a full screen, not a dialog');
        await act(async () => { while (pendingRpc.size) await Promise.all([...pendingRpc]); });
        assert.ok(dom.window.document.querySelector('table button[aria-label^="wot.resync:"]'));
        assert.match(dom.window.document.body.textContent!, /wot.syncNotice/);
        await click('table button[aria-label^="common.remove:"]');
        assert.ok(dom.window.document.querySelector('[role="dialog"]'));
        await act(async () => { button('common.remove').click(); });
        await act(async () => { while(pendingRpc.size) await Promise.all([...pendingRpc]); });
        assert.ok(button('wot.sync'));
        assert.equal(button('wot.resync'), undefined);
        await click('button[aria-label="common.back"]');
        assert.equal((await browser.storage.local.get(WOT_NOTICE_DISMISSED_KEY))[WOT_NOTICE_DISMISSED_KEY], true);
        assert.match(dom.window.document.body.textContent!, /wot.experimentalNotice/);
        await click('input[aria-label="wot.enable"]');
        assert.equal((await getWotSettings()).enabled, true);
        assert.equal(dom.window.document.querySelector<HTMLInputElement>('input[aria-label="wot.enable"]')!.checked, true);
        await act(async () => { button('wot.syncSettings').click(); });
        await act(async () => { button('wot.hybrid').click(); });
        assert.equal(button('wot.hybrid').getAttribute('aria-selected'), 'true');
        await act(async () => { await browser.storage.local.set({ [WOT_SYNC_STATUS_KEY]: { running: true } }); });
        assert.equal(button('wot.hybrid').getAttribute('aria-selected'), 'true', 'progress refresh must preserve unsaved edits');
        assert.ok(dom.window.document.querySelector('input[placeholder="https://oracle.example"]'));
        await act(async () => { button('wot.local').click(); });
        await click('button[aria-label="common.close"]');
        await click('input[aria-label="wot.enable"]');
        assert.equal((await getWotSettings()).enabled, false);
        await act(async () => root.unmount());
        root = createRoot(dom.window.document.getElementById('root')!);
        await mount();
        assert.equal(dom.window.document.querySelector('[role="dialog"]'), null);
        t.mock.method(browser.runtime, 'sendMessage', async () => ({ error: 'Unknown method: experimentalWot_getState' }));
        await act(async () => root.unmount());
        root = createRoot(dom.window.document.getElementById('root')!);
        await mount();
        assert.match(dom.window.document.body.textContent!, /wot.reloadRequired/);
        assert.ok(button('wot.reloadExtension'));
        let reloaded = false;
        Object.defineProperty(browser.runtime, 'reload', { configurable: true, value: () => { reloaded = true; } });
        await act(async () => { button('wot.reloadExtension').click(); });
        assert.equal(reloaded, true);
        Reflect.deleteProperty(browser.runtime, 'reload');
        assert.equal(dom.window.document.querySelector<HTMLInputElement>('input[aria-label="wot.enable"]')!.disabled, true);
    } finally {
        await act(async () => root.unmount()); dom.window.close();
        for (const [key, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    }
});

test('actual background dispatcher registers WoT settings and rejects website access', async t => {
    let listener: any;
    const runtime = browser.runtime as any;
    runtime.onConnect = { addListener() {} };
    t.after(() => { delete runtime.onConnect; });
    t.mock.method(runtime.onMessage, 'addListener', (fn: any) => { listener = fn; });
    await import('../background.ts');
    await new Promise(resolve => setTimeout(resolve, 20));
    await setup();
    const send = (method: string, params: any, sender: any) => new Promise<any>(resolve => listener({ method, params }, sender, resolve));
    const internal = { id: runtime.id, url: runtime.getURL('src/entrypoints/popup/index.html') };
    const state = await send('experimentalWot_getState', {}, internal);
    assert.equal(state.error, undefined);
    assert.equal(state.result.settings.enabled, true);
    const saved = await send('experimentalWot_save', { enabled: false }, internal);
    assert.equal(saved.result.settings.enabled, false);
    const denied = await send('experimentalWot_save', { enabled: true }, { id: runtime.id, url: 'https://site.test', tab: { id: 1 } });
    assert.equal(denied.error, 'Permission denied');
});


test('two-hop sync discovers hundreds of people from eight lists and reports missing lists', async () => {
    const rootKey = new Uint8Array(32).fill(21), root = bytesToHex(getPublicKey(rootKey));
    const peers = Array.from({ length: 7 }, (_, i) => new Uint8Array(32).fill(22 + i));
    const people = Array.from({ length: 300 }, (_, i) => (1000 + i).toString(16).padStart(64, '0'));
    const events = [await signEvent({ pubkey: root, kind: 3, created_at: 100, content: '', tags: [...peers.map(key => ['p', bytesToHex(getPublicKey(key))]), ['p', c]] }, rootKey)];
    for (const [index, key] of peers.entries()) events.push(await signEvent({ pubkey: bytesToHex(getPublicKey(key)), kind: 3, created_at: 100, content: '', tags: index === 0 ? people.map(pk => ['p', pk]) : [] }, key));
    relaySocket(events);
    await browser.storage.local.set({ accounts: [{ id: 'large', pubkey: root, type: 'npub' }], activeAccountId: 'large' });
    await browser.storage.sync.set({ relays: 'wss://relay.test' });
    await saveWotSettings({ enabled: true, maxHops: 2 });
    const result = await syncWotGraph();
    assert.deepEqual(graphStats(result), { nodes: 309, people: 308, authors: 8, edges: 308 });
    const state = await getWotState();
    assert.equal(state.people, 308);
    assert.equal(state.authors, 8);
    assert.equal(state.missingFollowLists, 1);
    assert.equal(await queryWot('getDistance', { target: people[299] }), 2);
    assert.deepEqual(graphStats(null), { nodes: 0, people: 0, authors: 0, edges: 0 });
});


import WotHowItWorks from '../src/screens/Settings/WotHowItWorks';
import WotSyncPanel from '../src/screens/Settings/WotSyncPanel';
test('WoT information and live progress use shared accessible panels', () => {
    const info = renderToStaticMarkup(createElement(WotHowItWorks, {onClose(){}}));
    assert.match(info, /role="dialog"/);
    assert.match(info, /wot.howUpdates/);
    assert.match(info, /wot.howPrivacy/);
    const menu = readFileSync(new URL('../src/screens/Menu/MenuOverlay.tsx', import.meta.url), 'utf8');
    assert.match(menu, /aria-label=\{t\('wot.howTitle'\)\}/);
    const html = renderToStaticMarkup(createElement(WotSyncPanel, {state:{settings:validateWotSettings({}),hasLocalGraph:false,syncing:true,updatedAt:null,authors:0,truncated:false,progress:{accountId:'a',phase:'fetching',running:true,depth:2,depthCompleted:50,depthTotal:100,authors:50,people:300,lists:40,startedAt:1,updatedAt:2}}}));
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /wot.currentHop/);
    assert.match(html, /300/);
    assert.match(html, /50%/);
    assert.equal(html.split('wot.people').length - 1, 1);
    assert.doesNotMatch(html, /wot.autoSync/);
});


test('page authorization and final identity checks load the graph only once', async t => {
    await setup();
    await wotContext(); // Migrate the legacy fixture before measuring normal query reads.
    const original = browser.storage.local.get.bind(browser.storage.local);
    let reads = 0;
    t.mock.method(browser.storage.local, 'get', async (key: any) => {
        if (key === WOT_GRAPH_PREFIX + 'a') reads++;
        return original(key);
    });
    assert.equal(await handleWotRequest('wot_getDistance', { origin: 'https://site.test', target: d }), 2);
    assert.equal(reads, 1);
    await clearWotGraph();
    assert.equal(reads, 2); // Read the pointer once to remove its IDB generation.
});

test('internal score lookup reuses opt-in, validation, scoring and mute rules', async () => {
    const lookup = handlers.get('experimentalWot_getTrustScore')!;
    await assert.rejects(lookup({ target: d }), /disabled/);
    await setup();
    assert.equal(await lookup({ target: d }), 0.65);
    await assert.rejects(lookup({ target: 'invalid' }), /pubkey/);
    await seedRelayCache(MUTE_LIST_CACHE, a, muteList([d]));
    assert.equal(await lookup({ target: d }), 0);
});

test('score search validates npubs, handles zero/missing/errors and discards late results', async t => {
    const { JSDOM } = await import('jsdom');
    const { act } = await import('react');
    const { default: WotScoreLookup } = await import('../src/screens/Settings/WotScoreLookup');
    const { npubEncode } = await import('../src/lib/crypto/bech32.ts');
    const dom = new JSDOM('<div id="root"></div>');
    const globals = new Map(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
    Object.defineProperties(globalThis, { window: { value: dom.window, configurable: true }, document: { value: dom.window.document, configurable: true }, IS_REACT_ACT_ENVIRONMENT: { value: true, configurable: true } });
    const { createRoot } = await import('react-dom/client');
    const requests: { params: any; resolve: (value: unknown) => void }[] = [];
    const profiles: { params: any; resolve: (value: unknown) => void }[] = [];
    t.mock.method(browser.runtime, 'sendMessage', (message: any) => new Promise(resolve => {
        (message.method === 'getProfileMetadata' ? profiles : requests).push({params: message.params, resolve});
    }));
    const root = createRoot(dom.window.document.getElementById('root')!);
    let settingsOpened = false;
    const render = (revision = 'one', disabled = false) => act(async () => root.render(createElement(WotScoreLookup, { revision, disabled, onSettings: () => { settingsOpened = true; } })));
    const button = (label: string) => [...dom.window.document.querySelectorAll('button')].find(b => b.textContent === label)!;
    const enter = (value: string) => act(async () => {
        const input = dom.window.document.querySelector('input')!;
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
    });
    const calculate = () => act(async () => button('wot.calculateScore').click());
    const explanation = (score: number | null) => ({ score, details: null, source: score === 0 ? 'muted' : 'none', maxHops: 2, baseScore: null, appliedBonus: null, knownMutes: 0, muteStatus: 'ready', graph: null });
    try {
        await render();
        assert.equal(button('wot.calculateScore').disabled, true);
        await enter('bad');
        assert.equal(button('wot.calculateScore').disabled, true);
        assert.match(dom.window.document.body.textContent!, /wot.invalidPubkey/);
        await enter(npubEncode(d));
        await calculate();
        assert.equal(requests[0].params.target, d);
        assert.equal(profiles[0].params.pubkey, d);
        assert.ok(dom.window.document.querySelector('[role="dialog"]'));
        assert.equal(dom.window.document.querySelector('[role="dialog"]')!.parentElement!.parentElement, dom.window.document.getElementById('root'));
        assert.match(dom.window.document.querySelector('[role="dialog"]')!.textContent!, /npub1/);
        await act(async () => dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true})));
        assert.equal(dom.window.document.querySelector('[role="dialog"]'), null);
        assert.equal(dom.window.document.querySelector('input')!.value, npubEncode(d));
        await enter(npubEncode(b));
        await calculate();
        await act(async () => requests[0].resolve({result: explanation(0.65)}));
        assert.doesNotMatch(dom.window.document.body.textContent!, /65 \/ 100/);
        await act(async () => profiles[0].resolve({result: {name: 'Stale profile'}}));
        assert.doesNotMatch(dom.window.document.body.textContent!, /Stale profile/);
        await act(async () => profiles[1].resolve({result: {name: 'Alice', picture: 'https://example.com/avatar.png', about: 'Hello'}}));
        const dialog = dom.window.document.querySelector('[role="dialog"]')!;
        assert.match(dialog.textContent!, /Alice/);
        assert.doesNotMatch(dialog.textContent!, /Hello|npub1/);
        assert.equal(dialog.querySelector('button[aria-label="wot.lookupPubkey"]'),null);
        assert.equal(dialog.querySelector('img')?.getAttribute('src'), 'https://example.com/avatar.png');
        await act(async () => requests[1].resolve({result: explanation(0)}));
        assert.match(dom.window.document.body.textContent!, /0 \/ 100/);
        await render('two');
        assert.equal(dom.window.document.querySelector('input')!.value, npubEncode(b));
        await act(async () => profiles[2].resolve({error: 'Profile unavailable'}));
        assert.match(dom.window.document.querySelector('[role="dialog"]')!.textContent!, /npub1/);
        await act(async () => requests[2].resolve({result: explanation(null)}));
        assert.match(dom.window.document.body.textContent!, /wot.scoreUnavailable/);
        await enter(c);
        await calculate();
        await act(async () => requests[3].resolve({error: 'Oracle unavailable'}));
        assert.match(dom.window.document.body.textContent!, /Oracle unavailable/);
        await act(async () => button('common.retry').click());
        await act(async () => requests[4].resolve({result: explanation(0.5)}));
        assert.match(dom.window.document.body.textContent!, /50 \/ 100/);
        await calculate();
        assert.equal(requests.length, 6, 'explicit recalculation queries the same key again');
        await act(async () => requests[5].resolve({result: explanation(0.5)}));
        await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="common.close"]')!.click());
        assert.equal(dom.window.document.querySelector('[role="dialog"]'), null);
        await act(async () => dom.window.document.querySelector<HTMLElement>('button[aria-label="wot.scoringSettings"]')!.click());
        assert.equal(settingsOpened, true);
        await render('two', true);
        assert.equal(button('wot.calculateScore').disabled, true);
        assert.doesNotMatch(dom.window.document.body.textContent!, /50 \/ 100/);
    } finally {
        await act(async () => root.unmount()); dom.window.close();
        for (const [key, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key]; }
    }
});


test('oracle defaults to Mapping Bitcoin, upgrades blank settings and preserves custom endpoints', async () => {
    const { WOT_SETTINGS_KEY, WOT_DEFAULTS } = await import('../src/constants/wot.ts');
    const defaults = await getWotSettings();
    assert.equal(defaults.oracleUrl, 'https://wot-oracle.mappingbitcoin.com');
    assert.equal(defaults.enabled, false);
    assert.equal(defaults.mode, 'local');
    assert.equal(validateWotSettings({ enabled: true, mode: 'remote' }).oracleUrl, defaults.oracleUrl);
    await browser.storage.local.set({ [WOT_SETTINGS_KEY]: { ...WOT_DEFAULTS, enabled: true, oracleUrl: '' } });
    assert.equal((await getWotSettings()).oracleUrl, defaults.oracleUrl);
    assert.equal((await getWotSettings()).enabled, true);
    await saveWotSettings({ ...WOT_DEFAULTS, oracleUrl: 'https://custom.example/' });
    assert.equal((await getWotSettings()).oracleUrl, 'https://custom.example');
});


test('score explanations reuse paths, weights and mute exclusions without exposing private diagnostics to sites', async () => {
    await setup();
    const lookup = handlers.get('experimentalWot_getScoreExplanation')!;
    const first = await lookup({ target: d }) as import('../src/domain/wot/types.ts').WotScoreExplanation;
    assert.deepEqual(first.details, { hops: 2, paths: 2, score: 0.65 });
    assert.equal(first.source, 'local');
    assert.equal(first.baseScore, 0.5);
    assert.ok(Math.abs(first.appliedBonus! - 0.15) < 1e-10);
    assert.equal(first.graph?.edges, 5);
    assert.equal(first.muteStatus, 'unavailable');
    await seedRelayCache(MUTE_LIST_CACHE, a, muteList([b]));
    const filtered = await lookup({ target: d }) as typeof first;
    assert.equal(filtered.knownMutes, 1);
    assert.equal(filtered.muteStatus, 'ready');
    assert.equal(filtered.details?.paths, 1);
    assert.equal(filtered.appliedBonus, 0);
    const muted = await lookup({ target: b }) as typeof first;
    assert.equal(muted.score, 0);
    assert.equal(muted.source, 'muted');
    assert.equal(muted.details, null);
    const missing = await lookup({ target: '55'.repeat(32) }) as typeof first;
    assert.equal(missing.score, null);
    assert.equal(missing.source, 'none');
    await assert.rejects(handleWotRequest('wot_getScoreExplanation', { origin: 'https://site.test', target: d }), /Unknown/);
});

test('score explanations identify oracle evidence and render the complete local breakdown', async () => {
    await setup('remote');
    globalThis.fetch = async () => new Response(JSON.stringify({ hops: 2, paths: 2 }), { status: 200 });
    const info = await queryWot('getScoreExplanation', { target: d }) as import('../src/domain/wot/types.ts').WotScoreExplanation;
    assert.equal(info.source, 'oracle');
    assert.equal(info.graph, null);
    assert.equal(info.score, 0.65);
    const { default: Breakdown } = await import('../src/screens/Settings/WotScoreBreakdown');
    const html = renderToStaticMarkup(createElement(Breakdown, { result: { ...info, source: 'local', graph: {edges: 5, people: 3, missingFollowLists: 1, truncated: false} } }));
    for (const label of ['hops', 'paths', 'base', 'bonus', 'mutesUnavailable'])
        assert.match(html, new RegExp('wot.explanation.' + label));
    assert.doesNotMatch(html, /wot.explanation.(edges|people|graphHint|incomplete)/);
    assert.match(html, /text-success[^>]*>\+50</);
    assert.match(html, /text-success[^>]*>\+15</);
    assert.match(html, /text-menu-subtitle/);
    assert.doesNotMatch(renderToStaticMarkup(createElement(Breakdown, {result: {...info, muteStatus: 'ready', knownMutes: 0}})), /wot.explanation.noMutes/);
    const mutedHtml = renderToStaticMarkup(createElement(Breakdown, {result: {...info, score: 0, details: null, source:'muted'}}));
    assert.match(mutedHtml, /text-error/);
    assert.match(mutedHtml, /−/);
    const negativeHtml = renderToStaticMarkup(createElement(Breakdown, {result: {...info, appliedBonus: -0.1}}));
    assert.match(negativeHtml, /text-error[^>]*>−10</);
    for (const [muteStatus, knownMutes, label] of [['ready', 1, 'mutesExcluded'], ['private-unavailable', 1, 'privateUnavailable']] as const) {
        assert.match(renderToStaticMarkup(createElement(Breakdown, { result: {...info, muteStatus, knownMutes} })), new RegExp('wot.explanation.' + label));
    }
});

test('database table targets row actions, confirms deletion and separates shared cache', async t => {
    const { JSDOM } = await import('jsdom');
    const { act } = await import('react');
    const { default: Databases } = await import('../src/screens/Settings/WotDatabases');
    const dom = new JSDOM('<div id="root"></div>');
    const globals = new Map(['window','document','IS_REACT_ACT_ENVIRONMENT'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
    Object.defineProperties(globalThis,{window:{value:dom.window,configurable:true},document:{value:dom.window.document,configurable:true},IS_REACT_ACT_ENVIRONMENT:{value:true,configurable:true}});
    const { createRoot } = await import('react-dom/client');
    const root=createRoot(dom.window.document.getElementById('root')!);
    let databases=[{accountId:'b',name:'Bob',pubkey:b,bytes:100,estimated:true,people:2,authors:1,updatedAt:1,canSync:true,truncated:false,missingFollowLists:0}];
    let sharedCache={records:3,bytes:50};
    const actions: any[]=[];
    t.mock.method(browser.runtime,'sendMessage',async (message:any)=>{
        if(message.method==='experimentalWot_getDatabases')return {result:{databases,accounts:databases.length,bytes:databases.length*100,estimated:true,sharedCache}};
        actions.push(message);
        if(message.method==='experimentalWot_clear')databases=[];
        if(message.method==='experimentalWot_clearCache')sharedCache={records:0,bytes:0};
        return {result:{}};
    });
    const click=(label:string)=>act(async()=>{
        const element=[...dom.window.document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label || b.textContent===label)!;
        element.click();
    });
    try {
        await act(async()=>root.render(createElement(Databases,{canSync:true})));
        assert.equal(dom.window.document.querySelectorAll('tbody tr').length,2);
        await click('wot.resync: Bob');
        assert.equal(actions[0].method,'experimentalWot_sync');
        assert.equal(actions[0].params.accountId,'b');
        await click('common.remove: Bob');
        await click('common.cancel');
        assert.equal(actions.length,1);
        await click('common.remove: Bob');
        await click('common.remove');
        assert.equal(actions[1].method,'experimentalWot_clear');
        assert.equal(actions[1].params.accountId,'b');
        assert.equal(dom.window.document.querySelectorAll('tbody tr').length,1);
        await click('common.remove: wot.sharedCache');
        assert.match(dom.window.document.querySelector('[role="dialog"]')!.textContent!,/wot.deleteCacheHint/);
        await click('common.remove');
        assert.equal(actions[2].method,'experimentalWot_clearCache');
        assert.equal(dom.window.document.querySelectorAll('tbody tr').length,0);
    } finally {
        await act(async()=>root.unmount());dom.window.close();
        for(const [key,descriptor] of globals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete (globalThis as any)[key];}
    }
});
