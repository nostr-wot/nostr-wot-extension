import React, { useCallback, type ReactNode } from 'react';
import { rpc } from '@shared/rpc.ts';
import { LOCK_STATE_KEY } from '@lib/constants.ts';
import useAsyncResource from '@hooks/useAsyncResource.ts';
import useStorageWatch from '@hooks/useStorageWatch.ts';
import createRequiredContext from '@utils/createRequiredContext.ts';

interface VaultData {
  exists: boolean;
  locked: boolean;
  autoLockEnabled: boolean;
  isNip46: boolean;
  isGenerated: boolean;
}

interface VaultContextValue extends VaultData {
  unlock: (password: string) => Promise<boolean>;
  lock: () => Promise<void>;
  checkState: () => Promise<void>;
}

const [VaultContext, useVault] = createRequiredContext<VaultContextValue>('useVault');

interface VaultProviderProps {
  children: ReactNode;
}

export function VaultProvider({ children }: VaultProviderProps) {
  const { data, refresh: checkState, patch: patchVault } = useAsyncResource<VaultData>(
    { exists: false, locked: true, autoLockEnabled: false, isNip46: false, isGenerated: false },
    {
      load: async (patch) => {
        try {
          const [existsResult, lockedResult, autoLockMs, acctType] = await Promise.all([
            rpc('vault_exists'),
            rpc('vault_isLocked'),
            rpc<number>('vault_getAutoLock'),
            rpc<{ type?: string }>('vault_getActiveAccountType'),
          ]);
          patch({
            exists: !!existsResult,
            locked: !!lockedResult,
            autoLockEnabled: autoLockMs > 0,
            isNip46: acctType?.type === 'nip46',
            isGenerated: acctType?.type === 'generated',
          });
        } catch {
          // Deliberately not resetting the rest here. `exists: false` is what
          // PopupApp uses to decide there is no vault to lock, so a failed
          // read — a worker asleep past rpc()'s three wake retries —
          // suppressed the lock screen over a locked vault. A read that did
          // not come back tells us nothing about the vault; the last thing we
          // did manage to read is a better answer than a confident wrong one,
          // and the background re-checks the real lock state on every
          // operation regardless. `locked: true` is the one field worth
          // forcing rather than leaving unknown — the safe default.
          patch({ locked: true });
        }
      },
    },
  );

  const unlock = useCallback(async (password: string): Promise<boolean> => {
    const result = await rpc('vault_unlock', { password });
    if (result) {
      patchVault({ locked: false });
      return true;
    }
    return false;
  }, [patchVault]);

  const lock = useCallback(async () => {
    await rpc('vault_lock');
    patchVault({ locked: true });
  }, [patchVault]);

  // Re-check when the active account changes, and when the vault locks.
  //
  // Auto-lock fires on a background timer with the popup open and unaware: it
  // kept rendering unlocked UI, and an incoming request that queued an unlock
  // waiter never produced a prompt, because the surface that raises one only
  // does so when it believes the vault is locked. The request timed out with
  // no UI ever shown. `lock()` now writes LOCK_STATE_KEY for this listener.
  useStorageWatch(
    [{ area: 'local', keys: ['activeAccountId', LOCK_STATE_KEY] }],
    checkState,
  );

  const value: VaultContextValue = { ...data, unlock, lock, checkState };

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export { useVault };
