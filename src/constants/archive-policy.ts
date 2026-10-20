import * as kinds from 'nostr-tools/kinds';

/** Explicit copy policy, independent of labels and the dependency's expanding kind catalog.
 * Private envelopes still require consent; unlisted kinds require the unknown-kind opt-in.
 */
export const ARCHIVE_COPY_KINDS: ReadonlySet<number> = new Set([
  kinds.Metadata,
  kinds.ShortTextNote,
  kinds.Contacts,
  kinds.EncryptedDirectMessage,
  kinds.EventDeletion,
  kinds.Repost,
  kinds.Reaction,
  kinds.GenericRepost,
  kinds.GiftWrap,
  kinds.Mutelist,
  kinds.Pinlist,
  kinds.RelayList,
  kinds.BookmarkList,
  kinds.CommunitiesList,
  kinds.PublicChatsList,
  kinds.BlockedRelaysList,
  kinds.SearchRelaysList,
  kinds.InterestsList,
  kinds.UserEmojiList,
  kinds.DirectMessageRelaysList,
  kinds.BlossomServerList,
  kinds.Followsets,
  kinds.Genericlists,
  kinds.Relaysets,
  kinds.Bookmarksets,
  kinds.Curationsets,
  kinds.LongFormArticle,
  kinds.DraftLong,
]);
