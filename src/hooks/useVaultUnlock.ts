import { useState, useRef, useCallback, useEffect } from 'react';
import { rpc } from '@shared/rpc.ts';

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
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATIONS = [60_000, 300_000, 900_000, 1_800_000];

function getLockoutDuration(failures: number): number {
  if (failures < LOCKOUT_THRESHOLD) return 0;
  const tier = Math.floor(failures / LOCKOUT_THRESHOLD) - 1;
  return LOCKOUT_DURATIONS[Math.min(tier, LOCKOUT_DURATIONS.length - 1)];
}

// Shared across hook instances so remounting doesn't reset counters
let _failCount = 0;
let _lockedUntil = 0;

export default function useVaultUnlock({ onSuccess, messages }: UseVaultUnlockOptions = {}): UseVaultUnlockResult {
  const msg = messages ? { ...DEFAULT_MESSAGES, ...messages } : DEFAULT_MESSAGES;
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
    setPassword('');
    setLoading(false);
    // Preserve lockout state — only clear error if not locked out
    if (_lockedUntil <= Date.now()) {
      setError('');
      setLockedUntil(0);
    } else {
      setLockedUntil(_lockedUntil);
    }
  }, []);

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

    if (!password) { setError(msg.enterPassword); return false; }
    setLoading(true);
    setError('');
    try {
      const ok = await rpc<boolean>('vault_unlock', { password });
      if (ok) {
        _failCount = 0;
        _lockedUntil = 0;
        setPassword('');
        setLockedUntil(0);
        onSuccess?.();
        return true;
      } else {
        _failCount++;
        const duration = getLockoutDuration(_failCount);
        if (duration > 0) {
          _lockedUntil = Date.now() + duration;
          setLockedUntil(_lockedUntil);
        } else {
          setError(msg.wrongPassword);
        }
        inputRef.current?.select();
        return false;
      }
    } catch (e: unknown) {
      setError((e as Error).message || msg.unlockFailed);
      inputRef.current?.select();
      return false;
    } finally {
      setLoading(false);
    }
  }, [password, onSuccess, msg]);

  return { password, setPassword, error, setError, loading, lockedUntil, inputRef, unlock, reset, focus };
}
