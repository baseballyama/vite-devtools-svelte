import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as rpc from '../lib/rpc.js'
import type { CompilerWarning, RuntimeError } from '../lib/types.js'
import { layout, settle } from '../test/dom.js'
import ErrorDashboard from './ErrorDashboard.svelte'

const XSS = '<img src=x onerror="alert(1)"><script>alert(2)</script>'

const errors: RuntimeError[] = [
  { message: 'older error', timestamp: 1_000 },
  {
    message: `TypeError: x is undefined ${XSS}`,
    file: '/app/src/lib/Card.svelte',
    line: 12,
    column: 4,
    stack: `at Card (Card.svelte:12)\n${XSS}`,
    timestamp: 2_000,
  },
]

const warnings: CompilerWarning[] = [
  {
    code: 'a11y_missing_attribute',
    message: 'img needs alt',
    file: '/app/src/routes/+page.svelte',
    line: 3,
  },
  {
    code: 'a11y_missing_attribute',
    message: 'a needs href',
    file: '/app/src/routes/+page.svelte',
    line: 9,
    column: 2,
  },
  {
    code: 'state_referenced_locally',
    message: 'count is read locally',
    file: '/app/src/lib/Counter.svelte',
  },
]

async function setup() {
  const user = userEvent.setup()
  render(ErrorDashboard)
  await settle()
  return { user, list: screen.getByRole('listbox', { name: 'Problems' }) }
}

const messages = (list: HTMLElement) =>
  within(list)
    .queryAllByRole('option')
    .map(o => o.querySelector('.msg')!.textContent)

beforeEach(() => {
  layout(() => ({ width: 1200, height: 800 }))
  vi.mocked(rpc.getRuntimeErrors).mockResolvedValue(errors)
  vi.mocked(rpc.getCompilerWarnings).mockResolvedValue(warnings)
})

