import { useState } from 'react';
import { t } from '@services/i18n/i18n.ts';
import { truncateNpub } from '@domain/nostr/display.ts';
import OverlayPanel from '@components/OverlayPanel';
import Button from '@components/Button';
import InputRow from '@components/InputRow';
import EditableList from '@components/EditableList';
import EmptyState from '@components/EmptyState';
import PublishRow from '@components/PublishRow';
import { SectionLabel } from '@components/SectionLabel';
import { muteListState, toHexPubkey, normalizeHashtag, type MyMuteList } from '@domain/mutes/muteList.ts';
import { useAccount } from '@context/AccountContext';
import IconButton from '@components/IconButton';
import Modal from '@components/Modal';
import IconInfo from '@assets/IconInfo.tsx';
import Container from '@components/Container';
import Text from '@components/Text';

import useMuteListEditor from './useMuteListEditor';
import { mergeUnique } from '@utils/collections.ts';

interface FiltersOverlayProps {
  visible: boolean;
  onClose: () => void;
}

export default function FiltersOverlay({ visible, onClose }: FiltersOverlayProps) {
  const { active } = useAccount();
  return visible ? <MuteEditor key={active?.id ?? 'none'} onClose={onClose} /> : null;
}

function MuteEditor({ onClose }: Pick<FiltersOverlayProps, 'onClose'>) {
  const [showInfo, setShowInfo] = useState(false);
  const { list, loading, readFailed, dirty, publishing, publishResult, importValue, importError,
    importing, busy, reload, update, handleImport, handlePublish, changeImport } = useMuteListEditor();
  const cur: MyMuteList = list || { people: [], hashtags: [], words: [], events: [], rawContent: '', createdAt: 0 };
  const readState = muteListState(list);
  return (
    <OverlayPanel title={t('mutes.title')} onBack={onClose}
      headerRight={<IconButton size="large" aria-label={t('mutes.aboutTitle')} onClick={() => setShowInfo(true)}><IconInfo size={18} /></IconButton>}>
      {showInfo && <Modal title={t('mutes.aboutTitle')} onClose={() => setShowInfo(false)}
        footer={<Button onClick={() => setShowInfo(false)}>{t('common.gotIt')}</Button>}>
        <Text as="p" className="leading-normal">{t('mutes.aboutBody')}</Text>
      </Modal>}
      <Container className="flex-1 overflow-y-auto gap-8">
        {loading ? (
          <EmptyState text={t('common.loading')} />
        ) : readFailed ? (
          <EmptyState text={t('mutes.readFailed')}>
            <Button small onClick={reload}>
              {t('common.retry')}
            </Button>
          </EmptyState>
        ) : (
          <>
            {(readState === 'missing' || readState === 'empty' || readState === 'private') && (
              <div role="status" className="rounded-md border border-card-border bg-card px-6 py-5 text-sm text-secondary leading-normal">
                {readState === 'missing' ? t('mutes.ownListMissing') : readState === 'private' ? t('mutes.privateOnly') : t('mutes.emptyList')}
              </div>
            )}
            {(['people', 'words', 'hashtags'] as const).map(field => (
              <EditableList key={field}
                label={t(`mutes.${field}`)} hint={t(`mutes.${field}Hint`)}
                placeholder={t(`mutes.${field}Placeholder`)} buttonLabel={t('common.add')}
                items={cur[field]} disabled={busy}
                renderItem={field === 'people' ? truncateNpub : undefined}
                validate={field === 'people' ? toHexPubkey : field === 'hashtags' ? normalizeHashtag : raw => raw.toLowerCase()}
                invalidMsg={field === 'people' ? t('mutes.invalidPubkey') : undefined}
                onAdd={value => update({ [field]: mergeUnique(cur[field], [value]) })}
                onRemove={value => update({ [field]: cur[field].filter(item => item !== value) })}
              />
            ))}

            <Container gap={3}>
              <SectionLabel>{t('mutes.importTitle')}</SectionLabel>
              <InputRow
                value={importValue}
                onChange={(e) => changeImport(e.target.value)}
                placeholder={t('mutes.importPlaceholder')}
                onSubmit={handleImport}
                buttonLabel={importing ? t('common.fetching') : t('mutes.importButton')}
                disabled={importing || publishing || !toHexPubkey(importValue)}
                error={importError}
                mono
              />
              <Text variant="muted" as="div" className="leading-tight">{t('mutes.importHint')}</Text>
            </Container>

            <PublishRow
              disabled={!dirty || importing}
              publishing={publishing}
              status={publishResult}
              dirty={dirty}
              labels={{
                idle: cur.createdAt > 0 ? t('mutes.published') : t('mutes.notPublished'),
                unsaved: t('mutes.unsaved'),
                success: t('mutes.published'),
                error: t('mutes.publishFailed'),
                publishing: t('common.publishing'),
              }}
              onPublish={handlePublish}
            />
          </>
        )}
      </Container>
    </OverlayPanel>
  );
}
