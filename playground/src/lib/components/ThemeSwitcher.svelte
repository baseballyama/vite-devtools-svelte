<script lang="ts">
  type Theme = 'dark' | 'light' | 'auto'

  let theme = $state<Theme>('dark')
  let fontSize = $state(14)
  let showPreview = $state(true)

  let effectiveTheme = $derived(
    theme === 'auto'
      ? (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : theme
  )

  let previewBg = $derived(effectiveTheme === 'light' ? '#f5f5f5' : '#1a1a2e')
  let previewFg = $derived(effectiveTheme === 'light' ? '#333' : '#e0e0e0')

  let settingsSummary = $derived.by(() => {
    const parts = [`Theme: ${effectiveTheme}`, `Font: ${fontSize}px`]
    if (!showPreview) parts.push('Preview hidden')
    return parts.join(' | ')
  })

  let changeCount = $state(0)

  $effect(() => {
    // Track setting changes (read the dependencies)
    void theme; void fontSize; void showPreview
    // Use queueMicrotask to write state outside the effect's tracking scope
    queueMicrotask(() => { changeCount++ })
  })
</script>

<div class="switcher">
  <h3>Settings</h3>
  <div class="setting">
    <span class="label">Theme</span>
    <div class="btn-group">
      {#each ['dark', 'light', 'auto'] as t}
        <button class:active={theme === t} onclick={() => theme = t as Theme}>{t}</button>
      {/each}
    </div>
  </div>
  <div class="setting">
    <span class="label">Font Size ({fontSize}px)</span>
    <input type="range" min="10" max="24" bind:value={fontSize} />
  </div>
  <div class="setting">
    <span class="label">Preview</span>
    <label class="toggle">
      <input type="checkbox" bind:checked={showPreview} />
      {showPreview ? 'Visible' : 'Hidden'}
    </label>
  </div>
  {#if showPreview}
    <div class="preview" style="background: {previewBg}; color: {previewFg}; font-size: {fontSize}px;">
      The quick brown fox jumps over the lazy dog.
    </div>
  {/if}
  <div class="summary">{settingsSummary} (changes: {changeCount})</div>
</div>

<style>
  .switcher {
    background: #1e1e3a; border: 1px solid #2a2a4a; border-radius: 8px; padding: 16px;
  }
  h3 { color: #ff3e00; margin-bottom: 12px; }
  .setting {
    display: flex; align-items: center; justify-content: space-between;
    padding: 6px 0; border-bottom: 1px solid #2a2a4a;
  }
  .label { font-size: 13px; color: #ccc; }
  .btn-group { display: flex; gap: 2px; }
  .btn-group button {
    background: #2a2a4a; color: #aaa; border: none; border-radius: 4px;
    padding: 4px 10px; font-size: 11px; cursor: pointer; text-transform: capitalize;
  }
  .btn-group button.active { background: #ff3e00; color: white; }
  input[type='range'] { accent-color: #ff3e00; width: 100px; }
  .toggle {
    font-size: 12px; color: #888; display: flex; align-items: center; gap: 6px; cursor: pointer;
  }
  .preview {
    margin-top: 10px; padding: 12px; border-radius: 4px; border: 1px solid #2a2a4a;
    transition: all 0.3s;
  }
  .summary {
    margin-top: 8px; font-size: 10px; color: #555; font-family: monospace;
  }
</style>
