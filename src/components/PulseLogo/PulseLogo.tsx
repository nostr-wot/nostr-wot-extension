import styles from './PulseLogo.module.css';
import { cn } from '@utils/cn.ts';

const WRAP = 'relative inline-flex items-center justify-center';

interface PulseLogoProps {
  src?: string;
  size?: number;
  alt?: string;
  className?: string;
}

export default function PulseLogo({ src = '', size = 96, alt = '', className = '' }: PulseLogoProps) {
  return (
    <div className={cn(styles.wrap, WRAP, className)}>
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
