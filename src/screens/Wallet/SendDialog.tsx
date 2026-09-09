import { useState, useEffect, useMemo, useRef, ChangeEvent } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import Button, { ButtonSecondary } from '@components/Button';
import Input from '@components/Input';
import Modal from '@components/Modal';
import { decodeBolt11 } from '@domain/wallet/bolt11.ts';
import { isLightningAddress, parseLnurl } from '@domain/wallet/lnurl.ts';
import { resolveSendTarget } from '@domain/wallet/sendTarget.ts';
import type { ResolvedAddress } from '@domain/wallet/paymentPreview.ts';
import { paymentErrorMessage } from '@services/i18n/paymentLabels.ts';
import PaymentPreview from './PaymentPreview';
import FormError from '@components/FormError';
import Container from '@components/Container';
import Text from '@components/Text';

interface SendDialogProps {
  onClose: () => void;
  /** A payment landed — refresh balance and transactions. */
  onSent: () => void;
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
  const sendIsAddress = useMemo(() => isLightningAddress(sendInput) || parseLnurl(sendInput) !== null, [sendInput]);

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
    const trimmed = sendInput.trim();
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
  // and the handler so the two cannot disagree. See domain/wallet/sendTarget.ts.
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
        maxWidth={340}
        /* A stray backdrop click must not tear down a payment mid-flight. */
        dismissOnBackdrop={!sendLoading}
        footerRow={!sendSuccess}
        footer={(
          <>
            <ButtonSecondary small onClick={onClose} disabled={sendLoading}>
              {sendSuccess ? t('common.close') : t('common.cancel')}
            </ButtonSecondary>
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
        <Container gap={6}>
      <Text variant="secondary" as="div" className="text-sm leading-normal text-menu-subtitle">{t('wallet.sendDesc')}</Text>
          <Container gap={5}>
            <Input
              type="text"
              label={t('wallet.payTo')}
              placeholder={t('wallet.pasteInvoiceOrAddress')}
              value={sendInput}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setSendInput(e.target.value)}
              small
            />

            {!sendSuccess && <PaymentPreview sendInput={sendInput} sendIsAddress={sendIsAddress}
              sendAddress={sendAddress} resolveLoading={resolveLoading} resolveError={resolveError}
              sendAmount={sendAmount} sendComment={sendComment} sendTarget={sendTarget}
              decodedInvoice={decodedInvoice} setSendAmount={setSendAmount} setSendComment={setSendComment} />}

            <FormError>{sendError}</FormError>
            {sendSuccess && <div className="text-sm text-success">{sendSuccess}</div>}
          </Container>
      </Container>
    </Modal>
  );
}
