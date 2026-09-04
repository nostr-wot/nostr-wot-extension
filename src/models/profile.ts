/**
 * A user's kind:0 profile metadata.
 *
 * The index signature is load-bearing: a kind:0 accumulates fields from every
 * client its owner has ever used, and publishing replaces the whole event — so
 * anything this extension does not know about still has to survive a
 * read-modify-write. See mergeProfileMetadata in shared/profileMetadata.ts.
 */
export interface ProfileMetadata {
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  nip05?: string;
  lud16?: string;
  website?: string;
  banner?: string;
  [key: string]: unknown;
}
