/**
 * Wallet and WebLN handlers.
 * @module services/background/wallet-handlers
 */

import browser from '../../lib/browser.ts';
import { readWalletDisplayCache, updateWalletDisplayCache, resetWalletDisplayCache, walletDisplayRevision } from '../wallet/display-cache.ts';
import * as vault from '../vault/vault.ts';
import * as signerApprovalQueue from '../signing/approvalQueue.ts';
import * as signerPermissions from '../permissions/permissions.ts';
import { npubEncode } from '../../lib/crypto/bech32.ts';
import { signEvent } from '../../lib/crypto/nip01.ts';
import { addWeblnAllowedDomain, isWeblnAllowed } from './domain-handlers.ts';
import { createWalletProvider, getWalletProvider, removeWalletProvider, isWalletProviderCurrent } from '../wallet/index.ts';
import { captureAccountSession, assertAccountSession } from '../signing/accountSession.ts';
import { type WalletConfig } from '@domain/wallet/types.ts';
import { decodeBolt11 } from '../../domain/wallet/bolt11.ts';
import { provisionLnbitsWallet, claimLightningAddress, getLightningAddress, releaseLightningAddress } from '../wallet/lnbits-provision.ts';
import { DEFAULT_LNBITS_URL } from '@constants/wallet.ts';
import { fetchPayParams, requestInvoice } from '../wallet/lnurl.ts';
import { reserveAutomaticPayment } from '../wallet/automatic-payment-budget.ts';
import { runPaymentOnce } from '../wallet/payment-intents.ts';
import type { SignedEvent } from '../../domain/nostr/types.ts';
import type { HandlerFn } from './state.ts';
import { logActivity } from '@services/background/activity-handlers.ts';

// ── Shared utilities ──

export async function getConnectedProvider() {
    await vault.requireUnlocked();
    const acct = vault.getActiveAccountWithWallet();
    if (!acct?.walletConfig) throw new Error('No wallet configured');
    const session = captureAccountSession(acct.id);
    const provider = getWalletProvider(acct.id, acct.walletConfig);
    if (!provider) throw new Error('Provider not available');
    const assertCurrent = () => {
        assertAccountSession(session);
        if (!isWalletProviderCurrent(acct.id, provider)) throw new Error('Wallet disconnected or replaced');
    };
    if (!provider.isConnected()) await provider.connect();
    assertCurrent();
    return { provider, acct, assertCurrent };
}

export function createNip98SignFn(acctId: string, endpointUrl: string): (challenge: string) => Promise<SignedEvent> {
    const session = captureAccountSession(acctId);
    return async (challenge: string): Promise<SignedEvent> => {
        assertAccountSession(session);
        const privkeyBytes = vault.getPrivkey(acctId);
        if (!privkeyBytes) throw new Error('No private key available');
        try {
            const signed = await signEvent({
                kind: 27235,
                created_at: Math.floor(Date.now() / 1000),
                tags: [['challenge', challenge], ['u', endpointUrl], ['method', 'POST']],
                content: '',
            }, privkeyBytes);
            assertAccountSession(session);
            return signed;
        } finally {
            privkeyBytes.fill(0);
        }
    };
}

// ── Handler Map ──

