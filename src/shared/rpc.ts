import browser from '@shared/browser.ts';

class RpcError extends Error {
  method: string;

  constructor(message: string, method: string) {
    super(message);
    this.name = 'RpcError';
    this.method = method;
  }
}

// MV3 service workers sleep aggressively; the first message after wake-up can
// reject before the onMessage listener is re-registered. Retry only on that
// specific transport error — application errors come back as { error } and
// must not be retried.
const WAKEUP_ERROR_PATTERNS = [
  'Could not establish connection',
  'Receiving end does not exist',
  'The message port closed before a response was received',
  'Extension context invalidated',
];

function isWakeupError(err: unknown): boolean {
  const msg = (err as Error)?.message || String(err);
  return WAKEUP_ERROR_PATTERNS.some(p => msg.includes(p));
}

async function sendWithWakeupRetry(payload: { method: string; params: unknown }): Promise<unknown> {
  const MAX_ATTEMPTS = 3;
  let attempt = 0;
  while (true) {
    try {
      return await browser.runtime.sendMessage(payload);
    } catch (err) {
      attempt++;
      if (!isWakeupError(err) || attempt >= MAX_ATTEMPTS) throw err;
      await new Promise((r) => setTimeout(r, 100 * attempt));
    }
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
