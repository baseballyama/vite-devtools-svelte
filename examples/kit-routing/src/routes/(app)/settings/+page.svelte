<script lang="ts">
  import { enhance } from '$app/forms';
  import { snapshot } from '$app/navigation';

  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  let draft = $state('');
  let submitting = $state(false);

  // Kept across back/forward navigation (type something, leave, press Back).
  snapshot({
    capture: () => draft,
    restore: value => (draft = value),
  });
</script>

<h1>Settings</h1>
<p>Current: {data.settings.displayName} · newsletter {data.settings.newsletter ? 'on' : 'off'}</p>

<form
  method="POST"
  action="?/profile"
  use:enhance={() => {
    submitting = true;
    return async ({ update }) => {
      await update({ reset: false });
      submitting = false;
    };
  }}
>
  <label>
    Display name
    <input name="displayName" value={form?.displayName ?? data.settings.displayName} />
  </label>
  <button type="submit" disabled={submitting}>Save (?/profile)</button>
  {#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
</form>

<form method="POST" action="?/newsletter" use:enhance>
  <button type="submit">Toggle newsletter (?/newsletter)</button>
</form>

{#if form?.saved}<p role="status">Saved {form.saved}.</p>{/if}

<label>
  Unsaved note (snapshot)
  <textarea bind:value={draft}></textarea>
</label>

<style>
  form {
    margin: 1rem 0;
  }
  .error {
    color: #c0392b;
  }
</style>