describe('ErrorDashboard', () => {
  it('lists runtime errors (newest first) before compiler warnings', async () => {
    const { list } = await setup()
    expect(messages(list)).toEqual([
      `TypeError: x is undefined ${XSS}`,
      'older error',
      'img needs alt',
      'a needs href',
      'count is read locally',
    ])
    const options = within(list).getAllByRole('option')
    expect(options[0]!.textContent).toContain('src/lib/Card.svelte:12:4')
    expect(options[3]!.textContent).toContain('+page.svelte:9:2')
    expect(options[4]!.textContent).toContain('Counter.svelte')
    // Errors without a file have no editor link.
    expect(within(options[1]!).queryByTitle('Open in editor')).toBeNull()
    // Markup in messages is text.
    expect(list.querySelector('img, script')).toBeNull()
    expect(screen.getByRole('heading', { name: /Problems/ }).textContent).toContain('5')
  })

  it('keeps the selected error selected when a newer one arrives', async () => {
    const { user, list } = await setup()
    await user.click(within(list).getAllByRole('option')[1]!)
    expect(screen.getByRole('complementary').textContent).toContain('older error')
    vi.mocked(rpc.getRuntimeErrors).mockResolvedValue([
      ...errors,
      { message: 'newest error', timestamp: 3_000 },
    ])
    await user.click(screen.getByRole('button', { name: /^Refresh/ }))
    await settle()
    expect(messages(list)[0]).toBe('newest error')
    const selected = within(list).getByRole('option', { selected: true })
    expect(selected.querySelector('.msg')!.textContent).toBe('older error')
    expect(screen.getByRole('complementary').textContent).toContain('older error')
  })

  it('shows a failed load as an error, not as "No problems"', async () => {
    vi.mocked(rpc.getRuntimeErrors).mockRejectedValue(new Error('RPC down'))
    await setup()
    expect(screen.getByRole('alert').textContent).toContain('RPC down')
    expect(screen.queryByText('No problems')).toBeNull()
  })

  it('filters by severity', async () => {
    const { user, list } = await setup()
    const sev = screen.getByRole('radiogroup', { name: 'Severity' })
    await user.click(within(sev).getByRole('radio', { name: /Errors/ }))
    expect(messages(list)).toHaveLength(2)
    await user.click(within(sev).getByRole('radio', { name: /Warnings/ }))
    expect(messages(list)).toHaveLength(3)
    expect(within(sev).getByRole('radio', { name: /Warnings/ }).textContent).toContain('3')
  })

  it('filters by text and by the most frequent warning codes', async () => {
    const { user, list } = await setup()
    const chip = screen.getByTitle('Filter by a11y_missing_attribute')
    expect(chip.textContent).toContain('2')
    await user.click(chip)
    expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe('a11y_missing_attribute')
    expect(messages(list)).toEqual(['img needs alt', 'a needs href'])
    await user.click(chip)
    expect(messages(list)).toHaveLength(5)

    await user.type(screen.getByRole('searchbox'), 'Counter')
    expect(messages(list)).toEqual(['count is read locally'])
    await user.clear(screen.getByRole('searchbox'))
    await user.type(screen.getByRole('searchbox'), 'zzz')
    expect(within(list).getByText('No problems match')).toBeTruthy()
  })

  it('shows a runtime error in the inspector, with its stack as text', async () => {
    const { user, list } = await setup()
    await user.click(within(list).getAllByRole('option')[0]!)
    const details = screen.getByRole('complementary', { name: 'Runtime error details' })
    expect(within(details).getByText('error')).toBeTruthy()
    expect(details.querySelector('pre')!.textContent).toBe(`at Card (Card.svelte:12)\n${XSS}`)
    expect(details.querySelector('img, script')).toBeNull()
    await user.click(within(details).getByRole('button', { name: 'Open line 12' }))
    expect(rpc.openInEditor).toHaveBeenCalledWith('/app/src/lib/Card.svelte', 12)
    await fireEvent.keyDown(details, { key: 'Escape' })
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('shows a warning with a docs link; a file without a line opens the file', async () => {
    const { user, list } = await setup()
    await user.click(within(list).getAllByRole('option')[4]!)
    const details = screen.getByRole('complementary', { name: 'state_referenced_locally details' })
    const link = within(details).getByRole('link', { name: /state_referenced_locally/ })
    expect(link.getAttribute('href')).toBe(
      'https://svelte.dev/docs/svelte/compiler-warnings#state_referenced_locally',
    )
    expect(link.getAttribute('rel')).toContain('noopener')
    await user.click(within(details).getByRole('button', { name: 'Open file' }))
    expect(rpc.openInEditor).toHaveBeenCalledWith('/app/src/lib/Counter.svelte', undefined)
    await user.click(within(details).getByRole('button', { name: 'Close details (Esc)' }))
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('an error without a file has no open action', async () => {
    const { user, list } = await setup()
    await user.click(within(list).getAllByRole('option')[1]!)
    const details = screen.getByRole('complementary', { name: 'Runtime error details' })
    expect(within(details).queryByRole('button', { name: /^Open/ })).toBeNull()
    expect(within(details).queryByText('Stack')).toBeNull()
  })

  it('opens a problem from its row button or with Enter', async () => {
    const { user, list } = await setup()
    const options = within(list).getAllByRole('option')
    await user.click(within(options[2]!).getByTitle('Open in editor'))
    expect(rpc.openInEditor).toHaveBeenLastCalledWith('/app/src/routes/+page.svelte', 3)
    // The row button does not select the row.
    expect(screen.queryByRole('complementary')).toBeNull()
    await user.click(options[1]!)
    await user.keyboard('{Enter}')
    // No file: nothing to open.
    expect(rpc.openInEditor).toHaveBeenCalledOnce()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(rpc.openInEditor).toHaveBeenLastCalledWith('/app/src/routes/+page.svelte', 3)
  })

  it('clears recorded problems', async () => {
    const { user, list } = await setup()
    await user.click(within(list).getAllByRole('option')[0]!)
    await user.click(screen.getByRole('button', { name: 'Clear recorded data' }))
    await settle()
    expect(rpc.clearErrors).toHaveBeenCalledOnce()
    expect(within(list).getByText('No problems')).toBeTruthy()
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('clears locally even when the server call fails', async () => {
    vi.mocked(rpc.clearErrors).mockRejectedValue(new Error('down'))
    const { user, list } = await setup()
    await user.click(screen.getByRole('button', { name: 'Clear recorded data' }))
    await settle()
    expect(within(list).getByText('No problems')).toBeTruthy()
  })

  it('shows collecting and empty states', async () => {
    let resolve!: (w: CompilerWarning[]) => void
    vi.mocked(rpc.getCompilerWarnings).mockReturnValueOnce(
      new Promise(r => {
        resolve = r
      }),
    )
    vi.mocked(rpc.getRuntimeErrors).mockResolvedValue([])
    const { list } = await setup()
    expect(within(list).getByText('Collecting diagnostics…')).toBeTruthy()
    resolve([])
    await settle()
    expect(within(list).getByText('No problems')).toBeTruthy()
  })

  it('discloses truncated captures', async () => {
    vi.mocked(rpc.getCaptureInfo).mockResolvedValue({
      runtimeErrors: { captured: 100, total: 250, truncated: true },
    })
    await setup()
    const notice = screen.getByRole('status', { name: /150 more exist/ })
    expect(notice.textContent).toMatch(/Showing\s+100\s+of\s+250/)
  })

  it('pauses and resumes live updates', async () => {
    const { user } = await setup()
    const live = screen.getByRole('button', { name: 'Live' })
    expect(live.getAttribute('aria-pressed')).toBe('true')
    await user.click(live)
    expect(screen.getByRole('button', { name: 'Paused' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
  })
})
