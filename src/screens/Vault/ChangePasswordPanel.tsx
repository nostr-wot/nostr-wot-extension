import { useState, ChangeEvent } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import Button from '@components/Button/Button';
import Input from '@components/Input/Input';
import PasswordPairFields from '@components/PasswordPairFields/PasswordPairFields';
import usePasswordPair from '@hooks/usePasswordPair.ts';
import FormError from '@components/FormError/FormError';
import Container from '@components/Container/Container';

/** State is scoped to this action and discarded when its panel unmounts. */
export default function ChangePasswordPanel({ onClose }: { onClose: () => void }) {
  const [cpCurrent, setCpCurrent] = useState('');
  const cpPair = usePasswordPair();
  const [cpError, setCpError] = useState('');
  const [cpSuccess, setCpSuccess] = useState(false);
  const handleClose = onClose;
  const handleChangePassword = async () => {
    setCpError('');
    if (!cpCurrent) { setCpError(t('key.enterCurrentPassword')); return; }
    if (!cpPair.ready) return;
    try {
      const result = await rpc<{ success?: boolean; error?: string }>('vault_changePassword', { currentPassword: cpCurrent, newPassword: cpPair.password });
      if (result?.success) {
        setCpSuccess(true);
        setTimeout(handleClose, 1500);
      } else {
        setCpError(result?.error || t('key.failedChangePassword'));
      }
    } catch {
      setCpError(t('key.failedChangePassword'));
    }
  };
  return (
    <Container gap={5}>
      {cpSuccess ? (
        <div className="text-lg font-medium text-success text-center py-8">{t('key.passwordChanged')}</div>
      ) : (
        <>
          <Input
            type="password"
            showToggle
            placeholder={t('key.currentPw')}
            value={cpCurrent}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setCpCurrent(e.target.value)}
          />
          <PasswordPairFields
            pair={cpPair}
            passwordPlaceholder={t('key.newPwMinChars')}
            confirmPlaceholder={t('key.confirmNewPw')}
            onSubmit={handleChangePassword}
          />
          <FormError>{cpError}</FormError>
          <Container variant="row" gap={4} className="justify-end mt-2">
            <Button variant="secondary" small onClick={handleClose}>{t('common.cancel')}</Button>
            <Button small onClick={handleChangePassword} disabled={!cpPair.ready}>{t('common.save')}</Button>
          </Container>
        </>
      )}
    </Container>
  );
}
