import { PROVIDER_LABELS } from '@constants/wallet.ts';
import { useState, useEffect, ChangeEvent } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import Card from '@components/Card';
import Button, { ButtonDanger } from '@components/Button';
import Input from '@components/Input';
import OverlayPanel from '@components/OverlayPanel';
import ConfirmDialog from '@components/ConfirmDialog';
import { SectionLabel, SectionHint } from '@components/SectionLabel';
import CopyButton from '@components/CopyButton';
import FormError from '@components/FormError';
import Container from '@components/Container';
import Text from '@components/Text';
import Spinner from '@components/Spinner';
import IconButton from '@components/IconButton';
import IconSync from '@assets/IconSync.tsx';
import { useWallet } from '@context/WalletContext';
import { useAccount } from '@context/AccountContext';
import ProfileAddressButton from './ProfileAddressButton';
import WalletConnectionHelp from './WalletConnectionHelp';

interface WalletSettingsProps {
  providerType: string;
  onClose: () => void;
  onDisconnected: () => void;
}

/** Settings read through the shared account context; only editable drafts stay local. */
export default function WalletSettings({ providerType, onClose, onDisconnected }: WalletSettingsProps) {
  const { active, cachedProfile } = useAccount();
  const {settings,settingsLoading,settingsError,ensureSettings,refreshSettings,patchSettings} = useWallet();
  const {threshold,nwcUri,address:lnAddress} = settings;
  const [thresholdDraft, setThresholdDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [settingsSaveError, setSettingsSaveError] = useState('');
  useEffect(() => { ensureSettings(); }, [ensureSettings]);
  useEffect(() => { if (threshold !== undefined) setThresholdDraft(String(threshold)); }, [threshold]);
  const [disconnecting, setDisconnecting] = useState<boolean>(false);

  const [usernameDraft, setUsernameDraft] = useState<string>('');
  const [claimLoading, setClaimLoading] = useState<boolean>(false);
  const [claimError, setClaimError] = useState<string>('');
  const [showUpdateProfile, setShowUpdateProfile] = useState<boolean>(false);
  const [profileError, setProfileError] = useState<string>('');
  const [profileLoading, setProfileLoading] = useState<boolean>(false);
  const [releaseLoading, setReleaseLoading] = useState<boolean>(false);
  const [confirmRelease, setConfirmRelease] = useState<boolean>(false);

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await rpc('wallet_disconnect');
      onDisconnected();
    } catch (error) {
      setSettingsSaveError((error as Error).message);
      setDisconnecting(false);
    }
  };

  const thresholdValue = Number(thresholdDraft);
  const thresholdValid = thresholdDraft.trim() !== '' && Number.isSafeInteger(thresholdValue) && thresholdValue >= 0;
  const handleThresholdSave = async () => {
    if (!thresholdValid || threshold === undefined || saving) return;
    setSaving(true); setSettingsSaveError('');
    try {
      await rpc('wallet_setAutoApproveThreshold', {threshold:thresholdValue});
      patchSettings({threshold:thresholdValue});
    } catch (error) { setSettingsSaveError((error as Error).message); }
    finally { setSaving(false); }
  };

  const handleClaimUsername = async () => {
    setClaimLoading(true);
    setClaimError('');
    try {
      const result = await rpc<{ address: string }>('wallet_claimLightningAddress', { username: usernameDraft.trim() });
      patchSettings({address:result.address});
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
      patchSettings({address:null});
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
      <OverlayPanel title={t('wallet.settings')} onClose={onClose} zIndex={500} headerRight={
        <IconButton tone="brand" disabled={settingsLoading} onClick={refreshSettings} title={t('wallet.refreshSettingsHint')} aria-label={t('wallet.refreshSettingsHint')}>
          {settingsLoading ? <Spinner size={14}/> : <IconSync size={16}/>}
        </IconButton>
      }>
        <div className="flex-1 min-h-0 overflow-y-auto">
        <Container gap={7} className="py-2">
        <WalletConnectionHelp />
        {settingsError && <FormError>{t('wallet.checkFailed')}</FormError>}
        <FormError>{settingsSaveError}</FormError>
        <Card className="m-0 p-8 flex flex-col gap-6">
          <Text as="p" className="text-md font-semibold text-heading">
            {t('wallet.connectedTo', { provider: providerType === 'lnbits' ? 'Nostr WoT LNBits' : providerLabel })}
          </Text>
          {nwcUri && (
            <Container variant="row" gap={4} className="justify-between">
              <span className="font-mono text-2xs text-muted overflow-hidden text-ellipsis whitespace-nowrap flex-1" >{t('wallet.nwcUri')}</span>
              <CopyButton iconOnly value={nwcUri} label={t('wallet.copyNwc')} />
            </Container>
          )}
          <Container gap={4} className="mt-auto border-t border-card-border pt-5">
            <SectionHint className="m-0 text-menu-subtitle">{t('wallet.disconnectHint')}</SectionHint>
            <ButtonDanger small onClick={handleDisconnect} disabled={disconnecting}>
              {disconnecting ? t('common.loading') : t('common.disconnect')}
            </ButtonDanger>
          </Container>
        </Card>

        <Card className="m-0 p-8 flex flex-col gap-6">
          <Container gap={3}><SectionLabel className="m-0 text-heading">{t('wallet.autoApprove')}</SectionLabel>
          <SectionHint className="m-0 text-menu-subtitle">{t('wallet.autoApproveHint')}</SectionHint></Container>
          <Container variant="row" gap={4} className="justify-between">
            <Text variant="body" as="span" className="text-sm shrink-0">{t('wallet.maxSats')}</Text>
            <Input
              type="number"
              value={thresholdDraft}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setThresholdDraft(e.target.value)}
              min={0} step={1} disabled={threshold === undefined || saving}
              small
              className="text-right"
              aria-label={t('wallet.maxSats')}
            />
          </Container>
          <Button small disabled={!thresholdValid || threshold === undefined || thresholdValue === threshold || saving} onClick={handleThresholdSave}>{saving ? t('common.loading') : t('common.save')}</Button>
        </Card>

        {providerType === 'lnbits' && (
          <Card className="m-0 p-8 flex flex-col gap-6">
            <Container gap={3}><SectionLabel className="m-0 text-heading">{t('wallet.lightningAddress')}</SectionLabel>
            <SectionHint className="m-0 text-menu-subtitle">{t('wallet.lightningAddressHint')}</SectionHint></Container>
            {lnAddress === undefined ? (<div className="text-sm text-menu-subtitle">{settingsLoading ? t('common.loading') : t('wallet.checkFailed')}</div>) : lnAddress ? (
              <Container gap={4} className="py-4">
                <Container variant="row" gap={3} className="justify-between">
                  <span className="text-md font-semibold text-heading break-all min-w-0">{lnAddress}</span>
                  <CopyButton iconOnly value={lnAddress} label={t('common.copy')} />
                </Container>
                <Container gap={3}>
                  {active && <ProfileAddressButton key={active.pubkey} pubkey={active.pubkey}
                    address={lnAddress} cachedAddress={cachedProfile?.lud16}
                    onAdd={() => setShowUpdateProfile(true)} />}
                  <ButtonDanger small onClick={() => setConfirmRelease(true)} disabled={releaseLoading}>
                    {t('wallet.releaseAddress')}
                  </ButtonDanger>
                </Container>
              </Container>
            ) : (
              <Container gap={4} className="py-2">
                <Input
                  type="text"
                  placeholder={t('wallet.usernamePlaceholder')}
                  value={usernameDraft}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setUsernameDraft(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
                  small
                />
                <span className="text-md text-muted whitespace-nowrap">@zaps.nostr-wot.com</span>
                <Button small onClick={handleClaimUsername} disabled={claimLoading || !usernameDraft.trim()}>
                  {claimLoading ? t('common.loading') : t('wallet.claimUsername')}
                </Button>
              </Container>
            )}
            <FormError>{claimError}</FormError>
          </Card>
        )}

        </Container>
        </div>
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
