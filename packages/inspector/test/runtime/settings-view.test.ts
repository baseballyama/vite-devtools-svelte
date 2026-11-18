import { flushSync, mount, unmount } from 'svelte';
import type { Component } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Inspector from '../../src/runtime/Inspector.svelte';
import KeyInput from '../../src/runtime/KeyInput.svelte';
import SettingsView from '../../src/runtime/SettingsView.svelte';

// a combo with a digit, whose `e.key` changes with shift
vi.mock('virtual:vite-devtools-svelte-inspector-options', async importOriginal => {
  const { default: options } = await importOriginal<{ default: Record<string, unknown> }>();
  return { default: { ...options, toggleKeyCombo: 'shift-1', holdMode: false } };
});

const defaults = {
  toggleKeyCombo: 'alt-x',
  holdMode: true,
  openKey: 'Enter',
  openMenuKey: ' ',
  escapeKeys: ['Backspace', 'Escape'],
  navKeys: { parent: 'ArrowUp', child: 'ArrowDown', next: 'ArrowRight', prev: 'ArrowLeft' },
  customStyles: true,
};

const mounted: Record<string, unknown>[] = [];

afterEach(() => {
  for (const component of mounted.splice(0)) void unmount(component);
  document.body.replaceChildren();
});

function show<Props extends Record<string, unknown>>(component: Component<Props>, props: Props) {
  mounted.push(mount(component, { target: document.body, props }));
  flushSync();
}

const button = (text: string) =>
  [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!;

const holdSwitch = () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;

function toggleHold() {
  holdSwitch().click();
  flushSync();
}

describe('SettingsView', () => {
  it('keeps tracking edits after resetting unsaved ones', () => {
    show(SettingsView, {
      current: defaults,
      defaults,
      file: '.env.local',
      save: vi.fn(),
      reset: vi.fn(),
    });
    toggleHold();
    expect(button('Save').disabled).toBe(false);

    button('Reset to defaults').click();
    flushSync();
    expect(holdSwitch().checked).toBe(true);
    expect(button('Save').disabled).toBe(true);

    toggleHold();
    expect(holdSwitch().checked).toBe(false);
    expect(button('Save').disabled).toBe(false);
  });
});

describe('KeyInput', () => {
  it('records the minus key by its code, as `-` separates the keys of a combo', () => {
    const onchange = vi.fn();
    show(KeyInput, { mode: 'combo' as const, value: 'alt-x', label: 'Shortcut', onchange });
    document.querySelector('button')!.click();
    flushSync();
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: '-', code: 'Minus', ctrlKey: true, bubbles: true }),
    );
    expect(onchange).toHaveBeenCalledWith('control-minus');
  });
});

describe('Inspector', () => {
  it('matches a digit in the combo by its code, though shift changes `e.key`', () => {
    const onenabledchange = vi.fn();
    show(Inspector, { openInEditor: vi.fn(), onenabledchange, ignore: () => false });
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: '!', code: 'Digit1', shiftKey: true, bubbles: true }),
    );
    flushSync();
    expect(onenabledchange).toHaveBeenLastCalledWith(true);
  });
});
