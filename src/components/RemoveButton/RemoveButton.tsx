import React from 'react';
import { IconClose } from '@assets';

interface RemoveButtonProps {
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}

export default function RemoveButton({ onClick }: RemoveButtonProps) {
  return (
    <button
      className="bg-transparent border-none text-muted cursor-pointer p-2 rounded-sm flex items-center shrink-0 transition-all hover:text-error hover:bg-error-tint-hover"
      onClick={onClick}
    >
      <IconClose size={14} />
    </button>
  );
}
