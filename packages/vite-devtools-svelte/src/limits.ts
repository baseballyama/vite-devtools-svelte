// Shared by the dev server and the MCP tools; kept import-free so the stdio relay (cli) does not load the collector.
export const MAX_EPOCH_LENGTH = 200;

export const GRAPH_LIMITS = { nodes: 5000, edges: 20000 } as const;

export const SUMMARY_TOP_K = { default: 50, max: 200 } as const;
