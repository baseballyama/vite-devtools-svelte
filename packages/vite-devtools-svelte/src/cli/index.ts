import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import pkg from '../../package.json' with { type: 'json' };
import { registryDir } from '../mcp/registry.js';
import { createRelay } from '../mcp/relay.js';

const USAGE = `Usage: vite-devtools-svelte mcp

  mcp   Start the MCP server over stdio. It answers from the dev server of the
        project in the current directory (or VITE_DEVTOOLS_SVELTE_URL with
        VITE_DEVTOOLS_SVELTE_TOKEN).`;

/**
 * Entry of the `vite-devtools-svelte` bin. Returns the exit code, or `null`
 * while serving. `outdatedLocal`: version of a project install without a CLI.
 */
export async function run(
  argv: string[],
  { outdatedLocal }: { outdatedLocal?: string } = {},
): Promise<number | null> {
  const [command] = argv;
  if (command === 'mcp') {
    const server = await createRelay({
      cwd: process.cwd(),
      env: process.env,
      registry: registryDir(),
      version: pkg.version,
      outdatedLocal,
    });
    await server.connect(new StdioServerTransport());
    return null;
  }
  const help = command === undefined || command === '--help' || command === '-h';
  (help ? process.stdout : process.stderr).write(`${USAGE}\n`);
  return help ? 0 : 1;
}
