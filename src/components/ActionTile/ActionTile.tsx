import React from 'react';
import styles from './ActionTile.module.css';

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
    <button type="button" className={styles.tile} onClick={onClick} disabled={disabled}>
      {icon}
      <div className={styles.text}>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
    </button>
  );
}
