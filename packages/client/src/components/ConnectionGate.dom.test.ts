import { render, screen } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { flushSync, tick } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as rpc from '../lib/rpc.js'
import { settle } from '../test/dom.js'
import { emitConnection } from '../test/fake-rpc.js'
import ConnectionGate from './ConnectionGate.svelte'

function emit(status: rpc.ConnectionStatus, error?: string) {
  emitConnection({ status, host: 'standalone', error })
  flushSync()
}

/** Follow a magic link in this same document: only `hashchange` fires. */
function openMagicLink(hash: string) {
  history.pushState(null, '', hash)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

const codeInput = () => screen.getByRole('textbox', { name: 'One-time code' })
const connect = () => screen.getByRole('button', { name: /Connect|Verifying/ })

afterEach(() => {
  vi.useRealTimers()
})

describe('ConnectionGate — connection banner', () => {
  it('renders nothing while connected', () => {
    render(ConnectionGate)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows "connecting" only after a grace period, and hides it once connected', () => {
    vi.useFakeTimers()
    render(ConnectionGate)
    emit('connecting')
    vi.advanceTimersByTime(1000)
    flushSync()
    expect(screen.queryByRole('status')).toBeNull()
    vi.advanceTimersByTime(300)
    flushSync()
    expect(screen.getByRole('status').textContent).toContain('Connecting to the dev server…')

    emit('connected')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('reports an unreachable server right away, with the error when there is one', () => {
    vi.useFakeTimers()
    render(ConnectionGate)
    emit('error', 'ECONNREFUSED')
    vi.advanceTimersByTime(0)
    flushSync()
    const banner = screen.getByRole('status')
    expect(banner.getAttribute('aria-live')).toBe('polite')
    expect(banner.textContent).toContain(
      'Dev server unreachable — reconnecting automatically (ECONNREFUSED).',
    )

    emit('disconnected')
    vi.advanceTimersByTime(0)
    flushSync()
    expect(screen.getByRole('status').textContent).toContain('reconnecting automatically.')
  })
})

describe('ConnectionGate — authorization', () => {
  it('asks for the code once, in a labelled modal dialog with the input focused', async () => {
    render(ConnectionGate)
    emit('unauthorized')
    await tick()
    const dialog = screen.getByRole('dialog', { name: 'Authorize this browser' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-describedby')).toBe('auth-desc')
    expect(document.activeElement).toBe(codeInput())
    expect(rpc.requestAuthCode).toHaveBeenCalledOnce()
    expect(rpc.requestAuthCode).toHaveBeenCalledWith(undefined)
    // No banner while the dialog is up.
    expect(screen.queryByRole('status')).toBeNull()

    // Bouncing through another state does not print another code.
    emit('connecting')
    emit('unauthorized')
    expect(rpc.requestAuthCode).toHaveBeenCalledOnce()
  })

  it('enables Connect only for six digits, then submits the digits', async () => {
    render(ConnectionGate)
    emit('unauthorized')
    expect((connect() as HTMLButtonElement).disabled).toBe(true)
    await userEvent.type(codeInput(), '123 45')
    expect((connect() as HTMLButtonElement).disabled).toBe(true)
    await userEvent.type(codeInput(), '6')
    expect((connect() as HTMLButtonElement).disabled).toBe(false)
    expect(connect().getAttribute('type')).toBe('submit')
    await userEvent.click(connect())
    expect(rpc.submitAuthCode).toHaveBeenCalledWith('123456')
    expect(screen.queryByRole('alert')).toBeNull()

    // Once trusted, the gate goes away.
    emit('connected')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('ignores Enter with an incomplete code', async () => {
    render(ConnectionGate)
    emit('unauthorized')
    await userEvent.type(codeInput(), '12{Enter}')
    expect(rpc.submitAuthCode).not.toHaveBeenCalled()
  })

  it('says "Verifying…" while the code is checked', async () => {
    let answer!: (ok: boolean) => void
    vi.mocked(rpc.submitAuthCode).mockImplementation(
      () =>
        new Promise<boolean>(resolve => {
          answer = resolve
        }),
    )
    render(ConnectionGate)
    emit('unauthorized')
    await userEvent.type(codeInput(), '123456{Enter}')
    expect(connect().textContent).toContain('Verifying…')
    expect((connect() as HTMLButtonElement).disabled).toBe(true)
    // A second Enter while busy does not submit again.
    await userEvent.type(codeInput(), '{Enter}')
    expect(rpc.submitAuthCode).toHaveBeenCalledOnce()
    answer(true)
    await settle()
    expect(connect().textContent).toContain('Connect')
  })

  it('reports a rejected or failing code, clears it and refocuses the input', async () => {
    vi.mocked(rpc.submitAuthCode).mockResolvedValueOnce(false)
    render(ConnectionGate)
    emit('unauthorized')
    await userEvent.type(codeInput(), '000000{Enter}')
    await settle()
    expect(screen.getByRole('alert').textContent).toContain('That code did not work')
    expect(codeInput().getAttribute('aria-invalid')).toBe('true')
    expect((codeInput() as HTMLInputElement).value).toBe('')
    expect(document.activeElement).toBe(codeInput())

    // Typing again clears the error.
    await userEvent.type(codeInput(), '1')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(codeInput().getAttribute('aria-invalid')).toBe('false')

    vi.mocked(rpc.submitAuthCode).mockRejectedValueOnce(new Error('socket closed'))
    await userEvent.type(codeInput(), '23456{Enter}')
    await settle()
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('prints a fresh code on request (reissue)', async () => {
    vi.mocked(rpc.requestAuthCode).mockRejectedValue(new Error('offline'))
    render(ConnectionGate)
    emit('unauthorized')
    await userEvent.click(screen.getByRole('button', { name: 'Print a new code' }))
    expect(rpc.requestAuthCode).toHaveBeenLastCalledWith({ reissue: true })
  })

  it('consumes a magic link (#devframe_otp=…) once and restores the panel hash', async () => {
    history.replaceState(null, '', '/?x=1#/overview')
    render(ConnectionGate)
    emit('unauthorized')
    const entries = history.length

    openMagicLink('#devframe_otp=654321')
    await settle()
    expect(rpc.submitAuthCode).toHaveBeenCalledExactlyOnceWith('654321')
    // The code is taken out of the URL, in place (no extra history entry).
    expect(location.hash).toBe('#/overview')
    expect(location.search).toBe('?x=1')
    expect(history.length).toBe(entries + 1)

    // The same code again is not resubmitted, but still leaves the URL.
    openMagicLink('#/overview&devframe_otp=654321')
    await settle()
    expect(rpc.submitAuthCode).toHaveBeenCalledOnce()
    expect(location.hash).toBe('#/overview')

    // Unrelated hash changes are left alone.
    openMagicLink('#/routes')
    await settle()
    expect(location.hash).toBe('#/routes')
    expect(rpc.submitAuthCode).toHaveBeenCalledOnce()
  })

  it('ignores magic links while connected', async () => {
    render(ConnectionGate)
    openMagicLink('#devframe_otp=111111')
    await settle()
    expect(rpc.submitAuthCode).not.toHaveBeenCalled()
    expect(location.hash).toBe('#devframe_otp=111111')
  })
})
