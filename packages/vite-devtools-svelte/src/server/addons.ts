import fs from 'node:fs';
import path from 'node:path';

import { defineRpcFunction } from 'devframe';
import type { Agent, AgentName } from 'package-manager-detector';
import { resolveCommand } from 'package-manager-detector/commands';
import { detect, getUserAgent } from 'package-manager-detector/detect';
import { z } from 'zod';

import type { AddonInfo, AddonsResult, CommunityAddon, CommunityAddonsResult } from '../types.js';
import { svAddons } from './sv-addons.js';

// npm's rules for a (scoped) package name, minus a leading `-` that `sv` would read as a flag.
const REGEX_NPM_NAME = /^(?:@[a-z0-9~][a-z0-9-._~]*\/)?[a-z0-9~][a-z0-9-._~]*$/;
const REGEX_GITHUB_OWNER = /github\.com[/:]([^/]+)\//;
// Some packages publish their README's HTML as the description.
const REGEX_HTML_TAG = /<[^<>]*>/g;

interface AddonExtra {
  name: string;
  kit?: boolean;
  /** Any of these in package.json means it is (probably) installed already. */
  deps?: string[];
}

// What sv does not expose; the ids, order and descriptions come from sv (./sv-addons.ts).
const EXTRAS: Record<string, AddonExtra> = {
  prettier: { name: 'Prettier', deps: ['prettier'] },
  eslint: { name: 'ESLint', deps: ['eslint'] },
  vitest: { name: 'Vitest', deps: ['vitest'] },
  playwright: { name: 'Playwright', deps: ['@playwright/test'] },
  tailwindcss: { name: 'Tailwind CSS', deps: ['tailwindcss'] },
  'enhanced-img': { name: 'Enhanced images', kit: true, deps: ['@sveltejs/enhanced-img'] },
  'sveltekit-adapter': { name: 'SvelteKit adapter', kit: true },
  drizzle: { name: 'Drizzle', kit: true, deps: ['drizzle-orm'] },
  'better-auth': { name: 'Better Auth', kit: true, deps: ['better-auth'] },
  mdsvex: { name: 'mdsvex', deps: ['mdsvex'] },
  paraglide: { name: 'Paraglide', kit: true, deps: ['@inlang/paraglide-js'] },
  storybook: { name: 'Storybook', deps: ['storybook'] },
  'ai-tools': { name: 'AI tools' },
  experimental: { name: 'Experimental' },
};

/** The same pick as `sv add`, so the `--install` it is given matches what sv would detect. */
export async function detectPackageManager(
  root: string,
): Promise<{ agent: Agent; name: AgentName }> {
  const detected = await detect({ cwd: root });
  if (detected) return detected;
  const name = getUserAgent() ?? 'npm';
  return { agent: name, name };
}

export function svAddCommand(
  { agent, name }: { agent: Agent; name: AgentName },
  id: string,
): { command: string; args: string[] } {
  const command = resolveCommand(agent, 'execute', ['sv', 'add', id, '--install', name]);
  if (!command) throw new Error(`${agent} cannot run sv`);
  return command;
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
  return svAddons.map(({ id, description }) => {
    const extra = EXTRAS[id];
    return {
      id,
      name: extra?.name ?? id,
      description,
      kit: extra?.kit,
      installed: extra?.deps?.some(d => deps.has(d)) ?? false,
    };
  });
}

function isSvAddon(id: string): boolean {
  return svAddons.some(a => a.id === id);
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
      const owner = p.links?.repository?.match(REGEX_GITHUB_OWNER)?.[1];
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
        const exec = { ...svAddCommand(await detectPackageManager(cwd), id), cwd };
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
