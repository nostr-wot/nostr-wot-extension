import { useState, useEffect } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import { IconKey, IconWarning, IconCopy } from '@assets';
import Button from '@components/Button/Button';
import styles from './SecuritySection.module.css';

type BlockReason = 'read-only' | 'remote-signer' | 'no-seed' | 'short-seed';

interface PqcStatus {
  canDerive: boolean;
  reason: BlockReason | null;
  wordCount: number | null;
  pubkey: string | null;
  keys: { kem: string; dsa: string } | null;
  attestation: { kind: number; created_at: number; tags: string[][]; content: string } | null;
}

export default function PqcSection() {
  const [status, setStatus] = useState<PqcStatus | null>(null);
  const [error, setError] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [revealed, setRevealed] = useState<boolean>(false);

  useEffect(() => {
    (async () => {
      try {
        setStatus(await rpc<PqcStatus>('pqc_getStatus'));
      } catch (e: any) {
        setError(e?.message || t('common.error'));
      }
    })();
  }, []);

  const handleCopy = async () => {
    if (!status?.attestation) return;
    await navigator.clipboard.writeText(JSON.stringify(status.attestation));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (error) return <div className={styles.error}>{error}</div>;
  if (!status) return <p className={styles.desc}>{t('common.loading')}</p>;

  // Cannot derive — explain why, and what the account can still do.
  if (!status.canDerive) {
    const reason = status.reason as BlockReason;
    return (
      <div className={styles.pqcBlocked}>
        <div className={styles.pqcNotice}>
          <IconWarning size={18} />
          <div>
            <strong>{t('pqc.unavailableTitle')}</strong>
            <p>
              {reason === 'short-seed'
                ? t('pqc.reasonShortSeed', { count: status.wordCount ?? 12 })
                : t(`pqc.reason.${reason}`)}
            </p>
          </div>
        </div>
        {reason !== 'read-only' && (
          <p className={styles.desc}>{t('pqc.independentHint')}</p>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className={styles.pqcNoticeOk}>
        <IconKey size={18} />
        <div>
          <strong>{t('pqc.readyTitle')}</strong>
          <p>{t('pqc.readyDesc')}</p>
        </div>
      </div>

      {!revealed ? (
        <Button onClick={() => setRevealed(true)}>{t('pqc.showKeys')}</Button>
      ) : (
        <>
          <div className={styles.pqcKeyRow}>
            <span>ml-kem-1024</span>
            <code>{status.keys!.kem.slice(0, 32)}…</code>
          </div>
          <div className={styles.pqcKeyRow}>
            <span>ml-dsa-87</span>
            <code>{status.keys!.dsa.slice(0, 32)}…</code>
          </div>

          <p className={styles.desc}>{t('pqc.publishDesc')}</p>
          <Button onClick={handleCopy}>
            <IconCopy size={14} />
            {copied ? t('common.copied') : t('pqc.copyAttestation')}
          </Button>
        </>
      )}

      <p className={styles.pqcLimits}>{t('pqc.limits')}</p>
    </div>
  );
}
