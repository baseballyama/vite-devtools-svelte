import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

import { MCP_PATH } from './http.js';
import { RELAY_INSTRUCTIONS } from './instructions.js';
import { listServers, selectServer, type RegistryEntry } from './registry.js';
import { buildMcpServer, error, text, type McpDeps } from './server.js';

/** Where a tool call goes. */
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
  outdatedLocal?: string;
}

const LIST_DEV_SERVERS: Tool = {
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

const unavailable = () => {
  throw new Error('not connected to a dev server');
};

/** The dev server endpoint's tools, read from a local copy that is never called. */
async function devServerTools(): Promise<Tool[]> {
  const deps = new Proxy({}, { get: () => unavailable }) as McpDeps;
  const server = buildMcpServer(deps);
  const client = new Client({ name: 'vite-devtools-svelte-relay', version: '0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  await client.connect(clientSide);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

const describeEntry = (e: RegistryEntry) => `${e.id}: ${e.packageName} at ${e.root}`;

/** The MCP endpoint URL for a dev server origin or a full endpoint URL. */
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
export async function createRelay(opts: RelayOptions): Promise<McpServer> {
  const tools = await devServerTools();
  for (const tool of tools) {
    tool.inputSchema.properties = { ...tool.inputSchema.properties, server: SERVER_ARG };
  }

  // The low-level handlers: the tools are JSON Schemas taken from the dev
  // server endpoint, which `registerTool` (zod only) cannot take.
  const mcp = new McpServer(
    { name: 'vite-devtools-svelte', version: opts.version },
    { capabilities: { tools: {} }, instructions: RELAY_INSTRUCTIONS },
  );
  const { server } = mcp;

  // One client per endpoint: the endpoint is stateless, so a cached client
  // only saves the initialize round trip.
  const clients = new Map<string, Promise<Client>>();
  function connect(target: Target): { key: string; client: Promise<Client> } {
    const key = `${target.url}\n${target.token}`;
    let client = clients.get(key);
    if (!client) {
      const c = new Client({ name: 'vite-devtools-svelte-relay', version: opts.version });
      const transport = new StreamableHTTPClientTransport(new URL(target.url), {
        requestInit: { headers: { 'x-svelte-devtools-token': target.token } },
      });
      client = c.connect(transport).then(() => c);
      clients.set(key, client);
    }
    return { key, client };
  }

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
    if (name === undefined && opts.outdatedLocal) {
      lines.push(
        `The project has @sveltejs/vite-devtools-svelte ${opts.outdatedLocal}, which does not announce its dev server: ask the user to upgrade it.`,
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

  // oxlint-disable-next-line unicorn/prefer-add-event-listener -- `onclose` is the SDK's only close hook
  server.onclose = () => {
    for (const client of clients.values())
      void client.then(
        c => c.close(),
        () => {},
      );
    clients.clear();
  };

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [LIST_DEV_SERVERS, ...tools] }));

  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    if (params.name === LIST_DEV_SERVERS.name) {
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
    if (!tools.some(t => t.name === params.name)) return error(`Unknown tool: ${params.name}`);
    const { server: name, ...args } = params.arguments ?? {};
    if (name !== undefined && typeof name !== 'string') return error('`server` must be a string.');
    const target = resolveTarget(name);
    if (typeof target === 'string') return error(target);
    const { key, client } = connect(target);
    try {
      return await (await client).callTool({ name: params.name, arguments: args });
    } catch (e) {
      clients.delete(key);
      return error(
        `The dev server at ${target.url} did not answer: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  });

  return mcp;
}
