import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createAddonRpcFunctions,
  detectPackageManager,
  listAddons,
  searchCommunityAddons,
  svAddCommand,
} from '../src/server/addons.js';
import type { AddonHub } from '../src/server/addons.js';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-addons-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const write = (file: string, content = '') => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
};

const KYSELY = {
  name: '@natoboram/sv-kysely',
  description: 'sv add-on for kysely',
  version: '0.0.1',
  downloads: 36,
  npmUrl: 'https://www.npmjs.com/package/@natoboram/sv-kysely',
};

function handlers(hub: AddonHub, search = () => Promise.resolve([KYSELY])) {
  const fns = createAddonRpcFunctions(
    () => dir,
    () => hub,
    search,
  );
  const get = (name: string) =>
    (fns.find(f => f.name === name) as unknown as { handler: (...a: any[]) => any }).handler;
  return {
    getAddons: get('get-addons'),
    getCommunity: get('get-community-addons'),
    install: get('install-addon'),
  };
}

describe('detectPackageManager', () => {
  it('reads the nearest lockfile, walking up from a workspace package', () => {
    write('pnpm-lock.yaml');
    write('apps/web/package.json', '{}');
    expect(detectPackageManager(path.join(dir, 'apps/web'))).toBe('pnpm');
  });

  it.each([
    ['yarn.lock', 'yarn'],
    ['bun.lock', 'bun'],
    ['package-lock.json', 'npm'],
  ])('%s -> %s', (lock, pm) => {
    write(lock);
    expect(detectPackageManager(dir)).toBe(pm);
  });

  it('tells yarn berry from classic by the lockfile', () => {
    write('yarn.lock', '__metadata:\n  version: 8\n');
    expect(detectPackageManager(dir)).toBe('yarn@berry');
  });

  it.each([
    ['pnpm@10.0.0', 'pnpm'],
    ['yarn@1.22.0', 'yarn'],
    ['yarn@4.1.0', 'yarn@berry'],
  ])('falls back to packageManager %s', (packageManager, agent) => {
    write('package.json', JSON.stringify({ packageManager }));
    expect(detectPackageManager(dir)).toBe(agent);
  });
});

describe('svAddCommand', () => {
  it.each([
    ['pnpm', 'pnpm', ['dlx', 'sv', 'add', 'vitest', '--install', 'pnpm']],
    ['yarn@berry', 'yarn', ['dlx', 'sv', 'add', 'vitest', '--install', 'yarn']],
    ['yarn', 'npx', ['sv', 'add', 'vitest', '--install', 'yarn']],
    ['bun', 'bunx', ['sv', 'add', 'vitest', '--install', 'bun']],
    ['npm', 'npx', ['sv', 'add', 'vitest', '--install', 'npm']],
  ] as const)('%s', (agent, command, args) => {
    expect(svAddCommand(agent, 'vitest')).toEqual({ command, args });
  });
});

describe('listAddons', () => {
  it('flags add-ons whose deps are in package.json', () => {
    write('package.json', JSON.stringify({ devDependencies: { prettier: '^3', vitest: '^4' } }));
    const installed = listAddons(dir)
      .filter(a => a.installed)
      .map(a => a.id);
    expect(installed).toEqual(['prettier', 'vitest']);
  });

  it('works without a package.json', () => {
    expect(listAddons(dir).some(a => a.installed)).toBe(false);
  });
});

describe('add-on RPCs', () => {
  it('reports unavailable outside the dock', () => {
    expect(handlers({}).getAddons().available).toBe(false);
  });

  it('rejects ids outside the catalog without spawning', async () => {
    const startPtySession = vi.fn();
    const { install } = handlers({ terminals: { startPtySession } });
    await expect(install({ id: 'rm -rf /' })).rejects.toThrow('Unknown sv add-on');
    expect(startPtySession).not.toHaveBeenCalled();
  });

  it('rejects without the hub terminals', async () => {
    await expect(handlers({}).install({ id: 'vitest' })).rejects.toThrow('Vite DevTools dock');
  });

  it('spawns sv add in a PTY at the root', async () => {
    write('pnpm-lock.yaml');
    const startPtySession = vi.fn((_exec: unknown, t: { id: string }) =>
      Promise.resolve({ id: t.id }),
    );
    const { install } = handlers({ terminals: { startPtySession } });
    const { sessionId } = await install({ id: 'vitest' });
    const [exec, terminal] = startPtySession.mock.calls[0]!;
    expect(exec).toEqual({ ...svAddCommand('pnpm', 'vitest'), cwd: dir });
    expect(terminal).toMatchObject({ id: sessionId, title: 'sv add vitest', restartable: false });
  });
});

const npmPackage = (name: string, monthly: number, repository?: string) => ({
  package: { name, version: '1.0.0', description: name, links: { repository } },
  downloads: { monthly },
});

describe('community add-ons', () => {
  it('keeps plain npm names, sorted by downloads, with the GitHub owner avatar', async () => {
    const body = {
      objects: [
        npmPackage('@acme/sv', 122, 'https://github.com/acme/sv-addon/'),
        npmPackage('a & calc', 999),
        npmPackage('-flag', 998),
        npmPackage('vite-plugin-svelte-md', 10070),
      ],
    };
    body.objects[3]!.package.description = '<a id="top"></a>';
    const fetchFn = vi.fn(() => Promise.resolve(Response.json(body)));
    const list = await searchCommunityAddons(fetchFn);
    expect(list.map(a => a.name)).toEqual(['vite-plugin-svelte-md', '@acme/sv']);
    expect(list[1]).toMatchObject({
      avatar: 'https://github.com/acme.png?size=64',
      npmUrl: 'https://www.npmjs.com/package/@acme/sv',
    });
    expect(list[0]!.description).toBe('');
  });

  it('flags the installed ones and reports npm failures', async () => {
    write('package.json', JSON.stringify({ devDependencies: { [KYSELY.name]: '^0.0.1' } }));
    expect((await handlers({}).getCommunity()).addons).toMatchObject([{ installed: true }]);
    const down = handlers({}, () => Promise.reject(new Error('offline')));
    expect(await down.getCommunity()).toEqual({ addons: [], error: 'offline' });
  });

  it('retries after a failed search, and serves the list from cache', async () => {
    const search = vi
      .fn<() => Promise<(typeof KYSELY)[]>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue([KYSELY]);
    const { getCommunity } = handlers({}, search);
    expect((await getCommunity()).error).toBe('offline');
    expect((await getCommunity()).addons).toHaveLength(1);
    await getCommunity();
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('installs a listed package, and nothing that npm did not list', async () => {
    const startPtySession = vi.fn((_exec: unknown, t: { id: string }) =>
      Promise.resolve({ id: t.id }),
    );
    const { install } = handlers({ terminals: { startPtySession } });
    await expect(install({ id: '@evil/pkg' })).rejects.toThrow('Unknown sv add-on');
    await install({ id: KYSELY.name });
    expect(startPtySession).toHaveBeenCalledOnce();
    expect(startPtySession.mock.calls[0]![0]).toMatchObject({
      args: expect.arrayContaining(['add', KYSELY.name]),
    });
  });
});
