import type { IconProps } from '@assets/iconProps.ts';
export default function IconPause({ size = 18, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="M8 5v14M16 5v14" />
    </svg>
  );
}
