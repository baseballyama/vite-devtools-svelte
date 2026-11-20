import { MCP_PATH } from './http.js';
import { RELAY_INSTRUCTIONS } from './instructions.js';
import {
  createMcpServer,
  text,
  toolError,
  type McpServer,
  type ToolInfo,
  type ToolResult,
} from './protocol.js';
import { listServers, selectServer, type RegistryEntry } from './registry.js';
import { devServerTools, type McpDeps } from './tools.js';

type Target = Pick<RegistryEntry, 'url' | 'token'>;

export interface RelayOptions {
  /** Directory the MCP client started us in: picks the dev server. */
  cwd: string;
  /** Reads `VITE_DEVTOOLS_SVELTE_URL` / `_TOKEN`. */
  env: NodeJS.ProcessEnv;
  /** Registry of running dev servers (`registryDir()`). */
  registry: string;
  version: string;
  /** Version of a project install too old to register its dev server. */
  outdatedLocalVersion?: string;
}

const LIST_DEV_SERVERS: ToolInfo = {
  name: 'list_dev_servers',
  title: 'Running dev servers',
  description:
    'Dev servers running with the vite-devtools-svelte plugin on this machine, and which one the other tools use when `server` is omitted.',
  inputSchema: { type: 'object', properties: {} },
};

const SERVER_ARG = {
  type: 'string',
  description:
    'Dev server to ask: an id from list_dev_servers (or its root / package name). Needed only when more than one is running.',
};

/** The dev server endpoint's tools, each with a `server` argument. */
function relayedTools(): ToolInfo[] {
  // Only listed, never called here, so the handlers never read `deps`.
  const tools = devServerTools({} as McpDeps).listTools();
  for (const tool of tools) {
    // `$schema` last keeps tools/list byte-identical to the SDK relay (see the mcp-wire snapshot).
    const { $schema, ...schema } = tool.inputSchema;
    tool.inputSchema = {
      ...schema,
      properties: { ...schema.properties, server: SERVER_ARG },
      $schema,
    };
  }
  return tools;
}

/** Accepted by every plugin version the relay may reach. */
const PROTOCOL_VERSION = '2025-06-18';
/** The SDK client's default request timeout. */
const CALL_TIMEOUT_MS = 60_000;

/** One stateless `tools/call` POST: every plugin version answers it as JSON, without initialize. */
async function forward(target: Target, name: string, args: object): Promise<ToolResult> {
  const res = await fetch(target.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': PROTOCOL_VERSION,
      'x-svelte-devtools-token': target.token,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Streamable HTTP error: Error POSTing to endpoint: ${body}`);
  const message = JSON.parse(body) as {
    result?: ToolResult;
    error?: { code: number; message: string };
  } | null;
  if (message?.error) throw new Error(`MCP error ${message.error.code}: ${message.error.message}`);
  const result = message?.result;
  if (!result || typeof result !== 'object') throw new Error('Invalid response');
  return result;
}

const describeEntry = (e: RegistryEntry) => `${e.id}: ${e.packageName} at ${e.root}`;

function endpointUrl(raw: string): string {
  const url = new URL(raw);
  if (url.pathname === '/' || url.pathname === '') url.pathname = MCP_PATH;
  return url.href;
}

/**
 * The stdio MCP server behind `vite-devtools-svelte mcp`: lists the dev
 * server tools even when no dev server runs, and forwards each call to the
 * dev server the client means (see `selectServer`).
 */
export function createRelay(opts: RelayOptions): McpServer {
  const tools = relayedTools();

  const { VITE_DEVTOOLS_SVELTE_URL: overrideUrl, VITE_DEVTOOLS_SVELTE_TOKEN: overrideToken } =
    opts.env;

  function resolveTarget(name?: string): Target | string {
    if (overrideUrl) {
      if (!overrideToken) {
        return 'VITE_DEVTOOLS_SVELTE_URL is set without VITE_DEVTOOLS_SVELTE_TOKEN.';
      }
      return { url: endpointUrl(overrideUrl), token: overrideToken };
    }
    const selection = selectServer(listServers(opts.registry), opts.cwd, name);
    if (selection.kind === 'found') return selection.entry;
    if (selection.kind === 'ambiguous') {
      return [
        'More than one dev server matches. Pass `server` with one of these ids:',
        ...selection.candidates.map(describeEntry),
      ].join('\n');
    }
    const lines = [
      name === undefined
        ? `No running dev server for ${opts.cwd}. Ask the user to start the app's dev server (e.g. \`vite dev\`) with the vite-devtools-svelte plugin.`
        : `No running dev server matches "${name}".`,
    ];
    if (name === undefined && opts.outdatedLocalVersion) {
      lines.push(
        `The project has @sveltejs/vite-devtools-svelte ${opts.outdatedLocalVersion}, which does not announce its dev server: ask the user to upgrade it.`,
      );
    }
    if (selection.others.length > 0) {
      lines.push(
        'Running dev servers (pass `server` to use one):',
        ...selection.others.map(describeEntry),
      );
    }
    return lines.join('\n');
  }

  async function callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    if (name === LIST_DEV_SERVERS.name) {
      const servers = listServers(opts.registry);
      const selection = selectServer(servers, opts.cwd);
      // The override takes every call, so no registered server is the default.
      const selected = !overrideUrl && selection.kind === 'found' ? selection.entry.id : null;
      return text({
        cwd: opts.cwd,
        override: overrideUrl ? endpointUrl(overrideUrl) : null,
        servers: servers.map(({ id, packageName, root, url, startedAt }) => ({
          id,
          packageName,
          root,
          url,
          startedAt,
          default: id === selected,
        })),
      });
    }
    if (!tools.some(t => t.name === name)) return toolError(`Unknown tool: ${name}`);
    const { server, ...rest } = args;
    if (server !== undefined && typeof server !== 'string') {
      return toolError('`server` must be a string.');
    }
    const target = resolveTarget(server);
    if (typeof target === 'string') return toolError(target);
    try {
      return await forward(target, name, rest);
    } catch (e) {
      return toolError(
        `The dev server at ${target.url} did not answer: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return createMcpServer(
    { name: 'vite-devtools-svelte', version: opts.version, instructions: RELAY_INSTRUCTIONS },
    { listTools: () => [LIST_DEV_SERVERS, ...tools], callTool },
  );
}
