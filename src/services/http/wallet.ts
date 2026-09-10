import type { FetchFn } from './types.ts';
import { WALLET_HTTP_TIMEOUT_MS, WALLET_HTTP_MAX_RESPONSE_BYTES } from '@constants/wallet-http.ts';

/** Only explicit loopback development endpoints may use plaintext HTTP. */
export function secureWalletUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Wallet: invalid or insecure URL — use https://'); }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
      || url.username || url.password || url.search || url.hash) {
    throw new Error('Wallet: invalid or insecure URL — use https://');
  }
  return url.href.replace(/\/+$/, '');
}

/** Refuse redirects before credentials move; bound both fetch and body consumption. */
export async function walletHttp<T>(
  url: string,
  init: RequestInit,
  fetchFn: FetchFn,
  errorPrefix: string,
  options: { signal?: AbortSignal; serverError?: boolean; empty?: boolean; timeoutMs?: number; maxBytes?: number } = {},
): Promise<T> {
  secureWalletUrl(url.split('?')[0]);
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason ?? new Error('Wallet disconnected'));
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Wallet request timed out')), options.timeoutMs ?? WALLET_HTTP_TIMEOUT_MS);
  let rejectAbort!: () => void;
  const canceled = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
    if (controller.signal.aborted) rejectAbort();
  });
  const work = async (): Promise<T> => {
    controller.signal.throwIfAborted();
    const response = await fetchFn(url, { ...init, redirect: 'error', signal: controller.signal });
    controller.signal.throwIfAborted();
    if (response.status >= 300 && response.status < 400 || response.redirected || response.type === 'opaqueredirect') {
      void response.body?.cancel().catch(() => {});
      throw new Error('Wallet redirects are forbidden');
    }
    if (!response.ok && !options.serverError) {
      void response.body?.cancel().catch(() => {});
      throw new Error(`${errorPrefix}: ${response.status}`);
    }
    const maxBytes = options.maxBytes ?? WALLET_HTTP_MAX_RESPONSE_BYTES;
    if (Number(response.headers.get('content-length')) > maxBytes) {
      void response.body?.cancel().catch(() => {});
      throw new Error('Wallet response too large');
    }
    const reader = response.body?.getReader();
    const cancelReader = () => { void reader?.cancel().catch(() => {}); };
    controller.signal.addEventListener('abort', cancelReader, { once: true });
    let content = '';
    let size = 0;
    const decoder = new TextDecoder();
    try {
      if (reader) while (true) {
        controller.signal.throwIfAborted();
        const { value, done } = await reader.read();
        controller.signal.throwIfAborted();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new Error('Wallet response too large');
        content += decoder.decode(value, { stream: true });
      }
      content += decoder.decode();
    } finally {
      controller.signal.removeEventListener('abort', cancelReader);
      void reader?.cancel().catch(() => {});
    }
    if (!response.ok) {
      let message = `${errorPrefix}: ${response.status}`;
      try { const body = JSON.parse(content); if (typeof body?.error === 'string' && body.error) message = body.error; } catch { /* keep HTTP error */ }
      throw new Error(message);
    }
    if (options.empty) return undefined as T;
    return JSON.parse(content) as T;
  };
  try { return await Promise.race([work(), canceled]); }
  finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', rejectAbort);
  }
}
