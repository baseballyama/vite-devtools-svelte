<script lang="ts">
  import '../app.css'
  import Footer from '#lib/Footer.svelte'
  import Header from '#lib/Header.svelte'

  import type { LayoutProps } from './$types'

  let { children }: LayoutProps = $props()
</script>

<a class="skip" href="#main">Skip to content</a>
<div class="frame">
  <Header />
  <main id="main">
    {@render children()}
  </main>
  <Footer />
</div>

<style>
  .skip {
    position: absolute;
    left: 1rem;
    top: -4rem;
    z-index: 100;
    padding: 0.6rem 1rem;
    border-radius: var(--radius);
    background: var(--paper);
    border: 1px solid var(--line-strong);
    color: var(--text);
  }

  .skip:focus {
    top: 1rem;
  }
</style>
