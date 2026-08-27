import { useState, useEffect } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import { IconKey, IconShield, IconWarning } from '@assets';
import styles from './HomeTab.module.css';

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

interface PqcStatus {
  canDerive: boolean;
  canImport: boolean;
  source: 'derived' | 'imported' | null;
  reason: string | null;
}

interface Published {
  published: boolean;
  current: boolean;
}

type CardState = 'enabled' | 'stale' | 'setup' | 'import';

interface PqcCardProps {
  onOpen: () => void;
}

export default function PqcCard({ onOpen }: PqcCardProps) {
  const [state, setState] = useState<CardState | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await rpc<PqcStatus>('pqc_getStatus');
        if (cancelled || !status) return;

        if (!status.canDerive) {
          // Nothing to derive. Offer the import path only where imported keys could
          // actually be used; otherwise say nothing rather than advertise a dead end.
          setState(status.canImport ? 'import' : null);
          return;
        }

        // Keys exist. Whether the feature is ON depends on the attestation being out
        // there and matching — but that is a relay round trip, and this card renders on
        // every popup open. Asking the network here made the popup take tens of seconds
        // to become usable. Read the last answer instead; the post-quantum panel refreshes
        // it whenever the user opens it, which is also when it can act on it.
        const pub = await rpc<Published | null>('pqc_getPublishedCached').catch(() => null);
        if (cancelled) return;
        // No answer yet: invite rather than assert. Claiming "on" without evidence would
        // be the one wrong thing to say here.
        if (!pub?.published) setState('setup');
        else setState(pub.current ? 'enabled' : 'stale');
      } catch {
        // Vault locked, or no active account. Nothing to report either way.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!state) return null;

  const COPY: Record<CardState, { icon: React.ReactNode; title: string; desc: string; className: string }> = {
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
    <button className={`${styles.pqcCard} ${className}`.trim()} onClick={onOpen}>
      <div className={styles.pqcIcon}>{icon}</div>
      <div className={styles.pqcText}>
        <strong>{title}</strong>
        <span>{desc}</span>
      </div>
    </button>
  );
}
