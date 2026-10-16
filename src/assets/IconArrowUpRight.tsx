import type { IconProps } from '@assets/iconProps.ts';
export default function IconArrowUpRight({ size = 18, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M7 17 17 7M7 7h10v10" />
    </svg>
  );
}
