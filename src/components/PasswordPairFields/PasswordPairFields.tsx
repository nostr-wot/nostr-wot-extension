import { ChangeEvent, KeyboardEvent } from 'react';
import { t } from '@lib/i18n.js';
import Input from '@components/Input/Input';
import type { UsePasswordPairResult } from './usePasswordPair.ts';
import styles from './PasswordPairFields.module.css';

interface PasswordPairFieldsProps {
  pair: UsePasswordPairResult;
  passwordPlaceholder?: string;
  confirmPlaceholder: string;
  /** Enter in the confirm field — gated on `pair.ready`, so it never fires on a pair that is not. */
  onSubmit?: () => void;
  /**
   * The live checklist of what the password still needs. On by default: it is
   * the difference between "refuses once you press submit" and "tells you what
   * is still missing before you try". Turn it off only for a site that already
   * states the requirement elsewhere, so it would be said twice.
   */
  showChecklist?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}

/**
 * The two fields for "new password, twice" — controlled by `usePasswordPair`,
 * not by this component. Renders as a fragment, not a wrapped block: every
 * call site already lays its form out as a column with its own gap, and a
 * second nested gap container here would either double that spacing or fight
 * it, depending on the site.
 *
 * Deliberately does not render a label above the password field either — the
 * six sites disagreed on whether to have one, what it said, and whether it
 * doubled as the confirm field's label too. A caller that wants one renders
 * its own `<label>` before this component, same as `EncryptedBackupForm` did.
 */
export default function PasswordPairFields({
  pair,
  passwordPlaceholder,
  confirmPlaceholder,
  onSubmit,
  showChecklist = true,
  disabled = false,
  autoFocus = false,
}: PasswordPairFieldsProps) {
  return (
    <>
      <Input
        type="password"
        showToggle
        placeholder={passwordPlaceholder}
        value={pair.password}
        onChange={(e: ChangeEvent<HTMLInputElement>) => pair.setPassword(e.target.value)}
        disabled={disabled}
        autoFocus={autoFocus}
      />
      <Input
        type="password"
        placeholder={confirmPlaceholder}
        value={pair.confirm}
        onChange={(e: ChangeEvent<HTMLInputElement>) => pair.setConfirm(e.target.value)}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter' && pair.ready && onSubmit) onSubmit();
        }}
        disabled={disabled}
      />
      {showChecklist && (
        <ul className={styles.requirements}>
          <li className={pair.longEnough ? styles.requirementMet : ''}>
            {pair.longEnough ? '✓' : '○'} {t('key.reqMinChars')}
          </li>
          <li className={pair.matches ? styles.requirementMet : ''}>
            {pair.matches ? '✓' : '○'} {t('key.reqMatch')}
          </li>
        </ul>
      )}
    </>
  );
}
