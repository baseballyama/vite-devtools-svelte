<script lang="ts">
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
  const platform = window.navigator.platform;
  const mac = /mac|iphone|ipad/i.test(platform);
  const MODIFIER_NAMES: Record<string, string> = mac
    ? { control: '⌃ Control', alt: '⌥ Option', shift: '⇧ Shift', meta: '⌘ Cmd' }
    : { control: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win' };

  /** how keys are shown */
  const NAMES: Record<string, string> = {
    arrowup: '↑',
    arrowdown: '↓',
    arrowleft: '←',
    arrowright: '→',
    backspace: '⌫ Backspace',
    escape: 'Esc',
    enter: '↵ Enter',
  };

  /** the key as the inspector compares it, letters and digits by physical key */
  function key_of(e: KeyboardEvent) {
    if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase();
    if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
    return e.key.toLowerCase() === 'control' ? 'control' : e.key;
  }

  function show(v: string) {
    if (v === ' ') return 'Space';
    return v
      .split('-')
      .map(part => {
        if (part in MODIFIER_NAMES) return MODIFIER_NAMES[part];
        return NAMES[part.toLowerCase()] ?? (part.length === 1 ? part.toUpperCase() : part);
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
    finish([...mods, name].join('-'));
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
  aria-label={`${label}: ${show(value)}. Click to record a new ${mode === 'combo' ? 'shortcut' : 'key'}`}
  onclick={record}
  onblur={() => recording && finish('')}
>
  {#if recording}
    <span class="sis-key-hint">{mode === 'combo' ? 'Press a shortcut…' : 'Press a key…'}</span>
  {:else}
    {#each show(value).split(' + ') as part, i (i)}
      {#if i > 0}<span class="sis-key-plus">+</span>{/if}<kbd>{part}</kbd>
    {/each}
  {/if}
</button>
