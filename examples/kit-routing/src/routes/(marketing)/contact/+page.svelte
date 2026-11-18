<script lang="ts">
  import { enhance } from '$app/forms';

  import type { PageProps } from './$types';

  let { form }: PageProps = $props();
</script>

<h1>Contact</h1>
<form method="POST" use:enhance>
  <label>Email <input name="email" value={form?.email ?? ''} /></label>
  <label>Message <input name="message" value={form?.message ?? ''} /></label>
  <button type="submit">Send (default action)</button>
</form>
{#if form?.error}<p role="alert">{form.error}</p>{/if}
{#if form?.sent}<p role="status">Sent message #{form.sent}.</p>{/if}
