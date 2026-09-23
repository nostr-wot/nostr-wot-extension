import { useEffect, useState } from 'react';
import browser from '@lib/browser.ts';
import { WALLET_HELP_DISMISSED_KEY } from '@constants/wallet.ts';
import { DEFAULT_LANG, SUPPORTED_LANGUAGES } from '@constants/i18n.ts';
import { getLanguage, t } from '@services/i18n/i18n.ts';
import useAsyncResource from '@hooks/useAsyncResource.ts';
import Modal from '@components/Modal';
import Button from '@components/Button';
import LinkButton from '@components/LinkButton';
import Toggle from '@components/Toggle';
import Container from '@components/Container';
import Text from '@components/Text';
import FormError from '@components/FormError';

/** First-visit explanation, also reachable from setup and settings info controls. */
export default function WalletConnectionHelp({ open, onOpenChange }: {
  open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const preference = useAsyncResource({ hidden: false }, { load: async (patch, isCurrent) => {
    const stored = await browser.storage.local.get(WALLET_HELP_DISMISSED_KEY);
    if (isCurrent()) patch({ hidden: stored[WALLET_HELP_DISMISSED_KEY] === true });
  } });
  const [closed, setClosed] = useState(false);
  const [dontShow, setDontShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [guideOpened, setGuideOpened] = useState(false);
  useEffect(() => { setDontShow(preference.data.hidden); }, [preference.data.hidden]);

  async function close() {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await browser.storage.local.set({ [WALLET_HELP_DISMISSED_KEY]: dontShow });
      setClosed(true);
      onOpenChange(false);
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  async function openGuide(guide: 'alby-hub-nwc' | 'lnbits-wallet-setup', anchor?: string) {
    setError('');
    setGuideOpened(false);
    try {
      const language = getLanguage();
      const prefix = language !== DEFAULT_LANG && SUPPORTED_LANGUAGES.some(item => item.code === language) ? `/${language}` : '';
      const url = `https://nostr-wot.com${prefix}/guides/${guide}${anchor ? `#${anchor}` : ''}`;
      await browser.tabs.create({ url, active: false });
      setGuideOpened(true);
    } catch { setError(t('wallet.guideOpenFailed')); }
  }

  if (preference.loading || (!open && (preference.data.hidden || closed))) return null;
  return (
    <Modal title={t('wallet.connectionHelpTitle')} onClose={() => { void close(); }}
      footer={<Button disabled={saving} onClick={() => { void close(); }}>{t('common.gotIt')}</Button>}>
      <Container gap={5}>
        <Text variant="secondary" className="m-0 text-sm leading-loose">{t('wallet.connectionHelp')}</Text>
        <Container as="nav" gap={4} aria-label={t('wallet.connectionGuides')}>
          <LinkButton tone="brand" onClick={() => { void openGuide('alby-hub-nwc'); }}>{t('wallet.albyGuide')}</LinkButton>
          <LinkButton tone="brand" onClick={() => { void openGuide('lnbits-wallet-setup', 'lnbits-nwc'); }}>{t('wallet.lnbitsNwcGuide')}</LinkButton>
          <LinkButton tone="brand" onClick={() => { void openGuide('lnbits-wallet-setup', 'lnbits-api'); }}>{t('wallet.lnbitsApiGuide')}</LinkButton>
        </Container>
        {guideOpened && <Text variant="hint" role="status">{t('wallet.guideOpened')}</Text>}
        <Container variant="row" gap={4}>
          <Text className="flex-1">{t('wallet.dontShowAgain')}</Text>
          <Toggle aria-label={t('wallet.dontShowAgain')} checked={dontShow} disabled={saving} onChange={setDontShow} />
        </Container>
        <FormError>{error || preference.error}</FormError>
      </Container>
    </Modal>
  );
}
