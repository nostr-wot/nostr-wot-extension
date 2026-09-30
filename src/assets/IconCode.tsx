import type { IconProps } from './iconProps';
export default function IconCode({size=16,...props}:IconProps) {
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}><path d="m8 5-6 7 6 7m8-14 6 7-6 7m-3-16-2 18"/></svg>;
}
