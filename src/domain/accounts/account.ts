/**
 * The account fields the popup renders.
 *
 * Deliberately narrower than `domain/accounts/types.ts`'s `Account`, which is the stored
 * record and carries key material. The UI only ever needs these five, and it
 * should not be able to reach the rest by accident — but the shape was written
 * out twice, so this is the one place it lives.
 */
export interface Account {
  id: string;
  pubkey: string;
  name?: string;
  readOnly?: boolean;
  type?: string;
}
