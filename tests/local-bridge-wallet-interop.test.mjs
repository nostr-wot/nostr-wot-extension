import test from 'node:test';
import process from 'node:process';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { LocalBridgeClient } from '../src/services/signing/localBridge/client.ts';
import { parsePairingUri } from '../src/services/signing/localBridge/protocol.ts';
import { getPublicKey, verifyEvent } from 'nostr-tools/pure';

// Optional cross-repository check, using the wallet's actual LanSession and SignerCore.
// LOCAL_BRIDGE_WALLET_ROOT=/path/to/wallet node --experimental-default-type=module --import tsx --test tests/local-bridge-wallet-interop.test.mjs
const root = process.env.LOCAL_BRIDGE_WALLET_ROOT;
test('extension interoperates with real wallet pairing, signing, encryption and revocation', { skip: !root }, async () => {
  const load = (relative) => import(pathToFileURL(`${root}/${relative}`).href);
  const [{ LanSession }, { PeerStore }, { createSigner }, { generateAccount }, { MemoryStore }] = await Promise.all([
    load('src/services/transports/lan/session.ts'),
    load('src/services/transports/lan/peers.ts'),
    load('src/services/signer/createSigner.ts'),
    load('src/domain/signer/accounts.ts'),
    load('node_modules/@nostr-wot/storage/dist/index.js'),
  ]);
  const stores = Object.fromEntries(
    ['vaultStore', 'permissionStore', 'activityStore', 'accountIndexStore', 'biometricStore', 'wrappedKeyStore'].map((key) => [
      key,
      new MemoryStore(),
    ]),
  );
  const signer = createSigner(stores, {
    kdf: {
      async derive(password, salt) {
        return new Uint8Array(32).fill(salt[0] ^ password.length);
      },
    },
  });
  const { LanSitePermissions } = await load('src/services/transports/lan/sitePermissions.ts');
  const { account } = generateAccount();
  await signer.accounts.createVault('interop password', account, 0);
  // Explicitly approve fixture requests through the real wallet approval port.
  let sitePrompts = 0;
  const stopApproval = signer.approval.subscribe(() => {
    for (const prompt of signer.approval.pending()) {
      const site = prompt.request.origin.identifier.startsWith('site:');
      if(site)sitePrompts++;
      signer.approval.decide(prompt.request.origin, prompt.request.id, { allow: true, remember: site });
    }
  });
  let accept;
  let onText;
  let onClose;
  const listeners = new Set();
  const closeListeners = new Set();
  const transport = {
    async open() {
      accept({
        id: 'extension',
        send: (text) => {
          for (const cb of listeners) cb(text);
        },
        close: () => {
          for (const cb of closeListeners) cb();
        },
        onText: (cb) => {
          onText = cb;
        },
        onClose: (cb) => {
          onClose = cb;
        },
      });
    },
    async send(text) {
      onText(text);
    },
    close() {
      onClose?.();
    },
    onMessage(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    onClose(cb) {
      closeListeners.add(cb);
      return () => closeListeners.delete(cb);
    },
  };
  const session = new LanSession({
    core: signer.core,
    sites: new LanSitePermissions({activeAccount:()=>signer.index.identityPort.getActiveAccount(),permissions:signer.permissions,approval:signer.approval}),
    permissions: signer.permissions,
    peers: new PeerStore(new MemoryStore()),
    hostSecretKey: async () => '11'.repeat(32),
    listener: {
      async start(cb) {
        accept = cb;
        return ['127.0.0.1:1234'];
      },
      async stop() {},
    },
    strategy: { mode: 'session', modeNoteKey: 'test', async acquire() {}, async release() {} },
  });
  await session.start();
  let client;
  try {
    const offer = parsePairingUri(session.offerUri(session.offer()));
    const key = new Uint8Array(32).fill(0x22);
    client = await LocalBridgeClient.connect({ offer, secretKey: key, transport, timeoutMs: 3000, onConfirmation: code => { const state = session.offerState(); assert.equal(state.phase, 'confirming'); assert(state.choices.includes(code)); session.confirmPairing(state.peerPubkey, code); } });
    key.fill(0); // Connection owns session keys; no caller secret is retained.
    assert.equal(await client.request('get_public_key', []), account.pubkey);
    const event = JSON.parse(
      await client.request('sign_event', [
        JSON.stringify({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'Local bridge interoperability' }),
      ]),
    );
    assert(verifyEvent(event));
    assert.equal(event.pubkey, account.pubkey);
    for(let i=0;i<2;i++){
      const scoped=JSON.parse(await client.request('sign_event',[JSON.stringify({kind:30078,created_at:Math.floor(Date.now()/1000),tags:[['d','settings']],content:'site data'})],'https://site.test'));
      assert(verifyEvent(scoped));
    }
    assert.equal(sitePrompts,1,'remembered site approval is reused within the connection');
    const recipient = getPublicKey(new Uint8Array(32).fill(0x33));
    for (const scheme of ['nip04', 'nip44']) {
      const cipher = await client.request(`${scheme}_encrypt`, [recipient, 'local bridge secret']);
      assert.notEqual(cipher, 'local bridge secret');
      assert.equal(await client.request(`${scheme}_decrypt`, [recipient, cipher]), 'local bridge secret');
    }
    await session.revoke(getPublicKey(new Uint8Array(32).fill(0x22)));
    await assert.rejects(client.request('get_public_key', []), /not connected/);
  } finally {
    client?.close();
    stopApproval();
    await session.stop();
  }
});
