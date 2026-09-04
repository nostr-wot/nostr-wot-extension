import React from 'react';
import Container from '@components/Container/Container';
import Text from '@components/Text/Text';

// font-[inherit]: preflight is off, so the <button> otherwise keeps the UA's
// own font and its label would not match the rest of the tile.
const TILE =
  'flex items-center gap-6 w-full px-7 py-6 border border-card-border rounded-panel bg-card font-[inherit] ' +
  'cursor-pointer text-left transition-all hover:bg-card-active disabled:opacity-40 disabled:cursor-not-allowed ' +
  '[&_svg]:text-brand [&_svg]:shrink-0';

interface ActionTileProps {
  icon: React.ReactNode;
  title: React.ReactNode;
  description: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

/**
 * A wide button that is itself a labeled choice: leading icon, bold title,
 * muted description below it. Five near-identical copies of this — the
 * wizard's backup-method tiles, split across BackupStep and CreateStep —
 * were hand-rolled with only the icon and copy differing.
 */
export default function ActionTile({ icon, title, description, onClick, disabled }: ActionTileProps) {
  return (
    <button type="button" className={TILE} onClick={onClick} disabled={disabled}>
      {icon}
      <Container>
        <strong className="text-md font-semibold text-heading">{title}</strong>
        <Text variant="muted" as="span">{description}</Text>
      </Container>
    </button>
  );
}
