/** Count whitespace-separated words, ignoring leading/trailing and repeated whitespace. */
export function countWords(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}
