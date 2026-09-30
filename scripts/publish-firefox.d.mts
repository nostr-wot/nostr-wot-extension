export const ADDON_ID: string;
export interface FirefoxSubmission {
  archive: string;
  source: string;
  version: string;
  archiveHash: string;
  sourceHash: string;
  approvalNotes: string;
  releaseNotes: string;
}
export function digest(bytes: Uint8Array): string;
export function amoToken(env: Record<string, string | undefined>, now?: number): string;
export function compareVersions(a: string, b: string): number;
export function publishFirefox(options: FirefoxSubmission, env: Record<string, string | undefined>, fetcher?: typeof fetch, sleep?: (ms: number) => Promise<unknown>): Promise<string>;
