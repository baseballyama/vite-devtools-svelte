import { render, screen, within } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { reactiveScope } from '../lib/reactive-selection.svelte.js'
import { router } from '../lib/router.svelte.js'
import * as rpc from '../lib/rpc.js'
import type {
  ReactiveGraphRequest,
  ReactiveGraphResult,
  ReactiveNode,
  ReactiveSummary,
  ReactiveSummaryRow,
  StateTimelineEntry,
} from '../lib/types.js'
import { layout, settle } from '../test/dom.js'
import { emptyGraph, emptySummary } from '../test/fake-rpc.js'
import ReactiveGraph from './ReactiveGraph.svelte'

const COUNTER = 'src/lib/Counter.svelte'
const APP = 'src/App.svelte'

const summaryRow = (
  componentId: number,
  file: string,
  changes: number,
  over: Partial<ReactiveSummaryRow> = {},
): ReactiveSummaryRow => ({
  componentId,
  file,
  nodes: { state: 1, derived: 1, effect: 1 },
  changes,
  renders: changes,
  renderMs: changes / 2,
  ...over,
})

const summary = (over: Partial<ReactiveSummary> = {}): ReactiveSummary => ({
  ...emptySummary,
  components: { total: 3, withActivity: 3 },
  rows: [summaryRow(1, COUNTER, 5), summaryRow(2, COUNTER, 2), summaryRow(3, APP, 1)],
  baseline: { complete: true, pendingNodes: 0 },
  capabilities: { valueInspection: false, signalHistory: false, writeCause: false },
  ...over,
})

const node = (
  componentId: number,
  name: string,
  type: ReactiveNode['type'],
  over: Partial<ReactiveNode> = {},
): ReactiveNode => ({
  id: `${componentId}:${name}`,
  type,
  name,
  componentId,
  componentFile: componentId === 3 ? APP : COUNTER,
  ...over,
})

let counterValue: unknown = 1
const graphNodes = (): ReactiveNode[] => [
  node(1, 'count', 'state', { value: counterValue }),
  node(1, 'double', 'derived', { value: 2 }),
  node(1, '(template)', 'template'),
  node(1, 'log', 'effect'),
  node(1, 'lazy', 'derived', { unevaluated: true }),
  node(1, 'items', 'state', { value: '(object)' }),
  node(3, 'theme', 'state', { value: 'dark' }),
]
const graphEdges = [
  { from: '1:count', to: '1:double' },
  { from: '1:double', to: '1:(template)' },
  { from: '1:count', to: '1:log' },
  { from: '3:theme', to: '1:(template)' },
]

function graph(
  req?: ReactiveGraphRequest,
  over: Partial<ReactiveGraphResult> = {},
): ReactiveGraphResult {
  const nodes = graphNodes()
  return {
    ...emptyGraph,
    nodes,
    edges: graphEdges,
    scope: req?.componentId ?? null,
    epoch: 'e1',
    total: { nodes: nodes.length, nodesKind: 'registered', edges: graphEdges.length },
    edgesOmitted: 2,
    computedAt: Date.UTC(2026, 0, 1, 12),
    policy: req?.componentId === undefined ? 'global-head' : 'scoped',
    ...over,
  }
}

/**
 * happy-dom does not match `:checked` on `<option>`, which Svelte's
 * `bind:value` on a `<select>` reads on change: answer it from
 * `selectedOptions` for this element.
 */
function checkedPolyfill(select: HTMLSelectElement) {
  Object.defineProperty(select, 'querySelector', {
    value: (selector: string) =>
      selector === ':checked'
        ? (select.selectedOptions[0] ?? null)
        : (select.querySelectorAll(selector)[0] ?? null),
  })
}
const byText = (a = '', b = '') => a.localeCompare(b)

/** Page text with whitespace collapsed (markup wraps text across lines). */
const text = () => (document.body.textContent ?? '').replaceAll(/\s+/g, ' ')
const panelHeading = () => screen.getByRole('heading', { level: 1 })
const radio = (group: string, name: string | RegExp) =>
  within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name })
const options = (list: string) =>
  within(screen.getByRole('listbox', { name: list })).queryAllByRole('option')

