import type {
  Account as SharedAccount,
  AccountType as SharedAccountType,
  Nip46Config as SharedNip46Config,
  PqImportedKeys as SharedPqImportedKeys,
  SafeAccount as SharedSafeAccount,
} from '@nostr-wot/accounts';
import type { WalletConfig } from '../wallet/types.ts';

// ── Accounts ──

/*
 * The account record is `@nostr-wot/accounts`' now. This extension adds exactly one field
 * the package deliberately does not carry — `walletConfig` — because it types against the
 * wallet domain, which the shared account layer must not depend on. Extending rather than
 * restating is what keeps the two from drifting: a field the package adds arrives without
 * an edit here, and a field it renames is a compile error rather than a silent second shape.
 */

/**
 * The account kinds, spelled out.
 *
 * This union is the ONE place in the migration where a literal is written twice, and it is
 * deliberate: `tests/i18n-keys.test.ts` reads these members out of this file as source TEXT
 * to enumerate the `wizard.type.*` keys every locale must carry. Point it at a package and
 * the enumeration silently covers nothing, which is exactly the failure that test exists to
 * prevent — a missing translation shows the user a raw key.
 *
 * The two copies cannot drift: `assertSameAccountType` below fails to compile if they do.
 */
export type AccountType = 'generated' | 'nsec' | 'npub' | 'nip46' | 'external';

/**
 * Mutual assignability, which is type equality: a member added, removed or renamed in the
 * package breaks the build here rather than quietly leaving one side short.
 */
declare const assertSameAccountType: {
  local: SharedAccountType extends AccountType ? true : never;
  shared: AccountType extends SharedAccountType ? true : never;
};
void assertSameAccountType;

export type Nip46Config = SharedNip46Config;
export type PqImportedKeys = SharedPqImportedKeys;

/** A stored account: the shared record plus this extension's wallet capability. */
export interface Account extends SharedAccount {
  walletConfig?: WalletConfig;
}

/**
 * Explicit public metadata allowlist. New Account fields are private by default.
 *
 * The shared one verbatim, which is what makes `walletConfig` private for free: it is not on
 * the allowlist, so `toSafeAccount` does not copy it and nothing returning a `SafeAccount`
 * can leak a wallet's admin key by spreading an account.
 */
export type SafeAccount = SharedSafeAccount;

/** Background-only wallet capability. Never return this through a UI/page RPC. */
export type SafeAccountWithWallet = SafeAccount & Pick<Account, 'walletConfig'>;

/** Background-only remote signer capability; includes connection secrets. */
export type BackgroundRemoteSignerAccount = SafeAccount & { nip46Config: Nip46Config };
