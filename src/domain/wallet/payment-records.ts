/** Financial contents are encrypted; the key is only an account-scoped change signal. */
export const paymentRecordsKey = (accountId: string) => `walletPaymentRecords_${accountId}`;
export interface PaymentNotice {
  id: string;
  origin: string;
  amount: number;
  timestamp: number;
}
