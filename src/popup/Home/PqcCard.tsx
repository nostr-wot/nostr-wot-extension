import React from 'react';
import { derivePqcCardState, type PqcCardState } from '@shared/pqcState.ts';
import { t } from '@lib/i18n.js';
import { IconKey, IconShield, IconWarning } from '@assets';
import { useNavigate } from './NavigationContext';
import styles from './PqcCard.module.css';
import { usePqc } from '@popup/context/PqcContext';

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

  const COPY: Record<PqcCardState, { icon: React.ReactNode; title: string; desc: string; className: string }> = {
    enabled: {
      icon: <IconShield size={18} />,
      title: t('pqc.cardEnabledTitle'),
      desc: t('pqc.cardEnabledDesc'),
      className: styles.pqcCardOn,
    },
    stale: {
      icon: <IconWarning size={18} />,
      title: t('pqc.cardStaleTitle'),
      desc: t('pqc.cardStaleDesc'),
      className: styles.pqcCardWarn,
    },
    setup: {
      icon: <IconKey size={18} />,
      title: t('pqc.cardTitle'),
      desc: t('pqc.cardDesc'),
      className: '',
    },
    import: {
      icon: <IconKey size={18} />,
      title: t('pqc.cardImportTitle'),
      desc: t('pqc.cardImportDesc'),
      className: '',
    },
  };

  const { icon, title, desc, className } = COPY[state];

  return (
    <button className={`${styles.pqcCard} ${className}`.trim()} onClick={navigate.openPqc}>
      <div className={styles.pqcIcon}>{icon}</div>
      <div className={styles.pqcText}>
        <strong>{title}</strong>
        <span>{desc}</span>
      </div>
    </button>
  );
}
