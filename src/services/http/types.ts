/** Injectable HTTP transport shared by network-backed services. */
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
