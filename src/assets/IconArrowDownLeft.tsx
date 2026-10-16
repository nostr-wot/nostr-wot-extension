import type { IconProps } from '@assets/iconProps.ts';
export default function IconArrowDownLeft({ size = 18, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M17 7 7 17M17 17H7V7" />
    </svg>
  );
}
