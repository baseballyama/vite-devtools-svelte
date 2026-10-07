export class Counter {
  count = $state(0)
  doubled = $derived(this.count * 2)
  inc() {
    this.count++
  }
}
