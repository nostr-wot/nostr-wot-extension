import React from 'react';
import { t } from '@lib/i18n.js';
import { formatLabel } from '@shared/permissions.js';
import { IconChevronRight, IconSync } from '@assets';
import styles from './ApprovalOverlay.module.css';

interface ApprovalRequest {
  permKey?: string;
  event?: any;
  [key: string]: any;
}

// A second, shadow copy of ApprovalOverlay's ApprovalGroup. It had drifted:
// the overlay passes `permKey` on every group it renders, and this type did not
// admit it, so the call site has been a type error. The card does not read the
// field — it is optional here to describe what it is actually handed.
interface ApprovalGroup {
  origin: string;
  method: string;
  permKey?: string;
  nip46InFlight?: boolean;
  requests: ApprovalRequest[];
}

interface ApprovalCardProps {
  group: ApprovalGroup;
  onClick: () => void;
  onCancel?: () => void;
}

export default function ApprovalCard({ group, onClick, onCancel }: ApprovalCardProps) {
  const domain = group.origin;
  const firstReq = group.requests[0];
  const label = formatLabel(firstReq?.permKey || group.method, firstReq?.event);
  const isNip46 = group.nip46InFlight;

  return (
    <button
      className={`${styles.card} ${isNip46 ? styles.cardNip46 : ''}`}
      onClick={onClick}
    >
      <div className={styles.cardLeft}>
        <div className={styles.cardOrigin}>{domain}</div>
        <div className={styles.cardMethod}>
          {isNip46 && <IconSync size={12} className={styles.spinnerIcon} />}
          {isNip46 ? t('approval.awaitingSigner') : label}
        </div>
        {!isNip46 && group.requests.length > 1 && (
          <div className={styles.cardCount}>{t('approval.requests', { count: group.requests.length })}</div>
        )}
      </div>
      {isNip46 && onCancel ? (
        <button
          className={styles.cancelBtn}
          onClick={(e) => { e.stopPropagation(); onCancel(); }}
          title={t('approval.cancelNip46')}
        >
          &times;
        </button>
      ) : !isNip46 ? <IconChevronRight size={16} className={styles.cardChevron} /> : null}
    </button>
  );
}
