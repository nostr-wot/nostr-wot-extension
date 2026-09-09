import { cn } from '@utils/cn.ts';

interface TextBlockProps {
  children: string;
  mono?: boolean;
  maxHeight?: number;
  className?: string;
}

/** Full, escaped content with preserved line breaks and bounded scrolling. */
export default function TextBlock({ children, mono = false, maxHeight = 180, className }: TextBlockProps) {
  return <pre className={cn(
    'm-0 whitespace-pre-wrap break-all overflow-y-auto select-text',
    mono ? 'font-mono-alt text-xs text-body' : 'font-[inherit] text-md leading-loose text-heading',
    className,
  )} style={{ maxHeight }}>{children}</pre>;
}
