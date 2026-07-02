import React, { useState, ChangeEvent } from 'react';
import { t } from '@lib/i18n.js';
import InputRow from '@components/InputRow/InputRow';
import RemoveButton from '@components/RemoveButton/RemoveButton';
import { SectionLabel } from '@components/SectionLabel/SectionLabel';
import styles from './EditableList.module.css';

interface EditableListClassNames {
  group?: string;
  list?: string;
  row?: string;
  item?: string;
  hint?: string;
}

interface EditableListProps {
  /** Optional section label; when set, renders a <SectionLabel> above the list. */
  label?: string;
  items: string[];
  /** Render the item's main text node (defaults to the raw string). */
  renderItem?: (item: string) => React.ReactNode;
  /** Leading node before the item text (e.g. a StatusDot). */
  leading?: (item: string) => React.ReactNode;
  /** Trailing node after the item text, before the remove button (e.g. R/W chips). */
  trailing?: (item: string) => React.ReactNode;
  placeholder: string;
  buttonLabel: string;
  onRemove: (item: string) => void;
  hint?: string;
  mono?: boolean;
  /** Class overrides so a call site can keep its exact container/row/item CSS. */
  classNames?: EditableListClassNames;
  disabled?: boolean;

  /* Internal-input mode (component owns value + error) */
  validate?: (raw: string) => string | null;
  invalidMsg?: string;
  onAdd?: (value: string) => void;

  /* Controlled-input mode (caller owns value + error). When `inputValue` is
     provided, the component defers input state to the caller. */
  inputValue?: string;
  onInputChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  error?: string;
}

/**
 * List of removable items + an add-input row. Two input modes:
 *
 *  - Internal (FiltersModal / MuteGroup): pass `validate` + `onAdd`; the
 *    component owns the input value and its inline error.
 *  - Controlled (NetworkSection / EndpointList): pass `inputValue`,
 *    `onInputChange`, `error` and an `onAdd` that reads the caller's own
 *    state; the component renders but does not own the input.
 */
export default function EditableList({
  label,
  items,
  renderItem,
  leading,
  trailing,
  placeholder,
  buttonLabel,
  onRemove,
  hint,
  mono = false,
  classNames = {},
  disabled = false,
  validate,
  invalidMsg,
  onAdd,
  inputValue,
  onInputChange,
  error,
}: EditableListProps) {
  const controlled = inputValue !== undefined;
  const [value, setValue] = useState('');
  const [internalError, setInternalError] = useState('');

  const handleInternalAdd = () => {
    const raw = value.trim();
    if (!raw) return;
    const normalized = validate ? validate(raw) : raw;
    if (normalized === null) {
      setInternalError(invalidMsg || t('mutes.invalidEntry'));
      return;
    }
    setInternalError('');
    setValue('');
    onAdd?.(normalized);
  };

  const body = (
    <>
      <div className={classNames.list || styles.list}>
        {items.map((item) => (
          <div key={item} className={classNames.row || styles.row}>
            {leading?.(item)}
            <span className={classNames.item || styles.item} title={item}>
              {renderItem ? renderItem(item) : item}
            </span>
            {trailing?.(item)}
            <RemoveButton onClick={() => onRemove(item)} />
          </div>
        ))}
      </div>
      <InputRow
        value={controlled ? inputValue! : value}
        onChange={controlled
          ? onInputChange!
          : (e: ChangeEvent<HTMLInputElement>) => { setValue(e.target.value); setInternalError(''); }}
        placeholder={placeholder}
        onSubmit={controlled ? onAdd : handleInternalAdd}
        buttonLabel={buttonLabel}
        disabled={disabled}
        error={controlled ? error : internalError}
        mono={mono}
      />
      {hint && items.length === 0 && <div className={classNames.hint || styles.hint}>{hint}</div>}
    </>
  );

  if (label) {
    return (
      <div className={classNames.group || styles.group}>
        <SectionLabel>{label}</SectionLabel>
        {body}
      </div>
    );
  }
  return body;
}
