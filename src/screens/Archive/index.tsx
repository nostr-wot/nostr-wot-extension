import browser from '@lib/browser';
import IconSearch from '@assets/IconSearch';
import { ARCHIVE_INTERVAL_OPTIONS } from '@constants/archive.ts';
import { formatBytes } from '@utils/format/bytes.ts';
import { useState, useRef, useId } from 'react';
import { useAccount } from '@context/AccountContext';
import useArchive from '@hooks/useArchive.ts';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import { archiveRelayUrls, archiveRelays, archiveRelaySuggestions } from '@domain/archive/settings.ts';
import type { ArchiveSettings } from '@domain/archive/types.ts';
import { relayAuthenticationError, relayAuthConfigurationError } from '@domain/relays/authenticationErrors.ts';
import InfoTooltip from '@components/InfoTooltip';
import Spinner from '@components/Spinner';
import Modal from '@components/Modal';
import CopyButton from '@components/CopyButton';
import { archiveRelayResults, archiveResultStatus } from '@domain/archive/results';
import Button from '@components/Button';
import IconButton from '@components/IconButton';
import IconSettings from '@assets/IconSettings';
import IconSync from '@assets/IconSync';
import IconPause from '@assets/IconPause';
import IconTrash from '@assets/IconTrash';
import Card from '@components/Card';
import Container from '@components/Container';
import Text from '@components/Text';
import Input from '@components/Input';
import Heading from '@components/Heading';
import ArchiveSettingsScreen from './ArchiveSettingsScreen';
import Dropdown from '@components/Dropdown';
import Toggle from '@components/Toggle';
import ConfirmDialog from '@components/ConfirmDialog';
import FormError from '@components/FormError';
import ArchiveFiles from './ArchiveFiles';

export default function ArchiveSection() {
  const { active } = useAccount();
  return active ? (
    <AccountArchive key={active.id} accountId={active.id} />
  ) : (
    <Text>{t('archive.noAccount')}</Text>
  );
}

