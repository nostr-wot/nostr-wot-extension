/** The browser opens this public page after removal. Never append identity data. */
export async function registerUninstallFeedback(runtime: {
    setUninstallURL?: (url: string) => Promise<void>;
}): Promise<void> {
    if (typeof runtime.setUninstallURL !== 'function') return;
    try {
        await runtime.setUninstallURL('https://nostr-wot.com/uninstall');
    } catch {
        console.warn('[FEEDBACK] Could not register uninstall page');
    }
}
