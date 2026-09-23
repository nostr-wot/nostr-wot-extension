/** Provider descriptions are display data, not proof of payment or zap validity. */
export function transactionMemo(memo: unknown, metadata: unknown): string | undefined {
  if (metadata && typeof metadata === 'object') {
    const { comment, nostr } = metadata as { comment?: unknown; nostr?: unknown };
    if (typeof comment === 'string' && comment.trim()) return comment.slice(0, 1000);
    // LNbits LNURLp retains the original serialized NIP-57 request in extra.nostr.
    // NWC bridges can forward this in their generic transaction metadata.
    if (typeof nostr === 'string' && nostr.length <= 64 * 1024) {
      try {
        const request = JSON.parse(nostr);
        if (request?.kind === 9734 && typeof request.content === 'string' && request.content.trim()) {
          return request.content.slice(0, 1000);
        }
      } catch { /* Invalid provider metadata must not hide the ordinary memo. */ }
    }
  }
  return typeof memo === 'string' && memo ? memo : undefined;
}
