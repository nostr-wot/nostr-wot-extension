import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import browser from '@shared/browser.ts';
import { rpc } from '@shared/rpc.ts';
import { LOCK_STATE_KEY } from '@lib/constants.ts';

interface VaultContextValue {
  exists: boolean;
  locked: boolean;
  autoLockEnabled: boolean;
  isNip46: boolean;
  isGenerated: boolean;
  unlock: (password: string) => Promise<boolean>;
  lock: () => Promise<void>;
  checkState: () => Promise<void>;
}

const VaultContext = createContext<VaultContextValue | null>(null);

interface VaultProviderProps {
  children: ReactNode;
}

export function VaultProvider({ children }: VaultProviderProps) {
  const [exists, setExists] = useState<boolean>(false);
  const [locked, setLocked] = useState<boolean>(true);
  const [autoLockEnabled, setAutoLockEnabled] = useState<boolean>(false);
  const [isNip46, setIsNip46] = useState<boolean>(false);
  const [isGenerated, setIsGenerated] = useState<boolean>(false);

  const checkState = useCallback(async () => {
    try {
      const [existsResult, lockedResult, autoLockMs, acctType] = await Promise.all([
        rpc('vault_exists'),
        rpc('vault_isLocked'),
        rpc<number>('vault_getAutoLock'),
        rpc<{ type?: string }>('vault_getActiveAccountType'),
      ]);
      setExists(!!existsResult);
      setLocked(!!lockedResult);
      setAutoLockEnabled(autoLockMs > 0);
      setIsNip46(acctType?.type === 'nip46');
      setIsGenerated(acctType?.type === 'generated');
    } catch {
      // Deliberately not resetting here. `exists: false` is what PopupApp uses
      // to decide there is no vault to lock, so a failed read — a worker asleep
      // past rpc()'s three wake retries — suppressed the lock screen over a
      // locked vault. A read that did not come back tells us nothing about the
      // vault; the last thing we did manage to read is a better answer than a
      // confident wrong one, and the background re-checks the real lock state on
      // every operation regardless.
      setLocked(true);
    }
  }, []);

  const unlock = useCallback(async (password: string): Promise<boolean> => {
    const result = await rpc('vault_unlock', { password });
    if (result) {
      setLocked(false);
      return true;
    }
    return false;
  }, []);

  const lock = useCallback(async () => {
    await rpc('vault_lock');
    setLocked(true);
  }, []);

  useEffect(() => {
    checkState();
  }, [checkState]);

  // Re-check when the active account changes, and when the vault locks.
  //
  // Auto-lock fires on a background timer with the popup open and unaware: it
  // kept rendering unlocked UI, and an incoming request that queued an unlock
  // waiter never produced a prompt, because the surface that raises one only
  // does so when it believes the vault is locked. The request timed out with no
  // UI ever shown. `lock()` now writes LOCK_STATE_KEY for this listener.
  useEffect(() => {
    function onChange(changes: Record<string, { newValue?: unknown; oldValue?: unknown }>, area: string) {
      if (area !== 'local') return;
      if (changes.activeAccountId || changes[LOCK_STATE_KEY]) {
        checkState();
      }
    }
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, [checkState]);

  const value: VaultContextValue = {
    exists,
    locked,
    autoLockEnabled,
    isNip46,
    isGenerated,
    unlock,
    lock,
    checkState,
  };

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultContextValue {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error('useVault must be used within VaultProvider');
  return ctx;
}
