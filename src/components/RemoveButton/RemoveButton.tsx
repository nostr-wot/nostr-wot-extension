import React from 'react';
import { IconClose } from '@assets';
import { t } from '@services/i18n/i18n.ts';
import IconButton from '@components/IconButton/IconButton';

type RemoveButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export default function RemoveButton(props: RemoveButtonProps) {
  return <IconButton tone="danger" aria-label={t('common.remove')} {...props}>
    <IconClose size={14} aria-hidden="true" />
  </IconButton>;
}
