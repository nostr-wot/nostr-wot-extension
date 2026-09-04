import { useEffect, useRef, useCallback, type ReactNode } from 'react';
import browser from '@lib/browser.ts';
import { t } from '@lib/i18n.js';
import { truncateNpub, getInitial } from '@utils/format/text.ts';
import { rpc } from '@services/rpc.ts';
import useAsyncResource from '@hooks/useAsyncResource.ts';
import useStorageWatch from '@hooks/useStorageWatch.ts';
import createRequiredContext from '@utils/createRequiredContext.ts';
import type { ProfileMetadata } from '@domain/profile/profileMetadata.ts';
import type { Account } from '@domain/accounts/account.ts';

interface ProfileCache {
  [pubkey: string]: ProfileMetadata;
}

interface AccountData {
  accounts: Account[] | null;
  activeId: string | null;
  profileCache: ProfileCache;
}

interface AccountContextValue {
  accounts: Account[] | null;
  active: Account | null;
  activeId: string | null;
  cachedProfile: ProfileMetadata | null;
  profileCache: ProfileCache;
  switchAccount: (accountId: string) => Promise<void>;
  reload: () => void;
  isReadOnly: boolean;
  isNip46: boolean;
  displayName: string;
  displaySub: string;
  avatarUrl: string | null;
  initial: string;
}

const [AccountContext, useAccount] = createRequiredContext<AccountContextValue>('useAccount');

interface AccountProviderProps {
  children: ReactNode;
}

export function AccountProvider({ children }: AccountProviderProps) {
  const { data, refresh, patch: patchAccount } = useAsyncResource<AccountData>(
    { accounts: null, activeId: null, profileCache: {} },
    {
      load: async (patch) => {
        const stored = await browser.storage.local.get(['accounts', 'activeAccountId', 'profileCache']) as Record<string, unknown>;
        const accounts: Account[] = (stored.accounts as Account[] | undefined) || [];
        const activeId: string = (stored.activeAccountId as string | undefined) || '';
        patch({
          accounts,
          activeId: activeId || accounts[0]?.id || null,
          profileCache: (stored.profileCache as ProfileCache | undefined) || {},
        });
      },
    },
  );
  const { accounts, activeId, profileCache } = data;
  const fetchedRef = useRef<Set<string>>(new Set());

  const active = accounts?.find((a) => a.id === activeId) || accounts?.[0] || null;

  useStorageWatch(
    [{ area: 'local', keys: ['accounts', 'activeAccountId', 'profileCache'] }],
    refresh,
  );

  // Fetch kind:0 metadata for all accounts in the background.
  // Shows cached data immediately; refreshes from relays each popup open.
  // Bespoke to Account: it writes back to storage itself rather than through
  // `patch`, so the update is visible to every context via the storage watch
  // above, not just this one.
  useEffect(() => {
    if (!accounts || accounts.length === 0) return;

    const pubkeys = [...new Set(accounts.map((a) => a.pubkey).filter(Boolean))];
    // Only fetch pubkeys we haven't already kicked off this session
    const toFetch = pubkeys.filter((pk) => !fetchedRef.current.has(pk));
    if (toFetch.length === 0) return;
    toFetch.forEach((pk) => fetchedRef.current.add(pk));

    // Fire all fetches concurrently, update cache as each resolves
    for (const pk of toFetch) {
      rpc<ProfileMetadata | null>('getProfileMetadata', { pubkey: pk })
        .then(async (metadata) => {
          if (!metadata) return;
          const stored = await browser.storage.local.get('profileCache') as Record<string, unknown>;
          const pc: ProfileCache = (stored.profileCache as ProfileCache | undefined) || {};
          pc[pk] = metadata;
          await browser.storage.local.set({ profileCache: pc });
          // State update will happen via the storage watch above.
        })
        .catch(() => {}); // Relay failures are fine — we keep cached data
    }
  }, [accounts]);

  const switchAccount = useCallback(async (accountId: string) => {
    if (!accounts?.find((a) => a.id === accountId)) return;
    patchAccount({ activeId: accountId });
    await rpc('switchAccount', { accountId });
    // Reload active tab so injected NIP-07 content reflects the new identity
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) void browser.tabs.reload(tabs[0].id);
    } catch { /* ignore — fails on chrome:// pages */ }
  }, [accounts, patchAccount]);

  const reload = useCallback(() => { void refresh(); }, [refresh]);

  const cachedProfile = active ? profileCache[active.pubkey] : null;

  const value: AccountContextValue = {
    accounts,
    active,
    activeId,
    cachedProfile,
    profileCache,
    switchAccount,
    reload,
    isReadOnly: active?.readOnly === true || active?.type === 'npub',
    isNip46: active?.type === 'nip46',
    displayName: cachedProfile?.name || active?.name || t('topbar.noAccounts'),
    displaySub: active ? (cachedProfile?.nip05 || truncateNpub(active.pubkey)) : t('topbar.addToStart'),
    avatarUrl: cachedProfile?.picture || null,
    initial: getInitial(cachedProfile?.name || active?.name),
  };

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export { useAccount };
