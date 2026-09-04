import React, { useState, useEffect, useMemo, useRef, ChangeEvent } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@lib/i18n.js';
import Button from '@components/Button/Button';
import Input from '@components/Input/Input';
import Modal from '@components/Modal/Modal';
import { decodeBolt11 } from '@lib/wallet/bolt11.ts';
import { isLightningAddress } from '@lib/wallet/lnurl.ts';
import { resolveSendTarget } from '@domain/wallet/sendTarget.ts';
import { describeInvoiceExpiry } from '@domain/wallet/invoiceExpiry.ts';
import { PAYMENT_IN_FLIGHT } from '@lib/wallet/types.ts';
import FormError from '@components/FormError/FormError';
import FieldDisplay from '@components/FieldDisplay/FieldDisplay';
import Container from '@components/Container/Container';
import Text from '@components/Text/Text';

/** What `wallet_resolveLightningAddress` hands back for the confirmation card. */
interface ResolvedAddress {
  address: string;
  domain: string;
  minSats: number;
  maxSats: number;
  description: string | null;
  commentAllowed: number;
  allowsNostr: boolean;
}

interface SendDialogProps {
  onClose: () => void;
  /** A payment landed — refresh balance and transactions. */
  onSent: () => void;
}

/**
 * Turn a payment failure into something worth showing.
 *
 * Most of what reaches here is an LNURL or provider message written in English
 * in the background, which is its own problem; the codes the background raises
 * deliberately are at least translated. Anything unrecognised is passed through
 * rather than replaced by a generic string — a specific English reason beats an
 * accurate but useless one.
 */
function paymentErrorMessage(e: unknown): string {
  const message = (e as Error)?.message || '';
  if (message.includes(PAYMENT_IN_FLIGHT)) return t('wallet.paymentInFlight');
  return message;
}

/** Turns the pure expiry shape into the translated string the row shows. */
function invoiceExpiryLabel(inv: { timestamp: number; expiry: number }): string {
  const e = describeInvoiceExpiry(inv.timestamp, inv.expiry, Date.now());
  if (e.state === 'expired') return t('wallet.invoiceExpired');
  if (e.state === 'minutes') return t('wallet.invoiceMinutes', { n: e.n });
  return t('wallet.invoiceHours', { n: e.n });
}

/**
 * Pay a BOLT11 invoice or a Lightning Address.
 *
 * The whole send path lives here: the debounced address resolve, the single
 * `sendTarget` answer that the Pay button and the handler share, and the
 * payment itself. Mounting it only while open means closing it is the reset —
 * the parent used to clear eight fields by hand.
 */
