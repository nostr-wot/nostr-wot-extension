/** Applies to the complete wallet HTTP request, including response streaming. */
export const WALLET_HTTP_TIMEOUT_MS = 15_000;
/** History pages need more room than provisioning responses, but remain bounded. */
export const WALLET_HTTP_MAX_RESPONSE_BYTES = 1024 * 1024;
