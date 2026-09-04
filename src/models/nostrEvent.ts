import type { UnsignedEvent } from '@lib/types.ts';

/**
 * Event shape shared by every approval/activity display surface: EventPreview, its
 * per-kind renderers, EventDetailModal, and permissions.ts's label formatter.
 *
 * This interface used to be declared ten separate times across those files, and the
 * copies had already started to drift -- some required `kind`/`content`, one only ever
 * saw `tags` and left the rest optional, one carried an index signature the others
 * lacked. `PendingRequest` drifted the exact same way (five copies, one of which
 * documented a resulting type error in a comment instead of fixing it) -- this is that
 * failure mode again, at twice the scale, caught before it produced its own uncaught
 * mismatch.
 *
 * `kind` and `content` are required: every renderer here (GenericPreview, NotePreview,
 * ProfilePreview, ReactionPreview, ...) reads them unconditionally, with no optional
 * chaining and no fallback -- making them optional would only reintroduce the drift by
 * pushing a null check onto call sites that don't need one. `tags` stays optional
 * because the widest of the ten declarations (permissions.ts, which only ever reads
 * `event.tags` for the kind-30078 platform lookup) never required it. The index
 * signature is kept so the raw-JSON `<pre>` dump in EventPreview can show whatever
 * extra wire fields (`id`, `sig`, `pubkey`, ...) an event happens to carry without this
 * type having to enumerate them.
 *
 * Deliberately not folded into `UnsignedEvent` (lib/types.ts): that type is the strict
 * wire shape used for signing, where `tags` is required and there is no index
 * signature. Loosening it here would leak a display-only permissiveness into every
 * signing path that depends on it.
 */
export interface NostrEventDisplay extends Pick<UnsignedEvent, 'kind' | 'content'> {
  tags?: string[][];
  [key: string]: unknown;
}
