<script lang="ts">
  import type { Component } from 'svelte';

  import './lib/design-system.css';
  import Button from './components/Button.svelte';
  import CommandPalette from './components/CommandPalette.svelte';
  import ConnectionGate from './components/ConnectionGate.svelte';
  import EmptyState from './components/EmptyState.svelte';
  import Icon from './components/Icon.svelte';
  import PanelHost from './components/PanelHost.svelte';
  import type { Command } from './components/types.js';
  import { connection, connectionSupported } from './lib/connection.svelte.js';
  import { elementPick } from './lib/element-pick.svelte.js';
  import { errorMessage } from './lib/format.js';
  import {
    groupLabels,
    panelById,
    panelsForView,
    requestedPanelView,
    type PanelGroup,
    type PanelId,
  } from './lib/panels.js';
  import { persisted } from './lib/persisted.svelte.js';
  import { resource } from './lib/resource.svelte.js';
  import { router } from './lib/router.svelte.js';
  import { getProject, onElementPicked } from './lib/rpc.js';
  import { createThemeStore, type ThemeMode } from './lib/theme.svelte.js';

  const theme = createThemeStore();
  const navPref = persisted<'expanded' | 'collapsed' | null>('nav', null);
  const requestedView = requestedPanelView();

  let viewportWidth = $state(window.innerWidth);
  const collapsed = $derived(navPref.value ? navPref.value === 'collapsed' : viewportWidth < 900);

  let paletteOpen = $state(false);

  // Lazy panels: a panel module is fetched on first visit, then kept mounted
  // (hidden) so its filters, selection and scroll survive tab switches.
  let loaded = $state<Partial<Record<PanelId, Component>>>({});
  let loadError = $state<Partial<Record<PanelId, string>>>({});
  let visited = $state<PanelId[]>([]);

  // Fetched on every (re)connect: RPCs fail until the tab is trusted, and a
  // restarted dev server may have added or dropped SvelteKit.
  const project = resource(getProject, {
    initial: null,
    when: () => !connectionSupported || connection.state.status === 'connected',
  });
  // A failed lookup shows every panel rather than hiding any for good.
  const panels = $derived(panelsForView(project.error ? true : project.data?.kit, requestedView));

  // A link or reload to a SvelteKit-only panel in an app without SvelteKit, or to a panel of
  // another workflow in a dock.
  $effect(() => {
    if ((project.data || project.error) && !panels.some(p => p.id === router.current))
      router.replace(panels[0]?.id ?? 'overview');
  });

  // The panel to show: none while a link to a SvelteKit-only panel waits for
  // the project, so an app without SvelteKit never loads or flashes it.
  const shown = $derived(panels.some(p => p.id === router.current) ? router.current : null);

  $effect(() => {
    const id = shown;
    if (!id) return;
    if (!visited.includes(id)) visited.push(id);
    // `load` records failures in `loadError`, so it never rejects.
    if (!loaded[id] && !loadError[id]) void load(id);
    document.title = `${panelById(id).label} · Svelte DevTools`;
  });

  $effect(() =>
    onElementPicked(pick => {
      if (requestedView !== null && requestedView !== 'inspect') return;
      elementPick.set(pick);
      router.go('components');
    }),
  );

  async function load(id: PanelId) {
    try {
      const mod = await panelById(id).load();
      loaded[id] = mod.default;
    } catch (e) {
      loadError[id] = errorMessage(e);
    }
  }

  const groups = $derived(
    (Object.keys(groupLabels) as PanelGroup[])
      .map(g => ({ id: g, label: groupLabels[g], items: panels.filter(p => p.group === g) }))
      .filter(g => g.items.length > 0),
  );

  const themeOrder: ThemeMode[] = ['system', 'light', 'dark'];
  const themeIcon = $derived(
    theme.mode === 'system' ? 'monitor' : theme.mode === 'light' ? 'sun' : 'moon',
  );

  function cycleTheme() {
    theme.set(themeOrder[(themeOrder.indexOf(theme.mode) + 1) % themeOrder.length]!);
  }

  function toggleNav() {
    navPref.value = collapsed ? 'expanded' : 'collapsed';
  }

  const commands = $derived<Command[]>([
    ...panels.map(p => ({
      id: `panel:${p.id}`,
      label: p.label,
      hint: p.description,
      group: groupLabels[p.group],
      icon: p.icon,
      keywords: p.keywords,
      run: () => router.go(p.id),
    })),
    {
      id: 'theme:system',
      label: 'Theme: follow system',
      group: 'Preferences',
      icon: 'monitor',
      run: () => theme.set('system'),
    },
    {
      id: 'theme:light',
      label: 'Theme: light',
      group: 'Preferences',
      icon: 'sun',
      run: () => theme.set('light'),
    },
    {
      id: 'theme:dark',
      label: 'Theme: dark',
      group: 'Preferences',
      icon: 'moon',
      run: () => theme.set('dark'),
    },
    ...(requestedView === null
      ? [
          {
            id: 'nav:toggle',
            label: collapsed ? 'Expand sidebar' : 'Collapse sidebar',
            group: 'Preferences',
            icon: 'sidebar' as const,
            run: toggleNav,
          },
        ]
      : []),
  ]);

  function isTyping(t: EventTarget | null) {
    const el = t as HTMLElement | null;
    return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
  }

  function onkeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      paletteOpen = !paletteOpen;
      return;
    }
    if (paletteOpen || isTyping(e.target)) return;
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const host = document.querySelector('.host:not([hidden])');
      const search = host?.querySelector<HTMLInputElement>('[data-panel-search]');
      if (search) {
        e.preventDefault();
        search.focus();
        search.select();
      }
    } else if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const down = e.key === 'ArrowDown';
      // From a panel that is not listed (yet), ↓ starts at the top, ↑ at the bottom.
      const i = panels.findIndex(p => p.id === shown);
      const from = i === -1 ? (down ? -1 : 0) : i;
      const next = panels[(from + (down ? 1 : -1) + panels.length) % panels.length]!;
      router.go(next.id);
    }
  }
