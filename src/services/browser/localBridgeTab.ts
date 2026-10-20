/** Document-side broker: transport secrets never cross the extension runtime port. */
export interface BridgeTabPort {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(fn: (message: unknown) => void): void; removeListener(fn: (message: unknown) => void): void };
  onDisconnect: { addListener(fn: () => void): void; removeListener(fn: () => void): void };
}
export interface BridgeTabClient { request(method: string, params: string[]): Promise<string>; close(): void; onClose?(handler: (error: Error) => void): () => void }
const METHODS = new Set(['sign_event', 'nip04_encrypt', 'nip04_decrypt', 'nip44_encrypt', 'nip44_decrypt']);

export function attachBridgeTab(client: BridgeTabClient, port: BridgeTabPort, pubkey: string, onClosed: (reason: string) => void): { ready: Promise<void>; close: () => void } {
  let closed = false;
  let stopClient = () => {};
  let accepted = false;
  const pending = new Set<string>();
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const timeout = setTimeout(() => close('The extension did not accept the connection'), 15_000);
  const heartbeat = setInterval(() => { if (!closed) { try { port.postMessage({ type: 'ping' }); } catch { close('Extension disconnected'); } } }, 25_000);
  function close(reason = 'Disconnected') {
    if (closed) return;
    closed = true;
    clearTimeout(timeout);
    clearInterval(heartbeat);
    port.onMessage.removeListener(message);
    port.onDisconnect.removeListener(disconnected);
    stopClient();
    client.close();
    try { port.disconnect(); } catch { /* Already disconnected. */ }
    rejectReady(new Error(reason));
    onClosed(reason);
  }
  const disconnected = () => close('Extension disconnected. Reconnect to continue signing.');
  function message(raw: unknown) {
    if (closed || !raw || typeof raw !== 'object') return;
    const data = raw as Record<string, unknown>;
    if (data.type === 'ready') {
      if (data.pubkey !== pubkey) { close('The extension account does not match the phone'); return; }
      accepted = true; clearTimeout(timeout); resolveReady(); return;
    }
    if (data.type === 'close' || data.type === 'error') { close(typeof data.error === 'string' ? data.error : 'Extension refused the connection'); return; }
    if (data.type !== 'request' || !accepted || typeof data.id !== 'string') return;
    const id = data.id;
    const reply = (value: object) => { if (!closed) { try { port.postMessage({ type: 'response', id, ...value }); } catch { disconnected(); } } };
    if (pending.has(id)) { close('Duplicate bridge request'); return; }
    if (pending.size >= 8 || typeof data.method !== 'string' || !METHODS.has(data.method) || !Array.isArray(data.params) || data.params.length > 2 || !data.params.every((p) => typeof p === 'string' && p.length <= 65_536)) {
      reply({ error: 'Invalid or busy bridge request' }); return;
    }
    pending.add(id);
    void client.request(data.method, data.params as string[])
      .then((result) => reply({ result }), (error: unknown) => reply({ error: error instanceof Error ? error.message : 'Phone refused the request' }))
      .finally(() => pending.delete(id));
  }
  stopClient = client.onClose?.((error) => close(error.message)) ?? (() => {});
  if (closed) return { ready, close: () => close() };
  port.onMessage.addListener(message);
  port.onDisconnect.addListener(disconnected);
  try { port.postMessage({ type: 'ready', pubkey }); } catch { disconnected(); }
  return { ready, close: () => close() };
}
