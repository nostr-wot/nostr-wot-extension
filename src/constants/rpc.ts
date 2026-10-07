// MV3 service workers sleep aggressively; the first message after wake-up can
// reject before the onMessage listener is re-registered. Retry only on that
// specific transport error — application errors come back as { error } and
// must not be retried.
export const WAKEUP_ERROR_PATTERNS = [
  'Could not establish connection',
  'Receiving end does not exist',
  'The message port closed before a response was received',
  'Extension context invalidated',
];

// How long rpcRead() waits for one attempt before sending it again. A cold
// worker evaluates its bundle and, in never-lock mode, finishes the startup
// unlock (PBKDF2) before answering; that is well under a second on ordinary
// hardware, so four seconds only trips on a start that has stalled.
export const READ_ATTEMPT_TIMEOUT_MS = 4000;