</script>

<svelte:window bind:innerWidth={viewportWidth} {onkeydown} />

<div class="app" class:collapsed class:embedded={requestedView !== null}>
  {#if requestedView === null}
    <nav class="nav" aria-label="Panels">
      <div class="brand">
        <svg class="logo" viewBox="0 0 98.1 118" width="18" height="21" aria-hidden="true">
          <path
            fill="#ff3e00"
            d="M91.8 15.6C80.9-.1 59.2-4.7 43.6 5.2L16.1 22.8C8.6 27.5 3.4 35.2 1.9 43.9c-1.3 7.3-.2 14.8 3.3 21.3-2.4 3.6-4 7.6-4.7 11.8-1.6 8.9.5 18.1 5.7 25.4 11 15.7 32.6 20.3 48.2 10.4l27.5-17.5c7.5-4.7 12.7-12.4 14.2-21.1 1.3-7.3.2-14.8-3.3-21.3 2.4-3.6 4-7.6 4.7-11.8 1.7-9-.4-18.2-5.7-25.5"
          />
          <path
            fill="#fff"
            d="M40.9 103.9c-8.9 2.3-18.2-1.2-23.4-8.7-3.2-4.4-4.4-9.9-3.5-15.3.2-.9.4-1.7.6-2.6l.5-1.6 1.4 1c3.3 2.4 6.9 4.2 10.8 5.4l1 .3-.1 1c-.1 1.4.3 2.9 1.1 4.1 1.6 2.3 4.4 3.4 7.1 2.7.6-.2 1.2-.4 1.7-.7L65.5 72c1.4-.9 2.3-2.2 2.6-3.8.3-1.6-.1-3.3-1-4.6-1.6-2.3-4.4-3.3-7.1-2.6-.6.2-1.2.4-1.7.7l-10.5 6.7c-1.7 1.1-3.6 1.9-5.6 2.4-8.9 2.3-18.2-1.2-23.4-8.7-3.1-4.4-4.4-9.9-3.4-15.3.9-5.2 4.1-9.9 8.6-12.7l27.5-17.5c1.7-1.1 3.6-1.9 5.6-2.5 8.9-2.3 18.2 1.2 23.4 8.7 3.2 4.4 4.4 9.9 3.5 15.3-.2.9-.4 1.7-.7 2.6l-.5 1.6-1.4-1c-3.3-2.4-6.9-4.2-10.8-5.4l-1-.3.1-1c.1-1.4-.3-2.9-1.1-4.1-1.6-2.3-4.4-3.3-7.1-2.6-.6.2-1.2.4-1.7.7L32.4 46.1c-1.4.9-2.3 2.2-2.6 3.8s.1 3.3 1 4.6c1.6 2.3 4.4 3.3 7.1 2.6.6-.2 1.2-.4 1.7-.7l10.5-6.7c1.7-1.1 3.6-1.9 5.6-2.5 8.9-2.3 18.2 1.2 23.4 8.7 3.2 4.4 4.4 9.9 3.5 15.3-.9 5.2-4.1 9.9-8.6 12.7l-27.5 17.5c-1.7 1.1-3.6 1.9-5.6 2.5"
          />
        </svg>
        <span class="brand-name">Svelte <span class="faint">DevTools</span></span>
      </div>

      <button
        class="cmdk"
        type="button"
        onclick={() => (paletteOpen = true)}
        title="Command palette (⌘K)"
      >
        <Icon name="search" size={14} />
        <span class="nav-text grow">Search</span>
        <kbd class="nav-text">⌘K</kbd>
      </button>

      <div class="groups">
        {#each groups as g (g.id)}
          <div class="group" role="group" aria-labelledby="nav-{g.id}">
            <!-- Overview and Problems need no heading; it still names the group. -->
            <span class={['group-label', g.id === 'start' && 'sr-only']} id="nav-{g.id}">
              {g.label}
            </span>
            {#each g.items as p (p.id)}
              <a
                class="item"
                href="#/{p.id}"
                aria-current={shown === p.id ? 'page' : undefined}
                title={collapsed ? p.label : p.description}
              >
                <Icon name={p.icon} size={16} />
                <span class="nav-text truncate">{p.label}</span>
              </a>
            {/each}
          </div>
        {/each}
      </div>

      <div class="foot">
        {#if connectionSupported}
          <span
            class="conn {connection.state.status}"
            role="status"
            title="Dev server: {connection.state.status}{connection.state.host !== 'unknown'
              ? ` (${connection.state.host === 'vite-devtools' ? 'Vite DevTools' : 'standalone'})`
              : ''}"
          >
            <span class="conn-dot" aria-hidden="true"></span>
            <span class="nav-text">{connection.state.status}</span>
          </span>
        {/if}
        <Button
          icon={themeIcon}
          variant="ghost"
          label="Theme: {theme.mode} (click to change)"
          onclick={cycleTheme}
        />
        <Button
          icon="sidebar"
          variant="ghost"
          label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onclick={toggleNav}
        />
      </div>
    </nav>
  {/if}

  <main class="stage">
    {#if requestedView !== null && panels.length > 1}
      <nav class="panel-tabs" aria-label="Workflow tools">
        {#each panels as panel (panel.id)}
          <a
            href="#/{panel.id}"
            aria-current={shown === panel.id ? 'page' : undefined}
            title={panel.description}
          >
            <Icon name={panel.icon} size={14} />
            {panel.label}
          </a>
        {/each}
      </nav>
    {/if}
    <div class="stage-content">
      {#each visited as id (id)}
        {@const Comp = loaded[id]}
        {#if Comp}
          <svelte:boundary>
            <PanelHost component={Comp} active={shown === id} />
            {#snippet failed(error: unknown, reset: () => void)}
              <div class="host" hidden={shown !== id}>
                <EmptyState title="{panelById(id).label} crashed" error={errorMessage(error)}>
                  <Button icon="refresh" onclick={reset}>Reload panel</Button>
                </EmptyState>
              </div>
            {/snippet}
          </svelte:boundary>
        {:else if shown === id}
          <div class="host">
            {#if loadError[id]}
              <EmptyState title="Could not load panel" error={loadError[id]} />
            {:else}
              <div class="loading" aria-busy="true" aria-label="Loading panel"></div>
            {/if}
          </div>
        {/if}
      {/each}
      {#if !shown}
        <div class="host">
          <div class="loading" aria-busy="true" aria-label="Loading panel"></div>
        </div>
      {/if}
    </div>
  </main>
</div>

<CommandPalette bind:open={paletteOpen} {commands} />
<ConnectionGate />

<style>
  .app {
    display: grid;
    grid-template-columns: var(--nav-w) minmax(0, 1fr);
    height: 100vh;
    height: 100dvh;
  }
  .app.collapsed {
    grid-template-columns: var(--nav-w-collapsed) minmax(0, 1fr);
  }
  .app.embedded {
    display: block;
  }

  .nav {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
    padding: 10px 8px 8px;
    background: var(--bg-subtle);
    border-right: 1px solid var(--border);
    overflow: hidden auto;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 26px;
    padding: 0 6px;
    font-weight: 600;
    letter-spacing: -0.01em;
    white-space: nowrap;
  }
  .logo {
    flex-shrink: 0;
  }
  .cmdk {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-elevated);
    color: var(--fg-faint);
    font-size: var(--fs-sm);
    text-align: left;
  }
  .cmdk:hover {
    border-color: var(--border-strong);
    color: var(--fg-muted);
  }
  .cmdk .grow {
    flex: 1;
  }
  .cmdk kbd {
    font-size: var(--fs-2xs);
    color: var(--fg-faint);
  }
  .groups {
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex: 1;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .group-label {
    padding: 4px 8px 3px;
    font-size: var(--fs-2xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-faint);
    white-space: nowrap;
  }
  .item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 28px;
    padding: 0 8px;
    border-radius: var(--radius);
    color: var(--fg-muted);
    text-decoration: none;
    font-size: var(--fs-sm);
    font-weight: 500;
    transition:
      background var(--dur-fast) var(--ease),
      color var(--dur-fast) var(--ease);
  }
  .item:hover {
    background: var(--bg-hover);
    color: var(--fg);
  }
  .item[aria-current='page'] {
    background: var(--bg-active);
    color: var(--fg);
  }
  .item[aria-current='page'] :global(.icon) {
    color: var(--accent-fg);
  }
  .item[aria-current='page']::before {
    content: '';
    position: absolute;
    left: -8px;
    top: 7px;
    bottom: 7px;
    width: 2px;
    border-radius: 0 2px 2px 0;
    background: var(--accent);
  }
  .conn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-right: auto;
    padding: 0 6px;
    font-size: var(--fs-xs);
    color: var(--fg-faint);
    text-transform: capitalize;
  }
  .conn-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--yellow);
  }
  .conn.connected .conn-dot {
    background: var(--green);
  }
  .conn.disconnected .conn-dot,
  .conn.error .conn-dot,
  .conn.unauthorized .conn-dot {
    background: var(--red);
  }
  .collapsed .conn {
    margin: 0 0 4px;
    padding: 6px 0;
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 2px;
    padding-top: 6px;
    border-top: 1px solid var(--border);
  }

  .collapsed .nav-text,
  .collapsed .brand-name,
  .collapsed .group-label {
    display: none;
  }
  .collapsed .brand,
  .collapsed .item,
  .collapsed .cmdk {
    justify-content: center;
    padding: 0;
  }
  .collapsed .group {
    padding-top: 6px;
    border-top: 1px solid var(--border);
  }
  .collapsed .group:first-child {
    border-top: 0;
    padding-top: 0;
  }
  .collapsed .foot {
    flex-direction: column;
    align-items: center;
  }

  .stage {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    position: relative;
    height: 100%;
  }
  .panel-tabs {
    display: flex;
    flex: none;
    gap: 2px;
    min-width: 0;
    height: 40px;
    padding: 0 12px;
    border-bottom: 1px solid var(--border);
    overflow: auto hidden;
  }
  .panel-tabs a {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    color: var(--fg-muted);
    font-size: var(--fs-sm);
    font-weight: 500;
    text-decoration: none;
    white-space: nowrap;
  }
  .panel-tabs a:hover {
    color: var(--fg);
  }
  .panel-tabs a[aria-current='page'] {
    color: var(--fg);
  }
  .panel-tabs a[aria-current='page'] :global(.icon) {
    color: var(--accent-fg);
  }
  .panel-tabs a[aria-current='page']::after {
    content: '';
    position: absolute;
    right: 8px;
    bottom: 0;
    left: 8px;
    height: 2px;
    border-radius: 2px 2px 0 0;
    background: var(--accent);
  }
  .stage-content {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }
  .stage-content :global(.host) {
    height: 100%;
    min-height: 0;
  }
  .stage-content :global(.host[hidden]) {
    display: none;
  }
  /* transform-only animation: runs on the compositor, not on the main
     thread the app shares with the dock */
  .loading {
    height: 2px;
    overflow: hidden;
  }
  .loading::before {
    content: '';
    display: block;
    width: 40%;
    height: 100%;
    background: linear-gradient(90deg, transparent, var(--accent), transparent);
    animation: slide 1s linear infinite;
  }
  @keyframes slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(250%);
    }
  }
</style>
