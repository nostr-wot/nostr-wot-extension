import React from 'react';
import styles from './TopoBg.module.css';
import { cn } from '@utils/cn.ts';

interface TopoBgProps {
  className?: string;
  children?: React.ReactNode;
}

export default function TopoBg({ className = '', children }: TopoBgProps) {
  return (
    <div className={cn(styles.topoBg, 'relative overflow-hidden', className)}>
      {children}
    </div>
  );
}
