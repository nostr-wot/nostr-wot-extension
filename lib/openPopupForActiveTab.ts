import browser from './browser.ts';
import { originMatchesActiveTab } from './originMatchesActiveTab.ts';

export { originMatchesActiveTab };

/**
 * Open the extension action popup ONLY if `origin` (a hostname) matches the tab
 * the user is currently looking at. Safe no-op when there is no active tab, the
 * hostnames differ, or `action.openPopup()` is unavailable / throws (e.g. no
 * active window). Prevents a background/inactive tab making nostr requests —
 * or one polling repeatedly — from popping the popup open.
 */
export async function openPopupForActiveTab(origin: string): Promise<void> {
  try {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (originMatchesActiveTab(activeTab?.url, origin)) {
      await browser.action.openPopup();
    }
  } catch {
    /* no active tab / openPopup unavailable — safe no-op */
  }
}
