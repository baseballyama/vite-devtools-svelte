<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import type { IconName } from '../lib/icons.js'
  import Icon from './Icon.svelte'

  interface Props extends Omit<HTMLButtonAttributes, 'children'> {
    icon?: IconName
    /** Accessible name; also the tooltip for icon-only buttons. */
    label?: string
    variant?: 'default' | 'ghost' | 'primary' | 'danger'
    pressed?: boolean
    children?: Snippet
  }

  let {
    icon,
    label,
    variant = 'default',
    pressed,
    children,
    type = 'button',
    title,
    ...rest
  }: Props = $props()
</script>

<button
  {type}
  class="btn {variant}"
  class:icon-only={!children}
  aria-label={children ? undefined : label}
  aria-pressed={pressed}
  title={title ?? label}
  {...rest}
>
  {#if icon}<Icon name={icon} size={14} />{/if}
  {#if children}<span class="label">{@render children()}</span>{/if}
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: var(--control-h);
    padding: 0 9px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-elevated);
    color: var(--fg-muted);
    font-size: var(--fs-sm);
    font-weight: 500;
    white-space: nowrap;
    flex-shrink: 0;
    transition:
      background var(--dur-fast) var(--ease),
      color var(--dur-fast) var(--ease),
      border-color var(--dur-fast) var(--ease);
  }
  .btn:hover:not(:disabled) {
    color: var(--fg);
    border-color: var(--border-strong);
    background: var(--bg-hover);
  }
  .btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .icon-only {
    width: var(--control-h);
    padding: 0;
  }
  .ghost {
    border-color: transparent;
    background: transparent;
  }
  .ghost:hover:not(:disabled) {
    border-color: transparent;
  }
  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .primary:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
    color: #fff;
  }
  .danger:hover:not(:disabled) {
    color: var(--red);
  }
  .btn[aria-pressed='true'] {
    color: var(--accent-fg);
    background: var(--bg-selected);
    border-color: transparent;
  }
  .label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
</style>
