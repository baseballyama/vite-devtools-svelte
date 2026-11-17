<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
</script>

<h1>{page.status}</h1>
<p data-testid="error-message">{page.error?.message}</p>
<a href={resolve('/users')}>Back to users</a>
