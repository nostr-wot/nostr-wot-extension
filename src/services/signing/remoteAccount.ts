import { type BunkerSigner, toBunkerURL } from 'nostr-tools/nip46';
import { connectNip46 } from '@domain/accounts/creation.ts';
import { bytesToHex } from '@lib/crypto/utils.ts';
import { getPublicKey } from '@lib/crypto/secp256k1.ts';
import { SIGNER_REQUEST_TIMEOUT_MS } from '@constants/signing.ts';
import type { Account } from '@domain/accounts/types.ts';

/** Resolve the user's identity separately from the signer's transport key. */
export async function resolveRemoteAccount(signer: BunkerSigner, secretKey: Uint8Array, connect = false): Promise<Account> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        if (connect) await signer.connect();
        const pubkey = await signer.getPublicKey();
        if (!/^[0-9a-f]{64}$/i.test(pubkey)) throw new Error('Remote signer returned an invalid public key');
        // bp contains all current relays, including a QR signer's switch_relays result.
        const account = connectNip46(toBunkerURL(signer.bp), connect ? 'Bunker' : 'Nostr Connect');
        account.pubkey = pubkey.toLowerCase();
        account.nip46Config!.localPrivkey = bytesToHex(secretKey);
        account.nip46Config!.localPubkey = bytesToHex(getPublicKey(secretKey));
        return account;
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Remote signer connection timed out')), SIGNER_REQUEST_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    await signer.close().catch(() => {});
  }
}
