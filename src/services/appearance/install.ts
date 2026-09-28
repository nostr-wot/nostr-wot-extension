import { THEME_STORAGE_KEY } from '@constants/appearance.ts';
import { downloadTheme } from '@domain/appearance/handoff.ts';

interface InstallPorts {
  read(): Promise<Record<string, unknown>>;
  query(): Promise<Array<{ url?: string }>>;
  url(path: string): string;
  open(url: string): Promise<unknown>;
}

/** Store installs do not forward query strings; recover the hint from an open download tab. */
export async function openInstalledWelcome(reason: string, ports: InstallPorts): Promise<void> {
  if (reason !== 'install') return;
  const stored = await ports.read();
  if (stored.keyVault || (Array.isArray(stored.accounts) && stored.accounts.length > 0)) return;
  let path = 'src/entrypoints/onboarding/index.html';
  if (stored[THEME_STORAGE_KEY] === undefined) {
    try {
      const themes = new Set((await ports.query()).map(tab => downloadTheme(tab.url || '')).filter(Boolean));
      // Multiple campaigns may be open. Do not silently pick an unrelated one.
      if (themes.size === 1) path += `?theme=${themes.values().next().value}`;
    } catch { /* A denied/missing tabs API must not prevent normal onboarding. */ }
  }
  await ports.open(ports.url(path));
}
