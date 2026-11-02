import { AsyncLock } from '@utils/asyncLock';

// Connection templates, disconnects and identity toggles share these storage keys.
// Acquire this before the signing-permission lock whenever both are needed.
export const siteConsentMutations = new AsyncLock();
