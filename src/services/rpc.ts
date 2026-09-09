import { WAKEUP_ERROR_PATTERNS } from '@constants/rpc.ts';
import browser from '@lib/browser.ts';

class RpcError extends Error {
  method: string;

  constructor(message: string, method: string) {
    super(message);
    this.name = 'RpcError';
    this.method = method;
  }
}

function isWakeupError(err: unknown): boolean {
  const msg = (err as Error)?.message || String(err);
  return WAKEUP_ERROR_PATTERNS.some(p => msg.includes(p));
}

async function sendWithWakeupRetry(payload: { method: string; params: unknown }): Promise<unknown> {
  const MAX_ATTEMPTS = 3;
  let attempt = 0;
  while (true) {
    try {
      const resp = await browser.runtime.sendMessage(payload);
      // Safari expresses "no responder" (background SW terminated / listener
      // not yet re-registered) by RESOLVING with `undefined` instead of
      // rejecting the way Chrome does. The background always replies with a
      // { result } or { error } envelope, so a missing envelope is the same
      // transport failure — retry it, and never hand `undefined` to callers.
      if (resp !== undefined) return resp;
      attempt++;
      if (attempt >= MAX_ATTEMPTS) {
        throw new RpcError('No response from the background service', payload.method);
      }
    } catch (err) {
      if (err instanceof RpcError) throw err;
      attempt++;
      if (!isWakeupError(err) || attempt >= MAX_ATTEMPTS) throw err;
    }
    await new Promise((r) => setTimeout(r, 100 * attempt));
  }
}

// Sends { method, params } to background, unwraps { result } / { error }
export async function rpc<T = unknown>(method: string, params: unknown = {}): Promise<T> {
  const resp = (await sendWithWakeupRetry({ method, params })) as { result?: unknown; error?: string } | undefined;
  if (resp?.error) throw new RpcError(resp.error, method);
  return resp?.result as T;
}

// Fire-and-forget (for 'configUpdated' etc.)
export function rpcNotify(method: string, params: unknown = {}): void {
  sendWithWakeupRetry({ method, params }).catch(() => {});
}
