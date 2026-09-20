/** A sync owns one pool; subscriptions release independently of physical sockets. */
export function createRelayPool(options: { _createSocket?: (url: string) => WebSocket } = {}) {
  type Lease = {
    onopen: ((event: Event) => void) | null;
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: Event) => void) | null;
    onclose: ((event: CloseEvent) => void) | null;
    readyState: number;
    subId?: string;
    send(data: string): void;
    close(): void;
  };
  type Connection = { socket: WebSocket; opened: boolean; dead: boolean; leases: Set<Lease> };
  const connections = new Map<string, Connection>();
  let closed = false;
  const factory = options._createSocket ?? ((url: string) => new WebSocket(url));

  function _createSocket(url: string): WebSocket {
    if (closed) throw new Error('Relay pool is closed');
    let connection = connections.get(url);
    if (!connection || connection.dead || connection.socket.readyState >= 2) {
      const socket = factory(url);
      connection = { socket, opened: false, dead: false, leases: new Set() };
      connections.set(url, connection);
      const owner = connection;
      socket.onopen = (event) => {
        if (owner.dead) return;
        owner.opened = true;
        for (const lease of owner.leases) {
          lease.readyState = 1;
          lease.onopen?.(event);
        }
      };
      socket.onmessage = (event) => {
        let data: unknown;
        try { data = JSON.parse(event.data); } catch { return; }
        if (!Array.isArray(data) || !['EVENT', 'EOSE', 'CLOSED'].includes(data[0])) return;
        for (const lease of owner.leases) {
          if (lease.subId === data[1]) {
            if (data[0] === 'CLOSED') lease.close();
            else lease.onmessage?.(event);
          }
        }
      };
      const retire = () => {
        if (owner.dead) return;
        owner.dead = true;
        if (connections.get(url) === owner) connections.delete(url);
        for (const lease of [...owner.leases]) lease.close();
        try { socket.close(); } catch { /* already disconnected */ }
      };
      socket.onerror = retire;
      socket.onclose = retire;
    }
    const owner = connection;
    const lease: Lease = {
      onopen: null, onmessage: null, onerror: null, onclose: null, readyState: 0,
      send(data) {
        if (owner.dead || lease.readyState !== 1) throw new Error('Relay connection is closed');
        const message = JSON.parse(data);
        if (message[0] === 'REQ') lease.subId = message[1];
        owner.socket.send(data);
      },
      close() {
        if (lease.readyState === 3) return;
        lease.readyState = 3;
        owner.leases.delete(lease);
        if (!owner.dead && owner.opened && lease.subId) {
          try { owner.socket.send(JSON.stringify(['CLOSE', lease.subId])); } catch { /* disconnected */ }
        }
        lease.onclose?.({} as CloseEvent);
      },
    };
    owner.leases.add(lease);
    if (owner.opened) queueMicrotask(() => {
      if (lease.readyState === 3 || owner.dead) return;
      lease.readyState = 1;
      lease.onopen?.({} as Event);
    });
    return lease as unknown as WebSocket;
  }

  function close() {
    if (closed) return;
    closed = true;
    for (const connection of connections.values()) {
      connection.dead = true;
      for (const lease of [...connection.leases]) lease.close();
      try { connection.socket.close(); } catch { /* already disconnected */ }
    }
    connections.clear();
  }
  return { _createSocket, close };
}
