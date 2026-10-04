// Generated from the `mcp-examples` artifact of CI run 37204003993 by
// scripts/screenshots/mcp-examples.mjs. Real answers; arrays longer than 4
// are cut (marked `shortened`). Do not edit by hand.

export interface McpExample {
  id: string
  tool: string
  arguments: Record<string, unknown>
  response: unknown
  shortened?: boolean
}

export const MCP_EXAMPLES_SOURCE =
  'Recorded by scripts/screenshots/mcp-examples.mjs in CI run 37204003993 (linux x64, Node v22.23.3) at commit 533928b (the PR #85 merge ref), with the 0.4.0 code before the version bump (package version 0.3.0 at capture), on examples/sample-app, a synthetic demo app. Absolute paths are shown as <project> / <repo>, and arrays longer than 4 are cut where marked; no value was changed.'

export const MCP_EXAMPLES: McpExample[] = [
  {
    id: 'summary',
    tool: 'get_reactive_summary',
    arguments: {
      topK: 5,
      windowMs: 30000,
    },
    response: {
      epoch: 'yotxdjn137mutu4dc2',
      window: {
        ms: 30000,
        since: 1791119166841,
        until: 1791119196841,
        sampledActiveMs: 5000,
      },
      policy: 'sampled-200ms',
      coverage: 'component-init',
      components: {
        total: 5,
        withActivity: 2,
      },
      rows: [
        {
          componentId: 0,
          file: '<project>/.svelte-kit/generated/root.svelte',
          nodes: {
            state: 3,
            derived: 2,
            effect: 2,
          },
          changes: 2,
          renders: 1,
          renderMs: 0,
        },
        {
          componentId: 2,
          file: '<project>/src/lib/components/Header.svelte',
          nodes: {
            state: 0,
            derived: 0,
            effect: 0,
          },
          changes: 0,
          renders: 2,
          renderMs: 0.1,
        },
      ],
      other: {
        components: 3,
        nodes: 8,
      },
      truncated: false,
      capabilities: {
        valueInspection: false,
        signalHistory: false,
        writeCause: false,
      },
      baseline: {
        complete: true,
        pendingNodes: 0,
      },
    },
  },
  {
    id: 'live',
    tool: 'get_live_components',
    arguments: {
      includeMeta: true,
      limit: 50,
    },
    response: {
      epoch: 'yotxdjn137mutu4dc2',
      total: 5,
      captured: 5,
      truncated: false,
      components: [
        {
          id: 0,
          file: '<project>/.svelte-kit/generated/root.svelte',
          name: 'root',
          parentId: null,
          mounted: true,
        },
        {
          id: 1,
          file: '<project>/src/routes/+layout.svelte',
          name: '+layout',
          parentId: 0,
          mounted: true,
        },
        {
          id: 2,
          file: '<project>/src/lib/components/Header.svelte',
          name: 'Header',
          parentId: 1,
          mounted: true,
        },
        {
          id: 13,
          file: '<project>/src/routes/cart/+page.svelte',
          name: '+page',
          parentId: 1,
          mounted: true,
        },
        '… 1 more',
      ],
    },
    shortened: true,
  },
  {
    id: 'scope',
    tool: 'get_reactive_scope',
    arguments: {
      componentId: 14,
      epoch: 'yotxdjn137mutu4dc2',
    },
    response: {
      nodes: [
        {
          id: '14:taxRate',
          type: 'state',
          name: 'taxRate',
          componentId: 14,
          componentFile: '<project>/src/lib/components/ReactivePriceChart.svelte',
          value: 0.1,
        },
        {
          id: '14:tax',
          type: 'derived',
          name: 'tax',
          componentId: 14,
          componentFile: '<project>/src/lib/components/ReactivePriceChart.svelte',
          value: 180,
        },
        {
          id: '14:shippingFreeThreshold',
          type: 'state',
          name: 'shippingFreeThreshold',
          componentId: 14,
          componentFile: '<project>/src/lib/components/ReactivePriceChart.svelte',
          value: 5000,
        },
        {
          id: '14:remaining',
          type: 'derived',
          name: 'remaining',
          componentId: 14,
          componentFile: '<project>/src/lib/components/ReactivePriceChart.svelte',
          value: 3200,
        },
        '… 4 more',
      ],
      edges: [
        {
          from: '14:taxRate',
          to: '14:tax',
        },
        {
          from: '14:shippingFreeThreshold',
          to: '14:remaining',
        },
        {
          from: '14:shippingFreeThreshold',
          to: '14:shipping',
        },
        {
          from: '14:subtotal',
          to: '14:remaining',
        },
        '… 5 more',
      ],
      scope: 14,
      epoch: 'yotxdjn137mutu4dc2',
      total: {
        nodes: 8,
        nodesKind: 'registered',
        edges: 9,
      },
      truncated: false,
      edgesOmitted: 0,
      computedAt: 1791119196854,
      policy: 'scoped',
    },
    shortened: true,
  },
  {
    id: 'timeline-first',
    tool: 'get_state_timeline',
    arguments: {
      limit: 5,
    },
    response: {
      cursor: 1791119189716031,
      reset: true,
      changes: [
        {
          id: '4:running',
          name: 'running',
          componentFile: '<project>/src/lib/components/FpsCanvas.svelte',
          oldValue: true,
          newValue: false,
          timestamp: 1791119192900,
          seq: 1791119189716016,
        },
        {
          id: '4:running',
          name: 'running',
          componentFile: '<project>/src/lib/components/FpsCanvas.svelte',
          oldValue: false,
          newValue: true,
          timestamp: 1791119194095,
          seq: 1791119189716021,
        },
        {
          id: '0:navigated',
          name: 'navigated',
          componentFile: '<project>/.svelte-kit/generated/root.svelte',
          oldValue: false,
          newValue: true,
          timestamp: 1791119195295,
          seq: 1791119189716030,
        },
        {
          id: '0:title',
          name: 'title',
          componentFile: '<project>/.svelte-kit/generated/root.svelte',
          oldValue: null,
          newValue: 'devtools-shop — vite-devtools-svelte sample',
          timestamp: 1791119195295,
          seq: 1791119189716031,
        },
      ],
      omitted: 0,
      maxValueChars: 2048,
    },
  },
  {
    id: 'timeline-next',
    tool: 'get_state_timeline',
    arguments: {
      since: 1791119189716031,
      limit: 5,
    },
    response: {
      cursor: 1791119189716039,
      reset: false,
      changes: [
        {
          id: '14:taxRate',
          name: 'taxRate',
          componentFile: '<project>/src/lib/components/ReactivePriceChart.svelte',
          oldValue: 0.1,
          newValue: 0.08,
          timestamp: 1791119196895,
          seq: 1791119189716039,
        },
      ],
      omitted: 0,
      maxValueChars: 2048,
    },
  },
  {
    id: 'capture',
    tool: 'get_capture_info',
    arguments: {},
    response: {
      liveComponents: {
        captured: 5,
        total: 5,
        truncated: false,
        policy: 'roots-first',
        epoch: 'yotxdjn137mutu4dc2',
      },
      renderProfiles: {
        captured: 5,
        total: 5,
        truncated: false,
        policy: 'newest-mounted',
        epoch: 'yotxdjn137mutu4dc2',
      },
      stateTimeline: {
        captured: 5,
        total: null,
        truncated: false,
        policy: 'sampled-200ms',
        baseline: {
          complete: true,
          pendingNodes: 0,
        },
      },
      fpsSamples: {
        captured: 12,
        total: 12,
        truncated: false,
        policy: 'tail',
      },
      runtimeErrors: {
        captured: 0,
        total: 0,
        truncated: false,
        policy: 'tail',
      },
      loadProfiles: {
        captured: 1,
        total: 1,
        truncated: false,
        policy: 'tail',
      },
      compilerWarnings: {
        captured: 0,
        total: 0,
        truncated: false,
        policy: 'tail',
      },
      reactiveNodes: {
        captured: 8,
        total: 8,
        truncated: false,
        policy: 'scoped',
        epoch: 'yotxdjn137mutu4dc2',
      },
      reactiveEdges: {
        captured: 9,
        total: 9,
        truncated: false,
        policy: 'scoped',
        epoch: 'yotxdjn137mutu4dc2',
      },
    },
  },
  {
    id: 'stale',
    tool: 'get_reactive_scope',
    arguments: {
      componentId: 14,
      epoch: 'yotxdjn137mutu4dc2',
    },
    response: {
      nodes: [],
      edges: [],
      scope: 14,
      epoch: 'mv4a1o7rqhmutu4koh',
      total: null,
      truncated: false,
      edgesOmitted: 0,
      computedAt: null,
      policy: 'scoped',
      stale: true,
      staleReason: 'epoch-changed',
    },
  },
  {
    id: 'session-start',
    tool: 'start_session',
    arguments: {
      label: 'before',
    },
    response: {
      id: 's_mutu4ia1_b33526',
      label: 'before',
      startedAt: 1791119198089,
      persist: false,
    },
  },
  {
    id: 'session-compare',
    tool: 'compare_sessions',
    arguments: {
      a: 's_mutu4ia1_b33526',
      b: 's_mutu4jfy_6d6dd6',
    },
    response: {
      a: {
        id: 's_mutu4ia1_b33526',
        label: 'before',
      },
      b: {
        id: 's_mutu4jfy_6d6dd6',
        label: 'after',
      },
      render: {
        totalRenderTimeDeltaA: 0,
        totalRenderTimeDeltaB: 0,
        diff: 0,
        verdict: 'unchanged',
      },
      load: {
        avgA: 0,
        avgB: 0,
        diff: 0,
        verdict: 'unchanged',
      },
      fps: {
        avgA: 60,
        avgB: 60,
        diff: 0,
        verdict: 'unchanged',
      },
    },
  },
]
