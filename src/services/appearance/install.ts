import { THEME_STORAGE_KEY } from '@constants/appearance.ts';
import { downloadTheme } from '@domain/appearance/handoff.ts';

interface InstallPorts {
  read(): Promise<Record<string, unknown>>;
  saveTheme(theme: string): Promise<void>;
  openPopup(): Promise<void>;
  query(): Promise<Array<{ url?: string }>>;
}

/** Store installs do not forward query strings; recover the hint from an open download tab. */
export async function openInstalledWelcome(reason: string, ports: InstallPorts): Promise<void> {
  if (reason !== 'install') return;
  const stored = await ports.read();
  if (stored.keyVault || (Array.isArray(stored.accounts) && stored.accounts.length > 0)) return;
  if (stored[THEME_STORAGE_KEY] === undefined) {
    try {
      const themes = new Set((await ports.query()).map(tab => downloadTheme(tab.url || '')).filter(Boolean));
      // Multiple campaigns may be open. Do not silently pick an unrelated one.
      if (themes.size === 1) {
        // The toolbar opens its fixed default URL. Save before its first render,
        // including when the user must open it manually after a browser refusal.
        await ports.saveTheme(themes.values().next().value!);
      }
    } catch { /* Lookup/storage failure must not prevent opening the normal popup. */ }
  }
  try {
    await ports.openPopup();
  } catch {
    // Automatic opening may need a user gesture. The user can click the toolbar icon;
    // do not open a separate setup tab or retry and steal focus later.
  }
}
