import { DEFAULT_LNBITS_URL } from '@constants/wallet.ts';
import { useState, ChangeEvent } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import Card from '@components/Card';
import Input from '@components/Input';
import Button from '@components/Button';
import LinkButton from '@components/LinkButton';
import { SectionLabel, SectionHint } from '@components/SectionLabel';

import Tabs from '@components/Tabs';
import FormError from '@components/FormError';
import Container from '@components/Container';
import WalletConnectionHelp from './WalletConnectionHelp';
import IconButton from '@components/IconButton';
import IconInfo from '@assets/IconInfo.tsx';

interface WalletSetupProps {
  onConnected: () => void;
}

type ProviderTab = 'quick' | 'nwc' | 'lnbits';

export default function WalletSetup({ onConnected }: WalletSetupProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [tab, setTab] = useState<ProviderTab>('quick');
  const [nwcString, setNwcString] = useState<string>('');
  const [lnbitsUrl, setLnbitsUrl] = useState<string>('');
  const [lnbitsKey, setLnbitsKey] = useState<string>('');
  const [provisionUrl, setProvisionUrl] = useState<string>('');
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const handleConnect = async () => {
    setError('');
    setLoading(true);
    try {
      if (tab === 'quick') {
        await rpc('wallet_provision', {
          instanceUrl: provisionUrl.trim() || undefined,
        });
      } else if (tab === 'nwc') {
        const trimmed = nwcString.trim();
        if (!trimmed.startsWith('nostr+walletconnect://')) {
          setError(t('wallet.invalidNwc'));
          setLoading(false);
          return;
        }
        await rpc('wallet_connect', {
          walletConfig: { type: 'nwc', connectionString: trimmed },
        });
      } else {
        const url = lnbitsUrl.trim();
        const key = lnbitsKey.trim();
        if (!url || !key) {
          setError(t('wallet.fillAllFields'));
          setLoading(false);
          return;
        }
        await rpc('wallet_connect', {
          walletConfig: { type: 'lnbits', instanceUrl: url, adminKey: key },
        });
      }
      onConnected();
    } catch (e: unknown) {
      setError((e as Error).message || t('common.error'));
    }
    setLoading(false);
  };

  const nwcReady = nwcString.trim().length > 0;
  const lnbitsReady = lnbitsUrl.trim().length > 0 && lnbitsKey.trim().length > 0;
  const canConnect =
    tab === 'quick' ? true :
    tab === 'nwc' ? nwcReady :
    lnbitsReady;

  return (
    <>
    <WalletConnectionHelp open={helpOpen} onOpenChange={setHelpOpen} />
    <Container gap={7} className="flex-1 min-h-0 overflow-y-auto py-2">
      <Card className="m-0 p-8 flex flex-col gap-8">
        <Container gap={3}>
          <Container variant="row" className="justify-between">
            <SectionLabel className="m-0">{t('wallet.connectWallet')}</SectionLabel>
            <IconButton tone="brand" title={t('wallet.connectionHelpTitle')} aria-label={t('wallet.connectionHelpTitle')} onClick={() => setHelpOpen(true)}><IconInfo size={16} /></IconButton>
          </Container>
          <SectionHint className="m-0">{t('wallet.connectHint')}</SectionHint>
        </Container>

        <Tabs
          label={t('wallet.connectWallet')}
          options={[
            { value: 'quick', label: t('wallet.quickSetup') },
            { value: 'nwc', label: 'NWC' },
            { value: 'lnbits', label: 'LNbits' },
          ]}
          value={tab}
          onChange={(next) => { setTab(next); setError(''); }}
        />

        <Container gap={6}>
          {tab === 'quick' ? (
            <>
              <SectionHint>{t('wallet.quickSetupHint')}</SectionHint>
              <LinkButton
                className="py-2 px-0 hover:text-secondary"
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                {t('wallet.advancedSettings')} {showAdvanced ? '\u25B2' : '\u25BC'}
              </LinkButton>
              {showAdvanced && (
                <Input
                  type="text"
                  placeholder={DEFAULT_LNBITS_URL}
                  value={provisionUrl}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => { setProvisionUrl(e.target.value); setError(''); }}
                  label={t('wallet.lnbitsUrl')}
                />
              )}
            </>
          ) : tab === 'nwc' ? (
            <>
              <SectionHint>{t('wallet.nwcSetupHint')}</SectionHint>
              <Input
                type="text"
                mono
                label={t('wallet.nwcUri')}
                placeholder="nostr+walletconnect://..."
                value={nwcString}
                onChange={(e: ChangeEvent<HTMLInputElement>) => { setNwcString(e.target.value); setError(''); }}
              />
            </>
          ) : (
            <>
              <SectionHint className="m-0">{t('wallet.lnbitsConnectionHint')}</SectionHint>
              <Input
                type="text"
                placeholder="https://lnbits.example.com"
                value={lnbitsUrl}
                onChange={(e: ChangeEvent<HTMLInputElement>) => { setLnbitsUrl(e.target.value); setError(''); }}
                label={t('wallet.instanceUrl')}
              />
              <Input
                type="password"
                showToggle
                placeholder={t('wallet.adminKey')}
                value={lnbitsKey}
                onChange={(e: ChangeEvent<HTMLInputElement>) => { setLnbitsKey(e.target.value); setError(''); }}
                label={t('wallet.adminKey')}
                aria-describedby="lnbits-admin-key-hint"
              />
              <div id="lnbits-admin-key-hint"><SectionHint className="m-0">{t('wallet.lnbitsAdminKeyHint')}</SectionHint></div>
            </>
          )}

          <FormError>{error}</FormError>

          <Container variant="row" gap={4} className="justify-end">
            <Button small onClick={handleConnect} disabled={loading || !canConnect}>
              {loading ? t('common.loading') : tab === 'quick' ? t('wallet.createWallet') : t('common.connect')}
            </Button>
          </Container>
        </Container>
      </Card>
    </Container>
    </>
  );
}
