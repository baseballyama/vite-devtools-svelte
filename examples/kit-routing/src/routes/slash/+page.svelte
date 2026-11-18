<h1>trailingSlash = 'always'</h1>
<p>
  Visit <!-- Deliberately without the slash (resolve() only types /slash/) -->
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
  <a href="/slash" data-sveltekit-reload>/slash</a>: it redirects to <code>/slash/</code>.
</p>
