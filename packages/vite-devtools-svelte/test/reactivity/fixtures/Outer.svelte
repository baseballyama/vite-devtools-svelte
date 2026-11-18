<script>
  import Card from './Card.svelte';
  import Leaf from './Leaf.svelte';

  const Alias = Card;
</script>

<Card title="one" />
<Card title="two" />
<Card title="slot"><Leaf label="passed" /></Card>
<Alias title="alias" />
<Card title="styled" --gap="1px" />
