import { useCallback, type ReactNode } from 'react';
import { rpc } from '@services/rpc.ts';
import useAsyncResource from '@hooks/useAsyncResource.ts';
import useStorageWatch from '@hooks/useStorageWatch.ts';
import createRequiredContext from '@utils/createRequiredContext.ts';

interface RawPerms {
  [domain: string]: {
    [bucket: string]: {
      [permKey: string]: string;
    };
  };
}

interface PermissionsData {
  rawPerms: RawPerms;
  useGlobalDefaults: boolean;
  /** False until the first read completes (success or failure) — never reset
   *  afterward. Nothing currently reads it, but the original never re-flipped
   *  it false on a background reload either, so a caller that gates a
   *  one-time effect on it (the way NetworkSection does with RelaysContext's
   *  `loaded`) gets the same "ran once, ever" answer. */
  loaded: boolean;
}

interface PermissionsContextValue extends PermissionsData {
  reload: () => Promise<void>;
  savePermission: (domain: string, permKey: string, decision: string, accountId?: string | null) => Promise<void>;
  clearPermissions: (domain: string, accountId?: string | null) => Promise<void>;
  copyPermissions: (fromAccountId: string, toAccountId: string) => Promise<void>;
  setUseGlobalDefaults: (enabled: boolean) => Promise<void>;
  getForBucket: (domain: string, accountId?: string | null) => Record<string, string>;
  getDomainsForBucket: (accountId?: string | null) => string[];
}

const [PermissionsContext, usePermissions] = createRequiredContext<PermissionsContextValue>('usePermissions');

interface PermissionsProviderProps {
  children: ReactNode;
}

export function PermissionsProvider({ children }: PermissionsProviderProps) {
  const { data, refresh: reload, patch } = useAsyncResource<PermissionsData>(
    { rawPerms: {}, useGlobalDefaults: true, loaded: false },
    {
      load: async (patch) => {
        const [raw, defaults] = await Promise.all([
          rpc<RawPerms>('signer_getPermissionsRaw'),
          rpc<boolean>('signer_getUseGlobalDefaults'),
        ]);
        patch({ rawPerms: raw || {}, useGlobalDefaults: defaults !== false, loaded: true });
      },
    },
  );
  const { rawPerms, useGlobalDefaults, loaded } = data;

  useStorageWatch(
    [{ area: 'local', keys: ['signerPermissions', 'signerUseGlobalDefaults'] }],
    reload,
  );

  /** Save a permission using a pre-computed permKey (e.g. "signEvent:1") */
  const savePermission = useCallback(async (domain: string, permKey: string, decision: string, accountId?: string | null) => {
    await rpc('signer_savePermission', {
      domain, methodName: permKey, decision, accountId,
    });
    // Optimistic local update — use the same mode logic as the backend. A
    // function of the previous data, not a captured `rawPerms`: two saves
    // issued before either re-renders must not have the second clobber the
    // first with a value it read before the first one landed.
    patch((prev) => {
      const next = { ...prev.rawPerms };
      const bucket = prev.useGlobalDefaults ? '_default' : (accountId || '_default');
      if (!next[domain]) next[domain] = {};
      if (!next[domain][bucket]) next[domain][bucket] = {};
      next[domain][bucket] = { ...next[domain][bucket], [permKey]: decision };
      return { rawPerms: next };
    });
  }, [patch]);

  /** Clear permissions for a domain (optionally per-account) */
  const clearPermissions = useCallback(async (domain: string, accountId?: string | null) => {
    await rpc('signer_clearPermissions', { domain, accountId });
    void reload();
  }, [reload]);

  /** Copy permissions from one account to another */
  const copyPermissions = useCallback(async (fromAccountId: string, toAccountId: string) => {
    await rpc('signer_copyPermissions', { fromAccountId, toAccountId });
    void reload();
  }, [reload]);

  /** Toggle the global defaults cascade */
  const setUseGlobalDefaults = useCallback(async (enabled: boolean) => {
    patch({ useGlobalDefaults: enabled });
    await rpc('signer_setUseGlobalDefaults', { enabled });
  }, [patch]);

  /** Get permissions for a specific bucket (accountId or '_default') */
  const getForBucket = useCallback((domain: string, accountId?: string | null): Record<string, string> => {
    const bucket = accountId || '_default';
    return rawPerms[domain]?.[bucket] || {};
  }, [rawPerms]);

  /** Get all domains that have permissions for a specific bucket */
  const getDomainsForBucket = useCallback((accountId?: string | null): string[] => {
    const bucket = accountId || '_default';
    const domains: string[] = [];
    for (const domain of Object.keys(rawPerms)) {
      const b = rawPerms[domain]?.[bucket];
      if (b && Object.keys(b).length > 0) {
        domains.push(domain);
      }
    }
    return domains;
  }, [rawPerms]);

  const value: PermissionsContextValue = {
    rawPerms,
    useGlobalDefaults,
    loaded,
    reload,
    savePermission,
    clearPermissions,
    copyPermissions,
    setUseGlobalDefaults,
    getForBucket,
    getDomainsForBucket,
  };

  return (
    <PermissionsContext.Provider value={value}>
      {children}
    </PermissionsContext.Provider>
  );
}

export { usePermissions };
