import { useState, ChangeEvent } from 'react';
import { t } from '@lib/i18n.js';
import { formatPermissionLabel } from '@domain/permissions/permissionLabels.ts';
import { buildRuleKey, validCustomKind, DECISIONS } from '@domain/permissions/permissionRules.ts';
import Input from '@components/Input/Input';
import { IconPlus } from '@assets';
import Button from '@components/Button/Button';
import Modal from '@components/Modal/Modal';
import Dropdown from '@components/Dropdown/Dropdown';
import LinkButton from '@components/LinkButton/LinkButton';
import Chip from '@components/Chip/Chip';
import Container from '@components/Container/Container';


interface AddRuleModalProps {
  availableKeys: string[];
  onAdd: (key: string, decision: string) => void | Promise<void>;
  onClose: () => void;
}

/**
 * Add one permission rule for a site.
 *
 * Its five fields lived in PermissionsSection, for a dialog reachable only from
 * the detail view — so the parent hand-reset them on every open. Mounting it
 * only while open does that for free.
 */
export default function AddRuleModal({ availableKeys, onAdd, onClose }: AddRuleModalProps) {
  const [presetKey, setPresetKey] = useState<string>(availableKeys[0] ?? 'signEvent:1');
  const [customKind, setCustomKind] = useState<string>('');
  const [decision, setDecision] = useState<string>('allow');
  const [useCustom, setUseCustom] = useState<boolean>(false);

  const valid = useCustom ? validCustomKind(customKind) : availableKeys.includes(presetKey);
  const submit = () => {
    if (!valid) return;
    void onAdd(buildRuleKey(presetKey, customKind, useCustom), decision);
    onClose();
  };

  return (
      <Modal
        title={t('perms.addRule')}
        onClose={() => onClose()}
        maxWidth={280}
        footerRow
        footer={(
          <>
            <Button small variant="secondary" onClick={() => onClose()}>{t('common.cancel')}</Button>
            <Button small onClick={submit} disabled={!valid} aria-label={t('perms.addRule')} title={t('perms.addRule')}><IconPlus size={18} /></Button>
          </>
        )}
      >
          <Container gap={3}>
            <span className="text-xs font-semibold text-muted uppercase tracking-[0.4px]">{t('perms.permission')}</span>
            {!useCustom ? (
              <Dropdown
                options={availableKeys.map(k => ({ value: k, label: formatPermissionLabel(k) }))}
                value={presetKey}
                onChange={setPresetKey}
                small
                aria-label={t('perms.permission')}
              />
            ) : (
              <Container variant="row" gap={1}>
                <span className="text-sm font-semibold text-secondary whitespace-nowrap">signEvent:</span>
                <Input
                  small
                  type="number"
                  min={0}
                  max={65535}
                  step={1}
                  aria-label={t('perms.customKind')}
                  className="flex-1 min-w-0 py-2.5 px-4 border border-card-border rounded-md bg-card text-sm font-[inherit] text-body outline-none transition-colors focus:border-brand"
                  placeholder="e.g. 30023"
                  value={customKind}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setCustomKind(e.target.value)}
                />
              </Container>
            )}
            <LinkButton tone="brand" onClick={() => setUseCustom(!useCustom)}>
              {useCustom ? t('perms.usePreset') : t('perms.customKind')}
            </LinkButton>
          </Container>

          <Container gap={3}>
            <span className="text-xs font-semibold text-muted uppercase tracking-[0.4px]">{t('perms.decision')}</span>
            <Container variant="row" gap={2}>
              {DECISIONS.map((d) => (
                <Chip key={d} tone={d} selected={decision === d} onClick={() => setDecision(d)}>
                  {t(`perms.${d}`)}
                </Chip>
              ))}
            </Container>
          </Container>

      </Modal>
  );
}
