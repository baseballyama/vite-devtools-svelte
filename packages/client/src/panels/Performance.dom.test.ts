import { render, screen, within } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { elementPick } from '../lib/element-pick.svelte.js';
import { reactiveScope } from '../lib/reactive-selection.svelte.js';
import { router } from '../lib/router.svelte.js';
import * as rpc from '../lib/rpc.js';
import type { PerfUpdate, PerformanceRecording } from '../lib/types.js';
import { layout, settle } from '../test/dom.js';
import { idleRecording } from '../test/fake-rpc.js';
import Performance from './Performance.svelte';

const trigger = (name: string, scope = '+page', during = false) => ({
  nodeId: `3:${name}`,
  name,
  scopeId: 3,
  scope,
  file: 'src/routes/+page.svelte',
  loc: { file: 'src/routes/+page.svelte', line: 88, column: 6 },
  during,
});

function update(id: number, start: number, duration: number, extra: Partial<PerfUpdate> = {}) {
  return {
    id,
    start,
    duration,
    event: null,
    triggers: [trigger('messages')],
    triggersOmitted: 0,
    components: 1,
    renders: 1,
    effects: 0,
    deriveds: 0,
    wastedDeriveds: 0,
    unchangedDeriveds: [],
    costs: [],
    costsOmitted: 0,
    droppedFrames: null,
    ...extra,
  } satisfies PerfUpdate;
}

const slow = update(2, 4210, 84.2, {
  event: { type: 'click', target: 'button.send' },
  triggers: [trigger('messages'), trigger('unread', '+page', true)],
  components: 212,
  effects: 18,
  deriveds: 640,
  wastedDeriveds: 412,
  unchangedDeriveds: [
    {
      name: 'isRead',
      scope: 'MessageRow',
      file: 'src/MessageRow.svelte',
      runs: 400,
      unchanged: 398,
    },
  ],
  costs: [
    {
      file: 'src/MessageRow.svelte',
      name: 'MessageRow',
      kind: 'component',
      componentId: 40,
      instances: 200,
      rendered: 200,
      renderMs: 50,
      effectMs: 0,
      derivedMs: 11,
      renders: 200,
      effects: 0,
      deriveds: 400,
    },
    {
      file: 'node_modules/ui/Icon.svelte',
      name: 'Icon',
      kind: 'library',
      componentId: null,
      instances: 1,
      rendered: 1,
      renderMs: 1,
      effectMs: 0,
      derivedMs: 0,
      renders: 1,
      effects: 0,
      deriveds: 0,
    },
  ],
  droppedFrames: 5,
});

const stopped: PerformanceRecording = {
  state: 'idle',
  recordingId: 'p1',
  startedAt: 1_000,
  stoppedAt: 13_000,
  epoch: 'e1',
  updates: [update(1, 2020, 24.9), slow, update(3, 5100, 1.2, { triggers: [] })],
  droppedUpdates: 0,
  components: [
    {
      file: 'src/MessageRow.svelte',
      name: 'MessageRow',
      kind: 'component',
      componentId: 40,
      instances: 200,
      updates: 3,
      renders: 600,
      effects: 0,
      deriveds: 1200,
      renderMs: 150,
      effectMs: 0,
      derivedMs: 33,
    },
    {
      file: 'src/lib/store.svelte.js',
      name: 'store.svelte.js',
      kind: 'module',
      componentId: null,
      instances: 1,
      updates: 1,
      renders: 0,
      effects: 0,
      deriveds: 2,
      renderMs: 0,
      effectMs: 0,
      derivedMs: 0.5,
    },
  ],
  componentsOmitted: false,
};

const rows = (name: string) =>
  within(screen.getByRole('listbox', { name })).queryAllByRole('option');

beforeEach(() => {
  layout(() => ({ width: 1200, height: 700 }));
  reactiveScope.set(null);
});

