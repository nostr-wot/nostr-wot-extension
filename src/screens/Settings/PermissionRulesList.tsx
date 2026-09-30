import { useState } from 'react';
import { t } from '@services/i18n/i18n';
import { formatPermissionLabel } from '@services/i18n/permissionLabels';
import { DECISIONS } from '@constants/permissions';
import ActionMenu from '@components/ActionMenu';
import Card from '@components/Card';
import Chip from '@components/Chip';
import Container from '@components/Container';
import Text from '@components/Text';
import FormError from '@components/FormError';

interface Props {
  keys: string[];
  permissions: Record<string, string>;
  inheritedKeys?: string[];
  accountMode?: boolean;
  onChange: (key: string, decision: string) => Promise<void>;
}

/** Shared global/account editor; inheritance is identified by text and neutral tone. */
export default function PermissionRulesList({ keys, permissions, inheritedKeys = [], accountMode = false, onChange }: Props) {
  const [error, setError] = useState('');
  return <Card>
    {keys.map(key => {
      const current = permissions[key] || 'ask';
      const inherited = inheritedKeys.includes(key);
      const label = formatPermissionLabel(key);
      const options: Array<{value:string;label:string}> = DECISIONS.map(value => ({ value, label:t(`perms.${value}`) }));
      if (accountMode && !inherited) options.push({value:'inherit',label:t('perms.useGlobalRule')});
      return <Container key={key} variant="row" className="justify-between py-5 border-b border-card-border last:border-b-0">
        <div className="min-w-0">
          <span className={inherited ? 'text-md font-medium text-muted' : 'text-md font-medium text-brand'}>{label}</span>
          {accountMode && <Text variant="muted">{t(inherited ? 'perms.inheritedRule' : 'perms.accountRule')}</Text>}
        </div>
        <ActionMenu label={label} options={options} onSelect={async value => {
          setError('');
          try { await onChange(key, value); } catch { setError(t('perms.saveFailed')); return false; }
        }} trigger={props => <Chip {...props} selected={!inherited} tone={current as 'allow' | 'deny' | 'ask'}>{t(`perms.${current}`)}</Chip>} />
      </Container>;
    })}
    <FormError>{error}</FormError>
  </Card>;
}
