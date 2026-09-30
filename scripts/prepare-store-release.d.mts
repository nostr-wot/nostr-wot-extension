export function prepareRelease(tag: string, run?: (command: string, args: string[]) => string): { commit: string; version: string };
