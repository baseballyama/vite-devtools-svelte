<script lang="ts">
  import Badge from '../../components/Badge.svelte'
  import type { Tone } from '../../components/types.js'
  import { kindLabel } from '../../lib/reactive.js'
  import type { ReactiveNode } from '../../lib/types.js'

  /** Signal kind badge: `state` / `derived` / `effect` / `markup` (`$`-prefixed when `rune`). */
  let { type, rune = false }: { type: ReactiveNode['type']; rune?: boolean } = $props()

  const tones: Record<ReactiveNode['type'], Tone> = {
    state: 'blue',
    derived: 'green',
    effect: 'red',
    template: 'purple',
  }
</script>

<Badge tone={tones[type]}>{rune || type === 'template' ? kindLabel(type) : type}</Badge>
