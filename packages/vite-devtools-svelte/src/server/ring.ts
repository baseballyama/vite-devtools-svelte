import type { CaptureInfo } from '../types.js'

/** A tail-capped dataset that counts what it received since the last clear. */
export class Ring<T> {
  items: T[] = []
  received = 0
  private readonly max: number
  constructor(max: number) {
    this.max = max
  }

  push(item: T): void {
    this.received++
    this.items.push(item)
    if (this.items.length > this.max) this.items = this.items.slice(-this.max)
  }

  clear(): void {
    this.items = []
    this.received = 0
  }

  get info(): CaptureInfo {
    const captured = this.items.length
    return { captured, total: this.received, truncated: this.received > captured, policy: 'tail' }
  }
}
