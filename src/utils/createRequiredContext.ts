import { createContext, useContext, type Context } from 'react';

/*
 * src/utils/ is for React-side helpers that are neither a component nor a hook.
 *
 * It is not src/shared/: that is React-free on purpose and is imported by
 * background code (services/background/domain-handlers.ts, services/wallet/payment-intents.ts),
 * so putting anything that imports React there would pull React into the
 * service worker's import graph. And this is not a context — it is the factory
 * that makes one, so it does not belong in src/popup/context/ either.
 */

/**
 * The three lines every context repeated: a `Context<T | null>`
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
