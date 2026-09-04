#!/usr/bin/env bash
# Run all tests using Node.js built-in test runner (Node 20+)
set -euo pipefail

cd "$(dirname "$0")/.."

# Crypto tests (no browser mock needed)
node --import tsx --test tests/crypto/*.test.ts

# Wallet tests (no browser mock needed)
node --import tsx --test tests/wallet/types.test.ts tests/wallet/lnbits.test.ts tests/wallet/nwc.test.ts tests/wallet/index.test.ts tests/wallet/lnbits-provision.test.ts tests/wallet/bolt11.test.ts tests/wallet/lnurl.test.ts tests/inject-webln.test.ts tests/inject-nip44-schemes.test.ts

# Pure popup decision logic: wizard state machine, popup gating, rpc transport,
# and the shared helpers the UI defers its decisions to. site-state was written
# but never listed here, so it had never run in this script or in CI.
node --import tsx --test tests/wizardMachine.test.ts tests/openPopupForActiveTab.test.ts tests/safeUrl.test.ts tests/rpc.test.ts tests/active-tab-domain.test.ts tests/i18n-keys.test.ts tests/theme-tokens.test.ts tests/site-state.test.ts tests/send-target.test.ts tests/approval.test.ts tests/profile-metadata.test.ts tests/tx-filter.test.ts tests/tx-pager.test.ts tests/invoice-expiry.test.ts tests/pqc-state.test.ts tests/permissions-ui.test.ts tests/paged-list.test.ts tests/tailwind-classes.test.ts tests/css-selectors.test.ts tests/test-registration.test.ts

# Module + wallet tests (need browser mock for vault/permissions/accounts)
node --import tsx --import ./tests/helpers/register-mocks.ts --test tests/vault.test.ts tests/permissions.test.ts tests/domain-handlers.test.ts tests/accounts.test.ts tests/signer.test.ts tests/signer-pq-refusal.test.ts tests/security-hardening.test.ts tests/communication.test.ts tests/delete-recreate.test.ts tests/wallet/approval.test.ts tests/wallet/permissions.test.ts tests/wallet/background-handlers.test.ts tests/wallet/payment-intents.test.ts tests/vault-wallet.test.ts tests/relay.test.ts tests/publish-handlers.test.ts tests/pqc-handlers.test.ts tests/profile-read.test.ts tests/relay-cache.test.ts tests/activity.test.ts tests/vault-auto-unlock.test.ts tests/password-pair.test.ts tests/password-pair-fields.test.ts tests/vault-lock-race.test.ts
