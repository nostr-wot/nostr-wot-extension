import { useState, useEffect } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import { IconKey } from '@assets';
import styles from './HomeTab.module.css';

/**
 * Offers post-quantum keys on the dashboard when the account can hold them.
 *
 * Buried in Menu → Security, this feature was effectively invisible. Surfacing it here
 * is the difference between a capability that exists and one people use.
 *
 * The card only appears when the account can actually derive — a 24-word seed. For
 * everything else (12-word, nsec import, remote signer) it renders nothing rather than
 * advertising something the user cannot act on.
 */

interface PqcStatus {
  canDerive: boolean;
  reason: string | null;
}

interface PqcCardProps {
  onOpen: () => void;
}

export default function PqcCard({ onOpen }: PqcCardProps) {
  const [status, setStatus] = useState<PqcStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await rpc<PqcStatus>('pqc_getStatus');
        if (!cancelled) setStatus(s);
      } catch {
        // Vault locked, or no active account. Nothing to offer either way.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!status?.canDerive) return null;

  return (
    <button className={styles.pqcCard} onClick={onOpen}>
      <div className={styles.pqcIcon}>
        <IconKey size={18} />
      </div>
      <div className={styles.pqcText}>
        <strong>{t('pqc.cardTitle')}</strong>
        <span>{t('pqc.cardDesc')}</span>
      </div>
    </button>
  );
}
