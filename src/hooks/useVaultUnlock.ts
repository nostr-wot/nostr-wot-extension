import browser from '@lib/browser.ts';
import { VAULT_STORAGE_KEY } from '@constants/vault.ts';
import { UNLOCK_FAILURES_PER_LOCKOUT as LOCKOUT_THRESHOLD } from '@constants/vault.ts';
import { UNLOCK_LOCKOUT_STEPS_MS as LOCKOUT_DURATIONS } from '@constants/vault.ts';
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import useAsyncScope from '@hooks/useAsyncScope';
import type { PasskeySelectorProps } from '@components/PasskeySelector';
import type { PasskeyMetadata } from '@domain/vault/passkey.ts';
import { authenticatePasskey } from '@services/vault/passkeyClient.ts';
import { rpc, rpcRead } from '@services/rpc.ts';

interface VaultUnlockMessages {
  enterPassword?: string;
  wrongPassword?: string;
  unlockFailed?: string;
  lockedOut?: string;
}

interface UseVaultUnlockOptions {
  onSuccess?: () => void;
  messages?: VaultUnlockMessages;
}

interface UseVaultUnlockResult {
  passkeySelection: PasskeySelectorProps;
  passkey: boolean;
  checkingMethod: boolean;
  password: string;
  setPassword: (pw: string) => void;
  error: string;
  setError: (err: string) => void;
  loading: boolean;
  lockedUntil: number;
  inputRef: React.RefObject<HTMLInputElement | null>;
  unlock: () => Promise<boolean>;
  reset: () => void;
  focus: () => void;
}

const DEFAULT_MESSAGES: Required<VaultUnlockMessages> = {
  enterPassword: 'Enter password',
  wrongPassword: 'Wrong password',
  unlockFailed: 'Unlock failed',
  lockedOut: 'Too many attempts. Try again in {seconds}s',
};

// Escalating lockout: 5 failures → 60s, 10 → 300s, 15 → 900s, 20+ → 1800s

function getLockoutDuration(failures: number): number {
  if (failures < LOCKOUT_THRESHOLD) return 0;
  const tier = Math.floor(failures / LOCKOUT_THRESHOLD) - 1;
  return LOCKOUT_DURATIONS[Math.min(tier, LOCKOUT_DURATIONS.length - 1)];
}

// Shared across hook instances so remounting doesn't reset counters
let _failCount = 0;
let _lockedUntil = 0;

export default function useVaultUnlock({ onSuccess, messages }: UseVaultUnlockOptions = {}): UseVaultUnlockResult {
  const { enterPassword, wrongPassword, unlockFailed, lockedOut } = messages || {};
  const msg = useMemo(() => ({
    enterPassword: enterPassword ?? DEFAULT_MESSAGES.enterPassword,
    wrongPassword: wrongPassword ?? DEFAULT_MESSAGES.wrongPassword,
    unlockFailed: unlockFailed ?? DEFAULT_MESSAGES.unlockFailed,
    lockedOut: lockedOut ?? DEFAULT_MESSAGES.lockedOut,
  }), [enterPassword, wrongPassword, unlockFailed, lockedOut]);
  const scope = useAsyncScope();
  const [credentials, setCredentials] = useState<PasskeyMetadata[]>([]);
  const [selectedCredential, setSelectedCredential] = useState('');
  const metadata = credentials.find((credential) => credential.credentialId === selectedCredential) || credentials[0];
  const [checkingMethod, setCheckingMethod] = useState(true);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      setCheckingMethod(true);
      rpcRead<PasskeyMetadata[]>('vault_listPasskeys', { forUnlock: true }).then((value) => { if (active) setCredentials(Array.isArray(value) ? value : []); }).catch(() => {}).finally(() => { if (active) setCheckingMethod(false); });
    };
    const changed = (changes: Record<string, unknown>, area: string) => { if (area === 'local' && VAULT_STORAGE_KEY in changes) refresh(); };
    refresh();
    browser.storage.onChanged.addListener(changed);
    return () => { active = false; browser.storage.onChanged.removeListener(changed); };
  }, []);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(_lockedUntil);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Countdown timer for lockout display
  useEffect(() => {
    if (lockedUntil <= Date.now()) return;
    const tick = () => {
      const remaining = lockedUntil - Date.now();
      if (remaining <= 0) {
        setError('');
        setLockedUntil(0);
        return;
      }
      setError(msg.lockedOut.replace('{seconds}', String(Math.ceil(remaining / 1000))));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockedUntil, msg.lockedOut]);

  const reset = useCallback((): void => {
    scope.invalidate();
    setPassword('');
    setLoading(false);
    // Preserve lockout state — only clear error if not locked out
    if (_lockedUntil <= Date.now()) {
      setError('');
      setLockedUntil(0);
    } else {
      setLockedUntil(_lockedUntil);
    }
  }, [scope]);

  const focus = useCallback((): void => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const unlock = useCallback(async (): Promise<boolean> => {
    // Check lockout
    if (_lockedUntil > Date.now()) {
      const remaining = Math.ceil((_lockedUntil - Date.now()) / 1000);
      setError(msg.lockedOut.replace('{seconds}', String(remaining)));
      return false;
    }

    if (checkingMethod || loading) return false;
    if (!metadata && !password) { setError(msg.enterPassword); return false; }
    const current = scope.start();
    setLoading(true);
    setError('');
    try {
      let ok: boolean;
      if (metadata) {
        const proof = await authenticatePasskey(metadata);
        try {
          if (!current()) return false;
          ok = await rpc<boolean>('vault_unlockPasskey', proof);
        }
        finally { proof.prf = ''; }
      } else {
        ok = await rpc<boolean>('vault_unlock', { password });
      }
      if (ok) {
        _failCount = 0;
        _lockedUntil = 0;
        if (!current()) return false;
        setPassword('');
        setLockedUntil(0);
        onSuccess?.();
        return true;
      } else {
        _failCount++;
        const duration = getLockoutDuration(_failCount);
        if (duration > 0) {
          _lockedUntil = Date.now() + duration;
          if (current()) setLockedUntil(_lockedUntil);
        } else if (current()) {
          setError(msg.wrongPassword);
        }
        if (current()) inputRef.current?.select();
        return false;
      }
    } catch (e: unknown) {
      if (current()) {
        setError((e as Error).message || msg.unlockFailed);
        inputRef.current?.select();
      }
      return false;
    } finally {
      if (current()) setLoading(false);
    }
  }, [password, onSuccess, msg, scope, metadata, checkingMethod, loading]);

  return { passkeySelection: { credentials, value: metadata?.credentialId || '', onChange: setSelectedCredential, disabled: loading }, passkey: !!metadata, checkingMethod, password, setPassword, error, setError, loading, lockedUntil, inputRef, unlock, reset, focus };
}
