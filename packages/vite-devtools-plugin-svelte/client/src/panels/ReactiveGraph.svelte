<script lang="ts">
  import { onMount } from 'svelte'
  import type { ReactiveNode, ReactiveGraph as ReactiveGraphType } from '../lib/types.js'
  import { getReactiveGraph, openReactiveInEditor } from '../lib/rpc.js'
  import PanelContainer from '../components/PanelContainer.svelte'
  import Card from '../components/Card.svelte'
  import Badge from '../components/Badge.svelte'
  import ActionButton from '../components/ActionButton.svelte'
  import GraphView from '../components/GraphView.svelte'

  let graph = $state<ReactiveGraphType>({ nodes: [], edges: [] })
  let selectedNode = $state<ReactiveNode | null>(null)
  let pollTimer: ReturnType<typeof setInterval> | null = null

  // Track previous node values to detect changes
  let prevValues = $state(new Map<string, unknown>())
  let changedNodeIds = $state(new Set<string>())

  async function refresh() {
    try {
      const newGraph = await getReactiveGraph()
      // Detect which nodes changed value since last poll
      const changed = new Set<string>()
      for (const node of newGraph.nodes) {
        if (node.value !== undefined) {
          const prev = prevValues.get(node.id)
          if (prev !== undefined && prev !== node.value) {
            changed.add(node.id)
          }
        }
      }

      // Update prev values snapshot
      const newPrev = new Map<string, unknown>()
      for (const node of newGraph.nodes) {
        if (node.value !== undefined) {
          newPrev.set(node.id, node.value)
        }
      }
      prevValues = newPrev
      changedNodeIds = changed
      graph = newGraph
    } catch {
      // If RPC not available, graph stays empty
    }
  }

  function handleSelectNode(node: ReactiveNode | null) {
    selectedNode = node
  }

  // Compute connected edges for selected node
  const connectedEdges = $derived.by(() => {
    if (!selectedNode) return { deps: [] as string[], dependents: [] as string[] }
    const deps: string[] = []
    const dependents: string[] = []
    for (const edge of graph.edges) {
      if (edge.to === selectedNode.id) deps.push(edge.from)
      if (edge.from === selectedNode.id) dependents.push(edge.to)
    }
    return { deps, dependents }
  })

  const nodeMap = $derived(new Map(graph.nodes.map(n => [n.id, n])))

  async function handleOpenReactive(file: string, name: string, type: string) {
    try { await openReactiveInEditor(file, name, type) } catch { /* ignore */ }
  }

  onMount(() => {
    refresh()
    pollTimer = setInterval(refresh, 1000)
    return () => {
      if (pollTimer) clearInterval(pollTimer)
    }
  })
</script>

<PanelContainer>
  <div class="header">
    <h2>Reactive Graph</h2>
    <div class="actions">
      <div class="legend">
        <span class="legend-item state">State</span>
        <span class="legend-item derived">Derived</span>
        <span class="legend-item effect">Effect</span>
      </div>
      <ActionButton onclick={refresh}>Refresh</ActionButton>
    </div>
  </div>

  <div class="graph-layout">
    <div class="graph-area">
      <GraphView
        nodes={graph.nodes}
        edges={graph.edges}
        onSelectNode={handleSelectNode}
        {changedNodeIds}
      />
    </div>

    {#if selectedNode}
      <div class="detail-sidebar">
        <Card title={selectedNode.name}>
          <div class="detail-row">
            <span class="detail-label">Type</span>
            <Badge variant={selectedNode.type === 'state' ? 'info' : selectedNode.type === 'derived' ? 'success' : 'error'}>
              {selectedNode.type}
            </Badge>
          </div>

          {#if selectedNode.value !== undefined}
            <div class="detail-row">
              <span class="detail-label">Value</span>
              <code class="detail-value">{String(selectedNode.value)}</code>
            </div>
          {/if}

          <div class="detail-row">
            <span class="detail-label">Component</span>
            <button class="detail-file-link" onclick={() => handleOpenReactive(selectedNode!.componentFile, selectedNode!.name, selectedNode!.type)}>
              {selectedNode.componentFile.split('/').pop()?.replace('.svelte', '') || '?'} : {selectedNode.name}
            </button>
          </div>

          {#if connectedEdges.deps.length > 0}
            <div class="detail-section">
              <span class="detail-label">Dependencies ({connectedEdges.deps.length})</span>
              <ul class="dep-list">
                {#each connectedEdges.deps as depId}
                  {@const depNode = nodeMap.get(depId)}
                  {#if depNode}
                    <li>
                      <button class="dep-link" onclick={() => handleOpenReactive(depNode.componentFile, depNode.name, depNode.type)}>{depNode.name}</button>
                      <Badge variant="neutral">{depNode.type}</Badge>
                    </li>
                  {/if}
                {/each}
              </ul>
            </div>
          {/if}

          {#if connectedEdges.dependents.length > 0}
            <div class="detail-section">
              <span class="detail-label">Dependents ({connectedEdges.dependents.length})</span>
              <ul class="dep-list">
                {#each connectedEdges.dependents as depId}
                  {@const depNode = nodeMap.get(depId)}
                  {#if depNode}
                    <li>
                      <button class="dep-link" onclick={() => handleOpenReactive(depNode.componentFile, depNode.name, depNode.type)}>{depNode.name}</button>
                      <Badge variant="neutral">{depNode.type}</Badge>
                    </li>
                  {/if}
                {/each}
              </ul>
            </div>
          {/if}
        </Card>
      </div>
    {/if}
  </div>
</PanelContainer>

<style>
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-3);
  }

  h2 {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--color-text);
    margin: 0;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .legend {
    display: flex;
    gap: var(--space-2);
    font-size: var(--text-xs);
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--color-text-muted);
  }

  .legend-item::before {
    content: '';
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .legend-item.state::before { background: var(--color-info); }
  .legend-item.derived::before { background: var(--color-success); }
  .legend-item.effect::before { background: var(--color-error); }

  .graph-layout {
    display: flex;
    gap: var(--space-3);
    flex: 1;
    min-height: 300px;
  }

  .graph-area {
    flex: 1;
    display: flex;
  }

  .detail-sidebar {
    width: 260px;
    flex-shrink: 0;
  }

  .detail-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-1) 0;
    gap: var(--space-2);
  }

  .detail-label {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-weight: 500;
  }

  .detail-value {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text);
    background: var(--color-surface-active);
    padding: 1px 6px;
    border-radius: var(--radius-sm);
  }

  .detail-file-link {
    font-size: var(--text-xs);
    color: var(--color-accent-400);
    background: none;
    border: none;
    cursor: pointer;
    font-family: var(--font-mono);
    padding: 0;
    text-decoration: underline;
    text-decoration-style: dotted;
  }

  .detail-file-link:hover {
    color: var(--color-accent-300);
  }

  .detail-section {
    padding: var(--space-2) 0 0;
    border-top: 1px dashed var(--color-border);
    margin-top: var(--space-2);
  }

  .dep-list {
    list-style: none;
    padding: 0;
    margin: var(--space-1) 0 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-xs);
    color: var(--color-text);
  }

  .dep-list li {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .dep-link {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-accent-400);
    font-size: var(--text-xs);
    font-family: var(--font-sans);
    padding: 0;
    text-decoration: underline;
    text-decoration-style: dotted;
  }

  .dep-link:hover {
    color: var(--color-accent-300);
  }
</style>
