import React from 'react';
import { derivePqcCardState, type PqcCardState } from '@domain/pqc/pqcState.ts';
import { t } from '@lib/i18n.js';
import { IconKey, IconShield, IconWarning } from '@assets';
import { useNavigate } from '@context/NavigationContext';
import Card from '@components/Card/Card';
import { usePqc } from '@context/PqcContext';

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

  // "On" is a status, not a call to action, so its icon reads calmer than the
  // setup invitation; "stale" needs to catch the eye because senders are
  // currently encrypting to the wrong key. `.pqcCardOn strong` never changed
  // the title colour in practice — it restated the same --text-heading the
  // base rule already set — so there is no "enabled" title override here.
  const iconTone = state === 'enabled' ? 'text-success' : state === 'stale' ? 'text-warning' : 'text-brand';
  const cardTone = state === 'stale' ? 'border-warning' : '';

  return (
    <Card
      as="button"
      variant="flat"
      className={`flex items-center gap-6 w-full py-6 px-7 mb-0 cursor-pointer text-left transition-colors hover:border-brand ${cardTone}`.trim()}
      onClick={navigate.openPqc}
    >
      <div className={`flex items-center justify-center w-16 h-16 shrink-0 rounded-md bg-card-active ${iconTone}`}>{icon}</div>
      <div className="flex flex-col">
        <strong className="block text-md font-semibold text-heading">{title}</strong>
        <span className="text-xs leading-normal text-secondary">{desc}</span>
      </div>
    </Card>
  );
}
