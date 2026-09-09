/** Own one replaceable timeout; old callbacks cannot clear newer feedback. */
export function createResettableTimeout() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  return {
    clear,
    schedule(callback: () => void, delay: number) {
      clear();
      timer = setTimeout(() => { timer = undefined; callback(); }, delay);
    },
  };
}
