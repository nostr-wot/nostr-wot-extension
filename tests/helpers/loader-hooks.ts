/**
 * ESM resolve hook: redirects lib/browser.js (or .ts) → tests/helpers/browser-mock.ts
 */
import { fileURLToPath } from 'node:url';
import { resolve as pathResolve } from 'node:path';

interface ResolveContext {
  parentURL?: string;
  [key: string]: any;
}

interface ResolveResult {
  url: string;
  shortCircuit?: boolean;
}

type NextResolve = (specifier: string, context: ResolveContext) => Promise<ResolveResult>;

export async function resolve(
  specifier: string,
  context: ResolveContext,
  nextResolve: NextResolve
): Promise<ResolveResult> {
  // Stand in for the browser API however it is reached.
  //
  // This used to fire only when the importer was itself inside lib/, which was
  // true while lib/ was the only thing importing it. src/ used to have its own
  // six-line copy of the shim — the one that silently omitted the Safari
  // storage.session polyfill — so it never came through here. With that copy
  // deleted, UI modules import the real one via the @lib alias, and a mocked
  // test run that loads any of them got the real module instead of the mock:
  // `chrome` is undefined under node, so it threw at import and took the whole
  // process down with it.
  if (
    specifier === './browser.js' ||
    specifier === './browser.ts' ||
    specifier === '../browser.js' ||
    specifier === '../browser.ts' ||
    specifier === '@lib/browser.js' ||
    specifier === '@lib/browser.ts' ||
    specifier.endsWith('/lib/browser.js') ||
    specifier.endsWith('/lib/browser.ts')
  ) {
    const mockPath = pathResolve(
      fileURLToPath(import.meta.url),
      '..', 'browser-mock.ts'
    );
    return { url: `file://${mockPath}`, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
