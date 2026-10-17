import Dropdown from '@components/Dropdown';
import { t } from '@services/i18n/i18n.ts';
import { passkeyDisplayName, type PasskeyMetadata } from '@domain/vault/passkey.ts';

export interface PasskeySelectorProps {
  credentials: PasskeyMetadata[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export default function PasskeySelector({ credentials, value, onChange, disabled }: PasskeySelectorProps) {
  if (credentials.length < 2) return null;
  return <Dropdown options={credentials.map((credential, index) => ({ value: credential.credentialId, label: `${passkeyDisplayName(credential, index, t('passkey.title'))}${credential.rpId ? ` · ${credential.rpId}` : ''}` }))} value={value} onChange={onChange} disabled={disabled} aria-label={t('passkey.title')} />;
}
