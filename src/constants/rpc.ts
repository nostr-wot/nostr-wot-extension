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
