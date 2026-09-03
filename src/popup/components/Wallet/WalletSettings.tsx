import React, { useState, useEffect, useCallback, ChangeEvent } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import Card from '@components/Card/Card';
import Button from '@components/Button/Button';
import Input from '@components/Input/Input';
import OverlayPanel from '@components/OverlayPanel/OverlayPanel';
import ConfirmDialog from '@components/ConfirmDialog/ConfirmDialog';
import { SectionLabel, SectionHint } from '@components/SectionLabel/SectionLabel';
import useCopy from '@shared/hooks/useCopy.ts';
import styles from './Wallet.module.css';

const PROVIDER_LABELS: Record<string, string> = {
  nwc: 'Nostr Wallet Connect',
  lnbits: 'LNbits',
};

interface WalletSettingsProps {
  providerType: string;
  onClose: () => void;
  onDisconnected: () => void;
}

/**
 * Wallet settings: connection, auto-approve threshold, Lightning Address.
 *
 * Everything here is reachable only from the settings button, so all of its
 * state and all four of its RPCs live here rather than in Wallet — which was
 * fetching the NWC URI, the threshold and the Lightning Address on mount for a
 * panel most sessions never open.
 *
 * It is an OverlayPanel, not a hand-rolled fixed sheet. The old version painted
 * itself over the whole viewport from inside a menu section, which is the shape
 * that made the containing-block bug matter in the first place.
 */
export default function WalletSettings({ providerType, onClose, onDisconnected }: WalletSettingsProps) {
  const [threshold, setThreshold] = useState<number>(0);
  const [thresholdDraft, setThresholdDraft] = useState<string>('0');
  const [disconnecting, setDisconnecting] = useState<boolean>(false);
  const [nwcUri, setNwcUri] = useState<string | null>(null);
  const nwcCopy = useCopy();

  const [lnAddress, setLnAddress] = useState<string | null>(null);
  const [usernameDraft, setUsernameDraft] = useState<string>('');
  const [claimLoading, setClaimLoading] = useState<boolean>(false);
  const [claimError, setClaimError] = useState<string>('');
  const addressCopy = useCopy();
  const [showUpdateProfile, setShowUpdateProfile] = useState<boolean>(false);
  const [profileError, setProfileError] = useState<string>('');
  const [profileLoading, setProfileLoading] = useState<boolean>(false);
  const [releaseLoading, setReleaseLoading] = useState<boolean>(false);
  const [confirmRelease, setConfirmRelease] = useState<boolean>(false);

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
      setNwcUri(await rpc<string | null>('wallet_getNwcUri'));
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

  useEffect(() => {
    fetchThreshold();
    fetchNwcUri();
    fetchLnAddress();
  }, [fetchThreshold, fetchNwcUri, fetchLnAddress]);

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

  // Releasing is irreversible and outward-facing: the username goes back in the
  // pool for someone else to claim, and any kind:0 already advertising it keeps
  // advertising it — so zaps aimed at the user start arriving for whoever claims
  // it next. That was one click on a danger button with no confirmation.
  const handleReleaseAddress = async () => {
    setReleaseLoading(true);
    setClaimError('');
    try {
      await rpc('wallet_releaseLightningAddress');
      setLnAddress(null);
      setConfirmRelease(false);
    } catch (e: unknown) {
      setClaimError((e as Error).message);
    }
    setReleaseLoading(false);
  };

  /**
   * Add the Lightning Address to the user's kind:0.
   *
   * kind:0 is replaceable, so what gets published here replaces the profile
   * outright. That makes the read beforehand load-bearing rather than a nicety:
   * merging `lud16` into the result of a *failed* read publishes a document
   * containing only `lud16`, and the user's name, picture, about and nip05 are
   * gone — silently, and worst on exactly the flaky-relay day that caused it.
   *
   * `getProfileForMerge` says whether anyone actually answered, which is the
   * distinction `getProfileMetadata`'s null cannot make. No answer, no publish.
   */
  const handleUpdateProfile = async () => {
    if (!lnAddress) return;
    setProfileError('');
    setProfileLoading(true);
    try {
      const pubkey = await rpc<string>('vault_getActivePubkey');
      if (!pubkey) throw new Error('no active account');

      const read = await rpc<{ metadata: Record<string, unknown> | null; reachable: boolean }>(
        'getProfileForMerge', { pubkey },
      );
      if (!read?.reachable) {
        setProfileError(t('wallet.profileReadFailed'));
        setProfileLoading(false);
        return;
      }

      const metadata = { ...(read.metadata || {}), lud16: lnAddress };
      await rpc('signAndPublishEvent', {
        event: {
          kind: 0,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: JSON.stringify(metadata),
        },
      });
      await rpc('updateProfileCache', { pubkey, metadata });
      setShowUpdateProfile(false);
    } catch (e: unknown) {
      // Not best-effort any more: closing the dialog on a failure told the user
      // their profile had been updated when it had not.
      setProfileError((e as Error)?.message || t('wallet.profileReadFailed'));
    }
    setProfileLoading(false);
  };

  const providerLabel = PROVIDER_LABELS[providerType] ?? providerType;

  return (
    <>
      <OverlayPanel title={t('wallet.settings')} onClose={onClose} zIndex={500}>
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
              <Button small variant="secondary" onClick={() => nwcUri && nwcCopy.copy(nwcUri)}>
                {nwcCopy.copied ? t('wallet.nwcCopied') : t('wallet.copyNwc')}
              </Button>
            </div>
          )}
        </Card>

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

        {providerType === 'lnbits' && (
          <Card>
            <SectionLabel>{t('wallet.lightningAddress')}</SectionLabel>
            <SectionHint>{t('wallet.lightningAddressHint')}</SectionHint>
            {lnAddress ? (
              <div className={styles.lnAddressRow}>
                <span className={styles.lnAddressValue}>{lnAddress}</span>
                <div className={styles.lnAddressActions}>
                  <Button small variant="secondary" onClick={() => lnAddress && addressCopy.copy(lnAddress)}>
                    {addressCopy.copied ? t('common.copied') : t('common.copy')}
                  </Button>
                  <Button small variant="secondary" onClick={() => setShowUpdateProfile(true)}>
                    {t('wallet.addToProfile')}
                  </Button>
                  <Button small variant="danger" onClick={() => setConfirmRelease(true)} disabled={releaseLoading}>
                    {t('wallet.releaseAddress')}
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
      </OverlayPanel>

      {confirmRelease && lnAddress && (
        <ConfirmDialog
          title={t('wallet.releaseAddress')}
          message={t('wallet.releaseWarning', { address: lnAddress })}
          confirmLabel={t('wallet.releaseAddress')}
          danger
          busy={releaseLoading}
          error={claimError}
          onConfirm={handleReleaseAddress}
          onCancel={() => setConfirmRelease(false)}
        />
      )}

      {/* Publishing a kind:0 is outward-facing, so this keeps ConfirmDialog's
          no-dismiss-on-backdrop rule: a stray click is not an answer. */}
      {showUpdateProfile && lnAddress && (
        <ConfirmDialog
          title={t('wallet.updateProfileTitle')}
          message={t('wallet.updateProfileDesc', { address: lnAddress })}
          confirmLabel={t('wallet.updateProfile')}
          cancelLabel={t('common.later')}
          busy={profileLoading}
          error={profileError}
          onConfirm={handleUpdateProfile}
          onCancel={() => setShowUpdateProfile(false)}
        />
      )}
    </>
  );
}
