import React, { useState, useEffect, useCallback, useMemo, ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import Card from '@components/Card/Card';
import Button from '@components/Button/Button';
import Input from '@components/Input/Input';
import QrCode from '@components/QrCode/QrCode';
import { SectionLabel, SectionHint } from '@components/SectionLabel/SectionLabel';
import { IconSettings, IconTuner } from '@assets/index';
import { decodeBolt11 } from '@lib/wallet/bolt11.ts';
import { formatSats } from '@shared/format/number.ts';
import type { Transaction } from '@lib/wallet/types.ts';

import styles from './Wallet.module.css';

interface WalletProps {
  providerType: string;
  onDisconnected: () => void;
}

const PROVIDER_LABELS: Record<string, string> = {
  nwc: 'Nostr Wallet Connect',
  lnbits: 'LNbits',
};

function formatTxDate(ts: number): string {
  if (!ts || ts <= 0) return '—';
  const d = new Date(ts * 1000);
  if (isNaN(d.getTime())) return '—';
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 0) return d.toLocaleDateString();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return t('time.justNow');
  if (diffMin < 60) return t('time.minutesAgo', { n: diffMin });
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t('time.hoursAgo', { n: diffHr });
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay <= 7) return t('time.daysAgo', { n: diffDay });
  // Older than a week: show short date
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export default function Wallet({ providerType, onDisconnected }: WalletProps) {
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState<boolean>(true);
  const [balanceError, setBalanceError] = useState<string>('');
  const [threshold, setThreshold] = useState<number>(0);
  const [thresholdDraft, setThresholdDraft] = useState<string>('0');
  const [disconnecting, setDisconnecting] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);

  // NWC URI
  const [nwcUri, setNwcUri] = useState<string | null>(null);
  const [nwcCopied, setNwcCopied] = useState<boolean>(false);

  // Deposit modal
  const [showDeposit, setShowDeposit] = useState<boolean>(false);
  const [depositAmount, setDepositAmount] = useState<string>('');
  const [depositLoading, setDepositLoading] = useState<boolean>(false);
  const [depositBolt11, setDepositBolt11] = useState<string>('');
  const [depositPaymentHash, setDepositPaymentHash] = useState<string>('');
  const [depositPaid, setDepositPaid] = useState<{ amount: number } | null>(null);
  const [depositError, setDepositError] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);

  // Send modal
  const [showSend, setShowSend] = useState<boolean>(false);
  const [sendBolt11, setSendBolt11] = useState<string>('');
  const [sendLoading, setSendLoading] = useState<boolean>(false);
  const [sendError, setSendError] = useState<string>('');
  const [sendSuccess, setSendSuccess] = useState<string>('');

  // Lightning Address
  const [lnAddress, setLnAddress] = useState<string | null>(null);
  const [usernameDraft, setUsernameDraft] = useState<string>('');
  const [claimLoading, setClaimLoading] = useState<boolean>(false);
  const [claimError, setClaimError] = useState<string>('');
  const [addressCopied, setAddressCopied] = useState<boolean>(false);
  const [showUpdateProfile, setShowUpdateProfile] = useState<boolean>(false);
  const [releaseLoading, setReleaseLoading] = useState<boolean>(false);

  // Transactions
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txLoading, setTxLoading] = useState<boolean>(true);
  const [txSearch, setTxSearch] = useState<string>('');
  const [txOffset, setTxOffset] = useState<number>(0);
  const [txHasMore, setTxHasMore] = useState<boolean>(true);
  const [txDirection, setTxDirection] = useState<'all' | 'in' | 'out'>('all');
  const [txDateFrom, setTxDateFrom] = useState<string>('');
  const [txDateTo, setTxDateTo] = useState<string>('');
  const [txFilterOpen, setTxFilterOpen] = useState<boolean>(false);
  const [draftDirection, setDraftDirection] = useState<'all' | 'in' | 'out'>('all');
  const [draftDateFrom, setDraftDateFrom] = useState<string>('');
  const [draftDateTo, setDraftDateTo] = useState<string>('');

  const fetchBalance = useCallback(async () => {
    setBalanceLoading(true);
    setBalanceError('');
    try {
      const result = await rpc<{ balance: number }>('wallet_getBalance');
      setBalance(result?.balance ?? 0);
    } catch (e: unknown) {
      setBalanceError((e as Error).message);
    }
    setBalanceLoading(false);
  }, []);

  const fetchThreshold = useCallback(async () => {
    try {
      const result = await rpc<number>('wallet_getAutoApproveThreshold');
      const val = typeof result === 'number' ? result : 0;
      setThreshold(val);
      setThresholdDraft(String(val));
    } catch {
      // ignore
    }
  }, []);

  const fetchNwcUri = useCallback(async () => {
    try {
      const uri = await rpc<string | null>('wallet_getNwcUri');
      setNwcUri(uri);
    } catch {
      // ignore — not all wallets have NWC
    }
  }, []);

  const fetchLnAddress = useCallback(async () => {
    try {
      const result = await rpc<{ address: string | null }>('wallet_getLightningAddress');
      setLnAddress(result?.address ?? null);
    } catch {
      // ignore
    }
  }, []);

  // Fetches raw pages from the API, accumulating until we have at least
  // `target` results that pass the given filters, or we exhaust the data.
  // For date-from filters, stops early once transactions are older than the boundary.
  const fetchFiltered = useCallback(async (
    startOffset: number,
    existing: Transaction[],
    filters: { direction: 'all' | 'in' | 'out'; dateFrom: string; dateTo: string },
    target = 10,
  ) => {
    setTxLoading(true);
    const BATCH = 50;
    const MAX_FETCHED = 500;
    const accumulated = [...existing];
    let offset = startOffset;
    let hasMore = true;
    const fromTs = filters.dateFrom ? new Date(filters.dateFrom).getTime() / 1000 : 0;
    const toTs = filters.dateTo ? new Date(filters.dateTo + 'T23:59:59').getTime() / 1000 : Infinity;

    try {
      while (hasMore && offset - startOffset < MAX_FETCHED) {
        const page = await rpc<Transaction[]>('wallet_getTransactions', { limit: BATCH, offset });
        if (page.length < BATCH) hasMore = false;
        offset += page.length;

        for (const tx of page) {
          // API returns newest-first; if we've passed the from-date, no more matches possible
          if (fromTs && tx.createdAt < fromTs) { hasMore = false; break; }
          accumulated.push(tx);
        }

        // Count how many match all filters so far
        const matchCount = accumulated.filter(tx => {
          if (filters.direction === 'in' && tx.amount < 0) return false;
          if (filters.direction === 'out' && tx.amount >= 0) return false;
          if (fromTs && tx.createdAt < fromTs) return false;
          if (toTs !== Infinity && tx.createdAt > toTs) return false;
          return true;
        }).length;

        if (matchCount >= target) break;
      }
    } catch { /* non-critical */ }

    setTransactions(accumulated);
    setTxOffset(offset);
    setTxHasMore(hasMore);
    setTxLoading(false);
  }, []);

  useEffect(() => {
    fetchBalance();
    fetchThreshold();
    fetchNwcUri();
    fetchLnAddress();
    fetchFiltered(0, [], { direction: 'all', dateFrom: '', dateTo: '' });
  }, [fetchBalance, fetchThreshold, fetchNwcUri, fetchLnAddress, fetchFiltered]);

  // Poll for invoice payment while the deposit modal is showing a bolt11.
  // Deps are intentionally minimal: we do not include depositPaid (setting it
  // would retrigger the effect and the cleanup would cancel our auto-close).
  useEffect(() => {
    if (!depositPaymentHash || !showDeposit) return;

    let cancelled = false;
    let detected = false;
    let autoCloseTimer: ReturnType<typeof setTimeout> | null = null;

    const interval = setInterval(async () => {
      if (detected) return;
      try {
        const res = await rpc<{ paid: boolean; amountPaid?: number }>(
          'wallet_checkInvoice',
          { paymentHash: depositPaymentHash },
        );
        if (cancelled || detected) return;
        if (res?.paid) {
          detected = true;
          clearInterval(interval);
          const fallback = parseInt(depositAmount, 10) || 0;
          setDepositPaid({ amount: res.amountPaid ?? fallback });
          fetchBalance();
          fetchFiltered(0, [], { direction: txDirection, dateFrom: txDateFrom, dateTo: txDateTo });
          autoCloseTimer = setTimeout(() => {
            if (!cancelled) closeDeposit();
          }, 2500);
        }
      } catch {
        // transient errors are ignored; polling continues
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      if (autoCloseTimer) clearTimeout(autoCloseTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depositPaymentHash, showDeposit]);

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await rpc('wallet_disconnect');
      onDisconnected();
    } catch {
      setDisconnecting(false);
    }
  };

  const handleThresholdBlur = async () => {
    const val = Math.max(0, parseInt(thresholdDraft, 10) || 0);
    setThresholdDraft(String(val));
    if (val !== threshold) {
      setThreshold(val);
      await rpc('wallet_setAutoApproveThreshold', { threshold: val });
    }
  };

  const handleDeposit = async () => {
    const amount = parseInt(depositAmount, 10);
    if (!amount || amount <= 0) return;
    setDepositLoading(true);
    setDepositError('');
    setDepositBolt11('');
    setDepositPaymentHash('');
    setDepositPaid(null);
    try {
      const result = await rpc<{ bolt11: string; paymentHash: string }>(
        'wallet_makeInvoice',
        { amount, memo: 'Deposit' },
      );
      setDepositBolt11(result.bolt11);
      setDepositPaymentHash(result.paymentHash);
    } catch (e: unknown) {
      setDepositError((e as Error).message);
    }
    setDepositLoading(false);
  };

  const handleSend = async () => {
    if (!sendBolt11.trim()) return;
    setSendLoading(true);
    setSendError('');
    setSendSuccess('');
    try {
      await rpc<{ preimage: string }>('wallet_payInvoice', { bolt11: sendBolt11.trim() });
      setSendSuccess(t('wallet.paymentSent'));
      fetchBalance();
      fetchFiltered(0, [], { direction: txDirection, dateFrom: txDateFrom, dateTo: txDateTo });
    } catch (e: unknown) {
      setSendError((e as Error).message);
    }
    setSendLoading(false);
  };

  const handleCopyNwc = async () => {
    if (!nwcUri) return;
    try {
      await navigator.clipboard.writeText(nwcUri);
      setNwcCopied(true);
      setTimeout(() => setNwcCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleCopyBolt11 = async () => {
    try {
      await navigator.clipboard.writeText(depositBolt11);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const closeDeposit = () => {
    setShowDeposit(false);
    setDepositBolt11('');
    setDepositAmount('');
    setDepositError('');
    setDepositPaymentHash('');
    setDepositPaid(null);
    fetchBalance();
    fetchFiltered(0, [], { direction: txDirection, dateFrom: txDateFrom, dateTo: txDateTo });
  };

  const closeSend = () => {
    setShowSend(false);
    setSendBolt11('');
    setSendError('');
    setSendSuccess('');
  };

  const handleClaimUsername = async () => {
    setClaimLoading(true);
    setClaimError('');
    try {
      const result = await rpc<{ address: string }>('wallet_claimLightningAddress', { username: usernameDraft.trim() });
      setLnAddress(result.address);
      setUsernameDraft('');
      setShowUpdateProfile(true);
    } catch (e: unknown) {
      setClaimError((e as Error).message);
    }
    setClaimLoading(false);
  };

  const handleCopyAddress = async () => {
    if (!lnAddress) return;
    try {
      await navigator.clipboard.writeText(lnAddress);
      setAddressCopied(true);
      setTimeout(() => setAddressCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleReleaseAddress = async () => {
    setReleaseLoading(true);
    setClaimError('');
    try {
      await rpc('wallet_releaseLightningAddress');
      setLnAddress(null);
    } catch (e: unknown) {
      setClaimError((e as Error).message);
    }
    setReleaseLoading(false);
  };

  const handleUpdateProfile = async () => {
    if (!lnAddress) return;
    try {
      const pubkey = await rpc<string>('vault_getActivePubkey');
      if (!pubkey) return;
      const existing = await rpc<Record<string, unknown> | null>('getProfileMetadata', { pubkey });
      const metadata = { ...(existing || {}), lud16: lnAddress };
      await rpc('signAndPublishEvent', {
        event: {
          kind: 0,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: JSON.stringify(metadata),
        },
      });
      await rpc('updateProfileCache', { pubkey, metadata });
    } catch {
      // ignore — profile update is best-effort
    }
    setShowUpdateProfile(false);
  };

  // Decode pasted invoice for preview
  const decodedInvoice = useMemo(() => {
    const trimmed = sendBolt11.trim();
    if (!trimmed) return null;
    return decodeBolt11(trimmed);
  }, [sendBolt11]);

  const handleShowMore = () => {
    fetchFiltered(txOffset, transactions, { direction: txDirection, dateFrom: txDateFrom, dateTo: txDateTo });
  };

  const txFilterCount = (txDirection !== 'all' ? 1 : 0) + (txDateFrom ? 1 : 0) + (txDateTo ? 1 : 0);

  const openFilterPopover = () => {
    setDraftDirection(txDirection);
    setDraftDateFrom(txDateFrom);
    setDraftDateTo(txDateTo);
    setTxFilterOpen(true);
  };

  const applyFilters = () => {
    setTxDirection(draftDirection);
    setTxDateFrom(draftDateFrom);
    setTxDateTo(draftDateTo);
    setTxFilterOpen(false);
    // Re-fetch: start from scratch with new filters
    fetchFiltered(0, [], { direction: draftDirection, dateFrom: draftDateFrom, dateTo: draftDateTo });
  };

  const clearFilters = () => {
    setDraftDirection('all');
    setDraftDateFrom('');
    setDraftDateTo('');
  };

  const filteredTx = useMemo(() => {
    let list = transactions;
    // All filtering is client-side on accumulated data
    if (txDirection === 'in') list = list.filter(tx => tx.amount >= 0);
    else if (txDirection === 'out') list = list.filter(tx => tx.amount < 0);
    if (txDateFrom) {
      const from = new Date(txDateFrom).getTime() / 1000;
      list = list.filter(tx => tx.createdAt >= from);
    }
    if (txDateTo) {
      const to = new Date(txDateTo + 'T23:59:59').getTime() / 1000;
      list = list.filter(tx => tx.createdAt <= to);
    }
    if (txSearch.trim()) {
      const q = txSearch.toLowerCase();
      list = list.filter(tx =>
        (tx.memo?.toLowerCase().includes(q)) ||
        String(Math.abs(tx.amount)).includes(q));
    }
    return list;
  }, [transactions, txDirection, txDateFrom, txDateTo, txSearch]);

  const providerLabel = PROVIDER_LABELS[providerType] ?? providerType;

  return (
    <div className={styles.section}>
      {/* Balance */}
      <Card className={styles.balanceCard}>
        <button className={styles.settingsBtn} onClick={() => setShowSettings(true)} title={t('wallet.settings')}>
          <IconSettings size={16} />
        </button>
        <span className={styles.balanceLabel}>{t('wallet.balance')}</span>
        {balanceLoading ? (
          <div className={styles.loading}>
            <div className={styles.spinner} />
          </div>
        ) : balanceError ? (
          <div className={styles.balanceErrorWrap}>
            <div className={styles.error}>{balanceError}</div>
            <Button small variant="secondary" onClick={fetchBalance}>
              {t('common.retry')}
            </Button>
          </div>
        ) : (
          <div>
            <span className={styles.balanceValue}>
              {Math.round(balance ?? 0).toLocaleString()}
            </span>
            <span className={styles.balanceUnit}>sats</span>
          </div>
        )}
      </Card>

      {/* Action buttons */}
      <div className={styles.actionRow}>
        <Button onClick={() => setShowDeposit(true)}>{t('wallet.deposit')}</Button>
        <Button variant="secondary" onClick={() => setShowSend(true)}>{t('wallet.send')}</Button>
      </div>

      {/* Deposit modal */}
      {showDeposit && createPortal(
        <div className={styles.qrOverlay} onClick={closeDeposit}>
          <div className={styles.qrModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.qrTitle}>{t('wallet.deposit')}</div>
            <div className={styles.overlayDesc}>{t('wallet.depositDesc')}</div>
            {depositPaid ? (
              <div className={styles.form} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '48px', color: 'var(--success)', lineHeight: 1 }}>
                  {'\u2713'}
                </div>
                <div className={styles.success} style={{ fontSize: '14px', fontWeight: 600 }}>
                  {t('wallet.paymentReceived')}
                </div>
                <div className={styles.success} style={{ fontSize: '16px' }}>
                  {`+${formatSats(depositPaid.amount)}`}
                </div>
              </div>
            ) : !depositBolt11 ? (
              <div className={styles.form}>
                <Input
                  type="number"
                  placeholder={t('wallet.amountSats')}
                  value={depositAmount}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setDepositAmount(e.target.value)}
                  small
                />
                {depositError && <div className={styles.error}>{depositError}</div>}
                <div className={styles.qrActions}>
                  <Button small variant="secondary" onClick={closeDeposit}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    small
                    onClick={handleDeposit}
                    disabled={depositLoading || !depositAmount || parseInt(depositAmount, 10) <= 0}
                  >
                    {depositLoading ? t('common.loading') : t('wallet.createInvoice')}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <QrCode value={depositBolt11} size={200} className={styles.qrCode} />
                <div className={styles.qrBolt11} onClick={handleCopyBolt11}>
                  {depositBolt11}
                </div>
                <div className={styles.qrActions}>
                  <Button small variant="secondary" onClick={handleCopyBolt11}>
                    {copied ? t('common.copied') : t('common.copy')}
                  </Button>
                  <Button small onClick={closeDeposit}>
                    {t('common.close')}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.getElementById('root') || document.body,
      )}

      {/* Send modal */}
      {showSend && createPortal(
        <div className={styles.qrOverlay} onClick={closeSend}>
          <div className={styles.qrModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.qrTitle}>{t('wallet.sendPayment')}</div>
            <div className={styles.overlayDesc}>{t('wallet.sendDesc')}</div>
            <div className={styles.form}>
              <Input
                type="text"
                placeholder={t('wallet.pasteInvoice')}
                value={sendBolt11}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setSendBolt11(e.target.value)}
                small
              />

              {/* Invoice preview */}
              {sendBolt11.trim() && !sendSuccess && (
                decodedInvoice ? (
                  <div className={styles.invoicePreview}>
                    <div className={styles.invoiceRow}>
                      <span className={styles.invoiceLabel}>{t('wallet.invoiceAmount')}</span>
                      <span className={`${styles.invoiceValue} ${styles.invoiceAmountValue}`}>
                        {decodedInvoice.amountSats !== null
                          ? `${Math.round(decodedInvoice.amountSats).toLocaleString()} sats`
                          : '—'}
                      </span>
                    </div>
                    <div className={styles.invoiceRow}>
                      <span className={styles.invoiceLabel}>{t('wallet.invoiceDescription')}</span>
                      <span className={styles.invoiceValue}>
                        {decodedInvoice.description || t('wallet.invoiceNone')}
                      </span>
                    </div>
                    <div className={styles.invoiceRow}>
                      <span className={styles.invoiceLabel}>{t('wallet.invoiceExpiry')}</span>
                      <span className={styles.invoiceValue}>
                        {(() => {
                          const expiresAt = (decodedInvoice.timestamp + decodedInvoice.expiry) * 1000;
                          const remaining = expiresAt - Date.now();
                          if (remaining <= 0) return t('wallet.invoiceExpired');
                          const mins = Math.ceil(remaining / 60000);
                          if (mins < 60) return t('wallet.invoiceMinutes', { n: mins });
                          return t('wallet.invoiceHours', { n: Math.round(mins / 60) });
                        })()}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className={styles.invoiceError}>{t('wallet.decodeFailed')}</div>
                )
              )}

              {sendError && <div className={styles.error}>{sendError}</div>}
              {sendSuccess && <div className={styles.success}>{sendSuccess}</div>}
              <div className={styles.qrActions}>
                <Button small variant="secondary" onClick={closeSend}>
                  {sendSuccess ? t('common.close') : t('common.cancel')}
                </Button>
                {!sendSuccess && (
                  <Button
                    small
                    onClick={handleSend}
                    disabled={sendLoading || !sendBolt11.trim() || (sendBolt11.trim() !== '' && !decodedInvoice)}
                  >
                    {sendLoading ? t('common.loading') : t('wallet.confirmPay')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.getElementById('root') || document.body,
      )}

      {/* Filter modal */}
      {txFilterOpen && createPortal(
        <div className={styles.txFilterOverlay} onClick={() => setTxFilterOpen(false)}>
          <div className={styles.txFilterModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.txFilterHeader}>
              <span className={styles.txFilterTitle}>{t('wallet.filtersTitle')}</span>
              <button className={styles.txFilterClose} onClick={() => setTxFilterOpen(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className={styles.txFilterSection}>
              <span className={styles.txFilterLabel}>{t('wallet.filterDirection')}</span>
              <div className={styles.txChips}>
                {(['all', 'in', 'out'] as const).map(dir => (
                  <button
                    key={dir}
                    className={`${styles.txChip} ${draftDirection === dir ? styles.txChipActive : ''}`}
                    onClick={() => setDraftDirection(dir)}
                  >
                    {dir === 'all' ? t('wallet.filterAll') : dir === 'in' ? t('wallet.txReceived') : t('wallet.txSent')}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.txFilterSection}>
              <span className={styles.txFilterLabel}>{t('wallet.filterDateRange')}</span>
              <div className={styles.txDateRow}>
                <input
                  type="date"
                  className={styles.txDateInput}
                  value={draftDateFrom}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setDraftDateFrom(e.target.value)}
                />
                <span className={styles.txDateSep}>—</span>
                <input
                  type="date"
                  className={styles.txDateInput}
                  value={draftDateTo}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setDraftDateTo(e.target.value)}
                />
              </div>
            </div>
            <div className={styles.txFilterActions}>
              <Button small variant="secondary" onClick={clearFilters}>{t('wallet.filterClear')}</Button>
              <Button small onClick={applyFilters}>{t('wallet.filterApply')}</Button>
            </div>
          </div>
        </div>,
        document.getElementById('root') || document.body,
      )}

      {/* Transactions */}
      <Card>
        <div className={styles.txToolbar}>
          <div className={styles.txSearchWrap}>
            <Input
              type="text"
              placeholder={t('wallet.searchTransactions')}
              value={txSearch}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setTxSearch(e.target.value)}
              small
            />
          </div>
          <button
            className={`${styles.txFilterBtn} ${txFilterCount > 0 ? styles.txFilterBtnActive : ''}`}
            onClick={openFilterPopover}
            title={t('wallet.filtersTitle')}
          >
            <IconTuner size={15} />
            {txFilterCount > 0 && <span className={styles.txFilterBadge}>{txFilterCount}</span>}
          </button>
        </div>
        {txLoading && filteredTx.length === 0 ? (
          <div className={styles.loading}>
            <div className={styles.spinner} />
          </div>
        ) : !txLoading && filteredTx.length === 0 ? (
          <div className={styles.txDate} style={{ textAlign: 'center', padding: '12px 0' }}>
            {t('wallet.noTransactions')}
          </div>
        ) : (
          <div className={styles.txList}>
            {filteredTx.map(tx => (
              <div key={tx.paymentHash} className={styles.txRow}>
                <span className={styles.txIcon}>
                  {tx.amount >= 0 ? '\u2193' : '\u2191'}
                </span>
                <div className={styles.txDetails}>
                  <div className={styles.txMemo}>
                    {(!tx.memo || /^lightning\s*(address|wallet)$/i.test(tx.memo))
                      ? (tx.amount >= 0 ? t('wallet.txReceived') : t('wallet.txSent'))
                      : tx.memo}
                  </div>
                  <button className={styles.txDateBtn} onClick={openFilterPopover}>{formatTxDate(tx.createdAt)}</button>
                </div>
                <span className={`${styles.txAmount} ${tx.amount >= 0 ? styles.txIncoming : styles.txOutgoing}`}>
                  {tx.amount >= 0 ? '+' : ''}{Math.round(tx.amount).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
        {txHasMore && !txLoading && !txSearch.trim() && filteredTx.length > 0 && (
          <div className={styles.showMore}>
            <Button small variant="secondary" onClick={handleShowMore} disabled={txLoading}>
              {txLoading ? t('common.loading') : t('wallet.showMore')}
            </Button>
          </div>
        )}
      </Card>

      {/* Settings overlay (full-page) */}
      {showSettings && (
        <div className={styles.settingsOverlay}>
          <div className={styles.settingsHeader}>
            <span className={styles.settingsTitle}>{t('wallet.settings')}</span>
            <Button small variant="secondary" onClick={() => setShowSettings(false)}>
              {t('common.close')}
            </Button>
          </div>

          {/* Connection card */}
          <Card className={styles.providerCard}>
            <div className={styles.providerRow}>
              <div className={styles.providerInfo}>
                <span className={styles.providerLabel}>{providerLabel}</span>
                <span className={styles.providerStatus}>{t('wallet.connected')}</span>
              </div>
              <Button small variant="danger" onClick={handleDisconnect} disabled={disconnecting}>
                {disconnecting ? t('common.loading') : t('common.disconnect')}
              </Button>
            </div>
            {nwcUri && (
              <div className={styles.nwcRow}>
                <span className={styles.nwcUri} title={nwcUri}>{t('wallet.nwcUri')}</span>
                <Button small variant="secondary" onClick={handleCopyNwc}>
                  {nwcCopied ? t('wallet.nwcCopied') : t('wallet.copyNwc')}
                </Button>
              </div>
            )}
          </Card>

          {/* Auto-approve card */}
          <Card>
            <SectionLabel>{t('wallet.autoApprove')}</SectionLabel>
            <SectionHint>{t('wallet.autoApproveHint')}</SectionHint>
            <div className={styles.thresholdRow}>
              <span className={styles.thresholdLabel}>{t('wallet.maxSats')}</span>
              <Input
                type="number"
                value={thresholdDraft}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setThresholdDraft(e.target.value)}
                onBlur={handleThresholdBlur}
                small
                className={styles.thresholdInput}
              />
            </div>
          </Card>

          {/* Lightning Address card (LNbits only) */}
          {providerType === 'lnbits' && (
            <Card>
              <SectionLabel>{t('wallet.lightningAddress')}</SectionLabel>
              <SectionHint>{t('wallet.lightningAddressHint')}</SectionHint>
              {lnAddress ? (
                <div className={styles.lnAddressRow}>
                  <span className={styles.lnAddressValue}>{lnAddress}</span>
                  <div className={styles.lnAddressActions}>
                    <Button small variant="secondary" onClick={handleCopyAddress}>
                      {addressCopied ? t('common.copied') : t('common.copy')}
                    </Button>
                    <Button small variant="secondary" onClick={() => setShowUpdateProfile(true)}>
                      {t('wallet.addToProfile')}
                    </Button>
                    <Button small variant="danger" onClick={handleReleaseAddress} disabled={releaseLoading}>
                      {releaseLoading ? t('common.loading') : t('wallet.releaseAddress')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className={styles.lnAddressClaimRow}>
                  <Input
                    type="text"
                    placeholder={t('wallet.usernamePlaceholder')}
                    value={usernameDraft}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setUsernameDraft(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
                    small
                  />
                  <span className={styles.lnAddressDomain}>@zaps.nostr-wot.com</span>
                  <Button small onClick={handleClaimUsername} disabled={claimLoading || !usernameDraft.trim()}>
                    {claimLoading ? t('common.loading') : t('wallet.claimUsername')}
                  </Button>
                </div>
              )}
              {claimError && <div className={styles.error}>{claimError}</div>}
            </Card>
          )}
        </div>
      )}

      {/* Update profile prompt */}
      {showUpdateProfile && lnAddress && createPortal(
        <div className={styles.qrOverlay} onClick={() => setShowUpdateProfile(false)}>
          <div className={styles.qrModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.qrTitle}>{t('wallet.updateProfileTitle')}</div>
            <div className={styles.overlayDesc}>
              {t('wallet.updateProfileDesc', { address: lnAddress })}
            </div>
            <div className={styles.qrActions}>
              <Button small variant="secondary" onClick={() => setShowUpdateProfile(false)}>
                {t('common.later')}
              </Button>
              <Button small onClick={handleUpdateProfile}>
                {t('wallet.updateProfile')}
              </Button>
            </div>
          </div>
        </div>,
        document.getElementById('root') || document.body,
      )}
    </div>
  );
}
