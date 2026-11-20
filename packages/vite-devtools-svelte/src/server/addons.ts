import fs from 'node:fs';
import path from 'node:path';

import { defineRpcFunction } from 'devframe';
import { z } from 'zod';

import type {
  AddonInfo,
  AddonsResult,
  CommunityAddon,
  CommunityAddonsResult,
  PackageManager,
} from '../types.js';

// npm's rules for a (scoped) package name, minus a leading `-` that `sv` would read as a flag.
const REGEX_NPM_NAME = /^(?:@[a-z0-9~][a-z0-9-._~]*\/)?[a-z0-9~][a-z0-9-._~]*$/;
// Some packages publish their README's HTML as the description.
const REGEX_HTML_TAG = /<[^<>]*>/g;
// Corepack's `name@x.y.z[+hash]`; any other value falls through to the parent directory.
// A regex because the major must start right after `@`; parseInt also accepts ` 9` and `+9`.
const REGEX_PACKAGE_MANAGER = /^(pnpm|yarn|bun|npm)@(\d+)/;

interface AddonDef {
  id: string;
  name: string;
  description: string;
  kit?: boolean;
  /** Any of these in package.json means it is (probably) installed already. */
  deps?: string[];
}

// sv's own order (perceived popularity).
const SV_ADDONS: readonly AddonDef[] = [
  { id: 'prettier', name: 'Prettier', description: 'Formatter', deps: ['prettier'] },
  { id: 'eslint', name: 'ESLint', description: 'Linter', deps: ['eslint'] },
  { id: 'vitest', name: 'Vitest', description: 'Unit testing', deps: ['vitest'] },
  {
    id: 'playwright',
    name: 'Playwright',
    description: 'Browser testing',
    deps: ['@playwright/test'],
  },
  {
    id: 'tailwindcss',
    name: 'Tailwind CSS',
    description: 'CSS framework',
    deps: ['tailwindcss'],
  },
  {
    id: 'enhanced-img',
    name: 'Enhanced images',
    description: 'Image optimization',
    kit: true,
    deps: ['@sveltejs/enhanced-img'],
  },
  {
    id: 'sveltekit-adapter',
    name: 'SvelteKit adapter',
    description: 'Deployment',
    kit: true,
  },
  { id: 'drizzle', name: 'Drizzle', description: 'Database ORM', kit: true, deps: ['drizzle-orm'] },
  {
    id: 'better-auth',
    name: 'Better Auth',
    description: 'Auth library',
    kit: true,
    deps: ['better-auth'],
  },
  { id: 'mdsvex', name: 'mdsvex', description: 'Svelte + Markdown', deps: ['mdsvex'] },
  {
    id: 'paraglide',
    name: 'Paraglide',
    description: 'i18n',
    kit: true,
    deps: ['@inlang/paraglide-js'],
  },
  { id: 'storybook', name: 'Storybook', description: 'Frontend workshop', deps: ['storybook'] },
  { id: 'ai-tools', name: 'AI tools', description: 'Svelte AI tools' },
  {
    id: 'experimental',
    name: 'Experimental',
    description: 'Svelte & Kit experimental features',
  },
];

// Yarn 2+ only; classic has no `dlx`.
type Agent = PackageManager | 'yarn@berry';

const LOCKFILES: [string, PackageManager][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
];

function agentAt(dir: string): Agent | undefined {
  for (const [file, pm] of LOCKFILES) {
    const lockfile = path.join(dir, file);
    if (!fs.existsSync(lockfile)) continue;
    if (pm !== 'yarn') return pm;
    const lock = fs.readFileSync(lockfile, 'utf-8');
    return lock.startsWith('__metadata:') || lock.includes('\n__metadata:') ? 'yarn@berry' : 'yarn';
  }
  try {
    const { packageManager } = JSON.parse(
      fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'),
    ) as { packageManager?: string };
    const [, pm, major] = REGEX_PACKAGE_MANAGER.exec(packageManager ?? '') ?? [];
    if (pm === 'yarn') return Number(major) >= 2 ? 'yarn@berry' : 'yarn';
    return pm as PackageManager | undefined;
  } catch {
    return undefined;
  }
}

/** Nearest lockfile or `packageManager` field wins, so a workspace package resolves to its monorepo's pm. */
export function detectPackageManager(root: string): Agent {
  let dir = path.resolve(root);
  for (;;) {
    const agent = agentAt(dir);
    if (agent) return agent;
    const parent = path.dirname(dir);
    if (parent === dir) return 'npm';
    dir = parent;
  }
}

const RUNNERS: Record<Agent, [string, ...string[]]> = {
  pnpm: ['pnpm', 'dlx'],
  'yarn@berry': ['yarn', 'dlx'],
  yarn: ['npx'],
  bun: ['bunx'],
  npm: ['npx'],
};

// The hub's PTY resolves Windows `.cmd` shims itself.
export function svAddCommand(agent: Agent, id: string): { command: string; args: string[] } {
  const [command, ...rest] = RUNNERS[agent];
  const pm = agent === 'yarn@berry' ? 'yarn' : agent;
  return { command, args: [...rest, 'sv', 'add', id, '--install', pm] };
}

