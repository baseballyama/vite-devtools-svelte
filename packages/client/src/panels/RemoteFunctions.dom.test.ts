import { render, screen, within } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as rpc from '../lib/rpc.js';
import type { RemoteFunctionsResult } from '../lib/types.js';
import { fakePollClock, layout, nextPoll, settle } from '../test/dom.js';
import RemoteFunctions from './RemoteFunctions.svelte';

const result: RemoteFunctionsResult = {
  enabled: true,
  functions: [
    {
      name: 'getTodos',
      type: 'query',
      file: 'src/lib/todos.remote.ts',
      line: 6,
      loaded: true,
      id: 'abc/getTodos',
    },
    {
      name: 'getUser',
      type: 'query_batch',
      file: 'src/lib/todos.remote.ts',
      line: 19,
      loaded: false,
    },
    { name: 'addTodo', type: 'form', file: 'src/lib/todos.remote.ts', line: 30, loaded: false },
    {
      name: 'logout',
      type: 'command',
      file: 'node_modules/auth-kit/dist/auth.remote.js',
      line: 2,
      loaded: true,
      id: 'def/logout',
      package: 'auth-kit',
    },
    { name: 'getBuild', type: 'prerender', file: 'src/lib/build.remote.ts', loaded: false },
    { name: 'odd', type: 'future_kind', file: 'src/lib/x.remote.ts', line: 1, loaded: false },
  ],
  errors: [],
};

function names(): string[] {
  const list = screen.getByRole('listbox', { name: 'Remote functions' });
  return within(list)
    .queryAllByRole('option')
    .map(o => o.querySelector('.name')!.textContent);
}

function row(name: string): HTMLElement {
  const list = screen.getByRole('listbox', { name: 'Remote functions' });
  return within(list)
    .getAllByRole('option')
    .find(o => o.querySelector('.name')!.textContent === name)!;
}

const lastOpened = () => vi.mocked(rpc.openInEditor).mock.lastCall;

let width = 1000;
beforeEach(() => {
  width = 1000;
  layout(() => ({ width, height: 600 }));
});

