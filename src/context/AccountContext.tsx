import { useEffect, useRef, useCallback, type ReactNode } from 'react';
import browser from '@lib/browser.ts';
import { t } from '@services/i18n/i18n.ts';
import { cachedPublicProfile } from '@domain/profile/publicProfile';
import { accountDisplay } from '@domain/accounts/display.ts';
import { ACCOUNT_LABELS_KEY } from '@constants/accounts.ts';
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
  /** The person's own labels by account id (see ACCOUNT_LABELS_KEY). */
  labels: Record<string, string>;
}

interface AccountContextValue {
  accounts: Account[] | null;
  active: Account | null;
  activeId: string | null;
  cachedProfile: ProfileMetadata | null;
  profileCache: ProfileCache;
  labels: Record<string, string>;
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
    { accounts: null, activeId: null, profileCache: {}, labels: {} },
    {
      load: async (patch, isCurrent) => {
        const stored = await browser.storage.local.get(['accounts', 'activeAccountId', 'profileCache', ACCOUNT_LABELS_KEY]) as Record<string, unknown>;
        const accounts: Account[] = (stored.accounts as Account[] | undefined) || [];
        const activeId: string = (stored.activeAccountId as string | undefined) || '';
        const profiles = await browser.storage.local.get(accounts.map(account => `profile_${account.pubkey}`));
        const profileCache: ProfileCache = {};
        for (const account of accounts) {
          const profile = cachedPublicProfile({ ...stored, ...profiles }, account.pubkey);
          if (profile) profileCache[account.pubkey] = profile;
        }
        if (!isCurrent()) return;
        patch({
          accounts,
          activeId: activeId || accounts[0]?.id || null,
          profileCache,
          labels: (stored[ACCOUNT_LABELS_KEY] as Record<string, string> | undefined) || {},
        });
      },
    },
  );
  const { accounts, activeId, profileCache, labels } = data;
  const fetchedRef = useRef<Set<string>>(new Set());

  const active = accounts?.find((a) => a.id === activeId) || accounts?.[0] || null;

  useStorageWatch(
    [{ area: 'local', keys: ['accounts', 'activeAccountId', 'profileCache', ACCOUNT_LABELS_KEY, ...(accounts || []).map(account => `profile_${account.pubkey}`)] }],
    refresh,
  );

  // The background owns the shared profile cache. Read it after relay fetches;
  // never copy a delayed response over a freshly published profile in the UI.
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
        .then(() => refresh())
        .catch(() => {}); // Relay failures are fine — we keep cached data
    }
  }, [accounts, refresh]);

  const switchAccount = useCallback(async (accountId: string) => {
    if (!accounts?.find((a) => a.id === accountId)) return;
    // Do not render an identity whose background switch has not completed:
    // account-scoped readers would query the old account and discard the reply.
    await commitAccountSwitch(accountId, id => rpc('switchAccount', { accountId: id }), id => patchAccount({ activeId: id }));
    // Many clients cache their selected identity and ignore account-change events.
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id !== undefined) {
        // Register outside the popup before navigation can destroy its timers.
        // Recovery failure must never prevent the website adopting the new account.
        await rpc('scheduleAccountSwitchPopupRecovery', { tabId: tab.id }).catch(() => {});
        try {
          const response = await browser.tabs.sendMessage(tab.id, { type: 'NOSTR_RELOAD_PAGE' }, { frameId: 0 });
          if (!response?.ok) await browser.tabs.reload(tab.id);
        } catch { await browser.tabs.reload(tab.id); }
      }
    } catch { /* Restricted or closed tab. */ }
  }, [accounts, patchAccount]);

  const reload = useCallback(() => { void refresh(); }, [refresh]);

  const cachedProfile = active ? profileCache[active.pubkey] : null;

  const display = active ? accountDisplay(active, cachedProfile, labels[active.id]) : null;

  const value: AccountContextValue = {
    accounts,
    active,
    activeId,
    cachedProfile,
    profileCache,
    labels,
    switchAccount,
    reload,
    isReadOnly: active?.readOnly === true || active?.type === 'npub',
    isNip46: active?.type === 'nip46',
    displayName: display?.name || t('topbar.noAccounts'),
    displaySub: display?.subtitle || t('topbar.addToStart'),
    avatarUrl: display?.picture || null,
    initial: display?.initial || '',
  };

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export { useAccount };

/** The UI must not query the next identity before the background selects it. */
export async function commitAccountSwitch(accountId: string, commit: (id: string) => Promise<unknown>, select: (id: string) => void): Promise<void> {
  await commit(accountId);
  select(accountId);
}
