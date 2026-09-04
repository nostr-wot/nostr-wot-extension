import { createContext, useContext, type Context } from 'react';

/**
 * The three lines every context in this folder repeated: a `Context<T | null>`
 * defaulting to `null` so a provider-less render is a wiring bug and not a
 * silently-nullable value, and a `useX()` that throws instead of handing back
 * `null` for every consumer to re-check.
 *
 * Returns the raw `Context` too — a provider still needs it for `.Provider`.
 */
export default function createRequiredContext<T>(hookName: string): [Context<T | null>, () => T] {
  const ctx = createContext<T | null>(null);
  function useRequired(): T {
    const value = useContext(ctx);
    if (!value) throw new Error(`${hookName} must be used within its provider`);
    return value;
  }
  return [ctx, useRequired];
}
