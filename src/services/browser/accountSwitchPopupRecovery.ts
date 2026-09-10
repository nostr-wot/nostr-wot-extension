import browser from '@lib/browser.ts';
import { ACCOUNT_SWITCH_POPUP_RECOVERY_MS } from '@constants/browser.ts';

let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;

/** Arm in the background before reloading: the originating popup may disappear. */
export async function scheduleAccountSwitchPopupRecovery(tabId: unknown): Promise<void> {
  if (!Number.isInteger(tabId) || (tabId as number) < 0) throw new Error('Invalid tab');
  const current = ++generation;
  clearTimeout(timer);
  // Firefox's popup API has different gesture requirements. This recovery is Chrome-only.
  if (!browser.runtime.getURL('').startsWith('chrome-extension://')) return;
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (current !== generation || tab?.id !== tabId || tab.windowId === undefined) return;
  const windowId = tab.windowId;
  timer = setTimeout(() => {
    void attemptRecovery(tabId as number, windowId, current);
  }, ACCOUNT_SWITCH_POPUP_RECOVERY_MS);
}

async function attemptRecovery(tabId: number, windowId: number, current: number): Promise<void> {
  try {
    const [window, tabs] = await Promise.all([
      browser.windows.get(windowId),
      browser.tabs.query({ active: true, windowId }),
    ]);
    if (current !== generation || !window.focused || tabs[0]?.id !== tabId) return;
    // getContexts() reports document existence, not native visibility. Let Chrome's
    // native openPopup guard refuse if it already owns an active popup. Never close
    // an existing popup, force focus, or retry a refusal.
    await browser.action.openPopup({ windowId });
  } catch { /* Native refusal is final; recovery never retries or logs. */ }
}
