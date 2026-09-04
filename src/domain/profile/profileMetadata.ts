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

/**
 * Building the kind:0 content the user is about to publish.
 *
 * This is a read-modify-write over a record the user does not fully own: a
 * kind:0 carries whatever fields the clients they have used decided to put
 * there, and a publish replaces the whole event. So the merge has to preserve
 * every field this form does not know about, and has to *remove* — not blank —
 * the ones the user cleared. Getting either half wrong silently destroys part
 * of a published profile, and there was no test on it.
 */


/** The fields the edit form owns. Anything else on the existing event is passed through. */
export interface ProfileFields {
  name: string;
  about: string;
  picture: string;
  nip05: string;
  lud16: string;
  website: string;
  banner: string;
}

/** Fields the form owns, in the order they are applied. */
const OWNED = ['name', 'about', 'picture', 'nip05', 'lud16', 'website', 'banner'] as const;

/**
 * Merge the form's fields over the existing kind:0 content.
 *
 * `uploadedPictureUrl` wins over the typed `picture`, because it is the file
 * the user just picked in this session.
 *
 * An empty field deletes the key rather than writing `''`. A kind:0 with
 * `"nip05": ""` is not the same as one without it — the empty string is a
 * claim, and some clients will try to verify it and show it as failing.
 */
export function mergeProfileMetadata(
  existing: ProfileMetadata | null | undefined,
  fields: ProfileFields,
  uploadedPictureUrl?: string | null,
): ProfileMetadata {
  const metadata: ProfileMetadata = existing ? { ...existing } : {};

  for (const key of OWNED) {
    const value = key === 'picture' ? (uploadedPictureUrl || fields.picture) : fields[key];
    if (value) metadata[key] = value;
    else delete metadata[key];
  }

  // `display_name` mirrors `name`. It used to be set when a name was given and
  // left alone otherwise — so clearing the name deleted `name` and left the old
  // value sitting in `display_name`, which is the field many clients prefer.
  // The user saw the field emptied and published; the old name kept showing.
  if (fields.name) metadata.display_name = fields.name;
  else delete metadata.display_name;

  return metadata;
}

/**
 * Whether the form differs from what is already published.
 *
 * `name` is compared against `display_name` as a fallback because that is what
 * the form seeds itself from when the two disagree.
 */
export function profileHasChanges(
  existing: ProfileMetadata | null | undefined,
  fields: ProfileFields,
  hasNewImage = false,
): boolean {
  if (hasNewImage) return true;
  const publishedName = (existing?.name || existing?.display_name || '') as string;
  if (fields.name !== publishedName) return true;
  return OWNED.some(
    (key) => key !== 'name' && key !== 'picture' && fields[key] !== ((existing?.[key] as string) || ''),
  ) || fields.picture !== ((existing?.picture as string) || '');
}
