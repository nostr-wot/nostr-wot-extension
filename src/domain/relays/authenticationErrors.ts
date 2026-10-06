/** Relay configuration failures cannot be repaired by signing another challenge. */
export function relayAuthConfigurationError(message: string): boolean {
  return /serviceUrl.*configur|auth.*not (?:enabled|configured)|authentication.*disabled/i.test(message);
}
export function relayAuthenticationError(message: string): boolean {
  return /auth-required:|authentication (?:refused|failed|challenge changed|required)|not authenticated/i.test(message);
}

/** Some relays wrap NIP-42 reason prefixes in a generic ERROR prefix. */
export function relayAuthenticationRequired(message: string): boolean {
  return /^(?:error:\s*)?auth-required:/i.test(message.trim());
}
