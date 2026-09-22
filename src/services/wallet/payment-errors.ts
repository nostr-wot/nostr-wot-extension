import { PAYMENT_OUTCOME_UNKNOWN } from '@constants/wallet.ts';

/** A payment was published, but no trustworthy final outcome was received. */
export class PaymentOutcomeUnknownError extends Error {
  constructor(detail?: string) {
    super(PAYMENT_OUTCOME_UNKNOWN, { cause: detail });
    this.name = 'PaymentOutcomeUnknownError';
  }
}
