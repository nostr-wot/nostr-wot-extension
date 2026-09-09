/** Latest-result guard. Invalidation prevents completed work from updating a retired scope. */
export function createAsyncScope() {
  let generation = 0;
  return {
    start() {
      const current = ++generation;
      return () => current === generation;
    },
    invalidate() { generation++; },
  };
}
