import { t } from '@services/i18n/i18n.ts';
import IconInfo from '@assets/IconInfo.tsx';
import Button, { ButtonSecondary } from '@components/Button';
import Container from '@components/Container';
import Text from '@components/Text';
import StatusNotice from '@components/StatusNotice';

interface PasskeyImportedStepProps {
  host?: string;
  onDone: () => void;
  /** Opens the existing passkey enrollment. Absent where no settings screen exists. */
  onProtect?: () => void;
}

/**
 * After importing a key another app derives from its passkey: say plainly that the
 * original passkey keeps producing it, and offer (never force) Nostr WoT passkey
 * protection through the existing enrollment.
 */
export default function PasskeyImportedStep({ host, onDone, onProtect }: PasskeyImportedStepProps) {
  return <Container gap={6} className="flex-1">
    <StatusNotice variant="callout" tone="ok" icon={<IconInfo />}>{t('passkeyImport.stillValid', { host: host || t('passkeyImport.otherApp') })}</StatusNotice>
    <Text variant="secondary">{t('passkeyImport.protectOffer')}</Text>
    {!onProtect && <Text variant="muted">{t('passkeyImport.protectLater')}</Text>}
    <Container stickyFooter gap={3}>
      {onProtect && <Button onClick={onProtect}>{t('passkeyImport.protect')}</Button>}
      {onProtect ? <ButtonSecondary onClick={onDone}>{t('common.later')}</ButtonSecondary> : <Button onClick={onDone}>{t('common.continue')}</Button>}
    </Container>
  </Container>;
}
