<script lang="ts" generics="V extends string">
  /** Single-choice segmented control (ARIA radiogroup, arrow keys move). */
  interface Option {
    value: V
    label: string
    count?: number
  }

  let {
    options,
    value = $bindable(),
    label,
  }: { options: readonly Option[]; value: V; label: string } = $props()

  function onkeydown(e: KeyboardEvent) {
    const i = options.findIndex((o) => o.value === value)
    let next = i
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % options.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + options.length) % options.length
    else return
    e.preventDefault()
    value = options[next].value
    const group = e.currentTarget as HTMLElement
    queueMicrotask(() => group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
  }
</script>

<div class="seg" role="radiogroup" aria-label={label} tabindex="-1" {onkeydown}>
  {#each options as o (o.value)}
    <button
      type="button"
      role="radio"
      aria-checked={o.value === value}
      tabindex={o.value === value ? 0 : -1}
      onclick={() => (value = o.value)}
    >
      {o.label}
      {#if o.count != null}<span class="n num">{o.count}</span>{/if}
    </button>
  {/each}
</div>

<style>
  .seg {
    display: inline-flex;
    height: var(--control-h);
    padding: 2px;
    gap: 2px;
    background: var(--bg-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    flex-shrink: 0;
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0 8px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--fg-muted);
    font-size: var(--fs-xs);
    font-weight: 500;
    white-space: nowrap;
  }
  button:hover {
    color: var(--fg);
  }
  button[aria-checked='true'] {
    background: var(--bg-elevated);
    color: var(--fg);
    box-shadow: 0 0 0 1px var(--border-strong);
  }
  .n {
    color: var(--fg-faint);
    font-size: var(--fs-2xs);
  }
</style>
