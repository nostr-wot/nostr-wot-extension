import React, { useState, useEffect, useCallback, useRef } from 'react';
import { rpc } from '@shared/rpc.ts';
import useRelayCache from '@shared/hooks/useRelayCache.ts';
import { PQC_PUBLISHED_CACHE } from '@shared/relayCacheNames.ts';
import {
  derivePqcCardState,
  type PqcStatus,
  type PqcPublished,
  type PqcCardState,
} from '@shared/pqcState.ts';
import { t } from '@lib/i18n.js';
import { IconKey, IconShield, IconWarning } from '@assets';
import { useNavigate } from './NavigationContext';
import styles from './PqcCard.module.css';

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
  const [state, setState] = useState<PqcCardState | null>(null);

  // Run-versioned rather than a per-call `cancelled` flag: this now re-runs
  // whenever the background refreshes the cache, so two passes can overlap and
  // the slower one must not win by finishing last (docs §9).
  const runRef = useRef(0);
  const load = useCallback(async () => {
    const run = ++runRef.current;
    const current = () => run === runRef.current;
    try {
      const status = await rpc<PqcStatus>('pqc_getStatus');
      if (!current() || !status) return;

      // Whether the feature is ON depends on the attestation being out there
      // and matching — asked of the relays, so it stays right when it was
      // published from another device. Only worth asking if keys exist.
      const published = status.canDerive
        ? await rpc<PqcPublished>('pqc_checkPublished').catch(() => null)
        : null;
      if (!current()) return;

      setState(derivePqcCardState(status, published));
    } catch {
      // Vault locked, or no active account. Nothing to report either way.
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  // The published check is served from the background's cache so this paints
  // without a relay round trip; this picks up the refreshed answer.
  useRelayCache(PQC_PUBLISHED_CACHE, load);

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
