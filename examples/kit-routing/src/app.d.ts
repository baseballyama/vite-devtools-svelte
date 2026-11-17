// See https://svelte.dev/docs/kit/types#app.d.ts
// (the export makes this file a module, so `declare global` augments App)

/** Set by handleError (hooks.server.ts / hooks.client.ts), shown by +error.svelte. */
export type ErrorId = string;

declare global {
  namespace App {
    interface Error {
      message: string;
      errorId?: ErrorId;
    }
    interface Locals {
      requestId: string;
      startedAt: number;
    }
    interface PageState {
      photo?: { id: number; title: string; color: string };
    }
  }
}