describe('RemoteFunctions', () => {
  it('explains how to turn remote functions on when they are off', async () => {
    vi.mocked(rpc.getRemoteFunctions).mockResolvedValue({
      enabled: false,
      functions: [],
      errors: [],
    });
    render(RemoteFunctions);
    await settle();
    expect(screen.getByRole('status').textContent).toContain('Remote functions are off');
    expect(screen.getByText('experimental.remoteFunctions')).toBeTruthy();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows the empty state without remote functions', async () => {
    render(RemoteFunctions);
    await settle();
    expect(screen.getByRole('status').textContent).toContain('No remote functions');
  });

  it('shows a failed request as an error', async () => {
    vi.mocked(rpc.getRemoteFunctions).mockRejectedValue(new Error('RPC down'));
    render(RemoteFunctions);
    await settle();
    expect(screen.getByRole('alert').textContent).toContain('RPC down');
  });

  it('lists functions with their kind, source and endpoint', async () => {
    vi.mocked(rpc.getRemoteFunctions).mockResolvedValue(result);
    render(RemoteFunctions);
    await settle();
    expect(screen.getAllByRole('columnheader').map(h => h.textContent.trim())).toEqual([
      'Function',
      'Kind',
      'Source',
      'Endpoint',
    ]);
    // By source file, then line.
    expect(names()).toEqual(['logout', 'getBuild', 'getTodos', 'getUser', 'addTodo', 'odd']);
    expect(row('getUser').textContent).toContain('query.batch');
    expect(row('getUser').textContent).toContain('Not loaded yet');
    expect(row('getTodos').textContent).toContain('todos.remote.ts:6');
    expect(row('getTodos').textContent).toContain('abc/getTodos');
    expect(row('logout').textContent).toContain('auth-kit');
    expect(row('odd').textContent).toContain('future_kind');
  });

  it('filters by kind and by text', async () => {
    const user = userEvent.setup();
    vi.mocked(rpc.getRemoteFunctions).mockResolvedValue(result);
    render(RemoteFunctions);
    await settle();
    const kinds = screen.getByRole('radiogroup', { name: 'Kind' });
    // Kinds without functions are not offered; unknown ones count as Other.
    expect(
      within(kinds)
        .getAllByRole('radio')
        .map(r => [r.firstChild!.textContent!.trim(), r.querySelector('.n')!.textContent]),
    ).toEqual([
      ['All', '6'],
      ['Queries', '2'],
      ['Commands', '1'],
      ['Forms', '1'],
      ['Prerender', '1'],
      ['Other', '1'],
    ]);
    await user.click(within(kinds).getByRole('radio', { name: /Queries/ }));
    expect(names()).toEqual(['getTodos', 'getUser']);
    await user.click(within(kinds).getByRole('radio', { name: /Commands/ }));
    expect(names()).toEqual(['logout']);
    await user.click(within(kinds).getByRole('radio', { name: /All/ }));
    await user.type(screen.getByRole('searchbox'), 'auth-kit');
    expect(names()).toEqual(['logout']);
    // the endpoint id, as copied from a request URL
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'abc/getTodos');
    expect(names()).toEqual(['getTodos']);
  });

  it('does not offer to open files outside the project root', async () => {
    const user = userEvent.setup();
    vi.mocked(rpc.getRemoteFunctions).mockResolvedValue({
      enabled: true,
      functions: [
        {
          name: 'linked',
          type: 'query',
          file: '../packages/lib/a.remote.ts',
          line: 1,
          loaded: false,
        },
      ],
      errors: [{ file: '../packages/lib/bad.remote.ts', message: 'could not be parsed' }],
    });
    render(RemoteFunctions);
    await settle();
    const chip = screen.getByTitle(
      'Outside the project root, so it cannot be opened: ../packages/lib/a.remote.ts',
    );
    expect(chip.hasAttribute('disabled')).toBe(true);
    await user.click(row('linked'));
    await user.keyboard('{Enter}');
    expect(
      screen
        .getByRole('button', { name: '../packages/lib/bad.remote.ts' })
        .hasAttribute('disabled'),
    ).toBe(true);
    expect(rpc.openInEditor).not.toHaveBeenCalled();
  });

  it('opens the declaration in the editor from the file chip or Enter', async () => {
    const user = userEvent.setup();
    vi.mocked(rpc.getRemoteFunctions).mockResolvedValue(result);
    render(RemoteFunctions);
    await settle();
    await user.click(screen.getByTitle('Open in editor: src/lib/todos.remote.ts:6'));
    expect(lastOpened()).toEqual(['src/lib/todos.remote.ts', 6]);
    await user.click(row('getBuild'));
    await user.keyboard('{Enter}');
    expect(lastOpened()?.[0]).toBe('src/lib/build.remote.ts');
    expect(lastOpened()?.[1]).toBeUndefined();
  });

  it('lists files that could not be parsed', async () => {
    const user = userEvent.setup();
    vi.mocked(rpc.getRemoteFunctions).mockResolvedValue({
      ...result,
      errors: [{ file: 'src/lib/broken.remote.ts', message: 'could not be parsed' }],
    });
    render(RemoteFunctions);
    await settle();
    await user.click(screen.getByRole('button', { name: 'src/lib/broken.remote.ts' }));
    expect(lastOpened()?.[0]).toBe('src/lib/broken.remote.ts');
  });

  it('sorts by function, kind and endpoint', async () => {
    const user = userEvent.setup();
    vi.mocked(rpc.getRemoteFunctions).mockResolvedValue(result);
    render(RemoteFunctions);
    await settle();
    const sortBy = (name: string) =>
      user.click(within(screen.getByRole('columnheader', { name })).getByRole('button'));
    await sortBy('Function');
    expect(names()).toEqual(['addTodo', 'getBuild', 'getTodos', 'getUser', 'logout', 'odd']);
    await sortBy('Kind');
    expect(names()).toEqual(['logout', 'addTodo', 'odd', 'getBuild', 'getTodos', 'getUser']);
    // loaded ones first
    await sortBy('Endpoint');
    expect(names().slice(0, 2).toSorted()).toEqual(['getTodos', 'logout']);
  });

  it('ignores a failed open-in-editor', async () => {
    const user = userEvent.setup();
    vi.mocked(rpc.getRemoteFunctions).mockResolvedValue(result);
    vi.mocked(rpc.openInEditor).mockRejectedValue(new Error('no editor'));
    render(RemoteFunctions);
    await settle();
    await user.click(screen.getByTitle('Open in editor: src/lib/todos.remote.ts:6'));
    await settle();
    expect(rpc.openInEditor).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('hides the endpoint column in a narrow layout', async () => {
    width = 500;
    vi.mocked(rpc.getRemoteFunctions).mockResolvedValue(result);
    render(RemoteFunctions);
    await settle();
    expect(screen.queryByRole('columnheader', { name: 'Endpoint' })).toBeNull();
    expect(screen.queryByText('Not loaded yet')).toBeNull();
  });

  it('picks up the id once the app loads a module', async () => {
    fakePollClock();
    vi.mocked(rpc.getRemoteFunctions).mockResolvedValue(result);
    render(RemoteFunctions);
    await settle();
    vi.mocked(rpc.getRemoteFunctions).mockResolvedValue({
      ...result,
      functions: [
        result.functions[0]!,
        { ...result.functions[1]!, loaded: true, id: 'abc/getUser' },
        ...result.functions.slice(2),
      ],
    });
    await nextPoll(3000);
    expect(screen.getByText('abc/getUser')).toBeTruthy();
  });
});
