<script lang="ts">
  import { onMount } from 'svelte';
  import options from 'virtual:vite-devtools-svelte-inspector-options';

  import { INSPECTOR_ICON_HOTSPOT, INSPECTOR_ICON_URL } from './icon.js';

  // Copied from Svelte's internal types
  interface DevStackEntry {
    file: string;
    type: 'component' | 'if' | 'each' | 'await' | 'key' | 'render';
    line: number;
    column: number;
    parent: DevStackEntry | null;
    componentTag?: string;
  }

  interface Metadata {
    loc: Loc;
    parent?: DevStackEntry;
  }

  interface Loc {
    file: string;
    line: number;
    column: number;
  }

  interface ElementWithMetadata extends Element {
    __svelte_meta: Metadata;
  }

  type StackItem = Loc & { tag: string };

  interface Props {
    /** open `loc` in the editor */
    openInEditor: (loc: Loc) => void;
    /** the inspector was enabled or disabled */
    onenabledchange: (enabled: boolean) => void;
    /** whether `e` comes from the dock's own ui, which the inspector must not handle */
    ignore: (e: Event) => boolean;
  }

  let { openInEditor, onenabledchange, ignore }: Props = $props();

  // `minus` stands for the `-` key, which separates the keys of a combo
  const toggle_combo = options.toggleKeyCombo
    .toLowerCase()
    .split('-')
    .map(k => (k === 'minus' ? '-' : k));
  const escape_keys = options.escapeKeys.map(k => k.toLowerCase());
  const nav_keys = Object.values(options.navKeys).map(k => k.toLowerCase());
  const open_key = options.openKey.toLowerCase();
  const open_menu_key = options.openMenuKey.toLowerCase();

  let enabled = $state(false);
  let has_opened = $state(false);

  const icon = INSPECTOR_ICON_URL;

  let x = $state(0),
    y = $state(0),
    w = $state(0),
    h = $state(0);

  let active_el = $state<ElementWithMetadata | undefined>();
  // the component instance of `active_el`, named by an in-page tool (see `describe`); null when none did
  let active_name = $state<string | null>(null);

  let menu = $state<{ x: number; y: number; stack: Array<Loc & { tag: string }> } | null>(null);

  let hold_start_ts = $state<number | null>(null);

  function mousemove(e: MouseEvent) {
    if (menu || ignore(e)) return;
    x = e.x;
    y = e.y;
  }

  function find_selectable_parent(el: Element | undefined, include_self = false) {
    let candidate: Element | undefined = el;

    if (!include_self) {
      candidate = candidate?.parentElement ?? undefined;
    }

    while (candidate) {
      if (is_selectable(candidate)) {
        return candidate;
      }

      candidate = candidate.parentElement ?? undefined;
    }
    return undefined;
  }

  function find_selectable_child(el: Element) {
    return [...el.querySelectorAll('*')].find(is_selectable);
  }

  function find_selectable_sibling(el: Element, prev = false) {
    let candidate: Element | null = el;
    do {
      candidate = prev ? candidate.previousElementSibling : candidate.nextElementSibling;
      if (is_selectable(candidate)) {
        return candidate;
      }
    } while (candidate);
    return undefined;
  }

  // matched like `is_nav`, so a key recorded by its code (e.g. `w`) also moves on other
  // keyboard layouts, where `e.key` differs
  function find_selectable_for_nav(e: KeyboardEvent) {
    const el = active_el;
    if (!el) {
      return find_selectable_child(document.body);
    }
    const { parent, child, next, prev } = options.navKeys;
    const keys = [parent, child, next, prev].map(k => k.toLowerCase());
    // by the physical key first: on AZERTY `e.key` of KeyZ is the `w` another direction uses
    const physical = physical_key(e.code);
    let i = keys.indexOf(physical);
    if (i === -1) i = keys.indexOf(e.key.toLowerCase());
    if (i === 0) return find_selectable_parent(el);
    if (i === 1) return find_selectable_child(el);
    if (i === 2) return find_selectable_sibling(el) || find_selectable_parent(el);
    if (i === 3) return find_selectable_sibling(el, true) || find_selectable_parent(el);
    return undefined;
  }

  function is_selectable(el: Element | null): el is ElementWithMetadata {
    if (!el) return false;
    // Only elements rendered by a Svelte component in dev mode carry `__svelte_meta`.
    const file = (el as Element & { __svelte_meta?: Metadata }).__svelte_meta?.loc.file;
    if (!file || file.includes('node_modules/')) {
      return false; // no file or 3rd party
    }
    const id = el.getAttribute('id');
    if (id === 'svelte-announcer' || id?.startsWith('svelte-inspector-')) {
      return false; // ignore some elements by id that would be selectable from keyboard nav otherwise
    }
    return true;
  }

  function mouseover(e: MouseEvent) {
    if (menu || ignore(e)) return;
    const el = find_selectable_parent(e.target as ElementWithMetadata, true);
    activate(el, false);
  }

  function activate(el: ElementWithMetadata | undefined, set_bubble_pos = true) {
    if (options.customStyles && el !== active_el) {
      if (active_el) {
        active_el.classList.remove('svelte-inspector-active-target');
      }
      if (el) {
        el.classList.add('svelte-inspector-active-target');
      }
    }

    // `mouseover` repeats inside the same element
    if (el !== active_el) active_name = el ? describe(el) : null;
    active_el = el;
    if (set_bubble_pos) {
      const pos = el!.getBoundingClientRect();
      x = Math.ceil(pos.left);
      y = Math.ceil(pos.bottom - 20);
    }
  }

  function open_editor(e: Event) {
    if (menu || ignore(e)) return;

    if (active_el) {
      stop(e);
      send(active_el.__svelte_meta.loc, active_el);
    }
  }

  // in-page tools (e.g. a devtools panel) name the component instance; a listener sets
  // `detail.name`
  function describe(el: Element): string | null {
    const detail: { element: Element; name: unknown } = { element: el, name: null };
    window.dispatchEvent(new CustomEvent('svelte-inspector:describe', { detail }));
    return typeof detail.name === 'string' ? detail.name : null;
  }

  function get_stack(target: ElementWithMetadata) {
    const el = find_selectable_parent(target, true)!;
    const meta = el.__svelte_meta;

    const stack: StackItem[] = [
      {
        file: meta.loc.file,
        line: meta.loc.line,
        column: meta.loc.column,
        tag: el.tagName.toLowerCase(),
      },
    ];

    let entry: Metadata | DevStackEntry | undefined = meta;

    while ((entry = entry.parent ?? undefined)) {
      if (entry.type !== 'component') continue;
      if (is_dependency_or_generated(entry.file)) continue;

      stack.push({
        file: entry.file,
        line: entry.line,
        column: entry.column,
        tag: entry.componentTag!,
      });
    }

    return stack;
  }

  function is_dependency_or_generated(file: string) {
    return ['node_modules/', '.svelte-kit/'].some(
      dir => file.startsWith(dir) || file.includes(`/${dir}`),
    );
  }

  function on_contextmenu(e: Event) {
    if (ignore(e)) return;
    e.preventDefault();

    active_el ??= find_selectable_parent(e.target as Element);
    if (!active_el) return;

    stop(e);
    menu = { x, y, stack: get_stack(active_el) };
  }

  /** `element`: the element opened, null for a component chosen from the menu */
  function send(loc: Loc, element: Element | null = null) {
    // for other in-page tools, e.g. to reveal the component in a devtools panel
    const stack = active_el ? get_stack(active_el) : [];
    window.dispatchEvent(
      new CustomEvent<{ loc: Loc; stack: StackItem[]; element: Element | null }>(
        'svelte-inspector:pick',
        { detail: { loc, stack, element } },
      ),
    );
    openInEditor(loc);
    has_opened = true;
    menu = null;
    if (options.holdMode && is_holding()) {
      disable();
    }
  }

  // digits by code too, so `shift-1` matches though `e.key` is `!`
  function physical_key(code: string) {
    if (code.startsWith('Key')) return code.slice(3).toLowerCase();
    if (code.startsWith('Digit')) return code.slice(5);
    return code.toLowerCase();
  }

  function is_active(key: string, e: KeyboardEvent) {
    switch (key) {
      case 'shift':
      case 'control':
      case 'alt':
      case 'meta':
        return e.getModifierState(key.charAt(0).toUpperCase() + key.slice(1));
      default:
        return key === physical_key(e.code) || key === e.key.toLowerCase();
    }
  }

  function is_combo(e: KeyboardEvent) {
    return toggle_combo.every(k => is_active(k, e));
  }

  function is_escape(e: KeyboardEvent) {
    return escape_keys.some(k => is_active(k, e));
  }

  function is_toggle(e: KeyboardEvent) {
    return toggle_combo.some(k => is_active(k, e));
  }

  function is_nav(e: KeyboardEvent) {
    return nav_keys.some(k => is_active(k, e));
  }

  function is_open(e: KeyboardEvent) {
    return open_key && is_active(open_key, e);
  }

  function is_open_menu(e: KeyboardEvent) {
    return open_menu_key && is_active(open_menu_key, e);
  }

  function is_holding() {
    return hold_start_ts && Date.now() - hold_start_ts > 250;
  }

  function stop(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  // Chrome's autofill dispatches keyboard events without a `key`.
  function has_key(e: KeyboardEvent) {
    return (e.key as string | undefined) != null;
  }

  function keydown(e: KeyboardEvent) {
    // typing in the dock's own ui (e.g. its command palette)
    if (ignore(e)) return;
    if (e.repeat || !has_key(e) || (!enabled && !is_toggle(e))) {
      return;
    }
    if (is_combo(e)) {
      toggle();
      if (options.holdMode && enabled) {
        hold_start_ts = Date.now();
      }
    } else if (enabled) {
      if (is_nav(e)) {
        const el = find_selectable_for_nav(e);
        if (el) {
          activate(el);
          stop(e);
        }
      } else if (is_open(e)) {
        open_editor(e);
      } else if (is_open_menu(e)) {
        on_contextmenu(e);
      } else if (is_holding() || is_escape(e)) {
        // is_holding() checks for unhandled additional key pressed
        // while holding the toggle keys, which is possibly another
        // shortcut (e.g. 'meta-shift-x'), so disable again.

        disable();
      }
    }
  }

  function keyup(e: KeyboardEvent) {
    if (e.repeat || !has_key(e) || !enabled) {
      return;
    }
    if (is_toggle(e)) {
      if (is_holding()) {
        disable();
      } else {
        hold_start_ts = null;
      }
    }
  }

  function toggle() {
    if (enabled) {
      disable();
    } else {
      enable();
    }
  }

  function listeners(body: HTMLBodyElement, enabled: boolean) {
    if (enabled) {
      body.addEventListener('mousemove', mousemove);
      body.addEventListener('mouseover', mouseover);
      body.addEventListener('click', open_editor, true);
      body.addEventListener('contextmenu', on_contextmenu, true);
    } else {
      body.removeEventListener('mousemove', mousemove);
      body.removeEventListener('mouseover', mouseover);
      body.removeEventListener('click', open_editor, true);
      body.removeEventListener('contextmenu', on_contextmenu, true);
    }
  }

  export function enable() {
    if (enabled) return;
    enabled = true;
    const b = document.body as HTMLBodyElement;
    if (options.customStyles) {
      b.classList.add('svelte-inspector-enabled');
    }
    listeners(b, enabled);
    activate_initial_el();
    onenabledchange(true);
  }

  function activate_initial_el() {
    const hov = innermost_hover_el();
    let el = find_selectable_parent(hov, true);
    if (!el) {
      const act = document.activeElement ?? undefined;
      el = find_selectable_parent(act, true);
    }
    if (!el) {
      el = find_selectable_child(document.body);
    }
    if (el) {
      activate(el);
    }
  }

  function innermost_hover_el() {
    let e = document.body.querySelector(':hover');
    let result;
    while (e) {
      result = e;
      e = e.querySelector(':hover');
    }
    return result;
  }

  export function disable() {
    const was_enabled = enabled;
    enabled = false;
    has_opened = false;
    hold_start_ts = null;
    menu = null;
    const b = document.body as HTMLBodyElement;
    listeners(b, enabled);
    if (options.customStyles) {
      b.classList.remove('svelte-inspector-enabled');
      active_el?.classList.remove('svelte-inspector-active-target');
    }
    active_el = undefined;
    active_name = null;
    if (was_enabled) onenabledchange(false);
  }

  function visibilityChange() {
    if (document.visibilityState === 'hidden') {
      onLeave();
    }
  }

  function onLeave() {
    if (enabled && (has_opened || hold_start_ts)) {
      disable();
    }
  }

  onMount(() => {
    const s = document.createElement('style');
    s.setAttribute('type', 'text/css');
    s.setAttribute('id', 'svelte-inspector-style');
    s.textContent = `:root { --svelte-inspector-icon: url(${icon}); --svelte-inspector-cursor: url(${icon}) ${INSPECTOR_ICON_HOTSPOT}, crosshair; }`;
    document.head.append(s);
    document.body.addEventListener('keydown', keydown);
    if (options.holdMode) {
      document.body.addEventListener('keyup', keyup);
    }
    document.addEventListener('visibilitychange', visibilityChange);
    document.documentElement.addEventListener('mouseleave', onLeave);
    return () => {
      disable();
      const s = document.head.querySelector('#svelte-inspector-style');
      if (s) {
        document.head.removeChild(s);
      }
      document.body.removeEventListener('keydown', keydown);
      if (options.holdMode) {
        document.body.removeEventListener('keyup', keyup);
      }
      document.removeEventListener('visibilitychange', visibilityChange);
      document.documentElement.removeEventListener('mouseleave', onLeave);
    };
  });
</script>

<svelte:window
  onclick={disable}
  onkeydown={(e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      disable();
    }
  }}
