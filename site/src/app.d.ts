// A global script (no import/export): every declaration here is ambient.

/** Injected by Vite `define` (see vite.config.ts). */
declare const __PKG_VERSION__: string;

declare namespace App {}

declare module '*.md?raw' {
  const content: string;
  export default content;
}
