import type { FirefoxSubmission } from './publish-firefox.mjs';
export function checksumFor(text: string, name: string): string;
export function changelogFor(text: string, version: string): string;
export function compareArchives(left: string, right: string): void;
export function prepareFirefox(directory: string, version: string, commit: string, run?: (command: string, args: string[], options?: object) => unknown): FirefoxSubmission;
export function releaseNotesFor(changelog: string, commit: string): string;
