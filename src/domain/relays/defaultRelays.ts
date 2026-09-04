// Order matters: reads try relays in order, so the first entry gates the wait.
// Kept in step with DEFAULT_RELAYS in lib/bg/state.ts.
export const DEFAULT_RELAYS = 'wss://nos.lol,wss://relay.damus.io,wss://nostr-01.yakihonne.com' as const;