beforeEach(() => {
  layout(() => ({ width: 1200, height: 600 }))
  reactiveScope.set(null)
  counterValue = 1
  vi.mocked(rpc.getReactiveSummary).mockResolvedValue(summary())
  vi.mocked(rpc.getReactiveGraph).mockImplementation(req => Promise.resolve(graph(req)))
  vi.mocked(rpc.getLiveComponentsMeta).mockResolvedValue({
    total: 3,
    kept: 3,
    truncated: false,
    epoch: 'e1',
    epochs: 1,
  })
})

const entry = (
  seq: number,
  id: string,
  over: Partial<StateTimelineEntry> = {},
): StateTimelineEntry => ({
  seq,
  id,
  name: id.split(':')[1]!,
  componentFile: COUNTER,
  oldValue: seq - 1,
  newValue: seq,
  timestamp: Date.UTC(2026, 0, 1, 12, 0, seq),
  ...over,
})

async function states() {
  render(ReactiveGraph)
  await settle()
  await userEvent.click(radio('Overview of', 'States'))
  await settle()
}

async function scoped(componentId = 1, epoch: string | null = 'e1') {
  reactiveScope.set({ componentId, epoch, label: '<Counter>', file: COUNTER })
  const r = render(ReactiveGraph)
  await settle()
  return r
}

const signals = () => options('Reactive signals')
const names = () => signals().map(r => r.querySelector('.name')?.textContent)

async function full() {
  render(ReactiveGraph)
  await settle()
  await userEvent.click(radio('Reactivity view', 'Full graph'))
  await settle()
}

