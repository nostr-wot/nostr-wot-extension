/** Public metadata only: rejected event content and keys are never retained here. */
export interface SigningRejection {
  id: string;
  timestamp: number;
  origin: string;
  kind: number;
  requestedPubkey: string;
  activePubkey: string | null;
  reason: 'accountMismatch';
}
