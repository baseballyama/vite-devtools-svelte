import { render, screen } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { tick } from 'svelte'
import { describe, expect, it, vi } from 'vitest'

import CommandPalette from './CommandPalette.svelte'
import type { Command } from './types.js'

function commands(): Command[] {
  return [
    {
      id: 'a',
      label: 'Overview',
      hint: 'Project at a glance',
      group: 'App',
      icon: 'overview',
      run: vi.fn<() => void>(),
    },
    {
      id: 'b',
      label: 'Routes',
      group: 'App',
      icon: 'routes',
      keywords: 'pages layouts',
      run: vi.fn<() => void>(),
    },
    { id: 'c', label: 'Theme: dark', group: 'Preferences', icon: 'moon', run: vi.fn<() => void>() },
  ]
}

const options = () => screen.getAllByRole('option')
const active = () => options().find(o => o.getAttribute('aria-selected') === 'true')

async function openPalette(cmds = commands()) {
  const view = render(CommandPalette, { open: true, commands: cmds })
  await tick()
  await tick()
  // A placeholder alone is not a reliable label: the input is named.
  return { ...view, cmds, input: screen.getByRole('combobox', { name: 'Search commands' }) }
}

describe('CommandPalette', () => {
  it('renders nothing while closed', () => {
    render(CommandPalette, { open: false, commands: commands() })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens as a modal dialog with every command and focuses the input', async () => {
    const { input } = await openPalette()
    const dialog = screen.getByRole('dialog', { name: 'Command palette' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByRole('listbox', { name: 'Commands' })).toBeTruthy()
    expect(options().map(o => o.textContent)).toEqual([
      expect.stringContaining('Overview'),
      expect.stringContaining('Routes'),
      expect.stringContaining('Theme: dark'),
    ])
    expect(screen.getByText('Project at a glance')).toBeTruthy()
    expect(document.activeElement).toBe(input)
    expect(active()?.textContent).toContain('Overview')
    expect(input.getAttribute('aria-activedescendant')).toBe(active()?.id)
  })

  it('filters by label, hint, group and keywords, and says when nothing matches', async () => {
    const { input } = await openPalette()
    await userEvent.type(input, 'layouts')
    expect(options()).toHaveLength(1)
    expect(options()[0]!.textContent).toContain('Routes')

    await userEvent.clear(input)
    await userEvent.type(input, 'prefer')
    expect(options().map(o => o.textContent)).toEqual([expect.stringContaining('Theme: dark')])

    await userEvent.clear(input)
    await userEvent.type(input, 'zzzz')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText('No matches for “zzzz”')).toBeTruthy()
    expect(input.getAttribute('aria-activedescendant')).toBeNull()
    // Arrows and Enter are no-ops without results.
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('highlights the matched part of the label as text', async () => {
    const { input } = await openPalette()
    await userEvent.type(input, 'Rout')
    expect(options()[0]!.querySelector('mark')?.textContent).toBe('Rout')
  })

  it('moves the selection with ↑/↓ (wrapping) and runs the active command on Enter', async () => {
    const { input, cmds } = await openPalette()
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    await userEvent.keyboard('{ArrowDown}')
    expect(active()?.textContent).toContain('Routes')
    await tick()
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
    await userEvent.keyboard('{ArrowUp}{ArrowUp}')
    expect(active()?.textContent).toContain('Theme: dark')
    await userEvent.keyboard('{ArrowDown}')
    expect(active()?.textContent).toContain('Overview')
    // Typing resets the selection to the first result.
    await userEvent.keyboard('{ArrowDown}')
    await userEvent.type(input, 'e')
    expect(active()).toBe(options()[0])

    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(cmds[1]!.run).toHaveBeenCalledOnce()
    expect(cmds[0]!.run).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps Tab inside the dialog', async () => {
    const { input } = await openPalette()
    await userEvent.tab()
    expect(document.activeElement).toBe(input)
  })

  it('runs a command on click and tracks the hovered row', async () => {
    const { cmds } = await openPalette()
    await userEvent.hover(options()[2]!)
    expect(active()?.textContent).toContain('Theme: dark')
    await userEvent.click(options()[2]!)
    expect(cmds[2]!.run).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on Escape and on a backdrop click, restoring focus to the opener', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const view = render(CommandPalette, { open: false, commands: commands() })
    await view.rerender({ open: true })
    await tick()
    await tick()
    expect(document.activeElement).toBe(screen.getByRole('combobox'))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)

    await view.rerender({ open: false })
    await view.rerender({ open: true })
    await tick()
    // A click inside the dialog does not close it; one on the scrim does.
    await userEvent.click(screen.getByRole('dialog'))
    expect(screen.getByRole('dialog')).toBeTruthy()
    const scrim = screen.getByRole('dialog').parentElement!
    await userEvent.click(scrim)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('starts with an empty query each time it opens', async () => {
    const view = render(CommandPalette, { open: true, commands: commands() })
    await tick()
    await userEvent.type(screen.getByRole('combobox'), 'zzz')
    await userEvent.keyboard('{Escape}')
    await view.rerender({ open: true })
    await tick()
    expect(screen.getByRole<HTMLInputElement>('combobox').value).toBe('')
    expect(options()).toHaveLength(3)
  })
})
