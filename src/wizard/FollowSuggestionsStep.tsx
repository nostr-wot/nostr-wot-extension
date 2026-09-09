import { useMemo, useState } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import { npubDecode } from '@lib/crypto/bech32.ts';
import Button from '@components/Button/Button';
import Avatar from '@components/Avatar/Avatar';
import { truncateNpub, getInitial as getInitialChar } from '@utils/format/text.ts';
import type { ProfileMetadata } from '@domain/profile/profileMetadata.ts';
import Heading from '@components/Heading/Heading';
import Container from '@components/Container/Container';
import Text from '@components/Text/Text';

/* ------------------------------------------------------------------ */
/*  Curated account list — npubs only                                  */
/* ------------------------------------------------------------------ */

const TIER_1: string[] = [
  'npub1gxdhmu9swqduwhr6zptjy4ya693zp3ql28nemy4hd97kuufyrqdqwe5zfk',
  'npub1m9vsm9d8sy0pevcjhenwm4ny6l37dm2hsg4dnusna43ql3n5305qy4zlg4',
  'npub12pluyzs2n3kxvx6t8fsqaa8j23f4n7syy45fny0cah46uaxqm5pqgfgy5m',
];

const TIER_2: string[] = [
  'npub1a2cww4kn9wqte4ry70vyfwqyqvpswksna27rtxd8vty6c74era8sdcw83a', // lyn alden
  'npub1gcxzte5zlkncx26j68ez60fzkvtkm9e0vrwdcvsjakxf9mu9qewqlfnj5z', // vitor pamplona
  'npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6', // fiatjaf
  'npub1spdnfacgsd7lk0nlqkq443tkq4jx9z6c6ksvaquuewmw7d3qltpslcq6j7', // paul keating
  'npub1cn4t4cd78nm900qc2hhqte5aa8c9njm6qkfzw95tszufwcwtcnsq7g3vle', // jack mallers
  'npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m', // jack dorsey
  'npub16c0nh3dnadzqpm76uctf5hqhe2lny344zsmpm6feee9p5rdxaa9q586nvr', // miljan
  'npub12rv5lskctqxxs2c8rf2zlzc7xx3qpvzs3w4etgemauy9thegr43sf485vg', // calle
  'npub1qnyd0r9f7g6u5z4x3c2v1b0n8m7k6j5h4g3f2d1s0a9p95gx', // odell
  'npub1s05n9m8k7j6h5g4f3d2s1a0p9o8i7u6y5t4r3e2w1q0eyhe', // jeff booth
  'npub15dqlghlewk84wz3pkqqvzl2w2w36f97g89ljds8x6c094nlu02vqjllm5m', // michael saylor
  'npub1g53mukxnjkcmr94fhryzkqutdz2ukq4ks0gvy5af25rgmwsl4ngq43drvk' // sirius
];

/* ------------------------------------------------------------------ */
/*  Selection algorithm                                                */
/* ------------------------------------------------------------------ */

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function selectAccounts(): string[] {
  const shuffledT1 = shuffle(TIER_1);
  const shuffledT2 = shuffle(TIER_2);
  const used = new Set<string>();

  // First half: 1 TIER_1 + 4 TIER_2, shuffled
  const t1a = shuffledT1[0];
  used.add(t1a);
  const t2a = shuffledT2.filter((n) => !used.has(n)).slice(0, 4);
  t2a.forEach((n) => used.add(n));
  const firstHalf = shuffle([t1a, ...t2a]);

  // Second half: 1 more TIER_1 + 6 TIER_2, shuffled (no repeats)
  const t1b = shuffledT1.find((n) => !used.has(n))!;
  used.add(t1b);
  const t2b = shuffledT2.filter((n) => !used.has(n)).slice(0, 6);
  const secondHalf = shuffle([t1b, ...t2b]);

  return [...firstHalf, ...secondHalf];
}

/* ------------------------------------------------------------------ */
/*  Profile metadata types                                             */
/* ------------------------------------------------------------------ */

/** A cached profile: the published metadata plus when this device fetched it. */
type ProfileMeta = ProfileMetadata & { _ts?: number };

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface FollowSuggestionsStepProps {
  onNext: () => void;
}

