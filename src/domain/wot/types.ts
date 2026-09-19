export interface WotScoring {
    distanceWeights: Record<1 | 2 | 3 | 4, number>;
    pathBonus: Record<2 | 3 | 4, number>;
    maxPathBonus: number;
}
export interface WotSyncProgress {
    accountId: string;
    phase: 'fetching' | 'complete' | 'failed' | 'cancelled';
    running: boolean;
    depth: number;
    authors: number;
    people: number;
    lists: number;
    startedAt: number;
    updatedAt: number;
    error?: string;
}
export interface WotDatabase {
    accountId: string;
    name: string;
    pubkey: string;
    bytes: number;
    estimated: boolean;
    people: number;
    authors: number;
    updatedAt: number;
}
export interface WotDatabaseSummary {
    sharedCache?: {records:number;bytes:number};
    databases: WotDatabase[];
    accounts: number;
    bytes: number;
    estimated: boolean;
}
export type WotMode = 'local' | 'remote' | 'hybrid';
export interface WotSettings {
    /** null means no total edge cap. */
    maxEdges: number | null;
    maxAuthors: number | null;
    maxFollows: number | null;
    autoSync: boolean;
    scoring: WotScoring;
    enabled: boolean;
    mode: WotMode;
    oracleUrl: string;
    maxHops: number;
}
export interface WotGraph {
    relayVersions?: Record<string, { createdAt: number; id: string }>;
    fullRefreshedAt?: number;
    listVersions?: Record<string, { createdAt: number; id: string }>;
    missingFollowLists?: number;
    root: string;
    follows: Record<string, string[]>;
    relays: Record<string, {
        url: string;
        read: boolean;
        write: boolean;
    }[]>;
    updatedAt: number;
    truncated: boolean;
}
export interface WotDetails {
    hops: number;
    paths: number | null;
    score: number;
}
export interface WotState {
    nodes?: number;
    edges?: number;
    progress?: WotSyncProgress | null;
    people?: number;
    missingFollowLists?: number;
    muteStatus?: 'ready' | 'unavailable' | 'private-unavailable';
    settings: WotSettings;
    hasLocalGraph: boolean;
    syncing: boolean;
    updatedAt: number | null;
    authors: number;
    truncated: boolean;
}
/** Historical page API, exposed only after experimental opt-in. */
export interface WotApi {
    getDistance(target: string): Promise<number | null>;
    isInMyWoT(target: string, maxHops?: number): Promise<boolean>;
    getTrustScore(target: string): Promise<number | null>;
    getDetails(target: string): Promise<{
        hops: number;
        paths: number | null;
        score: number;
    } | null>;
    getConfig(): Promise<unknown>;
    getDistanceBatch(targets: string[], options?: boolean | {
        includePaths?: boolean;
        includeScores?: boolean;
    }): Promise<unknown>;
    getTrustScoreBatch(targets: string[]): Promise<Record<string, number | null>>;
    filterByWoT(pubkeys: string[], maxHops?: number): Promise<string[]>;
    getStatus(): Promise<unknown>;
    getFollows(pubkey?: string): Promise<string[]>;
    getCommonFollows(pubkey: string): Promise<string[]>;
    getStats(): Promise<unknown>;
    getPath(target: string): Promise<string[] | null>;
    getRelayList(pubkey: string): Promise<unknown>;
    getRelayPool(): Promise<unknown>;
}
