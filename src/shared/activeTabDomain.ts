/**
 * Which site is the user looking at?
 *
 * The obvious answer — read `tab.url` from `tabs.query` — is not available to us. The
 * browser strips `url` (and title/favIconUrl) from tabs unless the extension holds the
 * "tabs" permission or an explicit host permission for that tab, and this extension
 * deliberately holds neither: content-script `matches` are scriptable hosts and grant
 * nothing to the tabs API. `activeTab` covers the popup when the user opens it themselves,
 * but not necessarily when the background opens it programmatically for an incoming
 * request — which is exactly when naming the site matters most.
 *
 * So: use the URL when the browser gives us one, and otherwise ask the background, which
 * knows which origin each tab is showing from the content-script port that tab opened.
 * The tab's id is never stripped.
 *
 * @module shared/activeTabDomain
 */

import browser from './browser.ts';
import { rpc } from './rpc.ts';
import { getDomainFromUrl } from './url.ts';

/** Set by the background when it opens the popup for a site. Mirrors lib/openPopupForActiveTab.ts. */
const POPUP_CONTEXT_KEY = 'popupContext';
interface PopupContext { origin: string; tabId: number | null; at: number }

// Long enough to cover opening and rendering, short enough that a context left by an
// earlier request cannot mislabel a popup the user opens later by hand.
const POPUP_CONTEXT_TTL_MS = 60_000;

/** Page URLs the extension deliberately has nothing to say about. */
const RESTRICTED = ['chrome://', 'edge://', 'about:', 'moz-extension://', 'chrome-extension://'];

export interface ActiveTabDomain {
  /** The hostname, or null when it genuinely cannot be determined. */
  domain: string | null;
  /** True when the active tab is a browser page the extension does not operate on. */
  restricted: boolean;
}

export async function resolveActiveTabDomain(): Promise<ActiveTabDomain> {
  let tab: { id?: number; url?: string } | undefined;
  try {
    [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  } catch {
    return { domain: null, restricted: false };
  }
  if (!tab) return { domain: null, restricted: false };

  if (tab.url) {
    if (RESTRICTED.some(p => tab!.url!.startsWith(p))) return { domain: null, restricted: true };
    return { domain: getDomainFromUrl(tab.url), restricted: false };
  }

  // No URL. First: did the background open this popup for a specific site? That is the
  // most direct answer, it needs no permissions, and it survives the service worker being
  // torn down between opening the popup and this running.
  try {
    const data = await browser.storage.session.get(POPUP_CONTEXT_KEY) as Record<string, PopupContext | undefined>;
    const ctx = data[POPUP_CONTEXT_KEY];
    if (
      ctx?.origin &&
      Date.now() - ctx.at < POPUP_CONTEXT_TTL_MS &&
      (ctx.tabId == null || tab.id == null || ctx.tabId === tab.id)
    ) {
      return { domain: ctx.origin, restricted: false };
    }
  } catch { /* fall through */ }

  // Otherwise ask the background which origin this tab has been talking to us as.
  try {
    const origin = await rpc<string | null>('getTabOrigin', { tabId: tab.id });
    return { domain: origin || null, restricted: false };
  } catch {
    return { domain: null, restricted: false };
  }
}
