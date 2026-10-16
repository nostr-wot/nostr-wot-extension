import React from 'react';
import Container from '@components/Container';
import Card from '@components/Card';
import Text from '@components/Text';
import { cn } from '@utils/cn.ts';

// font-[inherit]: preflight is off, so the <button> otherwise keeps the UA's
// own font and its label would not match the rest of the tile.
const TILE =
  'flex items-center gap-6 w-full px-7 py-6 border border-card-border rounded-panel bg-card font-[inherit] ' +
  'cursor-pointer text-left transition-all hover:bg-card-active disabled:opacity-40 disabled:cursor-not-allowed ' +
  '[&_svg]:text-brand [&_svg]:shrink-0';

interface ActionTileProps {
  icon: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  compact?: boolean;
  raised?: boolean;
  /** `danger` colours only the icon and title red, for an exit such as Disconnect. */
  tone?: 'brand' | 'danger';
  onClick: () => void;
  disabled?: boolean;
}

/**
 * A wide button that is itself a labeled choice: leading icon, bold title,
 * muted description below it. Five near-identical copies of this — the
 * wizard's backup-method tiles, split across BackupStep and CreateStep —
 * were hand-rolled with only the icon and copy differing.
 */
export default function ActionTile({ icon, title, description, onClick, disabled, compact = false, raised = false, tone = 'brand' }: ActionTileProps) {
  const danger = tone === 'danger';
  const className = cn(TILE, compact && 'min-w-0 flex-col justify-center gap-3 px-3 py-6 text-center', raised && 'mb-0 bg-glass rounded-lg hover:bg-glass-heavy hover:translate-x-2 motion-reduce:transform-none hover:border-brand', danger && '[&_svg]:text-error', danger && raised && 'hover:border-error');
  const content = <>
      {icon}
      <Container gap={raised ? 2 : undefined}>
        <strong className={cn('text-md font-semibold text-heading', compact && 'text-xs font-medium break-words', danger && 'text-error')}>{title}</strong>
        {description && <Text variant="muted" as="span" className="text-menu-subtitle">{description}</Text>}
      </Container>
  </>;
  return raised
    ? <Card as="button" variant="raised" className={className} onClick={onClick} disabled={disabled}>{content}</Card>
    : <button type="button" className={className} onClick={onClick} disabled={disabled}>{content}</button>;
}
