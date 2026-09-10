import { useState } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import { formatPermissionLabel } from '@services/i18n/permissionLabels.ts';
import { truncateNpub } from '@domain/nostr/display.ts';
import type { SigningRejection } from '@domain/signing/rejection.ts';
import { SIGNER_REJECTIONS_KEY } from '@constants/signing.ts';
import useAsyncResource from '@hooks/useAsyncResource.ts';
import useStorageWatch from '@hooks/useStorageWatch.ts';
import Modal from '@components/Modal';
import Button from '@components/Button';
import Container from '@components/Container';
import Text from '@components/Text';
import Card from '@components/Card';
import FieldDisplay from '@components/FieldDisplay';
import FormError from '@components/FormError';

export function RejectionList({ items }: { items: SigningRejection[] }) {
  return <Container gap={4}>
    <Text>{t('approval.accountMismatchReason')}</Text>
    {items.map(item => <Card key={item.id}>
      <FieldDisplay label={item.origin} value={formatPermissionLabel('signEvent:' + item.kind)} />
      <FieldDisplay label={t('approval.requestedAccount')} value={truncateNpub(item.requestedPubkey)} mono />
      {item.activePubkey && <FieldDisplay label={t('approval.extensionAccount')} value={truncateNpub(item.activePubkey)} mono />}
      <Text variant="hint">{new Date(item.timestamp).toLocaleString()}</Text>
    </Card>)}
  </Container>;
}

export default function RejectionNotice() {
  const { data, refresh } = useAsyncResource<{ items: SigningRejection[] }>({ items: [] }, {
    load: async (patch, current) => {
      const items = await rpc<SigningRejection[]>('signer_getRejections');
      if (current()) patch({ items: items || [] });
    },
  });
  useStorageWatch([{ area: 'local', keys: [SIGNER_REJECTIONS_KEY] }], refresh);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const acknowledge = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await rpc('signer_acknowledgeRejections', { ids: data.items.map(item => item.id) });
      await refresh();
    } catch { setError(t('common.error')); }
    finally { setBusy(false); }
  };
  if (!data.items.length) return null;
  return <Modal title={t('approval.rejectedRequests', { count: data.items.length })}
    onClose={() => { void acknowledge(); }} dismissOnBackdrop={false}
    footer={<Button disabled={busy} onClick={acknowledge}>{t('common.close')}</Button>}>
    <RejectionList items={data.items} />
    <FormError>{error}</FormError>
  </Modal>;
}
