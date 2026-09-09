/** Stable insertion-order union without mutating either input. */
export function mergeUnique<T>(existing: readonly T[], incoming: Iterable<T>): T[] {
  return [...new Set([...existing, ...incoming])];
}
