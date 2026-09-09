/**
 * Human-readable labels for permission keys.
 * These are the keys stored in permissions (not wire method names).
 */
export const PERM_LABELS: Record<string, string> = {
  'signEvent:0': 'perm.editProfile',
  'signEvent:1': 'perm.post',
  'signEvent:3': 'perm.updateContacts',
  'signEvent:5': 'perm.deleteEvent',
  'signEvent:6': 'perm.repost',
  'signEvent:7': 'perm.reaction',
  'signEvent:1111': 'perm.comment',
  'signEvent:9734': 'perm.zap',
  'signEvent:24242': 'perm.blossomAuth',
  'signEvent:27235': 'perm.httpAuth',
  'signEvent:30023': 'perm.article',
  'readMessages': 'perm.readMessages',
  'sendMessages': 'perm.sendMessages',
  'getPublicKey': 'perm.readProfile',
};

/** Fallback labels for wire method names (used when permKey is unavailable). */
export const WIRE_METHOD_LABELS: Record<string, string> = {
  'signEvent': 'approval.signEvent',
  'nip04Encrypt': 'activity.sendMessage',
  'nip04Decrypt': 'activity.readMessage',
  'nip44Encrypt': 'activity.sendMessage',
  'nip44Decrypt': 'activity.readMessage',
  'getPublicKey': 'perm.readProfile',
};

/**
 * Known platform-specific actions for kind 30078 (App-specific Data).
 * Keyed by platform prefix extracted from the d-tag identifier.
 */
export const PLATFORM_ACTIONS: Record<string, Record<string, string>> = {
  'Primal': {
    'get_membership_status': 'platform.membershipStatus',
    'get_app_settings': 'platform.primalSettings',
    'set_app_settings': 'platform.primalSettings',
  },
};
