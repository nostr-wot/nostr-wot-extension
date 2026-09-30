/** Validated upload archive metadata returned by verify-package.mjs. */
export function verifyPackage(
  archive: string,
  target: 'chrome' | 'firefox',
  version: string,
): { manifest: { version: string; [key: string]: unknown }; sha256: string };
