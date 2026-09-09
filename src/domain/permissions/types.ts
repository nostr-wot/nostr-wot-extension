// ── Permissions ──

export type PermissionDecision = 'allow' | 'deny' | 'ask';

/** Per-domain permission bucket: { permKey: decision } */
export type PermissionBucket = Record<string, PermissionDecision>;

/** Per-domain permissions: { bucketId: { permKey: decision } } */
export type DomainPermissions = Record<string, PermissionBucket>;

/** Full permission storage: { domain: { bucketId: { permKey: decision } } } */
export type PermissionMap = Record<string, DomainPermissions>;
