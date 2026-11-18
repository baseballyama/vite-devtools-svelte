<script>
  import Child from './Child.svelte';
</script>

<section class="outer">
  <p>outer <b>bold</b></p>
</section>
<Child label="first" />
<Child label="second">
  <em class="slotted">slot</em>
</Child>
