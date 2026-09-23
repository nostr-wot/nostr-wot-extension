import { LOCK_STATE_KEY } from '@constants/vault.ts';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { walletDisplayKey, type WalletDisplayCache } from '@domain/wallet/display-cache.ts';
const readWalletDisplayCache = (accountId: string) => rpc<WalletDisplayCache | null>('wallet_readDisplayCache', { accountId });
import type { Transaction } from '@domain/wallet/types.ts';
import useStorageWatch from '@hooks/useStorageWatch.ts';
import { t } from '@services/i18n/i18n.ts';
import { rpc } from '@services/rpc.ts';
import useAsyncResource from '@hooks/useAsyncResource.ts';
import createRequiredContext from '@utils/createRequiredContext.ts';
import { useAccount } from './AccountContext';

interface ConfigData {
  /** `string` = provider type (configured), `false` = no wallet, `null` =
   *  unknown (not fetched yet, or the last read failed). */
  configType: string | false | null;
  cachedBalance?: number;
  cachedTransactions?: Transaction[];
}

interface BalanceData {
  /** `null` = unknown (no wallet, not fetched yet, or the last read failed). */
  balance: number | null;
}

export interface WalletSettingsData {
  alias?: string;
  threshold?: number;
  nwcUri?: string | null;
  address?: string | null;
}

interface WalletContextValue {
  configType: string | false | null;
  settings: WalletSettingsData;
  settingsLoading: boolean;
  settingsError: string;
  ensureSettings: () => void;
  refreshSettings: () => Promise<void>;
  patchSettings: (next: Partial<WalletSettingsData>) => void;
  /** True when the most recent config read threw. Kept separate from
   *  `configType` rather than coerced into `false` — WalletSection used to do
   *  that and rendered the whole "connect a wallet" flow over a wallet that was
   *  already connected, on nothing worse than a cold service worker. */
  configReadFailed: boolean;
  configLoading: boolean;
  cachedTransactions: Transaction[];
  balance: number | null;
  balanceLoading: boolean;
  balanceError: string;
  refreshConfig: () => Promise<void>;
  refreshBalance: () => Promise<void>;
  /** Optimistic: call right after `wallet_disconnect` resolves so the UI does
   *  not wait on a round trip to know the wallet it just disconnected is gone. */
  markDisconnected: () => void;
}

const [WalletContext, useWallet] = createRequiredContext<WalletContextValue>('useWallet');

interface WalletProviderProps {
  children?: ReactNode;
}

/**
 * Wallet config presence and balance, fetched once here instead of by every
 * surface that needs them.
 *
 * Before this, `WalletSection` asked `wallet_hasConfig` on its own mount,
 * `Wallet` fetched the balance on its own mount, and `useWalletBanner` (Home)
 * asked both questions again independently — three round trips for two facts,
 * and no shared answer between them.
 *
 * Config and balance are two separate resources, not one: `refreshBalance` is
 * called on its own after a payment, and folding it into a single combined
 * read would repeat the config round trip every time a caller only wants a
 * fresher balance.
 */
export function WalletProvider({ children }: WalletProviderProps) {
  const { active } = useAccount();
  return <AccountWalletProvider accountId={active?.id || ''} enabled={!!active?.id}>{children}</AccountWalletProvider>;
}

export function AccountWalletProvider({ children, enabled, accountId = '' }: WalletProviderProps & { enabled: boolean; accountId?: string }) {
  const [snapshot, setSnapshot] = useState<{ accountId: string; value: WalletContextValue } | null>(null);
  const publish = useCallback((value: WalletContextValue) => setSnapshot({ accountId, value }), [accountId]);
  return <WalletContext.Provider value={snapshot?.accountId === accountId ? snapshot.value : EMPTY_WALLET}>
    <WalletAccountState key={accountId} accountId={accountId} enabled={enabled} publish={publish} />
    {children}
  </WalletContext.Provider>;
}

const EMPTY_WALLET: WalletContextValue = {
  configType: null, settings: {}, settingsLoading: true, settingsError: '',
  configReadFailed: false, configLoading: true, cachedTransactions: [],
  balance: null, balanceLoading: true, balanceError: '',
  ensureSettings() {}, patchSettings() {}, markDisconnected() {},
  async refreshSettings() {}, async refreshConfig() {}, async refreshBalance() {},
};

