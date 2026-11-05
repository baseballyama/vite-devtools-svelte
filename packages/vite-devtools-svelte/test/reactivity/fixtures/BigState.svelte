<script>
  let blob = $state({
    text: 'x'.repeat(8000),
    list: Array.from({ length: 50 }, (_, index) => ({ index, label: 'row ' + index })),
  })
</script>

<p class="big">{blob.text.length}</p>
