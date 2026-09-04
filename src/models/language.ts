/**
 * A selectable interface language.
 *
 * Shared because three surfaces render it — the wizard's first-run step, the
 * settings dialog, and the wheel both of those wrap — and it had been declared
 * separately in each.
 */
export interface Language {
  code: string;
  flag: string;
  native: string;
  prompt: string;
}
