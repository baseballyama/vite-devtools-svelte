<script lang="ts">
  import { getProject } from '../lib/rpc.js'
  import type { ProjectInfo } from '../lib/types.js'
  import Card from '../components/Card.svelte'
  import PanelContainer from '../components/PanelContainer.svelte'

  let project = $state<ProjectInfo | null>(null)
  let error = $state<string | null>(null)
  let loading = $state(true)

  async function load() {
    try {
      loading = true
      project = await getProject()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load project info'
    } finally {
      loading = false
    }
  }

  load()

  function formatDeps(deps: Record<string, string>): { name: string; version: string }[] {
    return Object.entries(deps)
      .map(([name, version]) => ({ name, version }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }
</script>

<PanelContainer>
  <h2 class="page-title">Overview</h2>

  {#if loading}
    <p class="status-text">Loading...</p>
  {:else if error}
    <p class="status-text error">{error}</p>
  {:else if project}
    <div class="info-grid">
      <Card title="Project">
        <dl class="info-dl">
          <div class="dl-row">
            <dt>Name</dt>
            <dd>{project.name}</dd>
          </div>
          <div class="dl-row">
            <dt>Version</dt>
            <dd class="font-mono">{project.version}</dd>
          </div>
        </dl>
      </Card>

      <Card title="Framework">
        <dl class="info-dl">
          <div class="dl-row">
            <dt>Svelte</dt>
            <dd class="version">{project.svelteVersion}</dd>
          </div>
          <div class="dl-row">
            <dt>SvelteKit</dt>
            <dd class="version">{project.sveltekitVersion}</dd>
          </div>
          <div class="dl-row">
            <dt>Vite</dt>
            <dd class="version">{project.viteVersion}</dd>
          </div>
        </dl>
      </Card>
    </div>

    {#if Object.keys(project.dependencies).length > 0}
      <Card title="Dependencies ({Object.keys(project.dependencies).length})">
        <div class="dep-table">
          {#each formatDeps(project.dependencies) as dep}
            <div class="dep-row">
              <span class="dep-name">{dep.name}</span>
              <span class="dep-version">{dep.version}</span>
            </div>
          {/each}
        </div>
      </Card>
    {/if}

    <Card title="Dev Dependencies ({Object.keys(project.devDependencies).length})">
      <div class="dep-table">
        {#each formatDeps(project.devDependencies) as dep}
          <div class="dep-row">
            <span class="dep-name">{dep.name}</span>
            <span class="dep-version">{dep.version}</span>
          </div>
        {/each}
      </div>
    </Card>
  {/if}
</PanelContainer>

<style>
  .page-title {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--color-text);
  }

  .status-text {
    color: var(--color-text-muted);
    padding: var(--space-4);
  }
  .status-text.error { color: var(--color-error); }

  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
  }

  .info-dl {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .dl-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 2px 0;
  }

  dt { color: var(--color-text-muted); font-size: var(--text-sm); }
  dd { color: var(--color-text); font-size: var(--text-sm); }
  .version { font-family: var(--font-mono); color: var(--color-success); }

  .dep-table {
    max-height: 300px;
    overflow-y: auto;
  }

  .dep-row {
    display: flex;
    justify-content: space-between;
    padding: var(--space-1-5) 0;
    border-bottom: 1px dashed var(--color-border);
    font-size: var(--text-sm);
  }

  .dep-row:last-child { border-bottom: none; }
  .dep-name { color: var(--color-text); }
  .dep-version { color: var(--color-text-muted); font-family: var(--font-mono); font-size: var(--text-xs); }
</style>
