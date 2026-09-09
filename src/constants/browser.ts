/** Where the background records which site it opened the popup for. */
export const POPUP_CONTEXT_KEY = 'popupContext';

/* Imported rather than mirrored. Both the key and the shape were restated here
   under a comment saying they mirrored the background's — a duplication someone
   noticed and wrote down instead of removing. The two must agree exactly: this
   reads the record the background writes, and a drifted key reads nothing at
   all, silently. */

// Long enough to cover opening and rendering, short enough that a context left by an
// earlier request cannot mislabel a popup the user opens later by hand.
export const POPUP_CONTEXT_TTL_MS = 60_000;

/** Page URLs the extension deliberately has nothing to say about. */
export const RESTRICTED_URL_PREFIXES = ['chrome://', 'edge://', 'about:', 'moz-extension://', 'chrome-extension://'];

export const FAVICON_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