function readDeps(root: string): Set<string> {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]);
  } catch {
    return new Set();
  }
}

export function listAddons(root: string): AddonInfo[] {
  const deps = readDeps(root);
  return SV_ADDONS.map(({ deps: addonDeps, ...addon }) => ({
    ...addon,
    installed: addonDeps?.some(d => deps.has(d)) ?? false,
  }));
}

function isSvAddon(id: string): boolean {
  return SV_ADDONS.some(a => a.id === id);
}

// sv's docs point to this keyword for community add-ons.
const COMMUNITY_SEARCH_URL = 'https://registry.npmjs.org/-/v1/search?text=keywords:sv-add&size=250';
const COMMUNITY_TTL = 10 * 60_000;

type CommunityPackage = Omit<CommunityAddon, 'installed'>;

interface NpmSearchObject {
  package: {
    name: string;
    version: string;
    description?: string;
    links?: { repository?: string };
  };
  downloads?: { monthly?: number };
}

function githubOwner(repository: string | undefined): string | undefined {
  if (!repository || !URL.canParse(repository)) return undefined;
  const { hostname, pathname } = new URL(repository);
  const [, owner] = pathname.split('/');
  return (hostname === 'github.com' || hostname === 'www.github.com') && owner ? owner : undefined;
}

/** Sorted by downloads; drops names that are not plain npm names (they reach a command line). */
export async function searchCommunityAddons(
  fetchFn: typeof fetch = fetch,
): Promise<CommunityPackage[]> {
  const res = await fetchFn(COMMUNITY_SEARCH_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`npm search answered ${res.status}`);
  const body = (await res.json()) as { objects?: NpmSearchObject[] };
  return (body.objects ?? [])
    .filter(o => REGEX_NPM_NAME.test(o.package.name))
    .map(({ package: p, downloads }) => {
      const owner = githubOwner(p.links?.repository);
      return {
        name: p.name,
        description: (p.description ?? '').replaceAll(REGEX_HTML_TAG, '').trim(),
        version: p.version,
        downloads: downloads?.monthly ?? 0,
        url: `https://npmx.dev/package/${p.name}`,
        avatar: owner ? `https://github.com/${owner}.png?size=64` : undefined,
      };
    })
    .toSorted((a, b) => b.downloads - a.downloads);
}

/** The hub surfaces of `ctx` this needs; absent when mounted standalone. */
export interface AddonHub {
  terminals?: {
    startPtySession: (
      exec: { command: string; args: string[]; cwd: string },
      terminal: { id: string; title: string; description?: string; restartable?: boolean },
    ) => Promise<{ id: string }>;
  };
}

export function createAddonRpcFunctions(
  root: () => string,
  hub: () => AddonHub,
  searchCommunity: () => Promise<CommunityPackage[]> = searchCommunityAddons,
) {
  let community: { at: number; list: Promise<CommunityPackage[]> } | undefined;
  const communityList = () => {
    if (!community || Date.now() - community.at > COMMUNITY_TTL) {
      const list = searchCommunity();
      community = { at: Date.now(), list };
      list.catch(() => {
        if (community?.list === list) community = undefined;
      });
    }
    return community.list;
  };
  const isCommunityAddon = async (name: string) =>
    (await communityList()).some(a => a.name === name);

  return [
    defineRpcFunction({
      name: 'get-community-addons',
      type: 'query',
      jsonSerializable: true,
      handler: async (): Promise<CommunityAddonsResult> => {
        try {
          const deps = readDeps(root());
          const list = await communityList();
          return { addons: list.map(a => Object.assign({ installed: deps.has(a.name) }, a)) };
        } catch (e) {
          return { addons: [], error: e instanceof Error ? e.message : String(e) };
        }
      },
    }),
    defineRpcFunction({
      name: 'get-addons',
      type: 'query',
      jsonSerializable: true,
      handler: (): AddonsResult => ({
        available: hub().terminals !== undefined,
        addons: listAddons(root()),
      }),
    }),
    defineRpcFunction({
      name: 'install-addon',
      type: 'action',
      jsonSerializable: true,
      args: [z.object({ id: z.string().max(214) })],
      returns: z.object({ sessionId: z.string() }),
      handler: async ({ id }) => {
        if (!isSvAddon(id) && !(await isCommunityAddon(id))) {
          throw new Error(`Unknown sv add-on: ${id}`);
        }
        const { terminals } = hub();
        if (!terminals) throw new Error('Installing add-ons needs the Vite DevTools dock');
        const cwd = root();
        const exec = { ...svAddCommand(detectPackageManager(cwd), id), cwd };
        const session = await terminals.startPtySession(exec, {
          id: `svelte-devtools:sv-add:${id}:${Date.now()}`,
          title: `sv add ${id}`,
          restartable: false,
        });
        return { sessionId: session.id };
      },
    }),
  ] as const;
}
