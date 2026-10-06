import { useState } from 'react';
import type { ArchiveSettings } from '@domain/archive/types.ts';
import { archiveRelays, archiveRelayUrl, archiveRelaySuggestions } from '@domain/archive/settings.ts';
import { MAX_ARCHIVE_GROUP_NAME_LENGTH, MAX_ARCHIVE_GROUPS } from '@constants/archive.ts';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import OverlayPanel from '@components/OverlayPanel';
import Container from '@components/Container';
import Text from '@components/Text';
import Toggle from '@components/Toggle';
import Dropdown from '@components/Dropdown';
import Input from '@components/Input';
import EditableList from '@components/EditableList';
import Button from '@components/Button';
import Modal from '@components/Modal';
import FormError from '@components/FormError';

interface Props {
  accountId: string;
  settings: ArchiveSettings;
  disabled: boolean;
  busy: boolean;
  error: string;
  onBack: () => void;
  onSave: (settings: ArchiveSettings) => Promise<boolean>;
}

export default function ArchiveSettingsScreen({
  accountId,
  settings,
  disabled,
  busy,
  error,
  onBack,
  onSave,
}: Props) {
  const [groupRelays, setGroupRelays] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState('');
  const controlsDisabled = disabled || discovering;
  const saveRelays = (relays: string[]) => {
    const id = settings.selectedGroupId || 'profile';
    const existing = settings.groups.find((group) => group.id === id);
    const group = { id, name: existing?.name || t('archive.profileGroup'), relays };
    return onSave({
      ...settings,
      automatic: relays.length ? settings.automatic : false,
      selectedGroupId: id,
      groups: [...settings.groups.filter((item) => item.id !== id), group],
    });
  };
  async function loadProfileRelays() {
    setDiscovering(true);
    setDiscoveryError('');
    try {
      const sources = await rpc<{ relays: string[]; messageRelays: string[] }>('archive_sources', {
        accountId,
      });
      const id = settings.selectedGroupId || 'profile';
      const group = {
        id,
        name: settings.groups.find((item) => item.id === id)?.name || t('archive.profileGroup'),
        relays: [...new Set([...sources.relays, ...sources.messageRelays])],
      };
      await onSave({
        ...settings,
        groups: [...settings.groups.filter((item) => item.id !== id), group],
        selectedGroupId: id,
      });
    } catch (cause) {
      setDiscoveryError((cause as Error).message);
    } finally {
      setDiscovering(false);
    }
  }
  const relayEditor = (items: string[], onChange: (items: string[]) => void) => (
    <EditableList
      collapseAdd
      suggestions={archiveRelaySuggestions(settings)}
      label={t('archive.relayUrls')}
      items={items}
      placeholder="wss://relay.example.com"
      buttonLabel={t('common.add')}
      disabled={controlsDisabled}
      validate={(value) => {
        try {
          return archiveRelayUrl(value);
        } catch {
          return null;
        }
      }}
      invalidMsg={t('archive.invalidRelay')}
      onAdd={(relay) => onChange([...items, relay])}
      onRemove={(relay) => onChange(items.filter((item) => item !== relay))}
    />
  );
  return (
    <OverlayPanel title={t('archive.settings')} onBack={busy || discovering ? null : onBack} zIndex={400}>
      <Container gap={6} className="overflow-y-auto min-h-0 pb-6">
        <Container variant="row" className="justify-between">
          <Text>{t('archive.includeMessages')}</Text>
          <Toggle
            aria-label={t('archive.includeMessages')}
            checked={settings.includeMessages}
            disabled={controlsDisabled}
            onChange={(value) => void onSave({ ...settings, includeMessages: value })}
          />
        </Container>
        <Text variant="muted">{t('archive.authHint')}</Text>
        <Dropdown
          aria-label={t('archive.group')}
          value={settings.selectedGroupId}
          disabled={controlsDisabled}
          options={[
            ...settings.groups.map((group) => ({
              value: group.id,
              label: group.id === 'profile' ? t('archive.defaultGroup') : group.name,
            })),
            {
              value: '__create__',
              label: t('archive.newGroup'),
              disabled: settings.groups.length >= MAX_ARCHIVE_GROUPS,
            },
          ]}
          onChange={(id) => {
            if (id === '__create__') {
              setName('');
              setGroupRelays([]);
              setCreating(true);
              return;
            }
            void onSave({
              ...settings,
              selectedGroupId: id,
              automatic:
                settings.automatic && !!settings.groups.find((group) => group.id === id)?.relays.length,
            });
          }}
        />
        {relayEditor(archiveRelays(settings), (relays) => void saveRelays(relays))}
        <Button variant="secondary" disabled={controlsDisabled} onClick={() => void loadProfileRelays()}>
          {t('archive.fromProfile')}
        </Button>
        <FormError>{error || discoveryError}</FormError>
      </Container>
      {creating && (
        <Modal
          zIndex={500}
          title={t('archive.newGroup')}
          onClose={() => {
            if (!busy) setCreating(false);
          }}
          footer={
            <Button
              disabled={controlsDisabled || !name.trim()}
              onClick={() => {
                const group = { id: crypto.randomUUID(), name: name.trim(), relays: groupRelays };
                void onSave({
                  ...settings,
                  groups: [...settings.groups, group],
                  selectedGroupId: group.id,
                  automatic: settings.automatic && group.relays.length > 0,
                }).then((saved) => {
                  if (saved) setCreating(false);
                });
              }}
            >
              {t('archive.createGroup')}
            </Button>
          }
        >
          <Input
            label={t('archive.groupName')}
            value={name}
            maxLength={MAX_ARCHIVE_GROUP_NAME_LENGTH}
            disabled={controlsDisabled}
            onChange={(event) => setName(event.target.value)}
          />
          {relayEditor(groupRelays, setGroupRelays)}
          <FormError>{error}</FormError>
        </Modal>
      )}
    </OverlayPanel>
  );
}
