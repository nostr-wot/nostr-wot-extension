// Which tab is showing which origin, learned from the ports content scripts open.
//
// This used to be read from tabs.query()'s `tab.url`, but Chrome strips url/title/
// favIconUrl unless the extension holds "tabs" or an explicit host permission for that
// tab — and content-script `matches` do not count. With no per-site grants there is no
// url to filter on, so every tab was skipped and connected sites silently stopped hearing
// about account switches.
//
// `port.sender` is not permission-gated (the connect gate already depends on that), so
// the content script telling us it exists is a better source than asking the tabs API.
// Two knowing limits: only tabs that made at least one NIP-07/WebLN call are registered —
// a page that never called holds no pubkey and has nothing to update — and the registry
// dies with the service worker, which is self-healing because the ports die with it too.
export const tabOrigins = new Map<number, string>();

/** Remember that `tabId` is showing `origin`. Called when a content-script port connects. */
export function rememberTabOrigin(tabId: number | undefined, origin: string): void {
    if (typeof tabId !== 'number' || !origin) return;
    tabOrigins.set(tabId, origin);
}

/** Forget a tab, on port disconnect or tab close. */
export function forgetTabOrigin(tabId: number | undefined): void {
    if (typeof tabId === 'number') tabOrigins.delete(tabId);
}

/** Which origin is a given tab showing, as learned from its content-script port. */
export function getTabOrigin(tabId: number | undefined): string | null {
    if (typeof tabId !== 'number') return null;
    return tabOrigins.get(tabId) ?? null;
}

