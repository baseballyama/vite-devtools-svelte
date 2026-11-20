<script lang="ts">
  import { physicalKey } from './keys.js';

  interface Props {
    /** `combo` is modifiers and one key like `alt-x`, `key` is a single key */
    mode: 'combo' | 'key';
    value: string;
    onchange: (value: string) => void;
    label: string;
  }

  let { mode, value, onchange, label }: Props = $props();

  let recording = $state(false);
  // modifiers held while recording
  let held: string[] = [];

  const MODIFIERS = ['shift', 'control', 'alt', 'meta'];

  // modifier names as the keyboard prints them, option and command on a mac
  const platform = window.navigator.platform.toLowerCase();
  const mac = ['mac', 'iphone', 'ipad'].some(name => platform.includes(name));
  const MODIFIER_NAMES: Record<string, string> = mac
    ? { control: '⌃ Control', alt: '⌥ Option', shift: '⇧ Shift', meta: '⌘ Cmd' }
    : { control: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win' };

  const KEY_NAMES: Record<string, string> = {
    arrowup: '↑',
    arrowdown: '↓',
    arrowleft: '←',
    arrowright: '→',
    backspace: '⌫ Backspace',
    escape: 'Esc',
    enter: '↵ Enter',
    minus: '-',
  };

  function key_of(e: KeyboardEvent) {
    const physical = physicalKey(e.code);
    if (physical !== undefined) return physical;
    // modifiers lowercase, as in a combo
    return MODIFIERS.includes(e.key.toLowerCase()) ? e.key.toLowerCase() : e.key;
  }

  function format_keys(v: string) {
    if (v === ' ') return 'Space';
    return v
      .split('-')
      .map(part => {
        if (part in MODIFIER_NAMES) return MODIFIER_NAMES[part];
        return KEY_NAMES[part.toLowerCase()] ?? (part.length === 1 ? part.toUpperCase() : part);
      })
      .join(' + ');
  }

  function finish(next: string) {
    recording = false;
    held = [];
    if (next) onchange(next);
  }

  function keydown(e: KeyboardEvent) {
    e.preventDefault();
    e.stopImmediatePropagation();
    const k = key_of(e);
    const name = k.toLowerCase();
    if (mode === 'key') return finish(k);
    if (MODIFIERS.includes(name)) {
      if (!held.includes(name)) held.push(name);
      return;
    }
    const mods = MODIFIERS.filter(m => e.getModifierState(m.charAt(0).toUpperCase() + m.slice(1)));
    // `-` separates the keys of a combo, so the minus key is saved as `minus`
    finish([...mods, name === '-' ? 'minus' : name].join('-'));
  }

  function keyup(e: KeyboardEvent) {
    e.preventDefault();
    e.stopImmediatePropagation();
    // a modifiers only combo like meta-shift, released without another key
    if (mode === 'combo' && held.length > 0)
      finish(MODIFIERS.filter(m => held.includes(m)).join('-'));
  }

  function record() {
    if (recording) return finish('');
    recording = true;
  }
</script>

<!-- capture while recording, svelte removes them when recording stops or the input unmounts -->
<svelte:window
  onkeydowncapture={recording ? keydown : undefined}
  onkeyupcapture={recording ? keyup : undefined}
/>

<button
  type="button"
  class={['sis-key', { recording }]}
  aria-label={`${label}: ${format_keys(value)}. Click to record a new ${mode === 'combo' ? 'shortcut' : 'key'}`}
  onclick={record}
  onblur={() => recording && finish('')}
>
  {#if recording}
    <span class="sis-key-hint">{mode === 'combo' ? 'Press a shortcut…' : 'Press a key…'}</span>
  {:else}
    {#each format_keys(value).split(' + ') as part, i (i)}
      {#if i > 0}<span class="sis-key-plus">+</span>{/if}<kbd>{part}</kbd>
    {/each}
  {/if}
</button>