export const handlers = new Map<string, HandlerFn>([
    ['webln_enable', async (params) => {
        const { origin, shownConnectCard } = params as { origin?: string; shownConnectCard?: boolean };
        if (!origin) return true;
        if (await isWeblnAllowed(origin)) return true;

        // Wallet access is a separate consent from the NIP-07 connect, and it has to be
        // asked for separately too. A site that saw the "Connect this site" card BECAUSE
        // of this enable() call has answered a wallet prompt — that counts. A site already
        // connected over NIP-07 has seen nothing about the wallet, and used to fall
        // straight through this handler: one silent enable() away from reading balances.
        if (!shownConnectCard) {
            const decision = await signerApprovalQueue.queueRequest({
                type: 'webln_enable',
                origin,
                needsPermission: true,
            });
            if (!decision.allow) {
                void logActivity({ domain: origin, method: 'enable', decision: 'rejected' });
                throw new Error('WebLN access denied');
            }
        }

        await addWeblnAllowedDomain(origin);
        return true;
    }],

    ['webln_getInfo', async () => {
        const { provider, assertCurrent } = await getConnectedProvider();
        assertCurrent();
        const info = await provider.getInfo();
        return {
            // node.pubkey is the Lightning node id. We don't expose one, and we
            // MUST NOT leak the user's Nostr identity pubkey here — that stays
            // behind the getPublicKey consent prompt (a connected site does not
            // automatically learn the identity).
            node: { alias: info.alias || '', pubkey: '' },
            supports: ['lightning'],
            methods: ['getInfo', ...[
                ['pay_invoice', 'sendPayment'],
                ['make_invoice', 'makeInvoice'],
                ['get_balance', 'getBalance'],
            ].filter(([walletMethod]) => info.methods.includes(walletMethod)).map(([, webMethod]) => webMethod)],
        };
    }],

    ['webln_getBalance', async () => {
        const { provider, assertCurrent } = await getConnectedProvider();
        assertCurrent();
        const result = await provider.getBalance();
        assertCurrent();
        return result;
    }],

    ['webln_sendPayment', async (params) => {
        const { paymentRequest, origin } = params as { paymentRequest: string; origin: string };
        if (!paymentRequest) throw new Error('Missing paymentRequest');

        const { provider, acct, assertCurrent } = await getConnectedProvider();

        // S-17: Decode BOLT11 to extract invoice amount for user display
        let invoiceAmountSats = 0;
        let invoiceAmountMsats = 0;
        try {
            const decoded = decodeBolt11(paymentRequest);
            if (decoded?.amountSats != null) {
                invoiceAmountSats = decoded.amountSats;
                invoiceAmountMsats = decoded.amountMsats ?? 0;
            }
        } catch {
            // Decode failed — fall through with 0 (unknown amount)
        }

        const perm = await signerPermissions.check(origin, 'webln_sendPayment', undefined, acct.id);
        if (perm === 'deny') throw new Error('Permission denied');

        // A single threshold caps both each invoice and all silent payments
        // across origins in a rolling 24h window. Reserve durably before dispatch.
        const data = await browser.storage.local.get(`walletThreshold_${acct.id}`) as Record<string, number>;
        const threshold = data[`walletThreshold_${acct.id}`] || 0;
        assertCurrent();
        const autoApproved = await reserveAutomaticPayment(acct.id, invoiceAmountMsats, threshold);

        assertCurrent();
        if (!autoApproved) {
            const decision = await signerApprovalQueue.queueRequest({
                type: 'webln_sendPayment',
                origin,
                accountId: acct.id,
                pubkey: acct.pubkey,
                needsPermission: true,
                walletAmount: invoiceAmountSats,
            });
            if (!decision.allow) throw new Error('Payment denied by user');
            assertCurrent();
            if (decision.remember) {
                // 'allow' here only enables threshold-capped auto-approval
                await signerPermissions.save(origin, 'webln_sendPayment', null, 'allow', acct.id);
            }
        }

        if (await signerPermissions.check(origin, 'webln_sendPayment', undefined, acct.id) === 'deny') throw new Error('Permission denied');
        assertCurrent();
        return await provider.payInvoice(paymentRequest);
    }],

    ['webln_makeInvoice', async (params) => {
        const { amount, defaultMemo } = params as { amount: number; defaultMemo?: string; origin: string };
        if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Invoice amount must be a positive whole number of sats');
        if (defaultMemo !== undefined && typeof defaultMemo !== 'string') throw new Error('Invalid invoice memo');
        const { provider, assertCurrent } = await getConnectedProvider();
        assertCurrent();
        const inv = await provider.makeInvoice(amount, defaultMemo);
        return { paymentRequest: inv.bolt11 };
    }],

    ['wallet_readDisplayCache', async (params) => {
        await vault.whenStartupUnlockSettled();
        if (typeof params.accountId !== 'string') throw new Error('Invalid account');
        return readWalletDisplayCache(params.accountId);
    }],

    ['wallet_hasConfig', async () => {
        const revision = walletDisplayRevision();
        await vault.requireUnlocked();
        const acct = vault.getActiveAccountWithWallet();
        if (!acct) throw new Error('No active account');
        if (acct.walletConfig) await updateWalletDisplayCache(acct.id, {providerType:acct.walletConfig.type}, revision).catch(() => {});
        return acct.walletConfig?.type ?? false;
    }],

    ['wallet_getInfo', async () => {
        const { provider, assertCurrent } = await getConnectedProvider();
        assertCurrent();
        const result = await provider.getInfo();
        assertCurrent();
        return result;
    }],

    ['wallet_getBalance', async () => {
        const revision = walletDisplayRevision();
        const { provider, acct, assertCurrent } = await getConnectedProvider();
        assertCurrent();
        const result = await provider.getBalance();
        assertCurrent();
        await updateWalletDisplayCache(acct.id, {providerType:provider.type,balance:result.balance}, revision).catch(() => {});
        assertCurrent();
        return result;
    }],

    ['wallet_connect', async (params) => {
        const { walletConfig } = params as { walletConfig: WalletConfig };
        await vault.requireUnlocked();
        const acctId = vault.getActiveAccountId();
        if (!acctId) throw new Error('No active account');
        const session = captureAccountSession(acctId);
        const candidate = createWalletProvider(walletConfig);
        if (!candidate) throw new Error('Unsupported wallet provider');
        const unsubscribe = vault.onSessionInvalidated(() => candidate.disconnect());
        try {
            await candidate.connect();
            assertAccountSession(session);
            // Opening a relay socket alone does not authenticate an NWC wallet.
            await candidate.getInfo();
            assertAccountSession(session);
        } finally {
            unsubscribe();
            candidate.disconnect();
        }
        // Keep the previous wallet until the candidate answers successfully.
        // Saving invalidates the old provider; subsequent reads create a fresh one.
        const saving = vault.updateAccountWalletConfig(acctId, walletConfig);
        const savedSession = captureAccountSession(acctId);
        await saving;
        assertAccountSession(savedSession);
        await resetWalletDisplayCache(acctId, walletConfig.type);
        assertAccountSession(savedSession);
        return true;
    }],

    ['wallet_disconnect', async () => {
        await vault.requireUnlocked();
        const acctId = vault.getActiveAccountId();
        if (!acctId) throw new Error('No active account');
        removeWalletProvider(acctId);
        await vault.updateAccountWalletConfig(acctId, null);
        await resetWalletDisplayCache(acctId, false);
        return true;
    }],

    ['wallet_setAutoApproveThreshold', async (params) => {
        await vault.requireUnlocked();
        const { threshold } = params as { threshold: number };
        if (!Number.isSafeInteger(threshold) || threshold < 0 || !Number.isSafeInteger(threshold * 1000)) {
            throw new Error('Threshold must be a non-negative whole number of sats');
        }
        const acctId = vault.getActiveAccountId();
        if (!acctId) throw new Error('No active account');
        await browser.storage.local.set({ [`walletThreshold_${acctId}`]: threshold });
        return true;
    }],

    ['wallet_getAutoApproveThreshold', async () => {
        await vault.whenStartupUnlockSettled();
        const acctId = vault.getActiveAccountId();
        if (!acctId) return 0;
        const data = await browser.storage.local.get(`walletThreshold_${acctId}`) as Record<string, number>;
        return data[`walletThreshold_${acctId}`] || 0;
    }],

    ['wallet_makeInvoice', async (params) => {
        const { amount, memo } = params as { amount: number; memo?: string };
        const { provider, assertCurrent } = await getConnectedProvider();
        assertCurrent();
        return await provider.makeInvoice(amount, memo);
    }],

    ['wallet_checkInvoice', async (params) => {
        const { paymentHash } = params as { paymentHash: string };
        const { provider, assertCurrent } = await getConnectedProvider();
        assertCurrent();
        const result = await provider.lookupInvoice(paymentHash);
        assertCurrent();
        return result;
    }],

    ['wallet_getTransactions', async (params) => {
        const { limit, offset } = params as { limit?: number; offset?: number };
        const revision = walletDisplayRevision();
        const { provider, acct, assertCurrent } = await getConnectedProvider();
        assertCurrent();
        const transactions = await provider.listTransactions(limit ?? 10, offset ?? 0);
        assertCurrent();
        if (!offset) await updateWalletDisplayCache(acct.id, {providerType:provider.type,transactions}, revision).catch(() => {});
        assertCurrent();
        return transactions;
    }],

    ['wallet_payInvoice', async (params) => {
        const { bolt11 } = params as { bolt11: string };
        const { provider, assertCurrent } = await getConnectedProvider();
        assertCurrent();
        return await provider.payInvoice(bolt11);
    }],

    ['wallet_resolveLightningAddress', async (params) => {
        await vault.requireUnlocked();
        const { address } = params as { address: string };
        const payParams = await fetchPayParams(address);
        const minSats = Math.ceil(payParams.minSendable / 1000);
        const maxSats = Math.floor(payParams.maxSendable / 1000);
        // Rounding the ends of a sub-sat range inward inverts it (500–900 msats
        // becomes 1–0), which the popup would render as a form no amount can
        // satisfy. Refuse here, where we can say why.
        if (maxSats < minSats) {
            throw new Error('This endpoint does not accept any whole-sat amount');
        }
        // Only what the popup needs to render a confirmation — the callback URL
        // stays in the background, so the resolution the user sees is the one
        // that gets paid (the popup can't be talked into a different callback).
        return {
            address: payParams.address,
            domain: payParams.domain,
            minSats,
            maxSats,
            description: payParams.description,
            commentAllowed: payParams.commentAllowed,
            allowsNostr: payParams.allowsNostr,
        };
    }],

    ['wallet_payToLightningAddress', async (params) => {
        const { address, amountSats, comment, intentId } = params as {
            address: string; amountSats: number; comment?: string; intentId?: string;
        };
        const { provider, assertCurrent } = await getConnectedProvider();
        if (!provider) throw new Error('Provider not available');
        // At most once per click. Each call asks the endpoint for a NEW invoice,
        // so a blind rpc() retry after a lost reply would pay a second, unrelated
        // payment hash that the node cannot recognise as a duplicate.
        // See services/wallet/payment-intents.ts.
        return await runPaymentOnce(intentId, async () => {
            // Re-resolve rather than trusting anything cached in the popup: the
            // invoice must come from the address the user is looking at right now.
            const payParams = await fetchPayParams(address);
            const { bolt11 } = await requestInvoice(payParams, amountSats, comment);
            assertCurrent();
            const { preimage } = await provider.payInvoice(bolt11);
            return { preimage, bolt11, amountSats, address: payParams.address };
        });
    }],

    ['wallet_provision', async (params) => {
        await vault.requireUnlocked();
        const acctId = vault.getActiveAccountId();
        if (!acctId) throw new Error('No active account');
        const acct = vault.getActiveAccountWithWallet();
        if (!acct) throw new Error('No active account');

        const session = captureAccountSession(acctId);
        const url = (params.instanceUrl as string)?.trim() || DEFAULT_LNBITS_URL;
        const npub = npubEncode(acct.pubkey);
        const walletName = `WoT:${npub.slice(0, 16)}`;

        const signFn = createNip98SignFn(acctId, `${url.replace(/\/+$/, '')}/api/provision`);
        const { adminKey, nwcUri } = await provisionLnbitsWallet(url, walletName, signFn);

        assertAccountSession(session);
        const walletConfig: WalletConfig = { type: 'lnbits', instanceUrl: url, adminKey, nwcUri };
        removeWalletProvider(acctId);
        await vault.updateAccountWalletConfig(acctId, walletConfig);
        await resetWalletDisplayCache(acctId, walletConfig.type);
        const provider = getWalletProvider(acctId, walletConfig);
        if (provider) await provider.connect();
        return true;
    }],

    ['wallet_getNwcUri', async () => {
        await vault.requireUnlocked();
        const acct = vault.getActiveAccountWithWallet();
        if (!acct?.walletConfig || acct.walletConfig.type !== 'lnbits') return null;
        return acct.walletConfig.nwcUri ?? null;
    }],

    ['wallet_claimLightningAddress', async (params) => {
        await vault.requireUnlocked();
        const acctId = vault.getActiveAccountId();
        if (!acctId) throw new Error('No active account');
        const acct = vault.getActiveAccountWithWallet();
        if (!acct?.walletConfig || acct.walletConfig.type !== 'lnbits') {
            throw new Error('No LNbits wallet configured');
        }
        const url = acct.walletConfig.instanceUrl;
        const signFn = createNip98SignFn(acctId, `${url.replace(/\/+$/, '')}/api/claim-username`);
        return await claimLightningAddress(url, params.username as string, signFn);
    }],

    ['wallet_getLightningAddress', async () => {
        await vault.requireUnlocked();
        const acct = vault.getActiveAccountWithWallet();
        if (!acct?.walletConfig || acct.walletConfig.type !== 'lnbits') {
            return { address: null };
        }
        const address = await getLightningAddress(acct.walletConfig.instanceUrl, acct.pubkey);
        return { address };
    }],

    ['wallet_releaseLightningAddress', async () => {
        await vault.requireUnlocked();
        const acctId = vault.getActiveAccountId();
        if (!acctId) throw new Error('No active account');
        const acct = vault.getActiveAccountWithWallet();
        if (!acct?.walletConfig || acct.walletConfig.type !== 'lnbits') {
            throw new Error('No LNbits wallet configured');
        }
        const url = acct.walletConfig.instanceUrl;
        const signFn = createNip98SignFn(acctId, `${url.replace(/\/+$/, '')}/api/release-username`);
        await releaseLightningAddress(url, signFn);
        return { ok: true };
    }],
]);