export function AccountArchive({ accountId }: { accountId: string }) {
  const { state, running, loading, error: readError, refresh } = useArchive(accountId);
  const [busy, setBusy] = useState(false);
  const retryRequests = useRef(new Set<string>());
  const [retrying, setRetrying] = useState<string[]>([]);
  async function retryRelay(relay: string) {
    if (retryRequests.current.has(relay)) return;
    retryRequests.current.add(relay);
    setRetrying([...retryRequests.current]);
    setError('');
    try {
      await rpc('archive_sync', { accountId, relay });
      await refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      retryRequests.current.delete(relay);
      setRetrying([...retryRequests.current]);
    }
  }
  const [error, setError] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [showFailures, setShowFailures] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const relayListId = useId();
  const [destination, setDestination] = useState('');
  const [messages, setMessages] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [confirmation, setConfirmation] = useState<'clear' | 'copy' | null>(null);
  const [preview, setPreview] = useState<{ eligible: number; skipped: number } | null>(null);
  async function action(work: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await work();
      await refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const save = (settings: ArchiveSettings) => rpc('archive_configure', { accountId, settings });
  if (!state)
    return (
      <Container gap={4}>
        <Text>{loading ? t('common.loading') : t('archive.unavailable')}</Text>
        <FormError>{readError}</FormError>
        <Button onClick={() => void refresh()}>{t('common.retry')}</Button>
      </Container>
    );
  const settings = state.settings;
  const results =
    state.progress.relayResults ??
    archiveRelayResults(archiveRelays(settings), settings.includeMessages, state.checkpoints);
  const migration = state.progress.phase === 'copying' || !!state.copyResult;
  const syncing = running && !migration;
  const hasResults = results.length > 0;
  const resultStatus = archiveResultStatus(results);
  const statusLabel = !migration && (running || ['locked', 'paused'].includes(state.progress.phase))
    ? t(`archive.phase.${state.progress.phase}`)
    : t(`archive.status.${!migration && state.progress.phase === 'error' ? 'error' : resultStatus}`);
  const hasErrors = (!migration && state.progress.phase === 'error') || results.some(result => result.errors.length > 0);
  const disabled = busy || running || state.progress.phase === 'locked';
  const toggle = (key: 'automatic', label: string) => (
    <Container variant="row" className="justify-between">
      <Text>{t(`archive.${label}`)}</Text>
      <Toggle
        aria-label={t(`archive.${label}`)}
        checked={!!settings[key]}
        disabled={disabled || !archiveRelays(settings).length}
        onChange={(value) => void action(() => save({ ...settings, [key]: value }))}
      />
    </Container>
  );
  return (
    <Container gap={6} className="p-2">
      <Text variant="muted">{t('archive.localWarning')}</Text>
      <Card className="flex flex-col gap-5 mb-0">
        {toggle('automatic', 'automaticArchive')}
        {settings.automatic && (
          <Dropdown
            aria-label={t('archive.frequency')}
            value={String(settings.intervalMinutes)}
            disabled={disabled}
            options={ARCHIVE_INTERVAL_OPTIONS.map((option) => ({
              value: String(option.minutes),
              label: t(option.label),
            }))}
            onChange={(value) => void action(() => save({ ...settings, intervalMinutes: Number(value) }))}
          />
        )}
        <Text>
          {t('archive.count', { count: state.count.toLocaleString(), bytes: formatBytes(state.bytes) })}
        </Text>
        {!migration && <Text variant="secondary">
          {t('archive.lastFinished')}:{' '}
          {state.progress.finishedAt
            ? new Date(state.progress.finishedAt).toLocaleString()
            : t('archive.never')}
        </Text>}
        {hasResults || syncing ? (
          <Container variant="row" className="justify-between">
            {syncing && <Spinner />}
            <Text role="status" className={syncing ? 'text-brand' : hasErrors ? 'text-error' : resultStatus === 'complete' ? 'text-success' : resultStatus === 'incomplete' ? 'text-warning' : 'text-secondary'}>{statusLabel}</Text>
            <Button variant="secondary" small onClick={() => setShowDetails(true)}>
              {t('archive.details')}
            </Button>
          </Container>
        ) : (
          <FormError>{!migration && state.progress.error}</FormError>
        )}
        <ArchiveFiles
          accountId={accountId}
          disabled={disabled}
          onChanged={refresh}
          leadingAction={
            <>
            <IconButton
              size="large"
              tone="brand"
              title={t(syncing ? 'archive.pause' : 'archive.sync')}
              aria-label={t(syncing ? 'archive.pause' : 'archive.sync')}
              disabled={syncing ? busy : disabled || !archiveRelays(settings).length}
              onClick={() =>
                void action(() => rpc(syncing ? 'archive_pause' : 'archive_sync', { accountId }))
              }
            >
              {syncing ? <IconPause aria-hidden="true" /> : <IconSync aria-hidden="true" />}
            </IconButton>
            {state.count > 0 && <IconButton size="large" tone="brand" title={t('archive.explorer.title')} aria-label={t('archive.explorer.title')} onClick={() => void action(() => browser.tabs.create({ url: browser.runtime.getURL(`src/entrypoints/archive/index.html?accountId=${encodeURIComponent(accountId)}`) }))}><IconSearch aria-hidden="true" /></IconButton>}
            <IconButton size="large" tone="brand" title={t('archive.settings')} aria-label={t('archive.settings')} onClick={() => setShowSettings(true)}>
              <IconSettings aria-hidden="true" />
            </IconButton>
            </>
          }
          trailingAction={
            <IconButton
              size="large"
              tone="danger"
              title={t('archive.clear')}
              aria-label={t('archive.clear')}
              disabled={disabled}
              onClick={() => {
                setError('');
                setConfirmation('clear');
              }}
            >
              <IconTrash aria-hidden="true" />
            </IconButton>
          }
        />
      </Card>
      {showDetails && (
        <Modal
          title={t('archive.details')}
          onClose={() => setShowDetails(false)}
          footer={
            <Button
              onClick={() => {
                setShowDetails(false);
                setShowSettings(true);
              }}
            >
              {t('archive.changeRelays')}
            </Button>
          }
        >
          <Container gap={5}>
            <Text>{t('archive.databaseSize', { bytes: formatBytes(state.bytes) })}<InfoTooltip text={t('archive.resultsHelp')} size={16} /></Text>
            <FormError>{!migration && state.progress.error}</FormError>
            <table className="w-full text-sm border-collapse text-left table-fixed">
              <thead>
                <tr className="border-b border-card-border">
                  <th scope="col" className="pb-3 w-[43%]">
                    {t('archive.relayColumn')}
                  </th>
                  <th scope="col" className="pb-3 w-[15%]">
                    {t('archive.eventsColumn')}
                  </th>
                  <th scope="col" className="pb-3">
                    {t('archive.resultColumn')}
                  </th>
                  <th scope="col" className="w-14"><span className="sr-only">{t('archive.details')}</span></th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => {
                  const pending = running && !!state.pendingRelays?.includes(result.relay);
                  const active = pending && (state.progress.activeRelays?.includes(result.relay) ?? state.progress.relay === result.relay);
                  const status = archiveResultStatus([result]);
                  const reauth = result.errors.some(relayAuthenticationError) && !result.errors.some(relayAuthConfigurationError);
                  const color = pending ? 'text-brand' : result.errors.length ? 'text-error' : status === 'complete' ? 'text-success' : status === 'incomplete' ? 'text-warning' : 'text-secondary';
                  return (
                  <tr key={result.relay} className="border-b border-card-border align-top">
                    <td className="py-3 pr-2">
                      <Text className={`break-all text-sm ${color}`}>{result.relay}</Text>
                    </td>
                    <td className="py-3">
                      {result.fetched === undefined ? (result.attempted === false ? '0' : '—') : result.fetched.toLocaleString()}
                    </td>
                    <td className="py-3">
                      {active && <Spinner size={16} className="mb-2" />}
                      <Text className={`text-xs break-words ${color}`}>
                        {t(pending ? (active ? 'archive.phase.syncing' : 'archive.queued') : `archive.status.${status}`)}
                      </Text>
                    </td>
                    <td className="py-3">
                      <div className="flex items-center justify-end gap-2">
                        {!!result.errors.length && <InfoTooltip text={result.errors.join(' · ')} size={16} />}
                      {!result.success && (
                        <IconButton
                          size="small"
                          tone="brand"
                          title={t(reauth ? 'archive.reauthenticate' : 'archive.retryRelay')}
                          aria-label={t(reauth ? 'archive.reauthenticate' : 'archive.retryRelay')}
                          disabled={busy || state.progress.phase === 'locked' || state.progress.phase === 'copying' || retrying.includes(result.relay) || state.pendingRelays?.includes(result.relay) || !archiveRelays(settings).includes(result.relay)}
                          onClick={() =>
                            void retryRelay(result.relay)
                          }
                        >
                          <IconSync aria-hidden="true" />
                        </IconButton>
                      )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
            <FormError>{error}</FormError>
          </Container>
        </Modal>
      )}
      {showSettings && (
        <ArchiveSettingsScreen
          settings={settings}
          disabled={disabled}
          busy={busy}
          error={error}
          accountId={accountId}
          onBack={() => {
            setShowSettings(false);
            setError('');
          }}
          onSave={(next) => action(() => save(next))}
        />
      )}
      {state.count > 0 && (
        <Card className="flex flex-col gap-5 mb-0">
          <Heading as="h2">{t('archive.copy')}</Heading>
          {migration && <Container gap={3} aria-live="polite">
            <Container variant="row" className="justify-between">
              {running && <Spinner />}
              <Text role="status" className={running ? 'text-brand' : state.progress.phase === 'error' || state.copyResult?.failed ? 'text-error' : state.progress.phase === 'complete' ? 'text-success' : 'text-secondary'}>{t(state.progress.phase === 'error' ? 'archive.status.error' : state.progress.phase === 'partial' ? 'archive.status.incomplete' : `archive.phase.${state.progress.phase}`)}</Text>
              {running && <IconButton tone="brand" title={t('archive.pause')} aria-label={t('archive.pause')} disabled={busy} onClick={() => void action(() => rpc('archive_pause', { accountId }))}><IconPause aria-hidden="true" /></IconButton>}
            </Container>
            {state.copyResult && <Text>{t('archive.copyResult', { accepted: state.copyResult.accepted, existing: state.copyResult.existing, failed: state.copyResult.failed, skipped: state.copyResult.skipped })}</Text>}
            {!!state.copyResult?.failures?.length && <Button small onClick={() => setShowFailures(true)}>{t('archive.failedEvents')}</Button>}
            <FormError>{state.progress.error}</FormError>
          </Container>}

          <Input
            list={relayListId}
            disabled={disabled}
            label={t('archive.destination')}
            value={destination}
            onChange={(event) => {
              setDestination(event.target.value);
              setPreview(null);
            }}
          />
          <datalist id={relayListId}>{archiveRelaySuggestions(settings).map(relay => <option key={relay} value={relay} />)}</datalist>
          <Container variant="row" className="justify-between">
            <Text>{t('archive.copyMessages')}</Text>
            <Toggle
              disabled={disabled}
              aria-label={t('archive.copyMessages')}
              checked={messages}
              onChange={(value) => {
                setMessages(value);
                setPreview(null);
              }}
            />
          </Container>
          <Container variant="row" className="justify-between">
            <Text>{t('archive.copyUnknown')}</Text>
            <Toggle
              disabled={disabled}
              aria-label={t('archive.copyUnknown')}
              checked={unknown}
              onChange={(value) => {
                setUnknown(value);
                setPreview(null);
              }}
            />
          </Container>
          <Text variant="muted">{t('archive.copyWarning')}</Text>
          <Button
            disabled={disabled || !destination.trim()}
            onClick={() =>
              void action(async () => {
                if (archiveRelayUrls(destination).length !== 1) throw new Error(t('archive.invalidRelay'));
                setPreview(
                  await rpc('archive_copyPreview', {
                    accountId,
                    relay: destination.trim(),
                    includeMessages: messages,
                    includeUnknown: unknown,
                  }),
                );
                setConfirmation('copy');
              })
            }
          >
            {busy ? t('common.loading') : t('archive.preview')}
          </Button>
        </Card>
      )}
      <FormError>{error || readError}</FormError>
      {showFailures && (
        <Modal title={t('archive.failedEvents')} onClose={() => setShowFailures(false)}>
          <Container gap={4}>
            <Text variant="muted">{t('archive.retryHelp')}</Text>
            {state.copyResult?.failures?.map(failure => (
              <Card key={failure.id} className="flex flex-col gap-3 mb-0">
                <Text>{t('archive.failedEventKind', { kind: failure.kind })} · {new Date(failure.createdAt * 1000).toLocaleString()}</Text>
                <Container variant="row">
                  <Text className="text-brand text-xs break-all font-mono">{failure.id}</Text>
                  <CopyButton value={failure.id} label={t('common.copy')} iconOnly />
                </Container>
                <Text className="text-error break-words">{failure.message}</Text>
                <Text variant="muted">{t('archive.publishAttempts', { count: failure.attempts })}</Text>
              </Card>
            ))}
          </Container>
        </Modal>
      )}
      {confirmation && (
        <ConfirmDialog
          title={t(`archive.${confirmation}`)}
          danger={confirmation === 'clear'}
          busy={busy}
          error={error}
          message={
            confirmation === 'clear' ? (
              t('archive.clearWarning')
            ) : (
              <>
                <Text>{destination}</Text>
                <Text>
                  {t('archive.previewCount', {
                    count: preview?.eligible || 0,
                    skipped: preview?.skipped || 0,
                  })}
                </Text>
                <Text>{t('archive.copyWarning')}</Text>
                {messages && <Text>{t('archive.messageWarning')}</Text>}
                {unknown && <Text>{t('archive.unknownWarning')}</Text>}
              </>
            )
          }
          onCancel={() => setConfirmation(null)}
          onConfirm={() =>
            void action(async () => {
              await rpc(confirmation === 'clear' ? 'archive_clear' : 'archive_copy', {
                accountId,
                relay: destination.trim(),
                includeMessages: messages,
                includeUnknown: unknown,
              });
              setConfirmation(null);
            })
          }
        />
      )}
    </Container>
  );
}
