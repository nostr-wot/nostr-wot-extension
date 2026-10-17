import { useState } from 'react';
import '@styles/tailwind.css';
import { AccountProvider, useAccount } from '@context/AccountContext';
import { VaultProvider, useVault } from '@context/VaultContext';
import useArchive from '@hooks/useArchive';
import ArchiveExplorerScreen from '@screens/Archive/ArchiveExplorerScreen';
import UnlockModal from '@screens/Vault/UnlockModal';
import Dropdown from '@components/Dropdown';
import Text from '@components/Text';
import Button from '@components/Button';
import FormError from '@components/FormError';
import Spinner from '@components/Spinner';
import IconButton from '@components/IconButton';
import IconLock from '@assets/IconLock';
import { t } from '@services/i18n/i18n';

function AccountExplorer({ accountId }: { accountId: string }) {
  const { state, error, refresh } = useArchive(accountId);
  if (!state) return <div className="p-12"><Spinner /><FormError>{error}</FormError>{error && <Button onClick={() => void refresh()}>{t('common.retry')}</Button>}</div>;
  return <ArchiveExplorerScreen accountId={accountId} total={state.count} onChanged={refresh} />;
}
function ArchivePage() {
  const { accounts, activeId } = useAccount();
  const vault = useVault();
  const [selected, setSelected] = useState(() => new URLSearchParams(window.location.search).get('accountId'));
  const accountId = accounts?.some(account => account.id === selected) ? selected : activeId;
  return <div className="h-screen flex flex-col bg-elevated text-heading overflow-hidden">
    <header className="shrink-0 border-b border-card-border px-8 py-5">
      <div className="max-w-[1400px] mx-auto flex items-center justify-between gap-6">
        <Text className="font-semibold text-brand">Nostr WoT</Text>
        <div className="flex items-center gap-4 min-w-0">
          {!!accounts?.length && <Dropdown aria-label={t('archive.explorer.account')} value={accountId || ''} disabled={vault.locked} options={accounts.map(account => ({ value: account.id, label: account.name || `${account.pubkey.slice(0, 8)}…` }))} onChange={id => setSelected(id)} />}
          {!vault.locked && <IconButton title={t('archive.explorer.lock')} aria-label={t('archive.explorer.lock')} onClick={() => void vault.lock()}><IconLock /></IconButton>}
        </div>
      </div>
    </header>
    <div className="flex-1 min-h-0 overflow-y-auto">
      {!accounts ? <div className="p-12"><Spinner /></div> : !accounts.length ? <div className="p-12"><Text>{t('archive.noAccount')}</Text></div> : !vault.locked && accountId ? <AccountExplorer key={accountId} accountId={accountId} /> : null}
    </div>
    {vault.locked && !!accounts?.length && <UnlockModal visible fullScreen />}
  </div>;
}
export default function ArchiveApp() {
  return <AccountProvider><VaultProvider><ArchivePage /></VaultProvider></AccountProvider>;
}
