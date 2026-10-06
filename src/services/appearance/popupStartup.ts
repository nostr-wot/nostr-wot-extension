import { POPUP_PREFERENCES_TIMEOUT_MS } from '@constants/browser.ts';

/** Preferences must never prevent the popup from mounting. Late reads can refresh it without remounting. */
export function startPopup(initialize: () => Promise<unknown>, render: () => void, timeoutMs = POPUP_PREFERENCES_TIMEOUT_MS): void {
  const timer = setTimeout(render, timeoutMs);
  void Promise.resolve().then(initialize).catch(() => {}).finally(() => {
    clearTimeout(timer);
    render();
  });
}
