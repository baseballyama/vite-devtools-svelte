declare global {
  /** Injected by Vite `define` (see vite.config.ts). */
  const __PKG_VERSION__: string

  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

declare module '*.md?raw' {
  const content: string
  export default content
}

export {}
