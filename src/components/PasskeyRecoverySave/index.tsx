import { useCallback, useEffect, useRef, useState } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import { parsePasskeyBackup } from '@domain/vault/passkey.ts';
import { savePasskeyRecovery } from '@services/vault/passkeyRecovery.ts';
import Button from '@components/Button';
import Text from '@components/Text';
import Container from '@components/Container';

/** Shared by onboarding and Security; success requires the provider to confirm the write. */
export default function PasskeyRecoverySave({ credentialId, autoStart = false, disabled = false, onSaved, onUnavailable }: {
  credentialId?: string; autoStart?: boolean; disabled?: boolean; onSaved?: () => void; onUnavailable?: () => void;
}) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const active = useRef<AbortController | null>(null);
  const callbacks = useRef({ onSaved, onUnavailable });
  callbacks.current = { onSaved, onUnavailable };
  const save = useCallback(async () => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    setStatus('saving');
    try {
      const backup = await rpc<string>('vault_exportPasskeyBackup');
      if (controller.signal.aborted) return;
      const selected = credentialId || parsePasskeyBackup(backup).passkeys[0].credentialId;
      await savePasskeyRecovery(backup, selected, controller.signal);
      if (!controller.signal.aborted) { setStatus('saved'); callbacks.current.onSaved?.(); }
    } catch {
      if (!controller.signal.aborted) { setStatus('failed'); callbacks.current.onUnavailable?.(); }
    } finally { if (active.current === controller) active.current = null; }
  }, [credentialId]);
  useEffect(() => {
    setStatus('idle');
    if (autoStart) void save();
    return () => { active.current?.abort(); active.current = null; };
  }, [autoStart, save]);
  return <Container gap={3}>
    <Button disabled={disabled || status === 'saving'} onClick={save}>{t(status === 'saving' ? 'passkey.savingRecovery' : 'passkey.saveRecovery')}</Button>
    {status === 'saved' && <Text variant="secondary" role="status">{t('passkey.recoverySaved')}</Text>}
    {status === 'failed' && <Text variant="secondary" role="status">{t('passkey.recoveryFallback')}</Text>}
  </Container>;
}
