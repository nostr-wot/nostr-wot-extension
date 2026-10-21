/** Scroll `element` into view, smoothly unless the person asked for reduced motion. */
export function scrollIntoViewGently(element: Element | null | undefined, block: ScrollLogicalPosition = 'nearest'): void {
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  element?.scrollIntoView({ block, behavior: reduce ? 'instant' : 'smooth' });
}
