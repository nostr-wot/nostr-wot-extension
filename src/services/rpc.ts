import { READ_ATTEMPT_TIMEOUT_MS, WAKEUP_ERROR_PATTERNS } from '@constants/rpc.ts';
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

const ATTEMPT_TIMED_OUT = Symbol('attemptTimedOut');

/** Resolve to ATTEMPT_TIMED_OUT when `promise` has not settled within `ms`. */
function withinAttempt<T>(promise: Promise<T>, ms: number | undefined): Promise<T | typeof ATTEMPT_TIMED_OUT> {
  if (!ms) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof ATTEMPT_TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(ATTEMPT_TIMED_OUT), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

export interface RpcOptions {
  /**
   * Give up on an attempt that has not answered within this many ms and send
   * it again. Chrome holds a message sent to a worker that is still starting,
   * and a start that stalls leaves it unanswered forever, so without this the
   * caller's loading state never ends. Re-sending wakes the worker again.
   * Only for reads: a write must never be sent twice.
   */
  attemptTimeoutMs?: number;
}

async function sendWithWakeupRetry(
  payload: { method: string; params: unknown },
  { attemptTimeoutMs }: RpcOptions = {},
): Promise<unknown> {
  const MAX_ATTEMPTS = 3;
  let attempt = 0;
  while (true) {
    try {
      const resp = await withinAttempt(browser.runtime.sendMessage(payload), attemptTimeoutMs);
      if (resp === ATTEMPT_TIMED_OUT) {
        attempt++;
        if (attempt >= MAX_ATTEMPTS) {
          throw new RpcError('The background service did not answer in time', payload.method);
        }
        continue;
      }
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
export async function rpc<T = unknown>(method: string, params: unknown = {}, options: RpcOptions = {}): Promise<T> {
  const resp = (await sendWithWakeupRetry({ method, params }, options)) as { result?: unknown; error?: string } | undefined;
  if (resp?.error) throw new RpcError(resp.error, method);
  return resp?.result as T;
}

// Fire-and-forget (for 'configUpdated' etc.)
/**
 * rpc() for a side-effect-free read: an attempt the worker does not answer is
 * sent again, and after the last one it fails instead of hanging the popup.
 */
export function rpcRead<T = unknown>(method: string, params: unknown = {}): Promise<T> {
  return rpc<T>(method, params, { attemptTimeoutMs: READ_ATTEMPT_TIMEOUT_MS });
}

export function rpcNotify(method: string, params: unknown = {}): void {
  sendWithWakeupRetry({ method, params }).catch(() => {});
}
