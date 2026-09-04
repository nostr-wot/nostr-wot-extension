import React, { useState, ChangeEvent } from 'react';
import { t } from '@lib/i18n.js';
import { formatLabel } from '@shared/permissions.ts';
import { buildRuleKey, DECISIONS } from '@shared/permissionRules.ts';
import Button from '@components/Button/Button';
import Modal from '@components/Modal/Modal';
import Dropdown from '@components/Dropdown/Dropdown';
import LinkButton from '@components/LinkButton/LinkButton';
import styles from './Settings.module.css';
import Chip from '@components/Chip/Chip';


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

  const submit = () => {
    onAdd(buildRuleKey(presetKey, customKind, useCustom && !!customKind.trim()), decision);
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
            <Button small onClick={submit}>{t('perms.addRule')}</Button>
          </>
        )}
      >
          <div className={styles.permModalSection}>
            <span className={styles.permModalLabel}>{t('perms.permission')}</span>
            {!useCustom ? (
              <Dropdown
                options={availableKeys.map(k => ({ value: k, label: formatLabel(k) }))}
                value={presetKey}
                onChange={setPresetKey}
                small
              />
            ) : (
              <div className={styles.permCustomKindRow}>
                <span className={styles.permCustomKindPrefix}>signEvent:</span>
                <input
                  type="number"
                  className={styles.permCustomKindInput}
                  placeholder="e.g. 30023"
                  value={customKind}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setCustomKind(e.target.value)}
                />
              </div>
            )}
            <LinkButton tone="brand" onClick={() => setUseCustom(!useCustom)}>
              {useCustom ? t('perms.usePreset') : t('perms.customKind')}
            </LinkButton>
          </div>

          <div className={styles.permModalSection}>
            <span className={styles.permModalLabel}>{t('perms.decision')}</span>
            <div className={styles.chipGroup}>
              {DECISIONS.map((d) => (
                <Chip key={d} tone={d} selected={decision === d} onClick={() => setDecision(d)}>
                  {t(`perms.${d}`)}
                </Chip>
              ))}
            </div>
          </div>

      </Modal>
  );
}
