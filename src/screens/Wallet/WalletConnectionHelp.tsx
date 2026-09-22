import { t } from '@services/i18n/i18n.ts';
import Card from '@components/Card';
import Container from '@components/Container';
import Text from '@components/Text';
import IconInfo from '@assets/IconInfo.tsx';

/** Shared connection guidance for setup and the connected wallet's settings. */
export default function WalletConnectionHelp() {
  const guides = [
    ['wallet.albyGuide', 'https://guides.getalby.com/user-guide/alby-hub/app-connections'],
    ['wallet.lnbitsNwcGuide', 'https://docs.lnbits.com/extensions/nwcprovider/'],
    ['wallet.lnbitsApiGuide', 'https://docs.lnbits.com/api/authentication#finding-your-keys'],
  ] as const;

  return (
    <Card variant="flat" className="m-0 p-8">
      <Container gap={5}>
        <Container variant="row" gap={3}>
          <IconInfo size={18} className="shrink-0 text-brand" aria-hidden="true" />
          <Text as="strong" className="text-sm text-heading">{t('wallet.connectionHelpTitle')}</Text>
        </Container>
        <Text variant="secondary" className="m-0 text-sm leading-loose">{t('wallet.connectionHelp')}</Text>
        <Container as="nav" gap={4} aria-label={t('wallet.connectionGuides')}>
          {guides.map(([label, href]) => (
            <a key={label} className="text-xs text-brand underline underline-offset-2 hover:text-brand-hover"
              href={href} target="_blank" rel="noreferrer noopener">{t(label)}</a>
          ))}
        </Container>
      </Container>
    </Card>
  );
}
