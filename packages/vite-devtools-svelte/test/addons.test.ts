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
  url: 'https://npmx.dev/package/@natoboram/sv-kysely',
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
  it('reads the nearest lockfile, walking up from a workspace package', async () => {
    write('pnpm-lock.yaml');
    write('apps/web/package.json', '{}');
    expect(await detectPackageManager(path.join(dir, 'apps/web'))).toEqual({
      name: 'pnpm',
      agent: 'pnpm',
    });
  });

  it.each([
    ['yarn.lock', 'yarn'],
    ['bun.lock', 'bun'],
    ['package-lock.json', 'npm'],
  ])('%s -> %s', async (lock, pm) => {
    write(lock);
    expect((await detectPackageManager(dir)).agent).toBe(pm);
  });

  it('takes yarn.lock without packageManager as classic, like sv', async () => {
    write('yarn.lock', '__metadata:\n  version: 8\n');
    expect((await detectPackageManager(dir)).agent).toBe('yarn');
  });

  it.each([
    ['pnpm@10.0.0', 'pnpm'],
    ['yarn@1.22.0', 'yarn'],
    ['yarn@4.1.0', 'yarn@berry'],
  ])('reads packageManager %s', async (packageManager, agent) => {
    write('package.json', JSON.stringify({ packageManager }));
    expect((await detectPackageManager(dir)).agent).toBe(agent);
  });

  it.each([
    ['bun/1.2.0 npm/? node/v22.0.0', 'bun'],
    ['foo/1.0.0 node/v22.0.0', 'npm'],
    [undefined, 'npm'],
  ])('falls back to the user agent %s', async (userAgent, pm) => {
    vi.stubEnv('npm_config_user_agent', userAgent);
    try {
      expect(await detectPackageManager(dir)).toEqual({ name: pm, agent: pm });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('svAddCommand', () => {
  it.each([
    [{ agent: 'pnpm', name: 'pnpm' }, 'pnpm', ['dlx', 'sv', 'add', 'vitest', '--install', 'pnpm']],
    [
      { agent: 'yarn@berry', name: 'yarn' },
      'yarn',
      ['dlx', 'sv', 'add', 'vitest', '--install', 'yarn'],
    ],
    [{ agent: 'yarn', name: 'yarn' }, 'npx', ['sv', 'add', 'vitest', '--install', 'yarn']],
    [{ agent: 'bun', name: 'bun' }, 'bun', ['x', 'sv', 'add', 'vitest', '--install', 'bun']],
    [{ agent: 'npm', name: 'npm' }, 'npx', ['sv', 'add', 'vitest', '--install', 'npm']],
  ] as const)('%o', (pm, command, args) => {
    expect(svAddCommand(pm, 'vitest')).toEqual({ command, args });
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

  it("takes sv's ids, order and descriptions", () => {
    expect(listAddons(dir).slice(0, 2)).toEqual([
      { id: 'prettier', name: 'Prettier', description: 'formatter', installed: false },
      { id: 'eslint', name: 'ESLint', description: 'linter', installed: false },
    ]);
    expect(listAddons(dir).find(a => a.id === 'drizzle')).toMatchObject({ kit: true });
  });

  it('names an add-on sv added after this release by its id', async () => {
    vi.resetModules();
    vi.doMock('../src/server/sv-addons.js', () => ({
      svAddons: [{ id: 'new-addon', description: 'something new' }],
    }));
    try {
      const fresh = await import('../src/server/addons.js');
      expect(fresh.listAddons(dir)).toEqual([
        { id: 'new-addon', name: 'new-addon', description: 'something new', installed: false },
      ]);
    } finally {
      vi.doUnmock('../src/server/sv-addons.js');
      vi.resetModules();
    }
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
    expect(exec).toEqual({ ...svAddCommand({ agent: 'pnpm', name: 'pnpm' }, 'vitest'), cwd: dir });
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
      url: 'https://npmx.dev/package/@acme/sv',
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
