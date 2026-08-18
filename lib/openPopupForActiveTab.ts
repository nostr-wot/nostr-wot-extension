import browser from './browser.ts';
import { originMatchesActiveTab, requestIsFromActiveTab } from './originMatchesActiveTab.ts';

export { originMatchesActiveTab, requestIsFromActiveTab };

/** Where the background records which site it opened the popup for. */
export const POPUP_CONTEXT_KEY = 'popupContext';

export interface PopupContext {
  origin: string;
  tabId: number | null;
  at: number;
}

/**
 * Open the extension action popup ONLY if the request came from the tab the user is
 * currently looking at — by tab id when the caller knows it, else by hostname.
 *
 * Safe no-op when there is no active tab, the request came from another tab, or
 * `action.openPopup()` is unavailable / throws (e.g. no active window). Prevents a
 * background/inactive tab making nostr requests — or one polling repeatedly — from
 * popping the popup open.
 */
export async function openPopupForActiveTab(origin: string, requestingTabId?: number): Promise<void> {
  try {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!requestIsFromActiveTab(activeTab, origin, requestingTabId)) return;

    // Tell the popup which site it is being opened for. It cannot reliably work that out
    // by itself: tabs.query withholds the URL from an extension holding no host permission
    // for that tab, and `activeTab` — which would supply it — is granted when the USER
    // invokes the extension, not when we open it ourselves. Without this the popup opened
    // to "Navigate to a website to connect" and the user had to close it and reopen it by
    // hand before the Connect card appeared.
    //
    // storage.session rather than a variable: the service worker can be torn down between
    // opening the popup and the popup reading this.
    await browser.storage.session.set({
      [POPUP_CONTEXT_KEY]: { origin, tabId: activeTab?.id ?? requestingTabId ?? null, at: Date.now() },
    });

    await browser.action.openPopup();
  } catch {
    /* no active tab / openPopup unavailable — safe no-op */
  }
}
