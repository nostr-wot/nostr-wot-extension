import React from 'react';
import { derivePqcCardState, type PqcCardState } from '@domain/pqc/pqcState.ts';
import { t } from '@services/i18n/i18n.ts';
import IconKey from '@assets/IconKey.tsx';
import IconShield from '@assets/IconShield.tsx';
import IconWarning from '@assets/IconWarning.tsx';
import { useNavigate } from '@context/NavigationContext';
import Card from '@components/Card';
import { usePqc } from '@context/PqcContext';
import Container from '@components/Container';
import Text from '@components/Text';

/**
 * Post-quantum status on the dashboard.
 *
 * The card used to say "Turn on post-quantum keys" whatever the account's actual state, so
 * a user who had already set them up was invited to turn on something that was on. It now
 * reports the state it finds, and only asks for an action when one is genuinely needed.
 *
 * "Set up" and "on" are not the same question as "can this account derive keys". A 24-word
 * account can always derive them — they are a function of the seed — but nobody can send to
 * them until the attestation is published, because that event is the only way a sender
 * discovers the key. So publication is what makes the feature real, and it is what this
 * card reports.
 */

export default function PqcCard() {
  const navigate = useNavigate();
  // Both reads come from PqcContext, which owns the fetch and the relay-cache
  // subscription for every post-quantum surface. This card and PqcSection used
  // to ask the same two questions independently on every popup open.
  const { status, published } = usePqc();
  const state = derivePqcCardState(status, published);

  if (!state) return null;

  return <PqcCardView state={state} onClick={navigate.openPqc} />;
}

export function PqcCardView({ state, onClick }: { state: PqcCardState; onClick: () => void }) {
  const COPY: Record<PqcCardState, { icon: React.ReactNode; title: string; desc: string }> = {
    enabled: {
      icon: <IconShield size={18} />,
      title: t('pqc.cardEnabledTitle'),
      desc: t('pqc.cardEnabledDesc'),
    },
    stale: {
      icon: <IconWarning size={18} />,
      title: t('pqc.cardStaleTitle'),
      desc: t('pqc.cardStaleDesc'),
    },
    setup: {
      icon: <IconKey size={18} />,
      title: t('pqc.cardTitle'),
      desc: t('pqc.cardDesc'),
    },
    import: {
      icon: <IconKey size={18} />,
      title: t('pqc.cardImportTitle'),
      desc: t('pqc.cardImportDesc'),
    },
  };

  const { icon, title, desc } = COPY[state];

  return (
    <Card
      as="button"
      variant="flat"
      className="flex items-center gap-6 w-full py-6 px-7 mb-0 cursor-pointer text-left transition-colors hover:border-brand"
      onClick={onClick}
    >
      <div className="flex items-center justify-center w-16 h-16 shrink-0 rounded-md bg-brand-light text-brand">{icon}</div>
      <Container>
        <strong className="block text-md font-semibold text-heading">{title}</strong>
        <Text variant="secondary" as="span" className="text-xs text-menu-subtitle">{desc}</Text>
      </Container>
    </Card>
  );
}
