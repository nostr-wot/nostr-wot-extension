import { TIER_1, TIER_2 } from '@constants/followSuggestions.ts';
import { useMemo, useState } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import { npubDecode } from '@lib/crypto/bech32.ts';
import Button, { ButtonSecondary } from '@components/Button';
import ProfileSummary from '@components/ProfileSummary';
import usePublicProfile from '@hooks/usePublicProfile';
import { truncateNpub } from '@domain/nostr/display.ts';
import Heading from '@components/Heading';
import Container from '@components/Container';
import Text from '@components/Text';

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

function SuggestedProfile({ pubkey }: { pubkey: string }) {
  const { profile } = usePublicProfile(pubkey);
  return <ProfileSummary compact meta={profile} fallback={truncateNpub(pubkey)} />;
}

interface FollowSuggestionsStepProps {
  onNext: () => void;
}

export default function FollowSuggestionsStep({ onNext }: FollowSuggestionsStepProps) {
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

  return (
    <Container className="flex-1">
      <Heading className="mb-3">{t('wizard.followTitle')}</Heading>
      <Text variant="secondary" className="mb-8">{t('wizard.followDesc')}</Text>

      <Container gap={3} className="max-h-[340px] overflow-y-auto pr-1">
        {hexKeys.map(({ hex }) => {
          const isSelected = selected.has(hex);
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
              <div className="flex-1 min-w-0"><SuggestedProfile pubkey={hex} /></div>
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
        <ButtonSecondary className="flex-1" onClick={onNext}>{t('wizard.skipForNow')}</ButtonSecondary>
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