describe('ReactiveGraph: components overview', () => {
  it('summarises activity per file without fetching a graph', async () => {
    render(ReactiveGraph)
    await settle()
    expect(rpc.getReactiveSummary).toHaveBeenCalledWith({ topK: 50, windowMs: 10000 })
    expect(rpc.getReactiveGraph).not.toHaveBeenCalled()
    expect(panelHeading().textContent).toContain('3')
    const record = screen.getByRole('group', { name: 'What this overview covers' })
    expect(record.textContent).toContain('3 active of 3 registered')
    expect(record.textContent).toContain('full values, per-signal history, update cause')
    const rows = options('Most active components')
    // Grouped by file, most changes first.
    expect(rows.map(r => r.querySelector('.mono')?.textContent)).toEqual(['Counter', 'App'])
    expect(rows[0]!.textContent).toContain('≥ 7')
    expect(screen.getByText(/Listed: 3\s+components \(all active\)/)).toBeTruthy()
    expect(screen.getByText(/Other: unknown\./)).toBeTruthy()
  })

  it('groups by instance and sorts by a column', async () => {
    render(ReactiveGraph)
    await settle()
    await userEvent.click(radio('Group', 'By instance'))
    expect(
      options('Most active components').map(r => r.querySelector('.num')?.textContent),
    ).toEqual([' #1', ' #2', ' #3'])
    await userEvent.click(
      within(screen.getByRole('columnheader', { name: 'Component' })).getByRole('button'),
    )
    expect(options('Most active components')[0]!.textContent).toContain('App')
  })

  it('selecting an instance from a file row loads its graph', async () => {
    render(ReactiveGraph)
    await settle()
    await userEvent.click(options('Most active components')[0]!)
    const aside = screen.getByRole('complementary', { name: '<Counter> details' })
    expect(within(aside).getByText('Listed instances')).toBeTruthy()
    await userEvent.click(within(aside).getByRole('button', { name: /#2/ }))
    await settle()
    expect(reactiveScope.current).toEqual({
      componentId: 2,
      epoch: 'e1',
      label: '<Counter>',
      file: COUNTER,
    })
    expect(radio('Reactivity view', '<Counter>').getAttribute('aria-checked')).toBe('true')
    expect(rpc.getReactiveGraph).toHaveBeenLastCalledWith({
      componentId: 2,
      epoch: 'e1',
      maxNodes: 5000,
      maxEdges: 20000,
    })
  })

  it('Enter on a single-instance row selects it', async () => {
    render(ReactiveGraph)
    await settle()
    screen.getByRole('listbox', { name: 'Most active components' }).focus()
    await userEvent.keyboard('{End}{Enter}')
    expect(reactiveScope.current?.componentId).toBe(3)
  })

  it('without a page-load id instances cannot be selected', async () => {
    vi.mocked(rpc.getReactiveSummary).mockResolvedValue(summary({ epoch: null }))
    render(ReactiveGraph)
    await settle()
    await userEvent.click(options('Most active components')[0]!)
    const aside = screen.getByRole('complementary', { name: '<Counter> details' })
    const instance = within(aside).getByRole('button', { name: /#1/ })
    expect(instance.hasAttribute('disabled')).toBe(true)
    expect(aside.textContent).toContain('reported no page-load id')
  })

  it('discloses truncation, other components, stale replies and an incomplete baseline', async () => {
    vi.mocked(rpc.getReactiveSummary).mockResolvedValue(
      summary({
        truncated: true,
        components: { total: null, withActivity: 9 },
        other: { components: 6, nodes: 40 },
        stale: true,
        staleReason: 'no-runtime',
        baseline: { complete: false, pendingNodes: 1 },
        capabilities: { valueInspection: true, signalHistory: true, writeCause: true },
      }),
    )
    render(ReactiveGraph)
    await settle()
    const body = text()
    expect(body).toContain('top 3 of 9 active')
    expect(body).toContain('Other: 6 components with 40 signals.')
    expect(body).toContain('9 active of unknown registered')
    expect(body).toContain('no app page is connected')
    expect(body).toContain('Sampling baseline: 1 state pending')
    expect(body).toMatch(/Not available yet\s*none/)
  })

  it('shows an unavailable overview with a way to the full graph', async () => {
    vi.mocked(rpc.getReactiveSummary).mockRejectedValue(new Error('no summary'))
    render(ReactiveGraph)
    await settle()
    expect(screen.getByText('Overview not available')).toBeTruthy()
    expect(text()).toContain('no summary')
    await userEvent.click(screen.getByRole('button', { name: 'Full graph' }))
    await settle()
    expect(radio('Reactivity view', 'Full graph').getAttribute('aria-checked')).toBe('true')
    expect(rpc.getReactiveGraph).toHaveBeenCalledWith({ maxNodes: 5000, maxEdges: 20000 })
  })

  it('shows an empty window', async () => {
    vi.mocked(rpc.getReactiveSummary).mockResolvedValue(summary({ rows: [] }))
    render(ReactiveGraph)
    await settle()
    expect(screen.getByText('No component was active in the window')).toBeTruthy()
    expect(screen.getByText(/Listed: 0\s+components/)).toBeTruthy()
  })
})

describe('ReactiveGraph: states overview', () => {
  it('lists the most changed states of the timeline buffer', async () => {
    vi.mocked(rpc.getStateTimelineDelta).mockResolvedValue({
      cursor: 3,
      reset: true,
      changes: [entry(1, '1:count'), entry(2, '1:count'), entry(3, 'x:loose', { newValue: 'hi' })],
    })
    vi.mocked(rpc.getCaptureInfo).mockResolvedValue({
      stateTimeline: {
        captured: 3,
        total: 3,
        truncated: false,
        baseline: { complete: false, pendingNodes: 2 },
      },
    })
    await states()
    expect(rpc.getStateTimelineDelta).toHaveBeenCalledWith(undefined)
    expect(panelHeading().textContent).toContain('2')
    const rows = options('Most changed states in the timeline buffer')
    expect(rows.map(r => r.querySelector('.name')?.textContent)).toEqual(['count', 'loose'])
    expect(rows[0]!.textContent).toContain('≥ 2')
    expect(rows[0]!.textContent).toContain('#1')
    // A node id without a numeric component id has no instance to open.
    expect(rows[1]!.textContent).not.toContain('#')
    expect(screen.getByRole('status', { name: '' }).textContent).toContain('2 states pending')
    expect(screen.getByText(/the latest 3 sampled changes/)).toBeTruthy()
  })

  it('activating a state opens its component with the served page load', async () => {
    vi.mocked(rpc.getStateTimelineDelta).mockResolvedValue({
      cursor: 1,
      reset: true,
      changes: [entry(1, '1:count'), entry(2, 'x:loose')],
    })
    await states()
    const list = screen.getByRole('listbox', { name: 'Most changed states in the timeline buffer' })
    list.focus()
    // `loose` has no component id: nothing happens.
    await userEvent.keyboard('{End}{Enter}')
    await settle()
    expect(reactiveScope.current).toBeNull()
    await userEvent.keyboard('{Home}{Enter}')
    await settle()
    expect(rpc.getLiveComponentsMeta).toHaveBeenCalled()
    expect(reactiveScope.current).toEqual({
      componentId: 1,
      epoch: 'e1',
      label: '<Counter>',
      file: COUNTER,
    })
  })

  it('does not scope a state when no page load is served', async () => {
    vi.mocked(rpc.getStateTimelineDelta).mockResolvedValue({
      cursor: 1,
      reset: true,
      changes: [entry(1, '1:count')],
    })
    vi.mocked(rpc.getLiveComponentsMeta).mockRejectedValue(new Error('down'))
    await states()
    screen.getByRole('listbox', { name: 'Most changed states in the timeline buffer' }).focus()
    await userEvent.keyboard('{Home}{Enter}')
    await settle()
    expect(reactiveScope.current).toBeNull()
  })

  it('shows an empty buffer and a failing timeline', async () => {
    await states()
    expect(screen.getByText('No $state changes in the buffer')).toBeTruthy()
    expect(screen.getByText(/since\s+unknown \(buffer empty\)/)).toBeTruthy()

    vi.mocked(rpc.getStateTimelineDelta).mockRejectedValue(new Error('timeline down'))
    await userEvent.click(screen.getByRole('button', { name: /^Refresh/ }))
    await settle()
    expect(screen.getByText('State timeline not available')).toBeTruthy()
    expect(text()).toContain('timeline down')
  })
})

describe('ReactiveGraph: component scope', () => {
  beforeEach(() => {
    localStorage.setItem('svelte-devtools:reactive:view', '"list"')
  })

  it('asks for a component before loading anything', async () => {
    render(ReactiveGraph)
    await settle()
    await userEvent.click(radio('Reactivity view', 'Component'))
    expect(screen.getByText('Pick a component')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Components' }))
    expect(router.current).toBe('components')
    await userEvent.click(screen.getByRole('button', { name: 'Overview' }))
    expect(radio('Reactivity view', 'Overview').getAttribute('aria-checked')).toBe('true')
  })

  it('refuses a scope without a page-load id', async () => {
    await scoped(1, null)
    expect(screen.getByText('This selection has no page-load id')).toBeTruthy()
    expect(rpc.getReactiveGraph).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(reactiveScope.current).toBeNull()
    expect(radio('Reactivity view', 'Overview').getAttribute('aria-checked')).toBe('true')
  })

  it('says so when the app page reloaded since the selection', async () => {
    vi.mocked(rpc.getReactiveGraph).mockResolvedValue({
      ...emptyGraph,
      scope: 1,
      epoch: null,
      stale: true,
      staleReason: 'epoch-changed',
    })
    await scoped()
    expect(screen.getByText('The app page reloaded')).toBeTruthy()
    expect(text()).toContain('<Counter> #1 may now be a different instance')
  })

  it('lists the signals with kind counts, filters by kind and text', async () => {
    await scoped()
    expect(rpc.getReactiveGraph).toHaveBeenCalledWith({
      componentId: 1,
      epoch: 'e1',
      maxNodes: 5000,
      maxEdges: 20000,
    })
    expect(panelHeading().textContent).toContain('7')
    expect(screen.getByText(/<Counter>/, { selector: 'strong' })).toBeTruthy()
    expect(text()).toContain('2 edges to signals outside the loaded set are not shown.')
    expect(text()).toMatch(/Built \d\d:\d\d:\d\d/)
    expect(radio('Signal kind', /\$state/).textContent).toContain('3')
    expect(names()).toHaveLength(7)
    // The markup node is labelled "markup".
    expect(signals().some(r => r.textContent?.includes('markup'))).toBe(true)
    expect(
      signals()
        .find(r => r.textContent?.includes('items'))
        ?.querySelector('.value')?.textContent,
    ).toBe('(object)')

    await userEvent.click(radio('Signal kind', /\$derived/))
    expect(names().toSorted(byText)).toEqual(['double', 'lazy'])
    await userEvent.click(radio('Signal kind', 'All'))
    const search = screen.getByRole('searchbox', { name: 'Filter' })
    expect(search.getAttribute('placeholder')).toBe('Filter the 7 loaded signals…')
    await userEvent.type(search, 'dark')
    expect(names()).toEqual(['theme'])
    await userEvent.type(search, 'zzz')
    expect(screen.getByText('No loaded signals match')).toBeTruthy()
  })

  it('sorts by in/out degree', async () => {
    await scoped()
    const header = screen.getByRole('columnheader', { name: 'In / Out' })
    await userEvent.click(within(header).getByRole('button'))
    expect(header.getAttribute('aria-sort')).toBe('descending')
    expect(names()[0]).toBe('count')
    expect(signals()[0]!.textContent).toContain('0 / 2')
  })

  it('inspects a signal: value, dependencies, editor, other component, history', async () => {
    await scoped()
    await userEvent.click(signals().find(r => r.textContent?.includes('count'))!)
    let aside = screen.getByRole('complementary', { name: 'count details' })
    expect(within(aside).getByText('$state')).toBeTruthy()
    expect(within(aside).getByText('component #1')).toBeTruthy()
    expect(within(aside).getByText('1', { selector: 'pre' })).toBeTruthy()
    expect(aside.textContent).toContain(
      'Not recorded. This dev server does not capture which write',
    )
    expect(aside.textContent).toContain('Per-signal history: not available yet.')
    // Same component: no "Show this component".
    expect(within(aside).queryByRole('button', { name: 'Show this component' })).toBeNull()
    await userEvent.click(within(aside).getByRole('button', { name: 'Go to definition (by name)' }))
    expect(rpc.openReactiveInEditor).toHaveBeenLastCalledWith(COUNTER, 'count', 'state')

    // Follow a dependent: count → double.
    await userEvent.click(within(aside).getByRole('button', { name: /double/ }))
    aside = screen.getByRole('complementary', { name: 'double details' })
    expect(aside.textContent).toContain('Not recorded for $derived.')
    // double → markup, which is also read by another component's state.
    await userEvent.click(within(aside).getByRole('button', { name: /markup/ }))
    aside = screen.getByRole('complementary', { name: '(template) details' })
    expect(aside.textContent).toContain("All reads from this component's markup")
    expect(within(aside).getByRole('button', { name: /theme.*other component/ })).toBeTruthy()
    await userEvent.click(within(aside).getByRole('button', { name: 'Open component' }))
    expect(rpc.openReactiveInEditor).toHaveBeenLastCalledWith(COUNTER, '(template)', 'template')
    expect(within(aside).getAllByText('None')).toHaveLength(1)

    await userEvent.click(within(aside).getByRole('button', { name: /theme/ }))
    aside = screen.getByRole('complementary', { name: 'theme details' })
    await userEvent.click(within(aside).getByRole('button', { name: 'Show this component' }))
    await settle()
    expect(reactiveScope.current).toEqual({
      componentId: 3,
      epoch: 'e1',
      label: '<App>',
      file: APP,
    })
  })

  it('links a state to the State timeline and explains summarised values', async () => {
    await scoped()
    await userEvent.click(signals().find(r => r.textContent?.includes('items'))!)
    const aside = screen.getByRole('complementary', { name: 'items details' })
    expect(within(aside).getByText('(object)', { selector: 'pre' })).toBeTruthy()
    expect(aside.textContent).toContain('Full value: not available yet.')
    await userEvent.click(within(aside).getByRole('button', { name: 'State timeline' }))
    expect(router.current).toBe('timeline')
  })

  it('explains an unevaluated $derived', async () => {
    await scoped()
    await userEvent.click(signals().find(r => r.textContent?.includes('lazy'))!)
    expect(screen.getByRole('complementary', { name: 'lazy details' }).textContent).toContain(
      'Not evaluated yet',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Close details (Esc)' }))
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('Enter opens the selected signal in the editor', async () => {
    await scoped()
    screen.getByRole('listbox', { name: 'Reactive signals' }).focus()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(rpc.openReactiveInEditor).toHaveBeenCalledOnce()
  })

  it('flashes values that changed since the last poll', async () => {
    await scoped()
    expect(document.querySelector('.flash')).toBeNull()
    counterValue = 2
    await userEvent.click(screen.getByRole('button', { name: /^Refresh/ }))
    await settle()
    const count = signals().find(r => r.textContent?.includes('count'))!
    expect(count.querySelector('.name.flash')).toBeTruthy()
    expect(count.querySelector('.value')?.textContent).toBe('2')
  })

  it('clears the scope from the scope bar', async () => {
    await scoped()
    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(reactiveScope.current).toBeNull()
    expect(screen.getByRole('listbox', { name: 'Most active components' })).toBeTruthy()
  })

  it('shows an empty component', async () => {
    vi.mocked(rpc.getReactiveGraph).mockImplementation(req =>
      Promise.resolve(graph(req, { nodes: [], edges: [], edgesOmitted: 0 })),
    )
    await scoped()
    expect(screen.getByText('No signals tracked here')).toBeTruthy()
  })
})

describe('ReactiveGraph: full graph', () => {
  it('renders the whole graph as a node-link diagram when small', async () => {
    await full()
    expect(rpc.getReactiveGraph).toHaveBeenCalledWith({ maxNodes: 5000, maxEdges: 20000 })
    expect(radio('Layout', 'Auto').getAttribute('aria-checked')).toBe('true')
    expect(document.querySelectorAll('svg g.node')).toHaveLength(7)
    expect(screen.queryByRole('listbox', { name: 'Reactive signals' })).toBeNull()
  })

  it('narrows to one file and its direct links, and scopes to a component', async () => {
    localStorage.setItem('svelte-devtools:reactive:view', '"list"')
    await full()
    const select = screen.getByRole('combobox', { name: 'Filter loaded signals by component file' })
    expect(within(select).getByRole('option', { name: 'All loaded files (2)' })).toBeTruthy()
    checkedPolyfill(select as HTMLSelectElement)
    await userEvent.selectOptions(select, APP)
    // App's theme plus the markup node it feeds.
    expect(
      options('Reactive signals')
        .map(r => r.querySelector('.name')?.textContent)
        .toSorted(byText),
    ).toEqual(['(template)', 'theme'])
    await userEvent.click(options('Reactive signals').find(r => r.textContent?.includes('theme'))!)
    await userEvent.click(screen.getByRole('button', { name: 'Show this component' }))
    await settle()
    expect(reactiveScope.current?.componentId).toBe(3)
  })

  it('refuses to lay out too many signals and offers the list', async () => {
    localStorage.setItem('svelte-devtools:reactive:view', '"graph"')
    vi.mocked(rpc.getReactiveGraph).mockImplementation(req =>
      Promise.resolve(
        graph(req, {
          nodes: Array.from({ length: 450 }, (_, i) => node(1, `s${i}`, 'state', { value: i })),
          edges: [],
        }),
      ),
    )
    await full()
    expect(screen.getByText('450 signals is too many to lay out')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Switch to list' }))
    expect(screen.getByRole('listbox', { name: 'Reactive signals' })).toBeTruthy()
    expect(radio('Layout', 'List').getAttribute('aria-checked')).toBe('true')
  })

  it('pauses auto-refresh for very large graphs and discloses the cap', async () => {
    vi.mocked(rpc.getReactiveGraph).mockImplementation(req =>
      Promise.resolve(
        graph(req, {
          nodes: Array.from({ length: 2001 }, (_, i) => node(1, `s${i}`, 'state')),
          edges: [],
          truncated: true,
          total: { nodes: 9000, nodesKind: 'registered', edges: null },
          stale: true,
          staleReason: 'timeout',
        }),
      ),
    )
    await full()
    expect(screen.getByText(/Paused: 2,001 of 9,000 signals/)).toBeTruthy()
    const live = screen.getByRole('button', { name: /Paused/ })
    expect(live.getAttribute('aria-pressed')).toBe('false')
    const notice = screen.getAllByRole('status').map(s => s.textContent)
    expect(notice.some(t => /Showing\s+global-head\s+2,001\s+of\s+9,000.*stale/s.test(t))).toBe(
      true,
    )
    // Resuming is respected.
    await userEvent.click(live)
    expect(screen.queryByText(/Paused: 2,001/)).toBeNull()
  })
})
