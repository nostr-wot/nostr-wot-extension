// ── Onboarding ──

/** Pending onboarding account TTL (5 minutes) */
export const ONBOARDING_PENDING_TTL_MS = 5 * 60 * 1000;

export const NC_TTL_MS = 5 * 60 * 1000;

export const NC_SESSIONS_KEY = '_ncSessions';

export const NC_SECRETS_KEY = '_ncSessionSecrets';

/** Every session-storage key the pending-onboarding record can occupy, current and legacy. */
export const PENDING_KEYS = [
    '_pendingOnboardingAccount',
    '_pendingOnboardingCreatedAt',
    '_pendingOnboardingSecrets',
    '_pendingOnboardingSecretsPad',
    // Legacy privkey-only split, superseded by the combined blob above.
    '_pendingOnboardingPad',
    '_pendingOnboardingMasked',
];

export const WIZARD_STORAGE_KEY = 'wizardState';
export const WIZARD_PERSIST_TTL_MS = ONBOARDING_PENDING_TTL_MS;
