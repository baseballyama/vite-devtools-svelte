import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'

import * as rpc from '../lib/rpc.js'
import Overview from '../panels/Overview.svelte'
import { settle } from '../test/dom.js'
import PanelHost from './PanelHost.svelte'

describe('PanelHost', () => {
  it('keeps an inactive panel mounted but hidden, and does not let it load', async () => {
    const { container } = render(PanelHost, { component: Overview, active: false })
    await settle()
    const host = container.querySelector('.host')!
    expect(host.hasAttribute('hidden')).toBe(true)
    expect(screen.queryByRole('region', { name: 'Overview' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Overview', hidden: true })).toBeTruthy()
    // Resources start only while the panel is active.
    expect(rpc.getProject).not.toHaveBeenCalled()
  })

  it('shows and starts the panel when it becomes active', async () => {
    const view = render(PanelHost, { component: Overview, active: false })
    await view.rerender({ active: true })
    await settle()
    expect(view.container.querySelector('.host')!.hasAttribute('hidden')).toBe(false)
    expect(screen.getByRole('heading', { name: 'demo-app' })).toBeTruthy()
    expect(rpc.getProject).toHaveBeenCalledOnce()

    // Hiding it again keeps what it rendered.
    await view.rerender({ active: false })
    expect(screen.getByRole('heading', { name: 'demo-app', hidden: true })).toBeTruthy()
  })
})
