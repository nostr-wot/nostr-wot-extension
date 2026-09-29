/** Resolve page identity exclusively from the browser's MessageSender, never params. */
export function getPageRequestOrigin(
    method: string,
    params: unknown,
    sender?: chrome.runtime.MessageSender,
): string {
    const kind = (params as { event?: { kind?: unknown } } | undefined)?.event?.kind;
    const authentication = method === 'nip07_signEvent' && (kind === 27235 || kind === 22242);
    if (authentication && sender?.frameId !== 0) {
        throw new Error('Authentication requires a verified top-level frame');
    }

    const originUrl = sender?.url || (sender?.frameId === 0 ? sender.tab?.url : undefined);
    try {
        if (!originUrl) throw new Error('Missing document URL');
        const parsed = new URL(originUrl);
        if (!['http:', 'https:'].includes(parsed.protocol) || sender?.origin === 'null') {
            throw new Error('Invalid origin');
        }
        if (authentication) {
            // origin is not supplied on every supported browser. When supplied,
            // it must agree with the document URL, including scheme and port.
            if (sender?.origin !== undefined && sender.origin !== parsed.origin) {
                throw new Error('Mismatched origin');
            }
            if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
                throw new Error('Insecure origin');
            }
        }
        return parsed.origin;
    } catch {
        throw new Error('Cannot determine request origin');
    }
}