/>

{#if enabled && (menu || active_el)}
  <div
    id="svelte-inspector-overlay"
    style:left="{Math.min(x + 3, document.documentElement.clientWidth - w - 10)}px"
    style:top="{document.documentElement.clientHeight < y + h + 40 ? y - h - 10 : y + 30}px"
    bind:offsetWidth={w}
    bind:offsetHeight={h}
  >
    {#if menu}
      <button
        type="button"
        aria-label="close"
        class="svelte-inspector-button"
        {@attach (node: HTMLButtonElement) => node.focus()}
      >
        <span>close</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          width="1em"
          height="1em"
          viewBox="0 0 24 24"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg
        >
      </button>

      <hr />

      <ul class="svelte-inspector-grid">
        {#each menu.stack as item, i (`${item.file}:${item.line}:${i}`)}
          <li>
            <button type="button" class="svelte-inspector-menu-row" onclick={() => send(item)}>
              <span class="svelte-inspector-tag">&lt;{item.tag}&gt;</span>
              <span class="svelte-inspector-file">{item.file}:{item.line}</span>
            </button>
          </li>
        {/each}
      </ul>
    {:else if active_el}
      {@const loc = active_el.__svelte_meta.loc}

      <div class="svelte-inspector-grid">
        <div class="svelte-inspector-menu-row">
          <span class="svelte-inspector-tag"
            >&lt;{active_name ?? active_el.tagName.toLowerCase()}&gt;</span
          >
          <span class="svelte-inspector-file">{loc.file}:{loc.line}</span>
        </div>
      </div>

      <div id="svelte-inspector-announcer" aria-live="assertive" aria-atomic="true">
        {active_el.tagName.toLowerCase()} in file {loc.file} on line {loc.line} column {loc.column +
          1}
      </div>
    {/if}
  </div>
{/if}

<style>
  :global(body.svelte-inspector-enabled *) {
    cursor: var(--svelte-inspector-cursor) !important;
  }
  :global(.svelte-inspector-active-target) {
    outline: 2px dashed #ff3e00 !important;
  }
  :global(#svelte-inspector-host) {
    direction: ltr;
  }

  *:not(svg *) {
    all: unset;
    box-sizing: border-box;
  }

  #svelte-inspector-overlay {
    position: fixed;
    padding: 2px;
    margin: 0;
    border-radius: 2px;
    filter: drop-shadow(2px 2px 4px rgb(0 0 0 / 0.1));
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 12px;
    line-height: 1.4;
    z-index: 999999;
    background-color: #fff;
    color: #222;
    cursor: auto;
    user-select: none;
  }

  .svelte-inspector-grid {
    display: grid;
    grid-template-columns: max-content 1fr;
    column-gap: 8px;
  }

  #svelte-inspector-announcer {
    position: absolute;
    left: 0px;
    top: 0px;
    clip: rect(0px, 0px, 0px, 0px);
    clip-path: inset(50%);
    overflow: hidden;
    white-space: nowrap;
    width: 1px;
    height: 1px;
  }

  .svelte-inspector-tag {
    white-space: nowrap;
    font-weight: 600;
  }

  .svelte-inspector-file {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #444;
  }

  ul {
    max-width: 480px;
    list-style: none;
    margin: 0;
    padding: 0;
    display: contents;

    li {
      display: contents;
    }
  }

  button {
    background: transparent;
    border: none;
    color: inherit;
    pointer-events: all;
    font: inherit;
    align-items: center;
    cursor: pointer;

    &:focus-visible {
      outline: 2px solid #ff3e00;
    }

    &:hover,
    &:focus-visible {
      background-color: rgb(0 0 0 / 0.05);
    }
  }

  hr {
    margin: 2px;
    background: rgb(0 0 0 / 0.05);
    border: none;
    height: 1px;
    width: 100%;
    display: block;
  }

  svg path {
    stroke: currentColor;
  }

  .svelte-inspector-button {
    display: flex;
    justify-content: space-between;
    width: 100%;
    padding: 4px 8px;
  }

  .svelte-inspector-menu-row {
    display: grid;
    grid-column: 1 / 3;
    grid-template-columns: subgrid;
    box-sizing: border-box;
    align-items: baseline;
    width: 100%;
    padding: 4px 8px;
    cursor: pointer;

    &:hover,
    &:focus-visible {
      background-color: rgb(0 0 0 / 0.05);
    }
  }
</style>
