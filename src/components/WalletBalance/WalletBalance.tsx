import Spinner from '@components/Spinner/Spinner';
import { t } from '@lib/i18n.js';

/** The last known balance stays visible through refreshes and failures. */
export default function WalletBalance({balance, loading, error, compact = false}: {
  balance: number | null; loading: boolean; error: boolean; compact?: boolean;
}) {
  return <div>
    <div className="flex items-center gap-3" aria-busy={loading}>
      <strong className={`${compact ? 'text-xl' : 'text-[32px]'} font-semibold tabular-nums text-heading`}>
        {balance === null ? '—' : Math.round(balance).toLocaleString()}
      </strong>
      <span className="text-sm text-menu-subtitle">sats</span>
      {loading && <span aria-label={t('common.loading')}><Spinner size={14}/></span>}
    </div>
    {error && balance !== null && <span className="text-xs text-menu-subtitle">{t('wallet.lastKnownBalance')}</span>}
  </div>;
}
