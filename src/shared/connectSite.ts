/**
 * Connecting a site, in an order that survives the popup being destroyed.
 *
 * `browser.permissions.request()` raises the browser's own "allow access to this site"
 * dialog. That dialog takes focus, and an extension popup that loses focus is dismissed —
 * along with its JS context, so nothing after the `await` runs. Recording the user's
 * consent after the permission request therefore lost exactly the thing the user had
 * already decided: they clicked Connect, accepted the browser's dialog, reopened the
 * popup, and the Connect button was still there. Clicking it again worked only because
 * the host permission was granted by then, so the request resolved with no dialog and
 * the popup lived long enough to reach the next line.
 *
 * So consent is persisted first and the browser is asked second. The two are independent
 * decisions anyway: the click is consent to share the identity with this site, while host
 * access is a browser-level gate on the content script. Granting the first without the
 * second is inert — with no content script, no request from that page can reach us.
 *
 * Dependencies are injected so the ordering can be tested without a browser.
 *
 * @module shared/connectSite
 */

export interface ConnectSiteDeps {
  /** Record the user's decision. Must complete before anything that can close the popup. */
  persistConsent: (domain: string) => Promise<void>;
  /**
   * Ask the browser for host access. May resolve false, throw, or never settle at all —
   * the page awaiting it can cease to exist while the dialog is open.
   */
  requestHostAccess: (domain: string) => Promise<boolean>;
}

export interface ConnectSiteResult {
  /** The site is connected — the user's consent is recorded. */
  connected: boolean;
  /** The browser also granted host access, so the content script can run there now. */
  hostAccess: boolean;
}

/**
 * @param domain - hostname the user chose to connect
 * @param deps - injected side effects
 */
export async function connectSite(domain: string, deps: ConnectSiteDeps): Promise<ConnectSiteResult> {
  if (!domain) return { connected: false, hostAccess: false };

  // First, and awaited: if this throws, nothing was decided and the caller should say so.
  await deps.persistConsent(domain);

  // Now the part that may take the popup down with it. Whatever happens here, the site
  // is connected — a denied or dismissed dialog just means the user has to grant site
  // access before the page can reach the extension.
  let hostAccess = false;
  try {
    hostAccess = await deps.requestHostAccess(domain);
  } catch {
    hostAccess = false;
  }

  return { connected: true, hostAccess };
}
