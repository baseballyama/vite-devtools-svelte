<script lang="ts">
  import { tick } from 'svelte'

  import { digitsOf } from '../lib/chars.js'
  import { connection } from '../lib/connection.svelte.js'
  import { hashOtp, router } from '../lib/router.svelte.js'
  import Button from './Button.svelte'
  import Icon from './Icon.svelte'

  /**
   * Connection UX: a blocking card when the dev server needs the one-time
   * code (standalone devframe auth), and a slim banner while the connection
   * is down. Nothing renders while connected.
   */
  let code = $state('')
  const digits = $derived(digitsOf(code))
  let busy = $state(false)
  let failed = $state(false)
  let requested = $state(false)
  let input = $state<HTMLInputElement | null>(null)

  const status = $derived(connection.state.status)

  // Avoid flashing the banner on the first sub-second connect.
  let showDown = $state(false)
  $effect(() => {
    if (status === 'connected' || status === 'unauthorized') {
      showDown = false
      return
    }
    const id = setTimeout(() => (showDown = true), status === 'connecting' ? 1200 : 0)
    return () => clearTimeout(id)
  })

  $effect(() => {
    if (status === 'unauthorized') {
      void tick().then(() => input?.focus())
      if (!requested) {
        requested = true
        connection.requestCode().catch(() => {})
      }
    }
  })

  // A magic link (`#devframe_otp=<code>`) opened in this same document —
  // pasted into the address bar or followed from a same-page link — only
  // fires `hashchange`; devframe reads the code on a full page load only.
  // While the gate is open, consume it through the public submit path,
  // once per code, and take the code out of the URL (back to the panel).
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- consumed-code bookkeeping, read only in the hash handler and never rendered: intentionally non-reactive
  const linkCodes = new Set<string>()
  $effect(() => {
    if (status !== 'unauthorized' || !connection.canAuth) return
    const onHash = () => {
      const c = hashOtp(location.hash)
      if (c === null) return
      history.replaceState(
        history.state,
        '',
        `${location.pathname}${location.search}#/${router.current}`,
      )
      if (linkCodes.has(c) || busy) return
      linkCodes.add(c)
      code = c
      void verify(c)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  })

  async function submit(e: SubmitEvent) {
    e.preventDefault()
    if (digits.length < 6 || busy) return
    await verify(digits)
  }

  async function verify(c: string) {
    busy = true
    failed = false
    try {
      failed = !(await connection.submitCode(c))
    } catch {
      failed = true
    } finally {
      busy = false
    }
    if (failed) {
      code = ''
      input?.focus()
    }
  }
</script>

{#if status === 'unauthorized' && connection.canAuth}
  <div class="scrim">
    <div role="dialog" aria-modal="true" aria-labelledby="auth-title" aria-describedby="auth-desc">
      <form class="card" onsubmit={submit}>
        <span class="lock"><Icon name="command" size={20} /></span>
        <h2 id="auth-title">Authorize this browser</h2>
        <p id="auth-desc">
          Enter the 6-digit code printed in the terminal running your dev server.
        </p>
        <input
          bind:this={input}
          bind:value={code}
          class="otp mono"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="7"
          placeholder="000000"
          aria-label="One-time code"
          aria-invalid={failed}
          oninput={() => (failed = false)}
        />
        {#if failed}<p class="err" role="alert">
            That code did not work — check the terminal and try again.
          </p>{/if}
        <Button type="submit" variant="primary" disabled={busy || digits.length < 6}>
          {busy ? 'Verifying…' : 'Connect'}
        </Button>
        <button
          type="button"
          class="link"
          onclick={() => connection.requestCode({ reissue: true }).catch(() => {})}
          >Print a new code</button
        >
      </form>
    </div>
  </div>
{:else if showDown && status !== 'connected' && status !== 'unauthorized'}
  <div class="banner" class:error={status !== 'connecting'} role="status" aria-live="polite">
    <span class="spinner" aria-hidden="true"></span>
    {#if status === 'connecting'}
      Connecting to the dev server…
    {:else}
      Dev server unreachable — reconnecting automatically{connection.state.error
        ? ` (${connection.state.error})`
        : ''}.
    {/if}
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 90;
    display: grid;
    place-items: center;
    padding: 16px;
    background: color-mix(in srgb, var(--bg) 70%, transparent);
    backdrop-filter: blur(6px);
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    width: min(360px, 100%);
    padding: 28px 24px 20px;
    text-align: center;
    background: var(--bg-elevated);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
  }
  .lock {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: var(--bg-selected);
    color: var(--accent-fg);
  }
  h2 {
    margin: 4px 0 0;
    font-size: var(--fs-lg);
  }
  p {
    margin: 0;
    color: var(--fg-muted);
    font-size: var(--fs-sm);
  }
  .otp {
    width: 100%;
    height: 44px;
    margin: 6px 0 4px;
    text-align: center;
    font-size: 22px;
    letter-spacing: 0.4em;
    background: var(--bg-inset);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    outline: none;
  }
  .otp:focus {
    border-color: var(--accent);
  }
  .otp[aria-invalid='true'] {
    border-color: var(--red);
  }
  .err {
    color: var(--red);
  }
  .card :global(.btn) {
    width: 100%;
    height: 32px;
  }
  .link {
    border: 0;
    background: none;
    color: var(--fg-muted);
    font-size: var(--fs-xs);
    text-decoration: underline;
  }
  .banner {
    position: fixed;
    left: 50%;
    bottom: 12px;
    z-index: 80;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: calc(100% - 32px);
    padding: 7px 12px;
    border-radius: var(--radius-full);
    background: var(--bg-elevated);
    box-shadow: var(--shadow);
    font-size: var(--fs-sm);
    color: var(--fg-muted);
  }
  .banner.error {
    color: var(--red);
  }
  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
