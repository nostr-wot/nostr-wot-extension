/**
 * Class strings shared by EventPreview and every kinds/* renderer.
 *
 * Previously `EventPreview.module.css`, imported by ten files for the same
 * handful of class names. A CSS Module distributes fine across imports; a
 * `.tsx` literal string does not without becoming ten copies of the same
 * text, so this stays a shared module rather than being inlined at each
 * call site the way a single-file component (Chip, Spinner) would.
 */
export const EP = {
  root: 'min-w-0 bg-page-solid border border-card-border rounded-md p-6',
  sectionTitle: 'text-xs uppercase tracking-[0.5px] text-secondary mb-4 font-semibold',
  tagsTitle: 'mt-5',
  noteContent: 'text-md leading-loose whitespace-pre-wrap break-words text-heading max-h-[180px] overflow-y-auto',
  tagsList: 'font-mono-alt text-xs bg-brand-tint-hover rounded-sm px-5 py-4 max-h-[140px] overflow-y-auto',
  tagRow: 'whitespace-pre-wrap break-all py-[1px] text-body',
  eventNote: 'text-sm italic text-muted mt-2',
  reactionEmoji: 'text-display leading-none my-2',

  // Profile card (kind 0)
  profileCard: 'bg-card border border-card-border rounded-md overflow-hidden flex flex-col',
  profileBanner: 'w-full h-[72px] overflow-hidden [&_img]:w-full [&_img]:h-full [&_img]:object-cover',
  // -mt-8 (-16px) replaces the old `.profileBanner + .profileHeader` sibling
  // rule -- applied by the caller only when a banner actually rendered,
  // since that is the exact condition the selector was matching.
  profileHeader: 'flex items-center gap-5 px-6 pt-0',
  profileHeaderAfterBanner: '-mt-8',
  profileAvatar: 'w-10 h-10 rounded-full object-cover border-2 border-card',
  profileAvatarPlaceholder:
    'w-10 h-10 rounded-full bg-brand-light flex items-center justify-center text-2xl font-bold text-brand ' +
    'border-2 border-card shrink-0',
  profileName: 'text-lg font-bold text-heading',
  profileAbout: 'text-sm text-body leading-normal px-6 pt-3',
  // first/last padding replaces `.profileField:first-of-type` /
  // `:last-of-type` -- computed per-item by the caller, which already knows
  // which rendered field is first/last since the set is conditional on data.
  profileField: 'flex gap-3 text-xs px-6',
  profileFieldFirst: 'pt-3',
  profileFieldLast: 'pb-5',
  profileFieldLabel: 'text-muted min-w-[60px] font-semibold',
  profileFieldValue: 'text-body break-all',

  // rgba(217,119,6,*) are one-offs, distinct from --warning-tint (0.08).
  unknownWarning:
    'flex items-start gap-4 px-5 py-4 bg-[rgba(217,119,6,0.1)] border border-[rgba(217,119,6,0.15)] ' +
    'rounded-md text-sm text-warning mb-4',
  expandToggle:
    'bg-none border-none py-2 px-0 mt-4 text-sm font-semibold text-brand cursor-pointer text-left ' +
    'transition-colors hover:text-brand-hover',
  jsonPreview: 'font-mono-alt text-xs whitespace-pre-wrap break-all bg-brand-tint-hover p-5 rounded-sm text-body max-h-[200px] overflow-y-auto mt-3',
};
