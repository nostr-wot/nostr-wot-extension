import { base64urlnopad } from '@scure/base';
import { expand, extract } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
export const MAX_FRAME_BYTES = 65536;
export const utf8 = new TextEncoder();
export const encode64 = (bytes: Uint8Array): string => base64urlnopad.encode(bytes);
export function decode64(value: unknown, size: number): Uint8Array {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url');
  const bytes = base64urlnopad.decode(value);
  if (bytes.length !== size || encode64(bytes) !== value) throw new Error('Invalid base64url length');
  return bytes;
}
export const transcript = (kind: string, ...fields: (string | number)[]): string => [`nwlan/2/${kind}`, ...fields].join('\x1f');
export function deriveKeys(conversation: Uint8Array, salt: string) {
  const prk = extract(sha256, conversation, utf8.encode(salt));
  const keys = {
    mac: expand(sha256, prk, utf8.encode('nwlan/2/mac'), 32),
    payload: expand(sha256, prk, utf8.encode('nwlan/2/payload'), 32),
  };
  prk.fill(0);
  return keys;
}
export const mac = (key: Uint8Array, text: string): string => encode64(hmac(sha256, key, utf8.encode(text)));
export function equalMac(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export interface PairingOffer {
  hostPubkey: string;
  transport: 'wifi' | 'ble';
  addresses: string[];
  psk?: string;
  name?: string;
}
/** Literal local addresses only: DNS names could resolve to public destinations. */
export function validateAddress(address: string): string {
  const match = /^(\[[0-9a-fA-F:]+\]|\d+\.\d+\.\d+\.\d+):(\d{1,5})$/.exec(address);
  if (!match || +match[2] < 1 || +match[2] > 65535) throw new Error('Use a local IP address and port');
  const host = match[1];
  if (host.startsWith('[')) {
    let canonical: string;
    try {
      canonical = new URL(`ws://${address}`).hostname.slice(1, -1);
    } catch {
      throw new Error('Invalid IPv6 address');
    }
    if (!(canonical === '::1' || /^f[cd][0-9a-f]{2}:/.test(canonical) || /^fe[89ab][0-9a-f]:/.test(canonical)))
      throw new Error('Only local addresses are allowed');
  } else {
    const octets = host.split('.');
    if (octets.some((x) => String(Number(x)) !== x || +x > 255)) throw new Error('Invalid IPv4 address');
    const [a, b] = octets.map(Number);
    if (!(a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254)))
      throw new Error('Only local addresses are allowed');
  }
  return address;
}
export function parsePairingUri(uri: string): PairingOffer {
  if (uri.length > 2048) throw new Error('Pairing code too large');
  const u = new URL(uri.trim());
  const q = u.searchParams;
  if (
    u.protocol !== 'nwlan:' ||
    u.username ||
    u.password ||
    u.port ||
    u.hash ||
    (u.pathname && u.pathname !== '/') ||
    !/^[a-f0-9]{64}$/.test(u.hostname)
  )
    throw new Error('Invalid pairing code');
  for (const field of ['v', 'transport', 'psk', 'name']) if (q.getAll(field).length > 1) throw new Error('Duplicate pairing field');
  if (q.get('v') !== '2') throw new Error('Unsupported local signer protocol version');
  const transport = q.get('transport') ?? 'wifi';
  if (transport !== 'wifi' && transport !== 'ble') throw new Error('Unsupported local signer transport');
  const addresses = q.getAll('addr');
  if (transport === 'wifi' ? addresses.length < 1 || addresses.length > 4 : addresses.length !== 0)
    throw new Error('Invalid pairing addresses');
  addresses.forEach(validateAddress);
  const psk = q.get('psk');
  decode64(psk, 32);
  const name = q.get('name') ?? undefined;
  if (name && name.length > 64) throw new Error('Pairing name too long');
  return { hostPubkey: u.hostname, transport, addresses, psk: psk!, name };
}
