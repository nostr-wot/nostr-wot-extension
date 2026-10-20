import Button from '@components/Button';
import Text from '@components/Text';
import FormError from '@components/FormError';
import { t } from '@services/i18n/i18n';

export default function ArchiveMessageContent({ plaintext, loading, error, onReveal }: { plaintext?: string; loading?: boolean; error?: string; onReveal: () => void }) {
  return <div>
    {plaintext !== undefined ? <Text className="whitespace-pre-wrap break-words">{plaintext}</Text> : <Button variant="secondary" type="button" disabled={loading} aria-label={t('archive.explorer.decrypt')} title={t('archive.explorer.decrypt')} onClick={onReveal} className="relative w-full">
      <span aria-hidden="true" className="block blur-sm select-none">{t('archive.explorer.encrypted')}</span>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold">{t(loading ? 'common.loading' : 'archive.explorer.decrypt')}</span>
    </Button>}
    <FormError>{error}</FormError>
  </div>;
}
