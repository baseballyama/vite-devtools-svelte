// A global script (no import/export): every declaration here is ambient.

/** Injected by Vite `define` (see vite.config.ts). */
declare const __PKG_VERSION__: string

declare namespace App {
  // interface Error {}
  // interface Locals {}
  // interface PageData {}
  // interface PageState {}
  // interface Platform {}
}

declare module '*.md?raw' {
  const content: string
  export default content
}
