import { cn } from '@utils/cn.ts';

const WRAP = 'relative inline-flex items-center justify-center';
const RING = 'absolute top-1/2 left-1/2 w-[60px] h-[60px] -mt-[30px] -ml-[30px] rounded-full ' +
  'bg-[radial-gradient(circle,var(--brand-light)_0%,transparent_70%)] animate-logo-pulse pointer-events-none -z-1';

interface PulseLogoProps {
  src?: string;
  size?: number;
  alt?: string;
  className?: string;
}

export default function PulseLogo({ src = '', size = 96, alt = '', className = '' }: PulseLogoProps) {
  return (
    <div className={cn(WRAP, className)}>
      <span aria-hidden="true" className={RING} />
      <span aria-hidden="true" className={cn(RING, '[animation-delay:2.5s]')} />
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
