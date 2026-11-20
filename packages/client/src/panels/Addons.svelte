<script lang="ts">
  import Badge from '../components/Badge.svelte';
  import Button from '../components/Button.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import Icon from '../components/Icon.svelte';
  import Panel from '../components/Panel.svelte';
  import SearchField from '../components/SearchField.svelte';
  import { addonLogo } from '../lib/addon-logos.js';
  import { showTerminals } from '../lib/devtools-dock.js';
  import { errorMessage } from '../lib/format.js';
  import { matcher } from '../lib/match.js';
  import { resource } from '../lib/resource.svelte.js';
  import { getAddons, getCommunityAddons, getProject, installAddon } from '../lib/rpc.js';

  const MONO_LOGOS = new Set(['drizzle', 'paraglide', 'better-auth']);
  const compact = new Intl.NumberFormat('en', { notation: 'compact' });

  const addons = resource(getAddons, { initial: null });
  const community = resource(getCommunityAddons, { initial: null });
  const project = resource(getProject, { initial: null });

  let query = $state('');
  let running = $state<string | null>(null);
  let error = $state<string | null>(null);

  const match = $derived(matcher(query));
  const official = $derived(
    (addons.data?.addons ?? []).filter(a => !match || match(a.id, a.name, a.description)),
  );
  const communityShown = $derived(
    (community.data?.addons ?? []).filter(a => !match || match(a.name, a.description)),
  );

  async function install(id: string) {
    running = id;
    error = null;
    try {
      const { sessionId } = await installAddon(id);
      await showTerminals(sessionId);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      running = null;
    }
  }
</script>

{#snippet installButton(id: string, installed: boolean, disabledReason?: string)}
  <Button
    icon="plus"
    variant={installed ? 'default' : 'primary'}
    disabled={running !== null || !!disabledReason}
    title={disabledReason}
    onclick={() => install(id)}
  >
    {running === id ? 'Starting…' : installed ? 'Reinstall' : 'Install'}
  </Button>
{/snippet}

<Panel title="Add" scroll>
  {#snippet toolbar()}
    <SearchField
      bind:value={query}
      placeholder="Search add-ons…"
      count={query ? official.length + communityShown.length : null}
    />
  {/snippet}
  {#snippet actions()}
    <Button
      icon="refresh"
      variant="ghost"
      label="Refresh add-ons"
      disabled={addons.busy || community.busy}
      onclick={() => {
        void addons.refresh();
        void community.refresh();
      }}
    />
  {/snippet}
  {#if addons.error}
    <EmptyState title="Could not list add-ons" error={addons.error} />
  {:else if addons.data && !addons.data.available}
    <EmptyState icon="plus" title="No terminal in this dock">
      <p>Installing add-ons runs <code>sv add</code> in the Vite DevTools terminal.</p>
    </EmptyState>
  {:else if addons.data}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <section class="section" aria-labelledby="addons-official">
      <h2 class="section-title" id="addons-official">
        Official <span class="num">{official.length}</span>
      </h2>
      <ul class="grid">
        {#each official as addon (addon.id)}
          <li class="card" class:installed={addon.installed}>
            <div class="head">
              <img
                class="logo"
                class:mono={MONO_LOGOS.has(addon.id)}
                src={addonLogo(addon.id)}
                alt=""
                width="32"
                height="32"
              />
              <div class="title">
                <span class="name">{addon.name}</span>
                <span class="desc">{addon.description}</span>
              </div>
            </div>
            <div class="badges">
              {#if addon.installed}
                <Badge tone="green" title="Found in package.json">installed</Badge>
              {/if}
              {#if addon.kit}<Badge tone="neutral">SvelteKit</Badge>{/if}
            </div>
            <div class="foot">
              <code class="cmd">sv add {addon.id}</code>
              {@render installButton(
                addon.id,
                addon.installed,
                addon.kit && project.data?.kit === false ? 'Requires SvelteKit' : undefined,
              )}
            </div>
          </li>
        {/each}
      </ul>
    </section>

    <section class="section" aria-labelledby="addons-community">
      <h2 class="section-title" id="addons-community">
        Community <span class="num">{communityShown.length}</span>
        <Badge tone="yellow">experimental</Badge>
      </h2>
      <p class="note">
        npm packages with the <code>sv-add</code> keyword. Svelte maintainers have not reviewed them:
        use at your discretion.
      </p>
      {#if community.error || community.data?.error}
        <EmptyState title="Could not reach npm" error={community.error ?? community.data?.error} />
      {:else if !community.data}
        <p class="note">Searching npm…</p>
      {:else}
        <ul class="grid">
          {#each communityShown as addon (addon.name)}
            <li class="card" class:installed={addon.installed}>
              <div class="head">
                <img
                  class="logo avatar"
                  src={addon.avatar ?? addonLogo('svelte')}
                  alt=""
                  width="32"
                  height="32"
                  loading="lazy"
                />
                <div class="title">
                  <span class="name">{addon.name}</span>
                  <span class="desc clamp" title={addon.description}>{addon.description}</span>
                </div>
              </div>
              <div class="badges">
                {#if addon.installed}
                  <Badge tone="green" title="Found in package.json">installed</Badge>
                {/if}
                <span class="meta" title="Downloads in the last 30 days">
                  {compact.format(addon.downloads)}/month · v{addon.version}
                </span>
                <a class="npm" href={addon.url} target="_blank" rel="noopener noreferrer">
                  npmx <Icon name="external" size={11} />
                </a>
              </div>
              <div class="foot">
                <code class="cmd" title="sv add {addon.name}">sv add {addon.name}</code>
                {@render installButton(addon.name, addon.installed)}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</Panel>

<style>
  .section {
    padding: 16px 16px 0;
  }
  .section-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 10px;
    font-size: var(--fs-md);
    font-weight: 600;
    color: var(--fg);
  }
  .num {
    color: var(--fg-faint);
    font-weight: 400;
  }
  .note {
    margin: 0 0 12px;
    font-size: var(--fs-sm);
    color: var(--fg-muted);
  }
  .grid {
    list-style: none;
    margin: 0;
    padding: 0 0 16px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 12px;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-subtle);
    transition: border-color var(--dur) var(--ease);
  }
  .card:hover {
    border-color: var(--border-strong);
  }
  .card.installed {
    border-color: color-mix(in srgb, var(--green) 35%, transparent);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .logo {
    width: 32px;
    height: 32px;
    object-fit: contain;
    flex-shrink: 0;
  }
  /* Black-only logos */
  :global(:root[data-theme='dark']) .logo.mono {
    filter: invert(1);
  }
  .avatar {
    border-radius: var(--radius);
  }
  .title {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .name {
    font-size: var(--fs-lg);
    font-weight: 600;
    color: var(--fg);
    overflow-wrap: anywhere;
  }
  .desc {
    font-size: var(--fs-sm);
    color: var(--fg-muted);
  }
  .clamp {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }
  .badges {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 17px;
  }
  .meta {
    font-size: var(--fs-xs);
    color: var(--fg-faint);
    font-variant-numeric: tabular-nums;
  }
  .npm {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    margin-left: auto;
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: auto;
  }
  .cmd {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--fg-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .error {
    margin: 16px 16px 0;
    padding: 6px 10px;
    border-radius: var(--radius);
    background: var(--red-bg);
    color: var(--red);
    font-size: var(--fs-sm);
  }
</style>
