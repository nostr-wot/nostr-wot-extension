import React from 'react';
import styles from './PulseLogo.module.css';

const WRAP = 'relative inline-flex items-center justify-center';

interface PulseLogoProps {
  src?: string;
  size?: number;
  alt?: string;
  className?: string;
}

export default function PulseLogo({ src = '', size = 96, alt = '', className = '' }: PulseLogoProps) {
  return (
    <div className={`${styles.wrap} ${WRAP} ${className}`}>
      <img
        src={src}
        width={size}
        height={size}
        alt={alt}
        className="relative"
      />
    </div>
  );
}
