import Text from '@components/Text';
import { t } from '@services/i18n/i18n.ts';
import Heading from '@components/Heading';

export default function RepostPreview() {
  return (
    <>
      <Heading level={5} as="h3" className="m-0 mb-4">{t('event.repost')}</Heading>
      <Text variant="hint" className="text-sm italic mt-2">{t('event.repostingNote')}</Text>
    </>
  );
}
