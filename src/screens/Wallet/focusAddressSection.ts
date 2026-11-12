/** Reveal the alias editor without moving the animated panel or the popup viewport. */
export function focusAddressSection(body: HTMLElement, section: HTMLElement): void {
  body.scrollTop += section.getBoundingClientRect().top - body.getBoundingClientRect().top;
  section.querySelector('input')?.focus({ preventScroll: true });
}
