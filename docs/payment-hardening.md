# Payment integrity and automatic spending

LNURL callbacks must return the exact requested integer millisatoshi amount. The
BOLT11 decoder preserves fractional sats instead of rounding them, refuses
sub-millisatoshi values, malformed amount syntax, unsafe integer amounts and
truncated tagged fields. An amountless invoice cannot satisfy an LNURL payment.

LNURL validation follows the current [LUD-06 text](https://github.com/lnurl/luds/blob/luds/06.md):
the invoice amount must match the requested amount exactly. The wallet does not
require an `h` tag or compare an invoice description hash with LNURL metadata.
Plain-description invoices and invoices whose hash refers to other description
text remain compatible. BOLT11 hash-field parsing and structural checks remain
separate from LNURL amount validation.
The lightweight decoder does not verify the invoice signature; the payment provider
remains responsible for BOLT11 signature validation.

The WebLN threshold is both a per-invoice cap and a cumulative cap over the past
24 hours for each account, shared by all requesting sites. Default 0 always asks.
Requests above the remaining budget use the existing explicit approval prompt.
A remembered permission never bypasses either cap, and deny still takes priority.

Before automatically approving, the background worker serializes reservations for
that account and persists the amount and time in authenticated encrypted local
storage. Restarting the worker does not reset the allowance. Payment failure,
ambiguous timeout, account switch or cancellation after reservation does not refund
it: the provider may have accepted the payment despite an error. Reservations expire
24 hours after creation; a clock rollback conservatively keeps future entries.
Changing the threshold does not erase spending. Storage failure or corrupt records
prevent automatic approval and require an explicit prompt.

Explicitly approved payments are outside the automatic allowance. This limits
unattended spending, not the account's total possible spend. The cap counts invoice
amounts; routing fees remain governed by the wallet provider.
