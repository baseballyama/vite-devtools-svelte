// vite-devtools-svelte: a reduced copy of vite-plugin-svelte's `src/utils/log.js`
// with only what the inspector plugin calls (`debug`, `warn`).

import { createDebug } from 'obug';

const prefix = 'vite-devtools-svelte';

type LogFn = (message: string, payload?: unknown, namespace?: string) => void;

function createLogger(logFn: (...args: unknown[]) => void): LogFn {
  return (message, payload, namespace) => {
    const text = `[${prefix}${namespace ? `:${namespace}` : ''}] ${message}`;
    if (payload) logFn(text, payload);
    else logFn(text);
  };
}

export const log: { debug: LogFn; warn: LogFn } = {
  debug(message, payload, namespace) {
    const debug = createDebug(namespace ? `${prefix}:${namespace}` : prefix);
    if (!debug.enabled) return;
    if (payload) debug(message, payload);
    else debug(message);
  },
  // Looked up on each call, so console patches made after import (tests, other tools) apply.
  warn: createLogger((...args) => console.warn(...args)),
};
