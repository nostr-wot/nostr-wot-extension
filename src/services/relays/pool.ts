import { RELAY_POOL_IDLE_MS, MAX_RELAY_CONNECTIONS, MAX_RELAY_LEASES, MAX_RELAY_FRAME_BYTES, MAX_RELAY_AUTH_CHALLENGE_LENGTH } from '@constants/relays.ts';
/** Physical connections are leased: closing a query never closes a sibling query. */
function createOwnedRelayPool(options: { _createSocket?: (url: string) => WebSocket; idleMs?: number } = {}) {
  type Lease = {
    onopen: ((event: Event) => void) | null;
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: Event) => void) | null;
    onclose: ((event: CloseEvent) => void) | null;
    readyState: number;
    subId?: string;
    publishId?: string;
    authentication?: { id: string; challenge: string };
    send(data: string): void;
    close(code?: number, reason?: string): void;
  };
  type Connection = { socket: WebSocket; opened: boolean; dead: boolean; leases: Set<Lease>; idle?: ReturnType<typeof setTimeout>; challenge?: string; authenticatedChallenge?: string };
  const connections = new Map<string, Connection>();
  let closed = false;
  const factory = options._createSocket ?? ((url: string) => new WebSocket(url));

  function _createSocket(url: string, scope = 'anonymous'): WebSocket {
    if (closed) throw new Error('Relay pool is closed');
    const parsed = new URL(url);
    if (!['wss:', 'ws:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) throw new Error('Invalid relay URL');
    const key = JSON.stringify([scope, parsed.href]);
    let connection = connections.get(key);
    if (!connection || connection.dead || connection.socket.readyState >= 2) {
      if (connections.size >= MAX_RELAY_CONNECTIONS) throw new Error('Relay connection limit reached');
      const socket = factory(url);
      connection = { socket, opened: false, dead: false, leases: new Set() };
      connections.set(key, connection);
      const owner = connection;
      socket.onopen = (event) => {
        if (owner.dead) return;
        owner.opened = true;
        for (const lease of [...owner.leases]) {
          if (lease.readyState === 3) continue;
          lease.readyState = 1;
          lease.onopen?.(event);
        }
      };
      socket.onmessage = (event) => {
        // Bound before parsing. Frames outside this budget cannot enter any consumer.
        if (typeof event.data !== 'string' || event.data.length > MAX_RELAY_FRAME_BYTES || new TextEncoder().encode(event.data).length > MAX_RELAY_FRAME_BYTES) {
          retire('Relay message exceeds size limit');
          return;
        }
        let data: unknown;
        try { data = JSON.parse(event.data); } catch { return; }
        if (!Array.isArray(data)) return;
        if (data[0] === 'AUTH' && typeof data[1] === 'string' && data[1].length <= MAX_RELAY_AUTH_CHALLENGE_LENGTH) owner.challenge = data[1];
        if (data[0] === 'OK' && data[2] === true) {
          const authentication = [...owner.leases].find(lease => lease.authentication?.id === data[1])?.authentication;
          if (authentication?.challenge === owner.challenge) owner.authenticatedChallenge = authentication?.challenge;
        }
        for (const lease of [...owner.leases]) {
          if ((['EVENT', 'EOSE', 'CLOSED', 'NEG-MSG', 'NEG-ERR'].includes(data[0]) && lease.subId === data[1]) ||
              (data[0] === 'OK' && lease.publishId === data[1]) || data[0] === 'AUTH') {
            lease.onmessage?.(event);
          }
        }
      };
      const retire = (reason: string, error = false) => {
        if (owner.dead) return;
        owner.dead = true;
        clearTimeout(owner.idle);
        if (connections.get(key) === owner) connections.delete(key);
        for (const lease of [...owner.leases]) {
          if (error) lease.onerror?.({} as Event);
          lease.onclose?.({ reason } as CloseEvent);
          lease.close();
        }
        try { socket.close(); } catch { /* already disconnected */ }
      };
      socket.onerror = () => retire('Relay connection error', true);
      socket.onclose = event => retire(event?.reason || 'Relay connection closed');
    }
    const owner = connection;
    if (owner.leases.size >= MAX_RELAY_LEASES) throw new Error('Relay subscription limit reached');
    clearTimeout(owner.idle);
    const lease: Lease = {
      onopen: null, onmessage: null, onerror: null, onclose: null, readyState: 0,
      send(data) {
        if (owner.dead || lease.readyState !== 1) throw new Error('Relay connection is closed');
        const message = JSON.parse(data);
        if (message[0] === 'REQ' || message[0] === 'NEG-OPEN') lease.subId = message[1];
        if (message[0] === 'EVENT' || message[0] === 'AUTH') lease.publishId = message[1]?.id;
        if (message[0] === 'AUTH') lease.authentication = { id: message[1]?.id, challenge: message[1]?.tags?.find((tag: string[]) => tag[0] === 'challenge')?.[1] };
        owner.socket.send(data);
      },
      close(_code?: number, reason?: string) {
        if (lease.readyState === 3) return;
        lease.readyState = 3;
        owner.leases.delete(lease);
        if (!owner.dead && owner.opened && lease.subId) {
          try { owner.socket.send(JSON.stringify(['CLOSE', lease.subId])); } catch { /* disconnected */ }
        }
        lease.onclose?.({ reason: 'Subscription released' } as CloseEvent);
        if (!owner.dead && owner.leases.size === 0 && options.idleMs !== undefined) {
          const retireIdle = () => {
            if (owner.leases.size || owner.dead) return;
            owner.dead = true;
            connections.delete(key);
            try { owner.socket.close(); } catch { /* disconnected */ }
          };
          if (reason === 'session-invalid') retireIdle();
          else owner.idle = setTimeout(retireIdle, options.idleMs);
        }
      },
    };
    owner.leases.add(lease);
    if (owner.opened) queueMicrotask(() => {
      if (lease.readyState === 3 || owner.dead) return;
      lease.readyState = 1;
      lease.onopen?.({} as Event);
      if (owner.challenge && owner.authenticatedChallenge !== owner.challenge && lease.readyState !== 3) lease.onmessage?.({ data: JSON.stringify(['AUTH', owner.challenge]) } as MessageEvent);
    });
    return lease as unknown as WebSocket;
  }

  function close() {
    if (closed) return;
    closed = true;
    for (const connection of connections.values()) {
      connection.dead = true;
      clearTimeout(connection.idle);
      for (const lease of [...connection.leases]) lease.close();
      try { connection.socket.close(); } catch { /* already disconnected */ }
    }
    connections.clear();
  }
  return { _createSocket, close };
}

const shared = createOwnedRelayPool({ idleMs: RELAY_POOL_IDLE_MS });
/** Only public/account Archive traffic belongs here; NWC and NIP-46 stay separate. */
export const createSharedRelaySocket = (url: string, scope = 'anonymous') => shared._createSocket(url, scope);

/** A sync owns its leases, while default pools reuse the background's shared sockets. */
export function createRelayPool(options: { _createSocket?: (url: string) => WebSocket; idleMs?: number } = {}) {
  if (options._createSocket || options.idleMs !== undefined) return createOwnedRelayPool(options);
  const leases = new Set<WebSocket>();
  let closed = false;
  return {
    _createSocket(url: string, scope = 'anonymous') {
      if (closed) throw new Error('Relay pool is closed');
      const lease = createSharedRelaySocket(url, scope);
      const release = lease.close.bind(lease);
      lease.close = (code?: number, reason?: string) => { leases.delete(lease); release(code, reason); };
      leases.add(lease);
      return lease;
    },
    close() { closed = true; for (const lease of leases) lease.close(); leases.clear(); },
  };
}
