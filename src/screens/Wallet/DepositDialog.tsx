import { useState, useEffect, ChangeEvent } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@lib/i18n.js';
import Button from '@components/Button/Button';
import Input from '@components/Input/Input';
import Modal from '@components/Modal/Modal';
import QrCode from '@components/QrCode/QrCode';
import useCopy from '@hooks/useCopy.ts';
import { formatSats } from '@utils/format/number.ts';
import FormError from '@components/FormError/FormError';
import Container from '@components/Container/Container';
import Text from '@components/Text/Text';

interface Invoice {
  bolt11: string;
  paymentHash: string;
  /** Kept with the invoice, not read from the amount field.
   *  The field is hidden once an invoice exists, so reading it later meant
   *  reading through a stale closure for a value that could no longer change —
   *  it worked, but only by accident of the form being unreachable. */
  amountSats: number;
}

interface DepositDialogProps {
  onClose: () => void;
  /** Refresh balance and transactions — the money has arrived. */
  onPaid: () => void;
}

/**
 * Create an invoice, show it, and watch for payment.
 *
 * Mounted only while open, so closing it *is* the reset — the parent used to
 * clear eight pieces of state by hand on every close.
 */
export default function DepositDialog({ onClose, onPaid }: DepositDialogProps) {
  const [amount, setAmount] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [paid, setPaid] = useState<{ amount: number } | null>(null);
  const [error, setError] = useState<string>('');
  const bolt11Copy = useCopy();

  // Poll while an unpaid invoice is on screen.
  //
  // `paid` is deliberately not a dependency: setting it would re-run the effect,
  // and the cleanup would cancel the auto-close timer we just armed.
  useEffect(() => {
    if (!invoice || paid) return;

    let cancelled = false;
    let detected = false;
    let autoCloseTimer: ReturnType<typeof setTimeout> | null = null;

    const interval = setInterval(async () => {
      if (detected) return;
      try {
        const res = await rpc<{ paid: boolean; amountPaid?: number }>(
          'wallet_checkInvoice',
          { paymentHash: invoice.paymentHash },
        );
        if (cancelled || detected) return;
        if (res?.paid) {
          detected = true;
          clearInterval(interval);
          setPaid({ amount: res.amountPaid ?? invoice.amountSats });
          onPaid();
          autoCloseTimer = setTimeout(() => { if (!cancelled) onClose(); }, 2500);
        }
      } catch {
        // transient errors are ignored; polling continues
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      if (autoCloseTimer) clearTimeout(autoCloseTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice]);

  const createInvoice = async () => {
    const sats = parseInt(amount, 10);
    if (!sats || sats <= 0) return;
    setLoading(true);
    setError('');
    try {
      const result = await rpc<{ bolt11: string; paymentHash: string }>(
        'wallet_makeInvoice', { amount: sats, memo: 'Deposit' },
      );
      setInvoice({ bolt11: result.bolt11, paymentHash: result.paymentHash, amountSats: sats });
    } catch (e: unknown) {
      setError((e as Error).message);
    }
    setLoading(false);
  };

  return (
    <Modal
      title={t('wallet.deposit')}
      onClose={onClose}
      maxWidth={340}
      footerRow={!paid}
      footer={paid ? (
        <Button small onClick={onClose}>{t('common.close')}</Button>
      ) : !invoice ? (
        <>
          <Button small variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button small onClick={createInvoice} disabled={loading || !amount || parseInt(amount, 10) <= 0}>
            {loading ? t('common.loading') : t('wallet.createInvoice')}
          </Button>
        </>
      ) : (
        <>
          <Button small variant="secondary" onClick={() => bolt11Copy.copy(invoice.bolt11)}>
            {bolt11Copy.copied ? t('common.copied') : t('common.copy')}
          </Button>
          <Button small onClick={onClose}>{t('common.close')}</Button>
        </>
      )}
    >
      <Container gap={6}>
      <Text variant="secondary" as="div" className="text-sm leading-normal text-menu-subtitle">{t('wallet.depositDesc')}</Text>
      {paid ? (
        <Container gap={4} className="text-center">
          <div className="text-[48px] leading-none text-success">{'✓'}</div>
          <div className="text-lg font-semibold text-success">{t('wallet.paymentReceived')}</div>
          <div className="text-2xl text-success">{`+${formatSats(paid.amount)}`}</div>
        </Container>
      ) : !invoice ? (
        <Container gap={5}>
          <Input
            type="number"
            label={t('wallet.amountSats')}
            min={1} step={1}
            placeholder={t('wallet.amountSats')}
            value={amount}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setAmount(e.target.value)}
            small
          />
          <FormError>{error}</FormError>
        </Container>
      ) : (
        <>
          <div className="flex justify-center"><QrCode value={invoice.bolt11} size={200} className="rounded-md overflow-hidden" /></div>
          {/* The only way to copy the invoice, so it has to be reachable
              without a mouse. It was a div with an onClick. */}
          <button
            type="button"
            className="w-full border-none bg-card font-mono text-2xs text-muted break-all text-center max-h-30 overflow-y-auto py-3 px-4 rounded-sm cursor-pointer"
            onClick={() => bolt11Copy.copy(invoice.bolt11)}
            aria-label={t('common.copy')}
          >
            {invoice.bolt11}
          </button>
        </>
      )}
    </Container>
    </Modal>
  );
}