/** Reset account resources without remounting the popup or its in-progress wizard. */
function WalletAccountState({ enabled, accountId, publish }: {
  enabled: boolean; accountId: string; publish: (value: WalletContextValue) => void;
}) {
  const intent = useRef(0);
  const settingsRevision = useRef(0);
  const [settingsRequested, setSettingsRequested] = useState(false);

  const {
    data: configData, loading: configLoading, error: configError, refresh: refreshConfig, patch: patchConfig,
  } = useAsyncResource<ConfigData>(
    { configType: null },
    {
      // Only this resource controller is keyed on the account id.
      enabled,
      load: async (patch, isCurrent) => {
        const generation = intent.current;
        await loadWalletDisplay(accountId, patch, () => isCurrent() && generation === intent.current);

      },
    },
  );

  const {
    data: balanceData, loading: balanceLoading, error: balanceError, refresh: refreshBalance, patch: patchBalance,
  } = useAsyncResource<BalanceData>(
    { balance: null },
    {
      // Only a configured wallet has a balance to fetch.
      enabled: typeof configData.configType === 'string',
      deps: [configData.configType],
      load: async (patch, isCurrent) => {
        const generation = intent.current;
        const result = await rpc<{ balance: number }>('wallet_getBalance');
        if (isCurrent() && generation === intent.current) patch({ balance: result.balance });
      },
    },
  );

  // The balance resource's `enabled` flag stops it from fetching once there
  // is no wallet, but does not clear a stale balance left over from a
  // previous account — that reset is context-specific, so it stays an
  // explicit line here rather than a side effect of `enabled` in the
  // generic (see useAsyncResource's note on `enabled`).
  useEffect(() => {
    if (typeof configData.configType !== 'string') patchBalance({ balance: null });
  }, [configData.configType, patchBalance]);

  const settingsResource = useAsyncResource<WalletSettingsData>({}, {
    enabled: settingsRequested && typeof configData.configType === 'string',
    deps: [configData.configType],
    load: async (patch, isCurrent) => {
      const revision = settingsRevision.current;
      await loadWalletSettings(String(configData.configType), patch, () => isCurrent() && revision === settingsRevision.current);
    },
  });
  const patchSettingsData = settingsResource.patch;
  const ensureSettings = useCallback(() => setSettingsRequested(true), []);
  const patchSettings = useCallback((next: Partial<WalletSettingsData>) => {
    settingsRevision.current++;
    patchSettingsData(next);
  }, [patchSettingsData]);

  const markDisconnected = useCallback(() => {
    intent.current++;
    settingsRevision.current++;
    setSettingsRequested(false);
    patchSettingsData({alias:undefined,threshold:undefined,nwcUri:undefined,address:undefined});
    patchConfig({ configType: false, cachedBalance: undefined, cachedTransactions: [] });
    patchBalance({ balance: null });
  }, [patchConfig, patchBalance, patchSettingsData]);

  useStorageWatch([{area:'local',keys:[walletDisplayKey(accountId)]}], () => {
    void readWalletDisplayCache(accountId).then(snapshot => { if (snapshot?.providerType === false) markDisconnected(); }).catch(() => {});
  });

  // A read made while locked may have failed without changing configType. The
  // unchanged provider type cannot trigger the resources' dependency effects.
  useStorageWatch([{ area: 'local', keys: [LOCK_STATE_KEY] }], () => {
    intent.current++;
    settingsRevision.current++;
    patchConfig({ cachedBalance: undefined, cachedTransactions: [] });
    patchBalance({ balance: null });
    patchSettingsData({alias:undefined,threshold:undefined,nwcUri:undefined,address:undefined});
    if (!enabled) return;
    void refreshConfig();
    if (typeof configData.configType === 'string') {
      void refreshBalance();
      if (settingsRequested) void settingsResource.refresh();
    }
  });

  const value = useMemo<WalletContextValue>(() => ({
    configType: configData.configType,
    settings: settingsResource.data,
    settingsLoading: settingsResource.loading || !settingsRequested,
    settingsError: settingsResource.error,
    ensureSettings,
    refreshSettings: settingsResource.refresh,
    patchSettings,
    configReadFailed: !!configError && configData.configType !== false,
    configLoading,
    cachedTransactions: configData.cachedTransactions || [],
    balance: balanceData.balance ?? configData.cachedBalance ?? null,
    balanceLoading,
    balanceError,
    refreshConfig,
    refreshBalance,
    markDisconnected,
  }), [configData, settingsResource.data, settingsResource.loading, settingsResource.error,
    settingsResource.refresh, settingsRequested, ensureSettings, patchSettings, configError,
    configLoading, balanceData, balanceLoading, balanceError, refreshConfig, refreshBalance, markDisconnected]);

  useLayoutEffect(() => publish(value), [publish, value]);
  return null;
}

export { useWallet };

/** Hydrate locally before starting the presence check. A refresh cannot erase a known wallet. */
export async function loadWalletDisplay(
  accountId: string,
  patch: (next: Partial<ConfigData>) => void,
  isCurrent: () => boolean,
  read: () => Promise<WalletDisplayCache | null> = () => readWalletDisplayCache(accountId),
  check: () => Promise<string | false> = () => rpc<string | false>('wallet_hasConfig'),
): Promise<void> {
  const cached = await read().catch(() => null);
  if (!isCurrent()) return;
  if (cached) patch({configType:cached.providerType,cachedBalance:cached.balance,cachedTransactions:cached.transactions});
  const result = await check();
  if (!isCurrent()) return;
  if (!result && cached?.providerType) throw new Error(t('wallet.checkFailed'));
  patch({configType:result});
}

/** Independent reads never turn failures into missing settings or hold a fast field behind a slow one. */
export async function loadWalletSettings(
  providerType: string,
  patch: (next: Partial<WalletSettingsData>) => void,
  isCurrent: () => boolean,
  request: (method: string) => Promise<unknown> = rpc,
): Promise<void> {
  const reads: Array<[string, (value: any) => Partial<WalletSettingsData>]> = [
    ['wallet_getInfo', value => ({alias:value.alias || ''})],
    ['wallet_getAutoApproveThreshold', value => ({threshold:value})],
    ['wallet_getLightningAddress', value => ({address:value.address})],
  ];
  if (providerType === 'lnbits') reads.push(
    ['wallet_getNwcUri', value => ({nwcUri:value})],
  );
  const results = await Promise.allSettled(reads.map(async ([method, convert]) => {
    const value = await request(method);
    if (isCurrent()) patch(convert(value));
  }));
  const failed = results.find(result => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}
