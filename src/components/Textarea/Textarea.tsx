import { useId, useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';
import { INPUT_BASE } from '@components/Input/Input';
import Container from '@components/Container/Container';
import { cn } from '@utils/cn.ts';

/** Shrink before measuring so deleting text reduces the field's height too. */
export function fitTextarea(node: Pick<HTMLTextAreaElement, 'scrollHeight' | 'offsetHeight' | 'clientHeight'> & { style: Pick<CSSStyleDeclaration, 'height'> }): void {
  node.style.height = '0px';
  node.style.height = `${node.scrollHeight + node.offsetHeight - node.clientHeight}px`;
}

/** Multiline counterpart to Input, growing with both loaded and edited text. */
export default function Textarea({ label, id, value, className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { if (ref.current) fitTextarea(ref.current); }, [value]);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    let width = node.clientWidth;
    const observer = new ResizeObserver(() => {
      if (node.clientWidth !== width) { width = node.clientWidth; fitTextarea(node); }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <Container gap={2} className="w-full min-w-0">
    {label && <label htmlFor={fieldId} className="text-sm font-semibold text-secondary">{label}</label>}
    <textarea {...rest} id={fieldId} ref={ref} value={value} rows={3}
      className={cn(INPUT_BASE, 'min-h-[72px] py-4 px-6 resize-none overflow-hidden whitespace-pre-wrap', className)} />
  </Container>;
}
