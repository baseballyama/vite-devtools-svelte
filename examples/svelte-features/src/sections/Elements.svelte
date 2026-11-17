<script lang="ts">
  import Frame from '../components/Frame.svelte';

  let tag = $state<'h3' | 'p' | 'blockquote'>('p');
  let width = $state(0);
  let visible = $state(true);
  let keys = $state(0);
</script>

<svelte:window bind:innerWidth={width} onkeydown={() => keys++} />
<svelte:document onvisibilitychange={() => (visible = document.visibilityState === 'visible')} />

{#snippet row(label: string, value: unknown)}
  <tr><th>{label}</th><td>{String(value)}</td></tr>
{/snippet}

{#snippet badge(text: string)}
  <mark>{text}</mark>
{/snippet}

<h2>Snippets & special elements</h2>

<table>
  <tbody>
    {@render row('window.innerWidth', width)}
    {@render row('keydowns', keys)}
    {@render row('document visible', visible)}
  </tbody>
</table>

<Frame title="children + snippet props" {badge}>
  <p>This paragraph is the <code>children</code> snippet of Frame.</p>
  {#snippet footer(count: number)}
    footer snippet, Frame clicked {count} times
  {/snippet}
</Frame>

<h3>&lt;svelte:element&gt;</h3>
<select data-testid="element-tag" bind:value={tag}>
  <option>h3</option>
  <option>p</option>
  <option>blockquote</option>
</select>
<svelte:element this={tag}>rendered as &lt;{tag}&gt;</svelte:element>

{#snippet passed(n: number)}
  <strong>snippet rendered by a child with n = {n}</strong>
{/snippet}
<Frame title="snippet passed down">
  {@render passed(42)}
</Frame>
