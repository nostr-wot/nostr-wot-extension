import { useCallback, useEffect, useRef, useState } from 'react';
import { SUBACCOUNT_PREVIEW_DELAY_MS } from '@constants/accounts.ts';
import type { SafeAccount } from '@domain/accounts/types.ts';
import { normalizeDerivationPath } from '@domain/accounts/derivation.ts';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import useAsyncScope from '@hooks/useAsyncScope.ts';

interface Preview {
  account: SafeAccount;
  derivationPath: string;
  seedName: string;
}

/** Serialize previews because the background holds one pending onboarding account. */
export default function useSubAccountPreview() {
  const [account, setAccount] = useState<SafeAccount | null>(null);
  const [path, setPathState] = useState('');
  const [seedName, setSeedName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const draft = useRef('');
  const pending = useRef(false);
  const attempted = useRef<string | null>(null);
  const scope = useAsyncScope();
  const validPath = normalizeDerivationPath(path);

  const generate = useCallback(async (requestedPath?: string) => {
    if (pending.current) return;
    pending.current = true;
    attempted.current = requestedPath ?? '';
    const isCurrent = scope.start();
    setLoading(true);
    setError('');
    try {
      const result = await rpc<Preview>('onboarding_generateSubAccount',
        requestedPath === undefined ? {} : { derivationPath: requestedPath });
      if (!isCurrent() || (requestedPath !== undefined && normalizeDerivationPath(draft.current) !== requestedPath)) return;
      setAccount(result.account);
      if (requestedPath === undefined) {
        draft.current = result.derivationPath;
        setPathState(result.derivationPath);
      }
      setSeedName(result.seedName);
      setNeedsUnlock(false);
    } catch (error) {
      if (!isCurrent() || (requestedPath !== undefined && normalizeDerivationPath(draft.current) !== requestedPath)) return;
      const message = error instanceof Error ? error.message : '';
      if (message.includes('locked')) setNeedsUnlock(true);
      else setError(message || t('wizard.failedGenerate'));
    } finally {
      pending.current = false;
      if (isCurrent()) setLoading(false);
    }
  }, [scope]);

  const setPath = useCallback((value: string) => {
    draft.current = value;
    attempted.current = null;
    setPathState(value);
    setAccount(null);
    setError('');
  }, []);

  useEffect(() => { void generate(); }, [generate]);
  useEffect(() => {
    if (!validPath || loading || needsUnlock || attempted.current === validPath || account?.derivationPath === validPath) return;
    const timer = setTimeout(() => void generate(validPath), SUBACCOUNT_PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [path, validPath, loading, needsUnlock, account, generate]);

  return { account, path, setPath, seedName, loading, error, needsUnlock,
    retry: () => generate(validPath ?? undefined) };
}
