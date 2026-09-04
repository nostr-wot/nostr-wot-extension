import { t } from '@lib/i18n.js';
import Toggle from '@components/Toggle/Toggle';
import Card from '@components/Card/Card';
import ListRow from '@components/ListRow/ListRow';
import { IconUser, IconChevronRight } from '@assets';
import { useNavigate } from '@context/NavigationContext';
import Container from '@components/Container/Container';
import Text from '@components/Text/Text';

interface SiteControlsProps {
  identityEnabled: boolean;
  isNip46?: boolean;
  onIdentityToggle: (checked: boolean) => void;
  // The site these rows act on — not itself a destination, so it is a plain
  // prop rather than something NavigationContext should know about.
  domain: string | null;
}

export default function SiteControls({
  identityEnabled,
  isNip46,
  onIdentityToggle,
  domain,
}: SiteControlsProps) {
  const navigate = useNavigate();
  return (
    <Card className="p-0 overflow-hidden">
      <Container variant="row" className="justify-between py-[11px] px-7">
        <Container variant="row" gap={4}>
          <IconUser size={15} className="text-brand shrink-0" />
          <Text as="span" className="font-medium">{t('home.allowIdentity')}</Text>
        </Container>
        <Toggle checked={identityEnabled} onChange={onIdentityToggle} />
      </Container>

      {isNip46 ? (
        <Text variant="muted" as="div" className="py-5 px-7 text-sm font-medium italic">
          <span>{t('perms.managedBySigner')}</span>
        </Text>
      ) : (
        <ListRow
          title={t('home.managePermissions')}
          trailing={<IconChevronRight size={14} />}
          onClick={() => navigate.managePermissions(domain!)}
        />
      )}

      <ListRow
        title={t('home.recentActivity')}
        trailing={<IconChevronRight size={14} />}
        onClick={() => navigate.viewAllActivity(domain)}
      />
    </Card>
  );
}
