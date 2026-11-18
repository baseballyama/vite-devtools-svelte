/**
 * Layout stand-ins for happy-dom, which computes no layout: every element
 * reports a 0 × 0 box unless a test says otherwise.
 */
import { afterEach, vi } from 'vitest';

import * as rpc from '../lib/rpc.js';
import { versions } from './fake-rpc.js';

const restores: (() => void)[] = [];

afterEach(() => {
  for (const restore of restores.splice(0).toReversed()) restore();
  vi.useRealTimers();
});

function stubGetter(proto: object, prop: string, get: (this: HTMLElement) => number): void {
  const previous = Object.getOwnPropertyDescriptor(proto, prop);
  Object.defineProperty(proto, prop, { configurable: true, get });
  restores.push(() => {
    if (previous) Object.defineProperty(proto, prop, previous);
    else Reflect.deleteProperty(proto, prop);
  });
}

/**
 * Give every element a box (`clientWidth`/`clientHeight`, `offset*`, and
 * `getBoundingClientRect`) for the rest of the test. `size` may depend on
 * the element (e.g. only the scroll viewport is tall).
 */
export function layout(size: (el: HTMLElement) => { width: number; height: number }): void {
  const proto = HTMLElement.prototype;
  stubGetter(proto, 'clientWidth', function () {
    return size(this).width;
  });
  stubGetter(proto, 'clientHeight', function () {
    return size(this).height;
  });
  stubGetter(proto, 'offsetWidth', function () {
    return size(this).width;
  });
  stubGetter(proto, 'offsetHeight', function () {
    return size(this).height;
  });
  const rect = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect');
  Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: HTMLElement) {
      const { width, height } = size(this);
      return DOMRect.fromRect({ x: 0, y: 0, width, height });
    },
  });
  restores.push(() => {
    if (rect) Object.defineProperty(Element.prototype, 'getBoundingClientRect', rect);
  });
}

/** A macrotask turn: lets timers queued with 0 ms run. */
export function nextTask(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}

/** Resolve after pending promise callbacks (RPC answers) and the Svelte updates they trigger. */
export async function settle(): Promise<void> {
  const { tick } = await import('svelte');
  for (let i = 0; i < 5; i++) {
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });
    await tick();
  }
}

/**
 * Fake the poll clock (`setInterval` and `Date`) for the rest of the test so
 * `nextPoll` can step a panel to its next poll. `setTimeout` stays real, so
 * `settle` still works. Call before rendering; real timers come back after each test.
 */
export function fakePollClock(): void {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
}

let pollStep = 0;

/**
 * Run the next poll of a panel that polls every `interval` ms (after
 * `fakePollClock`), with every dataset counter moved so the poll refetches,
 * and let its answer render.
 */
export async function nextPoll(interval: number): Promise<void> {
  pollStep++;
  const moved = Object.fromEntries(
    Object.keys(versions).map(k => [k, pollStep]),
  ) as unknown as typeof versions;
  vi.mocked(rpc.getVersions).mockResolvedValue(moved);
  await vi.advanceTimersByTimeAsync(interval);
  await settle();
}