describe('Performance', () => {
  it('explains what to do before the first recording; Record starts one', async () => {
    const user = userEvent.setup();
    render(Performance);
    await settle();
    expect(screen.getByRole('status').textContent).toContain('Find what makes your app slow');
    vi.mocked(rpc.getPerformanceRecording).mockResolvedValue({
      ...idleRecording,
      state: 'recording',
      recordingId: 'p1',
      startedAt: Date.now() - 12_400,
    });
    await user.click(screen.getByRole('button', { name: 'Record' }));
    await settle();
    expect(rpc.startPerformanceRecording).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Stop · 00:12' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Recording…');
    expect(document.querySelector('.summary')!.textContent).toBe('0 updates · 0 over 50 ms');
  });

  it('Stop shows the recording it returns; an RPC failure is shown', async () => {
    const user = userEvent.setup();
    vi.mocked(rpc.getPerformanceRecording).mockResolvedValue({
      ...idleRecording,
      state: 'recording',
      recordingId: 'p1',
      startedAt: Date.now(),
    });
    vi.mocked(rpc.stopPerformanceRecording).mockResolvedValue(stopped);
    render(Performance);
    await settle();
    await user.click(screen.getByRole('button', { name: /^Stop/ }));
    await settle();
    expect(rows('Recorded updates')).toHaveLength(3);
    vi.mocked(rpc.startPerformanceRecording).mockRejectedValue(new Error('no app page'));
    await user.click(screen.getByRole('button', { name: 'Record' }));
    await settle();
    expect(screen.getByRole('alert').textContent).toBe('no app page');
  });

  it('lists updates slowest first, with triggers, event and a timeline', async () => {
    vi.mocked(rpc.getPerformanceRecording).mockResolvedValue(stopped);
    render(Performance);
    await settle();
    expect(document.querySelector('.summary')!.textContent).toBe('3 updates · 1 over 50 ms');
    const [first, second, third] = rows('Recorded updates');
    expect(first!.textContent).toContain('+4.21 s');
    // only the states written before the update are its trigger
    expect([...first!.querySelectorAll('.chip')].map(c => c.textContent)).toEqual([
      '+page · messages',
    ]);
    expect(first!.textContent).toContain('click');
    expect(first!.textContent).toContain('18 / 640');
    expect(first!.textContent).toContain('84.2 ms');
    expect(second!.textContent).toContain('24.9 ms');
    expect(third!.textContent).toContain('1.20 ms');
    const bars = within(screen.getByRole('group', { name: 'Updates over time' })).getAllByRole(
      'button',
    );
    expect(bars.map(b => b.getAttribute('aria-label'))).toEqual([
      'Update at +2.02 s, 24.9 ms',
      'Update at +4.21 s, 84.2 ms',
      'Update at +5.10 s, 1.20 ms',
    ]);
    expect(bars.map(b => [...b.classList].find(c => ['ok', 'slow', 'bad'].includes(c)))).toEqual([
      'slow',
      'bad',
      'ok',
    ]);
  });

  it('sorts by time on request', async () => {
    const user = userEvent.setup();
    vi.mocked(rpc.getPerformanceRecording).mockResolvedValue(stopped);
    render(Performance);
    await settle();
    await user.click(screen.getByRole('button', { name: /^Time/ }));
    expect(rows('Recorded updates').map(r => r.textContent.slice(0, 7))).toEqual([
      '+2.02 s',
      '+4.21 s',
      '+5.10 s',
    ]);
  });

  it('a selected update shows why it ran, where the time went and hints', async () => {
    const user = userEvent.setup();
    vi.mocked(rpc.getPerformanceRecording).mockResolvedValue(stopped);
    render(Performance);
    await settle();
    await user.click(screen.getByRole('button', { name: 'Update at +4.21 s, 84.2 ms' }));
    const pane = screen.getByRole('complementary', { name: 'Update at +4.21 s details' });
    expect(pane.textContent).toContain('click on button.send · 5 dropped frames');
    expect([...pane.querySelectorAll('dd')].map(d => d.textContent)).toEqual([
      '84.2 ms',
      '212',
      '412',
    ]);
    expect(pane.textContent).toContain('written by an $effect while this update ran');
    expect(pane.textContent).toContain('declared at +page.svelte:88');
    const costs = within(within(pane).getByRole('list', { name: 'Self time per component' }))
      .getAllByRole('listitem')
      .map(li => li.textContent.replaceAll(/\s+/g, ' ').trim());
    expect(costs).toEqual(['MessageRow ×200 61.0 ms', 'Icon 1.00 ms']);
    expect(pane.textContent).toContain(
      'isRead ($derived in MessageRow) recomputed 400× and returned the same value 398×.',
    );
    expect(pane.textContent).toContain('200 instances of <MessageRow> re-rendered.');

    await user.click(within(pane).getAllByRole('button', { name: 'Open in editor' })[0]!);
    expect(rpc.openInEditor).toHaveBeenCalledWith('src/routes/+page.svelte', 88);

    // a library component has no instance to show
    expect(within(pane).getByRole('button', { name: 'Icon' }).hasAttribute('disabled')).toBe(true);
    await user.click(within(pane).getByRole('button', { name: /MessageRow/ }));
    expect(router.current).toBe('components');
    expect(elementPick.pending).toEqual({ epoch: 'e1', componentId: 40 });
    elementPick.done(elementPick.pending!);
  });

  it('"Show in Reactivity graph" scopes Reactivity to the state and focuses it', async () => {
    const user = userEvent.setup();
    vi.mocked(rpc.getPerformanceRecording).mockResolvedValue(stopped);
    render(Performance);
    await settle();
    await user.click(screen.getByRole('button', { name: 'Update at +4.21 s, 84.2 ms' }));
    await user.click(screen.getAllByRole('button', { name: 'Show in Reactivity graph' })[0]!);
    expect(router.current).toBe('reactive');
    expect(reactiveScope.current).toMatchObject({
      componentId: 3,
      epoch: 'e1',
      label: '<+page>',
      focus: '3:messages',
    });
  });

  it('an update without a tracked write says so; Esc closes the details', async () => {
    const user = userEvent.setup();
    vi.mocked(rpc.getPerformanceRecording).mockResolvedValue(stopped);
    render(Performance);
    await settle();
    await user.click(screen.getByRole('button', { name: 'Update at +5.10 s, 1.20 ms' }));
    const pane = screen.getByRole('complementary', { name: 'Update at +5.10 s details' });
    expect(pane.textContent).toContain('No tracked $state was written for this update');
    expect(pane.textContent).toContain('No effect or derived ran.');
    await user.click(within(pane).getByRole('button', { name: 'Close details (Esc)' }));
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('Components: totals per component file over the recording', async () => {
    const user = userEvent.setup();
    vi.mocked(rpc.getPerformanceRecording).mockResolvedValue(stopped);
    render(Performance);
    await settle();
    await user.click(screen.getByRole('radio', { name: 'Components' }));
    const list = rows('Components in the recording');
    expect(list.map(r => r.querySelector('.cname')!.textContent)).toEqual([
      'MessageRow',
      'store.svelte.js',
    ]);
    expect(list[0]!.textContent).toContain('600 / 0 / 1200');
    expect(list[0]!.textContent).toContain('61.0 ms'); // avg per update
    expect(list[0]!.textContent).toContain('183 ms');
    expect(list[1]!.textContent).toContain('module');
    await user.dblClick(list[0]!);
    expect(rpc.openInEditor).toHaveBeenCalledWith('src/MessageRow.svelte');
  });

  it('notes updates over the cap and components left out', async () => {
    const user = userEvent.setup();
    vi.mocked(rpc.getPerformanceRecording).mockResolvedValue({
      ...stopped,
      droppedUpdates: 12,
      componentsOmitted: true,
    });
    render(Performance);
    await settle();
    expect(document.querySelector('.summary')!.textContent).toContain('12 not kept (limit)');
    await user.click(screen.getByRole('radio', { name: 'Components' }));
    expect(screen.getByText(/Only the 2 heaviest component files are listed/)).toBeTruthy();
  });

  it('every column sorts; long trigger lists and omitted rows are disclosed', async () => {
    const user = userEvent.setup();
    vi.mocked(rpc.openInEditor).mockRejectedValue(new Error('no editor'));
    const many = update(9, 9000, 3, {
      triggers: [trigger('a'), trigger('b'), { ...trigger('c'), loc: null }],
      triggersOmitted: 4,
      costs: slow.costs,
      costsOmitted: 7,
    });
    vi.mocked(rpc.getPerformanceRecording).mockResolvedValue({
      ...stopped,
      updates: [...stopped.updates, many],
    });
    render(Performance);
    await settle();
    for (const name of [/^Components/, /^Effects \/ Derived/, /^Duration/]) {
      await user.click(screen.getByRole('button', { name }));
    }
    expect(rows('Recorded updates')[0]!.textContent).toContain('+4.21 s');
    await user.click(screen.getByRole('button', { name: 'Update at +9.00 s, 3.00 ms' }));
    const pane = screen.getByRole('complementary', { name: 'Update at +9.00 s details' });
    expect(pane.textContent).toContain('and 4 more');
    expect(pane.textContent).toContain('and 7 more');
    await user.click(within(pane).getAllByRole('button', { name: 'Open in editor' })[2]!);
    // no declaration location: the file, without a line
    expect(vi.mocked(rpc.openInEditor).mock.lastCall).toEqual([
      'src/routes/+page.svelte',
      undefined,
    ]);

    await user.click(screen.getByRole('radio', { name: 'Components' }));
    for (const name of [/^Component/, /^Inst/, /^Updates/, /^Render \/ Effect/, /^Avg/, /^Self/]) {
      await user.click(screen.getByRole('button', { name }));
    }
    expect(rows('Components in the recording')).toHaveLength(2);
    // a module has a file, code outside components has none
    await user.dblClick(rows('Components in the recording')[0]!);
    expect(rpc.openInEditor).toHaveBeenCalled();
  });

  it('the Stop button counts the recording time', async () => {
    vi.useFakeTimers({ now: 100_000, toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.mocked(rpc.getPerformanceRecording).mockResolvedValue({
      ...idleRecording,
      state: 'recording',
      recordingId: 'p1',
      startedAt: 100_000,
    });
    render(Performance);
    await settle();
    expect(screen.getByRole('button', { name: 'Stop · 00:00' })).toBeTruthy();
    vi.advanceTimersByTime(3000);
    await settle();
    expect(screen.getByRole('button', { name: 'Stop · 00:03' })).toBeTruthy();
    vi.useRealTimers();
  });

  it('Components view of an empty recording explains what to do', async () => {
    const user = userEvent.setup();
    render(Performance);
    await settle();
    await user.click(screen.getByRole('radio', { name: 'Components' }));
    expect(screen.getByRole('status').textContent).toContain('Find what makes your app slow');
  });

  it('after a recording without updates', async () => {
    vi.mocked(rpc.getPerformanceRecording).mockResolvedValue({ ...stopped, updates: [] });
    render(Performance);
    await settle();
    expect(screen.getByRole('status').textContent).toContain('No updates were recorded');
  });
});
