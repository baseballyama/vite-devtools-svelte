// A custom class sent from server loads to the browser through the `transport`
// hook (src/hooks.ts): the client gets a real `Money`, not a plain object.
export class Money {
  constructor(
    readonly cents: number,
    readonly currency: string,
  ) {}

  format(): string {
    return `${(this.cents / 100).toFixed(2)} ${this.currency}`;
  }
}