export default function FollowSuggestionsStep({ onNext }: FollowSuggestionsStepProps) {
  // Relay-backed profile loading and the "are you already following anyone?"
  // auto-skip are intentionally disabled here for now. In Safari the extension
  // popup cannot reach the Nostr relays, and the pending WebSocket/verify work
  // was locking up this step (cards visible, but buttons unresponsive). The
  // suggestions render statically from the curated list; names/avatars fall
  // back to the shortened key + initial. Re-enable once relay access in Safari
  // is fixed — as a background load that never gates the UI.
  const npubs = useMemo(() => selectAccounts(), []);
  const hexKeys = useMemo(
    () => npubs.reduce<Array<{ npub: string; hex: string }>>((acc, npub) => {
      try {
        acc.push({ npub, hex: npubDecode(npub) });
      } catch { /* skip invalid npub */ }
      return acc;
    }, []),
    [npubs],
  );

  const hexList = useMemo(() => hexKeys.map((a) => a.hex), [hexKeys]);

  const [selected, setSelected] = useState<Set<string>>(() => new Set(hexList));
  const [publishing, setPublishing] = useState(false);
  const profiles: Record<string, ProfileMeta> = {};

  const toggle = (hex: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(hex)) next.delete(hex);
      else next.add(hex);
      return next;
    });
  };

  const handleFollow = async () => {
    if (selected.size === 0) return;
    setPublishing(true);
    try {
      const tags = Array.from(selected).map((pk) => ['p', pk]);
      const event = {
        kind: 3,
        content: '',
        tags,
        created_at: Math.floor(Date.now() / 1000),
      };
      await rpc('signAndPublishEvent', { event });
    } catch { /* publish failed (e.g. relays unreachable) — proceed anyway so onboarding is never trapped */ }
    onNext();
  };

  const getName = (hex: string) => {
    const p = profiles[hex];
    return p?.display_name || p?.name || truncateNpub(hex);
  };

  const getSubtitle = (hex: string) => {
    const p = profiles[hex];
    return p?.nip05 || truncateNpub(hex);
  };

  const getAvatar = (hex: string) => profiles[hex]?.picture || null;

  const getInitial = (hex: string) => getInitialChar(getName(hex));

  return (
    <Container className="flex-1">
      <Heading className="mb-3">{t('wizard.followTitle')}</Heading>
      <Text variant="secondary" className="mb-8">{t('wizard.followDesc')}</Text>

      <Container gap={3} className="max-h-[340px] overflow-y-auto pr-1">
        {hexKeys.map(({ hex }) => {
          const isSelected = selected.has(hex);
          const avatar = getAvatar(hex);
          return (
            <button
              key={hex}
              type="button"
              // A toggle, not a link: aria-pressed is what tells a screen
              // reader this row is currently chosen. It was a div with an
              // onClick, so it could not be reached or activated from the
              // keyboard at all — on a step whose whole purpose is picking
              // from a list.
              aria-pressed={isSelected}
              className={`w-full font-[inherit] text-left flex items-center gap-5 py-5 px-6 border rounded-panel cursor-pointer transition-all select-none hover:bg-card-active ${isSelected ? 'border-brand bg-brand-tint-hover' : 'border-card-border bg-card'}`}
              onClick={() => toggle(hex)}
            >
              <Avatar
                src={avatar}
                fallback={getInitial(hex)}
                imgClassName="w-9 h-9 rounded-full object-cover shrink-0"
                fallbackClassName="w-9 h-9 rounded-full bg-brand-light text-brand flex items-center justify-center text-lg font-bold shrink-0"
              />
              <Container gap={1} className="overflow-hidden flex-1 min-w-0">
                <span className="text-md font-semibold text-heading overflow-hidden text-ellipsis whitespace-nowrap">{getName(hex)}</span>
                <span className="text-xs text-muted overflow-hidden text-ellipsis whitespace-nowrap">{getSubtitle(hex)}</span>
              </Container>
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all text-on-brand ${isSelected ? 'border-brand bg-brand' : 'border-card-border'}`}>
                {isSelected && (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
            </button>
          );
        })}
      </Container>

      <Text as="div" variant="secondary" className="text-sm text-center mt-3">
        {t('wizard.followSelected', { count: selected.size })}
      </Text>

      <Container variant="row" gap={4} stickyFooter>
        {/* Skip is NEVER disabled: a still-loading (or hung) relay query must
            not trap the user on this step. */}
        <Button className="flex-1" variant="secondary" onClick={onNext}>{t('wizard.skipForNow')}</Button>
        <Button
          className="flex-1"
          onClick={handleFollow}
          disabled={selected.size === 0 || publishing}
        >
          {publishing ? t('wizard.followPublishing') : t('wizard.followSuggestions')}
        </Button>
      </Container>
    </Container>
  );
}
