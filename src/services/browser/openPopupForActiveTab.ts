import { POPUP_CONTEXT_KEY } from '@constants/browser.ts';

import browser from '@lib/browser.ts';
import { requestIsFromActiveTab } from '../../domain/site/originMatchesActiveTab.ts';

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

    // Reloading the website after an account switch can immediately generate
    // fresh signing/connect requests. The popup already listens for them; do
    // not invoke the native popup-opening lifecycle again while it is visible.
    if (browser.runtime.getContexts) {
      const contexts = await browser.runtime.getContexts({ contextTypes: ['POPUP'] });
      if (contexts.length > 0) {
        return;
      }
    } else if (browser.extension?.getViews?.({ type: 'popup' }).length) {
      return;
    }

    await browser.action.openPopup();
  } catch {
    /* no active tab / openPopup unavailable — safe no-op */
  }
}
