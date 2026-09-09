/** One object URL with idempotent cleanup; callers own its lifetime. */
export function createObjectUrlResource(blob: Blob) {
  const url = URL.createObjectURL(blob);
  let disposed = false;
  return { url, dispose() {
    if (disposed) return;
    disposed = true;
    URL.revokeObjectURL(url);
  } };
}
