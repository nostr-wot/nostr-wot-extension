import type { BridgeTransport } from './client';
import { MAX_FRAME_BYTES, utf8, validateAddress } from './protocol';
export const BLE_SERVICE_UUID = '8f93b5a0-6d7c-4d9f-8b01-9d7a6b0e1200';
export const BLE_RX_UUID = '8f93b5a0-6d7c-4d9f-8b01-9d7a6b0e1201';
export const BLE_TX_UUID = '8f93b5a0-6d7c-4d9f-8b01-9d7a6b0e1202';
class Listeners {
  messages = new Set<(text: string) => void>();
  closes = new Set<(error?: Error) => void>();
  onMessage = (cb: (text: string) => void) => (
    this.messages.add(cb),
    () => {
      this.messages.delete(cb);
    }
  );
  onClose = (cb: (error?: Error) => void) => (
    this.closes.add(cb),
    () => {
      this.closes.delete(cb);
    }
  );
  emitClose(error?: Error) {
    for (const cb of this.closes) cb(error);
  }
}
export function createWifiTransport(address: string, factory: (url: string) => WebSocket = (url) => new WebSocket(url)): BridgeTransport {
  validateAddress(address);
  const events = new Listeners();
  let socket: WebSocket | undefined;
  let stopped = false;
  return {
    onMessage: events.onMessage,
    onClose: events.onClose,
    open: () =>
      new Promise<void>((resolve, reject) => {
        if (stopped) {
          reject(new Error('Transport closed'));
          return;
        }
        socket = factory(`ws://${address}/nwlan2`);
        socket.onopen = () => resolve();
        socket.onerror = () => {
          const e = new Error('Cannot reach local signer');
          reject(e);
          events.emitClose(e);
        };
        socket.onclose = () => {
          reject(new Error('Local signer disconnected'));
          events.emitClose();
        };
        socket.onmessage = (event) => {
          if (typeof event.data !== 'string' || utf8.encode(event.data).length > MAX_FRAME_BYTES) {
            events.emitClose(new Error('Invalid WebSocket frame'));
            return;
          }
          for (const cb of events.messages) cb(event.data);
        };
      }),
    send: async (frame) => {
      if (!socket || socket.readyState !== 1 || stopped) throw new Error('WebSocket is not open');
      socket.send(frame);
    },
    close: () => {
      if (stopped) return;
      stopped = true;
      events.emitClose(new Error('Local signer connection closed'));
      if (socket) {
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        if (socket.readyState === 0) socket.onopen = () => socket?.close();
        else socket.close();
      }
    },
  };
}
/** At most one frame plus its four-byte header is retained across notifications. */
export class BleFrameDecoder {
  private header = new Uint8Array(4);
  private headerUsed = 0;
  private body?: Uint8Array;
  private used = 0;
  push(chunk: Uint8Array): string[] {
    const frames: string[] = [];
    let offset = 0;
    while (offset < chunk.length) {
      if (!this.body) {
        const n = Math.min(4 - this.headerUsed, chunk.length - offset);
        this.header.set(chunk.subarray(offset, offset + n), this.headerUsed);
        offset += n;
        this.headerUsed += n;
        if (this.headerUsed < 4) continue;
        const size = new DataView(this.header.buffer).getUint32(0, false);
        if (size < 1 || size > MAX_FRAME_BYTES) throw new Error('Invalid BLE frame length');
        this.body = new Uint8Array(size);
        this.used = 0;
      }
      const n = Math.min(this.body.length - this.used, chunk.length - offset);
      this.body.set(chunk.subarray(offset, offset + n), this.used);
      offset += n;
      this.used += n;
      if (this.used === this.body.length) {
        frames.push(new TextDecoder('utf-8', { fatal: true }).decode(this.body));
        this.body = undefined;
        this.headerUsed = 0;
      }
    }
    return frames;
  }
}
export interface BleCharacteristic {
  value?: DataView;
  startNotifications(): Promise<unknown>;
  writeValueWithResponse(value: Uint8Array): Promise<unknown>;
  addEventListener(type: string, handler: () => void): void;
  removeEventListener(type: string, handler: () => void): void;
}
export interface BleDevice {
  gatt?: {
    connect(): Promise<{ getPrimaryService(uuid: string): Promise<{ getCharacteristic(uuid: string): Promise<BleCharacteristic> }> }>;
    disconnect(): void;
  };
  addEventListener(type: string, handler: () => void): void;
  removeEventListener(type: string, handler: () => void): void;
}
export interface BluetoothPort {
  requestDevice(options: { filters: { services: string[] }[] }): Promise<BleDevice>;
}
/** Call open directly from a document's click handler: the chooser requires transient user activation. */
export function createBleTransport(port?: BluetoothPort): BridgeTransport {
  const events = new Listeners();
  const decoder = new BleFrameDecoder();
  let device: BleDevice | undefined,
    rx: BleCharacteristic | undefined,
    tx: BleCharacteristic | undefined,
    stopped = false;
  let queue = Promise.resolve();
  const disconnected = () => events.emitClose(new Error('Bluetooth signer disconnected'));
  const notification = () => {
    try {
      const value = tx?.value;
      if (!value) throw new Error('Missing Bluetooth notification');
      for (const frame of decoder.push(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)))
        for (const cb of events.messages) cb(frame);
    } catch (error) {
      events.emitClose(error instanceof Error ? error : new Error('Invalid BLE frame'));
    }
  };
  const close = () => {
    const notify = !stopped;
    stopped = true;
    tx?.removeEventListener('characteristicvaluechanged', notification);
    device?.removeEventListener('gattserverdisconnected', disconnected);
    device?.gatt?.disconnect();
    if (notify) events.emitClose(new Error('Local signer connection closed'));
  };
  return {
    onMessage: events.onMessage,
    onClose: events.onClose,
    close,
    open: async () => {
      const bluetooth =
        port ?? (typeof navigator !== 'undefined' ? (navigator as Navigator & { bluetooth?: BluetoothPort }).bluetooth : undefined);
      if (!bluetooth)
        throw new Error('Web Bluetooth is unavailable. Use a supported Chromium browser and open pairing in an extension tab.');
      try {
        device = await bluetooth.requestDevice({ filters: [{ services: [BLE_SERVICE_UUID] }] });
        if (stopped) throw new Error('Bluetooth connection cancelled');
        if (!device.gatt) throw new Error('Bluetooth GATT unavailable');
        device.addEventListener('gattserverdisconnected', disconnected);
        const server = await device.gatt.connect();
        const service = await server.getPrimaryService(BLE_SERVICE_UUID);
        rx = await service.getCharacteristic(BLE_RX_UUID);
        tx = await service.getCharacteristic(BLE_TX_UUID);
        if (stopped) throw new Error('Bluetooth connection cancelled');
        tx.addEventListener('characteristicvaluechanged', notification);
        await tx.startNotifications();
        if (stopped) throw new Error('Bluetooth connection cancelled');
      } catch (error) {
        close();
        throw error;
      }
    },
    send: (frame) => {
      const operation = queue.then(async () => {
        if (stopped || !rx) throw new Error('Bluetooth is not connected');
        const body = utf8.encode(frame);
        if (body.length < 1 || body.length > MAX_FRAME_BYTES) throw new Error('BLE frame too large');
        const packet = new Uint8Array(body.length + 4);
        new DataView(packet.buffer).setUint32(0, body.length, false);
        packet.set(body, 4);
        for (let offset = 0; offset < packet.length; offset += 20) {
          if (stopped) throw new Error('Bluetooth disconnected');
          await rx.writeValueWithResponse(packet.slice(offset, offset + 20));
        }
      });
      queue = operation.catch(() => {});
      return operation;
    },
  };
}
