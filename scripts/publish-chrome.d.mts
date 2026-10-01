export const EXTENSION_ID: string;
export function publishChrome(options: { archive: string; version: string; sha256: string; publisher: string; token: string; inspectOnly?: boolean }, fetcher?: typeof fetch, sleep?: (ms: number) => Promise<unknown>): Promise<string>;
export function accessToken(env: Record<string, string | undefined>, fetcher?: typeof fetch): Promise<string>;
