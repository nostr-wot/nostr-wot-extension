import { encode64, parsePairingUri } from './protocol';
/** Decode only the bounded NW/1 bootstrap; the normal pairing validator remains authoritative. */
export function decodeSoundOffer(input: Uint8Array | Int8Array): string {
  const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (bytes.length < 4 || bytes[0] !== 0x4e || bytes[1] !== 0x57 || bytes[2] !== 1) throw new Error('Invalid sound pairing packet');
  const flag = bytes[3];
  if (flag > 2 || bytes.length !== (flag === 2 ? 68 : flag === 1 ? 86 : 74)) throw new Error('Invalid sound pairing length');
  const key = Array.from(bytes.subarray(4, 36), value => value.toString(16).padStart(2, '0')).join('');
  const query = new URLSearchParams({ v: '2', psk: encode64(bytes.subarray(36, 68)) });
  if (flag === 2) query.set('transport', 'ble');
  else {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const host = flag === 0 ? Array.from(bytes.subarray(68, 72)).join('.') : `[${Array.from({ length: 8 }, (_, i) => view.getUint16(68 + i * 2).toString(16)).join(':')}]`;
    query.set('addr', `${host}:${view.getUint16(bytes.length - 2)}`);
  }
  const uri = `nwlan://${key}?${query}`;
  parsePairingUri(uri);
  return uri;
}
