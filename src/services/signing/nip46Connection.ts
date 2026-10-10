import { SimplePool } from 'nostr-tools/pool';
import type { BunkerSigner } from 'nostr-tools/nip46';

/** Own the transport separately: BunkerSigner.close() closes subscriptions only. */
export class Nip46Connection {
  readonly pool: SimplePool;
  private signer?: BunkerSigner;
  private disposed = false;

  constructor() {
    const sockets = new Set<WebSocket>();
    const cancelPendingConnections = new Set<() => void>();
    let poolDisposed = false;
    const closeSocket = (socket: WebSocket) => {
      if (socket.readyState === 0 || socket.readyState === 1) {
        try { socket.close(); } catch { /* A CONNECTING implementation may require waiting for open. */ }
      }
    };
    class OwnedSocket extends WebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        if (poolDisposed) throw new Error('NIP-46 transport disposed');
        super(url, protocols);
        sockets.add(this);
        this.addEventListener('close', () => sockets.delete(this));
        this.addEventListener('open', event => {
          if (poolDisposed) {
            event.stopImmediatePropagation();
            closeSocket(this);
          }
        });
      }
    }
    class OwnedPool extends SimplePool {
      override async ensureRelay(url: string, params?: Parameters<SimplePool['ensureRelay']>[1]) {
        if (poolDisposed) throw new Error('NIP-46 transport disposed');
        let cancel!: () => void;
        const disposed = new Promise<never>((_, reject) => {
          cancel = () => reject(new Error('NIP-46 transport disposed'));
        });
        cancelPendingConnections.add(cancel);
        try {
          return await Promise.race([super.ensureRelay(url, params), disposed]);
        } finally {
          cancelPendingConnections.delete(cancel);
        }
      }
      override destroy(): void {
        poolDisposed = true;
        for (const cancel of cancelPendingConnections) cancel();
        cancelPendingConnections.clear();
        try { super.destroy(); } catch { /* Still close all captured sockets below. */ } finally {
          // nostr-tools Relay.close() does not close CONNECTING sockets. Retain
          // these handles even when a failed ensureRelay already removed a relay.
          for (const socket of sockets) closeSocket(socket);
        }
      }
    }
    const options = { websocketImplementation: OwnedSocket, enableReconnect: false };
    this.pool = new OwnedPool(options);
  }

  attach(signer: BunkerSigner): BunkerSigner {
    if (this.disposed) {
      void signer.close().catch(() => {});
      throw new Error('NIP-46 transport disposed');
    }
    this.signer = signer;
    return signer;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try { this.pool.destroy(); } finally {
      if (this.signer) void this.signer.close().catch(() => {});
    }
  }
}