export default function SendDialog({ onClose, onSent }: SendDialogProps) {
  const [sendInput, setSendInput] = useState<string>('');
  const [sendLoading, setSendLoading] = useState<boolean>(false);
  const [sendError, setSendError] = useState<string>('');
  const [sendSuccess, setSendSuccess] = useState<string>('');
  // Lightning Address send (LUD-16)
  const [sendAddress, setSendAddress] = useState<ResolvedAddress | null>(null);
  const [resolveLoading, setResolveLoading] = useState<boolean>(false);
  const [resolveError, setResolveError] = useState<string>('');
  const [sendAmount, setSendAmount] = useState<string>('');
  const [sendComment, setSendComment] = useState<string>('');

  // A Lightning Address goes in the same field as an invoice; decide which one
  // this is before trying to decode it as BOLT11.
  const sendIsAddress = useMemo(() => isLightningAddress(sendInput), [sendInput]);

  // Decode pasted invoice for preview
  const decodedInvoice = useMemo(() => {
    const trimmed = sendInput.trim();
    if (!trimmed || sendIsAddress) return null;
    return decodeBolt11(trimmed);
  }, [sendInput, sendIsAddress]);

  // Resolve a typed Lightning Address to its pay params, debounced so a partial
  // address does not fire a request on every keystroke.
  //
  // The address we last resolved lives in a ref rather than in the dependency
  // array: keying the effect on `sendAddress?.address` made it re-enter itself
  // as soon as the body cleared that state.
  const resolvedForRef = useRef<string | null>(null);
  useEffect(() => {
    const trimmed = sendInput.trim().toLowerCase();
    if (!sendIsAddress) {
      resolvedForRef.current = null;
      setSendAddress(null);
      setResolveError('');
      setResolveLoading(false);
      return;
    }
    if (resolvedForRef.current === trimmed) return;

    // Drop the old resolution NOW, before the debounce. Leaving it in place is
    // what let the Pay button stay enabled against the previous recipient for
    // 400ms while the field already showed a different address.
    resolvedForRef.current = null;
    setSendAddress(null);
    // And the amount and comment that belonged to the old recipient. `prev ||`
    // below only seeds an EMPTY field, so a figure typed for alice survived into
    // bob's form — and where it happened to fall inside bob's range it was
    // payable with one inattentive click, at an amount chosen for someone else.
    // The comment is worse: it is sent to the endpoint, so a note meant for one
    // person would be delivered to another.
    setSendAmount('');
    setSendComment('');

    let cancelled = false;
    setResolveLoading(true);
    setResolveError('');
    const timer = setTimeout(async () => {
      try {
        const resolved = await rpc<ResolvedAddress>('wallet_resolveLightningAddress', { address: trimmed });
        if (cancelled) return;
        resolvedForRef.current = trimmed;
        setSendAddress(resolved);
        // Seed the amount with the minimum so a one-amount endpoint (a fixed
        // price, min === max) needs no typing at all.
        setSendAmount((prev) => prev || String(resolved.minSats));
      } catch (e: unknown) {
        if (cancelled) return;
        resolvedForRef.current = null;
        setSendAddress(null);
        setResolveError((e as Error).message);
      } finally {
        if (!cancelled) setResolveLoading(false);
      }
    }, 400);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [sendInput, sendIsAddress]);

  // The single answer to "what would Pay send?", shared by the button's guard
  // and the handler so the two cannot disagree. See src/shared/sendTarget.ts.
  const sendTarget = useMemo(() => resolveSendTarget({
    input: sendInput,
    isAddress: sendIsAddress,
    resolved: sendAddress,
    amount: sendAmount,
    invoiceDecodable: !!decodedInvoice,
  }), [sendInput, sendIsAddress, sendAddress, sendAmount, decodedInvoice]);

  const handleSend = async () => {
    // Ask once, act on that answer. Recomputing the recipient here — or
    // branching on `sendAddress` while the button gated on something else — is
    // how the previous address got paid.
    const target = sendTarget;
    if (target.kind === 'none') return;
    setSendLoading(true);
    setSendError('');
    setSendSuccess('');
    try {
      if (target.kind === 'address') {
        await rpc<{ preimage: string }>('wallet_payToLightningAddress', {
          address: target.address,
          amountSats: target.amountSats,
          comment: sendAddress && sendAddress.commentAllowed > 0
            ? sendComment.trim() || undefined
            : undefined,
          // One id per click, so a transport-level rpc() retry replays the
          // result instead of sending a second payment.
          intentId: crypto.randomUUID(),
        });
      } else {
        await rpc<{ preimage: string }>('wallet_payInvoice', { bolt11: target.bolt11 });
      }
      setSendSuccess(t('wallet.paymentSent'));
      onSent();
    } catch (e: unknown) {
      setSendError(paymentErrorMessage(e));
    }
    setSendLoading(false);
  };

  return (
  <Modal
        title={t('wallet.sendPayment')}
        onClose={onClose}
        maxWidth={300}
        /* A stray backdrop click must not tear down a payment mid-flight. */
        dismissOnBackdrop={!sendLoading}
        footerRow={!sendSuccess}
        footer={(
          <>
            <Button small variant="secondary" onClick={onClose} disabled={sendLoading}>
              {sendSuccess ? t('common.close') : t('common.cancel')}
            </Button>
            {!sendSuccess && (
              <Button
                small
                onClick={handleSend}
                disabled={sendLoading || sendTarget.kind === 'none'}
              >
                {sendLoading ? t('common.loading') : t('wallet.confirmPay')}
              </Button>
            )}
          </>
        )}
      >
        <Text variant="secondary" as="div" className="text-sm">{t('wallet.sendDesc')}</Text>
          <Container gap={5}>
            <Input
              type="text"
              placeholder={t('wallet.pasteInvoiceOrAddress')}
              value={sendInput}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setSendInput(e.target.value)}
              small
            />

            {/* Lightning Address preview + amount */}
            {sendIsAddress && !sendSuccess && (
              resolveLoading ? (
                <Container variant="box">
                  <span className="text-xs font-semibold text-muted uppercase tracking-[0.3px] shrink-0">{t('wallet.resolvingAddress')}</span>
                </Container>
              ) : sendAddress ? (
                <>
                  <Container variant="box">
                    <FieldDisplay caps className="py-0" label={t('wallet.payTo')} value={sendAddress.address} />
                    {sendAddress.description && (
                      <FieldDisplay caps className="py-0" label={t('wallet.invoiceDescription')} value={sendAddress.description} />
                    )}
                    <FieldDisplay
                      caps
                      className="py-0"
                      label={t('wallet.addressRange')}
                      value={t('wallet.addressRangeValue', {
                        min: sendAddress.minSats.toLocaleString(),
                        max: sendAddress.maxSats.toLocaleString(),
                      })}
                    />
                  </Container>
                  <Input
                    type="number"
                    placeholder={t('wallet.amountSats')}
                    value={sendAmount}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setSendAmount(e.target.value)}
                    small
                  />
                  {sendAddress.commentAllowed > 0 && (
                    <Input
                      type="text"
                      placeholder={t('wallet.commentPlaceholder')}
                      value={sendComment}
                      maxLength={sendAddress.commentAllowed}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setSendComment(e.target.value)}
                      small
                    />
                  )}
                  {sendAmount !== '' && sendTarget.kind === 'none' && sendTarget.reason === 'amount' && (
                    <Text variant="muted" as="div" className="text-center py-3">
                      {t('wallet.amountOutOfRange', {
                        min: sendAddress.minSats.toLocaleString(),
                        max: sendAddress.maxSats.toLocaleString(),
                      })}
                    </Text>
                  )}
                </>
              ) : resolveError ? (
                <Text variant="muted" as="div" className="text-center py-3">{resolveError}</Text>
              ) : null
            )}

            {/* Invoice preview */}
            {sendInput.trim() && !sendIsAddress && !sendSuccess && (
              decodedInvoice ? (
                <Container variant="box">
                  <FieldDisplay
                    caps
                    className="py-0"
                    valueClassName="text-xl font-bold"
                    label={t('wallet.invoiceAmount')}
                    value={decodedInvoice.amountSats !== null
                      ? `${Math.round(decodedInvoice.amountSats).toLocaleString()} sats`
                      : '—'}
                  />
                  <FieldDisplay
                    caps
                    className="py-0"
                    label={t('wallet.invoiceDescription')}
                    value={decodedInvoice.description || t('wallet.invoiceNone')}
                  />
                  <FieldDisplay
                    caps
                    className="py-0"
                    label={t('wallet.invoiceExpiry')}
                    value={invoiceExpiryLabel(decodedInvoice)}
                  />
                </Container>
              ) : (
                <Text variant="muted" as="div" className="text-center py-3">{t('wallet.decodeFailed')}</Text>
              )
            )}

            <FormError>{sendError}</FormError>
            {sendSuccess && <div className="text-sm text-success">{sendSuccess}</div>}
          </Container>
      </Modal>
  );
}
