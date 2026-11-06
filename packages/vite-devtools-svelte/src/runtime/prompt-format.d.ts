// Types for `./prompt-format.js`, a browser source served as text (`?raw`) and
// imported directly by the unit tests.

export interface SourceLocation {
  file: string | null
  line: number | null
  column: number | null
  enclosing?: boolean
}
export interface TemplateFrame {
  type: string
  file: string | null
  line: number | null
  column: number | null
  componentTag: string | null
}
export interface ComponentRef {
  id: number
  name: string
  file: string
}
export interface ElementRef {
  tag: string
  id: string
  classes: string[]
}
export interface PageInfo {
  url: string
  title: string
  viewport: string
}
/** What `__SVELTE_DEVTOOLS__.inspectElement()` returns for a picked node. */
export interface Inspected {
  epoch?: string
  page?: PageInfo
  element: ElementRef | null
  source: SourceLocation | null
  template: TemplateFrame[]
  components: ComponentRef[]
}

export function relPath(file: string | null | undefined, root: string): string
export function relLocation(loc: SourceLocation | null | undefined, root: string): string
export function isProjectFile(file: string | null | undefined): boolean
export function elementTitle(element: ElementRef | null | undefined): string
export function formatSelection(payload: Inspected, index: number, root: string): string
export function buildPrompt(selections: Inspected[], instructions: string, root: string): string
